// web\src\pages\staff\DealerRoleReportPage.tsx
import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { staffApi } from '../../api/client'
import { isReportDealer } from '../../lib/reportDealers'
import {
  STAGE_COLUMNS, exportDealerRoleReportExcel, exportDealerRoleReportPdf, exportDealerSummaryExcel, exportDealerSummaryPdf,
  fmtDateTime, periodLabel,
  type DealerStageReport, type DealerStageSummary, type StageCounts,
} from '../../lib/dealerRoleReportExport'

/**
 * Dealer Role Report - stage-wise, drill-down version (2026-10-05).
 *
 * THE FLOW ("on dashboard default today Open / Closed / Ready For Delivery / Invoiced ... redirect
 * on 1 page ... Filters shown Date select and below All KPI cards using daterange count update and
 * on that card click then dealer ... and click on dealer cards that under all user and jobcard"):
 *
 *   Dashboard card ──► this page  (?status=open|closed|readyForDelivery|invoiced&from=&to=)
 *     1. ALL DEALERS view: Date filter + KPI cards (Created, Open, In Progress, Ready for Delivery,
 *        Invoiced, Closed) counted over the chosen dates, across the dealers shown here.
 *     2. Click a KPI card ──► one card per dealer showing that stage's count for each dealer.
 *     3. Click a dealer card ──► that dealer's report: roles, the people under each role, and the
 *        job cards - opened already filtered to the stage you clicked, with every role expanded.
 *     Every number, chart bar, role and person at step 3 is also clickable and lists its job cards.
 *   The Dealer dropdown jumps straight to step 3 for a dealer ("All dealers" goes back to step 1).
 *
 * WHICH DEALERS: only the dealers in lib/reportDealers.ts (edit that one list) - the dropdown, the
 * dealer cards and the totals all use it. Stage definitions (Open / In Progress / Ready for Delivery /
 * Invoiced / Closed / Other) live in backend DealerStageReportController.cs - read its doc comment,
 * they are interpretations to check. "Created" is the old "Job Cards Submitted".
 * Download Excel/PDF export whatever level you are on (dealer-wise summary, or one dealer's report).
 */

interface DealerOption { id: string; name: string }
type DealerRow = { id: string; name?: string; active?: boolean; isActive?: boolean }

type StageKey = 'created' | 'notClosed' | 'open' | 'inProgress' | 'readyForDelivery' | 'invoiced' | 'closed'
type DrillStage = StageKey | 'other'
interface DrillFilter {
  title: string
  stage: DrillStage
  role?: string
  /** Set (even to null, for the "Unknown creator" row) to filter to one person. */
  user?: { id: string | null }
}

const STAGES: { key: StageKey; label: string; icon: string; accent: string }[] = [
  { key: 'created', label: 'Job Cards Created', icon: '📋', accent: 'kpi-a1' },
  // Every job card that is not Closed/Cancelled - the SAME number as the dashboard's "Open Job Cards Count".
  { key: 'notClosed', label: 'Not Closed (all open)', icon: '📂', accent: 'kpi-a4' },
  { key: 'open', label: 'Open', icon: '📂', accent: 'kpi-a4' },
  { key: 'inProgress', label: 'In Progress', icon: '🔧', accent: 'kpi-a3' },
  { key: 'readyForDelivery', label: 'Ready for Delivery', icon: '🏁', accent: 'kpi-a5' },
  { key: 'invoiced', label: 'Invoiced', icon: '🧾', accent: 'kpi-a2' },
  { key: 'closed', label: 'Closed', icon: '✅', accent: 'kpi-a6' },
]
const STAGE_KEYS = STAGES.map((s) => s.key) as string[]
const stageLabel = (k: DrillStage): string => (k === 'other' ? 'Other' : STAGES.find((s) => s.key === k)?.label ?? k)

const CHART_BARS: { key: 'open' | 'inProgress' | 'readyForDelivery' | 'invoiced' | 'other'; name: string; color: string }[] = [
  { key: 'open', name: 'Open', color: '#f59e0b' },
  { key: 'inProgress', name: 'In Progress', color: '#3b82f6' },
  { key: 'readyForDelivery', name: 'Ready for Delivery', color: '#8b5cf6' },
  { key: 'invoiced', name: 'Invoiced', color: '#16a34a' },
  { key: 'other', name: 'Other', color: '#94a3b8' },
]

