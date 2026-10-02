import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import * as XLSX from 'xlsx'
import { staffApi } from '../../api/client'

/**
 * SECTION 163 (2026-09-30) + SECTION 166 (2026-09-30) "for this 3 master create edit delete
 * access ?" - the shared global complaint list (no DealerId - one list, every dealer) the Job
 * Card Wizard picks from. Now a full add / edit / deactivate page backed by
 * POST/PUT/DELETE /api/complaint-master (see ComplaintMasterController.cs's class doc comment for
 * role gating). "Delete" deactivates (IsActive=false) rather than hard-deleting - reversible via
 * the Reactivate button.
 */
interface Row {
  id: string
  complaintText: string
  sortOrder: number
  isActive: boolean
}

// SECTION 172 (2026-09-30) - see ServiceMenuMasterPage.tsx's own SECTION 172 doc comment for the
// full explanation (checkbox moved to the side of the title row; shared typography styles).
const PAGE_TITLE_STYLE: CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: '#111827', margin: 0 }
const PAGE_SUBTITLE_STYLE: CSSProperties = { fontSize: 14, color: '#6b7280', margin: '4px 0 0' }
const SECTION_TITLE_STYLE: CSSProperties = { fontSize: 16, fontWeight: 600, color: '#111827', letterSpacing: '-0.005em', marginTop: 0 }
const TH_STYLE: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', textAlign: 'left' }
// SECTION 174 (2026-09-30) "...in all master search and dropdown filter add" - added a search box
// (matches Complaint Text, same idea as LabourMasterPage.tsx's own search box). At the time, NO
// dropdown filter was added - this row shape only had Complaint Text/Sort Order/Active, and
// Active/Inactive was just a "Show deactivated rows too" checkbox.
//
// 2026-10-02 ("add download format of button and bulk import complain for dropdown and add filter
// and search"): that checkbox is now a proper Status (Active only / Deactivated only / All)
// dropdown filter instead - Status is the one categorical field this table actually has, same
// pattern ServiceMenuMasterPage.tsx/DocPrefixMasterPage.tsx already use for their own dropdown
// filters. Also added: a "Download template" button (a blank CSV with the two column headers this
// page expects) and "Bulk import complaints" (reads a .xlsx/.xls/.csv file - same `xlsx` library
// and FileReader pattern VehicleSalePage.tsx's "Import Vehicle Sale Report" already uses, see
// handleBulkImportFile below). There's no new bulk-create endpoint on the backend - each row is
// POSTed individually through the exact same /api/complaint-master endpoint the single "Add
// complaint" form above already calls (ComplaintMasterController.Create has no bulk variant), just
// looped sequentially so a failed row's error can be attributed and reported back. Rows already in
// the list, or duplicated within the uploaded file itself, are skipped (matched by Complaint Text,
// case-insensitive) rather than creating duplicates.

