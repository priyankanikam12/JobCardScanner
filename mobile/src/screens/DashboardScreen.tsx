// mobile\src\screens\DashboardScreen.tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { PickerField } from '../components/PickerField'
import { ANDROID_PAGES, useMenuAccess, type NavItem } from '../navigation/menuAccess'
import type { CorporateDashboardData, CorporateDashboardFilters, DashboardKpis } from '../types'
import type { JobCardsListFilter, RootStackParamList } from '../navigation/RootNavigator'
import { colors } from '../theme/colors'
import { DealerRoleReportScreen } from './DealerRoleReportScreen'
import type { DealerStageSummary } from '../utils/dealerRoleReportExport'

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>

// 2026-09-07: brought up to parity with the web Dealer Dashboard (web/src/pages/staff/
// DashboardPage.tsx) - same 9 KPI tiles (icon + label + the exact filter that reproduces the
// number), the same Revenue/Avg Service Time/CSAT row, and the same "Job Cards by Status"
// breakdown (a hand-rolled horizontal bar list here since there's no charting library in the
// mobile app yet - recharts is web-only - rather than pulling in a new native dependency for one
// screen). Also adds the BGauss branding this screen never had: the brand logo + a scooter
// illustration in a "Hub Pulse"-navy hero card up top, matching the reference app's branded
// dashboard header. Reported directly: "open close all this jobcards are shown real shown data
// close jobcards also show and ui attractive do same like web ui for android".
//
// Requires three image files to already exist at mobile/assets/ (same filenames the request
// named): BGauss_Logo.png (in-app header logo, used below) and Bg0-scooty.png (hero
// illustration, used below) - BG_Logo.png is used separately, as the Android app icon, in
// app.json. If either require() below fails to resolve, the two asset files just aren't present
// in this checkout of mobile/assets/ yet.
const LOGO = require('../../assets/BGauss_Logo.png')
const SCOOTER = require('../../assets/Bg0-scooty.png')

// Left-border/icon accent color, cycling through this palette (mirrors web's kpi-a1..a6 rotation
// in global.css) so a 9-tile grid stays visually distinguishable at a glance.
const ACCENTS = [colors.primary, colors.success, colors.amber, '#7c3aed', '#db2777', '#0891b2']

// Exact same 9 tiles, in the exact same order, with the exact same icons, as web's TILES array -
// each `to` is the JobCardsListFilter that reproduces the tile's own number, matching
// JobCardsController.List's dashboard-filter query params the same way web's `to` URLs do.
const TILES: { key: keyof DashboardKpis; label: string; icon: string; to: JobCardsListFilter }[] = [
  { key: 'vehiclesReceivedToday', label: 'Vehicles Received Today', icon: '🚗', to: { createdToday: true } },
  { key: 'totalOpen', label: 'Open Job Cards', icon: '📋', to: { excludeClosed: true } },
  { key: 'underService', label: 'Under Service', icon: '🔧', to: { stageKey: 'in_repair' } },
  { key: 'waitingForParts', label: 'Waiting for Parts', icon: '📦', to: { stageKey: 'part_suggestion' } },
  { key: 'waitingCustomerApproval', label: 'Waiting Customer Approval', icon: '✅', to: { status: 'PendingCustomerApproval' } },
  { key: 'vehiclesReady', label: 'Vehicles Ready', icon: '🏁', to: { stageKey: 'ready_for_delivery' } },
  { key: 'vehiclesDeliveredToday', label: 'Vehicles Delivered', icon: '🚀', to: { deliveredToday: true } },
  { key: 'pendingJobCards', label: 'Pending Job Cards', icon: '⏳', to: { pendingBucket: true } },
  { key: 'warrantyJobsOpen', label: 'Warranty Jobs', icon: '🛡️', to: { warrantyOnly: true, excludeClosed: true } },
]

/**
 * 2026-10-22 (web/src/pages/staff/DashboardPage.tsx parity): the dashboard branches by role, exactly like web - CorporateAdmin / SystemAdmin get the "Corporate Dashboard" (Today / Overall roll-up across
 * every dealer, dealer-wise volume, filters, revenue / warranty cost / CSAT and the trend charts), everyone else gets the single-dealer "Dealer Dashboard" (today's operations board). Both end with the
 * "All Pages" list: every page the signed-in role may open, decided by the Menu Access rules (navigation/menuAccess.ts) - the same ones that drive web's sidebar and its own "All Pages" grid - so a role
 * never sees a page here that web would hide from it. The six fixed shortcut cards of 30.09.2026 are replaced by that list.
 */
