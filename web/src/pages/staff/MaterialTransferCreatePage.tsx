// web\src\pages\staff\MaterialTransferCreatePage.tsx
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsPartStock, BaplDmsWorkshop, BaplItemMaster, JobSearchResult, LabourMasterPartwise, MaterialTransferDoc, MaterialTransferDocItemType, MaterialTransferDocStatus, MaterialTransferDocType, PartUpload } from '../../types'
import { JobSearchModal } from '../../components/JobSearchModal'
import { PartSearchInput, isConfirmedOutOfStock } from '../../components/PartSearchInput'

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
 * Technician: the reference's MaterialTransfer.Technician is an int id into DMS's own staff
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
 *
 * 2026-09-22 ninth correction ("then from /labour-master from this page which Rate Type * is
 * Partwise from this we upload FOR Part Code add Labour Code also that was wants to integrate in
 * material transfer which in video ... which labour we added from amterial transfer for Issue
 * Type - Paid that will goin for paid type and which are in U/w that was going in U/w that also
 * going in repair bill"): each Part row now has a "Labour" button (enabled once an Item Code is
 * picked) that opens PartwiseLabourModal - a "Labour List" popup scoped to that Part Code,
 * modelled directly on the mt-labour_add.mp4 recording of the real BGauss DMS
 * (mydmsconnect.com/MtrlTranN.aspx) - see that component's own doc comment for the full
 * video-vs-implementation mapping. Confirmed via AskUserQuestion: web and mobile ship together in
 * one delivery, and the Part Code -> Labour Code match is exact/Part-Code-only (no Model filter).
 * SUPERSEDED ON WEB 2026-09-23 ("dont open pop up tab direct that item code and Issue Type
 * regarding which labour linked that link with that item code"): the popup described in this
 * paragraph is GONE on this page - see autoAddLabourForPart's own doc comment further down for
 * what replaced it (a silent, no-dialog "+ Add" that stages every matching Labour Master Partwise
 * row in one click). PartwiseLabourModal.tsx (the component this paragraph describes) is now
 * unused by this file - it's still imported/used by mobile's own MaterialTransferCreateScreen.tsx,
 * untouched by this web-only round, and left in the web tree rather than deleted in case this
 * needs reverting. This paragraph is kept for history, not as current behaviour.
 *
 * Picked Labour Codes are staged as their own DraftItem rows with itemType: 'Labour' (new field,
 * defaults to 'Part' - see MaterialTransferDocItemType on the backend), rendered in a separate
 * read-only-Item-Code sub-table below the main Part grid rather than mixed into it, since a
 * Labour row has no Item Code search/HSN/Rack/Bin/stock-cap concept - it only reuses the same
 * Qty/Rate/GST/Issue-Type/save-payload shape DraftItem already has for a Part row. Each Labour
 * row remembers its parent Part row via sourcePartKey (new field): "Issue Type ... that will goin
 * for paid type ... also going in U/w" is implemented as GOVERNANCE, not a one-time copy - the
 * Part row's own Issue Type select (via the new updatePartIssueType) cascades to every Labour row
 * sourced from it, and the Labour sub-table shows Issue Type read-only (not independently
 * editable) so it can't silently drift from the Part line that governs it, matching your wording
 * literally. Removing a Part row also removes its Labour rows (cascade delete), since a Labour
 * line has no meaning once its governing Part line is gone.
 *
 * NOT implemented, disclosed rather than silently dropped: the video's own popup also has a
 * "Labour Technician" dropdown - see PartwiseLabourModal.tsx's own doc comment for why (same
 * pre-existing, already-disclosed "no technician-catalog endpoint for ServiceAdvisorUp" gap this
 * page's own header Technician field already lives with). TechnicianId is always sent as null.
 *
 * These Labour rows flow into Repair Bill exactly the way Material-Transfer Part rows already do
 * today - see RepairBillCreatePage.tsx's own materialTransferItems sync effect, extended the same
 * round to branch on itemType instead of assuming every synced row is a Part.
 *
 * 2026-09-23 ("this button not added why? please add and there history maintain in which job
 * card which item material transfered and there we can add labour"): reopen-as-editable, the
 * Material Transfer sibling of RepairBillCreatePage.tsx's own "click a saved bill, it reopens as
 * this same editable form" flow built the same round (video-confirmed, see that page's own doc
 * comment) - see startEditTransfer below for the full mechanics. "History ... which job card"
 * is the new Job No column on the combined list table further down (CombinedMaterialTransferRow.
 * jobNo, from MaterialTransferDocsController.ToCombinedRow's own JobCard include) - every row
 * already tells you which Job Card it was transferred for/against. "we can add labour" is the
 * existing per-Part-row "+ Add" button (2026-09-22/23, see above) - it needs no changes to work
 * once a transfer is reopened, since it just operates on this same `items` state either way.
 *
 * IMPORTANT divergence from Repair Bill's own reopen flow, called out since blindly copying that
 * page's pattern here would be WRONG: Repair Bill's Part lines re-derive FRESH from the job's
 * current Material Transfer on reopen (only Labour is restored from the bill's own saved rows),
 * because Material Transfer is a separate, still-live upstream source for Repair Bill to pull
 * from. Material Transfer has no such separate upstream source for ITS OWN Part lines - a
 * Material Transfer document IS the record being edited - so startEditTransfer restores EVERY
 * saved line (Part and Labour alike) directly from the doc's own Items, not just Labour.
 *
 * GST%/CGST/SGST/IGST are never persisted on MaterialTransferDocItem (confirmed on that model's
 * own doc comment - display-only, computed live from C_ItemMaster at pick time), so a restored
 * line has nothing saved to read them back from - each one is reset to the same 9/9/18 fallback
 * emptyItem() already uses. ASSUMPTION, disclosed rather than silently guessed: this only affects
 * the CGST Amt/SGST Amt/IGST Amt DISPLAY columns and the (also unpersisted) discount-vs-GST split
 * shown in this form - it does not change the saved Rate/Amount, which come from the doc as-is.
 * Likewise, discountType/discountValue are reset to '%'/'0' on restore (no re-discount) since a
 * saved line's own Rate already has any prior discount baked in - see lineCalc's own doc comment.
 *
 * sourcePartKey (which Part row a Labour row's "governed by" Issue Type comes from - see
 * updatePartIssueType) is NOT a persisted relationship on MaterialTransferDocItem either. On
 * restore it's rebuilt with a best-effort heuristic: items come back from the API in the same
 * order they were saved in, and every row was always originally appended either as a fresh Part
 * line or, for Labour, immediately after its parent Part row (via autoAddLabourForPart) - so each
 * restored Labour row is linked to the nearest PRECEDING Part row in that same saved order. This
 * is an ASSUMPTION (there's no reordering feature to break it today, but if one is ever added,
 * this heuristic would need revisiting) - it only affects whether changing a Part row's Issue
 * Type after reopening also cascades to its Labour rows and whether removing that Part row also
 * removes them; it never changes what's saved.
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
  /** 2026-09-22 (Labour-in-Material-Transfer integration, see module doc comment): 'Part' for
   * every row this page has always had; 'Labour' for a row staged via the new "Labour" button/
   * PartwiseLabourModal. Mirrors MaterialTransferDocItemType on the backend. */
  itemType: MaterialTransferDocItemType
  /** Set only on a 'Labour' row - the key of the Part row it was added from, so that Part row's
   * own Issue Type can govern (cascade to) this row (see updatePartIssueType) and removing that
   * Part row cascades to remove this one too. Null for every 'Part' row. */
  sourcePartKey: number | null
}
const emptyItem = (key: number): DraftItem => ({
  key, itemCode: '', itemDescription: '', hsnCode: '', qty: '1', rate: '0',
  rackNo: '', bin: '', serialNo: '', mrp: '', sgstPct: '9', cgstPct: '9', igstPct: '18',
  discountType: '%', discountValue: '0', validDays: '', itemReceived: '',
  issueType: '', availableQty: null, itemType: 'Part', sourcePartKey: null,
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
  const navigate = useNavigate()

  // ---------------- Location dropdown - scoped to the signed-in user's own accessible workshops -
  // drives the create form's own Location field. ----------------
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

  // 2026-09-23 ("this button not added why? please add"): reopen-as-editable state - see
  // startEditTransfer below and this module's own doc comment for the full mechanics. Mirrors
  // RepairBillCreatePage.tsx's editingBillId/editingBillNumber/editingBillStatus/editLoadError.
  const [editingTransferId, setEditingTransferId] = useState<string | null>(null)
  const [editingTransferNumber, setEditingTransferNumber] = useState<string | null>(null)
  const [editingTransferStatus, setEditingTransferStatus] = useState<MaterialTransferDocStatus | null>(null)
  const [editLoadError, setEditLoadError] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)

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
  // 2026-09-22: a Part row's Labour children (sourcePartKey === key) are cascade-removed with it -
  // a Labour row has no meaning once its governing Part line is gone. Still guarantees at least
  // one Part row remains (the "never end up with zero lines" guard the original logic already had).
  const removeItem = (key: number) => setItems((prev) => {
    const filtered = prev.filter((i) => i.key !== key && i.sourcePartKey !== key)
    return filtered.some((i) => i.itemType === 'Part') ? filtered : prev
  })
  const updateItem = (key: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  // 2026-09-22 ("which labour we added from amterial transfer for Issue Type - Paid that will goin
  // for paid type and which are in U/w that was going in U/w"): the Part row's own Issue Type
  // GOVERNS its Labour children - changing it here cascades to every Labour row sourced from this
  // Part row, rather than just setting the Part row's own value.
  const updatePartIssueType = (key: number, issueType: string) =>
    setItems((prev) => prev.map((i) => (i.key === key || i.sourcePartKey === key ? { ...i, issueType } : i)))

  // 2026-09-23 ("i chnaged my mind to change Item Code then still shown labour"): same cascade
  // Labour-clear as pickPartForLine's own codeChanged check below, but for the Item Code cell's
  // free-typed edits (PartSearchInput's onChangeText, which fires on every keystroke while
  // searching) rather than an actual dropdown pick. Only clears once - after the first keystroke
  // that actually differs from the row's current itemCode, there are no more sourcePartKey rows
  // left to remove, so further keystrokes are no-ops here.
  const changeItemCode = (key: number, newCode: string) =>
    setItems((prev) => {
      const current = prev.find((i) => i.key === key)
      const codeChanged = !!current && current.itemCode.trim().toUpperCase() !== newCode.trim().toUpperCase()
      const next = prev.map((i) => (i.key === key ? { ...i, itemCode: newCode } : i))
      return codeChanged ? next.filter((i) => i.sourcePartKey !== key) : next
    })

  // ---------------- Labour, auto-linked per Part row (Material Transfer's own "+ Add" button) ----------------
  // 2026-09-23 ("Labour ... that hide in page that only save in backend when i repair bill open in
  // that tht will shown" + "Labour button have on the place ADd button add and dont open pop up
  // tab direct that item code and Issue Type regarding which labour linked that link with that
  // item code dont show on ui hide this"): this REPLACES the old "Labour" button/PartwiseLabourModal
  // popup flow entirely - INTERPRETATION, flagged since the wording is broken English/Hinglish and
  // this is a real behaviour change, not just a relabel:
  //  - The popup (pick one or more Labour Codes, stage, Proceed) is gone. The button (renamed
  //    "+ Add") now fetches every Labour Master Partwise row for this Part Code
  //    (GET /api/material-transfer-docs/labour-by-part-code/{itemCode} - the SAME endpoint the
  //    popup used to call) and stages ALL of them in one click, silently - no dialog, no per-row
  //    choice. If your dealer's Labour Master Partwise genuinely has more than one Labour Code per
  //    Part Code that should NOT all be added together, this will over-add - say so and I'll bring
  //    back a choice, just not the modal-popup version.
  //  - The staged Labour rows are no longer shown in a visible table on THIS page at all (see the
  //    removed "Labour" panel further down) - they still save to the backend exactly as before
  //    (items already flowed into the same POST payload regardless of what was rendered), and still
  //    surface on Repair Bill once opened against the same Job (RepairBillCreatePage.tsx's own
  //    materialTransferItems sync effect, unchanged - that's where they become visible again).
  //  - Each Labour row's Issue Type still comes from its parent Part row (it.issueType at the
  //    moment of adding) and is still governed/cascaded by updatePartIssueType if the Part row's
  //    Issue Type changes later - unchanged from before.
  const [labourAddMessage, setLabourAddMessage] = useState<string | null>(null)
  const autoAddLabourForPart = async (it: DraftItem) => {
    setLabourAddMessage(null)
    let rows: LabourMasterPartwise[] = []
    try {
      const { data } = await staffApi.get<LabourMasterPartwise[]>(`/api/material-transfer-docs/labour-by-part-code/${encodeURIComponent(it.itemCode)}`)
      rows = data
    } catch {
      setLabourAddMessage(`Could not load Labour Master Partwise rates for ${it.itemCode}.`)
      return
    }
    const alreadyStaged = new Set(items.filter((i) => i.sourcePartKey === it.key).map((i) => i.itemCode))
    const toAdd = rows.filter((p) => p.labourCode && !alreadyStaged.has(p.labourCode))
    if (toAdd.length === 0) {
      setLabourAddMessage(rows.length === 0
        ? `No Labour Master Partwise rows found for ${it.itemCode}.`
        : `Every Labour code for ${it.itemCode} is already added.`)
      return
    }
    setItems((prev) => {
      let nextKey = (prev.at(-1)?.key ?? 0) + 1
      const newRows: DraftItem[] = toAdd.map((p) => {
        // LabourMasterPartwise stores IGST/CGST/SGST as plain decimal fractions (0.18 = 18%, per
        // this session's own confirmed convention) - converted to the same percentage-string shape
        // DraftItem's sgstPct/cgstPct/igstPct already use for a Part row's GST.
        const sgstPct = p.sgst != null ? p.sgst * 100 : 9
        const cgstPct = p.cgst != null ? p.cgst * 100 : 9
        const igstPct = p.igst != null ? p.igst * 100 : 18
        const totalGstPct = sgstPct + cgstPct > 0 ? sgstPct + cgstPct : igstPct
        const rate = p.labourRate ?? 0
        const row: DraftItem = {
          ...emptyItem(nextKey),
          itemType: 'Labour',
          sourcePartKey: it.key,
          itemCode: p.labourCode ?? '',
          itemDescription: p.jobDescription || p.labourCode || '',
          rate: String(rate),
          // Labour Master Partwise's own rate is GST-EXCLUSIVE (same convention
          // RepairBillCreatePage.tsx's own pickLabourForDraft uses) - MRP here is only the
          // display-only rate+GST figure lineCalc already computes for a Part row's MRP column.
          mrp: (rate * (1 + totalGstPct / 100)).toFixed(2),
          sgstPct: String(sgstPct),
          cgstPct: String(cgstPct),
          igstPct: String(igstPct),
          issueType: it.issueType,
        }
        nextKey += 1
        return row
      })
      return [...prev, ...newRows]
    })
    setLabourAddMessage(`✓ Added ${toAdd.length} Labour code${toAdd.length > 1 ? 's' : ''} for ${it.itemCode}.`)
  }

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
    staffApi.get<BaplItemMaster[]>('/api/item-master', { params: { activeOnly: true } })
      .then(({ data }) => setItemMasterCatalog(data))
      .catch(() => setItemMasterCatalog([]))
  }, [])

  const parts: BaplDmsPartStock[] = (() => {
    // Balance qty per part code at this Location (a later row for the same code wins, as before).
    const stockByCode = new Map<string, BaplDmsPartStock>()
    uploadedParts.forEach((u) => stockByCode.set(u.itemCode.trim().toUpperCase(), u))
    const seen = new Set<string>()
    const out: BaplDmsPartStock[] = []
    itemMasterCatalog.forEach((im) => {
      const key = im.itemCode.trim().toUpperCase()
      if (seen.has(key)) return // the catalogue's ItemCode is not unique - one picker row per part
      seen.add(key)
      const stock = stockByCode.get(key)
      out.push({
        itemCode: im.itemCode,
        description: im.itemName || im.displayName || im.itemCode,
        hsnCode: stock?.hsnCode || im.hsnCode,
        // Real balance when Part Upload has the part at this Location; otherwise 0 = "unknown", not "out of stock" (source 'itemMaster').
        availableQty: stock ? stock.availableQty : 0,
        dlrPrice: im.dlrPrice,
        sgstPct: im.sgst,
        cgstPct: im.cgst,
        igstPct: im.igst,
        source: stock ? 'partUpload' : 'itemMaster',
        billPrice: stock?.billPrice,
      })
    })
    return out
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
  // 2026-09-23 ("which have 0 qty for Item Code that dont allow to add"): a picked part with a
  // CONFIRMED zero balance (isConfirmedOutOfStock, imported from PartSearchInput.tsx - same one
  // rule used to grey out/disable a dropdown row there, so the two never drift apart) is refused
  // outright here too, since this is the one place every pick from either PartSearchInput instance
  // (Item Code column AND Description column both call this) funnels through - a defence-in-depth
  // check, not the only one.
  const pickPartForLine = async (key: number, p: BaplDmsPartStock) => {
    if (isConfirmedOutOfStock(p)) {
      setStockWarning(`${p.itemCode} has 0 balance at this location - cannot add.`)
      return
    }
    const current = items.find((i) => i.key === key)
    setPriceWarning(null)
    // 2026-09-23 ("i chnaged my mind to change Item Code then still shown labour ... clear labour
    // also cause for another Item Code have another labour"): Labour rows staged against this Part
    // row (sourcePartKey === key) were added against its OLD Item Code's own Labour Master Partwise
    // catalog - a different Item Code has a different (or no) set of applicable Labour Codes, so
    // they no longer belong once the Item Code actually changes. Cascade-clear them the same way
    // removeItem already cascades on delete, but only when the code is ACTUALLY changing (re-picking
    // the same item, e.g. just to refresh its price, must not wipe Labour that still applies).
    const codeChanged = !!current && current.itemCode.trim().toUpperCase() !== p.itemCode.trim().toUpperCase()
    if (codeChanged) setItems((prev) => prev.filter((i) => i.sourcePartKey !== key))
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

    // 2026-09-23 ("when i search Item Code and select then auto fetch all details in that also add
    // dependency with item code which i select Issue Type then automatically Paid that Part
    // Code(Item Code) regarding Category match Paid or U/W"): INTERPRETATION, flagged - Labour
    // Master Partwise's own Category column (confirmed real field, see the Labour Master page's own
    // screenshot showing "Paid" in a CATEGORY column) drives this Part row's Issue Type
    // automatically, the same lookup (labour-by-part-code) the old "Labour" popup used to call.
    // ASSUMPTION: a given Part Code's Labour Master Partwise rows all carry the SAME Category (the
    // row you showed had one Category per Part Code, not one per Labour Code within it) - the
    // FIRST matching row's Category is used as authoritative rather than requiring every row to
    // agree, since disagreement was never observed and blocking on it would silently skip this
    // auto-fill for no clear reason. Only overwrites when a category is actually found and maps
    // cleanly to "Paid" or "U/W" - never clears an existing Issue Type back to blank on a miss.
    try {
      const { data: labourRows } = await staffApi.get<LabourMasterPartwise[]>(`/api/material-transfer-docs/labour-by-part-code/${encodeURIComponent(p.itemCode)}`)
      const category = labourRows.find((l) => l.category)?.category?.trim().toLowerCase()
      const mappedIssueType = category?.includes('u/w') || category?.includes('uw') || category?.includes('warranty')
        ? 'U/W'
        : category?.includes('paid')
          ? 'Paid'
          : null
      if (mappedIssueType) updatePartIssueType(key, mappedIssueType)
    } catch {
      // Silent - this is a convenience auto-fill on top of the part pick, not something that
      // should surface its own error banner and compete with priceWarning/stockWarning above.
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

  // 2026-09-23 ("without Job No Job Search all feilds show disable ... To / From (Party) that
  // show disablw we cant edit this only this code"): Location/Transfer Type/Transfer Date/Remarks
  // now unlock once a Job is linked (see the header fields' new `disabled={!jobCardId}` below), but
  // Party is ALWAYS disabled - it is only ever auto-filled from the linked job (see selectJob
  // above), never a hand-typed field. Unlinking a job (this handler) therefore also resets
  // partyName (there is no other way to clear an always-disabled field) and Location back to the
  // user's default workshop, so unlinking never leaves a stale, now-unclearable value on screen.
  const clearJob = () => {
    setJobCardId(null)
    setJobCardNumber('')
    setPartyState(null)
    setPartyName('')
    setLocation(workshops.length > 0 ? workshops[0].locCode : '')
  }

  // 2026-09-23 - factored out of save()'s old POST-success handler so cancelEdit can reuse the
  // exact same "blank form" reset, mirroring RepairBillCreatePage.tsx's own resetFormToNew.
  const resetFormToNew = () => {
    clearJob()
    setTransferType('Issue')
    setTransferDate(new Date().toISOString().slice(0, 10))
    setRemarks('')
    setItems([emptyItem(1)])
    setStockWarning(null)
    setPriceWarning(null)
    setLabourAddMessage(null)
    setEditingTransferId(null)
    setEditingTransferNumber(null)
    setEditingTransferStatus(null)
  }

  // 2026-09-23 ("this button not added why? please add and there history maintain in which job
  // card which item material transfered and there we can add labour"): reopens an existing
  // JobCardScanner-own, still-Draft transfer as THIS SAME form, pre-filled, so it can be edited
  // and re-saved (Update Draft) or finalized (Confirm Transfer) right here - see this module's
  // own doc comment above for the full reasoning, especially why every item (Part AND Labour) is
  // restored directly from the doc's own saved rows here, unlike Repair Bill's Parts-re-derive-
  // fresh/Labour-only-restore split.
  const startEditTransfer = (id: string) => {
    setSaveError(null); setSaveOk(null); setEditLoadError(null)
    staffApi.get<MaterialTransferDoc>(`/api/material-transfer-docs/${id}`)
      .then(({ data: doc }) => {
        setEditingTransferId(doc.id)
        setEditingTransferNumber(doc.transferNumber)
        setEditingTransferStatus(doc.status)

        setTransferType(doc.transferType)
        setPartyName(doc.partyName || '')
        setRemarks(doc.remarks || '')
        setTransferDate(doc.transferDate ? doc.transferDate.slice(0, 10) : new Date().toISOString().slice(0, 10))
        setLocation(doc.location || '')

        let nextKey = 1
        let lastPartKey: number | null = null
        const restoredItems: DraftItem[] = doc.items.map((it) => {
          const key = nextKey++
          if (it.itemType === 'Part') lastPartKey = key
          return {
            key,
            itemCode: it.itemCode,
            itemDescription: it.itemDescription,
            hsnCode: it.hsnCode || '',
            qty: String(it.qty),
            rate: String(it.rate),
            rackNo: it.rackNo || '',
            bin: it.bin || '',
            serialNo: it.serialNo || '',
            mrp: it.mrp != null ? String(it.mrp) : '',
            // Never persisted (display-only) - defaulted back to emptyItem()'s own fallback, see
            // this module's own doc comment for why. Does not affect the saved Rate/Amount.
            sgstPct: '9', cgstPct: '9', igstPct: '18',
            // The saved Rate already has any prior discount baked in - see lineCalc's own doc
            // comment - so a restored line starts with no further discount stacked on top.
            discountType: '%', discountValue: '0',
            validDays: it.validDays != null ? String(it.validDays) : '',
            itemReceived: it.itemReceived || '',
            issueType: it.issueType || '',
            // No saved stock-at-pick-time figure to restore - the Qty cap only re-applies once
            // the line's part is re-picked (or a new one added). Never sent to the backend anyway.
            availableQty: null,
            itemType: it.itemType,
            // Best-effort heuristic (nearest preceding Part row in saved order) - see this
            // module's own doc comment for why there's no persisted parent link to restore exactly.
            sourcePartKey: it.itemType === 'Labour' ? lastPartKey : null,
          }
        })
        // No separate "next key" ref exists on this page - addItem/autoAddLabourForPart both
        // derive the next key from the current last item (prev.at(-1)?.key ?? 0) + 1, which
        // naturally continues on from these restored keys with no extra bookkeeping needed.
        setItems(restoredItems.length > 0 ? restoredItems : [emptyItem(1)])
        setStockWarning(null); setPriceWarning(null); setLabourAddMessage(null)

        if (doc.jobCardId) {
          setJobCardId(doc.jobCardId)
          setJobCardNumber(doc.jobCardNumber || '')
          staffApi.get<JobSearchResult[]>('/api/jobcards/search', { params: { jobNo: doc.jobCardNumber || undefined } })
            .then(({ data }) => {
              const job = data.find((j) => j.id === doc.jobCardId) ?? data[0]
              if (job) setPartyState(job.partyState ?? null)
            })
            .catch(() => { /* non-fatal - tax-mode detection just stays defaulted to Same State */ })
        } else {
          // A standalone (no-Job) transfer, saved before Parts required a linked Job - still
          // opened here so its fields are visible/reviewable, but the Part grid stays disabled
          // (same `disabled={!jobCardId}` gate a brand-new, not-yet-linked form already has).
          setJobCardId(null); setJobCardNumber(''); setPartyState(null)
        }

        window.scrollTo({ top: 0, behavior: 'smooth' })
      })
      .catch((err) => setEditLoadError(err?.response?.data?.message ?? `Could not load Transfer ${id} for editing.`))
  }

  // 2026-09-23 ("in repairbill which we added button like this add in material transfer") - opens
  // this page already in edit mode when arrived at via /material-transfer-bill?editId={id} (the
  // new MaterialTransferListPage.tsx's own Edit navigation) - mirrors RepairBillCreatePage.tsx's
  // own identical ?editId= effect.
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const editId = searchParams.get('editId')
    if (editId) startEditTransfer(editId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const cancelEdit = () => { resetFormToNew(); setEditLoadError(null) }

  // 2026-09-23 - "Confirm Transfer" reachable directly from the reopened edit form, the Material
  // Transfer sibling of RepairBillCreatePage.tsx's own finalizeEditingBillAsInvoice - reuses the
  // existing PUT .../status endpoint (unchanged, already used for other status transitions).
  const finalizeEditingTransferAsConfirmed = () => {
    if (!editingTransferId || !editingTransferNumber) return
    if (!window.confirm(`Confirm Transfer ${editingTransferNumber}? This finalizes it - line items can no longer be changed afterwards.`)) return
    setConvertingId(editingTransferId)
    staffApi
      .put(`/api/material-transfer-docs/${editingTransferId}/status`, JSON.stringify('Confirmed'), { headers: { 'Content-Type': 'application/json' } })
      .then(() => {
        setEditingTransferStatus('Confirmed')
        setSaveOk(`Transfer ${editingTransferNumber} confirmed.`)
        // 2026-09-23 - loadCombined() removed: the list now lives on its own page
        // (MaterialTransferListPage.tsx / /material-transfer-list), which re-fetches on its own mount.
      })
      .catch((err) => alert(err?.response?.data?.message ?? 'Could not confirm this transfer.'))
      .finally(() => setConvertingId(null))
  }

  const save = () => {
    setSaveError(null)
    setSaveOk(null)
    const validItems = items.filter((i) => i.itemDescription.trim() && Number(i.qty) > 0)
    if (validItems.length === 0) { setSaveError('Add at least one item line with a description and quantity.'); return }

    setSaving(true)
    const body = {
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
          // 2026-09-22 (Labour-in-Material-Transfer integration): itemType tells the backend which
          // rows are Labour (added via the "Labour" button/PartwiseLabourModal) vs the page's own
          // original Part rows - see MaterialTransferDocItemType's doc comment on the backend for
          // why a Labour row never touches PartUploads stock. technicianId stays null - same
          // disclosed gap as the page's own header Technician field (see module doc comment).
          itemType: i.itemType,
          technicianId: null,
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
    }

    // 2026-09-23 - editingTransferId set means startEditTransfer above loaded an existing Draft
    // transfer: PUT updates it IN PLACE (same transfer, same Transfer No) instead of POSTing a
    // new one - mirroring RepairBillCreatePage.tsx's own save()'s editingBillId branch. The form
    // is deliberately NOT reset to blank on a successful update (unlike a fresh create, below) -
    // staying on this same transfer is what lets "Confirm Transfer" immediately follow.
    const request = editingTransferId
      ? staffApi.put(`/api/material-transfer-docs/${editingTransferId}`, body)
      : staffApi.post('/api/material-transfer-docs', body)

    request
      .then((r) => {
        if (editingTransferId) {
          setSaveOk(`Updated ${r.data.transferNumber}.`)
        } else {
          setSaveOk(`Saved as ${r.data.transferNumber}.`)
          resetFormToNew()
        }
        // 2026-09-23 - loadCombined() removed: see note on finalizeEditingTransferAsConfirmed above.
      })
      .catch((err) => setSaveError(err?.response?.data?.message ?? `Could not ${editingTransferId ? 'update' : 'save'} the material transfer.`))
      .finally(() => setSaving(false))
  }

  // 2026-09-23 ("in repairbill which we added button like this add in material transfer for
  // showing which we transferred"): the combined list (this app's own transfers + DMSBAPLDATA-
  // synced ones), its filters, pagination, Delete, and the read-only detail popup all moved OUT of
  // this page onto their own separate page - see MaterialTransferListPage.tsx (route
  // /material-transfer-list), mirroring RepairBillListPage.tsx's own identical split. This page is
  // now the create/edit FORM only. `convertingId` (declared earlier, above, with the rest of the
  // reopen-as-editable state) stays here since finalizeEditingTransferAsConfirmed (this page's own
  // "Confirm Transfer" button while editing) still needs it - it's unrelated to the list.

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Material Transfer Bill</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/material-transfer-list')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden="true">☰</span>Material Transfer List
        </button>
      </div>
      {/* <p className="muted">
        Create a material transfer document - saved into JobCardScanner's own database. To see
        transfers already saved here (with Edit / Confirm Transfer), use "Material Transfer List" above.
      </p> */}

      <div className="card">
        {/* 2026-09-23 ("this button not added why? please add"): this same card/form now doubles
            as the edit view for an existing Draft transfer - see startEditTransfer's own doc
            comment above. editLoadError surfaces if that fetch itself fails (e.g. the transfer
            was deleted by someone else a moment before the click landed). */}
        {editingTransferId ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Editing Transfer {editingTransferNumber} <span className="badge badge-muted" style={{ marginLeft: 6 }}>{editingTransferStatus}</span></h3>
            <button className="btn btn-sm" type="button" onClick={cancelEdit}>✕ Cancel edit / start a new transfer</button>
          </div>
        ) : (
          <h3>New Material Transfer</h3>
        )}
        {editLoadError && <p className="muted" style={{ color: '#b91c1c' }}>{editLoadError}</p>}
        {/* 2026-09-23 ("fix ui like repair bill and without Job No Job Search all feilds show
            disable"): matches RepairBillCreatePage.tsx's own bordered/accented "Job & Bill Details"
            panel (same --primary/--border/--radius-sm tokens, no new styling invented - see that
            page's own "attractive page" doc comment). Functionally: every field below Job No is
            now disabled until a Job is linked (`disabled={!jobCardId}`), since Location/Transfer
            Type/Transfer Date/Remarks only make sense once a job's own data is in context - Job No
            itself is always the one live entry point. To/From (Party) is a stricter case: it is
            ALWAYS disabled, Job-linked or not (see below) - it is only ever auto-filled from the
            linked job's own PartyName (selectJob above), never a field a user is meant to type
            into by hand. */}
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
        <div className="form-row">
          <div className="field">
            <label>Location</label>
            {workshops.length > 0 ? (
              <select value={location} onChange={(e) => setLocation(e.target.value)} disabled={!jobCardId}>
                <option value="">— select —</option>
                {workshops.map((w) => (
                  <option key={w.locCode} value={w.locCode}>{w.locCode} — {w.locName}</option>
                ))}
              </select>
            ) : (
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Workshop location" disabled={!jobCardId} />
            )}
          </div>
          <div className="field">
            <label>Transfer Type</label>
            <select value={transferType} onChange={(e) => setTransferType(e.target.value as MaterialTransferDocType)} disabled={!jobCardId}>
              <option value="Issue">Issue</option>
              <option value="Return">Return</option>
            </select>
          </div>
          <div className="field">
            <label>To / From (Party)</label>
            <input
              value={partyName}
              readOnly
              disabled
              placeholder="Auto-filled from the linked job"
              title="Auto-filled from the linked job's Party Name - not hand-editable."
            />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>Transfer Date</label>
            <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} disabled={!jobCardId} />
          </div>
          <div className="field">
            <label>Remarks</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!jobCardId} />
          </div>
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
        {/* 2026-09-23 ("fix ui like repair bill"): own bordered/accented panel matching
            RepairBillCreatePage.tsx's own "Part Details List" panel (--accent-3/--warning/📦 -
            same tokens, nothing new invented). Purely visual - no column, data, or save behaviour
            changed here. */}
        {/* 2026-09-23 ("without Job Search we cant add Part Details List tha also show block
            sytematic wants"): extends the previous round's Job-linked gate (which so far only
            covered the header fields) to this whole grid - every input/button in a Part row, plus
            the "+ Add Line" button below the table, is now ALSO disabled until a Job is linked
            (`disabled={!jobCardId}`, same flag/pattern as the header fields), not just Location/
            Party/etc. A one-line hint replaces nothing that was there before - it's shown only in
            the no-job state so it's obvious WHY the grid looks blocked. */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--accent-3)', padding: '14px 16px', marginBottom: 18, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--warning)', fontWeight: 600 }}>
            <span>📦</span><span>Part Details List</span>
          </div>
          {!jobCardId && (
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
              Search and link a Job above to add parts.
            </p>
          )}
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
              {items.filter((i) => i.itemType === 'Part').map((it) => {
                const tax = lineTax(it, isSameState)
                const calc = lineCalc(it)
                return (
                <tr key={it.key}>
                  <td>
                    <PartSearchInput
                      parts={parts}
                      value={it.itemCode}
                      onChangeText={(text) => changeItemCode(it.key, text)}
                      onPick={(p) => pickPartForLine(it.key, p)}
                      placeholder="Item code…"
                      width={130}
                      disabled={!jobCardId}
                    />
                  </td>
                  <td>
                    <PartSearchInput
                      parts={parts}
                      value={it.itemDescription}
                      onChangeText={(text) => updateItem(it.key, { itemDescription: text })}
                      onPick={(p) => pickPartForLine(it.key, p)}
                      width={210}
                      disabled={!jobCardId}
                    />
                  </td>
                  <td><input value={it.hsnCode} readOnly placeholder="—" title="Auto-filled from the picked part." style={{ width: 100 }} /></td>
                  <td>
                    <select value={it.issueType} onChange={(e) => updatePartIssueType(it.key, e.target.value)} style={{ minWidth: 130 }} disabled={!jobCardId}>
                      <option value="">— select —</option>
                      <option value="Paid">Paid</option>
                      <option value="U/W">U/W</option>
                    </select>
                  </td>
                  <td><input type="number" value={it.qty} onChange={(e) => updateQty(it.key, e.target.value)} style={{ width: 70, textAlign: 'right' }} disabled={!jobCardId} /></td>
                  <td><input type="number" value={it.rate} onChange={(e) => updateItem(it.key, { rate: e.target.value })} title={it.mrp ? `Reverse-calculated from Dealer Price ₹${it.mrp} at ${calc.sgstPct + calc.cgstPct || calc.igstPct}% GST - edit to override.` : undefined} style={{ width: 90, textAlign: 'right' }} disabled={!jobCardId} /></td>
                  <td className="text-end">₹{tax.cgstAmt.toFixed(2)}{tax.cgstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{tax.cgstPct}%</span></>}</td>
                  <td className="text-end">₹{tax.sgstAmt.toFixed(2)}{tax.sgstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{tax.sgstPct}%</span></>}</td>
                  <td className="text-end">₹{tax.igstAmt.toFixed(2)}{tax.igstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{tax.igstPct}%</span></>}</td>
                  <td>
                    <select value={it.discountType} onChange={(e) => updateItem(it.key, { discountType: e.target.value as DiscountType })} style={{ minWidth: 80 }} disabled={!jobCardId}>
                      <option value="%">%</option>
                      <option value="Value">₹</option>
                    </select>
                  </td>
                  <td><input type="number" value={it.discountValue} onChange={(e) => updateItem(it.key, { discountValue: e.target.value })} style={{ width: 90, textAlign: 'right' }} disabled={!jobCardId} /></td>
                  <td className="text-end">₹{calc.amount.toFixed(2)}</td>
                  <td className="text-end">₹{calc.mrp.toFixed(2)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => autoAddLabourForPart(it)}
                        disabled={!jobCardId || !it.itemCode.trim()}
                        title={!jobCardId ? 'Link a Job first' : it.itemCode.trim() ? 'Auto-add every Labour Master Partwise code for this part' : 'Pick an Item Code first'}
                      >
                        + Add
                      </button>
                      <button className="btn btn-icon btn-danger" onClick={() => removeItem(it.key)} title="Remove line" disabled={!jobCardId}>✕</button>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </div>

        {/* 2026-09-23 ("Labour ... that hide in page that only save in backend when i repair bill
            open in that tht will shown" + "dont show on ui hide this"): the Labour Details List
            table that used to render here (one row per Labour Master Partwise code staged via a
            Part row's own button) is REMOVED from this page's UI - staged Labour rows still exist
            in `items` and still save to the backend exactly as before (see save() below, unchanged
            - it already iterated over the full `items` array regardless of what was rendered here),
            they're just no longer shown on THIS screen. They become visible again once you open
            Repair Bill for the same Job (RepairBillCreatePage.tsx's own materialTransferItems sync
            effect already pulls them in, unchanged by this round). autoAddLabourForPart's own
            success/error message (below) is the only on-screen feedback left for the "+ Add" click
            itself - a transient confirmation line, not a persistent table, so it doesn't reintroduce
            the thing you asked to hide. */}
        {labourAddMessage && <p className="muted" style={{ marginTop: 10 }}>{labourAddMessage}</p>}
        {stockWarning && <p className="muted" style={{ color: '#b45309', marginTop: 10 }}>⚠ {stockWarning}</p>}
        {priceWarning && <p className="muted" style={{ color: '#b45309', marginTop: 10 }}>⚠ {priceWarning}</p>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <button className="btn btn-sm" onClick={addItem} disabled={!jobCardId} title={!jobCardId ? 'Link a Job first' : undefined}>+ Add Line</button>
          <span className="muted">
            {partyState
              ? `Tax: ${isSameState ? 'Same State (CGST+SGST)' : 'Different State (IGST)'}, auto-detected from the linked job's customer state - `
              : `Tax: Same State (CGST+SGST), defaulted (no job linked - this dealer's own stock moving internally) - `}
            Total (excl. GST, not persisted): <strong>₹{estimatedTotal.toFixed(2)}</strong>
          </span>
        </div>

        {/* 2026-09-23 - while editing an existing transfer (editingTransferId set), the Save
            button becomes "Update Draft" and is disabled once the transfer is no longer Draft
            (Confirmed/Cancelled has no "undo" here - see startEditTransfer's own doc comment) -
            "Confirm Transfer" now also appears right here, matching RepairBillCreatePage.tsx's
            own Save-as-Proforma/Save-as-Invoice pairing on its own reopened edit form. */}
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || editingTransferStatus === 'Confirmed' || editingTransferStatus === 'Cancelled'}
          >
            {saving ? 'Saving…' : editingTransferId ? 'Update Draft' : 'Save Material Transfer'}
          </button>
          {editingTransferId && editingTransferStatus === 'Draft' && (
            <button className="btn btn-sm" type="button" disabled={convertingId === editingTransferId} onClick={finalizeEditingTransferAsConfirmed}>
              {convertingId === editingTransferId ? 'Saving…' : 'Confirm Transfer'}
            </button>
          )}
          {editingTransferId && editingTransferStatus !== 'Draft' && (
            <span className="muted" style={{ fontSize: 13 }}>This transfer is already {editingTransferStatus} - it can no longer be edited.</span>
          )}
        </div>
        {saveError && <p className="muted" style={{ color: '#b91c1c' }}>{saveError}</p>}
        {saveOk && <p className="muted" style={{ color: '#15803d' }}>{saveOk}</p>}
      </div>

      {/* 2026-09-23 - the combined list (filters, table, read-only detail popup) moved to its own
          page: see the "Material Transfer List" button in the header above, and
          MaterialTransferListPage.tsx / route /material-transfer-list. */}
      {showJobSearch && <JobSearchModal onSelect={selectJob} onClose={() => setShowJobSearch(false)} />}
    </div>
  )
}
