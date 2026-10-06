// web\src\pages\staff\ItemMasterPage.tsx
import { useEffect, useMemo, useState } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplItemMaster } from '../../types'
import { Pagination } from '../../components/Pagination'
import { usePagination } from '../../lib/usePagination'

/**
 * "Item Master" sidebar page (2026-09-21: "add in sidebar option in Item master page fetch data
 * from C _ItemMaster table from baplfinal databse") - read-only browse/search over BAPL's own
 * C_ItemMaster catalog (GET /api/item-master, see BaplItemMasterRow's doc comment in
 * BaplDealerService.cs for the confirmed schema). This is the SAME table Material Transfer/Repair
 * Bill now source their per-item Dealer Price and GST% from - this page is just the human-readable
 * view of that same data, not a separate dataset. Read-only: this app never writes to baplfinal.
 *
 * No default filter the way Vehicle Sale/Repair Bill default to "Zomato" - C_ItemMaster has no
 * natural default party, so this loads the first 1000 items (server-capped) alphabetically on open,
 * same "load something useful immediately" pattern as those pages, and narrows further as you type.
 *
 * 2026-10-05 ("create this table in our Jobcard Db, fetch data from baplfinal ... show on our UI from
 * our C_ItemMaster and also in jobcard"): this page now reads JobCardScannerDb's OWN copy of C_ItemMaster
 * (the same one Job Card -> Part Suggestion searches), not baplfinal live. The copy is refreshed from
 * baplfinal with the "Sync from BAPL" button below (CorporateAdmin / SystemAdmin only - it replaces the
 * catalogue every dealer searches) and the line under the title says when that last happened. An empty
 * table / a table that hasn't been created yet is reported in plain words instead of an empty grid.
 */

