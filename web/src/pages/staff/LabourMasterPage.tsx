import { useEffect, useRef, useState } from 'react'
import { staffApi } from '../../api/client'
import type { LabourMasterImportResult, LabourMasterPartwise, LabourMasterWithoutPartwise } from '../../types'
import { ReportDownloadButtons } from '../../components/ReportDownloadButtons'
import { Pagination } from '../../components/Pagination'
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '../../lib/exportReport'
import { usePagination } from '../../lib/usePagination'

/**
 * "Labour Master" sidebar page (2026-09-19: "i want create 1 sidebar option also in that Labour
 * Master after Service History ... i want 1. Partwise 2. Without partwise ... just want
 * Effective Date *, Rate Type *, Upload Excel *(import) in below grid shown and also duplicate
 * data dont add update same data and dont override this data give for both").
 *
 * One Rate Type selector drives BOTH the import target (which of the two backend endpoints the
 * file posts to) and which grid is shown below - exactly the three fields you asked for, no OEM
 * Model field and no separate "--Select--" placeholder option the way the DMS reference page had.
 * "Without Partwise" rows have no Part Code/Part Name columns; "Partwise" rows do - the table
 * columns below switch with the Rate Type so the grid never shows blank columns for the other
 * shape.
 *
 * Edit/Delete/Export all write straight to DMSBAPLDATA's two new tables (see
 * Services/LabourMasterImportService.cs) - this is NOT a client-side-only page like Vehicle
 * Sale's "Import Vehicle Sale Report" button; every import/edit/delete here is a real database
 * write, visible to every other user of this page immediately.
 */
