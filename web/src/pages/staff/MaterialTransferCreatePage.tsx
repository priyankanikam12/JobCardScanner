import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsPartStock, BaplDmsWorkshop, BaplItemMaster, CombinedMaterialTransferRow, JobSearchResult, MaterialTransferDocType, PartUpload } from '../../types'
import { Pagination } from '../../components/Pagination'
import { usePagination } from '../../lib/usePagination'
import { JobSearchModal } from '../../components/JobSearchModal'
import { PartSearchInput } from '../../components/PartSearchInput'
import { RecordDetailModal } from '../../components/RecordDetailModal'

/**
 * "Material Transfer Bill" sidebar page (2026-09-19: "now i want Create Repair Bill and Material
 * Transfer Bill ... i want to now this both pages data i want save in JobCardScannerDb ... fetched
 * data both from DMSBAPLDATAConnection ... this both data wants to show in 1 place"; corrected
 * 2026-09-21, "backend logic which u gave u and ui same make only according to our project dont
 * chnage Repair Bill and Material tranfer logic"). Same two-part shape as RepairBillCreatePage.tsx
 * - see that page's doc comment for the shared reasoning. Create form POSTs to
 * /api/material-transfer-docs (JobCardScanner's own database, MaterialTransferDocs/
 * MaterialTransferDocItems); the combined list below (GET /api/material-transfer-docs/combined)
 * shows those alongside the existing read-only DMSBAPLDATA-synced transfer documents for the
 * selected workshop location, tagged by Source.
 *
 * This is a NEW page/route, distinct from the existing read-only MaterialTransferPage.tsx
 * ("Material Transfer Report" in the sidebar) - that page and its route are unchanged. No stock
 * quantities are debited/credited anywhere by this page (see MaterialTransferDoc's doc comment on
 * the backend for why the reference app's PartsInventory side effects weren't ported) - this is a
 * record of the transfer, not a live inventory adjustment.
 *
 * Location is a dropdown scoped to the signed-in user's own accessible workshop location(s)
 * (profile.workLocationCodes via GET /api/bapl-dms/workshops?dealerId=...) - both the create
 * form's own Location field AND the combined-list filter below now read from the same scoped
 * workshops list (previously only the filter used it, the create form was free text).
 *
 * Technician: the reference's MaterialTransfer.Technician is an int id into BAPL DMS's own staff
 * table; this app maps it onto its own User (MaterialTransferDoc.TechnicianId), but there is no
 * accessible technician catalog endpoint for a ServiceAdvisor-level user to pick from (GET
 * /api/users requires DealerAdminUp, a higher policy than this page's own ServiceAdvisorUp - the
 * same reasoning JobCardDetailPage.tsx's own free-text "Assign Technician" field already
 * documents). Left unset from this quick-entry form rather than wiring a picker this page's own
 * users can't call - a real fix needs a technician-lookup endpoint scoped to ServiceAdvisorUp.
 *
 * 2026-09-21 ("give me this and proper flow of this", modelled on the reference DMS app's own Job
 * Search modal + "Part Name (Stock @ Location)" combo): "Job No" opens a Job Search picker
 * (JobSearchModal, GET /api/jobcards/search over this app's OWN JobCards - JobCardId is a local
 * FK, not a raw DMS id) - picking a job auto-fills Party Name/Location and links JobCardId onto
 * the transfer. Once Location is set (from the picked job, or chosen directly), each line's Item
 * Code AND Description are both a search-select against GET /api/bapl-dms/parts?locationCode=...
 * (same PartSearchInput component as RepairBillCreatePage.tsx, wired to both cells - "Item Code
 * not search when i type anything in textbox" 2026-09-21) instead of free-text fields.
 *
 * 2026-09-21 ("Part - Rate = MRP - GST%(CGST,IGST,SGST) .. BILL Creating (without discount) - use
 * all calculation part from dms"): re-verified against the actual pasted material-transfer.ts
 * (onAddItem()/onChangeItem()/calculateGST()), not re-derived from paraphrase. Confirmed:
 *  - A part's Item Rate is reverse-calculated out of its GST-inclusive MRP: basePrice = mrp / (1 +
 *    gst% / 100) - literally "Rate = MRP - GST%" - done here in pickPartForLine below the same
 *    way, using a per-line GST % (no confirmed per-part tax-rate source exists in this app, so
 *    it's a manual/estimated input, defaulted to 18%, exactly like RepairBillCreatePage.tsx's own
 *    gstPct field - see PartSearchInput.tsx's doc comment on why).
 *
 * 2026-09-21 third correction ("not a CGST Amt SGST Amt IGST Amt amt its only CGST , IGST,SGST
 * that will already fetched after item select not required to type GST remove"): the frames from
 * your MT.mp4 recording of the real DMS page confirm its "Part Name" field is labelled
 * "(Stock @ Location N)(GST 18%)" - the GST % is shown, read-only, next to the part, never a
 * typed field anywhere on that screen; HSN Code is its own grid column, also auto-filled from the
 * picked part. The GST % input box below is now REMOVED - GST % is shown read-only next to the
 * part (same place the reference shows it) instead, and an HSN Code column was added to the grid
 * to match the reference. FACT/gap that upload doesn't close: the actual DMS source for that
 * per-part GST % is still not confirmed anywhere in this codebase - ItemMaster's confirmed
 * columns (see BaplDmsService.GetPartsInventoryAsync's doc comment) are ItemCode/ItemName/
 * CustPrice/HsnCode only, no tax-rate column, and the "Stock Summary Detail Report" Excel you
 * uploaded for the new Part Upload tab (see Models/PartUploads.cs) also has no GST column. Until
 * that source is confirmed (e.g. `SELECT * FROM ItemMaster WHERE itemcode=...` shared, the same
 * way CustPrice/HsnCode were confirmed on 2026-09-03), this page still defaults every line to 18%
 * - the number just isn't user-editable anymore, so it can't drift from whatever default is set.
 *  - Material Transfer genuinely has NO discount concept anywhere in the reference's own
 *    onAddItem()/onChangeItem() (unlike Repair Bill's optional per-line discount) - "without
 *    discount" is accurate here and nothing below adds one.
 *  - CGST/SGST/IGST amounts are computed the same intra-state-vs-inter-state way as Repair Bill
 *    (Dealer.State vs the linked job's Customer.State - GET /api/auth/me's DealerState vs
 *    JobSearchResult.partyState) and shown per line for parity with the reference's own grid
 *    (which has CGST Amt./SGST Amt./IGST Amt. columns), but - matching MaterialTransferDoc's own
 *    doc comment on the backend - the reference's MaterialTransfer table stores NO tax columns at
 *    all, only Rate/Amount/Mrp; these are DISPLAY-ONLY here too, not sent in the POST payload.
 *
 * 2026-09-21 second correction ("Issue Type - U/W and Paid ... give proper flow"): re-reading the
 * reference confirmed `MaterialTransfer.IssueType` is a required per-ROW value, resolved from the
 * reference's own filtered dropdown (`IssueTypes.filter(x => x.id === 1 || x.id === 2)`), which
 * the user's own screenshot of that page shows as exactly "Paid" and "U/W" - distinct from this
 * page's existing header-level "Issue Type / Reason" free-text field above (that field models
 * `MaterialTransferDoc.IssueType`, which has no reference equivalent - see that field's backend
 * doc comment - and is kept as-is). Each line now carries its own Issue Type
 * (`MaterialTransferDocItem.IssueType`), defaulting to unset/blank since the reference itself
 * requires the user to choose per row rather than assuming one.
 *
 * 2026-09-21 ("and if stock add available then that will add"): picking a part now records its
 * AvailableQty (from GET /api/bapl-dms/parts) on the line, and Qty is capped to it with an inline
 * warning if exceeded - same stock-limit guard as RepairBillCreatePage.tsx's own updateQty (which
 * mirrors the reference's onBlurQuantity "Stock limit exceeded. Please reduce the quantity.").
 *
 * 2026-09-21 fourth correction ("its override this fix and Issue Type / Reason what is this i
 * dont want this"): removed the header-level "Issue Type / Reason" free-text field entirely - it
 * was this app's own invented field (`MaterialTransferDoc.IssueType`, "no reference equivalent",
 * see that field's backend doc comment) sitting right next to the real, reference-confirmed
 * per-line Issue Type (Paid/U-W) added earlier this same round, which was confusing to have two
 * differently-scoped "Issue Type" concepts on one screen. The create form no longer collects it
 * (always sends `issueType: null` for the header field) - only the per-line dropdown in the grid
 * remains. The backend column/DTO field were left in place (nullable, harmless) rather than
 * removed, since existing saved transfers may already have a value there and MaterialTransferPage.tsx
 * (the read-only DMSBAPLDATA report) is unrelated and unaffected either way.
 *
 * 2026-09-21 fifth correction ("in Part Upload which file upload before that ... need to select
 * Date, Location ... this part pick in materil transfer with balance quantity"): parts uploaded
 * via the new Part Upload tab (scoped to one Location per upload, see Models/PartUploads.cs) now
 * ALSO show up in this page's own Item Code/Description search, merged alongside the live DMS
 * PartsInventory list for the same Location - picking one uses its own BalQty as AvailableQty (the
 * same stock-cap guard above) and its own BillPrice as Rate directly (not reverse-calculated
 * through GST - see pickPartForLine's doc comment for why that's a deliberate, disclosed
 * interpretation, not a confirmed fact). A merged-in Part Upload row is visually tagged so it's
 * never confused with a live DMS stock figure.
 *
 * 2026-09-21 sixth correction ("Item Code in ovveride in under dropdown shown on front"): the
 * PartSearchInput dropdown was being clipped by this grid's own `overflowX: auto` scroll wrapper
 * (a CSS spec quirk, not a z-index/stacking problem - see PartSearchInput.tsx's own doc comment
 * for the mechanism) - fixed there via a portal, nothing changed on this page itself.
 *
 * 2026-09-21 seventh correction ("GST % remove that was shown in IGST, CGST, SGST in this row
 * automatic fetch according this item code(part no)"): the read-only "GST %" grid column (added
 * in the third correction above) is now removed entirely - CGST Amt/SGST Amt/IGST Amt already show
 * the equivalent information per line. gstPct itself is untouched on each line's state ("already
 * linked with state") - it still drives the CGST/SGST/IGST Amt columns via lineTax() exactly as
 * before, it's just no longer shown as its own column.
 *
 * 2026-09-21 eighth correction ("adjust all textbox according there size we already added scroll
 * so proper show textbox value"): widened this grid's tightest columns (Item Code/Description/
 * Qty/Rate/MRP/Issue Type especially) so each value fits inside its own input/select instead of
 * being visually clipped - the horizontal scroll wrapper (already present) handles anything still
 * wider than the card.
 */
