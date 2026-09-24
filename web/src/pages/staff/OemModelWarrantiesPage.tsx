import { useEffect, useMemo, useState } from 'react'
import { staffApi } from '../../api/client'
import type { CreateOemModelWarrantyRequest, OemModel, OemModelWarranty } from '../../types'
import { Pagination } from '../../components/Pagination'
import { usePagination } from '../../lib/usePagination'

/**
 * "OEM Model Warranty" admin page (2026-09-22 - see OemModelsPage.tsx's own doc comment for the
 * shared context). Manages the OEM/manufacturer's own STANDARD warranty terms per model
 * (OemModelWarrantiesController) - ported in shape from the DMS reference's own
 * oemmodel-warranty/add-oemmodel-warranty screens: list with date-range filter + Excel download,
 * and an add/edit form with a model dropdown (not free text - see OemModel's own doc comment for
 * why this table, unlike Vehicle.Model, is real FK-based).
 *
 * EffectiveDate minimum (ported business rule - see OemModelWarranty's own backend doc comment):
 * for the currently-selected model, EffectiveDate must be strictly after that model's own most
 * recent EXISTING EffectiveDate (excluding the row being edited). Enforced here client-side via the
 * <input type="date" min=...> the reference itself used, AND enforced again server-side by
 * OemModelWarrantiesController.Create/Update - a client-only check would be trivially bypassed.
 */
const emptyForm: CreateOemModelWarrantyRequest = {
  oemModelId: '',
  effectiveDate: new Date().toISOString().slice(0, 10),
  odoReading: null,
  durationType: 'Months',
  duration: null,
  isB2b: false,
}

