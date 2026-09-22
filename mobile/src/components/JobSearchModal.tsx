import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { colors } from '../theme/colors'
import type { JobSearchResult } from '../types'

/**
 * "Job Search" picker for Material Transfer Bill/Repair Bill (2026-09-21, "add changes in android
 * also") - mirrors web/src/components/JobSearchModal.tsx: a full-screen modal, debounced
 * search-as-you-type against GET /api/jobcards/search?q=... (this app's OWN JobCards only, not a
 * blended DMS view - JobCardId on both doc types is a local FK, same as web). Picking a row calls
 * onSelect and closes.
 */
export function JobSearchModal({ visible, onSelect, onClose }: { visible: boolean; onSelect: (job: JobSearchResult) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<JobSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!visible) return
    const handle = setTimeout(() => {
      setLoading(true)
      apiClient
        .get<JobSearchResult[]>('/api/jobcards/search', { params: { q: q || undefined } })
        .then(({ data }) => setResults(data))
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(handle)
  }, [q, visible])

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>Search Job</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>Close</Text></TouchableOpacity>
          </View>
          <TextInput
            style={styles.search}
            value={q}
            onChangeText={setQ}
            placeholder="Job card no., party name, reg no. or chassis no…"
            autoFocus
          />
          {loading && <ActivityIndicator style={{ marginVertical: 10 }} color={colors.primary} />}
          <FlatList
            data={results}
            keyExtractor={(j) => j.id}
            style={{ maxHeight: 420 }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={!loading ? <Text style={styles.empty}>{q.trim() ? 'No matching job cards.' : 'Start typing to search.'}</Text> : null}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} onPress={() => onSelect(item)}>
                <Text style={styles.rowTitle}>{item.jobCardNumber}{item.isDmsLinked === false ? ' (not DMS-synced)' : ''}</Text>
                <Text style={styles.rowSub}>{item.partyName ?? '—'} · {item.regNo ?? item.chassisNo ?? '—'}</Text>
                <Text style={styles.rowSub}>{item.location ?? '—'} · {item.jobTypeService ?? '—'}</Text>
              </TouchableOpacity>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '85%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  close: { color: colors.primary, fontWeight: '600' },
  search: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 8 },
  empty: { padding: 16, color: colors.textMuted, textAlign: 'center' },
  row: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  rowTitle: { fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
})
