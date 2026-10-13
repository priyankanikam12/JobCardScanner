// web\src\pages\staff\EmployeesPage.tsx
import { Fragment, useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsWorkshop, StaffRole } from '../../types'

/**
 * "Employees" page (2026-09-17, split out of Admin: Users into its own sidebar entry after
 * feedback that the inline "Add Employee" card on that page rendered with an unwanted horizontal
 * scrollbar inside the Work Area box and oversized Select All/Clear All buttons - both traced to
 * reusing the shared `.form-row` CSS-grid class for what should have been a plain button toolbar,
 * a grid column stretches every child to a 200px+ minimum width, which is right for label+input
 * pairs but wrong for a row of small buttons - see the Work Area toolbar below, which now uses an
 * explicit flex layout instead). Giving this its own page also means it no longer competes for
 * space with Admin: Users' four other cards (Azure AD sync, BAPL bulk import, DMS Logins, the
 * manual Azure-AD add form), and its own grid only needs to show the fields this page manages.
 *
 * Route guard: DealerAdmin/CorporateAdmin/SystemAdmin (see App.tsx + StaffLayout.tsx) - the same
 * DealerAdminUp floor UsersController's API already enforces, so a Dealer Admin can now actually
 * reach this to manage their own dealer's employees. This does NOT touch Admin: Users' own
 * CorporateAdmin/SystemAdmin-only restriction - that page's bulk/HQ tools are untouched.
 *
 * 2026-09-18: removed the separate "Dealer" picker - a DealerAdmin only ever sees/assigns their OWN
 * dealer's W1..Wn locations (`profile.dealerId` decides that automatically), while Corporate/System
 * Admin saw EVERY dealer's workshop locations at once (GET /api/bapl-dms/workshops with no dealerId).
 * DealerId on a Corporate/System-Admin-created employee is left null/unscoped (shown as "All" in the
 * grid) - Work Area's LocCodes, not DealerId, are what every enforcement point (JobCardsController,
 * DmsBaplDataController) actually checks.
 *
 * 2026-10-03 ("from this employees page also ui like technician-employees ... from Designation
 * hide mechanic and in that also filter add location and search"): matches
 * TechnicianEmployeesPage.tsx's pattern - Add/Edit in a styled modal, a Search box (name/email,
 * client-side) and a Location dropdown (client-side, against each row's workLocationCodes), and
 * 'Mechanic' removed from DESIGNATIONS (an employee already saved with it keeps it in the database).
 *
 * 2026-10-13 ("for edit and create in that also Work Area ... No DMS workshop locations on file yet ...
 * not showing which location have that dealer, shown in tick"): for CorporateAdmin / SystemAdmin the
 * Work Area list was loaded with NO dealerId - and GET /api/bapl-dms/workshops without a dealerId is
 * the "search every dealer by name/code (q)" mode, so with no search text it came back empty and the
 * box said "No DMS workshop locations on file yet." Now Corporate / System Admin pick a DEALER first
 * (a Dealer dropdown above the list, only dealers with a DMS dealer code) and that dealer's own W1..Wn
 * locations are listed with tick boxes - the call the Job Card page and a dealer login already use.
 * Locations ticked for one dealer stay ticked when another dealer is picked (an employee can work in
 * several dealers), and the count says how many are selected in total. When editing, the dealer is
 * preselected from the employee's own dealer, or from the dealer code in their first saved location
 * (CUS0288W4 -> CUS0288). A dealer login is unchanged (its own dealer's locations, no picker).
 * A failed or empty list now says so (with the HTTP status) instead of looking like "none on file".
 * Also: the browser's password autofill is switched off on the Email / Password boxes (it was filling
 * the signed-in user's own saved password into an employee's Password), and server validation errors
 * ({ errors: { Field: [...] } }) are shown instead of the generic "Could not save this employee."
 */

interface StaffUser {
  id: string
  name: string
  email: string
  mobile?: string
  role: StaffRole
  dealerId?: string | null
  dealerName?: string
  active: boolean
  state?: string | null
  city?: string | null
  pincode?: string | null
  dateOfJoining?: string | null
  designation?: string | null
  workLocationCodes: string[]
}

