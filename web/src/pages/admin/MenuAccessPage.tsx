// web\src\pages\admin\MenuAccessPage.tsx
import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import { NAV_ITEMS } from '../../components/StaffLayout'
import type { StaffRole } from '../../types'

/**
 * "Admin: Menu Access" (2026-09-29, SECTION 155 - "for sidebar menu acces provide page make foe
 * which role which menu wants to shown a every where"). Lets a CorporateAdmin/SystemAdmin change,
 * per sidebar item, which roles can see it - without a code deploy - by writing rows to the new
 * GET/PUT /api/menu-access (see backend/JobCardScanner.Api/Controllers/MenuAccessController.cs).
 *
 * Every row here is one entry from web/src/components/StaffLayout.tsx's own NAV_ITEMS - the exact
 * same list that drives the real sidebar, so this page can never drift out of sync with what pages
 * actually exist (a new page added to NAV_ITEMS automatically gets a row here too, no separate
 * list to maintain).
 *
 * ROLE LIST BELOW is every StaffRole name that has actually appeared in this codebase this
 * session (confirmed via NAV_ITEMS' own `roles` arrays and LabourMasterController.cs's doc
 * comment mentioning "ServiceAdvisor/Technician/PartsUser/Cashier"), PLUS Captain/ViceCaptain
 * added 2026-10-01 per explicit request (see that line's own doc comment just above ALL_ROLES for
 * the naming caveat and what's still needed to make these two real end-to-end) - I don't have your
 * real Models/User.cs or the StaffRole enum's full definition in this session, so if you have a
 * role that hasn't appeared anywhere I've seen, it won't show as a checkbox option here yet. Tell
 * me the missing name(s) and I'll add them - a one-line change.
 *
 * "Restrict to specific roles" toggle OFF (the default for any item that has no override saved
 * yet) means "everyone" - matching NAV_ITEMS' own convention of roles being left undefined.
 * Turning it ON reveals the checkboxes and starts from that item's CURRENT effective roles (the
 * saved override if one exists, otherwise the shipped code default) so you're editing from what's
 * actually in effect right now, not a blank slate.
 *
 * SECTION 170 (2026-09-30) "menu assign page fix which sidebar access provide oinly that shown in
 * sidebar other dont need to see only give 3 sidebar menu acess only in sidebar this 3 option" -
 * added the "Role Sidebar Mode" panel below the per-item table. The per-item table above is
 * unchanged and still works exactly as it always did (fail-open: unrestricted unless you say
 * otherwise). The NEW panel adds a per-ROLE toggle, backed by GET/PUT /api/menu-access/role-modes
 * (Models/RoleMenuMode.cs): turning "Only show checked items" ON for a role flips that role from
 * fail-open to an allow-list - it will then see ONLY the items you've explicitly checked for it in
 * the table above (including any item currently set to "everyone" - that no longer includes an
 * allow-listed role once its toggle is on), and any brand new page added later stays hidden from
 * that role until you explicitly check it too. This is the fix for "only give 3 sidebar menu
 * access" - turn the toggle on for the role, then go check exactly the 3 items you want visible to
 * it in the table above (toggling "Restrict to specific roles" on for each one if it isn't
 * already) - everything else is now hidden automatically, with no need to touch every other row.
 */

// 2026-10-01 ("Captain / Technician / Vice Captain ... this role also add"): added Captain and
// ViceCaptain below, alongside the existing Technician. NAMING - Interpretation/Assumption, not
// confirmed: your screenshot showed "Vice Captain" with a space (as Designation-dropdown display
// text), but every other role in this codebase is a single PascalCase word with no space
// (ServiceAdvisor, WorkshopManager, DealerAdmin, ...) - I used 'ViceCaptain' to match that
// convention. If the real backend enum value is spelled differently (e.g. "Vice_Captain" or
// "VC"), tell me the exact string and I'll fix it here.
//
// FLAGGED - this change alone is NOT enough to make Captain/Vice Captain real, working login
// roles: ALL_ROLES here only controls which checkboxes show up on THIS admin page. Two things I
// still don't have from you, both requested earlier and still open: (1) the StaffRole TypeScript
// type this file imports from '../../types' - if that type doesn't already include 'Captain' and
// 'ViceCaptain' as valid string values, this file will fail to type-check/build as-is; (2) the
// backend StaffRole enum + Auth/Policies.cs, which is what actually lets a user log in AS Captain/
// Vice Captain and has real permission checks run for them anywhere else in the app (every
// role-gated button/page in this codebase checks against that backend enum, not this array).
// Please send both files so I can wire this all the way through instead of just this one page.
const ALL_ROLES: StaffRole[] = [
  'ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'Supervisor',
  'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin',
  'Captain', 'ViceCaptain',
]

