// web\src\pages\staff\JobCardWizardPage.tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type {
  BaplDealerResolveResult, BaplDmsDealer, BaplDmsVehicleLookup, BaplDmsVehicleSuggestion, BaplDmsWorkshop,
  Customer, Dealer, JobCardSource, PhotoStage, ServiceType, Vehicle,
} from '../../types'
import { VEHICLE_MODELS, variantsForModel } from '../../data/vehicleCatalog'
import { JOB_SOURCES, SERVICE_TYPES } from '../../data/serviceCatalog'
import { buildJobCardPrintHtml } from '../../lib/jobCardPrintHtml'

const STEPS = ['Customer', 'Vehicle', 'Service Details', 'Review & Create']

// SECTION 169 (2026-09-30) "bind this 3 dropdown dependancy from master" - Job Type/Service Head/
// Priority are no longer read from the hardcoded web/src/data/serviceCatalog.ts (JOB_TYPES/
// SERVICE_HEADS/serviceHeadsForJobType, and the old independent PRIORITY_OPTIONS fixed 3-item
// dropdown below) - all three now come from GET /api/service-menu-master, a single flat table of
// (JobTypeId/Name, ServiceHeadId/Name, PriorityValue, PriorityLabel, SortOrder) rows maintained on
// the new Service Menu Master admin page (SECTION 163/166). See ServiceMenuMaster.cs's class doc
// comment for the full reasoning and the confirmed PriorityValue/PriorityLabel field-shape
// decision this relies on: PriorityLabel (e.g. "Normal"/"High"/"Urgent") is what gets POSTED as
// this page's own `priority` state/POST /api/jobcards field (must match JobCardPriority's real
// enum names), while PriorityValue (e.g. "1"/"2"/"3") is only the short code shown in the
// dropdown - exactly mirroring the old PRIORITY_OPTIONS tuple's [posted value, displayed label]
// shape, just sourced from the master table instead of a fixed array. COMPLAINTS is similarly
// replaced by GET /api/complaint-master (see the Complaint button grid further down).
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
/** First-seen-wins de-dup, preserving whatever order `items` is already sorted in - used to turn
 * the flat ServiceMenuRow list into the three cascading dropdowns' distinct option sets. */
function dedupeBy<T, K>(items: T[], keyFn: (item: T) => K): T[] {
  const seen = new Set<K>()
  const out: T[] = []
  for (const item of items) {
    const k = keyFn(item)
    if (!seen.has(k)) { seen.add(k); out.push(item) }
  }
  return out
}

/** Red "*" marker for required-field labels (2026-09-03 - "all required feild are red star"),
 * used everywhere a label needs one instead of a plain " *" that just inherited the label's own
 * text color (which read as just as easy to miss as no marker at all). */
function Req() {
  return <span style={{ color: '#dc2626' }}> *</span>
}

// JobCardScanner's own ServiceType enum is still required internally (dashboards, filters, the
// Status Badge, ...) but showing it as its own picker next to the Job Type dropdown was pure
// duplication - this best-effort mapping derives JobCardScanner's own value from whichever Job
// Type was actually picked, so only one "what kind of service is this" field is shown to the
// user; there's no clean 1:1 correspondence between the free-form Job Type catalog and
// JobCardScanner's fixed enum, so treat this as "close enough for internal reporting", not an
// authoritative translation.
// 2026-09-25: JOB_TYPES was replaced (Accidental/Major/Minor/Running Repair - see
// serviceCatalog.ts) - only "accidental" still has a confirmed matching ServiceType enum member
// (AccidentRepair). Major/Minor/Running Repair fall through to the same 'PaidService' default
// every previously-unmatched name already used - I don't have a confirmed correct ServiceType enum
// value for these three, so I'm not guessing one; tell me the right mapping if 'PaidService' isn't
// accurate for internal reporting.
function mapBaplJobTypeToServiceType(baplJobTypeName: string): ServiceType {
  const n = baplJobTypeName.trim().toLowerCase()
  if (n === 'accidental') return 'AccidentRepair'
  return 'PaidService'
}

const IST_TIME_ZONE = 'Asia/Kolkata'
const IST_OFFSET_MINUTES = 330 // UTC+05:30

/** "YYYY-MM-DDTHH:mm" for a datetime-local input's default value - used so "Expected delivery"
 * defaults to today rather than starting blank. Always real IST (UTC+05:30) time, not whatever
 * timezone the browser happens to be set to - per explicit request "Current time in IST
 * (UTC+05:30) use everywhere on ui". A datetime-local input carries no timezone info of its own
 * (it's just a wall-clock string), so shifting the underlying instant by exactly +5:30 before
 * slicing off the ISO string's own UTC marker is the only way to guarantee this always shows the
 * actual IST time, regardless of the browser/OS's configured zone - previously this read
 * `d.getTimezoneOffset()`, which only produced IST if the browser itself happened to be set to
 * IST already. Mirrors the same +330-minute convention already used server-side
 * (EstimatePdfService) for "show actual IST time". */
function nowForDatetimeLocalInput(): string {
  return new Date(Date.now() + IST_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 16)
}

/** A date (e.g. a vehicle's DMS sale date) in real IST, not the browser's own timezone -
 * same reasoning as nowForDatetimeLocalInput above. */
function formatISTDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: IST_TIME_ZONE })
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
    // Only dealers/workshops already known to DMS (a resolved BaplDmsDealerCode) are shown
    // here - a dealer imported only from the BAPL ERP warehouse (BaplDealerService's bulk import,
    // a different data source entirely) has no DMS job card history/master data behind it, so
    // showing it in this picker would silently break the chassis lookup, Service Location dropdown,
    // and the DMS write-back further down this wizard. Not in the list? Search DMS below.
    staffApi.get<Dealer[]>('/api/dealers')
      .then(({ data }) => setDealers(data.filter((d) => !!d.baplDmsDealerCode)))
      .catch(() => setDealers([]))
  }, [needsDealerPicker])

  // Live search against DMS's own DealerMaster (Controllers/BaplDmsController.cs), for staff
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
      setDealerSearchError(msg ? `DMS error: ${msg}` : 'Could not reach DMS right now - try the dropdown above, or again shortly.')
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
      setDealerSearchError(msg ? `DMS error: ${msg}` : `Could not add "${row.dealerName}" from DMS - try again shortly.`)
    } finally {
      setResolvingDealer(false)
    }
  }

  // Step 1: customer
  const [customer, setCustomer] = useState<Customer | null>(null)
  // state/saleDate: added per Item 3/7 - state is stored on the customer (Customer.State - see
  // deploy/add-customer-state-column.sql for the manual production migration this needs);
  // saleDate has nowhere of its own to live on Customer, so it's carried forward and saved as the
  // vehicle's PurchaseDate at step 2 (see createVehicle) - the same field a DMS-sourced
  // saleDate already fills for an auto-fetched vehicle.
  const [newCustomer, setNewCustomer] = useState({ name: '', mobile: '', email: '', city: '', address: '', state: '', saleDate: '' })

  // "(Registered customer Details)" - by chassis no. / registration no. - auto-fetches everything
  // DMS knows about that vehicle (Controllers/BaplDmsController.cs's vehicle-lookup, ported
  // from DMS's own onChassisChange()/GetAllInspectedLotChassisAsync) and uses it to pre-fill
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
  // 2026-10-01 ("global search in jobcardwizards page chassisno. wise not search global that also
  // add"): true whenever the suggestions currently shown came from the cross-dealer fallback
  // below, not the normal dealer-scoped query - drives the "showing results from every dealer"
  // banner in the dropdown so it's clear these rows aren't this workshop's own stock.
  const [suggestionsAreGlobal, setSuggestionsAreGlobal] = useState(false)
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
  // 2026-09-25 ("worklocation chassis no and reg no use from vehicle sale which we data fetch"):
  // kept only as a DISPLAY value now (the "registered to dealer X, not this workshop" hint on the
  // cross-dealer search hit below) - the actual lookup/suggestions calls below now scope by
  // effectiveDealerId (a Guid) directly, since GET /api/jobcards/vehicle-lookup and
  // /vehicle-suggestions take dealerId, not a BAPL dealer code (they resolve the code themselves
  // server-side - see JobCardsController.VehicleLookupForWizard's doc comment). Still falls back to
  // the signed-in dealer's own DMS code for that display comparison when the picker list hasn't
  // loaded this dealer's row yet.
  const vehicleSearchDealerCode = dealers.find((d) => d.id === effectiveDealerId)?.baplDmsDealerCode ?? profile?.dealerBaplDmsCode ?? undefined

  // 2026-10-01 ("global search in jobcardwizards page chassisno. wise not search global that also
  // add"): the live-typing typeahead used to ONLY ever query this dealer's own stock
  // (dealerId: effectiveDealerId) and show nothing at all when it found no matches - so a chassis
  // sold by a different dealer never appeared while typing, even though the Enter/Search button
  // flow a few lines below (lookupByChassisOrReg -> 404 -> showGlobalSearchOffer ->
  // searchGlobalChassis) already had a working cross-dealer fallback. This mirrors that same
  // fallback into the typeahead: if the dealer-scoped query comes back empty AND a dealer is
  // actually selected (an empty effectiveDealerId already means "unscoped", so there's nothing to
  // fall back from), it re-queries with no dealerId at all (every dealer) and shows those instead,
  // flagged via suggestionsAreGlobal so the dropdown can label them. No backend change needed -
  // GET /api/jobcards/vehicle-suggestions already treats an omitted dealerId as unscoped, the same
  // way /vehicle-lookup does (see JobCardsController.VehicleSuggestionsForWizard's doc comment).
  useEffect(() => {
    if (!showVehicleSuggestions || chassisOrRegQ.trim().length < 2) { setVehicleSuggestions([]); setSuggestionsAreGlobal(false); return }
    const q = chassisOrRegQ.trim()
    const handle = setTimeout(() => {
      staffApi.get<BaplDmsVehicleSuggestion[]>('/api/jobcards/vehicle-suggestions', { params: { q, dealerId: effectiveDealerId || undefined } })
        .then(({ data }) => {
          if (data.length > 0 || !effectiveDealerId) {
            setVehicleSuggestions(data)
            setSuggestionsAreGlobal(false)
            return
          }
          // Dealer-scoped search came back empty and there IS a dealer to fall back from -
          // re-run unscoped (every dealer), same as the Search-button flow's global offer.
          staffApi.get<BaplDmsVehicleSuggestion[]>('/api/jobcards/vehicle-suggestions', { params: { q } })
            .then(({ data: globalData }) => { setVehicleSuggestions(globalData); setSuggestionsAreGlobal(globalData.length > 0) })
            .catch(() => { setVehicleSuggestions([]); setSuggestionsAreGlobal(false) })
        })
        .catch(() => { setVehicleSuggestions([]); setSuggestionsAreGlobal(false) })
    }, 300)
    return () => clearTimeout(handle)
  }, [chassisOrRegQ, showVehicleSuggestions, effectiveDealerId])
  // Fields pre-filled from a DMS auto-fetch are locked by default (disabled inputs) so they
  // aren't accidentally overwritten - each section has its own "Edit anyway" escape hatch for the
  // rare case the fetched data is wrong. Resets back to locked whenever a fresh hit comes in.
  const [unlockCustomerFields, setUnlockCustomerFields] = useState(false)
  const [unlockVehicleFields, setUnlockVehicleFields] = useState(false)
  const customerFieldsLocked = !!baplVehicleHit && !unlockCustomerFields
  const vehicleFieldsLocked = !!baplVehicleHit && !unlockVehicleFields

  // SECTION 182 (2026-09-30) "Email City Address State..that not fetch why fix this" - `state`
  // was completely missing from this mapping before: name/mobile/city/email/address all had a
  // line here, `state` did not, even though newCustomer has a `state` field (used at step 0's
  // State input and posted to POST /api/customers). That's a confirmed bug - State could never
  // show anything, regardless of what DMS actually returned, purely because nothing ever wrote
  // into it. Added below.
  //
  // CONFIRMED 2026-10-01: `data.customerState` on BaplDmsVehicleLookup is real - it's in
  // web/src/types/index.ts already (`customerState? : string | null`), and your own
  // `select * from DMS_SaleBillCustomer where Id='81863'` dump proved the upstream State column
  // genuinely has data ('KARNATAKA') for the exact customer you screenshotted. So on web this was
  // always a correct mapping - the earlier "not fetched" report traced back to this same line
  // simply never existing until SECTION 182 above added it, not to a bad field name.
  //
  // SEPARATE, NOT FIXED HERE: if Email/City/Address are themselves coming back blank from DMS (as
  // your screenshot showed), that's not something this function can fix - it's a backend query
  // issue (whatever builds BaplDmsVehicleLookup isn't populating those fields, even though it
  // clearly IS resolving Name/Mobile from somewhere, per your screenshot). I don't have that
  // backend file this session - see my reply for what I need to fix that part.
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
      // Item 3: ChassisDetails.SaleDate is what gated this fetch in the first place (a null one
      // never reaches here - see the alert above) - show it back in the Sale Date field instead
      // of leaving it blank for the user to re-type. DMS returns a full datetime (e.g.
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
      const { data } = await staffApi.get<BaplDmsVehicleLookup>('/api/jobcards/vehicle-lookup', { params: { value, dealerId: effectiveDealerId || undefined } })
      // This chassis already has an open job card here in JobCardScanner - see
      // JobCardsController.VehicleLookupForWizard's doc comment on why this is now a local-only
      // check (there's no live DMS signal for this any more since DMS write-back was removed) -
      // refuse to auto-fill/proceed with it at all, and say which job card so staff know where to
      // go close it first.
      if (data.openJobCardNumber) {
        const status = data.openJobCardStatus ? ` (status: ${data.openJobCardStatus})` : ''
        setOpenJobCardNotice(`This chassis already has an open job card here: ${data.openJobCardNumber}${status}. It must be closed before this chassis can be used for a new job card.`)
        return
      }
      // Item 3: a hit with no SaleDate on file isn't auto-fetched - alert and leave the customer/
      // vehicle fields for manual entry instead of pre-filling from an incomplete DMS record.
      if (!data.saleDate) {
        // Item 12a/12b: shorter, friendlier wording - "This Vehicle not sold" instead of the
        // internal-sounding "Sale date not defined", shown as a styled banner instead of a native
        // window.alert() (which can't be styled and blocks the page). 2026-09-03: dropped the
        // extra "'X' was found in DMS." line that used to show right below it too, per explicit
        // request - the banner alone says enough; the second line just duplicated the same fact.
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
   * searchGlobalChassis()/applyGlobalChassisResult() pair. Covers reg no. the same as chassis no. -
   * `value` is whatever was typed into the single Chassis no. / Reg No. box, and
   * GET /api/jobcards/vehicle-lookup resolves it against either column server-side either way (see
   * JobCardsController.VehicleLookupForWizard's doc comment) - no separate "global reg no. search"
   * path is needed. */
  const searchGlobalChassis = async () => {
    const value = chassisOrRegQ.trim()
    if (!value) return
    setGlobalSearchLoading(true)
    setGlobalSearchNotFound(false)
    setGlobalHit(null)
    try {
      const { data } = await staffApi.get<BaplDmsVehicleLookup>('/api/jobcards/vehicle-lookup', { params: { value } })
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
    // belong to a chassis with an open job card (at this dealer or elsewhere). Always "here" now -
    // see VehicleLookupForWizard's doc comment on why this is local-only.
    if (globalHit.openJobCardNumber) {
      const status = globalHit.openJobCardStatus ? ` (status: ${globalHit.openJobCardStatus})` : ''
      setOpenJobCardNotice(`This chassis already has an open job card here: ${globalHit.openJobCardNumber}${status}. It must be closed before this chassis can be used for a new job card.`)
      setShowGlobalSearchOffer(false)
      setGlobalHit(null)
      return
    }
    applyVehicleHit(globalHit)
    setVehicleLookupError(null)
    setShowGlobalSearchOffer(false)
    setGlobalHit(null)
  }

  /** Picking a global (cross-dealer) suggestion from the typeahead dropdown: same as picking a
   * normal dealer-scoped one (fills the box and runs the full lookup), except the lookup itself
   * must also go unscoped (no dealerId), or a suggestion found by the global fallback above would
   * immediately 404 again against lookupByChassisOrReg's own dealer-scoped call. Reuses the same
   * open-job-card / not-sold guards as lookupByChassisOrReg/applyGlobalHit rather than duplicating
   * them differently. */
  const selectGlobalSuggestion = (chassisNo: string) => {
    setChassisOrRegQ(chassisNo)
    setShowVehicleSuggestions(false)
    setVehicleSuggestions([])
    setVehicleLookupError(null)
    setVehicleLookupLoading(true)
    staffApi.get<BaplDmsVehicleLookup>('/api/jobcards/vehicle-lookup', { params: { value: chassisNo } })
      .then(({ data }) => {
        if (data.openJobCardNumber) {
          const status = data.openJobCardStatus ? ` (status: ${data.openJobCardStatus})` : ''
          setOpenJobCardNotice(`This chassis already has an open job card here: ${data.openJobCardNumber}${status}. It must be closed before this chassis can be used for a new job card.`)
          return
        }
        if (!data.saleDate) { setVehicleNotSoldNotice('This Vehicle not sold'); return }
        applyVehicleHit(data)
      })
      .catch(() => setVehicleLookupError(`"${chassisNo}" wasn't found in Vehicle Sale.`))
      .finally(() => setVehicleLookupLoading(false))
  }

  // Step 2: vehicle
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [newVehicle, setNewVehicle] = useState({ model: '', variant: '', color: '', regNo: '', vin: '', odometer: 0 })
  // Model -> Variant is a dependent dropdown (see data/vehicleCatalog.ts): picking a model
  // narrows the Variant list down to just that model's variants, and changing the model clears
  // whatever variant was previously selected so an invalid model/variant pairing can't be sent.
  // Only used for a fully manual vehicle (no DMS hit) - see usingBaplVehicle below.
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const availableVariants = variantsForModel(selectedModelId)
  // True whenever a DMS chassis/reg-no hit exists - whether its fields are still locked or
  // "Edit anyway" has unlocked them. DMS doesn't split Model/Variant into two fields the way
  // JobCardScanner's own catalog does (it's one combined ItemName), so once a hit exists, Model is
  // always a plain text field and Variant is never shown again, even after "Edit anyway" - only
  // Model/Reg No/VIN reappear as editable.
  const usingBaplVehicle = !!baplVehicleHit
  const previousOdometer = baplVehicleHit?.vehiclePrevKms ?? null
  const odometerValid = newVehicle.odometer > 0 && (previousOdometer == null || newVehicle.odometer > previousOdometer)

  // 2026-09-07: Coupon No. and Job Category, matching DMS's own Job Card form (the DMS
  // Angular wizard shows these right after Service Location - see job-card-add-form.html). Coupon
  // No. auto-fills from the chassis number's last 13 characters, exactly like DMS's own
  // onChassisChange() (`this.couponNo = this.selectedChassis.slice(-13)`) - see the effect below -
  // but stays editable and stops auto-updating once the user types into it directly, same as any
  // other auto-filled-but-overridable field in this wizard.
  // 2026-09-18: Job Category now defaults to "B2B" per explicit request - this REPLACES the
  // earlier "defaults to B2C, matching DMS's own radio default" behavior (DMS's own b2c radio
  // starts checked, but this app's own default is now intentionally different from DMS's). Still
  // fully editable via the B2C/B2B toggle below either way.
  const [couponNo, setCouponNo] = useState('')
  const [couponNoTouched, setCouponNoTouched] = useState(false)
  const [jobCategory, setJobCategory] = useState<'B2C' | 'B2B'>('B2B')
  useEffect(() => {
    if (couponNoTouched) return
    const vin = newVehicle.vin || ''
    setCouponNo(vin.length > 13 ? vin.slice(-13) : vin)
  }, [newVehicle.vin, couponNoTouched])

  // Pre-fill the "add a new vehicle" form the moment a DMS hit exists, so a customer created
  // from a chassis/reg-no search (above) lands on step 2 with everything already typed in. DMS
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
  // SECTION 169 - starts blank now (was a fixed 'Normal' default) since the valid Priority values
  // themselves depend on which Job Type + Service Head are picked - see the master-data block
  // below. Holds whatever string the matching ServiceMenuMaster row's PriorityLabel is, which is
  // expected to already be one of JobCardPriority's real enum names.
  const [priority, setPriority] = useState('')
  const [batteryLevel, setBatteryLevel] = useState<number | ''>('')
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState(nowForDatetimeLocalInput)
  const [consentNotes, setConsentNotes] = useState('')
  // Populated from the fixed Complaint button grid and/or manual entry (see toggleComplaint/
  // addManualComplaint below) - never starts with a blank placeholder entry.
  const [complaints, setComplaints] = useState<string[]>([])
  // BAPL-DMS-style fields, captured alongside JobCardScanner's own Service Type/Source/Priority
  // above. Job Type -> Service Head -> Service Type is a live cascade straight off DMS's own
  // JobType/ServiceHead/ServiceType master tables (Controllers/BaplDmsController.cs) - picking a
  // Job Type loads that job type's Service Heads, picking a Service Head loads that head's Service
  // Types, same dependency DMS's own screen uses. These ids (plus Service Location's Loccode)
  // are what actually let JobCardsController.Create attempt the DMS write-back - the free-text
  // baplJobType/baplServiceLocation below are kept only as a human-readable label for display.
  const [baplJobType, setBaplJobType] = useState('')
  const [baplServiceLocation, setBaplServiceLocation] = useState('')
  const [baplSupervisorName, setBaplSupervisorName] = useState('')
  const [baplTechnicianName, setBaplTechnicianName] = useState('')
  const [baplManualJobNo, setBaplManualJobNo] = useState('')

  // 2026-09-25 ("according screenshot only those feilds show on page"): Supervisor/Technician
  // dropdowns (and the GET /api/technicians/supervisors, GET /api/technicians fetch that fed them)
  // are REMOVED - they're not in your screenshot any more. baplSupervisorName/baplTechnicianName
  // state stays (still posted to POST /api/jobcards, just always empty now) since removing it
  // would touch the submit payload's shape for no benefit.

  // SECTION 169 (2026-09-30) "bind this 3 dropdown dependancy from master" - Job Type/Service
  // Head/Priority are now read from GET /api/service-menu-master (see the import block's doc
  // comment above for the full reasoning). serviceMenuRows is the raw flat table; jobTypeOptions/
  // serviceHeadOptions/priorityOptionsForSelection below derive each cascading dropdown's distinct
  // option set from it. Service Type itself is still not shown as a field at all (unchanged from
  // 2026-09-25) - selectedServiceTypeId is kept only because JobCardsController.Create's payload
  // still has a slot for it (always null now).
  const [selectedJobTypeId, setSelectedJobTypeId] = useState<number | null>(null)
  const [selectedServiceHeadId, setSelectedServiceHeadId] = useState<number | null>(null)
  const [selectedServiceTypeId, setSelectedServiceTypeId] = useState<number | null>(null)
  const [serviceMenuRows, setServiceMenuRows] = useState<ServiceMenuRow[]>([])
  const [serviceMenuError, setServiceMenuError] = useState<string | null>(null)
  const [complaintOptions, setComplaintOptions] = useState<ComplaintMasterRow[]>([])

  useEffect(() => {
    staffApi.get<ServiceMenuRow[]>('/api/service-menu-master')
      .then(({ data }) => setServiceMenuRows(data))
      .catch(() => setServiceMenuError('Could not load Job Type / Service Head / Priority options from Service Menu Master.'))
    staffApi.get<ComplaintMasterRow[]>('/api/complaint-master')
      .then(({ data }) => setComplaintOptions(data))
      .catch(() => setComplaintOptions([]))
  }, [])

  const sortedServiceMenuRows = [...serviceMenuRows].sort((a, b) => a.sortOrder - b.sortOrder)
  const jobTypeOptions = dedupeBy(sortedServiceMenuRows, (r) => r.jobTypeId)
    .map((r) => ({ id: r.jobTypeId, name: r.jobTypeName }))
  const serviceHeadOptions = dedupeBy(sortedServiceMenuRows.filter((r) => r.jobTypeId === selectedJobTypeId), (r) => r.serviceHeadId)
    .map((r) => ({ id: r.serviceHeadId, name: r.serviceHeadName }))
  // value = PriorityLabel (posted as this page's `priority` state - must match JobCardPriority's
  // real enum names), label = PriorityValue (the short code shown in the dropdown) - see the
  // import block's doc comment for why these are the right way round.
  const priorityOptionsForSelection = dedupeBy(
    sortedServiceMenuRows.filter((r) => r.jobTypeId === selectedJobTypeId && r.serviceHeadId === selectedServiceHeadId),
    (r) => r.priorityLabel,
  ).map((r) => ({ value: r.priorityLabel, label: r.priorityValue }))

  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  const [selectedWorkshopLocCode, setSelectedWorkshopLocCode] = useState('')

  // 2026-09-25 ("Customer complaints top 5 radio button dont show in dropdown direct top 5
  // complain show direct in radio button ... button multiple mutiple selection and manual type"):
  // Customer complaints is now a grid of toggle BUTTONS (multi-select) straight off the fixed
  // COMPLAINTS list (serviceCatalog.ts) instead of a dropdown+Add - showing all 8 real complaints,
  // not just 5, since there's no usage-frequency data to pick a genuine "top 5" from (your call,
  // "show all 8"). manualComplaintText brings back a free-text option alongside the buttons, per
  // your "and manual type" - the earlier removal of free-text complaints (2026-09-03) is reversed
  // for this one case since you explicitly asked for it back here.
  const [manualComplaintText, setManualComplaintText] = useState('')

  // 2026-09-25 ("according screenshot only those feilds show on page"): the Source picker itself
  // is removed - selectedJobSourceId is kept only because JobCardsController.Create's payload
  // still has baplJobSourceId/baplJobSourceName slots for it (always null now); `source`
  // (JobCardScanner's own JobCardSource enum) stays at its default 'WalkIn' since nothing sets it
  // any more.
  const [selectedJobSourceId, setSelectedJobSourceId] = useState<number | null>(null)

  const [baplSyncWarning, setBaplSyncWarning] = useState<string | null>(null)

  // 2026-09-25 ("according screenshot only those feilds show on page"): only the fields still
  // actually shown on this step are required now - Service Type/Service Location/Supervisor/
  // Technician/Source were dropped from here since their pickers are gone (Service Location is
  // still auto-filled internally, just not required from the user any more since there's nothing
  // left for them to pick). Manual Job No. was already optional. Expected delivery and Complaints
  // stay required per the 2026-09-03 request. SECTION 169: Priority is now also required - it's a
  // real master-driven dropdown again, not an always-populated 'Normal' default.
  const serviceDetailsValid = !!(
    selectedJobTypeId && selectedServiceHeadId && priority && expectedDeliveryAt && complaints.length > 0
  )

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
      .then(({ data }) => {
        // 2026-09-18 Work Area scoping: a user with one or more assigned Work Area locations
        // (profile.workLocationCodes, from /api/auth/me - see User.WorkLocationCodes's doc
        // comment) should only ever be OFFERED their own location(s) here, not every workshop the
        // dealer has - the backend (JobCardsController.Create) already rejects an out-of-scope
        // choice, but the dropdown shouldn't present a choice it's only going to reject. An empty
        // workLocationCodes means unrestricted (e.g. Corporate/System Admin, or a legacy user with
        // no Work Area set) - unchanged, full list.
        const scoped = profile?.workLocationCodes?.length
          ? data.filter((w) => profile.workLocationCodes.includes(w.locCode))
          : data
        setWorkshops(scoped)
      })
      .catch(() => setWorkshops([]))
  }, [effectiveDealerId, profile?.workLocationCodes])

  // Default the Service Location to this dealer's own W-series, lowest number first (W1 if it
  // has one, else W2, and so on) - per your request, so a Service Location is already picked as
  // soon as the dealer/workshop list resolves, instead of starting blank until step 2. Only fires
  // when nothing is selected yet. 2026-09-25: this is now the ONLY way Service Location gets set
  // (the picker itself is hidden - see the read-only display further down) other than the more
  // specific chassis/reg-no auto-fill effect right below, which always re-sets on a match and so
  // still wins over this plain default.
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

  // Pre-select the Service Location once DMS told us which workshop this chassis is
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

  /** Priority options for a given (Job Type, Service Head) pair, straight off serviceMenuRows -
   * same de-dup used by priorityOptionsForSelection above, just parameterised so both onChange
   * handlers below can compute "what should Priority auto-select to now" before React re-renders
   * priorityOptionsForSelection itself. */
  const priorityOptionsFor = (jobTypeId: number | null, serviceHeadId: number | null) =>
    dedupeBy(
      sortedServiceMenuRows.filter((r) => r.jobTypeId === jobTypeId && r.serviceHeadId === serviceHeadId),
      (r) => r.priorityLabel,
    ).map((r) => ({ value: r.priorityLabel, label: r.priorityValue }))

  // SECTION 169 - resolved against the new Service Menu Master table (GET /api/service-menu-master,
  // see serviceMenuRows/jobTypeOptions/serviceHeadOptions above) instead of JOB_TYPES/
  // serviceHeadsForJobType. Same cascade reset/auto-select behavior as before: when the picked Job
  // Type has exactly ONE Service Head, that Service Head is auto-selected immediately instead of
  // showing a "Select service head…" placeholder - and now Priority follows the same rule one level
  // deeper: if the resulting (Job Type, Service Head) pair has exactly one Priority row, Priority
  // auto-selects too; otherwise it's cleared for the user to pick.
  const onJobTypeChange = (value: string) => {
    const id = value ? Number(value) : null
    setSelectedJobTypeId(id)
    const name = jobTypeOptions.find((j) => j.id === id)?.name ?? ''
    setBaplJobType(name)
    // JobCardScanner's own ServiceType is derived from the Job Type picked here rather than shown
    // as a separate dropdown - see mapBaplJobTypeToServiceType's doc comment above.
    if (name) setServiceType(mapBaplJobTypeToServiceType(name))
    const heads = dedupeBy(sortedServiceMenuRows.filter((r) => r.jobTypeId === id), (r) => r.serviceHeadId)
      .map((r) => ({ id: r.serviceHeadId, name: r.serviceHeadName }))
    const newHeadId = heads.length === 1 ? heads[0].id : null
    setSelectedServiceHeadId(newHeadId)
    setSelectedServiceTypeId(null)
    const prios = priorityOptionsFor(id, newHeadId)
    setPriority(prios.length === 1 ? prios[0].value : '')
  }

  // SECTION 169 - resolved against the new master table now (Service Type itself is still not a
  // field on this step at all, see the removed picker further down). Priority auto-selects/clears
  // the same way onJobTypeChange above does, one level deeper.
  const onServiceHeadChange = (value: string) => {
    const id = value ? Number(value) : null
    setSelectedServiceHeadId(id)
    setSelectedServiceTypeId(null)
    const prios = priorityOptionsFor(selectedJobTypeId, id)
    setPriority(prios.length === 1 ? prios[0].value : '')
  }

  // 2026-09-25: toggle-button multi-select, now against the Complaint Master list (SECTION 169 -
  // GET /api/complaint-master, see complaintOptions above; was the fixed COMPLAINTS array) -
  // clicking an already-added complaint's button removes it again (same as the Remove button in
  // the list below), so the buttons double as an at-a-glance "what's picked" view.
  const toggleComplaint = (name: string) => {
    setComplaints((prev) => (prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]))
  }
  const removeComplaint = (name: string) => setComplaints((prev) => prev.filter((c) => c !== name))
  // Manual/free-text complaint entry, brought back per your "and manual type" request - adds
  // whatever's typed as its own complaint line, same as a button pick.
  const addManualComplaint = () => {
    const text = manualComplaintText.trim()
    if (!text || complaints.includes(text)) return
    setComplaints((prev) => [...prev, text])
    setManualComplaintText('')
  }

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
    // DMS returns full ISO date-times (or plain dates); the backend's DateOnly fields only
    // want the date part - same trim BAPL's own Angular code does (`selected.saleDate?.split('T')[0]`).
    const dateOnly = (s?: string | null) => (s ? s.split('T')[0] : null)
    const { data } = await staffApi.post<Vehicle>('/api/customers/vehicles', {
      ...newVehicle,
      customerId: customer.id,
      dealerId: effectiveDealerId,
      // DMS's own sale date wins when there's an auto-fetched hit; otherwise fall back to
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
        // writing this job card into DMS's own database (see JobCardsController.Create).
        baplJobTypeId: selectedJobTypeId,
        baplServiceHeadId: selectedServiceHeadId,
        baplServiceHeadName: serviceHeadOptions.find((h) => h.id === selectedServiceHeadId)?.name ?? null,
        baplServiceTypeId: selectedServiceTypeId,
        baplServiceTypeName: SERVICE_TYPES.find((t) => t.id === selectedServiceTypeId)?.name ?? null,
        baplServiceLocationCode: selectedWorkshopLocCode || null,
        baplCustomerLedgerId: baplVehicleHit?.customerLedgerId ?? null,
        baplJobSourceId: selectedJobSourceId,
        baplJobSourceName: JOB_SOURCES.find((s) => s.id === selectedJobSourceId)?.name ?? null,
        baplCouponNo: couponNo || null,
        baplJobCategory: jobCategory,
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
      jobsource: JOB_SOURCES.find((s) => s.id === selectedJobSourceId)?.name,
      serviceHead: serviceHeadOptions.find((h) => h.id === selectedServiceHeadId)?.name,
      serviceType: SERVICE_TYPES.find((t) => t.id === selectedServiceTypeId)?.name,
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
      // this reads them from DMS's ChassisBatteryDetails response still held in wizard state.
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
                Not in the list yet? Search DMS below.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  value={dealerSearchQ}
                  onChange={(e) => setDealerSearchQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchBaplDealers()}
                  placeholder="Search Dealer WorkShop Location (DMS) by name or code…"
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
          <h3>Registered customer Details</h3>
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
            <label>Chassis no. / Reg No.</label>
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
                {/* 2026-10-01 ("global search in jobcardwizards page chassisno. wise not search
                   global that also add"): shown only when the rows below came from the cross-dealer
                   fallback (suggestionsAreGlobal - see the typeahead useEffect above), so it's
                   clear these aren't this workshop's own stock before picking one. */}
                {suggestionsAreGlobal && (
                  <li style={{ padding: '6px 8px', fontSize: 12, color: '#1e3a5f', background: '#eef6ff', borderRadius: 6, marginBottom: 2 }}>
                    🔎 No matches for this dealer — showing results from every dealer.
                  </li>
                )}
                {vehicleSuggestions.map((s) => (
                  <li key={s.chassisNo}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '6px 8px' }}
                      /* KNOWN NUANCE: a global (cross-dealer) suggestion is applied via
                         selectGlobalSuggestion (an unscoped lookup, so it doesn't immediately
                         404 against this dealer again), while a normal dealer-scoped suggestion
                         still goes through lookupByChassisOrReg as before - same open-job-card/
                         not-sold guards either way. */
                      onMouseDown={(e) => {
                        e.preventDefault()
                        if (suggestionsAreGlobal) { selectGlobalSuggestion(s.chassisNo) } else { setChassisOrRegQ(s.chassisNo); lookupByChassisOrReg(s.chassisNo) }
                      }}
                    >
                      <strong>{s.chassisNo}</strong>{s.regNo ? ` · ${s.regNo}` : ''}{s.modelName ? ` — ${s.modelName}` : ''}
                      {/* Item (a): show Sale Date on every suggestion row, not just after a full
                         Search hit - lets the user tell sold vehicles apart from unsold ones before
                         picking one. */}
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted, #6b7280)' }}>
                        Sale date: {s.saleDate ? formatISTDate(s.saleDate) : 'not sold'}
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
                🔎 Not found for this dealer.{globalSearchNotFound ? ' Not found anywhere in Vehicle Sale either.' : ' Search Vehicle Sale across every dealer?'}
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
                  Found in Vehicle Sale{globalHit.dealerCode && globalHit.dealerCode !== vehicleSearchDealerCode ? ` — registered to dealer ${globalHit.dealerCode}, not this workshop` : ''}
                </p>
                <p className="muted" style={{ margin: '4px 0 8px' }}>
                  {globalHit.customerName || 'Unknown customer'}{globalHit.customerMobile ? ` (${globalHit.customerMobile})` : ''} · {globalHit.modelName || 'Model unknown'}
                  {globalHit.registerNo ? ` · reg no. ${globalHit.registerNo}` : ''}
                  {globalHit.saleDate ? ` · sold ${formatISTDate(globalHit.saleDate)}` : ' · not yet sold'}
                </p>
                <button type="button" className="btn btn-sm btn-primary" onClick={applyGlobalHit}>Use this vehicle</button>
              </div>
            )}
            {/* {baplVehicleHit && (
              <p className="muted" style={{ marginTop: 4 }}>
                Customer Details : customer-{baplVehicleHit.customerName || 'Unknown customer'}
                {baplVehicleHit.customerMobile ? ` (${baplVehicleHit.customerMobile})` : ''} - model- {baplVehicleHit.modelName || 'Model unknown'}
                {baplVehicleHit.registerNo ? `, reg no. ${baplVehicleHit.registerNo}` : ''}
                {baplVehicleHit.saleDate ? `, sale date ${formatISTDate(baplVehicleHit.saleDate)}.` : '.'}
              </p>
            )} */}
          </div>
          <h3 style={{ marginTop: 24 }}>Registered Customer</h3>
          {customerFieldsLocked && (
            <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
              🔒 Name, Mobile, Email, City and Address were auto-fetched from DMS and are locked to prevent accidental changes.{' '}
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
          <button
            className="btn btn-primary"
            // 2026-09-03: also blocked while "This Vehicle not sold" is showing, per explicit
            // request - Dismissing the banner (the only way to clear vehicleNotSoldNotice) is what
            // re-enables this, so it still reads as "acknowledge, then proceed if you really mean to".
            disabled={!newCustomer.name || newCustomer.mobile.length !== 10 || !effectiveDealerId || !!vehicleNotSoldNotice}
            onClick={createCustomer}
          >
            Create & Continue
          </button>
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
              🔒 Model, Reg No and VIN were auto-fetched from DMS and are locked to prevent accidental changes.{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setUnlockVehicleFields(true) }}>Edit anyway</a>
            </p>
          )}
          {/* 2026-09-07: explicit inline gridTemplateColumns, not the plain .form-row class -
             .form-row's default `minmax(200px, 1fr)` only fit 5 of these 6-7 fields per row on a
             normal desktop width, wrapping Odometer onto its own line by itself. A 130px floor
             comfortably fits Model/Variant/Reg No/VIN/Coupon No/Job Category/Odometer on one row
             instead, per explicit request ("in 1 row for web all fields"). */}
          <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            <div className="field">
              <label>Model{usingBaplVehicle ? '' : ' & Variant'}</label>
              {usingBaplVehicle ? (
                // DMS doesn't split Model/Variant into two fields (see the pre-fill effect
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
            {/* 2026-09-07: Coupon No. + Job Category, matching DMS's own form - see the
               couponNo/jobCategory state declared above for the auto-fill/default rules. */}
            <div className="field">
              <label>Coupon No</label>
              <input value={couponNo} onChange={(e) => { setCouponNo(e.target.value); setCouponNoTouched(true) }} />
            </div>
            <div className="field">
              <label>Job Category</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={jobCategory === 'B2C' ? { background: '#2563eb', color: '#fff', border: '1px solid #2563eb' } : undefined}
                  onClick={() => setJobCategory('B2C')}
                >
                  B2C
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={jobCategory === 'B2B' ? { background: '#2563eb', color: '#fff', border: '1px solid #2563eb' } : undefined}
                  onClick={() => setJobCategory('B2B')}
                >
                  B2B
                </button>
              </div>
            </div>
            <div className="field">
              <label>Odometer (km)<Req />{previousOdometer != null ? ` (Previous: ${previousOdometer} km)` : ''}</label>
              {/* 2026-09-07: value was `newVehicle.odometer` directly (a number, defaulting to 0
                 or the previous-km auto-fill) - backspacing it down to a single digit made
                 e.target.value "" for one keystroke, Number("") is 0 (not NaN), so the field
                 immediately re-rendered showing "0" again instead of actually going blank. From
                 the keyboard it looked like backspace did nothing - "0" could never be erased to
                 start typing a fresh reading. Showing '' whenever the value is 0 (same pattern
                 mobile's Odometer field already used) fixes this: 0 is never a valid odometer
                 reading anyway (see odometerValid below), so there's nothing lost by never
                 displaying a literal "0" in the box. */}
              <input
                type="number"
                value={newVehicle.odometer || ''}
                onChange={(e) => setNewVehicle({ ...newVehicle, odometer: e.target.value === '' ? 0 : Number(e.target.value) })}
              />
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
                Service Details
              </span>
              <strong style={{ fontSize: 14 }}>Job Card fields</strong>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Job Type<Req /></label>
                {/* SECTION 169: sourced from GET /api/service-menu-master now (was the hardcoded
                   JOB_TYPES array) - see jobTypeOptions above. */}
                <select value={selectedJobTypeId ?? ''} onChange={(e) => onJobTypeChange(e.target.value)}>
                  <option value="">Select job type…</option>
                  {jobTypeOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {serviceMenuError && <p className="error-text" style={{ margin: '4px 0 0' }}>{serviceMenuError}</p>}
              </div>
              <div className="field">
                <label>Service Head<Req /></label>
                {/* 2026-09-25: auto-selected and shown read-only when the Job Type has exactly one
                   Service Head (see onJobTypeChange above) - still an editable dropdown when there's
                   a real choice. SECTION 169: options now come from the master table
                   (serviceHeadOptions), same auto-select behavior unchanged. */}
                {selectedJobTypeId && serviceHeadOptions.length === 1 ? (
                  <input value={serviceHeadOptions[0].name} disabled readOnly />
                ) : (
                  <select value={selectedServiceHeadId ?? ''} disabled={!selectedJobTypeId} onChange={(e) => onServiceHeadChange(e.target.value)}>
                    <option value="">{selectedJobTypeId ? 'Select service head…' : 'Select a job type first'}</option>
                    {serviceHeadOptions.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                )}
              </div>
              <div className="field">
                <label>Priority<Req /></label>
                {/* SECTION 169 (2026-09-30) "bind this 3 dropdown dependancy from master": Priority
                   is now a true 3rd level of the same cascade, sourced from the (Job Type, Service
                   Head)-filtered priorityOptionsForSelection - was a completely independent fixed
                   3-item PRIORITY_OPTIONS dropdown before. Auto-selected and shown read-only when
                   the combination has exactly one Priority row (same pattern as Service Head just
                   above); still POSTS the master row's PriorityLabel (must match JobCardPriority's
                   real enum names) while displaying its PriorityValue (the short "1"/"2"/"3"-style
                   code) - see the import block's doc comment and ServiceMenuMaster.cs for the full
                   PriorityValue/PriorityLabel reasoning. */}
                {selectedServiceHeadId && priorityOptionsForSelection.length === 1 ? (
                  <input value={priorityOptionsForSelection[0].label} disabled readOnly />
                ) : (
                  <select value={priority} disabled={!selectedServiceHeadId} onChange={(e) => setPriority(e.target.value)}>
                    <option value="">
                      {!selectedServiceHeadId
                        ? 'Select a service head first'
                        : priorityOptionsForSelection.length
                          ? 'Select priority…'
                          : 'No priority set up for this Service Head'}
                    </option>
                    {priorityOptionsForSelection.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              {/* 2026-09-25 ("Service Location (workshop) for main dealer all that hide"): the
                 workshop PICKER is hidden - Service Location is auto-selected (this dealer's own
                 W-series, lowest number first, or the workshop tied to a chassis/reg-no hit - see
                 the two useEffects above that still set selectedWorkshopLocCode/baplServiceLocation
                 unchanged) rather than left for the user to pick. Shown read-only so it's still
                 visible which workshop Supervisor/Technician below are scoped to. */}
              <div className="field">
                <label>Service Location (workshop)</label>
                <input value={baplServiceLocation || (effectiveDealerId ? 'Resolving…' : 'Select a dealer first')} disabled readOnly />
              </div>
              <div className="field">
                <label>Manual Job No.</label>
                <input value={baplManualJobNo} onChange={(e) => setBaplManualJobNo(e.target.value)} placeholder="e.g. 0" />
              </div>
              {/* 2026-09-25 ("according screenshot only those feilds show on page"): Supervisor,
                 Technician and Source are no longer shown on this step - only the fields visible
                 in your screenshot remain (Job Type, Service Head, Priority, Service Location
                 (read-only), Manual Job No., Battery level, Expected delivery, Complaints, Notes).
                 The supervisorOptions/technicianOptions fetch (GET /api/technicians/supervisors,
                 GET /api/technicians) and its effect were removed along with the pickers -
                 baplSupervisorName/baplTechnicianName/baplJobSourceId/baplJobSourceName state is
                 kept (POST /api/jobcards still has slots for them) but will always post as
                 empty/null now. ASSUMPTION, not confirmed: I'm assuming the backend still accepts
                 a job card without these (Job Type/Service Head/Service Location already became
                 optional server-side on 2026-09-24 - see JobCardsController.Create's own doc
                 comment) - if it still hard-requires Supervisor/Technician/Source, Create Job Card
                 will fail with a validation error until that's relaxed too. */}
            </div>
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
              {/* 2026-09-24 CHANGE ("dont save this jobcard in dms remove this all over flow that
                 save in jobcard db only"): this job card is saved in JobCardScanner ONLY - it is no
                 longer written into DMS's own database. 2026-09-25: Job Type/Service Head are no
                 longer even READ from DMS live - they're a fixed local catalog (see
                 serviceCatalog.ts). Service Location is still auto-selected behind the scenes (this
                 dealer's own default workshop, or the one tied to a chassis/reg-no hit) even though
                 it's no longer shown or required here. */}
              Job Type, Service Head, Expected delivery and at least one Complaint are required.
            </p>
          </div>

          <div className="form-row">
            <div className="field"><label>Battery level at check-in (%)</label><input type="number" min={0} max={100} value={batteryLevel} onChange={(e) => setBatteryLevel(e.target.value === '' ? '' : Number(e.target.value))} /></div>
            <div className="field"><label>Expected delivery<Req /></label><input type="datetime-local" value={expectedDeliveryAt} onChange={(e) => setExpectedDeliveryAt(e.target.value)} /></div>
          </div>

          <div className="field">
            <label>Complaint<Req /></label>
            {/* SECTION 169 (2026-09-30): toggle-button multi-select against the Complaint Master
               table now (GET /api/complaint-master, see complaintOptions above - was the fixed
               COMPLAINTS array from serviceCatalog.ts), plus a manual free-text entry alongside it.
               Click a button again (or Remove below) to un-pick it. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {complaintOptions.map((c) => {
                const picked = complaints.includes(c.complaintText)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="btn btn-sm"
                    aria-pressed={picked}
                    onClick={() => toggleComplaint(c.complaintText)}
                    style={picked ? { background: '#2563eb', color: '#fff', border: '1px solid #2563eb' } : undefined}
                  >
                    {c.complaintText}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                value={manualComplaintText}
                onChange={(e) => setManualComplaintText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addManualComplaint()}
                placeholder="Type a complaint not listed above…"
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={!manualComplaintText.trim()}
                onClick={addManualComplaint}
                style={{ fontWeight: 600 }}
              >
                + Add
              </button>
            </div>
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
                      style={{ background: '#dc2626', color: '#fff', border: '1px solid #dc2626' }}
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
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Fill in every field marked with a red * on this step to continue.</p>
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
          {/* SECTION 169: priority display now looks up the master row's short code (PriorityValue)
             matching whatever was posted (PriorityLabel) - was priorityLabel(priority) against the
             old fixed PRIORITY_OPTIONS tuple. Falls back to the raw posted value if, e.g., the
             Job Type/Service Head selection has since changed underneath (shouldn't happen within
             one wizard session, but this avoids showing a blank). */}
          <p><strong>Service:</strong> {baplJobType || serviceType} via {JOB_SOURCES.find((s) => s.id === selectedJobSourceId)?.name || source}, priority {priorityOptionsForSelection.find((p) => p.value === priority)?.label ?? priority}</p>
          <p><strong>Complaints:</strong> {complaints.join('; ') || 'None recorded'}</p>
          {(baplJobType || baplServiceLocation || baplSupervisorName || baplTechnicianName || baplManualJobNo) && (
            <p>
              <strong>DMS fields:</strong>{' '}
              {baplJobType && <><strong>Job Type:</strong> {baplJobType}. </>}
              {serviceHeadOptions.find((h) => h.id === selectedServiceHeadId)?.name && <><strong>Service Head:</strong> {serviceHeadOptions.find((h) => h.id === selectedServiceHeadId)?.name}. </>}
              {SERVICE_TYPES.find((t) => t.id === selectedServiceTypeId)?.name && <><strong>Service Type:</strong> {SERVICE_TYPES.find((t) => t.id === selectedServiceTypeId)?.name}. </>}
              {baplServiceLocation && <><strong>Location:</strong> {baplServiceLocation}. </>}
              {baplSupervisorName && <><strong>Supervisor:</strong> {baplSupervisorName}. </>}
              {baplTechnicianName && <><strong>Technician:</strong> {baplTechnicianName}. </>}
              {baplManualJobNo && <><strong>Manual Job No.:</strong> {baplManualJobNo}.</>}
            </p>
          )}

          {!createdJobCard && (
            <div className="field">
              <label>Photos<Req /></label>
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
                      <button
                        className="btn btn-sm"
                        style={{ marginTop: 6, width: '100%', background: '#dc2626', color: '#fff', border: '1px solid #dc2626' }}
                        onClick={() => removePendingPhoto(p.id)}
                      >
                        Remove
                      </button>
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