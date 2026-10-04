// mobile\src\screens\RepairBillListScreen.tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
// OS print dialog - the Android equivalent of web's window.open + window.print() (a phone has no
// browser print popup). Same expo-print call JobCardDetailScreen's PrintMenu already uses.
import * as Print from 'expo-print'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { PickerField } from '../components/PickerField'
import { colors } from '../theme/colors'
import type { RootStackParamList } from '../navigation/RootNavigator'
import type { BaplDmsWorkshop, CombinedRepairBillRow, JobCardDetail, RepairBillDoc } from '../types'
import { buildRepairBillTaxInvoicePrintHtml, taxInvoiceContextFromJobCard, type TaxInvoiceContext } from '../utils/repairBillInvoicePrintHtml'

/**
 * "Repair Bill List" screen (2026-09-23, "this main in 1 page not on same only which are save in
 * jobcard db that in grid button and which material transfer that jobcard") - the Android
 * counterpart to web's new RepairBillListPage.tsx, split out of RepairBillCreateScreen.tsx's own
 * embedded list section (see that screen's own doc comment), confirmed via AskUserQuestion
 * ("Android + Web: both get a separate list screen/page" + "JobCardScanner rows only").
 *
 * Calls GET /api/repair-bill-docs/combined with ownOnly=true (RepairBillDocsController.Combined's
 * own doc comment) so the backend skips the DMSBAPLDATA fetch entirely - every row here is always
 * this dealer's own JobCardScanner-saved bill; the .filter below is defensive belt-and-braces only,
 * same reasoning as web's RepairBillListPage.tsx. Filters mirror web's own (Date From/To/Service
 * Location/Bill No/Job No/Chassis No) - the "Filter DMSBAPLDATA rows by Party Name" filter this
 * screen's old embedded list had is dropped, same as web, since it only ever narrowed the
 * DMSBAPLDATA half this screen no longer fetches.
 *
 * Tap a row to expand its Item lines (same tap-to-expand UX the old embedded list had). A still-
 * Performa row also gets an "Edit" button that navigates to RepairBillCreate with
 * { editBillId: r.id } - the Android equivalent of web's `navigate('/repair-bill-new?editId=...')`
 * - and, for parity with web's read-only RecordDetailModal popup (which offers "Save as Invoice"
 * for a Performa row too), a "Save as Invoice" button right here so that action isn't lost by
 * moving off the create screen. canDelete-gated Delete, same SystemAdmin-only rule as before.
 *
 * 2026-10-04 (Print Invoice, mirrors web's RepairBillListPage.tsx): an expanded BILLED row gets a
 * "🖨 Print Invoice" button that prints the bill in the DMS "GST TAX INVOICE" layout (same document
 * as JobCardDetailScreen's Print -> Invoice; shared builder in utils/repairBillInvoicePrintHtml.ts).
 * Billed-only on purpose - a Performa bill isn't an invoice yet and shouldn't print under a "GST TAX
 * INVOICE" heading. The list row isn't guaranteed to carry every column the invoice needs, so
 * printInvoice() re-fetches the full RepairBillDoc (GET /api/repair-bill-docs/{id}) and, when the
 * bill is linked to a job card, that job card too (customer address/state, vehicle, job type/source,
 * technician). If the job card can't be loaded the invoice still prints with those fields "-".
 */
type RepairBillListNav = NativeStackNavigationProp<RootStackParamList, 'RepairBillList'>