/** Does a job card (from the report's own list) belong to this stage? Mirrors the backend buckets. */
function matchesStage(j: { status: string; bucket: string }, stage: DrillStage): boolean {
  switch (stage) {
    case 'created': return true
    case 'closed': return j.status === 'Closed'
    case 'notClosed': return j.status !== 'Closed' && j.status !== 'Cancelled'
    case 'open': return j.bucket === 'Open'
    case 'inProgress': return j.bucket === 'InProgress'
    case 'readyForDelivery': return j.bucket === 'ReadyForDelivery'
    case 'invoiced': return j.bucket === 'Invoiced'
    case 'other': return j.bucket === 'Other'
  }
}

const PAGE_STEP = 100
const pad = (n: number) => String(n).padStart(2, '0')
const toLocalIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayIso = () => toLocalIso(new Date())
const startOfMonthIso = () => { const d = new Date(); return toLocalIso(new Date(d.getFullYear(), d.getMonth(), 1)) }

/** A count that opens its job cards when clicked (plain text when it is 0 - nothing to open). */
function Num({ n, onClick, title }: { n: number; onClick: () => void; title: string }) {
  if (n === 0) return <>{n}</>
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      style={{ color: '#2563eb', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClick() } }}
    >
      {n}
    </span>
  )
}

