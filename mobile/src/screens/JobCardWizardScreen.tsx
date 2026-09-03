import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
// See JobCardDetailScreen.tsx's import of this same subpath - expo-file-system 54+ moved the old
// imperative writeAsStringAsync/EncodingType/StorageAccessFramework API here.
import * as FileSystem from 'expo-file-system/legacy'
import { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { PickerField, type PickerOption } from '../components/PickerField'
import { VEHICLE_MODELS, variantsForModel } from '../data/vehicleCatalog'
import { buildJobCardPrintHtml } from '../utils/printJobCard'
import type {
  BaplDealerResolveResult, BaplDmsComplaint, BaplDmsDealer, BaplDmsJobSource, BaplDmsJobType,
  BaplDmsServiceHead, BaplDmsServiceType, BaplDmsVehicleLookup, BaplDmsVehicleSuggestion, BaplDmsWorkshop,
  Customer, Dealer, JobCardPriority, JobCardSource, PhotoStage, ServiceType, Vehicle,
} from '../types'
import type { RootStackParamList } from '../navigation/RootNavigator'

type Props = NativeStackScreenProps<RootStackParamList, 'JobCardWizard'>

const STEPS = ['Customer', 'Vehicle', 'Service Details', 'Review & Create']

// Same best-effort BAPL DMS -> JobCardScanner enum mapping web's wizard uses - see
// web/src/pages/staff/JobCardWizardPage.tsx's doc comment on these two functions for why this
// isn't (and can't be) an authoritative 1:1 translation.
function mapBaplJobTypeToServiceType(baplJobTypeName: string): ServiceType {
  const n = baplJobTypeName.trim().toLowerCase()
  if (n === 'pdi') return 'Pdi'
  if (n === 'accidental') return 'AccidentRepair'
  if (n === 'in warranty period') return 'Warranty'
  if (n === 'post warranty period') return 'PaidService'
  return 'PaidService'
}
function mapBaplJobSourceToSource(baplJobSourceName: string): JobCardSource {
  const n = baplJobSourceName.trim().toLowerCase()
  if (n === 'walk in') return 'WalkIn'
  if (n === 'rsa') return 'Breakdown'
  if (n === 'mega camp') return 'Scheduled'
  return 'WalkIn'
}

type PendingPhoto = {
  id: string
  uri: string
  fileName: string
  mimeType: string
  caption: string
  stage: PhotoStage
  latitude?: number
  longitude?: number
}

const MAX_PHOTO_BYTES = 1_000_000_000

export function JobCardWizardScreen({ navigation }: Props) {
  const { profile } = useStaffAuth()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---- Dealer / workshop (head-office accounts only - see profile.dealerId) ----
  const [dealers, setDealers] = useState<Dealer[]>([])
  const [selectedDealerId, setSelectedDealerId] = useState('')
  const needsDealerPicker = !profile?.dealerId
  const effectiveDealerId = profile?.dealerId || selectedDealerId

  useEffect(() => {
    if (!needsDealerPicker) return
    apiClient.get<Dealer[]>('/api/dealers')
      .then(({ data }) => setDealers(data.filter((d) => !!d.baplDmsDealerCode)))
      .catch(() => setDealers([]))
  }, [needsDealerPicker])

  const [dealerSearchQ, setDealerSearchQ] = useState('')
  const [baplDealerResults, setBaplDealerResults] = useState<BaplDmsDealer[]>([])
  const [dealerSearchError, setDealerSearchError] = useState<string | null>(null)
  const [resolvingDealer, setResolvingDealer] = useState(false)
  const [newDealerLogin, setNewDealerLogin] = useState<{ email: string; password: string } | null>(null)

  const searchBaplDealers = async () => {
    if (dealerSearchQ.trim().length < 2) return
    setDealerSearchError(null)
    try {
      const { data } = await apiClient.get<BaplDmsDealer[]>('/api/bapl-dms/dealers', { params: { q: dealerSearchQ } })
      setBaplDealerResults(data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setDealerSearchError(msg ? `BAPL DMS error: ${msg}` : 'Could not reach BAPL DMS right now - try the dropdown above, or again shortly.')
    }
  }

  const selectBaplDealer = async (row: BaplDmsDealer) => {
    setResolvingDealer(true)
    setDealerSearchError(null)
    setNewDealerLogin(null)
    try {
      const { data } = await apiClient.post<BaplDealerResolveResult>('/api/bapl-dms/dealers/resolve', { dealerCode: row.dealerCode })
      setDealers((prev) => (prev.some((d) => d.id === data.id) ? prev : [...prev, data]))
      setSelectedDealerId(data.id)
      setBaplDealerResults([])
      setDealerSearchQ('')
      if (data.loginCreated && data.loginEmail && data.defaultPassword) {
        setNewDealerLogin({ email: data.loginEmail, password: data.defaultPassword })
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setDealerSearchError(msg ? `BAPL DMS error: ${msg}` : `Could not add "${row.dealerName}" from BAPL DMS - try again shortly.`)
    } finally {
      setResolvingDealer(false)
    }
  }

  // ---- Step 0: customer ----
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [newCustomer, setNewCustomer] = useState({ name: '', mobile: '', email: '', city: '', address: '', state: '', saleDate: '' })

  const [chassisOrRegQ, setChassisOrRegQ] = useState('')
  const [vehicleLookupLoading, setVehicleLookupLoading] = useState(false)
  const [vehicleLookupError, setVehicleLookupError] = useState<string | null>(null)
  const [baplVehicleHit, setBaplVehicleHit] = useState<BaplDmsVehicleLookup | null>(null)
  // Item 12a: a styled inline banner instead of a plain Alert.alert() for "This Vehicle not
  // sold" - matches web's same change.
  const [vehicleNotSoldNotice, setVehicleNotSoldNotice] = useState<string | null>(null)
  // "This chassis already has an open job card" - mirrors web's same state/flow (see
  // JobCardWizardPage.tsx's openJobCardNotice doc comment). Shown both as a native Alert (so it
  // can't be missed/scrolled past) and as a persistent banner.
  const [openJobCardNotice, setOpenJobCardNotice] = useState<string | null>(null)
  const [vehicleSuggestions, setVehicleSuggestions] = useState<BaplDmsVehicleSuggestion[]>([])
  // Global (cross-dealer) chassis/reg-no search - offered as a fallback right on the "not found"
  // flag when a dealer-scoped lookup 404s, mirroring BAPL DMS's own Angular "Search Chassis Across
  // All Dealers" popup (ebw-invoice component). GET /api/bapl-dms/vehicle-lookup already supports
  // this - dealerCode is optional server-side and an omitted one searches every dealer (see
  // IBaplDmsService.LookupVehicleAsync's own doc comment) - so no backend change was needed, just
  // this fallback UI wired to the same endpoint with dealerCode left out.
  const [showGlobalSearchOffer, setShowGlobalSearchOffer] = useState(false)
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalHit, setGlobalHit] = useState<BaplDmsVehicleLookup | null>(null)
  const [globalSearchNotFound, setGlobalSearchNotFound] = useState(false)

  // Scopes chassis/reg-no search to the dealer this job card is being created for - mirrors web's
  // JobCardWizardPage.tsx same computation. See AuthController.Me's DealerBaplDmsCode doc comment.
  const vehicleSearchDealerCode = dealers.find((d) => d.id === effectiveDealerId)?.baplDmsDealerCode ?? profile?.dealerBaplDmsCode ?? undefined

  useEffect(() => {
    if (chassisOrRegQ.trim().length < 2) { setVehicleSuggestions([]); return }
    const handle = setTimeout(() => {
      apiClient.get<BaplDmsVehicleSuggestion[]>('/api/bapl-dms/vehicle-suggestions', { params: { q: chassisOrRegQ.trim(), dealerCode: vehicleSearchDealerCode } })
        .then(({ data }) => setVehicleSuggestions(data))
        .catch(() => setVehicleSuggestions([]))
    }, 300)
    return () => clearTimeout(handle)
  }, [chassisOrRegQ, vehicleSearchDealerCode])

  const [unlockCustomerFields, setUnlockCustomerFields] = useState(false)
  const [unlockVehicleFields, setUnlockVehicleFields] = useState(false)
  const customerFieldsLocked = !!baplVehicleHit && !unlockCustomerFields
  const vehicleFieldsLocked = !!baplVehicleHit && !unlockVehicleFields

  const applyVehicleHit = (data: BaplDmsVehicleLookup) => {
    setBaplVehicleHit(data)
    setNewCustomer((c) => ({
      ...c,
      name: data.customerName || c.name,
      mobile: data.customerMobile ? data.customerMobile.replace(/\D/g, '').slice(0, 10) : c.mobile,
      city: data.customerCity || c.city,
      email: data.customerEmail || c.email,
      address: data.customerAddress || c.address,
      saleDate: data.saleDate ? data.saleDate.split('T')[0] : c.saleDate,
    }))
  }

  const lookupByChassisOrReg = async (valueOverride?: string) => {
    const value = (valueOverride ?? chassisOrRegQ).trim()
    if (!value) return
    setVehicleSuggestions([])
    setVehicleLookupLoading(true)
    setVehicleLookupError(null)
    setVehicleNotSoldNotice(null)
    setOpenJobCardNotice(null)
    setBaplVehicleHit(null)
    setUnlockCustomerFields(false)
    setUnlockVehicleFields(false)
    setShowGlobalSearchOffer(false)
    setGlobalHit(null)
    setGlobalSearchNotFound(false)
    try {
      const { data } = await apiClient.get<BaplDmsVehicleLookup>('/api/bapl-dms/vehicle-lookup', { params: { value, dealerCode: vehicleSearchDealerCode } })
      // This chassis already has an open job card somewhere - refuse to auto-fill/proceed with it,
      // and say exactly where so staff know where to go close it first. Matches web's same check.
      if (data.openJobCardNumber) {
        const where = data.openJobCardSource === 'bapl-dms' ? 'in BAPL DMS' : 'here'
        const status = data.openJobCardStatus ? ` (status: ${data.openJobCardStatus})` : ''
        const message = `This chassis already has an open job card ${where}: ${data.openJobCardNumber}${status}. It must be closed before this chassis can be used for a new job card.`
        setOpenJobCardNotice(message)
        Alert.alert('Chassis already checked in', message)
        return
      }
      if (!data.saleDate) {
        // Item 12a/12b: shorter, friendlier wording + a styled inline banner instead of a native
        // Alert.alert() - matches web's same change. 2026-09-03: dropped the extra "'X' was found
        // in DMS." line that used to show right below it too, per explicit request - matches web's
        // same fix (JobCardWizardPage.tsx's own lookupByChassisOrReg).
        setVehicleNotSoldNotice('This Vehicle not sold')
        return
      }
      applyVehicleHit(data)
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: { message?: string } } })?.response
      if (response?.status === 404) {
        setVehicleLookupError(`"${value}" wasn't found in BAPL DMS for this dealer.`)
        // Offer the cross-dealer fallback right on the "not found" flag, instead of only letting
        // the user give up and add the vehicle manually - see the state block above for why this
        // needs no new backend endpoint.
        setShowGlobalSearchOffer(true)
      } else {
        setVehicleLookupError(response?.data?.message
          ? `BAPL DMS error: ${response.data.message}`
          : 'Could not reach BAPL DMS right now - add the customer/vehicle manually below.')
      }
    } finally {
      setVehicleLookupLoading(false)
    }
  }

  /** "Search across all dealers" - re-runs the exact same lookup with dealerCode omitted, so a
   * chassis/reg no. sold by a DIFFERENT dealer still turns up instead of silently reading as
   * "doesn't exist anywhere". Mirrors BAPL DMS's own Angular ebw-invoice component's
   * searchGlobalChassis()/applyGlobalChassisResult() pair. */
  const searchGlobalChassis = async () => {
    const value = chassisOrRegQ.trim()
    if (!value) return
    setGlobalSearchLoading(true)
    setGlobalSearchNotFound(false)
    setGlobalHit(null)
    try {
      const { data } = await apiClient.get<BaplDmsVehicleLookup>('/api/bapl-dms/vehicle-lookup', { params: { value } })
      setGlobalHit(data)
    } catch {
      setGlobalSearchNotFound(true)
    } finally {
      setGlobalSearchLoading(false)
    }
  }

  const applyGlobalHit = () => {
    if (!globalHit) return
    // Same open-job-card block as the dealer-scoped lookup above.
    if (globalHit.openJobCardNumber) {
      const where = globalHit.openJobCardSource === 'bapl-dms' ? 'in BAPL DMS' : 'here'
      const status = globalHit.openJobCardStatus ? ` (status: ${globalHit.openJobCardStatus})` : ''
      const message = `This chassis already has an open job card ${where}: ${globalHit.openJobCardNumber}${status}. It must be closed before this chassis can be used for a new job card.`
      setOpenJobCardNotice(message)
      Alert.alert('Chassis already checked in', message)
      setShowGlobalSearchOffer(false)
      setGlobalHit(null)
      return
    }
    applyVehicleHit(globalHit)
    setVehicleLookupError(null)
    setShowGlobalSearchOffer(false)
    setGlobalHit(null)
  }

  // ---- Step 1: vehicle ----
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [newVehicle, setNewVehicle] = useState({ model: '', variant: '', color: '', regNo: '', vin: '', odometer: 0 })
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const availableVariants = variantsForModel(selectedModelId)
  const usingBaplVehicle = !!baplVehicleHit
  const previousOdometer = baplVehicleHit?.vehiclePrevKms ?? null
  const odometerValid = newVehicle.odometer > 0 && (previousOdometer == null || newVehicle.odometer > previousOdometer)

  useEffect(() => {
    if (!baplVehicleHit) return
    setSelectedModelId(null)
    setNewVehicle((v) => ({
      ...v,
      model: baplVehicleHit.modelName || v.model,
      variant: '',
      regNo: baplVehicleHit.registerNo || v.regNo,
      vin: baplVehicleHit.chassisNo || v.vin,
      odometer: baplVehicleHit.vehiclePrevKms ?? v.odometer,
    }))
  }, [baplVehicleHit])

  // ---- Step 2: service details ----
  const [serviceType, setServiceType] = useState<ServiceType>('PaidService')
  const [source, setSource] = useState<JobCardSource>('WalkIn')
  const [priority, setPriority] = useState<JobCardPriority>('Normal')
  const [batteryLevel, setBatteryLevel] = useState('')
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState<Date>(() => new Date())
  const [consentNotes, setConsentNotes] = useState('')
  const [complaints, setComplaints] = useState<string[]>([])

  const [baplJobType, setBaplJobType] = useState('')
  const [baplServiceLocation, setBaplServiceLocation] = useState('')
  const [baplSupervisorName, setBaplSupervisorName] = useState('')
  const [baplTechnicianName, setBaplTechnicianName] = useState('')
  const [baplManualJobNo, setBaplManualJobNo] = useState('')

  const [jobTypes, setJobTypes] = useState<BaplDmsJobType[]>([])
  const [serviceHeads, setServiceHeads] = useState<BaplDmsServiceHead[]>([])
  const [serviceTypes, setServiceTypes] = useState<BaplDmsServiceType[]>([])
  const [selectedJobTypeId, setSelectedJobTypeId] = useState<number | null>(null)
  const [selectedServiceHeadId, setSelectedServiceHeadId] = useState<number | null>(null)
  const [selectedServiceTypeId, setSelectedServiceTypeId] = useState<number | null>(null)
  const [baplMastersError, setBaplMastersError] = useState<string | null>(null)

  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  const [selectedWorkshopLocCode, setSelectedWorkshopLocCode] = useState('')

  const [complaintOptions, setComplaintOptions] = useState<BaplDmsComplaint[]>([])
  const [selectedComplaintId, setSelectedComplaintId] = useState('')

  const [jobSources, setJobSources] = useState<BaplDmsJobSource[]>([])
  const [selectedJobSourceId, setSelectedJobSourceId] = useState<number | null>(null)

  const [baplSyncWarning, setBaplSyncWarning] = useState<string | null>(null)

  // 2026-09-03: Customer complaints (Customer Voice) is now required too, matching web's same
  // change - both got a red * label. Expected delivery isn't included here: unlike web's
  // datetime-local input (which the user can clear to empty), this screen's date picker always
  // holds a real Date (defaults to "now" and can only be changed to another real date/time, never
  // cleared) - so there's nothing to actually enforce there, but the label still gets the same red
  // * for visual consistency with web.
  const serviceDetailsValid = !!(
    selectedJobTypeId && selectedServiceHeadId && selectedServiceTypeId &&
    selectedWorkshopLocCode && baplSupervisorName.trim() && baplTechnicianName.trim() &&
    selectedJobSourceId && complaints.length > 0
  )

  useEffect(() => {
    apiClient.get<BaplDmsJobType[]>('/api/bapl-dms/job-types')
      .then(({ data }) => setJobTypes(data))
      .catch(() => setBaplMastersError("Could not load BAPL DMS's Job Type list - Service Details will only capture JobCardScanner's own fields."))
    apiClient.get<BaplDmsComplaint[]>('/api/bapl-dms/complaints')
      .then(({ data }) => setComplaintOptions(data))
      .catch(() => setComplaintOptions([]))
    apiClient.get<BaplDmsJobSource[]>('/api/bapl-dms/job-sources')
      .then(({ data }) => setJobSources(data))
      .catch(() => setJobSources([]))
  }, [])

  useEffect(() => {
    setSelectedWorkshopLocCode('')
    setBaplServiceLocation('')
    if (!effectiveDealerId) { setWorkshops([]); return }
    apiClient.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: effectiveDealerId } })
      .then(({ data }) => setWorkshops(data))
      .catch(() => setWorkshops([]))
  }, [effectiveDealerId])

  useEffect(() => {
    if (selectedWorkshopLocCode || workshops.length === 0) return
    const bySeries = [...workshops].sort((a, b) => {
      const na = Number(/W(\d+)$/i.exec(a.locCode)?.[1] ?? Number.MAX_SAFE_INTEGER)
      const nb = Number(/W(\d+)$/i.exec(b.locCode)?.[1] ?? Number.MAX_SAFE_INTEGER)
      return na - nb
    })
    const def = bySeries[0]
    if (def) {
      setSelectedWorkshopLocCode(def.locCode)
      setBaplServiceLocation(def.locName)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workshops])

  useEffect(() => {
    if (!baplVehicleHit?.locationCode || workshops.length === 0) return
    const match = workshops.find((w) => w.locCode === baplVehicleHit.locationCode)
    if (match) {
      setSelectedWorkshopLocCode(match.locCode)
      setBaplServiceLocation(match.locName)
    }
  }, [baplVehicleHit, workshops])

  const onJobTypeChange = (value: string) => {
    const id = value ? Number(value) : null
    setSelectedJobTypeId(id)
    const name = jobTypes.find((j) => j.id === id)?.name ?? ''
    setBaplJobType(name)
    if (name) setServiceType(mapBaplJobTypeToServiceType(name))
    setSelectedServiceHeadId(null)
    setServiceHeads([])
    setSelectedServiceTypeId(null)
    setServiceTypes([])
    if (id == null) return
    apiClient.get<BaplDmsServiceHead[]>(`/api/bapl-dms/service-heads/${id}`)
      .then(({ data }) => setServiceHeads(data))
      .catch(() => setServiceHeads([]))
  }

  const onJobSourceChange = (value: string) => {
    const id = value ? Number(value) : null
    setSelectedJobSourceId(id)
    const name = jobSources.find((j) => j.id === id)?.name ?? ''
    if (name) setSource(mapBaplJobSourceToSource(name))
  }

  const onServiceHeadChange = (value: string) => {
    const id = value ? Number(value) : null
    setSelectedServiceHeadId(id)
    setSelectedServiceTypeId(null)
    setServiceTypes([])
    if (id == null) return
    apiClient.get<BaplDmsServiceType[]>(`/api/bapl-dms/service-types/${id}`)
      .then(({ data }) => setServiceTypes(data))
      .catch(() => setServiceTypes([]))
  }

  const onWorkshopChange = (locCode: string) => {
    setSelectedWorkshopLocCode(locCode)
    setBaplServiceLocation(workshops.find((w) => w.locCode === locCode)?.locName ?? '')
  }

  const addComplaintFromDropdown = () => {
    if (!selectedComplaintId) return
    const picked = complaintOptions.find((c) => String(c.id) === selectedComplaintId)
    if (!picked) return
    if (!complaints.includes(picked.name)) setComplaints((prev) => [...prev, picked.name])
    setSelectedComplaintId('')
  }
  const removeComplaint = (name: string) => setComplaints((prev) => prev.filter((c) => c !== name))

  const openExpectedDeliveryPicker = () => {
    DateTimePickerAndroid.open({
      value: expectedDeliveryAt,
      mode: 'date',
      onChange: (_e: DateTimePickerEvent, date?: Date) => {
        if (!date) return
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          is24Hour: true,
          onChange: (_e2: DateTimePickerEvent, time?: Date) => {
            if (!time) return
            const combined = new Date(date)
            combined.setHours(time.getHours(), time.getMinutes())
            setExpectedDeliveryAt(combined)
          },
        })
      },
    })
  }

  // ---- Photos (captured before the job card exists, uploaded right after creation) ----
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([])
  const [capturingPhoto, setCapturingPhoto] = useState(false)
  const [photoLocationNote, setPhotoLocationNote] = useState<string | null>(null)
  const [photoUploadWarning, setPhotoUploadWarning] = useState<string | null>(null)
  const [createdJobCard, setCreatedJobCard] = useState<{ id: string; jobCardNumber: string } | null>(null)
  const [sharingPdf, setSharingPdf] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  const getPhotoLocation = async (): Promise<{ latitude: number; longitude: number; accuracy: number | null } | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return null
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }
    } catch {
      return null
    }
  }

  const addPhotoFromResult = async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
      setError('That photo is larger than 1 GB - pick a smaller file.')
      return
    }
    setCapturingPhoto(true)
    setPhotoLocationNote('Getting location…')
    try {
      const pos = await getPhotoLocation()
      setPhotoLocationNote(pos ? `Location captured (±${Math.round(pos.accuracy ?? 0)}m)` : 'Location unavailable - added without it')
      setPendingPhotos((prev) => [...prev, {
        id: `${Date.now()}-${prev.length}`,
        uri: asset.uri,
        fileName: asset.fileName || `photo-${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
        caption: '',
        stage: 'CheckIn',
        latitude: pos?.latitude,
        longitude: pos?.longitude,
      }])
    } finally {
      setCapturingPhoto(false)
      setTimeout(() => setPhotoLocationNote(null), 2000)
    }
  }

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Camera permission is needed to take a photo.'); return }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 })
    await addPhotoFromResult(result)
  }

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Photo library permission is needed to add a photo.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 })
    await addPhotoFromResult(result)
  }

  const removePendingPhoto = (id: string) => setPendingPhotos((prev) => prev.filter((p) => p.id !== id))

  const createCustomer = async () => {
    if (!effectiveDealerId) { setError('Select a dealer/workshop before adding a customer.'); return }
    setError(null)
    try {
      const { data } = await apiClient.post<Customer>('/api/customers', { ...newCustomer, dealerId: effectiveDealerId })
      setCustomer({ ...data, vehicles: [] })
      setStep(1)
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create customer.')
    }
  }

  const createVehicle = async () => {
    if (!customer) return
    if (!effectiveDealerId) { setError('Select a dealer/workshop before adding a vehicle.'); return }
    setError(null)
    const dateOnly = (s?: string | null) => (s ? s.split('T')[0] : null)
    try {
      const { data } = await apiClient.post<Vehicle>('/api/customers/vehicles', {
        ...newVehicle,
        customerId: customer.id,
        dealerId: effectiveDealerId,
        purchaseDate: baplVehicleHit?.saleDate ? dateOnly(baplVehicleHit.saleDate) : (newCustomer.saleDate || null),
        controllerNo: baplVehicleHit?.controllerNo ?? null,
        converterNo: baplVehicleHit?.converterNo ?? null,
        chargerNo: baplVehicleHit?.chargerNumber ?? null,
        batteryNo: baplVehicleHit?.batteryNumber ?? null,
        motorNo: baplVehicleHit?.motorNo ?? null,
        insuranceExpiry: dateOnly(baplVehicleHit?.insuranceExpDate),
        nextServiceDueDate: dateOnly(baplVehicleHit?.nextServiceDueDate),
        warrantyOdoReading: baplVehicleHit?.odoReading ?? null,
        warrantyDuration: baplVehicleHit?.duration ?? null,
        warrantyDurationType: baplVehicleHit?.durationType ?? null,
        warrantyExpiryDate: dateOnly(baplVehicleHit?.expireWarrantyDate),
      })
      setVehicle(data)
      setStep(2)
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create vehicle.')
    }
  }

  const submit = async () => {
    if (!customer || !vehicle) return
    if (!effectiveDealerId) { setError('Select a dealer/workshop before creating the job card.'); return }
    if (pendingPhotos.length === 0) { setError('At least one photo is required before creating the job card.'); return }
    setSubmitting(true)
    setError(null)
    setPhotoUploadWarning(null)
    setBaplSyncWarning(null)
    try {
      const { data } = await apiClient.post('/api/jobcards', {
        dealerId: effectiveDealerId,
        customerId: customer.id,
        vehicleId: vehicle.id,
        serviceType,
        source,
        priority,
        odometerAtCheckIn: vehicle.odometer,
        batteryLevelAtCheckIn: batteryLevel === '' ? null : Number(batteryLevel),
        expectedDeliveryAt: expectedDeliveryAt ? expectedDeliveryAt.toISOString() : null,
        serviceAdvisorId: profile?.id,
        customerConsentNotes: consentNotes || null,
        complaints: complaints.filter((c) => c.trim()).map((description) => ({ description, isCustomerVoice: true })),
        baplJobType: baplJobType || null,
        baplServiceLocation: baplServiceLocation || null,
        baplSupervisorName: baplSupervisorName || null,
        baplTechnicianName: baplTechnicianName || null,
        baplManualJobNo: baplManualJobNo || null,
        baplJobTypeId: selectedJobTypeId,
        baplServiceHeadId: selectedServiceHeadId,
        baplServiceHeadName: serviceHeads.find((h) => h.id === selectedServiceHeadId)?.name ?? null,
        baplServiceTypeId: selectedServiceTypeId,
        baplServiceTypeName: serviceTypes.find((t) => t.id === selectedServiceTypeId)?.name ?? null,
        baplServiceLocationCode: selectedWorkshopLocCode || null,
        baplCustomerLedgerId: baplVehicleHit?.customerLedgerId ?? null,
        baplJobSourceId: selectedJobSourceId,
        baplJobSourceName: jobSources.find((s) => s.id === selectedJobSourceId)?.name ?? null,
      })
      if (data?.baplSyncWarning) setBaplSyncWarning(data.baplSyncWarning as string)

      if (pendingPhotos.length > 0) {
        let failed = 0
        for (const p of pendingPhotos) {
          const form = new FormData()
          // @ts-expect-error - RN's FormData accepts {uri,name,type} file parts, unlike the DOM lib's File type
          form.append('File', { uri: p.uri, name: p.fileName, type: p.mimeType })
          form.append('Stage', p.stage)
          if (p.caption) form.append('Caption', p.caption)
          if (p.latitude != null) form.append('Latitude', String(p.latitude))
          if (p.longitude != null) form.append('Longitude', String(p.longitude))
          try {
            await apiClient.post(`/api/jobcards/${data.id}/photos/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
          } catch {
            failed += 1
          }
        }
        if (failed > 0) {
          setPendingPhotos([])
          setCreatedJobCard({ id: data.id, jobCardNumber: data.jobCardNumber })
          setPhotoUploadWarning(`Job card ${data.jobCardNumber} was created, but ${failed} of ${pendingPhotos.length} photo(s) failed to upload. You can add them again from the job card's Photos section.`)
          return
        }
      }
      setPendingPhotos([])
      setCreatedJobCard({ id: data.id, jobCardNumber: data.jobCardNumber })
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create job card.')
    } finally {
      setSubmitting(false)
    }
  }

  // Web's "Print" opens a browser print popup, whose own dialog covers both printing AND "Save
  // as PDF" in one place; there's no such single dialog on Android, so this builds the same Job
  // Card + Gate Pass HTML and offers it two separate ways - Share (native share sheet: Drive/
  // Files, WhatsApp, a printer app, whatever the phone offers) and Download (saves the PDF
  // directly, so it doesn't depend on picking the right share target).
  const buildPrintHtml = () =>
    buildJobCardPrintHtml({
      dealerName: dealers.find((d) => d.id === effectiveDealerId)?.name ?? profile?.dealerName,
      dealerCode: dealers.find((d) => d.id === effectiveDealerId)?.code ?? baplVehicleHit?.dealerCode,
      jobinDate: new Date().toISOString(),
      jobtype: baplJobType,
      jobsource: jobSources.find((s) => s.id === selectedJobSourceId)?.name,
      serviceHead: serviceHeads.find((h) => h.id === selectedServiceHeadId)?.name,
      serviceType: serviceTypes.find((t) => t.id === selectedServiceTypeId)?.name,
      estdelDate: expectedDeliveryAt.toISOString(),
      vehiclekms: vehicle?.odometer,
      manualjobNo: baplManualJobNo,
      supervisor: baplSupervisorName,
      technician: baplTechnicianName,
      customerName: customer?.name,
      customerMobile: customer?.mobile,
      address: customer?.address,
      city: customer?.city,
      chassisNo: vehicle?.vin,
      batteryNo: vehicle?.batteryNo,
      chargerNo: vehicle?.chargerNo,
      controllerNo: vehicle?.controllerNo,
      registerNo: vehicle?.regNo,
      modelName: vehicle?.model,
      colour: vehicle?.color,
      saleDate: baplVehicleHit?.saleDate,
      insuranceExpiry: vehicle?.insuranceExpiry ?? baplVehicleHit?.insuranceExpDate,
      batteryChemical: baplVehicleHit?.batteryChemical,
      batteryCapacity: baplVehicleHit?.batteryCapacity,
      batteryMake: baplVehicleHit?.batteryMake,
      complaints: complaints.filter((c) => c.trim()),
      jobCardNumber: createdJobCard?.jobCardNumber,
    })

  const sharePdf = async () => {
    setSharingPdf(true)
    try {
      const { uri } = await Print.printToFileAsync({ html: buildPrintHtml() })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Job Card ${createdJobCard?.jobCardNumber ?? ''}` })
      } else {
        Alert.alert('Sharing is not available on this device.')
      }
    } catch {
      Alert.alert('Could not generate the Job Card PDF. Please try again.')
    } finally {
      setSharingPdf(false)
    }
  }

  // Item: "download pdf and share pdf both option" for Android. Android sandboxes app-private
  // storage, so a real "save to Downloads" needs the Storage Access Framework (lets the user pick
  // a folder, then writes straight into it) rather than expo-file-system's normal document
  // directory, which nothing outside the app can see. iOS has no equivalent public Downloads
  // folder/SAF, so there this just opens the same share sheet (its own "Save to Files" option
  // covers the same need).
  const downloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      const { uri } = await Print.printToFileAsync({ html: buildPrintHtml() })
      const fileName = `JobCard-${createdJobCard?.jobCardNumber ?? Date.now()}.pdf`
      if (Platform.OS === 'android') {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
        if (!perm.granted) return
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
        const destUri = await FileSystem.StorageAccessFramework.createFileAsync(perm.directoryUri, fileName, 'application/pdf')
        await FileSystem.writeAsStringAsync(destUri, base64, { encoding: FileSystem.EncodingType.Base64 })
        Alert.alert('Downloaded', `${fileName} was saved to the folder you chose.`)
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fileName })
      } else {
        Alert.alert('Downloading is not available on this device.')
      }
    } catch {
      Alert.alert('Could not download the Job Card PDF. Please try again.')
    } finally {
      setDownloadingPdf(false)
    }
  }

  const modelOptions: PickerOption[] = VEHICLE_MODELS.map((m) => ({ label: m.name, value: String(m.id) }))
  const variantOptions: PickerOption[] = availableVariants.map((v) => ({ label: v.name, value: v.name }))
  const jobTypeOptions: PickerOption[] = jobTypes.map((t) => ({ label: t.name, value: String(t.id) }))
  const serviceHeadOptions: PickerOption[] = serviceHeads.map((h) => ({ label: h.name, value: String(h.id) }))
  const serviceTypeOptions: PickerOption[] = serviceTypes.map((t) => ({ label: t.name, value: String(t.id) }))
  const workshopOptions: PickerOption[] = workshops.map((w) => ({ label: `${w.locName} (${w.locCode})`, value: w.locCode }))
  const jobSourceOptions: PickerOption[] = jobSources.map((s) => ({ label: s.name, value: String(s.id) }))
  const complaintPickOptions: PickerOption[] = complaintOptions.map((c) => ({ label: c.name, value: String(c.id) }))
  const priorityOptions: PickerOption[] = (['Normal', 'High', 'Urgent'] as JobCardPriority[]).map((p) => ({ label: p, value: p }))
  const dealerOptions: PickerOption[] = dealers.map((d) => ({ label: `${d.name} (${d.code})`, value: d.id }))

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.stepper}>
        {STEPS.map((s, i) => (
          <View key={s} style={[styles.stepChip, i === step && styles.stepChipActive, i < step && styles.stepChipDone]}>
            <Text style={[styles.stepChipText, i === step && styles.stepChipTextActive]}>{i + 1}. {s}</Text>
          </View>
        ))}
      </View>

      {step === 0 && (
        <View style={styles.card}>
          {needsDealerPicker && (
            <View style={{ marginBottom: 16 }}>
              <PickerField label="Dealer WorkShop Location" value={selectedDealerId} options={dealerOptions} onChange={setSelectedDealerId} placeholder="Select the dealer/workshop this job card is for…" />
              <Text style={styles.muted}>Your account isn't tied to a single dealer, so pick which workshop this job card belongs to. Not in the list yet? Search BAPL DMS below.</Text>
              <View style={styles.searchRow}>
                <TextInput style={[styles.input, { flex: 1 }]} value={dealerSearchQ} onChangeText={setDealerSearchQ} placeholder="Search Dealer WorkShop Location (BAPL DMS)" />
                <TouchableOpacity style={[styles.btn, dealerSearchQ.trim().length < 2 && styles.btnDisabled]} disabled={dealerSearchQ.trim().length < 2} onPress={searchBaplDealers}>
                  <Text style={styles.btnText}>Search</Text>
                </TouchableOpacity>
              </View>
              {dealerSearchError && <Text style={styles.errorText}>{dealerSearchError}</Text>}
              {baplDealerResults.map((d) => (
                <View key={d.dealerCode} style={styles.suggestRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{d.dealerName} ({d.dealerCode})</Text>
                    <Text style={styles.muted}>{d.city}</Text>
                  </View>
                  <TouchableOpacity style={styles.btnPrimarySm} disabled={resolvingDealer} onPress={() => selectBaplDealer(d)}>
                    <Text style={styles.btnPrimaryText}>Use this dealer</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {newDealerLogin && (
                <Text style={styles.muted}>Dealer login created - {newDealerLogin.email} / {newDealerLogin.password}. Share these with the dealer.</Text>
              )}
            </View>
          )}

          <Text style={styles.h3}>(Registered customer Details)</Text>
          <Text style={styles.label}>Search by chassis no. / registration no.</Text>
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={chassisOrRegQ}
              onChangeText={setChassisOrRegQ}
              placeholder="Chassis no. or registration no. (e.g. P6)"
              autoCapitalize="characters"
              autoCorrect={false}
              onSubmitEditing={() => lookupByChassisOrReg()}
            />
            <TouchableOpacity style={[styles.btn, (vehicleLookupLoading || !chassisOrRegQ.trim()) && styles.btnDisabled]} disabled={vehicleLookupLoading || !chassisOrRegQ.trim()} onPress={() => lookupByChassisOrReg()}>
              <Text style={styles.btnText}>{vehicleLookupLoading ? 'Searching…' : 'Search'}</Text>
            </TouchableOpacity>
          </View>
          {vehicleSuggestions.length > 0 && (
            // Dropdown scroll wasn't working on Android - a plain View with maxHeight clips
            // overflow instead of scrolling it. nestedScrollEnabled is required on Android for a
            // ScrollView inside another ScrollView (this whole screen is one) to scroll at all.
            <ScrollView style={styles.pickerBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {vehicleSuggestions.map((s) => (
                <TouchableOpacity key={s.chassisNo} style={styles.pickerRow} onPress={() => { setChassisOrRegQ(s.chassisNo); lookupByChassisOrReg(s.chassisNo) }}>
                  <Text style={styles.pickerRowText}>
                    <Text style={{ fontWeight: '700' }}>{s.chassisNo}</Text>
                    {s.regNo ? ` · ${s.regNo}` : ''}{s.modelName ? ` — ${s.modelName}` : ''}
                  </Text>
                  {/* Show Sale Date on every suggestion row, not just after a full Search hit -
                     mirrors web's same change. */}
                  <Text style={styles.pickerRowSubText}>
                    Sale date: {s.saleDate ? new Date(s.saleDate).toLocaleDateString() : 'not sold'}
                  </Text>
                </TouchableOpacity>
              ))}
              {/* Mirrors web's same hint - /api/bapl-dms/vehicle-suggestions caps results (100 by
                 default), so a dealer whose stock shares one chassis-number prefix may have more
                 matches than fit here for a short query. */}
              {vehicleSuggestions.length >= 100 && (
                <Text style={[styles.pickerRowSubText, { padding: 8 }]}>
                  Showing the first {vehicleSuggestions.length} matches - keep typing more of the chassis/reg no. to narrow down.
                </Text>
              )}
            </ScrollView>
          )}
          {vehicleNotSoldNotice && (
            <View style={styles.noticeBanner}>
              <Text style={styles.noticeBannerText}>⚠️ {vehicleNotSoldNotice}</Text>
              <TouchableOpacity onPress={() => setVehicleNotSoldNotice(null)}>
                <Text style={styles.noticeBannerDismiss}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}
          {openJobCardNotice && (
            <View style={styles.dangerBanner}>
              <Text style={styles.dangerBannerText}>🚫 {openJobCardNotice}</Text>
              <TouchableOpacity onPress={() => setOpenJobCardNotice(null)}>
                <Text style={styles.dangerBannerDismiss}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}
          {vehicleLookupError && <Text style={styles.errorText}>{vehicleLookupError}</Text>}
          {showGlobalSearchOffer && !globalHit && (
            <View style={styles.noticeBanner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.noticeBannerText}>🔎 Not found for this dealer. Search BAPL DMS across every dealer?</Text>
                {globalSearchNotFound && <Text style={[styles.noticeBannerText, { marginTop: 4 }]}>Not found anywhere in BAPL DMS either.</Text>}
              </View>
              <TouchableOpacity disabled={globalSearchLoading} onPress={searchGlobalChassis}>
                <Text style={styles.noticeBannerDismiss}>{globalSearchLoading ? 'Searching…' : 'Search all dealers'}</Text>
              </TouchableOpacity>
            </View>
          )}
          {globalHit && (
            <View style={styles.dmsBox}>
              <Text style={{ fontWeight: '700', color: '#1e3a5f' }}>
                Found in BAPL DMS{globalHit.dealerCode && globalHit.dealerCode !== vehicleSearchDealerCode ? ` — registered to dealer ${globalHit.dealerCode}, not this workshop` : ''}
              </Text>
              <Text style={styles.muted}>
                {globalHit.customerName || 'Unknown customer'}{globalHit.customerMobile ? ` (${globalHit.customerMobile})` : ''} · {globalHit.modelName || 'Model unknown'}
                {globalHit.registerNo ? ` · reg no. ${globalHit.registerNo}` : ''}
                {globalHit.saleDate ? ` · sold ${new Date(globalHit.saleDate).toLocaleDateString()}` : ' · not yet sold'}
              </Text>
              <TouchableOpacity style={[styles.btnPrimary, { marginTop: 8 }]} onPress={applyGlobalHit}>
                <Text style={styles.btnPrimaryText}>Use this vehicle</Text>
              </TouchableOpacity>
            </View>
          )}
          {baplVehicleHit && (
            <Text style={styles.muted}>
              Customer Details : customer-{baplVehicleHit.customerName || 'Unknown customer'}
              {baplVehicleHit.customerMobile ? ` (${baplVehicleHit.customerMobile})` : ''} - model- {baplVehicleHit.modelName || 'Model unknown'}
              {baplVehicleHit.registerNo ? `, reg no. ${baplVehicleHit.registerNo}` : ''}
              {baplVehicleHit.saleDate ? `, sale date ${new Date(baplVehicleHit.saleDate).toLocaleDateString()}.` : '.'}
            </Text>
          )}

          <Text style={[styles.h3, { marginTop: 20 }]}>Registered Customer</Text>
          {customerFieldsLocked && (
            <View>
              <Text style={styles.muted}>🔒 Name, Mobile, Email, City and Address were auto-fetched from BAPL DMS and are locked.</Text>
              <TouchableOpacity onPress={() => setUnlockCustomerFields(true)}><Text style={styles.link}>Edit anyway</Text></TouchableOpacity>
            </View>
          )}
          <Field label="Name" value={newCustomer.name} disabled={customerFieldsLocked} onChangeText={(v) => setNewCustomer({ ...newCustomer, name: v })} />
          <Field label="Mobile" value={newCustomer.mobile} disabled={customerFieldsLocked} keyboardType="number-pad" maxLength={10} onChangeText={(v) => setNewCustomer({ ...newCustomer, mobile: v.replace(/\D/g, '').slice(0, 10) })} />
          <Field label="Email" value={newCustomer.email} disabled={customerFieldsLocked} onChangeText={(v) => setNewCustomer({ ...newCustomer, email: v })} />
          <Field label="City" value={newCustomer.city} disabled={customerFieldsLocked} onChangeText={(v) => setNewCustomer({ ...newCustomer, city: v })} />
          <Field label="Address" value={newCustomer.address} disabled={customerFieldsLocked} onChangeText={(v) => setNewCustomer({ ...newCustomer, address: v })} />
          <Field label="State" value={newCustomer.state} disabled={customerFieldsLocked} onChangeText={(v) => setNewCustomer({ ...newCustomer, state: v })} />
          <Field label="Sale Date (YYYY-MM-DD)" value={newCustomer.saleDate} disabled={customerFieldsLocked} onChangeText={(v) => setNewCustomer({ ...newCustomer, saleDate: v })} />

          {error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity
            // 2026-09-03: also blocked while "This Vehicle not sold" is showing, matching web's
            // same change - the banner's own Dismiss button (below) is what re-enables this, same
            // "acknowledge, then proceed if you really mean to" pattern as web.
            style={[styles.btnPrimary, (!newCustomer.name || newCustomer.mobile.length !== 10 || !effectiveDealerId || !!vehicleNotSoldNotice) && styles.btnDisabled]}
            disabled={!newCustomer.name || newCustomer.mobile.length !== 10 || !effectiveDealerId || !!vehicleNotSoldNotice}
            onPress={createCustomer}
          >
            <Text style={styles.btnPrimaryText}>Create & Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 1 && customer && (
        <View style={styles.card}>
          <Text style={styles.h3}>Vehicle for {customer.name}</Text>
          {baplVehicleHit && (
            <View style={styles.dmsBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={styles.dmsBadge}>DMS</Text>
                {baplVehicleHit.vehiclePrevKms != null && <Text style={{ fontWeight: '700', fontSize: 15 }}>Previous Km: {baplVehicleHit.vehiclePrevKms}</Text>}
              </View>
              <Text style={{ fontSize: 13, color: '#1e3a5f', marginTop: 4 }}>
                Battery No.: {baplVehicleHit.batteryNumber || '—'}, Motor no.: {baplVehicleHit.motorNo || '—'}, Controller no.: {baplVehicleHit.controllerNo || '—'}, Charger no.: {baplVehicleHit.chargerNumber || '—'}.
              </Text>
            </View>
          )}
          {customer.vehicles && customer.vehicles.length > 0 && (
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.subheading}>This customer's existing vehicles</Text>
              {customer.vehicles.map((v) => (
                <TouchableOpacity key={v.id} style={styles.suggestRow} onPress={() => { setVehicle(v); setStep(2) }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{v.model} {v.variant}</Text>
                    <Text style={styles.muted}>{v.regNo} · {v.odometer} km</Text>
                  </View>
                  <Text style={styles.link}>Select</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {vehicleFieldsLocked && (
            <View>
              <Text style={styles.muted}>🔒 Model, Reg No and VIN were auto-fetched from BAPL DMS and are locked.</Text>
              <TouchableOpacity onPress={() => setUnlockVehicleFields(true)}><Text style={styles.link}>Edit anyway</Text></TouchableOpacity>
            </View>
          )}

          {usingBaplVehicle ? (
            <Field label="Model" value={newVehicle.model} disabled={vehicleFieldsLocked} onChangeText={(v) => setNewVehicle({ ...newVehicle, model: v })} />
          ) : (
            <>
              <PickerField
                label="Model"
                value={selectedModelId != null ? String(selectedModelId) : ''}
                options={modelOptions}
                placeholder="Select model…"
                onChange={(v) => {
                  const modelId = v ? Number(v) : null
                  const modelName = VEHICLE_MODELS.find((m) => m.id === modelId)?.name ?? ''
                  setSelectedModelId(modelId)
                  setNewVehicle({ ...newVehicle, model: modelName, variant: '' })
                }}
              />
              <PickerField
                label="Variant"
                value={newVehicle.variant}
                options={variantOptions}
                disabled={!selectedModelId}
                placeholder={selectedModelId ? 'Select variant…' : 'Select a model first'}
                onChange={(v) => setNewVehicle({ ...newVehicle, variant: v })}
              />
            </>
          )}
          <Field label="Reg No" value={newVehicle.regNo} disabled={vehicleFieldsLocked} onChangeText={(v) => setNewVehicle({ ...newVehicle, regNo: v })} />
          <Field label="VIN" value={newVehicle.vin} disabled={vehicleFieldsLocked} onChangeText={(v) => setNewVehicle({ ...newVehicle, vin: v })} />
          <Field
            label={`Odometer (km) *${previousOdometer != null ? ` (Previous: ${previousOdometer} km)` : ''}`}
            value={newVehicle.odometer ? String(newVehicle.odometer) : ''}
            keyboardType="numeric"
            onChangeText={(v) => setNewVehicle({ ...newVehicle, odometer: Number(v.replace(/[^0-9]/g, '')) || 0 })}
          />
          {previousOdometer != null && newVehicle.odometer > 0 && newVehicle.odometer <= previousOdometer && (
            <Text style={styles.errorText}>Must be greater than the previous odometer reading ({previousOdometer} km).</Text>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.btn} onPress={() => setStep(0)}><Text style={styles.btnText}>← Back</Text></TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, (!newVehicle.model || !effectiveDealerId || !odometerValid) && styles.btnDisabled]}
              disabled={!newVehicle.model || !effectiveDealerId || !odometerValid}
              onPress={createVehicle}
            >
              <Text style={styles.btnPrimaryText}>Create & Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 2 && (
        <View style={styles.card}>
          <Text style={styles.h3}>Service details</Text>
          <View style={styles.dmsBox}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Text style={styles.dmsBadge}>DMS</Text>
              <Text style={{ fontWeight: '700', fontSize: 14 }}>Job Card fields</Text>
            </View>
            {baplMastersError && <Text style={styles.errorText}>{baplMastersError}</Text>}
            <PickerField label="Job Type *" value={selectedJobTypeId != null ? String(selectedJobTypeId) : ''} options={jobTypeOptions} placeholder="Select job type…" onChange={onJobTypeChange} />
            <PickerField label="Service Head *" value={selectedServiceHeadId != null ? String(selectedServiceHeadId) : ''} options={serviceHeadOptions} disabled={!selectedJobTypeId} placeholder={selectedJobTypeId ? 'Select service head…' : 'Select a job type first'} onChange={onServiceHeadChange} />
            <PickerField label="Service Type *" value={selectedServiceTypeId != null ? String(selectedServiceTypeId) : ''} options={serviceTypeOptions} disabled={!selectedServiceHeadId} placeholder={selectedServiceHeadId ? 'Select service type…' : 'Select a service head first'} onChange={(v) => setSelectedServiceTypeId(v ? Number(v) : null)} />
            <PickerField label="Priority *" value={priority} options={priorityOptions} onChange={(v) => setPriority(v as JobCardPriority)} />
            <PickerField label="Service Location (workshop) *" value={selectedWorkshopLocCode} options={workshopOptions} disabled={!effectiveDealerId} placeholder={workshops.length ? 'Select workshop…' : 'No workshops found for this dealer yet'} onChange={onWorkshopChange} />
            <Field label="Supervisor *" value={baplSupervisorName} onChangeText={setBaplSupervisorName} placeholder="Supervisor name" />
            <Field label="Technician *" value={baplTechnicianName} onChangeText={setBaplTechnicianName} placeholder="Technician name" />
            <Field label="Manual Job No." value={baplManualJobNo} onChangeText={setBaplManualJobNo} placeholder="e.g. 0" />
            <PickerField label="Source *" value={selectedJobSourceId != null ? String(selectedJobSourceId) : ''} options={jobSourceOptions} placeholder="Select source…" onChange={onJobSourceChange} />
            <Text style={styles.muted}>All fields above are required - they are what let this job card also be created directly inside BAPL DMS's own database.</Text>
          </View>

          <Field label="Battery level at check-in (%)" value={batteryLevel} keyboardType="numeric" onChangeText={setBatteryLevel} />
          <View>
            <Text style={styles.label}>Expected delivery<Text style={styles.requiredStar}> *</Text></Text>
            <TouchableOpacity style={styles.field} onPress={openExpectedDeliveryPicker}>
              <Text style={styles.fieldText}>{expectedDeliveryAt.toLocaleString()}</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { marginTop: 12 }]}>Customer complaints (Customer Voice)<Text style={styles.requiredStar}> *</Text></Text>
          {complaintPickOptions.length > 0 && (
            <View style={styles.searchRow}>
              <View style={{ flex: 1 }}>
                <PickerField label="" value={selectedComplaintId} options={complaintPickOptions} placeholder="Pick from DMS's complaint list…" onChange={setSelectedComplaintId} />
              </View>
              <TouchableOpacity style={[styles.addBtnSm, !selectedComplaintId && styles.btnDisabled]} disabled={!selectedComplaintId} onPress={addComplaintFromDropdown}>
                <Text style={styles.addBtnSmText}>+ Add</Text>
              </TouchableOpacity>
            </View>
          )}
          {complaints.length > 0 ? (
            complaints.map((c) => (
              <View key={c} style={styles.chipRow}>
                <Text style={{ flex: 1 }}>{c}</Text>
                <TouchableOpacity style={styles.smallBtn} onPress={() => removeComplaint(c)}><Text style={styles.smallBtnText}>Remove</Text></TouchableOpacity>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No complaints added yet.</Text>
          )}

          <Text style={[styles.label, { marginTop: 12 }]}>(Customer Voice) notes</Text>
          <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top' }]} multiline value={consentNotes} onChangeText={setConsentNotes} />

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.btn} onPress={() => setStep(1)}><Text style={styles.btnText}>← Back</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.btnPrimary, !serviceDetailsValid && styles.btnDisabled]} disabled={!serviceDetailsValid} onPress={() => setStep(3)}>
              <Text style={styles.btnPrimaryText}>Continue to Review</Text>
            </TouchableOpacity>
          </View>
          {!serviceDetailsValid && <Text style={styles.muted}>Fill in every field marked with a red * on this step to continue.</Text>}
        </View>
      )}

      {step === 3 && customer && vehicle && (
        <View style={styles.card}>
          <Text style={styles.h3}>Review</Text>
          <Text style={styles.reviewLine}><Text style={styles.bold}>Customer</Text> — Name: {customer.name}  Mobile: {customer.mobile}  State: {customer.state || '-'}  City: {customer.city || '-'}</Text>
          <Text style={styles.reviewLine}><Text style={styles.bold}>Vehicle</Text> — Model: {vehicle.model} {vehicle.variant}  Reg No.: {vehicle.regNo || '-'}  KM: {vehicle.odometer}  Job No.: {baplManualJobNo || '-'}</Text>
          <Text style={styles.reviewLine}><Text style={styles.bold}>Service:</Text> {baplJobType || serviceType} via {jobSources.find((s) => s.id === selectedJobSourceId)?.name || source}, priority {priority}</Text>
          <Text style={styles.reviewLine}><Text style={styles.bold}>Complaints:</Text> {complaints.join('; ') || 'None recorded'}</Text>

          {!createdJobCard && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>Photos<Text style={styles.requiredStar}> *</Text></Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                <TouchableOpacity style={styles.btn} disabled={capturingPhoto} onPress={takePhoto}>
                  <Text style={styles.btnText}>{capturingPhoto ? 'Adding…' : '📷 Take Photo'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btn} disabled={capturingPhoto} onPress={pickPhoto}>
                  <Text style={styles.btnText}>🖼️ Choose Photo</Text>
                </TouchableOpacity>
              </View>
              {photoLocationNote && <Text style={styles.muted}>{photoLocationNote}</Text>}
              {pendingPhotos.length === 0 && <Text style={styles.errorText}>At least one photo is required.</Text>}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {pendingPhotos.map((p) => (
                  <View key={p.id} style={{ width: 150 }}>
                    <Image source={{ uri: p.uri }} style={{ width: '100%', height: 110, borderRadius: 6, borderWidth: 1, borderColor: '#e2e6ec' }} />
                    <TextInput
                      style={[styles.input, { marginTop: 6, fontSize: 12, padding: 6 }]}
                      value={p.caption}
                      placeholder="Caption (optional)"
                      onChangeText={(v) => setPendingPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, caption: v } : x)))}
                    />
                    <TouchableOpacity
                      style={[styles.btn, { marginTop: 6, backgroundColor: '#dc2626', borderColor: '#dc2626' }]}
                      onPress={() => removePendingPhoto(p.id)}
                    >
                      <Text style={[styles.btnText, { color: '#fff' }]}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}

          {createdJobCard ? (
            <View>
              {photoUploadWarning && <Text style={styles.muted}>{photoUploadWarning}</Text>}
              {baplSyncWarning && <Text style={styles.muted}>{baplSyncWarning}</Text>}
              <View style={styles.btnRow}>
                <TouchableOpacity style={styles.btn} disabled={downloadingPdf} onPress={downloadPdf}>
                  {downloadingPdf ? <ActivityIndicator color="#374151" /> : <Text style={styles.btnText}>⬇️ Download PDF</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.btn} disabled={sharingPdf} onPress={sharePdf}>
                  {sharingPdf ? <ActivityIndicator color="#374151" /> : <Text style={styles.btnText}>🖨️ Share PDF</Text>}
                </TouchableOpacity>
              </View>
              <View style={[styles.btnRow, { marginTop: 8 }]}>
                <TouchableOpacity style={styles.btnPrimary} onPress={() => navigation.replace('JobCardDetail', { id: createdJobCard.id })}>
                  <Text style={styles.btnPrimaryText}>Continue to Job Card {createdJobCard.jobCardNumber}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.btnRow}>
              <TouchableOpacity style={styles.btn} disabled={submitting} onPress={() => setStep(2)}><Text style={styles.btnText}>← Back</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btnPrimary, (submitting || pendingPhotos.length === 0) && styles.btnDisabled]} disabled={submitting || pendingPhotos.length === 0} onPress={submit}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Create Job Card</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  )
}

function Field({
  label, value, onChangeText, disabled, keyboardType, maxLength, placeholder,
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  disabled?: boolean
  keyboardType?: 'default' | 'numeric' | 'number-pad'
  maxLength?: number
  placeholder?: string
}) {
  // 2026-09-03: labels ending in " *" (e.g. "Supervisor *", "Odometer (km) *(Previous: ...)")
  // now render that asterisk in red instead of the same gray as the rest of the label - matches
  // web's Req() helper (JobCardWizardPage.tsx) and PickerField's own required handling below.
  const starMatch = /^(.*?)\s\*(.*)$/.exec(label)
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>
        {starMatch ? (
          <>{starMatch[1]}<Text style={styles.requiredStar}> *</Text>{starMatch[2]}</>
        ) : label}
      </Text>
      <TextInput
        style={[styles.input, disabled && styles.inputDisabled]}
        value={value}
        editable={!disabled}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        maxLength={maxLength}
        placeholder={placeholder}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f9', padding: 12 },
  stepper: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  stepChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec' },
  stepChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  stepChipDone: { backgroundColor: '#ecfdf5', borderColor: '#bbf7d0' },
  stepChipText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  stepChipTextActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e6ec', padding: 14, marginBottom: 24 },
  h3: { fontSize: 16, fontWeight: '700', color: '#101828', marginBottom: 10 },
  subheading: { fontWeight: '600', color: '#101828', marginBottom: 6 },
  label: { fontSize: 12, color: '#6b7280', marginBottom: 4 },
  fieldText: { color: '#101828', fontSize: 14 },
  field: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10, minHeight: 42, justifyContent: 'center', marginBottom: 10 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10 },
  inputDisabled: { backgroundColor: '#f4f6f9', color: '#6b7280' },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 4, marginBottom: 4 },
  errorText: { fontSize: 12, color: '#dc2626', marginTop: 4, marginBottom: 4 },
  noticeBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a' },
  noticeBannerText: { flex: 1, fontWeight: '600', color: '#92400e' },
  noticeBannerDismiss: { fontWeight: '600', color: '#92400e' },
  // Red variant of noticeBanner for "this chassis already has an open job card" - a harder stop
  // than the yellow "not sold" notice above, so it gets its own color.
  dangerBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  dangerBannerText: { flex: 1, fontWeight: '600', color: '#991b1b' },
  dangerBannerDismiss: { fontWeight: '600', color: '#991b1b' },
  link: { color: '#2563eb', fontWeight: '600', marginBottom: 8 },
  bold: { fontWeight: '700' },
  reviewLine: { marginBottom: 4, fontSize: 13, color: '#101828' },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 8 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff' },
  btnText: { color: '#374151', fontWeight: '600' },
  btnPrimary: { backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', flex: 1 },
  btnPrimarySm: { backgroundColor: '#2563eb', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  btnDisabled: { opacity: 0.5 },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  rowTitle: { fontWeight: '600', color: '#101828' },
  pickerBox: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, maxHeight: 200, marginBottom: 8, overflow: 'hidden' },
  pickerRow: { paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  pickerRowText: { color: '#374151' },
  pickerRowSubText: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  dmsBox: { backgroundColor: '#eef6ff', borderWidth: 1, borderColor: '#bfdcff', borderRadius: 8, padding: 12, marginBottom: 16 },
  dmsBadge: { backgroundColor: '#1c64f2', color: '#fff', fontSize: 12, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f4f6f8', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10, marginBottom: 6 },
  // 2026-09-03: was plain white/gray - now red, matching web's same change (only used for the
  // complaint "Remove" chip button on this screen).
  smallBtn: { backgroundColor: '#dc2626', borderWidth: 1, borderColor: '#dc2626', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  smallBtnText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  // 2026-09-03: was green (#16a34a) - now blue, matching web's same change (JobCardWizardPage.tsx).
  addBtnSm: { backgroundColor: '#2563eb', borderRadius: 6, paddingHorizontal: 12, justifyContent: 'center', marginTop: 18 },
  addBtnSmText: { color: '#fff', fontWeight: '700' },
  requiredStar: { color: '#dc2626' },
})
