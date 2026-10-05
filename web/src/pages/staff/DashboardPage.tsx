// web\src\pages\staff\DashboardPage.tsx
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import { NAV_ITEMS, useMenuAccess } from '../../components/StaffLayout'
import type { CorporateDashboardData, CorporateDashboardFilters, DashboardKpis } from '../../types'
// import { isReportDealer } from '../../lib/reportDealers'
import type { DealerStageSummary } from '../../lib/dealerRoleReportExport'

// 2026-09-18 "in dashboardpage add this all page landing page linking" - every sidebar destination,
// as its own clickable card, so the dashboard works as a landing page to the whole app and not just
// the 4 hand-picked shortcuts in ACTION_CARDS/CORPORATE_ACTION_CARDS below. Reuses StaffLayout's own
// NAV_ITEMS (now exported) rather than a second hand-maintained list, so a page's role-gating can't
// drift between the sidebar and this grid - Dashboard itself is excluded since you're already on it.
//
// SECTION 171 (2026-09-30) "i checkbox select from DealerAdmin only 3 page but all option shown in
// sidebar as well on dashboard": this grid used to filter ALL_PAGES with a plain
// `!n.roles || hasRole(...n.roles)` check - each item's hardcoded default `roles` only, completely
// bypassing both the Menu Access per-item overrides and the SECTION 170 per-role allow-list mode.
// So turning on "Only show checked items" for DealerAdmin and checking exactly 3 items correctly
// hid everything else from the SIDEBAR, but this grid kept showing every page regardless. Fixed
// below by filtering with the same useMenuAccess().isVisibleForCurrentRole (StaffLayout.tsx) the
// sidebar itself now uses, instead of a second, drifted copy of the same check.
const ALL_PAGES = NAV_ITEMS.filter((n) => n.to !== '/dashboard')

/**
 * The dashboard branches by role, same as the two screens this was modelled on: everyone
 * dealer-side (Service Advisor up to Dealer Admin, plus Technician/Parts/Cashier) gets the
 * single-dealer "Dealer Dashboard" - today's ops board; Corporate/System Admin get the
 * "Corporate Dashboard" - filterable roll-up across every dealer.
 */
export function DashboardPage() {
  const { hasRole } = useStaffAuth()
  return hasRole('CorporateAdmin', 'SystemAdmin') ? <CorporateDashboard /> : <DealerDashboard />
}

// ==================== Dealer Dashboard ====================

// Each tile's `to` is the exact /jobcards filter that reproduces the number on the card - these
// param names match JobCardsController.List's new dashboard-filter params 1:1 (excludeClosed/
// overdue/createdToday/deliveredToday/closedThisMonth/warrantyOnly/pendingBucket), each mirroring
// the same WHERE clause DashboardController.Kpis used to compute that same number, so a click
// always lands on the set of job cards that make up the count just shown.
// 2026-09-18: `actionNeeded` matches the BTL reference screenshot's orange "ACTION NEEDED" pill
// (see .kpi-badge-action in global.css) - set on the three tiles that represent something waiting
// on THIS dealer to act (parts to arrange, a customer approval to chase, a job stuck pending),
// as opposed to the others which are just informational counts.
//
// 2026-09-28 ("WARRANTY JOBS this after 1 card add Stock cards in that total stock shown and when
// click on that redirect on /part-upload page"): the Stock card itself is NOT in this array - it
// isn't driven by DashboardKpis/GET /api/dashboard/kpis like every tile below (I don't have
// DashboardController.cs in this session to add a server-computed field to that response), so it's
// rendered as its own hand-coded tile right after this array maps out, using a client-side total
// (GET /api/part-uploads, summed) instead - see DealerDashboard's stockQty state and the kpi-grid
// render below for the full reasoning.
//
// 2026-09-29 (SECTION 157, "fix login wise jobcard open close for supervisor dont have any
// jobcard then still shown main dealer count fix this"): `params` added to each tile - the exact
// same filter object GET /api/jobcards (JobCardsController.List) already accepts for this. See
// DealerDashboard's own scopedCounts doc comment below for why this is now needed for the tile's
// NUMBER, not just its click-through `to` link (which already used the same filters, just encoded
// as a URL query string instead of an object).
const TILES: { key: keyof DashboardKpis; label: string; icon: string; to: string; params: Record<string, string | boolean>; actionNeeded?: boolean }[] = [
  { key: 'vehiclesReceivedToday', label: 'Vehicles Received Today', icon: '🚗', to: '/jobcards?createdToday=true', params: { createdToday: true } },
  { key: 'totalOpen', label: 'Open Job Cards', icon: '📋', to: '/jobcards?excludeClosed=true', params: { excludeClosed: true } },
  { key: 'underService', label: 'Under Service', icon: '🔧', to: '/jobcards?stageKey=in_repair', params: { stageKey: 'in_repair' } },
  { key: 'waitingForParts', label: 'Waiting for Parts', icon: '📦', to: '/jobcards?stageKey=part_suggestion', params: { stageKey: 'part_suggestion' }, actionNeeded: true },
  { key: 'waitingCustomerApproval', label: 'Waiting Customer Approval', icon: '⏳', to: '/jobcards?status=PendingCustomerApproval', params: { status: 'PendingCustomerApproval' }, actionNeeded: true },
  { key: 'vehiclesReady', label: 'Vehicles Ready', icon: '🏁', to: '/jobcards?stageKey=ready_for_delivery', params: { stageKey: 'ready_for_delivery' } },
  { key: 'vehiclesDeliveredToday', label: 'Vehicles Delivered', icon: '🚀', to: '/jobcards?deliveredToday=true', params: { deliveredToday: true } },
  { key: 'pendingJobCards', label: 'Pending Job Cards', icon: '⏳', to: '/jobcards?pendingBucket=true', params: { pendingBucket: true }, actionNeeded: true },
  { key: 'warrantyJobsOpen', label: 'Warranty Jobs', icon: '🛡️', to: '/jobcards?warrantyOnly=true&excludeClosed=true', params: { warrantyOnly: true, excludeClosed: true } },
]

