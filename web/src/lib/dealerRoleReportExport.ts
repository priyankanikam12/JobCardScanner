// web\src\lib\dealerRoleReportExport.ts
// Types + Excel/PDF export for the stage-wise Dealer Role Report (GET /api/dashboard/dealer-stage-report
// - see backend DealerStageReportController.cs for the exact definition of every stage/bucket).
//
// 2026-10-05: reworked from the older Submitted/Open/Closed/Cancelled layout to Created / Open /
// In Progress / Ready for Delivery / Invoiced / Closed / Other, and a second pair of exports added
// for the dealer-wise summary (the page's "all dealers" view). Self-contained on purpose: it talks to
// `xlsx` and `jspdf`/`jspdf-autotable` directly (all three are already in web/package.json).
// Dates are DD.MM.YYYY and times IST, per the org's reporting standard.
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ---------------------------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------------------------
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
  /** Creator's user id - null when the creator isn't recorded / isn't a user of this dealer. */
  createdById: string | null
  jobCardNumber: string
  createdAt: string
  /** JobCardStatus name, e.g. Open / InProgress / Closed. */
  status: string
  /** Current workflow stage label, e.g. "Ready for Delivery". */
  stage: string | null
  /** Open | InProgress | ReadyForDelivery | Invoiced | Other - see DealerStageReportController. */
  bucket: string
  closedAt: string | null
  createdBy: string
  role: string
  regNo: string | null
  /** 2026-10-07: the vehicle's chassis no. (Vehicle.Vin), shown before Reg No. */
  chassisNo: string | null
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

/** Column order/labels used everywhere (page, Excel, PDF). */
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

// ---------------------------------------------------------------------------------------------
// formatting helpers (also used by the page itself)
// ---------------------------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0')

/** Backend timestamps are UTC but serialize without a "Z" - treat a zone-less value as UTC. */
const parseUtc = (iso: string): Date => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
/** IST is a fixed UTC+05:30 (no DST) - shifted by hand so it never depends on Intl timeZone support. */
const IST_OFFSET_MS = 330 * 60 * 1000
const istDate = (iso: string) => new Date(parseUtc(iso).getTime() + IST_OFFSET_MS)

/** DD.MM.YYYY HH:MM (IST). */
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '-'
  const d = istDate(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** "2026-10-05" (a date-only value from the API) -> DD.MM.YYYY, no timezone shifting. */
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
const stamp = (generatedAt: string): string => {
  const d = istDate(generatedAt)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

// ---------------------------------------------------------------------------------------------
// shared row builders
// ---------------------------------------------------------------------------------------------
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

const JOB_HEAD = ['Sr', 'Job Card No', 'Created (IST)', 'Stage', 'Status', 'Closed (IST)', 'Created By', 'Role', 'Chassis No', 'Reg No', 'Customer']
const jobRows = (r: DealerStageReport, limit?: number): (string | number)[][] =>
  (limit ? r.jobCards.slice(0, limit) : r.jobCards).map((j, i) => [
    i + 1, j.jobCardNumber, fmtDateTime(j.createdAt), j.stage ?? '-', j.status, fmtDateTime(j.closedAt),
    j.createdBy, j.role, j.chassisNo ?? '-', j.regNo ?? '-', j.customerName ?? '-',
  ])

const SUMMARY_HEAD = ['Dealer', 'Code', ...STAGE_LABELS, 'Material Transfers', 'Repair Bills']
const summaryRows = (s: DealerStageSummary): (string | number)[][] => s.dealers.map((d) => [d.dealerName, d.dealerCode ?? '-', ...countsRow(d), d.materialTransfers, d.repairBills])
const summaryTotalRow = (s: DealerStageSummary): (string | number)[] => ['TOTAL', '', ...countsRow(s.totals), s.totals.materialTransfers, s.totals.repairBills]

const DEFINITION_NOTES = [
  'Created = job cards created in the period. Open / In Progress / Ready for Delivery / Invoiced / Other split them with no overlap.',
  'Open = work not started · In Progress = technician timer started · Ready for Delivery / Invoiced = current workflow stage · Other = cancelled, pending or closed without an invoice.',
  'Closed = Status Closed (an Invoiced job card is closed, so Closed overlaps Invoiced and is not part of the split).',
  'Material Transfers / Repair Bills = documents dated in the period (any status; deleted Repair Bills excluded) - dated by the document, not the job card.',
  'Not Closed = every job card that is neither Closed nor Cancelled (the dashboard\'s Open Job Cards Count) - it overlaps the buckets and is not part of the split.',
]

function addSheet(wb: XLSX.WorkBook, name: string, aoa: (string | number)[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = widths.map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, name)
}

// ---------------------------------------------------------------------------------------------
// Excel - per-dealer report: Summary, By Role, By Person, Job Cards
// ---------------------------------------------------------------------------------------------
export function exportDealerRoleReportExcel(r: DealerStageReport): void {
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
  addSheet(wb, 'By Role', [ROLE_HEAD, ...roleRows(r), roleTotalRow(r)], [46, 8, 10, 8, 12, 18, 10, 8, 8])
  addSheet(wb, 'By Person', [PERSON_HEAD, ...personRows(r)], [24, 26, 16, 10, 10, 8, 12, 18, 10, 8, 8])
  addSheet(wb, 'Job Cards', [JOB_HEAD, ...jobRows(r)], [6, 24, 18, 22, 16, 18, 24, 18, 22, 16, 28])
  XLSX.writeFile(wb, `DealerRoleReport_${safeFile(r.dealer.name) || 'Dealer'}_${stamp(r.generatedAt)}.xlsx`)
}

// ---------------------------------------------------------------------------------------------
// Excel - dealer-wise summary (the page's "all dealers" view)
// ---------------------------------------------------------------------------------------------
export function exportDealerSummaryExcel(s: DealerStageSummary): void {
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
  XLSX.writeFile(wb, `DealerSummary_${stamp(s.generatedAt)}.xlsx`)
}

// ---------------------------------------------------------------------------------------------
// PDF helpers
// ---------------------------------------------------------------------------------------------
const PDF_JOB_ROW_CAP = 1000
const BRAND: [number, number, number] = [26, 79, 139]

/** Right-aligns the numeric columns in header, body AND footer (columnStyles alone only aligns body). */
const alignRight = (from: number) => ({
  didParseCell: (d: { column: { index: number }; cell: { styles: { halign?: string } } }) => {
    if (d.column.index >= from) d.cell.styles.halign = 'right'
  },
})

function pdfHeader(doc: jsPDF, title: string, lines: string[], generatedAt: string): void {
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...BRAND).text(title, 14, 16)
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(60)
  lines.forEach((l, i) => doc.text(l, 14, 23 + i * 6))
  doc.text(`Generated: ${fmtDateTime(generatedAt)} IST`, pageW - 14, 23, { align: 'right' })
}

function pdfTiles(doc: jsPDF, tiles: [string, number | string][], y: number): void {
  const pageW = doc.internal.pageSize.getWidth()
  const gap = 4
  const w = (pageW - 28 - gap * (tiles.length - 1)) / tiles.length
  tiles.forEach(([label, value], i) => {
    const x = 14 + i * (w + gap)
    doc.setDrawColor(210).setFillColor(247, 249, 252).roundedRect(x, y, w, 16, 1.5, 1.5, 'FD')
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...BRAND).text(String(value), x + w / 2, y + 8, { align: 'center' })
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(100).text(label, x + w / 2, y + 13.5, { align: 'center' })
  })
}

