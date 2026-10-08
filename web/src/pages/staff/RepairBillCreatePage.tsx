// web\src\pages\staff\RepairBillCreatePage.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsLabourRow, BaplDmsWorkshop, BaplItemMaster, JobSearchResult, LabourMasterPartwise, MaterialTransferItemForJob, RepairBillDoc, RepairBillDocItemType, RepairBillDocStatus } from '../../types'
import { JobSearchModal } from '../../components/JobSearchModal'
import { LabourSearchInput } from '../../components/LabourSearchInput'
// 2026-10-07 (Insurance): the "Insurance" section - pick an Insurance ledger (Ledger Master, type Insurance) and fill the policy details; saved with the bill and printed on its
// invoice (see lib/repairBillInsuranceHtml.ts). A bill without insurance saves and prints in the normal format.
import { InsuranceSection } from '../../components/InsuranceSection'

type TaxMode = 'Same State (CGST+SGST)' | 'Different State (IGST)'
type DiscountType = 'None' | 'Percentage' | 'Amount'

type DraftItem = {
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
  fromMaterialTransfer: boolean
}

const emptyItem = (key: string, defaultIssueType = ''): DraftItem => ({
  key, itemType: 'Labour', itemCode: '', itemDescription: '', hsnCode: '', qty: '1', rate: '0', mrp: '', gstPct: '18',
  discountType: 'None', discountValue: '0', issueType: defaultIssueType, fromMaterialTransfer: false,
})

const isZeroTaxIssue = (issueType: string) => issueType === 'U/W' || issueType === 'FSC' || issueType === 'FOC'

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

