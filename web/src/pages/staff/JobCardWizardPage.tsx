import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type {
  BaplDealerResolveResult, BaplDmsComplaint, BaplDmsDealer, BaplDmsJobSource, BaplDmsJobType,
  BaplDmsServiceHead, BaplDmsServiceType, BaplDmsVehicleLookup, BaplDmsVehicleSuggestion, BaplDmsWorkshop,
  Customer, Dealer, JobCardPriority, JobCardSource, PhotoStage, ServiceType, Vehicle,
} from '../../types'
import { VEHICLE_MODELS, variantsForModel } from '../../data/vehicleCatalog'
import { buildJobCardPrintHtml } from '../../lib/jobCardPrintHtml'

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

/** "YYYY-MM-DDTHH:mm" in the browser's local time, for a datetime-local input's default value -
 * used so "Expected delivery" defaults to today rather than starting blank. */
function nowForDatetimeLocalInput(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
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
  const [customer, setCustomer] = useState<Customer | null>(null)
  // state/saleDate: added per Item 3/7 - state is stored on the customer (Customer.State - see
  // deploy/add-customer-state-column.sql for the manual production migration this needs);
  // saleDate has nowhere of its own to live on Customer, so it's carried forward and saved as the
  // vehicle's PurchaseDate at step 2 (see createVehicle) - the same field a BAPL DMS-sourced
  // saleDate already fills for an auto-fetched vehicle.
  const [newCustomer, setNewCustomer] = useState({ name: '', mobile: '', email: '', city: '', address: '', state: '', saleDate: '' })

  // "(Registered customer Details)" - by chassis no. / registration no. - auto-fetches everything
  // BAPL DMS knows about that vehicle (Controllers/BaplDmsController.cs's vehicle-lookup, ported
  // from BAPL DMS's own onChassisChange()/GetAllInspectedLotChassisAsync) and uses it to pre-fill
  // both the "register a new customer" fields below AND the vehicle step that follows -
  // baplVehicleHit is read again in step 2 for that. The old "search by mobile number or name"
  // field is commented out below per your request - chassis/reg no. search is the only lookup left.
  const [chassisOrRegQ, setChassisOrRegQ] = useState('')
  const [vehicleLookupLoading, setVehicleLookupLoading] = useState(false)
  const [vehicleLookupError, setVehicleLookupError] = useState<string | null>(null)
  const [baplVehicleHit, setBaplVehicleHit] = useState<BaplDmsVehicleLookup | null>(null)
  // Item 12a: a styled inline banner instead of a plain window.alert() for "This Vehicle not
  // sold" - a native browser alert can't be styled and blocks the page until dismissed.
  const [vehicleNotSoldNotice, setVehicleNotSoldNotice] = useState<string | null>(null)
  // "This chassis already has an open job card" - set from BaplDmsVehicleLookup.openJobCardNumber
  // (see that field's doc comment) the moment a chassis is selected, instead of only finding out
  // after filling in the whole wizard and hitting the final "Create Job Card" (which still has its
  // own hard block - JobCardsController.Create - as a backstop). Blocks applyVehicleHit entirely
  // (same pattern as vehicleNotSoldNotice above) so the chassis can't be used to pre-fill/proceed
  // until that other job card is closed.
  const [openJobCardNotice, setOpenJobCardNotice] = useState<string | null>(null)
  // Item 2: live search-as-you-type suggestions under the chassis/reg-no box (e.g. typing "P6"
  // lists every matching ChassisDetails row so the user can pick one, instead of only supporting
  // Enter/Search for a single exact match). Debounced so it doesn't fire a request per keystroke;
  // cleared as soon as one is picked or the box is emptied.
  const [vehicleSuggestions, setVehicleSuggestions] = useState<BaplDmsVehicleSuggestion[]>([])
  const [showVehicleSuggestions, setShowVehicleSuggestions] = useState(false)
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
  // Scopes chassis/reg-no search to the dealer this job card is being created for - the wizard's
  // own dealer picker (Corporate/System Admin choosing which dealer/workshop) when one is set,
  // falling back to the signed-in dealer's own BAPL DMS code otherwise. Left undefined (unscoped,
  // matching the backend's existing "search everything" default) only when neither is known yet -
  // e.g. a brand new dealer login whose BaplDmsDealerCode hasn't been resolved by any lookup yet.
  const vehicleSearchDealerCode = dealers.find((d) => d.id === effectiveDealerId)?.baplDmsDealerCode ?? profile?.dealerBaplDmsCode ?? undefined
  useEffect(() => {
    if (!showVehicleSuggestions || chassisOrRegQ.trim().length < 2) { setVehicleSuggestions([]); return }
    const handle = setTimeout(() => {
      staffApi.get<BaplDmsVehicleSuggestion[]>('/api/bapl-dms/vehicle-suggestions', { params: { q: chassisOrRegQ.trim(), dealerCode: vehicleSearchDealerCode } })
        .then(({ data }) => setVehicleSuggestions(data))
        .catch(() => setVehicleSuggestions([]))
    }, 300)
    return () => clearTimeout(handle)
  }, [chassisOrRegQ, showVehicleSuggestions, vehicleSearchDealerCode])
  // Fields pre-filled from a BAPL DMS auto-fetch are locked by default (disabled inputs) so they
  // aren't accidentally overwritten - each section has its own "Edit anyway" escape hatch for the
  // rare case the fetched data is wrong. Resets back to locked whenever a fresh hit comes in.
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
      // Item 3: ChassisDetails.SaleDate is what gated this fetch in the first place (a null one
      // never reaches here - see the alert above) - show it back in the Sale Date field instead
      // of leaving it blank for the user to re-type. BAPL DMS returns a full datetime (e.g.
      // "2026-07-17T15:47:40.203"); the <input type="date"> only wants the date part.
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
      const { data } = await staffApi.get<BaplDmsVehicleLookup>('/api/bapl-dms/vehicle-lookup', { params: { value, dealerCode: vehicleSearchDealerCode } })
      // This chassis already has an open job card somewhere (JobCardScanner locally, or BAPL DMS -
      // see openJobCardNumber's doc comment) - refuse to auto-fill/proceed with it at all, and say
      // exactly where the open job card is so staff know where to go close it first.
      if (data.openJobCardNumber) {
        const where = data.openJobCardSource === 'bapl-dms' ? 'in BAPL DMS' : 'here'
        const status = data.openJobCardStatus ? ` (status: ${data.openJobCardStatus})` : ''
        setOpenJobCardNotice(`This chassis already has an open job card ${where}: ${data.openJobCardNumber}${status}. It must be closed before this chassis can be used for a new job card.`)
        return
      }
      // Item 3: a hit with no SaleDate on file isn't auto-fetched - alert and leave the customer/
      // vehicle fields for manual entry instead of pre-filling from an incomplete BAPL DMS record.
      if (!data.saleDate) {
        // Item 12a/12b: shorter, friendlier wording - "This Vehicle not sold" instead of the
        // internal-sounding "Sale date not defined", shown as a styled banner instead of a native
        // window.alert() (which can't be styled and blocks the page) - and a shorter inline error.
        setVehicleNotSoldNotice('This Vehicle not sold')
        setVehicleLookupError(`"${value}" was found in DMS.`)
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
      const { data } = await staffApi.get<BaplDmsVehicleLookup>('/api/bapl-dms/vehicle-lookup', { params: { value } })
      setGlobalHit(data)
    } catch {
      setGlobalSearchNotFound(true)
    } finally {
      setGlobalSearchLoading(false)
    }
  }

  const applyGlobalHit = () => {
    if (!globalHit) return
    // Same open-job-card block as the dealer-scoped lookup above - a cross-dealer hit can still
    // belong to a chassis with an open job card (at this dealer or elsewhere).
    if (globalHit.openJobCardNumber) {
      const where = globalHit.openJobCardSource === 'bapl-dms' ? 'in BAPL DMS' : 'here'
      const status = globalHit.openJobCardStatus ? ` (status: ${globalHit.openJobCardStatus})` : ''
      setOpenJobCardNotice(`This chassis already has an open job card ${where}: ${globalHit.openJobCardNumber}${status}. It must be closed before this chassis can be used for a new job card.`)
      setShowGlobalSearchOffer(false)
      setGlobalHit(null)
      return
    }
    applyVehicleHit(globalHit)
    setVehicleLookupError(null)
    setShowGlobalSearchOffer(false)
    setGlobalHit(null)
  }

  // Step 2: vehicle
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [newVehicle, setNewVehicle] = useState({ model: '', variant: '', color: '', regNo: '', vin: '', odometer: 0 })
  // Model -> Variant is a dependent dropdown (see data/vehicleCatalog.ts): picking a model
  // narrows the Variant list down to just that model's variants, and changing the model clears
  // whatever variant was previously selected so an invalid model/variant pairing can't be sent.
  // Only used for a fully manual vehicle (no BAPL DMS hit) - see usingBaplVehicle below.
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const availableVariants = variantsForModel(selectedModelId)
  // True whenever a BAPL DMS chassis/reg-no hit exists - whether its fields are still locked or
  // "Edit anyway" has unlocked them. BAPL DMS doesn't split Model/Variant into two fields the way
  // JobCardScanner's own catalog does (it's one combined ItemName), so once a hit exists, Model is
  // always a plain text field and Variant is never shown again, even after "Edit anyway" - only
  // Model/Reg No/VIN reappear as editable.
  const usingBaplVehicle = !!baplVehicleHit
  const previousOdometer = baplVehicleHit?.vehiclePrevKms ?? null
  const odometerValid = newVehicle.odometer > 0 && (previousOdometer == null || newVehicle.odometer > previousOdometer)

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
  const [batteryLevel, setBatteryLevel] = useState<number | ''>('')
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState(nowForDatetimeLocalInput)
  const [consentNotes, setConsentNotes] = useState('')
  // Populated only from the BAPL DMS ComplaintMaster dropdown now (see addComplaintFromDropdown) -
  // the old free-text "+ Add complaint" flow is gone per your request, so this never starts with a
  // blank placeholder entry any more.
  const [complaints, setComplaints] = useState<string[]>([])
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

  // Every field in the "Job Card fields" (BAPL DMS) panel is now required, per your request -
  // "Continue to Review" stays disabled until all of them are filled in, so a job card can no
  // longer reach Review with a half-filled BAPL DMS section.
  // Manual Job No. is no longer required (Item 5) - every other BAPL DMS field still is.
  const serviceDetailsValid = !!(
    selectedJobTypeId && selectedServiceHeadId && selectedServiceTypeId &&
    selectedWorkshopLocCode && baplSupervisorName.trim() && baplTechnicianName.trim() &&
    selectedJobSourceId
  )

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
    // Clear whatever Service Location was previously selected (manually or auto-defaulted) any
    // time the dealer itself changes - a workshop code from one dealer's W-series is meaningless
    // once effectiveDealerId points at a different dealer (only relevant for Corporate/System
    // Admin, who can switch dealers via the picker above; for a dealer-scoped login this only
    // ever runs once, on mount). Without this reset, the "default to W1" effect below would never
    // re-fire on a dealer switch, since it only defaults when the field is still empty.
    setSelectedWorkshopLocCode('')
    setBaplServiceLocation('')
    if (!effectiveDealerId) { setWorkshops([]); return }
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: effectiveDealerId } })
      .then(({ data }) => setWorkshops(data))
      .catch(() => setWorkshops([]))
  }, [effectiveDealerId])

  // Default the Service Location to this dealer's own W-series, lowest number first (W1 if it
  // has one, else W2, and so on) - per your request, so a Service Location is already picked as
  // soon as the dealer/workshop list resolves, instead of starting blank until step 2. Only fires
  // when nothing is selected yet, so it never overrides a manual pick (onWorkshopChange below) or
  // - since that effect runs after this one and always re-sets on a match - the more specific
  // auto-fill from a chassis/reg-no BAPL DMS hit right below.
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

  // Pre-select the Service Location once BAPL DMS told us which workshop this chassis is
  // registered against (ChassisDetails.LocationCode via the chassis/reg-no lookup), once that
  // dealer's workshop list has actually loaded. Runs after the W1-default effect above and always
  // re-sets on a match, so a specific chassis-linked workshop still wins over the plain default.
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

  // Dropdown-only now (multi-select by repeated Add clicks) - the old manual "+ Add complaint"
  // free-text flow is gone per your request.
  const addComplaintFromDropdown = () => {
    if (!selectedComplaintId) return
    const picked = complaintOptions.find((c) => String(c.id) === selectedComplaintId)
    if (!picked) return
    if (!complaints.includes(picked.name)) setComplaints((prev) => [...prev, picked.name])
    setSelectedComplaintId('')
  }
  const removeComplaint = (name: string) => setComplaints((prev) => prev.filter((c) => c !== name))

  // Photos captured BEFORE the job card exists (Review & Create step, ahead of the "Create Job
  // Card" button) - kept as in-memory File objects with a local object-URL preview until the job
  // card is actually created, since POST /api/jobcards/{id}/photos/upload needs a real job card id
  // that doesn't exist yet at this point in the wizard. submit() below uploads each one right after
  // creation succeeds. Now REQUIRED (at least one) per your request - previously optional.
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

  // 1 GB per-photo cap (raised from an implicit "whatever the backend allowed" - see
  // JobCardsController.UploadPhoto's [RequestSizeLimit(1_000_000_000)]) per your request.
  const MAX_PHOTO_BYTES = 1_000_000_000

  const addPendingPhoto = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoLocationNote(null)
      setError(`"${file.name}" is larger than 1 GB - pick a smaller file.`)
      return
    }
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
      // BAPL DMS's own sale date wins when there's an auto-fetched hit; otherwise fall back to
      // whatever was manually typed into the "Registered Customer" section's Sale Date field
      // (Item 3) - both ultimately save into the same Vehicle.PurchaseDate column.
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
      const { data } = await staffApi.post('/api/jobcards', {
        dealerId: effectiveDealerId,
        customerId: customer.id,
        vehicleId: vehicle.id,
        serviceType,
        source,
        priority,
        odometerAtCheckIn: vehicle.odometer,
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
      // Every successful creation stops here now, not just the warning cases above - the Print
      // button lives in the createdJobCard block below, so jumping straight to navigate() (the
      // old behavior) skipped that step entirely and the print button never had a chance to show.
      // The user now always lands on Print + "Continue to Job Card" and picks when to move on.
      pendingPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
      setPendingPhotos([])
      setCreatedJobCard({ id: data.id, jobCardNumber: data.jobCardNumber })
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create job card.')
    } finally {
      setSubmitting(false)
    }
  }

  const printPreview = () => {
    const win = window.open('', '_blank', 'width=900,height=650')
    if (!win) { setError('Please allow popups to print the job card.'); return }
    const html = buildJobCardPrintHtml({
      dealerName: dealers.find((d) => d.id === effectiveDealerId)?.name ?? profile?.dealerName,
      dealerCode: dealers.find((d) => d.id === effectiveDealerId)?.code ?? baplVehicleHit?.dealerCode,
      location: baplServiceLocation,
      jobinDate: new Date().toISOString(),
      jobtype: baplJobType,
      jobsource: jobSources.find((s) => s.id === selectedJobSourceId)?.name,
      serviceHead: serviceHeads.find((h) => h.id === selectedServiceHeadId)?.name,
      serviceType: serviceTypes.find((t) => t.id === selectedServiceTypeId)?.name,
      estdelDate: expectedDeliveryAt,
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
      // Sourced straight from the chassis/reg-no lookup (baplVehicleHit), not the saved Vehicle -
      // Battery Make/Chemical/Capacity aren't columns on JobCardScanner's own Vehicle table, so
      // this reads them from BAPL DMS's ChassisBatteryDetails response still held in wizard state.
      batteryChemical: baplVehicleHit?.batteryChemical,
      batteryCapacity: baplVehicleHit?.batteryCapacity,
      batteryMake: baplVehicleHit?.batteryMake,
      complaints: complaints.filter((c) => c.trim()),
    })
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
    win.onload = () => win.print()
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
              <label>Dealer WorkShop Location</label>
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
                  placeholder="Search Dealer WorkShop Location (BAPL DMS) by name or code…"
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
          <h3>(Registered customer Details)</h3>
          {/* "Search by mobile number or name" commented out per your request - chassis/reg no.
             search (below) is now the only way to look up a customer here. */}
          {/* <div className="field">
            <label>Search by mobile number or name</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="98765xxxxx" />
              <button className="btn" onClick={searchCustomers}>Search</button>
            </div>
          </div> */}
          <div className="field" style={{ position: 'relative' }}>
            <label>Search by chassis no. / registration no.</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={chassisOrRegQ}
                onChange={(e) => { setChassisOrRegQ(e.target.value); setShowVehicleSuggestions(true) }}
                onFocus={() => setShowVehicleSuggestions(true)}
                onBlur={() => setTimeout(() => setShowVehicleSuggestions(false), 150)}
                onKeyDown={(e) => e.key === 'Enter' && lookupByChassisOrReg()}
                placeholder="Chassis no. or registration no. (e.g. P6)"
                autoComplete="off"
              />
              <button className="btn" onClick={() => lookupByChassisOrReg()} disabled={vehicleLookupLoading || !chassisOrRegQ.trim()}>
                {vehicleLookupLoading ? 'Searching…' : 'Search'}
              </button>
            </div>
            {showVehicleSuggestions && vehicleSuggestions.length > 0 && (
              <ul style={{
                position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 90, marginTop: 2,
                background: 'var(--card-bg, #fff)', border: '1px solid var(--border)', borderRadius: 8,
                maxHeight: 220, overflowY: 'auto', listStyle: 'none', padding: 4, boxShadow: '0 6px 18px rgba(0,0,0,.12)',
              }}>
                {vehicleSuggestions.map((s) => (
                  <li key={s.chassisNo}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '6px 8px' }}
                      onMouseDown={(e) => { e.preventDefault(); setChassisOrRegQ(s.chassisNo); lookupByChassisOrReg(s.chassisNo) }}
                    >
                      <strong>{s.chassisNo}</strong>{s.regNo ? ` · ${s.regNo}` : ''}{s.modelName ? ` — ${s.modelName}` : ''}
                      {/* Item (a): show Sale Date on every suggestion row, not just after a full
                         Search hit - lets the user tell sold vehicles apart from unsold ones before
                         picking one. */}
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted, #6b7280)' }}>
                        Sale date: {s.saleDate ? new Date(s.saleDate).toLocaleDateString() : 'not sold'}
                      </span>
                    </button>
                  </li>
                ))}
                {/* /api/bapl-dms/vehicle-suggestions caps results (100 by default - see
                   BaplDmsController.VehicleSuggestions' doc comment on why this exists and isn't
                   just "show everything"). A dealer whose stock shares one chassis-number prefix
                   can have more matches than that for a short query - say so, instead of letting a
                   chassis that's the 101st alphabetical match silently look like it doesn't exist. */}
                {vehicleSuggestions.length >= 100 && (
                  <li style={{ padding: '6px 8px', fontSize: 12, color: 'var(--muted, #6b7280)' }}>
                    Showing the first {vehicleSuggestions.length} matches - keep typing more of the chassis/reg no. to narrow down.
                  </li>
                )}
              </ul>
            )}
            {vehicleNotSoldNotice && (
              <p
                role="alert"
                style={{
                  marginTop: 8, padding: '10px 14px', borderRadius: 8,
                  background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e',
                  fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                ⚠️ {vehicleNotSoldNotice}
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#92400e' }}
                  onClick={() => setVehicleNotSoldNotice(null)}
                >
                  Dismiss
                </button>
              </p>
            )}
            {openJobCardNotice && (
              <p
                role="alert"
                style={{
                  marginTop: 8, padding: '10px 14px', borderRadius: 8,
                  background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                  fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                🚫 {openJobCardNotice}
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#991b1b' }}
                  onClick={() => setOpenJobCardNotice(null)}
                >
                  Dismiss
                </button>
              </p>
            )}
            {vehicleLookupError && <p className="error-text">{vehicleLookupError}</p>}
            {showGlobalSearchOffer && !globalHit && (
              <p
                role="alert"
                style={{
                  marginTop: 8, padding: '10px 14px', borderRadius: 8,
                  background: '#eef6ff', border: '1px solid #bfdcff', color: '#1e3a5f',
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}
              >
                🔎 Not found for this dealer.{globalSearchNotFound ? ' Not found anywhere in BAPL DMS either.' : ' Search BAPL DMS across every dealer?'}
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  style={{ marginLeft: 'auto' }}
                  disabled={globalSearchLoading}
                  onClick={searchGlobalChassis}
                >
                  {globalSearchLoading ? 'Searching…' : 'Search all dealers'}
                </button>
              </p>
            )}
            {globalHit && (
              <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: '#eef6ff', border: '1px solid #bfdcff' }}>
                <p style={{ fontWeight: 600, color: '#1e3a5f', margin: 0 }}>
                  Found in BAPL DMS{globalHit.dealerCode && globalHit.dealerCode !== vehicleSearchDealerCode ? ` — registered to dealer ${globalHit.dealerCode}, not this workshop` : ''}
                </p>
                <p className="muted" style={{ margin: '4px 0 8px' }}>
                  {globalHit.customerName || 'Unknown customer'}{globalHit.customerMobile ? ` (${globalHit.customerMobile})` : ''} · {globalHit.modelName || 'Model unknown'}
                  {globalHit.registerNo ? ` · reg no. ${globalHit.registerNo}` : ''}
                  {globalHit.saleDate ? ` · sold ${new Date(globalHit.saleDate).toLocaleDateString()}` : ' · not yet sold'}
                </p>
                <button type="button" className="btn btn-sm btn-primary" onClick={applyGlobalHit}>Use this vehicle</button>
              </div>
            )}
            {baplVehicleHit && (
              <p className="muted" style={{ marginTop: 4 }}>
                Customer Details : customer-{baplVehicleHit.customerName || 'Unknown customer'}
                {baplVehicleHit.customerMobile ? ` (${baplVehicleHit.customerMobile})` : ''} - model- {baplVehicleHit.modelName || 'Model unknown'}
                {baplVehicleHit.registerNo ? `, reg no. ${baplVehicleHit.registerNo}` : ''}
                {baplVehicleHit.saleDate ? `, sale date ${new Date(baplVehicleHit.saleDate).toLocaleDateString()}.` : '.'}
              </p>
            )}
          </div>
          <h3 style={{ marginTop: 24 }}>Registered Customer</h3>
          {customerFieldsLocked && (
            <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
              🔒 Name, Mobile, Email, City and Address were auto-fetched from BAPL DMS and are locked to prevent accidental changes.{' '}
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
            <div className="field"><label>Email</label><input value={newCustomer.email} disabled={customerFieldsLocked} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} /></div>
            <div className="field"><label>City</label><input value={newCustomer.city} disabled={customerFieldsLocked} onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })} /></div>
            <div className="field"><label>Address</label><input value={newCustomer.address} disabled={customerFieldsLocked} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} /></div>
            <div className="field"><label>State</label><input value={newCustomer.state} disabled={customerFieldsLocked} onChange={(e) => setNewCustomer({ ...newCustomer, state: e.target.value })} /></div>
            <div className="field"><label>Sale Date</label><input type="date" value={newCustomer.saleDate} disabled={customerFieldsLocked} onChange={(e) => setNewCustomer({ ...newCustomer, saleDate: e.target.value })} /></div>
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
                  DMS
                </span>
                {baplVehicleHit.vehiclePrevKms != null && (
                  <span style={{ fontWeight: 700, fontSize: 15 }}>
                    Previous Km: {baplVehicleHit.vehiclePrevKms}
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#1e3a5f' }}>
                Battery No.: <strong>{baplVehicleHit.batteryNumber || '—'}</strong>, Motor no.: <strong>{baplVehicleHit.motorNo || '—'}</strong>,
                {' '}Controller no.: <strong>{baplVehicleHit.controllerNo || '—'}</strong>, Charger no.: <strong>{baplVehicleHit.chargerNumber || '—'}</strong>.
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
                    <td><button className="btn btn-sm btn-primary" onClick={() => { setVehicle(v); setStep(2) }}>Select</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {vehicleFieldsLocked && (
            <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
              🔒 Model, Reg No and VIN were auto-fetched from BAPL DMS and are locked to prevent accidental changes.{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setUnlockVehicleFields(true) }}>Edit anyway</a>
            </p>
          )}
          <div className="form-row">
            <div className="field">
              <label>Model{usingBaplVehicle ? '' : ' & Variant'}</label>
              {usingBaplVehicle ? (
                // BAPL DMS doesn't split Model/Variant into two fields (see the pre-fill effect
                // above) - a plain text input shows the combined name it sent back (editable once
                // "Edit anyway" unlocks it), instead of a <select> that would otherwise appear empty
                // (nothing in the catalog matches a BAPL ItemName one-for-one). The Variant dropdown
                // never reappears here, even after "Edit anyway" - only Model/Reg No/VIN do.
                <input value={newVehicle.model} disabled={vehicleFieldsLocked} onChange={(e) => setNewVehicle({ ...newVehicle, model: e.target.value })} />
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
            {!usingBaplVehicle && (
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
            <div className="field">
              <label>Odometer (km) *{previousOdometer != null ? ` (Previous: ${previousOdometer} km)` : ''}</label>
              <input type="number" value={newVehicle.odometer} onChange={(e) => setNewVehicle({ ...newVehicle, odometer: Number(e.target.value) })} />
              {previousOdometer != null && newVehicle.odometer > 0 && newVehicle.odometer <= previousOdometer && (
                <p className="error-text" style={{ margin: '4px 0 0', fontSize: 12 }}>Must be greater than the previous odometer reading ({previousOdometer} km).</p>
              )}
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(0)}>← Back</button>
            <button className="btn btn-primary" disabled={!newVehicle.model || !effectiveDealerId || !odometerValid} onClick={createVehicle}>Create & Continue</button>
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
                DMS
              </span>
              <strong style={{ fontSize: 14 }}>Job Card fields</strong>
            </div>
            {baplMastersError && <p className="error-text" style={{ marginTop: 0 }}>{baplMastersError}</p>}
            <div className="form-row">
              <div className="field">
                <label>Job Type *</label>
                <select value={selectedJobTypeId ?? ''} onChange={(e) => onJobTypeChange(e.target.value)}>
                  <option value="">Select job type…</option>
                  {jobTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Service Head *</label>
                <select value={selectedServiceHeadId ?? ''} disabled={!selectedJobTypeId} onChange={(e) => onServiceHeadChange(e.target.value)}>
                  <option value="">{selectedJobTypeId ? 'Select service head…' : 'Select a job type first'}</option>
                  {serviceHeads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Service Type *</label>
                <select value={selectedServiceTypeId ?? ''} disabled={!selectedServiceHeadId} onChange={(e) => setSelectedServiceTypeId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{selectedServiceHeadId ? 'Select service type…' : 'Select a service head first'}</option>
                  {serviceTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Priority *</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value as JobCardPriority)}>
                  {(['Normal', 'High', 'Urgent'] as JobCardPriority[]).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <div className="field">
                <label>Service Location (workshop) *</label>
                <select value={selectedWorkshopLocCode} disabled={!effectiveDealerId} onChange={(e) => onWorkshopChange(e.target.value)}>
                  <option value="">{workshops.length ? 'Select workshop…' : 'No workshops found for this dealer yet'}</option>
                  {workshops.map((w) => <option key={w.locCode} value={w.locCode}>{w.locName} ({w.locCode})</option>)}
                </select>
              </div>
              <div className="field">
                <label>Supervisor *</label>
                <input value={baplSupervisorName} onChange={(e) => setBaplSupervisorName(e.target.value)} placeholder="Supervisor name" />
              </div>
              <div className="field">
                <label>Technician *</label>
                <input value={baplTechnicianName} onChange={(e) => setBaplTechnicianName(e.target.value)} placeholder="Technician name" />
              </div>
              <div className="field">
                <label>Manual Job No.</label>
                <input value={baplManualJobNo} onChange={(e) => setBaplManualJobNo(e.target.value)} placeholder="e.g. 0" />
              </div>
              <div className="field">
                <label>Source *</label>
                <select value={selectedJobSourceId ?? ''} onChange={(e) => onJobSourceChange(e.target.value)}>
                  <option value="">Select source…</option>
                  {jobSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
              All fields above are required - they are what let this job card also be created directly inside BAPL DMS's own database.
            </p>
          </div>

          <div className="form-row">
            <div className="field"><label>Battery level at check-in (%)</label><input type="number" min={0} max={100} value={batteryLevel} onChange={(e) => setBatteryLevel(e.target.value === '' ? '' : Number(e.target.value))} /></div>
            <div className="field"><label>Expected delivery</label><input type="datetime-local" value={expectedDeliveryAt} onChange={(e) => setExpectedDeliveryAt(e.target.value)} /></div>
          </div>

          <div className="field">
            <label>Customer complaints (Customer Voice)</label>
            {/* Manual "+ Add complaint" free-text flow removed per your request - the BAPL DMS
               ComplaintMaster dropdown below is now the only way to add one, and it supports adding
               several (pick, Add, pick another, Add again). */}
            {complaintOptions.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={selectedComplaintId} onChange={(e) => setSelectedComplaintId(e.target.value)}>
                  <option value="">Pick from DMS's complaint list…</option>
                  {complaintOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button
                  className="btn btn-sm"
                  disabled={!selectedComplaintId}
                  onClick={addComplaintFromDropdown}
                  style={{ background: '#16a34a', color: '#fff', border: '1px solid #16a34a', fontWeight: 600 }}
                >
                  + Add
                </button>
              </div>
            )}
            {complaints.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {complaints.map((c) => (
                  <li key={c} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    background: '#f4f6f8', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px',
                  }}>
                    <span>{c}</span>
                    <button
                      className="btn btn-sm"
                      style={{ background: 'transparent', color: '#64748b', border: '1px solid var(--border)' }}
                      onClick={() => removeComplaint(c)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>No complaints added yet.</p>
            )}
          </div>

          <div className="field">
            <label>(Customer Voice) notes</label>
            <textarea rows={3} value={consentNotes} onChange={(e) => setConsentNotes(e.target.value)} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-primary" disabled={!serviceDetailsValid} onClick={() => setStep(3)}>Continue to Review</button>
          </div>
          {!serviceDetailsValid && (
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Fill in every field marked * in "Job Card fields" above to continue.</p>
          )}
        </div>
      )}

      {step === 3 && customer && vehicle && (
        <div className="card">
          <h3>Review</h3>
          <p style={{ marginBottom: 2 }}>
            <strong>Customer</strong> — <strong>Name:</strong> {customer.name} &nbsp; <strong>Mobile:</strong> {customer.mobile}
            {' '}&nbsp; <strong>State:</strong> {customer.state || '-'} &nbsp; <strong>City:</strong> {customer.city || '-'}
          </p>
          <p style={{ marginBottom: 2 }}>
            <strong>Vehicle</strong> — <strong>Model:</strong> {vehicle.model} {vehicle.variant} &nbsp; <strong>Reg No.:</strong> {vehicle.regNo || '-'}
            {' '}&nbsp; <strong>KM:</strong> {vehicle.odometer} &nbsp; <strong>Job No.:</strong> {baplManualJobNo || '-'}
          </p>
          <p><strong>Service:</strong> {baplJobType || serviceType} via {jobSources.find((s) => s.id === selectedJobSourceId)?.name || source}, priority {priority}</p>
          <p><strong>Complaints:</strong> {complaints.join('; ') || 'None recorded'}</p>
          {(baplJobType || baplServiceLocation || baplSupervisorName || baplTechnicianName || baplManualJobNo) && (
            <p>
              <strong>DMS fields:</strong>{' '}
              {baplJobType && <><strong>Job Type:</strong> {baplJobType}. </>}
              {serviceHeads.find((h) => h.id === selectedServiceHeadId)?.name && `Service Head: ${serviceHeads.find((h) => h.id === selectedServiceHeadId)?.name}. `}
              {serviceTypes.find((t) => t.id === selectedServiceTypeId)?.name && `Service Type: ${serviceTypes.find((t) => t.id === selectedServiceTypeId)?.name}. `}
              {baplServiceLocation && `Location: ${baplServiceLocation}. `}
              {baplSupervisorName && `Supervisor: ${baplSupervisorName}. `}
              {baplTechnicianName && `Technician: ${baplTechnicianName}. `}
              {baplManualJobNo && `Manual Job No.: ${baplManualJobNo}.`}
            </p>
          )}

          {!createdJobCard && (
            <div className="field">
              <label>Photos (required - captured now, uploaded once the job card is created; up to 1 GB each)</label>
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
              {pendingPhotos.length === 0 && <p className="error-text" style={{ margin: 0, fontSize: 12 }}>At least one photo is required.</p>}
              {pendingPhotos.length > 0 && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {pendingPhotos.map((p) => (
                    <div key={p.id} style={{ width: 150 }}>
                      <img src={p.previewUrl} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                      {/* Stage dropdown and lat/long location are captured (stage defaults to
                         'CheckIn') but no longer shown here per Item 7 - they were clutter on a
                         step that's just collecting photos before the job card exists. */}
                      <input
                        value={p.caption}
                        placeholder="Caption (optional)"
                        style={{ marginTop: 6, fontSize: 12, padding: '4px 6px' }}
                        onChange={(e) => setPendingPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, caption: e.target.value } : x)))}
                      />
                      <button className="btn btn-sm" style={{ marginTop: 6, width: '100%' }} onClick={() => removePendingPhoto(p.id)}>Remove</button>
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
              {/* Print moved here from the pre-creation button row per Item 7 - printing only
                 makes sense once the job card actually exists. */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={printPreview} style={{ border: '1px solid var(--border)' }}>🖨️ Print</button>
                <button
                  className="btn btn-primary"
                  // Item 7: land straight on the Workflow Timeline section of the job card, not
                  // just the top of the page - see the #workflow-timeline anchor on JobCardDetailPage.
                  onClick={() => navigate(`/jobcards/${createdJobCard.id}#workflow-timeline`)}
                >
                  Continue to Job Card {createdJobCard.jobCardNumber}
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" disabled={submitting} style={{ border: '1px solid var(--border)' }} onClick={() => setStep(2)}>← Back</button>
              <button className="btn btn-primary" disabled={submitting || pendingPhotos.length === 0} onClick={submit}>
                {submitting ? 'Creating...' : 'Create Job Card'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
