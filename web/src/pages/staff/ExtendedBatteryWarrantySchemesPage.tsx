import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import type { CreateExtendedBatteryWarrantySchemeRequest, ExtendedBatteryWarrantyScheme, OemModel } from '../../types'
import { Pagination } from '../../components/Pagination'
import { usePagination } from '../../lib/usePagination'

/**
 * "Extended Battery Warranty Schemes" admin page (2026-09-22: "needs to create warenty table in
 * jobcardscanner db for this functionality and add this in our function"). Manages the
 * dealer-configurable scheme master (backend/Models/ExtendedBatteryWarrantySchemes.cs) behind
 * ExtendedBatteryWarrantySchemesController - CRUD only here; the eligibility check itself runs
 * automatically, non-destructively, inside Repair Bill save (RepairBillDocsController.Create) once
 * a scheme exists here for a vehicle's Model, so this page exists purely so that data has
 * somewhere to be entered.
 *
 * Gated to WorkshopManagerUp in both App.tsx's route and StaffLayout.tsx's nav entry, matching the
 * backend controller's own [Authorize(Policy = Policies.WorkshopManagerUp)] - same reasoning as
 * Labour Master: DealerPrice/CustomerPrice/DiscountAmount here are confidential pricing data.
 *
 * NOTE: this is a separate, new concept from the existing Vehicle.Warranty.BatteryWarrantyExpiry
 * field elsewhere in this app (a single per-vehicle expiry date, no pricing/scheme). This page
 * does not read or write that field.
 *
 * 2026-09-22 UPDATE: an "OEM Model" dropdown (backed by the new /api/oem-models catalog - see
 * OemModelsPage.tsx) was added ALONGSIDE the free-text Vehicle Model field, not replacing it, per
 * an explicit choice confirmed via AskUserQuestion. Picking a model from the dropdown auto-fills
 * Vehicle Model from that model's name (keeping the two in sync going forward) and sets the new
 * oemModelId; Vehicle Model itself stays a required, directly-editable field so this page keeps
 * working exactly as before for anyone who doesn't use the dropdown, and so existing schemes with
 * no matching catalog entry aren't broken.
 */
const emptyForm: CreateExtendedBatteryWarrantySchemeRequest = {
  schemeName: '',
  vehicleModel: '',
  rateType: '',
  duration: 12,
  durationType: 'Months',
  kms: 0,
  dealerPrice: 0,
  customerPrice: 0,
  discountAmount: 0,
  gstPercent: 18,
  purchaseValidityDays: null,
  batteryPartCode: '',
  partCode: '',
  fromDate: new Date().toISOString().slice(0, 10),
  toDate: null,
  isActive: true,
  oemModelId: null,
}

