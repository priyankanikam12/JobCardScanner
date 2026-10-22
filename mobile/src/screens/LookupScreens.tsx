// mobile\src\screens\LookupScreens.tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { apiClient } from '../api/client'
import { colors } from '../theme/colors'
import type { DmsBaplDataServiceHistory, DmsBaplDataServiceHistorySuggestion, DmsBaplDataVehicleSale } from '../types'

/**
 * 2026-10-22 (Android counterparts of web's Service History, Vehicle Sale and Reports & Search pages). All three are read-mostly look-ups over the same endpoints the web pages use.
 * Not on Android (web only, needs a desktop file picker): Vehicle Sale's "Import Vehicle Sale Report" and the Excel / PDF download of the two grids.
 */
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN') : '—')
const fmtAmt = (n?: number | null) => (n == null ? '—' : `₹${n.toFixed(2)}`)
const errText = (err: unknown, fallback: string) => (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback

// ====================================================== Service History ======================================================
/**
 * Read-only Service History of ONE vehicle (search by chassis no. or reg no.; GET /api/dms-bapl-data/service-history, suggestions from /service-history/suggestions): the latest visit's vehicle and
 * party summary, then every past service visit, newest first.
 */
export function ServiceHistoryScreen() {
  const [query, setQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState<DmsBaplDataServiceHistorySuggestion[]>([])
  const [rows, setRows] = useState<DmsBaplDataServiceHistory[]>([])
  const [searchedFor, setSearchedFor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!showSuggestions || query.trim().length < 2) { setSuggestions([]); return }
    const handle = setTimeout(() => {
      apiClient.get<DmsBaplDataServiceHistorySuggestion[]>('/api/dms-bapl-data/service-history/suggestions', { params: { q: query.trim(), take: 20 } })
        .then(({ data }) => setSuggestions(data))
        .catch(() => setSuggestions([]))
    }, 300)
    return () => clearTimeout(handle)
  }, [query, showSuggestions])

  const search = (value?: string) => {
    const term = (value ?? query).trim()
    if (!term) { setError('Enter a Chassis No. or Reg No. to search.'); return }
    setShowSuggestions(false)
    setLoading(true)
    setError(null)
    apiClient.get<DmsBaplDataServiceHistory[]>('/api/dms-bapl-data/service-history', { params: { search: term } })
      .then((r) => { setRows(r.data); setSearchedFor(term) })
      .catch((err) => { setRows([]); setError(errText(err, 'Could not reach DMSBAPLDATA - check the connection and try again.')) })
      .finally(() => setLoading(false))
  }

  const latest = rows[0]
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.label}>Chassis No. / Reg No.</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            style={[styles.input, { flex: 1 }]} value={query} autoCapitalize="characters" autoCorrect={false}
            onChangeText={(v) => { setQuery(v); setShowSuggestions(true) }} onFocus={() => setShowSuggestions(true)} onSubmitEditing={() => search()}
            placeholder="Type a chassis no. or reg no." placeholderTextColor={colors.textMuted}
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={() => search()}><Text style={styles.primaryBtnText}>Search</Text></TouchableOpacity>
        </View>
        {showSuggestions && suggestions.length > 0 && (
          <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {suggestions.map((s) => (
              <TouchableOpacity key={s.chassisNo} style={styles.item} onPress={() => { setQuery(s.chassisNo); search(s.chassisNo) }}>
                <Text style={styles.bold}>{s.chassisNo}{s.regNo ? ` · ${s.regNo}` : ''}{s.model ? ` — ${s.model}` : ''}</Text>
                <Text style={styles.muted}>Last job: {fmtDate(s.lastJobDate)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
      {loading && <ActivityIndicator color={colors.primary} />}
      {!loading && searchedFor && rows.length === 0 && !error && <Text style={styles.muted}>No service history found for "{searchedFor}".</Text>}
      {latest && (
        <View style={styles.card}>
          <Text style={styles.h3}>Vehicle info</Text>
          <Text style={styles.bold}>{latest.chassisNo ?? '—'}{latest.regNo ? ` · ${latest.regNo}` : ''}</Text>
          <Text style={styles.muted}>{latest.model ?? '—'} · Party (latest visit): {latest.partyName ?? '—'}{latest.mobileNumber ? ` (${latest.mobileNumber})` : ''}</Text>
          <Text style={styles.muted}>{rows.length} visit{rows.length === 1 ? '' : 's'} on record</Text>
        </View>
      )}
      {rows.map((s) => (
        <View key={s.id} style={styles.card}>
          <Text style={styles.bold}>Job {s.jobNo ?? '—'} · {fmtDate(s.jobDate)}</Text>
          <Text style={styles.muted}>{s.compName ?? s.dealerCode ?? '—'} · {[s.serviceHead, s.jobType].filter(Boolean).join(' / ') || '—'}</Text>
          <Text style={styles.muted}>Party {s.partyName ?? '—'} · KMS {s.kms ?? '—'} · Mechanic {s.technician ?? '—'} · Supervisor {s.supervisor ?? '—'}</Text>
          <Text style={styles.muted}>Status {s.jobStatus ?? '—'} · Net total {fmtAmt(s.netTotal)}</Text>
        </View>
      ))}
    </ScrollView>
  )
}

// ====================================================== Vehicle Sale ======================================================
/**
 * Synced vehicle sale data (GET /api/vehicle-sales, searched and paged by the SERVER). Tap a row for the whole sale; "Edit Reg No" saves a hand-corrected registration number for that chassis into
 * JobCardScannerDb (POST /api/vehicle-sale-overrides) - it never touches the DMS data, and the New Job Card wizard then prefers it.
 */
const PAGE = 20
export function VehicleSaleScreen() {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sales, setSales] = useState<DmsBaplDataVehicleSale[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [editingChassis, setEditingChassis] = useState<string | null>(null)
  const [editReg, setEditReg] = useState('')
  const [overrideError, setOverrideError] = useState<string | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => { setDebounced(query.trim()); setPage(1) }, 400)
    return () => clearTimeout(handle)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiClient.get<{ total: number; rows: DmsBaplDataVehicleSale[] }>('/api/vehicle-sales', { params: { search: debounced || undefined, page, pageSize: PAGE } })
      .then((r) => { if (!cancelled) { setSales((prev) => (page === 1 ? r.data.rows : [...prev, ...r.data.rows])); setTotal(r.data.total) } })
      .catch((err) => { if (!cancelled) { if (page === 1) setSales([]); setTotal(0); setError(errText(err, 'Could not load the vehicle sales - check the connection and try again.')) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debounced, page])

  const saveReg = async (row: DmsBaplDataVehicleSale) => {
    const chassisNo = row.chassisNo?.trim()
    const regNo = editReg.trim()
    if (!chassisNo) { setOverrideError('This row has no chassis no. on record - a Reg No override needs one to save against.'); return }
    if (!regNo) { setOverrideError('Reg No cannot be blank.'); return }
    setOverrideError(null)
    try {
      await apiClient.post('/api/vehicle-sale-overrides', { chassisNo, regNo })
      setSales((prev) => prev.map((s) => (s.chassisNo === chassisNo ? { ...s, regNo } : s)))
      setEditingChassis(null)
    } catch (err) {
      setOverrideError(errText(err, 'Could not save the Reg No - try again.'))
    }
  }

  const detail = (s: DmsBaplDataVehicleSale): [string, string][] => [
    ['Location', [s.location, s.locationCity].filter(Boolean).join(' · ') || '—'], ['Customer', `${s.soldTo ?? '—'}${s.cusMob ? ` (${s.cusMob})` : ''}`],
    ['Address', [s.address1, s.address2, s.city, s.state, s.pin].filter(Boolean).join(', ') || '—'], ['Email', s.partyEmail ?? '—'],
    ['Motor no.', s.motorNo ?? '—'], ['Controller no.', s.controllerNo ?? '—'], ['Battery', [s.battery, s.batteryChemical, s.batteryCapacity, s.batteryMake].filter(Boolean).join(' · ') || '—'],
    ['Charger no.', s.chargerNo ?? '—'], ['Executive', s.executiveName ?? '—'], ['Financed by', s.financedBy ?? '—'], ['Item rate', fmtAmt(s.itemRate)], ['Remarks', s.remarks ?? '—'],
  ]

  return (
    <View style={styles.screen}>
      <View style={{ padding: 12, paddingBottom: 0 }}>
        <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Search invoice, chassis, reg no, customer…" placeholderTextColor={colors.textMuted} />
        {error && <Text style={styles.errorText}>{error}</Text>}
        {overrideError && <Text style={styles.errorText}>{overrideError}</Text>}
        <Text style={styles.muted}>{total.toLocaleString('en-IN')} sale{total === 1 ? '' : 's'}</Text>
      </View>
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        data={sales}
        keyExtractor={(s) => String(s.id)}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (!loading && sales.length < total) setPage((p) => p + 1) }}
        ListFooterComponent={loading ? <ActivityIndicator color={colors.primary} style={{ margin: 12 }} /> : null}
        ListEmptyComponent={!loading && !error ? <Text style={styles.muted}>No vehicle sales found.</Text> : null}
        renderItem={({ item: s }) => (
          <View style={styles.card}>
            <TouchableOpacity onPress={() => setExpandedId(expandedId === s.id ? null : s.id)}>
              <Text style={styles.bold}>{s.chassisNo ?? '—'}  {expandedId === s.id ? '▾' : '▸'}</Text>
              <Text style={styles.muted}>Invoice {s.invoiceNo ?? '—'} · {fmtDate(s.invoiceDate)} · {s.dealerName ?? s.dealerCode ?? '—'}</Text>
              <Text style={styles.muted}>{s.itemModel ?? '—'}{s.colorCode ? ` / ${s.colorCode}` : ''} · Sold to {s.soldTo ?? '—'} · {s.saleType ?? '—'}</Text>
              <Text style={styles.muted}>Net {fmtAmt(s.netAmount)}</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              {editingChassis === s.chassisNo ? (
                <>
                  <TextInput style={[styles.input, { flex: 1 }]} value={editReg} onChangeText={setEditReg} autoCapitalize="characters" autoFocus />
                  <TouchableOpacity style={styles.primaryBtnSm} onPress={() => void saveReg(s)}><Text style={styles.primaryBtnText}>Save</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.btnSm} onPress={() => setEditingChassis(null)}><Text style={styles.btnSmText}>✕</Text></TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={[styles.muted, { flex: 1 }]}>Reg No: {s.regNo ?? '—'}</Text>
                  <TouchableOpacity style={styles.btnSm} onPress={() => { setEditingChassis(s.chassisNo ?? null); setEditReg(s.regNo ?? ''); setOverrideError(null) }}><Text style={styles.btnSmText}>Edit Reg No</Text></TouchableOpacity>
                </>
              )}
            </View>
            {expandedId === s.id && (
              <View style={{ marginTop: 8 }}>
                {detail(s).map(([k, v]) => <Text key={k} style={styles.muted}><Text style={styles.bold}>{k}: </Text>{v}</Text>)}
              </View>
            )}
          </View>
        )}
      />
    </View>
  )
}

// ====================================================== Reports & Search ======================================================
interface SearchResults {
  jobCards: { id: string; jobCardNumber: string; status: string; customerName: string; vehicleRegNo?: string }[]
  customers: { id: string; name: string; mobile: string }[]
  invoices: { id: string; invoiceNumber: string; totalAmount: number; status: string }[]
}

/** ArrayBuffer -> base64 (React Native has no Buffer): the .xlsx the API answers with is written to a file and handed to the share sheet. */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]
    out += chars[b0 >> 2] + chars[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    out += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)] : '='
    out += i + 2 < bytes.length ? chars[b2 & 63] : '='
  }
  return out
}

