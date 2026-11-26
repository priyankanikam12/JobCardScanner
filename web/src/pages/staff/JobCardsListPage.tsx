// web\src\pages\staff\JobCardsListPage.tsx
import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { JobCardListResponse, JobCardSummary, JobCardStatus } from '../../types'
import { StatusBadge } from '../../components/StatusBadge'
import { MultiSelectDropdown } from '../../components/MultiSelectDropdown'
import './BillPages.css'

const STATUSES: JobCardStatus[] = ['Open', 'InProgress', 'PendingCustomerApproval', 'PendingQc', 'PendingClosure', 'PendingInvoice', 'Closed', 'Cancelled']

// Every boolean Dashboard KPI-card filter JobCardsController.List's own dashboard-filter query
// params support - see DashboardPage.tsx's TILES/pendingVehicles `to` links and the "Job Cards by
// Status" chart's onClick. Read straight off the URL below so a deep-link works the same whether
// it's a fresh navigation or a bookmarked/shared link.
const DASHBOARD_FILTER_KEYS = ['excludeClosed', 'overdue', 'createdToday', 'deliveredToday', 'closedThisMonth', 'warrantyOnly', 'pendingBucket'] as const

// A row's own detail route - shared by the row's onClick below and each inner Link's href, so
// they can never disagree about where a given row goes.
function detailRoute(jc: JobCardSummary): string {
  return jc.source === 'BaplDms'
    // jc.id is "bapl-{JobCardHeaderId}" (see JobCardsController.SummarizeBapl) - strip the prefix
    // back to the numeric id the read-only detail route wants.
    ? `/jobcards/bapl/${jc.id.replace(/^bapl-/, '')}`
    : `/jobcards/${jc.id}`
}

