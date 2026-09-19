import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'

interface Props {
  /** Called with every non-empty value found in the matched column. */
  onValues: (values: string[]) => void
  /** Column header names (case/spacing-insensitive) to look for in row 1 - the first one found
   * wins. Lets each page point this at whatever column its own data actually has (e.g. "Doc No"
   * for Material Transfer) instead of always assuming column A. Falls back to column A - treating
   * every row as data, no header - when none of these are found, so a plain single-column list
   * (the original behavior) still works too. */
  headerCandidates: string[]
  label?: string
}

const normalize = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[.\s]/g, '')

/**
 * "Import Excel" bulk-filter control - 2026-09-18 "import excel option add in each [page]" (asked
 * for the same three DMSBAPLDATA pages: Vehicle Sale, Material Transfer, Repair Bill).
 *
 * IMPORTANT - what this does and doesn't do: it reads an uploaded .xlsx/.xls/.csv file entirely IN
 * THE BROWSER (SheetJS) and hands values from ONE recognized column back to the page, which filters
 * the rows ALREADY LOADED on screen down to just the ones matching an imported value (e.g. paste in
 * a list of chassis numbers, see only the sales/bills/transfers for those). It does NOT send the
 * file to the server and does NOT write anything into DMSBAPLDATA or JobCardScanner's own database
 * - these three pages are documented everywhere as read-only to DMSBAPLDATA, and this keeps that
 * true. If "import" was actually meant as a way to CREATE or UPDATE records from an Excel file,
 * that's a fundamentally different (and much bigger) feature - say so explicitly and it'll get
 * scoped separately rather than assumed.
 *
 * 2026-09-18: now looks for a real header row (via `headerCandidates`) instead of always reading
 * column A - you tested the original column-A-only version against a real BAPL DMS report export
 * where the useful column wasn't first, so this is more forgiving of real-world files.
 */
export function ImportExcelButton({ onValues, headerCandidates, label = 'Import Excel' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = e.target?.result
      if (!data) return
      const workbook = XLSX.read(data, { type: 'array' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!firstSheet) return
      const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1 })
      if (rows.length === 0) { setStatus('That file has no rows.'); onValues([]); return }

      const normalizedCandidates = headerCandidates.map(normalize)
      const headerRow = rows[0]
      let colIndex = -1
      let matchedHeader = ''
      if (Array.isArray(headerRow)) {
        for (let i = 0; i < headerRow.length; i++) {
          if (normalizedCandidates.includes(normalize(headerRow[i]))) {
            colIndex = i
            matchedHeader = String(headerRow[i])
            break
          }
        }
      }

      let values: string[]
      if (colIndex >= 0) {
        values = rows.slice(1)
          .map((r) => (Array.isArray(r) ? r[colIndex] : undefined))
          .filter((v): v is string | number => v !== undefined && v !== null && String(v).trim() !== '')
          .map((v) => String(v).trim())
        setStatus(`Matched ${values.length} value${values.length === 1 ? '' : 's'} from the "${matchedHeader}" column.`)
      } else {
        // No recognized header - fall back to treating column A of every row as plain data (the
        // original, simpler behavior), so a single-column list without headers still works.
        values = rows
          .map((r) => (Array.isArray(r) ? r[0] : undefined))
          .filter((v): v is string | number => v !== undefined && v !== null && String(v).trim() !== '')
          .map((v) => String(v).trim())
        setStatus(`Couldn't find a column named ${headerCandidates.map((h) => `"${h}"`).join(' / ')} - used the first column instead (${values.length} value${values.length === 1 ? '' : 's'}).`)
      }
      onValues(values)
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" className="btn btn-sm btn-import" onClick={() => inputRef.current?.click()}>⬆ {label}</button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = '' // allow re-selecting the same filename again later
        }}
      />
      {status && <span className="muted" style={{ fontSize: 12 }}>{status}</span>}
    </span>
  )
}
