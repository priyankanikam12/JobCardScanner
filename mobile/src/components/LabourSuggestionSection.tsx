import { useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { apiMessage, discountLabel, discountOf, suggestionLineMoney, type DiscountKind } from '../lib/suggestionMoney'
import type { JobCardsLabourCatalogRow, JobCardDetail } from '../types'

// Issue Type: Paid / Under Warranty / Free of cost - matches web's LABOUR_ISSUE_TYPES (FOC added 03.10.2026).
const ISSUE_TYPES = ['Paid', 'U/W', 'FOC'] as const
const DISCOUNT_KINDS: { value: DiscountKind; label: string }[] = [
  { value: 'None', label: 'None' },
  { value: 'Percentage', label: '%' },
  { value: 'Amount', label: '₹' },
]

/**
 * "Labour Suggestion" panel - mirrors web/src/pages/staff/JobCardDetailPage.tsx's LabourSuggestionCard.
 *
 * 2026-10-22 (Android brought level with web) - what this card gained:
 *   * Issue Type FOC (free of cost: the line's Amount is 0).
 *   * Discount (None / % / ₹) on a line, set when it is added or later in the Edit row (PUT /api/jobcards/labour-suggestions/{id}/discount). An FOC line takes no discount.
 *   * An Edit row on every saved line: Quantity, Issue Type, Discount - and, ONLY for a line whose saved rate is 0 (or missing), an open Rate and HSN (22.10.2026: "only for a line whose rate is 0,
 *     not for all"). Whether a line is open is decided from its SAVED rate when Edit is tapped, so typing a rate never makes the box disappear. A line that already has a rate keeps it locked from
 *     Labour Master - the server refuses a rate for it too (JobCardsController.UpdateLabourSuggestion). Rate must be 0 or more; HSN is digits only, up to 8 (blank clears it).
 *   * Rate / SGST / CGST / IGST / Discount / Amount shown per line.
 * Unchanged: Labour Master is searched as you type (GET /api/jobcards/labour-catalog?search=); labourCode is NOT unique per row, so the picker is keyed by each row's own `id`.
 */
export function LabourSuggestionSection({ jc, onChanged, estimatesLocked, totalLockReached }: { jc: JobCardDetail; onChanged: () => void; estimatesLocked: boolean; totalLockReached: boolean }) {
  const [rows, setRows] = useState<JobCardsLabourCatalogRow[]>([])
  const [q, setQ] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // the picked row's own data, set once at pick time - a later re-search can no longer un-pick it
  const [selected, setSelected] = useState<JobCardsLabourCatalogRow | null>(null)
  const [qty, setQty] = useState('1')
  const [issueType, setIssueType] = useState<string>('')
  const [discountType, setDiscountType] = useState<DiscountKind>('None')
  const [discountValue, setDiscountValue] = useState('0')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<{ id: string; qty: string; issueType: string; discountType: DiscountKind; discountValue: string; rateEditable: boolean; rate: string; hsn: string } | null>(null)

  /** A rate can be typed only while it is 0 (or missing) - a rate that is already on the line is never changed from this screen. */
  const rateIsOpen = (rate: number | null | undefined) => !(Number(rate) > 0)

  useEffect(() => {
    const handle = setTimeout(() => {
      apiClient
        .get<JobCardsLabourCatalogRow[]>('/api/jobcards/labour-catalog', { params: q.trim() ? { search: q.trim() } : {} })
        .then(({ data }) => setRows(data))
        .catch(() => setRows([]))
    }, 300)
    return () => clearTimeout(handle)
  }, [q])

  const addSuggestion = async () => {
    if (!selected) return
    // gated on an open Technician Work Log timer (2026-09-07)
    if (!jc.worklogs.some((w) => !w.endedAt)) {
      Alert.alert('Start the Technician Work Log timer before adding a labour suggestion.')
      return
    }
    setSaving(true)
    try {
      const { data: created } = await apiClient.post<{ id: string }>(`/api/jobcards/${jc.id}/labour-suggestions`, {
        labourCode: selected.labourCode,
        labourDescription: selected.labourDescription ?? null,
        hsnCode: selected.hsnCode ?? null,
        sgst: selected.sgst ?? null,
        cgst: selected.cgst ?? null,
        igst: selected.igst ?? null,
        rateAtSuggestion: selected.labourRate ?? null,
        quantity: Math.min(Number(qty) || 1, 10000), // the API accepts 1 .. 10,000 (VAPT DMS-08)
        issueType: issueType || null,
      })
      // the discount is saved right after the line is added (an FOC line is free of cost, so it never takes one)
      const value = Number(discountValue) || 0
      if (issueType !== 'FOC' && discountType !== 'None' && value > 0) {
        try {
          await apiClient.put(`/api/jobcards/labour-suggestions/${created.id}/discount`, { discountType, discountValue: discountType === 'Percentage' ? Math.min(value, 100) : value })
        } catch {
          Alert.alert('The labour was added, but its discount could not be saved - use Edit on its row to set it.')
        }
      }
      setSelectedId(null)
      setSelected(null)
      setQ('')
      setQty('1')
      setIssueType('')
      setDiscountType('None')
      setDiscountValue('0')
      onChanged()
    } catch (err) {
      Alert.alert(apiMessage(err, 'Could not add labour suggestion'))
    } finally {
      setSaving(false)
    }
  }

  const removeSuggestion = async (id: string) => {
    try {
      await apiClient.delete(`/api/jobcards/labour-suggestions/${id}`)
      onChanged()
    } catch (err) {
      Alert.alert(apiMessage(err, 'Could not remove labour suggestion'))
    }
  }

  /** Edit row of an open line: the Rate must be a number, 0 or more (0 is allowed - e.g. a free labour). A line that already has a rate has nothing to check. */
  const editRateValid = !!editing && (!editing.rateEditable || (editing.rate.trim() !== '' && Number.isFinite(Number(editing.rate)) && Number(editing.rate) >= 0))

  const saveEdit = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await apiClient.put(`/api/jobcards/labour-suggestions/${editing.id}`, {
        quantity: Math.min(Number(editing.qty) || 1, 10000),
        issueType: editing.issueType.trim() || null,
        ...(editing.rateEditable ? { rateAtSuggestion: Number(editing.rate) || 0, hsnCode: editing.hsn.trim() || null } : {}),
      })
      const value = Number(editing.discountValue) || 0
      const isFoc = editing.issueType.trim() === 'FOC'
      const type = isFoc ? 'None' : editing.discountType
      await apiClient.put(`/api/jobcards/labour-suggestions/${editing.id}/discount`, {
        discountType: type === 'None' ? null : type,
        discountValue: type === 'None' ? 0 : type === 'Percentage' ? Math.min(value, 100) : value,
      })
      setEditing(null)
      onChanged()
    } catch (err) {
      Alert.alert(apiMessage(err, 'Could not save the labour line'))
    } finally {
      setSaving(false)
    }
  }

  const pillRow = <T extends string>(options: { value: T; label: string }[], value: T, onPick: (v: T) => void, disabled = false) => (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <TouchableOpacity key={o.value} disabled={disabled} style={[styles.pill, value === o.value && styles.pillSelected, disabled && { opacity: 0.45 }]} onPress={() => onPick(o.value)}>
          <Text style={[styles.pillText, value === o.value && styles.pillTextSelected]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
  const issueOptions = ISSUE_TYPES.map((t) => ({ value: t as string, label: t }))

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Labour Suggestion</Text>

      {jc.labourSuggestions.length === 0 && <Text style={styles.muted}>No labour suggested yet.</Text>}
      {jc.labourSuggestions.map((l) => {
        if (editing?.id === l.id) {
          const e = editing
          const foc = e.issueType === 'FOC'
          const amount = suggestionLineMoney(e.rateEditable ? Number(e.rate) || 0 : l.rateAtSuggestion, Number(e.qty) || 0, foc, { type: e.discountType, value: Number(e.discountValue) || 0 }).amount
          return (
            <View key={l.id} style={styles.editBox}>
              <Text style={styles.rowTitle}>{l.labourCode} - {l.labourDescription ?? 'No description'}</Text>
              <View style={styles.formRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Qty</Text>
                  <TextInput style={styles.input} value={e.qty} keyboardType="numeric" onChangeText={(v) => setEditing({ ...e, qty: v })} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Rate{e.rateEditable ? ' (rate was 0)' : ''}</Text>
                  {e.rateEditable ? (
                    <TextInput
                      style={[styles.input, { borderColor: editRateValid ? '#f59e0b' : '#dc2626' }]}
                      value={e.rate} keyboardType="decimal-pad" autoFocus
                      onChangeText={(v) => setEditing({ ...e, rate: v })}
                    />
                  ) : (
                    <Text style={styles.readonly}>{l.rateAtSuggestion ?? '-'}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>HSN</Text>
                  {e.rateEditable ? (
                    <TextInput style={styles.input} value={e.hsn} keyboardType="number-pad" maxLength={8} placeholder="HSN" onChangeText={(v) => setEditing({ ...e, hsn: v.replace(/\D/g, '').slice(0, 8) })} />
                  ) : (
                    <Text style={styles.readonly}>{l.hsnCode ?? '-'}</Text>
                  )}
                </View>
              </View>
              <Text style={styles.label}>Issue Type</Text>
              {pillRow(issueOptions, e.issueType, (v) => setEditing({ ...e, issueType: v }))}
              <Text style={[styles.label, { marginTop: 8 }]}>Discount</Text>
              {foc ? <Text style={styles.muted}>FOC - free of cost, no discount applies.</Text> : (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {pillRow(DISCOUNT_KINDS, e.discountType, (v) => setEditing({ ...e, discountType: v }))}
                  <TextInput style={[styles.input, { width: 90 }, e.discountType === 'None' && { opacity: 0.45 }]} editable={e.discountType !== 'None'} value={e.discountValue} keyboardType="decimal-pad" onChangeText={(v) => setEditing({ ...e, discountValue: v })} />
                </View>
              )}
              <Text style={[styles.rowTitle, { marginTop: 8 }]}>Amount ₹{amount.toFixed(2)}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TouchableOpacity style={[styles.addBtn, { flex: 1 }, (!editRateValid || saving) && styles.addBtnDisabled]} disabled={!editRateValid || saving} onPress={saveEdit}>
                  <Text style={styles.addBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(null)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
              {!editRateValid && <Text style={[styles.muted, { color: '#dc2626' }]}>Type the Rate (0 or more) first.</Text>}
            </View>
          )
        }
        const d = discountOf(l)
        const money = suggestionLineMoney(l.rateAtSuggestion, l.quantity, l.issueType === 'FOC', d)
        return (
          <View key={l.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{l.labourCode} - {l.labourDescription ?? 'No description'}</Text>
              <Text style={styles.muted}>Qty {l.quantity} · Rate ₹{l.rateAtSuggestion ?? '-'} · HSN {l.hsnCode ?? '-'} · {l.issueType ?? '-'}</Text>
              <Text style={styles.muted}>SGST {l.sgst ?? '-'} · CGST {l.cgst ?? '-'} · IGST {l.igst ?? '-'} · Discount {l.issueType === 'FOC' ? 'FOC' : discountLabel(d)} · Amount ₹{money.amount.toFixed(2)}</Text>
            </View>
            <View style={{ gap: 6 }}>
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => setEditing({ id: l.id, qty: String(l.quantity), issueType: l.issueType ?? '', discountType: d.type, discountValue: String(d.value), rateEditable: rateIsOpen(l.rateAtSuggestion), rate: String(l.rateAtSuggestion ?? 0), hsn: l.hsnCode ?? '' })}
              >
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallBtn} onPress={() => removeSuggestion(l.id)}>
                <Text style={styles.smallBtnText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        )
      })}

      {estimatesLocked || totalLockReached ? (
        <Text style={styles.muted}>
          {jc.status === 'Closed'
            ? 'Job card is closed - no more labour can be suggested.'
            : 'Estimate is marked Done - tap Edit on the Estimates Amount card below to add more labour.'}
        </Text>
      ) : (
      <>
      <Text style={styles.subheading}>Suggest labour (from Labour Master)</Text>
      <Text style={styles.label}>Labour Code</Text>
      <TextInput
        style={styles.input}
        value={q}
        onChangeText={(text) => { setQ(text); setSelectedId(null); setSelected(null); setShowSuggestions(true) }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        placeholder="Search by labour code or description…"
      />

      {showSuggestions && q.trim().length > 0 && rows.length > 0 && (
        <ScrollView style={styles.pickerBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {rows.map((r) => {
            const isSelected = r.id === selectedId
            return (
              <TouchableOpacity
                key={r.id}
                style={[styles.pickerRow, isSelected && styles.pickerRowSelected]}
                onPress={() => { setSelectedId(r.id); setSelected(r); setQ(`${r.labourCode}${r.labourDescription ? ' - ' + r.labourDescription : ''}`); setShowSuggestions(false) }}
              >
                <Text style={[styles.pickerRowText, isSelected && styles.pickerRowTextSelected]}>
                  {r.labourCode} - {r.labourDescription ?? 'No description'} (₹{r.labourRate ?? '-'})
                </Text>
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
          {' · '}Amount ₹{suggestionLineMoney(selected.labourRate, Number(qty) || 1, issueType === 'FOC', { type: discountType, value: Number(discountValue) || 0 }).amount.toFixed(2)}
          {issueType === 'FOC' ? ' (FOC - free of cost)' : discountType !== 'None' && Number(discountValue) > 0 ? ' after discount' : ''}
        </Text>
      )}

      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Qty</Text>
          <TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="numeric" />
        </View>
        <View style={{ flex: 2 }}>
          <Text style={styles.label}>Issue Type</Text>
          {pillRow(issueOptions, issueType, setIssueType)}
        </View>
      </View>
      <Text style={styles.label}>Discount</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        {pillRow(DISCOUNT_KINDS, discountType, setDiscountType, issueType === 'FOC')}
        <TextInput
          style={[styles.input, { width: 90 }, (issueType === 'FOC' || discountType === 'None') && { opacity: 0.45 }]}
          editable={!(issueType === 'FOC' || discountType === 'None')}
          value={discountValue} keyboardType="decimal-pad" onChangeText={setDiscountValue}
        />
      </View>

      <TouchableOpacity
        style={[styles.addBtn, (!selected || saving) && styles.addBtnDisabled]}
        disabled={!selected || saving}
        onPress={addSuggestion}
      >
        <Text style={styles.addBtnText}>{saving ? 'Adding…' : 'Add Suggestion'}</Text>
      </TouchableOpacity>
      </>
      )}
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
  editBox: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10, marginVertical: 6 },
  readonly: { paddingVertical: 9, color: '#374151' },
  smallBtn: { backgroundColor: '#dc2626', borderWidth: 1, borderColor: '#dc2626', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center' },
  smallBtnText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  editBtn: { backgroundColor: '#f4f6f9', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center' },
  editBtnText: { fontSize: 12, fontWeight: '600', color: '#374151' },
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
  cancelBtn: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', backgroundColor: '#fff' },
  cancelBtnText: { color: '#374151', fontWeight: '700' },
})