export function DealerRoleReportPage() {
  const [params] = useSearchParams()
  const urlStatus = params.get('status')

  // Every active dealer; `dealers` below is the subset actually shown (the Magnemite list, or ALL when scope=all).
  const [allDealers, setAllDealers] = useState<DealerOption[]>([])
  // scope=all comes from the dashboard's "Open Job Cards Count" tile: that number is across EVERY dealer, so
  // the report must be able to show every dealer too or its total could never match the tile.
  const [showAll, setShowAll] = useState(params.get('scope') === 'all')
  const [dealersLoaded, setDealersLoaded] = useState(false)
  const [dealersError, setDealersError] = useState<string | null>(null)
  const [dealerId, setDealerId] = useState('') // '' = all dealers
  const [status, setStatus] = useState<StageKey>(urlStatus && STAGE_KEYS.includes(urlStatus) ? (urlStatus as StageKey) : 'created')
  // From the dashboard cards the dates arrive in the URL (today..today); otherwise this month -> today.
  const [dateFrom, setDateFrom] = useState(params.get('from') ?? startOfMonthIso())
  const [dateTo, setDateTo] = useState(params.get('to') ?? todayIso())
  // Which job-card date the range filters on. The dashboard's "Closed today"/"Invoiced today" cards arrive with
  // basis=closed (closed that day); everything else filters on the created date.
  const [dateBasis, setDateBasis] = useState<'created' | 'closed'>(params.get('basis') === 'closed' ? 'closed' : 'created')

  const [summary, setSummary] = useState<DealerStageSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [report, setReport] = useState<DealerStageReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [drill, setDrill] = useState<DrillFilter | null>(null)
  const [shown, setShown] = useState(PAGE_STEP)
  const drillRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  /** Stage to auto-open (all roles expanded + its job cards) once the dealer's report has loaded. */
  const autoDrillRef = useRef<StageKey | null>(null)

  // ---- dealers allowed on this page ----
  useEffect(() => {
    staffApi
      .get<DealerRow[]>('/api/dealers')
      .then((res) => {
        const rows = Array.isArray(res.data) ? res.data : []
        setAllDealers(
          rows
            .filter((d) => d.active !== false && d.isActive !== false)
            .map((d) => ({ id: d.id, name: d.name ?? d.id }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      })
      .catch(() => setDealersError('Could not load the dealer list.'))
      .finally(() => setDealersLoaded(true))
  }, [])

  const dealers = showAll ? allDealers : allDealers.filter((d) => isReportDealer(d.name))

  // ---- all-dealers summary (KPI cards + dealer cards) ----
  useEffect(() => {
    if (!dealersLoaded || dealers.length === 0) { setSummary(null); return }
    setSummaryLoading(true)
    setSummaryError(null)
    staffApi
      .get<DealerStageSummary>('/api/dashboard/dealer-stage-report/summary', {
        // scope=all sends NO dealerIds so the backend counts every dealer - the same set the dashboard tile counts.
        params: { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, dateBasis: dateBasis === 'closed' ? 'closed' : undefined, dealerIds: showAll ? undefined : dealers.map((d) => d.id).join(',') },
      })
      .then((res) => setSummary(res.data))
      .catch((err: { response?: { data?: { message?: string } } }) => {
        setSummary(null)
        setSummaryError(err?.response?.data?.message ?? 'Could not load the dealer summary.')
      })
      .finally(() => setSummaryLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealersLoaded, allDealers, showAll, dateFrom, dateTo, dateBasis])

  // ---- one dealer's report ----
  useEffect(() => {
    if (!dealerId) { setReport(null); return }
    setLoading(true)
    setError(null)
    setExpanded(new Set())
    setDrill(null)
    staffApi
      .get<DealerStageReport>('/api/dashboard/dealer-stage-report', {
        params: { dealerId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, dateBasis: dateBasis === 'closed' ? 'closed' : undefined },
      })
      .then((res) => {
        setReport(res.data)
        const auto = autoDrillRef.current
        autoDrillRef.current = null
        if (auto) {
          // Arrived from a dealer card: show everyone under the dealer and the job cards for that stage.
          setExpanded(new Set(res.data.roles.map((r) => r.role)))
          openDrill({ title: `${stageLabel(auto)} job cards`, stage: auto })
        }
      })
      .catch((err: { response?: { data?: { message?: string } } }) => {
        setReport(null)
        setError(err?.response?.data?.message ?? 'Could not load the report for this dealer.')
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealerId, dateFrom, dateTo, dateBasis])

  const toggle = (role: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })

  /** Opens the job-card panel for a filter and scrolls it into view. */
  const openDrill = (f: DrillFilter) => {
    setDrill(f)
    setShown(PAGE_STEP)
    setTimeout(() => drillRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  const openDealerFromCard = (id: string) => {
    autoDrillRef.current = status
    setDealerId(id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const t = report?.totals
  const allExpanded = !!report && report.roles.length > 0 && report.roles.every((r) => expanded.has(r.role))
  const toggleStaff = () => {
    if (!report) return
    setExpanded(allExpanded ? new Set() : new Set(report.roles.map((r) => r.role)))
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const drillJobs = report && drill
    ? report.jobCards.filter((j) =>
        matchesStage(j, drill.stage) &&
        (drill.role === undefined || j.role === drill.role) &&
        (drill.user === undefined || j.createdById === drill.user.id))
    : []

  const clickable = { cursor: 'pointer' } as const
  const isDefaultDates = dateFrom === startOfMonthIso() && dateTo === todayIso()
  const hasData = dealerId ? !!report && !loading : !!summary && !summaryLoading
  const selectedDealerName = dealers.find((d) => d.id === dealerId)?.name

  const download = (kind: 'excel' | 'pdf') => {
    if (dealerId) {
      if (!report) return
      if (kind === 'excel') exportDealerRoleReportExcel(report); else exportDealerRoleReportPdf(report)
    } else {
      if (!summary) return
      if (kind === 'excel') exportDealerSummaryExcel(summary); else exportDealerSummaryPdf(summary)
    }
  }

  /** The count of one stage in a StageCounts object. */
  const countOf = (c: StageCounts, k: StageKey) => c[k]

  return (
    <div>
      {/* <p style={{ margin: '0 0 6px' }}>
        {dealerId
          ? <a href="#all-dealers" onClick={(e) => { e.preventDefault(); autoDrillRef.current = null; setDealerId('') }}>&larr; All dealers</a>
          : <Link to="/dashboard">&larr; Back to Dashboard</Link>}
      </p> */}
      <h2 style={{ marginBottom: 4 }}>Dealer Role Report</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {dealerId
          ? 'Every role under this dealer, the people in each role, and their job cards. Click any number, tile, bar or person to open those job cards.'
          : 'Job cards across the dealers below for the dates you choose. Click a tile to see it dealer by dealer, then a dealer to see its roles, people and job cards.'}
      </p>

      <div className="card">
        {/* .form-row is an equal-width grid that squeezed the Dealer select into one narrow column -
           plain flexbox instead, so the Dealer field gets the room it needs and everything wraps. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 340px', minWidth: 340, maxWidth: 480, marginBottom: 0 }}>
            <label>Dealer</label>
            <select style={{ width: '100%' }} value={dealerId} onChange={(e) => { autoDrillRef.current = null; setDealerId(e.target.value) }}>
              <option value="">All dealers ({dealers.length})</option>
              {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
            <label>{dateBasis === 'closed' ? 'Closed from' : 'Created from'}</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
            <label>{dateBasis === 'closed' ? 'Closed to' : 'Created to'}</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
            <label>Dates are</label>
            <select value={dateBasis} onChange={(e) => setDateBasis(e.target.value as 'created' | 'closed')}>
              <option value="created">Created date</option>
              <option value="closed">Closed date</option>
            </select>
          </div>
          <div className="field" style={{ flex: '0 0 auto', marginBottom: 0 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" onClick={() => { const d = todayIso(); setDateFrom(d); setDateTo(d) }}>Today</button>
              <button className="btn btn-sm" title="Switch between the Magnemite dealers and every dealer" onClick={() => { setDealerId(''); setShowAll((v) => !v) }}>
                {showAll ? 'Magnemite dealers only' : 'All dealers'}
              </button>
              {!isDefaultDates && (
                <button className="btn btn-sm" onClick={() => { setDateFrom(startOfMonthIso()); setDateTo(todayIso()) }}>This month</button>
              )}
              {(dateFrom || dateTo) && (
                <button className="btn btn-sm" onClick={() => { setDateFrom(''); setDateTo('') }}>All time</button>
              )}
            </div>
          </div>
          <div className="field" style={{ marginLeft: 'auto', marginBottom: 0 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-excel" disabled={!hasData} onClick={() => download('excel')}>Download Excel</button>
              <button className="btn btn-sm btn-pdf" disabled={!hasData} onClick={() => download('pdf')}>Download PDF</button>
            </div>
          </div>
        </div>
        {dealersError && <p className="error-text">{dealersError}</p>}
        {dealersLoaded && !dealersError && dealers.length === 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>No matching dealers found - check the list in lib/reportDealers.ts.</p>
        )}
      </div>

      {/* =============================== LEVEL 1: all dealers =============================== */}
      {!dealerId && (
        <>
          {summaryLoading && <p className="muted">Loading…</p>}
          {summaryError && <p className="error-text">{summaryError}</p>}
          {summary && !summaryLoading && (
            <>
              <p className="muted" style={{ marginBottom: 8 }}>
                <strong>{dealers.length} dealers{showAll ? ' (all)' : ''}</strong> · Period: {periodLabel(summary)} · Generated {fmtDateTime(summary.generatedAt)} IST
              </p>
              <div className="kpi-grid" style={{ margin: '8px 0 16px' }}>
                {STAGES.map((s) => (
                  <div
                    key={s.key}
                    className={`kpi ${s.accent}`}
                    style={{ ...clickable, outline: status === s.key ? '3px solid #2563eb' : undefined, outlineOffset: 1 }}
                    role="button"
                    tabIndex={0}
                    title={`Show ${s.label} dealer by dealer`}
                    onClick={() => setStatus(s.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setStatus(s.key) }}
                  >
                    <div className="kpi-icon">{s.icon}</div>
                    <div className="value">{countOf(summary.totals, s.key)}</div>
                    <div className="label">{s.label}</div>
                  </div>
                ))}
              </div>

              <h3 style={{ marginBottom: 2 }}>{stageLabel(status)} - by dealer</h3>
              <p className="muted" style={{ marginTop: 0 }}>Click a dealer to see its roles, people and job cards.</p>
              <div className="kpi-grid" style={{ margin: '8px 0 16px' }}>
                {[...summary.dealers]
                  .sort((a, b) => countOf(b, status) - countOf(a, status) || a.dealerName.localeCompare(b.dealerName))
                  .map((d) => (
                    <div
                      key={d.dealerId}
                      className="kpi kpi-a1"
                      style={clickable}
                      role="button"
                      tabIndex={0}
                      title={`Open ${d.dealerName}`}
                      onClick={() => openDealerFromCard(d.dealerId)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openDealerFromCard(d.dealerId) }}
                    >
                      <div className="kpi-icon">🏢</div>
                      <div className="value">{countOf(d, status)}</div>
                      <div className="label">{d.dealerName.replace(/^MAGNEMITE MOTO LLP-/i, '')}</div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
                        Created {d.created} · Open {d.open} · In Progress {d.inProgress}<br />
                        Ready {d.readyForDelivery} · Invoiced {d.invoiced} · Closed {d.closed}
                      </div>
                    </div>
                  ))}
                {summary.dealers.length === 0 && <p className="muted">No dealers to show.</p>}
              </div>
              <p className="muted">
                Created = job cards created in the period · Open + In Progress + Ready for Delivery + Invoiced + Other = Created · Closed overlaps Invoiced.
              </p>
            </>
          )}
        </>
      )}

      {/* =============================== LEVEL 2: one dealer =============================== */}
      {dealerId && loading && <p className="muted">Loading report…</p>}
      {dealerId && error && <p className="error-text">{error}</p>}

      {dealerId && report && t && !loading && (
        <>
          <p className="muted" style={{ marginBottom: 8 }}>
            <strong>{report.dealer.name || selectedDealerName}</strong>{report.dealer.code ? ` (${report.dealer.code})` : ''} · Period: {periodLabel(report)} · Generated {fmtDateTime(report.generatedAt)} IST
          </p>

          <div className="kpi-grid" style={{ margin: '8px 0 16px' }}>
            {STAGES.map((s) => (
              <div key={s.key} className={`kpi ${s.accent}`} style={clickable} role="button" tabIndex={0} title={`Show ${s.label} job cards`}
                onClick={() => openDrill({ title: `${s.label} job cards`, stage: s.key })}>
                <div className="kpi-icon">{s.icon}</div><div className="value">{countOf(t, s.key)}</div><div className="label">{s.label}</div>
              </div>
            ))}
            <div className="kpi kpi-a3" style={clickable} role="button" tabIndex={0} title="Show every role with its staff" onClick={toggleStaff}>
              <div className="kpi-icon">👥</div><div className="value">{t.activeUsers} / {t.users}</div>
              <div className="label">Staff (active / all)</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{allExpanded ? 'Hide staff ▲' : 'Show staff ▼'}</div>
            </div>
          </div>

          {t.created > 0 && (
            <div className="card">
              <h3>Job cards by role</h3>
              <p className="muted" style={{ marginTop: -6, marginBottom: 6 }}>Click a coloured bar to open those job cards.</p>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={report.roles.filter((r) => r.created > 0)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="role" fontSize={11} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    {CHART_BARS.map((b, i) => (
                      <Bar
                        key={b.key}
                        dataKey={b.key}
                        name={b.name}
                        stackId="a"
                        fill={b.color}
                        cursor="pointer"
                        radius={i === CHART_BARS.length - 1 ? [4, 4, 0, 0] : undefined}
                        onClick={(entry) => {
                          const role = (entry as unknown as { role?: string }).role
                          if (role) openDrill({ title: `${b.name} job cards · ${role}`, stage: b.key, role })
                        }}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 0, overflowX: 'auto' }} ref={tableRef}>
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th className="text-end">Staff</th>
                  {STAGE_COLUMNS.map((c) => (
                    <th key={c.key} className="text-end" style={{ background: status === c.key ? '#dbeafe' : undefined }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.roles.map((r) => {
                  const isOpen = expanded.has(r.role)
                  return (
                    <Fragment key={r.role}>
                      <tr onClick={() => toggle(r.role)} style={clickable} title="Click the role to show / hide its people; click a number to open those job cards">
                        <td><strong>{isOpen ? '▾' : '▸'} {r.role}</strong></td>
                        <td className="text-end">{r.users}</td>
                        {STAGE_COLUMNS.map((c) => (
                          <td key={c.key} className="text-end" style={{ background: status === c.key ? '#f0f7ff' : undefined }}>
                            <Num n={r[c.key]} title={`${c.label} - ${r.role}`} onClick={() => openDrill({ title: `${c.label} job cards · ${r.role}`, stage: c.key, role: r.role })} />
                          </td>
                        ))}
                      </tr>
                      {isOpen && r.people.map((p) => (
                        <tr key={`${r.role}-${p.userId ?? p.name}`} style={{ background: '#f8fafc' }}>
                          <td style={{ paddingLeft: 32 }}>
                            <span
                              role="button"
                              tabIndex={0}
                              title={`Open all job cards created by ${p.name}`}
                              style={{ color: '#2563eb', cursor: 'pointer' }}
                              onClick={() => openDrill({ title: `Job cards created · ${p.name}`, stage: 'created', role: r.role, user: { id: p.userId } })}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openDrill({ title: `Job cards created · ${p.name}`, stage: 'created', role: r.role, user: { id: p.userId } }) }}
                            >
                              {p.name}
                            </span>
                            {p.designation ? <span className="muted"> · {p.designation}</span> : null}
                            {!p.active ? <span className="muted"> · inactive</span> : null}
                          </td>
                          <td />
                          {STAGE_COLUMNS.map((c) => (
                            <td key={c.key} className="text-end" style={{ background: status === c.key ? '#f0f7ff' : undefined }}>
                              <Num n={p[c.key]} title={`${c.label} - ${p.name}`} onClick={() => openDrill({ title: `${c.label} job cards · ${p.name}`, stage: c.key, role: r.role, user: { id: p.userId } })} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
                {report.roles.length === 0 && (
                  <tr><td colSpan={2 + STAGE_COLUMNS.length} className="muted" style={{ textAlign: 'center', padding: 16 }}>No staff or job cards found for this dealer.</td></tr>
                )}
              </tbody>
              {report.roles.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    <td>Total</td>
                    <td className="text-end">{t.users}</td>
                    {STAGE_COLUMNS.map((c) => <td key={c.key} className="text-end">{t[c.key]}</td>)}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="muted" style={{ marginTop: 6 }}>
            Created = job cards created by a user of that role · Open + In Progress + Ready for Delivery + Invoiced + Other = Created · Closed overlaps Invoiced.
            {report.jobCardsTruncated ? ` The job-card list below and in the download shows the latest ${report.jobCards.length}; all counts are exact.` : ''}
          </p>

          {drill && (
            <div className="card" ref={drillRef} style={{ scrollMarginTop: 80 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>{drill.title} <span className="muted" style={{ fontWeight: 400 }}>({drillJobs.length})</span></h3>
                <button className="btn btn-sm" onClick={() => setDrill(null)}>Close ✕</button>
              </div>
              <div style={{ overflowX: 'auto', marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Sr</th><th>Job Card No</th><th>Created (IST)</th><th>Stage</th><th>Status</th><th>Created By</th><th>Role</th><th>Reg No</th><th>Customer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillJobs.slice(0, shown).map((j, i) => (
                      <tr key={j.id}>
                        <td>{i + 1}</td>
                        <td><Link to={`/jobcards/${j.id}`}>{j.jobCardNumber}</Link></td>
                        <td>{fmtDateTime(j.createdAt)}</td>
                        <td>{j.stage ?? '-'}</td>
                        <td>{j.status}</td>
                        <td>{j.createdBy}</td>
                        <td className="muted">{j.role}</td>
                        <td>{j.regNo ?? '-'}</td>
                        <td>{j.customerName ?? '-'}</td>
                      </tr>
                    ))}
                    {drillJobs.length === 0 && (
                      <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 16 }}>No job cards in this selection.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {drillJobs.length > shown && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-sm" onClick={() => setShown((n) => n + PAGE_STEP * 2)}>
                    Show more ({drillJobs.length - shown} remaining)
                  </button>
                </div>
              )}
              {report.jobCardsTruncated && (
                <p className="muted" style={{ marginBottom: 0 }}>
                  Only the latest {report.jobCards.length} job cards were loaded, so this list may be shorter than the count shown above.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}