export function ComplaintMasterPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 2026-10-02: replaces the old showInactive boolean checkbox - see the SECTION 174 doc comment
  // above.
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [search, setSearch] = useState('') // SECTION 174

  const [editId, setEditId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // 2026-10-02 bulk import state - see handleBulkImportFile/downloadTemplate below.
  const bulkFileInputRef = useRef<HTMLInputElement>(null)
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [bulkResult, setBulkResult] = useState<{ created: number; skipped: number; failed: { text: string; message: string }[] } | null>(null)

  const load = () => {
    setLoading(true)
    staffApi
      .get<Row[]>('/api/complaint-master/admin-list')
      .then((res) => setRows(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load Complaint Master data.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const startEdit = (r: Row) => {
    setEditId(r.id)
    setText(r.complaintText)
    setSortOrder(String(r.sortOrder))
    setFormError(null)
  }

  const cancelEdit = () => {
    setEditId(null)
    setText('')
    setSortOrder('0')
    setFormError(null)
  }

  const save = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setFormError('Complaint text is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const body = { complaintText: trimmed, sortOrder: Number(sortOrder) || 0 }
    const req = editId ? staffApi.put(`/api/complaint-master/${editId}`, { ...body, isActive: true }) : staffApi.post('/api/complaint-master', body)
    req
      .then(() => {
        cancelEdit()
        load()
      })
      .catch((err) => setFormError(err?.response?.data?.message ?? 'Could not save this complaint.'))
      .finally(() => setSaving(false))
  }

  const toggleActive = (r: Row) => {
    if (r.isActive) {
      staffApi.delete(`/api/complaint-master/${r.id}`).then(load).catch((err) => setError(err?.response?.data?.message ?? 'Could not deactivate this complaint.'))
    } else {
      staffApi
        .put(`/api/complaint-master/${r.id}`, { complaintText: r.complaintText, sortOrder: r.sortOrder, isActive: true })
        .then(load)
        .catch((err) => setError(err?.response?.data?.message ?? 'Could not reactivate this complaint.'))
    }
  }

  // Blank CSV with just the two column headers this page's bulk import expects, plus one example
  // row - opens fine in Excel, matches the header-matching handleBulkImportFile does below
  // (case/spacing-insensitive, so "complaint text" or "Complaint Text " in a re-saved file still
  // works).
  const downloadTemplate = () => {
    const csv = ['Complaint Text,Sort Order', '"Battery not charging",0'].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'ComplaintMasterImportTemplate.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const normalizeHeader = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[.\s]/g, '')

  /** Same xlsx/FileReader pattern as VehicleSalePage.tsx's "Import Vehicle Sale Report" - reads
   * the first sheet of a .xlsx/.xls/.csv file, finds the Complaint Text (required) and Sort Order
   * (optional, defaults to 0) columns by header name, then POSTs each new row individually through
   * the existing single-row create endpoint (there is no bulk-create endpoint on the backend).
   * Rows already in `rows`, or repeated within the file itself, are skipped rather than creating
   * duplicates - matched on Complaint Text, case-insensitive. Sequential (not Promise.all) so a
   * failed row's own error message can be captured and shown back, and so the API isn't hit with a
   * burst of parallel requests for a large file. */
  const handleBulkImportFile = (file: File) => {
    setBulkError(null)
    setBulkResult(null)
    setBulkImporting(true)
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = e.target?.result
      if (!data) { setBulkImporting(false); return }
      setTimeout(async () => {
        try {
          const workbook = XLSX.read(data, { type: 'array' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          if (!sheet) { setBulkError('That file has no sheets.'); setBulkImporting(false); return }
          const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
          if (sheetRows.length < 2) { setBulkError('That file has no data rows below the header.'); setBulkImporting(false); return }
          const headerRow = sheetRows[0] as unknown[]
          const textColIdx = headerRow.findIndex((h) => ['complainttext', 'complaint'].includes(normalizeHeader(h)))
          const sortColIdx = headerRow.findIndex((h) => ['sortorder', 'order'].includes(normalizeHeader(h)))
          if (textColIdx === -1) {
            setBulkError('Could not find a "Complaint Text" column in that file - use the downloaded template\'s header row.')
            setBulkImporting(false)
            return
          }
          const existing = new Set(rows.map((r) => r.complaintText.trim().toLowerCase()))
          const seenInFile = new Set<string>()
          const toCreate: { complaintText: string; sortOrder: number }[] = []
          let skipped = 0
          for (const raw of sheetRows.slice(1)) {
            if (!Array.isArray(raw)) continue
            const complaintText = String(raw[textColIdx] ?? '').trim()
            if (!complaintText) continue
            const key = complaintText.toLowerCase()
            if (existing.has(key) || seenInFile.has(key)) { skipped += 1; continue }
            seenInFile.add(key)
            const sortRaw = sortColIdx === -1 ? '' : String(raw[sortColIdx] ?? '').trim()
            toCreate.push({ complaintText, sortOrder: sortRaw ? (Number(sortRaw) || 0) : 0 })
          }
          if (toCreate.length === 0) {
            setBulkResult({ created: 0, skipped, failed: [] })
            setBulkImporting(false)
            return
          }
          let created = 0
          const failed: { text: string; message: string }[] = []
          for (const row of toCreate) {
            try {
              await staffApi.post('/api/complaint-master', row)
              created += 1
            } catch (err: unknown) {
              const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save.'
              failed.push({ text: row.complaintText, message: msg })
            }
          }
          setBulkResult({ created, skipped, failed })
          load()
        } catch {
          setBulkError('Could not read that file - make sure it is a .xlsx, .xls or .csv export matching the downloaded template\'s columns.')
        } finally {
          setBulkImporting(false)
        }
      }, 0)
    }
    reader.onerror = () => { setBulkError('Could not read that file.'); setBulkImporting(false) }
    reader.readAsArrayBuffer(file)
  }

  const visibleRows = rows
    .filter((r) => statusFilter === 'all' || (statusFilter === 'active' ? r.isActive : !r.isActive))
    .filter((r) => !search.trim() || r.complaintText.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={PAGE_TITLE_STYLE}>Complaint Master</h2>
        {/* <p style={PAGE_SUBTITLE_STYLE}>The shared global complaint list the Job Card Wizard picks from.</p> */}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={SECTION_TITLE_STYLE}>{editId ? 'Edit complaint' : 'Add new complaint'}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: 1, minWidth: 240 }}>
            <div className="muted">Complaint Text</div>
            <input style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Battery not charging" />
          </label>
          <label>
            <div className="muted">Sort Order</div>
            <input style={{ width: 70 }} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : editId ? 'Save changes' : 'Add complaint'}
          </button>
          {editId && (
            <button className="btn" disabled={saving} onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
        {formError && <p className="error-text">{formError}</p>}
      </div>

      {/* 2026-10-02 - see the class-level doc comment above. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={SECTION_TITLE_STYLE}>Bulk import</h3>
        {/* <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
          Download the template, fill in Complaint Text (one per row - Sort Order is optional), then upload it here.
          Rows already in the list below are skipped automatically, matched by Complaint Text.
        </p> */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn" onClick={downloadTemplate}>⬇ Download template</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={bulkImporting}
            onClick={() => bulkFileInputRef.current?.click()}
          >
            {bulkImporting ? 'Importing…' : '⬆ Bulk import complaints'}
          </button>
          <input
            ref={bulkFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) handleBulkImportFile(f)
            }}
          />
        </div>
        {bulkError && <p className="error-text">{bulkError}</p>}
        {bulkResult && (
          <p className="muted" style={{ marginTop: 8 }}>
            Imported {bulkResult.created} complaint{bulkResult.created === 1 ? '' : 's'}.
            {bulkResult.skipped > 0 ? ` ${bulkResult.skipped} skipped (already in the list, or duplicated in the file).` : ''}
            {bulkResult.failed.length > 0
              ? ` ${bulkResult.failed.length} failed: ${bulkResult.failed.map((f) => `"${f.text}" (${f.message})`).join('; ')}`
              : ''}
          </p>
        )}
      </div>

      {/* SECTION 174 - search box + (2026-10-02) Status dropdown filter, see class-level SECTION
         174 doc comment above. */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search Complaint Text…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }}>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="active">Active only</option>
            <option value="inactive">Deactivated only</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && (
        <div className="card" style={{ padding: 0 }}>
          {visibleRows.length === 0 ? (
            <p className="muted" style={{ padding: 16 }}>
              {rows.length === 0 ? 'No complaints yet - add one above.' : 'No complaints match your search.'}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={TH_STYLE}>Complaint</th>
                  <th style={TH_STYLE}>Sort Order</th>
                  <th style={TH_STYLE}>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id} style={r.isActive ? undefined : { opacity: 0.5 }}>
                    <td>{r.complaintText}</td>
                    <td>{r.sortOrder}</td>
                    <td>{r.isActive ? 'Active' : 'Deactivated'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn" onClick={() => startEdit(r)}>Edit</button>{' '}
                      <button className="btn" onClick={() => toggleActive(r)}>{r.isActive ? 'Deactivate' : 'Reactivate'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
