import { useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { apiClient } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { DashboardKpis } from '../types'
import type { RootStackParamList } from '../navigation/RootNavigator'

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>

export function DashboardScreen({ navigation }: Props) {
  const { profile } = useAuth()
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
          <Kpi label="Open Job Cards" value={kpis.totalOpen} />
          <Kpi label="Opened Today" value={kpis.openToday} />
          <Kpi label="Pending Approval" value={kpis.pendingApproval} />
          <Kpi label="Overdue" value={kpis.overdue} />
          <Kpi label="Closed This Month" value={kpis.closedThisMonth} />
          <Kpi label="Avg Turnaround (h)" value={kpis.avgTurnaroundHours} />
        </View>
      )}

      <View style={styles.actions}>
        <ActionCard title="Job Cards" subtitle="View & update assigned job cards" onPress={() => navigation.navigate('JobCardsList')} />
        <ActionCard title="Parts Catalog" subtitle="Search spare parts" onPress={() => navigation.navigate('Parts')} />
      </View>
    </ScrollView>
  )
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
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
  container: { flex: 1, backgroundColor: '#f4f6f9', padding: 16 },
  hello: { fontSize: 22, fontWeight: '700', color: '#101828' },
  role: { fontSize: 13, color: '#6b7280', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  kpi: { backgroundColor: '#fff', borderRadius: 10, padding: 14, width: '31%', borderWidth: 1, borderColor: '#e2e6ec' },
  kpiValue: { fontSize: 20, fontWeight: '700', color: '#101828' },
  kpiLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  actions: { gap: 10 },
  actionCard: { backgroundColor: '#fff', borderRadius: 10, padding: 16, borderWidth: 1, borderColor: '#e2e6ec' },
  actionTitle: { fontSize: 16, fontWeight: '700', color: '#101828' },
  actionSubtitle: { fontSize: 13, color: '#6b7280', marginTop: 2 },
})
