/**
 * Insurance block for the Repair Bill GST Tax Invoice print. A bill that has an insurance company prints this extra "INSURANCE DETAILS" box; a bill without one prints in
 * the normal format, unchanged (every function here returns the input untouched / an empty string).
 *
 * Use it around the existing invoice builder, e.g. in RepairBillListPage.printInvoice:
 *   win.document.write(withInsuranceBlock(buildRepairBillTaxInvoicePrintHtml(bill, ctx), bill))
 * (and the same one-line wrap anywhere else that prints a repair bill invoice, e.g. JobCardDetailPage's Print -> Invoice).
 * The block is inserted where the invoice HTML contains the marker <!--INSURANCE_BLOCK--> if the builder has one, otherwise just before </body>.
 */
export interface InsuranceFields {
  insuranceCompanyName?: string | null
  policyNo?: string | null
  insuranceValidTill?: string | null
  surveyorName?: string | null
  surveyorContactNumber?: string | null
  zeroDepreciation?: boolean | null
  insuranceDescription?: string | null
}

export const hasInsurance = (bill: InsuranceFields): boolean => !!bill.insuranceCompanyName?.trim()

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const dash = (v: unknown): string => {
  const t = String(v ?? '').trim()
  return t ? esc(t) : '-'
}

/** yyyy-MM-dd... -> dd-MM-yyyy ('-' when blank / unparsable). */
const fmtDate = (iso?: string | null): string => {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`
}

/** The "INSURANCE DETAILS" box - an empty string when the bill has no insurance. */
export function buildInsuranceBlockHtml(bill: InsuranceFields): string {
  if (!hasInsurance(bill)) return ''
  const cell = 'border:1px solid #000;padding:5px 8px;font-size:12px;vertical-align:top;'
  const label = `${cell}font-weight:700;background:#f3f4f6;width:16%;`
  return `
<div class="insurance-block" style="margin:10px 0;font-family:Arial,Helvetica,sans-serif;page-break-inside:avoid;">
  <table style="width:100%;border-collapse:collapse;">
    <tr><td colspan="4" style="${cell}font-weight:700;background:#e5e7eb;text-align:center;letter-spacing:.04em;">INSURANCE DETAILS</td></tr>
    <tr>
      <td style="${label}">Insurance Company</td><td style="${cell}width:34%;">${dash(bill.insuranceCompanyName)}</td>
      <td style="${label}">Policy No</td><td style="${cell}width:34%;">${dash(bill.policyNo)}</td>
    </tr>
    <tr>
      <td style="${label}">Valid Till</td><td style="${cell}">${fmtDate(bill.insuranceValidTill)}</td>
      <td style="${label}">Zero Depreciation</td><td style="${cell}">${bill.zeroDepreciation ? 'Yes' : 'No'}</td>
    </tr>
    <tr>
      <td style="${label}">Surveyor Name</td><td style="${cell}">${dash(bill.surveyorName)}</td>
      <td style="${label}">Surveyor Contact</td><td style="${cell}">${dash(bill.surveyorContactNumber)}</td>
    </tr>
    ${bill.insuranceDescription?.trim() ? `<tr><td style="${label}">Remarks</td><td style="${cell}" colspan="3">${esc(bill.insuranceDescription.trim())}</td></tr>` : ''}
  </table>
</div>`
}

/** Adds the insurance box to an invoice's HTML when the bill has insurance; otherwise returns the HTML unchanged (the normal format). */
export function withInsuranceBlock(invoiceHtml: string, bill: InsuranceFields): string {
  const block = buildInsuranceBlockHtml(bill)
  if (!block) return invoiceHtml
  const marker = '<!--INSURANCE_BLOCK-->'
  if (invoiceHtml.includes(marker)) return invoiceHtml.replace(marker, block)
  const bodyEnd = invoiceHtml.toLowerCase().lastIndexOf('</body>')
  return bodyEnd >= 0 ? invoiceHtml.slice(0, bodyEnd) + block + invoiceHtml.slice(bodyEnd) : invoiceHtml + block
}