export function RepairBillListScreen() {
  const { profile, hasRole } = useStaffAuth()
  const canDelete = hasRole('SystemAdmin')
  const navigation = useNavigation<RepairBillListNav>()

  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  useEffect(() => {
    if (!profile?.dealerId) return
    apiClient.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then(({ data }) => {
        const scoped = profile?.workLocationCodes?.length ? data.filter((w) => profile.workLocationCodes.includes(w.locCode)) : data
        setWorkshops(scoped)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.dealerId, profile?.workLocationCodes])

  const [listDateFrom, setListDateFrom] = useState('')
  const [listDateTo, setListDateTo] = useState('')
  const [listLocation, setListLocation] = useState('')
  const [listBillNo, setListBillNo] = useState('')
  const [listJobNo, setListJobNo] = useState('')
  const [listChassisNo, setListChassisNo] = useState('')
  const [rows, setRows] = useState<CombinedRepairBillRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [printingId, setPrintingId] = useState<string | null>(null)

  const loadCombined = () => {
    setLoading(true)
    apiClient
      .get<{ rows: CombinedRepairBillRow[]; dmsBaplDataError: string | null }>('/api/repair-bill-docs/combined', {
        params: {
          ownOnly: true,
          billNo: listBillNo || undefined,
          jobNo: listJobNo || undefined,
          chassisNo: listChassisNo || undefined,
          locationCode: listLocation || undefined,
          dateFrom: listDateFrom || undefined,
          dateTo: listDateTo || undefined,
        },
      })
      .then((r) => { setRows(r.data.rows.filter((row) => row.source === 'JobCardScanner')); setLoadError(null) })
      .catch(() => { setRows([]); setLoadError('Could not load the repair bill list.') })
      .finally(() => setLoading(false))
  }
  useEffect(loadCombined, []) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteBill = (id: string) => {
    Alert.alert('Delete this repair bill?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => apiClient.delete(`/api/repair-bill-docs/${id}`).then(loadCombined).catch((err) => Alert.alert('Could not delete', err?.response?.data?.message ?? 'Could not delete the repair bill.')) },
    ])
  }

  // Same PUT .../status Billed transition as RepairBillCreateScreen.tsx's own
  // finalizeEditingBillAsInvoice - see that screen's doc comment for why the body is a JSON string.
  const saveAsInvoice = (r: CombinedRepairBillRow) => {
    Alert.alert(
      'Save as Invoice?',
      `Save Bill ${r.billNumber} as Invoice? This finalizes it - line items can no longer be changed afterwards.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save as Invoice',
          onPress: () => {
            setConvertingId(r.id)
            apiClient
              .put(`/api/repair-bill-docs/${r.id}/status`, JSON.stringify('Billed'), { headers: { 'Content-Type': 'application/json' } })
              .then(() => { Alert.alert('Saved', `Bill ${r.billNumber} saved as Invoice.`); loadCombined() })
              .catch((err) => Alert.alert('Could not save', err?.response?.data?.message ?? 'Could not save this bill as an Invoice.'))
              .finally(() => setConvertingId(null))
          },
        },
      ],
    )
  }

  // 2026-10-04 (Print Invoice) - see this screen's doc comment. Billed bills only.
  const printInvoice = async (r: CombinedRepairBillRow) => {
    setPrintingId(r.id)
    try {
      const { data: bill } = await apiClient.get<RepairBillDoc>(`/api/repair-bill-docs/${r.id}`)
      // Fallback context (no linked job card, or it can't be loaded): dealer name from the signed-in
      // profile when the app's profile type carries one; everything else comes from the bill itself.
      const profileDealerName = (profile as unknown as { dealerName?: string | null } | null | undefined)?.dealerName
      let ctx: TaxInvoiceContext = { dealerName: profileDealerName }
      if (bill.jobCardId) {
        try {
          const { data: jc } = await apiClient.get<JobCardDetail>(`/api/jobcards/${bill.jobCardId}`)
          const fromJob = taxInvoiceContextFromJobCard(jc)
          ctx = { ...fromJob, dealerName: fromJob.dealerName ?? profileDealerName }
        } catch {
          /* best-effort - the invoice still prints without the job card's customer/vehicle extras */
        }
      }
      await Print.printAsync({ html: buildRepairBillTaxInvoicePrintHtml(bill, ctx) })
    } catch (err: unknown) {
      Alert.alert('Could not print', (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not load this invoice for printing.')
    } finally {
      setPrintingId(null)
    }
  }

  return (
    <ScrollView style={styles.screen} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={loadCombined} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={styles.sectionTitle}>Repair Bill List</Text>
        <TouchableOpacity style={styles.smallBtn} onPress={() => navigation.navigate('RepairBillCreate')}>
          <Text style={styles.smallBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>
      {/* <Text style={styles.muted}>Every repair bill saved in JobCardScanner's own database. Tap a Proforma bill's Edit button to open and edit it.</Text> */}

      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Bill No.</Text>
          <TextInput style={styles.input} value={listBillNo} onChangeText={setListBillNo} onSubmitEditing={loadCombined} placeholder="Enter Bill No." />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Job No.</Text>
          <TextInput style={styles.input} value={listJobNo} onChangeText={setListJobNo} onSubmitEditing={loadCombined} placeholder="Enter Job No." />
        </View>
      </View>
      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Chassis No.</Text>
          <TextInput style={styles.input} value={listChassisNo} onChangeText={setListChassisNo} onSubmitEditing={loadCombined} placeholder="Enter Chassis No." />
        </View>
      </View>
      <PickerField
        label="Service Location"
        value={listLocation}
        onChange={setListLocation}
        options={[{ label: 'All locations', value: '' }, ...workshops.map((w) => ({ label: `${w.locCode} — ${w.locName}`, value: w.locCode }))]}
        placeholder="All locations"
      />
      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Date From</Text>
          <TextInput style={styles.input} value={listDateFrom} onChangeText={setListDateFrom} placeholder="YYYY-MM-DD" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Date To</Text>
          <TextInput style={styles.input} value={listDateTo} onChangeText={setListDateTo} placeholder="YYYY-MM-DD" />
        </View>
      </View>
      <TouchableOpacity style={styles.smallBtn} onPress={loadCombined}><Text style={styles.smallBtnText}>{loading ? 'Loading…' : 'Search'}</Text></TouchableOpacity>
      {loadError && <Text style={styles.error}>{loadError}</Text>}
      {loading && <ActivityIndicator style={{ marginVertical: 8 }} color={colors.primary} />}

      {rows.map((r) => (
        <TouchableOpacity key={r.id} style={styles.row} onPress={() => setExpandedId(expandedId === r.id ? null : r.id)}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Text style={[styles.badge, styles.badgeSuccess]}>{r.source}</Text>
              <Text style={styles.rowTitle}>{r.billNumber}</Text>
              <Text style={[styles.badge, styles.badgeMuted]}>{r.status}</Text>
            </View>
            <Text style={styles.muted}>{r.sortDate ? new Date(r.sortDate).toLocaleDateString('en-IN') : '—'} · {r.location ?? '—'} · {r.billType ?? '—'} · Job {r.jobNo ?? '—'}</Text>
            <Text style={styles.muted}>{r.partyName ?? '—'} · {r.regNo ?? '—'} · {r.chassisNo ?? '—'}</Text>
            <Text style={styles.muted}>{r.itemCount} item(s) · ₹{r.totalAmount.toFixed(2)} · Prepared by {r.preparedBy ?? '—'} · Modified by {r.modifiedBy ?? '—'}</Text>
            {expandedId === r.id && (r.items ?? []).map((it, i) => (
              <Text key={i} style={styles.muted}>
                • {String(it.itemCode ?? it.itemIdno ?? '—')} — {String(it.itemDescription ?? it.itemDesc ?? '—')} · qty {String(it.qty ?? '—')} · rate ₹{String(it.rate ?? '—')}
              </Text>
            ))}
            {expandedId === r.id && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {r.status === 'Performa' && (
                  <TouchableOpacity style={[styles.addBtn, styles.inlineBtn]} onPress={(e) => { e.stopPropagation(); navigation.navigate('RepairBillCreate', { editBillId: r.id }) }}>
                    <Text style={styles.addBtnText}>✎ Edit</Text>
                  </TouchableOpacity>
                )}
                {r.status === 'Performa' && (
                  <TouchableOpacity style={[styles.smallBtn, { marginBottom: 0 }]} disabled={convertingId === r.id} onPress={(e) => { e.stopPropagation(); saveAsInvoice(r) }}>
                    <Text style={styles.smallBtnText}>{convertingId === r.id ? 'Saving…' : 'Save as Invoice'}</Text>
                  </TouchableOpacity>
                )}
                {r.status === 'Billed' && (
                  <TouchableOpacity
                    style={[styles.addBtn, styles.inlineBtn, printingId === r.id && styles.btnDisabled]}
                    disabled={printingId === r.id}
                    onPress={(e) => { e.stopPropagation(); printInvoice(r) }}
                  >
                    <Text style={styles.addBtnText}>{printingId === r.id ? 'Loading…' : '🖨 Print Invoice'}</Text>
                  </TouchableOpacity>
                )}
                {canDelete && (
                  <TouchableOpacity style={styles.removeBtn} onPress={(e) => { e.stopPropagation(); deleteBill(r.id) }}><Text style={styles.removeBtnText}>Delete</Text></TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>
      ))}
      {rows.length === 0 && !loading && <Text style={styles.muted}>No repair bills yet.</Text>}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  formRow: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 8 },
  error: { fontSize: 12, color: colors.danger, marginTop: 4, marginBottom: 4 },
  smallBtn: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, alignSelf: 'flex-start', marginBottom: 10 },
  smallBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
  rowTitle: { fontWeight: '700', color: colors.text },
  addBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  inlineBtn: { paddingHorizontal: 16 },
  addBtnText: { color: '#fff', fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  row: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  removeBtn: { backgroundColor: colors.danger, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center' },
  removeBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  badge: { fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  badgeSuccess: { backgroundColor: colors.successSoft, color: colors.success },
  badgeMuted: { backgroundColor: colors.bg, color: colors.textMuted },
})
