import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsLabourRow, BaplDmsPartStock, BaplDmsWorkshop, BaplItemMaster, CombinedRepairBillRow, JobSearchResult, PartUpload, RepairBillDocItemType } from '../../types'
import { Pagination } from '../../components/Pagination'
import { usePagination } from '../../lib/usePagination'
import { JobSearchModal } from '../../components/JobSearchModal'
import { PartSearchInput } from '../../components/PartSearchInput'
import { LabourSearchInput } from '../../components/LabourSearchInput'
import { RecordDetailModal } from '../../components/RecordDetailModal'

/**
 * "Repair Bill" sidebar page (2026-09-19: "now i want Create Repair Bill and Material Transfer
 * Bill ... i want to now this both pages data i want save in JobCardScannerDb ... fetched data
 * both from DMSBAPLDATAConnection from this db repair bill and material transfer this both data
 * wants to show in 1 place"; corrected 2026-09-21, "backend logic which u gave u and ui same make
 * only according to our project dont chnage Repair Bill and Material tranfer logic"). Two parts:
 *  1. A create form that POSTs to /api/repair-bill-docs - saved into JobCardScanner's OWN
 *     database (RepairBillDocs/RepairBillDocItems), never into BAPL DMS or DMSBAPLDATA.
 *  2. A combined list below (GET /api/repair-bill-docs/combined) showing bills created here
 *     side-by-side with the existing read-only DMSBAPLDATA-synced repair bills - each row tagged
 *     with its Source so the two are never presented as if they were the same record.
 *
 * This is a NEW page/route, distinct from the existing read-only RepairBillPage.tsx ("Repair Bill
 * Report" in the sidebar) - that page and its route are unchanged.
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
 */
type TaxMode = 'Same State (CGST+SGST)' | 'Different State (IGST)'
type DiscountType = 'None' | 'Percentage' | 'Amount'

type DraftItem = {
  key: number
  itemType: RepairBillDocItemType
  itemCode: string
  itemDescription: string
  hsnCode: string
  qty: string
  rate: string
  /** GST-inclusive MRP, captured when a part is picked via search - kept only so Rate can be
   * re-derived (MRP / (1 + gst% / 100)) if the line's GST % is edited afterwards; not itself sent
   * to the backend (RepairBillDocItem has no Mrp column, matching the reference's own
   * RepairBillDetail, which stores PartMRP only as display data, not as this page's source of
   * truth for Rate). Empty for a Labour line or a hand-typed Part with no picked stock row. */
  mrp: string
  gstPct: string
  discountType: DiscountType
  discountValue: string
  /** Reference: RepairBillDetail.IssutypeId, per line - "Paid" (taxed normally), "U/W" or "FSC"
   * (zero tax). Empty defers to the bill-level Issue Type default. */
  issueType: string
  /** Stock available at the current Location for this line's Item Code, captured when a part is
   * picked via search - used only to cap/warn on Qty (see updateQty below), never sent to the
   * backend. Null for a Labour line or a hand-typed Part with no picked stock row. */
  availableQty: number | null
}

const emptyItem = (key: number, defaultIssueType = ''): DraftItem => ({
  key, itemType: 'Part', itemCode: '', itemDescription: '', hsnCode: '', qty: '1', rate: '0', mrp: '', gstPct: '18',
  discountType: 'None', discountValue: '0', issueType: defaultIssueType, availableQty: null,
})

/** Reverse-calculates a GST-exclusive base Rate out of a GST-inclusive MRP, matching the
 * reference's own material-transfer.ts calculateGST(): basePrice = finalPrice / (1 + gst% / 100).
 * "Part - Rate = MRP - GST%" - confirmed against that pasted source, not inferred. */
