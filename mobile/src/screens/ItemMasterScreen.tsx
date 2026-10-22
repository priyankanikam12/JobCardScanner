import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { PickerField } from '../components/PickerField'
import { colors } from '../theme/colors'
import type { BaplItemMaster } from '../types'

/**
 * "Item Master" screen - mirrors web/src/pages/staff/ItemMasterPage.tsx. A browse/search over JobCardScanner's OWN copy of BAPL's C_ItemMaster catalogue (GET /api/item-master) - the same copy Job Card -> Part
 * Suggestion searches and Material Transfer / Repair Bill price against.
 *
 * 2026-10-22 (Android brought level with web):
 *   * "Sync from BAPL" (POST /api/item-master/sync) - CorporateAdmin / SystemAdmin only, because it replaces the catalogue every dealer searches - and the status line
 *     (GET /api/item-master/sync-status): table missing / empty / ready;
 *   * Status shown as Active / Inactive / Discontinued (A2 and B8 parts are discontinued models; only head-office roles are ever sent them);
 *   * Item Code / Item Name / Status filters (Status for head office only) applied on top of the server search, in the phone, instantly.
 */
interface SyncStatus { tableExists: boolean; rows: number; lastSyncedAt: string | null }
type StatusFilter = '' | 'Active' | 'Inactive' | 'Discontinued'

const isDiscontinued = (it: BaplItemMaster) => /^(A2|B8)/i.test((it.itemName ?? '').trim())
/** N = Inactive; otherwise an A2 / B8 part = Discontinued; otherwise Active (BAPL: Y or NULL = active). */
const statusOf = (it: BaplItemMaster): Exclude<StatusFilter, ''> => (it.status === 'N' ? 'Inactive' : isDiscontinued(it) ? 'Discontinued' : 'Active')

