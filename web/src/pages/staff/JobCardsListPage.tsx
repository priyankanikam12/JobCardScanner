// web\src\pages\staff\JobCardsListPage.tsx
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import type { JobCardListResponse, JobCardSummary, JobCardStatus } from '../../types'
import { StatusBadge } from '../../components/StatusBadge'

const STATUSES: JobCardStatus[] = ['Open', 'InProgress', 'PendingCustomerApproval', 'PendingQc', 'PendingClosure', 'PendingInvoice', 'Closed', 'Cancelled']

// Every boolean Dashboard KPI-card filter JobCardsController.List's own dashboard-filter query
// params support - see DashboardPage.tsx's TILES/pendingVehicles `to` links and the "Job Cards by
// Status" chart's onClick. Read straight off the URL below so a deep-link works the same whether
// it's a fresh navigation or a bookmarked/shared link.
const DASHBOARD_FILTER_KEYS = ['excludeClosed', 'overdue', 'createdToday', 'deliveredToday', 'closedThisMonth', 'warrantyOnly', 'pendingBucket'] as const

export function JobCardsListPage() {
  // Dashboard Quick Links / KPI cards / "Job Cards by Status" chart deep-link here as e.g.
  // /jobcards?status=PendingCustomerApproval, /jobcards?stageKey=part_suggestion, or
  // /jobcards?excludeClosed=true - read once on mount so a linked-to filter is applied immediately
  // instead of showing the unfiltered list first.
  const [searchParams] = useSearchParams()
  const [jobCards, setJobCards] = useState<JobCardSummary[]>([])
  // Non-null only when a real BAPL DMS problem (not "this dealer has no BAPL DMS data", which is
  // normal and silent) kept its job cards out of the blended list below.
  const [baplDmsWarning, setBaplDmsWarning] = useState<string | null>(null)
  const [status, setStatus] = useState<string>(() => searchParams.get('status') ?? '')
  const [stageKey] = useState<string>(() => searchParams.get('stageKey') ?? '')
  const [dashboardFilter] = useState<Record<string, string>>(() => {
    const found: Record<string, string> = {}
    for (const key of DASHBOARD_FILTER_KEYS) {
      const value = searchParams.get(key)
      if (value) found[key] = value
    }
    return found
  })
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const clearDashboardFilter = Object.keys(dashboardFilter).length > 0

  const load = () => {
    setLoading(true)
    staffApi
      .get<JobCardListResponse>('/api/jobcards', { params: { status: status || undefined, stageKey: stageKey || undefined, q: q || undefined, ...dashboardFilter } })
      .then((res) => { setJobCards(res.data.items); setBaplDmsWarning(res.data.baplDmsWarning ?? null) })
      .finally(() => setLoading(false))
  }

  useEffect(load, [status, stageKey])

  // Item 11: search-as-you-type (debounced) instead of requiring Enter/the Search button -
  // matches the type-ahead pattern used elsewhere in the app (chassis/reg-no lookup, Part/Labour
  // Suggestion). The backend query (/api/jobcards?q=) already does a substring Contains() match
  // on job card #, customer name/mobile and reg no, so this just makes it fire automatically.
  useEffect(() => {
    const handle = setTimeout(load, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Job Cards</h2>
        <Link className="btn btn-primary" to="/jobcards/new">+ New Job Card</Link>
      </div>

      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0, flex: 1 }}>
          <label>Search</label>
          <input placeholder="Job card #, customer, reg no..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 220 }}>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button className="btn" onClick={load}>Search</button>
      </div>

      {clearDashboardFilter && (
        <p style={{ marginTop: -8 }}>
          <span className="badge" style={{ marginRight: 8 }}>
            Filtered from Dashboard: {Object.entries(dashboardFilter).map(([k, v]) => `${k}=${v}`).join(', ')}
          </span>
          {/* A full navigation (not client-side routing) - dashboardFilter is only ever read once
             from the URL on mount, so clearing it needs a fresh page load rather than trying to
             reset in-place state for what's meant to be a one-off deep-link landing. */}
          <a href="/jobcards" className="btn btn-sm">Clear filter</a>
        </p>
      )}

      {baplDmsWarning && <p className="muted" style={{ marginTop: -8 }}>⚠ {baplDmsWarning}</p>}

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 16 }}>Loading...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Job Card #</th><th>Customer</th><th>Vehicle</th><th>Stage</th><th>Status</th><th>Technician</th><th>Created</th><th>Photos</th>
              </tr>
            </thead>
            <tbody>
              {jobCards.map((jc) => {
                const isBapl = jc.source === 'BaplDms'
                return (
                  <tr key={jc.id}>
                    <td>
                      {isBapl ? (
                        <>
                          {/* jc.id is "bapl-{JobCardHeaderId}" (see JobCardsController.SummarizeBapl) -
                             strip the prefix back to the numeric id the read-only detail route wants. */}
                          <Link to={`/jobcards/bapl/${jc.id.replace(/^bapl-/, '')}`}>{jc.jobCardNumber}</Link>
                          <div><span style={{ background: '#1c64f2', color: '#fff', fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 999 }}>DMS</span></div>
                        </>
                      ) : (
                        <Link to={`/jobcards/${jc.id}`}>{jc.jobCardNumber}</Link>
                      )}
                    </td>
                    <td>{jc.customerName}<div className="muted">{jc.customerMobile}</div></td>
                    <td>{jc.vehicleModel}<div className="muted">{jc.vehicleRegNo}</div></td>
                    <td>{isBapl ? <span className="muted">-</span> : jc.stageLabel}</td>
                    <td><StatusBadge status={jc.status} /></td>
                    <td>{jc.technicianName ?? '-'}</td>
                    <td>{jc.createdAt ? new Date(jc.createdAt).toLocaleDateString() : '-'}</td>
                    <td>
                      {isBapl ? (
                        <span className="muted">-</span>
                      ) : jc.photoCount ? (
                        // Item 10: media is viewable straight from the list now - jumps to the
                        // Photos section on the job card instead of just showing a bare count.
                        <Link to={`/jobcards/${jc.id}#photos`}>📷 {jc.photoCount}</Link>
                      ) : (
                        <span className="muted">📷 0</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {jobCards.length === 0 && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>No job cards found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