export function DashboardScreen(props: Props) {
  const { hasRole } = useStaffAuth()
  return hasRole('CorporateAdmin', 'SystemAdmin') ? <CorporateDashboard {...props} /> : <DealerDashboard {...props} />
}

type PageNav = Props['navigation']

/** "All Pages": every Android page this login may open (Menu Access rules), as tappable cards. */
function AllPages({ navigation }: { navigation: PageNav }) {
  const { isVisibleForCurrentRole } = useMenuAccess()
  const go = (item: NavItem) => (navigation.navigate as (screen: string, params?: object) => void)(item.screen as string, item.params)
  const pages = ANDROID_PAGES.filter(isVisibleForCurrentRole)
  return (
    <View>
      <Text style={styles.sectionTitle}>All Pages</Text>
      <Text style={styles.sectionNote}>Every page you have access to, in one place.</Text>
      <View style={styles.actions}>
        {pages.map((n, i) => (
          <ActionCard key={n.key} icon={n.icon} accent={ACCENTS[i % ACCENTS.length]} title={n.label} subtitle={n.subtitle ?? n.label} onPress={() => go(n)} />
        ))}
        {pages.length === 0 && <Text style={styles.sectionNote}>No page is assigned to your role yet. Ask your administrator.</Text>}
      </View>
    </View>
  )
}

