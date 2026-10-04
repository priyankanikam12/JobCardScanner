// web\src\lib\repairBillInvoicePrintHtml.ts   (NEW FILE)
import type { JobCardDetail, RepairBillDoc } from '../types'

// ============================================================================
// GST TAX INVOICE (Repair Bill invoice) - print layout.
//
// 2026-10-04 ("in print button which invoice is there that was repair bill invoice ... we need to
// print in that same format" - RepairBillInvoice-Format.pdf): replaces the old flat-table
// buildRepairBillInvoicePrintHtml with the DMS "GST TAX INVOICE" layout: dealer header ->
// Customer Details -> Vehicle Details -> items grid -> Amount In Words / Part Total / Labour Total
// / Invoice Total -> HSN Summary -> Remarks -> Customer Signature / Authorized Signatory.
//
// Pure data-in/HTML-out - no browser-only APIs - so the SAME function body runs on web
// (window.open + print) and on Android (expo-print's Print.printAsync({ html })).
// ============================================================================

/** Everything the invoice prints that is NOT on the RepairBillDoc itself. Every field is optional
 * and prints "-" (or is omitted, for the dealer header lines) when absent - nothing is invented. */
export interface TaxInvoiceContext {
  dealerName?: string | null
  dealerCode?: string | null
  dealerAddress?: string | null
  dealerPhone?: string | null
  dealerEmail?: string | null
  dealerGstin?: string | null
  customerName?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  customerState?: string | null
  customerCity?: string | null
  customerGstin?: string | null
  jobNo?: string | null
  chassisNo?: string | null
  registrationNo?: string | null
  motorNo?: string | null
  model?: string | null
  color?: string | null
  jobType?: string | null
  jobSource?: string | null
  technician?: string | null
}

const invEsc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Escaped text, or "-" when blank. */
const invTxt = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v).trim()
  return s ? invEsc(s) : '-'
}

const invNum = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 2-decimals with Indian digit grouping (12,34,567.89) - hand-rolled rather than
 * toLocaleString('en-IN') so output is identical on every JS engine (browser, Hermes). */
const invMoney = (v: unknown): string => {
  const x = invNum(v)
  const [intPart, dec] = Math.abs(x).toFixed(2).split('.')
  const grouped = intPart.length > 3
    ? intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + intPart.slice(-3)
    : intPart
  return (x < 0 ? '-' : '') + grouped + '.' + dec
}

const invPct = (v: unknown): string => `${Number(invNum(v).toFixed(2))}%`

const invDate = (v?: string | null): string => {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '-'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

const INV_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const INV_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const invBelow100 = (n: number): string => (n < 20 ? INV_ONES[n] : INV_TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + INV_ONES[n % 10] : ''))
const invBelow1000 = (n: number): string => {
  const h = Math.floor(n / 100)
  const r = n % 100
  return [h ? INV_ONES[h] + ' Hundred' : '', r ? invBelow100(r) : ''].filter(Boolean).join(' ')
}

/** Indian-system amount in words, e.g. 67990 -> "Sixty Seven Thousand Nine Hundred Ninety Rupees Only". */
export function invoiceAmountInWords(amount: number): string {
  const total = Math.round(Math.abs(invNum(amount)) * 100)
  const rupees = Math.floor(total / 100)
  const paise = total % 100
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only'
  const crore = Math.floor(rupees / 10000000)
  const lakh = Math.floor((rupees % 10000000) / 100000)
  const thousand = Math.floor((rupees % 100000) / 1000)
  const rest = rupees % 1000
  const rupeeText = rupees
    ? [crore ? invBelow1000(crore) + ' Crore' : '', lakh ? invBelow100(lakh) + ' Lakh' : '',
        thousand ? invBelow100(thousand) + ' Thousand' : '', rest ? invBelow1000(rest) : ''].filter(Boolean).join(' ') + ' Rupees'
    : ''
  const paiseText = paise ? invBelow100(paise) + ' Paise' : ''
  return [rupeeText, paiseText].filter(Boolean).join(' and ') + ' Only'
}

