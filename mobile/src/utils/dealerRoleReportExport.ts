// mobile\src\utils\dealerRoleReportExport.ts
// Android counterpart of web/src/lib/dealerRoleReportExport.ts - same types, same numbers, same
// sheets. A phone has no browser download, so each export is written to the app cache and handed to
// the OS share sheet (Save to Files / Drive / WhatsApp / email ...), the same pattern the wizard's
// "Share PDF" and JobCardDetailScreen's InvoiceCard already use (expo-print + expo-sharing +
// expo-file-system/legacy).
//
// NEEDS ONE NEW DEPENDENCY for the Excel file: `npx expo install xlsx` is NOT the right command -
// xlsx is a plain JS package, so run `npm install xlsx` inside mobile/ (no native module, no
// rebuild of the Android app needed). expo-print / expo-sharing / expo-file-system are already used
// elsewhere in this app. If xlsx isn't installed yet, Metro reports "Unable to resolve module
// 'xlsx'" on build - that is the only symptom.
//
// Dates are DD.MM.YYYY and times IST per the org's reporting standard; the IST shift is done by
// hand (UTC+05:30, no DST) rather than through Intl, same reasoning as the Work Log timer fix.
import * as XLSX from 'xlsx'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import * as FileSystem from 'expo-file-system/legacy'

export interface DealerRoleReportPerson {
  userId: string | null
  name: string
  designation: string | null
  active: boolean
  submitted: number
  open: number
  closed: number
  cancelled: number
}
export interface DealerRoleReportRole {
  role: string
  users: number
  submitted: number
  open: number
  closed: number
  cancelled: number
  people: DealerRoleReportPerson[]
}
export interface DealerRoleReportJobCard {
  jobCardNumber: string
  createdAt: string
  status: string
  closedAt: string | null
  createdBy: string
  role: string
  regNo: string | null
  customerName: string | null
}
export interface DealerRoleReport {
  dealer: { id: string; name: string; code: string | null }
  generatedAt: string
  dateFrom: string | null
  dateTo: string | null
  totals: { submitted: number; open: number; closed: number; cancelled: number; users: number; activeUsers: number }
  roles: DealerRoleReportRole[]
  jobCards: DealerRoleReportJobCard[]
  jobCardsTruncated: boolean
}

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
const fmtDateOnly = (v: string | null): string => {
  if (!v) return ''
  const [y, m, d] = v.split('-')
  return d && m && y ? `${d}.${m}.${y}` : v
}
export function periodLabel(r: Pick<DealerRoleReport, 'dateFrom' | 'dateTo'>): string {
  if (!r.dateFrom && !r.dateTo) return 'All time'
  return `${r.dateFrom ? fmtDateOnly(r.dateFrom) : 'Start'} to ${r.dateTo ? fmtDateOnly(r.dateTo) : 'Today'}`
}
export const closurePct = (closed: number, submitted: number): number =>
  submitted > 0 ? Math.round((closed / submitted) * 1000) / 10 : 0

