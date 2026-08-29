import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import type { JobCardListResponse, JobCardSummary, JobCardStatus } from '../../types'
import { StatusBadge } from '../../components/StatusBadge'

const STATUSES: JobCardStatus[] = ['Open', 'InProgress', 'PendingCustomerApproval', 'PendingQc', 'PendingClosure', 'PendingInvoice', 'Closed', 'Cancelled']

export function JobCardsListPage() {
  // Dealer Dashboard's Quick Links deep-link here as e.g. /jobcards?status=PendingCustomerApproval
  // or /jobcards?stageKey=parts_requested - read once on mount so a linked-to filter is applied
  // immediately instead of showing the unfiltered list first.
  const [searchParams] = useSearchParams()
  const [jobCards, setJobCards] = useState<JobCardSummary[]>([])
  // Non-null only when a real BAPL DMS problem (not "this dealer has no BAPL DMS data", which is
  // normal and silent) kept its job cards out of the blended list below.
  const [baplDmsWarning, setBaplDmsWarning] = useState<string | null>(null)
  const [status, setStatus] = useState<string>(() => searchParams.get('status') ?? '')
  const [stageKey] = useState<string>(() => searchParams.get('stageKey') ?? '')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    staffApi
      .get<JobCardListResponse>('/api/jobcards', { params: { status: status || undefined, stageKey: stageKey || undefined, q: q || undefined } })
      .then((res) => { setJobCards(res.data.items); setBaplDmsWarning(res.data.baplDmsWarning ?? null) })
      .finally(() => setLoading(false))
  }

  useEffect(load, [status, stageKey])

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
                          <div><span style={{ background: '#1c64f2', color: '#fff', fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 999 }}>BAPL DMS</span></div>
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
                    <td>{isBapl ? <span className="muted">-</span> : `📷 ${jc.photoCount ?? 0}`}</td>
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
