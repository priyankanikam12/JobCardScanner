import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import type { CreateOemModelRequest, OemModel } from '../../types'
import { Pagination } from '../../components/Pagination'
import { usePagination } from '../../lib/usePagination'

/**
 * "OEM Model Master" admin page (2026-09-22: "this wants to integrate for my
 * battery-warranty-schemes for link models for warrenty and this all table add in jobcard db that
 * all functionality need to craete in jc"). Manages the GLOBAL (not dealer-scoped) vehicle model
 * catalog behind OemModelsController - ported in shape from the BAPL DMS reference's own
 * OemmodelMaster list/add/edit screens you pasted, ID/ModelName/ModelShortName/IsActive + an Excel
 * "Download" button.
 *
 * Gated to WorkshopManagerUp for viewing (App.tsx route) but the Create/Update/Delete/Active-toggle
 * actions below additionally require CorporateAdminUp - the backend enforces the real gate
 * (stacked [Authorize] on those specific actions, see OemModelsController's own doc comment); this
 * page still shows the buttons to a WorkshopManagerUp-only user (so they can at least browse and
 * understand the catalog when picking a model on an Extended Battery Warranty Scheme) and simply
 * surfaces the resulting 403 from the API if they try to save - no client-side role check is
 * duplicated here since ICurrentUserService.Role isn't exposed to this page today.
 */
const emptyForm: CreateOemModelRequest = { modelName: '', modelShortName: '', isActive: true }

function downloadBlob(data: BlobPart, filename: string) {
  const url = URL.createObjectURL(new Blob([data]))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function OemModelsPage() {
  const [rows, setRows] = useState<OemModel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateOemModelRequest>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    staffApi
      .get<OemModel[]>('/api/oem-models', { params: { search: search || undefined } })
      .then((res) => setRows(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load OEM Models.'))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(rows)

  const startCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setFormError(null)
    setShowForm(true)
  }

  const startEdit = (m: OemModel) => {
    setEditingId(m.id)
    setForm({ modelName: m.modelName, modelShortName: m.modelShortName, isActive: m.isActive })
    setFormError(null)
    setShowForm(true)
  }

  const save = () => {
    if (!form.modelName.trim()) { setFormError('Model Name is required.'); return }
    setSaving(true)
    setFormError(null)
    const req = editingId
      ? staffApi.put<OemModel>(`/api/oem-models/${editingId}`, form)
      : staffApi.post<OemModel>('/api/oem-models', form)
    req
      .then(() => { setShowForm(false); load() })
      .catch((err) => setFormError(err?.response?.data?.message ?? 'Save failed.'))
      .finally(() => setSaving(false))
  }

  const remove = (m: OemModel) => {
    if (!window.confirm(`Delete model "${m.modelName}"? This cannot be undone.`)) return
    staffApi
      .delete(`/api/oem-models/${m.id}`)
      .then(load)
      .catch((err) => alert(err?.response?.data?.message ?? 'Delete failed - the model may already be used on an Extended Battery Warranty Scheme. Mark it Inactive instead.'))
  }

  const exportExcel = async () => {
    const res = await staffApi.get('/api/oem-models/export', { responseType: 'blob' })
    downloadBlob(res.data, 'oem-models.xlsx')
  }

  return (
    <div>
      <h2>OEM Model Master</h2>
      <p className="muted">
        The shared BGauss vehicle model catalog (e.g. "RUV 350 max") used across dealers - not dealer-specific.
        Used to pick a model on an Extended Battery Warranty Scheme and on OEM Model Warranty terms.
      </p>

      {showForm && (
        <div className="card banner-card">
          <h3>{editingId ? 'Edit Model' : 'New Model'}</h3>
          {formError && <p className="error-text">{formError}</p>}
          <div className="form-row">
            <div className="field"><label>Model Name *</label><input value={form.modelName} onChange={(e) => setForm({ ...form, modelName: e.target.value })} /></div>
            <div className="field"><label>Model Short Name</label><input value={form.modelShortName ?? ''} onChange={(e) => setForm({ ...form, modelShortName: e.target.value })} /></div>
            <div className="field">
              <label>Active</label>
              <select value={form.isActive ? '1' : '0'} onChange={(e) => setForm({ ...form, isActive: e.target.value === '1' })}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>{' '}
          <button className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={startCreate}>+ New Model</button>
        <input
          type="text"
          placeholder="Search Model Name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          style={{ maxWidth: 260 }}
        />
        <button type="button" className="btn btn-sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : '↻ Search'}</button>
        <button type="button" className="btn btn-sm" onClick={exportExcel}>⬇ Download Excel</button>
      </div>
      {error && <p className="error-text">{error}</p>}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Model Name</th><th>Short Name</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((m) => (
              <tr key={m.id}>
                <td>{m.modelName}</td>
                <td>{m.modelShortName ?? '—'}</td>
                <td>{m.isActive ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={() => startEdit(m)}>Edit</button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => remove(m)}>Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && !error && (
              <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                No OEM Models yet - click "+ New Model" above to add one.
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>
    </div>
  )
}
