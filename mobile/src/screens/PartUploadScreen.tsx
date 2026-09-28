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
import { useStaffAuth } from '../auth/StaffAuthContext'
import { colors } from '../theme/colors'

/**
 * "Part Upload" screen (Android/Expo) - 2026-09-28 ("this page also add in android"), the mobile
 * counterpart of web/src/pages/staff/PartUploadPage.tsx (that file's own doc comment has the full
 * background: a Stock Summary Detail Report .xlsx, upserted by Part No per Location into
 * JobCardScannerDb's own PartUploads table - re-uploading the same Location updates figures in
 * place rather than duplicating). Same three endpoints as web: GET /api/bapl-dms/workshops (scoped
 * to profile.workLocationCodes), GET/POST/PUT/DELETE /api/part-uploads[/import]/{id} - nothing new
 * on the backend, this is a frontend-only port.
 *
 * DELIBERATELY SIMPLER THAN THE WEB PAGE, flagged rather than silently dropped:
 *  - No Excel/PDF export (ReportDownloadButtons/exportReport are web-only libraries; porting them
 *    needs a real XLSX/PDF library for React Native, which I don't know is installed here).
 *  - No full "click a row to see all 30 fields" detail modal (RecordDetailModal is a web
 *    component) - Edit's modal below covers the fields you can actually change instead.
 *  - No shared Pagination component (page/pageSize state below is simple, self-contained
 *    next/prev over whatever the search already narrowed down, not a ported copy of web's
 *    usePagination hook, which I don't have on mobile).
 *  - Location and Report Date are chip-style buttons / a plain typed date, not a native dropdown
 *    or date-picker widget - same reasoning as AttendanceScreen.tsx's own "no date picker library
 *    confirmed installed" note: guessing a picker package that isn't in package.json breaks the
 *    build worse than a plain TextInput does.
 *
 * ASSUMPTION, flagged: uses `expo-document-picker` to pick the .xlsx file (the standard Expo way
 * to do this - there is no <input type="file"> on native). If that package isn't already a
 * dependency, run `npx expo install expo-document-picker` first or this screen won't build.
 *
 * WIRED UP 2026-09-28, from your real RootNavigator.tsx: `PartUpload: undefined` added to
 * RootStackParamList and `<Stack.Screen name="PartUpload" component={PartUploadScreen} />`
 * registered there - route is live. This is a NAMED export (`export function PartUploadScreen`),
 * matching every other screen in that file (ItemMasterScreen, DashboardScreen, etc.) - the earlier
 * `export default` on this file was inconsistent with that convention and has been corrected.
 */

interface Workshop {
  locCode: string
  locName: string
}

interface PartUploadRow {
  id: string
  partNo: string
  description: string | null
  hsnSacCode: string | null
  groupName: string | null
  itemType: string | null
  balQty: number | null
  mtTransferQty: number | null
  balAmnt: number | null
  billPrice: number | null
  locationCode: string
  reportDate: string | null
  qtyReqd: number | null
  minOrder: number | null
}

interface ImportResult {
  totalDataRows: number
  inserted: number
  updated: number
  unchanged: number
  skippedBlank: number
  warnings: string[]
}

// 2026-09-28 ("i create 1 user supervisor in the its not laod thatr 1 loaction Could not load
// uploaded part data. why in parts-upload"): every catch below used to show a fixed generic string
// regardless of the real cause, discarding the real HTTP status and this app's own `{ message }`
// error body - the exact same blind-spot already hit (and fixed) on the web Attendance page and
// elsewhere this session. Now appended in parentheses so the on-screen text itself says why (401 vs
// 403 vs 404 vs 500 vs a genuine network drop all look different) instead of needing another
// screenshot/log round-trip to find out - this is what's needed to actually diagnose the
// location-restricted Supervisor's load failure being reported here.
function describeError(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { message?: string } } }
  const detail = e?.response?.data?.message
  const status = e?.response?.status
  if (detail) return `${fallback} (${detail})`
  if (status) return `${fallback} (HTTP ${status})`
  return `${fallback} (no response reached the server - check your connection)`
}

const PAGE_SIZE = 25

