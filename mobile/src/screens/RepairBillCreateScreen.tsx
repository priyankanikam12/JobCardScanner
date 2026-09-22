import { useEffect, useState } from 'react'
import { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { JobSearchModal } from '../components/JobSearchModal'
import { PickerField } from '../components/PickerField'
import { colors } from '../theme/colors'
import type { BaplDmsLabourRow, BaplDmsPartStock, BaplDmsWorkshop, BaplItemMaster, CombinedRepairBillRow, JobSearchResult, RepairBillDocItemType } from '../types'

/**
 * "Repair Bill" screen (2026-09-21, "add changes in android also") - the Android counterpart to
 * web/src/pages/staff/RepairBillCreatePage.tsx, posting to the SAME backend endpoint (POST/GET
 * /api/repair-bill-docs...) - no backend change was needed for this round, only this new screen.
 * See MaterialTransferCreateScreen.tsx's doc comment for the shared "one line at a time" phone
 * layout reasoning and the same disclosed simplifications (no Part Upload merge into the picker).
 *
 * Selecting Type = Labour searches DMS's own Labour Master (GET /api/bapl-dms/labour) instead of
 * the Parts list - the same fix web's RepairBillCreatePage.tsx got this round
 * (LabourSearchInput.tsx there / pickLabourForLine here), so this screen never had the old
 * Parts-only-search gap to begin with.
 */
type TaxMode = 'Same State (CGST+SGST)' | 'Different State (IGST)'
type DiscountType = 'None' | 'Percentage' | 'Amount'

type DraftItem = {
  key: number
  itemType: RepairBillDocItemType
  itemCode: string
  itemDescription: string
  hsnCode: string
  qty: string
  rate: string
  mrp: string
  gstPct: string
  discountType: DiscountType
  discountValue: string
  issueType: string
}

const rateFromMrp = (mrp: number, gstPct: number) => mrp / (1 + gstPct / 100)
const isZeroTaxIssue = (issueType: string) => issueType === 'U/W' || issueType === 'FSC'

/** Direct port of web's lineEstimate/splitGst - discount reduces the taxable amount FIRST, then
 * CGST+SGST (same state) or IGST (different state) is added on top of what's left. Deliberately
 * NOT the frozen-GST-on-discount formula Material Transfer uses (see
 * RepairBillCreatePage.tsx/RepairBillDocsController.Create's own doc comments - this was
 * previously verified against real reference source and left unchanged; see the README delivered
 * with this round for the open question on whether you want the two aligned). */
const lineEstimate = (it: DraftItem, taxMode: TaxMode, headerIssueType: string) => {
  const zeroTax = isZeroTaxIssue(it.issueType || headerIssueType)
  const qty = Number(it.qty) || 0
  const rate = Number(it.rate) || 0
  const gst = Number(it.gstPct) || 0
  const discountValue = Number(it.discountValue) || 0
  const gross = qty * rate
  const discountAmt = Math.min(it.discountType === 'Percentage' ? (gross * discountValue) / 100 : it.discountType === 'Amount' ? discountValue : 0, gross)
  const taxable = zeroTax ? 0 : gross - discountAmt
  const cgstPct = zeroTax || taxMode === 'Different State (IGST)' ? 0 : gst / 2
  const sgstPct = zeroTax || taxMode === 'Different State (IGST)' ? 0 : gst / 2
  const igstPct = zeroTax || taxMode !== 'Different State (IGST)' ? 0 : gst
  const cgstAmt = (taxable * cgstPct) / 100
  const sgstAmt = (taxable * sgstPct) / 100
  const igstAmt = (taxable * igstPct) / 100
  const tax = cgstAmt + sgstAmt + igstAmt
  return { gross, discountAmt, taxable, cgstPct, sgstPct, igstPct, cgstAmt, sgstAmt, igstAmt, tax, total: taxable + tax }
}

const splitGst = (gstPct: number, taxMode: TaxMode) =>
  taxMode === 'Different State (IGST)'
    ? { cgstPct: 0, sgstPct: 0, igstPct: gstPct }
    : { cgstPct: gstPct / 2, sgstPct: gstPct / 2, igstPct: 0 }

const emptyDraft: Omit<DraftItem, 'key'> = {
  itemType: 'Part', itemCode: '', itemDescription: '', hsnCode: '', qty: '1', rate: '0', mrp: '',
  gstPct: '18', discountType: 'None', discountValue: '0', issueType: '',
}

export function RepairBillCreateScreen() {
  const { profile, hasRole } = useStaffAuth()
  const canDelete = hasRole('SystemAdmin')

  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  useEffect(() => {
    if (!profile?.dealerId) return
    apiClient.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then(({ data }) => {
        const scoped = profile?.workLocationCodes?.length ? data.filter((w) => profile.workLocationCodes.includes(w.locCode)) : data
        setWorkshops(scoped)
        if (scoped.length > 0) setLocation((prev) => prev || scoped[0].locCode)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.dealerId, profile?.workLocationCodes])

  // ---------------- Header form ----------------
  const [jobCardId, setJobCardId] = useState<string | null>(null)
  const [jobCardNumber, setJobCardNumber] = useState('')
  const [showJobSearch, setShowJobSearch] = useState(false)
  const [partyName, setPartyName] = useState('')
  const [regNo, setRegNo] = useState('')
  const [chassisNo, setChassisNo] = useState('')
  const [location, setLocation] = useState('')
  const [billType, setBillType] = useState('Cash')
  const [issueType, setIssueType] = useState('')
  const [taxMode, setTaxMode] = useState<TaxMode>('Same State (CGST+SGST)')
  const [taxModeAuto, setTaxModeAuto] = useState(false)
  const [partyState, setPartyState] = useState<string | null>(null)
  const [billDate, setBillDate] = useState(new Date())
  const [remarks, setRemarks] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const [nextKey, setNextKey] = useState(1)
  const [saving, setSaving] = useState(false)

  const [showInsurance, setShowInsurance] = useState(false)
  const [insuranceCompanyName, setInsuranceCompanyName] = useState('')
  const [insuranceDescription, setInsuranceDescription] = useState('')
  const [surveyorName, setSurveyorName] = useState('')
  const [surveyorContactNumber, setSurveyorContactNumber] = useState('')
  const [policyNo, setPolicyNo] = useState('')
  const [insuranceValidTill, setInsuranceValidTill] = useState<Date | null>(null)
  const [zeroDepreciation, setZeroDepreciation] = useState(false)
  const [totalDiscount, setTotalDiscount] = useState('0')
  const [amountReceived, setAmountReceived] = useState('0')

  useEffect(() => {
    const dealerState = profile?.dealerState
    if (!dealerState || !partyState) { setTaxModeAuto(false); return }
    setTaxMode(dealerState.trim().toUpperCase() === partyState.trim().toUpperCase() ? 'Same State (CGST+SGST)' : 'Different State (IGST)')
    setTaxModeAuto(true)
  }, [profile?.dealerState, partyState])

  const estimatedTotal = items.reduce((sum, it) => sum + lineEstimate(it, taxMode, issueType).total, 0)
  const zeroTaxLineCount = items.filter((it) => isZeroTaxIssue(it.issueType || issueType)).length

  const openDatePicker = (current: Date, onPick: (d: Date) => void) => {
    DateTimePickerAndroid.open({
      value: current, mode: 'date',
      onChange: (_e: DateTimePickerEvent, date?: Date) => { if (date) onPick(date) },
    })
  }

  // ---------------- Part / Labour pickers ----------------
  const [dmsParts, setDmsParts] = useState<BaplDmsPartStock[]>([])
  useEffect(() => {
    if (!location) { setDmsParts([]); return }
    apiClient.get<BaplDmsPartStock[]>('/api/bapl-dms/parts', { params: { locationCode: location } })
      .then(({ data }) => setDmsParts(data))
      .catch(() => setDmsParts([]))
  }, [location])

  const [itemMasterByCode, setItemMasterByCode] = useState<Record<string, BaplItemMaster>>({})
  useEffect(() => {
    const codes = Array.from(new Set(dmsParts.map((p) => p.itemCode.trim().toUpperCase()).filter(Boolean)))
    if (codes.length === 0) { setItemMasterByCode({}); return }
    apiClient.get<BaplItemMaster[]>('/api/item-master/by-codes', { params: { codes: codes.join(',') } })
      .then(({ data }) => {
        const byCode: Record<string, BaplItemMaster> = {}
        data.forEach((im) => { byCode[im.itemCode.trim().toUpperCase()] = im })
        setItemMasterByCode(byCode)
      })
      .catch(() => setItemMasterByCode({}))
  }, [dmsParts])

  const [labours, setLabours] = useState<BaplDmsLabourRow[]>([])
  useEffect(() => {
    if (!location) { setLabours([]); return }
    const dealerCode = location.replace(/W\d+$/i, '')
    apiClient.get<BaplDmsLabourRow[]>('/api/bapl-dms/labour', { params: { dealerCode: dealerCode || undefined } })
      .then(({ data }) => setLabours(data))
      .catch(() => setLabours([]))
  }, [location])

  const [draft, setDraft] = useState<Omit<DraftItem, 'key'>>(emptyDraft)
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const partMatches = draft.itemType === 'Part' && q.length > 0
    ? dmsParts.filter((p) => p.itemCode.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)).slice(0, 20)
    : []
  const labourMatches = draft.itemType === 'Labour' && q.length > 0
    ? labours.filter((l) => l.labourCode.toLowerCase().includes(q) || (l.labourDescription ?? '').toLowerCase().includes(q)).slice(0, 20)
    : []

  const pickPart = (p: BaplDmsPartStock) => {
    const im = itemMasterByCode[p.itemCode.trim().toUpperCase()]
    const sgstPct = im?.sgst ?? 9
    const cgstPct = im?.cgst ?? 9
    const igstPct = im?.igst ?? 18
    const totalGst = sgstPct + cgstPct > 0 ? sgstPct + cgstPct : igstPct
    const dlrPrice = im?.dlrPrice ?? p.mrp ?? null
    setDraft((d) => ({
      ...d,
      itemCode: p.itemCode,
      itemDescription: p.description || p.itemCode,
      hsnCode: p.hsnCode || im?.hsnCode || '',
      mrp: dlrPrice != null ? String(dlrPrice) : '',
      rate: dlrPrice != null ? rateFromMrp(dlrPrice, totalGst).toFixed(2) : '0',
      gstPct: String(totalGst),
    }))
    setSearch(`${p.itemCode}${p.description ? ' — ' + p.description : ''}`)
  }

  /** Rate set DIRECTLY from LabourRate - a labour rate card's rate is already GST-exclusive,
   * unlike a Part's GST-inclusive Dealer Price/MRP. Direct port of web's pickLabourForLine. */
  const pickLabour = (l: BaplDmsLabourRow) => {
    const totalGst = (l.cgst ?? 0) + (l.sgst ?? 0) > 0 ? (l.cgst ?? 0) + (l.sgst ?? 0) : (l.igst ?? 18)
    setDraft((d) => ({
      ...d,
      itemCode: l.labourCode,
      itemDescription: l.labourDescription || l.labourCode,
      hsnCode: l.hsnCode || '',
      mrp: '',
      rate: l.labourRate != null ? String(l.labourRate) : '0',
      gstPct: String(totalGst),
    }))
    setSearch(`${l.labourCode}${l.labourDescription ? ' — ' + l.labourDescription : ''}`)
  }

  const addLine = () => {
    if (!draft.itemDescription.trim() || Number(draft.qty) <= 0) {
      Alert.alert('Pick a part/labour and enter a quantity first.')
      return
    }
    setItems((prev) => [...prev, { key: nextKey, ...draft, issueType: draft.issueType || issueType }])
    setNextKey((k) => k + 1)
    setDraft(emptyDraft)
    setSearch('')
  }
  const removeLine = (key: number) => setItems((prev) => prev.filter((i) => i.key !== key))

  const selectJob = (job: JobSearchResult) => {
    setJobCardId(job.id)
    setJobCardNumber(job.jobCardNumber)
    if (job.partyName) setPartyName(job.partyName)
    if (job.regNo) setRegNo(job.regNo)
    if (job.chassisNo) setChassisNo(job.chassisNo)
    if (job.locationCode) setLocation(job.locationCode)
    setPartyState(job.partyState ?? null)
    setShowJobSearch(false)
  }
  const clearJob = () => { setJobCardId(null); setJobCardNumber(''); setPartyState(null) }

  const save = () => {
    if (!partyName.trim()) { Alert.alert('Party Name is required.'); return }
    if (items.length === 0) { Alert.alert('Add at least one item/labour line first.'); return }
    setSaving(true)
    apiClient
      .post('/api/repair-bill-docs', {
        jobCardId: jobCardId || null,
        partyName: partyName.trim(),
        regNo: regNo || null,
        chassisNo: chassisNo || null,
        location: location || null,
        billType: billType || null,
        issueType: issueType || null,
        remarks: remarks || null,
        billDate: billDate.toISOString().slice(0, 10),
        insuranceCompanyName: insuranceCompanyName || null,
        insuranceDescription: insuranceDescription || null,
        surveyorName: surveyorName || null,
        surveyorContactNumber: surveyorContactNumber || null,
        policyNo: policyNo || null,
        insuranceValidTill: insuranceValidTill ? insuranceValidTill.toISOString().slice(0, 10) : null,
        zeroDepreciation,
        totalDiscount: Number(totalDiscount) || 0,
        amountReceived: Number(amountReceived) || 0,
        items: items.map((i) => {
          const { cgstPct, sgstPct, igstPct } = splitGst(Number(i.gstPct) || 0, taxMode)
          return {
            itemType: i.itemType,
            itemCode: i.itemCode || i.itemDescription.slice(0, 30),
            itemDescription: i.itemDescription,
            hsnCode: i.hsnCode || null,
            issueType: i.issueType || null,
            qty: Number(i.qty) || 0,
            rate: Number(i.rate) || 0,
            cgstPct, sgstPct, igstPct,
            discountType: i.discountType === 'None' ? null : i.discountType,
            discountValue: Number(i.discountValue) || 0,
          }
        }),
      })
      .then((r) => {
        Alert.alert('Saved', `Saved as ${r.data.billNumber}.`)
        clearJob()
        setPartyName(''); setRegNo(''); setChassisNo(''); setBillType('Cash'); setIssueType(''); setRemarks('')
        setInsuranceCompanyName(''); setInsuranceDescription(''); setSurveyorName(''); setSurveyorContactNumber('')
        setPolicyNo(''); setInsuranceValidTill(null); setZeroDepreciation(false); setTotalDiscount('0'); setAmountReceived('0')
        setItems([])
        loadCombined()
      })
      .catch((err) => Alert.alert('Could not save', err?.response?.data?.message ?? 'Could not save the repair bill.'))
      .finally(() => setSaving(false))
  }

  // ---------------- Combined list ----------------
  const [party, setParty] = useState('')
  const [rows, setRows] = useState<CombinedRepairBillRow[]>([])
  const [dmsError, setDmsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadCombined = () => {
    setLoading(true)
    apiClient
      .get<{ rows: CombinedRepairBillRow[]; dmsBaplDataError: string | null }>('/api/repair-bill-docs/combined', { params: { party: party || undefined } })
      .then((r) => { setRows(r.data.rows); setDmsError(r.data.dmsBaplDataError) })
      .catch(() => { setRows([]); setDmsError('Could not load the combined list.') })
      .finally(() => setLoading(false))
  }
  useEffect(loadCombined, []) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteBill = (id: string) => {
    Alert.alert('Delete this repair bill?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => apiClient.delete(`/api/repair-bill-docs/${id}`).then(loadCombined).catch((err) => Alert.alert('Could not delete', err?.response?.data?.message ?? 'Could not delete the repair bill.')) },
    ])
  }

  return (
    <ScrollView style={styles.screen} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={loadCombined} />}>
      <Text style={styles.sectionTitle}>New Repair Bill</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Job No</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput style={[styles.input, { flex: 1 }]} value={jobCardNumber} editable={false} placeholder="No job linked" />
          <TouchableOpacity style={styles.smallBtn} onPress={() => setShowJobSearch(true)}><Text style={styles.smallBtnText}>Search</Text></TouchableOpacity>
          {!!jobCardId && <TouchableOpacity style={styles.smallBtn} onPress={clearJob}><Text style={styles.smallBtnText}>✕</Text></TouchableOpacity>}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Party Name *</Text>
        <TextInput style={styles.input} value={partyName} onChangeText={setPartyName} placeholder="Customer or fleet party name" />
      </View>
      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Reg No</Text>
          <TextInput style={styles.input} value={regNo} onChangeText={setRegNo} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Chassis No</Text>
          <TextInput style={styles.input} value={chassisNo} onChangeText={setChassisNo} />
        </View>
      </View>

      <PickerField label="Location" value={location} onChange={setLocation} options={workshops.map((w) => ({ label: `${w.locCode} — ${w.locName}`, value: w.locCode }))} placeholder="Select workshop" />

      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Bill Type</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {(['Cash', 'Credit', 'Warranty'] as const).map((t) => (
              <TouchableOpacity key={t} style={[styles.pill, billType === t && styles.pillSelected]} onPress={() => setBillType(t)}>
                <Text style={[styles.pillText, billType === t && styles.pillTextSelected]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Issue Type (default for new lines)</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {(['', 'Paid', 'U/W', 'FSC'] as const).map((t) => (
            <TouchableOpacity key={t || 'none'} style={[styles.pill, issueType === t && styles.pillSelected]} onPress={() => setIssueType(t)}>
              <Text style={[styles.pillText, issueType === t && styles.pillTextSelected]}>{t || 'none'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Tax Type{taxModeAuto ? ' (auto-detected)' : ''}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(['Same State (CGST+SGST)', 'Different State (IGST)'] as const).map((t) => (
            <TouchableOpacity key={t} style={[styles.pill, taxMode === t && styles.pillSelected]} onPress={() => { setTaxMode(t); setTaxModeAuto(false) }}>
              <Text style={[styles.pillText, taxMode === t && styles.pillTextSelected]}>{t === 'Same State (CGST+SGST)' ? 'Same State' : 'Different State'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Bill Date</Text>
        <TouchableOpacity style={styles.input} onPress={() => openDatePicker(billDate, setBillDate)}><Text>{billDate.toLocaleDateString('en-IN')}</Text></TouchableOpacity>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Remarks</Text>
        <TextInput style={styles.input} value={remarks} onChangeText={setRemarks} />
      </View>

      <TouchableOpacity style={styles.smallBtn} onPress={() => setShowInsurance((v) => !v)}>
        <Text style={styles.smallBtnText}>{showInsurance ? '− Hide' : '+ Add'} Insurance / Discount / Payment Details</Text>
      </TouchableOpacity>
      {showInsurance && (
        <View style={{ marginTop: 10 }}>
          <View style={styles.field}><Text style={styles.label}>Insurance Company</Text><TextInput style={styles.input} value={insuranceCompanyName} onChangeText={setInsuranceCompanyName} /></View>
          <View style={styles.field}><Text style={styles.label}>Claim Description</Text><TextInput style={styles.input} value={insuranceDescription} onChangeText={setInsuranceDescription} /></View>
          <View style={styles.field}><Text style={styles.label}>Policy No</Text><TextInput style={styles.input} value={policyNo} onChangeText={setPolicyNo} /></View>
          <View style={styles.field}>
            <Text style={styles.label}>Insurance Valid Till</Text>
            <TouchableOpacity style={styles.input} onPress={() => openDatePicker(insuranceValidTill ?? new Date(), setInsuranceValidTill)}><Text>{insuranceValidTill ? insuranceValidTill.toLocaleDateString('en-IN') : 'Select date'}</Text></TouchableOpacity>
          </View>
          <View style={styles.field}><Text style={styles.label}>Surveyor Name</Text><TextInput style={styles.input} value={surveyorName} onChangeText={setSurveyorName} /></View>
          <View style={styles.field}><Text style={styles.label}>Surveyor Contact No</Text><TextInput style={styles.input} value={surveyorContactNumber} onChangeText={setSurveyorContactNumber} keyboardType="phone-pad" /></View>
          <View style={styles.formRow}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Total Discount (₹)</Text><TextInput style={styles.input} value={totalDiscount} onChangeText={setTotalDiscount} keyboardType="numeric" /></View>
            <View style={{ flex: 1 }}><Text style={styles.label}>Amount Received (₹)</Text><TextInput style={styles.input} value={amountReceived} onChangeText={setAmountReceived} keyboardType="numeric" /></View>
          </View>
          <TouchableOpacity style={[styles.pill, zeroDepreciation && styles.pillSelected, { alignSelf: 'flex-start', marginBottom: 10 }]} onPress={() => setZeroDepreciation((v) => !v)}>
            <Text style={[styles.pillText, zeroDepreciation && styles.pillTextSelected]}>{zeroDepreciation ? '✓ ' : ''}Zero Depreciation</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ---------------- Add item/labour ---------------- */}
      <Text style={styles.subheading}>Add Item / Labour</Text>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
        {(['Part', 'Labour'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.pill, draft.itemType === t && styles.pillSelected]} onPress={() => { setDraft((d) => ({ ...emptyDraft, itemType: t })); setSearch('') }}>
            <Text style={[styles.pillText, draft.itemType === t && styles.pillTextSelected]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!location && <Text style={styles.muted}>Select a Location above to search {draft.itemType === 'Labour' ? 'labour codes' : 'parts'}.</Text>}
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        editable={!!location}
        placeholder={draft.itemType === 'Labour' ? 'Search labour code or description…' : 'Search item code or description…'}
      />
      {(partMatches.length > 0 || labourMatches.length > 0) && (
        <View style={styles.pickerBox}>
          {partMatches.map((p) => (
            <TouchableOpacity key={p.itemCode} style={styles.pickerRow} onPress={() => pickPart(p)}>
              <Text style={styles.pickerRowText}><Text style={{ fontWeight: '700' }}>{p.itemCode}</Text>{p.description ? ` — ${p.description}` : ''}</Text>
            </TouchableOpacity>
          ))}
          {labourMatches.map((l) => (
            <TouchableOpacity key={l.id} style={styles.pickerRow} onPress={() => pickLabour(l)}>
              <Text style={styles.pickerRowText}><Text style={{ fontWeight: '700' }}>{l.labourCode}</Text>{l.labourDescription ? ` — ${l.labourDescription}` : ''} (₹{l.labourRate ?? '—'})</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!!draft.itemCode && (
        <View style={styles.draftCard}>
          <Text style={styles.rowTitle}>{draft.itemCode} — {draft.itemDescription}</Text>
          <Text style={styles.muted}>HSN {draft.hsnCode || '—'} · {draft.mrp ? `MRP ₹${draft.mrp} · ` : ''}GST {draft.gstPct}%</Text>

          <View style={styles.formRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Qty</Text>
              <TextInput style={styles.input} value={draft.qty} onChangeText={(v) => setDraft((d) => ({ ...d, qty: v }))} keyboardType="numeric" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Rate</Text>
              <TextInput style={styles.input} value={draft.rate} onChangeText={(v) => setDraft((d) => ({ ...d, rate: v }))} keyboardType="numeric" />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Issue Type (this line)</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {(['', 'Paid', 'U/W', 'FSC'] as const).map((t) => (
                <TouchableOpacity key={t || 'default'} style={[styles.pill, draft.issueType === t && styles.pillSelected]} onPress={() => setDraft((d) => ({ ...d, issueType: t }))}>
                  <Text style={[styles.pillText, draft.issueType === t && styles.pillTextSelected]}>{t || `default (${issueType || 'none'})`}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.formRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Discount Type</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['None', 'Percentage', 'Amount'] as const).map((t) => (
                  <TouchableOpacity key={t} style={[styles.pill, draft.discountType === t && styles.pillSelected]} onPress={() => setDraft((d) => ({ ...d, discountType: t }))}>
                    <Text style={[styles.pillText, draft.discountType === t && styles.pillTextSelected]}>{t === 'Percentage' ? '%' : t === 'Amount' ? '₹' : 'None'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Discount Value</Text>
              <TextInput style={styles.input} value={draft.discountValue} onChangeText={(v) => setDraft((d) => ({ ...d, discountValue: v }))} keyboardType="numeric" editable={draft.discountType !== 'None'} />
            </View>
          </View>

          {(() => {
            const est = lineEstimate(draft as DraftItem, taxMode, issueType)
            return (
              <Text style={styles.muted}>
                Taxable ₹{est.taxable.toFixed(2)} · CGST ₹{est.cgstAmt.toFixed(2)} · SGST ₹{est.sgstAmt.toFixed(2)} · IGST ₹{est.igstAmt.toFixed(2)} · Total ₹{est.total.toFixed(2)}
              </Text>
            )
          })()}

          <TouchableOpacity style={styles.addBtn} onPress={addLine}><Text style={styles.addBtnText}>+ Add Line</Text></TouchableOpacity>
        </View>
      )}

      {items.length > 0 && <Text style={styles.subheading}>Lines ({items.length})</Text>}
      {items.map((it) => {
        const est = lineEstimate(it, taxMode, issueType)
        return (
          <View key={it.key} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>[{it.itemType}] {it.itemCode} — {it.itemDescription}</Text>
              <Text style={styles.muted}>Qty {it.qty} × ₹{it.rate} · {it.issueType || 'default'}{it.discountType !== 'None' ? ` · Disc ${it.discountValue}${it.discountType === 'Percentage' ? '%' : '₹'}` : ''}</Text>
              <Text style={styles.muted}>Taxable ₹{est.taxable.toFixed(2)} · CGST ₹{est.cgstAmt.toFixed(2)} · SGST ₹{est.sgstAmt.toFixed(2)} · IGST ₹{est.igstAmt.toFixed(2)} · Total ₹{est.total.toFixed(2)}</Text>
            </View>
            <TouchableOpacity style={styles.removeBtn} onPress={() => removeLine(it.key)}><Text style={styles.removeBtnText}>Remove</Text></TouchableOpacity>
          </View>
        )
      })}

      <Text style={styles.muted}>{zeroTaxLineCount > 0 ? `${zeroTaxLineCount} zero-tax line(s) - ` : ''}Estimated Total: ₹{estimatedTotal.toFixed(2)}</Text>
      <Text style={styles.total}>{' '}</Text>

      <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnDisabled]} disabled={saving} onPress={save}>
        <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Repair Bill'}</Text>
      </TouchableOpacity>

      {/* ---------------- Combined list ---------------- */}
      <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Repair Bills</Text>
      <View style={styles.field}>
        <Text style={styles.label}>Filter DMSBAPLDATA rows by Party Name</Text>
        <TextInput style={styles.input} value={party} onChangeText={setParty} onSubmitEditing={loadCombined} placeholder="e.g. Zomato" />
      </View>
      <TouchableOpacity style={styles.smallBtn} onPress={loadCombined}><Text style={styles.smallBtnText}>{loading ? 'Loading…' : 'Search'}</Text></TouchableOpacity>
      {dmsError && <Text style={styles.error}>DMSBAPLDATA rows unavailable: {dmsError}</Text>}
      {loading && <ActivityIndicator style={{ marginVertical: 8 }} color={colors.primary} />}

      {rows.map((r) => (
        <TouchableOpacity key={r.id} style={styles.row} onPress={() => setExpandedId(expandedId === r.id ? null : r.id)}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Text style={[styles.badge, r.source === 'JobCardScanner' ? styles.badgeSuccess : styles.badgeMuted]}>{r.source}</Text>
              <Text style={styles.rowTitle}>{r.billNumber}</Text>
            </View>
            <Text style={styles.muted}>{r.sortDate ? new Date(r.sortDate).toLocaleDateString('en-IN') : '—'} · {r.location ?? '—'} · {r.billType ?? '—'}</Text>
            <Text style={styles.muted}>{r.partyName ?? '—'} · {r.status ?? '—'} · {r.itemCount} item(s) · ₹{r.totalAmount.toFixed(2)}</Text>
            {expandedId === r.id && (r.items ?? []).map((it, i) => (
              <Text key={i} style={styles.muted}>
                • {String(it.itemCode ?? it.itemIdno ?? '—')} — {String(it.itemDescription ?? it.itemDesc ?? '—')} · qty {String(it.qty ?? '—')} · rate ₹{String(it.rate ?? '—')}
              </Text>
            ))}
          </View>
          {canDelete && r.source === 'JobCardScanner' && (
            <TouchableOpacity style={styles.removeBtn} onPress={(e) => { e.stopPropagation(); deleteBill(r.id) }}><Text style={styles.removeBtnText}>Delete</Text></TouchableOpacity>
          )}
        </TouchableOpacity>
      ))}
      {rows.length === 0 && !loading && <Text style={styles.muted}>No repair bills yet.</Text>}

      <JobSearchModal visible={showJobSearch} onSelect={selectJob} onClose={() => setShowJobSearch(false)} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 },
  subheading: { fontWeight: '600', marginTop: 14, marginBottom: 6, color: colors.text },
  field: { marginBottom: 10 },
  formRow: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  error: { fontSize: 12, color: colors.danger, marginTop: 4, marginBottom: 4 },
  total: { fontWeight: '700', color: colors.text, marginTop: 4, marginBottom: 10 },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  pillSelected: { backgroundColor: colors.navy, borderColor: colors.navy },
  pillText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  pillTextSelected: { color: '#fff' },
  smallBtn: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, alignSelf: 'flex-start', marginBottom: 10 },
  smallBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
  pickerBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, maxHeight: 220, marginTop: 6, marginBottom: 8 },
  pickerRow: { paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  pickerRowText: { color: colors.text },
  draftCard: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 6, marginBottom: 10 },
  rowTitle: { fontWeight: '700', color: colors.text },
  addBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  addBtnText: { color: '#fff', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  removeBtn: { backgroundColor: colors.danger, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  removeBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  saveBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginBottom: 10 },
  saveBtnDisabled: { backgroundColor: '#93c5fd' },
  saveBtnText: { color: '#fff', fontWeight: '700' },
  badge: { fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  badgeSuccess: { backgroundColor: colors.successSoft, color: colors.success },
  badgeMuted: { backgroundColor: colors.bg, color: colors.textMuted },
})
