import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { colors } from '../theme/colors'
import type { LabourMasterPartwise } from '../types'

/**
 * "Labour" picker for Material Transfer (2026-09-22, "give proper code like vide functionality in
 * mobile and for web both") - the Android counterpart to
 * web/src/components/PartwiseLabourModal.tsx: same GET /api/material-transfer-docs/
 * labour-by-part-code/{partCode} endpoint, same exact-Part-Code-only match (per the
 * AskUserQuestion answer "Part Code only (Recommended - matches the video exactly)"), same
 * stage-then-Proceed flow so more than one Labour Code can be queued for the same part in one
 * pass. See the web component's own doc comment for the full mt-labour_add.mp4-confirmed
 * reference workflow this ports - not re-derived here.
 *
 * NOT implemented, disclosed rather than silently dropped: the reference's own popup also has a
 * "Labour Technician" dropdown - same pre-existing, already-disclosed gap
 * MaterialTransferCreateScreen.tsx's own doc comment already lives with (no technician-catalog
 * endpoint for ServiceAdvisorUp). TechnicianId is always sent as null.
 */
export type PartwiseLabourPick = LabourMasterPartwise

export function PartwiseLabourModal({
  visible, partCode, partName, onClose, onProceed,
}: {
  visible: boolean
  partCode: string
  partName: string
  onClose: () => void
  onProceed: (picks: PartwiseLabourPick[]) => void
}) {
  const [options, setOptions] = useState<LabourMasterPartwise[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [staged, setStaged] = useState<PartwiseLabourPick[]>([])

  useEffect(() => {
    if (!visible || !partCode) return
    setLoading(true)
    setError(null)
    setStaged([])
    apiClient
      .get<LabourMasterPartwise[]>(`/api/material-transfer-docs/labour-by-part-code/${encodeURIComponent(partCode)}`)
      .then(({ data }) => setOptions(data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load Labour Master Partwise rates for this part.'))
      .finally(() => setLoading(false))
  }, [visible, partCode])

  const addStaged = (row: LabourMasterPartwise) => {
    if (staged.some((s) => s.labourCode === row.labourCode)) return
    setStaged((prev) => [...prev, row])
  }
  const removeStaged = (labourCode: string) => setStaged((prev) => prev.filter((s) => s.labourCode !== labourCode))
  const fmtPct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
  const available = options.filter((o) => !staged.some((s) => s.labourCode === o.labourCode))

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>Labour List</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>Close</Text></TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>Part wise Labour Detail (@Item Name {partCode} - {partName})</Text>

          {loading && <ActivityIndicator style={{ marginVertical: 10 }} color={colors.primary} />}
          {error && <Text style={styles.error}>{error}</Text>}

          {!loading && !error && (
            <>
              <Text style={styles.subheading}>Tap a Labour Code to stage it</Text>
              <FlatList
                data={available}
                keyExtractor={(o) => String(o.id)}
                style={{ maxHeight: 180 }}
                ListEmptyComponent={<Text style={styles.empty}>No Partwise labour rates found for this part.</Text>}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.pickerRow} onPress={() => addStaged(item)}>
                    <Text style={styles.pickerRowText}>
                      <Text style={{ fontWeight: '700' }}>{item.labourCode}</Text>
                      {item.jobDescription ? ` — ${item.jobDescription}` : ''} (₹{item.labourRate ?? '—'})
                    </Text>
                  </TouchableOpacity>
                )}
              />

              <Text style={[styles.subheading, { marginTop: 10 }]}>Staged ({staged.length})</Text>
              <FlatList
                data={staged}
                keyExtractor={(s) => s.labourCode}
                style={{ maxHeight: 180 }}
                ListEmptyComponent={<Text style={styles.empty}>No Labour codes added yet - pick one above.</Text>}
                renderItem={({ item: s }) => (
                  <View style={styles.stagedRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{s.labourCode} — {s.jobDescription ?? '—'}</Text>
                      <Text style={styles.muted}>
                        ₹{s.labourRate != null ? s.labourRate.toFixed(2) : '—'} · IGST {fmtPct(s.igst)} · CGST {fmtPct(s.cgst)} · SGST {fmtPct(s.sgst)}
                      </Text>
                    </View>
                    <TouchableOpacity style={styles.removeBtn} onPress={() => removeStaged(s.labourCode)}><Text style={styles.removeBtnText}>✕</Text></TouchableOpacity>
                  </View>
                )}
              />

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <TouchableOpacity style={styles.smallBtn} onPress={onClose}><Text style={styles.smallBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity
                  style={[styles.proceedBtn, staged.length === 0 && styles.proceedBtnDisabled]}
                  disabled={staged.length === 0}
                  onPress={() => onProceed(staged)}
                >
                  <Text style={styles.proceedBtnText}>Proceed →</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '85%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginBottom: 10 },
  close: { color: colors.primary, fontWeight: '600' },
  subheading: { fontWeight: '600', color: colors.text, marginBottom: 4 },
  error: { fontSize: 12, color: colors.danger, marginVertical: 6 },
  empty: { padding: 12, color: colors.textMuted, textAlign: 'center' },
  pickerRow: { paddingHorizontal: 4, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  pickerRowText: { color: colors.text },
  stagedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  rowTitle: { fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  removeBtn: { backgroundColor: colors.danger, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  removeBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  smallBtn: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9 },
  smallBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
  proceedBtn: { backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 9 },
  proceedBtnDisabled: { backgroundColor: '#93c5fd' },
  proceedBtnText: { color: '#fff', fontWeight: '700' },
})
