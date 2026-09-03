import { useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import type { DashboardKpis } from '../types'
import type { JobCardsListFilter, RootStackParamList } from '../navigation/RootNavigator'

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>

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
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}>
      <Text style={styles.hello}>Hi, {profile?.name?.split(' ')[0]}</Text>
      <Text style={styles.role}>{profile?.role} - {profile?.dealerName ?? 'All Dealers'}</Text>

      {kpis && (
        <View style={styles.grid}>
          {KPIS.map((k) => (
            <Kpi key={k.key} label={k.label} value={kpis[k.key]} onPress={() => navigation.navigate('JobCardsList', k.to)} />
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <ActionCard title="+ New Job Card" subtitle="Start a new vehicle check-in" onPress={() => navigation.navigate('JobCardWizard')} />
        <ActionCard title="Job Cards" subtitle="View & update assigned job cards" onPress={() => navigation.navigate('JobCardsList')} />
        <ActionCard title="Parts Catalog" subtitle="Search spare parts" onPress={() => navigation.navigate('Parts')} />
      </View>
    </ScrollView>
  )
}

function Kpi({ label, value, onPress }: { label: string; value: string | number; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.kpi, pressed && styles.kpiPressed]} onPress={onPress}>
      <Text style={styles.kpiValue}>{value}</Text>
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
  container: { flex: 1, backgroundColor: '#f4f6f9', padding: 16 },
  hello: { fontSize: 22, fontWeight: '700', color: '#101828' },
  role: { fontSize: 13, color: '#6b7280', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  kpi: { backgroundColor: '#fff', borderRadius: 10, padding: 14, width: '31%', borderWidth: 1, borderColor: '#e2e6ec' },
  kpiPressed: { backgroundColor: '#f4f6f9' },
  kpiValue: { fontSize: 20, fontWeight: '700', color: '#101828' },
  kpiLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  actions: { gap: 10 },
  actionCard: { backgroundColor: '#fff', borderRadius: 10, padding: 16, borderWidth: 1, borderColor: '#e2e6ec' },
  actionTitle: { fontSize: 16, fontWeight: '700', color: '#101828' },
  actionSubtitle: { fontSize: 13, color: '#6b7280', marginTop: 2 },
})
