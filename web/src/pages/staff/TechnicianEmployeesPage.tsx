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
 *
 * 2026-10-03 ("add filter for search technician and dropdown of location"): a name search box and
 * a Location dropdown sit above the list table - see the two pieces of state below their own doc
 * comment for which is server-side vs. client-side.
 *
 * 2026-10-03 follow-up ("enhance this page add 1 button Add Technician ... then open this
 * atrractive page"): the always-visible Add/Edit card is replaced with a single "+ Add Technician"
 * button in the page header, which opens a styled modal panel (colored icon header, rounded card,
 * backdrop) instead of a plain inline form. The same modal is reused for Edit (clicking a row's
 * Edit button opens it pre-filled) - editTechnician/resetForm below are unchanged in what they do,
 * they just also toggle the modal open/closed now.
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
  // 2026-10-03 ("add filter for search technician and dropdown of location"): locationFilter is
  // sent to the backend (GET /api/technicians?locationCode=... - the same param
  // JobCardDetailPage.tsx's own Assign Technician dropdown already uses to scope its fetch), so
  // the list is narrowed server-side. search stays client-side only (no confirmed backend
  // text-search param for this endpoint) - filtered below, right before rendering the table.
  const [locationFilter, setLocationFilter] = useState('')
  const [search, setSearch] = useState('')
  const load = () => staffApi.get<Technician[]>('/api/technicians', { params: { includeInactive, locationCode: locationFilter || undefined } }).then((r) => setTechnicians(r.data))
  useEffect(() => { load() }, [includeInactive, locationFilter])
  const visibleTechnicians = technicians.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()))

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
  // 2026-10-03 - drives the Add/Edit modal below. Opening it fresh (the header button) just sets
  // this true on top of emptyTechnicianForm; editTechnician (table row) sets the form THEN opens
  // it, so the same modal serves both.
  const [showModal, setShowModal] = useState(false)

  const openAddModal = () => { setForm(emptyTechnicianForm); setError(null); setShowModal(true) }
  const closeModal = () => { setShowModal(false); setForm(emptyTechnicianForm); setError(null) }

  const editTechnician = (t: Technician) => {
    setForm({ id: t.id, name: t.name, locationCode: t.locationCode })
    setError(null)
    setShowModal(true)
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
      closeModal()
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Technician Employee</h2>
        {canManage && (
          <button className="btn btn-primary" onClick={openAddModal}>
            + Add Technician
          </button>
        )}
      </div>
      <br />
      {/* <p className="muted" style={{ marginTop: -8 }}>
        These technicians appear in the Job Card Wizard's "Technician" dropdown and the Job Card
        Detail page's "Assign Technician" dropdown, scoped to the Location picked below. No
        login/password - this is a name-only roster, not a staff account.
      </p> */}

      <div className="card" style={{ padding: 0 }}>
        {/* 2026-10-03 - search by name + Location dropdown, above the Show-inactive toggle row. */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: '12px 14px 0' }}>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
            <label>Search Technician</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" />
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
            <label>Location</label>
            <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <option value="">All locations</option>
              {workshops.map((w) => <option key={w.locCode} value={w.locCode}>{w.locName} ({w.locCode})</option>)}
            </select>
          </div>
        </div>
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
            {visibleTechnicians.map((t) => (
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
            {visibleTechnicians.length === 0 && (
              <tr><td colSpan={canManage ? 4 : 3} className="muted">
                {technicians.length === 0 ? `No technicians yet${canManage ? ' - add one above.' : '.'}` : 'No technicians match this search/filter.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 2026-10-03 ("then open this atrractive page") - a self-contained modal overlay (no shared
          modal component confirmed in this session, so built inline rather than guessed) for both
          Add and Edit, replacing the old always-visible inline form card. Closing via backdrop
          click, the ✕ button, or a successful Save all route through closeModal/save above. */}
      {showModal && (
        <div
          role="presentation"
          onClick={closeModal}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 440, background: 'var(--surface, #fff)', borderRadius: 14,
              boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)', overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '16px 20px', background: 'linear-gradient(135deg, var(--primary, #2563eb), var(--primary-dark, #1d4ed8))',
                color: '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>🧑‍🔧</span>
                <h3 style={{ margin: 0, color: '#fff' }}>{form.id ? 'Edit Technician' : 'Add Technician'}</h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                style={{
                  background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 8,
                  width: 28, height: 28, cursor: 'pointer', fontSize: 15, lineHeight: 1,
                }}
              >✕</button>
            </div>

            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Technician name"
                  autoFocus
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Location</label>
                <select value={form.locationCode} onChange={(e) => setForm({ ...form, locationCode: e.target.value })}>
                  <option value="">{workshops.length ? 'Select workshop…' : 'No workshops found for this dealer yet'}</option>
                  {workshops.map((w) => <option key={w.locCode} value={w.locCode}>{w.locName} ({w.locCode})</option>)}
                </select>
              </div>

              {error && <p className="muted" style={{ color: '#b91c1c', margin: 0 }}>{error}</p>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                <button className="btn btn-sm" onClick={closeModal} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" disabled={busy} onClick={save}>
                  {busy ? 'Saving…' : form.id ? 'Save Changes' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}