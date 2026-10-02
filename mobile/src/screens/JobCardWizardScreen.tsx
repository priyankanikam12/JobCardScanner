// mobile\src\screens\JobCardWizardScreen.tsx
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
  BaplDealerResolveResult, BaplDmsDealer, BaplDmsJobSource,
  BaplDmsServiceType, BaplDmsVehicleLookup, BaplDmsVehicleSuggestion, BaplDmsWorkshop,
  Customer, Dealer, JobCardSource, PhotoStage, ServiceType, SupervisorOption, Technician, Vehicle,
} from '../types'
import type { RootStackParamList } from '../navigation/RootNavigator'
import { colors } from '../theme/colors'

type Props = NativeStackScreenProps<RootStackParamList, 'JobCardWizard'>

const STEPS = ['Customer', 'Vehicle', 'Service Details', 'Review & Create']

// SECTION 169 (2026-09-30) "bind this 3 dropdown dependancy from master" - Job Type/Service Head/
// Priority and Complaints are no longer live-fetched from BAPL DMS (/api/bapl-dms/job-types,
// /api/bapl-dms/service-heads/{id}, /api/bapl-dms/complaints) - all four now come from the new
// Service Menu Master / Complaint Master tables (SECTION 163/166), mirroring web's own SECTION 169
// rewire (JobCardWizardPage.tsx) exactly, including the PriorityValue/PriorityLabel field-shape
// decision - see that file's own doc comment and ServiceMenuMaster.cs's class doc comment for the
// full reasoning. Service Type and Job Source are UNCHANGED (still live BAPL DMS fetches) - only
// Job Type/Service Head/Priority/Complaints were in scope for this ask.
interface ServiceMenuRow {
  id: string
  jobTypeId: number
  jobTypeName: string
  serviceHeadId: number
  serviceHeadName: string
  priorityValue: string
  priorityLabel: string
  sortOrder: number
}
interface ComplaintMasterRow {
  id: string
  complaintText: string
}
/** First-seen-wins de-dup, preserving whatever order `items` is already sorted in - see web's
 * identical helper (JobCardWizardPage.tsx) for the full reasoning. */
function dedupeBy<T, K>(items: T[], keyFn: (item: T) => K): T[] {
  const seen = new Set<K>()
  const out: T[] = []
  for (const item of items) {
    const k = keyFn(item)
    if (!seen.has(k)) { seen.add(k); out.push(item) }
  }
  return out
}

const IST_TIME_ZONE = 'Asia/Kolkata'

/** A date/time in real IST (UTC+05:30), not whatever timezone the device happens to be set to -
 * per explicit request "Current time in IST (UTC+05:30) use everywhere on ui". Used for the
 * Expected delivery picker's displayed value and DMS sale dates below. */
function formatIST(value: Date | string, opts: Intl.DateTimeFormatOptions): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return d.toLocaleString('en-IN', { timeZone: IST_TIME_ZONE, ...opts })
}
const formatISTDate = (value: Date | string) => formatIST(value, { day: '2-digit', month: 'short', year: 'numeric' })
const formatISTDateTime = (value: Date | string) => formatIST(value, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })

// Same best-effort DMS -> JobCardScanner enum mapping web's wizard uses - see
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
      setDealerSearchError(msg ? `DMS error: ${msg}` : 'Could not reach DMS right now - try the dropdown above, or again shortly.')
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
      setDealerSearchError(msg ? `DMS error: ${msg}` : `Could not add "${row.dealerName}" from DMS - try again shortly.`)
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
  // 2026-09-04: mirrors web's showVehicleSuggestions exactly (JobCardWizardPage.tsx) - without
  // this gate the dropdown was driven purely off vehicleSuggestions.length, so once a search had
  // ever populated it, tapping back into the field later (without changing the text) could leave
  // a stale list sitting there with nothing to close it - web solved this with focus/blur; this
  // does the touch equivalent below (onFocus opens it, onBlur closes it after a short delay so a
  // tap on a suggestion row still registers first).
  const [showVehicleSuggestions, setShowVehicleSuggestions] = useState(false)
  // Global (cross-dealer) chassis/reg-no search - offered as a fallback right on the "not found"
  // flag when a dealer-scoped lookup 404s, mirroring DMS's own Angular "Search Chassis Across
  // All Dealers" popup (ebw-invoice component). GET /api/bapl-dms/vehicle-lookup already supports
  // this - dealerCode is optional server-side and an omitted one searches every dealer (see
  // IBaplDmsService.LookupVehicleAsync's own doc comment) - so no backend change was needed, just
  // this fallback UI wired to the same endpoint with dealerCode left out.
  const [showGlobalSearchOffer, setShowGlobalSearchOffer] = useState(false)
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalHit, setGlobalHit] = useState<BaplDmsVehicleLookup | null>(null)
  const [globalSearchNotFound, setGlobalSearchNotFound] = useState(false)

  // SECTION 169 (2026-09-30) "when i serach Reg No. like web not serach fix this" - FACT that was
  // the root cause: this screen was still calling the OLD /api/bapl-dms/vehicle-suggestions and
  // /api/bapl-dms/vehicle-lookup endpoints, scoped by a BAPL DMS dealer CODE
  // (vehicleSearchDealerCode below) - web moved off these on 2026-09-24/25 onto the newer, local-
  // only /api/jobcards/vehicle-suggestions and /api/jobcards/vehicle-lookup, scoped by dealerId (a
  // Guid), which resolve the BAPL code themselves server-side (see
  // JobCardsController.VehicleLookupForWizard's doc comment). This screen was never migrated, so it
  // was hitting a DIFFERENT, older endpoint pair than web the whole time - not the same endpoint
  // with a platform-specific bug. Chassis No. searches happened to still turn up matches (both
  // endpoint generations index chassis numbers similarly), but Registration No. lookups behaved
  // differently between the two implementations, which is what you saw as "Chassis works, Reg No.
  // doesn't". Fixed by repointing both calls below at the same endpoints web uses, with the same
  // dealerId param. vehicleSearchDealerCode is kept only as a DISPLAY value now (the "registered to
  // dealer X, not this workshop" hint below), exactly mirroring web's own comment on this.
  const vehicleSearchDealerCode = dealers.find((d) => d.id === effectiveDealerId)?.baplDmsDealerCode ?? profile?.dealerBaplDmsCode ?? undefined

  useEffect(() => {
    if (!showVehicleSuggestions || chassisOrRegQ.trim().length < 2) { setVehicleSuggestions([]); return }
    const handle = setTimeout(() => {
      apiClient.get<BaplDmsVehicleSuggestion[]>('/api/jobcards/vehicle-suggestions', { params: { q: chassisOrRegQ.trim(), dealerId: effectiveDealerId || undefined } })
        .then(({ data }) => setVehicleSuggestions(data))
        .catch(() => setVehicleSuggestions([]))
    }, 300)
    return () => clearTimeout(handle)
  }, [chassisOrRegQ, showVehicleSuggestions, effectiveDealerId])

  const [unlockCustomerFields, setUnlockCustomerFields] = useState(false)
  const [unlockVehicleFields, setUnlockVehicleFields] = useState(false)
  const customerFieldsLocked = !!baplVehicleHit && !unlockCustomerFields
  const vehicleFieldsLocked = !!baplVehicleHit && !unlockVehicleFields

  // 2026-10-01: State was missing from this mapping entirely - the DMS lookup response was
  // never read for it, so newCustomer.state stayed '' no matter what the source data had, even
  // though the State <Field> below is already wired to it. Confirmed via your own
  // `select * from DMS_SaleBillCustomer where Id='81863'` dump (State='KARNATAKA' for the exact
  // customer in your screenshot) that the upstream data is genuinely present - this was a pure
  // frontend mapping gap, not a missing-data issue. Same bug, same fix already applied earlier to
  // web's JobCardWizardPage.tsx (there under "SECTION 182"). NOTE: `data.customerState` is inferred
  // by the same naming convention as every other field here (customerName/customerCity/...); it is
  // NOT independently verified against mobile's own types.ts (not present in this sandbox) - if the
  // real field is named differently this will surface as a TypeScript compile error on this line,
  // not a silent failure, so it's safe to ship and verify.
  const applyVehicleHit = (data: BaplDmsVehicleLookup) => {
    setBaplVehicleHit(data)
    setNewCustomer((c) => ({
      ...c,
      name: data.customerName || c.name,
      mobile: data.customerMobile ? data.customerMobile.replace(/\D/g, '').slice(0, 10) : c.mobile,
      city: data.customerCity || c.city,
      email: data.customerEmail || c.email,
      address: data.customerAddress || c.address,
      state: data.customerState || c.state,
      saleDate: data.saleDate ? data.saleDate.split('T')[0] : c.saleDate,
    }))
  }

  const lookupByChassisOrReg = async (valueOverride?: string) => {
    const value = (valueOverride ?? chassisOrRegQ).trim()
    if (!value) return
    setShowVehicleSuggestions(false)
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
      const { data } = await apiClient.get<BaplDmsVehicleLookup>('/api/jobcards/vehicle-lookup', { params: { value, dealerId: effectiveDealerId || undefined } })
      // This chassis already has an open job card here in JobCardScanner - always "here" now (no
      // live DMS signal for this any more since DMS write-back was removed - see
      // JobCardsController.VehicleLookupForWizard's doc comment) - refuse to auto-fill/proceed with
      // it, and say which job card so staff know where to go close it first. Matches web's same
      // (now simplified, no more openJobCardSource branch) check.
      if (data.openJobCardNumber) {
        const status = data.openJobCardStatus ? ` (status: ${data.openJobCardStatus})` : ''
        const message = `This chassis already has an open job card here: ${data.openJobCardNumber}${status}. It must be closed before this chassis can be used for a new job card.`
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
        setVehicleLookupError(`"${value}" wasn't found in Vehicle Sale for this dealer.`)
        // Offer the cross-dealer fallback right on the "not found" flag, instead of only letting
        // the user give up and add the vehicle manually - see the state block above for why this
        // needs no new backend endpoint.
        setShowGlobalSearchOffer(true)
      } else {
        setVehicleLookupError(response?.data?.message
          ? `Vehicle Sale error: ${response.data.message}`
          : 'Could not reach Vehicle Sale right now - add the customer/vehicle manually below.')
      }
    } finally {
      setVehicleLookupLoading(false)
    }
  }

  /** "Search across all dealers" - re-runs the exact same lookup with dealerCode omitted, so a
   * chassis/reg no. sold by a DIFFERENT dealer still turns up instead of silently reading as
   * "doesn't exist anywhere". Mirrors DMS's own Angular ebw-invoice component's
   * searchGlobalChassis()/applyGlobalChassisResult() pair. */
  const searchGlobalChassis = async () => {
    const value = chassisOrRegQ.trim()
    if (!value) return
    setGlobalSearchLoading(true)
    setGlobalSearchNotFound(false)
    setGlobalHit(null)
    try {
      const { data } = await apiClient.get<BaplDmsVehicleLookup>('/api/jobcards/vehicle-lookup', { params: { value } })
      setGlobalHit(data)
    } catch {
      setGlobalSearchNotFound(true)
    } finally {
      setGlobalSearchLoading(false)
    }
  }

  const applyGlobalHit = () => {
    if (!globalHit) return
    // Same open-job-card block as the dealer-scoped lookup above - always "here" now, see that
    // lookup's own comment.
    if (globalHit.openJobCardNumber) {
      const status = globalHit.openJobCardStatus ? ` (status: ${globalHit.openJobCardStatus})` : ''
      const message = `This chassis already has an open job card here: ${globalHit.openJobCardNumber}${status}. It must be closed before this chassis can be used for a new job card.`
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

  // 2026-09-07: Coupon No. and Job Category - mirrors web's JobCardWizardPage.tsx exactly (see its
  // couponNo/jobCategory state doc comment for the full rationale: auto-fills from the chassis
  // number's last 13 characters like DMS's own onChassisChange(), stays editable).
  // 2026-09-18: Job Category now defaults to "B2B" per explicit request, matching the same change
  // made on web - this replaces the earlier B2C default.
  const [couponNo, setCouponNo] = useState('')
  const [couponNoTouched, setCouponNoTouched] = useState(false)
  const [jobCategory, setJobCategory] = useState<'B2C' | 'B2B'>('B2B')
  useEffect(() => {
    if (couponNoTouched) return
    const vin = newVehicle.vin || ''
    setCouponNo(vin.length > 13 ? vin.slice(-13) : vin)
  }, [newVehicle.vin, couponNoTouched])

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
  // SECTION 169 - starts blank now (was a fixed 'Normal' default), same reasoning as web: valid
  // Priority values depend on which Job Type + Service Head are picked - see the master-data block
  // below.
  const [priority, setPriority] = useState('')
  const [batteryLevel, setBatteryLevel] = useState('')
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState<Date>(() => new Date())
  const [consentNotes, setConsentNotes] = useState('')
  const [complaints, setComplaints] = useState<string[]>([])

  const [baplJobType, setBaplJobType] = useState('')
  const [baplServiceLocation, setBaplServiceLocation] = useState('')
  const [baplSupervisorName, setBaplSupervisorName] = useState('')
  const [baplTechnicianName, setBaplTechnicianName] = useState('')
  const [baplManualJobNo, setBaplManualJobNo] = useState('')

  // 2026-09-24 (mirrors web/src/pages/staff/JobCardWizardPage.tsx's own doc comment): Supervisor/
  // Technician are now PickerField dropdowns fed from this dealer's own Employees (Users with
  // Role=Supervisor - TechniciansController.Supervisors) and the new login-less Technician
  // Employee roster (TechniciansController.List), both scoped to the Service Location picked below
  // - not free text any more. Still stored as a plain name string for POST /api/jobcards, same
  // field the backend has always accepted. The fetch effect lives further down, after
  // selectedWorkshopLocCode is declared.
  const [supervisorOptions, setSupervisorOptions] = useState<SupervisorOption[]>([])
  const [technicianOptions, setTechnicianOptions] = useState<Technician[]>([])

  // SECTION 169 - serviceMenuRows is the raw GET /api/service-menu-master table; jobTypes/
  // serviceHeads below are DERIVED from it (not their own fetched state any more) but keep the same
  // {id, name} shape and variable names the rest of this file already reads (submit(), print
  // preview, JSX) so those call sites don't need to change.
  const [serviceMenuRows, setServiceMenuRows] = useState<ServiceMenuRow[]>([])
  const [serviceTypes, setServiceTypes] = useState<BaplDmsServiceType[]>([])
  const [selectedJobTypeId, setSelectedJobTypeId] = useState<number | null>(null)
  const [selectedServiceHeadId, setSelectedServiceHeadId] = useState<number | null>(null)
  const [selectedServiceTypeId, setSelectedServiceTypeId] = useState<number | null>(null)
  const [baplMastersError, setBaplMastersError] = useState<string | null>(null)

  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  const [selectedWorkshopLocCode, setSelectedWorkshopLocCode] = useState('')

  const [complaintOptions, setComplaintOptions] = useState<ComplaintMasterRow[]>([])
  const [selectedComplaintId, setSelectedComplaintId] = useState('')

  const [jobSources, setJobSources] = useState<BaplDmsJobSource[]>([])
  const [selectedJobSourceId, setSelectedJobSourceId] = useState<number | null>(null)

  const [baplSyncWarning, setBaplSyncWarning] = useState<string | null>(null)

  // 2026-09-03: Customer complaints (Customer Voice) is now required too, matching web's same
  // change - both got a red * label. Expected delivery isn't included here: unlike web's
  // datetime-local input (which the user can clear to empty), this screen's date picker always
  // holds a real Date (defaults to "now" and can only be changed to another real date/time, never
  // cleared) - so there's nothing to actually enforce there, but the label still gets the same red
  // * for visual consistency with web. SECTION 169: priority is now also required (it's a real
  // master-driven dropdown again, not an always-populated 'Normal' default).
  // 2026-10-02 FIX ("yesterday my user facing issue in jobcard create in Service details tab
  // all requird feilds filled but Continue to Review button still shown disable"): this boolean
  // used to also require selectedServiceTypeId, baplSupervisorName, baplTechnicianName and
  // selectedJobSourceId to be truthy - but the <PickerField> inputs that would ever set those
  // four values are commented out further down in this same Step 2 JSX (Service Type ~line 1210,
  // Supervisor/Technician ~lines 1227-1242, Source ~line 1244), so none of them can ever become
  // truthy no matter what the user fills in - permanently disabling "Continue to Review" on
  // Android (and web, if it ever shared this logic). Dropped those four from the gate. Kept
  // selectedWorkshopLocCode, since its "Service Location (workshop) *" picker IS actually
  // rendered/interactive on this screen (line 1223) - unlike web, where that field is shown
  // read-only, not user-chosen.
  // FACT, checked before this change: JobCardsController.cs's Create action assigns
  // req.BaplSupervisorName/BaplTechnicianName/BaplServiceTypeId/BaplJobSourceId straight onto the
  // new JobCard with no [Required]/null-check visible in that action, so submitting with these
  // four left null is not expected to be rejected server-side - but I have not located and read
  // the request DTO's own property declarations (to rule out a [Required] attribute there), so
  // flagging this as unconfirmed rather than certain. If dealers need Supervisor/Technician/
  // Service Type/Source captured on a job card, the right fix is to UN-comment those PickerFields
  // (they already have working option-loading code above, e.g. supervisorPickOptions/
  // technicianPickOptions/serviceTypeOptions/jobSourceOptions) and add them back to this
  // requirement list, rather than leaving them silently uncollected.
  const serviceDetailsValid = !!(
    selectedJobTypeId && selectedServiceHeadId && priority &&
    selectedWorkshopLocCode && complaints.length > 0
  )

  // SECTION 169 - Job Type/Service Head/Priority and Complaints now come from the new master
  // tables (was /api/bapl-dms/job-types and /api/bapl-dms/complaints). Job Source is unchanged.
  useEffect(() => {
    apiClient.get<ServiceMenuRow[]>('/api/service-menu-master')
      .then(({ data }) => setServiceMenuRows(data))
      .catch(() => setBaplMastersError('Could not load Job Type / Service Head / Priority options from Service Menu Master - Service Details will only capture JobCardScanner\'s own fields.'))
    apiClient.get<ComplaintMasterRow[]>('/api/complaint-master')
      .then(({ data }) => setComplaintOptions(data))
      .catch(() => setComplaintOptions([]))
    apiClient.get<BaplDmsJobSource[]>('/api/bapl-dms/job-sources')
      .then(({ data }) => setJobSources(data))
      .catch(() => setJobSources([]))
  }, [])

  const sortedServiceMenuRows = [...serviceMenuRows].sort((a, b) => a.sortOrder - b.sortOrder)
  const jobTypes = dedupeBy(sortedServiceMenuRows, (r) => r.jobTypeId)
    .map((r) => ({ id: r.jobTypeId, name: r.jobTypeName }))
  const serviceHeads = dedupeBy(sortedServiceMenuRows.filter((r) => r.jobTypeId === selectedJobTypeId), (r) => r.serviceHeadId)
    .map((r) => ({ id: r.serviceHeadId, name: r.serviceHeadName }))
  // value = PriorityLabel (posted as this screen's `priority` state), label = PriorityValue (the
  // short code shown in the picker) - see the import block's doc comment / web's identical
  // reasoning for why these are the right way round.
  const priorityOptionsForSelection = dedupeBy(
    sortedServiceMenuRows.filter((r) => r.jobTypeId === selectedJobTypeId && r.serviceHeadId === selectedServiceHeadId),
    (r) => r.priorityLabel,
  ).map((r) => ({ value: r.priorityLabel, label: r.priorityValue }))
  /** Same de-dup as priorityOptionsForSelection above, parameterised so onJobTypeChange/
   * onServiceHeadChange can compute Priority's next auto-selected value before this render's
   * priorityOptionsForSelection reflects the new selection. */
  const priorityOptionsFor = (jobTypeId: number | null, serviceHeadId: number | null) =>
    dedupeBy(
      sortedServiceMenuRows.filter((r) => r.jobTypeId === jobTypeId && r.serviceHeadId === serviceHeadId),
      (r) => r.priorityLabel,
    ).map((r) => ({ value: r.priorityLabel, label: r.priorityValue }))

  useEffect(() => {
    setSelectedWorkshopLocCode('')
    setBaplServiceLocation('')
    if (!effectiveDealerId) { setWorkshops([]); return }
    apiClient.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: effectiveDealerId } })
      .then(({ data }) => {
        // 2026-09-18 Work Area scoping (mirrors web/src/pages/staff/JobCardWizardPage.tsx): only
        // offer this user's own assigned Work Area location(s) when they have any set (from
        // /api/auth/me's workLocationCodes - see User.WorkLocationCodes's doc comment); empty
        // array means unrestricted (e.g. Corporate/System Admin).
        const scoped = profile?.workLocationCodes?.length
          ? data.filter((w) => profile.workLocationCodes.includes(w.locCode))
          : data
        setWorkshops(scoped)
      })
      .catch(() => setWorkshops([]))
  }, [effectiveDealerId, profile?.workLocationCodes])

  // Re-fetched whenever the dealer or the selected workshop location changes; a location change
  // also clears whichever Supervisor/Technician name was picked under the PREVIOUS location, since
  // either one scoped to one workshop isn't necessarily valid staff at another - mirrors web.
  useEffect(() => {
    setBaplSupervisorName('')
    setBaplTechnicianName('')
    if (!effectiveDealerId || !selectedWorkshopLocCode) { setSupervisorOptions([]); setTechnicianOptions([]); return }
    apiClient.get<SupervisorOption[]>('/api/technicians/supervisors', { params: { dealerId: effectiveDealerId, locationCode: selectedWorkshopLocCode } })
      .then(({ data }) => setSupervisorOptions(data))
      .catch(() => setSupervisorOptions([]))
    apiClient.get<Technician[]>('/api/technicians', { params: { dealerId: effectiveDealerId, locationCode: selectedWorkshopLocCode } })
      .then(({ data }) => setTechnicianOptions(data))
      .catch(() => setTechnicianOptions([]))
  }, [effectiveDealerId, selectedWorkshopLocCode])

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

  // SECTION 169 - resolved against the new Service Menu Master table now (was a live
  // GET /api/bapl-dms/service-heads/{id} fetch) - serviceHeads is a derived const (see above), so
  // there's no more setServiceHeads([])/fetch here, just a synchronous lookup, same as web. NEW,
  // matching web's own auto-select convention: when the picked Job Type has exactly one Service
  // Head, it's auto-selected immediately instead of leaving "Select service head…" for the user to
  // pick - and Priority follows the same rule one level deeper (auto-selects when the resulting
  // Job Type + Service Head pair has exactly one Priority row).
  const onJobTypeChange = (value: string) => {
    const id = value ? Number(value) : null
    setSelectedJobTypeId(id)
    const name = jobTypes.find((j) => j.id === id)?.name ?? ''
    setBaplJobType(name)
    if (name) setServiceType(mapBaplJobTypeToServiceType(name))
    const heads = dedupeBy(sortedServiceMenuRows.filter((r) => r.jobTypeId === id), (r) => r.serviceHeadId)
      .map((r) => ({ id: r.serviceHeadId, name: r.serviceHeadName }))
    const newHeadId = heads.length === 1 ? heads[0].id : null
    setSelectedServiceHeadId(newHeadId)
    setSelectedServiceTypeId(null)
    setServiceTypes([])
    const prios = priorityOptionsFor(id, newHeadId)
    setPriority(prios.length === 1 ? prios[0].value : '')
    if (newHeadId == null) return
    apiClient.get<BaplDmsServiceType[]>(`/api/bapl-dms/service-types/${newHeadId}`)
      .then(({ data }) => setServiceTypes(data))
      .catch(() => setServiceTypes([]))
  }

  const onJobSourceChange = (value: string) => {
    const id = value ? Number(value) : null
    setSelectedJobSourceId(id)
    const name = jobSources.find((j) => j.id === id)?.name ?? ''
    if (name) setSource(mapBaplJobSourceToSource(name))
  }

  // SECTION 169 - Priority auto-selects/clears the same way onJobTypeChange above does, one level
  // deeper. Service Type's own live fetch (GET /api/bapl-dms/service-types/{id}) is unchanged.
  const onServiceHeadChange = (value: string) => {
    const id = value ? Number(value) : null
    setSelectedServiceHeadId(id)
    setSelectedServiceTypeId(null)
    setServiceTypes([])
    const prios = priorityOptionsFor(selectedJobTypeId, id)
    setPriority(prios.length === 1 ? prios[0].value : '')
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
    const picked = complaintOptions.find((c) => c.id === selectedComplaintId)
    if (!picked) return
    if (!complaints.includes(picked.complaintText)) setComplaints((prev) => [...prev, picked.complaintText])
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
  const [printingPdf, setPrintingPdf] = useState(false)

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
        baplCouponNo: couponNo || null,
        baplJobCategory: jobCategory,
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

  // 2026-09-05: replaced the separate Download PDF / Share PDF buttons below with a single
  // "Print" button, matching web's single 🖨️ Print button on this step (JobCardWizardPage.tsx) -
  // Print.printAsync opens Android's own native print dialog, which (like the browser print popup
  // web uses) already offers "Save as PDF" as one of its printer choices, so this one dialog still
  // covers both printing and saving without needing a second, separate action.
  const printPdf = async () => {
    setPrintingPdf(true)
    try {
      await Print.printAsync({ html: buildPrintHtml() })
    } catch {
      Alert.alert('Could not open the print dialog. Please try again.')
    } finally {
      setPrintingPdf(false)
    }
  }

  // Kept for now (commented out of the UI below per request) rather than deleted, in case Share
  // PDF's direct-to-share-sheet flow (as opposed to Print's "Save as PDF" printer option) is wanted
  // back later.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const supervisorPickOptions: PickerOption[] = supervisorOptions.map((s) => ({ label: s.name, value: s.name }))
  const technicianPickOptions: PickerOption[] = technicianOptions.map((t) => ({ label: t.name, value: t.name }))
  const jobSourceOptions: PickerOption[] = jobSources.map((s) => ({ label: s.name, value: String(s.id) }))
  const complaintPickOptions: PickerOption[] = complaintOptions.map((c) => ({ label: c.complaintText, value: c.id }))
  // SECTION 169: sourced from the (Job Type, Service Head)-filtered priorityOptionsForSelection now
  // (was a completely independent fixed 3-item '1'/'2'/'3' array) - label = short code
  // (PriorityValue), value = what actually gets POSTED (PriorityLabel) - see the import block's
  // doc comment.
  const priorityOptions: PickerOption[] = priorityOptionsForSelection.map((p) => ({ label: p.label, value: p.value }))
  const dealerOptions: PickerOption[] = dealers.map((d) => ({ label: `${d.name} (${d.code})`, value: d.id }))

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.stepper}>
        {STEPS.map((s, i) => (
          <View key={s} style={[styles.stepChip, i === step && styles.stepChipActive, i < step && styles.stepChipDone]}>
            <Text style={[styles.stepChipText, i === step && styles.stepChipTextActive, i < step && styles.stepChipTextDone]}>
              {i < step ? '✓ ' : `${i + 1}. `}{s}
            </Text>
          </View>
        ))}
      </View>

      {step === 0 && (
        <View style={styles.card}>
          {needsDealerPicker && (
            <View style={{ marginBottom: 16 }}>
              <PickerField label="Dealer WorkShop Location" value={selectedDealerId} options={dealerOptions} onChange={setSelectedDealerId} placeholder="Select the dealer/workshop this job card is for…" />
              <Text style={styles.muted}>Your account isn't tied to a single dealer, so pick which workshop this job card belongs to. Not in the list yet? Search DMS below.</Text>
              <View style={styles.searchRow}>
                <TextInput style={[styles.input, { flex: 1 }]} value={dealerSearchQ} onChangeText={setDealerSearchQ} placeholder="Search Dealer WorkShop Location (DMS)" />
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

          <Text style={styles.h3}>Registered customer Details</Text>
          <Text style={styles.label}>Chassis no. / RegNo.</Text>
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={chassisOrRegQ}
              onChangeText={(text) => { setChassisOrRegQ(text); setShowVehicleSuggestions(true) }}
              onFocus={() => setShowVehicleSuggestions(true)}
              // Same 150ms grace period as web's onBlur - long enough for a tap on a suggestion
              // row below to register (its own onPress) before this hides the list out from
              // under it.
              onBlur={() => setTimeout(() => setShowVehicleSuggestions(false), 150)}
              placeholder="Chassis no. or registration no. (e.g. P6)"
              autoCapitalize="characters"
              autoCorrect={false}
              onSubmitEditing={() => lookupByChassisOrReg()}
            />
            <TouchableOpacity style={[styles.btn, (vehicleLookupLoading || !chassisOrRegQ.trim()) && styles.btnDisabled]} disabled={vehicleLookupLoading || !chassisOrRegQ.trim()} onPress={() => lookupByChassisOrReg()}>
              <Text style={styles.btnText}>{vehicleLookupLoading ? 'Searching…' : 'Search'}</Text>
            </TouchableOpacity>
          </View>
          {showVehicleSuggestions && vehicleSuggestions.length > 0 && (
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
                    Sale date: {s.saleDate ? formatISTDate(s.saleDate) : 'not sold'}
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
                <Text style={styles.noticeBannerText}>🔎 Not found for this dealer. Search DMS across every dealer?</Text>
                {globalSearchNotFound && <Text style={[styles.noticeBannerText, { marginTop: 4 }]}>Not found anywhere in DMS either.</Text>}
              </View>
              <TouchableOpacity disabled={globalSearchLoading} onPress={searchGlobalChassis}>
                <Text style={styles.noticeBannerDismiss}>{globalSearchLoading ? 'Searching…' : 'Search all dealers'}</Text>
              </TouchableOpacity>
            </View>
          )}
          {globalHit && (
            <View style={styles.dmsBox}>
              <Text style={{ fontWeight: '700', color: '#1e3a5f' }}>
                Found in DMS{globalHit.dealerCode && globalHit.dealerCode !== vehicleSearchDealerCode ? ` — registered to dealer ${globalHit.dealerCode}, not this workshop` : ''}
              </Text>
              <Text style={styles.muted}>
                {globalHit.customerName || 'Unknown customer'}{globalHit.customerMobile ? ` (${globalHit.customerMobile})` : ''} · {globalHit.modelName || 'Model unknown'}
                {globalHit.registerNo ? ` · reg no. ${globalHit.registerNo}` : ''}
                {globalHit.saleDate ? ` · sold ${formatISTDate(globalHit.saleDate)}` : ' · not yet sold'}
              </Text>
              <TouchableOpacity style={[styles.btnPrimary, { marginTop: 8 }]} onPress={applyGlobalHit}>
                <Text style={styles.btnPrimaryText}>Use this vehicle</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* {baplVehicleHit && (
            <Text style={styles.muted}>
              Customer Details : customer-{baplVehicleHit.customerName || 'Unknown customer'}
              {baplVehicleHit.customerMobile ? ` (${baplVehicleHit.customerMobile})` : ''} - model- {baplVehicleHit.modelName || 'Model unknown'}
              {baplVehicleHit.registerNo ? `, reg no. ${baplVehicleHit.registerNo}` : ''}
              {baplVehicleHit.saleDate ? `, sale date ${formatISTDate(baplVehicleHit.saleDate)}.` : '.'}
            </Text>
          )} */}

          <Text style={[styles.h3, { marginTop: 20 }]}>Registered Customer</Text>
          {customerFieldsLocked && (
            <View>
              <Text style={styles.muted}>🔒 Name, Mobile, Email, City and Address were auto-fetched from DMS and are locked.</Text>
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
              <Text style={styles.muted}>🔒 Model, Reg No and VIN were auto-fetched from DMS and are locked.</Text>
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
          {/* 2026-09-07: Coupon No. + Job Category, matching DMS's own form and mirroring
             web's JobCardWizardPage.tsx - see the couponNo/jobCategory state above for the
             auto-fill/default rules. */}
          <Field label="Coupon No" value={couponNo} onChangeText={(v) => { setCouponNo(v); setCouponNoTouched(true) }} />
          <PickerField
            label="Job Category"
            value={jobCategory}
            options={[{ label: 'B2C', value: 'B2C' }, { label: 'B2B', value: 'B2B' }]}
            onChange={(v) => setJobCategory(v as 'B2C' | 'B2B')}
          />
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
            <PickerField label="Job Type *" value={selectedJobTypeId != null ? String(selectedJobTypeId) : ''} options={jobTypes.map((jobType) => ({ label: jobType.name, value: String(jobType.id) }))} onChange={onJobTypeChange} />
            <PickerField label="Service Head *" value={selectedServiceHeadId != null ? String(selectedServiceHeadId) : ''} options={serviceHeadOptions} disabled={!selectedJobTypeId} placeholder={selectedJobTypeId ? 'Select service head…' : 'Select a job type first'} onChange={onServiceHeadChange} />
            {/* <PickerField label="Service Type *" value={selectedServiceTypeId != null ? String(selectedServiceTypeId) : ''} options={serviceTypeOptions} disabled={!selectedServiceHeadId} placeholder={selectedServiceHeadId ? 'Select service type…' : 'Select a service head first'} onChange={(v) => setSelectedServiceTypeId(v ? Number(v) : null)} /> */}
            <PickerField
              label="Priority *"
              value={priority}
              options={priorityOptions}
              disabled={!selectedServiceHeadId}
              placeholder={
                !selectedServiceHeadId
                  ? 'Select a service head first'
                  : priorityOptionsForSelection.length ? 'Select priority…' : 'No priority set up for this Service Head'
              }
              onChange={setPriority}
            />
            <PickerField label="Service Location (workshop) *" value={selectedWorkshopLocCode} options={workshopOptions} disabled={!effectiveDealerId} placeholder={workshops.length ? 'Select workshop…' : 'No workshops found for this dealer yet'} onChange={onWorkshopChange} />
            {/* 2026-09-24 CHANGE (mirrors web): Supervisor/Technician are now dropdowns scoped to
               the Service Location above, fed from Admin -> Employees (Designation: Supervisor)
               and the new Technician Employee tab, instead of free text. */}
            {/* <PickerField
              label="Supervisor *"
              value={baplSupervisorName}
              options={supervisorPickOptions}
              disabled={!selectedWorkshopLocCode}
              placeholder={selectedWorkshopLocCode ? (supervisorPickOptions.length ? 'Select supervisor…' : 'No Supervisor set up for this location yet') : 'Select a Service Location first'}
              onChange={setBaplSupervisorName}
            />
            <PickerField
              label="Technician *"
              value={baplTechnicianName}
              options={technicianPickOptions}
              disabled={!selectedWorkshopLocCode}
              placeholder={selectedWorkshopLocCode ? (technicianPickOptions.length ? 'Select technician…' : 'No Technician set up for this location yet') : 'Select a Service Location first'}
              onChange={setBaplTechnicianName}
            /> */}
            <Field label="Manual Job No." value={baplManualJobNo} onChangeText={setBaplManualJobNo} placeholder="e.g. 0" />
            {/* <PickerField label="Source *" value={selectedJobSourceId != null ? String(selectedJobSourceId) : ''} options={jobSourceOptions} placeholder="Select source…" onChange={onJobSourceChange} /> */}
            {/* 2026-09-24 CHANGE ("dont save this jobcard in dms remove this all over flow that
               save in jobcard db only"): this job card is saved in JobCardScanner ONLY. These
               fields are still required for this job card's own records (Job Type/Source drive
               ServiceType/Source, Service Location scopes Supervisor/Technician above) - not
               because they feed a DMS write-back any more. */}
            {/* <Text style={styles.muted}>All fields above are required for this job card's own records. Service Location also determines which Supervisor/Technician are offered above.</Text> */}
          </View>

          <Field label="Battery level at check-in (%)" value={batteryLevel} keyboardType="numeric" onChangeText={setBatteryLevel} />
          <View>
            <Text style={styles.label}>Expected delivery<Text style={styles.requiredStar}> *</Text></Text>
            <TouchableOpacity style={styles.field} onPress={openExpectedDeliveryPicker}>
              <Text style={styles.fieldText}>{formatISTDateTime(expectedDeliveryAt)}</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { marginTop: 12 }]}>Customer complaints<Text style={styles.requiredStar}> *</Text></Text>
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

          <Text style={[styles.label, { marginTop: 12 }]}>Customer notes</Text>
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
          {/* SECTION 169: was a raw `priority` display (which itself used to hold '1'/'2'/'3'
             directly, mislabeled as JobCardPriority via an `as unknown` cast - see priorityOptions'
             own doc comment above). `priority` now correctly holds the real posted enum value
             (PriorityLabel, e.g. "Normal"), so this looks up the matching master row's short code
             (PriorityValue) for display, same as web. */}
          <Text style={styles.reviewLine}><Text style={styles.bold}>Service:</Text> {baplJobType || serviceType} via {jobSources.find((s) => s.id === selectedJobSourceId)?.name || source}, priority {priorityOptionsForSelection.find((p) => p.value === priority)?.label ?? priority}</Text>
          <Text style={styles.reviewLine}><Text style={styles.bold}>Complaints:</Text> {complaints.join('; ') || 'None recorded'}</Text>

          {!createdJobCard && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>Photos<Text style={styles.requiredStar}> *</Text></Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                <TouchableOpacity style={styles.btn} disabled={capturingPhoto} onPress={takePhoto}>
                  <Text style={styles.btnText}>{capturingPhoto ? 'Adding…' : '📷 Capture Photo'}</Text>
                </TouchableOpacity>
                {/* <TouchableOpacity style={styles.btn} disabled={capturingPhoto} onPress={pickPhoto}>
                  <Text style={styles.btnText}>🖼️ Choose Photo</Text>
                </TouchableOpacity> */}
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
              {/* Single "Print" button now, matching web's step - see printPdf above for why
                 Print.printAsync alone (its own dialog's "Save as PDF" printer option) covers what
                 the old separate Download PDF button did too.
                 <View style={styles.btnRow}>
                   <TouchableOpacity style={styles.btn} disabled={downloadingPdf} onPress={downloadPdf}>
                     {downloadingPdf ? <ActivityIndicator color="#374151" /> : <Text style={styles.btnText}>⬇️ Download PDF</Text>}
                   </TouchableOpacity>
                   <TouchableOpacity style={styles.btn} disabled={sharingPdf} onPress={sharePdf}>
                     {sharingPdf ? <ActivityIndicator color="#374151" /> : <Text style={styles.btnText}>🖨️ Share PDF</Text>}
                   </TouchableOpacity>
                 </View> */}
              <View style={styles.btnRow}>
                <TouchableOpacity style={styles.btn} disabled={printingPdf} onPress={printPdf}>
                  {printingPdf ? <ActivityIndicator color="#374151" /> : <Text style={styles.btnText}>🖨️ Print</Text>}
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
  // 3-state step chips (Hub Pulse reskin): outlined default (not yet reached), solid navy
  // "selected" (current step), solid amber "✓ done" (completed step) - matches the reference
  // app's chip-state pattern for multi-step selection controls.
  stepChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  stepChipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  stepChipDone: { backgroundColor: colors.amber, borderColor: colors.amber },
  stepChipText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  stepChipTextActive: { color: '#fff' },
  stepChipTextDone: { color: '#fff' },
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
  // 2026-09-05: flexWrap added to both so a longer button label (e.g. "Continue to Job Card
  // JC/288/26-27/0006") or a narrower/smaller handset no longer forces buttons to squeeze onto one
  // line - they drop to their own line instead of clipping or overlapping.
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start', marginBottom: 8 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
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