interface SyncStatus {
  tableExists: boolean
  rows: number
  /** UTC, no "Z" on the wire. */
  lastSyncedAt: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')
/** DD.MM.YYYY HH:MM in IST (a fixed UTC+05:30, no DST - shifted by hand, no Intl). */
function fmtIst(iso: string | null): string {
  if (!iso) return '-'
  const utc = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
  if (Number.isNaN(utc.getTime())) return '-'
  const d = new Date(utc.getTime() + 330 * 60 * 1000)
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

type StatusFilter = '' | 'Active' | 'Inactive' | 'Discontinued'

/** A2 / B8 parts are discontinued models (only CorporateAdmin / SystemAdmin are ever sent them). */
const isDiscontinued = (it: BaplItemMaster) => /^(A2|B8)/i.test((it.itemName ?? '').trim())
/** Status as shown in the grid: N = Inactive; otherwise an A2 / B8 part = Discontinued; otherwise Active (BAPL: Y or NULL = active). */
const statusOf = (it: BaplItemMaster): Exclude<StatusFilter, ''> =>
  it.status === 'N' ? 'Inactive' : isDiscontinued(it) ? 'Discontinued' : 'Active'

export function ItemMasterPage() {
  const { hasRole } = useStaffAuth()
  const canSync = hasRole('CorporateAdmin', 'SystemAdmin')

  const [q, setQ] = useState('')
  const [items, setItems] = useState<BaplItemMaster[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const search = () => {
    setLoading(true)
    setError(null)
    staffApi
      .get<BaplItemMaster[]>('/api/item-master', { params: { q: q || undefined } })
      .then((r) => setItems(r.data))
      .catch((err) => {
        setItems([])
        setError(err?.response?.data?.message ?? 'Could not read the Item Master - check the connection and try again.')
      })
      .finally(() => setLoading(false))
  }

  const loadStatus = () => {
    staffApi
      .get<SyncStatus>('/api/item-master/sync-status')
      .then((r) => setStatus(r.data))
      .catch(() => setStatus(null))
  }

  useEffect(() => { search(); loadStatus() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handle = setTimeout(search, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const sync = () => {
    if (!window.confirm('Replace JobCardScanner\'s Item Master with a fresh copy from BAPL (baplfinal)? Every dealer\'s Item Master and Part Suggestion search will use the new data.')) return
    setSyncing(true)
    setSyncMsg(null)
    setSyncError(null)
    staffApi
      .post<{ rows: number; seconds: number }>('/api/item-master/sync', undefined, { timeout: 10 * 60 * 1000 })
      .then((r) => {
        setSyncMsg(`Synced ${r.data.rows.toLocaleString('en-IN')} spare parts from BAPL in ${r.data.seconds}s.`)
        search()
        loadStatus()
      })
      .catch((err) => setSyncError(err?.response?.data?.message ?? 'The sync failed - check the connection to BAPL and try again.'))
      .finally(() => setSyncing(false))
  }

  // 2026-10-06 ("Item Code, Item Name, Status add filtering"): column filters applied in the browser to the list the server already
  // returned (the whole catalogue for the user's role, loaded once) - instant, no extra request. They combine with each other
  // (all must match) and sit on top of the server-side "Search catalog" box above. Code / Name are "contains", case-insensitive.
  const [fCode, setFCode] = useState('')
  const [fName, setFName] = useState('')
  const [fStatus, setFStatus] = useState<StatusFilter>('')
  const filtersActive = !!(fCode.trim() || fName.trim() || fStatus)
  const filtered = useMemo(() => {
    const code = fCode.trim().toLowerCase()
    const name = fName.trim().toLowerCase()
    return items.filter((it) =>
      (!code || it.itemCode.toLowerCase().includes(code)) &&
      (!name || (it.itemName ?? it.displayName ?? '').toLowerCase().includes(name)) &&
      (!fStatus || statusOf(it) === fStatus))
  }, [items, fCode, fName, fStatus])

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(filtered)
  // A new filter always starts from the first page of its results.
  useEffect(() => { setPage(1) }, [fCode, fName, fStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  const fmtAmt = (n?: number | null) => (n == null ? '—' : `₹${n.toFixed(2)}`)
  const fmtPct = (n?: number | null) => (n == null ? '—' : `${n}%`)

  // Status as shown in the grid (see statusOf above). A2 / B8 parts are discontinued models - only an admin ever receives them.
  const statusCell = (it: BaplItemMaster) =>
    statusOf(it) === 'Inactive' ? <span className="badge badge-muted">Inactive</span>
    : statusOf(it) === 'Discontinued' ? <span className="badge badge-muted" title="A2 / B8 parts are discontinued - hidden from non-admin roles">Discontinued</span>
    : <span className="badge badge-success">Active</span>

  const neverSynced = status !== null && (!status.tableExists || status.rows === 0)

  return (
    <div>
      <h2>Item Master</h2>
      {/* <p className="muted">
        BAPL's item catalog (C_ItemMaster, baplfinal) - Dealer Price and per-item GST% (SGST/CGST/
        IGST), same source Material Transfer Bill and Repair Bill now use to auto-calculate Rate,
        MRP and tax when you pick a part. Read-only - this app never writes to baplfinal.
      </p> */}

      <p className="muted" style={{ marginTop: 0, marginBottom: 4 }}>
        {status === null ? 'Checking when the catalogue was last synced…'
          : !status.tableExists ? 'The Item Master table has not been created yet.'
          : status.rows === 0 ? ''
          : ``}
      </p>
      {/* 2026-10-06: who sees which items - CorporateAdmin / SystemAdmin see every spare part that was synced (ProductMainGroupId = 2),
         including deactivated and discontinued (A2 / B8) ones; every other role sees only active (Status Y or NULL) parts that do
         not start with A2 / B8. The filter is applied by the server (LocalItemMasterService.SearchAsync). */}
      {status !== null && status.rows > 0 && (
        <p className="muted" style={{ marginTop: 0 }}>
          {canSync
            ? ''
            : ''}
        </p>
      )}

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>Search catalog</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Item code, name, display name or HSN code" />
          </div>
        </div>
        {/* Column filters - narrow the list below by Item Code, Item Name and Status. Status only matters to admins: every other role is
           only ever sent active, continuing parts, so the dropdown is shown to CorporateAdmin / SystemAdmin only. */}
        <div className="form-row">
          <div className="field">
            <label>Item Code</label>
            <input value={fCode} onChange={(e) => setFCode(e.target.value)} placeholder="Filter by item code" />
          </div>
          <div className="field">
            <label>Item Name</label>
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Filter by item name" />
          </div>
          {canSync && (
            <div className="field">
              <label>Status</label>
              <select value={fStatus} onChange={(e) => setFStatus(e.target.value as StatusFilter)}>
                <option value="">All</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Discontinued">Discontinued (A2 / B8)</option>
              </select>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={search} disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
          {filtersActive && (
            <button className="btn" onClick={() => { setFCode(''); setFName(''); setFStatus('') }} title="Clear the Item Code / Item Name / Status filters">Clear filters</button>
          )}
          {canSync && (
            <button className="btn btn-primary" onClick={sync} disabled={syncing} title="Copy BAPL's C_ItemMaster (baplfinal) into JobCardScanner's own Item Master">
              {syncing ? 'Syncing…' : '⟳ Sync from BAPL'}
            </button>
          )}
        </div>
        {syncing && <p className="muted">Copying the catalogue from BAPL - this can take up to a minute. Please keep this page open.</p>}
        {syncMsg && <p className="muted" style={{ color: '#15803d' }}>{syncMsg}</p>}
        {syncError && <p className="muted" style={{ color: '#b91c1c' }}>{syncError}</p>}
        {error && <p className="muted" style={{ color: '#b91c1c' }}>{error}</p>}
        {neverSynced && !canSync && (
          <p className="muted" style={{ color: '#b45309' }}>An admin (Corporate / System Admin) needs to click "Sync from BAPL" before items appear here.</p>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Item Name</th>
              <th>HSN Code</th>
              <th className="text-end">Dealer Price</th>
              <th className="text-end">SGST %</th>
              <th className="text-end">CGST %</th>
              <th className="text-end">IGST %</th>
              <th className="text-end">Qty</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((it) => (
              <tr key={it.itemCode}>
                <td>{it.itemCode}</td>
                <td>{it.itemName ?? it.displayName ?? '—'}</td>
                <td>{it.hsnCode ?? '—'}</td>
                <td className="text-end">{fmtAmt(it.dlrPrice)}</td>
                <td className="text-end">{fmtPct(it.sgst)}</td>
                <td className="text-end">{fmtPct(it.cgst)}</td>
                <td className="text-end">{fmtPct(it.igst)}</td>
                <td className="text-end" title="This dealer's uploaded Part Upload stock, summed across every location - not a C_ItemMaster column. Blank means nothing uploaded yet, not 0 in stock.">{it.qty ?? '—'}</td>
                <td>{it.itemType ?? '—'}</td>
                <td>{statusCell(it)}</td>
              </tr>
            ))}
            {items.length > 0 && filtered.length === 0 && !loading && (
              <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                No items match the filters ({items.length.toLocaleString('en-IN')} loaded) - clear a filter to see more.
              </td></tr>
            )}
            {items.length === 0 && !loading && !error && (
              <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                {neverSynced ? 'Nothing to show yet - the Item Master has not been synced from BAPL.' : `No items found${q ? ` matching "${q}"` : ''}.`}
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>
    </div>
  )
}
