import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsLabourRow, BaplDmsWorkshop, BaplItemMaster, JobSearchResult, LabourMasterPartwise, MaterialTransferItemForJob, RepairBillDoc, RepairBillDocItemType, RepairBillDocStatus } from '../../types'
import { JobSearchModal } from '../../components/JobSearchModal'
import { LabourSearchInput } from '../../components/LabourSearchInput'

/**
 * "Repair Bill" sidebar page (2026-09-19: "now i want Create Repair Bill and Material Transfer
 * Bill ... i want to now this both pages data i want save in JobCardScannerDb ... fetched data
 * both from DMSBAPLDATAConnection from this db repair bill and material transfer this both data
 * wants to show in 1 place"; corrected 2026-09-21, "backend logic which u gave u and ui same make
 * only according to our project dont chnage Repair Bill and Material tranfer logic"). Two parts:
 *  1. A create form that POSTs to /api/repair-bill-docs - saved into JobCardScanner's OWN
 *     database (RepairBillDocs/RepairBillDocItems), never into DMS or DMSBAPLDATA.
 *  2. A combined list below (GET /api/repair-bill-docs/combined) showing bills created here
 *     side-by-side with the existing read-only DMSBAPLDATA-synced repair bills - each row tagged
 *     with its Source so the two are never presented as if they were the same record.
 *
 * This is a NEW page/route, distinct from the existing read-only RepairBillPage.tsx ("Repair Bill
 * Report" in the sidebar) - that page and its route are unchanged.
 *
 * 2026-09-22 "in repiar bill save as proforma and after save as proforma then save as invoice that
 * same functionality we need to create in our jc" - the reference DMS app's own two-step bill
 * lifecycle. The create form's button below (now labelled "Save as Proforma") is unchanged
 * behaviour - it always creates the bill with Status=Performa server-side
 * (RepairBillDocsController.Create hard-codes this, ignoring any status the caller might send),
 * matching the reference's own "Save as Proforma" action. "Save as Invoice" is a SEPARATE, later
 * step against an EXISTING Proforma bill (not a second create-time button) - it lives in the
 * record-detail popup you get from clicking a row in the list below, calls the already-existing
 * `PUT /api/repair-bill-docs/{id}/status` endpoint (RepairBillDocsController.UpdateStatus - this
 * endpoint already existed in the backend but had no frontend caller anywhere in the app until
 * now) to move Status from Performa to Billed, and only appears for this app's own
 * (`source: 'JobCardScanner'`) bills that are still Performa - a DMSBAPLDATA-synced row or an
 * already-Billed/Cancelled bill shows no such button. This app still has no line-item EDIT screen
 * (see the "Column set" comment further down) - "Save as Invoice" finalizes the STATUS only, it
 * does not let you change Rate/Qty/GST/discount before finalizing; if the bill's own line items
 * were wrong, the only options today are re-entering a fresh bill or (SystemAdmin) deleting this
 * one - flagging this rather than silently building a fuller edit flow you didn't ask for.
 *
 * Corrected 2026-09-21: the backend no longer infers CGST+SGST-vs-IGST from Customer/Dealer State
 * (that guess never existed in the reference RepairBillRepo - it only persists whatever
 * Cgst/Sgst/Igst the CALLER already resolved). The "Tax Type" selector below is the same kind of
 * caller-side convenience the reference's own Angular UI had (resolving LabourMaster/
 * PartWiseLabour's stored rate into one pair before saving) - it runs here in the browser instead,
 * and the three independent CgstPct/SgstPct/IgstPct are sent explicitly per line, matching what
 * RepairBillDocItem now stores.
 *
 * Location is a dropdown scoped to the signed-in user's own accessible workshop location(s)
 * (profile.workLocationCodes via GET /api/bapl-dms/workshops?dealerId=...) - same scoped-picker
 * pattern already used on MaterialTransferCreatePage.tsx, not a free-text field.
 *
 * 2026-09-21 ("give me this and proper flow of this", modelled on the reference DMS app's own Job
 * Search modal + Part Name combo): "Job No" opens a Job Search picker (JobSearchModal, GET
 * /api/jobcards/search over this app's OWN JobCards - JobCardId is a local FK, not a raw DMS id)
 * - picking a job auto-fills Party Name/Reg No/Chassis No/Location and links JobCardId onto the
 * bill. Once Location is set (from the picked job, or chosen directly), each line's Item Code
 * AND Description are both a search-select against GET /api/bapl-dms/parts?locationCode=... (same
 * PartSearchInput component as MaterialTransferCreatePage.tsx, wired to both cells - "Item Code
 * not search when i type anything in textbox" 2026-09-21) instead of free-text fields.
 *
 * 2026-09-21 ("Labour - Rate + GST%(CGST,IGST,SGST) according to state Intra state and inter
 * state ... with discount" / "Part - Rate = MRP - GST%(CGST,IGST,SGST) .. BILL Creating (without
 * discount) - use all calculation part from dms"): re-verified against the actual pasted
 * repair-bill.ts (addLabour()/calculatePart()/calculateTotals()) and material-transfer.ts
 * (calculateGST()), not re-derived from paraphrase. What the reference actually does, confirmed:
 *  - EVERY line (Part or Labour) in the Repair Bill itself is taxed the SAME way: gross = qty x
 *    rate (rate already GST-exclusive, i.e. "taxable"), an optional discount (% or flat, defaults
 *    to none) reduces gross to a taxable amount, then CGST+SGST (same state) or IGST (different
 *    state) is added ON TOP of the taxable amount - never reverse-calculated out of it at this
 *    stage. This is what RepairBillDocsController.Create already does server-side; nothing about
 *    that arithmetic changes here. The "Part ... without discount" phrase does NOT mean the
 *    reference blocks discount on Part lines in the Repair Bill (calculatePart() takes the same
 *    optional item.discount/discountType as addLabour() does) - discount simply defaults to none
 *    on both line types unless entered, same as before.
 *  - Where Part and Labour genuinely differ is EARLIER, at Material Transfer time: a Part's Rate
 *    is derived ONCE, when the part is picked from stock, by reverse-calculating GST OUT of its
 *    GST-inclusive MRP (material-transfer.ts calculateGST: basePrice = mrp / (1 + gst% / 100)) -
 *    this is literally "Rate = MRP - GST%". That derived, GST-exclusive Rate is what then flows
 *    into the Repair Bill and gets taxed forward like any other line. Picking a part here via
 *    PartSearchInput reproduces that same reverse calc (see pickPartForLine below) using the
 *    line's own GST % (no confirmed per-part tax-rate source exists in this app - see
 *    PartSearchInput.tsx's doc comment - so GST % stays a manual/estimated per-line input,
 *    defaulted to 18% same as before).
 *  - "according to state Intra state and inter state": the reference determines this with a
 *    straight Dealer.State == Customer.State compare (repair-bill.ts's own isSameState), not
 *    anything more elaborate - now auto-detected below from GET /api/auth/me's DealerState vs the
 *    picked job's Customer.State (JobSearchResult.partyState), with the existing Tax Type
 *    dropdown left in place as a manual override for a standalone bill with no job/customer
 *    linked (where neither state is known).
 * 2026-09-21 second correction ("Issue Type - U/W and Paid ... give proper flow"): Issue Type is
 * now genuinely per LINE, not per bill - re-reading the reference confirmed RepairBillDetail.
 * IssutypeId is a detail-row column (RepairBillHeader has no IssueType column at all). The
 * bill-level Issue Type field is now only a default that prefills each new line (still editable
 * per line afterwards) - RepairBillDocItem/CreateRepairBillItemRequest both carry their own
 * IssueType now, and it (falling back to the bill-level value if a line's own is unset) is what
 * decides that line's own zero-tax treatment, matching the reference's own per-line behaviour.
 *
 * 2026-09-21 ("and if stock add available then that will add"): picking a part now records its
 * AvailableQty (from GET /api/bapl-dms/parts) on the line, and Qty is capped to it with an inline
 * warning if exceeded - same stock-limit guard as the reference's own onBlurQuantity ("Stock limit
 * exceeded. Please reduce the quantity."). Only enforced for a line whose Item Code came from a
 * picked stock row (a hand-typed Part not in PartsInventory, or a Labour line, has no stock figure
 * to check against).
 *
 * 2026-09-21 third correction ("GST % remove that was shown in IGST, CGST, SGST in this row
 * automatic fetch according this item code ... already linked with state so IGST, CGST, SGST
 * according that shown in repair bill also"): the GST % column is no longer a visible/editable
 * input - same removal as MaterialTransferCreatePage.tsx's own third 2026-09-21 correction, now
 * applied here too since CGST Amt/SGST Amt/IGST Amt already show the equivalent information per
 * line. The underlying gstPct STAYS on each line's state ("already linked with state") - it still
 * drives splitGst()/lineEstimate() exactly as before, defaulting to 18% (see PartSearchInput.tsx's
 * doc comment on why no confirmed per-part GST% source exists) - it just isn't a typed field
 * anymore, so it can't be hand-edited away from that default or the value derived when a Part-
 * Upload row is picked.
 *
 * 2026-09-21 fourth correction ("stock also shown from partuploads and in repair bill"): parts
 * uploaded via the "Part Upload" tab now merge into this page's own Item Code/Description search
 * too, alongside the live DMS PartsInventory list - same treatment as
 * MaterialTransferCreatePage.tsx's own fifth 2026-09-21 correction (BalQty as AvailableQty,
 * BillPrice as Rate directly, tagged "Uploaded" in the dropdown - see pickPartForLine below).
 *
 * 2026-09-22 REPLACED BY THE CORRECTION BELOW - kept only for history: everything above about a
 * manual Item Code/Description PART search (PartSearchInput, dmsParts/uploadedParts/
 * itemMasterByCode/itemMasterCatalog/pickPartForLine) was REMOVED this round. Labour is still a
 * manual search-and-add (unchanged, see pickLabourForLine below).
 *
 * 2026-09-22 ("now i saved from material transfer bill now this will shown in repair bill with
 * which i material transfer and from repair bill we can add only labour from labour master in
 * dropdown and that will add save as proforma" + you pasted the REAL DMS reference source -
 * RepairBillController.cs/RepairBillRepo.cs, repair-bill.ts/.html, repair-bill-list.ts/.html,
 * repair-bill-invoice.ts/.html): this is a confirmed architecture correction, not an
 * interpretation - the pasted repair-bill.html's own Part search UI is commented out entirely
 * (`<!-- <ul *ngIf="showPartDropdown" ...> -->`), and repair-bill.ts's loadMaterialedJobCardList()
 * (called from onSelect() the moment a Job is picked) is what actually populates the reference's
 * Part Details List - straight from whatever Material Transfer already saved against that job
 * (jobCardService.getMaterialedJobCardList(jobId, dealerCode)), never from a live parts search
 * inside Repair Bill itself. Only Labour has a real search-and-add flow there (addLabour()).
 *
 * This page now mirrors that: once a Job is linked (jobCardId set, via Search Job same as before),
 * a new effect fetches GET /api/material-transfer-docs/for-job/{jobCardId} (every non-Cancelled
 * Material Transfer item already saved against this job - see MaterialTransferDocsController.
 * ForJob's doc comment) and turns each into a read-only Part row in the grid below: Item Code/
 * Description/HSN/Qty/Rate come straight from that Material Transfer line (Rate already reflects
 * SECTION 64's C_ItemMaster-driven calculation from when it was transferred - not recomputed here),
 * while Discount Type/Discount Value/Issue Type stay editable per line, matching the reference's
 * own editPart()/updatePart() (edit only, no delete - Part rows have no ✕ here either, since they
 * represent parts that were physically transferred, not something this bill invents). GST% for the
 * CGST/SGST/IGST split still comes from a fresh C_ItemMaster by-codes lookup (SGST/CGST/IGST aren't
 * stored on MaterialTransferDocItem - see that model's doc comment), same source Material Transfer
 * itself used, just fetched again since the split isn't persisted there.
 *
 * The "+ Add Line" button (and the whole itemType Part/Labour picker) is GONE - every manually
 * added line is now always Labour (addLabour()'s reference equivalent), searched via
 * LabourSearchInput exactly as before. A standalone bill with no Job linked simply has no Part rows
 * at all (nothing to auto-load), matching the reference (Part Details List only ever renders after
 * onSelect() runs loadMaterialedJobCardList()).
 *
 * 2026-09-22 ("in labour after jobcard serach this automatically details fetch then we adding
 * labour details see screenshot that type add ui and all", two screenshots of the real reference
 * /repair-bill page pasted alongside - Date/Location/Prefix/Bill No/Bill Type/Cash Account/Party
 * Name/Mobile Number/Party State/Job Search header, a "Selected Job Details" panel, a Labour
 * staging row + Labour Details List table, and a separate Part Details List table): the single
 * inline-edit grid this page had before (every line, including a not-yet-added one, edited
 * in-place in one table) is REPLACED by the reference's own two-part pattern, confirmed via
 * AskUserQuestion ("Redesign both Labour and Part display" - the alternative of leaving Part
 * display untouched was offered and NOT chosen):
 *  - Labour: a dedicated staging row (draftLabour state) mirrors the reference's addLabour()/
 *    editLabour() - Labour search, Description, Qty, Rate, Disc. Type, Discount, Issue Type, then
 *    +Add (or Update, once a row's own pencil icon is clicked - labourEditingKey tracks which).
 *    Committing pushes/updates one entry in `items` (still the same array shape saved to the
 *    backend - see save() below, unchanged) and resets the staging row. The Labour Details List
 *    table below it is now purely READ-ONLY display + Edit/Delete icons, not editable cells.
 *  - Part: still auto-loaded read-only from Material Transfer (unchanged data/effect above - the
 *    reference's own Part-adding row never applied here, since this app's Parts always come from a
 *    saved Material Transfer, never a live search inside Repair Bill itself). Only its TABLE was
 *    restyled into its own separate "Part Details List", matching the reference's column set
 *    (Action/Sr.No/Part No./Description/Qty/Rate/HSN Code/MRP/Discount/Discount Type/CGST Amt./
 *    SGST Amt./IGST Amt./Amount/Issue Type/GST %) - minus "FOC Rate", which the reference shows but
 *    this app's data model has no equivalent column for (RepairBillDocItem has no FOC concept) -
 *    omitted rather than faked. Its Edit icon toggles just Discount/Issue Type into inline inputs
 *    on that one row (the only fields ever editable on a Part line); there is still no Delete icon
 *    for a Part row, matching the reference exactly.
 */
