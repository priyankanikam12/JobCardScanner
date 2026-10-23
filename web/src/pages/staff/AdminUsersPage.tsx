// web\src\pages\staff\AdminUsersPage.tsx
import { useEffect, useMemo, useState } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import { Pagination } from '../../components/Pagination'
import { SortTh, TableSearch, useTableView, type Column } from '../../components/TableControls'
import type { StaffRole } from '../../types'

interface StaffUser {
  id: string
  name: string
  email: string
  mobile?: string
  role: StaffRole
  dealerName?: string
  active: boolean
}

const ROLES: StaffRole[] = ['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'Technician', 'PartsUser', 'Cashier', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']

interface AzureDirectoryUser {
  objectId: string
  displayName: string
  email: string
  accountEnabled: boolean
  provisioned: boolean
  userId?: string
  role?: StaffRole
  active?: boolean
  dealerId?: string
}

interface BaplStatus {
  totalDealersInBapl: number
  dealersImported: number
  pendingImport: number
}
interface BaplPreviewDealer {
  customerCode: string
  customerName: string
  city: string
  state: string
  mobile: string
  contactPerson: string
  assignedRepCode?: string | null
  proposedEmail: string
  hasRealEmail: boolean
}
interface BaplPreviewResult {
  totalInBapl: number
  alreadyImported: number
  toCreate: number
  dealers: BaplPreviewDealer[]
}
interface BaplImportResult {
  message: string
  repCodeUpdated?: number
  created: number
  skipped: number
  failed: number
  defaultPassword: string
  errors: string[]
  dealers: { customerCode: string; customerName: string; city: string; state: string; email: string }[]
}

// One row of DMS's own AspNetUsers (GET /api/bapl-dms/aspnet-users), cross-referenced
// server-side against JobCardScannerDb's own Dealers/Users - see BaplDmsController.AspNetUsers's
// doc comment. Read-only browse: there's no PasswordHash here, and no add/resolve action - it
// exists purely so an admin can see why a given DMS login is or isn't working yet (no
// DealerCode on file, a DealerCode that doesn't resolve to a known local Dealer, or simply never
// signed in) without pasting SQL dumps back and forth.
interface BaplAspNetUser {
  id: string
  email: string
  userName?: string | null
  phoneNumber?: string | null
  dealerCode?: string | null
  lockoutEnabled: boolean
  emailConfirmed: boolean
  resolvedDealerId?: string | null
  resolvedDealerName?: string | null
  provisioned: boolean
  localActive?: boolean | null
  localUserId?: string | null
}

// 2026-10-01 ("this page also ui make proper tab wise when i click Sync from Azure AD button then
// shown this in table when i clcik Bulk import dealers from ERP (BAPL) then open this page and
// hide this previous all proper ui"): this page used to stack all four action cards (Sync from
// Azure AD / Bulk import dealers from ERP / DMS Logins / Add staff user manually) one under the
// other, always visible at once. Converted to a tab strip - only the selected tab's card renders,
// so switching tabs now actually hides the previous card instead of just scrolling past it.
//
// ASSUMPTION (flagging, not guessed silently): the final "all users" table at the bottom of the
// page is left OUTSIDE the tabs, always visible - you didn't call that one out by name, and every
// action above it (role updates, new adds, activate/deactivate) is really editing rows in that
// same table, so keeping it always in view as the one shared result/reference list seemed more
// useful than burying it behind a 5th tab. Say the word if you want it tabbed too, or moved
// elsewhere.
type AdminUsersTab = 'azure' | 'bapl' | 'dms' | 'manual'

// 2026-10-23 ("pagination add 10 data records in 1 page, sorting order each column, then search filter for all row"): every table on this page shows 10 rows per page, sorts on any column
// header and filters on all its columns - see components/TableControls.tsx. The "rows per page" list offers 10 / 25 / 50 / 100.
const PAGE_SIZES = [10, 25, 50, 100]
const EMPTY_DEALERS: BaplPreviewDealer[] = []