// SECTION 179 (2026-09-30) "after i tick on menu that role that will show in sidebar untick then
// remove from sidebar only for dealer" - confirmed via AskUserQuestion: "Role Sidebar Mode panel
// shows only DealerAdmin." Only the "Role Sidebar Mode" allow-list toggle panel (SECTION 170)
// below is narrowed down to this one role - the per-item table above (the one with a checkbox
// column per ALL_ROLES) is UNCHANGED, still restricts any page to any role exactly as before.
// Deliberately not used anywhere else in this file: ALL_ROLES itself stays untouched, so save()
// still round-trips every role's onlyShowChecked value (including any other role that may have
// been set to true from before this change) rather than silently resetting them - narrowing this
// constant only hides the OTHER roles from being edited here, it doesn't touch their saved data.
const ROLE_SIDEBAR_MODE_ROLES: StaffRole[] = ['DealerAdmin']

// SECTION 173 (2026-09-30) - "Save failed." on dms.bgauss.com with no further detail. This page's
// save()/load() catches used to show that one fixed string (or a similarly generic "Could not
// load...") regardless of the real cause, discarding the actual HTTP status and this app's own
// `{ message }` error body - the exact same blind spot already hit and fixed this session on
// PartUploadScreen.tsx/AttendanceScreen.tsx (mobile). Appended in parentheses now, so the banner
// itself says why (a 403 from the CorporateAdmin/SystemAdmin role check in
// MenuAccessController.Put vs. a 500 from a database error vs. a genuine network drop all read
// differently) instead of needing a DevTools round-trip to find out.
function describeError(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { message?: string } } }
  const detail = e?.response?.data?.message
  const status = e?.response?.status
  if (detail) return `${fallback} (${detail})`
  if (status) return `${fallback} (HTTP ${status})`
  return `${fallback} (no response reached the server - check your connection)`
}

interface RowState {
  key: string
  to: string
  label: string
  icon: string
  /** null = "everyone" (toggle off); a Set (possibly empty while mid-edit) = restricted to these
   * roles (toggle on). */
  restrictedTo: Set<StaffRole> | null
}