type TaxMode = 'Same State (CGST+SGST)' | 'Different State (IGST)'
type DiscountType = 'None' | 'Percentage' | 'Amount'

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
  const { profile } = useStaffAuth()
  const navigate = useNavigate()

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
  // 2026-09-23 ("not added grid button on this clcik open material transfered job cards history" -
  // the THIRD restatement of "add grid button ... job card shown which will transfer from material
  // transfer to save as proforma using adding labour details", after two rounds that missed the
  // mark): a SEPARATE picker from "Search Job" above - opens the same JobSearchModal but with
  // onlyWithMaterialTransfer set, so the grid it shows is scoped to job cards that already have a
  // Material Transfer saved. Selecting a row calls the SAME selectJob() as "Search Job" - once
  // picked, this page's own existing sync effect auto-loads that job's Material Transfer Parts (as
  // it already does for any linked job), so all that's left is adding Labour below and Save as
  // Proforma - exactly the flow described.
  const [showMtJobGrid, setShowMtJobGrid] = useState(false)
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

  // 2026-09-23 ("this grid button click from db which material transfer that will shown for Save
  // as proforma and save as invoice" - confirmed via video against the reference DMS app's own
  // repair-bill/{id} page, chosen via AskUserQuestion over leaving the read-only popup as-is):
  // clicking a JobCardScanner-own bill that's still Performa in the list below now reopens THIS
  // SAME create form, pre-filled, instead of only a read-only popup - see startEditBill below.
  // null means "creating a brand-new bill" (this form's original, unchanged behaviour); set means
  // "editing an existing Performa bill" - save() branches to PUT instead of POST accordingly.
  const [editingBillId, setEditingBillId] = useState<string | null>(null)
  const [editingBillNumber, setEditingBillNumber] = useState<string | null>(null)
  const [editingBillStatus, setEditingBillStatus] = useState<RepairBillDocStatus | null>(null)
  const [editLoadError, setEditLoadError] = useState<string | null>(null)
  // 2026-09-23 - populated once by startEditBill below (matched by itemType+itemCode, since a
  // saved RepairBillDocItem has no MaterialTransferDocItem.Id of its own to match on) so the
  // materialTransferItems sync effect further down can best-effort restore a Part/Labour line's
  // Discount/Issue Type after Parts re-derive fresh from the job's CURRENT Material Transfer -
  // see that effect's own doc comment for the full reasoning. A plain {} outside of editing, so
  // this has zero effect on the normal create-a-new-bill flow. Cleared whenever a fresh/different
  // bill starts being edited (or editing is cancelled / a new bill starts), so a stale snapshot
  // never leaks one bill's Discount/Issue Type onto a different job's Parts that happen to share
  // an item code.
  const editSnapshotByCodeRef = useRef<Record<string, { discountType: DiscountType; discountValue: string; issueType: string }>>({})
  // 2026-09-23 - true right after startEditBill restores a bill's saved Labour lines as manual
  // rows; the dedupe effect further down (after materialTransferItems/mtFetchDone) flips it back
  // to false once it's run, so it only ever fires once per edit, not on every future change to
  // this job's Material Transfer during normal use.
  const dedupeLabourAfterEditRef = useRef(false)

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
  // 2026-09-22 ("which labour we added from amterial transfer ... that also going in repair
  // bill"): same exclusion mechanism as removePart above, for a Labour row synced in from
  // Material Transfer (see the materialTransferItems sync effect below) - reuses the SAME
  // excludedPartKeys set (both Part and Labour synced rows are keyed by their own
  // MaterialTransferDocItem.Id, so there's no collision) rather than a second Set, since the
  // reason for excluding is identical: without it, the next sync effect run would silently bring
  // a removed row back.
  const removeMtLabour = (it: DraftItem) => {
    if (!window.confirm(`Remove Labour "${it.itemDescription}" from this bill? The Material Transfer record itself is unaffected - this only excludes it from this Repair Bill.`)) return
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
  const resetDraftLabour = () => { setDraftLabour(emptyItem('draft', issueType)); setLabourEditingKey(null) }
  const startEditLabour = (it: DraftItem) => { setDraftLabour({ ...it }); setLabourEditingKey(it.key) }
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
    const codes = Array.from(new Set(materialTransferItems.filter((m) => m.itemType !== 'Labour').map((m) => m.itemCode.trim().toUpperCase()).filter(Boolean)))
    if (codes.length === 0) { setMtItemMasterByCode({}); return }
    staffApi.get<BaplItemMaster[]>('/api/item-master/by-codes', { params: { codes: codes.join(',') } })
      .then(({ data }) => {
        const byCode: Record<string, BaplItemMaster> = {}
        data.forEach((im) => { byCode[im.itemCode.trim().toUpperCase()] = im })
        setMtItemMasterByCode(byCode)
      })
      .catch(() => setMtItemMasterByCode({}))
  }, [materialTransferItems])

  // 2026-09-22 ("that also going in repair bill"): the SAME "no tax columns stored on
  // MaterialTransferDocItem" gap as above, but for a synced LABOUR row - C_ItemMaster (a Part
  // catalog) has no row for a Labour Code, so a separate fresh-by-code lookup against Labour
  // Master Partwise itself (GET /api/material-transfer-docs/labour-by-codes) is needed to recover
  // its real IGST/CGST/SGST, instead of always falling back to the generic 9/9/18 default.
  const [mtLabourGstByCode, setMtLabourGstByCode] = useState<Record<string, LabourMasterPartwise>>({})
  useEffect(() => {
    const codes = Array.from(new Set(materialTransferItems.filter((m) => m.itemType === 'Labour').map((m) => m.itemCode.trim().toUpperCase()).filter(Boolean)))
    if (codes.length === 0) { setMtLabourGstByCode({}); return }
    staffApi.get<LabourMasterPartwise[]>('/api/material-transfer-docs/labour-by-codes', { params: { codes: codes.join(',') } })
      .then(({ data }) => {
        const byCode: Record<string, LabourMasterPartwise> = {}
        data.forEach((l) => { byCode[l.labourCode.trim().toUpperCase()] = l })
        setMtLabourGstByCode(byCode)
      })
      .catch(() => setMtLabourGstByCode({}))
  }, [materialTransferItems])

  // Turns the loaded Material Transfer items into read-only Part/Labour rows in `items`, replacing
  // whatever synced rows were there before (there can only ever be one set, always sourced from
  // this same job) while leaving every manually-added Labour row untouched. Keyed by each row's
  // own MaterialTransferDocItem.Id, so a Discount/Issue Type the user already edited on a
  // still-present row survives a re-fetch (e.g. after adding another Material Transfer for the
  // same job).
  //
  // 2026-09-22 ("which labour we added from amterial transfer for Issue Type - Paid that will
  // goin for paid type and which are in U/w that was going in U/w that also going in repair
  // bill"): now branches on m.itemType instead of assuming every synced row is a Part - a Labour
  // row from Material Transfer's own new "Labour" picker becomes a Labour-type DraftItem here
  // (fromMaterialTransfer: true, same as a Part), landing in labourRows below alongside any
  // manually-added Labour lines. Its Issue Type is whatever Material Transfer's own per-line
  // Issue Type resolved to (m.issueType) - MaterialTransferCreatePage.tsx's own
  // updatePartIssueType already makes that value follow the governing Part row there, so no
  // separate propagation logic is needed on this side; this effect only reads what Material
  // Transfer already decided.
  useEffect(() => {
    setItems((prev) => {
      const manual = prev.filter((i) => !i.fromMaterialTransfer)
      const mtRows: DraftItem[] = materialTransferItems.filter((m) => !excludedPartKeys.has(m.id)).map((m) => {
        const isLabour = m.itemType === 'Labour'
        let sgstPct: number, cgstPct: number, igstPct: number
        if (isLabour) {
          const lm = mtLabourGstByCode[m.itemCode.trim().toUpperCase()]
          sgstPct = lm?.sgst != null ? lm.sgst * 100 : 9
          cgstPct = lm?.cgst != null ? lm.cgst * 100 : 9
          igstPct = lm?.igst != null ? lm.igst * 100 : 18
        } else {
          const im = mtItemMasterByCode[m.itemCode.trim().toUpperCase()]
          sgstPct = im?.sgst ?? 9
          cgstPct = im?.cgst ?? 9
          igstPct = im?.igst ?? 18
        }
        const totalGst = sgstPct + cgstPct > 0 ? sgstPct + cgstPct : igstPct
        const existing = prev.find((i) => i.key === m.id)
        // 2026-09-23 (reopening an existing Performa bill for editing - see startEditBill's own
        // doc comment): `existing` is only ever set from THIS SAME session's own prior state, so
        // it's always empty the first time this effect runs right after a bill is loaded for
        // editing - Discount/Issue Type customizations that bill had saved would otherwise be
        // silently lost (reset to None/0/default) the moment its Parts re-derive from Material
        // Transfer. editSnapshotByCodeRef (populated once by startEditBill, matched by
        // itemType+itemCode since a saved RepairBillDocItem has no MaterialTransferDocItem.Id of
        // its own to match on) is a best-effort fallback for exactly that gap - a plain {} outside
        // of editing, so this has zero effect on the normal create-a-new-bill flow.
        const snap = editSnapshotByCodeRef.current[`${isLabour ? 'Labour' : 'Part'}:${m.itemCode.trim().toUpperCase()}`]
        return {
          key: m.id,
          itemType: isLabour ? 'Labour' : 'Part',
          itemCode: m.itemCode,
          itemDescription: m.itemDescription,
          hsnCode: m.hsnCode || '',
          qty: String(m.qty),
          rate: String(m.rate),
          mrp: !isLabour && m.mrp != null ? String(m.mrp) : '',
          gstPct: String(totalGst),
          discountType: existing?.discountType ?? snap?.discountType ?? 'None',
          discountValue: existing?.discountValue ?? snap?.discountValue ?? '0',
          issueType: existing?.issueType ?? snap?.issueType ?? (m.issueType || ''),
          fromMaterialTransfer: true,
        }
      })
      return [...mtRows, ...manual]
    })
  }, [materialTransferItems, mtItemMasterByCode, mtLabourGstByCode, excludedPartKeys])

  // 2026-09-23 - runs once right after startEditBill re-links a bill's Job (dedupeLabourAfterEditRef
  // flips true there). startEditBill restores every Labour line the bill had saved as a manual
  // row (see its own doc comment for why Part lines are handled differently) without knowing yet
  // which of those originally came from THIS job's Material Transfer - so once the fresh
  // Material Transfer fetch for that job actually settles (mtFetchDone), any restored manual
  // Labour row whose code matches a Labour line Material Transfer is ALSO currently supplying is
  // dropped, leaving the fresh Material-Transfer-sourced row (which the sync effect above already
  // added) as the only copy instead of showing both.
  useEffect(() => {
    if (!dedupeLabourAfterEditRef.current || !mtFetchDone) return
    dedupeLabourAfterEditRef.current = false
    const mtLabourCodes = new Set(
      materialTransferItems.filter((m) => m.itemType === 'Labour').map((m) => m.itemCode.trim().toUpperCase()),
    )
    if (mtLabourCodes.size === 0) return
    setItems((prev) => prev.filter((it) => !(it.itemType === 'Labour' && !it.fromMaterialTransfer && mtLabourCodes.has(it.itemCode.trim().toUpperCase()))))
  }, [mtFetchDone, materialTransferItems])

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
   * below) - no separate tax model needed for Labour vs Part lines. */
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

  // 2026-09-23 ("also block all withour job search"): Party Name/Reg No/Chassis No/Location are no
  // longer hand-editable in EITHER state (see the JSX further down) - auto-filled and read-only
  // once a Job is linked (unchanged), and now BLOCKED (disabled, not just "editable again") once
  // it's unlinked too, rather than handing manual entry back the way this page used to support a
  // standalone/walk-in bill. Since there is no other way left to clear them, unlinking the Job now
  // also resets these four back to blank/default here, the same fix MaterialTransferCreatePage.tsx
  // already needed for its own Party field once IT became always-disabled.
  const clearJob = () => {
    setJobCardId(null); setJobCardNumber(''); setPartyState(null); setVehicleModel(null)
    setJobDate(null); setOdometer(null); setTechnician(null)
    setPartyName(''); setRegNo(''); setChassisNo('')
    setLocation(workshops.length > 0 ? workshops[0].locCode : '')
    // 2026-09-23 - unlinking the Job while editing an existing bill leaves nothing left to save
    // against (this page has required a Job for every bill since the earlier "also block all
    // withour job search" change), so it also cancels the edit rather than leaving editingBillId
    // pointed at a bill whose form no longer matches it.
    setEditingBillId(null); setEditingBillNumber(null); setEditingBillStatus(null); setEditLoadError(null)
    editSnapshotByCodeRef.current = {}
  }

  // 2026-09-23 - shared by a fresh save() success and cancelEdit() below: resets every field back
  // to this form's own empty/default state, exactly what save() already did on success before
  // editing existed. Kept separate from clearJob() (which stays scoped to just "unlink the Job")
  // so a plain unlink doesn't also blank Bill Type/Remarks/insurance fields.
  const resetFormToNew = () => {
    clearJob()
    setBillType('Cash'); setIssueType(''); setRemarks('')
    setInsuranceCompanyName(''); setInsuranceDescription(''); setSurveyorName(''); setSurveyorContactNumber('')
    setPolicyNo(''); setInsuranceValidTill(''); setZeroDepreciation(false); setTotalDiscount('0'); setAmountReceived('0')
    setBillDate(new Date().toISOString().slice(0, 10))
    nextManualKeyRef.current = 2
    setItems([])
    resetDraftLabour()
    setEditingPartKey(null)
  }

  // 2026-09-23 ("this grid button click from db which material transfer that will shown for Save
  // as proforma and save as invoice" - see this page's own doc comment above for the full video-
  // confirmed reasoning): reopens an existing JobCardScanner-own, still-Performa bill as THIS SAME
  // form, pre-filled, so it can be edited and re-saved (Update Proforma) or finalized (Save as
  // Invoice) right here - instead of only the read-only popup a click used to always open.
  //
  // Party Name/Reg No/Chassis No/Location are restored straight from the bill (they're `readOnly`
  // regardless of source, see the JSX further down) rather than needing the Job re-fetch below.
  // The "Selected Job Details" panel's own extra fields (Job Date/Model/KMs/Technician) and
  // Party State (for taxMode) genuinely only live on the Job itself, not on the saved bill, so
  // they're re-fetched via the same GET /api/jobcards/search this page's own Job Search modal
  // already uses, filtered to this bill's own JobCardNumber.
  //
  // Part lines are DELIBERATELY NOT restored from the bill's own saved items - they re-derive
  // fresh from the job's CURRENT Material Transfer via the existing sync effect above, exactly
  // like a brand-new bill would (this is the literal "pull from Material Transfer in the DB"
  // behaviour the video showed, not a replay of what this bill happened to save previously, which
  // may be stale if more was transferred since). Only Labour lines are restored from the bill's
  // own saved items (a Labour line can also be added by hand here, independent of Material
  // Transfer, and that would otherwise be lost) - restored as manual/editable rows, then
  // deduplicated against whatever the fresh Material Transfer fetch actually returns (see the
  // dedupe effect above) so a Labour line that WAS Material-Transfer-sourced doesn't show twice.
  // A Part/Labour line's own saved Discount/Issue Type is best-effort restored via
  // editSnapshotByCodeRef (matched by item code) once Parts re-derive - see that ref's own doc
  // comment for why this is best-effort, not guaranteed.
  // 2026-09-23 ("this main in 1 page not on same"): the combined list this used to be called from
  // directly (row click / ✎ button, passing a whole CombinedRepairBillRow) moved out to its own
  // page (RepairBillListPage.tsx, route /repair-bill-list) - it now navigates here instead, to
  // `/repair-bill-new?editId={id}`, and THIS page reads that query param on mount (see the
  // useEffect right after this function) and calls startEditBill(id) itself. Signature narrowed
  // from a full CombinedRepairBillRow down to just the id it always actually used.
  const startEditBill = (id: string) => {
    setSaveError(null); setSaveOk(null); setEditLoadError(null)
    staffApi.get<RepairBillDoc>(`/api/repair-bill-docs/${id}`)
      .then(({ data: bill }) => {
        setEditingBillId(bill.id)
        setEditingBillNumber(bill.billNumber)
        setEditingBillStatus(bill.status)

        setBillType(bill.billType || 'Cash')
        setIssueType(bill.issueType || '')
        setBillDate(bill.billDate ? bill.billDate.slice(0, 10) : new Date().toISOString().slice(0, 10))
        setRemarks(bill.remarks || '')
        setPartyName(bill.partyName)
        setRegNo(bill.regNo || '')
        setChassisNo(bill.chassisNo || '')
        setLocation(bill.location || '')
        setInsuranceCompanyName(bill.insuranceCompanyName || '')
        setInsuranceDescription(bill.insuranceDescription || '')
        setSurveyorName(bill.surveyorName || '')
        setSurveyorContactNumber(bill.surveyorContactNumber || '')
        setPolicyNo(bill.policyNo || '')
        setInsuranceValidTill(bill.insuranceValidTill ? bill.insuranceValidTill.slice(0, 10) : '')
        setZeroDepreciation(bill.zeroDepreciation)
        setTotalDiscount(String(bill.totalDiscount))
        setAmountReceived(String(bill.amountReceived))
        setShowInsurance(!!(bill.insuranceCompanyName || bill.policyNo || bill.surveyorName))

        const snapshot: Record<string, { discountType: DiscountType; discountValue: string; issueType: string }> = {}
        bill.items.forEach((it) => {
          snapshot[`${it.itemType}:${it.itemCode.trim().toUpperCase()}`] = {
            discountType: (it.discountType as DiscountType) || 'None',
            discountValue: String(it.discountValue),
            issueType: it.issueType || '',
          }
        })
        editSnapshotByCodeRef.current = snapshot

        const restoredLabour: DraftItem[] = bill.items
          .filter((it) => it.itemType === 'Labour')
          .map((it, idx) => ({
            key: `edit-${idx}`,
            itemType: 'Labour',
            itemCode: it.itemCode,
            itemDescription: it.itemDescription,
            hsnCode: it.hsnCode || '',
            qty: String(it.qty),
            rate: String(it.rate),
            mrp: '',
            gstPct: String((it.cgstPct || 0) + (it.sgstPct || 0) > 0 ? (it.cgstPct || 0) + (it.sgstPct || 0) : (it.igstPct || 0)),
            discountType: (it.discountType as DiscountType) || 'None',
            discountValue: String(it.discountValue),
            issueType: it.issueType || '',
            fromMaterialTransfer: false,
          }))
        nextManualKeyRef.current = restoredLabour.length + 2
        setExcludedPartKeys(new Set())
        setEditingPartKey(null)
        resetDraftLabour()

        if (bill.jobCardId) {
          dedupeLabourAfterEditRef.current = restoredLabour.length > 0
          setItems(restoredLabour)
          setJobCardId(bill.jobCardId)
          setJobCardNumber(bill.jobCardNumber || '')
          staffApi.get<JobSearchResult[]>('/api/jobcards/search', { params: { jobNo: bill.jobCardNumber || undefined } })
            .then(({ data }) => {
              const job = data.find((j) => j.id === bill.jobCardId) ?? data[0]
              if (!job) return
              setPartyState(job.partyState ?? null)
              setVehicleModel(job.vehicleType || null)
              setJobDate(job.jobDate || null)
              setOdometer(job.odometer ?? null)
              setTechnician(job.technician || null)
            })
            .catch(() => { /* non-fatal - the "Selected Job Details" panel just stays partly blank */ })
        } else {
          // Pre-2026-09-23 bills could be saved with no Job linked at all - this page can no
          // longer SAVE further changes to one (the Save button stays disabled without a Job,
          // same as for a brand-new bill), but it's still opened here read-into-the-form so its
          // fields are at least visible/reviewable rather than refusing to open it.
          dedupeLabourAfterEditRef.current = false
          setJobCardId(null); setJobCardNumber(''); setPartyState(null); setVehicleModel(null)
          setJobDate(null); setOdometer(null); setTechnician(null)
          setItems(restoredLabour)
        }

        window.scrollTo({ top: 0, behavior: 'smooth' })
      })
      .catch((err) => setEditLoadError(err?.response?.data?.message ?? `Could not load Bill ${id} for editing.`))
  }

  // 2026-09-23 ("this main in 1 page not on same") - opens this page already in edit mode when
  // arrived at via /repair-bill-new?editId={id} (the List page's own Edit navigation, above).
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const editId = searchParams.get('editId')
    if (editId) startEditBill(editId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const cancelEdit = () => { resetFormToNew(); setEditLoadError(null) }

  const save = () => {
    setSaveError(null)
    setSaveOk(null)
    if (!partyName.trim()) { setSaveError('Party Name is required.'); return }
    const validItems = items.filter((i) => i.itemDescription.trim() && Number(i.qty) > 0)
    if (validItems.length === 0) { setSaveError('Add at least one item/labour line with a description and quantity.'); return }

    const body = {
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
    }

    setSaving(true)
    // 2026-09-23 - editingBillId set means startEditBill above loaded an existing Performa bill:
    // PUT updates it IN PLACE (same bill, same Bill No) instead of POSTing a new one. The form is
    // deliberately NOT reset to blank on a successful update (unlike a fresh create, right below) -
    // staying on this same bill is what lets "Save as Invoice" immediately follow without having
    // to re-open it.
    const request = editingBillId
      ? staffApi.put(`/api/repair-bill-docs/${editingBillId}`, body)
      : staffApi.post('/api/repair-bill-docs', body)

    request
      .then((r) => {
        if (editingBillId) {
          setSaveOk(`Updated ${r.data.billNumber}.`)
        } else {
          setSaveOk(`Saved as ${r.data.billNumber}.`)
          resetFormToNew()
        }
        // 2026-09-23 - loadCombined() removed: the list now lives on its own page
        // (RepairBillListPage.tsx / /repair-bill-list), which re-fetches on its own mount.
      })
      .catch((err) => setSaveError(err?.response?.data?.message ?? `Could not ${editingBillId ? 'update' : 'save'} the repair bill.`))
      .finally(() => setSaving(false))
  }

  // 2026-09-23 - "Save as Invoice" reachable directly from the reopened edit form (matching the
  // reference DMS app's own repair-bill/{id} page, which has both actions on the same screen),
  // alongside the existing read-only-popup version of this same action (saveAsInvoice below,
  // unchanged, still used for a bill opened via the list's read-only view). Deliberately a
  // separate small function rather than reusing saveAsInvoice as-is - that one is keyed to
  // `viewingBill` (the read-only popup's own state), which is null while editing here.
  const finalizeEditingBillAsInvoice = () => {
    if (!editingBillId || !editingBillNumber) return
    if (!window.confirm(`Save Bill ${editingBillNumber} as Invoice? This finalizes it - line items can no longer be changed afterwards.`)) return
    setConvertingId(editingBillId)
    staffApi
      .put(`/api/repair-bill-docs/${editingBillId}/status`, JSON.stringify('Billed'), { headers: { 'Content-Type': 'application/json' } })
      .then(() => {
        setEditingBillStatus('Billed')
        setSaveOk(`Bill ${editingBillNumber} saved as Invoice.`)
        // 2026-09-23 - loadCombined() removed: see note on the save() handler above.
      })
      .catch((err) => alert(err?.response?.data?.message ?? 'Could not save this bill as an Invoice.'))
      .finally(() => setConvertingId(null))
  }

  // 2026-09-23 ("this main in 1 page not on same only which are save in jobcard db that in grid
  // button and which material transfer that jobcard"): the combined list (this app's own bills +
  // DMSBAPLDATA-synced ones), its filters, pagination, Delete, and the read-only detail popup all
  // moved OUT of this page onto their own separate page - see RepairBillListPage.tsx (route
  // /repair-bill-list) for all of that, confirmed via AskUserQuestion ("Android + Web: both get a
  // separate list screen/page" + "JobCardScanner rows only"). This page is now the create/edit
  // FORM only. `convertingId` stays here (below) since finalizeEditingBillAsInvoice (this page's
  // own "Save as Invoice" button while editing) still needs it - it's unrelated to the list.
  const [convertingId, setConvertingId] = useState<string | null>(null)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Repair Bill</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/repair-bill-list')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden="true">☰</span>Repair Bill List
        </button>
      </div>
      <p className="muted">
        Create a repair bill - saved into JobCardScanner's own database. To see bills already saved
        here (with Edit / Save as Invoice), use "View Repair Bill List" above.
      </p>

      <div className="card">
        {/* 2026-09-23 ("this grid button click from db which material transfer that will shown
            for Save as proforma and save as invoice"): this same card/form now doubles as the
            edit view for an existing Performa bill - see startEditBill's own doc comment above.
            editLoadError surfaces if that fetch itself fails (e.g. the bill was deleted by
            someone else a moment before the click landed). */}
        {editingBillId ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Editing Bill {editingBillNumber} <span className="badge badge-muted" style={{ marginLeft: 6 }}>{editingBillStatus}</span></h3>
            <button className="btn btn-sm" type="button" onClick={cancelEdit}>✕ Cancel edit / start a new bill</button>
          </div>
        ) : (
          <h3>New Repair Bill</h3>
        )}
        {editLoadError && <p className="muted" style={{ color: '#b91c1c' }}>{editLoadError}</p>}
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
              {/* 2026-09-23 - the "grid button": opens a picker scoped to job cards that already
                  have a Material Transfer saved (see showMtJobGrid's own doc comment above). */}
              <button className="btn btn-sm btn-icon" onClick={() => setShowMtJobGrid(true)} type="button" title="Browse job cards with a Material Transfer">🔲</button>
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
            recap - these are the actual fields saved on the bill).
            2026-09-23 ("also block all withour job search") SUPERSEDES this field's own "Unlinking
            the Job hands editing back for a standalone bill" behaviour: these four no longer
            become editable again once the Job is unlinked either - they're locked in BOTH states
            now (autoFilledFromJob === !!jobCardId, so `true` below covers "read-only, auto-filled"
            when linked and "blocked, not yet fillable" when not), matching the same all-fields-
            need-a-Job-first gate now applied throughout this page. A standalone/no-job Repair Bill
            can therefore no longer be created - flagged here as a real, deliberate behaviour change
            from what this page supported before, not a silent side effect. clearJob() (above) now
            resets these four to blank/default on unlink, since there's no other way left to clear
            them. */}
        <div className="form-row">
          <div className="field">
            <label>Party Name *</label>
            <input
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              placeholder="Customer or fleet party name"
              readOnly
              title={autoFilledFromJob ? 'Auto-filled from the linked Job.' : 'Search and link a Job above to fill this in.'}
            />
          </div>
          <div className="field">
            <label>Reg No</label>
            <input
              value={regNo}
              onChange={(e) => setRegNo(e.target.value)}
              readOnly
              title={autoFilledFromJob ? 'Auto-filled from the linked Job.' : 'Search and link a Job above to fill this in.'}
            />
          </div>
          <div className="field">
            <label>Chassis No</label>
            <input
              value={chassisNo}
              onChange={(e) => setChassisNo(e.target.value)}
              readOnly
              title={autoFilledFromJob ? 'Auto-filled from the linked Job.' : 'Search and link a Job above to fill this in.'}
            />
          </div>
          <div className="field">
            <label>Location</label>
            {workshops.length > 0 ? (
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled
                title={autoFilledFromJob ? 'Auto-filled from the linked Job.' : 'Search and link a Job above to fill this in.'}
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
                readOnly
                title={autoFilledFromJob ? 'Auto-filled from the linked Job.' : 'Search and link a Job above to fill this in.'}
              />
            )}
          </div>
        </div>
        {/* 2026-09-23 ("also block all withour job search"): Bill Type/Bill Date/Remarks join the
            same Job-linked gate as Party Name/Reg No/Chassis No/Location above - disabled until a
            Job is linked, same `disabled={!jobCardId}` flag/pattern as
            MaterialTransferCreatePage.tsx's own header fields. */}
        <div className="form-row">
          <div className="field">
            <label>Bill Type</label>
            <select value={billType} onChange={(e) => setBillType(e.target.value)} disabled={!jobCardId}>
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
            <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} disabled={!jobCardId} />
          </div>
          <div className="field">
            <label>Remarks</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!jobCardId} />
          </div>
        </div>
        {!jobCardId && (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
            Search and link a Job above to fill in the rest of this bill.
          </p>
        )}
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
        {/* 2026-09-22 ("after Qty feild have much space that all feilds fix in 1 link with Add
            button"): this staging row used .form-row, whose equal-width grid
            (repeat(auto-fit, minmax(200px,1fr))) stretched every field - including small ones like
            Qty/Rate/Disc.Type - out to at least 200px each, wrapping unevenly and leaving a lot of
            empty space around them. Switched to .suggest-row.
            2026-09-23 ("Labour,Description,Qty,Rate,Disc. Type,Discount,Issue Type, Add button in
            1 line"): that fix wasn't actually enough on its own - .suggest-row's own .field-grow
            class (`flex: 1 1 260px`) was STILL claiming far more width than the Labour/Description
            boxes actually need (they already carry their own fixed pixel width via
            LabourSearchInput's `width` prop), leaving too little room for Qty/Rate/Disc. Type/
            Discount/Issue Type/+Add to fit on the same line, so they wrapped onto a second row.
            Switched Labour/Description to `field-compact` too (same class already used for every
            other field here) - every field now sizes to its own content instead of Labour/
            Description competing to fill the leftover space, so the whole row - all seven fields
            plus the button - reads as one line. `.suggest-row`/`.field-grow`/`.field-compact`
            themselves are untouched in global.css, so JobCardDetailPage.tsx's own "Suggest a
            part"/"Suggest labour" rows (which still want their one search field to grow) are
            unaffected.
            2026-09-23 SECOND correction ("in 1 line row this Labour...Issue Type and button add in
            1 line") - the field-compact change above still wasn't enough at a realistic browser
            width (7 fields + a button, each already sized to its own content, simply add up to
            more than a typical laptop screen's card width) - .suggest-row's shared `flex-wrap:
            wrap` (global.css, used elsewhere too - see the paragraph above for why it's left
            untouched) was still free to drop Issue Type/+Add onto a second row whenever that
            happened. Forced to a genuine single line here with two LOCAL, inline overrides (not
            touching the shared class, so other .suggest-row users are unaffected): `flexWrap:
            'nowrap'` on this row, inside a new `overflowX: 'auto'` wrapper - same pattern this
            page's own Part Details List / Material Transfer's grid already use for a row that's
            wider than its card, so at a narrower width the row now scrolls horizontally instead of
            wrapping, and Issue Type + Add always stay on the same line as everything else. */}
        <div style={{ overflowX: 'auto' }}>
        <div className="suggest-row" style={{ background: 'var(--surface-muted, #f8f9fa)', borderRadius: 8, padding: '10px 12px', flexWrap: 'nowrap' }}>
          <div className="field field-compact">
            <label>Labour</label>
            <LabourSearchInput
              labours={labourOptionsForModel}
              locationSelected={!!location}
              value={draftLabour.itemCode}
              onChangeText={(text) => setDraftLabour((p) => ({ ...p, itemCode: text }))}
              onPick={pickLabourForDraft}
              placeholder="Labour code…"
              width={140}
              disabled={!jobCardId}
            />
          </div>
          <div className="field field-compact">
            <label>Description</label>
            <LabourSearchInput
              labours={labourOptionsForModel}
              locationSelected={!!location}
              value={draftLabour.itemDescription}
              onChangeText={(text) => setDraftLabour((p) => ({ ...p, itemDescription: text }))}
              onPick={pickLabourForDraft}
              width={220}
              disabled={!jobCardId}
            />
          </div>
          <div className="field field-compact">
            <label>Qty</label>
            <input type="number" value={draftLabour.qty} onChange={(e) => setDraftLabour((p) => ({ ...p, qty: e.target.value }))} style={{ width: 70, textAlign: 'right' }} disabled={!jobCardId} />
          </div>
          <div className="field field-compact">
            <label>Rate</label>
            <input type="number" value={draftLabour.rate} onChange={(e) => setDraftLabour((p) => ({ ...p, rate: e.target.value }))} style={{ width: 90, textAlign: 'right' }} disabled={!jobCardId} />
          </div>
          <div className="field field-compact">
            <label>Disc. Type</label>
            <select value={draftLabour.discountType} onChange={(e) => setDraftLabour((p) => ({ ...p, discountType: e.target.value as DiscountType }))} disabled={!jobCardId}>
              <option value="None">None</option>
              <option value="Percentage">%</option>
              <option value="Amount">₹</option>
            </select>
          </div>
          <div className="field field-compact">
            <label>Discount</label>
            <input type="number" value={draftLabour.discountValue} onChange={(e) => setDraftLabour((p) => ({ ...p, discountValue: e.target.value }))} disabled={!jobCardId || draftLabour.discountType === 'None'} style={{ width: 90, textAlign: 'right' }} />
          </div>
          <div className="field field-compact">
            <label>Issue Type</label>
            <select value={draftLabour.issueType} onChange={(e) => setDraftLabour((p) => ({ ...p, issueType: e.target.value }))} disabled={!jobCardId}>
              <option value="">— default —</option>
              <option value="Paid">Paid</option>
              <option value="U/W">U/W </option>
              {/* <option value="FSC">FSC - Free Service Coupon (zero tax)</option> */}
            </select>
          </div>
          <div className="field field-compact">
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={commitLabourDraft}
              disabled={!jobCardId || !draftLabour.itemCode.trim() || !draftLabour.itemDescription.trim()}
              title={!jobCardId ? 'Link a Job first' : !draftLabour.itemCode.trim() ? 'Pick a Labour code first.' : undefined}
            >
              {labourEditingKey ? 'Update' : '+ Add'}
            </button>
            {labourEditingKey && (
              <button className="btn btn-sm" type="button" onClick={resetDraftLabour} style={{ marginLeft: 6 }}>Cancel</button>
            )}
          </div>
        </div>
        </div>
        {!jobCardId && (
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
            Search and link a Job above to add Labour.
          </p>
        )}
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
                      {/* 2026-09-22 (Labour-in-Material-Transfer integration): a Labour row synced
                          in from Material Transfer (see this module's own sync-effect doc comment)
                          has no Edit here - its Item Code/Description/Rate/Issue Type come straight
                          from the Material Transfer line and its own "Labour" picker, same read-
                          only treatment Part rows already get - only Remove is offered, and it goes
                          through removeMtLabour (excludedPartKeys) so it isn't silently reintroduced
                          on the next sync, exactly like removePart. */}
                      {it.fromMaterialTransfer ? (
                        <button className="btn btn-icon btn-danger" type="button" onClick={() => removeMtLabour(it)} title="Remove from this bill" disabled={!jobCardId}>✕</button>
                      ) : (
                        <>
                          <button className="btn btn-icon" type="button" onClick={() => startEditLabour(it)} title="Edit" disabled={!jobCardId}>✎</button>{' '}
                          <button className="btn btn-icon btn-danger" type="button" onClick={() => removeLabour(it.key)} title="Delete" disabled={!jobCardId}>✕</button>
                        </>
                      )}
                    </td>
                    <td>{i + 1}</td>
                    <td>
                      {it.itemCode}
                      {it.fromMaterialTransfer && <><br /><span className="muted" style={{ fontSize: 10 }}>via Material Transfer{it.issueType ? ` · ${it.issueType}` : ''}</span></>}
                    </td>
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

        {/* 2026-09-22: mirrors the real DMS reference's own onSelect() warning ("Material
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

        <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* 2026-09-22: relabelled from "Save Repair Bill" - creating a NEW bill always saves it
              as Performa (unchanged). 2026-09-23: while editing an existing bill (editingBillId
              set), this same button instead re-saves it IN PLACE via save()'s own PUT branch - see
              save()'s doc comment - and "Save as Invoice" now also appears right here, matching
              the reference DMS app's own repair-bill/{id} page having both actions on one screen
              (video-confirmed - see this file's own top-of-file doc comment) instead of only being
              reachable from the read-only popup. */}
          <button className="btn btn-primary" onClick={save} disabled={saving || !jobCardId || editingBillStatus === 'Billed' || editingBillStatus === 'Cancelled'} title={!jobCardId ? 'Link a Job first' : undefined}>
            {saving ? 'Saving…' : editingBillId ? 'Update Proforma' : 'Save as Proforma'}
          </button>
          {editingBillId && editingBillStatus === 'Performa' && (
            <button className="btn btn-sm" type="button" disabled={convertingId === editingBillId} onClick={finalizeEditingBillAsInvoice}>
              {convertingId === editingBillId ? 'Saving…' : 'Save as Invoice'}
            </button>
          )}
          {editingBillId && editingBillStatus !== 'Performa' && (
            <span className="muted" style={{ fontSize: 13 }}>This bill is already {editingBillStatus} - it can no longer be edited.</span>
          )}
        </div>
        {saveError && <p className="muted" style={{ color: '#b91c1c' }}>{saveError}</p>}
        {saveOk && <p className="muted" style={{ color: '#15803d' }}>{saveOk}</p>}
      </div>

      {/* 2026-09-23 - the combined list (filters, table, read-only detail popup) moved to its own
          page: see the "View Repair Bill List" button in the header above, and
          RepairBillListPage.tsx / route /repair-bill-list. */}
      {showJobSearch && <JobSearchModal onSelect={selectJob} onClose={() => setShowJobSearch(false)} />}
      {showMtJobGrid && <JobSearchModal onSelect={(j) => { selectJob(j); setShowMtJobGrid(false) }} onClose={() => setShowMtJobGrid(false)} onlyWithMaterialTransfer />}
    </div>
  )
}
