import { useEffect, useState } from 'react'
import { staffApi } from '../api/client'
import type { JobSearchResult } from '../types'

/**
 * "Job Search" modal (2026-09-21, "give me this and proper flow of this" - modelled on the
 * reference DMS app's own Job Search popup on its Material Transfer / Repair Bill [GST]
 * create pages: Date From/To + Job No/Registration No/Chassis Number filters, a results grid with
 * Job No/Job Date/Location/Job Type-Service Name/Party Name/Regn.-Chassis No/Vehicle Type/Job
 * Source, and a Select action per row). Shared between RepairBillCreatePage.tsx and
 * MaterialTransferCreatePage.tsx - same component, same GET /api/jobcards/search behind it.
 *
 * Built as this app's own React/global.css style (a plain fixed-overlay + `.card`), not a port of
 * the reference's Angular/Bootstrap modal markup - "ui ... according to our project" per your
 * instruction on the create pages themselves.
 *
 * 2026-09-23 ("not added grid button on this clcik open material transfered job cards history"):
 * new optional `onlyWithMaterialTransfer` prop, passed by RepairBillCreatePage.tsx's new grid
 * button (see that page's own doc comment) - when true, this reuses the SAME modal/search endpoint
 * but with `onlyWithMaterialTransfer=true` added to the GET /api/jobcards/search call
 * (JobCardsController.Search's own new param), so the results grid shows ONLY job cards that
 * already have a Material Transfer saved against them - i.e. literally "material transferred job
 * cards history" - instead of every job card. Every other caller (this page's plain "Search Job"
 * button, and MaterialTransferCreatePage.tsx's own Job Search) omits the prop and is unaffected.
 *
 * SECTION 168 (2026-09-30) "in mt and rb only open jobcard shown..only 1 is open means inprogreass
 * other already close after that shown" - the plain "Search Job" use (onlyWithMaterialTransfer
 * false/omitted) now also sends `excludeClosed=true` on the same GET /api/jobcards/search call,
 * which JobCardsController.Search already supported since SECTION 153 but no caller had ever set.
 * This hides Closed and Cancelled job cards from the results grid - only open/in-progress ones show
 * - so this modal can no longer be used to pick an already-closed job card for a new Material
 * Transfer or Repair Bill. Deliberately NOT sent when onlyWithMaterialTransfer is true (the "MT
 * History" grid-button mode): a completed Material Transfer is still valid history even after its
 * job card later closes, so that view keeps showing closed-job transfers exactly as before.
 */
type Props = {
  onSelect: (job: JobSearchResult) => void
  onClose: () => void
  onlyWithMaterialTransfer?: boolean
}

const defaultDateRange = () => {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(firstOfMonth), to: fmt(today) }
}

export function JobSearchModal({ onSelect, onClose, onlyWithMaterialTransfer = false }: Props) {
  const initial = defaultDateRange()
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [jobNo, setJobNo] = useState('')
  const [regNo, setRegNo] = useState('')
  const [chassisNo, setChassisNo] = useState('')
  const [rows, setRows] = useState<JobSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const search = () => {
    setLoading(true)
    setError(null)
    staffApi
      .get<JobSearchResult[]>('/api/jobcards/search', {
        params: {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          jobNo: jobNo || undefined,
          regNo: regNo || undefined,
          chassisNo: chassisNo || undefined,
          onlyWithMaterialTransfer: onlyWithMaterialTransfer || undefined,
          // SECTION 168 - only exclude Closed/Cancelled job cards for the plain "Search Job" use;
          // the MT History grid-button mode (onlyWithMaterialTransfer=true) keeps showing them.
          excludeClosed: onlyWithMaterialTransfer ? undefined : true,
        },
      })
      .then(({ data }) => { setRows(data); setSearched(true) })
      .catch(() => setError('Could not search job cards.'))
      .finally(() => setLoading(false))
  }
  // 2026-09-23 - grid-button mode auto-runs the search on open (Date From/To already default to
  // "this month", same as before) so the grid shows results immediately rather than an empty
  // "Set your filters and click Search" state - matching "click open material transfered job
  // cards history" (i.e. a ready history list, not another empty search form to fill in first).
  useEffect(() => { if (onlyWithMaterialTransfer) search() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 960, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{onlyWithMaterialTransfer ? 'Material Transfer Job Card History' : 'Job Search'}</h3>
          <button className="btn btn-icon" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="form-row" style={{ marginTop: 10 }}>
          <div className="field">
            <label>Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>Date To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="field">
            <label>Job No</label>
            <input value={jobNo} onChange={(e) => setJobNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="e.g. JC/288/26-27/0006" />
          </div>
          <div className="field">
            <label>Registration No</label>
            <input value={regNo} onChange={(e) => setRegNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
          </div>
          <div className="field">
            <label>Chassis Number</label>
            <input value={chassisNo} onChange={(e) => setChassisNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={search} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
          </div>
        </div>

        {error && <p className="muted" style={{ color: '#b91c1c' }}>{error}</p>}

        <div style={{ maxHeight: 420, overflowY: 'auto', marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Job No</th>
                <th>Job Date</th>
                <th>Location</th>
                <th>Job Type / Service</th>
                <th>Party Name</th>
                <th>Regn. / Chassis No.</th>
                <th>Vehicle Type</th>
                {/* <th>Job Source</th>
                <th>DMS</th> */}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td>{j.jobCardNumber}</td>
                  <td>{j.jobDate ? new Date(j.jobDate).toLocaleDateString('en-IN') : '—'}</td>
                  <td>{j.location ?? '—'}</td>
                  <td>{j.jobTypeService || '—'}</td>
                  <td>{j.partyName ?? '—'}</td>
                  <td>{j.regNo ?? '—'}{j.chassisNo ? ` / ${j.chassisNo}` : ''}</td>
                  <td>{j.vehicleType ?? '—'}</td>
                  {/* <td>{j.jobSource ?? '—'}</td>
                  <td>
                    <span className={`badge ${j.isDmsLinked ? 'badge-success' : 'badge-muted'}`}>
                      {j.isDmsLinked ? 'Synced' : 'Local only'}
                    </span>
                  </td> */}
                  <td><button className="btn btn-sm btn-primary" onClick={() => onSelect(j)}>Select</button></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                    {loading
                      ? 'Searching…'
                      : searched
                        ? (onlyWithMaterialTransfer ? 'No job cards with a Material Transfer match this search.' : 'No job cards match this search.')
                        : 'Set your filters and click Search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

