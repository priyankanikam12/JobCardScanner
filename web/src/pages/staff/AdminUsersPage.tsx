import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
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

const ROLES: StaffRole[] = ['ServiceAdvisor', 'WorkshopManager', 'Technician', 'PartsUser', 'Cashier', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']

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

export function AdminUsersPage() {
  const { profile, hasRole } = useStaffAuth()
  const [users, setUsers] = useState<StaffUser[]>([])
  const [form, setForm] = useState({ name: '', email: '', mobile: '', role: 'ServiceAdvisor' as StaffRole })

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
  // re-queries a few hundred ms after the admin stops typing.
  useEffect(() => {
    const t = setTimeout(() => { loadAzureDirectory(azureQuery) }, azureQuery ? 350 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [azureQuery])

  const roleFor = (u: AzureDirectoryUser): StaffRole => azureRoleChoice[u.email] ?? u.role ?? 'ServiceAdvisor'

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
  const allVisibleSelected = selectableUnprovisioned.length > 0 && selectedCount === selectableUnprovisioned.length

  const toggleSelectAllVisible = () => {
    const next = { ...azureSelected }
    const target = !allVisibleSelected
    selectableUnprovisioned.forEach((u) => { next[u.email] = target })
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

  const create = async () => {
    await staffApi.post('/api/users', { ...form, dealerId: profile?.dealerId })
    setForm({ name: '', email: '', mobile: '', role: 'ServiceAdvisor' })
    load()
  }

  const toggleActive = async (u: StaffUser) => {
    await staffApi.put(`/api/users/${u.id}`, { active: !u.active })
    load()
  }

  return (
    <div>
      <h2>Admin: Users</h2>

      <div className="card">
        <h3>Sync from Azure AD</h3>
        <p className="muted">
          Search your organization's real Azure AD directory{azureTotal !== null ? ` (${azureTotal} accounts)` : ''} and add
          or re-role people directly - no need to type their email by hand.
        </p>
        <div className="form-row">
          <div className="field" style={{ flex: 1 }}>
            <label>Search by name or email</label>
            <input placeholder="e.g. oat or bgauss.com" value={azureQuery} onChange={(e) => setAzureQuery(e.target.value)} />
          </div>
        </div>

        {azureError && (
          <p className="muted" style={{ color: '#b91c1c' }}>{azureError}</p>
        )}
        {azureBulkError && (
          <p className="muted" style={{ color: '#b91c1c' }}>{azureBulkError}</p>
        )}
        {azureLoading && <p className="muted">Loading from Azure AD…</p>}

        {!azureLoading && !azureError && (
          <>
            <div className="form-row" style={{ alignItems: 'center' }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={selectedCount === 0 || azureBulkBusy}
                onClick={addSelectedFromAzure}
              >
                {azureBulkBusy ? 'Adding selected…' : `Add Selected (${selectedCount})`}
              </button>
              <span className="muted">Tick the accounts you want to add, pick a role per row, then add them all in one click.</span>
            </div>

            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      disabled={selectableUnprovisioned.length === 0}
                      onChange={toggleSelectAllVisible}
                      title="Select all not-yet-added accounts currently shown"
                    />
                  </th>
                  <th>Name</th><th>Email</th><th>Enabled</th><th>Status</th><th>Role</th><th></th>
                </tr>
              </thead>
              <tbody>
                {azureResults.map((u) => (
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
                    <td>{u.accountEnabled ? 'Yes' : 'No'}</td>
                    <td>{u.provisioned ? (u.active ? 'Added' : 'Added (inactive)') : 'Not added'}</td>
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
                {azureResults.length === 0 && (
                  <tr><td colSpan={7} className="muted">No matches{azureQuery ? ` for "${azureQuery}"` : ''}.</td></tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>

      {hasRole('CorporateAdmin', 'SystemAdmin') && (
      <div className="card">
        <h3>Bulk import dealers from ERP (BAPL)</h3>
        <p className="muted">
          Pulls BGauss's real dealer network from BAPL's customer master and creates a Dealer
          record plus a Dealer Admin login (password <code>Dealer@123</code>, forced change on
          first sign-in) for each one that isn't already here.
        </p>

        <div className="form-row" style={{ alignItems: 'center' }}>
          <button className="btn btn-sm" disabled={!!baplLoading} onClick={loadBaplStatus}>
            {baplLoading === 'status' ? 'Checking…' : 'Check Status'}
          </button>
          {baplStatus && (
            <span className="muted">
              {baplStatus.totalDealersInBapl} dealers in BAPL · {baplStatus.dealersImported} already imported · {baplStatus.pendingImport} pending
            </span>
          )}
        </div>

        {baplError && <p className="muted" style={{ color: '#b91c1c' }}>{baplError}</p>}

        {!baplResult && (
          <div className="form-row" style={{ alignItems: 'center' }}>
            <button className="btn btn-sm btn-primary" disabled={!!baplLoading} onClick={loadBaplPreview}>
              {baplLoading === 'preview' ? 'Loading…' : 'Preview Import'}
            </button>
            {baplPreview && baplPreview.toCreate > 0 && (
              <button className="btn btn-sm btn-primary" disabled={!!baplLoading} onClick={runBaplImport}>
                {baplLoading === 'import' ? `Importing ${baplPreview.toCreate}…` : `Import ${baplPreview.toCreate} Dealers`}
              </button>
            )}
            {baplPreview && baplPreview.toCreate === 0 && (
              <span className="muted">All active BAPL dealers already have a Dealer record here.</span>
            )}
          </div>
        )}

        {baplPreview && !baplResult && baplPreview.toCreate > 0 && (
          <div>
            <div className="form-row" style={{ alignItems: 'center' }}>
              <span className="muted">
                <strong>{baplPreview.toCreate}</strong> to create · {baplPreview.alreadyImported} already imported
              </span>
              <button className="btn btn-sm" onClick={() => setBaplShowList((v) => !v)}>
                {baplShowList ? 'Hide list' : 'Show list'}
              </button>
            </div>
            {baplShowList && (
              <table>
                <thead><tr><th>Code</th><th>Dealer Name</th><th>City</th><th>State</th><th>Assigned Rep</th><th>Proposed Email</th><th>Real Email?</th></tr></thead>
                <tbody>
                  {baplPreview.dealers.map((d) => (
                    <tr key={d.customerCode}>
                      <td>{d.customerCode}</td><td>{d.customerName}</td><td>{d.city}</td><td>{d.state}</td>
                      <td>{d.assignedRepCode ?? '-'}</td>
                      <td>{d.proposedEmail}</td><td>{d.hasRealEmail ? 'Yes' : 'fallback'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
            <button className="btn btn-sm" onClick={() => { setBaplResult(null); setBaplPreview(null); loadBaplStatus() }}>
              Import More / Refresh
            </button>
          </div>
        )}
      </div>
      )}

      <div className="card">
        <h3>Add staff user manually</h3>
        <p className="muted">The email must exactly match the email/UPN they sign in to Azure AD with - see docs/AZURE_AD_SETUP.md. Prefer the Azure AD search above when possible, so you don't have to type it by hand.</p>
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
        <button className="btn btn-primary" disabled={!form.name || !form.email} onClick={create}>Add User</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Dealer</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.dealerName ?? 'All'}</td>
                <td>{u.active ? 'Yes' : 'No'}</td>
                <td><button className="btn btn-sm" onClick={() => toggleActive(u)}>{u.active ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
