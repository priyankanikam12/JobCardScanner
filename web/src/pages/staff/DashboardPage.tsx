import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { CorporateDashboardData, CorporateDashboardFilters, DashboardKpis } from '../../types/types_index'

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

const TILES: { key: keyof DashboardKpis; label: string; icon: string }[] = [
  { key: 'vehiclesReceivedToday', label: 'Vehicles Received Today', icon: '🚗' },
  { key: 'totalOpen', label: 'Open Job Cards', icon: '📋' },
  { key: 'underService', label: 'Under Service', icon: '🔧' },
  { key: 'waitingForParts', label: 'Waiting for Parts', icon: '📦' },
  { key: 'waitingCustomerApproval', label: 'Waiting Customer Approval', icon: '✅' },
  { key: 'vehiclesReady', label: 'Vehicles Ready', icon: '🏁' },
  { key: 'vehiclesDeliveredToday', label: 'Vehicles Delivered', icon: '🚀' },
  { key: 'pendingJobCards', label: 'Pending Job Cards', icon: '⏳' },
  { key: 'warrantyJobsOpen', label: 'Warranty Jobs', icon: '🛡️' },
]

const QUICK_LINKS: { label: string; to: string }[] = [
  { label: 'Open Job Cards', to: '/jobcards' },
  { label: 'Waiting for Parts', to: '/jobcards?stageKey=parts_requested' },
  { label: 'Awaiting Approval', to: '/jobcards?status=PendingCustomerApproval' },
  { label: 'Ready for Pickup', to: '/jobcards?stageKey=ready_for_delivery' },
  { label: 'Reports', to: '/reports' },
]

function DealerDashboard() {
  const { profile, hasRole } = useStaffAuth()
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>Dealer Dashboard</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Live workshop operations overview</p>
        </div>
        {hasRole('ServiceAdvisor', 'WorkshopManager', 'DealerAdmin') && (
          <Link className="btn btn-primary" to="/jobcards/new">+ New Job Card</Link>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
        {TILES.map((t) => (
          <div key={t.key} className="card" style={{ margin: 0 }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{t.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{kpis[t.key] as number}</div>
            <div className="muted">{t.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Revenue (Paid Invoices)</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>₹{kpis.revenuePaidInvoices.toLocaleString()}</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Avg. Service Time</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{kpis.avgTurnaroundHours} hrs</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Customer Satisfaction</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {kpis.csat.average != null ? `${kpis.csat.average.toFixed(1)} / 5` : 'No ratings yet'}
          </div>
          {kpis.csat.ratingsCount > 0 && <div className="muted" style={{ fontSize: 12 }}>({kpis.csat.ratingsCount} ratings)</div>}
        </div>
      </div>

      <div className="card">
        <h3>Quick links</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {QUICK_LINKS.map((l) => (
            <Link key={l.label} to={l.to} className="btn btn-sm">{l.label}</Link>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Job Cards by Status</h3>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={kpis.byStatus}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="status" fontSize={12} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
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

function CorporateDashboard() {
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, margin: '20px 0' }}>
            <div className="card" style={{ margin: 0 }}>
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Revenue</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>₹{data.revenue.toLocaleString()}</div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Warranty Cost</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>₹{data.warrantyCost.toLocaleString()}</div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>CSAT</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{data.csat.average != null ? `${data.csat.average.toFixed(1)} / 5` : 'No ratings yet'}</div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Pending Vehicles</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{data.pendingVehicles}</div>
            </div>
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