function DealerDashboard() {
  const { profile } = useStaffAuth()
  const { isVisibleForCurrentRole } = useMenuAccess() // SECTION 171 - see ALL_PAGES' own doc comment above
  const navigate = useNavigate()
  const [kpis, setKpis] = useState<DashboardKpis | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    staffApi
      .get<DashboardKpis>('/api/dashboard/kpis')
      .then((res) => setKpis(res.data))
      .finally(() => setLoading(false))
  }, [])

  // 2026-09-29 (SECTION 157, "fix login wise jobcard open close for supervisor dont have any
  // jobcard then still shown main dealer count fix this") - CONFIRMED root cause, re-reading
  // backend/JobCardScanner.Api/Controllers/JobCardsController.cs's actual source this round: its
  // List() action (GET /api/jobcards, used above by every "All Pages"/tile `to` link) already
  // applies BOTH the signed-in user's own dealer AND their Work Area (`_currentUser.WorkLocationCodes`)
  // scoping - "a user assigned to specific DMS workshop locations only sees job cards opened at one
  // of THEIR locations" (that controller's own doc comment, confirmed word-for-word). GET
  // /api/dashboard/kpis (DashboardController) - which is what kpis above actually comes from - is a
  // DIFFERENT endpoint, and I don't have DashboardController.cs in this session to confirm it, but
  // your report ("supervisor dont have any jobcard then still shown main dealer count") is exactly
  // what you'd see if it computes every count across the WHOLE dealer without that same
  // WorkLocationCodes filter - it very likely never got that scoping added when Work Area/
  // WorkLocationCodes was built (2026-09-17, well after kpis' own dashboard existed).
  //
  // FIX APPLIED HERE (frontend-only - the durable fix is really adding the same WorkLocationCodes
  // filter to DashboardController.Kpis itself, but I don't have that file this session): each of
  // the 9 TILES above is now counted by calling the ALREADY-correctly-scoped GET /api/jobcards with
  // that tile's own `params` (added to TILES above - the exact filters JobCardsController.List's
  // own doc comment says reproduce each dashboard number), instead of trusting kpis[t.key] from the
  // unscoped endpoint. Exactly the same idea already used for the Stock Qty tile below (a
  // client-side count from an endpoint that's actually scoped correctly) - just applied to the
  // other 9 tiles too, now that JobCardsController.cs's exact filter vocabulary is confirmed.
  //
  // KNOWN LIMIT (please read before relying on this for a very busy dealer): GET /api/jobcards caps
  // results at 200 rows (`.Take(200)`, confirmed in its own source) and returns no separate
  // total-count field, so a tile whose TRUE count exceeds 200 will under-report rather than show
  // the real number. For a single Work Area's currently-open job cards this is very unlikely, but
  // I'm flagging it rather than silently hiding the limitation.
  //
  // NOT FIXED by this change (still dealer-wide/unscoped, still come straight from kpis): Revenue
  // (Paid Invoices), Avg. Service Time, Customer Satisfaction, and the "Job Cards by Status" chart
  // further down this page - none of those are a simple job-card-count filter the way the 9 tiles
  // are (revenue/turnaround/CSAT need real aggregation across Invoices/ratings, not a row count), so
  // they can't be reproduced from GET /api/jobcards the same way. If a Supervisor seeing the whole
  // dealer's Revenue/TAT/CSAT numbers is also a problem for you, say so and I'll flag exactly what's
  // needed from DashboardController.cs to fix those at the real source too.
  const [scopedCounts, setScopedCounts] = useState<Partial<Record<keyof DashboardKpis, number>> | null>(null)
  useEffect(() => {
    Promise.all(
      TILES.map((t) =>
        staffApi
          .get<{ items: unknown[] }>('/api/jobcards', { params: t.params })
          .then((res): [keyof DashboardKpis, number] => [t.key, res.data.items.length])
          .catch((): [keyof DashboardKpis, number | undefined] => [t.key, undefined]),
      ),
    ).then((pairs) => {
      const next: Partial<Record<keyof DashboardKpis, number>> = {}
      pairs.forEach(([key, count]) => { if (count !== undefined) next[key] = count })
      setScopedCounts(next)
    })
  }, [])

