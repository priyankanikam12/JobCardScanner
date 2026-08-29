import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type {
  BaplDealerResolveResult, BaplDmsComplaint, BaplDmsDealer, BaplDmsJobSource, BaplDmsJobType,
  BaplDmsServiceHead, BaplDmsServiceType, BaplDmsVehicleLookup, BaplDmsWorkshop, Customer, Dealer,
  JobCardPriority, JobCardSource, PhotoStage, ServiceType, Vehicle,
} from '../../types'
import { VEHICLE_MODELS, variantsForModel } from '../../data/vehicleCatalog'

const STEPS = ['Customer', 'Vehicle', 'Service Details', 'Review & Create']

// JobCardScanner's own ServiceType/JobCardSource enums are still required internally (dashboards,
// filters, the Status Badge, ...) but showing them as their own pickers next to BAPL DMS's real
// Job Type and JobSource dropdowns was pure duplication - two "what kind of service is this"
// fields and two "where did this job come from" fields for the same job card. These best-effort
// mappings derive JobCardScanner's own value from whichever BAPL DMS option was actually picked,
// so only one of each is shown to the user; there's no clean 1:1 correspondence between BAPL DMS's
// free-form master data and JobCardScanner's fixed enum, so treat this as "close enough for
// internal reporting", not an authoritative translation.
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