/** A dealer offered in the Work Area dealer picker (GET /api/dealers) - only those with a DMS dealer code have workshops. */
interface WorkDealer {
  id: string
  name: string
  code?: string
  baplDmsDealerCode?: string | null
}

// Fixed reference list (28 states + 8 union territories) - deliberately NOT sourced from any
// database, since no verified India state/city/pincode master exists anywhere in this codebase or
// its connected databases (see User.WorkLocationCodes/State doc comments in MasterData.cs).
const INDIA_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
]

// 2026-10-03 ("hide mechanic"): 'Mechanic' removed from the selectable list - see this file's own
// top-of-file doc comment for what that does/doesn't affect for an employee already saved with it.
const DESIGNATIONS = ['Supervisor', 'Captain', 'ViceCaptain', 'Technician'] as const
type Designation = typeof DESIGNATIONS[number]

const emptyEmployeeForm = {
  id: null as string | null, // set when editing an existing row, null when creating
  name: '', email: '', password: '', mobile: '',
  state: '', city: '', pincode: '', dateOfJoining: '',
  designation: '' as '' | Designation,
  // 2026-10-01 ("which designation update that role also want that add in page to update"):
  // READ-ONLY - the already-saved Role for the employee being edited (u.role, from GET
  // /api/users), shown next to Designation so you can see what Role this person actually has.
  // This is NOT an editable field and is never sent back to the server - Role is still only ever
  // set by the backend's own Designation -> Role mapping (UsersController), per the existing
  // placeholder/doc comments in saveEmployee() below. Blank while creating a new employee.
  role: '' as StaffRole | '',
  dealerId: '',
  workLocationCodes: [] as string[],
}

// 2026-10-13: also reads ASP.NET validation answers ({ title, errors: { Field: [messages] } } with no "message")
// and shows the HTTP status when the server sent nothing readable, instead of only the generic fallback.
const apiErrorMessage = (err: unknown, fallback: string): string => {
  const res = (err as { response?: { status?: number; data?: { message?: string; title?: string; errors?: Record<string, string[]> } } })?.response
  const d = res?.data
  if (d?.message) return d.message
  if (d?.errors) {
    const all = Object.entries(d.errors).flatMap(([f, m]) => m.map((x) => `${f}: ${x}`))
    if (all.length) return all.join(' ')
  }
  if (d?.title) return d.title
  return res?.status ? `${fallback} (HTTP ${res.status})` : fallback
}

