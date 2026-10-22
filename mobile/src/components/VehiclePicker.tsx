// mobile\src\components\VehiclePicker.tsx
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import type { BaplDmsVehicleSuggestion } from '../types'
import { colors } from '../theme/colors'

/**
 * 2026-10-22 (Android counterpart of web/src/components/VehiclePicker.tsx): the chassis no. / registration no. box with a live dropdown - the SAME search the New Job Card wizard uses
 * (GET /api/jobcards/vehicle-suggestions): type "P6" and every matching chassis is listed, type part of a registration number and those are listed too, each with its sale date. A dealer login
 * searches its own dealer's vehicles first and, when that finds nothing, every dealer (the list says so); head-office logins (no dealer) search everything. Tapping a row calls onPick; the Search
 * button calls onPick with exactly the typed text.
 */
export interface PickedVehicle { value: string; chassisNo: string | null; regNo: string | null; modelName: string | null }

export function VehiclePicker({ dealerId, initial = '', onPick }: { dealerId?: string | null; initial?: string; onPick: (v: PickedVehicle) => void }) {
  const [q, setQ] = useState(initial)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<BaplDmsVehicleSuggestion[]>([])
  const [global, setGlobal] = useState(false)

  useEffect(() => {
    if (!open || q.trim().length < 2) { setRows([]); setGlobal(false); return }
    const text = q.trim()
    let cancelled = false
    const handle = setTimeout(() => {
      apiClient.get<BaplDmsVehicleSuggestion[]>('/api/jobcards/vehicle-suggestions', { params: { q: text, dealerId: dealerId || undefined } })
        .then(({ data }) => {
          if (cancelled) return
          if (data.length > 0 || !dealerId) { setRows(data); setGlobal(false); return }
          // nothing in this dealer's own stock: look in every dealer, like the wizard does
          return apiClient.get<BaplDmsVehicleSuggestion[]>('/api/jobcards/vehicle-suggestions', { params: { q: text } })
            .then(({ data: all }) => { if (!cancelled) { setRows(all); setGlobal(all.length > 0) } })
        })
        .catch(() => { if (!cancelled) { setRows([]); setGlobal(false) } })
    }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [q, open, dealerId])

  const pick = (s: BaplDmsVehicleSuggestion) => {
    setQ(s.chassisNo)
    setOpen(false)
    setRows([])
    onPick({ value: s.chassisNo, chassisNo: s.chassisNo, regNo: s.regNo ?? null, modelName: s.modelName ?? null })
  }
  const submitTyped = () => {
    if (!q.trim()) return
    setOpen(false)
    onPick({ value: q.trim(), chassisNo: null, regNo: null, modelName: null })
  }

  return (
    <View>
      <Text style={styles.label}>Chassis no. / Reg No.</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={q}
          onChangeText={(v) => { setQ(v); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onSubmitEditing={submitTyped}
          returnKeyType="search"
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="Type a chassis no. or registration no. (e.g. P6)"
          placeholderTextColor={colors.textMuted}
        />
        <TouchableOpacity style={[styles.btn, !q.trim() && styles.btnDisabled]} disabled={!q.trim()} onPress={submitTyped}>
          <Text style={styles.btnText}>Search</Text>
        </TouchableOpacity>
      </View>
      {open && rows.length > 0 && (
        <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {global && <Text style={styles.globalNote}>🔎 No matches for your dealer — showing results from every dealer.</Text>}
          {rows.map((s) => (
            <TouchableOpacity key={s.chassisNo} style={styles.item} onPress={() => pick(s)}>
              <Text style={styles.itemTitle}>{s.chassisNo}{s.regNo ? ` · ${s.regNo}` : ''}{s.modelName ? ` — ${s.modelName}` : ''}</Text>
              <Text style={styles.itemSub}>Sale date: {s.saleDate ? new Date(s.saleDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'not sold'}</Text>
            </TouchableOpacity>
          ))}
          {rows.length >= 100 && <Text style={styles.itemSub}>Showing the first {rows.length} matches - keep typing to narrow down.</Text>}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.text },
  btn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11 },
  btnDisabled: { backgroundColor: '#93c5fd' },
  btnText: { color: '#fff', fontWeight: '700' },
  list: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 8, maxHeight: 260, marginTop: 4, padding: 4 },
  globalNote: { padding: 8, fontSize: 12, color: '#1e3a5f', backgroundColor: '#eef6ff', borderRadius: 6, marginBottom: 2 },
  item: { paddingHorizontal: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  itemTitle: { fontWeight: '700', color: colors.text },
  itemSub: { fontSize: 12, color: colors.textMuted, marginTop: 2, paddingHorizontal: 8 },
})