export function buildRepairBillTaxInvoicePrintHtml(bill: RepairBillDoc, ctx: TaxInvoiceContext = {}): string {
  const items = bill.items ?? []

  // ---- which tax columns to show: IGST for an inter-state bill, CGST+SGST for intra-state ----
  const hasIgst = items.some((i) => invNum(i.igstAmount) > 0 || invNum(i.igstPct) > 0)
  const hasCgst = items.some((i) => invNum(i.cgstAmount) > 0 || invNum(i.cgstPct) > 0 || invNum(i.sgstAmount) > 0 || invNum(i.sgstPct) > 0)
  const showIgst = hasIgst
  const showCgstSgst = hasCgst || !hasIgst
  const taxColCount = (showCgstSgst ? 2 : 0) + (showIgst ? 1 : 0)

  const taxCell = (amt: unknown, pct: unknown) =>
    `<td class="r">${invMoney(amt)}<div class="pct">@${invPct(pct)}</div></td>`

  const rows = items.map((it, i) => {
    const issue = (it.issueType ?? '').trim()
    const tag = issue && issue !== 'Paid' ? ` <span class="tag">[${invEsc(issue)}]</span>` : ''
    const discount = !it.discountType || it.discountType === 'None' || !invNum(it.discountValue)
      ? '-'
      : it.discountType === 'Percentage' ? invPct(it.discountValue) : invMoney(it.discountValue)
    return `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${invTxt(it.itemCode)}</td>
        <td>${invTxt(it.itemDescription)}${tag}</td>
        <td>${invTxt(it.hsnCode)}</td>
        <td class="c">${invNum(it.qty)}</td>
        <td class="r">${invMoney(it.rate)}</td>
        <td class="r">${discount}</td>
        <td class="r">${invMoney(it.taxableAmount)}</td>
        ${showCgstSgst ? taxCell(it.cgstAmount, it.cgstPct) + taxCell(it.sgstAmount, it.sgstPct) : ''}
        ${showIgst ? taxCell(it.igstAmount, it.igstPct) : ''}
        <td class="r b">${invMoney(it.totalAmount)}</td>
      </tr>`
  }).join('')
  const itemColSpan = 8 + taxColCount + 1

  // ---- totals ----
  const partTotal = items.filter((i) => i.itemType === 'Part').reduce((s, i) => s + invNum(i.totalAmount), 0)
  const labourTotal = items.filter((i) => i.itemType === 'Labour').reduce((s, i) => s + invNum(i.totalAmount), 0)
  const invoiceTotal = invNum(bill.totalAmount)
  // Anything the line items don't explain (e.g. a bill-level discount) is shown as its own row
  // instead of silently making Part + Labour not add up to the Invoice Total.
  const adjustment = invoiceTotal - (partTotal + labourTotal)
  const received = invNum(bill.amountReceived)

  // ---- HSN summary: one row per (HSN, CGST%, SGST%, IGST%) ----
  type HsnRow = { hsn: string; taxable: number; cgstPct: number; cgst: number; sgstPct: number; sgst: number; igstPct: number; igst: number }
  const hsnMap = new Map<string, HsnRow>()
  for (const it of items) {
    const hsn = (it.hsnCode ?? '').trim() || '-'
    const key = `${hsn}|${invNum(it.cgstPct)}|${invNum(it.sgstPct)}|${invNum(it.igstPct)}`
    const row = hsnMap.get(key) ?? {
      hsn, taxable: 0, cgstPct: invNum(it.cgstPct), cgst: 0, sgstPct: invNum(it.sgstPct), sgst: 0, igstPct: invNum(it.igstPct), igst: 0,
    }
    row.taxable += invNum(it.taxableAmount)
    row.cgst += invNum(it.cgstAmount)
    row.sgst += invNum(it.sgstAmount)
    row.igst += invNum(it.igstAmount)
    hsnMap.set(key, row)
  }
  const hsnRows = Array.from(hsnMap.values())
  const hsnBody = hsnRows.map((h) => `
      <tr>
        <td>${invEsc(h.hsn)}</td>
        <td class="r">${invMoney(h.taxable)}</td>
        <td class="r">${invPct(h.sgstPct)}</td><td class="r">${invMoney(h.sgst)}</td>
        <td class="r">${invPct(h.cgstPct)}</td><td class="r">${invMoney(h.cgst)}</td>
        <td class="r">${invPct(h.igstPct)}</td><td class="r">${invMoney(h.igst)}</td>
      </tr>`).join('')
  const hsnTotal = hsnRows.reduce(
    (t, h) => ({ taxable: t.taxable + h.taxable, sgst: t.sgst + h.sgst, cgst: t.cgst + h.cgst, igst: t.igst + h.igst }),
    { taxable: 0, sgst: 0, cgst: 0, igst: 0 },
  )

  // ---- dealer header: only lines that actually have data ----
  const dealerLines = [
    ctx.dealerAddress && invEsc(ctx.dealerAddress),
    ctx.dealerPhone && `Phone : ${invEsc(ctx.dealerPhone)}`,
    ctx.dealerEmail && `Email : ${invEsc(ctx.dealerEmail)}`,
    ctx.dealerGstin && `GSTIN : ${invEsc(ctx.dealerGstin)}`,
  ].filter(Boolean) as string[]
  const dealerSub = !dealerLines.length && ctx.dealerCode ? `<div class="line">Dealer Code : ${invEsc(ctx.dealerCode)}</div>` : ''

  const customerName = ctx.customerName ?? bill.partyName
  const chassis = ctx.chassisNo ?? bill.chassisNo
  const regNo = ctx.registrationNo ?? bill.regNo
  const jobNo = ctx.jobNo ?? bill.jobCardNumber

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Invoice ${invEsc(bill.billNumber)}</title>
<style>
  *,*::before,*::after { box-sizing: border-box; }
  body { font-family: 'Poppins', Arial, Helvetica, sans-serif; color: #374151; font-size: 12px; margin: 0; padding: 22px 26px; }
  .co { font-size: 22px; font-weight: 600; color: #374151; margin-bottom: 6px; }
  .line { font-size: 12.5px; line-height: 1.55; }
  .title { text-align: center; font-size: 19px; font-weight: 600; margin: 12px 0 2px; letter-spacing: .3px; }
  .subtitle { text-align: center; font-size: 11px; color: #6b7280; margin-bottom: 10px; }
  .card { border: 1px solid #e5e7eb; margin-bottom: 12px; }
  .card-title { background: #f9fafb; border-bottom: 1px solid #e5e7eb; padding: 7px 11px; font-size: 15px; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; }
  .kv td { padding: 3.5px 4px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  .kv td.k { font-weight: 600; width: 27%; color: #1f2937; }
  .kv4 td.k { width: 17%; } .kv4 td.v { width: 33%; } .kv4 td.k2 { width: 17%; font-weight: 600; color: #1f2937; }
  .grid th { background: #f3f4f6; color: #6b7280; font-weight: 600; font-size: 11px; padding: 8px 5px; border: 1px solid #e5e7eb; text-align: left; }
  .grid td { padding: 6px 5px; border: 1px solid #eef0f3; font-size: 11px; vertical-align: top; }
  .grid tr { page-break-inside: avoid; }
  .r { text-align: right; } .c { text-align: center; } .b { font-weight: 600; }
  .pct { font-size: 9px; color: #9ca3af; }
  .tag { color: #b45309; font-size: 10px; font-weight: 600; }
  .words { margin: 12px 0 2px; font-size: 12.5px; }
  .words b { color: #1f2937; }
  .tot td { padding: 4px 4px; border-top: 1px solid #eef0f3; font-size: 12.5px; }
  .tot td.k { font-weight: 600; color: #1f2937; }
  .tot td.v { text-align: right; width: 22%; }
  .tot tr.grand td { font-weight: 700; color: #111827; }
  .h2 { font-size: 15px; font-weight: 500; margin: 14px 0 6px; break-after: avoid; page-break-after: avoid; }
  .hsnwrap { break-inside: avoid; page-break-inside: avoid; }
  .hsn th { background: #f3f4f6; color: #6b7280; font-weight: 600; font-size: 10.5px; padding: 7px 5px; border: 1px solid #e5e7eb; text-align: left; }
  .hsn td { padding: 5px; border: 1px solid #eef0f3; font-size: 10.5px; }
  .hsn tfoot td { font-weight: 600; background: #fafafa; }
  .remarks { margin-top: 10px; font-size: 12.5px; min-height: 26px; }
  .sigs { margin-top: 26px; width: 100%; } .sigs td { width: 50%; text-align: center; font-size: 12.5px; }
  .sigline { border-top: 1.5px dashed #6b7280; width: 62%; margin: 0 auto 5px; }
  @page { size: A4; margin: 10mm; }
  @media print { body { padding: 0; } .card, .hsnwrap, .sigs { break-inside: avoid; page-break-inside: avoid; } }
</style></head>
<body>
  ${ctx.dealerName && String(ctx.dealerName).trim() ? `<div class="co">${invEsc(String(ctx.dealerName).trim())}</div>` : ''}
  ${dealerLines.map((l) => `<div class="line">${l}</div>`).join('')}${dealerSub}

  <div class="title">GST TAX INVOICE</div>
  <div class="subtitle">Invoice Date : ${invDate(bill.billDate)}</div>

  <div class="card">
    <div class="card-title">Customer Details</div>
    <table class="kv">
      <tr><td class="k">Customer Name</td><td>${invTxt(customerName)}</td></tr>
      <tr><td class="k">Phone</td><td>${invTxt(ctx.customerPhone)}</td></tr>
      <tr><td class="k">Address</td><td>${invTxt(ctx.customerAddress)}</td></tr>
      <tr><td class="k">State</td><td>${invTxt(ctx.customerState)}</td></tr>
      <tr><td class="k">City</td><td>${invTxt(ctx.customerCity)}</td></tr>
      <tr><td class="k">GSTIN</td><td>${invTxt(ctx.customerGstin)}</td></tr>
    </table>
  </div>

  <div class="card">
    <div class="card-title">Vehicle Details</div>
    <table class="kv kv4">
      <tr><td class="k">Job No</td><td class="v">${invTxt(jobNo)}</td><td class="k2">Invoice No</td><td class="v">${invTxt(bill.billNumber)}</td></tr>
      <tr><td class="k">Chassis No</td><td class="v">${invTxt(chassis)}</td><td class="k2">Registration No</td><td class="v">${invTxt(regNo)}</td></tr>
      <tr><td class="k">Motor No</td><td class="v">${invTxt(ctx.motorNo)}</td><td class="k2">Model</td><td class="v">${invTxt(ctx.model)}</td></tr>
      <tr><td class="k">Color</td><td class="v">${invTxt(ctx.color)}</td><td class="k2">Job Type</td><td class="v">${invTxt(ctx.jobType)}</td></tr>
      <tr><td class="k">Job Source</td><td class="v">${invTxt(ctx.jobSource)}</td><td class="k2">Technician</td><td class="v">${invTxt(ctx.technician)}</td></tr>
    </table>
  </div>

  <table class="grid">
    <thead><tr>
      <th>Sr</th><th>Code</th><th>Description</th><th>HSN</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Discount</th><th class="r">Taxable</th>
      ${showCgstSgst ? '<th class="r">CGST</th><th class="r">SGST</th>' : ''}${showIgst ? '<th class="r">IGST</th>' : ''}
      <th class="r">Net Amount</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="${itemColSpan}" class="c" style="color:#9ca3af">No items on this invoice</td></tr>`}</tbody>
  </table>

  <div class="words"><b>Amount In Words :</b> ${invEsc(invoiceAmountInWords(invoiceTotal))}</div>
  <table class="tot">
    <tr><td class="k">Part Total</td><td class="v">${invMoney(partTotal)}</td></tr>
    <tr><td class="k">Labour Total</td><td class="v">${invMoney(labourTotal)}</td></tr>
    ${Math.abs(adjustment) > 0.005 ? `<tr><td class="k">Bill Discount / Adjustment</td><td class="v">${invMoney(adjustment)}</td></tr>` : ''}
    <tr class="grand"><td class="k">Invoice Total</td><td class="v">${invMoney(invoiceTotal)}</td></tr>
    ${received > 0 ? `<tr><td class="k">Amount Received</td><td class="v">${invMoney(received)}</td></tr>
    <tr><td class="k">Balance</td><td class="v">${invMoney(invoiceTotal - received)}</td></tr>` : ''}
  </table>

  <div class="hsnwrap">
  <div class="h2">HSN Summary</div>
  <table class="hsn">
    <thead><tr><th>HSN</th><th class="r">Taxable Value</th><th class="r">SGST Rate</th><th class="r">SGST Amt</th><th class="r">CGST Rate</th><th class="r">CGST Amt</th><th class="r">IGST Rate</th><th class="r">IGST Amt</th></tr></thead>
    <tbody>${hsnBody || '<tr><td colspan="8" class="c" style="color:#9ca3af">-</td></tr>'}</tbody>
    ${hsnRows.length > 1 ? `<tfoot><tr><td>Total</td><td class="r">${invMoney(hsnTotal.taxable)}</td><td></td><td class="r">${invMoney(hsnTotal.sgst)}</td><td></td><td class="r">${invMoney(hsnTotal.cgst)}</td><td></td><td class="r">${invMoney(hsnTotal.igst)}</td></tr></tfoot>` : ''}
  </table>
  </div>

  <div class="remarks"><b>Remarks :</b> ${bill.remarks ? invEsc(bill.remarks) : ''}</div>

  <table class="sigs"><tr>
    <td><div class="sigline"></div>Customer Signature</td>
    <td><div class="sigline"></div>Authorized Signatory</td>
  </tr></table>
</body></html>`
}

/** Maps a job card (JobCardDetail) onto the invoice's non-bill fields - shared by web and Android so
 * both print identical data. Properties the app's TS types may not declare yet (dealer
 * address/phone/email/GSTIN, vehicle motor no., customer state/GSTIN) are read through a loose cast:
 * they print as soon as the API returns them under those camelCase names, and show "-"/are omitted
 * until then - nothing is guessed or hard-coded. */
export function taxInvoiceContextFromJobCard(jc: JobCardDetail): TaxInvoiceContext {
  const dealer = jc.dealer as unknown as { name?: string | null; code?: string | null; address?: string | null; phone?: string | null; email?: string | null; gstin?: string | null } | null | undefined
  const customer = jc.customer as unknown as { state?: string | null; gstin?: string | null } | null | undefined
  const vehicle = jc.vehicle as unknown as { motorNo?: string | null } | null | undefined
  const model = [jc.vehicle?.model, jc.vehicle?.variant].filter(Boolean).join(' ').trim()
  return {
    dealerName: dealer?.name,
    dealerCode: dealer?.code,
    dealerAddress: dealer?.address,
    dealerPhone: dealer?.phone,
    dealerEmail: dealer?.email,
    dealerGstin: dealer?.gstin,
    customerName: jc.customer?.name,
    customerPhone: jc.customer?.mobile,
    customerAddress: jc.customer?.address,
    customerState: customer?.state,
    customerCity: jc.customer?.city,
    customerGstin: customer?.gstin,
    jobNo: jc.baplJobNo != null ? String(jc.baplJobNo) : jc.jobCardNumber,
    chassisNo: jc.vehicle?.vin,
    registrationNo: jc.vehicle?.regNo,
    motorNo: vehicle?.motorNo,
    model: model || null,
    color: jc.vehicle?.color,
    jobType: jc.baplJobType,
    jobSource: jc.baplJobSourceName,
    technician: jc.assignedTechnicianName,
  }
}