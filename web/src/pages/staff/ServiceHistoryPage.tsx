import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import type { DmsBaplDataServiceHistory, DmsBaplDataServiceHistorySuggestion } from '../../types'
import { ReportDownloadButtons } from '../../components/ReportDownloadButtons'
import { Pagination } from '../../components/Pagination'
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '../../lib/exportReport'
import { usePagination } from '../../lib/usePagination'

// 2026-09-18 "download report excel pdf download button insert in starting row" - same convention
// as Vehicle Sale/Repair Bill/Material Transfer: a flat column set for both Excel and PDF export,
// a superset of what the on-screen grid shows.
const REPORT_COLUMNS: ReportColumn<DmsBaplDataServiceHistory>[] = [
  { header: 'Job No', value: (s) => s.jobNo ?? '' },
  { header: 'Job Date', value: (s) => (s.jobDate ? new Date(s.jobDate).toLocaleDateString('en-IN') : '') },
  { header: 'Dealer', value: (s) => s.compName ?? s.dealerCode ?? '' },
  { header: 'Chassis No', value: (s) => s.chassisNo ?? '' },
  { header: 'Reg No', value: (s) => s.regNo ?? '' },
  { header: 'Model', value: (s) => s.model ?? '' },
  { header: 'Party Name', value: (s) => s.partyName ?? '' },
  { header: 'Mobile', value: (s) => s.mobileNumber ?? '' },
  { header: 'Job Head', value: (s) => s.serviceHead ?? '' },
  { header: 'Job Type', value: (s) => s.jobType ?? '' },
  { header: 'KMS', value: (s) => s.kms ?? '' },
  { header: 'Mechanic', value: (s) => s.technician ?? '' },
  { header: 'Supervisor', value: (s) => s.supervisor ?? '' },
  { header: 'Job Status', value: (s) => s.jobStatus ?? '' },
  { header: 'Invoice Date', value: (s) => (s.invoiceDate ? new Date(s.invoiceDate).toLocaleDateString('en-IN') : '') },
  { header: 'Net Total', value: (s) => s.netTotal ?? '' },
]

/**
 * "Service History" sidebar page (2026-09-18: "here i want after Jobcards this table Servive
 * History From DMSBAPLDATA databse ... search chasis or reg in 1 input box dont add filter by").
 *
 * 2026-09-18 REVISION - "like in jobcard in search by chassisno. how it after p6 search or reg no.
 * search in dropdown suggetion and that chasiis data in form show like attached pdf format with
 * any search cahssis all data shown in below grid": the first version's plain "type a value, hit
 * Search" box had a real problem you ran into - DMS_ServiceHistory is searched with a substring
 * match (LIKE '%value%'), so a short/partial value like "P6" alone can match a large share of
 * chassis numbers (most contain common letters somewhere in the middle), making the result look
 * like "the whole table" came back. The fix: the same typeahead SHAPE the Job Card wizard's "Search
 * by chassis no. / registration no." box uses (2-char minimum, 300ms debounce, dropdown of matches)
 * so you always end up searching with ONE real, exact chassis/reg no. - never a bare fragment.
 *
 * 2026-09-18 FURTHER REVISION - "its taken from jobcard i want fetch data in service history from
 * [DMS_ServiceHistory query]": the dropdown initially reused the wizard's OWN endpoint
 * (/api/bapl-dms/vehicle-suggestions), which searches BAPL DMS's live ChassisDetails table - a sale/
 * stock record, not a service one. That could suggest a sold vehicle with zero service visits (pick
 * it here and you'd just get "no service history found"), or miss a vehicle whose ChassisDetails row
 * doesn't cleanly match. Suggestions now come from a dedicated endpoint
 * (GET /api/dms-bapl-data/service-history/suggestions) that queries DMS_ServiceHistory itself,
 * grouped by ChassisNo - see DmsBaplDataServiceHistorySuggestion's doc comment in
 * DmsBaplDataService.cs. Every suggestion shown here is guaranteed to have at least one real history
 * row, and the dropdown now shows "Last service: <date>" instead of a sale date.
 *
 * "that chassis data in form show" - a Vehicle Info summary card up top (Chassis No/Reg No/Model/
 * Party Name/Mobile/most recent Dealership), built from the most recent DMS_ServiceHistory row for
 * that vehicle - styled after the legacy report PDF's bordered info block, though NOT a field-for-
 * field copy of it: the PDF's own "Vehicle Info" box (Sold Through/Booking/Lead Date) is Vehicle
 * SALE data (DMS_VehicleSales, a different table - see the Vehicle Sale sidebar page for that), not
 * anything DMS_ServiceHistory itself carries, so those specific fields aren't fabricated here.
 *
 * "any search cahssis all data shown in below grid" - once a vehicle is picked, EVERY
 * DMS_ServiceHistory row for that exact chassis/reg (every past service visit) is listed in the
 * grid below the summary card, paginated the same way as the other DMSBAPLDATA pages.
 *
 * FACT (unchanged from the first version): DMS_ServiceHistory carries job-level TOTALS only - no
 * Item/Labour/Battery line-item table exists behind it in DMSBAPLDATA, unlike DMS_RepairBill (which
 * has DMS_RepairBillItem). The legacy PDF's per-part/labour/battery breakdown can't be reproduced
 * from this table, so the grid below is one row per job/visit, not an expandable line-item panel.
 */