type DiscountType = '%' | 'Value'

type DraftItem = {
  key: number
  itemCode: string
  itemDescription: string
  /** Auto-filled from the picked part (BaplDmsPartStock.hsnCode), same as RepairBillCreatePage.tsx
   * - matches the reference grid's own "HSN Code" column, read-only here (not sent by hand). */
  hsnCode: string
  qty: string
  /** Per-unit, GST-EXCLUSIVE rate - reverse-calculated when a part is picked (see
   * rateFromDlrPrice below), editable afterwards. */
  rate: string
  rackNo: string
  bin: string
  serialNo: string
  /** Per-unit, GST-INCLUSIVE - BAPL's own C_ItemMaster.Dlr_Price for the picked item (see
   * itemMasterByCode below). Fixed master data - never changes when a discount is applied to
   * Rate (2026-09-21: "MRP is still constant it will not change"). */
  mrp: string
  /** 2026-09-21 ("Rate = Dlr_Price - GST% ... fetch from baplfinal databse"): these three are the
   * ITEM's OWN stored SGST/CGST/IGST percentages from BAPL's C_ItemMaster (confirmed real per-item
   * data - see BaplItemMasterRow's doc comment in BaplDealerService.cs), not a generic default
   * split anymore. Falls back to 9/9/18 (the old implicit 18%-total/2 split) when the picked item
   * has no C_ItemMaster match, or for a hand-typed line with nothing picked at all. */
  sgstPct: string
  cgstPct: string
  igstPct: string
  /** 2026-09-21 ("Discount type(% and Value) and inbox after select type for typing discount"):
   * NEW - the reference's own Material Transfer has no discount concept (see this module's earlier
   * doc comment), but you explicitly asked for one here now, with its own calculation rule (see
   * lineCalc below) - not inferred from any reference source, implemented literally per your own
   * worked example. */
  discountType: DiscountType
  discountValue: string
  validDays: string
  itemReceived: string
  /** Reference: MaterialTransfer.IssueType, per row - "Paid" or "U/W" (see module doc comment's
   * second 2026-09-21 correction). Kept optional/blank by default since the reference's own
   * dropdown has no pre-selected value either. */
  issueType: string
  /** Stock available at the current Location for this line's Item Code, captured when a part is
   * picked via search - used only to cap/warn on Qty (see updateQty below), never sent to the
   * backend. Null for a hand-typed Item Code with no picked stock row. */
  availableQty: number | null
}
const emptyItem = (key: number): DraftItem => ({
  key, itemCode: '', itemDescription: '', hsnCode: '', qty: '1', rate: '0',
  rackNo: '', bin: '', serialNo: '', mrp: '', sgstPct: '9', cgstPct: '9', igstPct: '18',
  discountType: '%', discountValue: '0', validDays: '', itemReceived: '',
  issueType: '', availableQty: null,
})

