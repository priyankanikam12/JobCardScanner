// web\src\lib\jobCardPrintHtml.ts
// Shared print-HTML builders for the "DMS Job Card + Gate Pass" paper layout.
//
// 2026-09-03: extracted out of JobCardWizardPage.tsx (which originally owned
// buildJobCardPrintHtml, dash, fmtDatePrint and the whole print <style> block as private,
// module-scope helpers) so JobCardDetailPage's new "Print" menu (Estimate / JobCard print /
// Invoice - see that page's PrintMenu component) can reuse the exact same layout instead of a
// second, drifting copy. buildEstimatePrintHtml is new here, sharing PRINT_DOC_CSS with
// buildJobCardPrintHtml so an "Estimate" print looks like the same document family as a "JobCard
// print" - same header/section chrome, just fewer sections - per explicit request rather than a
// one-off layout of its own.
//
// 2026-10-04: the "Invoice" print option no longer lives in this file - it is the DMS "GST TAX
// INVOICE" layout in lib/repairBillInvoicePrintHtml.ts. buildJobCardPrintHtml below gained an
// optional `customerState` (the Customer Details "State" row used to be a hard-coded "-").

export const dash = (v: unknown) => (v !== null && v !== undefined && String(v).trim() !== '' ? String(v) : '-')

export const fmtDatePrint = (v?: string | null) => {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-GB')
}

/** Shared <style> body for every print document built here - keeps "Estimate" and "JobCard
 * print" visually one family (same header, section, and table chrome) instead of hand-matching
 * two separate stylesheets. */
