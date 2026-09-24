import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsWorkshop, Technician } from '../../types'

/**
 * "Technician Employee" tab (2026-09-24 - "that Supervisor login which we create from Dealer
 * Employees that supervisor when login then he have access to create Tecnician that tab name
 * Technician Employee"). Manages the new login-less Technician roster (see backend
 * Models/Technicians.cs) that feeds the Job Card Wizard's "Technician" dropdown and the Job Card
 * Detail page's "Assign Technician" dropdown (both scoped by Location - see those pages' own doc
 * comments). Deliberately NOT a User/login - no email, password, mobile, or role: just a Name and
 * a Location, mirroring EmployeesPage.tsx's overall structure but far smaller, since there is no
 * Azure AD/Dealer-JWT sign-in to manage here.
 *
 * Route guard (App.tsx/StaffLayout.tsx): Supervisor/DealerAdmin/CorporateAdmin/SystemAdmin for the
 * page itself, matching this page's write actions being SupervisorUp-gated server-side
 * (TechniciansController.Create/Update/Delete) - a plain WorkshopManager does NOT get this tab,
 * that's the one deliberate access difference the new Supervisor role exists to create (see
 * StaffRole.Supervisor's own doc comment). Reading the list (GET /api/technicians) is
 * ServiceAdvisorUp underneath, wide enough for the Wizard/Detail page dropdowns everyone else uses.
 *
 * KNOWN GAP (disclosed, not silently dropped): unlike EmployeesPage.tsx, this page has no
 * Corporate/System Admin cross-dealer view - TechniciansController.List only returns rows for a
 * dealerId a Corporate/System Admin explicitly passes, and this page never passes one, so it will
 * show an empty list for those two roles today. Dealer-scoped Supervisor/DealerAdmin (the actual
 * intended users of this tab) are unaffected.
 */

const emptyTechnicianForm = {
  id: null as string | null,
  name: '',
  locationCode: '',
}

const apiErrorMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback

export function TechnicianEmployeesPage() {
  const { profile, hasRole } = useStaffAuth()
  const canManage = hasRole('Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin')

  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [includeInactive, setIncludeInactive] = useState(false)
  const load = () => staffApi.get<Technician[]>('/api/technicians', { params: { includeInactive } }).then((r) => setTechnicians(r.data))
  useEffect(() => { load() }, [includeInactive])

  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  useEffect(() => {
    if (!profile?.dealerId) { setWorkshops([]); return }
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then((r) => setWorkshops(r.data))
      .catch(() => setWorkshops([]))
  }, [profile?.dealerId])

  const [form, setForm] = useState(emptyTechnicianForm)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const resetForm = () => { setForm(emptyTechnicianForm); setError(null) }

  const editTechnician = (t: Technician) => {
    setForm({ id: t.id, name: t.name, locationCode: t.locationCode })
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async () => {
    setError(null)
    if (!form.name.trim()) { setError('Name is required.'); return }
    if (!form.locationCode) { setError('Location is required.'); return }
    const locationName = workshops.find((w) => w.locCode === form.locationCode)?.locName ?? null
    setBusy(true)
    try {
      if (form.id) {
        await staffApi.put(`/api/technicians/${form.id}`, { name: form.name.trim(), locationCode: form.locationCode, locationName })
      } else {
        await staffApi.post('/api/technicians', { name: form.name.trim(), locationCode: form.locationCode, locationName })
      }
      resetForm()
      load()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not save this technician.'))
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (t: Technician) => {
    await staffApi.put(`/api/technicians/${t.id}`, { active: !t.active })
    load()
  }

  const remove = async (t: Technician) => {
    if (!window.confirm(`Permanently delete ${t.name}? This cannot be undone - use Deactivate instead if you just want to hide them from the dropdowns.`)) return
    try {
      await staffApi.delete(`/api/technicians/${t.id}`)
      load()
    } catch (err: unknown) {
      window.alert(apiErrorMessage(err, 'Could not delete this technician.'))
    }
  }

  return (
    <div>
      <h2>Technician Employee</h2>
      {/* <p className="muted" style={{ marginTop: -8 }}>
        These technicians appear in the Job Card Wizard's "Technician" dropdown and the Job Card
        Detail page's "Assign Technician" dropdown, scoped to the Location picked below. No
        login/password - this is a name-only roster, not a staff account.
      </p> */}

      {canManage && (
        <div className="card">
          <h3>{form.id ? 'Edit Technician' : 'Add Technician'}</h3>
          <div className="form-row">
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Technician name" />
            </div>
            <div className="field">
              <label>Location</label>
              <select value={form.locationCode} onChange={(e) => setForm({ ...form, locationCode: e.target.value })}>
                <option value="">{workshops.length ? 'Select workshop…' : 'No workshops found for this dealer yet'}</option>
                {workshops.map((w) => <option key={w.locCode} value={w.locCode}>{w.locName} ({w.locCode})</option>)}
              </select>
            </div>
          </div>
          {error && <p className="muted" style={{ color: '#b91c1c' }}>{error}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : form.id ? 'Save Changes' : 'Save'}
            </button>
            {form.id && <button className="btn btn-sm" onClick={resetForm}>Cancel Edit</button>}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 14px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} style={{ width: 'auto' }} />
            Show inactive
          </label>
        </div>
        <table>
          <thead>
            <tr><th>Name</th><th>Location</th><th>Active</th>{canManage && <th></th>}</tr>
          </thead>
          <tbody>
            {technicians.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.locationName ? `${t.locationName} (${t.locationCode})` : t.locationCode}</td>
                <td>{t.active ? 'Yes' : 'No'}</td>
                {canManage && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => editTechnician(t)}>Edit</button>{' '}
                    <button className="btn btn-sm" onClick={() => toggleActive(t)}>{t.active ? 'Deactivate' : 'Activate'}</button>{' '}
                    <button className="btn btn-sm" style={{ color: '#b91c1c' }} onClick={() => remove(t)}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
            {technicians.length === 0 && (
              <tr><td colSpan={canManage ? 4 : 3} className="muted">No technicians yet{canManage ? ' - add one above.' : '.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
