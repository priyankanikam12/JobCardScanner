// web\src\pages\staff\JobCardDetailPage.tsx
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import { PasswordInput } from '../../components/PasswordInput'
import { StatusBadge } from '../../components/StatusBadge'
import { WorkflowTimeline, type WorkflowTimelineHistoryEntry } from '../../components/WorkflowTimeline'
import type { BaplDmsJobCardHistory, BaplDmsVehicleLookup, JobCardDetail, JobCardPhoto, JobCardsLabourCatalogRow, JobCardsPartsCatalogRow, RepairBillDoc, Technician, WorkflowStage } from '../../types'
import { buildEstimatePrintHtml, buildJobCardPrintHtml } from '../../lib/jobCardPrintHtml'
// 2026-10-04 ("in print button which invoice is there that was repair bill invoice ... we need to
// print in that same format"): the Invoice print option uses the DMS "GST TAX INVOICE" layout -
// see lib/repairBillInvoicePrintHtml.ts.
import { buildRepairBillTaxInvoicePrintHtml, taxInvoiceContextFromJobCard } from '../../lib/repairBillInvoicePrintHtml'

// Photo URLs come back from the API as a relative path (e.g. "/uploads/jobcard-photos/.../x.jpg" -
// see JobCardsController.UploadPhoto), same origin as the API itself, not the frontend dev server.
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL
const photoSrc = (url: string) => (url.startsWith('http') ? url : `${API_BASE_URL}${url}`)

// 2026-09-28 (SECTION 137): the part-search fetch used to use a blanket `.catch(() => setAvailableParts([]))`,
// so a REAL backend failure looked exactly like "zero parts matched your search". describeSearchError makes a
// real failure say so explicitly instead of masquerading as "not found".
function describeSearchError(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { message?: string } } }
  const detail = e?.response?.data?.message
  const status = e?.response?.status
  if (detail) return `${fallback} (${detail})`
  if (status) return `${fallback} (HTTP ${status})`
  return `${fallback} (no response reached the server - check your connection)`
}

// ---------------- Discount on Part / Labour suggestions (2026-10-07) ----------------
// A suggestion line now carries a Discount Type (None / % / ₹) and Discount Value, like the Repair Bill and Material Transfer lines. Stored on the suggestion row
// (sql/2026-10-07_jobcard_suggestion_discount.sql) and set through PUT /api/jobcards/{part|labour}-suggestions/{id}/discount.
type DiscountKind = 'None' | 'Percentage' | 'Amount'

/** discountType / discountValue of a suggestion row. Read through a loose cast so this file compiles whether or not types/index.ts declares the two fields yet. */
const discountOf = (row: unknown): { type: DiscountKind; value: number } => {
  const r = row as { discountType?: string | null; discountValue?: number | null }
  const type: DiscountKind = r.discountType === 'Percentage' || r.discountType === 'Amount' ? r.discountType : 'None'
  return { type, value: Number(r.discountValue) || 0 }
}

/** One suggestion line's money - same rule as the Repair Bill's lineEstimate: the discount comes off the line's gross (rate x qty), a % of it or a flat rupee amount and
 *  never more than the gross; an FOC (free of cost) line is 0 whatever its discount. */
function suggestionLineMoney(rate: number | null | undefined, qty: number | null | undefined, isFoc: boolean, discount: { type: DiscountKind; value: number }) {
  const gross = (Number(rate) || 0) * (Number(qty) || 0)
  if (isFoc) return { gross, discount: 0, amount: 0 }
  const raw = discount.type === 'Percentage' ? (gross * discount.value) / 100 : discount.type === 'Amount' ? discount.value : 0
  const off = Math.min(Math.max(raw, 0), gross)
  return { gross, discount: off, amount: gross - off }
}

const discountLabel = (d: { type: DiscountKind; value: number }) => (d.type === 'Percentage' ? `${d.value}%` : d.type === 'Amount' ? `₹${d.value}` : '—')

/** The Part / Labour rows of the estimate, with discount worked in - shared by the "Estimate" print and the Estimates Amount card so both always show the same numbers. */
function buildEstimateRows(jc: JobCardDetail) {
  const partRows = jc.partSuggestions.map((p, i) => {
    const mrp = p.mrp ?? 0
    const qty = p.quantity ?? 1
    const isFoc = p.status === 'FOC'
    const d = discountOf(p)
    const m = suggestionLineMoney(mrp, qty, isFoc, d)
    return { sr: i + 1, code: p.itemCode, description: p.description ?? '-', hsn: p.hsnCode ?? '-', mrp, qty, isFoc, discountText: isFoc ? 'FOC' : discountLabel(d), discount: m.discount, amount: m.amount }
  })
  const labourRows = jc.labourSuggestions.map((l, i) => {
    const rate = l.rateAtSuggestion ?? 0
    const qty = l.quantity ?? 1
    const isFoc = l.issueType === 'FOC'
    const d = discountOf(l)
    const m = suggestionLineMoney(rate, qty, isFoc, d)
    return { sr: i + 1, code: l.labourCode, description: l.labourDescription ?? '-', hsn: l.hsnCode ?? '-', rate, qty, isFoc, discountText: isFoc ? 'FOC' : discountLabel(d), discount: m.discount, amount: m.amount }
  })
  const partsTotal = partRows.reduce((sum, r) => sum + r.amount, 0)
  const labourTotal = labourRows.reduce((sum, r) => sum + r.amount, 0)
  return { partRows, labourRows, partsTotal, labourTotal, grandTotal: partsTotal + labourTotal }
}

// 2026-10-01 REMOVED (per explicit request - "Remove the cap entirely"): the ₹2000 Grand Total
// hard-stop that used to block Part/Labour Suggestion once the Estimates Amount reached a threshold.
// There is now no maximum - Part/Labour Suggestion only locks on the manual Done/Edit toggle on the
// Estimates Amount card (see EstimatesCard / `estimatesLocked` below).

/** "Set/reset customer portal password" - the dealer/admin side of the customer password login
 * (POST /api/customers/{id}/admin-reset-password), which runs alongside the customer's existing
 * OTP-based portal login. Only visible to WorkshopManager and up, matching the backend policy. This
 * SETS the password to whatever the admin/dealer types here (never reveals or "checks" the existing
 * one - only a PBKDF2 hash is ever stored), so share it with the customer directly afterwards. */
