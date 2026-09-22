import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsLabourRow, BaplDmsWorkshop, BaplItemMaster, CombinedRepairBillRow, JobSearchResult, MaterialTransferItemForJob, RepairBillDocItemType } from '../../types'
import { Pagination } from '../../components/Pagination'
import { usePagination } from '../../lib/usePagination'
import { JobSearchModal } from '../../components/JobSearchModal'
import { LabourSearchInput } from '../../components/LabourSearchInput'
import { RecordDetailModal } from '../../components/RecordDetailModal'

/**
 * "Repair Bill" sidebar page - see this file's many earlier doc-comment rounds (Proforma/Invoice
 * lifecycle, per-job Material Transfer Part auto-load, Labour staging row, model-based labour
 * filtering, colour-accented section panels, Part Details List Edit/Delete, etc.) for the full
 * history - all unchanged in this round.
 *
 * 2026-09-22 ("only this div fix according to fetched data range that text box fix dont add extra
 * space and after filled labour code which data fetch that will block its not editable") - the
 * Labour staging row's fields (below) are resized to fit the data they actually hold instead of
 * generic/stretched widths, and Description locks once a Labour code is picked:
 *   - Every field's width is sized to its real content: a Labour code is ~12 chars, Qty/Rate/
 *     Discount are short numbers, the two selects are boxed to their own content (their OPEN
 *     dropdown list still shows full option text - only the CLOSED box is narrower, since a plain
 *     `<select>` otherwise sizes its closed box to its WIDEST option in most browsers).
 *   - Description no longer has a fixed pixel width while searching - it flex-grows
 *     (`flex: '1 1 160px'`) to fill whatever space is left in the row.
 *   - `labourFetched` (new state, alongside draftLabour/labourEditingKey) tracks whether the
 *     current Description value came from an actual Labour-code pick. Once true, Description
 *     swaps to a plain, disabled, grey "locked" input (`lockedFieldStyle`, new here) instead of
 *     staying a second searchable box for data that's already fetched - typing a new search in
 *     the Labour code field (onChangeText) resets it back to false so the search box reopens.
 *     Rate now locks the same way once fetched (this round's follow-up ask) - a plain, disabled,
 *     grey input, not editable-with-override.
 *   - Every field's wrapping `<div>` also gets `minWidth: 0` - the standard fix that lets a flex
 *     child actually shrink below its own content's intrinsic width, which the flex default of
 *     `min-width: auto` otherwise blocks.
 */
type TaxMode = 'Same State (CGST+SGST)' | 'Different State (IGST)'
type DiscountType = 'None' | 'Percentage' | 'Amount'

/** Visually "locked" look for a field whose value came from a fetch rather than direct typing -
 * distinct grey background/text/cursor so it reads as non-interactive at a glance. */
const lockedFieldStyle: CSSProperties = {
  background: '#eef0f3',
  color: '#6b7280',
  cursor: 'not-allowed',
  borderColor: '#d7dbe0',
}

type DraftItem = {
  /** A manually-added Labour line gets a locally-minted "manual-N" string; an auto-loaded Part
   * line uses its own MaterialTransferDocItem.Id (a real GUID from the backend) directly - see
   * this module's 2026-09-22 doc comment. String, not a number, specifically so the two spaces
   * can never collide. */
  key: string
  itemType: RepairBillDocItemType
  itemCode: string
  itemDescription: string
  hsnCode: string
  qty: string
  rate: string
  /** GST-inclusive MRP - for a Labour line this stays empty (Labour's Rate is never MRP-derived);
   * for an auto-loaded Part line this is that Material Transfer item's own Mrp, display-only (not
   * sent to the backend - RepairBillDocItem has no Mrp column, matching the reference's own
   * RepairBillDetail, which stores PartMRP only as display data). */
  mrp: string
  gstPct: string
  discountType: DiscountType
  discountValue: string
  /** Reference: RepairBillDetail.IssutypeId, per line - "Paid" (taxed normally), "U/W" or "FSC"
   * (zero tax). Empty defers to the bill-level Issue Type default. */
  issueType: string
  /** 2026-09-22: true for a Part row auto-loaded from GET /api/material-transfer-docs/for-job -
   * Item Code/Description/HSN/Qty/Rate are read-only for these (see this module's doc comment);
   * only Discount Type/Discount Value/Issue Type stay editable, and there is no Remove button.
   * False (the default) for every manually-added Labour line. */
  fromMaterialTransfer: boolean
}

const emptyItem = (key: string, defaultIssueType = ''): DraftItem => ({
  key, itemType: 'Labour', itemCode: '', itemDescription: '', hsnCode: '', qty: '1', rate: '0', mrp: '', gstPct: '18',
  discountType: 'None', discountValue: '0', issueType: defaultIssueType, fromMaterialTransfer: false,
})

const isZeroTaxIssue = (issueType: string) => issueType === 'U/W' || issueType === 'FSC'

const lineEstimate = (it: DraftItem, taxMode: TaxMode, headerIssueType: string) => {
  const zeroTax = isZeroTaxIssue(it.issueType || headerIssueType)
  const qty = Number(it.qty) || 0
  const rate = Number(it.rate) || 0
  const gst = Number(it.gstPct) || 0
  const discountValue = Number(it.discountValue) || 0
  const gross = qty * rate
  const discountAmt = Math.min(it.discountType === 'Percentage' ? (gross * discountValue) / 100 : it.discountType === 'Amount' ? discountValue : 0, gross)
  const taxable = zeroTax ? 0 : gross - discountAmt
  // 2026-09-21 ninth correction ("CGST, IGST,SGST % also shown"): the % actually applied is now
  // returned alongside each amount too - read-only, derived from the same gstPct/taxMode/zeroTax
  // split as the amounts, matching MaterialTransferCreatePage.tsx's own identical correction.
  const cgstPct = zeroTax || taxMode === 'Different State (IGST)' ? 0 : gst / 2
  const sgstPct = zeroTax || taxMode === 'Different State (IGST)' ? 0 : gst / 2
  const igstPct = zeroTax || taxMode !== 'Different State (IGST)' ? 0 : gst
  const cgstAmt = (taxable * cgstPct) / 100
  const sgstAmt = (taxable * sgstPct) / 100
  const igstAmt = (taxable * igstPct) / 100
  const tax = cgstAmt + sgstAmt + igstAmt
  return { gross, discountAmt, taxable, cgstPct, sgstPct, igstPct, cgstAmt, sgstAmt, igstAmt, tax, total: taxable + tax }
}

/** Splits a line's single GST % into independent Cgst/Sgst/Igst percentages per the (now
 * auto-detected, see taxMode below) Tax Type, matching how the reference's Angular resolved one
 * LabourMaster/PartWiseLabour rate into a CGST+SGST or IGST pair before ever calling
 * InsertRepairBill - the backend itself no longer decides this (see
 * RepairBillDocsController.Create's doc comment). */
const splitGst = (gstPct: number, taxMode: TaxMode) =>
  taxMode === 'Different State (IGST)'
    ? { cgstPct: 0, sgstPct: 0, igstPct: gstPct }
    : { cgstPct: gstPct / 2, sgstPct: gstPct / 2, igstPct: 0 }

