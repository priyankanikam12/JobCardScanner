// mobile\src\utils\dealerRoleReportExport.ts
// Android counterpart of web/src/lib/dealerRoleReportExport.ts - same types, same numbers, same
// sheets (see backend DealerStageReportController.cs for the exact definition of every stage).
// A phone has no browser download, so each export is written to the app cache and handed to the OS
// share sheet (Save to Files / Drive / WhatsApp / email ...), the same pattern the wizard's "Share
// PDF" and JobCardDetailScreen's InvoiceCard already use (expo-print + expo-sharing +
// expo-file-system/legacy).
//
// NEEDS ONE DEPENDENCY for the Excel file: `npm install xlsx` inside mobile/ (a plain JS package -
// no native module, no Android rebuild). If it is missing, Metro reports "Unable to resolve module
// 'xlsx'" - that is the only symptom.
//
// 2026-10-05: reworked from the old Submitted/Open/Closed/Cancelled layout to Created / Open / In
// Progress / Ready for Delivery / Invoiced / Closed / Other / Not Closed, plus a second pair of
// exports for the dealer-wise summary (the screen's "all dealers" view). Dates are DD.MM.YYYY and
// times IST; the IST shift is done by hand (UTC+05:30, no DST) rather than through Intl, same
// reasoning as the Work Log timer fix.
import * as XLSX from 'xlsx'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import * as FileSystem from 'expo-file-system/legacy'

// ---------------- types (identical to web) ----------------
export interface StageCounts {
  created: number
  open: number
  inProgress: number
  readyForDelivery: number
  invoiced: number
  closed: number
  other: number
  /** Status neither Closed nor Cancelled - the dashboard's "Open Job Cards Count" rule (overlaps the buckets). */
  notClosed: number
}
export interface StagePerson extends StageCounts {
  userId: string | null
  name: string
  designation: string | null
  active: boolean
}
export interface StageRole extends StageCounts {
  role: string
  users: number
  people: StagePerson[]
}
export interface StageJobCard {
  id: string
  createdById: string | null
  jobCardNumber: string
  createdAt: string
  status: string
  stage: string | null
  /** Open | InProgress | ReadyForDelivery | Invoiced | Other */
  bucket: string
  closedAt: string | null
  createdBy: string
  role: string
  regNo: string | null
  customerName: string | null
}
export interface DealerStageReport {
  dealer: { id: string; name: string; code: string | null }
  generatedAt: string
  dateFrom: string | null
  dateTo: string | null
  /** 'created' (default) or 'closed' - which job-card date the period filters on. */
  dateBasis?: string
  totals: StageCounts & { users: number; activeUsers: number }
  roles: StageRole[]
  jobCards: StageJobCard[]
  jobCardsTruncated: boolean
}
/** Document counts on the all-dealers summary (not available per role / person): Material Transfer and Repair Bill documents. */
export interface DocCounts {
  materialTransfers: number
  repairBills: number
}
export interface DealerStageSummaryRow extends StageCounts, DocCounts {
  dealerId: string
  dealerName: string
  dealerCode: string | null
}
export interface DealerStageSummary {
  generatedAt: string
  dateFrom: string | null
  dateTo: string | null
  dateBasis?: string
  totals: StageCounts & DocCounts
  dealers: DealerStageSummaryRow[]
}

/** One Material Transfer / Repair Bill line (GET .../repair-bills and .../material-transfers). */
export interface DealerDocItem {
  code: string | null
  description: string | null
  itemType: string | null
  qty: number
  rate: number
  amount: number
}
/** One Material Transfer / Repair Bill document of a dealer. `type` = Bill Type (repair bill) or Transfer Type (material transfer). */
export interface DealerDocRow {
  id: string
  number: string
  /** Date-only, YYYY-MM-DD. */
  date: string
  status: string
  party: string | null
  regNo: string | null
  chassisNo: string | null
  location: string | null
  type: string | null
  jobNo: string | null
  itemCount: number
  totalAmount: number
  preparedBy: string | null
  items: DealerDocItem[]
}
export interface DealerDocList {
  dealer: { id: string; name: string; code: string | null }
  generatedAt: string
  dateFrom: string | null
  dateTo: string | null
  /** Exact number of documents in the period; `rows` is capped (see `truncated`). */
  total: number
  truncated: boolean
  rows: DealerDocRow[]
}