function downloadBlob(data: BlobPart, filename: string) {
  const url = URL.createObjectURL(new Blob([data]))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function OemModelWarrantiesPage() {
  const [rows, setRows] = useState<OemModelWarranty[]>([])
  const [models, setModels] = useState<OemModel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterModelId, setFilterModelId] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateOemModelWarrantyRequest>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    staffApi
      .get<OemModelWarranty[]>('/api/oem-model-warranties', {
        params: { oemModelId: filterModelId || undefined, effectiveFrom: filterFrom || undefined, effectiveTo: filterTo || undefined },
      })
      .then((res) => setRows(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load OEM Model Warranties.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    staffApi.get<OemModel[]>('/api/oem-models', { params: { isActive: true } }).then((res) => setModels(res.data)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(rows)

  // Ported from the reference's add-oemmodel-warranty.ts getLastEffectiveDate()/effectiveMinDate -
  // the earliest date the form's own EffectiveDate field may be set to, given the currently
  // selected model and (when editing) excluding the row being edited itself.
  const effectiveMinDate = useMemo(() => {
    const otherRowsForModel = rows.filter((w) => w.oemModelId === form.oemModelId && w.id !== editingId)
    if (otherRowsForModel.length === 0) return undefined
    const lastDate = otherRowsForModel.reduce((max, w) => (w.effectiveDate > max ? w.effectiveDate : max), otherRowsForModel[0].effectiveDate)
    return addDays(lastDate.slice(0, 10), 1)
  }, [rows, form.oemModelId, editingId])

  const startCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setFormError(null)
    setShowForm(true)
  }

  const startEdit = (w: OemModelWarranty) => {
    setEditingId(w.id)
    setForm({
      oemModelId: w.oemModelId,
      effectiveDate: w.effectiveDate.slice(0, 10),
      odoReading: w.odoReading,
      durationType: w.durationType,
      duration: w.duration,
      isB2b: w.isB2b,
    })
    setFormError(null)
    setShowForm(true)
  }

  const save = () => {
    if (!form.oemModelId) { setFormError('OEM Model is required.'); return }
    if (effectiveMinDate && form.effectiveDate < effectiveMinDate) {
      setFormError(`Effective Date must be on/after ${new Date(effectiveMinDate).toLocaleDateString('en-IN')} for this model.`)
      return
    }
    setSaving(true)
    setFormError(null)
    const req = editingId
      ? staffApi.put<OemModelWarranty>(`/api/oem-model-warranties/${editingId}`, form)
      : staffApi.post<OemModelWarranty>('/api/oem-model-warranties', form)
    req
      .then(() => { setShowForm(false); load() })
      .catch((err) => setFormError(err?.response?.data?.message ?? 'Save failed.'))
      .finally(() => setSaving(false))
  }

  const remove = (w: OemModelWarranty) => {
    if (!window.confirm(`Delete this warranty term for "${w.oemModelName ?? w.oemModelId}"? This cannot be undone.`)) return
    staffApi
      .delete(`/api/oem-model-warranties/${w.id}`)
      .then(load)
      .catch((err) => alert(err?.response?.data?.message ?? 'Delete failed.'))
  }

  const exportExcel = async () => {
    const res = await staffApi.get('/api/oem-model-warranties/export', {
      responseType: 'blob',
      params: { oemModelId: filterModelId || undefined, effectiveFrom: filterFrom || undefined, effectiveTo: filterTo || undefined },
    })
    downloadBlob(res.data, 'oem-model-warranties.xlsx')
  }

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN')

  return (
    <div>
      <h2>OEM Model Warranty</h2>
      <p className="muted">
        The OEM/manufacturer's own standard warranty terms per model (date/odometer cap, duration, B2B flag) -
        separate from the dealer-priced Extended Battery Warranty Scheme. Terms are versioned by Effective Date:
        a new term for a model must be dated after that model's most recent existing term.
      </p>

      {showForm && (
        <div className="card banner-card">
          <h3>{editingId ? 'Edit Warranty Term' : 'New Warranty Term'}</h3>
          {formError && <p className="error-text">{formError}</p>}
          <div className="form-row">
            <div className="field">
              <label>OEM Model *</label>
              <select value={form.oemModelId} onChange={(e) => setForm({ ...form, oemModelId: e.target.value })}>
                <option value="">Select a model…</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.modelName}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Effective Date *</label>
              <input type="date" min={effectiveMinDate} value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
              {effectiveMinDate && <span className="muted" style={{ fontSize: 12 }}>Must be on/after {new Date(effectiveMinDate).toLocaleDateString('en-IN')}</span>}
            </div>
            <div className="field"><label>Odo Reading (km)</label><input type="number" min={0} step="0.01" value={form.odoReading ?? ''} onChange={(e) => setForm({ ...form, odoReading: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>Duration</label><input type="number" min={0} step="0.01" value={form.duration ?? ''} onChange={(e) => setForm({ ...form, duration: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field">
              <label>Duration Type</label>
              <select value={form.durationType ?? ''} onChange={(e) => setForm({ ...form, durationType: (e.target.value || null) as 'Months' | 'Years' | null })}>
                <option value="">—</option>
                <option value="Months">Months</option>
                <option value="Years">Years</option>
              </select>
            </div>
            <div className="field">
              <label>B2B</label>
              <select value={form.isB2b ? '1' : '0'} onChange={(e) => setForm({ ...form, isB2b: e.target.value === '1' })}>
                <option value="0">No (B2C)</option>
                <option value="1">Yes (B2B)</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>{' '}
          <button className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={startCreate}>+ New Warranty Term</button>
        <select value={filterModelId} onChange={(e) => setFilterModelId(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All Models</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.modelName}</option>)}
        </select>
        <label className="muted" style={{ fontSize: 12 }}>Effective From</label>
        <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
        <label className="muted" style={{ fontSize: 12 }}>To</label>
        <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
        <button type="button" className="btn btn-sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : '↻ Filter'}</button>
        <button type="button" className="btn btn-sm" onClick={exportExcel}>⬇ Download Excel</button>
      </div>
      {error && <p className="error-text">{error}</p>}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Model</th><th>Effective Date</th><th className="text-end">Odo Reading</th>
              <th>Duration</th><th>B2B</th><th></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((w) => (
              <tr key={w.id}>
                <td>{w.oemModelName ?? '—'}</td>
                <td>{fmtDate(w.effectiveDate)}</td>
                <td className="text-end">{w.odoReading != null ? w.odoReading.toLocaleString('en-IN') : '—'}</td>
                <td>{w.duration != null ? `${w.duration} ${w.durationType ?? ''}` : '—'}</td>
                <td>{w.isB2b ? 'Yes' : 'No'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={() => startEdit(w)}>Edit</button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => remove(w)}>Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && !error && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                No OEM Model Warranty terms yet - click "+ New Warranty Term" above to add one.
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>
    </div>
  )
}