export function MenuAccessPage() {
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  // SECTION 170 - per-role allow-list mode, see class doc comment above.
  const [roleModes, setRoleModes] = useState<Record<StaffRole, boolean>>({} as Record<StaffRole, boolean>)

  const load = () => {
    setLoading(true)
    setError(null)
    staffApi
      .get<{ navKey: string; roles: string[] }[]>('/api/menu-access')
      .then((res) => {
        const overrideMap: Record<string, string[]> = {}
        res.data.forEach((r) => { overrideMap[r.navKey] = r.roles })
        setRows(
          NAV_ITEMS.map((item) => {
            // If an override row exists for this item, it wins (even an empty one, meaning an
            // admin explicitly set it back to "everyone") - otherwise fall back to the item's own
            // shipped default `roles`, exactly like StaffLayout.tsx's own effectiveRoles() does.
            const override = overrideMap[item.key]
            const effective = override !== undefined ? override : item.roles
            return {
              key: item.key,
              to: item.to,
              label: item.label,
              icon: item.icon,
              restrictedTo: effective && effective.length > 0 ? new Set(effective as StaffRole[]) : null,
            }
          }),
        )
      })
      .catch((err) => setError(describeError(err, 'Could not load menu access settings.')))
      .finally(() => setLoading(false))
    staffApi
      .get<{ role: string; onlyShowChecked: boolean }[]>('/api/menu-access/role-modes')
      .then((res) => {
        const map = {} as Record<StaffRole, boolean>
        res.data.forEach((r) => { map[r.role as StaffRole] = r.onlyShowChecked })
        setRoleModes(map)
      })
      .catch(() => {
        // Fail-open (every role stays in today's existing behavior) - same reasoning as the item
        // overrides fetch above.
      })
  }

  useEffect(load, [])

  const toggleRoleMode = (role: StaffRole) => {
    setRoleModes((prev) => ({ ...prev, [role]: !prev[role] }))
  }

  const toggleRestricted = (key: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r
        if (r.restrictedTo !== null) return { ...r, restrictedTo: null } // turning OFF -> everyone
        // Turning ON with nothing selected yet would hide the item from EVERYONE, which is very
        // likely not what was intended - start with every role checked instead, so the admin
        // actively unchecks the ones they want to exclude rather than starting from a blank grid.
        return { ...r, restrictedTo: new Set(ALL_ROLES) }
      }),
    )
  }

  const toggleRole = (key: string, role: StaffRole) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key || r.restrictedTo === null) return r
        const next = new Set(r.restrictedTo)
        if (next.has(role)) next.delete(role)
        else next.add(role)
        return { ...r, restrictedTo: next }
      }),
    )
  }

  // SECTION 175 (2026-09-30) - "i want just role mapping like my role is DealerAdmin for this role
  // i want to show only 2 sidebar menu DashBoard and Jobcard ... direct all role menu remove". The
  // two panels below already do this, but as 3+ separate actions spread across 17 rows plus a
  // second panel (check a role's box on every item you want it to see, THEN separately flip that
  // role's Role Sidebar Mode toggle) - easy to half-finish, which is exactly how a SystemAdmin
  // login ended up in allow-list mode with NOTHING checked, hiding its own sidebar (see
  // StaffLayout.tsx's SECTION 174 fix for that fallout). This panel does the same end result in one
  // step: pick a role, check only the pages it should see, Apply. It only edits the SAME
  // `rows`/`roleModes` state the two panels below already use and already save - nothing new is
  // sent to the backend, and the per-item table below updates immediately so you can review or
  // fine-tune by hand before clicking the existing Save button at the bottom.
  const [quickRole, setQuickRole] = useState<StaffRole>('DealerAdmin')
  const [quickChecked, setQuickChecked] = useState<Set<string>>(new Set())

  // Re-seed the quick-setup checklist from the role's CURRENT effective access whenever you switch
  // the target role (or the underlying data finishes loading) - so opening this panel always starts
  // from what that role can actually see right now, not a blank or stale list. Deliberately NOT
  // re-run on every `rows`/`roleModes` change (e.g. a manual edit in the table below) - that would
  // fight whatever you're actively checking/unchecking here.
  useEffect(() => {
    if (loading) return
    const next = new Set<string>()
    rows.forEach((r) => {
      // Mirrors StaffLayout.tsx's isVisibleForCurrentRole exactly: allow-list mode (roleModes[role])
      // hides anything without an EXPLICIT restricted entry naming this role, even an item that's
      // still "everyone" (restrictedTo === null) under the normal fail-open rule.
      const visible = roleModes[quickRole]
        ? r.restrictedTo !== null && r.restrictedTo.has(quickRole)
        : r.restrictedTo === null || r.restrictedTo.has(quickRole)
      if (visible) next.add(r.key)
    })
    setQuickChecked(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickRole, loading])

  const toggleQuickChecked = (key: string) => {
    setQuickChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const applyQuickSetup = () => {
    setRows((prev) =>
      prev.map((r) => {
        // Start from the item's CURRENT restricted set, or - if it's still "everyone" - every role,
        // so applying this for DealerAdmin never silently changes what any OTHER role can see; only
        // quickRole's membership in this item's allowed set is touched.
        const base = r.restrictedTo !== null ? new Set(r.restrictedTo) : new Set(ALL_ROLES)
        if (quickChecked.has(r.key)) base.add(quickRole)
        else base.delete(quickRole)
        return { ...r, restrictedTo: base }
      }),
    )
    // "direct all role menu remove" - the durable version of "only these, nothing else, ever" (see
    // SECTION 170's own doc comment): also switches this role into Role Sidebar Mode's allow-list,
    // so a brand new page added later stays hidden from it too instead of showing up by default.
    setRoleModes((prev) => ({ ...prev, [quickRole]: true }))
  }

  const save = async () => {
    setSaving(true)
    setSavedMessage(null)
    setError(null)
    const body = rows.map((r) => ({
      navKey: r.key,
      roles: r.restrictedTo ? Array.from(r.restrictedTo) : [],
    }))
    // SECTION 170 - role modes save as their own bulk PUT, right alongside the item overrides
    // above, so one Save button covers both panels.
    const roleModeBody = ALL_ROLES.map((role) => ({ role, onlyShowChecked: !!roleModes[role] }))
    // SECTION 173 - each PUT is now try/caught with its own label, so a failure says WHICH of the
    // two saves it hit (they run sequentially - if the first one fails, the second never runs, so
    // "at the per-item table" vs "at the Role Sidebar Mode panel" is unambiguous either way).
    try {
      await staffApi.put('/api/menu-access', body)
    } catch (err: unknown) {
      setError(describeError(err, 'Save failed at the per-item table'))
      setSaving(false)
      return
    }
    try {
      await staffApi.put('/api/menu-access/role-modes', roleModeBody)
      // 2026-09-30 (SECTION 164, "give alert menu assigned sucessfully for web and mobile"):
      // reworded per your ask, and now genuinely true for both - web's sidebar re-syncs on its own
      // next navigation (see StaffLayout.tsx's own SECTION 164 fix - no full reload needed anymore,
      // just clicking any link), and the mobile Dashboard's tiles now read these same overrides too
      // (see mobile/src/screens/DashboardScreen.tsx's own SECTION 164 doc comment) - next time that
      // screen opens/refreshes.
      setSavedMessage('Menu access assigned successfully. Web picks it up on the next click anywhere in the app; the mobile Dashboard picks it up next time that screen opens.')
    } catch (err: unknown) {
      setError(describeError(err, 'Save failed at Role Sidebar Mode (the per-item table above was saved OK)'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h2>Admin: Menu Access</h2>
      <p className="muted">
        Choose which roles can see each sidebar page. A page with "Restrict to specific roles" off is visible to
        every signed-in staff member - the same as leaving it unset in code.
      </p>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {savedMessage && (
        <p style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 8, background: '#ecfdf3', color: '#065f46', fontSize: 13 }}>
          {savedMessage}
        </p>
      )}

      {!loading && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Quick setup by role</h3>
          <p className="muted" style={{ marginTop: -4 }}>
            Pick a role, check only the pages it should see, then Apply. That fills in the per-item table and Role
            Sidebar Mode toggle below for you - review or adjust by hand if you like, then click Save at the bottom
            to actually commit it.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <label className="muted">Role</label>
            <select value={quickRole} onChange={(e) => setQuickRole(e.target.value as StaffRole)}>
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginBottom: 12 }}>
            {rows.map((r) => (
              <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={quickChecked.has(r.key)} onChange={() => toggleQuickChecked(r.key)} />
                <span>{r.icon}</span> {r.label}
              </label>
            ))}
          </div>
          <button className="btn" onClick={applyQuickSetup}>Apply to table below</button>
        </div>
      )}

      {!loading && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Route</th>
                <th>Restrict to specific roles</th>
                <th>Allowed roles</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <span style={{ marginRight: 6 }}>{r.icon}</span>
                    {r.label}
                  </td>
                  <td className="muted">{r.to}</td>
                  <td>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={r.restrictedTo !== null}
                        onChange={() => toggleRestricted(r.key)}
                      />
                      {r.restrictedTo !== null ? 'Restricted' : 'Everyone'}
                    </label>
                  </td>
                  <td>
                    {r.restrictedTo === null ? (
                      <span className="muted">— all roles —</span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                        {ALL_ROLES.map((role) => (
                          <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={r.restrictedTo!.has(role)}
                              onChange={() => toggleRole(r.key, role)}
                            />
                            {role}
                          </label>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SECTION 170 (2026-09-30) "only give 3 sidebar menu acess only in sidebar this 3 option" -
         see this page's own class doc comment for the full explanation.
         SECTION 179 (2026-09-30) - narrowed to DealerAdmin only (ROLE_SIDEBAR_MODE_ROLES, see its
         own doc comment above for why the other roles no longer appear here - they're still fully
         supported by the per-item table above; this panel specifically is dealer-only per
         request). */}
      {!loading && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Role Sidebar Mode</h3>
          <p className="muted" style={{ marginTop: -4 }}>
            Off (default): Dealer Admin sees every page above unless you've restricted it away. On: Dealer Admin sees
            ONLY the pages above where you've checked "DealerAdmin" - everything else, including any new page added
            later, stays hidden until you check it too.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
            {ROLE_SIDEBAR_MODE_ROLES.map((role) => (
              <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={!!roleModes[role]} onChange={() => toggleRoleMode(role)} />
                {role} <span className="muted">{roleModes[role] ? '(only checked items)' : '(everyone by default)'}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={saving || loading} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