export function LabourMasterPage() {
  const [rateType, setRateType] = useState<'withoutPartwise' | 'partwise'>('withoutPartwise')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [search, setSearch] = useState('')

  const [woRows, setWoRows] = useState<LabourMasterWithoutPartwise[]>([])
  const [pwRows, setPwRows] = useState<LabourMasterPartwise[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<LabourMasterImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [editingWo, setEditingWo] = useState<LabourMasterWithoutPartwise | null>(null)
  const [editingPw, setEditingPw] = useState<LabourMasterPartwise | null>(null)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    setError(null)
    const path = rateType === 'withoutPartwise' ? '/api/labour-master/without-partwise' : '/api/labour-master/partwise'
    staffApi
      .get(path, { params: { search: search || undefined } })
      .then((res) => (rateType === 'withoutPartwise' ? setWoRows(res.data) : setPwRows(res.data)))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load Labour Master data.'))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [rateType])

  const rows = rateType === 'withoutPartwise' ? woRows : pwRows
  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(rows)

  const handleImport = (file: File) => {
    if (!effectiveDate) { setImportError('Pick an Effective Date first.'); return }
    setImportError(null)
    setImportResult(null)
    setImporting(true)
    const form = new FormData()
    form.append('File', file)
    form.append('EffectiveDate', effectiveDate)
    const path = rateType === 'withoutPartwise' ? '/api/labour-master/without-partwise/import' : '/api/labour-master/partwise/import'
    staffApi
      .post<LabourMasterImportResult>(path, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((res) => {
        setImportResult(res.data)
        load()
      })
      .catch((err) => setImportError(err?.response?.data?.message ?? 'Import failed - check the file and try again.'))
      .finally(() => setImporting(false))
  }

  const saveWo = () => {
    if (!editingWo) return
    setSaving(true)
    staffApi
      .put<LabourMasterWithoutPartwise>(`/api/labour-master/without-partwise/${editingWo.id}`, {
        jobDescription: editingWo.jobDescription,
        model: editingWo.model,
        labourRate: editingWo.labourRate,
        igst: editingWo.igst,
        cgst: editingWo.cgst,
        sgst: editingWo.sgst,
        tier: editingWo.tier,
        category: editingWo.category,
        effectiveDate: editingWo.effectiveDate,
        isActive: editingWo.isActive,
      })
      .then(() => { setEditingWo(null); load() })
      .catch((err) => alert(err?.response?.data?.message ?? 'Update failed.'))
      .finally(() => setSaving(false))
  }

  const savePw = () => {
    if (!editingPw) return
    setSaving(true)
    staffApi
      .put<LabourMasterPartwise>(`/api/labour-master/partwise/${editingPw.id}`, {
        partName: editingPw.partName,
        jobDescription: editingPw.jobDescription,
        model: editingPw.model,
        labourRate: editingPw.labourRate,
        igst: editingPw.igst,
        cgst: editingPw.cgst,
        sgst: editingPw.sgst,
        tier: editingPw.tier,
        category: editingPw.category,
        effectiveDate: editingPw.effectiveDate,
        isActive: editingPw.isActive,
      })
      .then(() => { setEditingPw(null); load() })
      .catch((err) => alert(err?.response?.data?.message ?? 'Update failed.'))
      .finally(() => setSaving(false))
  }

  const deleteWo = (row: LabourMasterWithoutPartwise) => {
    if (!window.confirm(`Delete labour rate "${row.labourCode}" (${row.model ?? 'no model'})? This cannot be undone.`)) return
    staffApi.delete(`/api/labour-master/without-partwise/${row.id}`).then(load).catch((err) => alert(err?.response?.data?.message ?? 'Delete failed.'))
  }
  const deletePw = (row: LabourMasterPartwise) => {
    if (!window.confirm(`Delete part-wise labour rate "${row.labourCode}" / "${row.partCode ?? '—'}"? This cannot be undone.`)) return
    staffApi.delete(`/api/labour-master/partwise/${row.id}`).then(load).catch((err) => alert(err?.response?.data?.message ?? 'Delete failed.'))
  }

  const fmtPct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`)
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN') : '—')
  const toDateInputValue = (d: string | null) => (d ? d.slice(0, 10) : '')

  const woColumns: ReportColumn<LabourMasterWithoutPartwise>[] = [
    { header: 'Labour Code', value: (r) => r.labourCode },
    { header: 'Job Description', value: (r) => r.jobDescription ?? '' },
    { header: 'Model', value: (r) => r.model ?? '' },
    { header: 'Labour Rate', value: (r) => r.labourRate ?? '' },
    { header: 'IGST', value: (r) => r.igst ?? '' },
    { header: 'CGST', value: (r) => r.cgst ?? '' },
    { header: 'SGST', value: (r) => r.sgst ?? '' },
    { header: 'Tier', value: (r) => r.tier ?? '' },
    { header: 'Category', value: (r) => r.category ?? '' },
    { header: 'Effective Date', value: (r) => fmtDate(r.effectiveDate) },
    { header: 'Active', value: (r) => (r.isActive ? 'Yes' : 'No') },
  ]
  const pwColumns: ReportColumn<LabourMasterPartwise>[] = [
    { header: 'Part Code', value: (r) => r.partCode ?? '' },
    { header: 'Part Name', value: (r) => r.partName ?? '' },
    { header: 'Labour Code', value: (r) => r.labourCode },
    { header: 'Job Description', value: (r) => r.jobDescription ?? '' },
    { header: 'Model', value: (r) => r.model ?? '' },
    { header: 'Labour Rate', value: (r) => r.labourRate ?? '' },
    { header: 'IGST', value: (r) => r.igst ?? '' },
    { header: 'CGST', value: (r) => r.cgst ?? '' },
    { header: 'SGST', value: (r) => r.sgst ?? '' },
    { header: 'Tier', value: (r) => r.tier ?? '' },
    { header: 'Category', value: (r) => r.category ?? '' },
    { header: 'Effective Date', value: (r) => fmtDate(r.effectiveDate) },
    { header: 'Active', value: (r) => (r.isActive ? 'Yes' : 'No') },
  ]

  return (
    <div>
      <h2>Labour Master</h2>
      <p className="muted">Import, edit and export labour rate master data - stored in DMSBAPLDATA.</p>

      <div className="card">
        <h3>Import Excel</h3>
        <div className="form-row">
          <div className="field">
            <label>Effective Date *</label>
            <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
          </div>
          <div className="field">
            <label>Rate Type *</label>
            <select
              value={rateType}
              onChange={(e) => {
                setRateType(e.target.value as 'withoutPartwise' | 'partwise')
                setImportResult(null)
                setImportError(null)
              }}
            >
              <option value="withoutPartwise">Without Partwise</option>
              <option value="partwise">Partwise</option>
            </select>
          </div>
          <div className="field">
            <label>Upload Excel *</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImport(file)
                e.target.value = ''
              }}
              disabled={importing || !effectiveDate}
            />
          </div>
        </div>
        {importing && <p className="muted">Importing…</p>}
        {importError && <p className="error-text">{importError}</p>}
        {importResult && (
          <p className="jcs-info-text" style={{ margin: 0, padding: '10px 12px', borderRadius: 8, background: '#ecfdf3', color: '#065f46', fontSize: 13 }}>
            Imported {importResult.totalDataRows} row{importResult.totalDataRows === 1 ? '' : 's'}:{' '}
            {importResult.inserted} new, {importResult.updated} updated, {importResult.unchanged} unchanged (no duplicates added)
            {importResult.skippedBlank > 0 ? `, ${importResult.skippedBlank} blank row(s) skipped` : ''}.
            {importResult.warnings.length > 0 && (
              <> {importResult.warnings.map((w, i) => <span key={i}> {w}</span>)}</>
            )}
          </p>
        )}
      </div>

      {/* ---------------- Edit card (Without Partwise) ---------------- */}
      {editingWo && (
        <div className="card banner-card">
          <h3>Edit Labour Rate - {editingWo.labourCode}</h3>
          <div className="form-row">
            <div className="field"><label>Job Description</label><input value={editingWo.jobDescription ?? ''} onChange={(e) => setEditingWo({ ...editingWo, jobDescription: e.target.value })} /></div>
            <div className="field"><label>Model</label><input value={editingWo.model ?? ''} onChange={(e) => setEditingWo({ ...editingWo, model: e.target.value })} /></div>
            <div className="field"><label>Labour Rate</label><input type="number" step="0.01" value={editingWo.labourRate ?? ''} onChange={(e) => setEditingWo({ ...editingWo, labourRate: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>Tier</label><input type="number" value={editingWo.tier ?? ''} onChange={(e) => setEditingWo({ ...editingWo, tier: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>IGST (fraction, e.g. 0.18 = 18%)</label><input type="number" step="0.0001" value={editingWo.igst ?? ''} onChange={(e) => setEditingWo({ ...editingWo, igst: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>CGST</label><input type="number" step="0.0001" value={editingWo.cgst ?? ''} onChange={(e) => setEditingWo({ ...editingWo, cgst: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>SGST</label><input type="number" step="0.0001" value={editingWo.sgst ?? ''} onChange={(e) => setEditingWo({ ...editingWo, sgst: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>Category</label><input value={editingWo.category ?? ''} onChange={(e) => setEditingWo({ ...editingWo, category: e.target.value })} /></div>
            <div className="field"><label>Effective Date</label><input type="date" value={toDateInputValue(editingWo.effectiveDate)} onChange={(e) => setEditingWo({ ...editingWo, effectiveDate: e.target.value })} /></div>
            <div className="field">
              <label>Active</label>
              <select value={editingWo.isActive ? '1' : '0'} onChange={(e) => setEditingWo({ ...editingWo, isActive: e.target.value === '1' })}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={saveWo}>{saving ? 'Saving…' : 'Save'}</button>{' '}
          <button className="btn btn-sm" onClick={() => setEditingWo(null)}>Cancel</button>
        </div>
      )}

      {/* ---------------- Edit card (Partwise) ---------------- */}
      {editingPw && (
        <div className="card banner-card">
          <h3>Edit Part-wise Labour Rate - {editingPw.labourCode} / {editingPw.partCode ?? '—'}</h3>
          <div className="form-row">
            <div className="field"><label>Part Name</label><input value={editingPw.partName ?? ''} onChange={(e) => setEditingPw({ ...editingPw, partName: e.target.value })} /></div>
            <div className="field"><label>Job Description</label><input value={editingPw.jobDescription ?? ''} onChange={(e) => setEditingPw({ ...editingPw, jobDescription: e.target.value })} /></div>
            <div className="field"><label>Model</label><input value={editingPw.model ?? ''} onChange={(e) => setEditingPw({ ...editingPw, model: e.target.value })} /></div>
            <div className="field"><label>Labour Rate</label><input type="number" step="0.01" value={editingPw.labourRate ?? ''} onChange={(e) => setEditingPw({ ...editingPw, labourRate: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>Tier</label><input type="number" value={editingPw.tier ?? ''} onChange={(e) => setEditingPw({ ...editingPw, tier: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>IGST (fraction, e.g. 0.18 = 18%)</label><input type="number" step="0.0001" value={editingPw.igst ?? ''} onChange={(e) => setEditingPw({ ...editingPw, igst: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>CGST</label><input type="number" step="0.0001" value={editingPw.cgst ?? ''} onChange={(e) => setEditingPw({ ...editingPw, cgst: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>SGST</label><input type="number" step="0.0001" value={editingPw.sgst ?? ''} onChange={(e) => setEditingPw({ ...editingPw, sgst: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>Category</label><input value={editingPw.category ?? ''} onChange={(e) => setEditingPw({ ...editingPw, category: e.target.value })} /></div>
            <div className="field"><label>Effective Date</label><input type="date" value={toDateInputValue(editingPw.effectiveDate)} onChange={(e) => setEditingPw({ ...editingPw, effectiveDate: e.target.value })} /></div>
            <div className="field">
              <label>Active</label>
              <select value={editingPw.isActive ? '1' : '0'} onChange={(e) => setEditingPw({ ...editingPw, isActive: e.target.value === '1' })}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={savePw}>{saving ? 'Saving…' : 'Save'}</button>{' '}
          <button className="btn btn-sm" onClick={() => setEditingPw(null)}>Cancel</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <ReportDownloadButtons
          disabled={rows.length === 0}
          onExcel={() =>
            rateType === 'withoutPartwise'
              ? exportReportToExcel('Labour_Master_Without_Partwise', woColumns, woRows)
              : exportReportToExcel('Labour_Master_Partwise', pwColumns, pwRows)
          }
          onPdf={() =>
            rateType === 'withoutPartwise'
              ? exportReportToPdf('Labour Master - Without Partwise', 'Labour_Master_Without_Partwise', woColumns, woRows)
              : exportReportToPdf('Labour Master - Partwise', 'Labour_Master_Partwise', pwColumns, pwRows)
          }
        />
        <input
          type="text"
          placeholder="Search Labour Code / Model / Category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          style={{ maxWidth: 260 }}
        />
        <button type="button" className="btn btn-sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : '↻ Search'}</button>
      </div>
      {error && <p className="error-text">{error}</p>}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            {rateType === 'withoutPartwise' ? (
              <tr>
                <th>Labour Code</th><th>Job Description</th><th>Model</th><th className="text-end">Rate</th>
                <th>IGST</th><th>CGST</th><th>SGST</th><th>Tier</th><th>Category</th><th>Effective Date</th><th>Status</th><th></th>
              </tr>
            ) : (
              <tr>
                <th>Part Code</th><th>Part Name</th><th>Labour Code</th><th>Job Description</th><th>Model</th>
                <th className="text-end">Rate</th><th>IGST</th><th>CGST</th><th>SGST</th><th>Tier</th><th>Category</th><th>Effective Date</th><th>Status</th><th></th>
              </tr>
            )}
          </thead>
          <tbody>
            {rateType === 'withoutPartwise'
              ? (pageRows as LabourMasterWithoutPartwise[]).map((r) => (
                  <tr key={r.id}>
                    <td>{r.labourCode}</td>
                    <td>{r.jobDescription ?? '—'}</td>
                    <td>{r.model ?? '—'}</td>
                    <td className="text-end">{r.labourRate ?? '—'}</td>
                    <td>{fmtPct(r.igst)}</td>
                    <td>{fmtPct(r.cgst)}</td>
                    <td>{fmtPct(r.sgst)}</td>
                    <td>{r.tier ?? '—'}</td>
                    <td>{r.category ?? '—'}</td>
                    <td>{fmtDate(r.effectiveDate)}</td>
                    <td>{r.isActive ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => setEditingWo(r)}>Edit</button>{' '}
                      <button className="btn btn-sm btn-danger" onClick={() => deleteWo(r)}>Delete</button>
                    </td>
                  </tr>
                ))
              : (pageRows as LabourMasterPartwise[]).map((r) => (
                  <tr key={r.id}>
                    <td>{r.partCode ?? '—'}</td>
                    <td>{r.partName ?? '—'}</td>
                    <td>{r.labourCode}</td>
                    <td>{r.jobDescription ?? '—'}</td>
                    <td>{r.model ?? '—'}</td>
                    <td className="text-end">{r.labourRate ?? '—'}</td>
                    <td>{fmtPct(r.igst)}</td>
                    <td>{fmtPct(r.cgst)}</td>
                    <td>{fmtPct(r.sgst)}</td>
                    <td>{r.tier ?? '—'}</td>
                    <td>{r.category ?? '—'}</td>
                    <td>{fmtDate(r.effectiveDate)}</td>
                    <td>{r.isActive ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => setEditingPw(r)}>Edit</button>{' '}
                      <button className="btn btn-sm btn-danger" onClick={() => deletePw(r)}>Delete</button>
                    </td>
                  </tr>
                ))}
            {rows.length === 0 && !loading && !error && (
              <tr><td colSpan={13} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                No {rateType === 'withoutPartwise' ? 'Without Partwise' : 'Partwise'} labour rates yet - import an Excel file above to get started.
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>
    </div>
  )
}
