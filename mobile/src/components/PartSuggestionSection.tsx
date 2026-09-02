import { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { Badge } from './Badge'
import type { BaplDmsPartStock, JobCardDetail } from '../types'

/**
 * "Part Suggestion" panel - mirrors web/src/pages/staff/JobCardDetailPage.tsx's PartSuggestionCard
 * (Item 16 rework): a type-ahead search bound to item code/description, a Qty field, and a
 * Remove button per suggestion, instead of the old Paid/U-W-toggle-only version. Parts come live
 * from BAPL DMS's own PartsInventory for this job card's service location (GET
 * /api/bapl-dms/parts?locationCode=...); Description/HsnCode/Mrp are snapshotted onto the
 * suggestion at add time (POST .../part-suggestions), not re-fetched afterwards.
 */
export function PartSuggestionSection({ jc, onChanged }: { jc: JobCardDetail; onChanged: () => void }) {
  const [availableParts, setAvailableParts] = useState<BaplDmsPartStock[]>([])
  const [search, setSearch] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [qty, setQty] = useState('1')
  const [status, setStatus] = useState<'Paid' | 'U/W'>('Paid')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!jc.baplServiceLocationCode) { setAvailableParts([]); return }
    apiClient
      .get<BaplDmsPartStock[]>('/api/bapl-dms/parts', { params: { locationCode: jc.baplServiceLocationCode } })
      .then(({ data }) => setAvailableParts(data))
      .catch(() => setAvailableParts([]))
  }, [jc.baplServiceLocationCode])

  const selectedPart = availableParts.find((p) => p.itemCode === itemCode)
  const q = search.trim().toLowerCase()
  const matches = q.length === 0 ? [] : availableParts
    .filter((p) => p.itemCode.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
    .slice(0, 20)

  const pickPart = (p: BaplDmsPartStock) => {
    setItemCode(p.itemCode)
    setSearch(`${p.itemCode}${p.description ? ' - ' + p.description : ''}`)
  }

  const removeSuggestion = async (id: string) => {
    try {
      await apiClient.delete(`/api/jobcards/part-suggestions/${id}`)
      onChanged()
    } catch {
      Alert.alert('Could not remove part suggestion')
    }
  }

  const addSuggestion = async () => {
    if (!itemCode) return
    setSaving(true)
    try {
      await apiClient.post(`/api/jobcards/${jc.id}/part-suggestions`, {
        itemCode,
        availableQtyAtSuggestion: selectedPart?.availableQty ?? null,
        status,
        quantity: Number(qty) || 1,
        description: selectedPart?.description ?? null,
        hsnCode: selectedPart?.hsnCode ?? null,
        mrp: selectedPart?.mrp ?? null,
      })
      setItemCode('')
      setSearch('')
      setQty('1')
      setStatus('Paid')
      onChanged()
    } catch {
      Alert.alert('Could not add part suggestion')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Part Suggestion</Text>

      {jc.partSuggestions.length === 0 && <Text style={styles.muted}>No parts suggested yet.</Text>}
      {jc.partSuggestions.map((p, i) => (
        <View key={p.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{i + 1}. {p.itemCode} {p.description ? `- ${p.description}` : ''}</Text>
            <Text style={styles.muted}>MRP {p.mrp != null ? `₹${p.mrp}` : '-'} · Qty {p.quantity}</Text>
          </View>
          <Badge status={p.status === 'Paid' ? 'Closed' : 'InProgress'} />
          <TouchableOpacity style={styles.smallBtn} onPress={() => removeSuggestion(p.id)}>
            <Text style={styles.smallBtnText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={styles.subheading}>Suggest a part (from BAPL DMS PartsInventory)</Text>
      {!jc.baplServiceLocationCode && (
        <Text style={styles.muted}>No BAPL DMS service location on this job card - part list unavailable.</Text>
      )}

      <TextInput
        style={styles.input}
        value={search}
        placeholder="Start typing an item code or description…"
        onChangeText={(v) => { setSearch(v); setItemCode('') }}
      />
      {matches.length > 0 && (
        <View style={styles.pickerBox}>
          {matches.map((p) => (
            <TouchableOpacity key={p.itemCode} style={styles.pickerRow} onPress={() => pickPart(p)}>
              <Text style={styles.pickerRowText}>
                <Text style={{ fontWeight: '700' }}>{p.itemCode}</Text>{p.description ? ` — ${p.description}` : ''} (avail. {p.availableQty})
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>QTY</Text>
          <TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="Qty" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Issue Type (Status)</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['Paid', 'U/W'] as const).map((s) => (
              <TouchableOpacity key={s} style={[styles.pill, status === s && styles.pillSelected]} onPress={() => setStatus(s)}>
                <Text style={[styles.pillText, status === s && styles.pillTextSelected]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
      {selectedPart && (
        <Text style={styles.muted}>MRP {selectedPart.mrp != null ? `₹${selectedPart.mrp}` : '-'} · HSN {selectedPart.hsnCode ?? '-'} · Available {selectedPart.availableQty}</Text>
      )}

      <TouchableOpacity
        style={[styles.addBtn, (!itemCode || saving) && styles.addBtnDisabled]}
        disabled={!itemCode || saving}
        onPress={addSuggestion}
      >
        <Text style={styles.addBtnText}>{saving ? 'Adding…' : 'Add Suggestion'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e6ec', padding: 14, marginBottom: 10 },
  cardTitle: { fontWeight: '700', marginBottom: 8, color: '#101828' },
  subheading: { fontWeight: '600', marginTop: 10, marginBottom: 6, color: '#101828' },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  rowTitle: { fontWeight: '600', color: '#101828' },
  smallBtn: { backgroundColor: '#f4f6f9', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  smallBtnText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  pickerBox: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, maxHeight: 200, marginTop: 6, marginBottom: 8, overflow: 'hidden' },
  pickerRow: { paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  pickerRowText: { color: '#374151' },
  formRow: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  label: { fontSize: 12, color: '#6b7280', marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 8 },
  pill: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  pillSelected: { backgroundColor: '#101828', borderColor: '#101828' },
  pillText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  pillTextSelected: { color: '#fff' },
  addBtn: { backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  addBtnDisabled: { backgroundColor: '#93c5fd' },
  addBtnText: { color: '#fff', fontWeight: '700' },
})