export function PartUploadScreen() {
  const { profile } = useStaffAuth()

  const [workshops, setWorkshops] = useState<Workshop[]>([])
  useEffect(() => {
    if (!profile?.dealerId) return
    apiClient
      .get<Workshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then(({ data }: any) => {
        const scoped = profile?.workLocationCodes?.length
          ? data.filter((w: Workshop) => profile.workLocationCodes.includes(w.locCode))
          : data
        setWorkshops(scoped)
        if (scoped.length > 0) setUploadLocation((prev) => prev || scoped[0].locCode)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.dealerId])

  const [rows, setRows] = useState<PartUploadRow[]>([])
  const [search, setSearch] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const [uploadLocation, setUploadLocation] = useState('')
  const [uploadDate, setUploadDate] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const canUpload = !!uploadLocation && !!uploadDate

  const load = () => {
    setLoading(true)
    setError(null)
    apiClient
      .get<PartUploadRow[]>('/api/part-uploads', { params: { search: search || undefined, locationCode: filterLocation || undefined } })
      .then((res: any) => { setRows(res.data); setPage(0) })
      .catch((err: unknown) => setError(describeError(err, 'Could not load uploaded part data.')))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [filterLocation])

  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))

  const pickAndImport = async () => {
    if (!canUpload) {
      setImportError('Select Date and Location before uploading.')
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
    // React Native's FormData accepts { uri, name, type } in place of a Blob/File - standard Expo
    // multipart-upload shape.
    form.append('File', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as any)
    form.append('LocationCode', uploadLocation)
    form.append('ReportDate', uploadDate)
    apiClient
      .post<ImportResult>('/api/part-uploads/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((res: any) => { setImportResult(res.data); load() })
      .catch((err: unknown) => setImportError(describeError(err, 'Import failed - check the file and try again.')))
      .finally(() => setImporting(false))
  }

  const deleteRow = (row: PartUploadRow) => {
    Alert.alert('Delete part', `Delete uploaded part "${row.partNo}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          apiClient
            .delete(`/api/part-uploads/${row.id}`)
            .then(load)
            .catch((err: unknown) => Alert.alert('Delete failed', describeError(err, 'Delete failed.'))),
      },
    ])
  }

  // ---------------- Edit modal ----------------
  const [editing, setEditing] = useState<PartUploadRow | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const saveEdit = () => {
    if (!editing) return
    setSavingEdit(true)
    apiClient
      .put(`/api/part-uploads/${editing.id}`, {
        description: editing.description,
        balQty: editing.balQty,
        balAmnt: editing.balAmnt,
        billPrice: editing.billPrice,
        qtyReqd: editing.qtyReqd,
        minOrder: editing.minOrder,
        hsnSacCode: editing.hsnSacCode,
        groupName: editing.groupName,
        itemType: editing.itemType,
      })
      .then(() => { setEditing(null); load() })
      .catch((err: unknown) => Alert.alert('Save failed', describeError(err, 'Save failed.')))
      .finally(() => setSavingEdit(false))
  }

  const fmtNum = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }))
  const locName = (code: string) => workshops.find((w) => w.locCode === code)?.locName ?? code

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <Text style={styles.title}>Part Upload</Text>
        <Text style={styles.subtitle}>
          Upload a Stock Summary Detail Report (.xlsx) - saved into JobCardScanner’s own database, scoped to your dealer.
        </Text>

        {/* ---------------- Upload card ---------------- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Upload Excel</Text>
          <Text style={styles.label}>Date * (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} placeholder="2026-09-28" value={uploadDate} onChangeText={setUploadDate} editable={!importing} />

          <Text style={styles.label}>Location *</Text>
          <View style={styles.chipRow}>
            {workshops.map((w) => (
              <Pressable
                key={w.locCode}
                style={[styles.chip, uploadLocation === w.locCode && styles.chipActive]}
                onPress={() => setUploadLocation(w.locCode)}
                disabled={importing}
              >
                <Text style={[styles.chipText, uploadLocation === w.locCode && styles.chipTextActive]}>{w.locName}</Text>
              </Pressable>
            ))}
            {workshops.length === 0 && <Text style={styles.muted}>No workshop locations found for your dealer.</Text>}
          </View>

          <Pressable
            style={[styles.button, (!canUpload || importing) && styles.buttonDisabled]}
            onPress={pickAndImport}
            disabled={!canUpload || importing}
          >
            <Text style={styles.buttonText}>{importing ? 'Importing…' : 'Choose & Upload Excel File'}</Text>
          </Pressable>
          {!canUpload && <Text style={styles.muted}>Select Date and Location above to enable the file upload.</Text>}
          {importError && <Text style={styles.errorText}>{importError}</Text>}
          {importResult && (
            <Text style={styles.successText}>
              Imported {importResult.totalDataRows} row{importResult.totalDataRows === 1 ? '' : 's'}: {importResult.inserted} new,{' '}
              {importResult.updated} updated, {importResult.unchanged} unchanged
              {importResult.skippedBlank > 0 ? `, ${importResult.skippedBlank} blank row(s) skipped` : ''}.
            </Text>
          )}
        </View>

        {/* ---------------- Filter / search ---------------- */}
        <View style={styles.card}>
          <Text style={styles.label}>Location filter</Text>
          <View style={styles.chipRow}>
            <Pressable style={[styles.chip, filterLocation === '' && styles.chipActive]} onPress={() => setFilterLocation('')}>
              <Text style={[styles.chipText, filterLocation === '' && styles.chipTextActive]}>All locations</Text>
            </Pressable>
            {workshops.map((w) => (
              <Pressable key={w.locCode} style={[styles.chip, filterLocation === w.locCode && styles.chipActive]} onPress={() => setFilterLocation(w.locCode)}>
                <Text style={[styles.chipText, filterLocation === w.locCode && styles.chipTextActive]}>{w.locName}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Search Part No / Description / HSN…"
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
          ListEmptyComponent={!loading ? <Text style={styles.muted}>No uploaded parts yet - upload a report above to get started.</Text> : null}
          renderItem={({ item }) => (
            <View style={styles.partCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.partNo}>{item.partNo}</Text>
                <Text style={styles.muted}>{item.description ?? '—'}</Text>
                <Text style={styles.muted}>
                  HSN {item.hsnSacCode ?? '—'} · {locName(item.locationCode)}
                </Text>
                <Text style={styles.muted}>
                  Bal Qty {fmtNum(item.balQty)} · Bal Amt ₹{fmtNum(item.balAmnt)} · Bill ₹{fmtNum(item.billPrice)}
                </Text>
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
              <Text style={styles.cardTitle}>Edit Part - {editing?.partNo}</Text>
              {editing && (
                <>
                  <Text style={styles.label}>Description</Text>
                  <TextInput style={styles.input} value={editing.description ?? ''} onChangeText={(v) => setEditing({ ...editing, description: v })} />
                  <Text style={styles.label}>HSN/SAC Code</Text>
                  <TextInput style={styles.input} value={editing.hsnSacCode ?? ''} onChangeText={(v) => setEditing({ ...editing, hsnSacCode: v })} />
                  <Text style={styles.label}>Group</Text>
                  <TextInput style={styles.input} value={editing.groupName ?? ''} onChangeText={(v) => setEditing({ ...editing, groupName: v })} />
                  <Text style={styles.label}>Item Type</Text>
                  <TextInput style={styles.input} value={editing.itemType ?? ''} onChangeText={(v) => setEditing({ ...editing, itemType: v })} />
                  <Text style={styles.label}>Bal Qty</Text>
                  <TextInput
                    style={styles.input} keyboardType="numeric"
                    value={editing.balQty != null ? String(editing.balQty) : ''}
                    onChangeText={(v) => setEditing({ ...editing, balQty: v === '' ? null : Number(v) })}
                  />
                  <Text style={styles.label}>Bal Amount</Text>
                  <TextInput
                    style={styles.input} keyboardType="numeric"
                    value={editing.balAmnt != null ? String(editing.balAmnt) : ''}
                    onChangeText={(v) => setEditing({ ...editing, balAmnt: v === '' ? null : Number(v) })}
                  />
                  <Text style={styles.label}>Bill Price</Text>
                  <TextInput
                    style={styles.input} keyboardType="numeric"
                    value={editing.billPrice != null ? String(editing.billPrice) : ''}
                    onChangeText={(v) => setEditing({ ...editing, billPrice: v === '' ? null : Number(v) })}
                  />
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
  partCard: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  partNo: { fontSize: 15, fontWeight: '700', color: colors.text },
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
