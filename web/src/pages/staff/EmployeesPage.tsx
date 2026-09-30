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
 * 2026-09-18: removed the separate "Dealer" picker (`hasRole('CorporateAdmin', 'SystemAdmin')` is
 * still exactly the gate that decides which mode applies, it just no longer feeds a dropdown) -
 * a DealerAdmin still only ever sees/assigns their OWN dealer's W1..Wn locations (unchanged,
 * `profile.dealerId` decides that automatically, no field needed), while Corporate/System Admin
 * now see and can pick from EVERY dealer's workshop locations directly in Work Area (GET
 * /api/bapl-dms/workshops with no dealerId param - already built for exactly this, see its doc
 * comment: "Omit dealerId to search every dealer's workshops by name/code (q)"). Since Work Area
 * can now span more than one dealer for a Corporate/System-Admin-created employee, DealerId on
 * that User row is left null/unscoped (shown as "All" in the grid, same convention already used
 * there) rather than picking one dealer arbitrarily - Work Area's LocCodes, not DealerId, are what
 * every enforcement point (JobCardsController, DmsBaplDataController) actually checks, so this
 * costs nothing functionally.
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

const DESIGNATIONS = ['Captain', 'Technician', 'Vice Captain'] as const
type Designation = typeof DESIGNATIONS[number]

const emptyEmployeeForm = {
  id: null as string | null, // set when editing an existing row, null when creating
  name: '', email: '', password: '', mobile: '',
  state: '', city: '', pincode: '', dateOfJoining: '',
  designation: '' as '' | Designation,
  dealerId: '',
  workLocationCodes: [] as string[],
}

const apiErrorMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback

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

  // Work Area checkbox list - the SAME endpoint Parts & Inventory / Material Transfer already use.
  // Corporate/System Admin get EVERY dealer's workshop locations at once (no dealerId param - see
  // this endpoint's own doc comment); anyone else only ever sees their own dealer's, exactly like
  // before, just without a picker since there was never a real choice to make for them.
  useEffect(() => {
    if (!isCorporateOrSystem && !profile?.dealerId) { setEmployeeWorkshops([]); return }
    setEmployeeWorkshopsLoading(true)
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: isCorporateOrSystem ? {} : { dealerId: profile?.dealerId } })
      .then((r) => setEmployeeWorkshops(r.data))
      .catch(() => setEmployeeWorkshops([]))
      .finally(() => setEmployeeWorkshopsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCorporateOrSystem, profile?.dealerId])

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
  const clearAllWorkLocations = () => setEmployeeForm((f) => ({ ...f, workLocationCodes: [] }))

  const resetEmployeeForm = () => { setEmployeeForm(emptyEmployeeForm); setLocSearch(''); setEmployeeError(null) }

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
      dealerId: u.dealerId ?? '',
      workLocationCodes: u.workLocationCodes,
    })
    setLocSearch('')
    setEmployeeError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
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
    // Admin have no dealer field anymore - a brand-new employee is left dealer-unscoped (null,
    // shown as "All" in the grid; Work Area's LocCodes are what actually gate their access, not
    // this field), while editing an EXISTING employee round-trips whatever dealerId that row
    // already had rather than clearing it.
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
      resetEmployeeForm()
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

  // 2026-09-18 "Grid" view: a per-row "View" button that expands that one employee's full saved
  // details inline (Name, Email, Designation, Dealer, City/State, Work Area, Active) - the grid
  // row itself only has room for a Work Area *count* ("2 locations"), so this is where the actual
  // location names/codes are shown in full, resolved via employeeWorkshops (already fetched above
  // for the Add/Edit card - covers every dealer's workshops for Corporate/System Admin, or just
  // this admin's own dealer's otherwise, which is always enough to resolve any employee row this
  // admin can see).
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const workshopNameByCode = new Map(employeeWorkshops.map((w) => [w.locCode, w.locName]))

  return (
    <div>
      <h2>Employees</h2>

      <div className="card">
        <h3>{employeeForm.id ? 'Edit Employee' : 'Add Employee'}</h3>
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
            {/* No verified India city/pincode master exists in this codebase (see User.State's doc
                comment in MasterData.cs) - City is a free-text/typeahead field, not a dropdown
                dependent on State, and Pincode below is entered separately rather than derived. */}
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
        </div>

        <div className="field">
          <label>Work Area{employeeWorkshopsLoading ? ' (loading…)' : ''}</label>
          <p className="muted" style={{ marginTop: -2 }}>
            {isCorporateOrSystem
              ? 'Every dealer\'s workshop locations - search by dealer or location name/code below.'
              : 'Your dealer\'s workshop locations.'}
          </p>
          {!employeeWorkshopsLoading && employeeWorkshops.length === 0 && (
            <p className="muted">No DMS workshop locations on file yet.</p>
          )}
          {employeeWorkshops.length > 0 && (
            // overflow: hidden here (in addition to overflowX: hidden on the scrolling list below)
            // is a deliberate belt-and-braces fix for the horizontal-scrollbar bug reported on this
            // box - the checkbox list's overflowY: 'auto' alone causes some browsers to compute
            // overflow-x as 'auto' too per the CSS overflow spec (any axis left at its 'visible'
            // default becomes 'auto' once the other axis is set to a scrolling value), so a
            // scrollbar could appear even for content that only barely overflows sideways.
            <div style={{ border: '1px solid var(--border, #d1d5db)', borderRadius: 6, padding: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button type="button" className="btn btn-sm" onClick={selectAllWorkLocations}>Select All</button>
                <button type="button" className="btn btn-sm" onClick={clearAllWorkLocations}>Clear All</button>
                <input style={{ flex: '1 1 180px', minWidth: 140, width: 'auto' }} placeholder="Search Group" value={locSearch} onChange={(e) => setLocSearch(e.target.value)} />
                <span className="muted" style={{ whiteSpace: 'nowrap' }}>{employeeForm.workLocationCodes.length} of {employeeWorkshops.length} selected</span>
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
        </div>

        <div className="form-row">
          <div className="field"><label>Email/Login Id.</label><input value={employeeForm.email} disabled={!!employeeForm.id} onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })} /></div>
          <div className="field">
            <label>Password{employeeForm.id ? ' (leave blank to keep unchanged)' : ''}</label>
            <input type="password" value={employeeForm.password} onChange={(e) => setEmployeeForm({ ...employeeForm, password: e.target.value })} />
          </div>
        </div>

        {employeeError && <p className="muted" style={{ color: '#b91c1c' }}>{employeeError}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-primary" disabled={employeeBusy} onClick={saveEmployee}>
            {employeeBusy ? 'Saving…' : employeeForm.id ? 'Save Changes' : 'Save'}
          </button>
          {employeeForm.id && <button className="btn btn-sm" onClick={resetEmployeeForm}>Cancel Edit</button>}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Designation</th><th>Dealer</th>
              <th>City / State</th><th>Work Area</th><th>Active</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Fragment key={u.id}>
                <tr>
                  <td>{u.name}</td><td>{u.email}</td><td>{u.designation ?? '-'}</td><td>{u.dealerName ?? 'All'}</td>
                  <td>{[u.city, u.state].filter(Boolean).join(', ') || '-'}</td>
                  <td>{u.workLocationCodes.length > 0 ? `${u.workLocationCodes.length} location${u.workLocationCodes.length === 1 ? '' : 's'}` : 'All'}</td>
                  <td>{u.active ? 'Yes' : 'No'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => editEmployee(u)}>Edit</button>{' '}
                    <button className="btn btn-sm" onClick={() => toggleActive(u)}>{u.active ? 'Deactivate' : 'Activate'}</button>{' '}
                    <button className="btn btn-sm" style={{ color: '#b91c1c' }} onClick={() => deleteEmployee(u)}>Delete</button>{' '}
                    {/* 2026-09-18: icon-only "Grid" toggle (see .btn-icon in global.css), matched
                        against your reference screenshot's own Grid button - expands/collapses
                        the full-detail row below, same behavior as the old text "View"/"Hide"
                        button this replaces. */}
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
                    <td colSpan={8} style={{ background: 'var(--bg-muted, #f9fafb)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '6px 24px', padding: '10px 4px' }}>
                        <div><strong>Name:</strong> {u.name}</div>
                        <div><strong>Email:</strong> {u.email}</div>
                        <div><strong>Designation:</strong> {u.designation ?? '-'}</div>
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
            {users.length === 0 && (
              <tr><td colSpan={8} className="muted">No employees yet - add one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
