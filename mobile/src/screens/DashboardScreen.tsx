// mobile\src\screens\DashboardScreen.tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import type { DashboardKpis } from '../types'
import type { JobCardsListFilter, RootStackParamList } from '../navigation/RootNavigator'
import { colors } from '../theme/colors'

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

export function DashboardScreen({ navigation }: Props) {
  // SECTION 172 (2026-09-30) - hasRole is no longer used here: Technician Employee (the one card
  // that read it, to gate Supervisor+) was removed from this screen's Actions list per your "show
  // only menu 1-6" request - see the Actions block below.
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

  // 2026-09-30 (SECTION 164, "...give alert menu assigned sucessfully for web and mobile give
  // thus" - read as: the Admin: Menu Access feature (web/src/pages/admin/MenuAccessPage.tsx,
  // Models/MenuAccessOverride.cs) should also actually affect this screen, not just web's sidebar,
  // which is the only place it did anything before this change): this screen's own "menu" is this
  // ActionCard list below - there's no separate drawer/sidebar component on Android - so each
  // ActionCard that has a web-sidebar equivalent is now hidden the same way web's NAV_ITEMS are,
  // reading the SAME GET /api/menu-access overrides web's StaffLayout.tsx reads.
  //
  // NAV KEYS below are hand-matched to web/src/components/StaffLayout.tsx's own navKeyOf(to)
  // output for the corresponding sidebar route (e.g. '/item-master' -> 'item-master') - so ONE
  // Admin: Menu Access row controls both platforms at once. "Repair Bill List" has NO web sidebar
  // equivalent (that item is commented out of web's own NAV_ITEMS_BASE - never shipped there), so
  // it is NOT wired to any key here and stays exactly as visible as it always was - there is
  // nothing to restrict it from on the Admin: Menu Access page today. "+ New Job Card" is tied to
  // the same 'jobcards' key as "Job Cards" (there's no separate web sidebar entry just for
  // creating one - it's reached from within the Job Cards page itself).
  //
  // DEFAULT (no override saved for a key): every ActionCard below keeps showing to every role,
  // exactly as before this change - this only ever NARROWS visibility once an admin actually saves
  // a restriction naming that key, same fail-open convention as web's own effectiveRoles(). This
  // was a deliberate choice: mobile never had web's hardcoded default `roles` floors to begin with
  // (see this screen's own pre-existing notes on Attendance/Item Master etc. never being
  // role-gated here), and introducing new DEFAULT restrictions nobody asked for risks hiding a
  // page some role could already reach - only Menu Access's explicit, opt-in overrides apply.
  const [menuOverrides, setMenuOverrides] = useState<Record<string, string[]>>({})
  // SECTION 170 (2026-09-30) "only give 3 sidebar menu acess only in sidebar this 3 option" -
  // mirrors web's StaffLayout.tsx own SECTION 170 addition exactly, see that file's doc comment
  // for the full design (Models/RoleMenuMode.cs). true = this login's own role is in "only show
  // checked" allow-list mode.
  const [roleModes, setRoleModes] = useState<Record<string, boolean>>({})
  useEffect(() => {
    apiClient
      .get<{ navKey: string; roles: string[] }[]>('/api/menu-access')
      .then((r) => {
        const map: Record<string, string[]> = {}
        r.data.forEach((row) => { map[row.navKey] = row.roles })
        setMenuOverrides(map)
      })
      .catch(() => {
        // Fail-open - see doc comment above. An endpoint hiccup never hides this screen's own menu.
      })
    apiClient
      .get<{ role: string; onlyShowChecked: boolean }[]>('/api/menu-access/role-modes')
      .then((r) => {
        const map: Record<string, boolean> = {}
        r.data.forEach((row) => { map[row.role] = row.onlyShowChecked })
        setRoleModes(map)
      })
      .catch(() => {
        // Fail-open (mode stays false) - same reasoning as the overrides fetch above.
      })
  }, [])

  /** true = show this ActionCard. SECTION 170: when this login's own role is in "only show
   * checked" allow-list mode, the logic INVERTS - hidden unless an explicit, non-empty override
   * for navKey lists this role (no override at all no longer means "everyone" for that role).
   * Otherwise, unchanged from before: no override saved for navKey -> always true; an override
   * that exists but is empty also means "everyone"; only a non-empty override that excludes this
   * login's own role hides it. */
  const menuVisible = (navKey: string): boolean => {
    const override = menuOverrides[navKey]
    if (profile?.role && roleModes[profile.role]) {
      return !!override && override.length > 0 && override.includes(profile.role)
    }
    if (override === undefined || override.length === 0) return true
    return !!profile?.role && override.includes(profile.role)
  }

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

            <View style={styles.grid}>
              {/* Revenue/turnaround are both driven by CLOSED (invoiced) job cards - same closest
                 equivalent filter web's own Revenue/Avg. Service Time tiles link to, even though
                 neither is an exact reproduction of the number (both are computed off Invoices,
                 not a job-card count). */}
              <Kpi icon="₹" label="Revenue (Paid Invoices)" value={`₹${kpis.revenuePaidInvoices.toLocaleString()}`} accent={colors.success} onPress={() => navigation.navigate('JobCardsList', { status: 'Closed' })} />
              <Kpi icon="⏱️" label="Avg. Service Time" value={`${kpis.avgTurnaroundHours} hrs`} accent={colors.primary} onPress={() => navigation.navigate('JobCardsList', { status: 'Closed' })} />
              {/* Not pressable - there's no rating/feedback capture in the schema yet, same as
                 web's own CSAT tile, so no job-card filter corresponds to this number. */}
              <View style={[styles.kpi, { borderLeftColor: '#db2777' }]}>
                <Text style={styles.kpiIcon}>⭐</Text>
                <Text style={styles.kpiValue}>{kpis.csat.average != null ? `${kpis.csat.average.toFixed(1)} / 5` : '—'}</Text>
                <Text style={styles.kpiLabel}>Customer Satisfaction{kpis.csat.ratingsCount > 0 ? ` (${kpis.csat.ratingsCount})` : ' (no ratings yet)'}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Job Cards by Status</Text>
              <Text style={styles.cardSubtitle}>Tap a bar to see those job cards - Closed ones included.</Text>
              <StatusBars data={kpis.byStatus} onPress={(status) => navigation.navigate('JobCardsList', { status })} />
            </View>
          </>
        )}

        <View style={styles.actions}>
          {/* SECTION 172 (2026-09-30) "in dashboardpage in android show only menu 1. Job Cards
             2. Labour Master 3. Stock Report 4. Material Transfer Bill 5. Repair Bill 6.
             Attendance only personal and according which changes done in web add in android" -
             this Actions list is now exactly these 6 cards, in this order, replacing the previous
             9-card list. REMOVED from here:
               - "+ New Job Card" (was a separate card sharing the 'jobcards' key with "Job Cards"
                 below) - not in your list. Job Cards below is now the only entry point into that
                 flow from this screen; if JobCardsListScreen.tsx has no "add" affordance of its
                 own, quick-create from the Dashboard is gone until one's added there - flagging
                 since I don't have that screen's source this session to confirm either way.
               - Item Master and Technician Employee - both still live, un-commented entries on
                 web's own sidebar (StaffLayout.tsx NAV_ITEMS_BASE), so this removal is
                 Android-only, per your explicit list, not a mirror of a web change.
               - "Repair Bill List" - this one DOES mirror a real web change: web's own
                 NAV_ITEMS_BASE already has '/repair-bill-list' (and '/material-transfer-list')
                 commented out of its sidebar, so dropping it here brings Android back in line with
                 what web currently shows, per "according which changes done in web add in
                 android".
             Every remaining card still goes through menuVisible() - same SECTION 155/164/170 Menu
             Access gating as before. Trimming this fixed list doesn't touch backend permissions
             for the removed items - Item Master/Technician Employee's own routes/APIs are
             unchanged, they're just no longer offered a shortcut from this screen. */}
          {menuVisible('jobcards') && (
            <ActionCard title="Job Cards" subtitle="View & update assigned job cards" onPress={() => navigation.navigate('JobCardsList')} />
          )}
          {menuVisible('labour-master') && (
            <ActionCard title="Labour Master" subtitle="Import & manage labour rate cards (Partwise / Without Partwise)" onPress={() => navigation.navigate('LabourMaster')} />
          )}
          {menuVisible('part-upload') && (
            <ActionCard title="Stock Report" subtitle="Stock Summary Detail Report - own stock table" onPress={() => navigation.navigate('PartUpload')} />
          )}
          {menuVisible('material-transfer-bill') && (
            <ActionCard title="Material Transfer Bill" subtitle="Create & view material transfers" onPress={() => navigation.navigate('MaterialTransferCreate')} />
          )}
          {menuVisible('repair-bill-new') && (
            <ActionCard title="Repair Bill" subtitle="Create a repair bill" onPress={() => navigation.navigate('RepairBillCreate')} />
          )}
          {/* "Attendance only personal" - this card now always opens straight to the read-only
             "my own attendance" view, even for a WorkshopManager+ login that would otherwise get
             the full dealer staff roster/marking view - see AttendanceScreen.tsx's own SECTION 172
             doc comment and RootNavigator.tsx's Attendance param type for the mechanics
             (route param { onlyMine: true }). The full manager flow itself is untouched, just no
             longer reachable from this particular card. */}
          {menuVisible('attendance') && (
            <ActionCard title="Attendance" subtitle="Mark your own attendance" onPress={() => navigation.navigate('Attendance', { onlyMine: true })} />
          )}
        </View>
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

function ActionCard({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable style={styles.actionCard} onPress={onPress}>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.actionSubtitle}>{subtitle}</Text>
    </Pressable>
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

  actions: { gap: 10, marginBottom: 8 },
  actionCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 16, borderWidth: 1, borderColor: colors.border },
  actionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  actionSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
})