function CustomerPasswordResetButton({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [open, setOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      await staffApi.post(`/api/customers/${customerId}/admin-reset-password`, { newPassword })
      setMsg(`Password set for ${customerName}. Share it with them directly.`)
      setNewPassword('')
    } catch (err: unknown) {
      setMsg((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not set the password.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>
        Set/reset customer portal password
      </button>
    )
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div className="form-row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>New password for {customerName}</label>
          <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" minLength={8} />
        </div>
        <button type="button" className="btn btn-sm btn-primary" disabled={newPassword.length < 8 || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => { setOpen(false); setMsg(null) }}>Cancel</button>
      </div>
      {msg && <p className="muted" style={{ marginTop: 6 }}>{msg}</p>}
    </div>
  )
}

/** Of the app's 15 workflow stages (see DbSeeder's default template), these 3 are hidden from both
 * the read-only Workflow Timeline below and the Update Workflow Stage dropdown - NOT removed from the
 * backend, purely a display filter:
 *  - "job_card_created" is folded into "check_in" as one combined "Vehicle Check-In / Job Card
 *    Created" step (see buildTimelineStages);
 *  - "quality_check" and "rework" are hidden as effectively-unused stubs (nothing on this page
 *    produces or consumes them any more). */
const HIDDEN_WORKFLOW_STAGE_KEYS = new Set(['job_card_created', 'quality_check', 'rework'])
const MERGED_CHECKIN_LABEL = 'Vehicle Check-In / Job Card Created'

/** Quality Check panel toggle - see its usage below. A `const false`, not a literal `false` inline in
 * the JSX: TypeScript's control-flow narrowing of `jc` does not survive an inline
 * `{false && <QcCard jc={jc} .../>}`, so this named constant keeps the file type-checking cleanly. */
const SHOW_QUALITY_CHECK_PANEL = false

/** The WorkflowStage list actually shown in the timeline - see HIDDEN_WORKFLOW_STAGE_KEYS. */
function buildTimelineStages(stages: WorkflowStage[]): WorkflowStage[] {
  return stages
    .filter((s) => !HIDDEN_WORKFLOW_STAGE_KEYS.has(s.stageKey))
    .map((s) => (s.stageKey === 'check_in' ? { ...s, label: MERGED_CHECKIN_LABEL } : s))
}

/** Stage-history entries for the timeline, with "check_in" and "job_card_created" entries combined
 * into one - using the earliest enteredAt and latest exitedAt of the two - and "quality_check"/
 * "rework" entries dropped entirely (see HIDDEN_WORKFLOW_STAGE_KEYS). */
function buildTimelineHistory(jc: JobCardDetail): WorkflowTimelineHistoryEntry[] {
  const out: WorkflowTimelineHistoryEntry[] = []
  let merged: WorkflowTimelineHistoryEntry | null = null
  for (const h of jc.stageHistory) {
    const key = h.stage?.stageKey
    if (key === 'quality_check' || key === 'rework') continue
    if (key === 'check_in' || key === 'job_card_created') {
      if (!merged) {
        merged = { stageLabel: MERGED_CHECKIN_LABEL, enteredAt: h.enteredAt, exitedAt: h.exitedAt }
        out.push(merged)
      } else {
        if (new Date(h.enteredAt).getTime() < new Date(merged.enteredAt).getTime()) merged.enteredAt = h.enteredAt
        if (h.exitedAt && (!merged.exitedAt || new Date(h.exitedAt).getTime() > new Date(merged.exitedAt).getTime())) merged.exitedAt = h.exitedAt
      }
      continue
    }
    out.push({ stageLabel: h.stage?.label, enteredAt: h.enteredAt, exitedAt: h.exitedAt })
  }
  return out
}

/** currentStageId to pass to WorkflowTimeline: unchanged unless the job card's real current stage is
 * one of the hidden ones, in which case this redirects to the nearest earlier stage that IS still
 * shown (for "job_card_created" that's always "check_in", i.e. the merged step). */
function resolveTimelineCurrentStageId(stages: WorkflowStage[], currentStage?: WorkflowStage): string | undefined {
  if (!currentStage) return undefined
  if (!HIDDEN_WORKFLOW_STAGE_KEYS.has(currentStage.stageKey)) return currentStage.id
  const visible = stages.filter((s) => !HIDDEN_WORKFLOW_STAGE_KEYS.has(s.stageKey) && s.seq <= currentStage.seq)
  return visible.sort((a, b) => b.seq - a.seq)[0]?.id
}

/** Raw chronological stage-history log ("grid") shown below the visual Workflow Timeline stepper -
 * unlike the stepper (one row per DEFINED stage, showing only the latest visit), this shows every row
 * that's actually happened, in order, including remarks and who made each change - the audit trail of
 * what moved the job card forward and when (most stage changes are auto-triggered, see backend
 * WorkflowStageAutomation). */
function WorkflowHistoryGrid({ jc }: { jc: JobCardDetail }) {
  const rows = [...jc.stageHistory].sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime())
  if (rows.length === 0) return null
  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
  return (
    <table style={{ marginTop: 16 }}>
      <thead>
        <tr><th>Stage</th><th>Entered</th><th>Exited</th><th>Remarks</th><th>By</th></tr>
      </thead>
      <tbody>
        {rows.map((h) => (
          <tr key={h.id}>
            <td>{h.stage?.label ?? '—'}</td>
            <td>{fmt(h.enteredAt)}</td>
            <td>{fmt(h.exitedAt)}</td>
            <td>{h.notes ?? '—'}</td>
            <td>{h.changedBy?.name ?? (h.notes?.startsWith('Auto-advanced') ? 'System' : '—')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** "Print" menu - 3 options (Estimate / JobCard print / Invoice).
 *
 *   - Invoice       -> prints the DMS "GST TAX INVOICE" layout from this job card's Billed Repair Bill
 *                      (GET /api/repair-bill-docs?jobCardId=...) - see lib/repairBillInvoicePrintHtml.ts.
 *                      The data source is this app's OWN RepairBillDocs, not DMS's RepairBillHeader/Detail.
 *   - JobCard print -> buildJobCardPrintHtml; Invoice No comes from the Billed Repair Bill; Sale Date/
 *                      Battery Make/Chemical/Capacity (and any missing controller/charger/battery no.)
 *                      come from the same Vehicle Sale lookup the wizard uses - best-effort, a failed
 *                      lookup just leaves "-" for those fields.
 *   - Estimate      -> buildEstimatePrintHtml from the Part/Labour Suggestions.
 * Every option opens its print window synchronously inside the click (before any await) so the
 * browser popup blocker allows it, then fills it once data arrives. Notices/errors surface through the
 * same `setMsg` line the rest of this page uses for action feedback.
 * Role gate: none - all roles can print (2026-10-03, "For all Role its visible"). */
function PrintMenu({ jc, setMsg }: { jc: JobCardDetail; setMsg: (m: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Closes on a click OUTSIDE this container rather than via the toggle button's onBlur: a plain
  // <button> doesn't reliably take focus on click in every browser (notably Safari), so an onBlur-based
  // close raced against the click that was meant to open the menu (2026-09-03 fix).
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  /** Opens the print window immediately - must happen synchronously in the click handler, before any
   * await (once an `await` has run the browser no longer counts window.open as a direct response to the
   * click and its popup blocker refuses it). */
  const openLoadingWindow = (loadingText: string, popupBlockedMsg: string): Window | null => {
    const win = window.open('', '_blank', 'width=900,height=650')
    if (!win) { setMsg(popupBlockedMsg); return null }
    win.document.write(`<p style="font-family:sans-serif;padding:20px;color:#555;">${loadingText}</p>`)
    return win
  }
  /** Replaces the loading text with the real document and opens the native print dialog. */
  const showInWindow = (win: Window, html: string) => {
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
    win.onload = () => win.print()
  }

  /** This job card's Billed ("saved as Invoice") Repair Bill, if any. */
  const fetchBilledBill = async (): Promise<RepairBillDoc | undefined> => {
    const { data } = await staffApi.get<RepairBillDoc[]>('/api/repair-bill-docs', { params: { jobCardId: jc.id } })
    return data.find((b) => b.status === 'Billed')
  }

  const printEstimate = () => {
    setOpen(false)
    const win = openLoadingWindow('Preparing estimate…', 'Please allow popups to print the estimate.')
    if (!win) return
    // Amounts are net of each line's discount (and 0 for FOC). The print layout has no Discount column, so a discounted line says so in its description.
    const est = buildEstimateRows(jc)
    const withDiscountNote = (description: string, discount: number) => (discount > 0 ? `${description} (discount -₹${discount.toFixed(2)})` : description)
    const partRows = est.partRows.map((r) => ({ sr: r.sr, code: r.code, description: withDiscountNote(r.description, r.discount), hsn: r.hsn, mrp: r.mrp, qty: r.qty, amount: r.amount }))
    const labourRows = est.labourRows.map((r) => ({ sr: r.sr, code: r.code, description: withDiscountNote(r.description, r.discount), hsn: r.hsn, rate: r.rate, qty: r.qty, amount: r.amount }))
    const partsTotal = est.partsTotal
    const labourTotal = est.labourTotal
    showInWindow(win, buildEstimatePrintHtml({
      dealerName: jc.dealer?.name,
      dealerCode: jc.dealer?.code,
      jobCardNumber: jc.jobCardNumber,
      printDate: jc.createdAt ? new Date(jc.createdAt).toLocaleDateString('en-GB') : '-',
      customerName: jc.customer?.name,
      customerMobile: jc.customer?.mobile,
      address: jc.customer?.address,
      city: jc.customer?.city,
      vehicleModel: jc.vehicle?.model,
      vehicleVariant: jc.vehicle?.variant,
      registerNo: jc.vehicle?.regNo,
      chassisNo: jc.vehicle?.vin,
      odometer: jc.odometerAtCheckIn,
      partRows,
      labourRows,
      partsTotal,
      labourTotal,
      grandTotal: partsTotal + labourTotal,
    }))
  }

  const printJobCard = async () => {
    setOpen(false)
    setBusy(true)
    setMsg(null)
    const win = openLoadingWindow('Preparing job card…', 'Please allow popups to print the job card.')
    if (!win) { setBusy(false); return }
    try {
      const vin = jc.vehicle?.vin
      // Both lookups are best-effort and independent - a failure in either just leaves its fields "-".
      const [billed, lookup] = await Promise.all([
        fetchBilledBill().catch(() => undefined),
        vin
          ? staffApi.get<BaplDmsVehicleLookup>('/api/jobcards/vehicle-lookup', { params: { value: vin, dealerId: jc.dealer?.id } })
              .then((r) => r.data)
              .catch(() => undefined)
          : Promise.resolve(undefined),
      ])
      // Not every app type declares these two yet - loose reads, same approach as the invoice context.
      const customerState = (jc.customer as unknown as { state?: string | null } | null | undefined)?.state
      const purchaseDate = (jc.vehicle as unknown as { purchaseDate?: string | null } | null | undefined)?.purchaseDate

      showInWindow(win, buildJobCardPrintHtml({
        dealerName: jc.dealer?.name,
        dealerCode: jc.dealer?.code,
        location: jc.baplServiceLocation,
        jobinDate: jc.createdAt ?? new Date().toISOString(),
        jobtype: jc.baplJobType,
        jobsource: jc.baplJobSourceName,
        serviceHead: jc.baplServiceHeadName,
        serviceType: jc.baplServiceTypeName,
        estdelDate: jc.expectedDeliveryAt,
        vehiclekms: jc.odometerAtCheckIn,
        manualjobNo: jc.baplManualJobNo,
        supervisor: jc.baplSupervisorName,
        technician: jc.assignedTechnicianName ?? jc.baplTechnicianName,
        customerName: jc.customer?.name,
        customerMobile: jc.customer?.mobile,
        customerState, // needs the customerState edit in lib/jobCardPrintHtml.ts
        address: jc.customer?.address,
        city: jc.customer?.city,
        chassisNo: jc.vehicle?.vin,
        batteryNo: jc.vehicle?.batteryNo ?? lookup?.batteryNumber,
        chargerNo: jc.vehicle?.chargerNo ?? lookup?.chargerNumber,
        controllerNo: jc.vehicle?.controllerNo ?? lookup?.controllerNo,
        registerNo: jc.vehicle?.regNo,
        modelName: jc.vehicle?.model,
        colour: jc.vehicle?.color,
        saleDate: lookup?.saleDate ?? purchaseDate,
        insuranceExpiry: jc.vehicle?.insuranceExpiry ?? lookup?.insuranceExpDate,
        batteryChemical: lookup?.batteryChemical,
        batteryCapacity: lookup?.batteryCapacity,
        batteryMake: lookup?.batteryMake,
        complaints: jc.complaints.map((c) => c.description),
        jobNo: jc.baplJobNo != null ? String(jc.baplJobNo) : jc.jobCardNumber,
        // The header's "Invoice No" is the Billed Repair Bill's number (this app's invoices live in
        // RepairBillDocs); jc.invoice is the legacy Invoice record, kept only as a fallback.
        invoiceNo: billed?.billNumber ?? jc.invoice?.invoiceNumber,
      }))
    } catch {
      win.close()
      setMsg('Could not prepare the job card for printing. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const printInvoice = async () => {
    setOpen(false)
    setBusy(true)
    setMsg(null)
    const win = openLoadingWindow('Loading invoice…', 'Please allow popups to view/print the invoice.')
    if (!win) { setBusy(false); return }
    try {
      const billed = await fetchBilledBill()
      if (!billed) {
        win.close()
        setMsg('No Repair Bill has been saved as Invoice for this job card yet.')
        return
      }
      showInWindow(win, buildRepairBillTaxInvoicePrintHtml(billed, taxInvoiceContextFromJobCard(jc)))
    } catch (err: unknown) {
      win.close()
      // 2026-10-05: a 403 means this login's role isn't allowed to read repair bills at all (the Invoice
      // option needs GET /api/repair-bill-docs); say so, with the code, instead of "try again".
      const e = err as { response?: { status?: number; data?: { message?: string } } }
      const status = e?.response?.status
      setMsg(
        status === 403 ? 'Your login is not allowed to read Repair Bills (HTTP 403), so the invoice cannot be opened - ask an admin to allow your role.'
        : `Could not load the invoice for this job card${status ? ` (HTTP ${status})` : ''}${e?.response?.data?.message ? ` - ${e.response.data.message}` : ''}.`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn"
        style={{ border: '1px solid var(--border)' }}
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
      >
        🖨️ {busy ? 'Opening…' : 'Print'} ▾
      </button>
      {open && (
        <ul style={{
          position: 'absolute', zIndex: 10, top: '100%', right: 0, marginTop: 2, minWidth: 160,
          background: 'var(--card-bg, #fff)', border: '1px solid var(--border)', borderRadius: 8,
          listStyle: 'none', padding: 4, boxShadow: '0 6px 18px rgba(0,0,0,.12)',
        }}>
          <li><button type="button" className="btn btn-sm" style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }} onMouseDown={(e) => { e.preventDefault(); printEstimate() }}>Estimate</button></li>
          <li><button type="button" className="btn btn-sm" style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }} onMouseDown={(e) => { e.preventDefault(); printJobCard() }}>JobCard print</button></li>
          <li><button type="button" className="btn btn-sm" style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }} onMouseDown={(e) => { e.preventDefault(); printInvoice() }}>Invoice</button></li>
        </ul>
      )}
    </div>
  )
}

export function JobCardDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile, hasRole } = useStaffAuth()
  const [jc, setJc] = useState<JobCardDetail | null>(null)
  const [stages, setStages] = useState<WorkflowStage[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // Estimates Amount "Done"/"Edit" toggle - lifted up here (rather than local to EstimatesCard) because
  // "Done" also hides PartSuggestionCard/LabourSuggestionCard's add-new-suggestion forms, not just
  // EstimatesCard's own UI. See EstimatesCard.
  const [estimatesLocked, setEstimatesLocked] = useState(false)

  const load = async () => {
    if (!id) return
    const [jcRes, stagesRes] = await Promise.all([
      staffApi.get<JobCardDetail>(`/api/jobcards/${id}`),
      staffApi.get<WorkflowStage[]>('/api/workflow-stages'),
    ])
    setJc(jcRes.data)
    setStages(stagesRes.data)
  }

  useEffect(() => { load() }, [id])

  // "Continue to Job Card" after creation links straight to /jobcards/{id}#workflow-timeline, and a job
  // card's photo count on the list page links straight to /jobcards/{id}#photos. Both scroll that
  // section into view once the page (and the matching id) has actually rendered, rather than relying on
  // the browser's own same-navigation hash scroll (which can miss it since the content loads async).
  const scrolledToHashRef = useRef(false)
  useEffect(() => {
    if (scrolledToHashRef.current || !jc || !window.location.hash) return
    const el = document.getElementById(window.location.hash.slice(1))
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      scrolledToHashRef.current = true
    }
  }, [jc])

  if (!jc) return <p className="muted">Loading...</p>

  const run = async (fn: () => Promise<unknown>, successMsg?: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      await load()
      if (successMsg) setMsg(successMsg)
    } catch (err: unknown) {
      // Surface both the friendly message and the raw exception detail when the backend sends one (see
      // JobCardsController.AddPartSuggestion/AddLabourSuggestion's catch blocks) - this is what tells
      // apart "migration wasn't run against this database" from a genuinely new bug.
      const data = (err as { response?: { data?: { message?: string; detail?: string } } })?.response?.data
      setMsg(data ? [data.message, data.detail].filter(Boolean).join(' — ') || 'Action failed.' : 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{jc.jobCardNumber}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PrintMenu jc={jc} setMsg={setMsg} />
          <StatusBadge status={jc.status} />
        </div>
      </div>
      {msg && <p className="muted">{msg}</p>}

      <div className="form-row" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Customer & Vehicle</h3>
          <p><strong>{jc.customer?.name}</strong><br />{jc.customer?.mobile}</p>
          <p>{jc.vehicle?.model} {jc.vehicle?.variant}<br />Reg: {jc.vehicle?.regNo} | Odometer: {jc.odometerAtCheckIn} km</p>
          <p className="muted" style={{ marginTop: 2 }}>
            Technician: <strong>{jc.assignedTechnicianName || 'Not assigned yet'}</strong>
          </p>
          {jc.customer && hasRole('WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && (
            <CustomerPasswordResetButton customerId={jc.customer.id} customerName={jc.customer.name} />
          )}
          {(jc.baplJobType || jc.baplServiceLocation || jc.baplSupervisorName || jc.baplTechnicianName || jc.baplManualJobNo) && (
            <p className="muted" style={{ marginTop: 8 }}>
              <span style={{ background: '#1c64f2', color: '#fff', fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 999, marginRight: 6 }}>
                Details
              </span>
              {[
                jc.baplJobType && `Job Type: ${jc.baplJobType}`,
                jc.baplServiceHeadName && `Service Head: ${jc.baplServiceHeadName}`,
                jc.baplServiceTypeName && `Service Type: ${jc.baplServiceTypeName}`,
                jc.baplJobSourceName && `Source: ${jc.baplJobSourceName}`,
                jc.baplServiceLocation && `Location: ${jc.baplServiceLocation}`,
                jc.baplSupervisorName && `Supervisor: ${jc.baplSupervisorName}`,
                jc.baplTechnicianName && `Technician: ${jc.baplTechnicianName}`,
                jc.baplManualJobNo && `Manual Job No.: ${jc.baplManualJobNo}`,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
          {jc.baplSyncStatus === 'Synced' && jc.baplJobCardHeaderId && (
            <p className="muted" style={{ marginTop: 4 }}>
              ✅ Synced to DMS as{' '}
              <a href={`/jobcards/bapl/${jc.baplJobCardHeaderId}`}>
                {jc.baplJobNo != null ? `job card #${jc.baplJobNo}` : 'a job card (DMS sync pending)'}
              </a>.
            </p>
          )}
          {jc.baplSyncStatus === 'Failed' && (
            <p className="error-text" style={{ marginTop: 4 }}>
              ⚠ Not yet synced to DMS{jc.baplSyncError ? `: ${jc.baplSyncError}` : '.'}
            </p>
          )}
        </div>

        <div className="card" id="workflow-timeline">
          <h3>Workflow Timeline</h3>
          <WorkflowTimeline
            stages={buildTimelineStages(stages)}
            currentStageId={resolveTimelineCurrentStageId(stages, jc.currentStage)}
            history={buildTimelineHistory(jc)}
          />
          <WorkflowHistoryGrid jc={jc} />
        </div>
      </div>

      {hasRole('ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && (
        <UpdateWorkflowStageCard jc={jc} stages={stages} busy={busy} run={run} canAssignTechnician={hasRole('ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin')} />
      )}

      <ComplaintsCard jc={jc} run={run} />
      <PhotosCard jc={jc} run={run} />
      <WorklogCard jc={jc} run={run} profileId={profile?.id} />
      {SHOW_QUALITY_CHECK_PANEL && hasRole('WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && <QcCard jc={jc} run={run} />}
      <PartSuggestionCard jc={jc} run={run} estimatesLocked={estimatesLocked} />
      <LabourSuggestionCard jc={jc} run={run} estimatesLocked={estimatesLocked} />
      <EstimatesCard jc={jc} run={run} estimatesLocked={estimatesLocked} setEstimatesLocked={setEstimatesLocked} />
    </div>
  )
}

/** DMS's own service/job-card history for this vehicle's chassis (GET /api/bapl-dms/service-history) -
 * a read-only reference panel, kept but currently unused (not rendered above). */
function BaplServiceHistoryCard({ chassisNo, dealerCode }: { chassisNo?: string | null; dealerCode?: string | null }) {
  const [rows, setRows] = useState<BaplDmsJobCardHistory[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRows(null)
    setError(null)
    if (!chassisNo) return
    staffApi.get<BaplDmsJobCardHistory[]>('/api/bapl-dms/service-history', { params: { chassisNo, dealerCode: dealerCode || undefined } })
      .then(({ data }) => setRows(data))
      .catch((err) => {
        const msg = err?.response?.data?.message
        if (err?.response?.status === 502) setError(msg ?? 'Could not reach DMS.')
        setRows([])
      })
  }, [chassisNo, dealerCode])

  if (!chassisNo) return null

  return (
    <div className="card">
      <h3>DMS Service History</h3>
      {error && <p className="muted">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows !== null && rows.length === 0 && !error && <p className="muted">No prior DMS job cards found for this chassis.</p>}
      {rows !== null && rows.length > 0 && (
        <table>
          <thead>
            <tr><th>Job No.</th><th>Date</th><th>Status</th><th>Inward Type</th><th>Km</th><th>Complaints</th><th>Supervisor / Technician</th><th>Invoice No.</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.jobCardHeaderId}>
                <td>{r.jobPrefix}{r.jobNo}</td>
                <td>{r.jobInDate ? new Date(r.jobInDate).toLocaleDateString() : '-'}</td>
                <td>{r.jobStatus ?? '-'}</td>
                <td>{r.inwardType ?? '-'}</td>
                <td>{r.vehicleKms ?? '-'}</td>
                <td>{r.complaints ?? '-'}</td>
                <td>{r.supervisor ?? '-'} / {r.technician ?? '-'}</td>
                <td>{r.invoiceNo ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Photo capture + upload, added to the Job Card Detail page. */
function PhotosCard({ jc, run }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>, successMsg?: string) => void }) {
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [locationNote, setLocationNote] = useState<string | null>(null)
  const [captionEdits, setCaptionEdits] = useState<Record<string, string>>({})
  const [savingCaptionId, setSavingCaptionId] = useState<string | null>(null)

  const getLocation = (): Promise<GeolocationPosition | null> =>
    new Promise((resolve) => {
      if (!('geolocation' in navigator)) { resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
      )
    })

  const onFileChosen = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setLocationNote('Getting location…')
    try {
      const pos = await getLocation()
      setLocationNote(pos ? `Location captured (±${Math.round(pos.coords.accuracy)}m)` : 'Location unavailable - uploading without it')

      const form = new FormData()
      form.append('File', file)
      form.append('Stage', 'CheckIn')
      if (caption) form.append('Caption', caption)
      if (pos) {
        form.append('Latitude', String(pos.coords.latitude))
        form.append('Longitude', String(pos.coords.longitude))
      }

      await run(() => staffApi.post(`/api/jobcards/${jc.id}/photos/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } }), 'Photo uploaded.')
      setCaption('')
    } finally {
      setUploading(false)
      setLocationNote(null)
    }
  }

  const saveCaption = async (photoId: string) => {
    const value = captionEdits[photoId] ?? ''
    setSavingCaptionId(photoId)
    try {
      await run(() => staffApi.put(`/api/jobcards/photos/${photoId}`, { caption: value || null }))
    } finally {
      setSavingCaptionId(null)
    }
  }

  return (
    <div className="card" id="photos">
      <h3>Photos</h3>
      <div className="form-row">
        <div className="field">
          <label>Caption (optional)</label>
          <input disabled={uploading} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Left mirror scratch" />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label className="btn btn-sm btn-primary" style={{ cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
          {uploading ? 'Uploading…' : 'Take / Upload Photo'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={uploading}
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFileChosen(f) }}
          />
        </label>
        {locationNote && <span className="muted">{locationNote}</span>}
      </div>

      {jc.photos.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          {jc.photos.map((p) => (
            <div key={p.id} style={{ width: 180 }}>
              <a href={photoSrc(p.url)} target="_blank" rel="noreferrer">
                <img src={photoSrc(p.url)} alt={p.caption ?? 'Job card photo'} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6, border: '1px solid #ddd' }} />
              </a>
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <input
                  value={captionEdits[p.id] ?? p.caption ?? ''}
                  onChange={(e) => setCaptionEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder="Add a caption…"
                  style={{ fontSize: 12, padding: '4px 6px' }}
                  disabled={savingCaptionId === p.id}
                />
                <button
                  className="btn btn-sm"
                  style={{ fontSize: 11, padding: '4px 8px' }}
                  disabled={savingCaptionId === p.id || (captionEdits[p.id] ?? p.caption ?? '') === (p.caption ?? '')}
                  onClick={() => saveCaption(p.id)}
                >
                  {savingCaptionId === p.id ? 'Saving…' : 'Save'}
                </button>
              </div>
              {p.latitude != null && p.longitude != null && (
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                  <a href={`https://maps.google.com/?q=${p.latitude},${p.longitude}`} target="_blank" rel="noreferrer">📍 {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</a>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UpdateWorkflowStageCard({
  jc, stages, busy, run, canAssignTechnician,
}: {
  jc: JobCardDetail
  stages: WorkflowStage[]
  busy: boolean
  run: (fn: () => Promise<unknown>, successMsg?: string) => void
  canAssignTechnician: boolean
}) {
  const [technicianName, setTechnicianName] = useState(jc.assignedTechnicianName ?? '')
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState(jc.expectedDeliveryAt ? jc.expectedDeliveryAt.slice(0, 16) : '')
  const [notes, setNotes] = useState('')
  const [technicianOptions, setTechnicianOptions] = useState<Technician[]>([])

  useEffect(() => {
    setTechnicianName(jc.assignedTechnicianName ?? '')
    setExpectedDeliveryAt(jc.expectedDeliveryAt ? jc.expectedDeliveryAt.slice(0, 16) : '')
  }, [jc.id, jc.assignedTechnicianName, jc.expectedDeliveryAt])

  useEffect(() => {
    staffApi.get<Technician[]>('/api/technicians', { params: { dealerId: jc.dealer?.id, locationCode: jc.baplServiceLocationCode || undefined } })
      .then(({ data }) => setTechnicianOptions(data))
      .catch(() => setTechnicianOptions([]))
  }, [jc.dealer?.id, jc.baplServiceLocationCode])

  const saveDetails = () => staffApi.put(`/api/jobcards/${jc.id}`, {
    assignedTechnicianName: technicianName || null,
    expectedDeliveryAt: expectedDeliveryAt || null,
  })

  const currentSeq = jc.currentStage?.seq ?? -1
  const repairCompletedStage = stages.find((s) => s.stageKey === 'repair_completed')
  const readyForDeliveryStage = stages.find((s) => s.stageKey === 'ready_for_delivery')
  const invoiceGeneratedStage = stages.find((s) => s.stageKey === 'invoice_generated')
  const markStage = (stage?: WorkflowStage) => {
    if (!stage) return Promise.resolve()
    return staffApi.post(`/api/jobcards/${jc.id}/stage`, { stageId: stage.id, notes: notes || null })
  }

  return (
    <div className="card">
      <h3>Update Workflow Stage</h3>
      {!jc.assignedTechnicianName && (
        <p className="error-text" style={{ marginTop: -4 }}>
          ⚠ No Technician assigned yet - every stage update (including the automatic ones above)
          will be refused until one is set below.
        </p>
      )}
      {canAssignTechnician && (
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <label>Assign Technician</label>
            <select disabled={busy} value={technicianName} onChange={(e) => setTechnicianName(e.target.value)}>
              <option value="">{technicianOptions.length ? 'Select technician…' : 'No Technician set up for this location yet'}</option>
              {technicianName && !technicianOptions.some((t) => t.name === technicianName) && (
                <option value={technicianName}>{technicianName} (not in this location's list)</option>
              )}
              {technicianOptions.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Expected Completion</label>
            <input type="datetime-local" disabled={busy} value={expectedDeliveryAt} onChange={(e) => setExpectedDeliveryAt(e.target.value)} />
          </div>
          <div className="field">
            <button className="btn btn-sm" disabled={busy} onClick={() => run(saveDetails, 'Technician & completion date updated.')}>Save</button>
          </div>
        </div>
      )}
      <div className="field">
        <label>Remarks (attached to the buttons below)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Stage remarks…" />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {repairCompletedStage && (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || currentSeq >= repairCompletedStage.seq}
            onClick={() => run(() => markStage(repairCompletedStage), 'Marked Repair Completed.')}
          >
            Mark Repair Completed
          </button>
        )}
        {invoiceGeneratedStage && (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || currentSeq >= invoiceGeneratedStage.seq}
            onClick={() => run(() => markStage(invoiceGeneratedStage), 'Marked Invoice Generated. Job card closed.')}
          >
            Mark Invoice Generated
          </button>
        )}
        {readyForDeliveryStage && (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || currentSeq >= readyForDeliveryStage.seq}
            onClick={() => run(() => markStage(readyForDeliveryStage), 'Marked Ready for Delivery.')}
          >
            Mark Ready for Delivery
          </button>
        )}
      </div>
    </div>
  )
}

function ComplaintsCard({ jc, run }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>) => void }) {
  const [text, setText] = useState('')
  return (
    <div className="card">
      <h3>Complaints & Inspection</h3>
      <ul>{jc.complaints.map((c) => <li key={c.id}>{c.description}</li>)}</ul>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add complaint" />
        <button className="btn btn-sm btn-primary" onClick={() => { run(() => staffApi.post(`/api/jobcards/${jc.id}/inspections`, { component: 'General', condition: 'NeedsAttention', notes: text })); setText('') }}>Log Inspection Note</button>
      </div>
      {jc.inspections.length > 0 && (
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Component</th><th>Condition</th><th>Notes</th></tr></thead>
          <tbody>{jc.inspections.map((i) => <tr key={i.id}><td>{i.component}</td><td>{i.condition}</td><td>{i.notes}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  )
}

const IST_TIME_ZONE = 'Asia/Kolkata'
const parseUtcIso = (iso: string): Date => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
const formatIST = (iso: string, opts: Intl.DateTimeFormatOptions) => parseUtcIso(iso).toLocaleString('en-IN', { timeZone: IST_TIME_ZONE, ...opts })
const formatISTTime = (iso: string) => formatIST(iso, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
const formatISTDateTime = (iso: string) => formatIST(iso, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })

function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

const hasOpenWorklog = (jc: JobCardDetail) => jc.worklogs.some((w) => !w.endedAt)

function WorklogCard({ jc, run, profileId }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>) => void; profileId?: string }) {
  const openLog = jc.worklogs.find((w) => !w.endedAt)

  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!openLog) return
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [openLog?.id])

  useEffect(() => {
    if (jc.status === 'Closed' && openLog) {
      run(() => staffApi.post(`/api/jobcards/worklogs/${openLog.id}/end`, {}))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jc.status, openLog?.id])

  const startTimer = () => run(() => staffApi.post(`/api/jobcards/${jc.id}/worklogs/start`, { technicianId: profileId, taskDescription: 'Service work' }))
  const stopTimer = () => { if (openLog) run(() => staffApi.post(`/api/jobcards/worklogs/${openLog.id}/end`, {})) }

  return (
    <div className="card">
      <h3>Technician Work Log</h3>
      {openLog ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <p className="muted" style={{ margin: 0 }}>
            ⏱ Timer running since {formatISTTime(openLog.startedAt)} IST - running for{' '}
            {formatElapsedMs(nowMs - parseUtcIso(openLog.startedAt).getTime())}.
          </p>
          <button className="btn btn-sm" style={{ background: '#dc2626', color: '#fff', border: '1px solid #dc2626' }} onClick={stopTimer}>■ Stop Timer</button>
        </div>
      ) : jc.status === 'Closed' ? (
        <p className="muted">Timer stopped - this job card is closed.</p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <p className="muted" style={{ margin: 0 }}>Timer isn't running. Start it before adding Part/Labour suggestions.</p>
          <button className="btn btn-sm btn-primary" onClick={startTimer}>▶ Start Timer</button>
        </div>
      )}
      <table style={{ marginTop: 12 }}>
        <thead><tr><th>Started (IST)</th><th>Ended (IST)</th><th>Duration (min)</th></tr></thead>
        <tbody>{jc.worklogs.map((w) => <tr key={w.id}><td>{formatISTDateTime(w.startedAt)}</td><td>{w.endedAt ? formatISTDateTime(w.endedAt) : '-'}</td><td>{w.durationMinutes ?? '-'}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function QcCard({ jc, run }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>) => void }) {
  const [item, setItem] = useState('')
  const DEFAULT_ITEMS = ['Brakes', 'Battery Health', 'Lights & Indicators', 'Tyre Condition', 'Motor Sound']
  return (
    <div className="card">
      <h3>Quality Check</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {DEFAULT_ITEMS.map((name) => (
          <button key={name} className="btn btn-sm" onClick={() => run(() => staffApi.post(`/api/jobcards/${jc.id}/qc-items`, { itemName: name, passed: true }))}>
            Mark "{name}" Pass
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Custom QC item" />
        <button className="btn btn-sm" onClick={() => { run(() => staffApi.post(`/api/jobcards/${jc.id}/qc-items`, { itemName: item, passed: true })); setItem('') }}>Add & Pass</button>
      </div>
      <table style={{ marginTop: 12 }}>
        <thead><tr><th>Item</th><th>Result</th></tr></thead>
        <tbody>{jc.qcChecklistItems.map((q) => <tr key={q.id}><td>{q.itemName}</td><td>{q.passed === true ? 'Pass' : q.passed === false ? 'Fail' : 'Pending'}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function EstimatesCard({
  jc, estimatesLocked, setEstimatesLocked,
}: {
  jc: JobCardDetail
  run: (fn: () => Promise<unknown>) => void
  estimatesLocked: boolean
  setEstimatesLocked: (v: boolean) => void
}) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [emailMsg, setEmailMsg] = useState<string | null>(null)

  const sendEmail = async () => {
    if (!email.trim()) { setEmailMsg('Enter an email address first.'); return }
    setSending(true)
    setEmailMsg(null)
    try {
      const { data } = await staffApi.post<{ message: string }>(`/api/jobcards/${jc.id}/estimates/email`, { email: email.trim() })
      setEmailMsg(data.message)
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string } } })?.response?.data
      setEmailMsg(data?.message ?? 'Could not send the email.')
    } finally {
      setSending(false)
    }
  }

  const money = (n: number) => `₹${n.toFixed(2)}`

  // 2026-10-07: amounts are net of each line's discount (and 0 for FOC) - see buildEstimateRows.
  const { partRows, labourRows, partsTotal, labourTotal, grandTotal } = buildEstimateRows(jc)
  const closed = jc.status === 'Closed'

  return (
    <div className="card">
      <h3>Estimates Amount</h3>

      <h4>Part Details</h4>
      <table>
        <thead><tr><th>Sr no.</th><th>Item Code</th><th>Description</th><th>HSN</th><th>MRP</th><th>Qty</th><th>Discount</th><th>Amount</th></tr></thead>
        <tbody>
          {partRows.map((r) => (
            <tr key={r.sr}>
              <td>{r.sr}</td><td>{r.code}</td><td>{r.description}</td><td>{r.hsn}</td>
              <td>{money(r.mrp)}</td><td>{r.qty}</td>
              <td>{r.discountText}{r.discount > 0 && <span className="muted"> (−{money(r.discount)})</span>}</td>
              <td>{money(r.amount)}</td>
            </tr>
          ))}
          {partRows.length === 0 && <tr><td colSpan={8} className="muted">No parts suggested yet.</td></tr>}
        </tbody>
        {partRows.length > 0 && (
          <tfoot><tr><td colSpan={7} style={{ textAlign: 'right', fontWeight: 600 }}>Parts Total</td><td style={{ fontWeight: 600 }}>{money(partsTotal)}</td></tr></tfoot>
        )}
      </table>

      <h4 style={{ marginTop: 16 }}>Labour Details</h4>
      <table>
        <thead><tr><th>Sr no.</th><th>Labour Code</th><th>Description</th><th>HSN</th><th>MRP (Rate)</th><th>Qty</th><th>Discount</th><th>Amount</th></tr></thead>
        <tbody>
          {labourRows.map((r) => (
            <tr key={r.sr}>
              <td>{r.sr}</td><td>{r.code}</td><td>{r.description}</td><td>{r.hsn}</td>
              <td>{money(r.rate)}</td><td>{r.qty}</td>
              <td>{r.discountText}{r.discount > 0 && <span className="muted"> (−{money(r.discount)})</span>}</td>
              <td>{money(r.amount)}</td>
            </tr>
          ))}
          {labourRows.length === 0 && <tr><td colSpan={8} className="muted">No labour suggested yet.</td></tr>}
        </tbody>
        {labourRows.length > 0 && (
          <tfoot><tr><td colSpan={7} style={{ textAlign: 'right', fontWeight: 600 }}>Labour Total</td><td style={{ fontWeight: 600 }}>{money(labourTotal)}</td></tr></tfoot>
        )}
      </table>

      <div style={{
        marginTop: 16, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12,
        borderTop: '2px solid var(--border)', paddingTop: 10, flexWrap: 'wrap',
      }}>
        <strong style={{ fontSize: 16 }}>Grand Total</strong>
        <strong style={{ fontSize: 18 }}>{money(grandTotal)}</strong>
        {!closed && (
          estimatesLocked ? (
            <button
              className="btn btn-sm"
              onClick={() => { setEstimatesLocked(false); setEmailMsg(null) }}
            >
              Edit
            </button>
          ) : (
            <button
              className="btn btn-sm"
              style={{ background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }}
              onClick={() => setEstimatesLocked(true)}
            >
              Done
            </button>
          )
        )}
      </div>
      {estimatesLocked && !closed && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Customer email address…"
            style={{ minWidth: 240 }}
          />
          <button className="btn btn-sm btn-primary" disabled={sending} onClick={sendEmail}>
            {sending ? 'Sending…' : 'Send Estimate'}
          </button>
        </div>
      )}
      {emailMsg && <p className="muted" style={{ textAlign: 'right', marginTop: 6 }}>{emailMsg}</p>}
    </div>
  )
}

// ---------------- Part Suggestion helpers (2026-10-06) ----------------
// GST % and stock shown next to each part. GET /api/jobcards/parts-catalog returns sgst / cgst / igst, availableQty
// (the part's Part Upload balance COMBINED across every location this login may access - e.g. 17 + 10 = 27 for a login
// with access to both workshops; a login restricted to one location sees that location's own quantity) and
// stockByLocation [{ locationCode, qty }]. Read loosely (a cast) so this file keeps compiling whatever fields
// JobCardsPartsCatalogRow already declares in types.

type PartCatalogRow = JobCardsPartsCatalogRow & {
  sgst?: number | null
  cgst?: number | null
  igst?: number | null
  stockByLocation?: { locationCode: string; qty: number }[] | null
}

/** GST % of a parts-catalog row: SGST + CGST when present, otherwise IGST ('—' for an upload-only part, which carries no GST rate). */
function partGstText(p: JobCardsPartsCatalogRow): string {
  const g = p as PartCatalogRow
  const split = (g.sgst ?? 0) + (g.cgst ?? 0)
  const total = split > 0 ? split : (g.igst ?? 0)
  return total > 0 ? `${total}%` : '—'
}

/** "avail. 27" - the combined balance (see above). */
function partAvailText(p: JobCardsPartsCatalogRow): string {
  return `avail. ${p.availableQty ?? '—'}`
}

/** Where the balance is held: "Stock: CUS0270W1 17 + CUS0270W3 10 = 27" (one location: "Stock: CUS0270W1 17"; none: "Available 0"). */
function partStockLines(p: JobCardsPartsCatalogRow): string {
  const x = p as PartCatalogRow
  const parts = (x.stockByLocation ?? []).map((s) => `${s.locationCode || '—'} ${s.qty}`)
  if (parts.length === 0) return `Available ${x.availableQty ?? 0}`
  return parts.length === 1 ? `Stock: ${parts[0]}` : `Stock: ${parts.join(' + ')} = ${x.availableQty ?? 0}`
}

function PartSuggestionCard({ jc, run, estimatesLocked }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>, successMsg?: string) => void; estimatesLocked: boolean }) {
  const [availableParts, setAvailableParts] = useState<JobCardsPartsCatalogRow[]>([])
  const [search, setSearch] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [itemCode, setItemCode] = useState('')
  const [qty, setQty] = useState<number>(1)
  const [status, setStatus] = useState<'Paid' | 'U/W' | 'FOC'>('Paid')
  const [searchError, setSearchError] = useState<string | null>(null)
  // 2026-10-07: discount of the line being added, and of an already-added line being edited
  const [discountType, setDiscountType] = useState<DiscountKind>('None')
  const [discountValue, setDiscountValue] = useState('0')
  const [editing, setEditing] = useState<{ id: string; type: DiscountKind; value: string } | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = search.trim()
      if (trimmed.length === 0) { setAvailableParts([]); setSearchError(null); return }
      // No locationCode: the quantity is the combined Part Upload balance across the locations this login may access.
      staffApi.get<JobCardsPartsCatalogRow[]>('/api/jobcards/parts-catalog', { params: { q: trimmed } })
        .then(({ data }) => { setAvailableParts(data); setSearchError(null) })
        .catch((err) => {
          setAvailableParts([])
          setSearchError(describeSearchError(err, 'Search failed'))
        })
    }, 300)
    return () => clearTimeout(handle)
  }, [search])

  const [selectedPart, setSelectedPart] = useState<JobCardsPartsCatalogRow | null>(null)
  const q = search.trim()
  const matches = availableParts.slice(0, 20)

  const pickPart = (p: JobCardsPartsCatalogRow) => {
    setItemCode(p.itemCode)
    setSelectedPart(p)
    setSearch(`${p.itemCode}${p.description ? ' - ' + p.description : ''}`)
    setShowSuggestions(false)
  }

  const addSuggestion = async () => {
    const { data: created } = await staffApi.post<{ id: string }>(`/api/jobcards/${jc.id}/part-suggestions`, {
      itemCode,
      availableQtyAtSuggestion: selectedPart?.availableQty ?? null,
      status,
      quantity: qty || 1,
      description: selectedPart?.description ?? null,
      hsnCode: selectedPart?.hsnCode ?? null,
      mrp: selectedPart?.mrp ?? null,
    })
    // the discount is saved right after the part is added (an FOC part is free of cost, so it never takes one)
    const value = Number(discountValue) || 0
    if (status !== 'FOC' && discountType !== 'None' && value > 0) {
      try {
        await staffApi.put(`/api/jobcards/part-suggestions/${created.id}/discount`, { discountType, discountValue: discountType === 'Percentage' ? Math.min(value, 100) : value })
      } catch {
        alert('The part was added, but its discount could not be saved - use the Discount button on its row to set it.')
      }
    }
    setItemCode('')
    setSelectedPart(null)
    setSearch('')
    setQty(1)
    setStatus('Paid')
    setDiscountType('None')
    setDiscountValue('0')
  }

  const saveDiscountEdit = async () => {
    if (!editing) return
    const value = Number(editing.value) || 0
    await staffApi.put(`/api/jobcards/part-suggestions/${editing.id}/discount`, {
      discountType: editing.type === 'None' ? null : editing.type,
      discountValue: editing.type === 'None' ? 0 : editing.type === 'Percentage' ? Math.min(value, 100) : value,
    })
    setEditing(null)
  }

  /** Money of a saved part line (MRP x Qty, less its discount; FOC = 0). */
  const partMoney = (p: JobCardDetail['partSuggestions'][number]) => suggestionLineMoney(p.mrp, p.quantity, p.status === 'FOC', discountOf(p))

  return (
    <div className="card">
      <h3>Part Suggestion</h3>
      <table>
        <thead><tr><th>Sr no.</th><th>Item Code</th><th>Description</th><th>MRP</th><th>QTY</th><th>Discount</th><th>Amount</th><th>Issue Type</th><th>Picture</th><th></th></tr></thead>
        <tbody>
          {jc.partSuggestions.map((p, i) => (
            <tr key={p.id}>
              <td>{i + 1}</td>
              <td>{p.itemCode}</td>
              <td>{p.description ?? '-'}</td>
              <td>{p.mrp != null ? `₹${p.mrp}` : '-'}</td>
              <td>{p.quantity}</td>
              <td>
                {editing?.id === p.id ? (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as DiscountKind })}>
                      <option value="None">None</option>
                      <option value="Percentage">%</option>
                      <option value="Amount">₹</option>
                    </select>
                    <input
                      type="number" min={0} value={editing.value} disabled={editing.type === 'None'}
                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                      style={{ width: '5rem', textAlign: 'right' }}
                    />
                  </div>
                ) : (
                  p.status === 'FOC' ? 'FOC' : discountLabel(discountOf(p))
                )}
              </td>
              <td>₹{partMoney(p).amount.toFixed(2)}</td>
              <td><StatusBadge status={p.status} /></td>
              <td>
                <PartPictureCell
                  jcId={jc.id}
                  suggestionId={p.id}
                  photos={jc.photos.filter((ph) => ph.partSuggestionId === p.id)}
                  run={run}
                />
              </td>
              <td style={{ display: 'flex', gap: 4 }}>
                <select
                  value={p.status}
                  onChange={(e) => run(() => staffApi.put(`/api/jobcards/part-suggestions/${p.id}`, { status: e.target.value }))}
                >
                  <option value="Paid">Paid</option>
                  <option value="U/W">U/W</option>
                  <option value="FOC">FOC</option>
                </select>
                {editing?.id === p.id ? (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => run(saveDiscountEdit, 'Discount updated.')}>Save</button>
                    <button className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <button
                    className="btn btn-sm"
                    disabled={p.status === 'FOC'}
                    title={p.status === 'FOC' ? 'An FOC part is free of cost - no discount applies.' : 'Edit this part\'s discount'}
                    onClick={() => setEditing({ id: p.id, type: discountOf(p).type, value: String(discountOf(p).value) })}
                  >
                    Discount
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  style={{ background: '#dc2626', color: '#fff', border: '1px solid #dc2626' }}
                  onClick={() => run(() => staffApi.delete(`/api/jobcards/part-suggestions/${p.id}`))}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {jc.partSuggestions.length === 0 && (
            <tr><td colSpan={10} className="muted">No parts suggested yet.</td></tr>
          )}
        </tbody>
      </table>

      {estimatesLocked || jc.status === 'Closed' ? (
        <p className="muted">
          {jc.status === 'Closed'
            ? 'Job card is closed - no more parts can be suggested.'
            : 'Estimate is marked Done - click Edit on the Estimates Amount card below to add more parts.'}
        </p>
      ) : (
      <>
      <h4>Suggest a part (from Item Master / Part Upload)</h4>
      {/* 2026-10-03: the whole row is wrapped in an overflowX:auto container with flexWrap:'nowrap' so
         Item Code/QTY/Issue Type/Add read as one tidy line (the same single-line fix as
         RepairBillCreatePage's Labour staging row). .suggest-row's shared flex-wrap:wrap in global.css is
         left untouched, so other .suggest-row users (Labour Suggestion's own row below) are unaffected. */}
      <div style={{ overflowX: 'auto' }}>
      <div className="suggest-row" style={{ flexWrap: 'nowrap' }}>
        <div className="field field-grow" style={{ position: 'relative' }}>
          <label>Item Code / Description</label>
          <input
            value={search}
            placeholder="Start typing an item code or description…"
            onChange={(e) => { setSearch(e.target.value); setItemCode(''); setSelectedPart(null); setShowSuggestions(true) }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            autoComplete="off"
          />
          {showSuggestions && q.length > 0 && (
            matches.length > 0 ? (
              <ul style={{
                position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 2,
                background: 'var(--card-bg, #fff)', border: '1px solid var(--border)', borderRadius: 8,
                maxHeight: 220, overflowY: 'auto', listStyle: 'none', padding: 4, boxShadow: '0 6px 18px rgba(0,0,0,.12)',
              }}>
                {matches.map((p) => (
                  <li key={p.itemCode}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '6px 8px' }}
                      onMouseDown={(e) => { e.preventDefault(); pickPart(p) }}
                    >
                      <strong>{p.itemCode}</strong>{p.description ? ` — ${p.description}` : ''} <span className="muted">({partAvailText(p)} · GST {partGstText(p)})</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{
                position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 2,
                background: 'var(--card-bg, #fff)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '8px 10px', boxShadow: '0 6px 18px rgba(0,0,0,.12)',
              }}>
                <span className={searchError ? 'error-text' : 'muted'} style={{ fontSize: 13 }}>
                  {searchError ?? `Part number "${search.trim()}" does not exist in Item Master.`}
                </span>
              </div>
            )
          )}
        </div>
        <div className="field field-compact">
          <label>QTY</label>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: '4rem' }} />
        </div>
        <div className="field field-compact">
          <label>Disc. Type</label>
          <select value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountKind)} disabled={status === 'FOC'}>
            <option value="None">None</option>
            <option value="Percentage">%</option>
            <option value="Amount">₹</option>
          </select>
        </div>
        <div className="field field-compact">
          <label>Discount</label>
          <input
            type="number" min={0} value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            disabled={status === 'FOC' || discountType === 'None'}
            style={{ width: '5.5rem', textAlign: 'right' }}
          />
        </div>
        <div className="field field-compact">
          <label>Issue Type</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'Paid' | 'U/W' | 'FOC')}>
            <option value="Paid">Paid</option>
            <option value="U/W">U/W</option>
            <option value="FOC">FOC</option>
          </select>
        </div>
        <div className="field field-compact">
          <button
            className="btn btn-sm btn-primary"
            disabled={!itemCode}
            onClick={() => {
              if (!hasOpenWorklog(jc)) { alert('Start the Technician Work Log timer before adding a part suggestion.'); return }
              run(addSuggestion, 'Part suggestion added.')
            }}
          >Add Suggestion</button>
        </div>
      </div>
      </div>
      {selectedPart && (
        <p className="muted">
          MRP {selectedPart.mrp != null ? `₹${selectedPart.mrp}` : '-'} · GST {partGstText(selectedPart)} · HSN {selectedPart.hsnCode ?? '-'} · {partStockLines(selectedPart)}
          {' · '}Amount ₹{suggestionLineMoney(selectedPart.mrp, qty, status === 'FOC', { type: discountType, value: Number(discountValue) || 0 }).amount.toFixed(2)}
          {status === 'FOC' ? ' (FOC - free of cost)' : discountType !== 'None' && Number(discountValue) > 0 ? ' after discount' : ''}
        </p>
      )}
      </>
      )}
    </div>
  )
}

function PartPictureCell({
  jcId, suggestionId, photos, run,
}: {
  jcId: string
  suggestionId: string
  photos: JobCardPhoto[]
  run: (fn: () => Promise<unknown>, successMsg?: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const onFilesChosen = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('File', file)
        form.append('Stage', 'PartSuggestion')
        form.append('PartSuggestionId', suggestionId)
        // eslint-disable-next-line no-await-in-loop
        await run(() => staffApi.post(`/api/jobcards/${jcId}/photos/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } }))
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const isVideo = (ph: JobCardPhoto) => /\.(mp4|mov|webm|3gp|avi)$/i.test(ph.url)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {photos.map((ph) => (
        <a key={ph.id} href={photoSrc(ph.url)} target="_blank" rel="noreferrer" title={isVideo(ph) ? 'View video' : 'View photo'}>
          {isVideo(ph) ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
              borderRadius: 4, background: '#101828', color: '#fff', fontSize: 12,
            }}>▶</span>
          ) : (
            <img src={photoSrc(ph.url)} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />
          )}
        </a>
      ))}
      <button
        type="button"
        className="btn btn-sm"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        title="Upload photo or video"
      >
        {uploading ? '…' : '+'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => onFilesChosen(e.target.files)}
      />
    </div>
  )
}

const LABOUR_ISSUE_TYPES = ['Paid', 'U/W', 'FOC'] as const

function LabourSuggestionCard({ jc, run, estimatesLocked }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>, successMsg?: string) => void; estimatesLocked: boolean }) {
  const [rows, setRows] = useState<JobCardsLabourCatalogRow[]>([])
  const [q, setQ] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [selected, setSelected] = useState<JobCardsLabourCatalogRow | null>(null)
  const [qty, setQty] = useState<number>(1)
  const [issueType, setIssueType] = useState('')
  const [editing, setEditing] = useState<{ id: string; qty: number; issueType: string; discountType: DiscountKind; discountValue: string } | null>(null)
  // 2026-10-07: discount of the labour line being added
  const [discountType, setDiscountType] = useState<DiscountKind>('None')
  const [discountValue, setDiscountValue] = useState('0')

  useEffect(() => {
    const handle = setTimeout(() => {
      staffApi.get<JobCardsLabourCatalogRow[]>('/api/jobcards/labour-catalog', { params: q.trim() ? { search: q.trim() } : {} })
        .then(({ data }) => setRows(data))
        .catch(() => setRows([]))
    }, 300)
    return () => clearTimeout(handle)
  }, [q])

  const pickLabour = (r: JobCardsLabourCatalogRow) => {
    setSelectedId(String(r.id))
    setSelected(r)
    setQ(`${r.labourCode}${r.labourDescription ? ' - ' + r.labourDescription : ''}`)
    setShowSuggestions(false)
  }

  const addSuggestion = async () => {
    if (!selected) return
    const { data: created } = await staffApi.post<{ id: string }>(`/api/jobcards/${jc.id}/labour-suggestions`, {
      labourCode: selected.labourCode,
      labourDescription: selected?.labourDescription ?? null,
      hsnCode: selected?.hsnCode ?? null,
      sgst: selected?.sgst ?? null,
      cgst: selected?.cgst ?? null,
      igst: selected?.igst ?? null,
      rateAtSuggestion: selected?.labourRate ?? null,
      quantity: qty || 1,
      issueType: issueType.trim() || null,
    })
    // the discount is saved right after the labour line is added (an FOC line is free of cost, so it never takes one)
    const value = Number(discountValue) || 0
    if (issueType !== 'FOC' && discountType !== 'None' && value > 0) {
      try {
        await staffApi.put(`/api/jobcards/labour-suggestions/${created.id}/discount`, { discountType, discountValue: discountType === 'Percentage' ? Math.min(value, 100) : value })
      } catch {
        alert('The labour was added, but its discount could not be saved - use Edit on its row to set it.')
      }
    }
    setSelectedId('')
    setSelected(null)
    setQ('')
    setQty(1)
    setIssueType('')
    setDiscountType('None')
    setDiscountValue('0')
  }

  const saveEdit = async () => {
    if (!editing) return
    await staffApi.put(`/api/jobcards/labour-suggestions/${editing.id}`, {
      quantity: editing.qty || 1,
      issueType: editing.issueType.trim() || null,
    })
    const value = Number(editing.discountValue) || 0
    const isFoc = editing.issueType.trim() === 'FOC'
    const type = isFoc ? 'None' : editing.discountType
    await staffApi.put(`/api/jobcards/labour-suggestions/${editing.id}/discount`, {
      discountType: type === 'None' ? null : type,
      discountValue: type === 'None' ? 0 : type === 'Percentage' ? Math.min(value, 100) : value,
    })
    setEditing(null)
  }

  /** Money of a saved labour line (Rate x Qty, less its discount; FOC = 0). */
  const labourMoney = (l: JobCardDetail['labourSuggestions'][number]) => suggestionLineMoney(l.rateAtSuggestion, l.quantity, l.issueType === 'FOC', discountOf(l))

  return (
    <div className="card">
      <h3>Labour Suggestion</h3>
      <table>
        <thead>
          <tr>
            <th>Labour Code</th><th>Description</th><th>Qty</th><th>Rate</th><th>HSN</th>
            <th>SGST</th><th>CGST</th><th>IGST</th><th>Discount</th><th>Amount</th><th>Issue Type</th><th></th>
          </tr>
        </thead>
        <tbody>
          {jc.labourSuggestions.map((l) =>
            editing?.id === l.id ? (
              <tr key={l.id}>
                <td>{l.labourCode}</td>
                <td>{l.labourDescription ?? '-'}</td>
                <td><input type="number" min={1} value={editing.qty} onChange={(e) => setEditing({ ...editing, qty: Number(e.target.value) })} style={{ width: '4rem' }} /></td>
                <td>{l.rateAtSuggestion ?? '-'}</td>
                <td>{l.hsnCode ?? '-'}</td>
                <td>{l.sgst ?? '-'}</td>
                <td>{l.cgst ?? '-'}</td>
                <td>{l.igst ?? '-'}</td>
                <td>
                  {editing.issueType === 'FOC' ? 'FOC' : (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <select value={editing.discountType} onChange={(e) => setEditing({ ...editing, discountType: e.target.value as DiscountKind })}>
                        <option value="None">None</option>
                        <option value="Percentage">%</option>
                        <option value="Amount">₹</option>
                      </select>
                      <input
                        type="number" min={0} value={editing.discountValue} disabled={editing.discountType === 'None'}
                        onChange={(e) => setEditing({ ...editing, discountValue: e.target.value })}
                        style={{ width: '5rem', textAlign: 'right' }}
                      />
                    </div>
                  )}
                </td>
                <td>₹{suggestionLineMoney(l.rateAtSuggestion, editing.qty, editing.issueType === 'FOC', { type: editing.discountType, value: Number(editing.discountValue) || 0 }).amount.toFixed(2)}</td>
                <td>
                  <select value={editing.issueType} onChange={(e) => setEditing({ ...editing, issueType: e.target.value })}>
                    <option value="">Select…</option>
                    {LABOUR_ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td>
                  <button className="btn btn-sm btn-primary" onClick={() => run(saveEdit)}>Save</button>{' '}
                  <button className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={l.id}>
                <td>{l.labourCode}</td>
                <td>{l.labourDescription ?? '-'}</td>
                <td>{l.quantity}</td>
                <td>{l.rateAtSuggestion ?? '-'}</td>
                <td>{l.hsnCode ?? '-'}</td>
                <td>{l.sgst ?? '-'}</td>
                <td>{l.cgst ?? '-'}</td>
                <td>{l.igst ?? '-'}</td>
                <td>{l.issueType === 'FOC' ? 'FOC' : discountLabel(discountOf(l))}</td>
                <td>₹{labourMoney(l).amount.toFixed(2)}</td>
                <td>{l.issueType ?? '-'}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => setEditing({ id: l.id, qty: l.quantity, issueType: l.issueType ?? '', discountType: discountOf(l).type, discountValue: String(discountOf(l).value) })}>Edit</button>{' '}
                  <button
                    className="btn btn-sm"
                    style={{ background: '#dc2626', color: '#fff', border: '1px solid #dc2626' }}
                    onClick={() => run(() => staffApi.delete(`/api/jobcards/labour-suggestions/${l.id}`))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            )
          )}
          {jc.labourSuggestions.length === 0 && (
            <tr><td colSpan={12} className="muted">No labour suggested yet.</td></tr>
          )}
        </tbody>
      </table>

      {estimatesLocked || jc.status === 'Closed' ? (
        <p className="muted">
          {jc.status === 'Closed'
            ? 'Job card is closed - no more labour can be suggested.'
            : 'Estimate is marked Done - click Edit on the Estimates Amount card below to add more labour.'}
        </p>
      ) : (
      <>
      <h4>Suggest labour (from Labour Master)</h4>
      <div style={{ overflowX: 'auto' }}>
      <div className="suggest-row" style={{ flexWrap: 'nowrap' }}>
        <div className="field field-grow" style={{ position: 'relative' }}>
          <label>Labour Code</label>
          <input
            type="text"
            value={q}
            placeholder="Search by labour code or description…"
            onChange={(e) => { setQ(e.target.value); setSelectedId(''); setSelected(null); setShowSuggestions(true) }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            autoComplete="off"
          />
          {showSuggestions && q.trim().length > 0 && (
            rows.length > 0 ? (
              <ul style={{
                position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 2,
                background: 'var(--card-bg, #fff)', border: '1px solid var(--border)', borderRadius: 8,
                maxHeight: 220, overflowY: 'auto', listStyle: 'none', padding: 4, boxShadow: '0 6px 18px rgba(0,0,0,.12)',
              }}>
                {rows.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '6px 8px' }}
                      onMouseDown={(e) => { e.preventDefault(); pickLabour(r) }}
                    >
                      <strong>{r.labourCode}</strong>{r.labourDescription ? ` — ${r.labourDescription}` : ''} <span className="muted">(₹{r.labourRate ?? '-'})</span>
                      {r.partCode && (
                        <><br /><span className="muted" style={{ fontSize: 12 }}>Part: {r.partCode}{r.partDescription ? ` — ${r.partDescription}` : ''}</span></>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{
                position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 2,
                background: 'var(--card-bg, #fff)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '8px 10px', boxShadow: '0 6px 18px rgba(0,0,0,.12)',
              }}>
                <span className="muted" style={{ fontSize: 13 }}>No labour found in DMS matching "{q.trim()}".</span>
              </div>
            )
          )}
        </div>
        <div className="field field-compact">
          <label>Qty</label>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: '4rem' }} />
        </div>
        <div className="field field-compact">
          <label>Disc. Type</label>
          <select value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountKind)} disabled={issueType === 'FOC'}>
            <option value="None">None</option>
            <option value="Percentage">%</option>
            <option value="Amount">₹</option>
          </select>
        </div>
        <div className="field field-compact">
          <label>Discount</label>
          <input
            type="number" min={0} value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            disabled={issueType === 'FOC' || discountType === 'None'}
            style={{ width: '5.5rem', textAlign: 'right' }}
          />
        </div>
        <div className="field field-compact">
          <label>Issue Type</label>
          <select value={issueType} onChange={(e) => setIssueType(e.target.value)}>
            <option value="">Select…</option>
            {LABOUR_ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="field field-compact">
          <button
            className="btn btn-sm btn-primary"
            disabled={!selectedId}
            onClick={() => {
              if (!hasOpenWorklog(jc)) { alert('Start the Technician Work Log timer before adding a labour suggestion.'); return }
              run(addSuggestion, 'Labour suggestion added.')
            }}
          >Add Suggestion</button>
        </div>
      </div>
      </div>
      {selected && (
        <p className="muted">
          Rate ₹{selected.labourRate ?? '-'} · HSN {selected.hsnCode ?? '-'} · SGST {selected.sgst ?? '-'} · CGST {selected.cgst ?? '-'} · IGST {selected.igst ?? '-'}
          {' · '}Amount ₹{suggestionLineMoney(selected.labourRate, qty, issueType === 'FOC', { type: discountType, value: Number(discountValue) || 0 }).amount.toFixed(2)}
          {issueType === 'FOC' ? ' (FOC - free of cost)' : discountType !== 'None' && Number(discountValue) > 0 ? ' after discount' : ''}
          {selected.partCode && ` · Part: ${selected.partCode}${selected.partDescription ? ' — ' + selected.partDescription : ''}`}
        </p>
      )}
      </>
      )}
    </div>
  )
}

function InvoiceCard({ jc }: { jc: JobCardDetail }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const { data } = await staffApi.get(`/api/jobcards/${jc.id}/invoice-pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `invoice-${jc.baplJobNo ?? jc.id}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) setNotice('No repair bill saved in DMS for this job yet.')
      else setError('Could not download the invoice from DMS. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h3>Invoice</h3>
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={download}>
        {busy ? 'Downloading…' : 'Download Invoice from DMS'}
      </button>
      {notice && <p className="muted" style={{ marginTop: 8 }}>{notice}</p>}
      {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  )
}

function ClosureCard({ jc, run }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>) => void }) {
  const [otpRequestId, setOtpRequestId] = useState<string | null>(null)
  const [devOtpCode, setDevOtpCode] = useState<string | null>(null)
  const [code, setCode] = useState('')

  if (jc.status === 'Closed') return <div className="card"><h3>Job Card Closed</h3></div>

  return (
    <div className="card">
      <h3>OTP-Based Closure</h3>
      {!otpRequestId ? (
        <button className="btn btn-sm btn-primary" onClick={async () => {
          const { data } = await staffApi.post(`/api/jobcards/${jc.id}/closure/otp`)
          setOtpRequestId(data.otpRequestId)
          setDevOtpCode(data.devOtpCode ?? null)
        }}>
          Send Closure OTP to Customer
        </button>
      ) : (
        <div>
          {devOtpCode && (
            <p className="muted" style={{ marginBottom: 8 }}>
              Dev mode (no SMS provider configured) &mdash; OTP code: <strong>{devOtpCode}</strong>
            </p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="6-digit OTP" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => run(() => staffApi.post(`/api/jobcards/${jc.id}/closure/verify`, { otpRequestId, code }))}>Verify & Close</button>
          </div>
        </div>
      )}
    </div>
  )
}