export function ItemMasterScreen() {
  const { hasRole } = useStaffAuth()
  const canSync = hasRole('CorporateAdmin', 'SystemAdmin')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<BaplItemMaster[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [fCode, setFCode] = useState('')
  const [fName, setFName] = useState('')
  const [fStatus, setFStatus] = useState<StatusFilter>('')

  const search = () => {
    setLoading(true)
    setError(null)
    apiClient
      .get<BaplItemMaster[]>('/api/item-master', { params: { q: q || undefined } })
      .then(({ data }) => setItems(data))
      .catch((err) => {
        setItems([])
        setError(err?.response?.data?.message ?? 'Could not read the Item Master - check the connection and try again.')
      })
      .finally(() => setLoading(false))
  }
  const loadStatus = () => {
    apiClient.get<SyncStatus>('/api/item-master/sync-status').then((r) => setStatus(r.data)).catch(() => setStatus(null))
  }

  useEffect(() => { loadStatus() }, [])
  useEffect(() => {
    const handle = setTimeout(search, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const doSync = () => {
    setSyncing(true)
    setSyncMsg(null)
    setError(null)
    apiClient
      .post<{ rows: number; seconds: number }>('/api/item-master/sync', undefined, { timeout: 10 * 60 * 1000 })
      .then((r) => { setSyncMsg(`Synced ${r.data.rows.toLocaleString('en-IN')} spare parts from BAPL in ${r.data.seconds}s.`); search(); loadStatus() })
      .catch((err) => setError(err?.response?.data?.message ?? 'The sync failed - check the connection to BAPL and try again.'))
      .finally(() => setSyncing(false))
  }
  const sync = () => Alert.alert(
    'Sync from BAPL',
    "Replace JobCardScanner's Item Master with a fresh copy from BAPL (baplfinal)? Every dealer's Item Master and Part Suggestion search will use the new data.",
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Sync', onPress: doSync }],
  )

  const filtered = useMemo(() => {
    const code = fCode.trim().toLowerCase()
    const name = fName.trim().toLowerCase()
    return items.filter((it) =>
      (!code || it.itemCode.toLowerCase().includes(code)) &&
      (!name || (it.itemName ?? it.displayName ?? '').toLowerCase().includes(name)) &&
      (!fStatus || statusOf(it) === fStatus))
  }, [items, fCode, fName, fStatus])
  const filtersActive = !!(fCode.trim() || fName.trim() || fStatus)

  const fmtAmt = (n?: number | null) => (n == null ? '—' : `₹${n.toFixed(2)}`)
  const fmtPct = (n?: number | null) => (n == null ? '—' : `${n}%`)
  const neverSynced = status !== null && (!status.tableExists || status.rows === 0)

  return (
    <View style={styles.screen}>
      <TextInput style={styles.search} value={q} onChangeText={setQ} placeholder="Search: item code, name, display name or HSN" placeholderTextColor={colors.textMuted} />
      <View style={styles.filters}>
        <TextInput style={[styles.search, styles.filterInput]} value={fCode} onChangeText={setFCode} placeholder="Filter: item code" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />
        <TextInput style={[styles.search, styles.filterInput]} value={fName} onChangeText={setFName} placeholder="Filter: item name" placeholderTextColor={colors.textMuted} />
      </View>
      {canSync && (
        <PickerField
          label="Status"
          value={fStatus}
          onChange={(v) => setFStatus(v as StatusFilter)}
          options={[{ value: '', label: 'All' }, { value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }, { value: 'Discontinued', label: 'Discontinued (A2 / B8)' }]}
        />
      )}
      <View style={styles.actions}>
        {filtersActive && (
          <TouchableOpacity style={styles.btn} onPress={() => { setFCode(''); setFName(''); setFStatus('') }}><Text style={styles.btnText}>Clear filters</Text></TouchableOpacity>
        )}
        {canSync && (
          <TouchableOpacity style={[styles.btn, styles.btnPrimary, syncing && { opacity: 0.6 }]} disabled={syncing} onPress={sync}>
            <Text style={[styles.btnText, { color: '#fff' }]}>{syncing ? 'Syncing…' : '⟳ Sync from BAPL'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {status !== null && !status.tableExists && <Text style={styles.warn}>The Item Master table has not been created yet.</Text>}
      {syncing && <Text style={styles.muted}>Copying the catalogue from BAPL - this can take up to a minute. Please keep this screen open.</Text>}
      {syncMsg && <Text style={styles.ok}>{syncMsg}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}
      {neverSynced && !canSync && <Text style={styles.warn}>An admin (Corporate / System Admin) needs to tap "Sync from BAPL" before items appear here.</Text>}
      {loading && <ActivityIndicator style={{ marginVertical: 10 }} color={colors.primary} />}
      <Text style={styles.muted}>{filtered.length.toLocaleString('en-IN')} item{filtered.length === 1 ? '' : 's'}{filtersActive ? ` (of ${items.length.toLocaleString('en-IN')} loaded)` : ''}</Text>
      <FlatList
        style={styles.list}
        data={filtered}
        keyExtractor={(it) => it.itemCode}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        ListEmptyComponent={!loading ? <Text style={styles.muted}>{neverSynced ? 'Nothing to show yet - the Item Master has not been synced from BAPL.' : items.length > 0 ? 'No items match the filters - clear a filter to see more.' : `No items found${q ? ` matching "${q}"` : ''}.`}</Text> : null}
        renderItem={({ item: it }) => {
          const st = statusOf(it)
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{it.itemCode}</Text>
                <Text style={styles.muted}>{it.itemName ?? it.displayName ?? '—'}</Text>
                <Text style={styles.muted}>HSN {it.hsnCode ?? '—'} · {it.itemType ?? '—'} · <Text style={st === 'Active' ? styles.active : styles.inactive}>{st}</Text></Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.price}>{fmtAmt(it.dlrPrice)}</Text>
                <Text style={styles.muted}>S {fmtPct(it.sgst)} · C {fmtPct(it.cgst)} · I {fmtPct(it.igst)}</Text>
                {/* this dealer's uploaded Part Upload stock, summed across every location - not a C_ItemMaster column. Blank means nothing uploaded yet, not 0 in stock. */}
                <Text style={styles.muted}>Qty {it.qty ?? '—'}</Text>
              </View>
            </View>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  search: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 8, color: colors.text },
  filters: { flexDirection: 'row', gap: 8 },
  filterInput: { flex: 1 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8, marginBottom: 4 },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: colors.surface },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnText: { fontWeight: '700', color: colors.text },
  error: { color: colors.danger, fontSize: 12, marginBottom: 8 },
  ok: { color: '#15803d', fontSize: 12, marginBottom: 6 },
  warn: { color: '#b45309', fontSize: 12, marginBottom: 6 },
  list: { flex: 1 },
  row: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  price: { fontWeight: '700', color: colors.text },
  active: { color: colors.success, fontWeight: '700' },
  inactive: { color: colors.textMuted, fontWeight: '700' },
})
