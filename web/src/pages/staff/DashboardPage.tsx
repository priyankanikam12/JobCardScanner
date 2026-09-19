import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import { NAV_ITEMS } from '../../components/StaffLayout'
import type { CorporateDashboardData, CorporateDashboardFilters, DashboardKpis } from '../../types'

// 2026-09-18 "in dashboardpage add this all page landing page linking" - every sidebar destination,
// as its own clickable card, so the dashboard works as a landing page to the whole app and not just
// the 4 hand-picked shortcuts in ACTION_CARDS/CORPORATE_ACTION_CARDS below. Reuses StaffLayout's own
// NAV_ITEMS (now exported) rather than a second hand-maintained list, so a page's role-gating can't
// drift between the sidebar and this grid - Dashboard itself is excluded since you're already on it.
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
const TILES: { key: keyof DashboardKpis; label: string; icon: string; to: string; actionNeeded?: boolean }[] = [
  { key: 'vehiclesReceivedToday', label: 'Vehicles Received Today', icon: '🚗', to: '/jobcards?createdToday=true' },
  { key: 'totalOpen', label: 'Open Job Cards', icon: '📋', to: '/jobcards?excludeClosed=true' },
  { key: 'underService', label: 'Under Service', icon: '🔧', to: '/jobcards?stageKey=in_repair' },
  { key: 'waitingForParts', label: 'Waiting for Parts', icon: '📦', to: '/jobcards?stageKey=part_suggestion', actionNeeded: true },
  { key: 'waitingCustomerApproval', label: 'Waiting Customer Approval', icon: '⏳', to: '/jobcards?status=PendingCustomerApproval', actionNeeded: true },
  { key: 'vehiclesReady', label: 'Vehicles Ready', icon: '🏁', to: '/jobcards?stageKey=ready_for_delivery' },
  { key: 'vehiclesDeliveredToday', label: 'Vehicles Delivered', icon: '🚀', to: '/jobcards?deliveredToday=true' },
  { key: 'pendingJobCards', label: 'Pending Job Cards', icon: '⏳', to: '/jobcards?pendingBucket=true', actionNeeded: true },
  { key: 'warrantyJobsOpen', label: 'Warranty Jobs', icon: '🛡️', to: '/jobcards?warrantyOnly=true&excludeClosed=true' },
]

function DealerDashboard() {
  const { profile, hasRole } = useStaffAuth()
  const navigate = useNavigate()
  const [kpis, setKpis] = useState<DashboardKpis | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    staffApi
      .get<DashboardKpis>('/api/dashboard/kpis')
      .then((res) => setKpis(res.data))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="muted">Loading dashboard...</p>
  if (!kpis) return <p className="muted">Could not load dashboard.</p>

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Dealer Dashboard</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>Live workshop operations overview</p>
      </div>

      {/* 2026-09-19 "remove 4 kpi cards from dashboard it will duplicate" - you clarified this
          meant the top action-card row (New Job Card, Job Cards, Reports & Search, Employees):
          removed outright, since "All Pages" right below already links to Job Cards, Reports &
          Search and Employees, and New Job Card is one click away from the Job Cards page itself -
          keeping both rows was showing the same destinations twice. */}
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ marginBottom: 2 }}>All Pages</h3>
        <p className="muted" style={{ marginTop: 0 }}>Every page you have access to, in one place.</p>
      </div>
      <div className="action-card-grid">
        {ALL_PAGES.filter((n) => !n.roles || hasRole(...n.roles)).map((n, i) => (
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
        {TILES.map((t, i) => (
          // Every tile is a Link to the /jobcards filter that reproduces its own number - see
          // TILES' doc comment above for how each `to` matches DashboardController.Kpis' own
          // computation.
          <Link key={t.key} to={t.to} className={`kpi kpi-a${(i % 6) + 1}`} style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
            {t.actionNeeded && <span className="kpi-badge-action">Action Needed</span>}
            <div className="kpi-icon">{t.icon}</div>
            <div className="value">{kpis[t.key] as number}</div>
            <div className="label">{t.label}</div>
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
  const { hasRole } = useStaffAuth() // used by the "All Pages" grid's role filter below
  const [filterOptions, setFilterOptions] = useState<CorporateDashboardFilters | null>(null)
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

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Corporate Dashboard</h2>
      <p className="muted" style={{ marginTop: 0 }}>Consolidated visibility across all dealers</p>

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
        {/* No role filter needed here beyond what's already on ALL_PAGES itself - only
           Corporate/System Admin ever render this component, and every restricted NAV_ITEMS entry
           already includes both of those roles (see StaffLayout.tsx), so nothing here would ever
           be hidden from this dashboard anyway. Filtered anyway for safety if that ever changes. */}
        {ALL_PAGES.filter((n) => !n.roles || hasRole(...n.roles)).map((n, i) => (
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
            {/* Only this tile links out - Revenue/Warranty Cost/CSAT are computed off Invoices (or,
               for CSAT, off a rating system that doesn't exist yet - see DealerDashboard's own
               CSAT tile comment), not a job-card count, so there's no /jobcards filter that
               actually reproduces those numbers the way there is for Pending Vehicles. The
               region/state/city/dealer/model filter bar above isn't passed through - JobCardsListPage
               doesn't support those dimensions today, only status/stageKey/q. */}
            <Link to="/jobcards?excludeClosed=true" className="kpi kpi-a4" style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
              <span className="kpi-badge-action">Action Needed</span>
              <div className="kpi-icon">🚗</div>
              <div className="value">{data.pendingVehicles}</div>
              <div className="label">Pending Vehicles</div>
            </Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
            <div className="card">
              <h3>Job Card Volume by Dealer</h3>
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
            </div>

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

