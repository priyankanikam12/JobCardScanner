import { useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import type { BaplDmsLabourRow, JobCardDetail } from '../types'

// Issue Type is a fixed Paid / Under Warranty choice, not free text - matches
// web/src/pages/staff/JobCardDetailPage.tsx's LABOUR_ISSUE_TYPES.
const ISSUE_TYPES = ['Paid', 'U/W'] as const

/**
 * "Labour Suggestion" panel - mirrors web/src/pages/staff/JobCardDetailPage.tsx's
 * LabourSuggestionCard. Labour rows come live from BAPL DMS's own LabourMaster, scoped by this
 * job card's own Job Type/Service Head/Service Type cascade plus a free-text search (most real
 * LabourMaster rows have no cascade mapping yet, so cascade-only would hide them - see
 * BaplDmsLabourRow's doc comment on the backend). Description/HSN/GST/Rate are snapshotted from
 * whichever row is picked, not re-editable once added; Quantity and Issue Type can be edited
 * after the fact.
 *
 * IMPORTANT: labourCode is NOT unique per LabourMaster row (the same code repeats across
 * different CityTier/oemmodelname combos - confirmed in real data, e.g. "SF0M001" appears 4
 * times). The picker below is keyed and selected by each row's own unique `id`, never by
 * `labourCode` - selecting by code alone would silently resolve to the wrong row's rate/HSN/GST
 * (see the web fix this mirrors).
 */
export function LabourSuggestionSection({ jc, onChanged }: { jc: JobCardDetail; onChanged: () => void }) {
  const [rows, setRows] = useState<BaplDmsLabourRow[]>([])
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Holds the actually-picked row's own data, set once at pick time - not re-derived from `rows`.
  // 2026-09-03 fix (mirrors web's LabourSuggestionCard fix): `rows` is refreshed by the debounced
  // search above every time `q` changes, including further typing after a pick. If a later search
  // came back without a row matching the old `selectedId` (e.g. because the user kept typing, or
  // the cascade filters changed), deriving `selected` as `rows.find(...)` would silently go back
  // to undefined even though selectedId still looked picked, which either disabled "Add
  // Suggestion" unexpectedly or (on web, which enabled the button off selectedId rather than
  // selected) let it silently no-op on press. Storing the picked row directly means a later,
  // unrelated re-search can no longer un-pick it.
  const [selected, setSelected] = useState<BaplDmsLabourRow | null>(null)
  const [qty, setQty] = useState('1')
  const [issueType, setIssueType] = useState<(typeof ISSUE_TYPES)[number] | ''>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const params: Record<string, string | number> = {}
    if (jc.baplJobTypeId) params.jobTypeId = jc.baplJobTypeId
    if (jc.baplServiceHeadId) params.serviceHeadId = jc.baplServiceHeadId
    if (jc.baplServiceTypeId) params.serviceTypeId = jc.baplServiceTypeId
    // 2026-09-03: scopes the PartWiseLabourMaster union (see GetLabourAsync's doc comment, backend)
    // to this job card's own dealer - without it PartWiseLabourMaster rows are skipped server-side
    // entirely, so this list would silently stay LabourMaster-only.
    if (jc.baplDealerCode) params.dealerCode = jc.baplDealerCode
    if (q.trim()) params.q = q.trim()
    // Debounced (300ms) same as every other search-as-you-type box in this app - mirrors web's
    // same fix on LabourSuggestionCard.
    const handle = setTimeout(() => {
      apiClient
        .get<BaplDmsLabourRow[]>('/api/bapl-dms/labour', { params })
        .then(({ data }) => setRows(data))
        .catch(() => setRows([]))
    }, 300)
    return () => clearTimeout(handle)
  }, [jc.baplJobTypeId, jc.baplServiceHeadId, jc.baplServiceTypeId, jc.baplDealerCode, q])

  const addSuggestion = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await apiClient.post(`/api/jobcards/${jc.id}/labour-suggestions`, {
        labourCode: selected.labourCode,
        labourDescription: selected.labourDescription ?? null,
        hsnCode: selected.hsnCode ?? null,
        sgst: selected.sgst ?? null,
        cgst: selected.cgst ?? null,
        igst: selected.igst ?? null,
        rateAtSuggestion: selected.labourRate ?? null,
        quantity: Number(qty) || 1,
        issueType: issueType || null,
      })
      setSelectedId(null)
      setSelected(null)
      setQty('1')
      setIssueType('')
      onChanged()
    } catch {
      Alert.alert('Could not add labour suggestion')
    } finally {
      setSaving(false)
    }
  }

  const removeSuggestion = async (id: string) => {
    try {
      await apiClient.delete(`/api/jobcards/labour-suggestions/${id}`)
      onChanged()
    } catch {
      Alert.alert('Could not remove labour suggestion')
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Labour Suggestion</Text>

      {jc.labourSuggestions.length === 0 && <Text style={styles.muted}>No labour suggested yet.</Text>}
      {jc.labourSuggestions.map((l) => (
        <View key={l.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{l.labourCode} - {l.labourDescription ?? 'No description'}</Text>
            <Text style={styles.muted}>
              Qty {l.quantity} · Rate ₹{l.rateAtSuggestion ?? '-'} · {l.issueType ?? '-'}
            </Text>
          </View>
          <TouchableOpacity style={styles.smallBtn} onPress={() => removeSuggestion(l.id)}>
            <Text style={styles.smallBtnText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={styles.subheading}>Suggest labour (from BAPL DMS LabourMaster)</Text>
      {/* No separate "Search" label - matches web's LabourSuggestionCard: this field IS the search
         box, not a distinct extra step. */}
      <Text style={styles.label}>Labour Code</Text>
      <TextInput
        style={styles.input}
        value={q}
        onChangeText={(text) => { setQ(text); setSelectedId(null); setSelected(null) }}
        placeholder="Search by labour code or description…"
      />

      {rows.length > 0 && (
        // See PartSuggestionSection.tsx's same fix - a plain View with maxHeight clips instead of
        // scrolling on Android; nestedScrollEnabled lets this ScrollView scroll inside the card's
        // own outer ScrollView.
        <ScrollView style={styles.pickerBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {rows.map((r) => {
            const isSelected = r.id === selectedId
            return (
              <TouchableOpacity
                key={r.id}
                style={[styles.pickerRow, isSelected && styles.pickerRowSelected]}
                onPress={() => { setSelectedId(r.id); setSelected(r) }}
              >
                <Text style={[styles.pickerRowText, isSelected && styles.pickerRowTextSelected]}>
                  {r.labourCode} - {r.labourDescription ?? 'No description'} (₹{r.labourRate ?? '-'})
                </Text>
                {/* 2026-09-03: PartWiseLabourMaster rows are tied to a specific part - shown here
                   so it's clear this rate applies to that part, not labour in general. */}
                {!!r.partCode && (
                  <Text style={styles.muted}>Part: {r.partCode}{r.partDescription ? ` - ${r.partDescription}` : ''}</Text>
                )}
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}

      {selected && (
        <Text style={styles.muted}>
          Rate ₹{selected.labourRate ?? '-'} · HSN {selected.hsnCode ?? '-'} · SGST {selected.sgst ?? '-'} · CGST {selected.cgst ?? '-'} · IGST {selected.igst ?? '-'}
          {selected.partCode ? ` · Part: ${selected.partCode}${selected.partDescription ? ' - ' + selected.partDescription : ''}` : ''}
        </Text>
      )}

      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Qty</Text>
          <TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="numeric" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Issue Type</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {ISSUE_TYPES.map((t) => (
              <TouchableOpacity key={t} style={[styles.pill, issueType === t && styles.pillSelected]} onPress={() => setIssueType(t)}>
                <Text style={[styles.pillText, issueType === t && styles.pillTextSelected]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.addBtn, (!selected || saving) && styles.addBtnDisabled]}
        disabled={!selected || saving}
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
  pickerBox: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, maxHeight: 160, marginTop: 8, marginBottom: 8, overflow: 'hidden' },
  pickerRow: { paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  pickerRowSelected: { backgroundColor: '#eef2ff' },
  pickerRowText: { color: '#374151' },
  pickerRowTextSelected: { color: '#2563eb', fontWeight: '700' },
  formRow: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 10 },
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