export function EmployeesPage() {
  const { profile, hasRole } = useStaffAuth()
  const [users, setUsers] = useState<StaffUser[]>([])
  const load = () => staffApi.get<StaffUser[]>('/api/users').then((r) => setUsers(r.data))
  useEffect(() => { load() }, [])

  const isCorporateOrSystem = hasRole('CorporateAdmin', 'SystemAdmin')

  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm)
  const [employeeWorkshops, setEmployeeWorkshops] = useState<BaplDmsWorkshop[]>([])
  const [employeeWorkshopsLoading, setEmployeeWorkshopsLoading] = useState(false)
  const [locSearch, setLocSearch] = useState('')
  const [employeeError, setEmployeeError] = useState<string | null>(null)
  const [employeeBusy, setEmployeeBusy] = useState(false)
  // 2026-10-03 ("then open this atrractive page", matching TechnicianEmployeesPage.tsx) - drives
  // the Add/Edit modal below. Opening it fresh (the header button) resets the form first;
  // editEmployee (table row) fills the form then opens it, so the same modal serves both.
  const [showModal, setShowModal] = useState(false)

  // 2026-10-13: Corporate / System Admin pick a dealer, and that dealer's own workshop locations are listed. workDealerId is the picked
  // dealer (local Dealer id); knownWorkshops remembers every location name loaded so far (code -> name), so a location ticked for one
  // dealer still shows its name after another dealer is picked, in the grid's expanded row, and in the table's Location filter.
  const [workDealers, setWorkDealers] = useState<WorkDealer[]>([])
  const [workDealerId, setWorkDealerId] = useState('')
  const [workshopsError, setWorkshopsError] = useState<string | null>(null)
  const [knownWorkshops, setKnownWorkshops] = useState<Record<string, string>>({})

  // Dealers offered in the picker: only those with a DMS dealer code (a dealer without one has no workshops to list).
  useEffect(() => {
    if (!isCorporateOrSystem) return
    staffApi.get<WorkDealer[]>('/api/dealers')
      .then(({ data }) => setWorkDealers(data.filter((d) => !!d.baplDmsDealerCode).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setWorkDealers([]))
  }, [isCorporateOrSystem])

  // Work Area checkbox list - the SAME call the Job Card page and Parts / Material Transfer use: GET /api/bapl-dms/workshops?dealerId=...
  // A dealer login gets its own dealer's locations; Corporate / System Admin get the dealer picked above (nothing until one is picked).
  const workshopsDealerId = isCorporateOrSystem ? workDealerId : (profile?.dealerId ?? '')
  useEffect(() => {
    setWorkshopsError(null)
    if (!workshopsDealerId) { setEmployeeWorkshops([]); return }
    setEmployeeWorkshopsLoading(true)
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: workshopsDealerId } })
      .then((r) => {
        setEmployeeWorkshops(r.data)
        setKnownWorkshops((prev) => {
          const next = { ...prev }
          r.data.forEach((w) => { next[w.locCode] = w.locName })
          return next
        })
      })
      .catch((err: unknown) => {
        setEmployeeWorkshops([])
        setWorkshopsError(apiErrorMessage(err, 'Could not load the workshop locations from DMS.'))
      })
      .finally(() => setEmployeeWorkshopsLoading(false))
  }, [workshopsDealerId])

  const filteredWorkshops = employeeWorkshops.filter((w) =>
    !locSearch || w.locName.toLowerCase().includes(locSearch.toLowerCase()) || w.locCode.toLowerCase().includes(locSearch.toLowerCase()))

  const toggleWorkLocation = (locCode: string) => {
    setEmployeeForm((f) => ({
      ...f,
      workLocationCodes: f.workLocationCodes.includes(locCode)
        ? f.workLocationCodes.filter((c) => c !== locCode)
        : [...f.workLocationCodes, locCode],
    }))
  }
  const selectAllWorkLocations = () => setEmployeeForm((f) => ({ ...f, workLocationCodes: Array.from(new Set([...f.workLocationCodes, ...employeeWorkshops.map((w) => w.locCode)])) }))
  // Clears only the locations of the dealer shown - ones ticked for other dealers stay (see this file's 2026-10-13 note).
  const clearAllWorkLocations = () => setEmployeeForm((f) => {
    const listed = new Set(employeeWorkshops.map((w) => w.locCode))
    return { ...f, workLocationCodes: f.workLocationCodes.filter((c) => !listed.has(c)) }
  })

  // The dealer a set of saved locations belongs to, read from the dealer code in the first one (CUS0288W4 -> CUS0288).
  const dealerIdForLocationCodes = (codes: string[]) => {
    const first = codes[0]
    if (!first) return ''
    const prefix = first.replace(/W\d+$/i, '').toUpperCase()
    return workDealers.find((d) => (d.baplDmsDealerCode ?? '').toUpperCase() === prefix)?.id ?? ''
  }

  const openAddModal = () => {
    setEmployeeForm(emptyEmployeeForm); setLocSearch(''); setEmployeeError(null)
    if (isCorporateOrSystem) setWorkDealerId('')
    setShowModal(true)
  }
  const resetEmployeeForm = () => { setEmployeeForm(emptyEmployeeForm); setLocSearch(''); setEmployeeError(null) }
  const closeModal = () => { setShowModal(false); resetEmployeeForm() }

  const editEmployee = (u: StaffUser) => {
    setEmployeeForm({
      id: u.id,
      name: u.name,
      email: u.email,
      password: '', // never pre-filled - Update only changes it when non-empty, see UsersController
      mobile: u.mobile ?? '',
      state: u.state ?? '',
      city: u.city ?? '',
      pincode: u.pincode ?? '',
      dateOfJoining: u.dateOfJoining ? u.dateOfJoining.slice(0, 10) : '',
      designation: (u.designation as Designation) ?? '',
      role: u.role,
      dealerId: u.dealerId ?? '',
      workLocationCodes: u.workLocationCodes,
    })
    if (isCorporateOrSystem) setWorkDealerId(u.dealerId || dealerIdForLocationCodes(u.workLocationCodes))
    setLocSearch('')
    setEmployeeError(null)
    setShowModal(true)
  }

  const saveEmployee = async () => {
    setEmployeeError(null)
    if (!employeeForm.name || !employeeForm.email) { setEmployeeError('Employee Name and Email/Login Id are required.'); return }
    if (!employeeForm.id && !employeeForm.password) { setEmployeeError('Password is required to create a new employee login.'); return }
    if (!isCorporateOrSystem && !profile?.dealerId) { setEmployeeError('Your account has no dealer assigned - contact a System Admin.'); return }
    if (!employeeForm.designation) { setEmployeeError('Select a Designation.'); return }
    // Mobile No. - 10 digits, matching standard Indian mobile number length. Optional field, but
    // if something was entered it must be exactly 10 digits - the input itself already strips
    // non-digits and caps length at 10 (see onChange below), so this only trips if fewer than 10
    // digits were entered.
    if (employeeForm.mobile && employeeForm.mobile.length !== 10) { setEmployeeError('Mobile No. must be exactly 10 digits.'); return }

    // Non-corporate admins always create/edit under their own dealer (unchanged). Corporate/System
    // Admin: a brand-new employee is left dealer-unscoped (null, shown as "All" in the grid; Work
    // Area's LocCodes are what actually gate their access, not this field), while editing an
    // EXISTING employee round-trips whatever dealerId that row already had rather than clearing it.
    // (The Dealer picker in Work Area only chooses which dealer's locations to LIST - it does not set this.)
    const dealerIdToSend = isCorporateOrSystem ? (employeeForm.dealerId || null) : profile!.dealerId

    setEmployeeBusy(true)
    try {
      if (employeeForm.id) {
        await staffApi.put(`/api/users/${employeeForm.id}`, {
          name: employeeForm.name,
          mobile: employeeForm.mobile || null,
          dealerId: dealerIdToSend,
          state: employeeForm.state || null,
          city: employeeForm.city || null,
          pincode: employeeForm.pincode || null,
          dateOfJoining: employeeForm.dateOfJoining || null,
          designation: employeeForm.designation,
          workLocationCodes: employeeForm.workLocationCodes,
          ...(employeeForm.password ? { password: employeeForm.password } : {}),
        })
      } else {
        await staffApi.post('/api/users', {
          name: employeeForm.name,
          email: employeeForm.email,
          mobile: employeeForm.mobile || null,
          role: 'ServiceAdvisor', // placeholder - the backend maps Designation -> the real Role (see UsersController.RoleForDesignation)
          dealerId: dealerIdToSend,
          authType: 'Local',
          password: employeeForm.password,
          state: employeeForm.state || null,
          city: employeeForm.city || null,
          pincode: employeeForm.pincode || null,
          dateOfJoining: employeeForm.dateOfJoining || null,
          designation: employeeForm.designation,
          workLocationCodes: employeeForm.workLocationCodes,
        })
      }
      closeModal()
      load()
    } catch (err: unknown) {
      setEmployeeError(apiErrorMessage(err, 'Could not save this employee.'))
    } finally {
      setEmployeeBusy(false)
    }
  }

  const deleteEmployee = async (u: StaffUser) => {
    if (!window.confirm(`Permanently delete ${u.name} (${u.email})? This cannot be undone - use Deactivate instead if you just want to disable their login.`)) return
    try {
      await staffApi.delete(`/api/users/${u.id}`)
      load()
    } catch (err: unknown) {
      window.alert(apiErrorMessage(err, 'Could not delete this user.'))
    }
  }

  const toggleActive = async (u: StaffUser) => {
    await staffApi.put(`/api/users/${u.id}`, { active: !u.active })
    load()
  }

  // 2026-09-18 "Grid" view: a per-row button that expands that one employee's full saved details
  // inline - the grid row itself only has room for a Work Area *count*, so this is where the actual
  // location names/codes are shown in full, resolved via knownWorkshops (every location name loaded so far).
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const workshopNameByCode = new Map(Object.entries(knownWorkshops))

  // 2026-10-03 ("add filter add location and search"): Search is client-side (name or email);
  // Location is also client-side - it filters against each row's own workLocationCodes array. A user
  // with an empty workLocationCodes ("All (unrestricted)") never matches a specific location filter.
  // 2026-10-13: the Location options are every location loaded so far PLUS every code any listed employee
  // already has (so a Corporate / System Admin, whose list is loaded dealer by dealer, can still filter by them).
  const [search, setSearch] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const locationFilterOptions = Array.from(new Set([...Object.keys(knownWorkshops), ...users.flatMap((u) => u.workLocationCodes)])).sort()
  const visibleUsers = users.filter((u) => {
    const matchesSearch = !search.trim()
      || u.name.toLowerCase().includes(search.trim().toLowerCase())
      || u.email.toLowerCase().includes(search.trim().toLowerCase())
    const matchesLocation = !locationFilter || u.workLocationCodes.includes(locationFilter)
    return matchesSearch && matchesLocation
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Dealer Employees</h2>
        <button className="btn btn-primary" onClick={openAddModal}>
          + Add Employee
        </button>
      </div>
      <br/>

      <div className="card" style={{ padding: 0 }}>
        {/* 2026-10-03 - search by name/email + Location dropdown, matching
            TechnicianEmployeesPage.tsx's placement/pattern. */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: '14px 14px 0' }}>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
            <label>Search Employee</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email…" />
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
            <label>Location</label>
            <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <option value="">All locations</option>
              {locationFilterOptions.map((code) => (
                <option key={code} value={code}>{knownWorkshops[code] ? `${knownWorkshops[code]} (${code})` : code}</option>
              ))}
            </select>
          </div>
        </div>
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Designation</th><th>Role</th><th>Dealer</th>
              <th>City / State</th><th>Work Area</th><th>Active</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((u) => (
              <Fragment key={u.id}>
                <tr>
                  <td>{u.name}</td><td>{u.email}</td><td>{u.designation ?? '-'}</td><td>{u.role}</td><td>{u.dealerName ?? 'All'}</td>
                  <td>{[u.city, u.state].filter(Boolean).join(', ') || '-'}</td>
                  <td>{u.workLocationCodes.length > 0 ? `${u.workLocationCodes.length} location${u.workLocationCodes.length === 1 ? '' : 's'}` : 'All'}</td>
                  <td>{u.active ? 'Yes' : 'No'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => editEmployee(u)}>Edit</button>{' '}
                    <button className="btn btn-sm" onClick={() => toggleActive(u)}>{u.active ? 'Deactivate' : 'Activate'}</button>{' '}
                    <button className="btn btn-sm" style={{ color: '#b91c1c' }} onClick={() => deleteEmployee(u)}>Delete</button>{' '}
                    {/* 2026-09-18: icon-only "Grid" toggle (see .btn-icon in global.css) - expands/collapses
                        the full-detail row below. */}
                    <button
                      className={`btn btn-sm btn-icon ${expandedId === u.id ? 'btn-primary' : ''}`}
                      title={expandedId === u.id ? 'Hide saved data' : 'View saved data'}
                      aria-label={expandedId === u.id ? 'Hide saved data' : 'View saved data'}
                      onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                    >
                      ▦
                    </button>
                  </td>
                </tr>
                {expandedId === u.id && (
                  <tr>
                    <td colSpan={9} style={{ background: 'var(--bg-muted, #f9fafb)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '6px 24px', padding: '10px 4px' }}>
                        <div><strong>Name:</strong> {u.name}</div>
                        <div><strong>Email:</strong> {u.email}</div>
                        <div><strong>Designation:</strong> {u.designation ?? '-'}</div>
                        <div><strong>Role:</strong> {u.role}</div>
                        <div><strong>Dealer:</strong> {u.dealerName ?? 'All'}</div>
                        <div><strong>City/State:</strong> {[u.city, u.state].filter(Boolean).join(', ') || '-'}</div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <strong>Work Area:</strong>{' '}
                          {u.workLocationCodes.length === 0
                            ? 'All (unrestricted)'
                            : u.workLocationCodes.map((code) => workshopNameByCode.get(code) ? `${workshopNameByCode.get(code)} (${code})` : code).join(', ')}
                        </div>
                        <div><strong>Active:</strong> {u.active ? 'Yes' : 'No'}</div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {visibleUsers.length === 0 && (
              <tr><td colSpan={9} className="muted">
                {users.length === 0 ? 'No employees yet - add one above.' : 'No employees match this search/filter.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 2026-10-03 ("then open this atrractive page", matching TechnicianEmployeesPage.tsx) - the
          same Add/Edit form, now inside a styled modal instead of an always-visible inline card. */}
      {showModal && (
        <div
          role="presentation"
          onClick={closeModal}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
            overflowY: 'auto',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto',
              background: 'var(--surface, #fff)', borderRadius: 14,
              boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
            }}
          >
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '16px 20px', background: 'linear-gradient(135deg, var(--primary, #2563eb), var(--primary-dark, #1d4ed8))',
                color: '#fff', position: 'sticky', top: 0, zIndex: 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>👤</span>
                <h3 style={{ margin: 0, color: '#fff' }}>{employeeForm.id ? 'Edit Employee' : 'Add Employee'}</h3>
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

            <div style={{ padding: 20 }}>
              <div className="form-row">
                <div className="field"><label>Employee Name</label><input value={employeeForm.name} onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })} /></div>
                <div className="field">
                  <label>State</label>
                  <select value={employeeForm.state} onChange={(e) => setEmployeeForm({ ...employeeForm, state: e.target.value })}>
                    <option value="">--Select State--</option>
                    {INDIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>City</label>
                  <input list="employee-city-options" value={employeeForm.city} onChange={(e) => setEmployeeForm({ ...employeeForm, city: e.target.value })} placeholder="Type to search / enter city" />
                  {/* No verified India city/pincode master exists in this codebase (see
                      User.State's doc comment in MasterData.cs) - City is a free-text/typeahead
                      field, not a dropdown dependent on State, and Pincode below is entered
                      separately rather than derived. */}
                  <datalist id="employee-city-options" />
                </div>
                <div className="field">
                  <label>Pincode</label>
                  <input value={employeeForm.pincode} onChange={(e) => setEmployeeForm({ ...employeeForm, pincode: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) })} placeholder="6-digit PIN" maxLength={6} inputMode="numeric" />
                </div>
              </div>
              <div className="form-row">
                <div className="field">
                  <label>Mobile No.</label>
                  <input
                    value={employeeForm.mobile}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, mobile: e.target.value.replace(/[^0-9]/g, '').slice(0, 10) })}
                    placeholder="10-digit mobile number"
                    maxLength={10}
                    inputMode="numeric"
                  />
                </div>
                <div className="field"><label>DOJ</label><input type="date" value={employeeForm.dateOfJoining} onChange={(e) => setEmployeeForm({ ...employeeForm, dateOfJoining: e.target.value })} /></div>
                <div className="field">
                  <label>Designation</label>
                  <select value={employeeForm.designation} onChange={(e) => setEmployeeForm({ ...employeeForm, designation: e.target.value as Designation | '' })}>
                    <option value="">--Select--</option>
                    {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Role</label>
                  {/* Read-only - see the `role` field's doc comment on emptyEmployeeForm above. Not
                      an input: there is nothing here for the admin to pick, this only shows what
                      the backend already assigned from Designation. */}
                  <input value={employeeForm.id ? employeeForm.role : 'Set automatically after saving'} disabled />
                </div>
              </div>

              <div className="field">
                <label>Work Area{employeeWorkshopsLoading ? ' (loading…)' : ''}</label>
                <p className="muted" style={{ marginTop: -2 }}>
                  {isCorporateOrSystem
                    ? 'Pick a dealer, then tick the workshop locations this employee may work in. Locations ticked for other dealers stay ticked.'
                    : 'Your dealer\'s workshop locations.'}
                </p>

                {/* 2026-10-13: Corporate / System Admin choose which dealer's locations to list. */}
                {isCorporateOrSystem && (
                  <div style={{ marginBottom: 8 }}>
                    <select value={workDealerId} onChange={(e) => { setWorkDealerId(e.target.value); setLocSearch('') }}>
                      <option value="">--Select dealer--</option>
                      {workDealers.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}{d.baplDmsDealerCode ? ` (${d.baplDmsDealerCode})` : ''}</option>
                      ))}
                    </select>
                    {workDealers.length === 0 && <p className="muted" style={{ margin: '4px 0 0' }}>No dealers with a DMS dealer code were found.</p>}
                  </div>
                )}

                {isCorporateOrSystem && !workDealerId && (
                  <p className="muted">Select a dealer above to see its workshop locations.</p>
                )}
                {workshopsError && <p className="muted" style={{ color: '#b91c1c' }}>⚠ {workshopsError}</p>}
                {!!workshopsDealerId && !employeeWorkshopsLoading && !workshopsError && employeeWorkshops.length === 0 && (
                  <p className="muted">No DMS workshop locations are on file for this dealer.</p>
                )}
                {employeeWorkshops.length > 0 && (
                  // overflow: hidden here (in addition to overflowX: hidden on the scrolling list
                  // below) is a deliberate belt-and-braces fix for the horizontal-scrollbar bug
                  // reported on this box - the checkbox list's overflowY: 'auto' alone causes some
                  // browsers to compute overflow-x as 'auto' too per the CSS overflow spec.
                  <div style={{ border: '1px solid var(--border, #d1d5db)', borderRadius: 6, padding: 10, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <button type="button" className="btn btn-sm" onClick={selectAllWorkLocations}>Select All</button>
                      <button type="button" className="btn btn-sm" onClick={clearAllWorkLocations}>Clear All</button>
                      <input style={{ flex: '1 1 180px', minWidth: 140, width: 'auto' }} placeholder="Search Group" value={locSearch} onChange={(e) => setLocSearch(e.target.value)} />
                      <span className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {employeeForm.workLocationCodes.filter((c) => employeeWorkshops.some((w) => w.locCode === c)).length} of {employeeWorkshops.length} selected here
                        {isCorporateOrSystem ? `, ${employeeForm.workLocationCodes.length} in total` : ''}
                      </span>
                    </div>
                    <div style={{ maxHeight: 180, overflowY: 'auto', overflowX: 'hidden' }}>
                      {filteredWorkshops.map((w) => (
                        <label key={w.locCode} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                          <input type="checkbox" checked={employeeForm.workLocationCodes.includes(w.locCode)} onChange={() => toggleWorkLocation(w.locCode)} style={{ width: 'auto', flex: '0 0 auto', marginTop: 3 }} />
                          <span style={{ overflowWrap: 'anywhere' }}>{w.locName} <span className="muted">({w.locCode})</span></span>
                        </label>
                      ))}
                      {filteredWorkshops.length === 0 && <p className="muted">No locations match "{locSearch}".</p>}
                    </div>
                  </div>
                )}

                {/* Locations already saved for this employee that are not in the list shown (another dealer's, or the list is empty / failed): still visible, still saved. */}
                {employeeForm.workLocationCodes.some((c) => !employeeWorkshops.some((w) => w.locCode === c)) && (
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
                    Also selected (other dealers): {employeeForm.workLocationCodes
                      .filter((c) => !employeeWorkshops.some((w) => w.locCode === c))
                      .map((c) => (knownWorkshops[c] ? `${knownWorkshops[c]} (${c})` : c)).join(', ')}
                  </p>
                )}
              </div>

              <div className="form-row">
                <div className="field">
                  <label>Email/Login Id.</label>
                  <input value={employeeForm.email} disabled={!!employeeForm.id} autoComplete="off" onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })} />
                </div>
                <div className="field">
                  <label>Password{employeeForm.id ? ' (leave blank to keep unchanged)' : ''}</label>
                  {/* autoComplete="new-password": stops the browser filling the signed-in user's own saved password in here */}
                  <input type="password" name="employee-new-password" autoComplete="new-password" value={employeeForm.password} onChange={(e) => setEmployeeForm({ ...employeeForm, password: e.target.value })} />
                </div>
              </div>

              {employeeError && <p className="muted" style={{ color: '#b91c1c' }}>{employeeError}</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
                <button className="btn btn-sm" onClick={closeModal} disabled={employeeBusy}>Cancel</button>
                <button className="btn btn-primary" disabled={employeeBusy} onClick={saveEmployee}>
                  {employeeBusy ? 'Saving…' : employeeForm.id ? 'Save Changes' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}