export const PRINT_DOC_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;background:#fff;padding:10mm 12mm}
.doc-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1a4f8b;padding-bottom:7px;margin-bottom:8px}
.co-name{font-size:15px;font-weight:bold;color:#1a4f8b;letter-spacing:.2px}
.co-sub{font-size:9px;color:#555;margin-top:3px}
.doc-right{text-align:right}
.doc-title{font-size:15px;font-weight:bold;color:#1a4f8b;letter-spacing:.5px;margin-bottom:5px}
.doc-right table{margin-left:auto;border-collapse:collapse;font-size:9.5px;color:#333}
.doc-right td{padding:1.5px 3px}
.doc-right td.lbl{color:#666;text-align:right;padding-right:5px}
.doc-right td.val{font-weight:bold}
.sec{border:1px solid #c8c8c8;border-radius:2px;margin-bottom:6px;page-break-inside:avoid}
.sec-title{background:#e8e8e8;color:#333;font-size:8.5px;font-weight:bold;letter-spacing:.9px;text-transform:uppercase;padding:4px 8px;border-bottom:1px solid #c8c8c8}
.row2{display:flex;gap:6px;margin-bottom:6px;align-items:flex-start}
.row2>.sec{flex:1;margin-bottom:0}
.kv{width:100%;border-collapse:collapse}
.kv tr{border-bottom:1px solid #eaeaea}
.kv tr:last-child{border-bottom:none}
.kv td{padding:3.5px 8px;vertical-align:top;line-height:1.45}
.kv td.k{width:46%;font-size:9px;color:#555;white-space:nowrap}
.kv td.v{font-size:10px;font-weight:bold;word-break:break-word}
.split{display:flex}
.split .col{flex:1;border-right:1px solid #e0e0e0}
.split .col:last-child{border-right:none}
.cpl{width:100%;border-collapse:collapse;font-size:10px}
.cpl thead tr{background:#eef2f9}
.cpl th{padding:5px 8px;text-align:left;font-size:8.5px;font-weight:bold;color:#1a4f8b;border-bottom:1px solid #c8c8c8;white-space:nowrap}
.cpl td{padding:4.5px 8px;border-bottom:1px solid #eaeaea;vertical-align:top;line-height:1.4}
.cpl tbody tr:last-child td{border-bottom:none}
.cpl tfoot td{padding:6px 8px;font-weight:bold;border-top:2px solid #1a4f8b}
.obs-strip{border:1px solid #c8c8c8;border-radius:2px;padding:0;margin-bottom:6px;display:flex;page-break-inside:avoid}
.obs-item{flex:1;padding:6px 10px;border-right:1px solid #e0e0e0}
.obs-item:last-child{border-right:none}
.obs-lbl{display:block;font-size:8px;font-weight:bold;color:#333;background:#e8e8e8;text-transform:uppercase;letter-spacing:.5px;padding:3px 6px;margin:-6px -10px 6px -10px}
.obs-val{font-size:10px;line-height:1.5;min-height:28px;display:block}
.sigs{display:flex;justify-content:space-around;align-items:flex-end;margin-top:24px;margin-bottom:10px;padding:0 20px;page-break-inside:avoid}
.sig{width:28%;text-align:center}
.sig-space{height:40px}
.sig-line{border-top:1px solid #333;margin:0 10px}
.sig-label{font-size:9px;color:#333;padding-top:5px;font-weight:bold;letter-spacing:.3px}
.tc{text-align:center}
.tr{text-align:right}
.muted{color:#999;font-style:italic}
.tear-line{display:flex;align-items:center;margin:14px 0;gap:8px;page-break-inside:avoid}
.tear-line-border{flex:1;border-top:1.5px dashed #888}
.tear-line-label{font-size:8.5px;color:#888;white-space:nowrap;letter-spacing:.5px;display:flex;align-items:center;gap:4px}
.tear-scissors{font-size:12px;color:#888;transform:rotate(90deg);display:inline-block}
.gp-section{page-break-before:always;page-break-inside:avoid}
.gp-heading{text-align:center;font-size:13px;font-weight:bold;color:#1a4f8b;letter-spacing:1px;text-transform:uppercase;padding:6px 0 10px;margin-bottom:10px;border-bottom:1px solid #ccc}
.gp-sigs{display:flex;justify-content:space-between;align-items:flex-end;padding:0 10px;margin-bottom:12px}
.gp-sig-box{width:220px;text-align:center}
.gp-sig-space{height:40px}
.gp-sig-line{border-top:1px solid #333;margin:0 10px}
.gp-sig-label{font-size:10px;color:#333;padding-top:5px;font-weight:bold;letter-spacing:.3px}
.gp-tbl{width:100%;border-collapse:collapse;font-size:11px}
.gp-tbl td{padding:7px 10px;border:1px solid #ddd;vertical-align:middle;line-height:1.5}
.gp-tbl td.gl{color:#555;font-size:9.5px;white-space:nowrap;background:#f8f9fb;width:20%}
.gp-tbl td.gv{font-size:11px;font-weight:bold;word-break:break-word}
.gp-sigs-bottom{display:flex;justify-content:space-between;align-items:flex-end;padding:0 10px;margin-top:20px}
@media print{body{padding:0}@page{size:A4;margin:10mm 12mm}.sec,.obs-strip,.row2,.sigs,.tear-line,.gp-section{page-break-inside:avoid}}
`

/**
 * Builds a print preview matching the real DMS "Job Card + Gate Pass" paper layout, field for
 * field: a Job Card page (company/dealer header, Job Details/Customer Details/Vehicle Details/
 * Battery Details panels, Customer Voice & Complaints, Observation/Supervisor Comment/Remarks,
 * signatures) followed by a torn-off Gate Pass page.
 *
 * Used from two places: JobCardWizardPage's Review & Create step (before the job card - and BAPL
 * DMS's own Job No./Invoice No - actually exist, so jobNo/invoiceNo are left undefined there and
 * show "-"), and JobCardDetailPage's "Print" menu -> "JobCard print" (after creation, with the
 * real jobNo/invoiceNo passed in once known). Fields DMS's own print shows that
 * JobCardScanner genuinely has nowhere to source (GST No., Alt. Mobile, OEM
 * Model, and every Battery Details voltage/capacity test reading - DMS's
 * ChassisBatteryDetails table doesn't carry those, only serial numbers and Make/Chemical/
 * Capacity, which this DOES now print) show as "-" rather than being guessed. Customer State is
 * printed when the caller passes `customerState` (2026-10-04) and "-" otherwise.
 */
export function buildJobCardPrintHtml(d: {
  dealerName?: string | null
  dealerCode?: string | null
  location?: string | null
  jobinDate: string
  jobtype?: string | null
  jobsource?: string | null
  serviceHead?: string | null
  serviceType?: string | null
  estdelDate?: string | null
  vehiclekms?: number | null
  manualjobNo?: string | null
  supervisor?: string | null
  technician?: string | null
  customerName?: string | null
  customerMobile?: string | null
  // 2026-10-04: the Customer Details "State" row used to be a hard-coded "-" - callers that know the
  // customer's state (JobCardDetailPage's Print menu; the wizard's Review step) now pass it here.
  customerState?: string | null
  address?: string | null
  city?: string | null
  chassisNo?: string | null
  batteryNo?: string | null
  chargerNo?: string | null
  controllerNo?: string | null
  registerNo?: string | null
  modelName?: string | null
  colour?: string | null
  saleDate?: string | null
  insuranceExpiry?: string | null
  // Sourced from DMS's own ChassisBatteryDetails table (see BaplDmsService.LookupVehicleAsync's
  // ChassisBatteryDetails enrichment) - previously nowhere to source, so the Battery Details panel
  // printed "-" for all three even when DMS had them on file.
  batteryChemical?: string | null
  batteryCapacity?: string | null
  batteryMake?: string | null
  complaints: string[]
  // Only known once the job card actually exists (JobCardDetailPage's "JobCard print") - the
  // wizard's pre-creation preview leaves these undefined and they print as "-", same as before.
  jobNo?: string | null
  invoiceNo?: string | null
}): string {
  const complaintRows = d.complaints.length
    ? d.complaints.map((c, i) => `
        <tr>
          <td class="tc">${i + 1}</td>
          <td>-</td>
          <td>-</td>
          <td>${c}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" class="tc muted">No complaints recorded</td></tr>`

  // The real paper form shows the delivery time as a full "HH:MM:SS.fffffff"-style stamp (e.g.
  // "20:20:00.0000000"); the wizard only ever captures a datetime-local value (minute precision),
  // so this pads seconds/fractional-seconds as zero rather than fabricating precision that was
  // never entered.
  const deliveryTimeMatch = d.estdelDate ? /T(\d{2}):(\d{2})/.exec(d.estdelDate) : null
  const deliveryTime = deliveryTimeMatch ? `${deliveryTimeMatch[1]}:${deliveryTimeMatch[2]}:00.0000000` : '-'

  const printDate = fmtDatePrint(d.jobinDate)
  const jobNoDisplay = d.jobNo ? `${d.jobNo} &nbsp; Date: ${printDate}` : `- (assigned on creation) &nbsp; Date: ${printDate}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Job Card Preview</title>
<style>${PRINT_DOC_CSS}</style>
</head>
<body>
<div class="page1">
<div class="doc-head">
  <div>
    <div class="co-name">${dash(d.dealerName)}</div>
    <div class="co-sub">Dealer Code: ${dash(d.dealerCode)} &nbsp;|&nbsp; ${dash(d.dealerName)}</div>
  </div>
  <div class="doc-right">
    <div class="doc-title">JOB CARD</div>
    <table>
      <tr><td class="lbl">Invoice No:</td><td class="val">${dash(d.invoiceNo)}</td></tr>
      <tr><td class="lbl">Job No:</td><td class="val">${jobNoDisplay}</td></tr>
    </table>
  </div>
</div>
<div class="row2">
  <div class="sec">
    <div class="sec-title">Job Details</div>
    <div class="split">
      <div class="col">
        <table class="kv">
          <tr><td class="k">Job Type</td><td class="v">${dash(d.jobtype)}</td></tr>
          <tr><td class="k">Job Source</td><td class="v">${dash(d.jobsource)}</td></tr>
          <tr><td class="k">Service Head</td><td class="v">${dash(d.serviceHead)}</td></tr>
          <tr><td class="k">Service Type</td><td class="v">${dash(d.serviceType)}</td></tr>
          <tr><td class="k">Est. Delivery</td><td class="v">${fmtDatePrint(d.estdelDate)}</td></tr>
        </table>
      </div>
      <div class="col">
        <table class="kv">
          <tr><td class="k">Vehicle Kms</td><td class="v">${dash(d.vehiclekms)}</td></tr>
          <tr><td class="k">Manual Job No</td><td class="v">${dash(d.manualjobNo)}</td></tr>
          <tr><td class="k">Supervisor</td><td class="v">${dash(d.supervisor)}</td></tr>
          <tr><td class="k">Technician</td><td class="v">${dash(d.technician)}</td></tr>
          <tr><td class="k">Delivery Time</td><td class="v">${deliveryTime}</td></tr>
        </table>
      </div>
    </div>
  </div>
  <div class="sec">
    <div class="sec-title">Customer Details</div>
    <table class="kv">
      <tr><td class="k">Customer Name</td><td class="v">${dash(d.customerName)}</td></tr>
      <tr><td class="k">Address</td><td class="v">${dash(d.address)}</td></tr>
      <tr><td class="k">City &amp; Pin</td><td class="v">${dash(d.city)}</td></tr>
      <tr><td class="k">State</td><td class="v">${dash(d.customerState)}</td></tr>
      <tr><td class="k">GST No.</td><td class="v">-</td></tr>
      <tr><td class="k">Mobile</td><td class="v">${dash(d.customerMobile)}</td></tr>
      <tr><td class="k">Alt. Mobile</td><td class="v">-</td></tr>
    </table>
  </div>
</div>
<div class="row2">
  <div class="sec">
    <div class="sec-title">Vehicle Details</div>
    <table class="kv">
      <tr><td class="k">Chassis No</td><td class="v">${dash(d.chassisNo)}</td></tr>
      <tr><td class="k">Battery No</td><td class="v">${dash(d.batteryNo)}</td></tr>
      <tr><td class="k">Charger No</td><td class="v">${dash(d.chargerNo)}</td></tr>
      <tr><td class="k">Controller No</td><td class="v">${dash(d.controllerNo)}</td></tr>
      <tr><td class="k">Register No</td><td class="v">${dash(d.registerNo)}</td></tr>
      <tr><td class="k">Model</td><td class="v">${dash(d.modelName)}</td></tr>
      <tr><td class="k">OEM Model</td><td class="v">-</td></tr>
      <tr><td class="k">Colour</td><td class="v">${dash(d.colour)}</td></tr>
      <tr><td class="k">Sale Date</td><td class="v">${fmtDatePrint(d.saleDate)}</td></tr>
      <tr><td class="k">Insurance Exp.</td><td class="v">${fmtDatePrint(d.insuranceExpiry)}</td></tr>
    </table>
  </div>
  <div class="sec">
    <div class="sec-title">Battery Details</div>
    <table class="kv">
      <tr><td class="k">Battery Make</td><td class="v">${dash(d.batteryMake)}</td></tr>
      <tr><td class="k">Battery Serial No(s)</td><td class="v">${dash(d.batteryNo)}</td></tr>
      <tr><td class="k">Voltage at Full Charge (OCV)</td><td class="v">-</td></tr>
      <tr><td class="k">Voltage at Full Charge (CCV)</td><td class="v">-</td></tr>
      <tr><td class="k">Voltage at Discharge</td><td class="v">-</td></tr>
      <tr><td class="k">Capacity (AH)</td><td class="v">-</td></tr>
      <tr><td class="k">Battery Set Voltage</td><td class="v">-</td></tr>
      <tr><td class="k">Motor Drawing (No Load)</td><td class="v">-</td></tr>
      <tr><td class="k">Controller No. Make</td><td class="v">${dash(d.controllerNo)}</td></tr>
      <tr><td class="k">Battery Chemical</td><td class="v">${dash(d.batteryChemical)}</td></tr>
      <tr><td class="k">Battery Capacity</td><td class="v">${dash(d.batteryCapacity)}</td></tr>
    </table>
  </div>
</div>
<div class="sec">
  <div class="sec-title">Customer Voice &amp; Complaints</div>
  <table class="cpl">
    <thead><tr><th style="width:36px">Sr</th><th style="width:24%">Customer Voice</th><th style="width:24%">Code</th><th>Complaint</th></tr></thead>
    <tbody>${complaintRows}</tbody>
  </table>
</div>
<div class="obs-strip">
  <div class="obs-item"><span class="obs-lbl">Observation</span><span class="obs-val">-</span></div>
  <div class="obs-item"><span class="obs-lbl">Supervisor Comment</span><span class="obs-val">-</span></div>
  <div class="obs-item"><span class="obs-lbl">Remarks</span><span class="obs-val">-</span></div>
</div>
<div class="sigs">
  <div class="sig"><div class="sig-space"></div><div class="sig-line"></div><div class="sig-label">Technician</div></div>
  <div class="sig"><div class="sig-space"></div><div class="sig-line"></div><div class="sig-label">Supervisor / Advisor</div></div>
  <div class="sig"><div class="sig-space"></div><div class="sig-line"></div><div class="sig-label">Customer</div></div>
</div>
<div class="tear-line">
  <div class="tear-line-border"></div>
  <div class="tear-line-label"><span class="tear-scissors">&#9988;</span> TEAR HERE <span class="tear-scissors">&#9988;</span></div>
  <div class="tear-line-border"></div>
</div>
</div>
<div class="page2 gp-section">
  <div class="gp-heading">Gate Pass</div>
  <div class="gp-sigs">
    <div class="gp-sig-box"><div class="gp-sig-space"></div><div class="gp-sig-line"></div><div class="gp-sig-label">Supervisor / Advisor</div></div>
    <div class="gp-sig-box"><div class="gp-sig-space"></div><div class="gp-sig-line"></div><div class="gp-sig-label">Customer</div></div>
  </div>
  <table class="gp-tbl">
    <tr>
      <td class="gl">Customer Name</td><td class="gv">${dash(d.customerName)}</td>
      <td class="gl">Job Date</td><td class="gv">${printDate}</td>
      <td class="gl">Job No</td><td class="gv">${dash(d.jobNo)}</td>
    </tr>
    <tr>
      <td class="gl">Vehicle No.</td><td class="gv">${dash(d.registerNo)}</td>
      <td class="gl">Chassis No.</td><td class="gv">${dash(d.chassisNo)}</td>
      <td class="gl"></td><td class="gv"></td>
    </tr>
  </table>
  <div class="gp-sigs-bottom">
    <div class="gp-sig-box"><div class="gp-sig-space"></div><div class="gp-sig-line"></div><div class="gp-sig-label">Supervisor / Advisor</div></div>
    <div class="gp-sig-box"><div class="gp-sig-space"></div><div class="gp-sig-line"></div><div class="gp-sig-label">Customer</div></div>
  </div>
</div>
</body>
</html>`
}

/**
 * "Estimate" print (JobCardDetailPage's Print menu, option 1) - explicitly scoped down to just
 * customer/dealer/vehicle identity plus the Estimates Amount tables (Part Details, Labour
 * Details, Grand Total - the exact same numbers EstimatesCard shows on screen, recomputed here
 * identically), NOT the full Job Details/Battery Details/Complaints/signatures/Gate Pass that
 * "JobCard print" includes - shares PRINT_DOC_CSS with buildJobCardPrintHtml above so it reads as
 * the same document family rather than a one-off layout.
 */
export function buildEstimatePrintHtml(d: {
  dealerName?: string | null
  dealerCode?: string | null
  jobCardNumber: string
  printDate: string
  customerName?: string | null
  customerMobile?: string | null
  address?: string | null
  city?: string | null
  vehicleModel?: string | null
  vehicleVariant?: string | null
  registerNo?: string | null
  chassisNo?: string | null
  odometer?: number | null
  partRows: { sr: number; code: string; description: string; hsn: string; mrp: number; qty: number; amount: number }[]
  labourRows: { sr: number; code: string; description: string; hsn: string; rate: number; qty: number; amount: number }[]
  partsTotal: number
  labourTotal: number
  grandTotal: number
}): string {
  const money = (n: number) => `Rs. ${n.toFixed(2)}`

  const partBody = d.partRows.length
    ? d.partRows.map((r) => `
        <tr>
          <td class="tc">${r.sr}</td><td>${r.code}</td><td>${r.description}</td><td>${r.hsn}</td>
          <td class="tr">${money(r.mrp)}</td><td class="tc">${r.qty}</td><td class="tr">${money(r.amount)}</td>
        </tr>`).join('')
    : `<tr><td colspan="7" class="tc muted">No parts suggested</td></tr>`
  const labourBody = d.labourRows.length
    ? d.labourRows.map((r) => `
        <tr>
          <td class="tc">${r.sr}</td><td>${r.code}</td><td>${r.description}</td><td>${r.hsn}</td>
          <td class="tr">${money(r.rate)}</td><td class="tc">${r.qty}</td><td class="tr">${money(r.amount)}</td>
        </tr>`).join('')
    : `<tr><td colspan="7" class="tc muted">No labour suggested</td></tr>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Estimate Preview</title>
<style>${PRINT_DOC_CSS}</style>
</head>
<body>
<div class="doc-head">
  <div>
    <div class="co-name">${dash(d.dealerName)}</div>
    <div class="co-sub">Dealer Code: ${dash(d.dealerCode)}</div>
  </div>
  <div class="doc-right">
    <div class="doc-title">ESTIMATE</div>
    <table>
      <tr><td class="lbl">Job Card No:</td><td class="val">${dash(d.jobCardNumber)}</td></tr>
      <tr><td class="lbl">Date:</td><td class="val">${d.printDate}</td></tr>
    </table>
  </div>
</div>
<div class="row2">
  <div class="sec">
    <div class="sec-title">Customer Details</div>
    <table class="kv">
      <tr><td class="k">Customer Name</td><td class="v">${dash(d.customerName)}</td></tr>
      <tr><td class="k">Mobile</td><td class="v">${dash(d.customerMobile)}</td></tr>
      <tr><td class="k">Address</td><td class="v">${dash(d.address)}</td></tr>
      <tr><td class="k">City</td><td class="v">${dash(d.city)}</td></tr>
    </table>
  </div>
  <div class="sec">
    <div class="sec-title">Vehicle Details</div>
    <table class="kv">
      <tr><td class="k">Model</td><td class="v">${dash(d.vehicleModel)} ${dash(d.vehicleVariant) !== '-' ? d.vehicleVariant : ''}</td></tr>
      <tr><td class="k">Register No</td><td class="v">${dash(d.registerNo)}</td></tr>
      <tr><td class="k">Chassis No</td><td class="v">${dash(d.chassisNo)}</td></tr>
      <tr><td class="k">Odometer</td><td class="v">${d.odometer != null ? `${d.odometer} km` : '-'}</td></tr>
    </table>
  </div>
</div>
<div class="sec">
  <div class="sec-title">Part Details</div>
  <table class="cpl">
    <thead><tr><th style="width:32px">Sr</th><th>Item Code</th><th>Description</th><th>HSN</th><th class="tr">MRP</th><th class="tc">Qty</th><th class="tr">Amount</th></tr></thead>
    <tbody>${partBody}</tbody>
    ${d.partRows.length > 0 ? `<tfoot><tr><td colspan="6" class="tr">Parts Total</td><td class="tr">${money(d.partsTotal)}</td></tr></tfoot>` : ''}
  </table>
</div>
<div class="sec">
  <div class="sec-title">Labour Details</div>
  <table class="cpl">
    <thead><tr><th style="width:32px">Sr</th><th>Labour Code</th><th>Description</th><th>HSN</th><th class="tr">Rate</th><th class="tc">Qty</th><th class="tr">Amount</th></tr></thead>
    <tbody>${labourBody}</tbody>
    ${d.labourRows.length > 0 ? `<tfoot><tr><td colspan="6" class="tr">Labour Total</td><td class="tr">${money(d.labourTotal)}</td></tr></tfoot>` : ''}
  </table>
</div>
<div class="sec">
  <table class="cpl">
    <tfoot><tr><td class="tr" style="font-size:12px">Grand Total</td><td class="tr" style="font-size:12px">${money(d.grandTotal)}</td></tr></tfoot>
  </table>
</div>
</body>
</html>`
}