function DealerDashboard({ navigation }: Props) {
  const { profile } = useStaffAuth()
  const [kpis, setKpis] = useState<DashboardKpis | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = () => {
    setRefreshing(true)
    apiClient.get<DashboardKpis>('/api/dashboard/kpis').then((r) => setKpis(r.data)).finally(() => setRefreshing(false))
  }

  useEffect(load, [])

  // 2026-09-29 (SECTION 157, "fix login wise jobcard open close for supervisor dont have any
  // jobcard then still shown main dealer count fix this") - same bug, same fix, as web's
  // DashboardPage.tsx (see that file's own SECTION 157 doc comment for the full root-cause
  // writeup): GET /api/dashboard/kpis counts every tile DEALER-WIDE, not scoped to this login's own
  // Work Area (WorkLocationCodes) the way GET /api/jobcards (JobCardsController.List, its actual
  // source re-read this round) already is - confirmed real, not a guess, from that controller's own
  // doc comment: "a user assigned to specific DMS workshop locations only sees job cards opened at
  // one of THEIR locations". A Supervisor whose Work Area has zero matching job cards was still
  // seeing the whole dealer's numbers on these 9 tiles because they came from the unscoped endpoint.
  //
  // FIX: each TILES entry's own `to` object is ALREADY the exact shape GET /api/jobcards needs as
  // its query params (createdToday/excludeClosed/stageKey/status/deliveredToday/pendingBucket/
  // warrantyOnly - the same names, reused as-is below for BOTH navigation.navigate AND this count
  // fetch), so no new filter mapping was needed on this screen, unlike web where a separate
  // `params` field had to be added alongside the URL-string `to`.
  //
  // ASSUMPTION (flagging, since I don't have mobile/src/api/client.ts in this session to confirm
  // apiClient's exact method signature): apiClient.get(url, { params }) works the same way
  // staffApi.get(url, { params }) already does on web (both axios-style clients) - CorporateDashboard
  // on web already calls staffApi.get(..., { params: {...} }) this same way, so this mirrors an
  // already-working pattern, just on the mobile client instead. If apiClient's `params` option
  // doesn't exist or is named differently, this call will need a small adjustment - tell me what
  // VS Code/the Android build reports and I'll fix it directly.
  //
  // KNOWN LIMIT, same as web: GET /api/jobcards caps at 200 rows with no total-count field, so a
  // tile whose true count exceeds 200 will under-report - unlikely for one Work Area's open job
  // cards, but flagging it rather than hiding it.
  //
  // NOT FIXED by this change (still dealer-wide, unscoped, still straight from kpis): Revenue (Paid
  // Invoices), Avg. Service Time, Customer Satisfaction, and the Job Cards by Status bars further
  // down this screen - see web DashboardPage.tsx's identical note for why those four can't be
  // reproduced from a simple job-card-count filter.
  const [scopedCounts, setScopedCounts] = useState<Partial<Record<keyof DashboardKpis, number>> | null>(null)
  useEffect(() => {
    Promise.all(
      TILES.map((t) =>
        apiClient
          .get<{ items: unknown[] }>('/api/jobcards', { params: t.to })
          .then((r): [keyof DashboardKpis, number] => [t.key, r.data.items.length])
          .catch((): [keyof DashboardKpis, number | undefined] => [t.key, undefined]),
      ),
    ).then((pairs) => {
      const next: Partial<Record<keyof DashboardKpis, number>> = {}
      pairs.forEach(([key, count]) => { if (count !== undefined) next[key] = count })
      setScopedCounts(next)
    })
  }, [])

  // 2026-09-28 ("Stock cards in that total stock shown ... in android also") - mirrors web's
  // DealerDashboard exactly, see that file's own stockQty doc comment for the full reasoning: no
  // DashboardController.cs in this session to add a server field, so this sums GET /api/part-uploads
  // (balQty ?? 0 per row, all locations for this dealer) client-side instead. stockError only
  // distinguishes "still loading" from "the call failed" for future debugging - the tile shows "—"
  // either way rather than a wrong number.
  //
  // 2026-09-29 (SECTION 157, then FIXED same day - SECTION 158) - same "Part Upload location
  // scoping" gap flagged on web, now fixed at the real backend source (GET /api/part-uploads is
  // now WorkLocationCodes-scoped - see PartUploadController.cs's own SECTION 158 doc comment). No
  // change needed on this screen - it already just sums whatever that endpoint returns.
  const [stockQty, setStockQty] = useState<number | null>(null)
  const [stockError, setStockError] = useState(false)
  useEffect(() => {
    apiClient
      .get<{ balQty: number | null }[]>('/api/part-uploads')
      .then((r) => setStockQty(r.data.reduce((sum, row) => sum + (row.balQty ?? 0), 0)))
      .catch(() => setStockError(true))
  }, [])

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}>
        <View style={styles.hero}>
          <View style={styles.heroLeft}>
            <Image source={LOGO} style={styles.heroLogo} resizeMode="contain" />
            <Text style={styles.hello}>Hi, {profile?.name?.split(' ')[0]}</Text>
            <Text style={styles.role}>{profile?.role} · {profile?.dealerName ?? 'All Dealers'}</Text>
          </View>
          <Image source={SCOOTER} style={styles.heroScooter} resizeMode="contain" />
        </View>

        {!kpis ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading dashboard...</Text>
          </View>
        ) : (
          <>
            <View style={styles.grid}>
              {TILES.map((t, i) => (
                <Kpi
                  key={t.key}
                  icon={t.icon}
                  label={t.label}
                  value={scopedCounts === null ? '…' : scopedCounts[t.key] ?? (kpis[t.key] as number)}
                  accent={ACCENTS[i % ACCENTS.length]}
                  onPress={() => navigation.navigate('JobCardsList', t.to)}
                />
              ))}
              {/* 2026-09-28 ("WARRANTY JOBS this after 1 card add Stock cards ... redirect on
                 /part-upload page ... in android also"): right after Warranty Jobs (TILES' own
                 last entry), per your confirmed route (PartUpload - same screen name Part Upload's
                 own ActionCard below already navigates to). */}
              <Kpi
                icon="📦"
                label="Stock Qty"
                value={stockError ? '—' : stockQty === null ? '…' : stockQty.toLocaleString('en-IN')}
                accent={ACCENTS[TILES.length % ACCENTS.length]}
                onPress={() => navigation.navigate('PartUpload')}
              />
            </View>

            {/* 2026-10-22 (web parity): the Revenue (Paid Invoices) / Avg. Service Time / Customer Satisfaction tiles are commented out of web's Dealer Dashboard, so they are not shown here either. */}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Job Cards by Status</Text>
              <Text style={styles.cardSubtitle}>Tap a bar to see those job cards - Closed ones included.</Text>
              <StatusBars data={kpis.byStatus} onPress={(status) => navigation.navigate('JobCardsList', { status })} />
            </View>
          </>
        )}

        <AllPages navigation={navigation} />
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  )
}