export function JobCardWizardPage() {
  const { profile } = useStaffAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every job card / customer / vehicle belongs to a dealer (workshop). Regular dealer staff
  // (ServiceAdvisor, WorkshopManager, DealerAdmin, ...) already have this on their own profile
  // (see Users.DealerId), so it's implicit for them. Head-office accounts (CorporateAdmin,
  // SystemAdmin) aren't tied to a single dealer, so profile.dealerId is null for them - without
  // this picker they'd silently send dealerId: null and the API would reject it with a 400
  // (System.Guid isn't nullable), because /api/customers, /api/customers/vehicles and
  // /api/jobcards all require a real dealer id.
  const [dealers, setDealers] = useState<Dealer[]>([])
  const [selectedDealerId, setSelectedDealerId] = useState('')
  const needsDealerPicker = !profile?.dealerId
  const effectiveDealerId = profile?.dealerId || selectedDealerId

  useEffect(() => {
    if (!needsDealerPicker) return
    // Only dealers/workshops already known to BAPL DMS (a resolved BaplDmsDealerCode) are shown
    // here - a dealer imported only from the BAPL ERP warehouse (BaplDealerService's bulk import,
    // a different data source entirely) has no BAPL DMS job card history/master data behind it, so
    // showing it in this picker would silently break the chassis lookup, Service Location dropdown,
    // and the BAPL DMS write-back further down this wizard. Not in the list? Search BAPL DMS below.
    staffApi.get<Dealer[]>('/api/dealers')
      .then(({ data }) => setDealers(data.filter((d) => !!d.baplDmsDealerCode)))
      .catch(() => setDealers([]))
  }, [needsDealerPicker])

  // Live search against BAPL DMS's own DealerMaster (Controllers/BaplDmsController.cs), for staff
  // whose workshop isn't already a local Dealer row (or who'd rather find it by BAPL's own name/
  // code than scroll the plain dropdown above). Selecting a hit resolves-or-creates the matching
  // local Dealer (no login - see the controller's doc comment) and adds it to the picker.
  const [dealerSearchQ, setDealerSearchQ] = useState('')
  const [baplDealerResults, setBaplDealerResults] = useState<BaplDmsDealer[]>([])
  const [dealerSearchError, setDealerSearchError] = useState<string | null>(null)
  const [resolvingDealer, setResolvingDealer] = useState(false)
  // Shown once, right after a dealer is resolved for the first time - the DealerAdmin login this
  // creates (same shared default password as the bulk BAPL ERP import) is only ever handed back in
  // this one API response, so whoever ran the search needs to see it now to pass it on.
  const [newDealerLogin, setNewDealerLogin] = useState<{ email: string; password: string } | null>(null)

  const searchBaplDealers = async () => {
    if (dealerSearchQ.trim().length < 2) return
    setDealerSearchError(null)
    try {
      const { data } = await staffApi.get<BaplDmsDealer[]>('/api/bapl-dms/dealers', { params: { q: dealerSearchQ } })
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
      const { data } = await staffApi.post<BaplDealerResolveResult>('/api/bapl-dms/dealers/resolve', { dealerCode: row.dealerCode })
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

  // Step 1: customer
  const [searchQ, setSearchQ] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [newCustomer, setNewCustomer] = useState({ name: '', mobile: '', email: '', city: '', address: '' })

  // "Find or add customer" by chassis no. / registration no. - auto-fetches everything BAPL DMS
  // knows about that vehicle (Controllers/BaplDmsController.cs's vehicle-lookup, ported from BAPL
  // DMS's own onChassisChange()/GetAllInspectedLotChassisAsync) and uses it to pre-fill both the
  // "register a new customer" fields below AND the vehicle step that follows - baplVehicleHit is
  // read again in step 2 for that.
  const [chassisOrRegQ, setChassisOrRegQ] = useState('')
  const [vehicleLookupLoading, setVehicleLookupLoading] = useState(false)
  const [vehicleLookupError, setVehicleLookupError] = useState<string | null>(null)
  const [baplVehicleHit, setBaplVehicleHit] = useState<BaplDmsVehicleLookup | null>(null)
  // Fields pre-filled from a BAPL DMS auto-fetch are locked by default (disabled inputs) so they
  // aren't accidentally overwritten - each section has its own "Edit anyway" escape hatch for the
  // rare case the fetched data is wrong. Resets back to locked whenever a fresh hit comes in.
  const [unlockCustomerFields, setUnlockCustomerFields] = useState(false)
  const [unlockVehicleFields, setUnlockVehicleFields] = useState(false)
  const customerFieldsLocked = !!baplVehicleHit && !unlockCustomerFields
  const vehicleFieldsLocked = !!baplVehicleHit && !unlockVehicleFields

  const lookupByChassisOrReg = async () => {
    if (!chassisOrRegQ.trim()) return
    setVehicleLookupLoading(true)
    setVehicleLookupError(null)
    setBaplVehicleHit(null)
    setUnlockCustomerFields(false)
    setUnlockVehicleFields(false)
    try {
      const { data } = await staffApi.get<BaplDmsVehicleLookup>('/api/bapl-dms/vehicle-lookup', { params: { value: chassisOrRegQ.trim() } })
      setBaplVehicleHit(data)
      setNewCustomer((c) => ({
        ...c,
        name: data.customerName || c.name,
        mobile: data.customerMobile ? data.customerMobile.replace(/\D/g, '').slice(0, 10) : c.mobile,
        city: data.customerCity || c.city,
      }))
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: { message?: string } } })?.response
      setVehicleLookupError(response?.status === 404
        ? `"${chassisOrRegQ.trim()}" wasn't found in BAPL DMS - add the customer/vehicle manually below.`
        : response?.data?.message
          ? `BAPL DMS error: ${response.data.message}`
          : 'Could not reach BAPL DMS right now - add the customer/vehicle manually below.')
    } finally {
      setVehicleLookupLoading(false)
    }
  }

  // Step 2: vehicle
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [newVehicle, setNewVehicle] = useState({ model: '', variant: '', color: '', regNo: '', vin: '', odometer: 0 })
  // Model -> Variant is a dependent dropdown (see data/vehicleCatalog.ts): picking a model
  // narrows the Variant list down to just that model's variants, and changing the model clears
  // whatever variant was previously selected so an invalid model/variant pairing can't be sent.
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const availableVariants = variantsForModel(selectedModelId)

  // Pre-fill the "add a new vehicle" form the moment a BAPL DMS hit exists, so a customer created
  // from a chassis/reg-no search (above) lands on step 2 with everything already typed in. BAPL DMS
  // doesn't split Model/Variant into two fields the way JobCardScanner's own catalog does - it's one
  // combined ItemName (e.g. "BGauss C12i MAX 2.0 Monolith Grey", straight from ChassisDetails) - so
  // this no longer tries to match it against the Model/Variant catalog; it's saved as-is into the
  // single Model field and Variant is left blank (the backend field is a plain string either way -
  // see CreateVehicleRequest).
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

  // Step 3: service details
  const [serviceType, setServiceType] = useState<ServiceType>('PaidService')
  const [source, setSource] = useState<JobCardSource>('WalkIn')
  const [priority, setPriority] = useState<JobCardPriority>('Normal')
  const [odometerAtCheckIn, setOdometerAtCheckIn] = useState(0)
  const [batteryLevel, setBatteryLevel] = useState<number | ''>('')
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState('')
  const [consentNotes, setConsentNotes] = useState('')
  const [complaints, setComplaints] = useState<string[]>([''])
  // BAPL-DMS-style fields, captured alongside JobCardScanner's own Service Type/Source/Priority
  // above. Job Type -> Service Head -> Service Type is a live cascade straight off BAPL DMS's own
  // JobType/ServiceHead/ServiceType master tables (Controllers/BaplDmsController.cs) - picking a
  // Job Type loads that job type's Service Heads, picking a Service Head loads that head's Service
  // Types, same dependency BAPL DMS's own screen uses. These ids (plus Service Location's Loccode)
  // are what actually let JobCardsController.Create attempt the BAPL DMS write-back - the free-text
  // baplJobType/baplServiceLocation below are kept only as a human-readable label for display.
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

  // Replaces the old hardcoded WalkIn/PickupAndDrop/Breakdown/Scheduled/Online "Source" dropdown -
  // BAPL DMS's own JobSource master (Walk In/RSA/Mega Camp/...) is now the only "where did this job
  // come from" picker shown; JobCardScanner's own `source` state above is derived from it (see
  // mapBaplJobSourceToSource) rather than picked directly.
  const [jobSources, setJobSources] = useState<BaplDmsJobSource[]>([])
  const [selectedJobSourceId, setSelectedJobSourceId] = useState<number | null>(null)

  const [baplSyncWarning, setBaplSyncWarning] = useState<string | null>(null)

  // Job Type/JobSource masters + Complaint master are all small, session-wide lists - fetched once
  // each, not re-fetched per wizard step.
  useEffect(() => {
    staffApi.get<BaplDmsJobType[]>('/api/bapl-dms/job-types')
      .then(({ data }) => setJobTypes(data))
      .catch(() => setBaplMastersError('Could not load BAPL DMS\'s Job Type list - Service Details will only capture JobCardScanner\'s own fields.'))
    staffApi.get<BaplDmsComplaint[]>('/api/bapl-dms/complaints')
      .then(({ data }) => setComplaintOptions(data))
      .catch(() => setComplaintOptions([]))
    staffApi.get<BaplDmsJobSource[]>('/api/bapl-dms/job-sources')
      .then(({ data }) => setJobSources(data))
      .catch(() => setJobSources([]))
  }, [])

  useEffect(() => {
    if (!effectiveDealerId) { setWorkshops([]); return }
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: effectiveDealerId } })
      .then(({ data }) => setWorkshops(data))
      .catch(() => setWorkshops([]))
  }, [effectiveDealerId])

  // Pre-select the Service Location once BAPL DMS told us which workshop this chassis is
  // registered against (ChassisDetails.LocationCode via the chassis/reg-no lookup), once that
  // dealer's workshop list has actually loaded.
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
    // JobCardScanner's own ServiceType is derived from the Job Type picked here rather than shown
    // as a separate dropdown - see mapBaplJobTypeToServiceType's doc comment above.
    if (name) setServiceType(mapBaplJobTypeToServiceType(name))
    setSelectedServiceHeadId(null)
    setServiceHeads([])
    setSelectedServiceTypeId(null)
    setServiceTypes([])
    if (id == null) return
    staffApi.get<BaplDmsServiceHead[]>(`/api/bapl-dms/service-heads/${id}`)
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
    staffApi.get<BaplDmsServiceType[]>(`/api/bapl-dms/service-types/${id}`)
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
    setComplaints((prev) => {
      const blanks = prev.filter((c) => !c.trim())
      const filled = prev.filter((c) => c.trim())
      return [...filled, picked.name, ...blanks]
    })
    setSelectedComplaintId('')
  }

  // Photos captured BEFORE the job card exists (Review & Create step, ahead of the "Create Job
  // Card" button) - kept as in-memory File objects with a local object-URL preview until the job
  // card is actually created, since POST /api/jobcards/{id}/photos/upload needs a real job card id
  // that doesn't exist yet at this point in the wizard. submit() below uploads each one right after
  // creation succeeds. This is in addition to, not instead of, the Photos card already on the Job
  // Card Detail page - that one stays for photos added after the fact (repairs, QC, delivery, ...).
  type PendingPhoto = { id: string; file: File; previewUrl: string; caption: string; stage: PhotoStage; latitude?: number; longitude?: number }
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([])
  const [capturingPhoto, setCapturingPhoto] = useState(false)
  const [photoLocationNote, setPhotoLocationNote] = useState<string | null>(null)
  const [photoUploadWarning, setPhotoUploadWarning] = useState<string | null>(null)
  const [createdJobCard, setCreatedJobCard] = useState<{ id: string; jobCardNumber: string } | null>(null)

  // Release the object URLs when the component unmounts, so a long wizard session with several
  // large photos doesn't leak memory. Kept in a ref (rather than depending on pendingPhotos
  // directly) so the unmount cleanup below always sees the latest list instead of the empty array
  // captured back when this effect first mounted.
  const pendingPhotosRef = useRef<PendingPhoto[]>([])
  useEffect(() => { pendingPhotosRef.current = pendingPhotos }, [pendingPhotos])
  useEffect(() => {
    return () => pendingPhotosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl))
  }, [])

  const getPhotoLocation = (): Promise<GeolocationPosition | null> =>
    new Promise((resolve) => {
      if (!('geolocation' in navigator)) { resolve(null); return }
      navigator.geolocation.getCurrentPosition((pos) => resolve(pos), () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 })
    })

  const addPendingPhoto = async (file: File | undefined) => {
    if (!file) return
    setCapturingPhoto(true)
    setPhotoLocationNote('Getting location…')
    try {
      const pos = await getPhotoLocation()
      setPhotoLocationNote(pos ? `Location captured (±${Math.round(pos.coords.accuracy)}m)` : 'Location unavailable - added without it')
      setPendingPhotos((prev) => [...prev, {
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        caption: '',
        stage: 'CheckIn',
        latitude: pos?.coords.latitude,
        longitude: pos?.coords.longitude,
      }])
    } finally {
      setCapturingPhoto(false)
      setTimeout(() => setPhotoLocationNote(null), 2000)
    }
  }

  const removePendingPhoto = (id: string) => {
    setPendingPhotos((prev) => {
      const found = prev.find((p) => p.id === id)
      if (found) URL.revokeObjectURL(found.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
  }

  const searchCustomers = async () => {
    if (searchQ.length < 3) return
    const { data } = await staffApi.get<Customer[]>('/api/customers/search', { params: { q: searchQ } })
    setResults(data)
  }

  const createCustomer = async () => {
    if (!effectiveDealerId) { setError('Select a dealer/workshop before adding a customer.'); return }
    setError(null)
    const { data } = await staffApi.post<Customer>('/api/customers', { ...newCustomer, dealerId: effectiveDealerId })
    setCustomer({ ...data, vehicles: [] })
    setStep(1)
  }

  const createVehicle = async () => {
    if (!customer) return
    if (!effectiveDealerId) { setError('Select a dealer/workshop before adding a vehicle.'); return }
    setError(null)
    // BAPL DMS returns full ISO date-times (or plain dates); the backend's DateOnly fields only
    // want the date part - same trim BAPL's own Angular code does (`selected.saleDate?.split('T')[0]`).
    const dateOnly = (s?: string | null) => (s ? s.split('T')[0] : null)
    const { data } = await staffApi.post<Vehicle>('/api/customers/vehicles', {
      ...newVehicle,
      customerId: customer.id,
      dealerId: effectiveDealerId,
      purchaseDate: dateOnly(baplVehicleHit?.saleDate),
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
    setOdometerAtCheckIn(data.odometer)
    setStep(2)
  }

  const submit = async () => {
    if (!customer || !vehicle) return
    if (!effectiveDealerId) { setError('Select a dealer/workshop before creating the job card.'); return }
    setSubmitting(true)
    setError(null)
    setPhotoUploadWarning(null)
    setBaplSyncWarning(null)
    try {
      const { data } = await staffApi.post('/api/jobcards', {
        dealerId: effectiveDealerId,
        customerId: customer.id,
        vehicleId: vehicle.id,
        serviceType,
        source,
        priority,
        odometerAtCheckIn,
        batteryLevelAtCheckIn: batteryLevel === '' ? null : batteryLevel,
        expectedDeliveryAt: expectedDeliveryAt || null,
        serviceAdvisorId: profile?.id,
        customerConsentNotes: consentNotes || null,
        complaints: complaints.filter((c) => c.trim()).map((description) => ({ description, isCustomerVoice: true })),
        baplJobType: baplJobType || null,
        baplServiceLocation: baplServiceLocation || null,
        baplSupervisorName: baplSupervisorName || null,
        baplTechnicianName: baplTechnicianName || null,
        baplManualJobNo: baplManualJobNo || null,
        // Cascade ids + Service Location code - only set once all three of Job Type/Service Head/
        // Service Type are picked, which is what tells the backend there's enough to actually try
        // writing this job card into BAPL DMS's own database (see JobCardsController.Create).
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

      // The job card now has a real id, so the photos captured before this point (pendingPhotos)
      // can finally go through the same upload endpoint the Job Card Detail page's Photos card
      // uses. Uploaded one at a time and tallied rather than in parallel, so one slow/large photo
      // doesn't fight the others for bandwidth on a workshop's typically-thin connection.
      if (pendingPhotos.length > 0) {
        let failed = 0
        for (const p of pendingPhotos) {
          const form = new FormData()
          form.append('File', p.file)
          form.append('Stage', p.stage)
          if (p.caption) form.append('Caption', p.caption)
          if (p.latitude != null) form.append('Latitude', String(p.latitude))
          if (p.longitude != null) form.append('Longitude', String(p.longitude))
          try {
            await staffApi.post(`/api/jobcards/${data.id}/photos/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
          } catch {
            failed += 1
          }
        }
        if (failed > 0) {
          pendingPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
          setPendingPhotos([])
          setCreatedJobCard({ id: data.id, jobCardNumber: data.jobCardNumber })
          setPhotoUploadWarning(`Job card ${data.jobCardNumber} was created, but ${failed} of ${pendingPhotos.length} photo(s) failed to upload. You can add them again from the job card's Photos section.`)
          return
        }
      }
      // A BAPL DMS sync failure (see baplSyncWarning above) never blocks or fails job card
      // creation - the local job card is already saved - but it's worth pausing on this step to
      // show the user rather than silently navigating away, same as a photo upload failure.
      if (data?.baplSyncWarning) {
        setCreatedJobCard({ id: data.id, jobCardNumber: data.jobCardNumber })
        return
      }
      navigate(`/jobcards/${data.id}`)
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create job card.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h2>New Job Card</h2>
      <div className="stepper">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`}>{i + 1}. {s}</div>
        ))}
      </div>

      {step === 0 && (
        <div className="card">
          {needsDealerPicker && (
            <div className="field" style={{ marginBottom: 16 }}>
              <label>Dealer / Workshop</label>
              <select value={selectedDealerId} onChange={(e) => setSelectedDealerId(e.target.value)}>
                <option value="">Select the dealer/workshop this job card is for…</option>
                {dealers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                ))}
              </select>
              <p className="muted" style={{ marginTop: 4 }}>
                Your account isn't tied to a single dealer, so pick which workshop this job card belongs to.
                Not in the list yet? Search BAPL DMS below.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  value={dealerSearchQ}
                  onChange={(e) => setDealerSearchQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchBaplDealers()}
                  placeholder="Search Dealer / Workshop (BAPL DMS) by name or code…"
                />
                <button className="btn" onClick={searchBaplDealers} disabled={dealerSearchQ.trim().length < 2}>Search</button>
              </div>
              {dealerSearchError && <p className="error-text">{dealerSearchError}</p>}
              {baplDealerResults.length > 0 && (
                <table style={{ marginTop: 8 }}>
                  <thead><tr><th>Dealer</th><th>Code</th><th>City</th><th></th></tr></thead>
                  <tbody>
                    {baplDealerResults.map((d) => (
                      <tr key={d.dealerCode}>
                        <td>{d.dealerName}</td><td>{d.dealerCode}</td><td>{d.city}</td>
                        <td><button className="btn btn-sm btn-primary" disabled={resolvingDealer} onClick={() => selectBaplDealer(d)}>Use this dealer</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {newDealerLogin && (
                <p className="muted" style={{ marginTop: 8 }}>
                  Dealer login created - <strong>{newDealerLogin.email}</strong> / <strong>{newDealerLogin.password}</strong>.
                  Share these with the dealer; they'll be asked to set a new password on first sign-in.
                </p>
              )}
            </div>
          )}
          <h3>Find or add customer</h3>
          <div className="field">
            <label>Search by mobile number or name</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="98765xxxxx" />
              <button className="btn" onClick={searchCustomers}>Search</button>
            </div>
          </div>
          <div className="field">
            <label>Or search by chassis no. / registration no. / mobile no. (auto-fetches customer &amp; vehicle details from BAPL DMS)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={chassisOrRegQ}
                onChange={(e) => setChassisOrRegQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && lookupByChassisOrReg()}
                placeholder="Chassis no., registration no., or mobile no."
              />
              <button className="btn" onClick={lookupByChassisOrReg} disabled={vehicleLookupLoading || !chassisOrRegQ.trim()}>
                {vehicleLookupLoading ? 'Searching…' : 'Search'}
              </button>
            </div>
            {vehicleLookupError && <p className="error-text">{vehicleLookupError}</p>}
            {baplVehicleHit && (
              <p className="muted" style={{ marginTop: 4 }}>
                Found in BAPL DMS: <strong>{baplVehicleHit.customerName || 'Unknown customer'}</strong>
                {baplVehicleHit.customerMobile ? ` (${baplVehicleHit.customerMobile})` : ''} - {baplVehicleHit.modelName || 'Model unknown'}
                {baplVehicleHit.registerNo ? `, ${baplVehicleHit.registerNo}` : ''}. Customer and vehicle details below have been pre-filled -
                review them, then Create &amp; Continue.
              </p>
            )}
          </div>
          {results.length > 0 && (
            <table>
              <thead><tr><th>Name</th><th>Mobile</th><th>City</th><th></th></tr></thead>
              <tbody>
                {results.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td><td>{c.mobile}</td><td>{c.city}</td>
                    <td><button className="btn btn-sm btn-primary" onClick={() => { setCustomer(c); setBaplVehicleHit(null); setStep(1) }}>Select</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: 24 }}>Or register a new customer</h3>
          {customerFieldsLocked && (
            <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
              🔒 Name and Mobile were auto-fetched from BAPL DMS and are locked to prevent accidental changes.{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setUnlockCustomerFields(true) }}>Edit anyway</a>
            </p>
          )}
          <div className="form-row">
            <div className="field">
              <label>Name</label>
              <input value={newCustomer.name} disabled={customerFieldsLocked} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Mobile</label>
              <input
                value={newCustomer.mobile}
                disabled={customerFieldsLocked}
                maxLength={10}
                inputMode="numeric"
                placeholder="10-digit mobile number"
                onChange={(e) => setNewCustomer({ ...newCustomer, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              />
            </div>
            <div className="field"><label>Email</label><input value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} /></div>
            <div className="field"><label>City</label><input value={newCustomer.city} onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })} /></div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" disabled={!newCustomer.name || newCustomer.mobile.length !== 10 || !effectiveDealerId} onClick={createCustomer}>Create & Continue</button>
        </div>
      )}

      {step === 1 && customer && (
        <div className="card">
          <h3>Vehicle for {customer.name}</h3>
          {baplVehicleHit && (
            <div style={{
              background: '#eef6ff', border: '1px solid #bfdcff', borderRadius: 8,
              padding: '10px 14px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ background: '#1c64f2', color: '#fff', fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999 }}>
                  BAPL DMS
                </span>
                {baplVehicleHit.vehiclePrevKms != null && (
                  <span style={{ fontWeight: 700, fontSize: 15 }}>
                    Previous Km: {baplVehicleHit.vehiclePrevKms}
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#1e3a5f' }}>
                Auto-fetched - Battery: <strong>{baplVehicleHit.batteryNumber || '—'}</strong>, Motor: <strong>{baplVehicleHit.motorNo || '—'}</strong>,
                {' '}Controller: <strong>{baplVehicleHit.controllerNo || '—'}</strong>, Charger: <strong>{baplVehicleHit.chargerNumber || '—'}</strong>
                {baplVehicleHit.insuranceExpDate ? <>, Insurance till: <strong>{baplVehicleHit.insuranceExpDate.split('T')[0]}</strong></> : ''}
                {baplVehicleHit.nextServiceDueDate ? <>, Next service due: <strong>{baplVehicleHit.nextServiceDueDate.split('T')[0]}</strong></> : ''}
                {baplVehicleHit.expireWarrantyDate ? <>, Warranty till: <strong>{baplVehicleHit.expireWarrantyDate.split('T')[0]}</strong></> : ''}
                . These will be saved with the vehicle.
              </p>
            </div>
          )}
          {customer.vehicles && customer.vehicles.length > 0 && (
            <table>
              <thead><tr><th>Model</th><th>Reg No</th><th>Odometer</th><th></th></tr></thead>
              <tbody>
                {customer.vehicles.map((v) => (
                  <tr key={v.id}>
                    <td>{v.model} {v.variant}</td><td>{v.regNo}</td><td>{v.odometer} km</td>
                    <td><button className="btn btn-sm btn-primary" onClick={() => { setVehicle(v); setOdometerAtCheckIn(v.odometer); setStep(2) }}>Select</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 style={{ marginTop: 24 }}>Or add a new vehicle</h3>
          {vehicleFieldsLocked && (
            <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
              🔒 Model, Variant, Reg No and VIN were auto-fetched from BAPL DMS and are locked to prevent accidental changes.{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setUnlockVehicleFields(true) }}>Edit anyway</a>
            </p>
          )}
          <div className="form-row">
            <div className="field">
              <label>Model{vehicleFieldsLocked ? '' : ' & Variant'}</label>
              {vehicleFieldsLocked ? (
                // BAPL DMS doesn't split Model/Variant into two fields (see the pre-fill effect
                // above) - a plain disabled text input shows the combined name it sent back,
                // instead of a <select> that would otherwise appear empty (nothing in the catalog
                // matches a BAPL ItemName one-for-one).
                <input value={newVehicle.model} disabled />
              ) : (
                <select
                  value={selectedModelId ?? ''}
                  onChange={(e) => {
                    const modelId = e.target.value ? Number(e.target.value) : null
                    const modelName = VEHICLE_MODELS.find((m) => m.id === modelId)?.name ?? ''
                    setSelectedModelId(modelId)
                    setNewVehicle({ ...newVehicle, model: modelName, variant: '' })
                  }}
                >
                  <option value="">Select model…</option>
                  {VEHICLE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
            </div>
            {!vehicleFieldsLocked && (
              <div className="field">
                <label>Variant</label>
                <select
                  value={newVehicle.variant}
                  disabled={!selectedModelId}
                  onChange={(e) => setNewVehicle({ ...newVehicle, variant: e.target.value })}
                >
                  <option value="">{selectedModelId ? 'Select variant…' : 'Select a model first'}</option>
                  {availableVariants.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
                </select>
              </div>
            )}
            <div className="field"><label>Reg No</label><input value={newVehicle.regNo} disabled={vehicleFieldsLocked} onChange={(e) => setNewVehicle({ ...newVehicle, regNo: e.target.value })} /></div>
            <div className="field"><label>VIN</label><input value={newVehicle.vin} disabled={vehicleFieldsLocked} onChange={(e) => setNewVehicle({ ...newVehicle, vin: e.target.value })} /></div>
            <div className="field"><label>Odometer (km)</label><input type="number" value={newVehicle.odometer} onChange={(e) => setNewVehicle({ ...newVehicle, odometer: Number(e.target.value) })} /></div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(0)}>← Back</button>
            <button className="btn btn-primary" disabled={!newVehicle.model || !effectiveDealerId} onClick={createVehicle}>Create & Continue</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h3>Service details</h3>

          <div style={{
            background: '#eef6ff', border: '1px solid #bfdcff', borderRadius: 8,
            padding: '12px 14px', marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ background: '#1c64f2', color: '#fff', fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999 }}>
                BAPL DMS
              </span>
              <strong style={{ fontSize: 14 }}>Job Card fields (as entered in BAPL DMS)</strong>
            </div>
            {baplMastersError && <p className="error-text" style={{ marginTop: 0 }}>{baplMastersError}</p>}
            <div className="form-row">
              <div className="field">
                <label>Job Type</label>
                <select value={selectedJobTypeId ?? ''} onChange={(e) => onJobTypeChange(e.target.value)}>
                  <option value="">Select job type…</option>
                  {jobTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Service Head</label>
                <select value={selectedServiceHeadId ?? ''} disabled={!selectedJobTypeId} onChange={(e) => onServiceHeadChange(e.target.value)}>
                  <option value="">{selectedJobTypeId ? 'Select service head…' : 'Select a job type first'}</option>
                  {serviceHeads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Service Type</label>
                <select value={selectedServiceTypeId ?? ''} disabled={!selectedServiceHeadId} onChange={(e) => setSelectedServiceTypeId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{selectedServiceHeadId ? 'Select service type…' : 'Select a service head first'}</option>
                  {serviceTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <div className="field">
                <label>Service Location (workshop)</label>
                <select value={selectedWorkshopLocCode} disabled={!effectiveDealerId} onChange={(e) => onWorkshopChange(e.target.value)}>
                  <option value="">{workshops.length ? 'Select workshop…' : 'No workshops found for this dealer yet'}</option>
                  {workshops.map((w) => <option key={w.locCode} value={w.locCode}>{w.locName} ({w.locCode})</option>)}
                </select>
              </div>
              <div className="field">
                <label>Supervisor</label>
                <input value={baplSupervisorName} onChange={(e) => setBaplSupervisorName(e.target.value)} placeholder="Supervisor name" />
              </div>
              <div className="field">
                <label>Technician</label>
                <input value={baplTechnicianName} onChange={(e) => setBaplTechnicianName(e.target.value)} placeholder="Technician name" />
              </div>
              <div className="field">
                <label>Manual Job No.</label>
                <input value={baplManualJobNo} onChange={(e) => setBaplManualJobNo(e.target.value)} placeholder="e.g. 0" />
              </div>
            </div>
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
              {selectedJobTypeId && selectedServiceHeadId && selectedServiceTypeId
                ? 'Job Type / Service Head / Service Type / Service Location above will be written into BAPL DMS\'s own job card when you create this job card.'
                : 'Pick Job Type, Service Head and Service Type above to also create this job card in BAPL DMS\'s own database - leave any of them blank to only save it in JobCardScanner.'}
            </p>
          </div>

          {/* No separate "Service Type" picker here any more - it was a straight duplicate of the
             BAPL DMS Service Type dropdown above (JobCardScanner's own ServiceType enum is now
             auto-derived from whichever Job Type was picked - see mapBaplJobTypeToServiceType).
             "Source" now comes from BAPL DMS's own JobSource master instead of a hardcoded list. */}
          <div className="form-row">
            <div className="field">
              <label>Source</label>
              <select value={selectedJobSourceId ?? ''} onChange={(e) => onJobSourceChange(e.target.value)}>
                <option value="">Select source…</option>
                {jobSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as JobCardPriority)}>
                {(['Normal', 'High', 'Urgent'] as JobCardPriority[]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field"><label>Odometer at check-in (km)</label><input type="number" value={odometerAtCheckIn} onChange={(e) => setOdometerAtCheckIn(Number(e.target.value))} /></div>
            <div className="field"><label>Battery level at check-in (%)</label><input type="number" min={0} max={100} value={batteryLevel} onChange={(e) => setBatteryLevel(e.target.value === '' ? '' : Number(e.target.value))} /></div>
            <div className="field"><label>Expected delivery</label><input type="datetime-local" value={expectedDeliveryAt} onChange={(e) => setExpectedDeliveryAt(e.target.value)} /></div>
          </div>

          <div className="field">
            <label>Customer complaints / concerns</label>
            {complaintOptions.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={selectedComplaintId} onChange={(e) => setSelectedComplaintId(e.target.value)}>
                  <option value="">Pick from BAPL DMS's complaint list…</option>
                  {complaintOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="btn btn-sm" disabled={!selectedComplaintId} onClick={addComplaintFromDropdown}>Add</button>
              </div>
            )}
            {complaints.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={c} onChange={(e) => setComplaints(complaints.map((x, idx) => (idx === i ? e.target.value : x)))} placeholder="e.g. Unusual noise from rear motor" />
                <button className="btn btn-sm" onClick={() => setComplaints(complaints.filter((_, idx) => idx !== i))}>Remove</button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => setComplaints([...complaints, ''])}>+ Add complaint</button>
          </div>

          <div className="field">
            <label>Customer consent notes</label>
            <textarea rows={3} value={consentNotes} onChange={(e) => setConsentNotes(e.target.value)} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={() => setStep(3)}>Continue to Review</button>
          </div>
        </div>
      )}

      {step === 3 && customer && vehicle && (
        <div className="card">
          <h3>Review</h3>
          <p><strong>Customer:</strong> {customer.name} ({customer.mobile})</p>
          <p><strong>Vehicle:</strong> {vehicle.model} {vehicle.variant} - {vehicle.regNo}</p>
          <p><strong>Service:</strong> {baplJobType || serviceType} via {jobSources.find((s) => s.id === selectedJobSourceId)?.name || source}, priority {priority}</p>
          <p><strong>Complaints:</strong> {complaints.filter((c) => c.trim()).join('; ') || 'None recorded'}</p>
          {(baplJobType || baplServiceLocation || baplSupervisorName || baplTechnicianName || baplManualJobNo) && (
            <p>
              <strong>BAPL DMS fields:</strong>{' '}
              {[
                baplJobType && `Job Type: ${baplJobType}`,
                serviceHeads.find((h) => h.id === selectedServiceHeadId)?.name && `Service Head: ${serviceHeads.find((h) => h.id === selectedServiceHeadId)?.name}`,
                serviceTypes.find((t) => t.id === selectedServiceTypeId)?.name && `Service Type: ${serviceTypes.find((t) => t.id === selectedServiceTypeId)?.name}`,
                baplServiceLocation && `Location: ${baplServiceLocation}`,
                baplSupervisorName && `Supervisor: ${baplSupervisorName}`,
                baplTechnicianName && `Technician: ${baplTechnicianName}`,
                baplManualJobNo && `Manual Job No.: ${baplManualJobNo}`,
              ].filter(Boolean).join(', ')}
            </p>
          )}
          {selectedJobTypeId && selectedServiceHeadId && selectedServiceTypeId && (
            <p className="muted" style={{ marginTop: -8 }}>This will also be created as a job card in BAPL DMS's own database.</p>
          )}

          {!createdJobCard && (
            <div className="field">
              <label>Photos (optional - captured now, uploaded once the job card is created)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: pendingPhotos.length > 0 ? 12 : 0 }}>
                <label className="btn btn-sm" style={{ cursor: capturingPhoto ? 'default' : 'pointer', opacity: capturingPhoto ? 0.6 : 1 }}>
                  {capturingPhoto ? 'Adding…' : '📷 Take / Upload Photo'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={capturingPhoto}
                    style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; addPendingPhoto(f) }}
                  />
                </label>
                {photoLocationNote && <span className="muted">{photoLocationNote}</span>}
              </div>
              {pendingPhotos.length > 0 && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {pendingPhotos.map((p) => (
                    <div key={p.id} style={{ width: 150 }}>
                      <img src={p.previewUrl} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                      <select
                        value={p.stage}
                        style={{ marginTop: 4, fontSize: 12, padding: '4px 6px' }}
                        onChange={(e) => setPendingPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, stage: e.target.value as PhotoStage } : x)))}
                      >
                        {(['CheckIn', 'Inspection', 'Repair', 'Qc', 'Delivery'] as PhotoStage[]).map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <input
                        value={p.caption}
                        placeholder="Caption (optional)"
                        style={{ marginTop: 4, fontSize: 12, padding: '4px 6px' }}
                        onChange={(e) => setPendingPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, caption: e.target.value } : x)))}
                      />
                      {p.latitude != null && p.longitude != null && (
                        <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>📍 {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</p>
                      )}
                      <button className="btn btn-sm" style={{ marginTop: 4, width: '100%' }} onClick={() => removePendingPhoto(p.id)}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="error-text">{error}</p>}

          {createdJobCard ? (
            <>
              {photoUploadWarning && <p className="muted">{photoUploadWarning}</p>}
              {baplSyncWarning && <p className="muted">{baplSyncWarning}</p>}
              <button className="btn btn-primary" onClick={() => navigate(`/jobcards/${createdJobCard.id}`)}>Continue to Job Card {createdJobCard.jobCardNumber}</button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" disabled={submitting} onClick={() => setStep(2)}>← Back</button>
              <button className="btn btn-primary" disabled={submitting} onClick={submit}>
                {submitting ? 'Creating...' : 'Create Job Card'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