/** Column order/labels used everywhere (screen, Excel, PDF). */
export const STAGE_COLUMNS: { key: keyof StageCounts; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'open', label: 'Open' },
  { key: 'inProgress', label: 'In Progress' },
  { key: 'readyForDelivery', label: 'Ready for Delivery' },
  { key: 'invoiced', label: 'Invoiced' },
  { key: 'closed', label: 'Closed' },
  { key: 'other', label: 'Other' },
  { key: 'notClosed', label: 'Not Closed' },
]

// ---------------- formatting ----------------
const pad = (n: number) => String(n).padStart(2, '0')
const parseUtc = (iso: string): Date => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
const IST_OFFSET_MS = 330 * 60 * 1000
const istDate = (iso: string) => new Date(parseUtc(iso).getTime() + IST_OFFSET_MS)

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '-'
  const d = istDate(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
export const fmtDateOnly = (v: string | null): string => {
  if (!v) return ''
  const [y, m, d] = v.split('-')
  return d && m && y ? `${d}.${m}.${y}` : v
}
export function periodLabel(r: { dateFrom: string | null; dateTo: string | null; dateBasis?: string }): string {
  const by = r.dateBasis === 'closed' ? ' (by closed date)' : ''
  if (!r.dateFrom && !r.dateTo) return `All time${by}`
  if (r.dateFrom && r.dateFrom === r.dateTo) return `${fmtDateOnly(r.dateFrom)}${by}`
  return `${r.dateFrom ? fmtDateOnly(r.dateFrom) : 'Start'} to ${r.dateTo ? fmtDateOnly(r.dateTo) : 'Today'}${by}`
}

const safeFile = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
const stampOf = (generatedAt: string): string => {
  const d = istDate(generatedAt)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}
const reportBase = (r: DealerStageReport) => `DealerRoleReport_${safeFile(r.dealer.name) || 'Dealer'}_${stampOf(r.generatedAt)}`
const summaryBase = (s: DealerStageSummary) => `DealerSummary_${stampOf(s.generatedAt)}`
const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------- shared rows ----------------
const countsRow = (c: StageCounts): number[] => STAGE_COLUMNS.map((s) => c[s.key])
const STAGE_LABELS = STAGE_COLUMNS.map((s) => s.label)

const ROLE_HEAD = ['Role', 'Staff', ...STAGE_LABELS]
const roleRows = (r: DealerStageReport): (string | number)[][] => r.roles.map((x) => [x.role, x.users, ...countsRow(x)])
const roleTotalRow = (r: DealerStageReport): (string | number)[] => ['TOTAL', r.totals.users, ...countsRow(r.totals)]
const PERSON_HEAD = ['Role', 'Name', 'Designation', 'Login', ...STAGE_LABELS]
const personRows = (r: DealerStageReport): (string | number)[][] =>
  r.roles.flatMap((role) =>
    role.people.map((p) => [role.role, p.name, p.designation ?? '-', p.active ? 'Active' : 'Inactive', ...countsRow(p)]),
  )
const JOB_HEAD = ['Sr', 'Job Card No', 'Created (IST)', 'Stage', 'Status', 'Closed (IST)', 'Created By', 'Role', 'Reg No', 'Customer']
const jobRows = (r: DealerStageReport, limit?: number): (string | number)[][] =>
  (limit ? r.jobCards.slice(0, limit) : r.jobCards).map((j, i) => [
    i + 1, j.jobCardNumber, fmtDateTime(j.createdAt), j.stage ?? '-', j.status, fmtDateTime(j.closedAt),
    j.createdBy, j.role, j.regNo ?? '-', j.customerName ?? '-',
  ])
const SUMMARY_HEAD = ['Dealer', 'Code', ...STAGE_LABELS, 'Material Transfers', 'Repair Bills']
const summaryRows = (s: DealerStageSummary): (string | number)[][] => s.dealers.map((d) => [d.dealerName, d.dealerCode ?? '-', ...countsRow(d), d.materialTransfers, d.repairBills])
const summaryTotalRow = (s: DealerStageSummary): (string | number)[] => ['TOTAL', '', ...countsRow(s.totals), s.totals.materialTransfers, s.totals.repairBills]

const DEFINITION_NOTES = [
  'Created = job cards created in the period. Open / In Progress / Ready for Delivery / Invoiced / Other split them with no overlap.',
  'Open = work not started; In Progress = technician timer started; Ready for Delivery / Invoiced = current workflow stage; Other = cancelled, pending or closed without an invoice.',
  'Closed = Status Closed (an Invoiced job card is closed, so Closed overlaps Invoiced and is not part of the split).',
  'Material Transfers / Repair Bills = documents dated in the period (any status; deleted Repair Bills excluded) - dated by the document, not the job card.',
  "Not Closed = every job card that is neither Closed nor Cancelled (the dashboard's Open Job Cards Count) - it overlaps the buckets and is not part of the split.",
]

// ---------------- Excel ----------------
function addSheet(wb: XLSX.WorkBook, name: string, aoa: (string | number)[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = widths.map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, name)
}

async function shareWorkbook(wb: XLSX.WorkBook, baseName: string): Promise<void> {
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string
  const fileName = `${baseName}.xlsx`
  const uri = `${FileSystem.cacheDirectory}${fileName}`
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 })
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.')
  await Sharing.shareAsync(uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: fileName,
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
  })
}

