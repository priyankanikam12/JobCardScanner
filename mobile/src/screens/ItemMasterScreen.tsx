import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native'
import { apiClient } from '../api/client'
import { colors } from '../theme/colors'
import type { BaplItemMaster } from '../types'

/**
 * "Item Master" screen (2026-09-21, "add changes in android also") - mirrors web's
 * web/src/pages/staff/ItemMasterPage.tsx: a read-only browse/search over BAPL's own C_ItemMaster
 * catalog (GET /api/item-master, same backend endpoint web uses - no backend change needed for
 * this Android round). This is the SAME table Material Transfer Bill/Repair Bill now source their
 * per-item Dealer Price and GST% from - this screen is just the human-readable view of that same
 * data. Read-only: this app never writes to baplfinal.
 */
export function ItemMasterScreen() {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<BaplItemMaster[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const handle = setTimeout(() => {
      apiClient
        .get<BaplItemMaster[]>('/api/item-master', { params: { q: q || undefined } })
        .then(({ data }) => setItems(data))
        .catch((err) => {
          setItems([])
          setError(err?.response?.data?.message ?? "Could not reach BAPL's item master (baplfinal) - check the connection and try again.")
        })
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(handle)
  }, [q])

  const fmtAmt = (n?: number | null) => (n == null ? '—' : `₹${n.toFixed(2)}`)
  const fmtPct = (n?: number | null) => (n == null ? '—' : `${n}%`)

  return (
    <View style={styles.screen}>
      <TextInput style={styles.search} value={q} onChangeText={setQ} placeholder="Item code, name or display name" />
      {error && <Text style={styles.error}>{error}</Text>}
      {loading && <ActivityIndicator style={{ marginVertical: 10 }} color={colors.primary} />}
      <FlatList
        style={styles.list}
        data={items}
        keyExtractor={(it) => it.itemCode}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={!loading ? <Text style={styles.muted}>No items found{q ? ` matching "${q}"` : ''}.</Text> : null}
        renderItem={({ item: it }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{it.itemCode}</Text>
              <Text style={styles.muted}>{it.itemName ?? it.displayName ?? '—'}</Text>
              <Text style={styles.muted}>HSN {it.hsnCode ?? '—'} · {it.itemType ?? '—'} · {it.status === 'Y' ? 'Active' : it.status === 'N' ? 'Inactive' : (it.status ?? '—')}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.price}>{fmtAmt(it.dlrPrice)}</Text>
              <Text style={styles.muted}>S {fmtPct(it.sgst)} · C {fmtPct(it.cgst)} · I {fmtPct(it.igst)}</Text>
            </View>
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  search: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 8 },
  error: { color: colors.danger, fontSize: 12, marginBottom: 8 },
  list: { flex: 1 },
  row: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  price: { fontWeight: '700', color: colors.text },
})
