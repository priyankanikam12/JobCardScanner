// mobile\src\screens\RepairBillCreateScreen.tsx
import { useEffect, useRef, useState } from 'react'
import { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { JobSearchModal } from '../components/JobSearchModal'
import { PickerField } from '../components/PickerField'
import { colors } from '../theme/colors'
import type { RootStackParamList } from '../navigation/RootNavigator'
import type { BaplDmsLabourRow, BaplDmsPartStock, BaplDmsWorkshop, BaplItemMaster, JobSearchResult, LabourMasterPartwise, MaterialTransferItemForJob, RepairBillDoc, RepairBillDocItemType, RepairBillDocStatus } from '../types'

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
 *
 * 2026-09-22 ("which labour we added from amterial transfer for Issue Type - Paid that will goin
 * for paid type and which are in U/w that was going in U/w that also going in repair bill ...give
 * proper code like vide functionality in mobile and for web both give proper"): this screen never
 * had ANY Material Transfer sync at all before this round (unlike web's RepairBillCreatePage.tsx,
 * which has always auto-loaded its Part Details List from GET .../for-job/{jobCardId} - see that
 * page's own doc comment) - every line here, Part or Labour, was always manually searched/added.
 * Bringing Material-Transfer-sourced Labour into Repair Bill without also bringing its Part rows
 * would leave this screen showing Labour lines with no matching Part lines for the same
 * transfer - an inconsistent half-mirror of web's own behaviour - so this round ports web's FULL
 * materialTransferItems sync effect (both Part AND Labour rows), not only the new Labour half.
 * See the sync effect's own doc comment further down for the mechanics; `key` changes from a
 * locally-minted number to a string so a synced row can be keyed by its own real
 * MaterialTransferDocItem.Id (a GUID) without colliding with a manually-added "manual-N" line,
 * the same collision-avoidance web's own DraftItem.key already uses.
 *
 * 2026-09-23 ("add grid button and in that that job card shown which will transfer from material
 * transfer to save as proforma using adding labour details add this only this page give me for
 * android and web adding this button"): reopen-as-editable, the Android port of
 * RepairBillCreatePage.tsx's own "click a saved bill, it reopens as this same editable form" flow
 * (web's SECTION 80/81) - see startEditBill below for the full mechanics. Web already has this
 * (a click anywhere on the row); this screen adds an explicit "Edit" button inside a tapped row's
 * expanded detail instead (see the Combined list section further down) - a literal grid BUTTON,
 * matching your wording, rather than repurposing the existing tap-to-expand gesture this screen
 * already had (tapping a row still just expands/collapses its summary, unchanged).
 *
 * Same Part-vs-Labour restoration asymmetry as web, ported as-is and for the same reason: Part
 * lines are DELIBERATELY re-derived FRESH from the Job's CURRENT Material Transfer (the existing
 * sync effect above already does this the moment jobCardId is set) rather than replayed from what
 * the bill happened to save previously - this is the "pull from Material Transfer in the DB"
 * behaviour, not a replay of possibly-stale data. Only Labour lines are restored from the bill's
 * own saved items (a Labour line can also be hand-added, independent of Material Transfer) -
 * restored as manual rows keyed "edit-N" (never colliding with "manual-N" or a real MT GUID), then
 * deduplicated once the fresh Material Transfer fetch resolves (see the dedupe effect below) so a
 * Labour line that WAS Material-Transfer-sourced doesn't show twice. A line's own saved Discount/
 * Issue Type is best-effort restored via editSnapshotByCodeRef (matched by item type + code, since
 * a saved line has no direct link back to the Material Transfer row it came from) once Parts
 * re-derive - same disclosed best-effort limitation as web.
 *
 * 2026-09-23 ("this main in 1 page not on same only which are save in jobcard db that in grid
 * button and which material transfer that jobcard"): the embedded "Combined list" section (own
 * JobCardScanner bills + DMSBAPLDATA-synced ones, tap-to-expand, Edit/Delete) moved OUT of this
 * screen onto its own screen - see RepairBillListScreen.tsx (route "RepairBillList") - confirmed
 * via AskUserQuestion ("Android + Web: both get a separate list screen/page" + "JobCardScanner
 * rows only"), mirroring web's own RepairBillCreatePage.tsx/RepairBillListPage.tsx split. This
 * screen is now the create/edit FORM only, reached either fresh (Dashboard's "Repair Bill" card)
 * or already in edit mode via a navigation param - see the route.params effect below, the Android
 * equivalent of web's ?editId= query param.
 *
 * 2026-10-02 ("for mobile also give this repair bill and material transfer both page report") -
 * added a "View DMS Report" button next to "View List" (new-bill header) - opens
 * RepairBillReportScreen.tsx, the read-only DMSBAPLDATA repair-bill report (NOT this screen's own
 * JobCardScannerDb Performa/Billed data - see that screen's own doc comment for the distinction).
 * Not shown while editing an existing bill (editingBillId set), matching where "View List" itself
 * is hidden, since that header row doesn't render in edit mode either.
 */
type TaxMode = 'Same State (CGST+SGST)' | 'Different State (IGST)'
type DiscountType = 'None' | 'Percentage' | 'Amount'

type DraftItem = {
  /** A manually-added line gets a locally-minted "manual-N" string; a line synced in from
   * Material Transfer uses its own MaterialTransferDocItem.Id (a real GUID) directly - see this
   * module's 2026-09-22 doc comment. */
  key: string
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
  /** 2026-09-22: true for a Part/Labour line auto-loaded from Material Transfer - read-only here
   * (no per-field edit UI on this screen for ANY line, manual or synced, so this only changes how
   * Remove behaves - see removeMtLine below, mirroring web's excludedPartKeys). False (default)
   * for every manually-added line. */
  fromMaterialTransfer: boolean
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
  gstPct: '18', discountType: 'None', discountValue: '0', issueType: '', fromMaterialTransfer: false,
}

type RepairBillCreateRouteProp = RouteProp<RootStackParamList, 'RepairBillCreate'>
type RepairBillCreateNav = NativeStackNavigationProp<RootStackParamList, 'RepairBillCreate'>

export function RepairBillCreateScreen() {
  const { profile } = useStaffAuth()
  const navigation = useNavigation<RepairBillCreateNav>()
  const route = useRoute<RepairBillCreateRouteProp>()

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
  // 2026-09-23 ("not added grid button on this clcik open material transfered job cards history" -
  // the THIRD restatement of "add grid button ... job card shown which will transfer from material
  // transfer to save as proforma using adding labour details", after two rounds that missed the
  // mark): a SEPARATE picker from "Search" above, scoped to job cards that already have a Material
  // Transfer saved (see JobSearchModal.tsx's own onlyWithMaterialTransfer doc comment). Selecting a
  // row calls the SAME selectJob() as "Search" - the existing materialTransferItems sync effect
  // above then auto-loads that job's Material Transfer Parts, leaving only Add Labour + Save as
  // Proforma, exactly the flow described.
  const [showMtJobGrid, setShowMtJobGrid] = useState(false)
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

  // 2026-09-23 ("add grid button ... give me for android and web adding this button"): reopen-
  // as-editable state - see startEditBill below and this module's own doc comment. Mirrors
  // RepairBillCreatePage.tsx's editingBillId/editingBillNumber/editingBillStatus/editLoadError.
  const [editingBillId, setEditingBillId] = useState<string | null>(null)
  const [editingBillNumber, setEditingBillNumber] = useState<string | null>(null)
  const [editingBillStatus, setEditingBillStatus] = useState<RepairBillDocStatus | null>(null)
  const [editLoadError, setEditLoadError] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const editSnapshotByCodeRef = useRef<Record<string, { discountType: DiscountType; discountValue: string; issueType: string }>>({})
  const dedupeLabourAfterEditRef = useRef(false)
  const scrollRef = useRef<ScrollView>(null)

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

  // 2026-09-22 ("now i saved from material transfer bill now this will shown in repair bill"):
  // every Material Transfer item already saved against the linked Job - see this module's own doc
  // comment for why this ports web's full sync (Part AND Labour), not just the new Labour half.
  const [materialTransferItems, setMaterialTransferItems] = useState<MaterialTransferItemForJob[]>([])
  const [mtFetchDone, setMtFetchDone] = useState(false)
  const [excludedMtKeys, setExcludedMtKeys] = useState<Set<string>>(new Set())
  useEffect(() => {
    setMtFetchDone(false)
    setExcludedMtKeys(new Set())
    if (!jobCardId) { setMaterialTransferItems([]); return }
    apiClient.get<MaterialTransferItemForJob[]>(`/api/material-transfer-docs/for-job/${jobCardId}`)
      .then(({ data }) => setMaterialTransferItems(data))
      .catch(() => setMaterialTransferItems([]))
      .finally(() => setMtFetchDone(true))
  }, [jobCardId])

  // Rate/Mrp/Qty/HSN already come straight off the Material Transfer item - but SGST/CGST/IGST %
  // were never stored on MaterialTransferDocItem, so a fresh, precise-by-code C_ItemMaster lookup
  // (Part rows) is needed, same as web's own mtItemMasterByCode.
  const [mtItemMasterByCode, setMtItemMasterByCode] = useState<Record<string, BaplItemMaster>>({})
  useEffect(() => {
    const codes = Array.from(new Set(materialTransferItems.filter((m) => m.itemType !== 'Labour').map((m) => m.itemCode.trim().toUpperCase()).filter(Boolean)))
    if (codes.length === 0) { setMtItemMasterByCode({}); return }
    apiClient.get<BaplItemMaster[]>('/api/item-master/by-codes', { params: { codes: codes.join(',') } })
      .then(({ data }) => {
        const byCode: Record<string, BaplItemMaster> = {}
        data.forEach((im) => { byCode[im.itemCode.trim().toUpperCase()] = im })
        setMtItemMasterByCode(byCode)
      })
      .catch(() => setMtItemMasterByCode({}))
  }, [materialTransferItems])

  // Same idea as above but for a synced LABOUR row - C_ItemMaster (a Part catalog) has no row for
  // a Labour Code, so a separate fresh-by-code lookup against Labour Master Partwise itself is
  // needed to recover its real IGST/CGST/SGST, same as web's own mtLabourGstByCode.
  const [mtLabourGstByCode, setMtLabourGstByCode] = useState<Record<string, LabourMasterPartwise>>({})
  useEffect(() => {
    const codes = Array.from(new Set(materialTransferItems.filter((m) => m.itemType === 'Labour').map((m) => m.itemCode.trim().toUpperCase()).filter(Boolean)))
    if (codes.length === 0) { setMtLabourGstByCode({}); return }
    apiClient.get<LabourMasterPartwise[]>('/api/material-transfer-docs/labour-by-codes', { params: { codes: codes.join(',') } })
      .then(({ data }) => {
        const byCode: Record<string, LabourMasterPartwise> = {}
        data.forEach((l) => { byCode[l.labourCode.trim().toUpperCase()] = l })
        setMtLabourGstByCode(byCode)
      })
      .catch(() => setMtLabourGstByCode({}))
  }, [materialTransferItems])

  // Turns the loaded Material Transfer items into read-only Part/Labour lines in `items`,
  // replacing whatever synced lines were there before while leaving every manually-added line
  // untouched - direct port of web's own materialTransferItems sync effect (see
  // RepairBillCreatePage.tsx for the original, this is the same logic/shape).
  useEffect(() => {
    setItems((prev) => {
      const manual = prev.filter((i) => !i.fromMaterialTransfer)
      const mtLines: DraftItem[] = materialTransferItems.filter((m) => !excludedMtKeys.has(m.id)).map((m) => {
        const isLabour = m.itemType === 'Labour'
        let sgstPct: number, cgstPct: number, igstPct: number
        if (isLabour) {
          const lm = mtLabourGstByCode[m.itemCode.trim().toUpperCase()]
          sgstPct = lm?.sgst != null ? lm.sgst * 100 : 9
          cgstPct = lm?.cgst != null ? lm.cgst * 100 : 9
          igstPct = lm?.igst != null ? lm.igst * 100 : 18
        } else {
          const im = mtItemMasterByCode[m.itemCode.trim().toUpperCase()]
          sgstPct = im?.sgst ?? 9
          cgstPct = im?.cgst ?? 9
          igstPct = im?.igst ?? 18
        }
        const totalGst = sgstPct + cgstPct > 0 ? sgstPct + cgstPct : igstPct
        // 2026-09-23 (reopen-as-editable) - best-effort restore of this line's own saved Discount/
        // Issue Type, matched by item type + code since a saved bill line has no direct FK back to
        // the Material Transfer row it came from - see startEditBill's own doc comment.
        const snap = editSnapshotByCodeRef.current[`${isLabour ? 'Labour' : 'Part'}:${m.itemCode.trim().toUpperCase()}`]
        return {
          key: m.id,
          itemType: isLabour ? 'Labour' : 'Part',
          itemCode: m.itemCode,
          itemDescription: m.itemDescription,
          hsnCode: m.hsnCode || '',
          qty: String(m.qty),
          rate: String(m.rate),
          mrp: !isLabour && m.mrp != null ? String(m.mrp) : '',
          gstPct: String(totalGst),
          discountType: snap?.discountType ?? ('None' as DiscountType),
          discountValue: snap?.discountValue ?? '0',
          issueType: snap?.issueType ?? (m.issueType || ''),
          fromMaterialTransfer: true,
        }
      })
      return [...mtLines, ...manual]
    })
  }, [materialTransferItems, mtItemMasterByCode, mtLabourGstByCode, excludedMtKeys])

  // 2026-09-23 (reopen-as-editable) - one-time cleanup after startEditBill restores this bill's own
  // saved Labour lines as manual "edit-N" rows: once the fresh Material Transfer fetch resolves,
  // drop any "edit-N" Labour row whose item code the fresh fetch ALSO returned (fromMaterialTransfer
  // sync above already re-added it) so it doesn't show twice - see this module's own doc comment.
  // Gated to run only once per edit-open (dedupeLabourAfterEditRef reset to false immediately) and
  // only ever touches "edit-" keyed rows, never a genuinely hand-added "manual-N" line.
  useEffect(() => {
    if (!dedupeLabourAfterEditRef.current || !mtFetchDone) return
    dedupeLabourAfterEditRef.current = false
    const mtLabourCodes = new Set(materialTransferItems.filter((m) => m.itemType === 'Labour').map((m) => m.itemCode.trim().toUpperCase()))
    setItems((prev) => prev.filter((i) => !(i.key.startsWith('edit-') && i.itemType === 'Labour' && mtLabourCodes.has(i.itemCode.trim().toUpperCase()))))
  }, [mtFetchDone, materialTransferItems])

  // 2026-09-22: mirrors web's removePart/removeMtLabour - excludes a synced line from THIS bill
  // only (the Material Transfer record itself is unaffected) via excludedMtKeys, so the sync
  // effect above doesn't silently bring it back. Plain removeLine (below) stays for manual lines.
  const removeMtLine = (it: DraftItem) => {
    Alert.alert(
      `Remove ${it.itemType} "${it.itemDescription}"?`,
      'The Material Transfer record itself is unaffected - this only excludes it from this Repair Bill.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => setExcludedMtKeys((prev) => new Set(prev).add(it.key)) },
      ],
    )
  }

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
    setItems((prev) => [...prev, { key: `manual-${nextKey}`, ...draft, issueType: draft.issueType || issueType }])
    setNextKey((k) => k + 1)
    setDraft(emptyDraft)
    setSearch('')
  }
  const removeLine = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key))

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

  // 2026-09-23 - factored out of save()'s old POST-success handler so cancelEdit can reuse the
  // exact same "blank form" reset, mirroring RepairBillCreatePage.tsx's own resetFormToNew.
  const resetFormToNew = () => {
    clearJob()
    setPartyName(''); setRegNo(''); setChassisNo(''); setBillType('Cash'); setIssueType(''); setRemarks('')
    setInsuranceCompanyName(''); setInsuranceDescription(''); setSurveyorName(''); setSurveyorContactNumber('')
    setPolicyNo(''); setInsuranceValidTill(null); setZeroDepreciation(false); setTotalDiscount('0'); setAmountReceived('0')
    setBillDate(new Date())
    setItems([])
    setEditingBillId(null); setEditingBillNumber(null); setEditingBillStatus(null)
    editSnapshotByCodeRef.current = {}
  }

  // 2026-09-23 ("add grid button ... give me for android and web adding this button"): reopens an
  // existing JobCardScanner-own, still-Performa bill as THIS SAME form, pre-filled, so it can be
  // edited and re-saved (Update Proforma) or finalized (Save as Invoice) right here - see this
  // module's own doc comment above for the full reasoning, especially why Part lines are NOT
  // restored from the bill's own saved items (they re-derive fresh via the existing sync effect
  // above) while Labour lines are.
  const startEditBill = (id: string) => {
    setEditLoadError(null)
    apiClient.get<RepairBillDoc>(`/api/repair-bill-docs/${id}`)
      .then(({ data: bill }) => {
        setEditingBillId(bill.id)
        setEditingBillNumber(bill.billNumber)
        setEditingBillStatus(bill.status)

        setPartyName(bill.partyName)
        setRegNo(bill.regNo || '')
        setChassisNo(bill.chassisNo || '')
        setLocation(bill.location || '')
        setBillType(bill.billType || 'Cash')
        setIssueType(bill.issueType || '')
        setBillDate(bill.billDate ? new Date(bill.billDate) : new Date())
        setRemarks(bill.remarks || '')
        setInsuranceCompanyName(bill.insuranceCompanyName || '')
        setInsuranceDescription(bill.insuranceDescription || '')
        setSurveyorName(bill.surveyorName || '')
        setSurveyorContactNumber(bill.surveyorContactNumber || '')
        setPolicyNo(bill.policyNo || '')
        setInsuranceValidTill(bill.insuranceValidTill ? new Date(bill.insuranceValidTill) : null)
        setZeroDepreciation(bill.zeroDepreciation)
        setTotalDiscount(String(bill.totalDiscount))
        setAmountReceived(String(bill.amountReceived))
        setShowInsurance(!!(bill.insuranceCompanyName || bill.policyNo || bill.surveyorName))

        const snapshot: Record<string, { discountType: DiscountType; discountValue: string; issueType: string }> = {}
        bill.items.forEach((it) => {
          snapshot[`${it.itemType}:${it.itemCode.trim().toUpperCase()}`] = {
            discountType: (it.discountType as DiscountType) || 'None',
            discountValue: String(it.discountValue),
            issueType: it.issueType || '',
          }
        })
        editSnapshotByCodeRef.current = snapshot

        const restoredLabour: DraftItem[] = bill.items
          .filter((it) => it.itemType === 'Labour')
          .map((it, idx) => ({
            key: `edit-${idx}`,
            itemType: 'Labour' as RepairBillDocItemType,
            itemCode: it.itemCode,
            itemDescription: it.itemDescription,
            hsnCode: it.hsnCode || '',
            qty: String(it.qty),
            rate: String(it.rate),
            mrp: '',
            gstPct: String((it.cgstPct || 0) + (it.sgstPct || 0) > 0 ? (it.cgstPct || 0) + (it.sgstPct || 0) : (it.igstPct || 0)),
            discountType: (it.discountType as DiscountType) || 'None',
            discountValue: String(it.discountValue),
            issueType: it.issueType || '',
            fromMaterialTransfer: false,
          }))

        setExcludedMtKeys(new Set())
        setDraft(emptyDraft)
        setSearch('')

        if (bill.jobCardId) {
          dedupeLabourAfterEditRef.current = restoredLabour.length > 0
          setItems(restoredLabour)
          setJobCardId(bill.jobCardId)
          setJobCardNumber(bill.jobCardNumber || '')
          apiClient.get<JobSearchResult[]>('/api/jobcards/search', { params: { jobNo: bill.jobCardNumber || undefined } })
            .then(({ data }) => {
              const job = data.find((j) => j.id === bill.jobCardId) ?? data[0]
              if (job) setPartyState(job.partyState ?? null)
            })
            .catch(() => { /* non-fatal - tax-mode auto-detection just stays defaulted */ })
        } else {
          // Pre-2026-09-23 bills could be saved with no Job linked at all - this screen can no
          // longer save further changes to one going forward, but it's still opened here read-
          // into-the-form so its fields are at least visible/reviewable.
          dedupeLabourAfterEditRef.current = false
          setJobCardId(null); setJobCardNumber(''); setPartyState(null)
          setItems(restoredLabour)
        }

        scrollRef.current?.scrollTo({ y: 0, animated: true })
      })
      .catch((err) => setEditLoadError(err?.response?.data?.message ?? `Could not load Bill ${id} for editing.`))
  }

  // 2026-09-23 ("this main in 1 page not on same") - opens this screen already in edit mode when
  // arrived at via navigation.navigate('RepairBillCreate', { editBillId: id }) - the Android
  // equivalent of web's /repair-bill-new?editId={id}, used by the new RepairBillListScreen's own
  // Edit button.
  useEffect(() => {
    if (route.params?.editBillId) startEditBill(route.params.editBillId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.editBillId])

  const cancelEdit = () => { resetFormToNew(); setEditLoadError(null) }

  // 2026-09-23 - "Save as Invoice" reachable directly from the reopened edit form, the Android
  // sibling of RepairBillCreatePage.tsx's own finalizeEditingBillAsInvoice - reuses the existing
  // PUT .../status endpoint (already used elsewhere for other status transitions).
  const finalizeEditingBillAsInvoice = () => {
    if (!editingBillId || !editingBillNumber) return
    Alert.alert(
      'Save as Invoice?',
      `Save Bill ${editingBillNumber} as Invoice? This finalizes it - line items can no longer be changed afterwards.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save as Invoice',
          onPress: () => {
            setConvertingId(editingBillId)
            apiClient
              .put(`/api/repair-bill-docs/${editingBillId}/status`, JSON.stringify('Billed'), { headers: { 'Content-Type': 'application/json' } })
              .then(() => {
                setEditingBillStatus('Billed')
                Alert.alert('Saved', `Bill ${editingBillNumber} saved as Invoice.`)
                // 2026-09-23 - loadCombined() removed: the list now lives on its own screen
                // (RepairBillListScreen.tsx), which re-fetches on its own mount/focus.
              })
              .catch((err) => Alert.alert('Could not save', err?.response?.data?.message ?? 'Could not save this bill as an Invoice.'))
              .finally(() => setConvertingId(null))
          },
        },
      ],
    )
  }

  const save = () => {
    if (!partyName.trim()) { Alert.alert('Party Name is required.'); return }
    if (items.length === 0) { Alert.alert('Add at least one item/labour line first.'); return }
    setSaving(true)
    const body = {
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
    }

    // 2026-09-23 - editingBillId set means startEditBill above loaded an existing Performa bill:
    // PUT updates it IN PLACE (same bill, same Bill No) instead of POSTing a new one - mirroring
    // RepairBillCreatePage.tsx's own save(). The form is deliberately NOT reset to blank on a
    // successful update (unlike a fresh create, below) - staying on this same bill is what lets
    // "Save as Invoice" immediately follow.
    const request = editingBillId
      ? apiClient.put(`/api/repair-bill-docs/${editingBillId}`, body)
      : apiClient.post('/api/repair-bill-docs', body)

    request
      .then((r) => {
        if (editingBillId) {
          Alert.alert('Updated', `Updated ${r.data.billNumber}.`)
        } else {
          Alert.alert('Saved', `Saved as ${r.data.billNumber}.`)
          resetFormToNew()
        }
        // 2026-09-23 - loadCombined() removed: see note on finalizeEditingBillAsInvoice above.
      })
      .catch((err) => Alert.alert('Could not save', err?.response?.data?.message ?? `Could not ${editingBillId ? 'update' : 'save'} the repair bill.`))
      .finally(() => setSaving(false))
  }

  return (
    <ScrollView ref={scrollRef} style={styles.screen} keyboardShouldPersistTaps="handled">
      {/* 2026-09-23 ("add grid button ... give me for android and web adding this button"): this
          same form now doubles as the edit view for an existing Performa bill, opened via the
          "Edit" button on the new RepairBillListScreen - see startEditBill's own doc comment
          above. editLoadError surfaces if that fetch itself fails (e.g. the bill was deleted by
          someone else a moment before the tap landed). */}
      {editingBillId ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={styles.sectionTitle}>Editing Bill {editingBillNumber} <Text style={[styles.badge, styles.badgeMuted]}>{editingBillStatus}</Text></Text>
          <TouchableOpacity style={styles.smallBtn} onPress={cancelEdit}><Text style={styles.smallBtnText}>✕ Cancel</Text></TouchableOpacity>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <Text style={styles.sectionTitle}>New Repair Bill</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {/* 2026-10-02 ("for mobile also give this repair bill and material transfer both page
                report") - opens the read-only DMSBAPLDATA report (RepairBillReportScreen.tsx),
                NOT this screen's own JobCardScannerDb Performa/Billed data - see this file's own
                doc comment for the distinction. */}
            <TouchableOpacity style={styles.smallBtn} onPress={() => navigation.navigate('RepairBillReport')}>
              <Text style={styles.smallBtnText}>View RB Report</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtn} onPress={() => navigation.navigate('RepairBillList')}>
              <Text style={styles.smallBtnText}>View List</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {editLoadError && <Text style={styles.error}>{editLoadError}</Text>}

      <View style={styles.field}>
        <Text style={styles.label}>Job No</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput style={[styles.input, { flex: 1 }]} value={jobCardNumber} editable={false} placeholder="No job linked" />
          <TouchableOpacity style={styles.smallBtn} onPress={() => setShowJobSearch(true)}><Text style={styles.smallBtnText}>Search</Text></TouchableOpacity>
          {/* 2026-09-23 - the "grid button": opens a picker scoped to job cards that already have a
              Material Transfer saved (see showMtJobGrid's own doc comment above). */}
          <TouchableOpacity style={styles.smallBtn} onPress={() => setShowMtJobGrid(true)}><Text style={styles.smallBtnText}>🔲 MT History</Text></TouchableOpacity>
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
          {(['', 'Paid', 'U/W'] as const).map((t) => (
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
              {(['', 'Paid', 'U/W'] as const).map((t) => (
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
      {/* 2026-09-22: mirrors web's own onSelect() warning - see this module's doc comment on why
          this screen now syncs from Material Transfer at all. */}
      {jobCardId && mtFetchDone && materialTransferItems.length === 0 && (
        <Text style={styles.muted}>
          No Material Transfer found yet for this Job Card. Parts/Labour issued via Material
          Transfer will appear here automatically once saved - you can still add lines manually above.
        </Text>
      )}
      {items.map((it) => {
        const est = lineEstimate(it, taxMode, issueType)
        return (
          <View key={it.key} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>[{it.itemType}] {it.itemCode} — {it.itemDescription}</Text>
              {it.fromMaterialTransfer && <Text style={styles.muted}>via Material Transfer</Text>}
              <Text style={styles.muted}>Qty {it.qty} × ₹{it.rate} · {it.issueType || 'default'}{it.discountType !== 'None' ? ` · Disc ${it.discountValue}${it.discountType === 'Percentage' ? '%' : '₹'}` : ''}</Text>
              <Text style={styles.muted}>Taxable ₹{est.taxable.toFixed(2)} · CGST ₹{est.cgstAmt.toFixed(2)} · SGST ₹{est.sgstAmt.toFixed(2)} · IGST ₹{est.igstAmt.toFixed(2)} · Total ₹{est.total.toFixed(2)}</Text>
            </View>
            <TouchableOpacity style={styles.removeBtn} onPress={() => (it.fromMaterialTransfer ? removeMtLine(it) : removeLine(it.key))}><Text style={styles.removeBtnText}>Remove</Text></TouchableOpacity>
          </View>
        )
      })}

      <Text style={styles.muted}>{zeroTaxLineCount > 0 ? `${zeroTaxLineCount} zero-tax line(s) - ` : ''}Estimated Total: ₹{estimatedTotal.toFixed(2)}</Text>
      <Text style={styles.total}>{' '}</Text>

      {/* 2026-09-23 - while editing an existing bill (editingBillId set), Save becomes "Update
          Proforma" and is disabled once the bill is no longer Performa (Billed/Cancelled has no
          "undo" here) - "Save as Invoice" now also sits right here, matching
          RepairBillCreatePage.tsx's own Save-as-Proforma/Save-as-Invoice pairing on web. */}
      <TouchableOpacity
        style={[styles.saveBtn, (saving || editingBillStatus === 'Billed' || editingBillStatus === 'Cancelled') && styles.saveBtnDisabled]}
        disabled={saving || editingBillStatus === 'Billed' || editingBillStatus === 'Cancelled'}
        onPress={save}
      >
        <Text style={styles.saveBtnText}>{saving ? 'Saving…' : editingBillId ? 'Update Proforma' : 'Save Repair Bill'}</Text>
      </TouchableOpacity>
      {editingBillId && editingBillStatus === 'Performa' && (
        <TouchableOpacity style={[styles.smallBtn, { marginBottom: 14 }]} disabled={convertingId === editingBillId} onPress={finalizeEditingBillAsInvoice}>
          <Text style={styles.smallBtnText}>{convertingId === editingBillId ? 'Saving…' : 'Save as Invoice'}</Text>
        </TouchableOpacity>
      )}
      {editingBillId && editingBillStatus !== 'Performa' && (
        <Text style={styles.muted}>This bill is already {editingBillStatus} - it can no longer be edited.</Text>
      )}

      {/* 2026-09-23 - the combined list (filters, rows, Edit/Delete) moved to its own screen: see
          the "View List" button above and RepairBillListScreen.tsx / route "RepairBillList". */}
      <JobSearchModal visible={showJobSearch} onSelect={selectJob} onClose={() => setShowJobSearch(false)} />
      <JobSearchModal
        visible={showMtJobGrid}
        onSelect={(j) => { selectJob(j); setShowMtJobGrid(false) }}
        onClose={() => setShowMtJobGrid(false)}
        onlyWithMaterialTransfer
        title="Material Transfer Job Card History"
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