/** One dealer: Summary, By Role, By Person, Job Cards. */
export async function shareDealerRoleReportExcel(r: DealerStageReport): Promise<void> {
  const wb = XLSX.utils.book_new()
  addSheet(wb, 'Summary', [
    ['Dealer Role Report'],
    [],
    ['Dealer', r.dealer.name],
    ['Dealer Code', r.dealer.code ?? '-'],
    ['Period', periodLabel(r)],
    ['Generated (IST)', fmtDateTime(r.generatedAt)],
    [],
    ['Metric', 'Count'],
    ...STAGE_COLUMNS.map((s) => [s.label, r.totals[s.key]] as (string | number)[]),
    ['Staff (all)', r.totals.users],
    ['Staff (active login)', r.totals.activeUsers],
    [],
    ['Notes'],
    ...DEFINITION_NOTES.map((n) => [n]),
    ...(r.jobCardsTruncated ? [[`The Job Cards sheet is limited to the latest ${r.jobCards.length} rows; every count above is exact.`]] : []),
  ], [34, 40])
  addSheet(wb, 'By Role', [ROLE_HEAD, ...roleRows(r), roleTotalRow(r)], [46, 8, 10, 8, 12, 18, 10, 8, 8, 11])
  addSheet(wb, 'By Person', [PERSON_HEAD, ...personRows(r)], [24, 26, 16, 10, 10, 8, 12, 18, 10, 8, 8, 11])
  addSheet(wb, 'Job Cards', [JOB_HEAD, ...jobRows(r)], [6, 24, 18, 22, 16, 18, 24, 18, 16, 28])
  await shareWorkbook(wb, reportBase(r))
}

/** Dealer-wise summary (the "all dealers" view). */
export async function shareDealerSummaryExcel(s: DealerStageSummary): Promise<void> {
  const wb = XLSX.utils.book_new()
  addSheet(wb, 'Dealer Summary', [
    ['Dealer-wise Job Card Summary'],
    ['Period', periodLabel(s)],
    ['Generated (IST)', fmtDateTime(s.generatedAt)],
    [],
    SUMMARY_HEAD,
    ...summaryRows(s),
    summaryTotalRow(s),
    [],
    ['Notes'],
    ...DEFINITION_NOTES.map((n) => [n]),
  ], [46, 12, 10, 8, 12, 18, 10, 8, 8, 11, 18, 13])
  await shareWorkbook(wb, summaryBase(s))
}

// ---------------- PDF (HTML -> expo-print) ----------------
const PDF_JOB_ROW_CAP = 1000

