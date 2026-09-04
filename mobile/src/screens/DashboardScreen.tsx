import { useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import type { DashboardKpis } from '../types'
import type { JobCardsListFilter, RootStackParamList } from '../navigation/RootNavigator'
import { colors } from '../theme/colors'

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>

// Each KPI tile gets a left-border accent color, cycling through this palette (mirrors web's
// kpi-a1..a6 rotation in global.css) so a busy dashboard stays visually distinguishable at a
// glance - part of the 2026-09-04 "Hub Pulse" reskin. 'overdue' always renders amber regardless
// of its position in the rotation, matching the reference app's "amber = needs attention" accent.
const ACCENTS = [colors.primary, colors.success, colors.amber, '#7c3aed', '#db2777', '#0891b2']

// Each card's `to` is the exact JobCardsList filter that reproduces its own number - these param
// names match JobCardsController.List's dashboard-filter query params 1:1 (see
// web/src/pages/staff/DashboardPage.tsx's same mapping), each mirroring the same WHERE clause
// DashboardController.Kpis used to compute that number, so tapping a card always lands on the set
// of job cards that make up the count just shown.
const KPIS: { key: keyof DashboardKpis; label: string; to: JobCardsListFilter }[] = [
  { key: 'totalOpen', label: 'Open Job Cards', to: { excludeClosed: true } },
  { key: 'openToday', label: 'Opened Today', to: { createdToday: true } },
  { key: 'pendingApproval', label: 'Pending Approval', to: { status: 'PendingCustomerApproval' } },
  { key: 'overdue', label: 'Overdue', to: { overdue: true } },
  { key: 'closedThisMonth', label: 'Closed This Month', to: { closedThisMonth: true } },
  // Avg Turnaround isn't itself a job-card count (it's computed off closed job cards' durations),
  // but "Closed" job cards is the closest equivalent list to land on.
  { key: 'avgTurnaroundHours', label: 'Avg Turnaround (h)', to: { status: 'Closed' } },
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
        <Text style={styles.hello}>Hi, {profile?.name?.split(' ')[0]}</Text>
        <Text style={styles.role}>{profile?.role} · {profile?.dealerName ?? 'All Dealers'}</Text>

        {kpis && (
          <View style={styles.grid}>
            {KPIS.map((k, i) => (
              <Kpi
                key={k.key}
                label={k.label}
                value={kpis[k.key]}
                accent={k.key === 'overdue' ? colors.amber : ACCENTS[i % ACCENTS.length]}
                onPress={() => navigation.navigate('JobCardsList', k.to)}
              />
            ))}
          </View>
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

function Kpi({ label, value, accent, onPress }: { label: string; value: string | number; accent: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.kpi, { borderLeftColor: accent }, pressed && styles.kpiPressed]} onPress={onPress}>
      <Text style={[styles.kpiValue, accent === colors.amber && { color: colors.amberDark }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </Pressable>
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
  hello: { fontSize: 22, fontWeight: '700', color: colors.text },
  role: { fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  kpi: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, width: '31%', borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4 },
  kpiPressed: { backgroundColor: colors.bg },
  kpiValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  kpiLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  actions: { gap: 10 },
  actionCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 16, borderWidth: 1, borderColor: colors.border },
  actionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  actionSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
})
