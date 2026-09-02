import { useEffect, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { apiClient } from '../api/client'
import { Badge } from '../components/Badge'
import type { JobCardListResponse, JobCardSummary } from '../types'
import type { RootStackParamList } from '../navigation/RootNavigator'

type Props = NativeStackScreenProps<RootStackParamList, 'JobCardsList'>

export function JobCardsListScreen({ navigation }: Props) {
  const [jobCards, setJobCards] = useState<JobCardSummary[]>([])
  // Non-null only when a real BAPL DMS problem (not "this dealer has no BAPL DMS data", which is
  // normal and silent) kept its job cards out of the blended list below - mirrors
  // web/src/pages/staff/JobCardsListPage.tsx.
  const [baplDmsWarning, setBaplDmsWarning] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = () => {
    setRefreshing(true)
    apiClient
      .get<JobCardListResponse>('/api/jobcards', { params: { q: q || undefined } })
      .then((r) => { setJobCards(r.data.items); setBaplDmsWarning(r.data.baplDmsWarning ?? null) })
      .finally(() => setRefreshing(false))
  }

  useEffect(load, [])

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TextInput
          style={[styles.search, { flex: 1, marginBottom: 0 }]}
          placeholder="Search job card #, customer, reg no..."
          value={q}
          onChangeText={setQ}
          onSubmitEditing={load}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('JobCardWizard')}>
          <Text style={styles.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>
      {baplDmsWarning && <Text style={styles.warning}>⚠ {baplDmsWarning}</Text>}
      <FlatList
        data={jobCards}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => {
          const isBapl = item.source === 'BaplDms'
          return (
            <Pressable
              style={styles.row}
              disabled={isBapl}
              onPress={() => !isBapl && navigation.navigate('JobCardDetail', { id: item.id })}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.jcNumber}>{item.jobCardNumber}</Text>
                  {isBapl && <Text style={styles.dmsBadge}>DMS</Text>}
                </View>
                <Text style={styles.muted}>{item.customerName} - {item.vehicleModel} {item.vehicleRegNo}</Text>
                <Text style={styles.muted}>{isBapl ? '-' : item.stageLabel}</Text>
                {!isBapl && (item.photoCount ?? 0) > 0 && <Text style={styles.photoCount}>📷 {item.photoCount}</Text>}
              </View>
              <Badge status={item.status} />
            </Pressable>
          )
        }}
        ListEmptyComponent={<Text style={styles.muted}>No job cards found.</Text>}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f9', padding: 12 },
  headerRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10 },
  newBtn: { backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12 },
  newBtnText: { color: '#fff', fontWeight: '700' },
  warning: { fontSize: 12, color: '#92400e', marginBottom: 8 },
  row: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e6ec', padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  jcNumber: { fontSize: 15, fontWeight: '700', color: '#101828' },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  photoCount: { fontSize: 12, color: '#2563eb', marginTop: 2 },
  dmsBadge: { backgroundColor: '#1c64f2', color: '#fff', fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: 'hidden' },
})
