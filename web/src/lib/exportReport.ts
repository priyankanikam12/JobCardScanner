import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * Shared "Download Report" helpers for the DMSBAPLDATA-backed list pages (Vehicle Sale, Material
 * Transfer, Repair Bill) - 2026-09-18: "vehicle sale . material transfer, repair bill shown
 * download report excel pdf download button insert in starting row download report in all page".
 *
 * Exports exactly the rows currently loaded/filtered on screen (not a fresh server round-trip) -
 * whatever the user searched for and is already looking at is exactly what comes out, no surprises
 * from a second query racing a fast follow-up search. Client-side only (SheetJS for .xlsx, jsPDF +
 * autoTable for .pdf) - no new backend endpoint needed, since these pages already hold the full row
 * set in memory once a search has run.
 */
export interface ReportColumn<T> {
  header: string
  value: (row: T) => string | number
}

export function exportReportToExcel<T>(filenameNoExt: string, columns: ReportColumn<T>[], rows: T[]) {
  const data = rows.map((row) => {
    const obj: Record<string, string | number> = {}
    for (const col of columns) obj[col.header] = col.value(row)
    return obj
  })
  const sheet = XLSX.utils.json_to_sheet(data, { header: columns.map((c) => c.header) })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Report')
  XLSX.writeFile(workbook, `${filenameNoExt}.xlsx`)
}

// 2026-09-18: a PDF has no equivalent of a spreadsheet's "just keep scrolling" - autoTable renders
// every row as real paginated pages, so a report the size of the one you tested Import with
// (50,000+ rows) would produce a multi-thousand-page PDF that can take minutes and a large amount
// of memory to generate, if it doesn't just lock up the tab. Excel has no such limit (SheetJS
// writes 50,000+ rows in about a second), so only the PDF path caps itself - past this many rows it
// exports the first slice and says so on the page and in the filename, rather than silently doing
// something that looks broken or hangs. Download Excel remains the way to get the full data.
const PDF_ROW_CAP = 2000

export function exportReportToPdf<T>(title: string, filenameNoExt: string, columns: ReportColumn<T>[], rows: T[]) {
  const truncated = rows.length > PDF_ROW_CAP
  const pdfRows = truncated ? rows.slice(0, PDF_ROW_CAP) : rows
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' })
  doc.setFontSize(14)
  doc.text(title, 14, 15)
  doc.setFontSize(9)
  doc.setTextColor(100)
  const subtitle = truncated
    ? `Generated ${new Date().toLocaleString('en-IN')} - showing first ${PDF_ROW_CAP} of ${rows.length} rows (use Download Excel for the full data)`
    : `Generated ${new Date().toLocaleString('en-IN')} - ${rows.length} row${rows.length === 1 ? '' : 's'}`
  doc.text(subtitle, 14, 21)
  autoTable(doc, {
    startY: 26,
    head: [columns.map((c) => c.header)],
    body: pdfRows.map((row) => columns.map((c) => String(c.value(row)))),
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [10, 37, 64] }, // matches global.css's --navy: #0a2540
  })
  doc.save(`${filenameNoExt}${truncated ? `_first${PDF_ROW_CAP}` : ''}.pdf`)
}
