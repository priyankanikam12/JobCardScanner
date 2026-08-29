import { useEffect, useState } from 'react'
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native'
import { apiClient } from '../api/client'
import type { PartMaster } from '../types'

export function PartsScreen() {
  const [q, setQ] = useState('')
  const [parts, setParts] = useState<PartMaster[]>([])

  const search = () => apiClient.get<PartMaster[]>('/api/parts', { params: { q: q || undefined } }).then((r) => setParts(r.data))

  useEffect(() => { search() }, [])

  return (
    <View style={styles.container}>
      <TextInput style={styles.search} placeholder="Search parts" value={q} onChangeText={setQ} onSubmitEditing={search} returnKeyType="search" />
      <FlatList
        data={parts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.muted}>{item.partNumber} - {item.category}</Text>
            </View>
            <Text style={styles.price}>Rs.{item.unitPrice}</Text>
            <Text style={item.stockQty <= 5 ? styles.lowStock : styles.muted}>{item.stockQty} in stock</Text>
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f9', padding: 12 },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10, marginBottom: 12 },
  row: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e6ec', padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontWeight: '700', color: '#101828' },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  price: { fontWeight: '600' },
  lowStock: { color: '#dc2626', fontSize: 12, fontWeight: '600' },
})
