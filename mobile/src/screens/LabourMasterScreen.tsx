import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { apiClient } from '../api/client'
import { colors } from '../theme/colors'

/**
 * "Labour Master" screen (Android/Expo) - 2026-09-28 ("this page also add in android"), the mobile
 * counterpart of web/src/pages/staff/LabourMasterPage.tsx (see that file's own doc comment for the
 * full background: Without Partwise / Partwise labour rate cards, imported from Excel into
 * DMSBAPLDATA's own two tables, upserted by key so a re-import updates rather than duplicates).
 * Same four endpoints as web, nothing new on the backend:
 *   GET/PUT/DELETE /api/labour-master/without-partwise[/{id}]
 *   GET/PUT/DELETE /api/labour-master/partwise[/{id}]
 *   POST /api/labour-master/without-partwise/import , .../partwise/import
 *
 * Same simplifications as PartUploadScreen.tsx (its sibling, added this same round) and for the
 * same reasons - see that file's own doc comment for the full list (no Excel/PDF export, no ported
 * Pagination component, Rate Type is a chip toggle not a native dropdown, Effective Date is a
 * plain typed field). Uses `expo-document-picker` for the file picker - same ASSUMPTION flagged
 * there: run `npx expo install expo-document-picker` first if it isn't already a dependency.
 *
 * WIRED UP 2026-09-28, from your real RootNavigator.tsx: `LabourMaster: undefined` added to
 * RootStackParamList and `<Stack.Screen name="LabourMaster" component={LabourMasterScreen} />`
 * registered there - route is live. This is a NAMED export (`export function LabourMasterScreen`),
 * matching every other screen in that file - the earlier `export default` on this file was
 * inconsistent with that convention and has been corrected.
 */

type RateType = 'withoutPartwise' | 'partwise'

interface LabourRow {
  id: string
  labourCode: string
  jobDescription: string | null
  model: string | null
  labourRate: number | null
  igst: number | null
  cgst: number | null
  sgst: number | null
  tier: number | null
  category: string | null
  effectiveDate: string | null
  isActive: boolean
  // Partwise only
  partCode?: string | null
  partName?: string | null
}

interface ImportResult {
  totalDataRows: number
  inserted: number
  updated: number
  unchanged: number
  skippedBlank: number
  warnings: string[]
}

const PAGE_SIZE = 25