function pdfPageNumbers(doc: jsPDF): void {
  const pageW = doc.internal.pageSize.getWidth()
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130)
    doc.text(`Page ${i} of ${pages}`, pageW - 14, doc.internal.pageSize.getHeight() - 7, { align: 'right' })
  }
}

const lastY = (doc: jsPDF, fallback: number) => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback
const tableBase = { styles: { fontSize: 8.5, cellPadding: 1.8 }, headStyles: { fillColor: BRAND, textColor: 255, fontSize: 8.5 }, margin: { left: 14, right: 14 } }

// ---------------------------------------------------------------------------------------------
// PDF - per-dealer report (A4 landscape): tiles, By Role (with totals), By Person, Job Cards (capped)
// ---------------------------------------------------------------------------------------------
export function exportDealerRoleReportPdf(r: DealerStageReport): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  pdfHeader(doc, 'Dealer Role Report', [
    `${r.dealer.name}${r.dealer.code ? `  (${r.dealer.code})` : ''}`,
    `Period: ${periodLabel(r)}   ·   Staff: ${r.totals.activeUsers} active / ${r.totals.users} total`,
  ], r.generatedAt)
  pdfTiles(doc, STAGE_COLUMNS.map((s) => [s.label, r.totals[s.key]] as [string, number]), 35)

  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(40).text('Job cards by role', 14, 59)
  autoTable(doc, {
    ...tableBase, startY: 62, head: [ROLE_HEAD], body: roleRows(r).map((row) => row.map(String)),
    foot: [roleTotalRow(r).map(String)], footStyles: { fillColor: [232, 238, 247], textColor: 30, fontStyle: 'bold' },
    ...alignRight(1),
  })

  let y = lastY(doc, 62) + 10
  if (y > 170) { doc.addPage(); y = 16 }
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(40).text('Job cards by person', 14, y)
  autoTable(doc, { ...tableBase, startY: y + 3, head: [PERSON_HEAD], body: personRows(r).map((row) => row.map(String)), ...alignRight(4) })

  doc.addPage()
  const shown = Math.min(r.jobCards.length, PDF_JOB_ROW_CAP)
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(40).text('Job card details', 14, 16)
  if (r.jobCards.length > shown || r.jobCardsTruncated) {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120)
      .text(`Showing the latest ${shown} job cards - the Excel download has the full list. All counts above are exact.`, 14, 21)
  }
  autoTable(doc, { ...tableBase, startY: 24, head: [JOB_HEAD], body: jobRows(r, PDF_JOB_ROW_CAP).map((row) => row.map(String)), ...alignRight(99) })

  pdfPageNumbers(doc)
  doc.save(`DealerRoleReport_${safeFile(r.dealer.name) || 'Dealer'}_${stamp(r.generatedAt)}.pdf`)
}

// ---------------------------------------------------------------------------------------------
// PDF - dealer-wise summary
// ---------------------------------------------------------------------------------------------
export function exportDealerSummaryPdf(s: DealerStageSummary): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  pdfHeader(doc, 'Dealer-wise Job Card Summary', [`Period: ${periodLabel(s)}`], s.generatedAt)
  pdfTiles(doc, [...STAGE_COLUMNS.map((c) => [c.label, s.totals[c.key]] as [string, number]), ['Material Transfers', s.totals.materialTransfers], ['Repair Bills', s.totals.repairBills]], 30)
  autoTable(doc, {
    ...tableBase, startY: 54, head: [SUMMARY_HEAD], body: summaryRows(s).map((row) => row.map(String)),
    foot: [summaryTotalRow(s).map(String)], footStyles: { fillColor: [232, 238, 247], textColor: 30, fontStyle: 'bold' },
    ...alignRight(2),
  })
  const y = lastY(doc, 54) + 8
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(110)
  DEFINITION_NOTES.forEach((n, i) => doc.text(n, 14, y + i * 5))
  pdfPageNumbers(doc)
  doc.save(`DealerSummary_${stamp(s.generatedAt)}.pdf`)
}