export function RepairBillCreatePage() {
  const { profile, hasRole } = useStaffAuth()
  const canDelete = hasRole('SystemAdmin')

  // ---------------- Location dropdown - scoped to the signed-in user's own accessible workshops ----------------
  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  useEffect(() => {
    if (!profile?.dealerId) return
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then(({ data }) => {
        const scoped = profile?.workLocationCodes?.length ? data.filter((w) => profile.workLocationCodes.includes(w.locCode)) : data
        setWorkshops(scoped)
        if (scoped.length > 0) setLocation((prev) => prev || scoped[0].locCode)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.dealerId, profile?.workLocationCodes])

  // ---------------- Create form ----------------
  const [jobCardId, setJobCardId] = useState<string | null>(null)
  // 2026-09-22 ("Party Name, Reg No, Chassis No, Location that also auto fetched feild that also
  // dont show editable") - true once a Job is linked, since Party Name/Reg No/Chassis No/Location
  // are then auto-filled straight from that Job (selectJob() below) and are turned read-only in
  // the JSX further down rather than staying editable right next to the Job that just filled them.
  const autoFilledFromJob = !!jobCardId
  const [jobCardNumber, setJobCardNumber] = useState('')
  // 2026-09-22 "in labour after jobcard serach this automatically details fetch" - read-only
  // "Selected Job Details" panel fields, matching the reference DMS app's own screenshot (Job
  // Date/Job No/Reg No/Model/KMs/Chassis/Technician). Job No/Reg No/Model/Chassis already existed
  // as this page's own Party Name/Reg No/Chassis No/Location fields (now ALSO read-only whenever a
  // Job is linked, see autoFilledFromJob above) - this panel remains an ADDITIONAL read-only
  // summary alongside them, not a replacement; Job
  // Date/KMs/Technician are new here, sourced from GET /api/jobcards/search's own real
  // JobCard.CreatedAt/Vehicle.Odometer/JobCard.AssignedTechnicianName fields (see
  // JobCardsController.Search's own 2026-09-22 doc comment) - never fabricated.
  const [jobDate, setJobDate] = useState<string | null>(null)
  const [odometer, setOdometer] = useState<number | null>(null)
  const [technician, setTechnician] = useState<string | null>(null)
  // 2026-09-22 ("Add Model-based filtering to the Repair Bill labour dropdown"): JobSearchResult's
  // own `vehicleType` field is actually the vehicle's OEM Model name, not a vehicle category -
  // confirmed in JobCardsController.Search: `VehicleType = j.Vehicle != null ? j.Vehicle.Model :
  // null` (misleadingly named on that endpoint, left as-is rather than renamed everywhere it's
  // already consumed). Used below to narrow the Labour search to codes tagged for this job's own
  // model (BaplDmsLabourRow.oemModelName), same field JobCardDetailPage's own Labour Suggestion
  // panel already carries but never filtered on client-side until now.
  const [vehicleModel, setVehicleModel] = useState<string | null>(null)
  const [showJobSearch, setShowJobSearch] = useState(false)
  const [partyName, setPartyName] = useState('')
  const [regNo, setRegNo] = useState('')
  const [chassisNo, setChassisNo] = useState('')
  const [location, setLocation] = useState('')
  const [billType, setBillType] = useState('Cash')
  const [issueType, setIssueType] = useState('')
  const [partyState, setPartyState] = useState<string | null>(null)
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  // 2026-09-22: starts empty now that adding a Labour line goes through the dedicated staging row
  // (see draftLabour below) instead of always having one blank editable row sitting in the grid.
  const [items, setItems] = useState<DraftItem[]>([])
  // 2026-09-22 - mints a unique "manual-N" key per manually-added Labour line; an auto-loaded Part
  // line's key is its own MaterialTransferDocItem.Id instead (see DraftItem.key's doc comment), so
  // this counter only ever needs to stay unique among Labour lines, not globally sequential.
  const nextManualKeyRef = useRef(2)

  // 2026-09-21 ("according to state Intra state and inter state"): Same State vs Different State,
  // from this dealer's own State (GET /api/auth/me's DealerState) compared against the picked
  // job's Customer.State (JobSearchResult.partyState) - the exact compare the reference's
  // repair-bill.ts addLabour()/calculatePart() do (isSameState = dealerState.trim().toUpperCase()
  // === custState.trim().toUpperCase()). Defaults to Same State (CGST+SGST) whenever either state
  // isn't known yet (no job linked yet, or that job's customer has no State on file) - same
  // default this page already had before.
  //
  // 2026-09-22 "Tax Type hide dont show in ui automatically login dealer state wise it select":
  // this is now a plain derived value (useMemo), not useState+useEffect - there is no manual
  // override selector left in the UI to set it from, so there was nothing left for a setter to do.
  const taxMode: TaxMode = useMemo(() => {
    const dealerState = profile?.dealerState
    if (!dealerState || !partyState) return 'Same State (CGST+SGST)'
    return dealerState.trim().toUpperCase() === partyState.trim().toUpperCase()
      ? 'Same State (CGST+SGST)' : 'Different State (IGST)'
  }, [profile?.dealerState, partyState])

  // Insurance / discount / payment - reference RepairBillHeader fields, collapsed by default since
  // most bills don't carry an insurance claim.
  const [showInsurance, setShowInsurance] = useState(false)
  const [insuranceCompanyName, setInsuranceCompanyName] = useState('')
  const [insuranceDescription, setInsuranceDescription] = useState('')
  const [surveyorName, setSurveyorName] = useState('')
  const [surveyorContactNumber, setSurveyorContactNumber] = useState('')
  const [policyNo, setPolicyNo] = useState('')
  const [insuranceValidTill, setInsuranceValidTill] = useState('')
  const [zeroDepreciation, setZeroDepreciation] = useState(false)
  const [totalDiscount, setTotalDiscount] = useState('0')
  const [amountReceived, setAmountReceived] = useState('0')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState<string | null>(null)

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key))
  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  // 2026-09-22 ("in Part Details List with edit delete button also add") - explicit ask to add a
  // working Delete for Part rows, a deliberate departure from the reference (whose own Part
  // Details List has Edit only, no Delete - see this module's earlier doc comment, which this
  // supersedes). Deleting a Part row here only removes it from THIS bill's own item list - it does
  // NOT touch, undo, or reverse the underlying Material Transfer the part was physically issued
  // on (there is no "un-transfer" concept anywhere in this app); it just means that part won't be
  // billed on this Repair Bill. excludedPartKeys remembers which MaterialTransferDocItem.Id(s)
  // were removed so the materialTransferItems sync effect below (which otherwise re-derives every
  // Part row fresh from GET .../for-job/{jobCardId} whenever that data changes) doesn't silently
  // bring a deleted row back later in the same session - cleared whenever the linked Job changes
  // (see the for-job fetch effect) and after a successful save (see save() below).
  const [excludedPartKeys, setExcludedPartKeys] = useState<Set<string>>(new Set())
  const removePart = (it: DraftItem) => {
    if (!window.confirm(`Remove Part "${it.itemDescription}" from this bill? The Material Transfer record itself is unaffected - this only excludes it from this Repair Bill.`)) return
    setExcludedPartKeys((prev) => new Set(prev).add(it.key))
    removeItem(it.key)
    if (editingPartKey === it.key) setEditingPartKey(null)
  }

  // 2026-09-22 ("in labour...we adding labour details see screenshot that type add ui"): a
  // dedicated staging row for adding/editing ONE Labour line at a time, matching the reference's
  // own addLabour()/editLabour() (a separate input row above a read-only Labour Details List,
  // rather than editing every line in place inside the list itself). `labourEditingKey` is null
  // while staging a brand-new line, or an existing item's key while re-opening it for edit (the
  // reference's own pencil icon) - commitLabourDraft() below either updates that item in place or
  // appends a new one, matching editLabour()/updateLabour() vs addLabour().
  const [draftLabour, setDraftLabour] = useState<DraftItem>(() => emptyItem('draft', issueType))
  const [labourEditingKey, setLabourEditingKey] = useState<string | null>(null)
  // 2026-09-22 ("after filled labour code which data fetch that will block its not editable"):
  // true once the current draftLabour.itemDescription actually came from a Labour-code pick (see
  // pickLabourForDraft below) rather than free typing - drives whether Description renders as a
  // searchable box or a locked, disabled recap (see the Labour section JSX further down).
  const [labourFetched, setLabourFetched] = useState(false)
  const resetDraftLabour = () => { setDraftLabour(emptyItem('draft', issueType)); setLabourEditingKey(null); setLabourFetched(false) }
  const startEditLabour = (it: DraftItem) => { setDraftLabour({ ...it }); setLabourEditingKey(it.key); setLabourFetched(!!it.itemCode) }
  const commitLabourDraft = () => {
    if (!draftLabour.itemCode.trim() || !draftLabour.itemDescription.trim()) return
    if (labourEditingKey) {
      updateItem(labourEditingKey, { ...draftLabour, key: labourEditingKey })
    } else {
      setItems((prev) => [...prev, { ...draftLabour, key: `manual-${nextManualKeyRef.current++}` }])
    }
    resetDraftLabour()
  }
  const removeLabour = (key: string) => { removeItem(key); if (labourEditingKey === key) resetDraftLabour() }

  // Part lines stay auto-loaded/read-only (see this module's 2026-09-22 doc comment on why there's
  // no Part search/add row) - only Discount Type/Discount Value/Issue Type are ever editable on
  // one, so "Edit" here just toggles those three fields into inline inputs on that one row instead
  // of opening the shared staging row above (which is Labour-only).
  const [editingPartKey, setEditingPartKey] = useState<string | null>(null)

  const estimatedTotal = items.reduce((sum, it) => sum + lineEstimate(it, taxMode, issueType).total, 0)
  // Per-line Issue Type (2026-09-21 correction) means zero-tax is no longer a single whole-bill
  // flag - this counts how many of the current lines actually resolve to zero-tax (own IssueType,
  // falling back to the bill-level default), for the summary line below.
  const zeroTaxLineCount = items.filter((it) => isZeroTaxIssue(it.issueType || issueType)).length
  // 2026-09-22 - `items` stays the single source of truth saved to the backend (unchanged shape);
  // these two are just how the two separate Details List tables below read from it, matching the
  // reference's own Labour Details List / Part Details List split.
  const labourRows = items.filter((it) => it.itemType === 'Labour')
  const partRows = items.filter((it) => it.itemType === 'Part')

  // 2026-09-22 ("now i saved from material transfer bill now this will shown in repair bill with
  // which i material transfer"): every Material Transfer item already saved against the linked
  // Job (GET /api/material-transfer-docs/for-job/{jobCardId} - see that controller action's doc
  // comment) - fetched fresh whenever jobCardId changes, cleared when no Job is linked. This
  // REPLACES the old manual Item Code/Description Part search entirely - see this module's own
  // 2026-09-22 doc comment for why.
  const [materialTransferItems, setMaterialTransferItems] = useState<MaterialTransferItemForJob[]>([])
  // Reference: onSelect() warns "Material Transfer is not completed for this Job Card" off a
  // stored IsMaterialTransfer flag this app has no equivalent column for (never confirmed to exist
  // in JobCardScannerDb) - this derives the same warning from data already fetched here instead:
  // true once the for-job call above has settled (success or failure), so the "no items yet" note
  // below only shows after a real answer, not while still loading.
  const [mtFetchDone, setMtFetchDone] = useState(false)
  useEffect(() => {
    setMtFetchDone(false)
    setExcludedPartKeys(new Set()) // a different (or unlinked) Job's Parts are a clean slate - see removePart's own doc comment.
    if (!jobCardId) { setMaterialTransferItems([]); return }
    staffApi.get<MaterialTransferItemForJob[]>(`/api/material-transfer-docs/for-job/${jobCardId}`)
      .then(({ data }) => setMaterialTransferItems(data))
      .catch(() => setMaterialTransferItems([]))
      .finally(() => setMtFetchDone(true))
  }, [jobCardId])

  // Rate/Mrp/Qty/HSN already come straight off the Material Transfer item (SECTION 64's
  // C_ItemMaster-derived figures, not recomputed here) - but SGST/CGST/IGST % were never stored on
  // MaterialTransferDocItem (see that model's own doc comment), so a fresh, precise-by-code
  // C_ItemMaster lookup (same endpoint as before, just for this job's own item codes) is still
  // needed to compute this bill's own CGST/SGST/IGST split.
  const [mtItemMasterByCode, setMtItemMasterByCode] = useState<Record<string, BaplItemMaster>>({})
  useEffect(() => {
    const codes = Array.from(new Set(materialTransferItems.map((m) => m.itemCode.trim().toUpperCase()).filter(Boolean)))
    if (codes.length === 0) { setMtItemMasterByCode({}); return }
    staffApi.get<BaplItemMaster[]>('/api/item-master/by-codes', { params: { codes: codes.join(',') } })
      .then(({ data }) => {
        const byCode: Record<string, BaplItemMaster> = {}
        data.forEach((im) => { byCode[im.itemCode.trim().toUpperCase()] = im })
        setMtItemMasterByCode(byCode)
      })
      .catch(() => setMtItemMasterByCode({}))
  }, [materialTransferItems])

  // Turns the loaded Material Transfer items into read-only Part rows in `items`, replacing
  // whatever Part rows were there before (there can only ever be one set, always sourced from this
  // same job) while leaving every manually-added Labour row untouched. Keyed by each row's own
  // MaterialTransferDocItem.Id, so a Discount/Issue Type the user already edited on a still-present
  // row survives a re-fetch (e.g. after adding another Material Transfer for the same job).
  useEffect(() => {
    setItems((prev) => {
      const manual = prev.filter((i) => !i.fromMaterialTransfer)
      const partRows: DraftItem[] = materialTransferItems.filter((m) => !excludedPartKeys.has(m.id)).map((m) => {
        const im = mtItemMasterByCode[m.itemCode.trim().toUpperCase()]
        const sgstPct = im?.sgst ?? 9
        const cgstPct = im?.cgst ?? 9
        const igstPct = im?.igst ?? 18
        const totalGst = sgstPct + cgstPct > 0 ? sgstPct + cgstPct : igstPct
        const existing = prev.find((i) => i.key === m.id)
        return {
          key: m.id,
          itemType: 'Part',
          itemCode: m.itemCode,
          itemDescription: m.itemDescription,
          hsnCode: m.hsnCode || '',
          qty: String(m.qty),
          rate: String(m.rate),
          mrp: m.mrp != null ? String(m.mrp) : '',
          gstPct: String(totalGst),
          discountType: existing?.discountType ?? 'None',
          discountValue: existing?.discountValue ?? '0',
          issueType: existing?.issueType ?? (m.issueType || ''),
          fromMaterialTransfer: true,
        }
      })
      return [...partRows, ...manual]
    })
  }, [materialTransferItems, mtItemMasterByCode, excludedPartKeys])

  // 2026-09-21 ("Labour - when labor type select then Labour Code suggestion shown"): sourced from
  // DMS's own Labour Master (GET /api/bapl-dms/labour, the SAME endpoint/data
  // JobCardDetailPage.tsx's Labour Suggestion panel already uses) - scoped to this location's
  // owning dealer (LocCode is always {DealerCode}W{n} - see BaplDmsService's own
  // WorkshopLocCodeRegex - so the trailing W<digits> is stripped the same way
  // DmsBaplDataController.cs already recovers a dealer code from a workshop LocCode elsewhere in
  // this codebase). No JobType/ServiceHead/ServiceType cascade filter here (this page has none of
  // those loaded, unlike the Job Card Detail page) - every active labour row for this dealer is
  // offered, narrowed by the picker's own free-text search. This is now the ONLY manual add flow
  // left on this page (see this module's 2026-09-22 doc comment).
  const [labours, setLabours] = useState<BaplDmsLabourRow[]>([])
  useEffect(() => {
    if (!location) { setLabours([]); return }
    const dealerCode = location.replace(/W\d+$/i, '')
    staffApi.get<BaplDmsLabourRow[]>('/api/bapl-dms/labour', { params: { dealerCode: dealerCode || undefined } })
      .then(({ data }) => setLabours(data))
      .catch(() => setLabours([]))
  }, [location])

  // 2026-09-22 ("Add Model-based filtering to the Repair Bill labour dropdown"): narrows the
  // dealer-wide `labours` list above to this job's own vehicleModel before it reaches
  // LabourSearchInput. Deliberately keeps a labour row when EITHER vehicleModel isn't resolved yet
  // (no Job linked, or this job's Vehicle has no Model on file) OR the row itself has no
  // oemModelName (a labour rate that applies across every model) - only narrows when both sides are
  // known and don't match, so this never makes a genuinely-applicable labour code disappear from
  // the picker on an unconfirmed guess.
  const labourOptionsForModel = !vehicleModel
    ? labours
    : labours.filter((l) => !l.oemModelName || l.oemModelName.trim().toLowerCase() === vehicleModel.trim().toLowerCase())

  /** Picking a Labour Master row sets Rate DIRECTLY from LabourRate (not reverse-calculated - a
   * labour rate card's own GST-exclusive rate, unlike a Part's tax-inclusive MRP/Dealer Price) and
   * its OWN Sgst/Cgst/Igst percentages (already confirmed real columns - see BaplDmsLabourRow's
   * doc comment in BaplDmsService.cs) as this line's gstPct total, which then flows through the
   * SAME taxMode/splitGst() pipeline every other line already uses (see lineEstimate/splitGst
   * below) - no separate tax model needed for Labour vs Part lines. Also marks the Description
   * field as "fetched" (see labourFetched's own doc comment above) so it locks. */
  const pickLabourForDraft = (l: BaplDmsLabourRow) => {
    const totalGst = (l.cgst ?? 0) + (l.sgst ?? 0) > 0 ? (l.cgst ?? 0) + (l.sgst ?? 0) : (l.igst ?? 18)
    setDraftLabour((prev) => ({
      ...prev,
      itemCode: l.labourCode,
      itemDescription: l.labourDescription || l.labourCode,
      hsnCode: l.hsnCode || '',
      mrp: '',
      rate: l.labourRate != null ? String(l.labourRate) : '0',
      gstPct: String(totalGst),
    }))
    setLabourFetched(true)
  }

  const selectJob = (job: JobSearchResult) => {
    setJobCardId(job.id)
    setJobCardNumber(job.jobCardNumber)
    if (job.partyName) setPartyName(job.partyName)
    if (job.regNo) setRegNo(job.regNo)
    if (job.chassisNo) setChassisNo(job.chassisNo)
    if (job.locationCode) setLocation(job.locationCode)
    setPartyState(job.partyState ?? null)
    setVehicleModel(job.vehicleType || null)
    setJobDate(job.jobDate || null)
    setOdometer(job.odometer ?? null)
    setTechnician(job.technician || null)
    setShowJobSearch(false)
  }

  const clearJob = () => {
    setJobCardId(null); setJobCardNumber(''); setPartyState(null); setVehicleModel(null)
    setJobDate(null); setOdometer(null); setTechnician(null)
  }

  const save = () => {
    setSaveError(null)
    setSaveOk(null)
    if (!partyName.trim()) { setSaveError('Party Name is required.'); return }
    const validItems = items.filter((i) => i.itemDescription.trim() && Number(i.qty) > 0)
    if (validItems.length === 0) { setSaveError('Add at least one item/labour line with a description and quantity.'); return }

    setSaving(true)
    staffApi
      .post('/api/repair-bill-docs', {
        jobCardId: jobCardId || null,
        partyName: partyName.trim(),
        regNo: regNo || null,
        chassisNo: chassisNo || null,
        location: location || null,
        billType: billType || null,
        issueType: issueType || null,
        remarks: remarks || null,
        billDate,
        insuranceCompanyName: insuranceCompanyName || null,
        insuranceDescription: insuranceDescription || null,
        surveyorName: surveyorName || null,
        surveyorContactNumber: surveyorContactNumber || null,
        policyNo: policyNo || null,
        insuranceValidTill: insuranceValidTill || null,
        zeroDepreciation,
        totalDiscount: Number(totalDiscount) || 0,
        amountReceived: Number(amountReceived) || 0,
        items: validItems.map((i) => {
          const { cgstPct, sgstPct, igstPct } = splitGst(Number(i.gstPct) || 0, taxMode)
          return {
            itemType: i.itemType,
            itemCode: i.itemCode || i.itemDescription.slice(0, 30),
            itemDescription: i.itemDescription,
            hsnCode: i.hsnCode || null,
            issueType: i.issueType || null,
            qty: Number(i.qty) || 0,
            rate: Number(i.rate) || 0,
            cgstPct, sgstPct, igstPct,
            discountType: i.discountType === 'None' ? null : i.discountType,
            discountValue: Number(i.discountValue) || 0,
          }
        }),
      })
      .then((r) => {
        setSaveOk(`Saved as ${r.data.billNumber}.`)
        clearJob()
        setPartyName(''); setRegNo(''); setChassisNo(''); setBillType('Cash'); setIssueType(''); setRemarks('')
        setInsuranceCompanyName(''); setInsuranceDescription(''); setSurveyorName(''); setSurveyorContactNumber('')
        setPolicyNo(''); setInsuranceValidTill(''); setZeroDepreciation(false); setTotalDiscount('0'); setAmountReceived('0')
        nextManualKeyRef.current = 2
        setItems([])
        resetDraftLabour()
        setEditingPartKey(null)
        loadCombined()
      })
      .catch((err) => setSaveError(err?.response?.data?.message ?? 'Could not save the repair bill.'))
      .finally(() => setSaving(false))
  }

  // ---------------- Combined list (this app's own bills + DMSBAPLDATA-synced bills) ----------------
  // 2026-09-21 ("according /repair-bill-list do in our repair bill"): filter set widened to match
  // the reference repair-bill-list.ts's own repairbillsearchModel (Date From/To, Service Location,
  // Bill No, Job No, Chassis No) - see RepairBillDocsController.Combined's doc comment for which of
  // these narrow which data source (only this app's own JobCardScannerDb rows; DMSBAPLDATA keeps
  // its existing party-only filter, unchanged).
  const [party, setParty] = useState('Zomato')
  const [listBillNo, setListBillNo] = useState('')
  const [listJobNo, setListJobNo] = useState('')
  const [listChassisNo, setListChassisNo] = useState('')
  const [listLocation, setListLocation] = useState('')
  const [listDateFrom, setListDateFrom] = useState('')
  const [listDateTo, setListDateTo] = useState('')
  const [rows, setRows] = useState<CombinedRepairBillRow[]>([])
  const [dmsError, setDmsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadCombined = () => {
    setLoading(true)
    staffApi
      .get<{ rows: CombinedRepairBillRow[]; dmsBaplDataError: string | null }>('/api/repair-bill-docs/combined', {
        params: {
          party: party || undefined,
          billNo: listBillNo || undefined,
          jobNo: listJobNo || undefined,
          chassisNo: listChassisNo || undefined,
          locationCode: listLocation || undefined,
          dateFrom: listDateFrom || undefined,
          dateTo: listDateTo || undefined,
        },
      })
      .then((r) => { setRows(r.data.rows); setDmsError(r.data.dmsBaplDataError) })
      .catch(() => { setRows([]); setDmsError('Could not load the combined list.') })
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadCombined() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteBill = (id: string) => {
    if (!window.confirm('Delete this repair bill? This cannot be undone.')) return
    staffApi.delete(`/api/repair-bill-docs/${id}`)
      .then(() => loadCombined())
      .catch((err) => alert(err?.response?.data?.message ?? 'Could not delete the repair bill.'))
  }

  // 2026-09-22 "save as proforma and after save as proforma then save as invoice" - see this
  // file's own doc comment above for the full lifecycle. PUT .../status expects the raw enum
  // VALUE as the JSON body (RepairBillDocsController.UpdateStatus takes `[FromBody]
  // RepairBillDocStatus status`, no wrapper object) - Program.cs registers a global
  // JsonStringEnumConverter, so the body must be the JSON STRING "Billed", not the bare word
  // Billed or a {status:...} object. Explicit JSON.stringify + Content-Type below rather than
  // relying on axios's default string handling, which does NOT auto-quote/auto-JSON a plain
  // string payload the way it does for an object.
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const saveAsInvoice = (bill: CombinedRepairBillRow) => {
    if (!window.confirm(`Save Bill ${bill.billNumber} as Invoice? This finalizes it - line items can no longer be changed afterwards.`)) return
    setConvertingId(bill.id)
    staffApi
      .put(`/api/repair-bill-docs/${bill.id}/status`, JSON.stringify('Billed'), { headers: { 'Content-Type': 'application/json' } })
      .then(() => {
        setViewingBill((v) => (v && v.id === bill.id ? { ...v, status: 'Billed' } : v))
        loadCombined()
      })
      .catch((err) => alert(err?.response?.data?.message ?? 'Could not save this bill as an Invoice.'))
      .finally(() => setConvertingId(null))
  }

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(rows)

  // ---------------- Detail view (2026-09-21 "all upload data and exist data are clickable on
  // any record we click this all details can openable") - see MaterialTransferCreatePage.tsx's
  // own copy of this pattern for the shared reasoning (both this app's own bills and DMSBAPLDATA-
  // synced ones already come back with Items from /combined). ----------------
  const [viewingBill, setViewingBill] = useState<CombinedRepairBillRow | null>(null)
  const billItemColumns = viewingBill?.source === 'DMSBAPLDATA'
    ? ['Item Code/Id', 'Description', 'Type', 'Issue Type', 'Qty', 'Rate', 'CGST %', 'CGST Amt', 'SGST %', 'SGST Amt', 'IGST %', 'IGST Amt', 'Wav Rate', 'Total Amt', 'Material Issue']
    : ['Item Type', 'Item Code', 'Description', 'HSN', 'Issue Type', 'Qty', 'Rate', 'Discount', 'CGST %', 'SGST %', 'IGST %', 'Taxable Amt', 'Total Amt']
  const fmtBillCell = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v))
  const billItemRows = (viewingBill?.items ?? []).map((it) =>
    viewingBill?.source === 'DMSBAPLDATA'
      ? [fmtBillCell(it.itemIdno ?? it.itemCode), fmtBillCell(it.itemDesc), fmtBillCell(it.itemType), fmtBillCell(it.issueType), fmtBillCell(it.qty), fmtBillCell(it.rate),
         fmtBillCell(it.cgstPer), fmtBillCell(it.cgstAmount), fmtBillCell(it.sgstPer), fmtBillCell(it.sgstAmount), fmtBillCell(it.igstPer), fmtBillCell(it.igstAmount),
         fmtBillCell(it.wavRate), fmtBillCell(it.totAmnt), fmtBillCell(it.mtrlIssue)]
      : [fmtBillCell(it.itemType), fmtBillCell(it.itemCode), fmtBillCell(it.itemDescription), fmtBillCell(it.hsnCode), fmtBillCell(it.issueType), fmtBillCell(it.qty), fmtBillCell(it.rate),
         fmtBillCell(it.discountValue), fmtBillCell(it.cgstPct), fmtBillCell(it.sgstPct), fmtBillCell(it.igstPct), fmtBillCell(it.taxableAmount), fmtBillCell(it.totalAmount)]
  )

  return (
    <div>
      <h2>Repair Bill</h2>
      <p className="muted">
        Create a repair bill - saved into JobCardScanner's own database. The list below shows bills
        created here together with the read-only repair bill data synced from DMSBAPLDATA, tagged
        by source.
      </p>

      <div className="card">
        <h3>New Repair Bill</h3>
        {/* 2026-09-22 ("proper give me this page attractive page"): the page's fields were a flat
            run of .form-rows with no visual grouping - each of the three logical sections (job/
            bill header fields, Labour, Part Details List) now gets its own bordered, colour-
            accented panel (reusing this app's own existing --accent-N/--border/--radius-sm design
            tokens - see styles/global.css - nothing new invented) with a small icon+title caption,
            purely a visual/CSS change, no field, data, or save behaviour moved or altered. */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--primary)', padding: '14px 16px', marginBottom: 18, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--primary-dark)', fontWeight: 600 }}>
            <span>🧾</span><span>Job &amp; Bill Details</span>
          </div>
        <div className="form-row">
          <div className="field">
            <label>Job No</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={jobCardNumber} readOnly placeholder="No job linked" style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => setShowJobSearch(true)} type="button">Search Job</button>
              {jobCardId && <button className="btn btn-sm" onClick={clearJob} type="button" title="Unlink job">✕</button>}
            </div>
          </div>
        </div>

        {/* 2026-09-22 "in labour after jobcard serach this automatically details fetch" - read-only
            summary of the linked job, matching the reference DMS app's own "Selected Job Details"
            panel (Job Date/Job No/Reg No/Model/KMs/Chassis/Technician). Shown only once a job is
            actually linked; the fields below (Party Name/Reg No/Chassis No/Location) are the real
            values actually saved on the bill (this panel is a read-only recap, not a second set of
            inputs) - and, per the later 2026-09-22 correction just below, become read-only
            themselves too once a Job is linked, since they're auto-filled from it. */}
        {jobCardId && (
          <div className="form-row" style={{ background: 'var(--surface-muted, #f8f9fa)', borderRadius: 8, padding: '10px 12px', marginBottom: 4 }}>
            <div className="field">
              <label>Job Date</label>
              <input value={jobDate ? new Date(jobDate).toLocaleDateString('en-IN') : '—'} readOnly />
            </div>
            <div className="field">
              <label>Job No.</label>
              <input value={jobCardNumber || '—'} readOnly />
            </div>
            <div className="field">
              <label>Reg No</label>
              <input value={regNo || '—'} readOnly />
            </div>
            <div className="field">
              <label>Model</label>
              <input value={vehicleModel || '—'} readOnly />
            </div>
            <div className="field">
              <label>KMs</label>
              <input value={odometer != null ? odometer.toLocaleString('en-IN') : '—'} readOnly title="Vehicle.Odometer at last update - not necessarily today's reading." />
            </div>
            <div className="field">
              <label>Chassis</label>
              <input value={chassisNo || '—'} readOnly />
            </div>
            <div className="field">
              <label>Technician</label>
              <input value={technician || '—'} readOnly title={!technician ? 'No technician assigned on this Job Card yet.' : undefined} />
            </div>
          </div>
        )}

        {/* 2026-09-22 ("Party Name, Reg No, Chassis No, Location that also auto fetched feild that
            also dont show editable"): these four are auto-filled from selectJob() the moment a Job
            is linked (same as the read-only "Selected Job Details" panel above, which is a separate
            recap - these are the actual fields saved on the bill). Once a Job IS linked
            (jobCardId set) they become read-only here too, since editing them by hand would just
            silently drift from the linked Job's own real data - autoFilledFromJob (below) makes
            that explicit rather than leaving them editable right next to a job that just filled
            them in. Unlinking the Job (the ✕ button above) hands editing back for a standalone
            bill, exactly as before this change. */}
        <div className="form-row">
          <div className="field">
            <label>Party Name *</label>
            <input
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              placeholder="Customer or fleet party name"
              readOnly={autoFilledFromJob}
              title={autoFilledFromJob ? 'Auto-filled from the linked Job - unlink the Job to edit.' : undefined}
            />
          </div>
          <div className="field">
            <label>Reg No</label>
            <input
              value={regNo}
              onChange={(e) => setRegNo(e.target.value)}
              readOnly={autoFilledFromJob}
              title={autoFilledFromJob ? 'Auto-filled from the linked Job - unlink the Job to edit.' : undefined}
            />
          </div>
          <div className="field">
            <label>Chassis No</label>
            <input
              value={chassisNo}
              onChange={(e) => setChassisNo(e.target.value)}
              readOnly={autoFilledFromJob}
              title={autoFilledFromJob ? 'Auto-filled from the linked Job - unlink the Job to edit.' : undefined}
            />
          </div>
          <div className="field">
            <label>Location</label>
            {workshops.length > 0 ? (
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={autoFilledFromJob}
                title={autoFilledFromJob ? 'Auto-filled from the linked Job - unlink the Job to edit.' : undefined}
              >
                <option value="">— select —</option>
                {workshops.map((w) => (
                  <option key={w.locCode} value={w.locCode}>{w.locCode} — {w.locName}</option>
                ))}
              </select>
            ) : (
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Workshop location"
                readOnly={autoFilledFromJob}
                title={autoFilledFromJob ? 'Auto-filled from the linked Job - unlink the Job to edit.' : undefined}
              />
            )}
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>Bill Type</label>
            <select value={billType} onChange={(e) => setBillType(e.target.value)}>
              <option value="Cash">Cash</option>
              <option value="Credit">Credit</option>
              <option value="Warranty">Warranty</option>
            </select>
          </div>
          {/* 2026-09-22 "Tax Type hide dont show in ui automatically login dealer state wise it
              select" and "Issue Type (default for new lines) that also hide": both selectors
              removed from the visible form. taxMode keeps auto-computing from Dealer State vs
              Party State exactly as before (see the useMemo above this component's JSX), and
              issueType stays at its default '' (no bill-level override), which was already its
              normal value on every bill nobody had touched this dropdown on. Each line's OWN
              Issue Type selector (in the item grid below) is untouched - only this bill-level
              DEFAULT picker is hidden. */}
          <div className="field">
            <label>Bill Date</label>
            <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Remarks</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
        </div>

        {/* 2026-09-22 ("in labour...we adding labour details see screenshot that type add ui and
            all"): rebuilt to match the reference DMS app's own two-part layout - a dedicated
            staging row for adding/editing ONE Labour line (below), feeding a separate read-only
            Labour Details List table, instead of the old single grid where every line (including a
            not-yet-added one) was edited in place. Part lines are unchanged in substance (still
            auto-loaded read-only from Material Transfer, still no manual search/add row - the
            reference's own Part-adding row never applied to them here, see this module's
            2026-09-22 doc comment above) - only their table's look was restyled to match the
            reference's own Part Details List column set. */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--accent-2)', padding: '14px 16px', marginBottom: 18, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--accent-2)', fontWeight: 600 }}>
            <span>🔧</span><span>Labour</span>
            {labourRows.length > 0 && <span className="badge badge-success">{labourRows.length}</span>}
          </div>
        {/* 2026-09-22 ("only this div fix according to fetched data range that text box fix dont
            add extra space and after filled labour code which data fetch that will block its not
            editable" - see this module's own doc comment at the top of the file for the full
            reasoning): every field below is now sized to the data it actually holds, every
            wrapping div gets minWidth: 0, and Description locks (locked/disabled, grey) once a
            Labour code has actually been picked - typing a new search in the Labour field reopens
            it. */}
      <div style={{ overflowX: 'auto' }}>
        <div className="suggest-row" style={{ background: 'var(--surface-muted, #f8f9fa)', borderRadius: 8, padding: '10px 12px', flexWrap: 'nowrap' }}>
          <div className="field field-compact" style={{ minWidth: 0 }}>
            <label>Labour</label>
            <LabourSearchInput
              labours={labourOptionsForModel}
              locationSelected={!!location}
              value={draftLabour.itemCode}
              onChangeText={(text) => { setLabourFetched(false); setDraftLabour((p) => ({ ...p, itemCode: text })) }}
              onPick={pickLabourForDraft}
              placeholder="Labour code…"
              width={120}
            />
          </div>
          <div className="field field-grow" style={{ minWidth: 0, flex: '1 1 160px' }}>
            <label>Description</label>
            {labourFetched ? (
              <input
                value={draftLabour.itemDescription}
                readOnly
                disabled
                style={{ ...lockedFieldStyle, width: '100%' }}
                title="Fetched from the picked Labour code - not directly editable. Search a different Labour code to change it."
              />
            ) : (
              <LabourSearchInput
                labours={labourOptionsForModel}
                locationSelected={!!location}
                value={draftLabour.itemDescription}
                onChangeText={(text) => setDraftLabour((p) => ({ ...p, itemDescription: text }))}
                onPick={pickLabourForDraft}
                width={220}
              />
            )}
          </div>
          <div className="field field-compact" style={{ minWidth: 0 }}>
            <label>Qty</label>
            <input type="number" value={draftLabour.qty} onChange={(e) => setDraftLabour((p) => ({ ...p, qty: e.target.value }))} style={{ width: 48, textAlign: 'right' }} />
          </div>
          <div className="field field-compact" style={{ minWidth: 0 }}>
            <label>Rate</label>
            {labourFetched ? (
              <input
                value={draftLabour.rate}
                readOnly
                disabled
                style={{ ...lockedFieldStyle, width: 68, textAlign: 'right' }}
                title="Fetched from the picked Labour code - not editable. Search a different Labour code to change it."
              />
            ) : (
              <input
                type="number" value={draftLabour.rate}
                onChange={(e) => setDraftLabour((p) => ({ ...p, rate: e.target.value }))}
                style={{ width: 68, textAlign: 'right' }}
              />
            )}
          </div>
          <div className="field field-compact" style={{ minWidth: 0 }}>
            <label>Disc. Type</label>
            <select value={draftLabour.discountType} onChange={(e) => setDraftLabour((p) => ({ ...p, discountType: e.target.value as DiscountType }))} style={{ width: 64 }}>
              <option value="None">None</option>
              <option value="Percentage">%</option>
              <option value="Amount">₹</option>
            </select>
          </div>
          <div className="field field-compact" style={{ minWidth: 0 }}>
            <label>Discount</label>
            <input type="number" value={draftLabour.discountValue} onChange={(e) => setDraftLabour((p) => ({ ...p, discountValue: e.target.value }))} disabled={draftLabour.discountType === 'None'} style={{ width: 60, textAlign: 'right' }} />
          </div>
          <div className="field field-compact" style={{ minWidth: 0 }}>
            <label>Issue Type</label>
            <select value={draftLabour.issueType} onChange={(e) => setDraftLabour((p) => ({ ...p, issueType: e.target.value }))} style={{ width: 110 }} title={draftLabour.issueType || '— default —'}>
              <option value="">— default —</option>
              <option value="Paid">Paid</option>
              <option value="U/W">U/W</option>
              {/* <option value="FSC">FSC - Free Service Coupon (zero tax)</option> */}
            </select>
          </div>
          <div className="field field-compact" style={{ minWidth: 0, whiteSpace: 'nowrap' }}>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={commitLabourDraft}
              disabled={!draftLabour.itemCode.trim() || !draftLabour.itemDescription.trim()}
              title={!draftLabour.itemCode.trim() ? 'Pick a Labour code first.' : undefined}
            >
              {labourEditingKey ? 'Update' : '+ Add'}
            </button>
            {labourEditingKey && (
              <button className="btn btn-sm" type="button" onClick={resetDraftLabour} style={{ marginLeft: 6 }}>Cancel</button>
            )}
          </div>
        </div>
      </div>
        {vehicleModel && (
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }} title="Labour codes tagged for a different model are hidden - a code with no model tag on file still shows up regardless.">
            Labour codes filtered to {vehicleModel}
          </p>
        )}

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 70 }}>Action</th>
                <th>Sr.No</th>
                <th>Labour Code</th>
                <th>Description</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Rate</th>
                <th>HSN Code</th>
                <th className="text-end">Discount Amt.</th>
                <th>Disc.Type</th>
                <th className="text-end">CGST Amt.</th>
                <th className="text-end">SGST Amt.</th>
                <th className="text-end">IGST Amt.</th>
                <th className="text-end" title="Taxable + CGST + SGST + IGST for this line - recalculated live as you edit, finalized once you Save.">Net Amount</th>
              </tr>
            </thead>
            <tbody>
              {labourRows.map((it, i) => {
                const est = lineEstimate(it, taxMode, issueType)
                return (
                  <tr key={it.key} style={labourEditingKey === it.key ? { background: 'var(--surface-muted, #f8f9fa)' } : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-icon" type="button" onClick={() => startEditLabour(it)} title="Edit">✎</button>{' '}
                      <button className="btn btn-icon btn-danger" type="button" onClick={() => removeLabour(it.key)} title="Delete">✕</button>
                    </td>
                    <td>{i + 1}</td>
                    <td>{it.itemCode}</td>
                    <td>{it.itemDescription}</td>
                    <td className="text-end">{it.qty}</td>
                    <td className="text-end">₹{Number(it.rate || 0).toFixed(2)}</td>
                    <td>{it.hsnCode || '—'}</td>
                    <td className="text-end">₹{est.discountAmt.toFixed(2)}</td>
                    <td>{it.discountType === 'None' ? '—' : `${it.discountValue}${it.discountType === 'Percentage' ? '(%)' : '(RS)'}`}</td>
                    <td className="text-end">₹{est.cgstAmt.toFixed(2)}</td>
                    <td className="text-end">₹{est.sgstAmt.toFixed(2)}</td>
                    <td className="text-end">₹{est.igstAmt.toFixed(2)}</td>
                    <td className="text-end">₹{est.total.toFixed(2)}</td>
                  </tr>
                )
              })}
              {labourRows.length === 0 && (
                <tr><td colSpan={13} className="muted" style={{ textAlign: 'center', padding: 12 }}>No Labour lines added yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        </div>

        {/* 2026-09-22 ("in Part Details List with edit delete button also add and proper give me
            this page attractive page"): own bordered/accented panel matching Labour's above, plus
            a working Delete icon (see removePart's own doc comment above for what Delete actually
            does/doesn't affect - the underlying Material Transfer is never touched). */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--accent-3)', padding: '14px 16px', marginBottom: 18, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--warning)', fontWeight: 600 }}>
            <span>📦</span><span>Part Details List</span>
            {partRows.length > 0 && <span className="badge" style={{ background: 'var(--accent-3-soft)', color: 'var(--warning)' }}>{partRows.length}</span>}
          </div>

        {/* 2026-09-22: mirrors the real BAPL DMS reference's own onSelect() warning ("Material
            Transfer is not completed for this Job Card") - shown here once the for-job fetch has
            actually completed (mtFetchDone) so it never flashes during the initial load, and only
            when a Job is linked at all (jobCardId) and that fetch came back empty. Client-side only,
            derived from data already fetched below - no new backend flag invented for this. */}
        {jobCardId && mtFetchDone && materialTransferItems.length === 0 && (
          <p className="muted" style={{ color: '#b45309', margin: '0 0 10px' }}>
            ⚠ No Material Transfer found yet for this Job Card. Parts must be issued via Material
            Transfer first - they will appear here automatically once saved. You can still add
            Labour above.
          </p>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 64 }}>Action</th>
                <th>Sr.No</th>
                <th>Part No.</th>
                <th>Description</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Rate</th>
                <th>HSN Code</th>
                <th className="text-end">MRP</th>
                <th className="text-end">Discount</th>
                <th>Discount Type</th>
                <th className="text-end">CGST Amt.</th>
                <th className="text-end">SGST Amt.</th>
                <th className="text-end">IGST Amt.</th>
                <th className="text-end">Amount</th>
                <th>Issue Type</th>
                <th className="text-end">GST %</th>
              </tr>
            </thead>
            <tbody>
              {partRows.map((it, i) => {
                const est = lineEstimate(it, taxMode, issueType)
                const editing = editingPartKey === it.key
                return (
                  <tr key={it.key} style={editing ? { background: 'var(--surface-muted, #f8f9fa)' } : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {/* Only Discount Type/Discount Value/Issue Type are ever editable on a Part
                          row (Item Code/Description/HSN/Qty/Rate come straight from Material
                          Transfer, see this module's own doc comment). Delete (2026-09-22, "in
                          Part Details List with edit delete button also add") excludes this row
                          from the bill only - see removePart's own doc comment for exactly what it
                          does and doesn't affect; this is a deliberate departure from the
                          reference's own Edit-only Part Details List. */}
                      <button className="btn btn-icon" type="button" onClick={() => setEditingPartKey(editing ? null : it.key)} title={editing ? 'Done' : 'Edit Discount / Issue Type'}>
                        {editing ? '✓' : '✎'}
                      </button>{' '}
                      <button className="btn btn-icon btn-danger" type="button" onClick={() => removePart(it)} title="Remove from this bill">✕</button>
                    </td>
                    <td>{i + 1}</td>
                    <td>{it.itemCode}</td>
                    <td>{it.itemDescription}</td>
                    <td className="text-end" title="Qty transferred - see the Material Transfer Bill to change it.">{it.qty}</td>
                    <td className="text-end">₹{Number(it.rate || 0).toFixed(2)}</td>
                    <td>{it.hsnCode || '—'}</td>
                    <td className="text-end">{it.mrp ? `₹${Number(it.mrp).toFixed(2)}` : '—'}</td>
                    <td className="text-end">
                      {editing ? (
                        <input type="number" value={it.discountValue} onChange={(e) => updateItem(it.key, { discountValue: e.target.value })} disabled={it.discountType === 'None'} style={{ width: 80, textAlign: 'right' }} />
                      ) : (
                        `₹${est.discountAmt.toFixed(2)}`
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <select value={it.discountType} onChange={(e) => updateItem(it.key, { discountType: e.target.value as DiscountType })}>
                          <option value="None">None</option>
                          <option value="Percentage">%</option>
                          <option value="Amount">₹</option>
                        </select>
                      ) : (
                        it.discountType === 'None' ? '—' : it.discountType
                      )}
                    </td>
                    <td className="text-end">₹{est.cgstAmt.toFixed(2)}</td>
                    <td className="text-end">₹{est.sgstAmt.toFixed(2)}</td>
                    <td className="text-end">₹{est.igstAmt.toFixed(2)}</td>
                    <td className="text-end">₹{est.total.toFixed(2)}</td>
                    <td>
                      {editing ? (
                        <select value={it.issueType} onChange={(e) => updateItem(it.key, { issueType: e.target.value })}>
                          <option value="">— default —</option>
                          <option value="Paid">Paid (taxed)</option>
                          <option value="U/W">U/W - Under Warranty (zero tax)</option>
                          <option value="FSC">FSC - Free Service Coupon (zero tax)</option>
                        </select>
                      ) : (
                        it.issueType || `default (${issueType || '— none —'})`
                      )}
                    </td>
                    <td className="text-end">{it.gstPct}%</td>
                  </tr>
                )
              })}
              {partRows.length === 0 && (
                <tr><td colSpan={16} className="muted" style={{ textAlign: 'center', padding: 12 }}>No Part lines yet - these load automatically once a Material Transfer is saved for this Job.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <span className="muted">
            {zeroTaxLineCount > 0 && <>{zeroTaxLineCount} zero-tax line{zeroTaxLineCount > 1 ? 's' : ''} - </>}
            Estimated Total: <strong>₹{estimatedTotal.toFixed(2)}</strong>
          </span>
        </div>

        <div style={{ marginTop: 14 }}>
          <button className="btn btn-sm" onClick={() => setShowInsurance((v) => !v)}>{showInsurance ? '− Hide' : '+ Add'} Insurance / Discount / Payment Details</button>
        </div>
        {showInsurance && (
          <>
            <div className="form-row" style={{ marginTop: 10 }}>
              <div className="field">
                <label>Insurance Company</label>
                <input value={insuranceCompanyName} onChange={(e) => setInsuranceCompanyName(e.target.value)} />
              </div>
              <div className="field">
                <label>Claim Description</label>
                <input value={insuranceDescription} onChange={(e) => setInsuranceDescription(e.target.value)} />
              </div>
              <div className="field">
                <label>Policy No</label>
                <input value={policyNo} onChange={(e) => setPolicyNo(e.target.value)} />
              </div>
              <div className="field">
                <label>Insurance Valid Till</label>
                <input type="date" value={insuranceValidTill} onChange={(e) => setInsuranceValidTill(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Surveyor Name</label>
                <input value={surveyorName} onChange={(e) => setSurveyorName(e.target.value)} />
              </div>
              <div className="field">
                <label>Surveyor Contact No</label>
                <input value={surveyorContactNumber} onChange={(e) => setSurveyorContactNumber(e.target.value)} />
              </div>
              <div className="field">
                <label>Total Discount (₹)</label>
                <input type="number" value={totalDiscount} onChange={(e) => setTotalDiscount(e.target.value)} />
              </div>
              <div className="field">
                <label>Amount Received (₹)</label>
                <input type="number" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} />
              </div>
              <div className="field" style={{ justifyContent: 'flex-end' }}>
                <label>
                  <input type="checkbox" checked={zeroDepreciation} onChange={(e) => setZeroDepreciation(e.target.checked)} style={{ marginRight: 6 }} />
                  Zero Depreciation
                </label>
              </div>
            </div>
          </>
        )}

        <div style={{ marginTop: 14 }}>
          {/* 2026-09-22: relabelled from "Save Repair Bill" - this button always creates the bill
              as Performa (unchanged behaviour, see this file's own doc comment above for the full
              Proforma -> Invoice lifecycle); "Save as Invoice" is a separate later step from the
              list below, not a second button here. */}
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save as Proforma'}</button>
          {saveError && <p className="muted" style={{ color: '#b91c1c' }}>{saveError}</p>}
          {saveOk && <p className="muted" style={{ color: '#15803d' }}>{saveOk}</p>}
        </div>
      </div>

      {/* 2026-09-21 ("according /repair-bill-list do in our repair bill"): filter row matches the
          reference repair-bill-list.ts's own repairbillsearchModel (Date From/To, Service
          Location, Bill No, Job No, Chassis No) - see loadCombined's own doc comment for which
          data source each filter narrows. The Party Name filter (DMSBAPLDATA-only, pre-existing)
          stays, unrelated to the reference's own fields. */}
      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>Date From</label>
            <input type="date" value={listDateFrom} onChange={(e) => setListDateFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>Date To</label>
            <input type="date" value={listDateTo} onChange={(e) => setListDateTo(e.target.value)} />
          </div>
          <div className="field">
            <label>Service Location</label>
            {workshops.length > 0 ? (
              <select value={listLocation} onChange={(e) => setListLocation(e.target.value)}>
                <option value="">All locations</option>
                {workshops.map((w) => (
                  <option key={w.locCode} value={w.locCode}>{w.locCode} — {w.locName}</option>
                ))}
              </select>
            ) : (
              <input value={listLocation} onChange={(e) => setListLocation(e.target.value)} placeholder="Workshop location" />
            )}
          </div>
          <div className="field">
            <label>Bill No.</label>
            <input value={listBillNo} onChange={(e) => setListBillNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCombined()} placeholder="Enter Bill No." />
          </div>
          <div className="field">
            <label>Job No.</label>
            <input value={listJobNo} onChange={(e) => setListJobNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCombined()} placeholder="Enter Job No." />
          </div>
          <div className="field">
            <label>Chassis No.</label>
            <input value={listChassisNo} onChange={(e) => setListChassisNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCombined()} placeholder="Enter Chassis No." />
          </div>
          <div className="field">
            <label>Filter DMSBAPLDATA rows by Party Name</label>
            <input value={party} onChange={(e) => setParty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCombined()} placeholder="e.g. Zomato" />
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={loadCombined} disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
        {dmsError && <p className="muted" style={{ color: '#b91c1c' }}>DMSBAPLDATA rows unavailable: {dmsError}</p>}
      </div>

      {/* Column set matches the reference repair-bill-list.html: SR.No/Bill No/Date/Party Name/
          Reg No/ChassisNo/Location/Bill Type/Job No/Bill Amount/Status/Prepared by/Modified by,
          Action column first. Two differences from the reference, both disclosed rather than
          silently copied: this list blends TWO data sources (Source badge, since the reference's
          own list only ever shows BAPL DMS's own bills), and a row opens a read-only detail popup
          on click (see RecordDetailModal below) rather than navigating to an edit page - this app
          has no repair-bill edit screen, only status/delete actions, so "double-click to edit"
          from the reference has no equivalent here. */}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>SR.No</th>
              <th>Bill No</th>
              <th>Date</th>
              <th>Party Name</th>
              <th>Reg No</th>
              <th>Chassis No</th>
              <th>Location</th>
              <th>Bill Type</th>
              <th>Job No</th>
              <th className="text-end">Bill Amount</th>
              <th>Status</th>
              <th>Prepared by</th>
              <th>Modified by</th>
              {canDelete && <th></th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={r.id} onClick={() => setViewingBill(r)} style={{ cursor: 'pointer' }} title="Click to view full details">
                <td><span className={`badge ${r.source === 'JobCardScanner' ? 'badge-success' : 'badge-muted'}`}>{r.source}</span></td>
                <td>{((page - 1) * pageSize) + i + 1}</td>
                <td>{r.billNumber}</td>
                <td>{r.sortDate ? new Date(r.sortDate).toLocaleDateString('en-IN') : '—'}</td>
                <td>{r.partyName ?? '—'}</td>
                <td>{r.regNo ?? '—'}</td>
                <td>{r.chassisNo ?? '—'}</td>
                <td>{r.location ?? '—'}</td>
                <td>{r.billType ?? '—'}</td>
                <td>{r.jobNo ?? '—'}</td>
                <td className="text-end">₹{r.totalAmount.toFixed(2)}</td>
                <td>{r.status ?? '—'}</td>
                <td>{r.preparedBy ?? '—'}</td>
                <td>{r.modifiedBy ?? '—'}</td>
                {canDelete && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {r.source === 'JobCardScanner' && (
                      <button className="btn btn-icon btn-danger" onClick={() => deleteBill(r.id)} title="Delete (SystemAdmin only)">✕</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={canDelete ? 14 : 13} className="muted" style={{ textAlign: 'center', padding: 16 }}>No repair bills yet.</td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>

      {showJobSearch && <JobSearchModal onSelect={selectJob} onClose={() => setShowJobSearch(false)} />}

      {viewingBill && (
        <RecordDetailModal
          title={`Bill ${viewingBill.billNumber}`}
          subtitle={`${viewingBill.source}${viewingBill.location ? ` · ${viewingBill.location}` : ''}`}
          onClose={() => setViewingBill(null)}
          fields={[
            { label: 'Source', value: viewingBill.source },
            { label: 'Bill No', value: viewingBill.billNumber },
            { label: 'Date', value: viewingBill.sortDate ? new Date(viewingBill.sortDate).toLocaleDateString('en-IN') : null },
            { label: 'Party Name', value: viewingBill.partyName },
            { label: 'Reg No', value: viewingBill.regNo },
            { label: 'Chassis No', value: viewingBill.chassisNo },
            { label: 'Location', value: viewingBill.location },
            { label: 'Bill Type', value: viewingBill.billType },
            { label: 'Job No', value: viewingBill.jobNo },
            { label: 'Status', value: viewingBill.status },
            { label: 'Item Count', value: viewingBill.itemCount },
            { label: 'Total Amount', value: `₹${viewingBill.totalAmount.toFixed(2)}` },
            { label: 'Prepared By', value: viewingBill.preparedBy },
            { label: 'Modified By', value: viewingBill.modifiedBy },
          ]}
          itemsTitle="Items"
          itemColumns={billItemColumns}
          itemRows={billItemRows}
          actions={
            viewingBill.source === 'JobCardScanner' && viewingBill.status === 'Performa' ? (
              <button
                className="btn btn-primary btn-sm"
                disabled={convertingId === viewingBill.id}
                onClick={() => saveAsInvoice(viewingBill)}
              >
                {convertingId === viewingBill.id ? 'Saving…' : 'Save as Invoice'}
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