export function ExtendedBatteryWarrantySchemesPage() {
  const [rows, setRows] = useState<ExtendedBatteryWarrantyScheme[]>([])
  const [models, setModels] = useState<OemModel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateExtendedBatteryWarrantySchemeRequest>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    staffApi
      .get<ExtendedBatteryWarrantyScheme[]>('/api/extended-battery-warranty-schemes', { params: { search: search || undefined } })
      .then((res) => setRows(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load Extended Battery Warranty Schemes.'))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  useEffect(() => {
    staffApi.get<OemModel[]>('/api/oem-models', { params: { isActive: true } }).then((res) => setModels(res.data)).catch(() => {})
  }, [])

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(rows)

  const startCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setFormError(null)
    setShowForm(true)
  }

  const startEdit = (s: ExtendedBatteryWarrantyScheme) => {
    setEditingId(s.id)
    setForm({
      schemeName: s.schemeName,
      vehicleModel: s.vehicleModel,
      rateType: s.rateType,
      duration: s.duration,
      durationType: s.durationType,
      kms: s.kms,
      dealerPrice: s.dealerPrice,
      customerPrice: s.customerPrice,
      discountAmount: s.discountAmount,
      gstPercent: s.gstPercent,
      purchaseValidityDays: s.purchaseValidityDays,
      batteryPartCode: s.batteryPartCode,
      partCode: s.partCode,
      fromDate: s.fromDate.slice(0, 10),
      toDate: s.toDate ? s.toDate.slice(0, 10) : null,
      isActive: s.isActive,
      oemModelId: s.oemModelId,
    })
    setFormError(null)
    setShowForm(true)
  }

  const save = () => {
    if (!form.schemeName.trim()) { setFormError('Scheme Name is required.'); return }
    if (!form.vehicleModel.trim()) { setFormError('Vehicle Model is required.'); return }
    setSaving(true)
    setFormError(null)
    const payload = { ...form, toDate: form.toDate || null, purchaseValidityDays: form.purchaseValidityDays || null }
    const req = editingId
      ? staffApi.put<ExtendedBatteryWarrantyScheme>(`/api/extended-battery-warranty-schemes/${editingId}`, payload)
      : staffApi.post<ExtendedBatteryWarrantyScheme>('/api/extended-battery-warranty-schemes', payload)
    req
      .then(() => { setShowForm(false); load() })
      .catch((err) => setFormError(err?.response?.data?.message ?? 'Save failed.'))
      .finally(() => setSaving(false))
  }

  const remove = (s: ExtendedBatteryWarrantyScheme) => {
    if (!window.confirm(`Delete scheme "${s.schemeName}" (${s.vehicleModel})? This cannot be undone.`)) return
    staffApi
      .delete(`/api/extended-battery-warranty-schemes/${s.id}`)
      .then(load)
      .catch((err) => alert(err?.response?.data?.message ?? 'Delete failed - the scheme may already be used on a Repair Bill line. Mark it Inactive instead.'))
  }

  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN') : '—')
  const fmtAmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div>
      <h2>Extended Battery Warranty Schemes</h2>
      <p className="muted">
        Dealer-configured Extended Battery Warranty pricing/coverage by vehicle model. A Repair Bill's Part
        lines are checked against these automatically when the vehicle's Model and Purchase Date match a scheme -
        this page is only for entering/maintaining that scheme data.
      </p>

      {showForm && (
        <div className="card banner-card">
          <h3>{editingId ? 'Edit Scheme' : 'New Scheme'}</h3>
          {formError && <p className="error-text">{formError}</p>}
          <div className="form-row">
            <div className="field"><label>Scheme Name *</label><input value={form.schemeName} onChange={(e) => setForm({ ...form, schemeName: e.target.value })} /></div>
            <div className="field">
              <label>OEM Model (optional)</label>
              <select
                value={form.oemModelId ?? ''}
                onChange={(e) => {
                  const id = e.target.value || null
                  const picked = models.find((m) => m.id === id)
                  setForm({ ...form, oemModelId: id, vehicleModel: picked ? picked.modelName : form.vehicleModel })
                }}
              >
                <option value="">— pick from catalog —</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.modelName}</option>)}
              </select>
            </div>
            <div className="field"><label>Vehicle Model *</label><input value={form.vehicleModel} onChange={(e) => setForm({ ...form, vehicleModel: e.target.value, oemModelId: null })} placeholder="Must match Vehicle Model exactly, e.g. RUV 350 max" /></div>
            <div className="field"><label>Rate Type</label><input value={form.rateType ?? ''} onChange={(e) => setForm({ ...form, rateType: e.target.value })} /></div>
            <div className="field"><label>Duration *</label><input type="number" min={0} value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} /></div>
            <div className="field">
              <label>Duration Type *</label>
              <select value={form.durationType} onChange={(e) => setForm({ ...form, durationType: e.target.value as 'Days' | 'Months' | 'Years' })}>
                <option value="Days">Days</option>
                <option value="Months">Months</option>
                <option value="Years">Years</option>
              </select>
            </div>
            <div className="field"><label>Coverage Kms (0 = no cap)</label><input type="number" min={0} step="0.01" value={form.kms} onChange={(e) => setForm({ ...form, kms: Number(e.target.value) })} /></div>
            <div className="field"><label>Dealer Price</label><input type="number" min={0} step="0.01" value={form.dealerPrice} onChange={(e) => setForm({ ...form, dealerPrice: Number(e.target.value) })} /></div>
            <div className="field"><label>Customer Price</label><input type="number" min={0} step="0.01" value={form.customerPrice} onChange={(e) => setForm({ ...form, customerPrice: Number(e.target.value) })} /></div>
            <div className="field"><label>Discount Amount</label><input type="number" min={0} step="0.01" value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: Number(e.target.value) })} /></div>
            <div className="field"><label>GST %</label><input type="number" min={0} step="0.01" value={form.gstPercent} onChange={(e) => setForm({ ...form, gstPercent: Number(e.target.value) })} /></div>
            <div className="field"><label>Purchase Validity (days)</label><input type="number" min={0} value={form.purchaseValidityDays ?? ''} onChange={(e) => setForm({ ...form, purchaseValidityDays: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>Battery Part Code</label><input value={form.batteryPartCode ?? ''} onChange={(e) => setForm({ ...form, batteryPartCode: e.target.value })} placeholder="Matched against a Repair Bill Part line's Item Code" /></div>
            <div className="field"><label>Part Code</label><input value={form.partCode ?? ''} onChange={(e) => setForm({ ...form, partCode: e.target.value })} /></div>
            <div className="field"><label>From Date *</label><input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} /></div>
            <div className="field"><label>To Date</label><input type="date" value={form.toDate ?? ''} onChange={(e) => setForm({ ...form, toDate: e.target.value || null })} /></div>
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
        <button type="button" className="btn btn-primary btn-sm" onClick={startCreate}>+ New Scheme</button>
        <input
          type="text"
          placeholder="Search Scheme Name / Vehicle Model…"
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
            <tr>
              <th>Scheme Name</th><th>Vehicle Model</th><th>OEM Model Link</th><th>Duration</th><th className="text-end">Kms</th>
              <th className="text-end">Dealer Price</th><th className="text-end">Customer Price</th>
              <th className="text-end">GST %</th><th>Battery Part / Part Code</th><th>From</th><th>To</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((s) => (
              <tr key={s.id}>
                <td>{s.schemeName}</td>
                <td>{s.vehicleModel}</td>
                <td>{s.oemModelName ? <span className="badge badge-success">{s.oemModelName}</span> : <span className="muted">Unlinked</span>}</td>
                <td>{s.duration} {s.durationType}</td>
                <td className="text-end">{s.kms > 0 ? s.kms.toLocaleString('en-IN') : '—'}</td>
                <td className="text-end">{fmtAmt(s.dealerPrice)}</td>
                <td className="text-end">{fmtAmt(s.customerPrice)}</td>
                <td className="text-end">{s.gstPercent}%</td>
                <td>{s.batteryPartCode ?? '—'} / {s.partCode ?? '—'}</td>
                <td>{fmtDate(s.fromDate)}</td>
                <td>{fmtDate(s.toDate)}</td>
                <td>{s.isActive ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={() => startEdit(s)}>Edit</button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && !error && (
              <tr><td colSpan={13} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                No Extended Battery Warranty Schemes yet - click "+ New Scheme" above to add one.
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>
    </div>
  )
}