const table = (head: string[], rows: (string | number)[][], rightFrom: number, foot?: (string | number)[]): string => {
  const cell = (tag: 'th' | 'td', v: string | number, i: number) => `<${tag}${i >= rightFrom ? ' class="r"' : ''}>${esc(v)}</${tag}>`
  return `<table>
    <thead><tr>${head.map((h, i) => cell('th', h, i)).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((v, i) => cell('td', v, i)).join('')}</tr>`).join('')}</tbody>
    ${foot ? `<tfoot><tr>${foot.map((v, i) => cell('td', v, i)).join('')}</tr></tfoot>` : ''}
  </table>`
}

const PDF_CSS = `
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10px; }
  h1 { font-size: 18px; color: #1a4f8b; margin: 0 0 4px; }
  h2 { font-size: 12px; margin: 16px 0 6px; color: #333; }
  .meta { color: #555; font-size: 10px; display: flex; justify-content: space-between; }
  .tiles { display: flex; gap: 6px; margin: 10px 0 4px; }
  .tile { flex: 1; border: 1px solid #d6dbe3; border-radius: 6px; background: #f7f9fc; text-align: center; padding: 8px 2px; }
  .tile b { display: block; font-size: 15px; color: #1a4f8b; }
  .tile span { font-size: 8px; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 2px; }
  th { background: #1a4f8b; color: #fff; text-align: left; padding: 4px 6px; font-size: 9px; }
  td { padding: 3.5px 6px; border-bottom: 1px solid #e5e7eb; font-size: 9px; }
  tbody tr:nth-child(even) td { background: #f6f7f9; }
  tfoot td { font-weight: bold; background: #e8eef7; border-top: 2px solid #1a4f8b; }
  .r { text-align: right; }
  .note { color: #777; font-size: 9px; margin: 2px 0 4px; }
  .pb { page-break-before: always; }
  tr { page-break-inside: avoid; }`

const tilesHtml = (c: StageCounts, extra: [string, number][] = []) =>
  `<div class="tiles">${[...STAGE_COLUMNS.map((s) => [s.label, c[s.key]] as [string, number]), ...extra]
    .map(([label, value]) => `<div class="tile"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('')}</div>`

export function buildDealerRoleReportHtml(r: DealerStageReport): string {
  const shown = Math.min(r.jobCards.length, PDF_JOB_ROW_CAP)
  const truncNote = r.jobCards.length > shown || r.jobCardsTruncated
    ? `<p class="note">Showing the latest ${shown} job cards - the Excel download has the full list. All counts above are exact.</p>` : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dealer Role Report</title><style>${PDF_CSS}</style></head><body>
  <h1>Dealer Role Report</h1>
  <div class="meta"><div><b>${esc(r.dealer.name)}</b>${r.dealer.code ? ` (${esc(r.dealer.code)})` : ''}<br>Period: ${esc(periodLabel(r))} &nbsp;·&nbsp; Staff: ${r.totals.activeUsers} active / ${r.totals.users} total</div><div>Generated: ${esc(fmtDateTime(r.generatedAt))} IST</div></div>
  ${tilesHtml(r.totals)}
  <h2>Job cards by role</h2>
  ${table(ROLE_HEAD, roleRows(r), 1, roleTotalRow(r))}
  <h2>Job cards by person</h2>
  ${table(PERSON_HEAD, personRows(r), 4)}
  <div class="pb"></div>
  <h2>Job card details</h2>
  ${truncNote}
  ${table(JOB_HEAD, jobRows(r, PDF_JOB_ROW_CAP), 99)}
</body></html>`
}

export function buildDealerSummaryHtml(s: DealerStageSummary): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dealer-wise Job Card Summary</title><style>${PDF_CSS}</style></head><body>
  <h1>Dealer-wise Job Card Summary</h1>
  <div class="meta"><div>Period: ${esc(periodLabel(s))}</div><div>Generated: ${esc(fmtDateTime(s.generatedAt))} IST</div></div>
  ${tilesHtml(s.totals, [['Material Transfers', s.totals.materialTransfers], ['Repair Bills', s.totals.repairBills]])}
  ${table(SUMMARY_HEAD, summaryRows(s), 2, summaryTotalRow(s))}
  ${DEFINITION_NOTES.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
</body></html>`
}

async function sharePdf(html: string, baseName: string): Promise<void> {
  // A4 landscape in points (842 x 595) passed explicitly - the CSS @page size alone is not honoured on every Android WebView.
  const { uri } = await Print.printToFileAsync({ html, width: 842, height: 595 })
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.')
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${baseName}.pdf`, UTI: 'com.adobe.pdf' })
}
export const shareDealerRoleReportPdf = (r: DealerStageReport) => sharePdf(buildDealerRoleReportHtml(r), reportBase(r))
export const shareDealerSummaryPdf = (s: DealerStageSummary) => sharePdf(buildDealerSummaryHtml(s), summaryBase(s))