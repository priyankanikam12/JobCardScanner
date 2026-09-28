// mobile\src\screens\MaterialTransferCreateScreen.tsx
import { useEffect, useState } from 'react'
import { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { JobSearchModal } from '../components/JobSearchModal'
import { PartwiseLabourModal, type PartwiseLabourPick } from '../components/PartwiseLabourModal'
import { PickerField } from '../components/PickerField'
import { colors } from '../theme/colors'
import type { BaplDmsPartStock, BaplDmsWorkshop, BaplItemMaster, CombinedMaterialTransferRow, JobSearchResult, MaterialTransferDocItemType, MaterialTransferDocType } from '../types'

/**
 * "Material Transfer Bill" screen (2026-09-21, "add changes in android also") - the Android
 * counterpart to web/src/pages/staff/MaterialTransferCreatePage.tsx, posting to the SAME backend
 * endpoint (POST/GET /api/material-transfer-docs...) - no backend change was needed for this
 * round, only this new screen. See that web page's own doc comment for the full history of this
 * feature; this screen reproduces its calculation logic exactly (lineCalc below is a direct,
 * unchanged port) but trades the web grid for a phone-friendly "add one line at a time" flow,
 * since a wide spreadsheet-style grid doesn't fit a phone screen - each added line becomes a card
 * in a list instead, the same pattern PartSuggestionSection.tsx/LabourSuggestionSection.tsx
 * already use elsewhere in this app (search box -> pick -> fill in qty/discount -> "Add Line").
 *
 * Deliberately simplified vs. web for this round: no "Part Upload" merge into the Item Code
 * picker (mobile has no Part Upload screen to manage/see the effect of the balance-quantity
 * decrement that merge drives - see MaterialTransferDocsController.Create's own doc comment on the
 * backend) - only live DMS PartsInventory is searched here. The backend's own PartUploads.BalQty
 * decrement still runs automatically server-side if a picked/typed Item Code happens to match a
 * Part Upload row at this Location, exactly as it does from web - this is a picker-display
 * simplification only, not a calculation change. Rack No/Bin/Serial No/Valid Days/Received are not
 * collected here either (web already hides these from its own grid too, per your own request -
 * see that page's doc comment - they are simply sent as null, same as a web line that never used
 * them).
 *
 * 2026-09-22 ("then from /labour-master ... add Labour Code also that was wants to integrate in
 * material transfer which in video ... give proper code like vide functionality in mobile and for
 * web both give proper"): once a Part line has been added (+ Add Line), its card in the "Lines"
 * list gets its own "+ Labour" button - opens PartwiseLabourModal scoped to that line's Item Code
 * (Part Code only match, per the AskUserQuestion answer), and any picks become new Labour-type
 * lines appended right after it, carrying that Part line's own Issue Type (governs, captured at
 * add-time - mobile's existing "Lines" list has never allowed editing an added line in place, only
 * Remove, so there is no later divergence to cascade-guard against, unlike web's editable grid).
 * Removing a Part line cascades to remove its Labour children too (see removeLine below) - a
 * Labour line has no meaning once its governing Part line is gone.
 */
type DiscountType = '%' | 'Value'

type DraftItem = {
  key: number
  itemCode: string
  itemDescription: string
  hsnCode: string
  qty: string
  rate: string
  mrp: string
  sgstPct: string
  cgstPct: string
  igstPct: string
  discountType: DiscountType
  discountValue: string
  issueType: string
  /** 2026-09-22: 'Part' for every line this screen has always added via the search/draft flow;
   * 'Labour' for a line staged via the new "+ Labour" button/PartwiseLabourModal. Mirrors
   * MaterialTransferDocItemType on the backend. */
  itemType: MaterialTransferDocItemType
  /** Set only on a 'Labour' line - the key of the Part line it was added from (see module doc
   * comment). Null for every 'Part' line. */
  sourcePartKey: number | null
}

/** "Rate = Dlr_Price - GST%" - reverse-calculates the GST-exclusive per-unit Rate out of
 * C_ItemMaster's GST-INCLUSIVE Dlr_Price. Direct port of web's rateFromDlrPrice. */
const rateFromDlrPrice = (dlrPrice: number, totalGstPct: number) => dlrPrice / (1 + totalGstPct / 100)

/** Direct port of web's lineCalc - see that function's doc comment in
 * web/src/pages/staff/MaterialTransferCreatePage.tsx for the full worked-example reasoning
 * (frozen GST-on-discount: discount reduces Rate only, the GST rupee amount added back stays the
 * ORIGINAL amount computed on the undiscounted Rate, MRP never moves). */
const lineCalc = (it: DraftItem) => {
  const qty = Number(it.qty) || 0
  const rate = Number(it.rate) || 0
  const sgstPct = Number(it.sgstPct) || 0
  const cgstPct = Number(it.cgstPct) || 0
  const igstPct = Number(it.igstPct) || 0
  const totalGstPct = sgstPct + cgstPct > 0 ? sgstPct + cgstPct : igstPct

  const originalBase = qty * rate
  const originalGstAmt = (originalBase * totalGstPct) / 100

  const discPct = it.discountType === '%' ? Number(it.discountValue) || 0 : 0
  const discVal = it.discountType === 'Value' ? Number(it.discountValue) || 0 : 0
  const discountedRate = Math.max(0, it.discountType === '%' ? rate * (1 - discPct / 100) : rate - discVal)
  const discountedBase = qty * discountedRate

  const amount = discountedBase + originalGstAmt
  const mrp = rate + (rate * totalGstPct) / 100

  return { qty, rate, discountedRate, originalBase, discountedBase, originalGstAmt, amount, mrp, sgstPct, cgstPct, igstPct }
}

/** Direct port of web's lineTax - display-only CGST/SGST/IGST split of a line's frozen GST amount. */
const lineTax = (it: DraftItem, isSameState: boolean) => {
  const calc = lineCalc(it)
  if (!isSameState) {
    return { cgstPct: 0, sgstPct: 0, igstPct: calc.igstPct, cgstAmt: 0, sgstAmt: 0, igstAmt: calc.originalGstAmt }
  }
  const pairTotal = calc.cgstPct + calc.sgstPct
  const cgstAmt = pairTotal > 0 ? (calc.originalGstAmt * calc.cgstPct) / pairTotal : calc.originalGstAmt / 2
  const sgstAmt = pairTotal > 0 ? (calc.originalGstAmt * calc.sgstPct) / pairTotal : calc.originalGstAmt / 2
  return { cgstPct: calc.cgstPct, sgstPct: calc.sgstPct, igstPct: 0, cgstAmt, sgstAmt, igstAmt: 0 }
}

const emptyDraft: Omit<DraftItem, 'key'> = {
  itemCode: '', itemDescription: '', hsnCode: '', qty: '1', rate: '0', mrp: '',
  sgstPct: '9', cgstPct: '9', igstPct: '18', discountType: '%', discountValue: '0', issueType: '',
  itemType: 'Part', sourcePartKey: null,
}

export function MaterialTransferCreateScreen() {
  const { profile } = useStaffAuth()

  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  useEffect(() => {
    if (!profile?.dealerId) return
    apiClient.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then(({ data }) => {
        const scoped = profile?.workLocationCodes?.length ? data.filter((w) => profile.workLocationCodes.includes(w.locCode)) : data
        setWorkshops(scoped)
        if (scoped.length > 0) { setLocation((prev) => prev || scoped[0].locCode); setLocCode((prev) => prev || scoped[0].locCode) }
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.dealerId, profile?.workLocationCodes])

  // ---------------- Header form ----------------
  const [jobCardId, setJobCardId] = useState<string | null>(null)
  const [jobCardNumber, setJobCardNumber] = useState('')
  const [showJobSearch, setShowJobSearch] = useState(false)
  const [location, setLocation] = useState('')
  const [transferType, setTransferType] = useState<MaterialTransferDocType>('Issue')
  const [partyName, setPartyName] = useState('')
  const [transferDate, setTransferDate] = useState(new Date())
  const [remarks, setRemarks] = useState('')
  const [partyState, setPartyState] = useState<string | null>(null)
  const [items, setItems] = useState<DraftItem[]>([])
  const [nextKey, setNextKey] = useState(1)
  const [saving, setSaving] = useState(false)

  // Same "default to Same State" interpretation as web (Material Transfer moves the dealer's own
  // stock internally, so it defaults to the dealer's own state on both sides unless a linked job's
  // customer proves otherwise) - see that page's own doc comment for the disclosed reasoning.
  const isSameState = profile?.dealerState && partyState
    ? profile.dealerState.trim().toUpperCase() === partyState.trim().toUpperCase()
    : true

  const estimatedTotal = items.reduce((sum, it) => sum + lineCalc(it).amount, 0)

  const openDatePicker = (current: Date, onPick: (d: Date) => void) => {
    DateTimePickerAndroid.open({
      value: current, mode: 'date',
      onChange: (_e: DateTimePickerEvent, date?: Date) => { if (date) onPick(date) },
    })
  }

  // ---------------- Item picker ----------------
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

  const [draft, setDraft] = useState<Omit<DraftItem, 'key'>>(emptyDraft)
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const matches = q.length === 0 ? [] : dmsParts.filter((p) => p.itemCode.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)).slice(0, 20)

  const pickPart = (p: BaplDmsPartStock) => {
    const im = itemMasterByCode[p.itemCode.trim().toUpperCase()]
    const sgstPct = im?.sgst ?? 9
    const cgstPct = im?.cgst ?? 9
    const igstPct = im?.igst ?? 18
    const totalGst = sgstPct + cgstPct > 0 ? sgstPct + cgstPct : igstPct
    const dlrPrice = im?.dlrPrice ?? p.mrp ?? null
    setDraft({
      ...emptyDraft,
      itemCode: p.itemCode,
      itemDescription: p.description || p.itemCode,
      hsnCode: p.hsnCode || im?.hsnCode || '',
      mrp: dlrPrice != null ? String(dlrPrice) : '',
      rate: dlrPrice != null ? rateFromDlrPrice(dlrPrice, totalGst).toFixed(2) : '0',
      sgstPct: String(sgstPct), cgstPct: String(cgstPct), igstPct: String(igstPct),
    })
    setSearch(`${p.itemCode}${p.description ? ' — ' + p.description : ''}`)
  }

  const addLine = () => {
    if (!draft.itemDescription.trim() || Number(draft.qty) <= 0) {
      Alert.alert('Pick an item and enter a quantity first.')
      return
    }
    setItems((prev) => [...prev, { key: nextKey, ...draft }])
    setNextKey((k) => k + 1)
    setDraft(emptyDraft)
    setSearch('')
  }
  // 2026-09-22: cascade-removes any Labour lines added FROM this line (sourcePartKey === key) -
  // see module doc comment. A Labour line by itself is also just removed directly (it has no
  // children of its own).
  const removeLine = (key: number) => setItems((prev) => prev.filter((i) => i.key !== key && i.sourcePartKey !== key))

  // ---------------- Labour picker ("+ Labour" on an already-added Part line) ----------------
  const [labourModalFor, setLabourModalFor] = useState<DraftItem | null>(null)
  const handleLabourProceed = (picks: PartwiseLabourPick[]) => {
    if (!labourModalFor) return
    const parentKey = labourModalFor.key
    const parentIssueType = labourModalFor.issueType
    let key = nextKey
    const newLines: DraftItem[] = picks.map((p) => {
      // LabourMasterPartwise stores IGST/CGST/SGST as a plain decimal fraction (0.18 = 18%) -
      // converted to the same percentage-string shape this screen's own sgstPct/cgstPct/igstPct
      // already use for a Part line's GST, same convention the web component uses.
      const sgstPct = p.sgst != null ? p.sgst * 100 : 9
      const cgstPct = p.cgst != null ? p.cgst * 100 : 9
      const igstPct = p.igst != null ? p.igst * 100 : 18
      const totalGstPct = sgstPct + cgstPct > 0 ? sgstPct + cgstPct : igstPct
      const rate = p.labourRate ?? 0
      const line: DraftItem = {
        ...emptyDraft,
        key,
        itemType: 'Labour',
        sourcePartKey: parentKey,
        itemCode: p.labourCode,
        itemDescription: p.jobDescription || p.labourCode,
        rate: String(rate),
        mrp: (rate * (1 + totalGstPct / 100)).toFixed(2),
        sgstPct: String(sgstPct),
        cgstPct: String(cgstPct),
        igstPct: String(igstPct),
        issueType: parentIssueType,
      }
      key += 1
      return line
    })
    setItems((prev) => {
      // Insert right after the parent Part line, matching the module doc comment ("appended right
      // after it") - a plain append to the end would separate a Labour line from the Part line it
      // belongs to once several Part lines exist.
      const idx = prev.findIndex((i) => i.key === parentKey)
      if (idx < 0) return [...prev, ...newLines]
      return [...prev.slice(0, idx + 1), ...newLines, ...prev.slice(idx + 1)]
    })
    setNextKey(key)
    setLabourModalFor(null)
  }

  const selectJob = (job: JobSearchResult) => {
    setJobCardId(job.id)
    setJobCardNumber(job.jobCardNumber)
    if (job.partyName) setPartyName(job.partyName)
    if (job.locationCode) setLocation(job.locationCode)
    setPartyState(job.partyState ?? null)
    setShowJobSearch(false)
  }
  const clearJob = () => { setJobCardId(null); setJobCardNumber(''); setPartyState(null) }

  const save = () => {
    if (items.length === 0) { Alert.alert('Add at least one item line first.'); return }
    setSaving(true)
    apiClient
      .post('/api/material-transfer-docs', {
        jobCardId: jobCardId || null,
        location: location || null,
        transferType,
        issueType: null,
        partyName: partyName || null,
        remarks: remarks || null,
        transferDate: transferDate.toISOString().slice(0, 10),
        items: items.map((i) => ({
          itemCode: i.itemCode || i.itemDescription.slice(0, 30),
          itemDescription: i.itemDescription,
          hsnCode: i.hsnCode || null,
          issueType: i.issueType || null,
          // 2026-09-22 (Labour-in-Material-Transfer integration) - see MaterialTransferDocItemType's
          // own doc comment on the backend for why a Labour line never touches PartUploads stock.
          // technicianId stays null - same disclosed gap as the web page's own header Technician field.
          itemType: i.itemType,
          technicianId: null,
          qty: Number(i.qty) || 0,
          rate: Number(lineCalc(i).discountedRate.toFixed(2)),
          rackNo: null, bin: null, serialNo: null,
          mrp: i.mrp ? Number(i.mrp) : null,
          validDays: null, itemReceived: null,
        })),
      })
      .then((r) => {
        Alert.alert('Saved', `Saved as ${r.data.transferNumber}.`)
        clearJob()
        setPartyName(''); setRemarks(''); setItems([])
        loadCombined()
      })
      .catch((err) => Alert.alert('Could not save', err?.response?.data?.message ?? 'Could not save the material transfer.'))
      .finally(() => setSaving(false))
  }

  // ---------------- Combined list ----------------
  const [locCode, setLocCode] = useState('')
  const [rows, setRows] = useState<CombinedMaterialTransferRow[]>([])
  const [dmsError, setDmsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadCombined = () => {
    setLoading(true)
    apiClient
      .get<{ rows: CombinedMaterialTransferRow[]; dmsBaplDataError: string | null }>('/api/material-transfer-docs/combined', { params: { locCode: locCode || undefined } })
      .then((r) => { setRows(r.data.rows); setDmsError(r.data.dmsBaplDataError) })
      .catch(() => { setRows([]); setDmsError('Could not load the combined list.') })
      .finally(() => setLoading(false))
  }
  useEffect(loadCombined, [locCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteTransfer = (id: string) => {
    Alert.alert('Delete this material transfer?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => apiClient.delete(`/api/material-transfer-docs/${id}`).then(loadCombined).catch((err) => Alert.alert('Could not delete', err?.response?.data?.message ?? 'Could not delete the material transfer.')) },
    ])
  }

  return (
    <ScrollView style={styles.screen} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={loadCombined} />}>
      <Text style={styles.sectionTitle}>New Material Transfer</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Job No</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput style={[styles.input, { flex: 1 }]} value={jobCardNumber} editable={false} placeholder="No job linked" />
          <TouchableOpacity style={styles.smallBtn} onPress={() => setShowJobSearch(true)}><Text style={styles.smallBtnText}>Search</Text></TouchableOpacity>
          {!!jobCardId && <TouchableOpacity style={styles.smallBtn} onPress={clearJob}><Text style={styles.smallBtnText}>✕</Text></TouchableOpacity>}
        </View>
      </View>

      <PickerField label="Location" value={location} onChange={setLocation} options={workshops.map((w) => ({ label: `${w.locCode} — ${w.locName}`, value: w.locCode }))} placeholder="Select workshop" />

      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Transfer Type</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['Issue', 'Return'] as const).map((t) => (
              <TouchableOpacity key={t} style={[styles.pill, transferType === t && styles.pillSelected]} onPress={() => setTransferType(t)}>
                <Text style={[styles.pillText, transferType === t && styles.pillTextSelected]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>To / From (Party)</Text>
        <TextInput style={styles.input} value={partyName} onChangeText={setPartyName} placeholder="Technician or source location" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Transfer Date</Text>
        <TouchableOpacity style={styles.input} onPress={() => openDatePicker(transferDate, setTransferDate)}>
          <Text>{transferDate.toLocaleDateString('en-IN')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Remarks</Text>
        <TextInput style={styles.input} value={remarks} onChangeText={setRemarks} />
      </View>

      {/* ---------------- Add item ---------------- */}
      <Text style={styles.subheading}>Add Item</Text>
      {!location && <Text style={styles.muted}>Select a Location above to search parts.</Text>}
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        editable={!!location}
        placeholder="Search item code or description…"
      />
      {q.length > 0 && matches.length > 0 && (
        <View style={styles.pickerBox}>
          {matches.map((p) => (
            <TouchableOpacity key={p.itemCode} style={styles.pickerRow} onPress={() => pickPart(p)}>
              <Text style={styles.pickerRowText}><Text style={{ fontWeight: '700' }}>{p.itemCode}</Text>{p.description ? ` — ${p.description}` : ''}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!!draft.itemCode && (
        <View style={styles.draftCard}>
          <Text style={styles.rowTitle}>{draft.itemCode} — {draft.itemDescription}</Text>
          <Text style={styles.muted}>HSN {draft.hsnCode || '—'} · MRP {draft.mrp ? `₹${draft.mrp}` : '—'} · SGST {draft.sgstPct}% CGST {draft.cgstPct}% IGST {draft.igstPct}%</Text>

          <View style={styles.formRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Qty</Text>
              <TextInput style={styles.input} value={draft.qty} onChangeText={(v) => setDraft((d) => ({ ...d, qty: v }))} keyboardType="numeric" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Rate (excl. GST)</Text>
              <TextInput style={styles.input} value={draft.rate} onChangeText={(v) => setDraft((d) => ({ ...d, rate: v }))} keyboardType="numeric" />
            </View>
          </View>

          <View style={styles.formRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Issue Type</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['Paid', 'U/W'] as const).map((t) => (
                  <TouchableOpacity key={t} style={[styles.pill, draft.issueType === t && styles.pillSelected]} onPress={() => setDraft((d) => ({ ...d, issueType: t }))}>
                    <Text style={[styles.pillText, draft.issueType === t && styles.pillTextSelected]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.formRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Discount Type</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['%', 'Value'] as const).map((t) => (
                  <TouchableOpacity key={t} style={[styles.pill, draft.discountType === t && styles.pillSelected]} onPress={() => setDraft((d) => ({ ...d, discountType: t }))}>
                    <Text style={[styles.pillText, draft.discountType === t && styles.pillTextSelected]}>{t === '%' ? '%' : '₹'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Discount Value</Text>
              <TextInput style={styles.input} value={draft.discountValue} onChangeText={(v) => setDraft((d) => ({ ...d, discountValue: v }))} keyboardType="numeric" />
            </View>
          </View>

          {(() => {
            const calc = lineCalc(draft as DraftItem)
            const tax = lineTax(draft as DraftItem, isSameState)
            return (
              <Text style={styles.muted}>
                CGST ₹{tax.cgstAmt.toFixed(2)} · SGST ₹{tax.sgstAmt.toFixed(2)} · IGST ₹{tax.igstAmt.toFixed(2)} · Amount ₹{calc.amount.toFixed(2)} · MRP ₹{calc.mrp.toFixed(2)}
              </Text>
            )
          })()}

          <TouchableOpacity style={styles.addBtn} onPress={addLine}>
            <Text style={styles.addBtnText}>+ Add Line</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ---------------- Added lines ---------------- */}
      {items.length > 0 && <Text style={styles.subheading}>Lines ({items.length})</Text>}
      {items.map((it) => {
        const calc = lineCalc(it)
        const tax = lineTax(it, isSameState)
        return (
          <View key={it.key} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>[{it.itemType}] {it.itemCode} — {it.itemDescription}</Text>
              <Text style={styles.muted}>Qty {it.qty} × ₹{it.rate} · {it.issueType || 'no issue type'}</Text>
              <Text style={styles.muted}>CGST ₹{tax.cgstAmt.toFixed(2)} · SGST ₹{tax.sgstAmt.toFixed(2)} · IGST ₹{tax.igstAmt.toFixed(2)}</Text>
              <Text style={styles.muted}>Amount ₹{calc.amount.toFixed(2)} · MRP ₹{calc.mrp.toFixed(2)}</Text>
            </View>
            <View style={{ gap: 6 }}>
              {it.itemType === 'Part' && !!it.itemCode.trim() && (
                <TouchableOpacity style={styles.smallBtn} onPress={() => setLabourModalFor(it)}><Text style={styles.smallBtnText}>+ Labour</Text></TouchableOpacity>
              )}
              <TouchableOpacity style={styles.removeBtn} onPress={() => removeLine(it.key)}><Text style={styles.removeBtnText}>Remove</Text></TouchableOpacity>
            </View>
          </View>
        )
      })}

      <Text style={styles.muted}>
        {partyState
          ? `Tax: ${isSameState ? 'Same State (CGST+SGST)' : 'Different State (IGST)'}, auto-detected from the linked job's customer state.`
          : 'Tax: Same State (CGST+SGST), defaulted (no job linked).'}
      </Text>
      <Text style={styles.total}>Total (excl. GST, not persisted): ₹{estimatedTotal.toFixed(2)}</Text>

      <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnDisabled]} disabled={saving} onPress={save}>
        <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Material Transfer'}</Text>
      </TouchableOpacity>

      {/* ---------------- Combined list ---------------- */}
      <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Material Transfers</Text>
      <PickerField label="DMS workshop location (for DMSBAPLDATA rows)" value={locCode} onChange={setLocCode} options={workshops.map((w) => ({ label: `${w.locCode} — ${w.locName}`, value: w.locCode }))} placeholder="— none —" />
      {dmsError && <Text style={styles.error}>DMSBAPLDATA rows unavailable: {dmsError}</Text>}
      {loading && <ActivityIndicator style={{ marginVertical: 8 }} color={colors.primary} />}

      {rows.map((r) => (
        <TouchableOpacity key={r.id} style={styles.row} onPress={() => setExpandedId(expandedId === r.id ? null : r.id)}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Text style={[styles.badge, r.source === 'JobCardScanner' ? styles.badgeSuccess : styles.badgeMuted]}>{r.source}</Text>
              <Text style={styles.rowTitle}>{r.transferNumber}</Text>
            </View>
            <Text style={styles.muted}>{r.sortDate ? new Date(r.sortDate).toLocaleDateString('en-IN') : '—'} · {r.location ?? '—'} · {r.transferType ?? '—'}</Text>
            <Text style={styles.muted}>{r.partyName ?? '—'} · {r.status ?? '—'} · {r.itemCount} item(s) · ₹{r.totalAmount.toFixed(2)}</Text>
            {expandedId === r.id && (r.items ?? []).map((it, i) => (
              <Text key={i} style={styles.muted}>
                • {String(it.itemCode ?? it.itemIdno ?? it.itemName ?? '—')} — {String(it.itemDescription ?? '—')} · qty {String(it.qty ?? '—')} · rate ₹{String(it.rate ?? '—')}
              </Text>
            ))}
          </View>
          {r.source === 'JobCardScanner' && (
            <TouchableOpacity style={styles.removeBtn} onPress={(e) => { e.stopPropagation(); deleteTransfer(r.id) }}><Text style={styles.removeBtnText}>Delete</Text></TouchableOpacity>
          )}
        </TouchableOpacity>
      ))}
      {rows.length === 0 && !loading && <Text style={styles.muted}>No material transfers yet.</Text>}

      <JobSearchModal visible={showJobSearch} onSelect={selectJob} onClose={() => setShowJobSearch(false)} />
      <PartwiseLabourModal
        visible={!!labourModalFor}
        partCode={labourModalFor?.itemCode ?? ''}
        partName={labourModalFor?.itemDescription ?? ''}
        onClose={() => setLabourModalFor(null)}
        onProceed={handleLabourProceed}
      />
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
  total: { fontWeight: '700', color: colors.text, marginTop: 10, marginBottom: 10 },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  pillSelected: { backgroundColor: colors.navy, borderColor: colors.navy },
  pillText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  pillTextSelected: { color: '#fff' },
  smallBtn: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8 },
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