/** Global search across job cards, customers and invoices (GET /api/search, 2+ characters, as you type) and the two Excel exports (GET /api/reports/{jobcards|invoices}/export). */
export function ReportsScreen() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const search = () => apiClient.get<SearchResults>('/api/search', { params: { q } }).then((r) => setResults(r.data)).catch(() => setResults(null))
  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return }
    const handle = setTimeout(search, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const exportFile = async (kind: 'jobcards' | 'invoices', filename: string) => {
    setBusy(kind)
    try {
      const res = await apiClient.get<ArrayBuffer>(`/api/reports/${kind}/export`, { responseType: 'arraybuffer' })
      const uri = `${FileSystem.cacheDirectory}${filename}`
      await FileSystem.writeAsStringAsync(uri, toBase64(res.data), { encoding: FileSystem.EncodingType.Base64 })
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: filename })
      else Alert.alert('Saved', `The report was saved as ${uri}`)
    } catch (err) {
      Alert.alert('Export failed', errText(err, 'Could not download the report.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.label}>Search job cards, customers, invoices…</Text>
        <TextInput style={styles.input} value={q} onChangeText={setQ} onSubmitEditing={search} placeholder="At least 2 characters" placeholderTextColor={colors.textMuted} />
      </View>
      {results && (
        <View style={styles.card}>
          <Text style={styles.h3}>Job Cards</Text>
          {results.jobCards.length === 0 && <Text style={styles.muted}>None.</Text>}
          {results.jobCards.map((j) => <Text key={j.id} style={styles.muted}>{j.jobCardNumber} - {j.customerName} - {j.status}</Text>)}
          <Text style={[styles.h3, { marginTop: 10 }]}>Customers</Text>
          {results.customers.length === 0 && <Text style={styles.muted}>None.</Text>}
          {results.customers.map((c) => <Text key={c.id} style={styles.muted}>{c.name} - {c.mobile}</Text>)}
          <Text style={[styles.h3, { marginTop: 10 }]}>Invoices</Text>
          {results.invoices.length === 0 && <Text style={styles.muted}>None.</Text>}
          {results.invoices.map((i) => <Text key={i.id} style={styles.muted}>{i.invoiceNumber} - Rs.{i.totalAmount} - {i.status}</Text>)}
        </View>
      )}
      <View style={styles.card}>
        <Text style={styles.h3}>Export reports</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <TouchableOpacity style={[styles.btnSm, busy === 'jobcards' && { opacity: 0.5 }]} disabled={!!busy} onPress={() => void exportFile('jobcards', 'jobcards-report.xlsx')}><Text style={styles.btnSmText}>{busy === 'jobcards' ? 'Preparing…' : 'Export Job Cards (.xlsx)'}</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.btnSm, busy === 'invoices' && { opacity: 0.5 }]} disabled={!!busy} onPress={() => void exportFile('invoices', 'invoices-report.xlsx')}><Text style={styles.btnSmText}>{busy === 'invoices' ? 'Preparing…' : 'Export Invoices (.xlsx)'}</Text></TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  h3: { fontSize: 15, fontWeight: '700', color: colors.text },
  bold: { fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.text },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 6 },
  list: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 8, maxHeight: 240, marginTop: 6 },
  item: { paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11, justifyContent: 'center' },
  primaryBtnSm: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  btnSm: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  btnSmText: { color: colors.text, fontWeight: '600', fontSize: 13 },
})
