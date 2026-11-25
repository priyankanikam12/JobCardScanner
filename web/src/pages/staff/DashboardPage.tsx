// web\src\pages\staff\DashboardPage.tsx
// 2026-11-25 ("dashboard ui also change more attractive"): UI only - new hero header, coloured KPI tiles, "All Pages" tiles, rounded chart panels and pill filters. Styling lives in ./DashboardPage.css
// (every class is dsh-*, so global.css and other pages are untouched). NO data logic was changed: same endpoints, same TILES/params, same Work Area-scoped counts, same links, same role branching.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import { NAV_ITEMS, useMenuAccess } from '../../components/StaffLayout'
import type { CorporateDashboardData, CorporateDashboardFilters, DashboardKpis } from '../../types'
// import { isReportDealer } from '../../lib/reportDealers'
import type { DealerStageSummary } from '../../lib/dealerRoleReportExport'
import './DashboardPage.css'

// Every sidebar destination as its own card (landing page to the whole app). Reuses StaffLayout's own NAV_ITEMS so role-gating cannot drift from the sidebar; Dashboard itself is excluded.
// SECTION 171: filtered with useMenuAccess().isVisibleForCurrentRole (Menu Access overrides + per-role allow-list), the same check the sidebar uses.
const ALL_PAGES = NAV_ITEMS.filter((n) => n.to !== '/dashboard')

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** e.g. "Wednesday, 25.11.2026" (DD.MM.YYYY, BGauss standard) */
function todayLabel(): string {
  const d = new Date()
  return `${WEEKDAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

/** Signed-in person's name for the hero greeting. ASSUMPTION: the profile exposes it as name / fullName / displayName / userName (the navbar shows it from the same profile) - if the greeting does not appear, tell me the real field name. */
function personName(profile: unknown): string {
  const p = (profile ?? {}) as Record<string, unknown>
  for (const k of ['name', 'fullName', 'displayName', 'userName']) {
    const v = p[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

const tone = (i: number) => `dsh-t${(i % 6) + 1}`
const rise = (i: number): CSSProperties => ({ ['--i' as string]: i }) as CSSProperties

const chartTooltip = {
  contentStyle: { borderRadius: 12, border: '1px solid #e3ebf5', boxShadow: '0 12px 26px -14px rgba(11,36,71,0.45)', fontSize: 13 },
  cursor: { fill: 'rgba(37, 99, 235, 0.06)' },
}

// ---------------- small presentational pieces ----------------

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.4 2 5 13.2h5.6L9.6 22 19 10.2h-5.7L13.4 2Z" />
    </svg>
  )
}

function Hero({ title, subtitle, chips, userName, children }: { title: string; subtitle: string; chips: ReactNode; userName?: string; children?: ReactNode }) {
  return (
    <div className="dsh-hero">
      <div>
        {userName && (
          <div className="dsh-hello">
            <span className="dsh-avatar" aria-hidden="true">{initialsOf(userName)}</span>
            <span>Welcome back, <b>{userName}</b></span>
          </div>
        )}
        <div className="dsh-hero-title">
          <span className="dsh-hero-bolt" aria-hidden="true"><BoltIcon /></span>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="dsh-chips">{chips}</div>
      </div>
      {children}
    </div>
  )
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="dsh-sec-head">
      <div>
        <h3>{title}</h3>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  )
}

function KpiTile({ to, icon, value, label, toneIndex, index, action }: { to?: string; icon: string; value: ReactNode; label: string; toneIndex: number; index: number; action?: boolean }) {
  const body = (
    <>
      <div className="dsh-kpi-top">
        <span className="dsh-icon" aria-hidden="true">{icon}</span>
        {action && <span className="dsh-pill-action">Action Needed</span>}
      </div>
      <div className="dsh-kpi-value">{value}</div>
      <div className="dsh-kpi-label">{label}</div>
      {to && <div className="dsh-kpi-go">View list →</div>}
    </>
  )
  const cls = `dsh-kpi ${tone(toneIndex)}`
  // `to` omitted = a plain (non-clickable) tile, e.g. Revenue / Warranty Cost / CSAT on the Corporate Dashboard (they were never links)
  return to ? <Link to={to} className={cls} style={rise(index)}>{body}</Link> : <div className={cls} style={rise(index)}>{body}</div>
}

function PageTiles({ pages }: { pages: typeof ALL_PAGES }) {
  return (
    <div className="dsh-pages">
      {pages.map((n, i) => (
        <Link key={n.to} to={n.to} className={`dsh-page ${tone(i)}`} style={rise(i)}>
          <span className="dsh-icon" aria-hidden="true">{n.icon}</span>
          <div className="dsh-page-text">
            <div className="dsh-page-title">{n.label}</div>
            <div className="dsh-page-sub">{n.subtitle ?? n.label}</div>
          </div>
          <span className="dsh-page-arrow" aria-hidden="true">›</span>
        </Link>
      ))}
    </div>
  )
}

/**
 * The dashboard branches by role: everyone dealer-side (Service Advisor up to Dealer Admin, plus Technician/Parts/Cashier) gets the single-dealer "Dealer Dashboard";
 * Corporate/System Admin get the "Corporate Dashboard" - a filterable roll-up across every dealer.
 */
export function DashboardPage() {
  const { hasRole } = useStaffAuth()
  return hasRole('CorporateAdmin', 'SystemAdmin') ? <CorporateDashboard /> : <DealerDashboard />
}

// ==================== Dealer Dashboard ====================

// Each tile's `to` is the exact /jobcards filter that reproduces its number (param names match JobCardsController.List's dashboard filters 1:1).
// `actionNeeded` = something waiting on THIS dealer to act (orange pill). `params` = the same filter as an object (SECTION 157: the NUMBER on each tile is counted through the already
// Work Area-scoped GET /api/jobcards, not the dealer-wide /api/dashboard/kpis).
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
  const { isVisibleForCurrentRole } = useMenuAccess() // SECTION 171
  const navigate = useNavigate()
  const [kpis, setKpis] = useState<DashboardKpis | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    staffApi
      .get<DashboardKpis>('/api/dashboard/kpis')
      .then((res) => setKpis(res.data))
      .finally(() => setLoading(false))
  }, [])

  // SECTION 157 (unchanged): GET /api/dashboard/kpis counts the whole dealer, but GET /api/jobcards is scoped to the user's dealer AND Work Area (WorkLocationCodes), so each tile is
  // counted from /api/jobcards with that tile's own `params`. KNOWN LIMIT: that endpoint caps at 200 rows (.Take(200)) with no total field, so a count above 200 under-reports.
  // Still dealer-wide (straight from kpis): "Job Cards by Status" chart below (and the Revenue / Avg. Service Time / CSAT numbers, currently not displayed).
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

  // Stock Qty tile (unchanged): total stock = sum of Bal Qty across GET /api/part-uploads (client-side; "-" if the call fails, e.g. a role without Part Upload access).
  const [stockQty, setStockQty] = useState<number | null>(null)
  const [stockError, setStockError] = useState(false)
  useEffect(() => {
    staffApi
      .get<{ balQty: number | null }[]>('/api/part-uploads')
      .then((res) => setStockQty(res.data.reduce((sum, r) => sum + (r.balQty ?? 0), 0)))
      .catch(() => setStockError(true))
  }, [])

  if (loading) return <p className="dsh-loading">Loading dashboard...</p>
  if (!kpis) return <p className="muted">Could not load dashboard.</p>

  // number shown for a tile: scoped count; falls back to the dealer-wide kpis value only if that one tile's own fetch failed; "…" while loading
  const countFor = (key: keyof DashboardKpis): ReactNode =>
    scopedCounts === null ? <span className="dsh-loading-value">…</span> : (scopedCounts[key] ?? (kpis[key] as number))

  return (
    <div className="dsh">
      <Hero
        userName={personName(profile)}
        title="Dealer Dashboard"
        subtitle="Live workshop operations overview"
        chips={
          <>
            <span className="dsh-chip"><span className="dsh-live" /> Live</span>
            <span className="dsh-chip">📅 {todayLabel()}</span>
            {profile?.dealerName && <span className="dsh-chip">🏢 {profile.dealerName}</span>}
          </>
        }
      >
        <div className="dsh-hero-stats">
          <Link to="/jobcards?excludeClosed=true" className="dsh-hero-stat">
            <b>{scopedCounts === null ? '…' : (scopedCounts.totalOpen ?? kpis.totalOpen)}</b>
            <span>Open job cards</span>
          </Link>
          <Link to="/jobcards?stageKey=ready_for_delivery" className="dsh-hero-stat">
            <b>{scopedCounts === null ? '…' : (scopedCounts.vehiclesReady ?? kpis.vehiclesReady)}</b>
            <span>Ready for delivery</span>
          </Link>
        </div>
      </Hero>

      {/* KPI tiles first, "All Pages" below (2026-09-28 order kept). Each tile links to the /jobcards filter that reproduces its own number. */}
      <section>
        <SectionHead title="Workshop Today" sub="Tap a tile to open the job cards behind the number." />
        <div className="dsh-kpis">
          {TILES.map((t, i) => (
            <KpiTile key={t.key} to={t.to} icon={t.icon} label={t.label} value={countFor(t.key)} action={t.actionNeeded} toneIndex={i} index={i} />
          ))}
          {/* Stock Qty - right after Warranty Jobs, opens /part-upload */}
          <KpiTile
            to="/part-upload"
            icon="📦"
            label="Stock Qty"
            value={stockError ? '—' : stockQty === null ? <span className="dsh-loading-value">…</span> : stockQty.toLocaleString('en-IN')}
            toneIndex={TILES.length}
            index={TILES.length}
          />
        </div>
      </section>

      <section>
        <SectionHead title="All Pages" sub="Every page you have access to, in one place." />
        <PageTiles pages={ALL_PAGES.filter(isVisibleForCurrentRole)} />
      </section>

      {/* Revenue (Paid Invoices) / Avg. Service Time / Customer Satisfaction tiles stay switched off, as before (kpis.revenuePaidInvoices, kpis.avgTurnaroundHours, kpis.csat are still on the response). */}

      <section className="dsh-panel">
        <h3>Job Cards by Status</h3>
        <p className="dsh-panel-sub">Click a bar to see those job cards.</p>
        <div className="dsh-chart">
          <ResponsiveContainer>
            <BarChart data={kpis.byStatus}>
              <defs>
                <linearGradient id="dshStatusBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#2563eb" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3ebf5" />
              <XAxis dataKey="status" fontSize={12} tickLine={false} axisLine={{ stroke: '#e3ebf5' }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip {...chartTooltip} />
              <Bar
                dataKey="count"
                fill="url(#dshStatusBar)"
                radius={[8, 8, 0, 0]}
                maxBarSize={56}
                cursor="pointer"
                onClick={(entry) => navigate(`/jobcards?status=${encodeURIComponent(entry.status)}`)}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <p className="dsh-foot">{profile?.dealerName ? `Showing data for ${profile.dealerName}.` : ''}</p>
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

// Quick links (Corporate/System Admin only). `featured` = the dark highlighted tile.
const CORPORATE_ACTION_CARDS: { label: string; subtitle: string; icon: string; to: string; featured?: boolean }[] = [
  { label: 'Job Cards', subtitle: 'Browse job cards across every dealer', icon: '📋', to: '/jobcards' },
  { label: 'Reports & Search', subtitle: 'Excel & PDF, by period, state, dealer', icon: '📊', to: '/reports', featured: true },
  { label: 'Manage Users & Activity', subtitle: 'Add staff, edit roles and Work Area', icon: '👥', to: '/admin/users' },
  { label: 'Admin: Workflow', subtitle: 'Configure job card stages', icon: '⚙️', to: '/admin/workflow' },
]

// The five cards shown in BOTH the Today and Overall rows. `key` = field read from the stage-report summary totals (DealerStageReportController.Summary) and the `status` the Dealer Role Report opens on.
const DASH_CARDS = [
  { key: 'created', label: 'Job cards created', icon: '📋', tone: 0 },
  { key: 'inProgress', label: 'In Progress', icon: '🔧', tone: 2 },
  { key: 'materialTransfers', label: 'Material Transfer', icon: '🔄', tone: 3 },
  { key: 'repairBills', label: 'Repair Bill', icon: '🧾', tone: 5 },
  { key: 'readyForDelivery', label: 'Ready For Delivery', icon: '🏁', tone: 4 },
] as const

function CorporateDashboard() {
  const { profile } = useStaffAuth()
  const { isVisibleForCurrentRole } = useMenuAccess() // SECTION 171
  const [filterOptions, setFilterOptions] = useState<CorporateDashboardFilters | null>(null)
  const [filters, setFilters] = useState<CorporateFilterState>(EMPTY_FILTERS)
  const [data, setData] = useState<CorporateDashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  // Today row = documents / job cards dated today; Overall row = every date (In Progress and Ready For Delivery = what is in that stage right now). Both across ALL dealers.
  const [todaySummary, setTodaySummary] = useState<DealerStageSummary | null>(null)
  const [overallSummary, setOverallSummary] = useState<DealerStageSummary | null>(null)
  const [todayError, setTodayError] = useState(false)
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
  useEffect(() => {
    staffApi.get<DealerStageSummary>('/api/dashboard/dealer-stage-report/summary', { params: { dateFrom: todayStr, dateTo: todayStr } })
      .then((res) => setTodaySummary(res.data)).catch(() => setTodayError(true))
    staffApi.get<DealerStageSummary>('/api/dashboard/dealer-stage-report/summary')
      .then((res) => setOverallSummary(res.data)).catch(() => setTodayError(true))
  }, [todayStr])

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

  // Overview-tile data (Staff count / Parts Stock) - fetched as before, for the overview tiles that are currently switched off (see the comment block further down).
  // ASSUMPTION FLAGGED (unchanged): GET /api/employees with no params is a best guess at the endpoint.
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

  const [orgStockQty, setOrgStockQty] = useState<number | null>(null)
  const [orgStockError, setOrgStockError] = useState(false)
  useEffect(() => {
    staffApi
      .get<{ balQty: number | null }[]>('/api/part-uploads')
      .then((res) => setOrgStockQty(res.data.reduce((sum, r) => sum + (r.balQty ?? 0), 0)))
      .catch(() => setOrgStockError(true))
  }, [])

  const rows = [
    { title: 'Today', src: todaySummary, query: `&from=${todayStr}&to=${todayStr}` },
    { title: 'Overall', src: overallSummary, query: '&from=&to=' },
  ] as const

  return (
    <div className="dsh">
      <Hero
        userName={personName(profile)}
        title="Corporate Dashboard"
        subtitle="Roll-up across every dealer"
        chips={
          <>
            <span className="dsh-chip"><span className="dsh-live" /> Live</span>
            <span className="dsh-chip">📅 {todayLabel()}</span>
            <span className="dsh-chip">🏢 {filterOptions ? `${filterOptions.dealers.length} dealers` : 'All dealers'}</span>
          </>
        }
      >
        <div className="dsh-hero-stats">
          <Link to="/dealer-role-report?status=notClosed&scope=all&from=&to=" className="dsh-hero-stat">
            <b>{loading || !data ? '…' : data.pendingVehicles}</b>
            <span>Open job cards</span>
          </Link>
          <div className="dsh-hero-stat">
            <b>{todayError ? '—' : todaySummary ? todaySummary.totals.created : '…'}</b>
            <span>Created today</span>
          </div>
        </div>
      </Hero>

      {/* Today and Overall: each its OWN full-width row, five cards side by side (auto-fit: five across on a normal screen, wrapping only if narrow). Today sits above Overall. */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rows.map((row, r) => (
          <div key={row.title} className="dsh-row">
            <div className="dsh-row-head">
              <span className={`dsh-row-badge${row.title === 'Overall' ? ' overall' : ''}`}>{row.title}</span>
              <span className="dsh-row-line" />
            </div>
            <div className="dsh-row-cards">
              {DASH_CARDS.map((c, i) => (
                <KpiTile
                  key={c.key}
                  to={`/dealer-role-report?status=${c.key}&scope=all${row.query}`}
                  icon={c.icon}
                  label={c.label}
                  toneIndex={c.tone}
                  index={r * DASH_CARDS.length + i}
                  value={todayError ? '—' : row.src ? row.src.totals[c.key] : <span className="dsh-loading-value">…</span>}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Overview tiles (Open Job Cards Count / Dealers / Staff (All Roles) / Parts Stock) stay switched off as before. To bring them back, render KpiTile for:
          data.pendingVehicles -> /dealer-role-report?status=notClosed&scope=all&from=&to= ; filterOptions.dealers.length -> /dealer-role-report ;
          staffError/staffCount ; orgStockError/orgStockQty -> /part-upload. */}

      <section className="dsh-panel">
        <h3>Job Card Volume by Dealer</h3>
        <p className="dsh-panel-sub">Dealer-wise count of job cards.</p>
        {loading || !data ? (
          <p className="dsh-loading">Loading...</p>
        ) : (
          <div className="dsh-chart">
            <ResponsiveContainer>
              <BarChart data={data.jobCardVolumeByDealer}>
                <defs>
                  <linearGradient id="dshVolBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34e8a0" />
                    <stop offset="100%" stopColor="#0e9f63" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3ebf5" />
                <XAxis dataKey="dealerName" fontSize={11} tickLine={false} axisLine={{ stroke: '#e3ebf5' }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip {...chartTooltip} />
                <Bar dataKey="count" fill="url(#dshVolBar)" radius={[8, 8, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section>
        <SectionHead title="Quick Links" />
        <div className="dsh-pages">
          {CORPORATE_ACTION_CARDS.map((a, i) => (
            <Link key={a.label} to={a.to} className={`dsh-page ${a.featured ? 'dsh-page-featured' : tone(i)}`} style={rise(i)}>
              <span className="dsh-icon" aria-hidden="true">{a.icon}</span>
              <div className="dsh-page-text">
                <div className="dsh-page-title">{a.label}</div>
                <div className="dsh-page-sub">{a.subtitle}</div>
              </div>
              <span className="dsh-page-arrow" aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionHead title="All Pages" sub="Every page you have access to, in one place." />
        {/* SECTION 171: same isVisibleForCurrentRole check as the sidebar and the Dealer Dashboard grid */}
        <PageTiles pages={ALL_PAGES.filter(isVisibleForCurrentRole)} />
      </section>

      <section className="dsh-panel dsh-filters">
        <span className="dsh-filters-label">Filters</span>
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
      </section>

      {loading || !data ? (
        <p className="dsh-loading">Loading...</p>
      ) : (
        <>
          <section className="dsh-kpis">
            <KpiTile icon="₹" label="Revenue" toneIndex={1} index={0} value={`₹${data.revenue.toLocaleString()}`} />
            <KpiTile icon="🛡️" label="Warranty Cost" toneIndex={2} index={1} value={`₹${data.warrantyCost.toLocaleString()}`} />
            <KpiTile
              icon="⭐"
              label={`CSAT${data.csat.average == null ? ' (no ratings yet)' : ''}`}
              toneIndex={4}
              index={2}
              value={data.csat.average != null ? `${data.csat.average.toFixed(1)} / 5` : '—'}
            />
          </section>

          <section className="dsh-charts">
            <div className="dsh-panel">
              <h3>Job Card Volume Trend</h3>
              <p className="dsh-panel-sub">Trend for the selection above.</p>
              <div className="dsh-chart">
                <ResponsiveContainer>
                  <LineChart data={data.jobCardVolumeTrend}>
                    <defs>
                      <linearGradient id="dshTrendLine" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#0e9f63" />
                        <stop offset="100%" stopColor="#38bdf8" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3ebf5" />
                    <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={{ stroke: '#e3ebf5' }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                    <Tooltip {...chartTooltip} cursor={{ stroke: '#b9cbe0' }} />
                    <Line type="monotone" dataKey="count" stroke="url(#dshTrendLine)" strokeWidth={3} dot={{ r: 3.5, fill: '#fff', stroke: '#0e9f63', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="dsh-panel">
              <h3>Average TAT by Dealer (hours)</h3>
              <p className="dsh-panel-sub">Lower is better.</p>
              <div className="dsh-chart">
                <ResponsiveContainer>
                  <BarChart data={data.avgTatByDealer}>
                    <defs>
                      <linearGradient id="dshTatBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#67e8f9" />
                        <stop offset="100%" stopColor="#0891b2" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3ebf5" />
                    <XAxis dataKey="dealerName" fontSize={11} tickLine={false} axisLine={{ stroke: '#e3ebf5' }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                    <Tooltip {...chartTooltip} />
                    <Bar dataKey="avgHours" fill="url(#dshTatBar)" radius={[8, 8, 0, 0]} maxBarSize={56} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="dsh-panel">
              <h3>Top Parts Consumption</h3>
              <p className="dsh-panel-sub">Quantity consumed.</p>
              <div className="dsh-chart">
                <ResponsiveContainer>
                  <BarChart data={data.topPartsConsumption} layout="vertical" margin={{ left: 24 }}>
                    <defs>
                      <linearGradient id="dshPartsBar" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#7c3aed" />
                        <stop offset="100%" stopColor="#c4b5fd" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e3ebf5" />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="partName" fontSize={11} width={140} tickLine={false} axisLine={false} />
                    <Tooltip {...chartTooltip} />
                    <Bar dataKey="qty" fill="url(#dshPartsBar)" radius={[0, 8, 8, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="dsh-panel">
            <h3>Repeat Complaints (vehicles with &gt;1 visit)</h3>
            <p className="dsh-panel-sub">Vehicles that came back more than once in this selection.</p>
            <table className="dsh-table">
              <thead><tr><th>Reg No</th><th>Visits</th></tr></thead>
              <tbody>
                {data.repeatComplaints.map((r, i) => (
                  <tr key={i}><td>{r.regNo ?? '-'}</td><td>{r.visits}</td></tr>
                ))}
                {data.repeatComplaints.length === 0 && (
                  <tr><td colSpan={2} className="dsh-empty">No repeat visits in this selection.</td></tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}