function Kpi({ icon, label, value, accent, onPress }: { icon: string; label: string; value: string | number; accent: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.kpi, { borderLeftColor: accent }, pressed && styles.kpiPressed]} onPress={onPress}>
      <Text style={styles.kpiIcon}>{icon}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </Pressable>
  )
}

/** Horizontal bar list standing in for web's recharts BarChart - each bar's width is proportional
 * to the largest count in the set, so "Closed" (or whichever status has the most job cards) always
 * fills the row completely and every other status reads relative to it. Tapping a row deep-links
 * to /jobcards filtered to that exact status, same as web's onClick handler on its own bars. */
function StatusBars({ data, onPress }: { data: { status: string; count: number }[]; onPress: (status: string) => void }) {
  if (data.length === 0) return <Text style={styles.cardSubtitle}>No job cards yet.</Text>
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <View style={{ gap: 10, marginTop: 4 }}>
      {data.map((d) => (
        <Pressable key={d.status} onPress={() => onPress(d.status)} style={styles.statusRow}>
          <Text style={styles.statusLabel} numberOfLines={1}>{d.status}</Text>
          <View style={styles.statusTrack}>
            <View style={[styles.statusFill, { width: `${Math.max(4, (d.count / max) * 100)}%` }]} />
          </View>
          <Text style={styles.statusCount}>{d.count}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function ActionCard({ title, subtitle, icon, accent, onPress }: { title: string; subtitle: string; icon?: string; accent?: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.actionCard, accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : null]} onPress={onPress}>
      {icon ? <Text style={styles.actionIcon}>{icon}</Text> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
    </Pressable>
  )
}

/** A horizontal bar list standing in for web's recharts bars - widths are relative to the largest value. */
function BarList({ rows, color = colors.primary, unit = '' }: { rows: { label: string; value: number }[]; color?: string; unit?: string }) {
  if (rows.length === 0) return <Text style={styles.cardSubtitle}>Nothing in this selection.</Text>
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      {rows.map((r, i) => (
        <View key={`${r.label}-${i}`} style={styles.statusRow}>
          <Text style={[styles.statusLabel, { width: 110 }]} numberOfLines={1}>{r.label}</Text>
          <View style={styles.statusTrack}>
            <View style={[styles.statusFill, { backgroundColor: color, width: `${Math.max(4, (r.value / max) * 100)}%` }]} />
          </View>
          <Text style={[styles.statusCount, { width: 46 }]}>{r.value}{unit}</Text>
        </View>
      ))}
    </View>
  )
}

const WARRANTY_OPTIONS = [
  { value: '', label: 'Warranty & Non-Warranty' },
  { value: 'warranty', label: 'Warranty Only' },
  { value: 'nonwarranty', label: 'Non-Warranty Only' },
]
const allOption = (label: string, values: string[]) => [{ value: '', label }, ...values.map((v) => ({ value: v, label: v }))]

/**
 * Corporate Dashboard (CorporateAdmin / SystemAdmin) - web's CorporateDashboard: the Today / Overall roll-up across every dealer (a tap opens the Dealer Role Report on that card), the dealer-wise job
 * card volume, the All Pages list, then the filterable Revenue / Warranty Cost / CSAT tiles with the volume trend, average TAT by dealer, top parts consumption and repeat complaints. Web's
 * commented-out "Open Job Cards / Dealers / Staff / Parts Stock" tile row is not shown here either. recharts bars become the proportional bar lists above.
 */
function CorporateDashboard({ navigation }: Props) {
  const { profile } = useStaffAuth()
  const [filterOptions, setFilterOptions] = useState<CorporateDashboardFilters | null>(null)
  const [filters, setFilters] = useState({ region: '', state: '', city: '', dealerId: '', model: '', warranty: '' })
  const [data, setData] = useState<CorporateDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [todaySummary, setTodaySummary] = useState<DealerStageSummary | null>(null)
  const [overallSummary, setOverallSummary] = useState<DealerStageSummary | null>(null)
  const [todayError, setTodayError] = useState(false)
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()

  const loadSummaries = () => {
    apiClient.get<DealerStageSummary>('/api/dashboard/dealer-stage-report/summary', { params: { dateFrom: todayStr, dateTo: todayStr } })
      .then((r) => setTodaySummary(r.data)).catch(() => setTodayError(true))
    apiClient.get<DealerStageSummary>('/api/dashboard/dealer-stage-report/summary')
      .then((r) => setOverallSummary(r.data)).catch(() => setTodayError(true))
  }
  useEffect(loadSummaries, [todayStr])
  useEffect(() => {
    apiClient.get<CorporateDashboardFilters>('/api/dashboard/corporate/filters').then((r) => setFilterOptions(r.data)).catch(() => { /* the filters just stay empty */ })
  }, [])
  const loadData = () => {
    setLoading(true)
    apiClient
      .get<CorporateDashboardData>('/api/dashboard/corporate', {
        params: {
          region: filters.region || undefined, state: filters.state || undefined, city: filters.city || undefined,
          dealerId: filters.dealerId || undefined, model: filters.model || undefined, warranty: filters.warranty || undefined,
        },
      })
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }
  useEffect(loadData, [filters])

  const ROWS = [
    { title: 'Today', src: todaySummary, from: todayStr, to: todayStr },
    { title: 'Overall', src: overallSummary, from: '', to: '' },
  ] as const
  const CARDS = [
    { key: 'created', label: 'Job cards created', icon: '📋' },
    { key: 'inProgress', label: 'In Progress', icon: '🔧' },
    { key: 'materialTransfers', label: 'Material Transfer', icon: '🔄' },
    { key: 'repairBills', label: 'Repair Bill', icon: '🧾' },
    { key: 'readyForDelivery', label: 'Ready For Delivery', icon: '🏁' },
  ] as const

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadSummaries(); loadData() }} />}>
        <View style={styles.hero}>
          <View style={styles.heroLeft}>
            <Image source={LOGO} style={styles.heroLogo} resizeMode="contain" />
            <Text style={styles.hello}>Hi, {profile?.name?.split(' ')[0]}</Text>
            <Text style={styles.role}>{profile?.role} · {profile?.dealerName ?? 'All Dealers'}</Text>
          </View>
          <Image source={SCOOTER} style={styles.heroScooter} resizeMode="contain" />
        </View>

        {ROWS.map((row) => (
          <View key={row.title} style={styles.card}>
            <Text style={styles.cardTitle}>{row.title}</Text>
            <Text style={styles.cardSubtitle}>{row.title === 'Today' ? 'Job cards, Material Transfers and Repair Bills dated today, across all dealers.' : 'All dates. In Progress and Ready For Delivery are what is in that stage right now.'} Tap a card for the dealer-wise detail.</Text>
            <View style={[styles.grid, { marginTop: 10, marginBottom: 0 }]}>
              {CARDS.map((c, i) => (
                <Kpi
                  key={c.key}
                  icon={c.icon}
                  label={c.label}
                  value={todayError ? '—' : row.src ? row.src.totals[c.key] : '…'}
                  accent={ACCENTS[i % ACCENTS.length]}
                  onPress={() => navigation.navigate('DealerRoleReport', { status: c.key, scope: 'all', from: row.from, to: row.to })}
                />
              ))}
            </View>
          </View>
        ))}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Job Card Volume by Dealer</Text>
          <Text style={styles.cardSubtitle}>Dealer-wise count of job cards.</Text>
          {loading || !data ? <ActivityIndicator color={colors.primary} style={{ marginTop: 10 }} /> : <BarList rows={data.jobCardVolumeByDealer.map((d) => ({ label: d.dealerName, value: d.count }))} color={colors.success} />}
        </View>

        <ActionCard icon="📈" accent={colors.primary} title="Dealer Role Report" subtitle="Dealer & role-wise job cards: submitted / open / closed" onPress={() => navigation.navigate('DealerRoleReport')} />
        <View style={{ height: 16 }} />

        <AllPages navigation={navigation} />

        <View style={[styles.card, { marginTop: 8 }]}>
          <Text style={styles.cardTitle}>Filters</Text>
          <View style={{ gap: 8, marginTop: 8 }}>
            <PickerField label="Region" value={filters.region} onChange={(v) => setFilters({ ...filters, region: v })} options={allOption('All Regions', filterOptions?.regions ?? [])} />
            <PickerField label="State" value={filters.state} onChange={(v) => setFilters({ ...filters, state: v })} options={allOption('All States', filterOptions?.states ?? [])} />
            <PickerField label="City" value={filters.city} onChange={(v) => setFilters({ ...filters, city: v })} options={allOption('All Cities', filterOptions?.cities ?? [])} />
            <PickerField label="Dealer" value={filters.dealerId} onChange={(v) => setFilters({ ...filters, dealerId: v })} options={[{ value: '', label: 'All Dealers' }, ...(filterOptions?.dealers ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
            <PickerField label="Model" value={filters.model} onChange={(v) => setFilters({ ...filters, model: v })} options={allOption('All Models', filterOptions?.models ?? [])} />
            <PickerField label="Warranty" value={filters.warranty} onChange={(v) => setFilters({ ...filters, warranty: v })} options={WARRANTY_OPTIONS} />
          </View>
        </View>

        {loading || !data ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading dashboard...</Text>
          </View>
        ) : (
          <>
            <View style={styles.grid}>
              <Kpi icon="₹" label="Revenue" value={`₹${data.revenue.toLocaleString()}`} accent={colors.success} onPress={() => undefined} />
              <Kpi icon="🛡️" label="Warranty Cost" value={`₹${data.warrantyCost.toLocaleString()}`} accent={colors.amber} onPress={() => undefined} />
              <Kpi icon="⭐" label={`CSAT${data.csat.average == null ? ' (no ratings yet)' : ''}`} value={data.csat.average != null ? `${data.csat.average.toFixed(1)} / 5` : '—'} accent="#db2777" onPress={() => undefined} />
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Job Card Volume Trend</Text>
              <BarList rows={data.jobCardVolumeTrend.map((d) => ({ label: d.date, value: d.count }))} color={colors.success} />
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Average TAT by Dealer (hours)</Text>
              <BarList rows={data.avgTatByDealer.map((d) => ({ label: d.dealerName, value: Math.round(d.avgHours * 10) / 10 }))} color="#0ea5e9" unit=" h" />
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top Parts Consumption</Text>
              <BarList rows={data.topPartsConsumption.map((d) => ({ label: d.partName, value: d.qty }))} color="#8b5cf6" />
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Repeat Complaints (vehicles with {'>'}1 visit)</Text>
              {data.repeatComplaints.length === 0 && <Text style={styles.cardSubtitle}>No repeat visits in this selection.</Text>}
              {data.repeatComplaints.map((r, i) => (
                <View key={i} style={styles.repeatRow}>
                  <Text style={styles.statusLabel}>{r.regNo ?? '-'}</Text>
                  <Text style={styles.statusCount}>{r.visits}</Text>
                </View>
              ))}
            </View>
          </>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: 16 },

  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.navy,
    borderRadius: 14,
    padding: 16,
    marginBottom: 18,
    overflow: 'hidden',
  },
  heroLeft: { flex: 1 },
  heroLogo: { width: 120, height: 32, marginBottom: 10 },
  heroScooter: { width: 84, height: 84, marginLeft: 8 },
  hello: { fontSize: 20, fontWeight: '700', color: colors.onNavyText },
  role: { fontSize: 12, color: colors.onNavyMuted, marginTop: 2 },

  loading: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  loadingText: { color: colors.textMuted, fontSize: 13 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  kpi: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, width: '31%', borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4 },
  kpiPressed: { backgroundColor: colors.bg },
  kpiIcon: { fontSize: 16, marginBottom: 4 },
  kpiValue: { fontSize: 18, fontWeight: '700', color: colors.text },
  kpiLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  card: { backgroundColor: colors.surface, borderRadius: 10, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusLabel: { width: 84, fontSize: 12, color: colors.text, fontWeight: '600' },
  statusTrack: { flex: 1, height: 14, borderRadius: 7, backgroundColor: colors.bg, overflow: 'hidden' },
  statusFill: { height: '100%', borderRadius: 7, backgroundColor: colors.primary },
  statusCount: { width: 28, textAlign: 'right', fontSize: 12, fontWeight: '700', color: colors.text },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 4 },
  sectionNote: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 8 },
  repeatRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  actions: { gap: 10, marginBottom: 8 },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 10, padding: 16, borderWidth: 1, borderColor: colors.border },
  actionIcon: { fontSize: 22 },
  actionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  actionSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
})