export function RepairBillCreatePage() {
  const { profile } = useStaffAuth()
  const navigate = useNavigate()

  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  useEffect(() => {
    if (!profile?.dealerId) return
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then(({ data }) => {
        const scoped = profile?.workLocationCodes?.length ? data.filter((w) => profile.workLocationCodes.includes(w.locCode)) : data
        setWorkshops(scoped)
        if (scoped.length > 0) setLocation((prev) => prev || scoped[0].locCode)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.dealerId, profile?.workLocationCodes])

  const [jobCardId, setJobCardId] = useState<string | null>(null)
  const autoFilledFromJob = !!jobCardId
  const [jobCardNumber, setJobCardNumber] = useState('')
  const [jobDate, setJobDate] = useState<string | null>(null)
  const [odometer, setOdometer] = useState<number | null>(null)
  const [technician, setTechnician] = useState<string | null>(null)
  const [vehicleModel, setVehicleModel] = useState<string | null>(null)
  const [showJobSearch, setShowJobSearch] = useState(false)
  const [showMtJobGrid, setShowMtJobGrid] = useState(false)
  const [partyName, setPartyName] = useState('')
  const [regNo, setRegNo] = useState('')
  const [chassisNo, setChassisNo] = useState('')
  const [location, setLocation] = useState('')
  const [billType, setBillType] = useState('Cash')
  const [issueType, setIssueType] = useState('')
  const [partyState, setPartyState] = useState<string | null>(null)
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const nextManualKeyRef = useRef(2)

  const taxMode: TaxMode = useMemo(() => {
    const dealerState = profile?.dealerState
    if (!dealerState || !partyState) return 'Same State (CGST+SGST)'
    return dealerState.trim().toUpperCase() === partyState.trim().toUpperCase()
      ? 'Same State (CGST+SGST)' : 'Different State (IGST)'
  }, [profile?.dealerState, partyState])

  // Insurance (2026-10-07): showInsurance = the Insurance section is switched on for this bill. The values below are saved on the bill (RepairBillDoc.insurance*) and printed on
  // its invoice; with the section off, none of them is sent and the bill prints in the normal format.
  const [showInsurance, setShowInsurance] = useState(false)
  const [insuranceCompanyName, setInsuranceCompanyName] = useState('')
  const [insuranceDescription, setInsuranceDescription] = useState('')
  const [surveyorName, setSurveyorName] = useState('')
  const [surveyorContactNumber, setSurveyorContactNumber] = useState('')
  const [policyNo, setPolicyNo] = useState('')
  const [insuranceValidTill, setInsuranceValidTill] = useState('')
  const [zeroDepreciation, setZeroDepreciation] = useState(false)
  const [totalDiscount, setTotalDiscount] = useState('0')
  const [amountReceived, setAmountReceived] = useState('0')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState<string | null>(null)

  const [editingBillId, setEditingBillId] = useState<string | null>(null)
  const [editingBillNumber, setEditingBillNumber] = useState<string | null>(null)
  const [editingBillStatus, setEditingBillStatus] = useState<RepairBillDocStatus | null>(null)
  const [editLoadError, setEditLoadError] = useState<string | null>(null)
  const editSnapshotByCodeRef = useRef<Record<string, { discountType: DiscountType; discountValue: string; issueType: string }>>({})
  const dedupeLabourAfterEditRef = useRef(false)

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key))
  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const [excludedPartKeys, setExcludedPartKeys] = useState<Set<string>>(new Set())
  const removePart = (it: DraftItem) => {
    if (!window.confirm(`Remove Part "${it.itemDescription}" from this bill? The Material Transfer record itself is unaffected - this only excludes it from this Repair Bill.`)) return
    setExcludedPartKeys((prev) => new Set(prev).add(it.key))
    removeItem(it.key)
    if (editingPartKey === it.key) setEditingPartKey(null)
  }
  const removeMtLabour = (it: DraftItem) => {
    if (!window.confirm(`Remove Labour "${it.itemDescription}" from this bill? The Material Transfer record itself is unaffected - this only excludes it from this Repair Bill.`)) return
    setExcludedPartKeys((prev) => new Set(prev).add(it.key))
    removeItem(it.key)
    if (editingPartKey === it.key) setEditingPartKey(null)
  }

  const [draftLabour, setDraftLabour] = useState<DraftItem>(() => emptyItem('draft', issueType))
  const [labourEditingKey, setLabourEditingKey] = useState<string | null>(null)
  const resetDraftLabour = () => { setDraftLabour(emptyItem('draft', issueType)); setLabourEditingKey(null) }
  const startEditLabour = (it: DraftItem) => { setDraftLabour({ ...it }); setLabourEditingKey(it.key) }
  const commitLabourDraft = () => {
    if (!draftLabour.itemCode.trim() || !draftLabour.itemDescription.trim()) return
    if (labourEditingKey) {
      updateItem(labourEditingKey, { ...draftLabour, key: labourEditingKey })
    } else {
      setItems((prev) => [...prev, { ...draftLabour, key: `manual-${nextManualKeyRef.current++}` }])
    }
    resetDraftLabour()
  }
  const removeLabour = (key: string) => { removeItem(key); if (labourEditingKey === key) resetDraftLabour() }

  const [editingPartKey, setEditingPartKey] = useState<string | null>(null)

  const estimatedTotal = items.reduce((sum, it) => sum + lineEstimate(it, taxMode, issueType).total, 0)
  const zeroTaxLineCount = items.filter((it) => isZeroTaxIssue(it.issueType || issueType)).length
  const labourRows = items.filter((it) => it.itemType === 'Labour')
  const partRows = items.filter((it) => it.itemType === 'Part')

  const [materialTransferItems, setMaterialTransferItems] = useState<MaterialTransferItemForJob[]>([])
  const [mtFetchDone, setMtFetchDone] = useState(false)
  useEffect(() => {
    setMtFetchDone(false)
    setExcludedPartKeys(new Set())
    if (!jobCardId) { setMaterialTransferItems([]); return }
    staffApi.get<MaterialTransferItemForJob[]>(`/api/material-transfer-docs/for-job/${jobCardId}`)
      .then(({ data }) => setMaterialTransferItems(data))
      .catch(() => setMaterialTransferItems([]))
      .finally(() => setMtFetchDone(true))
  }, [jobCardId])

  const [mtItemMasterByCode, setMtItemMasterByCode] = useState<Record<string, BaplItemMaster>>({})
  useEffect(() => {
    const codes = Array.from(new Set(materialTransferItems.filter((m) => m.itemType !== 'Labour').map((m) => m.itemCode.trim().toUpperCase()).filter(Boolean)))
    if (codes.length === 0) { setMtItemMasterByCode({}); return }
    staffApi.get<BaplItemMaster[]>('/api/item-master/by-codes', { params: { codes: codes.join(',') } })
      .then(({ data }) => {
        const byCode: Record<string, BaplItemMaster> = {}
        data.forEach((im) => { byCode[im.itemCode.trim().toUpperCase()] = im })
        setMtItemMasterByCode(byCode)
      })
      .catch(() => setMtItemMasterByCode({}))
  }, [materialTransferItems])

  const [mtLabourGstByCode, setMtLabourGstByCode] = useState<Record<string, LabourMasterPartwise>>({})
  useEffect(() => {
    const codes = Array.from(new Set(materialTransferItems.filter((m) => m.itemType === 'Labour').map((m) => m.itemCode.trim().toUpperCase()).filter(Boolean)))
    if (codes.length === 0) { setMtLabourGstByCode({}); return }
    staffApi.get<LabourMasterPartwise[]>('/api/material-transfer-docs/labour-by-codes', { params: { codes: codes.join(',') } })
      .then(({ data }) => {
        const byCode: Record<string, LabourMasterPartwise> = {}
        data.forEach((l) => { byCode[l.labourCode.trim().toUpperCase()] = l })
        setMtLabourGstByCode(byCode)
      })
      .catch(() => setMtLabourGstByCode({}))
  }, [materialTransferItems])

  useEffect(() => {
    setItems((prev) => {
      const manual = prev.filter((i) => !i.fromMaterialTransfer)
      const mtRows: DraftItem[] = materialTransferItems.filter((m) => !excludedPartKeys.has(m.id)).map((m) => {
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
        const existing = prev.find((i) => i.key === m.id)
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
          discountType: existing?.discountType ?? snap?.discountType ?? 'None',
          discountValue: existing?.discountValue ?? snap?.discountValue ?? '0',
          issueType: existing?.issueType ?? snap?.issueType ?? (m.issueType || ''),
          fromMaterialTransfer: true,
        }
      })
      return [...mtRows, ...manual]
    })
  }, [materialTransferItems, mtItemMasterByCode, mtLabourGstByCode, excludedPartKeys])

  useEffect(() => {
    if (!dedupeLabourAfterEditRef.current || !mtFetchDone) return
    dedupeLabourAfterEditRef.current = false
    const mtLabourCodes = new Set(
      materialTransferItems.filter((m) => m.itemType === 'Labour').map((m) => m.itemCode.trim().toUpperCase()),
    )
    if (mtLabourCodes.size === 0) return
    setItems((prev) => prev.filter((it) => !(it.itemType === 'Labour' && !it.fromMaterialTransfer && mtLabourCodes.has(it.itemCode.trim().toUpperCase()))))
  }, [mtFetchDone, materialTransferItems])

  const [labours, setLabours] = useState<BaplDmsLabourRow[]>([])
  useEffect(() => {
    if (!location) { setLabours([]); return }
    const dealerCode = location.replace(/W\d+$/i, '')
    staffApi.get<BaplDmsLabourRow[]>('/api/bapl-dms/labour', { params: { dealerCode: dealerCode || undefined } })
      .then(({ data }) => setLabours(data))
      .catch(() => setLabours([]))
  }, [location])

  const labourOptionsForModel = !vehicleModel
    ? labours
    : labours.filter((l) => !l.oemModelName || l.oemModelName.trim().toLowerCase() === vehicleModel.trim().toLowerCase())

  const pickLabourForDraft = (l: BaplDmsLabourRow) => {
    const totalGst = (l.cgst ?? 0) + (l.sgst ?? 0) > 0 ? (l.cgst ?? 0) + (l.sgst ?? 0) : (l.igst ?? 18)
    setDraftLabour((prev) => ({
      ...prev,
      itemCode: l.labourCode,
      itemDescription: l.labourDescription || l.labourCode,
      hsnCode: l.hsnCode || '',
      mrp: '',
      rate: l.labourRate != null ? String(l.labourRate) : '0',
      gstPct: String(totalGst),
    }))
  }

  const selectJob = (job: JobSearchResult) => {
    setJobCardId(job.id)
    setJobCardNumber(job.jobCardNumber)
    if (job.partyName) setPartyName(job.partyName)
    if (job.regNo) setRegNo(job.regNo)
    if (job.chassisNo) setChassisNo(job.chassisNo)
    if (job.locationCode) setLocation(job.locationCode)
    setPartyState(job.partyState ?? null)
    setVehicleModel(job.vehicleType || null)
    setJobDate(job.jobDate || null)
    setOdometer(job.odometer ?? null)
    setTechnician(job.technician || null)
    setShowJobSearch(false)
  }

  const clearJob = () => {
    setJobCardId(null); setJobCardNumber(''); setPartyState(null); setVehicleModel(null)
    setJobDate(null); setOdometer(null); setTechnician(null)
    setPartyName(''); setRegNo(''); setChassisNo('')
    setLocation(workshops.length > 0 ? workshops[0].locCode : '')
    setEditingBillId(null); setEditingBillNumber(null); setEditingBillStatus(null); setEditLoadError(null)
    editSnapshotByCodeRef.current = {}
  }

  const resetFormToNew = () => {
    clearJob()
    setBillType('Cash'); setIssueType(''); setRemarks('')
    setInsuranceCompanyName(''); setInsuranceDescription(''); setSurveyorName(''); setSurveyorContactNumber('')
    setPolicyNo(''); setInsuranceValidTill(''); setZeroDepreciation(false); setShowInsurance(false); setTotalDiscount('0'); setAmountReceived('0')
    setBillDate(new Date().toISOString().slice(0, 10))
    nextManualKeyRef.current = 2
    setItems([])
    resetDraftLabour()
    setEditingPartKey(null)
  }

  const startEditBill = (id: string) => {
    setSaveError(null); setSaveOk(null); setEditLoadError(null)
    staffApi.get<RepairBillDoc>(`/api/repair-bill-docs/${id}`)
      .then(({ data: bill }) => {
        setEditingBillId(bill.id)
        setEditingBillNumber(bill.billNumber)
        setEditingBillStatus(bill.status)

        setBillType(bill.billType || 'Cash')
        setIssueType(bill.issueType || '')
        setBillDate(bill.billDate ? bill.billDate.slice(0, 10) : new Date().toISOString().slice(0, 10))
        setRemarks(bill.remarks || '')
        setPartyName(bill.partyName)
        setRegNo(bill.regNo || '')
        setChassisNo(bill.chassisNo || '')
        setLocation(bill.location || '')
        setInsuranceCompanyName(bill.insuranceCompanyName || '')
        setInsuranceDescription(bill.insuranceDescription || '')
        setSurveyorName(bill.surveyorName || '')
        setSurveyorContactNumber(bill.surveyorContactNumber || '')
        setPolicyNo(bill.policyNo || '')
        setInsuranceValidTill(bill.insuranceValidTill ? bill.insuranceValidTill.slice(0, 10) : '')
        setZeroDepreciation(bill.zeroDepreciation)
        setTotalDiscount(String(bill.totalDiscount))
        setAmountReceived(String(bill.amountReceived))
        // a saved bill that has insurance reopens with the Insurance section on
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
            itemType: 'Labour',
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
        nextManualKeyRef.current = restoredLabour.length + 2
        setExcludedPartKeys(new Set())
        setEditingPartKey(null)
        resetDraftLabour()

        if (bill.jobCardId) {
          dedupeLabourAfterEditRef.current = restoredLabour.length > 0
          setItems(restoredLabour)
          setJobCardId(bill.jobCardId)
          setJobCardNumber(bill.jobCardNumber || '')
          staffApi.get<JobSearchResult[]>('/api/jobcards/search', { params: { jobNo: bill.jobCardNumber || undefined } })
            .then(({ data }) => {
              const job = data.find((j) => j.id === bill.jobCardId) ?? data[0]
              if (!job) return
              setPartyState(job.partyState ?? null)
              setVehicleModel(job.vehicleType || null)
              setJobDate(job.jobDate || null)
              setOdometer(job.odometer ?? null)
              setTechnician(job.technician || null)
            })
            .catch(() => { /* non-fatal - the "Selected Job Details" panel just stays partly blank */ })
        } else {
          dedupeLabourAfterEditRef.current = false
          setJobCardId(null); setJobCardNumber(''); setPartyState(null); setVehicleModel(null)
          setJobDate(null); setOdometer(null); setTechnician(null)
          setItems(restoredLabour)
        }

        window.scrollTo({ top: 0, behavior: 'smooth' })
      })
      .catch((err) => setEditLoadError(err?.response?.data?.message ?? `Could not load Bill ${id} for editing.`))
  }

  const [searchParams] = useSearchParams()
  useEffect(() => {
    const editId = searchParams.get('editId')
    if (editId) startEditBill(editId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const cancelEdit = () => { resetFormToNew(); setEditLoadError(null) }

  const save = () => {
    setSaveError(null)
    setSaveOk(null)
    if (!partyName.trim()) { setSaveError('Party Name is required.'); return }
    // Insurance (2026-10-07): the section is on, so an insurance company must have been picked from the Insurance ledger list.
    if (showInsurance && !insuranceCompanyName.trim()) { setSaveError('Select the Insurance company from the list, or click "Remove Insurance".'); return }
    if (showInsurance && surveyorContactNumber && !/^\d{10}$/.test(surveyorContactNumber)) { setSaveError('Surveyor Contact No must be exactly 10 digits.'); return }
    const validItems = items.filter((i) => i.itemDescription.trim() && Number(i.qty) > 0)
    if (validItems.length === 0) { setSaveError('Add at least one item/labour line with a description and quantity.'); return }

    const body = {
      jobCardId: jobCardId || null,
      partyName: partyName.trim(),
      regNo: regNo || null,
      chassisNo: chassisNo || null,
      location: location || null,
      billType: billType || null,
      issueType: issueType || null,
      remarks: remarks || null,
      billDate,
      // a bill without the Insurance section sends none of these, so it saves and prints in the normal format
      insuranceCompanyName: showInsurance ? insuranceCompanyName || null : null,
      insuranceDescription: showInsurance ? insuranceDescription || null : null,
      surveyorName: showInsurance ? surveyorName || null : null,
      surveyorContactNumber: showInsurance ? surveyorContactNumber || null : null,
      policyNo: showInsurance ? policyNo || null : null,
      insuranceValidTill: showInsurance ? insuranceValidTill || null : null,
      zeroDepreciation: showInsurance ? zeroDepreciation : false,
      totalDiscount: Number(totalDiscount) || 0,
      amountReceived: Number(amountReceived) || 0,
      items: validItems.map((i) => {
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

    setSaving(true)
    const request = editingBillId
      ? staffApi.put(`/api/repair-bill-docs/${editingBillId}`, body)
      : staffApi.post('/api/repair-bill-docs', body)

    request
      .then((r) => {
        if (editingBillId) {
          setSaveOk(`Updated ${r.data.billNumber}.`)
        } else {
          setSaveOk(`Saved as ${r.data.billNumber}.`)
          resetFormToNew()
        }
      })
      .catch((err) => setSaveError(err?.response?.data?.message ?? `Could not ${editingBillId ? 'update' : 'save'} the repair bill.`))
      .finally(() => setSaving(false))
  }

  const finalizeEditingBillAsInvoice = () => {
    if (!editingBillId || !editingBillNumber) return
    if (!window.confirm(`Save Bill ${editingBillNumber} as Invoice? This finalizes it - line items can no longer be changed afterwards.`)) return
    setConvertingId(editingBillId)
    staffApi
      .put(`/api/repair-bill-docs/${editingBillId}/status`, JSON.stringify('Billed'), { headers: { 'Content-Type': 'application/json' } })
      .then(() => {
        setEditingBillStatus('Billed')
        setSaveOk(`Bill ${editingBillNumber} saved as Invoice.`)
      })
      .catch((err) => alert(err?.response?.data?.message ?? 'Could not save this bill as an Invoice.'))
      .finally(() => setConvertingId(null))
  }

  const [convertingId, setConvertingId] = useState<string | null>(null)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Repair Bill</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/repair-bill-list')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden="true">☰</span>Repair Bill List
        </button>
      </div>

      <div className="card">
        {editingBillId ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Editing Bill {editingBillNumber} <span className="badge badge-muted" style={{ marginLeft: 6 }}>{editingBillStatus}</span></h3>
            <button className="btn btn-sm" type="button" onClick={cancelEdit}>✕ Cancel edit / start a new bill</button>
          </div>
        ) : (
          <h3>New Repair Bill</h3>
        )}
        {editLoadError && <p className="muted" style={{ color: '#b91c1c' }}>{editLoadError}</p>}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--primary)', padding: '14px 16px', marginBottom: 18, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--primary-dark)', fontWeight: 600 }}>
            <span>🧾</span><span>Job &amp; Bill Details</span>
          </div>
        <div className="form-row">
          <div className="field">
            <label>Job No</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={jobCardNumber} readOnly placeholder="No job linked" style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => setShowJobSearch(true)} type="button">Search Job</button>
              <button className="btn btn-sm btn-icon" onClick={() => setShowMtJobGrid(true)} type="button" title="Browse job cards with a Material Transfer">🔲</button>
              {jobCardId && <button className="btn btn-sm" onClick={clearJob} type="button" title="Unlink job">✕</button>}
            </div>
          </div>
        </div>

        {jobCardId && (
          <div className="form-row" style={{ background: 'var(--surface-muted, #f8f9fa)', borderRadius: 8, padding: '10px 12px', marginBottom: 4 }}>
            <div className="field">
              <label>Job Date</label>
              <input value={jobDate ? new Date(jobDate).toLocaleDateString('en-IN') : '—'} readOnly />
            </div>
            <div className="field">
              <label>Job No.</label>
              <input value={jobCardNumber || '—'} readOnly />
            </div>
            <div className="field">
              <label>Reg No</label>
              <input value={regNo || '—'} readOnly />
            </div>
            <div className="field">
              <label>Model</label>
              <input value={vehicleModel || '—'} readOnly />
            </div>
            <div className="field">
              <label>KMs</label>
              <input value={odometer != null ? odometer.toLocaleString('en-IN') : '—'} readOnly title="Vehicle.Odometer at last update - not necessarily today's reading." />
            </div>
            <div className="field">
              <label>Chassis</label>
              <input value={chassisNo || '—'} readOnly />
            </div>
            <div className="field">
              <label>Technician</label>
              <input value={technician || '—'} readOnly title={!technician ? 'No technician assigned on this Job Card yet.' : undefined} />
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="field">
            <label>Party Name *</label>
            <input
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              placeholder="Customer or fleet party name"
              readOnly
              title={autoFilledFromJob ? 'Auto-filled from the linked Job.' : 'Search and link a Job above to fill this in.'}
            />
          </div>
          <div className="field">
            <label>Reg No</label>
            <input
              value={regNo}
              onChange={(e) => setRegNo(e.target.value)}
              readOnly
              title={autoFilledFromJob ? 'Auto-filled from the linked Job.' : 'Search and link a Job above to fill this in.'}
            />
          </div>
          <div className="field">
            <label>Chassis No</label>
            <input
              value={chassisNo}
              onChange={(e) => setChassisNo(e.target.value)}
              readOnly
              title={autoFilledFromJob ? 'Auto-filled from the linked Job.' : 'Search and link a Job above to fill this in.'}
            />
          </div>
          <div className="field">
            <label>Location</label>
            {workshops.length > 0 ? (
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled
                title={autoFilledFromJob ? 'Auto-filled from the linked Job.' : 'Search and link a Job above to fill this in.'}
              >
                <option value="">— select —</option>
                {workshops.map((w) => (
                  <option key={w.locCode} value={w.locCode}>{w.locCode} — {w.locName}</option>
                ))}
              </select>
            ) : (
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Workshop location"
                readOnly
                title={autoFilledFromJob ? 'Auto-filled from the linked Job.' : 'Search and link a Job above to fill this in.'}
              />
            )}
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>Bill Type</label>
            <select value={billType} onChange={(e) => setBillType(e.target.value)} disabled={!jobCardId}>
              <option value="Cash">Cash</option>
              <option value="Credit">Credit</option>
              <option value="Warranty">Warranty</option>
            </select>
          </div>
          <div className="field">
            <label>Bill Date</label>
            <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} disabled={!jobCardId} />
          </div>
          <div className="field">
            <label>Remarks</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!jobCardId} />
          </div>
        </div>
        {!jobCardId && (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
            Search and link a Job above to fill in the rest of this bill.
          </p>
        )}
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--accent-2)', padding: '14px 16px', marginBottom: 18, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--accent-2)', fontWeight: 600 }}>
            <span>🔧</span><span>Labour</span>
            {labourRows.length > 0 && <span className="badge badge-success">{labourRows.length}</span>}
          </div>
        <div style={{ overflowX: 'auto' }}>
        <div className="suggest-row" style={{ background: 'var(--surface-muted, #f8f9fa)', borderRadius: 8, padding: '10px 12px', flexWrap: 'nowrap' }}>
          <div className="field field-compact">
            <label>Labour</label>
            <LabourSearchInput
              labours={labourOptionsForModel}
              locationSelected={!!location}
              value={draftLabour.itemCode}
              onChangeText={(text) => setDraftLabour((p) => ({ ...p, itemCode: text }))}
              onPick={pickLabourForDraft}
              placeholder="Labour code…"
              width={140}
              disabled={!jobCardId}
            />
          </div>
          <div className="field field-compact">
            <label>Description</label>
            <LabourSearchInput
              labours={labourOptionsForModel}
              locationSelected={!!location}
              value={draftLabour.itemDescription}
              onChangeText={(text) => setDraftLabour((p) => ({ ...p, itemDescription: text }))}
              onPick={pickLabourForDraft}
              width={220}
              disabled={!jobCardId}
            />
          </div>
          <div className="field field-compact">
            <label>Qty</label>
            <input type="number" value={draftLabour.qty} onChange={(e) => setDraftLabour((p) => ({ ...p, qty: e.target.value }))} style={{ width: 70, textAlign: 'right' }} disabled={!jobCardId} />
          </div>
          <div className="field field-compact">
            <label>Rate</label>
            <input type="number" value={draftLabour.rate} onChange={(e) => setDraftLabour((p) => ({ ...p, rate: e.target.value }))} style={{ width: 90, textAlign: 'right' }} disabled={!jobCardId} />
          </div>
          <div className="field field-compact">
            <label>Disc. Type</label>
            <select value={draftLabour.discountType} onChange={(e) => setDraftLabour((p) => ({ ...p, discountType: e.target.value as DiscountType }))} disabled={!jobCardId}>
              <option value="None">None</option>
              <option value="Percentage">%</option>
              <option value="Amount">₹</option>
            </select>
          </div>
          <div className="field field-compact">
            <label>Discount</label>
            <input type="number" value={draftLabour.discountValue} onChange={(e) => setDraftLabour((p) => ({ ...p, discountValue: e.target.value }))} disabled={!jobCardId || draftLabour.discountType === 'None'} style={{ width: 90, textAlign: 'right' }} />
          </div>
          <div className="field field-compact">
            <label>Issue Type</label>
            <select value={draftLabour.issueType} onChange={(e) => setDraftLabour((p) => ({ ...p, issueType: e.target.value }))} disabled={!jobCardId}>
              <option value="">— default —</option>
              <option value="Paid">Paid</option>
              <option value="U/W">U/W </option>
              <option value="FOC">FOC</option>
            </select>
          </div>
          <div className="field field-compact">
            <label style={{ visibility: 'hidden' }}>Add</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={commitLabourDraft}
                disabled={!jobCardId || !draftLabour.itemCode.trim() || !draftLabour.itemDescription.trim()}
                title={!jobCardId ? 'Link a Job first' : !draftLabour.itemCode.trim() ? 'Pick a Labour code first.' : undefined}
              >
                {labourEditingKey ? 'Update' : '+ Add'}
              </button>
              {labourEditingKey && (
                <button className="btn btn-sm" type="button" onClick={resetDraftLabour}>Cancel</button>
              )}
            </div>
          </div>
        </div>
        </div>
        {!jobCardId && (
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
            Search and link a Job above to add Labour.
          </p>
        )}
        {vehicleModel && (
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }} title="Labour codes tagged for a different model are hidden - a code with no model tag on file still shows up regardless.">
            Labour codes filtered to {vehicleModel}
          </p>
        )}

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 70 }}>Action</th>
                <th>Sr.No</th>
                <th>Labour Code</th>
                <th>Description</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Rate</th>
                <th>HSN Code</th>
                <th className="text-end">Discount Amt.</th>
                <th>Disc.Type</th>
                <th className="text-end">CGST Amt.</th>
                <th className="text-end">SGST Amt.</th>
                <th className="text-end">IGST Amt.</th>
                <th className="text-end" title="Taxable + CGST + SGST + IGST for this line - recalculated live as you edit, finalized once you Save.">Net Amount</th>
              </tr>
            </thead>
            <tbody>
              {labourRows.map((it, i) => {
                const est = lineEstimate(it, taxMode, issueType)
                return (
                  <tr key={it.key} style={labourEditingKey === it.key ? { background: 'var(--surface-muted, #f8f9fa)' } : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {it.fromMaterialTransfer ? (
                        <button className="btn btn-icon btn-danger" type="button" onClick={() => removeMtLabour(it)} title="Remove from this bill" disabled={!jobCardId}>✕</button>
                      ) : (
                        <>
                          <button className="btn btn-icon" type="button" onClick={() => startEditLabour(it)} title="Edit" disabled={!jobCardId}>✎</button>{' '}
                          <button className="btn btn-icon btn-danger" type="button" onClick={() => removeLabour(it.key)} title="Delete" disabled={!jobCardId}>✕</button>
                        </>
                      )}
                    </td>
                    <td>{i + 1}</td>
                    <td>
                      {it.itemCode}
                      {it.fromMaterialTransfer && <><br /><span className="muted" style={{ fontSize: 10 }}>via Material Transfer{it.issueType ? ` · ${it.issueType}` : ''}</span></>}
                    </td>
                    <td>{it.itemDescription}</td>
                    <td className="text-end">{it.qty}</td>
                    <td className="text-end">₹{Number(it.rate || 0).toFixed(2)}</td>
                    <td>{it.hsnCode || '—'}</td>
                    <td className="text-end">₹{est.discountAmt.toFixed(2)}</td>
                    <td>{it.discountType === 'None' ? '—' : `${it.discountValue}${it.discountType === 'Percentage' ? '(%)' : '(RS)'}`}</td>
                    {/* 2026-10-03 ("CGST Amt. SGST Amt. IGST Amt. with this % also shown"): the %
                       actually applied to this line (already computed by lineEstimate - cgstPct/
                       sgstPct/igstPct) is now shown under each amount, same pattern
                       MaterialTransferCreatePage.tsx's own Part grid already uses for its CGST/
                       SGST/IGST Amt columns (₹ amount, then a small muted "@N%" line below it) -
                       the two pages now read the same way. Only shown when the % is actually
                       non-zero (a zero-tax line, or the side of the split that doesn't apply for
                       this tax mode, shows just the ₹0.00 with no "@0%" clutter underneath). */}
                    <td className="text-end">₹{est.cgstAmt.toFixed(2)}{est.cgstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{est.cgstPct}%</span></>}</td>
                    <td className="text-end">₹{est.sgstAmt.toFixed(2)}{est.sgstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{est.sgstPct}%</span></>}</td>
                    <td className="text-end">₹{est.igstAmt.toFixed(2)}{est.igstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{est.igstPct}%</span></>}</td>
                    <td className="text-end">₹{est.total.toFixed(2)}</td>
                  </tr>
                )
              })}
              {labourRows.length === 0 && (
                <tr><td colSpan={13} className="muted" style={{ textAlign: 'center', padding: 12 }}>No Labour lines added yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--accent-3)', padding: '14px 16px', marginBottom: 18, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--warning)', fontWeight: 600 }}>
            <span>📦</span><span>Part Details List</span>
            {partRows.length > 0 && <span className="badge" style={{ background: 'var(--accent-3-soft)', color: 'var(--warning)' }}>{partRows.length}</span>}
          </div>

        {jobCardId && mtFetchDone && materialTransferItems.length === 0 && (
          <p className="muted" style={{ color: '#b45309', margin: '0 0 10px' }}>
            ⚠ No Material Transfer found yet for this Job Card. Parts must be issued via Material
            Transfer first - they will appear here automatically once saved. You can still add
            Labour above.
          </p>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 64 }}>Action</th>
                <th>Sr.No</th>
                <th>Part No.</th>
                <th>Description</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Rate</th>
                <th>HSN Code</th>
                <th className="text-end">MRP</th>
                <th className="text-end">Discount</th>
                <th>Discount Type</th>
                <th className="text-end">CGST Amt.</th>
                <th className="text-end">SGST Amt.</th>
                <th className="text-end">IGST Amt.</th>
                <th className="text-end">Amount</th>
                <th>Issue Type</th>
                <th className="text-end">GST %</th>
              </tr>
            </thead>
            <tbody>
              {partRows.map((it, i) => {
                const est = lineEstimate(it, taxMode, issueType)
                const editing = editingPartKey === it.key
                return (
                  <tr key={it.key} style={editing ? { background: 'var(--surface-muted, #f8f9fa)' } : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-icon" type="button" onClick={() => setEditingPartKey(editing ? null : it.key)} title={editing ? 'Done' : 'Edit Discount / Issue Type'}>
                        {editing ? '✓' : '✎'}
                      </button>{' '}
                      <button className="btn btn-icon btn-danger" type="button" onClick={() => removePart(it)} title="Remove from this bill">✕</button>
                    </td>
                    <td>{i + 1}</td>
                    <td>{it.itemCode}</td>
                    <td>{it.itemDescription}</td>
                    <td className="text-end" title="Qty transferred - see the Material Transfer Bill to change it.">{it.qty}</td>
                    <td className="text-end">₹{Number(it.rate || 0).toFixed(2)}</td>
                    <td>{it.hsnCode || '—'}</td>
                    <td className="text-end">{it.mrp ? `₹${Number(it.mrp).toFixed(2)}` : '—'}</td>
                    <td className="text-end">
                      {editing ? (
                        <input type="number" value={it.discountValue} onChange={(e) => updateItem(it.key, { discountValue: e.target.value })} disabled={it.discountType === 'None'} style={{ width: 80, textAlign: 'right' }} />
                      ) : (
                        `₹${est.discountAmt.toFixed(2)}`
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <select value={it.discountType} onChange={(e) => updateItem(it.key, { discountType: e.target.value as DiscountType })}>
                          <option value="None">None</option>
                          <option value="Percentage">%</option>
                          <option value="Amount">₹</option>
                        </select>
                      ) : (
                        it.discountType === 'None' ? '—' : it.discountType
                      )}
                    </td>
                    {/* 2026-10-03 - same CGST/SGST/IGST %-under-amount treatment as the Labour
                       Details List table above. */}
                    <td className="text-end">₹{est.cgstAmt.toFixed(2)}{est.cgstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{est.cgstPct}%</span></>}</td>
                    <td className="text-end">₹{est.sgstAmt.toFixed(2)}{est.sgstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{est.sgstPct}%</span></>}</td>
                    <td className="text-end">₹{est.igstAmt.toFixed(2)}{est.igstPct > 0 && <><br /><span className="muted" style={{ fontSize: 11 }}>@{est.igstPct}%</span></>}</td>
                    <td className="text-end">₹{est.total.toFixed(2)}</td>
                    <td>
                      {editing ? (
                        <select value={it.issueType} onChange={(e) => updateItem(it.key, { issueType: e.target.value })}>
                          <option value="">— default —</option>
                          <option value="Paid">Paid (taxed)</option>
                          <option value="U/W">U/W - Under Warranty (zero tax)</option>
                          <option value="FSC">FSC - Free Service Coupon (zero tax)</option>
                          <option value="FOC">FOC - Free of Cost (zero amount)</option>
                        </select>
                      ) : (
                        it.issueType || `default (${issueType || '— none —'})`
                      )}
                    </td>
                    <td className="text-end">{it.gstPct}%</td>
                  </tr>
                )
              })}
              {partRows.length === 0 && (
                <tr><td colSpan={16} className="muted" style={{ textAlign: 'center', padding: 12 }}>No Part lines yet - these load automatically once a Material Transfer is saved for this Job.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        </div>

        {/* ---------- Insurance (2026-10-07) ----------
            "+ Add Insurance" opens the list of Insurance ledgers (Ledger Master, type Insurance); pick one, fill the policy details, then Save as Proforma / Save as Invoice as usual.
            The insurance details are saved on the bill and printed on its invoice; a bill without insurance prints in the normal format. */}
        <InsuranceSection
          enabled={showInsurance}
          onToggle={(on) => {
            setShowInsurance(on)
            if (!on) {
              setInsuranceCompanyName(''); setInsuranceDescription(''); setSurveyorName(''); setSurveyorContactNumber('')
              setPolicyNo(''); setInsuranceValidTill(''); setZeroDepreciation(false)
            }
          }}
          value={{
            companyName: insuranceCompanyName, policyNo, validTill: insuranceValidTill, surveyorName,
            surveyorContact: surveyorContactNumber, zeroDepreciation, description: insuranceDescription,
          }}
          onChange={(p) => {
            if (p.companyName !== undefined) setInsuranceCompanyName(p.companyName)
            if (p.policyNo !== undefined) setPolicyNo(p.policyNo)
            if (p.validTill !== undefined) setInsuranceValidTill(p.validTill)
            if (p.surveyorName !== undefined) setSurveyorName(p.surveyorName)
            if (p.surveyorContact !== undefined) setSurveyorContactNumber(p.surveyorContact)
            if (p.zeroDepreciation !== undefined) setZeroDepreciation(p.zeroDepreciation)
            if (p.description !== undefined) setInsuranceDescription(p.description)
          }}
          disabled={!jobCardId || editingBillStatus === 'Billed' || editingBillStatus === 'Cancelled'}
          disabledReason={!jobCardId ? 'Search and link a Job above to add Insurance.' : `This bill is already ${editingBillStatus} - its insurance can no longer be changed.`}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <span className="muted">
            {zeroTaxLineCount > 0 && <>{zeroTaxLineCount} zero-tax line{zeroTaxLineCount > 1 ? 's' : ''} - </>}
            Estimated Total: <strong>₹{estimatedTotal.toFixed(2)}</strong>
          </span>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={save} disabled={saving || !jobCardId || editingBillStatus === 'Billed' || editingBillStatus === 'Cancelled'} title={!jobCardId ? 'Link a Job first' : undefined}>
            {saving ? 'Saving…' : editingBillId ? 'Update Proforma' : 'Save as Proforma'}
          </button>
          {editingBillId && editingBillStatus === 'Performa' && (
            <button className="btn btn-sm" type="button" disabled={convertingId === editingBillId} onClick={finalizeEditingBillAsInvoice}>
              {convertingId === editingBillId ? 'Saving…' : 'Save as Invoice'}
            </button>
          )}
          {editingBillId && editingBillStatus !== 'Performa' && (
            <span className="muted" style={{ fontSize: 13 }}>This bill is already {editingBillStatus} - it can no longer be edited.</span>
          )}
        </div>
        {saveError && <p className="muted" style={{ color: '#b91c1c' }}>{saveError}</p>}
        {saveOk && <p className="muted" style={{ color: '#15803d' }}>{saveOk}</p>}
      </div>

      {showJobSearch && <JobSearchModal onSelect={selectJob} onClose={() => setShowJobSearch(false)} />}
      {showMtJobGrid && <JobSearchModal onSelect={(j) => { selectJob(j); setShowMtJobGrid(false) }} onClose={() => setShowMtJobGrid(false)} onlyWithMaterialTransfer />}
    </div>
  )
}