export function AdminUsersPage() {
  const { profile, hasRole } = useStaffAuth()
  const [users, setUsers] = useState<StaffUser[]>([])
  const [form, setForm] = useState({ name: '', email: '', mobile: '', role: 'ServiceAdvisor' as StaffRole })

  const canSeeBapl = hasRole('CorporateAdmin', 'SystemAdmin')
  const canSeeDms = hasRole('DealerAdmin', 'CorporateAdmin', 'SystemAdmin')
  const [activeTab, setActiveTab] = useState<AdminUsersTab>('azure')

  // ---------------- Sync from Azure AD ----------------
  const [azureQuery, setAzureQuery] = useState('')
  const [azureResults, setAzureResults] = useState<AzureDirectoryUser[]>([])
  const [azureTotal, setAzureTotal] = useState<number | null>(null)
  const [azureLoading, setAzureLoading] = useState(false)
  const [azureError, setAzureError] = useState<string | null>(null)
  // Role picked in each row's dropdown before Add/Update Role is clicked, keyed by email.
  const [azureRoleChoice, setAzureRoleChoice] = useState<Record<string, StaffRole>>({})
  const [azureBusyEmail, setAzureBusyEmail] = useState<string | null>(null)
  // Checked rows (not-yet-added accounts only) for the "Add Selected" bulk action, keyed by email.
  const [azureSelected, setAzureSelected] = useState<Record<string, boolean>>({})
  const [azureBulkBusy, setAzureBulkBusy] = useState(false)
  const [azureBulkError, setAzureBulkError] = useState<string | null>(null)

  const load = () => staffApi.get<StaffUser[]>('/api/users').then((r) => setUsers(r.data))
  useEffect(() => { load() }, [])

  const loadAzureDirectory = async (q: string) => {
    setAzureLoading(true)
    setAzureError(null)
    try {
      const { data } = await staffApi.get<{ total: number; results: AzureDirectoryUser[] }>('/api/admin/azure-directory/users', { params: q ? { q } : {} })
      setAzureResults(data.results)
      setAzureTotal(data.total)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Could not reach the Azure AD directory.'
      setAzureError(message)
      setAzureResults([])
      setAzureTotal(null)
    } finally {
      setAzureLoading(false)
    }
  }

  // Debounced search-as-you-type - loads the full directory once up front (empty query), then
  // re-queries a few hundred ms after the admin stops typing. Only while the Azure AD tab is
  // active - no point re-querying a hidden tab's own debounce timer in the background.
  useEffect(() => {
    if (activeTab !== 'azure') return
    const t = setTimeout(() => { loadAzureDirectory(azureQuery) }, azureQuery ? 350 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [azureQuery, activeTab])

  const roleFor = (u: AzureDirectoryUser): StaffRole => azureRoleChoice[u.email] ?? u.role ?? 'ServiceAdvisor'

  // Azure AD tab: the search box above the table asks the directory (as before); this quick filter and the sort / paging below work on the accounts that came back.
  const [azureStatusFilter, setAzureStatusFilter] = useState<'all' | 'new' | 'added'>('all')
  const azureRows = useMemo(
    () => azureResults.filter((u) => azureStatusFilter === 'all' || (azureStatusFilter === 'new' ? !u.provisioned : u.provisioned)),
    [azureResults, azureStatusFilter],
  )
  const azureColumns: Column<AzureDirectoryUser>[] = [
    { key: 'name', label: 'Name', value: (u) => u.displayName },
    { key: 'email', label: 'Email', value: (u) => u.email },
    { key: 'enabled', label: 'Enabled', value: (u) => (u.accountEnabled ? 'Yes' : 'No') },
    { key: 'status', label: 'Status', value: (u) => (u.provisioned ? (u.active ? 'Added' : 'Added (inactive)') : 'Not added') },
    { key: 'role', label: 'Role', value: (u) => roleFor(u) },
  ]
  const azureView = useTableView(azureRows, azureColumns, { pageSize: 10, version: azureRoleChoice })

  const addFromAzure = async (u: AzureDirectoryUser) => {
    setAzureBusyEmail(u.email)
    try {
      await staffApi.post('/api/users', { name: u.displayName, email: u.email, mobile: '', role: roleFor(u), dealerId: profile?.dealerId })
      await loadAzureDirectory(azureQuery)
      load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not add this user.'
      setAzureError(message)
    } finally {
      setAzureBusyEmail(null)
    }
  }

  // Rows currently checked AND still not-provisioned (a row auto-drops off selection once it's
  // been added, since re-loading the directory sets its provisioned flag to true).
  const selectableUnprovisioned = azureResults.filter((u) => !u.provisioned)
  const selectedCount = selectableUnprovisioned.filter((u) => azureSelected[u.email]).length
  // the header checkbox works on the rows of the CURRENT PAGE; the ticks of other pages stay (the "Add Selected" count covers every page)
  const pageUnprovisioned = azureView.pageRows.filter((u) => !u.provisioned)
  const allVisibleSelected = pageUnprovisioned.length > 0 && pageUnprovisioned.every((u) => azureSelected[u.email])

  const toggleSelectAllVisible = () => {
    const next = { ...azureSelected }
    const target = !allVisibleSelected
    pageUnprovisioned.forEach((u) => { next[u.email] = target })
    setAzureSelected(next)
  }

  const addSelectedFromAzure = async () => {
    const toAdd = selectableUnprovisioned.filter((u) => azureSelected[u.email])
    if (toAdd.length === 0) return
    setAzureBulkBusy(true)
    setAzureBulkError(null)
    const failures: string[] = []
    // Sequential, not Promise.all - keeps error attribution per-user simple and avoids hammering
    // the API with a burst of a few hundred inserts at once.
    for (const u of toAdd) {
      try {
        await staffApi.post('/api/users', { name: u.displayName, email: u.email, mobile: '', role: roleFor(u), dealerId: profile?.dealerId })
        setAzureSelected((prev) => { const next = { ...prev }; delete next[u.email]; return next })
      } catch (err: unknown) {
        const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'failed'
        failures.push(`${u.email} (${message})`)
      }
    }
    if (failures.length > 0) setAzureBulkError(`Could not add ${failures.length} user(s): ${failures.join(', ')}`)
    await loadAzureDirectory(azureQuery)
    load()
    setAzureBulkBusy(false)
  }

  const updateRoleFromAzure = async (u: AzureDirectoryUser) => {
    if (!u.userId) return
    setAzureBusyEmail(u.email)
    try {
      await staffApi.put(`/api/users/${u.userId}`, { role: roleFor(u) })
      await loadAzureDirectory(azureQuery)
      load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not update this user\'s role.'
      setAzureError(message)
    } finally {
      setAzureBusyEmail(null)
    }
  }

  // ---------------- Bulk Import Dealers from ERP (BAPL) ----------------
  const [baplStatus, setBaplStatus] = useState<BaplStatus | null>(null)
  const [baplPreview, setBaplPreview] = useState<BaplPreviewResult | null>(null)
  const [baplResult, setBaplResult] = useState<BaplImportResult | null>(null)
  const [baplLoading, setBaplLoading] = useState<'status' | 'preview' | 'import' | null>(null)
  const [baplError, setBaplError] = useState<string | null>(null)
  const [baplShowList, setBaplShowList] = useState(false)

  const baplErrMessage = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback

  const loadBaplStatus = async () => {
    setBaplLoading('status'); setBaplError(null)
    try { setBaplStatus((await staffApi.get<BaplStatus>('/api/admin/bapl-dealers/status')).data) }
    catch (err: unknown) { setBaplError(baplErrMessage(err, 'Could not reach the BAPL dealer database.')) }
    finally { setBaplLoading(null) }
  }
  const loadBaplPreview = async () => {
    setBaplLoading('preview'); setBaplError(null)
    try {
      setBaplPreview((await staffApi.post<BaplPreviewResult>('/api/admin/bapl-dealers/preview')).data)
      setBaplResult(null)
    } catch (err: unknown) { setBaplError(baplErrMessage(err, 'Could not reach the BAPL dealer database.')) }
    finally { setBaplLoading(null) }
  }
  const runBaplImport = async () => {
    if (!window.confirm(`Import ${baplPreview?.toCreate ?? '?'} dealers with default login password Dealer@123?`)) return
    setBaplLoading('import'); setBaplError(null)
    try {
      const { data } = await staffApi.post<BaplImportResult>('/api/admin/bapl-dealers/import')
      setBaplResult(data)
      setBaplPreview(null)
      loadBaplStatus()
    } catch (err: unknown) { setBaplError(baplErrMessage(err, 'Import failed.')) }
    finally { setBaplLoading(null) }
  }

  // ---------------- DMS Logins (browse AspNetUsers) ----------------
  const [baplUsersQuery, setBaplUsersQuery] = useState('')
  const [baplUsers, setBaplUsers] = useState<BaplAspNetUser[]>([])
  const [baplUsersLoading, setBaplUsersLoading] = useState(false)
  const [baplUsersError, setBaplUsersError] = useState<string | null>(null)
  const [baplUsersLoaded, setBaplUsersLoaded] = useState(false)

  const loadBaplUsers = async (q: string) => {
    setBaplUsersLoading(true)
    setBaplUsersError(null)
    try {
      const { data } = await staffApi.get<BaplAspNetUser[]>('/api/bapl-dms/aspnet-users', { params: q ? { q } : {} })
      setBaplUsers(data)
      setBaplUsersLoaded(true)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Could not reach DMS right now.'
      setBaplUsersError(message)
      setBaplUsers([])
    } finally {
      setBaplUsersLoading(false)
    }
  }

  const baplUsersStatusLabel = (u: BaplAspNetUser) => {
    if (!u.provisioned) return 'Never signed in here yet'
    if (u.localActive) return 'Active'
    return u.resolvedDealerId ? 'Inactive' : 'Inactive - pending dealer assignment'
  }

  // BAPL preview list, DMS logins and the all-users table: search on every column, sort on every column, 10 rows per page.
  const baplColumns: Column<BaplPreviewDealer>[] = [
    { key: 'code', label: 'Code', value: (d) => d.customerCode },
    { key: 'name', label: 'Dealer Name', value: (d) => d.customerName },
    { key: 'city', label: 'City', value: (d) => d.city },
    { key: 'state', label: 'State', value: (d) => d.state },
    { key: 'rep', label: 'Assigned Rep', value: (d) => d.assignedRepCode },
    { key: 'email', label: 'Proposed Email', value: (d) => d.proposedEmail },
    { key: 'real', label: 'Real Email?', value: (d) => (d.hasRealEmail ? 'Yes' : 'fallback') },
  ]
  const baplView = useTableView(baplPreview?.dealers ?? EMPTY_DEALERS, baplColumns, { pageSize: 10 })

  const dmsColumns: Column<BaplAspNetUser>[] = [
    { key: 'email', label: 'Email', value: (u) => u.email },
    { key: 'username', label: 'Username', value: (u) => u.userName },
    { key: 'dealerCode', label: 'Dealer Code', value: (u) => u.dealerCode },
    { key: 'dealer', label: 'Resolved Dealer', value: (u) => u.resolvedDealerName },
    { key: 'status', label: 'Status here', value: (u) => baplUsersStatusLabel(u) },
    { key: 'locked', label: 'Locked', value: (u) => (u.lockoutEnabled ? 'Yes' : 'No') },
  ]
  // the search box of this tab does both: typing filters the logins already loaded, the button (or Enter) asks DMS again with the same text
  const dmsView = useTableView(baplUsers, dmsColumns, { pageSize: 10, query: baplUsersQuery })

  const userColumns: Column<StaffUser>[] = [
    { key: 'name', label: 'Name', value: (u) => u.name },
    { key: 'email', label: 'Email', value: (u) => u.email },
    { key: 'role', label: 'Role', value: (u) => u.role },
    { key: 'dealer', label: 'Dealer', value: (u) => u.dealerName ?? 'All' },
    { key: 'active', label: 'Active', value: (u) => (u.active ? 'Yes' : 'No') },
  ]
  const usersView = useTableView(users, userColumns, { pageSize: 10 })

  const create = async () => {
    await staffApi.post('/api/users', { ...form, dealerId: profile?.dealerId })
    setForm({ name: '', email: '', mobile: '', role: 'ServiceAdvisor' })
    load()
  }

  const toggleActive = async (u: StaffUser) => {
    await staffApi.put(`/api/users/${u.id}`, { active: !u.active })
    load()
  }

  // Tabs visible to this admin - DealerAdmin never sees the BAPL tab, and only
  // Dealer/Corporate/System Admin see DMS Logins (same gates the cards used before, just moved up
  // to decide tab visibility instead of card visibility). If the active tab becomes hidden because
  // the gate changed (shouldn't normally happen mid-session, but cheap to guard), fall back to the
  // one tab everyone can always see.
  useEffect(() => {
    if (activeTab === 'bapl' && !canSeeBapl) setActiveTab('azure')
    if (activeTab === 'dms' && !canSeeDms) setActiveTab('azure')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeBapl, canSeeDms])

  const tabs: { key: AdminUsersTab; label: string; visible: boolean }[] = [
    { key: 'azure', label: 'Sync from Azure AD', visible: true },
    { key: 'bapl', label: 'Bulk import dealers from ERP', visible: canSeeBapl },
    { key: 'dms', label: 'DMS Logins', visible: canSeeDms },
    { key: 'manual', label: 'Add staff user manually', visible: true },
  ]

  const statusBadge = (u: AzureDirectoryUser) =>
    u.provisioned
      ? <span className={`badge ${u.active ? 'badge-success' : 'badge-warning'}`}>{u.active ? 'Added' : 'Added (inactive)'}</span>
      : <span className="badge badge-muted">Not added</span>

  return (
    <div>
      <h2>Admin: Users</h2>

      <div className="au-tabs" role="tablist">
        {tabs.filter((tab) => tab.visible).map((tab) => (
          <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} className={`au-tab${activeTab === tab.key ? ' active' : ''}`} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'azure' && (
      <div className="card">
        <h3>Sync from Azure AD</h3>
        {/* <p className="muted">
          Search your organization's real Azure AD directory{azureTotal !== null ? ` (${azureTotal} accounts)` : ''} and add
          or re-role people directly - no need to type their email by hand.
        </p> */}

        <div className="tc-toolbar">
          <TableSearch value={azureQuery} onChange={setAzureQuery} placeholder="Search the directory by name or email, e.g. oat or bgauss.com" ariaLabel="Search by name or email" />
          <div className="tc-seg" role="group" aria-label="Show accounts">
            {([['all', 'All'], ['new', 'Not added'], ['added', 'Added']] as const).map(([key, label]) => (
              <button key={key} type="button" className={`tc-seg-btn${azureStatusFilter === key ? ' active' : ''}`} onClick={() => setAzureStatusFilter(key)}>{label}</button>
            ))}
          </div>
          <button type="button" className="btn btn-primary" disabled={selectedCount === 0 || azureBulkBusy} onClick={addSelectedFromAzure}>
            {azureBulkBusy ? 'Adding selected…' : `Add selected (${selectedCount})`}
          </button>
        </div>
        {/* <p className="muted tc-hint">Tick the accounts you want to add, pick a role per row, then add them all in one click.</p> */}

        {azureError && <p className="muted" style={{ color: '#b91c1c' }}>{azureError}</p>}
        {azureBulkError && <p className="muted" style={{ color: '#b91c1c' }}>{azureBulkError}</p>}
        {azureLoading && <p className="muted">Loading from Azure AD…</p>}

        {!azureLoading && !azureError && (
          <>
            <div className="tc-tablewrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        disabled={pageUnprovisioned.length === 0}
                        onChange={toggleSelectAllVisible}
                        title="Select all not-yet-added accounts on this page"
                      />
                    </th>
                    <SortTh label="Name" sortKey="name" sort={azureView.sort} onSort={azureView.toggleSort} />
                    <SortTh label="Email" sortKey="email" sort={azureView.sort} onSort={azureView.toggleSort} />
                    <SortTh label="Enabled" sortKey="enabled" sort={azureView.sort} onSort={azureView.toggleSort} />
                    <SortTh label="Status" sortKey="status" sort={azureView.sort} onSort={azureView.toggleSort} />
                    <SortTh label="Role" sortKey="role" sort={azureView.sort} onSort={azureView.toggleSort} />
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {azureView.pageRows.map((u) => (
                    <tr key={u.objectId}>
                      <td>
                        {!u.provisioned && (
                          <input
                            type="checkbox"
                            checked={!!azureSelected[u.email]}
                            onChange={(e) => setAzureSelected({ ...azureSelected, [u.email]: e.target.checked })}
                          />
                        )}
                      </td>
                      <td>{u.displayName}</td>
                      <td>{u.email}</td>
                      <td><span className={`badge ${u.accountEnabled ? 'badge-success' : 'badge-muted'}`}>{u.accountEnabled ? 'Yes' : 'No'}</span></td>
                      <td>{statusBadge(u)}</td>
                      <td>
                        <select value={roleFor(u)} onChange={(e) => setAzureRoleChoice({ ...azureRoleChoice, [u.email]: e.target.value as StaffRole })}>
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td>
                        {u.provisioned ? (
                          <button className="btn btn-sm" disabled={azureBusyEmail === u.email || roleFor(u) === u.role} onClick={() => updateRoleFromAzure(u)}>
                            {azureBusyEmail === u.email ? 'Saving…' : 'Update Role'}
                          </button>
                        ) : (
                          <button className="btn btn-sm btn-primary" disabled={azureBusyEmail === u.email || azureBulkBusy} onClick={() => addFromAzure(u)}>
                            {azureBusyEmail === u.email ? 'Adding…' : 'Add'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {azureView.pageRows.length === 0 && (
                    <tr><td colSpan={7} className="muted">No matches{azureQuery ? ` for "${azureQuery}"` : ''}{azureStatusFilter !== 'all' ? ` among the ${azureStatusFilter === 'new' ? 'not added' : 'added'} accounts` : ''}.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="tc-pager">
              <Pagination page={azureView.page} pageCount={azureView.pageCount} total={azureView.total} onPageChange={azureView.setPage} pageSize={azureView.pageSize} onPageSizeChange={azureView.setPageSize} pageSizeOptions={PAGE_SIZES} />
            </div>
          </>
        )}
      </div>
      )}

      {activeTab === 'bapl' && canSeeBapl && (
      <div className="card">
        <h3>Bulk import dealers from ERP</h3>
        {/* <p className="muted">
          Pulls BGauss's real dealer network from BAPL's customer master and creates a Dealer
          record plus a Dealer Admin login (password <code>Dealer@123</code>, forced change on
          first sign-in) for each one that isn't already here.
        </p> */}

        <div className="tc-toolbar">
          <button type="button" className="btn" disabled={!!baplLoading} onClick={loadBaplStatus}>
            {baplLoading === 'status' ? 'Checking…' : 'Check status'}
          </button>
          {!baplResult && (
            <button type="button" className="btn btn-primary" disabled={!!baplLoading} onClick={loadBaplPreview}>
              {baplLoading === 'preview' ? 'Loading…' : 'Preview import'}
            </button>
          )}
          {!baplResult && baplPreview && baplPreview.toCreate > 0 && (
            <button type="button" className="btn btn-success" disabled={!!baplLoading} onClick={runBaplImport}>
              {baplLoading === 'import' ? `Importing ${baplPreview.toCreate}…` : `Import ${baplPreview.toCreate} dealers`}
            </button>
          )}
          {baplStatus && (
            <div className="tc-chips tc-spacer" aria-label="BAPL import status">
              <span className="tc-chip"><b>{baplStatus.totalDealersInBapl}</b> in BAPL</span>
              <span className="tc-chip tc-chip-ok"><b>{baplStatus.dealersImported}</b> imported</span>
              <span className="tc-chip tc-chip-warn"><b>{baplStatus.pendingImport}</b> pending</span>
            </div>
          )}
        </div>

        {baplError && <p className="muted" style={{ color: '#b91c1c' }}>{baplError}</p>}
        {!baplResult && baplPreview && baplPreview.toCreate === 0 && (
          <p className="muted">All active BAPL dealers already have a Dealer record here.</p>
        )}

        {baplPreview && !baplResult && baplPreview.toCreate > 0 && (
          <div>
            <div className="tc-toolbar">
              <TableSearch value={baplView.query} onChange={baplView.setQuery} placeholder="Filter the list by code, dealer, city, state, rep or email" ariaLabel="Filter the import list" />
              <span className="tc-count">
                <strong>{baplPreview.toCreate}</strong> to create · {baplPreview.alreadyImported} already imported
                {baplView.query && <> · showing {baplView.total} of {baplView.allTotal}</>}
              </span>
            </div>
            <div className="tc-tablewrap">
              <table>
                <thead>
                  <tr>
                    <SortTh label="Code" sortKey="code" sort={baplView.sort} onSort={baplView.toggleSort} />
                    <SortTh label="Dealer Name" sortKey="name" sort={baplView.sort} onSort={baplView.toggleSort} />
                    <SortTh label="City" sortKey="city" sort={baplView.sort} onSort={baplView.toggleSort} />
                    <SortTh label="State" sortKey="state" sort={baplView.sort} onSort={baplView.toggleSort} />
                    <SortTh label="Assigned Rep" sortKey="rep" sort={baplView.sort} onSort={baplView.toggleSort} />
                    <SortTh label="Proposed Email" sortKey="email" sort={baplView.sort} onSort={baplView.toggleSort} />
                    <SortTh label="Real Email?" sortKey="real" sort={baplView.sort} onSort={baplView.toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {baplView.pageRows.map((d) => (
                    <tr key={d.customerCode}>
                      <td>{d.customerCode}</td><td>{d.customerName}</td><td>{d.city}</td><td>{d.state}</td>
                      <td>{d.assignedRepCode ?? '-'}</td>
                      <td>{d.proposedEmail}</td>
                      <td><span className={`badge ${d.hasRealEmail ? 'badge-success' : 'badge-muted'}`}>{d.hasRealEmail ? 'Yes' : 'fallback'}</span></td>
                    </tr>
                  ))}
                  {baplView.pageRows.length === 0 && (
                    <tr><td colSpan={7} className="muted">No dealer matches "{baplView.query}".</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="tc-pager">
              <Pagination page={baplView.page} pageCount={baplView.pageCount} total={baplView.total} onPageChange={baplView.setPage} pageSize={baplView.pageSize} onPageSizeChange={baplView.setPageSize} pageSizeOptions={PAGE_SIZES} />
            </div>
          </div>
        )}

        {baplResult && (
          <div>
            <p><strong>{baplResult.created}</strong> created · <strong>{baplResult.skipped}</strong> already existed
              {!!baplResult.repCodeUpdated && <> ({baplResult.repCodeUpdated} rep code{baplResult.repCodeUpdated === 1 ? '' : 's'} updated)</>}
              {baplResult.failed > 0 && <> · <strong style={{ color: '#b91c1c' }}>{baplResult.failed}</strong> failed</>}
            </p>
            <p className="muted">
              Default login password for new dealers: <code>{baplResult.defaultPassword}</code> — share securely; they're forced to change it on first sign-in.
            </p>
            {baplResult.errors.length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer', color: '#b91c1c' }}>{baplResult.errors.length} error(s)</summary>
                <ul>{baplResult.errors.map((e, i) => <li key={i} className="muted">{e}</li>)}</ul>
              </details>
            )}
            <button type="button" className="btn btn-sm" onClick={() => { setBaplResult(null); setBaplPreview(null); loadBaplStatus() }}>
              Import more / refresh
            </button>
          </div>
        )}
      </div>
      )}

      {activeTab === 'dms' && canSeeDms && (
      <div className="card">
        <h3>DMS Logins</h3>
        <div className="tc-toolbar">
          <TableSearch
            value={baplUsersQuery}
            onChange={setBaplUsersQuery}
            onEnter={() => loadBaplUsers(baplUsersQuery)}
            placeholder="Search by email, username or dealer code, e.g. CUS0001 or someone@example.com"
            ariaLabel="Search by email, username, or dealer code"
          />
          <button type="button" className="btn btn-primary" disabled={baplUsersLoading} onClick={() => loadBaplUsers(baplUsersQuery)}>
            {baplUsersLoading ? 'Loading…' : baplUsersLoaded ? 'Search' : 'Load DMS logins'}
          </button>
        </div>
        {baplUsersLoaded && !baplUsersLoading && !baplUsersError && (
          <p className="muted tc-hint">Typing filters the logins below at once; press Search (or Enter) to ask DMS again with the same text.</p>
        )}

        {baplUsersError && <p className="muted" style={{ color: '#b91c1c' }}>{baplUsersError}</p>}

        {baplUsersLoaded && !baplUsersLoading && !baplUsersError && (
          <>
            <div className="tc-tablewrap">
              <table>
                <thead>
                  <tr>
                    <SortTh label="Email" sortKey="email" sort={dmsView.sort} onSort={dmsView.toggleSort} />
                    <SortTh label="Username" sortKey="username" sort={dmsView.sort} onSort={dmsView.toggleSort} />
                    <SortTh label="Dealer Code" sortKey="dealerCode" sort={dmsView.sort} onSort={dmsView.toggleSort} />
                    <SortTh label="Resolved Dealer" sortKey="dealer" sort={dmsView.sort} onSort={dmsView.toggleSort} />
                    <SortTh label="Status here" sortKey="status" sort={dmsView.sort} onSort={dmsView.toggleSort} />
                    <SortTh label="Locked" sortKey="locked" sort={dmsView.sort} onSort={dmsView.toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {dmsView.pageRows.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{u.userName ?? '-'}</td>
                      <td>{u.dealerCode ?? <span className="muted">none on file</span>}</td>
                      <td>{u.resolvedDealerName ?? (u.dealerCode ? <span className="muted">not linked yet</span> : '-')}</td>
                      <td>{baplUsersStatusLabel(u)}</td>
                      <td><span className={`badge ${u.lockoutEnabled ? 'badge-warning' : 'badge-muted'}`}>{u.lockoutEnabled ? 'Yes' : 'No'}</span></td>
                    </tr>
                  ))}
                  {dmsView.pageRows.length === 0 && (
                    <tr><td colSpan={6} className="muted">No matches{baplUsersQuery ? ` for "${baplUsersQuery}"` : ''} (up to 500 shown).</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="tc-pager">
              <Pagination page={dmsView.page} pageCount={dmsView.pageCount} total={dmsView.total} onPageChange={dmsView.setPage} pageSize={dmsView.pageSize} onPageSizeChange={dmsView.setPageSize} pageSizeOptions={PAGE_SIZES} />
            </div>
          </>
        )}
      </div>
      )}

      {activeTab === 'manual' && (
      <div className="card">
        <h3>Add staff user manually (Azure AD)</h3>
        {/* <p className="muted">For a corporate Azure AD sign-in with any Role (Admin, Cashier, Parts, ...). The email must exactly match the email/UPN they sign in to Azure AD with - see docs/AZURE_AD_SETUP.md. Prefer the Azure AD search above when possible, so you don't have to type it by hand. For a dealer/workshop employee with a local login and Work Area location scoping, use the "Employees" page instead.</p> */}
        <div className="form-row">
          <div className="field"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label>Email (Azure AD UPN)</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field"><label>Mobile</label><input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
          <div className="field">
            <label>Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <button type="button" className="btn btn-primary" disabled={!form.name || !form.email} onClick={create}>Add user</button>
      </div>
      )}

      <div className="card">
        <div className="tc-toolbar">
          <h3 style={{ margin: 0 }}>All users</h3>
          <TableSearch value={usersView.query} onChange={usersView.setQuery} placeholder="Filter by name, email, role, dealer or active" ariaLabel="Filter users" />
          <span className="tc-count">{usersView.query ? `${usersView.total} of ${usersView.allTotal} users` : `${usersView.allTotal} users`}</span>
        </div>
        <div className="tc-tablewrap">
          <table>
            <thead>
              <tr>
                <SortTh label="Name" sortKey="name" sort={usersView.sort} onSort={usersView.toggleSort} />
                <SortTh label="Email" sortKey="email" sort={usersView.sort} onSort={usersView.toggleSort} />
                <SortTh label="Role" sortKey="role" sort={usersView.sort} onSort={usersView.toggleSort} />
                <SortTh label="Dealer" sortKey="dealer" sort={usersView.sort} onSort={usersView.toggleSort} />
                <SortTh label="Active" sortKey="active" sort={usersView.sort} onSort={usersView.toggleSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {usersView.pageRows.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.dealerName ?? 'All'}</td>
                  <td><span className={`badge ${u.active ? 'badge-success' : 'badge-muted'}`}>{u.active ? 'Yes' : 'No'}</span></td>
                  <td>
                    <button type="button" className="btn btn-sm" onClick={() => toggleActive(u)}>{u.active ? 'Deactivate' : 'Activate'}</button>
                  </td>
                </tr>
              ))}
              {usersView.pageRows.length === 0 && (
                <tr><td colSpan={6} className="muted">{usersView.query ? `No user matches "${usersView.query}".` : 'No users yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="tc-pager">
          <Pagination page={usersView.page} pageCount={usersView.pageCount} total={usersView.total} onPageChange={usersView.setPage} pageSize={usersView.pageSize} onPageSizeChange={usersView.setPageSize} pageSizeOptions={PAGE_SIZES} />
        </div>
      </div>
    </div>
  )
}
