import { useEffect, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { apiClient } from '../api/client'
import { Badge } from '../components/Badge'
import type { JobCardSummary } from '../types'
import type { RootStackParamList } from '../navigation/RootNavigator'

type Props = NativeStackScreenProps<RootStackParamList, 'JobCardsList'>

export function JobCardsListScreen({ navigation }: Props) {
  const [jobCards, setJobCards] = useState<JobCardSummary[]>([])
  const [q, setQ] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = () => {
    setRefreshing(true)
    apiClient
      .get<JobCardSummary[]>('/api/jobcards', { params: { q: q || undefined } })
      .then((r) => setJobCards(r.data))
      .finally(() => setRefreshing(false))
  }

  useEffect(load, [])

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search job card #, customer, reg no..."
        value={q}
        onChangeText={setQ}
        onSubmitEditing={load}
        returnKeyType="search"
      />
      <FlatList
        data={jobCards}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => navigation.navigate('JobCardDetail', { id: item.id })}>
            <View style={{ flex: 1 }}>
              <Text style={styles.jcNumber}>{item.jobCardNumber}</Text>
              <Text style={styles.muted}>{item.customerName} - {item.vehicleModel} {item.vehicleRegNo}</Text>
              <Text style={styles.muted}>{item.stageLabel}</Text>
            </View>
            <Badge status={item.status} />
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.muted}>No job cards found.</Text>}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f9', padding: 12 },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10, marginBottom: 12 },
  row: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e6ec', padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  jcNumber: { fontSize: 15, fontWeight: '700', color: '#101828' },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 2 },
})
