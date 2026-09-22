// web\src\components\JobSearchModal.tsx
import { useState } from 'react'
import { staffApi } from '../api/client'
import type { JobSearchResult } from '../types'

/**
 * "Job Search" modal (2026-09-21, "give me this and proper flow of this" - modelled on the
 * reference BAPL DMS app's own Job Search popup on its Material Transfer / Repair Bill [GST]
 * create pages: Date From/To + Job No/Registration No/Chassis Number filters, a results grid with
 * Job No/Job Date/Location/Job Type-Service Name/Party Name/Regn.-Chassis No/Vehicle Type/Job
 * Source, and a Select action per row). Shared between RepairBillCreatePage.tsx and
 * MaterialTransferCreatePage.tsx - same component, same GET /api/jobcards/search behind it.
 *
 * Built as this app's own React/global.css style (a plain fixed-overlay + `.card`), not a port of
 * the reference's Angular/Bootstrap modal markup - "ui ... according to our project" per your
 * instruction on the create pages themselves.
 */
type Props = {
  onSelect: (job: JobSearchResult) => void
  onClose: () => void
}

const defaultDateRange = () => {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(firstOfMonth), to: fmt(today) }
}

export function JobSearchModal({ onSelect, onClose }: Props) {
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
        },
      })
      .then(({ data }) => { setRows(data); setSearched(true) })
      .catch(() => setError('Could not search job cards.'))
      .finally(() => setLoading(false))
  }

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
          <h3 style={{ margin: 0 }}>Job Search</h3>
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
                  
                  <td><button className="btn btn-sm btn-primary" onClick={() => onSelect(j)}>Select</button></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                    {searched ? 'No job cards match this search.' : loading ? 'Searching…' : 'Set your filters and click Search.'}
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