export function JobCardsListPage() {
  // Dashboard Quick Links / KPI cards / "Job Cards by Status" chart deep-link here as e.g.
  // /jobcards?status=PendingCustomerApproval, /jobcards?stageKey=part_suggestion, or
  // /jobcards?excludeClosed=true - read once on mount so a linked-to filter is applied immediately
  // instead of showing the unfiltered list first.
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { hasRole, profile } = useStaffAuth()
  // 2026-10-12 ("on systemadmin and corporateadmin login the job card list shows who created the job card"): head-office logins get a "Created By" column after Created.
  const showCreatedBy = hasRole('CorporateAdmin', 'SystemAdmin')
  const [createdByMap, setCreatedByMap] = useState<Record<string, string>>({})
  const [jobCards, setJobCards] = useState<JobCardSummary[]>([])
  // Non-null only when a real DMS problem (not "this dealer has no DMS data", which is
  // normal and silent) kept its job cards out of the blended list below.
  const [baplDmsWarning, setBaplDmsWarning] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<string[]>(() => (searchParams.get('status') ? [searchParams.get('status') as string] : []))
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
  // 2026-11-26 (more filters): chassis no, created date range for everyone; Dealer + Designation (Captain / ViceCaptain / Other) + Created By for Corporate Admin / System Admin.
  const [chassisNo, setChassisNo] = useState('')
  // 2026-11-26: Created from / to start as "this month" (1st .. today, local date). Not applied when the page was opened from a Dashboard KPI / status link, so those lists are not cut to this month.
  const thisMonth = (() => {
    const t = new Date()
    const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { from: f(new Date(t.getFullYear(), t.getMonth(), 1)), to: f(t) }
  })()
  const fromDeepLink = Array.from(searchParams.keys()).length > 0
  const [dateFrom, setDateFrom] = useState(fromDeepLink ? '' : thisMonth.from)
  const [dateTo, setDateTo] = useState(fromDeepLink ? '' : thisMonth.to)
  // 2026-11-26 (multi-select checkbox dropdowns): every list filter holds several ticked values; nothing ticked = no filter. Sent to the API as comma-separated lists.
  const [dealerIds, setDealerIds] = useState<string[]>([])
  const [designations, setDesignations] = useState<string[]>([])
  const [createdByIds, setCreatedByIds] = useState<string[]>([])
  const [locationCodes, setLocationCodes] = useState<string[]>([])
  const [dealers, setDealers] = useState<{ id: string; name: string }[]>([])
  const [people, setPeople] = useState<{ id: string; name: string; designation: string | null; active?: boolean }[]>([])
  const [workshops, setWorkshops] = useState<{ locCode: string; locName: string }[]>([])
  const [loading, setLoading] = useState(true)

  const clearDashboardFilter = Object.keys(dashboardFilter).length > 0

  const load = () => {
    setLoading(true)
    staffApi
      .get<JobCardListResponse>('/api/jobcards', {
        params: {
          statuses: statuses.join(',') || undefined, stageKey: stageKey || undefined, q: q || undefined,
          chassisNo: chassisNo.trim() || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
          dealerIds: showCreatedBy ? dealerIds.join(',') || undefined : undefined,
          createdByDesignations: showCreatedBy ? designations.join(',') || undefined : undefined,
          createdByIds: showCreatedBy ? createdByIds.join(',') || undefined : undefined,
          locationCodes: locationCodes.join(',') || undefined,
          ...dashboardFilter,
        },
      })
      .then((res) => { setJobCards(res.data.items); setBaplDmsWarning(res.data.baplDmsWarning ?? null) })
      .finally(() => setLoading(false))
  }

  const filterKey = [statuses, dealerIds, designations, createdByIds, locationCodes].map((a) => a.join('|')).join('~')
  useEffect(load, [filterKey, stageKey, dateFrom, dateTo])

  // Dealer list (head office only); the picked dealers' people feed the Created By list.
  useEffect(() => {
    if (!showCreatedBy) return
    staffApi.get<{ id: string; name: string }[]>('/api/dealers').then(({ data }) => setDealers(data)).catch(() => setDealers([]))
  }, [showCreatedBy])
  const dealerKey = dealerIds.join('|')
  useEffect(() => {
    setCreatedByIds([])
    setLocationCodes([])
    if (!showCreatedBy || dealerIds.length === 0) { setPeople([]); return }
    Promise.all(dealerIds.map((id) => staffApi.get<{ id: string; name: string; designation: string | null; active?: boolean }[]>('/api/users', { params: { dealerId: id } }).then((r) => r.data).catch(() => [])))
      .then((lists) => setPeople(lists.flat()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealerKey, showCreatedBy])

  // Service locations: a dealer login sees its own dealer's locations (limited to its Work Area); head office sees them once exactly one dealer is picked.
  const wsDealerId = showCreatedBy ? (dealerIds.length === 1 ? dealerIds[0] : '') : (profile?.dealerId ?? '')
  useEffect(() => {
    if (!wsDealerId) { setWorkshops([]); return }
    staffApi.get<{ locCode: string; locName: string }[]>('/api/bapl-dms/workshops', { params: { dealerId: wsDealerId } })
      .then(({ data }) => {
        const mine = (!showCreatedBy && profile?.workLocationCodes?.length) ? profile.workLocationCodes.map((c) => c.trim().toLowerCase()) : null
        setWorkshops(mine ? data.filter((w) => mine.includes((w.locCode ?? '').trim().toLowerCase())) : data)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsDealerId, showCreatedBy])

  const isCaptainOrVice = (d: string | null) => d === 'Captain' || d === 'ViceCaptain'
  const peopleShown = people.filter((p) =>
    designations.length === 0 ? true
      : (designations.includes('Other') && !isCaptainOrVice(p.designation)) || (p.designation != null && designations.includes(p.designation)))
  const hasAnyFilter = statuses.length + dealerIds.length + designations.length + createdByIds.length + locationCodes.length > 0 || !!(q || chassisNo) || dateFrom !== thisMonth.from || dateTo !== thisMonth.to
  const clearFilters = () => { setStatuses([]); setDealerIds([]); setDesignations([]); setCreatedByIds([]); setLocationCodes([]); setQ(''); setChassisNo(''); setDateFrom(thisMonth.from); setDateTo(thisMonth.to) }

  // Item 11: search-as-you-type (debounced) instead of requiring Enter/the Search button -
  // matches the type-ahead pattern used elsewhere in the app (chassis/reg-no lookup, Part/Labour
  // Suggestion). The backend query (/api/jobcards?q=) already does a substring Contains() match
  // on job card #, customer name/mobile and reg no, so this just makes it fire automatically.
  useEffect(() => {
    const handle = setTimeout(load, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, chassisNo])

  // 2026-10-12: who created each job card on the page - one POST for the page's own (JobCardScanner) job cards, only for CorporateAdmin / SystemAdmin. The DMS-sourced rows have no
  // creator here and show "-".
  useEffect(() => {
    if (!showCreatedBy) return
    const ids = jobCards.filter((j) => j.source !== 'BaplDms').map((j) => j.id)
    if (ids.length === 0) return
    let cancelled = false
    staffApi
      .post<{ id: string; createdByName: string | null }[]>('/api/jobcards/created-by', { ids })
      .then(({ data }) => {
        if (cancelled) return
        setCreatedByMap((prev) => ({ ...prev, ...Object.fromEntries(data.map((d) => [d.id, d.createdByName ?? '-'])) }))
      })
      .catch(() => { /* best-effort - the column just shows "-" */ })
    return () => { cancelled = true }
  }, [jobCards, showCreatedBy])

  return (
    <div className="jcx">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Job Cards</h2>
        <Link className="btn btn-primary" to="/jobcards/new">+ New Job Card</Link>
      </div>

      {/* overflow: visible - the card's own CSS clips its content, which cut the checkbox lists off inside the card. */}
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', overflow: 'visible', position: 'relative', zIndex: 5 }}>
        <div className="field" style={{ marginBottom: 0, flex: '1 1 260px' }}>
          <label>Search</label>
          <input placeholder="Job card #, customer, reg no, chassis no..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 200 }}>
          <label>Chassis No.</label>
          <input placeholder="Chassis no..." value={chassisNo} onChange={(e) => setChassisNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 160 }}>
          <label>Created from</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 160 }}>
          <label>Created to</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <MultiSelectDropdown label="Status" allLabel="All statuses" options={STATUSES.map((s) => ({ value: s, label: s }))} selected={statuses} onChange={setStatuses} />
        {showCreatedBy && (
          <>
            <MultiSelectDropdown label="Dealer" allLabel="All dealers" width={240} options={dealers.map((d) => ({ value: d.id, label: d.name }))} selected={dealerIds} onChange={setDealerIds} />
            <MultiSelectDropdown
              label="Role (created by)" allLabel="All roles" disabled={dealerIds.length === 0}
              options={[{ value: 'Captain', label: 'Captain' }, { value: 'ViceCaptain', label: 'Vice Captain' }, { value: 'Other', label: 'Other roles' }]}
              selected={designations} onChange={setDesignations}
            />
            <MultiSelectDropdown
              label="Created by" allLabel={dealerIds.length === 0 ? 'Pick a dealer first' : 'Everyone'} disabled={dealerIds.length === 0} width={220}
              options={peopleShown.map((p) => ({ value: p.id, label: p.name, hint: p.designation ?? undefined }))} selected={createdByIds} onChange={setCreatedByIds}
            />
          </>
        )}
        {workshops.length > 0 && (
          <MultiSelectDropdown label="Service location" allLabel="All locations" width={220} options={workshops.map((w) => ({ value: w.locCode, label: `${w.locName} (${w.locCode})` }))} selected={locationCodes} onChange={setLocationCodes} />
        )}
        <button className="btn" onClick={load}>Search</button>
        {hasAnyFilter && <button className="btn" onClick={clearFilters}>Clear filters</button>}
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
                <th>Job Card #</th><th>Customer</th><th>Vehicle</th><th>Stage</th><th>Status</th><th>Technician</th><th>Created</th>
                {showCreatedBy && <th>Created By</th>}
                <th>Photos</th>
              </tr>
            </thead>
            <tbody>
              {jobCards.map((jc) => {
                const isBapl = jc.source === 'BaplDms'
                // Reported directly: "any place click on jobcard then open jobcard now only
                // jobcard open when click Job card no" - previously only the Job Card # cell had
                // a Link, so clicking the customer/vehicle/stage/status/technician/created cells
                // did nothing. The whole row now opens the job card; the inner Links (Job Card #,
                // the Photos jump-to-anchor) keep their own more specific destination by stopping
                // the click from also reaching the row's onClick below - otherwise both handlers
                // would fire on the same click and the row's plain detailRoute(jc) would win over
                // e.g. the Photos link's more specific "#photos" anchor.
                const stopRowClick = (e: MouseEvent) => e.stopPropagation()
                return (
                  <tr key={jc.id} onClick={() => navigate(detailRoute(jc))} style={{ cursor: 'pointer' }}>
                    <td>
                      {isBapl ? (
                        <>
                          <Link to={detailRoute(jc)} onClick={stopRowClick}>{jc.jobCardNumber}</Link>
                          <div><span style={{ background: '#1c64f2', color: '#fff', fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 999 }}>DMS</span></div>
                        </>
                      ) : (
                        <Link to={detailRoute(jc)} onClick={stopRowClick}>{jc.jobCardNumber}</Link>
                      )}
                    </td>
                    <td>{jc.customerName}<div className="muted">{jc.customerMobile}</div></td>
                    {/* <td>{jc.vehicleModel}<div className="muted">{jc.vehicleRegNo}</div></td> */}
                    <td>
                      {jc.vehicleModel}
                      <div className="muted">{jc.vehicleRegNo}</div>
                      <div className="muted">{jc.vehicleChassisNo ?? '-'}</div>
                    </td>
                    <td>{isBapl ? <span className="muted">-</span> : jc.stageLabel}</td>
                    <td><StatusBadge status={jc.status} /></td>
                    <td>{jc.technicianName ?? '-'}</td>
                    <td>{jc.createdAt ? new Date(jc.createdAt).toLocaleDateString() : '-'}</td>
                    {showCreatedBy && <td>{isBapl ? '-' : createdByMap[jc.id] ?? '…'}</td>}
                    <td>
                      {isBapl ? (
                        <span className="muted">-</span>
                      ) : jc.photoCount ? (
                        // Item 10: media is viewable straight from the list now - jumps to the
                        // Photos section on the job card instead of just showing a bare count.
                        <Link to={`/jobcards/${jc.id}#photos`} onClick={stopRowClick}>📷 {jc.photoCount}</Link>
                      ) : (
                        <span className="muted">📷 0</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {jobCards.length === 0 && (
                <tr><td colSpan={showCreatedBy ? 9 : 8} className="muted" style={{ textAlign: 'center', padding: 24 }}>No job cards found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