export function ServiceHistoryPage() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<DmsBaplDataServiceHistorySuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  const [searchedFor, setSearchedFor] = useState<string | null>(null)
  const [rows, setRows] = useState<DmsBaplDataServiceHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Same debounce/min-length shape as JobCardWizardPage.tsx's chassis/reg typeahead, but querying
  // DMS_ServiceHistory itself (see this component's doc comment for why the endpoint changed from
  // the wizard's own /api/bapl-dms/vehicle-suggestions).
  useEffect(() => {
    if (!showSuggestions || query.trim().length < 2) { setSuggestions([]); return }
    const handle = setTimeout(() => {
      staffApi
        .get<DmsBaplDataServiceHistorySuggestion[]>('/api/dms-bapl-data/service-history/suggestions', { params: { q: query.trim(), take: 20 } })
        .then(({ data }) => setSuggestions(data))
        .catch(() => setSuggestions([]))
    }, 300)
    return () => clearTimeout(handle)
  }, [query, showSuggestions])

  const search = (value?: string) => {
    const term = (value ?? query).trim()
    if (!term) {
      setError('Enter a Chassis No. or Reg No. to search.')
      return
    }
    setShowSuggestions(false)
    setLoading(true)
    setError(null)
    staffApi
      .get<DmsBaplDataServiceHistory[]>('/api/dms-bapl-data/service-history', { params: { search: term } })
      .then((r) => {
        setRows(r.data)
        setSearchedFor(term)
      })
      .catch((err) => {
        setRows([])
        setError(err?.response?.data?.message ?? 'Could not reach DMSBAPLDATA - check the connection and try again.')
      })
      .finally(() => setLoading(false))
  }

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(rows)

  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN') : '—')
  const fmtAmt = (n?: number | null) => (n == null ? '—' : `₹${n.toFixed(2)}`)

  // Most recent row (rows already come back ordered JobDate DESC, Id DESC from the backend) - the
  // "Vehicle Info" summary card's source. Vehicle-identity fields (Chassis/Reg/Model) don't change
  // between visits; Party/Mobile/Dealership are shown from this latest visit specifically, since
  // those CAN change across a vehicle's history (resale, service at a different dealer - exactly
  // what the legacy PDF's own sample rows for one chassis showed across different jobs).
  const latest = rows[0]

  return (
    <div>
      <h2>Service History</h2>
      <p className="muted">
        Synced service job history from DMSBAPLDATA. Search by Chassis No. or Reg No. Read-only -
        this app never writes to DMSBAPLDATA.
      </p>

      {/* 2026-09-18 "this also override fix this" - .card's own CSS sets overflow-x: auto (so wide
          tables scroll inside their card instead of the whole page) - but per the CSS spec, setting
          only overflow-x forces overflow-y to compute as auto too, which clipped this dropdown down
          to a tiny scrollable sliver instead of letting it float freely below the input. Overriding
          both axes back to visible here, inline (higher specificity than the class), fixes this
          card specifically without touching the shared .card rule every other page still relies on
          for its own wide-table scrolling. */}
      <div className="card" style={{ marginBottom: 12, position: 'relative', overflow: 'visible' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 200 }}>
            <input
              type="text"
              placeholder="Chassis no. or registration no. (e.g. P6)"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true) }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={(e) => { if (e.key === 'Enter') search() }}
              autoComplete="off"
              style={{ width: '100%' }}
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul style={{
                position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 2,
                background: 'var(--card-bg, #fff)', border: '1px solid var(--border)', borderRadius: 8,
                maxHeight: 240, overflowY: 'auto', listStyle: 'none', padding: 4, boxShadow: '0 6px 18px rgba(0,0,0,.12)',
              }}>
                {suggestions.map((s) => (
                  <li key={s.chassisNo}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '6px 8px' }}
                      onMouseDown={(e) => { e.preventDefault(); setQuery(s.chassisNo); search(s.chassisNo) }}
                    >
                      <strong>{s.chassisNo}</strong>{s.regNo ? ` · ${s.regNo}` : ''}{s.model ? ` — ${s.model}` : ''}
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted, #6b7280)' }}>
                        Last service: {s.lastJobDate ? fmtDate(s.lastJobDate) : '—'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => search()} disabled={loading || !query.trim()}>
            {loading ? 'Searching…' : '🔍 Search'}
          </button>
        </div>
      </div>

      {error && <p className="muted" style={{ color: '#b91c1c' }}>{error}</p>}

      {searchedFor && !error && rows.length === 0 && !loading && (
        <p className="muted">No service history found for "{searchedFor}".</p>
      )}

      {searchedFor && latest && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Vehicle Info</h3>
            <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <div><label>Chassis No</label><div>{latest.chassisNo ?? '—'}</div></div>
              <div><label>Reg No</label><div>{latest.regNo ?? '—'}</div></div>
              <div><label>Model</label><div>{latest.model ?? '—'}</div></div>
              <div><label>Brand</label><div>{latest.brandName ?? '—'}</div></div>
              <div><label>Party Name (latest visit)</label><div>{latest.partyName ?? '—'}</div></div>
              <div><label>Mobile (latest visit)</label><div>{latest.mobileNumber ?? '—'}</div></div>
              <div><label>Dealership (latest visit)</label><div>{latest.compName ?? latest.dealerCode ?? '—'}</div></div>
              <div><label>Total Visits</label><div>{total}</div></div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <ReportDownloadButtons
              disabled={rows.length === 0}
              onExcel={() => exportReportToExcel('Service_History_Report', REPORT_COLUMNS, rows)}
              onPdf={() => exportReportToPdf('Service History Report', 'Service_History_Report', REPORT_COLUMNS, rows)}
            />
          </div>

          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Job No</th>
                  <th>Job Date</th>
                  <th>Dealer</th>
                  <th>Party Name</th>
                  <th>Job Head / Type</th>
                  <th>KMS</th>
                  <th>Mechanic</th>
                  <th>Supervisor</th>
                  <th>Status</th>
                  <th className="text-end">Net Total</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((s) => (
                  <tr key={s.id}>
                    <td>{s.jobNo ?? '—'}</td>
                    <td>{fmtDate(s.jobDate)}</td>
                    <td>{s.compName ?? s.dealerCode ?? '—'}</td>
                    <td>{s.partyName ?? '—'}</td>
                    <td>{[s.serviceHead, s.jobType].filter(Boolean).join(' / ') || '—'}</td>
                    <td>{s.kms ?? '—'}</td>
                    <td>{s.technician ?? '—'}</td>
                    <td>{s.supervisor ?? '—'}</td>
                    <td>{s.jobStatus ?? '—'}</td>
                    <td className="text-end">{fmtAmt(s.netTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
          </div>
        </>
      )}
    </div>
  )
}