/** "Rate = Dlr_Price - GST%" (2026-09-21, your own wording) - reverse-calculates the GST-exclusive
 * per-unit Rate out of C_ItemMaster's GST-INCLUSIVE Dlr_Price: Rate = Dlr_Price / (1 + gst% / 100).
 * Same formula/shape as the previous MRP-based rateFromMrp, just fed a confirmed real Dealer Price
 * instead of an unconfirmed default. */
const rateFromDlrPrice = (dlrPrice: number, totalGstPct: number) => dlrPrice / (1 + totalGstPct / 100)

/**
 * 2026-09-21 ("with and without discount - without discount rate is 100 and gst % is 18% = 118 is
 * MRP and Amount ... with discount - 100(rate) - 10%(discount%) = in backend calculation it
 * calculate 90 but in actual its calculate that 90 + 18%(gst%)= 108 = Amount and MRP still
 * constant it will not change"):
 *  - No discount: Amount = qty x (Rate + GST on Rate) = qty x Dlr_Price = qty x MRP.
 *  - With a discount: the discount reduces Rate ONLY. The GST rupee amount added back is the
 *    ORIGINAL amount computed on the UNDISCOUNTED Rate (18 on a Rate of 100, in your example) -
 *    it is NOT recalculated on the discounted Rate (that would give 90 + 16.20 = 106.20, not the
 *    108 you specified). MRP is always the original, undiscounted Rate+GST figure and never moves
 *    when a discount is applied - taken literally from your own worked numbers (given twice,
 *    consistently), not "corrected" to the more usual GST-on-discounted-price convention.
 */
const lineCalc = (it: DraftItem) => {
  const qty = Number(it.qty) || 0
  const rate = Number(it.rate) || 0
  const sgstPct = Number(it.sgstPct) || 0
  const cgstPct = Number(it.cgstPct) || 0
  const igstPct = Number(it.igstPct) || 0
  const totalGstPct = sgstPct + cgstPct > 0 ? sgstPct + cgstPct : igstPct

  const originalBase = qty * rate // pre-tax, pre-discount
  const originalGstAmt = (originalBase * totalGstPct) / 100 // frozen - see doc comment above

  const discPct = it.discountType === '%' ? Number(it.discountValue) || 0 : 0
  const discVal = it.discountType === 'Value' ? Number(it.discountValue) || 0 : 0
  const discountedRate = Math.max(0, it.discountType === '%' ? rate * (1 - discPct / 100) : rate - discVal)
  const discountedBase = qty * discountedRate

  const amount = discountedBase + originalGstAmt
  const mrp = rate + (rate * totalGstPct) / 100 // per-unit, fixed regardless of discount

  return { qty, rate, discountedRate, originalBase, discountedBase, originalGstAmt, amount, mrp, sgstPct, cgstPct, igstPct }
}

/** Display-only CGST/SGST/IGST split of a line's (frozen, see lineCalc) GST amount, per the
 * auto-detected (or defaulted) tax mode - not persisted, see the module doc comment above. Splits
 * proportionally between the item's own SGST/CGST shares (equal in every sample row you shared,
 * but not assumed to be) rather than always exactly halving the total. */
const lineTax = (it: DraftItem, isSameState: boolean) => {
  const calc = lineCalc(it)
  if (!isSameState) {
    return { cgstPct: 0, sgstPct: 0, igstPct: calc.igstPct, cgstAmt: 0, sgstAmt: 0, igstAmt: calc.originalGstAmt }
  }
  const pairTotal = calc.cgstPct + calc.sgstPct
  const cgstAmt = pairTotal > 0 ? (calc.originalGstAmt * calc.cgstPct) / pairTotal : calc.originalGstAmt / 2
  const sgstAmt = pairTotal > 0 ? (calc.originalGstAmt * calc.sgstPct) / pairTotal : calc.originalGstAmt / 2
  return { cgstPct: calc.cgstPct, sgstPct: calc.sgstPct, igstPct: 0, cgstAmt, sgstAmt, igstAmt: 0 }
}