// 2026-09-28 ("add Stock cards in that total stock shown"): FACT, confirmed from your earlier
  // answer - total stock = sum of Bal Qty. Computed client-side from GET /api/part-uploads (the
  // exact same endpoint web/src/pages/staff/PartUploadPage.tsx and mobile's PartUploadScreen.tsx
  // already use - see that screen's own doc comment for the endpoint list), called with no
  // search/locationCode filter so it returns every PartUploads row across every location for this
  // dealer, then summed here (balQty ?? 0 per row, so a null Bal Qty counts as 0 rather than
  // breaking the total). NOT a DashboardController.cs field - I still don't have that controller
  // in this session, so this is the client-side fallback SECTION 144 flagged as the alternative to
  // a server-computed field, used now rather than continuing to block the whole card on a file
  // request. stockError (not stockQty === null) distinguishes "still loading" from "the call
  // failed" (e.g. a role without access to Part Upload data) - the tile shows "—" either way rather
  // than a wrong number, but only the error case is worth telling apart in code for future
  // debugging.
const [stockQty, setStockQty] = useState<number | null>(null)
  const [stockError, setStockError] = useState(false)
  useEffect(() => {
    staffApi
      .get<{ balQty: number | null }[]>('/api/part-uploads')
      .then((res) => setStockQty(res.data.reduce((sum, r) => sum + (r.balQty ?? 0), 0)))
      .catch(() => setStockError(true))
  }, [])

  if (loading) return <p className="muted">Loading dashboard...</p>
  if (!kpis) return <p className="muted">Could not load dashboard.</p>

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Dealer Dashboard</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>Live workshop operations overview</p>
      </div>

      {/* 2026-09-28 ("1st shown in web card VEHICLES RECEIVED TODAY to WARRANTY JOBS this cards
          1st then shown below kpi cards of All Pages"): the KPI tile row (Vehicles Received Today
          through Warranty Jobs) now renders FIRST, with "All Pages" moved below it - reordered
          from the previous layout (All Pages first, KPI tiles second). Nothing inside either
          section changed, only which one comes first on the page. */}
      <div className="kpi-grid">
        {TILES.map((t, i) => (
          // Every tile is a Link to the /jobcards filter that reproduces its own number - see
          // TILES' doc comment above for how each `to` matches DashboardController.Kpis' own
          // computation. The NUMBER shown (SECTION 157) comes from scopedCounts (an already Work
          // Area-scoped count via GET /api/jobcards), falling back to the old dealer-wide kpis
          // value only if that one tile's own scoped fetch failed - see scopedCounts' own doc
          // comment above for the full reasoning. Shows "…" while the scoped counts are still
          // loading, rather than flashing the (possibly wrong, dealer-wide) kpis number first.
          <Link key={t.key} to={t.to} className={`kpi kpi-a${(i % 6) + 1}`} style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
            {t.actionNeeded && <span className="kpi-badge-action">Action Needed</span>}
            <div className="kpi-icon">{t.icon}</div>
            <div className="value">{scopedCounts === null ? '…' : scopedCounts[t.key] ?? (kpis[t.key] as number)}</div>
            <div className="label">{t.label}</div>
          </Link>
        ))}
        {/* 2026-09-28 ("WARRANTY JOBS this after 1 card add Stock cards ... redirect on
           /part-upload page"): right after Warranty Jobs (TILES' own last entry), per your
           confirmed route. See stockQty's own doc comment above for why this is a hand-coded tile
           rather than another TILES entry. */}
        <Link
          to="/part-upload"
          className={`kpi kpi-a${(TILES.length % 6) + 1}`}
          style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
        >
          <div className="kpi-icon">📦</div>
          <div className="value">{stockError ? '—' : stockQty === null ? '…' : stockQty.toLocaleString('en-IN')}</div>
          <div className="label">Stock Qty</div>
        </Link>
      </div>

      <div style={{ marginBottom: 8, marginTop: 24 }}>
        <h3 style={{ marginBottom: 2 }}>All Pages</h3>
        <p className="muted" style={{ marginTop: 0 }}>Every page you have access to, in one place.</p>
      </div>
      <div className="action-card-grid">
        {ALL_PAGES.filter(isVisibleForCurrentRole).map((n, i) => (
          <Link key={n.to} to={n.to} className={`action-card aa-a${(i % 6) + 1}`}>
            <div className="action-card-icon">{n.icon}</div>
            <div>
              <div className="action-card-title">{n.label}</div>
              <div className="action-card-subtitle">{n.subtitle ?? n.label}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="kpi-grid">
        {/* Revenue/turnaround are both driven by CLOSED (invoiced) job cards - the closest
           equivalent /jobcards filter, even though neither is an exact reproduction of the
           number shown (revenue/turnaround are computed off Invoices, not a job-card count). */}
        <Link to="/jobcards?status=Closed" className="kpi kpi-a2" style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
          <div className="kpi-icon">₹</div>
          <div className="value">₹{kpis.revenuePaidInvoices.toLocaleString()}</div>
          <div className="label">Revenue (Paid Invoices)</div>
        </Link>
        <Link to="/jobcards?status=Closed" className="kpi kpi-a1" style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
          <div className="kpi-icon">⏱️</div>
          <div className="value">{kpis.avgTurnaroundHours} hrs</div>
          <div className="label">Avg. Service Time</div>
        </Link>
        {/* Not a Link - there's no rating/feedback capture in the schema yet (see
           DashboardController.Kpis' own comment on this), so no job-card filter actually
           corresponds to this number. */}
        <div className="kpi kpi-a5">
          <div className="kpi-icon">⭐</div>
          <div className="value">{kpis.csat.average != null ? `${kpis.csat.average.toFixed(1)} / 5` : '—'}</div>
          <div className="label">
            Customer Satisfaction{kpis.csat.ratingsCount > 0 ? ` (${kpis.csat.ratingsCount} ratings)` : ' (no ratings yet)'}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Job Cards by Status</h3>
        <p className="muted" style={{ marginTop: -6, marginBottom: 10 }}>Click a bar to see those job cards.</p>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={kpis.byStatus}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="status" fontSize={12} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar
                dataKey="count"
                fill="#2563eb"
                radius={[4, 4, 0, 0]}
                cursor="pointer"
                onClick={(entry) => navigate(`/jobcards?status=${encodeURIComponent(entry.status)}`)}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 4 }}>
        {profile?.dealerName ? `Showing data for ${profile.dealerName}.` : ''}
      </p>
    </div>
  )
}

