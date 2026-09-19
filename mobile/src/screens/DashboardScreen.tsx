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
  const { profile } = useStaffAuth()
  const [kpis, setKpis] = useState<DashboardKpis | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = () => {
    setRefreshing(true)
    apiClient.get<DashboardKpis>('/api/dashboard/kpis').then((r) => setKpis(r.data)).finally(() => setRefreshing(false))
  }

  useEffect(load, [])

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
                  value={kpis[t.key] as number}
                  accent={ACCENTS[i % ACCENTS.length]}
                  onPress={() => navigation.navigate('JobCardsList', t.to)}
                />
              ))}
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
          <ActionCard title="+ New Job Card" subtitle="Start a new vehicle check-in" onPress={() => navigation.navigate('JobCardWizard')} />
          <ActionCard title="Job Cards" subtitle="View & update assigned job cards" onPress={() => navigation.navigate('JobCardsList')} />
          <ActionCard title="Parts Catalog" subtitle="Search spare parts" onPress={() => navigation.navigate('Parts')} />
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
