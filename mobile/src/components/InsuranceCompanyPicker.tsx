// mobile\src\components\InsuranceCompanyPicker.tsx
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { colors } from '../theme/colors'

/**
 * 2026-10-07 (web InsuranceSection): the "Insurance Company" of a Repair Bill is PICKED from the Insurance ledgers (Ledger Master, type "Insurance" - this dealer's own plus the ones shared with every
 * dealer), not typed. The list is loaded the first time it is opened (GET /api/ledger-master/types -> GET /api/ledger-master?ledgerTypeId=...); tapping a row calls onPick with that company's name, which the
 * Repair Bill screen saves as insuranceCompanyName exactly as before - so saving and editing an old bill (typed name) keep working unchanged.
 */
interface InsuranceLedger { id: string; ledgerCode: string; ledgerName: string; mobileNumber: string | null; city: string | null; state: string | null; gstno: string | null }

export function InsuranceCompanyPicker({ value, onPick, disabled = false }: { value: string; onPick: (companyName: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [ledgers, setLedgers] = useState<InsuranceLedger[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [pickedCode, setPickedCode] = useState('')

  useEffect(() => {
    if (!open || ledgers !== null) return
    setLoadError(null)
    apiClient
      .get<{ id: number; customerType: string }[]>('/api/ledger-master/types')
      .then(({ data }) => {
        const insuranceType = data.find((t) => t.customerType.trim().toLowerCase() === 'insurance')
        if (!insuranceType) { setLedgers([]); setLoadError('Ledger Master has no "Insurance" ledger type.'); return undefined }
        return apiClient
          .get<{ data: InsuranceLedger[]; totalRecords: number }>('/api/ledger-master', { params: { ledgerTypeId: insuranceType.id, pageIndex: 0, pageSize: 500, includeInactive: false } })
          .then((res) => setLedgers(res.data.data))
      })
      .catch((err) => { setLedgers([]); setLoadError(err?.response?.data?.message ?? 'Could not load the Insurance ledgers.') })
  }, [open, ledgers])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || !ledgers) return ledgers ?? []
    return ledgers.filter((l) => [l.ledgerName, l.ledgerCode, l.city, l.mobileNumber, l.gstno].some((v) => (v ?? '').toLowerCase().includes(q)))
  }, [ledgers, search])

  return (
    <View>
      <Text style={styles.label}>Insurance Company <Text style={{ color: colors.danger }}>*</Text></Text>
      <View style={styles.row}>
        <TextInput style={[styles.input, { flex: 1 }]} editable={false} value={value ? `${pickedCode ? `${pickedCode} - ` : ''}${value}` : ''} placeholder="Select an insurance company from the list" placeholderTextColor={colors.textMuted} />
        <TouchableOpacity style={[styles.btn, disabled && { opacity: 0.5 }]} disabled={disabled} onPress={() => setOpen((o) => !o)}>
          <Text style={styles.btnText}>{open ? 'Close' : value ? 'Change' : 'Select'}</Text>
        </TouchableOpacity>
      </View>
      {open && (
        <View style={styles.panel}>
          <TextInput style={styles.input} value={search} onChangeText={setSearch} autoFocus placeholder="Search insurance company, code, city, mobile or GST…" placeholderTextColor={colors.textMuted} />
          <ScrollView style={{ maxHeight: 240, marginTop: 6 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {ledgers === null && <Text style={styles.muted}>Loading…</Text>}
            {shown.map((l) => (
              <TouchableOpacity key={l.id} style={styles.item} onPress={() => { onPick(l.ledgerName); setPickedCode(l.ledgerCode); setOpen(false); setSearch('') }}>
                <Text style={styles.itemTitle}>{l.ledgerCode} — {l.ledgerName}</Text>
                <Text style={styles.muted}>{l.city ?? '—'} · {l.mobileNumber ?? '—'} · GST {l.gstno ?? '—'}</Text>
              </TouchableOpacity>
            ))}
            {ledgers !== null && shown.length === 0 && (
              <Text style={styles.muted}>{loadError ?? (search ? 'No insurance company matches your search.' : 'No Insurance ledgers yet - create one in Ledger Master (type Insurance), then tap Select again.')}</Text>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.text },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#fff' },
  btnText: { fontWeight: '700', color: colors.text },
  panel: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, marginTop: 6, backgroundColor: '#fff' },
  item: { paddingVertical: 9, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  itemTitle: { fontWeight: '600', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
})