// ==================== Corporate Dashboard ====================

interface CorporateFilterState {
  region: string
  state: string
  city: string
  dealerId: string
  model: string
  warranty: string
}

const EMPTY_FILTERS: CorporateFilterState = { region: '', state: '', city: '', dealerId: '', model: '', warranty: '' }

// Same top action-card treatment as the Dealer Dashboard (see ACTION_CARDS above) - no role
// filtering needed here since only Corporate/System Admin ever render this component at all.
const CORPORATE_ACTION_CARDS: { label: string; subtitle: string; icon: string; to: string; featured?: boolean }[] = [
  { label: 'Job Cards', subtitle: 'Browse job cards across every dealer', icon: '📋', to: '/jobcards' },
  { label: 'Reports & Search', subtitle: 'Excel & PDF, by period, state, dealer', icon: '📊', to: '/reports', featured: true },
  { label: 'Manage Users & Activity', subtitle: 'Add staff, edit roles and Work Area', icon: '👥', to: '/admin/users' },
  { label: 'Admin: Workflow', subtitle: 'Configure job card stages', icon: '⚙️', to: '/admin/workflow' },
]

function CorporateDashboard() {
  const { isVisibleForCurrentRole } = useMenuAccess() // SECTION 171 - used by the "All Pages" grid's filter below
  const [filterOptions, setFilterOptions] = useState<CorporateDashboardFilters | null>(null)
  const [liveSummary, setLiveSummary] = useState<DealerStageSummary | null>(null)
  const [closedTodaySummary, setClosedTodaySummary] = useState<DealerStageSummary | null>(null)
  const [todayError, setTodayError] = useState(false)
  const [createdTodaySummary, setCreatedTodaySummary] = useState<DealerStageSummary | null>(null)
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
  useEffect(() => {
    staffApi.get<DealerStageSummary>('/api/dashboard/dealer-stage-report/summary')
       .then((res) => setLiveSummary(res.data)).catch(() => setTodayError(true))
    staffApi.get<DealerStageSummary>('/api/dashboard/dealer-stage-report/summary', { params: { dateFrom: todayStr, dateTo: todayStr } })
       .then((res) => setCreatedTodaySummary(res.data)).catch(() => setTodayError(true))
    staffApi.get<DealerStageSummary>('/api/dashboard/dealer-stage-report/summary', { params: { dateFrom: todayStr, dateTo: todayStr, dateBasis: 'closed' } })
       .then((res) => setClosedTodaySummary(res.data)).catch(() => setTodayError(true))
  }, [todayStr])
  const [filters, setFilters] = useState<CorporateFilterState>(EMPTY_FILTERS)
  const [data, setData] = useState<CorporateDashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    staffApi.get<CorporateDashboardFilters>('/api/dashboard/corporate/filters').then((res) => setFilterOptions(res.data))
  }, [])

  useEffect(() => {
    setLoading(true)
    staffApi
      .get<CorporateDashboardData>('/api/dashboard/corporate', {
        params: {
          region: filters.region || undefined,
          state: filters.state || undefined,
          city: filters.city || undefined,
          dealerId: filters.dealerId || undefined,
          model: filters.model || undefined,
          warranty: filters.warranty || undefined,
        },
      })
      .then((res) => setData(res.data))
      .finally(() => setLoading(false))
  }, [filters])

  // 2026-10-02 ("in dashboard of systemadmin ... kpi cards app like other dashboard ... other
  // role ... Parts stocks") - confirmed via AskUserQuestion: "other role" = total staff across
  // every role, combined into one number. ASSUMPTION FLAGGED: I don't have EmployeesController.cs
  // (or whichever controller backs NAV_ITEMS' "employees"/"technician-employees" pages) in this
  // session, so GET /api/employees with no params is a best guess at the endpoint, not confirmed -
  // same "try it, degrade to a dash on failure" pattern this file already uses for the Dealer
  // Dashboard's Stock Qty tile below. If this shows "—", tell me the real endpoint/shape and I'll
  // fix it rather than guess again.
  //
  // 2026-10-02 ("that card clickable dealerwise can check how much dealer how his under role and
  // that role dealtail") - the FULL employee array is now kept (not just its length), so the
  // Dealers card's click-through breakdown below can group these same rows by dealer + role
  // without a second network call. ASSUMPTION FLAGGED (separate from the endpoint path itself):
  // each row is assumed to carry `role` and `dealerId` fields (camelCase, matching every other
  // confirmed JSON response this session, e.g. AttendanceController.List's `role: s.Role.ToString()`
  // and `dealerId`) - if the breakdown panel below comes up empty/wrong, this field-shape guess is
  // the first thing to check once the real controller is pasted.
  interface EmployeeRow {
    id?: string
    name?: string
    role?: string
    dealerId?: string | null
    dealerName?: string | null
  }
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null)
  const [staffError, setStaffError] = useState(false)
  useEffect(() => {
    staffApi
      .get<EmployeeRow[]>('/api/employees')
      .then((res) => setEmployees(Array.isArray(res.data) ? res.data : []))
      .catch(() => setStaffError(true))
  }, [])
  const staffCount = employees?.length ?? null

  // Toggled by clicking the "Dealers" KPI tile - see that tile's own render below.
  // const [showDealerBreakdown, setShowDealerBreakdown] = useState(false)

  // Groups the same `employees` array above by dealer, then by role within each dealer - built
  // once per employees/filterOptions change rather than on every render.
  // const dealerRoleBreakdown = useMemo(() => {
  //   if (!employees) return null
  //   const byDealer = new Map<string, { dealerName: string; roles: Map<string, number>; total: number }>()
  //   for (const e of employees) {
  //     const dealerKey = e.dealerId ?? '__unassigned__'
  //     const dealerName =
  //       e.dealerName ||
  //       filterOptions?.dealers.find((d) => d.id === e.dealerId)?.name ||
  //       (e.dealerId ? e.dealerId : 'Unassigned / no dealer')
  //     const role = e.role || 'Unknown role'
  //     if (!byDealer.has(dealerKey)) byDealer.set(dealerKey, { dealerName, roles: new Map(), total: 0 })
  //     const entry = byDealer.get(dealerKey)!
  //     entry.roles.set(role, (entry.roles.get(role) ?? 0) + 1)
  //     entry.total += 1
  //   }
  //   return Array.from(byDealer.values()).sort((a, b) => a.dealerName.localeCompare(b.dealerName))
  // }, [employees, filterOptions])

  // 2026-10-02 - confirmed via AskUserQuestion: Parts Stock = quantity summed across every dealer.
  // Same GET /api/part-uploads + sum(balQty) approach already used for the Dealer Dashboard's own
  // Stock Qty tile (see that tile's doc comment), called here with no dealer filter. ASSUMPTION
  // FLAGGED: I don't have PartUploadsController.cs in this session to confirm it actually returns
  // every dealer's rows (not just one) when called by a Corporate/System Admin - if the number
  // looks like a single dealer's stock rather than the org total, that controller needs a look.
  const [orgStockQty, setOrgStockQty] = useState<number | null>(null)
  const [orgStockError, setOrgStockError] = useState(false)
  useEffect(() => {
    staffApi
      .get<{ balQty: number | null }[]>('/api/part-uploads')
      .then((res) => setOrgStockQty(res.data.reduce((sum, r) => sum + (r.balQty ?? 0), 0)))
      .catch(() => setOrgStockError(true))
  }, [])

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Corporate Dashboard</h2>
      <p className="muted" style={{ marginTop: 0 }}>Consolidated visibility across all dealers</p>
                <h3 style={{ margin: '16px 0 2px' }}>Job cards - all dealers</h3>
        <p className="muted" style={{ margin: 0 }}>Created, Closed and Invoiced show today. Open, In Progress and Ready for Delivery are live counts - click a card for the dealer-wise detail.</p>
        <div className="kpi-grid" style={{ margin: '8px 0 16px' }}>
          {([
            ['created', 'Job cards created today', '📋', 'kpi-a1', 'created'],
            ['inProgress', 'In Progress', '🔧', 'kpi-a3', 'live'],
            ['open', 'Open', '📂', 'kpi-a4', 'live'],
            ['readyForDelivery', 'Ready for Delivery', '🏁', 'kpi-a5', 'live'],
            ['closed', 'Closed today', '✅', 'kpi-a2', 'closed'],
            ['invoiced', 'Invoiced today', '🧾', 'kpi-a6', 'closed'],
          ] as const).map(([key, label, icon, accent, source]) => {
            const src = source === 'created' ? createdTodaySummary : source === 'closed' ? closedTodaySummary : liveSummary
            const to =
              source === 'closed' ? `/dealer-role-report?status=${key}&scope=all&basis=closed&from=${todayStr}&to=${todayStr}`
              : source === 'created' ? `/dealer-role-report?status=${key}&scope=all&from=${todayStr}&to=${todayStr}`
              : `/dealer-role-report?status=${key}&scope=all&from=&to=`
            return (
              <Link key={key} to={to} className={`kpi ${accent}`} style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                <div className="kpi-icon">{icon}</div>
                <div className="value">{todayError ? '—' : src ? src.totals[key] : '…'}</div>
                <div className="label">{label}</div>
              </Link>
            )
          })}
        </div>
      {/* 2026-10-02 ("in dashboard of systemadmin ... kpi cards app like other dashboard ... Open
         Job Cards Count / Dealer Wise count of job cards / Dealer / other role / Parts stocks ...
         all main after login in starting like after other role login") - mirrors the Dealer
         Dashboard's own 2026-09-28 reorder (KPI tiles first, All Pages/action cards below), so a
         SystemAdmin/CorporateAdmin login lands on the same kind of overview row other roles get,
         instead of two card grids and a filter bar first.

         INTERPRETATION, not a new/duplicate number: "Open Job Cards Count" below reuses
         data.pendingVehicles rather than adding a second count. Its own Link already points at
         /jobcards?excludeClosed=true - the exact same filter the Dealer Dashboard's "Open Job
         Cards" tile uses - and this component's own prior comment on this tile ("there's no
         /jobcards filter that actually reproduces those numbers the way there is for Pending
         Vehicles") confirms it really is a live job-card count server-side, unlike
         Revenue/Warranty Cost/CSAT. "Dealer Wise count of job cards" is the existing "Job Card
         Volume by Dealer" chart, just moved up here instead of being duplicated as a second
         per-dealer number - see that chart below. */}
      <div className="kpi-grid" style={{ margin: '16px 0' }}>
        <Link to="/jobcards?excludeClosed=true" className="kpi kpi-a4" style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
          <span className="kpi-badge-action">Action Needed</span>
          <div className="kpi-icon">📋</div>
          <div className="value">{loading || !data ? '…' : data.pendingVehicles}</div>
          <div className="label">Open Job Cards Count</div>
        </Link>
        {/* 2026-10-02 ("that card clickable dealerwise can check how much dealer how his under
           role and that role dealtail") - toggles the role-breakdown panel below instead of
           navigating, so this is a <div onClick> (matching the Staff/Parts Stock tiles' look) with
           keyboard support, not a <Link>. */}
          <Link to="/dealer-role-report" className="kpi kpi-a2" style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
            <div className="kpi-icon">🏢</div>
            <div className="value">{filterOptions ? filterOptions.dealers.length : '…'}</div>
            <div className="label">Dealers</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Open dealer role report →</div>
          </Link>
        <div className="kpi kpi-a3">
          <div className="kpi-icon">👥</div>
          <div className="value">{staffError ? '—' : staffCount === null ? '…' : staffCount}</div>
          <div className="label">Staff (All Roles)</div>
        </div>
        <Link to="/part-upload" className="kpi kpi-a5" style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
          <div className="kpi-icon">📦</div>
          <div className="value">{orgStockError ? '—' : orgStockQty === null ? '…' : orgStockQty.toLocaleString('en-IN')}</div>
          <div className="label">Parts Stock</div>
        </Link>
      </div>

      {/* 2026-10-02 - the Dealers tile's click-through breakdown: how many staff, by role, under
         each dealer. Built client-side from the same /api/employees fetch as the Staff (All
         Roles) tile above - see that tile's own doc comment for the flagged endpoint/shape
         assumption this inherits. */}
      {/* {showDealerBreakdown && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Dealers - Role-wise Staff</h3>
          {staffError ? (
            <p className="muted">Could not load staff details to build this breakdown ({'/api/employees'} failed - see this tile's own code comment).</p>
          ) : !dealerRoleBreakdown ? (
            <p className="muted">Loading...</p>
          ) : dealerRoleBreakdown.length === 0 ? (
            <p className="muted">No staff records found.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Dealer</th><th>Total Staff</th><th>Role-wise Count</th></tr>
              </thead>
              <tbody>
                {dealerRoleBreakdown.map((d) => (
                  <tr key={d.dealerName}>
                    <td>{d.dealerName}</td>
                    <td>{d.total}</td>
                    <td className="muted">
                      {Array.from(d.roles.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([role, count]) => `${role}: ${count}`)
                        .join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )} */}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Job Card Volume by Dealer</h3>
        <p className="muted" style={{ marginTop: -6, marginBottom: 10 }}>Dealer-wise count of job cards.</p>
        {loading || !data ? (
          <p className="muted">Loading...</p>
        ) : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={data.jobCardVolumeByDealer}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dealerName" fontSize={11} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="action-card-grid">
        {CORPORATE_ACTION_CARDS.map((a, i) => (
          <Link key={a.label} to={a.to} className={`action-card ${a.featured ? 'action-card-featured' : `aa-a${(i % 6) + 1}`}`}>
            <div className="action-card-icon">{a.icon}</div>
            <div>
              <div className="action-card-title">{a.label}</div>
              <div className="action-card-subtitle">{a.subtitle}</div>
            </div>
          </Link>
        ))}
      </div>

      <div style={{ marginBottom: 8 }}>
        <h3 style={{ marginBottom: 2 }}>All Pages</h3>
        <p className="muted" style={{ marginTop: 0 }}>Every page you have access to, in one place.</p>
      </div>
      <div className="action-card-grid">
        {/* SECTION 171: now goes through the same isVisibleForCurrentRole check the sidebar and the
           Dealer Dashboard's own grid use (see ALL_PAGES' doc comment above) - CorporateAdmin/
           SystemAdmin are extremely unlikely to ever be put in "only show checked" allow-list mode,
           but this keeps the three grids/sidebar from ever being able to drift apart again. */}
        {ALL_PAGES.filter(isVisibleForCurrentRole).map((n, i) => (
          <Link key={n.to} to={n.to} className={`action-card aa-a${(i % 6) + 1}`}>
            <div className="action-card-icon">{n.icon}</div>
            <div>
              <div className="action-card-title">{n.label}</div>
              <div className="action-card-subtitle">{n.subtitle ?? n.label}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select value={filters.region} onChange={(e) => setFilters({ ...filters, region: e.target.value })}>
          <option value="">All Regions</option>
          {filterOptions?.regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })}>
          <option value="">All States</option>
          {filterOptions?.states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })}>
          <option value="">All Cities</option>
          {filterOptions?.cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.dealerId} onChange={(e) => setFilters({ ...filters, dealerId: e.target.value })}>
          <option value="">All Dealers</option>
          {filterOptions?.dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={filters.model} onChange={(e) => setFilters({ ...filters, model: e.target.value })}>
          <option value="">All Models</option>
          {filterOptions?.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filters.warranty} onChange={(e) => setFilters({ ...filters, warranty: e.target.value })}>
          <option value="">Warranty & Non-Warranty</option>
          <option value="warranty">Warranty Only</option>
          <option value="nonwarranty">Non-Warranty Only</option>
        </select>
      </div>

      {loading || !data ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
          <div className="kpi-grid" style={{ margin: '20px 0' }}>
            <div className="kpi kpi-a2">
              <div className="kpi-icon">₹</div>
              <div className="value">₹{data.revenue.toLocaleString()}</div>
              <div className="label">Revenue</div>
            </div>
            <div className="kpi kpi-a3">
              <div className="kpi-icon">🛡️</div>
              <div className="value">₹{data.warrantyCost.toLocaleString()}</div>
              <div className="label">Warranty Cost</div>
            </div>
            <div className="kpi kpi-a5">
              <div className="kpi-icon">⭐</div>
              <div className="value">{data.csat.average != null ? `${data.csat.average.toFixed(1)} / 5` : '—'}</div>
              <div className="label">CSAT{data.csat.average == null ? ' (no ratings yet)' : ''}</div>
            </div>
          </div>
          {/* Pending Vehicles / Job Card Volume by Dealer moved up to the top overview row/card
             (2026-10-02) - see this component's own doc comment above. Not duplicated here. */}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
            <div className="card">
              <h3>Job Card Volume Trend</h3>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={data.jobCardVolumeTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={11} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h3>Average TAT by Dealer (hours)</h3>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={data.avgTatByDealer}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="dealerName" fontSize={11} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="avgHours" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h3>Top Parts Consumption</h3>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={data.topPartsConsumption} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="partName" fontSize={11} width={140} />
                    <Tooltip />
                    <Bar dataKey="qty" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Repeat Complaints (vehicles with &gt;1 visit)</h3>
            <table>
              <thead><tr><th>Reg No</th><th>Visits</th></tr></thead>
              <tbody>
                {data.repeatComplaints.map((r, i) => (
                  <tr key={i}><td>{r.regNo ?? '-'}</td><td>{r.visits}</td></tr>
                ))}
                {data.repeatComplaints.length === 0 && (
                  <tr><td colSpan={2} className="muted" style={{ textAlign: 'center', padding: 16 }}>No repeat visits in this selection.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}