// mobile\src\screens\LedgerMasterScreen.tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { PickerField } from '../components/PickerField'
import { colors } from '../theme/colors'

/**
 * "Ledger Master" - the Android counterpart of web/src/pages/staff/LedgerMasterPage.tsx: the Party and Insurance ledgers (the customers and insurance companies the New Job Card wizard's "Edit anyway"
 * and the Repair Bill's Insurance picker list). Company and Dealer ledgers are copied from the ERP and are read-only here (only a SystemAdmin may change them, exactly as on web).
 *   * list: search, Ledger Type filter, inactive ledgers shown greyed out, "load more" paging (GET /api/ledger-master);
 *   * add / edit: every role may create and edit (a dealer login only its own dealer's ledgers; CorporateAdmin / SystemAdmin pick the Dealer first); a ledger you may not change opens view-only;
 *   * delete = deactivate and reactivate: CorporateAdmin / SystemAdmin only (a ledger copied from the ERP: SystemAdmin only) - the server refuses it for anyone else too.
 * Not on Android (web only): Excel export of the grid, "Sync from ERP" and the ERP Dealer Code picker.
 */
interface LedgerType { id: number; customerType: string; isErpSourced: boolean; isOrgLevel: boolean }
interface DealerOption { id: string; code: string | null; name: string }
interface LedgerRow {
  id: string; dealerId: string | null; dealerName: string | null; dealerCode: string | null; ledgerTypeId: number; ledgerType: string; ledgerCode: string; ledgerName: string
  mobileNumber: string | null; alternateMobileNo: string | null; eMail: string | null; address: string | null; address2: string | null; city: string | null; state: string | null
  pin: string | null; gstno: string | null; pan: string | null; aadharNumber: string | null; isShared: boolean; isActive: boolean
}
interface Form {
  ledgerTypeId: number; dealerId: string; ledgerName: string; mobileNumber: string; alternateMobileNo: string; eMail: string; address: string; address2: string
  city: string; state: string; pin: string; gstno: string; pan: string; aadharNumber: string; isShared: boolean
}
const EMPTY: Form = { ledgerTypeId: 0, dealerId: '', ledgerName: '', mobileNumber: '', alternateMobileNo: '', eMail: '', address: '', address2: '', city: '', state: '', pin: '', gstno: '', pan: '', aadharNumber: '', isShared: false }
const PAGE_SIZE = 50
const errText = (err: unknown, fallback: string) => (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback

export function LedgerMasterScreen() {
  const { profile } = useStaffAuth()
  const isOrgWide = profile?.role === 'CorporateAdmin' || profile?.role === 'SystemAdmin'
  const [types, setTypes] = useState<LedgerType[]>([])
  const [dealers, setDealers] = useState<DealerOption[]>([])
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [total, setTotal] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editRow, setEditRow] = useState<LedgerRow | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [mobileWarning, setMobileWarning] = useState<string | null>(null)

  useEffect(() => {
    apiClient.get<LedgerType[]>('/api/ledger-master/types').then((r) => setTypes(r.data)).catch(() => setTypes([]))
    apiClient.get<DealerOption[]>('/api/ledger-master/dealers').then((r) => setDealers(r.data)).catch(() => setDealers([]))
  }, [])
  const typeById = (id: number | null | undefined) => types.find((t) => t.id === id)

  const fetchPage = (index: number, append: boolean) => {
    setLoading(true)
    setError(null)
    apiClient
      .get<{ data: LedgerRow[]; totalRecords: number }>('/api/ledger-master', { params: { searchTerm: search.trim() || undefined, pageIndex: index, pageSize: PAGE_SIZE, ledgerTypeId: typeFilter || undefined, includeInactive: true } })
      .then((res) => { setRows((prev) => (append ? [...prev, ...res.data.data] : res.data.data)); setTotal(res.data.totalRecords); setPageIndex(index) })
      .catch((err) => { if (!append) setRows([]); setError(errText(err, 'Could not load Ledger Master data.')) })
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    if (!profile) return
    const handle = setTimeout(() => fetchPage(0, false), 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role, typeFilter, search])

  /** Who can change a row (the server enforces the same). */
  const canChangeRow = (r: LedgerRow) => {
    const t = typeById(r.ledgerTypeId)
    if (t?.isErpSourced) return profile?.role === 'SystemAdmin'
    if (isOrgWide) return true
    if (t?.isOrgLevel) return false
    return !!profile?.dealerId && r.dealerId === profile.dealerId
  }
  /** Every role may create and edit, but only CorporateAdmin / SystemAdmin may delete or reactivate (an ERP ledger: SystemAdmin only). */
  const canDeleteRow = (r: LedgerRow) => (typeById(r.ledgerTypeId)?.isErpSourced ? profile?.role === 'SystemAdmin' : isOrgWide)

  const addableTypes = types.filter((t) => !t.isErpSourced && (isOrgWide || !t.isOrgLevel))
  const formType = typeById(editRow ? editRow.ledgerTypeId : form.ledgerTypeId)
  const isPartyOrInsurance = !!formType && !formType.isErpSourced && !formType.isOrgLevel
  const readOnlyForm = !!editRow && !canChangeRow(editRow)

  const openAdd = () => {
    const party = addableTypes.find((t) => t.customerType.trim().toLowerCase() === 'party') ?? addableTypes[0]
    setEditRow(null)
    setForm({ ...EMPTY, ledgerTypeId: party?.id ?? 0, dealerId: isOrgWide ? '' : profile?.dealerId ?? '' })
    setFormError(null)
    setMobileWarning(null)
    setFormOpen(true)
  }
  const openEdit = (r: LedgerRow) => {
    setEditRow(r)
    setForm({
      ledgerTypeId: r.ledgerTypeId, dealerId: r.dealerId ?? '', ledgerName: r.ledgerName, mobileNumber: r.mobileNumber ?? '', alternateMobileNo: r.alternateMobileNo ?? '', eMail: r.eMail ?? '',
      address: r.address ?? '', address2: r.address2 ?? '', city: r.city ?? '', state: r.state ?? '', pin: r.pin ?? '', gstno: r.gstno ?? '', pan: r.pan ?? '', aadharNumber: r.aadharNumber ?? '', isShared: r.isShared,
    })
    setFormError(null)
    setMobileWarning(null)
    setFormOpen(true)
  }
  const closeForm = () => { setFormOpen(false); setEditRow(null); setForm(EMPTY); setFormError(null); setMobileWarning(null) }

  // warn (not block) when another ledger already uses this mobile number
  useEffect(() => {
    const mobile = form.mobileNumber.trim()
    if (!formOpen || mobile.length !== 10) { setMobileWarning(null); return }
    const handle = setTimeout(() => {
      apiClient.get<boolean>('/api/ledger-master/check-mobile', { params: { mobile, excludeId: editRow?.id } })
        .then((r) => setMobileWarning(r.data ? 'Another ledger already uses this mobile number.' : null))
        .catch(() => setMobileWarning(null))
    }, 400)
    return () => clearTimeout(handle)
  }, [form.mobileNumber, formOpen, editRow?.id])

  const save = () => {
    const name = form.ledgerName.trim()
    if (!editRow && !form.ledgerTypeId) { setFormError('Ledger Type is required.'); return }
    if (!name) { setFormError('Ledger Name is required.'); return }
    if (!editRow && isOrgWide && isPartyOrInsurance && !form.dealerId) { setFormError('Dealer is required.'); return }
    setSaving(true)
    setFormError(null)
    const common = {
      ledgerName: name, mobileNumber: form.mobileNumber.trim() || null, alternateMobileNo: form.alternateMobileNo.trim() || null, eMail: form.eMail.trim() || null,
      address: form.address.trim() || null, address2: form.address2.trim() || null, city: form.city.trim() || null, state: form.state.trim() || null, pin: form.pin.trim() || null,
      gstno: form.gstno.trim() || null, pan: form.pan.trim() || null, aadharNumber: form.aadharNumber.trim() || null,
      isShared: isOrgWide && isPartyOrInsurance ? form.isShared : undefined,
    }
    const req = editRow
      ? apiClient.put(`/api/ledger-master/${editRow.id}`, { ...common, isActive: editRow.isActive })
      : apiClient.post('/api/ledger-master', { ...common, ledgerTypeId: form.ledgerTypeId, dealerId: isOrgWide && isPartyOrInsurance ? form.dealerId || null : undefined })
    req.then(() => { closeForm(); fetchPage(0, false) })
      .catch((err) => setFormError(errText(err, `Could not save this ledger (${(err as { response?: { status?: number } })?.response?.status ? `HTTP ${(err as { response?: { status?: number } }).response?.status}` : 'no response from the server'}).`)))
      .finally(() => setSaving(false))
  }

  const toggleActive = (r: LedgerRow) => {
    if (!canDeleteRow(r)) return
    const act = () => {
      const action = r.isActive
        ? apiClient.delete(`/api/ledger-master/${r.id}`)
        : apiClient.put(`/api/ledger-master/${r.id}`, {
            ledgerName: r.ledgerName, mobileNumber: r.mobileNumber, alternateMobileNo: r.alternateMobileNo, eMail: r.eMail, address: r.address, address2: r.address2, city: r.city, state: r.state,
            pin: r.pin, gstno: r.gstno, pan: r.pan, aadharNumber: r.aadharNumber, isActive: true,
          })
      action.then(() => { closeForm(); fetchPage(0, false) }).catch((err) => Alert.alert('Ledger Master', errText(err, 'Could not change this ledger.')))
    }
    if (r.isActive) Alert.alert('Delete ledger', `Delete ledger "${r.ledgerName}"? It is hidden from the pickers and can be reactivated from this list later.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: act }])
    else act()
  }

  const field = (label: string, key: keyof Form, opts: { keyboard?: 'default' | 'number-pad' | 'email-address'; max?: number } = {}) => (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, readOnlyForm && { backgroundColor: '#f4f6f9' }]} editable={!readOnlyForm} value={String(form[key] ?? '')} maxLength={opts.max}
        keyboardType={opts.keyboard ?? 'default'} autoCapitalize={key === 'eMail' ? 'none' : 'sentences'}
        onChangeText={(v) => setForm({ ...form, [key]: key === 'mobileNumber' || key === 'alternateMobileNo' ? v.replace(/\D/g, '').slice(0, 10) : v })}
      />
    </View>
  )

  return (
    <View style={styles.screen}>
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        data={formOpen ? [] : rows}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (!loading && !formOpen && rows.length < total) fetchPage(pageIndex + 1, true) }}
        ListHeaderComponent={
          <>
            <TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="Search name, ledger code, mobile or city…" placeholderTextColor={colors.textMuted} />
            <View style={{ marginTop: 8 }}>
              <PickerField label="Ledger Type" value={typeFilter} onChange={setTypeFilter} options={[{ value: '', label: 'All types' }, ...types.map((t) => ({ value: String(t.id), label: t.customerType }))]} />
            </View>
            <View style={styles.toolbar}>
              <Text style={styles.muted}>{total.toLocaleString('en-IN')} ledger{total === 1 ? '' : 's'}</Text>
              {!formOpen && <TouchableOpacity style={styles.primaryBtn} onPress={openAdd}><Text style={styles.primaryBtnText}>+ Add Ledger</Text></TouchableOpacity>}
            </View>
            {error && <Text style={styles.errorText}>{error}</Text>}

            {formOpen && (
              <View style={styles.card}>
                <Text style={styles.h3}>{editRow ? `${editRow.ledgerCode} · ${editRow.ledgerType}${editRow.dealerName && formType && !formType.isErpSourced ? ` · ${editRow.dealerName}` : ''}` : 'Add Ledger'}</Text>
                {readOnlyForm && <Text style={styles.muted}>You can view this ledger but not change it.</Text>}
                {!editRow && (
                  <View style={{ marginTop: 8 }}>
                    <PickerField label="Ledger Type" required value={String(form.ledgerTypeId || '')} onChange={(v) => setForm({ ...form, ledgerTypeId: Number(v) })} options={addableTypes.map((t) => ({ value: String(t.id), label: t.customerType }))} />
                  </View>
                )}
                {!editRow && isOrgWide && isPartyOrInsurance && (
                  <View style={{ marginTop: 8 }}>
                    <PickerField label="Dealer" required value={form.dealerId} onChange={(v) => setForm({ ...form, dealerId: v })} options={dealers.map((d) => ({ value: d.id, label: `${d.code ? `${d.code} - ` : ''}${d.name}` }))} />
                  </View>
                )}
                {field('Ledger Name *', 'ledgerName')}
                {field('Mobile (10 digits)', 'mobileNumber', { keyboard: 'number-pad', max: 10 })}
                {mobileWarning && <Text style={styles.warnText}>{mobileWarning}</Text>}
                {field('Alternate mobile', 'alternateMobileNo', { keyboard: 'number-pad', max: 10 })}
                {field('Email', 'eMail', { keyboard: 'email-address' })}
                {field('Address', 'address')}
                {field('Address 2', 'address2')}
                {field('City', 'city')}
                {field('State', 'state')}
                {field('Pin', 'pin', { keyboard: 'number-pad', max: 10 })}
                {field('GSTIN', 'gstno', { max: 20 })}
                {field('PAN', 'pan', { max: 10 })}
                {field('Aadhaar no.', 'aadharNumber', { keyboard: 'number-pad', max: 12 })}
                {isOrgWide && isPartyOrInsurance && !readOnlyForm && (
                  <View style={styles.switchRow}><Switch value={form.isShared} onValueChange={(v) => setForm({ ...form, isShared: v })} /><Text style={styles.rowText}>Visible to every dealer (ALL DEALERS)</Text></View>
                )}
                {formError && <Text style={styles.errorText}>{formError}</Text>}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {!readOnlyForm && <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}><Text style={styles.primaryBtnText}>{saving ? 'Saving…' : editRow ? 'Save changes' : 'Create ledger'}</Text></TouchableOpacity>}
                  {editRow && canDeleteRow(editRow) && (
                    <TouchableOpacity style={[styles.btn, editRow.isActive && styles.btnDanger]} onPress={() => toggleActive(editRow)}><Text style={[styles.btnText, editRow.isActive && { color: '#fff' }]}>{editRow.isActive ? 'Delete' : 'Reactivate'}</Text></TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.btn} onPress={closeForm}><Text style={styles.btnText}>{readOnlyForm ? 'Close' : 'Cancel'}</Text></TouchableOpacity>
                </View>
              </View>
            )}
          </>
        }
        ListFooterComponent={loading ? <ActivityIndicator color={colors.primary} style={{ margin: 12 }} /> : null}
        ListEmptyComponent={!loading && !error && !formOpen ? <Text style={styles.muted}>No ledgers found.</Text> : null}
        renderItem={({ item: r }) => (
          <TouchableOpacity style={[styles.row, !r.isActive && { opacity: 0.55 }]} onPress={() => openEdit(r)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{r.ledgerCode} — {r.ledgerName}</Text>
              <Text style={styles.muted}>{r.ledgerType}{r.isShared && !typeById(r.ledgerTypeId)?.isErpSourced && !typeById(r.ledgerTypeId)?.isOrgLevel ? ' · ALL DEALERS' : ''}{r.dealerName ? ` · ${r.dealerName}` : ''}</Text>
              <Text style={styles.muted}>{r.mobileNumber ?? '—'} · {r.city ?? '—'} · {r.state ?? '—'}{r.isActive ? '' : ' · inactive'}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, marginVertical: 10 },
  h3: { fontSize: 15, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.text },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  rowText: { color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 8 },
  rowTitle: { fontWeight: '700', color: colors.text },
  chev: { fontSize: 22, color: colors.textMuted },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 8 },
  warnText: { color: '#b45309', fontSize: 12, marginTop: 4 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', backgroundColor: '#fff' },
  btnDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnText: { fontWeight: '700', color: colors.text },
})