const safeFile = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
const fileBase = (r: DealerRoleReport): string => {
  const d = istDate(r.generatedAt)
  return `DealerRoleReport_${safeFile(r.dealer.name) || 'Dealer'}_${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}
const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------- shared rows ----------------
const ROLE_HEAD = ['Role', 'Staff', 'Submitted', 'Open', 'Closed', 'Cancelled', 'Closure %']
const roleRows = (r: DealerRoleReport): (string | number)[][] =>
  r.roles.map((x) => [x.role, x.users, x.submitted, x.open, x.closed, x.cancelled, closurePct(x.closed, x.submitted)])
const roleTotalRow = (r: DealerRoleReport): (string | number)[] =>
  ['TOTAL', r.totals.users, r.totals.submitted, r.totals.open, r.totals.closed, r.totals.cancelled, closurePct(r.totals.closed, r.totals.submitted)]
const PERSON_HEAD = ['Role', 'Name', 'Designation', 'Login', 'Submitted', 'Open', 'Closed', 'Cancelled']
const personRows = (r: DealerRoleReport): (string | number)[][] =>
  r.roles.flatMap((role) =>
    role.people.map((p) => [role.role, p.name, p.designation ?? '-', p.active ? 'Active' : 'Inactive', p.submitted, p.open, p.closed, p.cancelled]),
  )
const JOB_HEAD = ['Sr', 'Job Card No', 'Created (IST)', 'Status', 'Closed (IST)', 'Created By', 'Role', 'Reg No', 'Customer']
const jobRows = (r: DealerRoleReport, limit?: number): (string | number)[][] =>
  (limit ? r.jobCards.slice(0, limit) : r.jobCards).map((j, i) => [
    i + 1, j.jobCardNumber, fmtDateTime(j.createdAt), j.status, fmtDateTime(j.closedAt), j.createdBy, j.role, j.regNo ?? '-', j.customerName ?? '-',
  ])

// ---------------- Excel ----------------
export async function shareDealerRoleReportExcel(r: DealerRoleReport): Promise<void> {
  const wb = XLSX.utils.book_new()
  const addSheet = (name: string, aoa: (string | number)[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = widths.map((wch) => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  addSheet('Summary', [
    ['Dealer Role Report'],
    [],
    ['Dealer', r.dealer.name],
    ['Dealer Code', r.dealer.code ?? '-'],
    ['Period (job card created date)', periodLabel(r)],
    ['Generated (IST)', fmtDateTime(r.generatedAt)],
    [],
    ['Metric', 'Count'],
    ['Job cards submitted', r.totals.submitted],
    ['Open', r.totals.open],
    ['Closed', r.totals.closed],
    ['Cancelled', r.totals.cancelled],
    ['Closure %', closurePct(r.totals.closed, r.totals.submitted)],
    ['Staff (all)', r.totals.users],
    ['Staff (active login)', r.totals.activeUsers],
    [],
    ['Notes'],
    ['Submitted = job cards created by a user of that role. Open = not Closed and not Cancelled.'],
    ...(r.jobCardsTruncated ? [[`The Job Cards sheet is limited to the latest ${r.jobCards.length} rows; every count above is exact.`]] : []),
  ], [34, 40])
  addSheet('By Role', [ROLE_HEAD, ...roleRows(r), roleTotalRow(r)], [46, 8, 11, 8, 8, 11, 11])
  addSheet('By Person', [PERSON_HEAD, ...personRows(r)], [26, 28, 18, 10, 11, 8, 8, 11])
  addSheet('Job Cards', [JOB_HEAD, ...jobRows(r)], [6, 24, 18, 20, 18, 26, 18, 16, 28])

  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string
  const fileName = `${fileBase(r)}.xlsx`
  const uri = `${FileSystem.cacheDirectory}${fileName}`
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 })
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.')
  await Sharing.shareAsync(uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: fileName,
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
  })
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

export function buildDealerRoleReportHtml(r: DealerRoleReport): string {
  const t = r.totals
  const tiles: [string, string | number][] = [
    ['Submitted', t.submitted], ['Open', t.open], ['Closed', t.closed], ['Cancelled', t.cancelled],
    ['Closure %', `${closurePct(t.closed, t.submitted)}%`], ['Staff (active / all)', `${t.activeUsers} / ${t.users}`],
  ]
  const shown = Math.min(r.jobCards.length, PDF_JOB_ROW_CAP)
  const truncNote = r.jobCards.length > shown || r.jobCardsTruncated
    ? `<p class="note">Showing the latest ${shown} job cards - the Excel download has the full list. All counts above are exact.</p>` : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dealer Role Report</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10px; }
  h1 { font-size: 18px; color: #1a4f8b; margin: 0 0 4px; }
  h2 { font-size: 12px; margin: 16px 0 6px; color: #333; }
  .meta { color: #555; font-size: 10px; display: flex; justify-content: space-between; }
  .tiles { display: flex; gap: 8px; margin: 10px 0 4px; }
  .tile { flex: 1; border: 1px solid #d6dbe3; border-radius: 6px; background: #f7f9fc; text-align: center; padding: 8px 4px; }
  .tile b { display: block; font-size: 15px; color: #1a4f8b; }
  .tile span { font-size: 9px; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 2px; }
  th { background: #1a4f8b; color: #fff; text-align: left; padding: 4px 6px; font-size: 9px; }
  td { padding: 3.5px 6px; border-bottom: 1px solid #e5e7eb; font-size: 9px; }
  tbody tr:nth-child(even) td { background: #f6f7f9; }
  tfoot td { font-weight: bold; background: #e8eef7; border-top: 2px solid #1a4f8b; }
  .r { text-align: right; }
  .note { color: #777; font-size: 9px; margin: 2px 0 4px; }
  .pb { page-break-before: always; }
  tr { page-break-inside: avoid; }
</style></head><body>
  <h1>Dealer Role Report</h1>
  <div class="meta"><div><b>${esc(r.dealer.name)}</b>${r.dealer.code ? ` (${esc(r.dealer.code)})` : ''}<br>Period: ${esc(periodLabel(r))}</div><div>Generated: ${esc(fmtDateTime(r.generatedAt))} IST</div></div>
  <div class="tiles">${tiles.map(([l, v]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
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

export async function shareDealerRoleReportPdf(r: DealerRoleReport): Promise<void> {
  // A4 landscape in points (842 x 595) passed explicitly - the CSS @page size alone is not honoured on every Android WebView.
  const { uri } = await Print.printToFileAsync({ html: buildDealerRoleReportHtml(r), width: 842, height: 595 })
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.')
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${fileBase(r)}.pdf`, UTI: 'com.adobe.pdf' })
}