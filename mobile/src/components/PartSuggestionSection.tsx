import { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { Badge } from './Badge'
import type { BaplDmsPartStock, JobCardDetail } from '../types'

/**
 * "Part Suggestion" panel - mirrors web/src/pages/staff/JobCardDetailPage.tsx's
 * PartSuggestionCard. Parts come live from BAPL DMS's own PartsInventory for this job card's
 * service location (GET /api/bapl-dms/parts?locationCode=...); suggesting one just records an
 * itemCode + a Paid/U-W status in JobCardScannerDb (POST .../part-suggestions) - nothing is
 * written back into BAPL DMS itself. Status can be flipped afterwards
 * (PUT .../part-suggestions/{id}).
 *
 * itemCode is unique per BaplDmsPartStock row (already grouped/summed server-side), so - unlike
 * LabourSuggestionSection's labourCode - keying the picker list by itemCode is safe.
 */
export function PartSuggestionSection({ jc, onChanged }: { jc: JobCardDetail; onChanged: () => void }) {
  const [availableParts, setAvailableParts] = useState<BaplDmsPartStock[]>([])
  const [itemCode, setItemCode] = useState('')
  const [qty, setQty] = useState('')
  const [status, setStatus] = useState<'Paid' | 'U/W'>('Paid')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!jc.baplServiceLocationCode) { setAvailableParts([]); return }
    apiClient
      .get<BaplDmsPartStock[]>('/api/bapl-dms/parts', { params: { locationCode: jc.baplServiceLocationCode } })
      .then(({ data }) => setAvailableParts(data))
      .catch(() => setAvailableParts([]))
  }, [jc.baplServiceLocationCode])

  const selectPart = (p: BaplDmsPartStock) => {
    setItemCode(p.itemCode)
    setQty(String(p.availableQty))
  }

  const toggleStatus = async (id: string, current: 'Paid' | 'U/W') => {
    try {
      await apiClient.put(`/api/jobcards/part-suggestions/${id}`, { status: current === 'Paid' ? 'U/W' : 'Paid' })
      onChanged()
    } catch {
      Alert.alert('Could not update status')
    }
  }

  const addSuggestion = async () => {
    if (!itemCode) return
    setSaving(true)
    try {
      await apiClient.post(`/api/jobcards/${jc.id}/part-suggestions`, {
        itemCode,
        availableQtyAtSuggestion: qty === '' ? null : Number(qty),
        status,
      })
      setItemCode('')
      setQty('')
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
      {jc.partSuggestions.map((p) => (
        <View key={p.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{p.itemCode}</Text>
            <Text style={styles.muted}>Available qty at suggestion: {p.availableQtyAtSuggestion ?? '-'}</Text>
          </View>
          <Badge status={p.status === 'Paid' ? 'Closed' : 'InProgress'} />
          <TouchableOpacity style={styles.smallBtn} onPress={() => toggleStatus(p.id, p.status)}>
            <Text style={styles.smallBtnText}>Mark {p.status === 'Paid' ? 'U/W' : 'Paid'}</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={styles.subheading}>Suggest a part (from BAPL DMS PartsInventory)</Text>
      {!jc.baplServiceLocationCode && (
        <Text style={styles.muted}>No BAPL DMS service location on this job card - part list unavailable.</Text>
      )}

      {availableParts.length > 0 && (
        <View style={styles.pickerBox}>
          {availableParts.map((p) => {
            const selected = p.itemCode === itemCode
            return (
              <TouchableOpacity
                key={p.itemCode}
                style={[styles.pickerRow, selected && styles.pickerRowSelected]}
                onPress={() => selectPart(p)}
              >
                <Text style={[styles.pickerRowText, selected && styles.pickerRowTextSelected]}>
                  {p.itemCode} (avail. {p.availableQty})
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      )}

      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Available Qty</Text>
          <TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="Qty" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Status</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['Paid', 'U/W'] as const).map((s) => (
              <TouchableOpacity key={s} style={[styles.pill, status === s && styles.pillSelected]} onPress={() => setStatus(s)}>
                <Text style={[styles.pillText, status === s && styles.pillTextSelected]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

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
  pickerBox: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, maxHeight: 160, marginBottom: 8, overflow: 'hidden' },
  pickerRow: { paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  pickerRowSelected: { backgroundColor: '#eef2ff' },
  pickerRowText: { color: '#374151' },
  pickerRowTextSelected: { color: '#2563eb', fontWeight: '700' },
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