export function LabourMasterScreen() {
  const [rateType, setRateType] = useState<RateType>('withoutPartwise')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [search, setSearch] = useState('')

  const [rows, setRows] = useState<LabourRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    const path = rateType === 'withoutPartwise' ? '/api/labour-master/without-partwise' : '/api/labour-master/partwise'
    apiClient
      .get<LabourRow[]>(path, { params: { search: search || undefined } })
      .then((res: any) => { setRows(res.data); setPage(0) })
      .catch((err: any) => setError(err?.response?.data?.message ?? 'Could not load Labour Master data.'))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [rateType])

  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))

  const pickAndImport = async () => {
    if (!effectiveDate) {
      setImportError('Pick an Effective Date first.')
      return
    }
    const picked = await DocumentPicker.getDocumentAsync({
      type: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ],
      copyToCacheDirectory: true,
    })
    if (picked.canceled || !picked.assets?.[0]) return
    const file = picked.assets[0]

    setImportError(null)
    setImportResult(null)
    setImporting(true)
    const form = new FormData()
    form.append('File', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as any)
    form.append('EffectiveDate', effectiveDate)
    const path = rateType === 'withoutPartwise' ? '/api/labour-master/without-partwise/import' : '/api/labour-master/partwise/import'
    apiClient
      .post<ImportResult>(path, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((res: any) => { setImportResult(res.data); load() })
      .catch((err: any) => setImportError(err?.response?.data?.message ?? 'Import failed - check the file and try again.'))
      .finally(() => setImporting(false))
  }

  const deleteRow = (row: LabourRow) => {
    const label = rateType === 'withoutPartwise' ? `"${row.labourCode}" (${row.model ?? 'no model'})` : `"${row.labourCode}" / "${row.partCode ?? '—'}"`
    Alert.alert('Delete labour rate', `Delete ${label}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const path = rateType === 'withoutPartwise' ? `/api/labour-master/without-partwise/${row.id}` : `/api/labour-master/partwise/${row.id}`
          apiClient.delete(path).then(load).catch((err: any) => Alert.alert('Delete failed', err?.response?.data?.message ?? 'Delete failed.'))
        },
      },
    ])
  }

  // ---------------- Edit modal ----------------
  const [editing, setEditing] = useState<LabourRow | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const saveEdit = () => {
    if (!editing) return
    setSavingEdit(true)
    const path = rateType === 'withoutPartwise' ? `/api/labour-master/without-partwise/${editing.id}` : `/api/labour-master/partwise/${editing.id}`
    const body: Record<string, unknown> = {
      jobDescription: editing.jobDescription,
      model: editing.model,
      labourRate: editing.labourRate,
      igst: editing.igst,
      cgst: editing.cgst,
      sgst: editing.sgst,
      tier: editing.tier,
      category: editing.category,
      effectiveDate: editing.effectiveDate,
      isActive: editing.isActive,
    }
    if (rateType === 'partwise') body.partName = editing.partName
    apiClient
      .put(path, body)
      .then(() => { setEditing(null); load() })
      .catch((err: any) => Alert.alert('Save failed', err?.response?.data?.message ?? 'Update failed.'))
      .finally(() => setSavingEdit(false))
  }

  const fmtPct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`)

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <Text style={styles.title}>Labour Master</Text>
        <Text style={styles.subtitle}>Import, edit and export labour rate master data - stored in DMSBAPLDATA.</Text>

        {/* ---------------- Import card ---------------- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Import Excel</Text>
          <Text style={styles.label}>Effective Date * (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} placeholder="2026-09-28" value={effectiveDate} onChangeText={setEffectiveDate} editable={!importing} />

          <Text style={styles.label}>Rate Type *</Text>
          <View style={styles.chipRow}>
            {(['withoutPartwise', 'partwise'] as RateType[]).map((rt) => (
              <Pressable
                key={rt}
                style={[styles.chip, rateType === rt && styles.chipActive]}
                onPress={() => { setRateType(rt); setImportResult(null); setImportError(null) }}
              >
                <Text style={[styles.chipText, rateType === rt && styles.chipTextActive]}>
                  {rt === 'withoutPartwise' ? 'Without Partwise' : 'Partwise'}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[styles.button, (!effectiveDate || importing) && styles.buttonDisabled]}
            onPress={pickAndImport}
            disabled={!effectiveDate || importing}
          >
            <Text style={styles.buttonText}>{importing ? 'Importing…' : 'Choose & Upload Excel File'}</Text>
          </Pressable>
          {importError && <Text style={styles.errorText}>{importError}</Text>}
          {importResult && (
            <Text style={styles.successText}>
              Imported {importResult.totalDataRows} row{importResult.totalDataRows === 1 ? '' : 's'}: {importResult.inserted} new,{' '}
              {importResult.updated} updated, {importResult.unchanged} unchanged
              {importResult.skippedBlank > 0 ? `, ${importResult.skippedBlank} blank row(s) skipped` : ''}.
            </Text>
          )}
        </View>

        {/* ---------------- Search ---------------- */}
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            placeholder="Search Labour Code / Model / Category…"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={load}
            returnKeyType="search"
          />
          <Pressable style={styles.button} onPress={load} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Loading…' : '↻ Search'}</Text>
          </Pressable>
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}

        {/* ---------------- Results ---------------- */}
        {loading && rows.length === 0 && <ActivityIndicator style={{ marginTop: 16 }} color={colors.primary} />}
        <FlatList
          data={pageRows}
          keyExtractor={(r) => r.id}
          scrollEnabled={false}
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.muted}>
                No {rateType === 'withoutPartwise' ? 'Without Partwise' : 'Partwise'} labour rates yet - import an Excel file above to get started.
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.laborCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.labourCode}>
                  {item.labourCode}{item.partCode ? ` · Part ${item.partCode}` : ''}
                </Text>
                <Text style={styles.muted}>{item.jobDescription ?? '—'}</Text>
                <Text style={styles.muted}>Model {item.model ?? '—'} · Rate ₹{item.labourRate ?? '—'}</Text>
                <Text style={styles.muted}>
                  IGST {fmtPct(item.igst)} · CGST {fmtPct(item.cgst)} · SGST {fmtPct(item.sgst)}
                </Text>
                <View style={[styles.badge, item.isActive ? styles.badgeSuccess : styles.badgeDanger]}>
                  <Text style={item.isActive ? styles.badgeSuccessText : styles.badgeDangerText}>{item.isActive ? 'Active' : 'Inactive'}</Text>
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <Pressable style={styles.smallButton} onPress={() => setEditing(item)}>
                  <Text style={styles.smallButtonText}>Edit</Text>
                </Pressable>
                <Pressable style={[styles.smallButton, styles.smallButtonDanger]} onPress={() => deleteRow(item)}>
                  <Text style={[styles.smallButtonText, styles.smallButtonTextDanger]}>Delete</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
        {rows.length > PAGE_SIZE && (
          <View style={styles.pagerRow}>
            <Pressable disabled={page === 0} onPress={() => setPage((p) => Math.max(0, p - 1))} style={styles.pagerButton}>
              <Text style={styles.pagerButtonText}>‹ Prev</Text>
            </Pressable>
            <Text style={styles.muted}>Page {page + 1} of {pageCount}</Text>
            <Pressable disabled={page >= pageCount - 1} onPress={() => setPage((p) => Math.min(pageCount - 1, p + 1))} style={styles.pagerButton}>
              <Text style={styles.pagerButtonText}>Next ›</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* ---------------- Edit modal ---------------- */}
      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.cardTitle}>
                Edit Labour Rate - {editing?.labourCode}{editing?.partCode ? ` / ${editing.partCode}` : ''}
              </Text>
              {editing && (
                <>
                  {rateType === 'partwise' && (
                    <>
                      <Text style={styles.label}>Part Name</Text>
                      <TextInput style={styles.input} value={editing.partName ?? ''} onChangeText={(v) => setEditing({ ...editing, partName: v })} />
                    </>
                  )}
                  <Text style={styles.label}>Job Description</Text>
                  <TextInput style={styles.input} value={editing.jobDescription ?? ''} onChangeText={(v) => setEditing({ ...editing, jobDescription: v })} />
                  <Text style={styles.label}>Model</Text>
                  <TextInput style={styles.input} value={editing.model ?? ''} onChangeText={(v) => setEditing({ ...editing, model: v })} />
                  <Text style={styles.label}>Labour Rate</Text>
                  <TextInput
                    style={styles.input} keyboardType="numeric"
                    value={editing.labourRate != null ? String(editing.labourRate) : ''}
                    onChangeText={(v) => setEditing({ ...editing, labourRate: v === '' ? null : Number(v) })}
                  />
                  <Text style={styles.label}>IGST (fraction, e.g. 0.18 = 18%)</Text>
                  <TextInput
                    style={styles.input} keyboardType="numeric"
                    value={editing.igst != null ? String(editing.igst) : ''}
                    onChangeText={(v) => setEditing({ ...editing, igst: v === '' ? null : Number(v) })}
                  />
                  <Text style={styles.label}>CGST</Text>
                  <TextInput
                    style={styles.input} keyboardType="numeric"
                    value={editing.cgst != null ? String(editing.cgst) : ''}
                    onChangeText={(v) => setEditing({ ...editing, cgst: v === '' ? null : Number(v) })}
                  />
                  <Text style={styles.label}>SGST</Text>
                  <TextInput
                    style={styles.input} keyboardType="numeric"
                    value={editing.sgst != null ? String(editing.sgst) : ''}
                    onChangeText={(v) => setEditing({ ...editing, sgst: v === '' ? null : Number(v) })}
                  />
                  <Text style={styles.label}>Active</Text>
                  <View style={styles.chipRow}>
                    <Pressable style={[styles.chip, editing.isActive && styles.chipActive]} onPress={() => setEditing({ ...editing, isActive: true })}>
                      <Text style={[styles.chipText, editing.isActive && styles.chipTextActive]}>Active</Text>
                    </Pressable>
                    <Pressable style={[styles.chip, !editing.isActive && styles.chipActive]} onPress={() => setEditing({ ...editing, isActive: false })}>
                      <Text style={[styles.chipText, !editing.isActive && styles.chipTextActive]}>Inactive</Text>
                    </Pressable>
                  </View>
                  <View style={styles.modalActions}>
                    <Pressable style={styles.button} onPress={saveEdit} disabled={savingEdit}>
                      <Text style={styles.buttonText}>{savingEdit ? 'Saving…' : 'Save'}</Text>
                    </Pressable>
                    <Pressable style={[styles.button, styles.buttonSecondary]} onPress={() => setEditing(null)}>
                      <Text style={styles.buttonSecondaryText}>Cancel</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: 12 },
  muted: { fontSize: 12, color: colors.textMuted },
  errorText: { color: '#b00020', marginTop: 8, fontSize: 13 },
  successText: { color: '#065f46', marginTop: 8, fontSize: 13 },
  card: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '600', color: colors.text, marginTop: 8, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.text },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  button: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  buttonSecondary: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  buttonSecondaryText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  laborCard: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  labourCode: { fontSize: 15, fontWeight: '700', color: colors.text },
  badge: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, marginTop: 4 },
  badgeSuccess: { backgroundColor: '#ecfdf3' },
  badgeSuccessText: { color: '#065f46', fontSize: 11, fontWeight: '600' },
  badgeDanger: { backgroundColor: '#fef2f2' },
  badgeDangerText: { color: '#b00020', fontSize: 11, fontWeight: '600' },
  smallButton: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  smallButtonText: { fontSize: 12, color: colors.text },
  smallButtonDanger: { borderColor: '#b00020' },
  smallButtonTextDanger: { color: '#b00020' },
  pagerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 8 },
  pagerButton: { paddingVertical: 6, paddingHorizontal: 12 },
  pagerButtonText: { color: colors.primary, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '85%' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 8 },
})