const rateFromMrp = (mrp: number, gstPct: number) => mrp / (1 + gstPct / 100)

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
  const [jobCardNumber, setJobCardNumber] = useState('')
  const [showJobSearch, setShowJobSearch] = useState(false)
  const [partyName, setPartyName] = useState('')
  const [regNo, setRegNo] = useState('')
  const [chassisNo, setChassisNo] = useState('')
  const [location, setLocation] = useState('')
  const [billType, setBillType] = useState('Cash')
  const [issueType, setIssueType] = useState('')
  const [taxMode, setTaxMode] = useState<TaxMode>('Same State (CGST+SGST)')
  const [taxModeAuto, setTaxModeAuto] = useState(false)
  const [partyState, setPartyState] = useState<string | null>(null)
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  const [items, setItems] = useState<DraftItem[]>([emptyItem(1)])

  // 2026-09-21 ("according to state Intra state and inter state"): auto-detect Same State vs
  // Different State from this dealer's own State (GET /api/auth/me's DealerState) compared
  // against the picked job's Customer.State (JobSearchResult.partyState) - the exact compare the
  // reference's repair-bill.ts addLabour()/calculatePart() do (isSameState = dealerState.trim()
  // .toUpperCase() === custState.trim().toUpperCase()). Only auto-sets when BOTH states are known
  // (a job is linked and that job's customer has a State on file); otherwise this page falls back
  // to the existing manual Tax Type dropdown, since guessing would be worse than asking.
  useEffect(() => {
    const dealerState = profile?.dealerState
    if (!dealerState || !partyState) { setTaxModeAuto(false); return }
    setTaxMode(dealerState.trim().toUpperCase() === partyState.trim().toUpperCase()
      ? 'Same State (CGST+SGST)' : 'Different State (IGST)')
    setTaxModeAuto(true)
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

  const addItem = () => setItems((prev) => [...prev, emptyItem((prev.at(-1)?.key ?? 0) + 1, issueType)])
  const removeItem = (key: number) => setItems((prev) => (prev.length > 1 ? prev.filter((i) => i.key !== key) : prev))
  const updateItem = (key: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  // "and if stock add available then that will add" - caps Qty to the picked stock row's
  // AvailableQty, same guard as the reference's own onBlurQuantity stock-limit check.
  const [stockWarning, setStockWarning] = useState<string | null>(null)
  // 2026-09-22 - see pickPartForLine's doc comment below: tells the user WHY Rate/MRP weren't
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

  const estimatedTotal = items.reduce((sum, it) => sum + lineEstimate(it, taxMode, issueType).total, 0)
  // Per-line Issue Type (2026-09-21 correction) means zero-tax is no longer a single whole-bill
  // flag - this counts how many of the current lines actually resolve to zero-tax (own IssueType,
  // falling back to the bill-level default), for the summary line below.
  const zeroTaxLineCount = items.filter((it) => isZeroTaxIssue(it.issueType || issueType)).length

  // Parts available at the currently-selected Location - fetched once per location change, then
  // searched client-side by each line's own PartSearchInput (same pattern PartSuggestionCard on
  // the Job Card Detail page already uses).
  //
  // 2026-09-21 ("stock also shown from partuploads and in repair bill"): merged in with parts
  // uploaded via the "Part Upload" tab for the SAME location, same as
  // MaterialTransferCreatePage.tsx's own fifth 2026-09-21 correction - see that page's doc comment
  // for the full reasoning (source: 'partUpload' tagging, BillPrice-direct Rate, no reverse-GST).
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
  // 2026-09-21 ninth correction ("why duplicate Item Code shown") - see
  // MaterialTransferCreatePage.tsx's own identical correction for the full reasoning: dedupe by
  // Item Code, Part Upload winning over live DMS stock.
  const uploadedCodes = new Set(uploadedParts.map((p) => p.itemCode.trim().toUpperCase()))

  // 2026-09-21 ("Rate = Dlr_Price - GST% ... fetch from baplfinal databse ... use in material
  // transfer and repair bill"): same C_ItemMaster enrichment as MaterialTransferCreatePage.tsx -
  // see that page's identical block for the full reasoning (this bulk-enriches BOTH live-DMS and
  // Part-Upload rows alike, since Part Upload's BillPrice is no longer used for Rate here either).
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
  // select"): same fix as MaterialTransferCreatePage.tsx's own identical block - `parts` is now
  // seeded primarily from the full, dealer/location-agnostic C_ItemMaster catalog (fetched once on
  // mount, not scoped to a Location), so Item Code/Description search works whether or not a
  // Location/Job has been chosen yet. Live DMS stock/Part Upload rows for the current Location are
  // then merged on top (for availableQty and the "Uploaded" badge) - see PartSearchInput.tsx's own
  // updated doc comment for the full reasoning.
  const [itemMasterCatalog, setItemMasterCatalog] = useState<BaplItemMaster[]>([])
  useEffect(() => {
    staffApi.get<BaplItemMaster[]>('/api/item-master')
      .then(({ data }) => setItemMasterCatalog(data))
      .catch(() => setItemMasterCatalog([]))
  }, [])

  const parts: BaplDmsPartStock[] = (() => {
    const byCode: Record<string, BaplDmsPartStock> = {}
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

  // 2026-09-21 ("Labour - when labor type select then Labour Code suggestion shown"): a SEPARATE
  // list from `parts` above, sourced from DMS's own Labour Master (GET /api/bapl-dms/labour, the
  // SAME endpoint/data JobCardDetailPage.tsx's Labour Suggestion panel already uses) - scoped to
  // this location's owning dealer (LocCode is always {DealerCode}W{n} - see BaplDmsService's own
  // WorkshopLocCodeRegex - so the trailing W<digits> is stripped the same way
  // DmsBaplDataController.cs already recovers a dealer code from a workshop LocCode elsewhere in
  // this codebase). No JobType/ServiceHead/ServiceType cascade filter here (this page has none of
  // those loaded, unlike the Job Card Detail page) - every active labour row for this dealer is
  // offered, narrowed by the picker's own free-text search.
  const [labours, setLabours] = useState<BaplDmsLabourRow[]>([])
  useEffect(() => {
    if (!location) { setLabours([]); return }
    const dealerCode = location.replace(/W\d+$/i, '')
    staffApi.get<BaplDmsLabourRow[]>('/api/bapl-dms/labour', { params: { dealerCode: dealerCode || undefined } })
      .then(({ data }) => setLabours(data))
      .catch(() => setLabours([]))
  }, [location])

  /** Picking a Labour Master row sets Rate DIRECTLY from LabourRate (not reverse-calculated - a
   * labour rate card's own GST-exclusive rate, unlike a Part's tax-inclusive MRP/Dealer Price) and
   * its OWN Sgst/Cgst/Igst percentages (already confirmed real columns - see BaplDmsLabourRow's
   * doc comment in BaplDmsService.cs) as this line's gstPct total, which then flows through the
   * SAME taxMode/splitGst() pipeline every other line already uses (see lineEstimate/splitGst
   * below) - no separate tax model needed for Labour vs Part lines. */
  const pickLabourForLine = (key: number, l: BaplDmsLabourRow) => {
    const totalGst = (l.cgst ?? 0) + (l.sgst ?? 0) > 0 ? (l.cgst ?? 0) + (l.sgst ?? 0) : (l.igst ?? 18)
    updateItem(key, {
      itemCode: l.labourCode,
      itemDescription: l.labourDescription || l.labourCode,
      hsnCode: l.hsnCode || '',
      mrp: '',
      rate: l.labourRate != null ? String(l.labourRate) : '0',
      gstPct: String(totalGst),
      availableQty: null,
    })
  }

  // 2026-09-21 ("Rate = Dlr_Price - GST% ... fetch from baplfinal databse"): picking a Part now
  // reverse-calculates its GST-exclusive Rate out of C_ItemMaster's confirmed, GST-INCLUSIVE
  // Dlr_Price using that item's own SGST/CGST/IGST percentages (via the itemMasterByCode merge
  // above), same replacement as MaterialTransferCreatePage.tsx's own pickPartForLine - see that
  // page's doc comment for the full reasoning, including why Part-Upload's BillPrice is no longer
  // used for Rate. Falls back to the previous Mrp-based/default-18%/BillPrice-direct behaviour only
  // when this item code has no C_ItemMaster match.
  // 2026-09-22 ("which dealer price are there in item-master that will not came in material
  // transfer ... dont take this calclation from parts-upload for clculation take item-master
  // rate , mrp , amount calculation"): same fix as MaterialTransferCreatePage.tsx's own
  // pickPartForLine - see that page's doc comment for the full race-condition/1000-row-cap
  // reasoning this closes. Picking a Part now fetches C_ItemMaster fresh, for this EXACT Item
  // Code, at the moment of picking (GET /api/item-master/by-codes?codes=<one code>) - Rate/MRP/
  // GST% are ALWAYS computed from that fresh row; Part Upload/live DMS stock now only ever
  // supplies Item Code/Description/HSN/availableQty, never a price. If C_ItemMaster genuinely has
  // no row for this code, Rate/MRP are left for manual entry, with priceWarning below explaining
  // why instead of silently falling back to Part Upload's Bill Price.
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
        rate: rateFromMrp(im.dlrPrice, totalGst).toFixed(2),
        gstPct: String(totalGst),
        hsnCode: im.hsnCode || p.hsnCode || '',
      })
    } else {
      setPriceWarning(`No Item Master (C_ItemMaster) price found for ${p.itemCode} - Rate/MRP left for manual entry.`)
    }
  }

  const selectJob = (job: JobSearchResult) => {
    setJobCardId(job.id)
    setJobCardNumber(job.jobCardNumber)
    if (job.partyName) setPartyName(job.partyName)
    if (job.regNo) setRegNo(job.regNo)
    if (job.chassisNo) setChassisNo(job.chassisNo)
    if (job.locationCode) setLocation(job.locationCode)
    setPartyState(job.partyState ?? null)
    setShowJobSearch(false)
  }

  const clearJob = () => { setJobCardId(null); setJobCardNumber(''); setPartyState(null) }

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
        setStockWarning(null)
        setPartyName(''); setRegNo(''); setChassisNo(''); setBillType('Cash'); setIssueType(''); setRemarks('')
        setInsuranceCompanyName(''); setInsuranceDescription(''); setSurveyorName(''); setSurveyorContactNumber('')
        setPolicyNo(''); setInsuranceValidTill(''); setZeroDepreciation(false); setTotalDiscount('0'); setAmountReceived('0')
        setItems([emptyItem(1)])
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
            <label>Party Name *</label>
            <input value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Customer or fleet party name" />
          </div>
          <div className="field">
            <label>Reg No</label>
            <input value={regNo} onChange={(e) => setRegNo(e.target.value)} />
          </div>
          <div className="field">
            <label>Chassis No</label>
            <input value={chassisNo} onChange={(e) => setChassisNo(e.target.value)} />
          </div>
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
          <div className="field">
            <label>Issue Type (default for new lines)</label>
            <select value={issueType} onChange={(e) => setIssueType(e.target.value)}>
              <option value="">— none —</option>
              <option value="Paid">Paid (taxed)</option>
              <option value="U/W">U/W - Under Warranty (zero tax)</option>
              <option value="FSC">FSC - Free Service Coupon (zero tax)</option>
            </select>
          </div>
          <div className="field">
            <label>Tax Type{taxModeAuto ? ' (auto-detected)' : ''}</label>
            <select
              value={taxMode}
              onChange={(e) => { setTaxMode(e.target.value as TaxMode); setTaxModeAuto(false) }}
              title={taxModeAuto ? `Auto-detected from Dealer State (${profile?.dealerState}) vs Party State (${partyState}) - change to override.` : 'Pick a job with a customer on file to auto-detect this from state.'}
            >
              <option value="Same State (CGST+SGST)">Same State (CGST+SGST)</option>
              <option value="Different State (IGST)">Different State (IGST)</option>
            </select>
          </div>
          <div className="field">
            <label>Bill Date</label>
            <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Remarks</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        {/* 2026-09-21 ("adjust all textbox according there size we already added scroll so
            proper show textbox value"): wrapped in a horizontally-scrollable container, same as
            MaterialTransferCreatePage.tsx's own item grid - this table had no such wrapper before,
            so on a narrow window its columns were squeezed instead of scrolling. Column widths
            below were widened at the same time so each value (Type/Qty/Rate especially) actually
            fits instead of being clipped by its `<select>`/`<input>`'s own box. */}
        <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 120 }}>Type</th>
              <th style={{ width: 140 }}>Item Code</th>
              <th style={{ width: 220 }}>Description</th>
              <th style={{ width: 100 }}>HSN</th>
              <th style={{ width: 150 }}>Issue Type</th>
              <th className="text-end" style={{ width: 80 }}>Qty</th>
              <th className="text-end" style={{ width: 100 }}>Rate</th>
              <th style={{ width: 110 }}>Discount</th>
              <th className="text-end" style={{ width: 100 }}>Disc. Val</th>
              <th className="text-end" style={{ width: 100 }}>Taxable</th>
              <th className="text-end" style={{ width: 100 }}>CGST Amt</th>
              <th className="text-end" style={{ width: 100 }}>SGST Amt</th>
              <th className="text-end" style={{ width: 100 }}>IGST Amt</th>
              <th className="text-end" style={{ width: 120 }}>Est. Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const est = lineEstimate(it, taxMode, issueType)
              return (
                <tr key={it.key}>
                  <td>
                    <select
                      value={it.itemType}
                      onChange={(e) => updateItem(it.key, { itemType: e.target.value as RepairBillDocItemType })}
                      style={{ minWidth: 100 }}
                    >
                      <option value="Part">Part</option>
                      <option value="Labour">Labour</option>
                    </select>
                  </td>
                  <td>
                    {it.itemType === 'Labour' ? (
                      <LabourSearchInput
                        labours={labours}
                        locationSelected={!!location}
                        value={it.itemCode}
                        onChangeText={(text) => updateItem(it.key, { itemCode: text })}
                        onPick={(l) => pickLabourForLine(it.key, l)}
                        placeholder="Labour code…"
                        width={130}
                      />
                    ) : (
                      <PartSearchInput
                        parts={parts}
                        value={it.itemCode}
                        onChangeText={(text) => updateItem(it.key, { itemCode: text })}
                        onPick={(p) => pickPartForLine(it.key, p)}
                        placeholder="Item code…"
                        width={130}
                      />
                    )}
                  </td>
                  <td>
                    {it.itemType === 'Labour' ? (
                      <LabourSearchInput
                        labours={labours}
                        locationSelected={!!location}
                        value={it.itemDescription}
                        onChangeText={(text) => updateItem(it.key, { itemDescription: text })}
                        onPick={(l) => pickLabourForLine(it.key, l)}
                        width={210}
                      />
                    ) : (
                      <PartSearchInput
                        parts={parts}
                        value={it.itemDescription}
                        onChangeText={(text) => updateItem(it.key, { itemDescription: text })}
                        onPick={(p) => pickPartForLine(it.key, p)}
                        width={210}
                      />
                    )}
                  </td>
                  <td><input value={it.hsnCode} onChange={(e) => updateItem(it.key, { hsnCode: e.target.value })} style={{ width: 90 }} /></td>
                  <td>
                    <select
                      value={it.issueType}
                      onChange={(e) => updateItem(it.key, { issueType: e.target.value })}
                      title={!it.issueType ? `Defers to the bill-level default (${issueType || '— none —'}).` : undefined}
                      style={{ minWidth: 130 }}
                    >
                      <option value="">— default —</option>
                      <option value="Paid">Paid (taxed)</option>
                      <option value="U/W">U/W - Under Warranty (zero tax)</option>
                      <option value="FSC">FSC - Free Service Coupon (zero tax)</option>
                    </select>
                  </td>
                  <td><input type="number" value={it.qty} onChange={(e) => updateQty(it.key, e.target.value)} style={{ width: 70, textAlign: 'right' }} /></td>
                  <td><input type="number" value={it.rate} onChange={(e) => updateItem(it.key, { rate: e.target.value })} title={it.mrp ? `Reverse-calculated from MRP ₹${it.mrp} at ${it.gstPct}% GST - edit to override.` : undefined} style={{ width: 90, textAlign: 'right' }} /></td>
                  <td>
                    <select value={it.discountType} onChange={(e) => updateItem(it.key, { discountType: e.target.value as DiscountType })} style={{ minWidth: 90 }}>
                      <option value="None">None</option>
                      <option value="Percentage">%</option>
                      <option value="Amount">₹</option>
                    </select>
                  </td>
                  <td><input type="number" value={it.discountValue} onChange={(e) => updateItem(it.key, { discountValue: e.target.value })} disabled={it.discountType === 'None'} style={{ width: 90, textAlign: 'right' }} /></td>
                  <td className="text-end">₹{est.taxable.toFixed(2)}</td>
                  <td className="text-end">₹{est.cgstAmt.toFixed(2)}{est.cgstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{est.cgstPct}%</span></>}</td>
                  <td className="text-end">₹{est.sgstAmt.toFixed(2)}{est.sgstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{est.sgstPct}%</span></>}</td>
                  <td className="text-end">₹{est.igstAmt.toFixed(2)}{est.igstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{est.igstPct}%</span></>}</td>
                  <td className="text-end">₹{est.total.toFixed(2)}</td>
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
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Repair Bill'}</button>
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
        />
      )}
    </div>
  )
}