export function MaterialTransferCreatePage() {
  const { profile } = useStaffAuth()

  // ---------------- Location dropdown - scoped to the signed-in user's own accessible workshops;
  // drives both the create form's own Location field and the combined-list filter below. ----------------
  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])

  // ---------------- Create form ----------------
  const [jobCardId, setJobCardId] = useState<string | null>(null)
  const [jobCardNumber, setJobCardNumber] = useState('')
  const [showJobSearch, setShowJobSearch] = useState(false)
  const [location, setLocation] = useState('')
  const [transferType, setTransferType] = useState<MaterialTransferDocType>('Issue')
  const [partyName, setPartyName] = useState('')
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  const [items, setItems] = useState<DraftItem[]>([emptyItem(1)])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState<string | null>(null)
  const [partyState, setPartyState] = useState<string | null>(null)

  // "according to state Intra state and inter state" - same Dealer.State vs Customer.State
  // compare as RepairBillCreatePage.tsx, see that page's doc comment.
  //
  // 2026-09-21 eighth correction ("why not shown gst also shown" + explicit answer to the
  // clarifying question this was asked back before touching any GST logic - "Default to Same
  // State (Recommended)"): DEFAULTS to Same State (true) when no job/customer is linked, instead
  // of the previous null/"unknown" that held CGST/SGST/IGST at ₹0.00. This is a disclosed,
  // user-confirmed INTERPRETATION specific to Material Transfer, not something silently invented:
  // Material Transfer never bills an external party (Party here is "Technician or source
  // location", not a customer) - it moves the dealer's own stock within the dealer's own
  // operation, so it is always this dealer's own State on both sides unless/until a linked job's
  // customer proves otherwise. Repair Bill (which CAN bill an external customer/fleet party in a
  // different state) intentionally keeps its own separate, already-existing Tax Type
  // dropdown/auto-detect instead - see that page's taxMode/taxModeAuto for why the same default
  // isn't safe to assume there.
  const isSameState = profile?.dealerState && partyState
    ? profile.dealerState.trim().toUpperCase() === partyState.trim().toUpperCase()
    : true

  const addItem = () => setItems((prev) => [...prev, emptyItem((prev.at(-1)?.key ?? 0) + 1)])
  const removeItem = (key: number) => setItems((prev) => (prev.length > 1 ? prev.filter((i) => i.key !== key) : prev))
  const updateItem = (key: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const estimatedTotal = items.reduce((sum, it) => sum + lineCalc(it).amount, 0)

  // Parts available at the currently-selected Location - fetched once per location change, then
  // searched client-side by each line's own PartSearchInput (same pattern PartSuggestionCard on
  // the Job Card Detail page already uses).
  //
  // 2026-09-21 fifth correction: merged in with parts uploaded via the "Part Upload" tab for the
  // SAME location (GET /api/part-uploads?locationCode=...) - "this part pick in materil transfer
  // with balance quantity". Each merged-in row is tagged source: 'partUpload' (see
  // BaplDmsPartStock's doc comment) so PartSearchInput can visually distinguish it and
  // pickPartForLine can use its BillPrice/BalQty directly instead of the live-DMS MRP/GST path.
  const [dmsParts, setDmsParts] = useState<BaplDmsPartStock[]>([])
  const [uploadedParts, setUploadedParts] = useState<BaplDmsPartStock[]>([])
  useEffect(() => {
    if (!location) { setDmsParts([]); return }
    staffApi.get<BaplDmsPartStock[]>('/api/bapl-dms/parts', { params: { locationCode: location } })
      .then(({ data }) => setDmsParts(data))
      .catch(() => setDmsParts([]))
  }, [location])
  useEffect(() => {
    if (!location) { setUploadedParts([]); return }
    staffApi.get<PartUpload[]>('/api/part-uploads', { params: { locationCode: location } })
      .then(({ data }) => setUploadedParts(data.map((u): BaplDmsPartStock => ({
        itemCode: u.partNo,
        availableQty: u.balQty ?? 0,
        description: u.description,
        hsnCode: u.hsnSacCode,
        source: 'partUpload',
        billPrice: u.billPrice,
      }))))
      .catch(() => setUploadedParts([]))
  }, [location])
  // 2026-09-21 ninth correction ("why duplicate Item Code shown"): the same Item Code can
  // legitimately exist in BOTH lists (a part DMS still has a stock row for AND that you've also
  // uploaded a Part Upload report for at this Location) - simply concatenating showed it twice,
  // once with live DMS stock (often 0) and once "Uploaded" with the real Bal Qty, with nothing
  // telling the user which one they'd actually picked. Deduplicated by Item Code, Part Upload
  // winning: it's the row this app can actually deduct/restore stock against (see
  // MaterialTransferDocsController.Create/Delete's PartUploads.BalQty adjustment) and its BalQty
  // is the more current figure of the two, so it's the more actionable one to show/pick.
  const uploadedCodes = new Set(uploadedParts.map((p) => p.itemCode.trim().toUpperCase()))

  // 2026-09-21 ("Rate = Dlr_Price - GST% ... that all we want to fetch from baplfinal databse"):
  // bulk-enriches whatever's already loaded (BOTH live-DMS AND Part-Upload rows alike - your own
  // instruction was that Part Upload's BillPrice/Bal Amount is a dealer rate, not the Rate/MRP/GST
  // this app should calculate from) with BAPL's own C_ItemMaster (baplfinal), keyed by ItemCode.
  const [itemMasterByCode, setItemMasterByCode] = useState<Record<string, BaplItemMaster>>({})
  useEffect(() => {
    const codes = Array.from(new Set([...dmsParts, ...uploadedParts].map((p) => p.itemCode.trim().toUpperCase()).filter(Boolean)))
    if (codes.length === 0) { setItemMasterByCode({}); return }
    staffApi.get<BaplItemMaster[]>('/api/item-master/by-codes', { params: { codes: codes.join(',') } })
      .then(({ data }) => {
        const byCode: Record<string, BaplItemMaster> = {}
        data.forEach((im) => { byCode[im.itemCode.trim().toUpperCase()] = im })
        setItemMasterByCode(byCode)
      })
      .catch(() => setItemMasterByCode({}))
  }, [dmsParts, uploadedParts])

  // 2026-09-22 ("take Item Code from /item-master and with Search Job below Item Code we cant
  // select give proper changes"): the FULL BAPL Item Master catalog (GET /api/item-master, no q -
  // same up-to-1000-row unfiltered load ItemMasterPage.tsx does on open), fetched ONCE on mount -
  // deliberately NOT keyed to `location` at all, since C_ItemMaster is a dealer/location-agnostic
  // catalog (confirmed: SearchItemMasterAsync has no dealer/location filter). This is what actually
  // fixes "we cant select": before this, Item Code could only be picked from whatever had a live
  // DMS stock row or Part Upload row at the CURRENTLY SELECTED Location - so a Location that had no
  // stock loaded yet (or no Location/Job picked at all, since PartSearchInput used to be disabled
  // until one was) left the Item Code search with nothing to find. Item Master itself needs neither.
  const [itemMasterCatalog, setItemMasterCatalog] = useState<BaplItemMaster[]>([])
  useEffect(() => {
    staffApi.get<BaplItemMaster[]>('/api/item-master')
      .then(({ data }) => setItemMasterCatalog(data))
      .catch(() => setItemMasterCatalog([]))
  }, [])

  const parts: BaplDmsPartStock[] = (() => {
    const byCode: Record<string, BaplDmsPartStock> = {}
    // 1. Primary source - the full Item Master catalog, so every real item can be found and
    //    picked regardless of Location/live-stock state. availableQty starts at 0 (unknown, not
    //    "0 in stock" - see BaplDmsPartStock.source's doc comment) until overlaid below.
    itemMasterCatalog.forEach((im) => {
      const code = im.itemCode.trim().toUpperCase()
      byCode[code] = {
        itemCode: im.itemCode,
        description: im.itemName || im.displayName || im.itemCode,
        hsnCode: im.hsnCode,
        availableQty: 0,
        dlrPrice: im.dlrPrice,
        sgstPct: im.sgst,
        cgstPct: im.cgst,
        igstPct: im.igst,
        source: 'itemMaster',
      }
    })
    // 2. Overlay live DMS stock / Part Upload rows for the CURRENT Location on top - real
    //    availableQty replaces the placeholder 0, and each row's own itemMasterByCode match (a
    //    precise by-code lookup, not capped at 1000 rows like the catalog preload above) still
    //    wins for Dealer Price/GST, same enrichment as before this round.
    ;[...dmsParts.filter((p) => !uploadedCodes.has(p.itemCode.trim().toUpperCase())), ...uploadedParts].forEach((p) => {
      const code = p.itemCode.trim().toUpperCase()
      const im = itemMasterByCode[code]
      const existing = byCode[code]
      byCode[code] = {
        ...existing,
        ...p,
        dlrPrice: im?.dlrPrice ?? existing?.dlrPrice ?? p.mrp,
        sgstPct: im?.sgst ?? existing?.sgstPct,
        cgstPct: im?.cgst ?? existing?.cgstPct,
        igstPct: im?.igst ?? existing?.igstPct,
        hsnCode: p.hsnCode || im?.hsnCode || existing?.hsnCode,
      }
    })
    return Object.values(byCode)
  })()

  // 2026-09-22 ("which dealer price are there in item-master that will not came in material
  // transfer ... dont take this calclation from parts-upload for clculation take item-master
  // rate , mrp , amount calculation"): re-worked to fix a real bug you hit - the previous version
  // read Dealer Price/GST off of the already-merged `parts` list (`p.dlrPrice`/`p.sgstPct`/etc,
  // populated by the itemMasterByCode/itemMasterCatalog effects above), both of which can still be
  // mid-flight OR simply miss the item: itemMasterByCode is a separate async fetch chained after
  // dmsParts/uploadedParts load, so a fast pick could land before it resolved, and
  // itemMasterCatalog is capped at 1000 rows (see ItemMasterController.cs's own doc comment) so a
  // less-common item's own C_ItemMaster row may never be in it at all. Either way, `dlrPrice` then
  // came back null and this fell through to Part Upload's raw BillPrice as Rate - exactly the "Rs
  // 242 Dealer Price never came into Material Transfer" you reported.
  //
  // Fix: picking a part now fetches C_ItemMaster fresh, for this EXACT Item Code, at the moment of
  // picking (GET /api/item-master/by-codes?codes=<one code> - precise, not capped at 1000, not
  // dependent on any other effect having already resolved). Rate/MRP/SGST/CGST/IGST are ALWAYS
  // computed from that fresh C_ItemMaster row - Part Upload/live DMS stock now only ever supplies
  // Item Code/Description/HSN/availableQty, never a price, matching your explicit instruction.
  // If C_ItemMaster genuinely has no row for this code (a real gap, not a stale-cache miss), Rate/
  // MRP are left as-is for manual entry, with priceWarning below telling you why instead of
  // silently guessing from Part Upload's Bill Price.
  const pickPartForLine = async (key: number, p: BaplDmsPartStock) => {
    const current = items.find((i) => i.key === key)
    setPriceWarning(null)
    updateItem(key, {
      itemCode: p.itemCode,
      itemDescription: p.description || p.itemCode,
      hsnCode: p.hsnCode || '',
      availableQty: p.availableQty,
    })
    if (Number(current?.qty) > p.availableQty) {
      setStockWarning(`Only ${p.availableQty} in stock for ${p.itemCode} - quantity capped.`)
      updateItem(key, { qty: String(p.availableQty) })
    }

    let im: BaplItemMaster | undefined
    try {
      const { data } = await staffApi.get<BaplItemMaster[]>('/api/item-master/by-codes', { params: { codes: p.itemCode } })
      im = data.find((row) => row.itemCode.trim().toUpperCase() === p.itemCode.trim().toUpperCase())
    } catch {
      im = undefined
    }

    if (im?.dlrPrice != null) {
      const sgstPct = im.sgst ?? 9
      const cgstPct = im.cgst ?? 9
      const igstPct = im.igst ?? 18
      const totalGst = sgstPct + cgstPct > 0 ? sgstPct + cgstPct : igstPct
      updateItem(key, {
        mrp: String(im.dlrPrice),
        rate: rateFromDlrPrice(im.dlrPrice, totalGst).toFixed(2),
        sgstPct: String(sgstPct),
        cgstPct: String(cgstPct),
        igstPct: String(igstPct),
        hsnCode: im.hsnCode || p.hsnCode || '',
      })
    } else {
      setPriceWarning(`No Item Master (C_ItemMaster) price found for ${p.itemCode} - Rate/MRP left for manual entry.`)
    }
  }

  // "and if stock add available then that will add" - caps Qty to the picked stock row's
  // AvailableQty, same guard as RepairBillCreatePage.tsx's own updateQty.
  const [stockWarning, setStockWarning] = useState<string | null>(null)
  // 2026-09-22 - see pickPartForLine's doc comment above: tells the user WHY Rate/MRP weren't
  // auto-filled (no C_ItemMaster match for the picked Item Code) instead of silently falling back
  // to a non-Item-Master number.
  const [priceWarning, setPriceWarning] = useState<string | null>(null)
  const updateQty = (key: number, qtyText: string) => {
    const it = items.find((i) => i.key === key)
    const qty = Number(qtyText)
    if (it?.availableQty != null && !isNaN(qty) && qty > it.availableQty) {
      setStockWarning(`Only ${it.availableQty} in stock for ${it.itemCode || it.itemDescription} - quantity capped.`)
      updateItem(key, { qty: String(it.availableQty) })
      return
    }
    setStockWarning(null)
    updateItem(key, { qty: qtyText })
  }

  const selectJob = (job: JobSearchResult) => {
    setJobCardId(job.id)
    setJobCardNumber(job.jobCardNumber)
    if (job.partyName) setPartyName(job.partyName)
    if (job.locationCode) setLocation(job.locationCode)
    setPartyState(job.partyState ?? null)
    setShowJobSearch(false)
  }

  const clearJob = () => { setJobCardId(null); setJobCardNumber(''); setPartyState(null) }

  const save = () => {
    setSaveError(null)
    setSaveOk(null)
    const validItems = items.filter((i) => i.itemDescription.trim() && Number(i.qty) > 0)
    if (validItems.length === 0) { setSaveError('Add at least one item line with a description and quantity.'); return }

    setSaving(true)
    staffApi
      .post('/api/material-transfer-docs', {
        jobCardId: jobCardId || null,
        location: location || null,
        transferType,
        issueType: null,
        partyName: partyName || null,
        remarks: remarks || null,
        transferDate,
        items: validItems.map((i) => ({
          itemCode: i.itemCode || i.itemDescription.slice(0, 30),
          itemDescription: i.itemDescription,
          hsnCode: i.hsnCode || null,
          issueType: i.issueType || null,
          qty: Number(i.qty) || 0,
          // 2026-09-21 (Discount type/value added this round): the PERSISTED Rate is the
          // post-discount rate (lineCalc's discountedRate) - MaterialTransferDocItem has no
          // discount columns of its own (the reference has none either - see this module's own
          // doc comment), so the discount is baked into Rate before saving, same as it always was
          // for a hand-edited Rate. The GST add-back (Amount = discountedRate x qty + frozen GST)
          // stays a FRONTEND-ONLY display figure, exactly as before - Amount here is still
          // Rate x Qty, computed server-side, matching MaterialTransferDoc's own doc comment on
          // why no tax is persisted.
          rate: Number(lineCalc(i).discountedRate.toFixed(2)),
          rackNo: i.rackNo || null,
          bin: i.bin || null,
          serialNo: i.serialNo || null,
          mrp: i.mrp ? Number(i.mrp) : null,
          validDays: i.validDays ? Number(i.validDays) : null,
          itemReceived: i.itemReceived || null,
        })),
      })
      .then((r) => {
        setSaveOk(`Saved as ${r.data.transferNumber}.`)
        clearJob()
        setPartyName(''); setRemarks('')
        setItems([emptyItem(1)])
        setStockWarning(null)
        loadCombined()
      })
      .catch((err) => setSaveError(err?.response?.data?.message ?? 'Could not save the material transfer.'))
      .finally(() => setSaving(false))
  }

  // ---------------- Combined list (this app's own transfers + DMSBAPLDATA-synced transfers) ----------------
  const [locCode, setLocCode] = useState('')
  const [rows, setRows] = useState<CombinedMaterialTransferRow[]>([])
  const [dmsError, setDmsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!profile?.dealerId) return
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then(({ data }) => {
        const scoped = profile?.workLocationCodes?.length ? data.filter((w) => profile.workLocationCodes.includes(w.locCode)) : data
        setWorkshops(scoped)
        if (scoped.length > 0) {
          setLocCode((prev) => prev || scoped[0].locCode)
          setLocation((prev) => prev || scoped[0].locCode)
        }
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.dealerId, profile?.workLocationCodes])

  const loadCombined = () => {
    setLoading(true)
    staffApi
      .get<{ rows: CombinedMaterialTransferRow[]; dmsBaplDataError: string | null }>('/api/material-transfer-docs/combined', { params: { locCode: locCode || undefined } })
      .then((r) => { setRows(r.data.rows); setDmsError(r.data.dmsBaplDataError) })
      .catch(() => { setRows([]); setDmsError('Could not load the combined list.') })
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadCombined() }, [locCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteTransfer = (id: string) => {
    if (!window.confirm('Delete this material transfer? This cannot be undone.')) return
    staffApi.delete(`/api/material-transfer-docs/${id}`)
      .then(() => loadCombined())
      .catch((err) => alert(err?.response?.data?.message ?? 'Could not delete the material transfer.'))
  }

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(rows)

  // ---------------- Detail view (2026-09-21 "all upload data and exist data are clickable on
  // any record we click this all details can openable") - opens every field a combined-list row
  // carries, including its line items (both JobCardScanner's own and DMSBAPLDATA-synced rows
  // already come back with Items from /combined - no extra round trip needed). Item column shape
  // differs by source since the two carry different real fields. ----------------
  const [viewingTransfer, setViewingTransfer] = useState<CombinedMaterialTransferRow | null>(null)
  const transferItemColumns = viewingTransfer?.source === 'DMSBAPLDATA'
    ? ['Item Code/Id', 'Description', 'Type', 'Qty', 'Rate', 'CGST %', 'CGST Amt', 'SGST %', 'SGST Amt', 'IGST %', 'IGST Amt', 'Discount', 'MRP']
    : ['Item Code', 'Description', 'HSN', 'Issue Type', 'Qty', 'Rate', 'Amount', 'Rack', 'Bin', 'Serial No', 'MRP', 'Valid Days', 'Received']
  const fmtCell = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v))
  const transferItemRows = (viewingTransfer?.items ?? []).map((it) =>
    viewingTransfer?.source === 'DMSBAPLDATA'
      ? [fmtCell(it.itemIdno ?? it.itemName), fmtCell(it.itemDescription), fmtCell(it.itemType), fmtCell(it.qty), fmtCell(it.rate),
         fmtCell(it.cgstPer), fmtCell(it.cgstAmount), fmtCell(it.sgstPer), fmtCell(it.sgstAmount), fmtCell(it.igstPer), fmtCell(it.igstAmount),
         fmtCell(it.discount), fmtCell(it.mrp)]
      : [fmtCell(it.itemCode), fmtCell(it.itemDescription), fmtCell(it.hsnCode), fmtCell(it.issueType), fmtCell(it.qty), fmtCell(it.rate),
         fmtCell(it.amount), fmtCell(it.rackNo), fmtCell(it.bin), fmtCell(it.serialNo), fmtCell(it.mrp), fmtCell(it.validDays), fmtCell(it.itemReceived)]
  )

  return (
    <div>
      <h2>Material Transfer Bill</h2>
      <p className="muted">
        Create a material transfer document - saved into JobCardScanner's own database. The list
        below shows transfers created here together with the read-only material transfer data
        synced from DMSBAPLDATA, tagged by source.
      </p>

      <div className="card">
        <h3>New Material Transfer</h3>
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
        <div className="form-row">
          <div className="field">
            <label>Location</label>
            {workshops.length > 0 ? (
              <select value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="">— select —</option>
                {workshops.map((w) => (
                  <option key={w.locCode} value={w.locCode}>{w.locCode} — {w.locName}</option>
                ))}
              </select>
            ) : (
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Workshop location" />
            )}
          </div>
          <div className="field">
            <label>Transfer Type</label>
            <select value={transferType} onChange={(e) => setTransferType(e.target.value as MaterialTransferDocType)}>
              <option value="Issue">Issue</option>
              <option value="Return">Return</option>
            </select>
          </div>
          <div className="field">
            <label>To / From (Party)</label>
            <input value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Technician or source location" />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>Transfer Date</label>
            <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Remarks</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        {/* 2026-09-21 ("that calculation also and auto fetch with proper calculation... change
            order in material-transfer-bill Item Code Description HSN Code Issue Type Qty Rate
            CGST Amt SGST Amt IGST Amt Discount type(% and Value) and inbox after select type for
            typing discount, Amount, MRP ...and remove Rack No Bin Valid Days Received"): grid
            reordered/pruned to exactly that column set. Rack No/Bin/Serial No/Valid Days/Received
            are NOT deleted from the data model or the save payload (MaterialTransferDocItem still
            has real columns for them, and RecordDetailModal's own view below still shows them for
            an already-saved transfer) - only these five input cells are hidden from THIS create
            grid, since you asked to remove them from view here specifically. Serial No wasn't in
            either your new column list or your removal list, so it stays available via the
            existing RecordDetailModal detail view instead of cluttering this already-wide grid. */}
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 140 }}>Item Code</th>
                <th style={{ width: 220 }}>Description</th>
                <th style={{ width: 110 }}>HSN Code</th>
                <th style={{ width: 150 }}>Issue Type</th>
                <th className="text-end" style={{ width: 80 }}>Qty</th>
                <th className="text-end" style={{ width: 100 }}>Rate</th>
                <th className="text-end" style={{ width: 100 }}>CGST Amt</th>
                <th className="text-end" style={{ width: 100 }}>SGST Amt</th>
                <th className="text-end" style={{ width: 100 }}>IGST Amt</th>
                <th style={{ width: 90 }}>Disc. Type</th>
                <th className="text-end" style={{ width: 100 }}>Discount</th>
                <th className="text-end" style={{ width: 120 }}>Amount</th>
                <th className="text-end" style={{ width: 100 }}>MRP</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const tax = lineTax(it, isSameState)
                const calc = lineCalc(it)
                return (
                <tr key={it.key}>
                  <td>
                    <PartSearchInput
                      parts={parts}
                      value={it.itemCode}
                      onChangeText={(text) => updateItem(it.key, { itemCode: text })}
                      onPick={(p) => pickPartForLine(it.key, p)}
                      placeholder="Item code…"
                      width={130}
                    />
                  </td>
                  <td>
                    <PartSearchInput
                      parts={parts}
                      value={it.itemDescription}
                      onChangeText={(text) => updateItem(it.key, { itemDescription: text })}
                      onPick={(p) => pickPartForLine(it.key, p)}
                      width={210}
                    />
                  </td>
                  <td><input value={it.hsnCode} readOnly placeholder="—" title="Auto-filled from the picked part." style={{ width: 100 }} /></td>
                  <td>
                    <select value={it.issueType} onChange={(e) => updateItem(it.key, { issueType: e.target.value })} style={{ minWidth: 130 }}>
                      <option value="">— select —</option>
                      <option value="Paid">Paid</option>
                      <option value="U/W">U/W</option>
                    </select>
                  </td>
                  <td><input type="number" value={it.qty} onChange={(e) => updateQty(it.key, e.target.value)} style={{ width: 70, textAlign: 'right' }} /></td>
                  <td><input type="number" value={it.rate} onChange={(e) => updateItem(it.key, { rate: e.target.value })} title={it.mrp ? `Reverse-calculated from Dealer Price ₹${it.mrp} at ${calc.sgstPct + calc.cgstPct || calc.igstPct}% GST - edit to override.` : undefined} style={{ width: 90, textAlign: 'right' }} /></td>
                  <td className="text-end">₹{tax.cgstAmt.toFixed(2)}{tax.cgstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{tax.cgstPct}%</span></>}</td>
                  <td className="text-end">₹{tax.sgstAmt.toFixed(2)}{tax.sgstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{tax.sgstPct}%</span></>}</td>
                  <td className="text-end">₹{tax.igstAmt.toFixed(2)}{tax.igstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{tax.igstPct}%</span></>}</td>
                  <td>
                    <select value={it.discountType} onChange={(e) => updateItem(it.key, { discountType: e.target.value as DiscountType })} style={{ minWidth: 80 }}>
                      <option value="%">%</option>
                      <option value="Value">₹</option>
                    </select>
                  </td>
                  <td><input type="number" value={it.discountValue} onChange={(e) => updateItem(it.key, { discountValue: e.target.value })} style={{ width: 90, textAlign: 'right' }} /></td>
                  <td className="text-end">₹{calc.amount.toFixed(2)}</td>
                  <td className="text-end">₹{calc.mrp.toFixed(2)}</td>
                  <td><button className="btn btn-icon btn-danger" onClick={() => removeItem(it.key)} title="Remove line">✕</button></td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {stockWarning && <p className="muted" style={{ color: '#b45309', marginTop: 10 }}>⚠ {stockWarning}</p>}
        {priceWarning && <p className="muted" style={{ color: '#b45309', marginTop: 10 }}>⚠ {priceWarning}</p>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <button className="btn btn-sm" onClick={addItem}>+ Add Line</button>
          <span className="muted">
            {partyState
              ? `Tax: ${isSameState ? 'Same State (CGST+SGST)' : 'Different State (IGST)'}, auto-detected from the linked job's customer state - `
              : `Tax: Same State (CGST+SGST), defaulted (no job linked - this dealer's own stock moving internally) - `}
            Total (excl. GST, not persisted): <strong>₹{estimatedTotal.toFixed(2)}</strong>
          </span>
        </div>

        <div style={{ marginTop: 14 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Material Transfer'}</button>
          {saveError && <p className="muted" style={{ color: '#b91c1c' }}>{saveError}</p>}
          {saveOk && <p className="muted" style={{ color: '#15803d' }}>{saveOk}</p>}
        </div>
      </div>

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>DMS workshop location (for the DMSBAPLDATA rows below)</label>
            {workshops.length > 0 ? (
              <select value={locCode} onChange={(e) => setLocCode(e.target.value)}>
                <option value="">— none —</option>
                {workshops.map((w) => (
                  <option key={w.locCode} value={w.locCode}>{w.locCode} — {w.locName}</option>
                ))}
              </select>
            ) : (
              <input value={locCode} onChange={(e) => setLocCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCombined()} placeholder="e.g. CUS0288W5" />
            )}
          </div>
        </div>
        <button className="btn" onClick={loadCombined} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        {dmsError && <p className="muted" style={{ color: '#b91c1c' }}>DMSBAPLDATA rows unavailable: {dmsError}</p>}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Transfer No</th>
              <th>Date</th>
              <th>Location</th>
              <th>Type</th>
              <th>Party</th>
              <th>Status</th>
              <th className="text-end">Items</th>
              <th className="text-end">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} onClick={() => setViewingTransfer(r)} style={{ cursor: 'pointer' }} title="Click to view full details">
                <td><span className={`badge ${r.source === 'JobCardScanner' ? 'badge-success' : 'badge-muted'}`}>{r.source}</span></td>
                <td>{r.transferNumber}</td>
                <td>{r.sortDate ? new Date(r.sortDate).toLocaleDateString('en-IN') : '—'}</td>
                <td>{r.location ?? '—'}</td>
                <td>{r.transferType ?? '—'}</td>
                <td>{r.partyName ?? '—'}</td>
                <td>{r.status ?? '—'}</td>
                <td className="text-end">{r.itemCount}</td>
                <td className="text-end">₹{r.totalAmount.toFixed(2)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {r.source === 'JobCardScanner' && (
                    <button className="btn btn-icon btn-danger" onClick={() => deleteTransfer(r.id)} title="Delete">✕</button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 16 }}>No material transfers yet.</td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>

      {showJobSearch && <JobSearchModal onSelect={selectJob} onClose={() => setShowJobSearch(false)} />}

      {viewingTransfer && (
        <RecordDetailModal
          title={`Transfer ${viewingTransfer.transferNumber}`}
          subtitle={`${viewingTransfer.source}${viewingTransfer.location ? ` · ${viewingTransfer.location}` : ''}`}
          onClose={() => setViewingTransfer(null)}
          fields={[
            { label: 'Source', value: viewingTransfer.source },
            { label: 'Transfer No', value: viewingTransfer.transferNumber },
            { label: 'Date', value: viewingTransfer.sortDate ? new Date(viewingTransfer.sortDate).toLocaleDateString('en-IN') : null },
            { label: 'Location', value: viewingTransfer.location },
            { label: 'Type', value: viewingTransfer.transferType },
            { label: 'Party', value: viewingTransfer.partyName },
            { label: 'Status', value: viewingTransfer.status },
            { label: 'Item Count', value: viewingTransfer.itemCount },
            { label: 'Total Amount', value: `₹${viewingTransfer.totalAmount.toFixed(2)}` },
          ]}
          itemsTitle="Items"
          itemColumns={transferItemColumns}
          itemRows={transferItemRows}
        />
      )}
    </div>
  )
}
