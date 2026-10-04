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
// print in that same format"): the Invoice print option now uses the DMS "GST TAX INVOICE" layout -
// see lib/repairBillInvoicePrintHtml.ts. Replaces this file's old flat-table
// buildRepairBillInvoicePrintHtml (2026-09-28, SECTION 150), which was deleted.
import { buildRepairBillTaxInvoicePrintHtml, taxInvoiceContextFromJobCard } from '../../lib/repairBillInvoicePrintHtml'

// Photo URLs come back from the API as a relative path (e.g. "/uploads/jobcard-photos/.../x.jpg" -
// see JobCardsController.UploadPhoto), same origin as the API itself, not the frontend dev server.
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL
const photoSrc = (url: string) => (url.startsWith('http') ? url : `${API_BASE_URL}${url}`)

// 2026-09-28 (SECTION 137) - "0301-A01-1025 exists in Item Master and Part Upload but search says
// it does not exist": PartSuggestionCard's search fetch below used a blanket
// `.catch(() => setAvailableParts([]))` - a REAL backend failure (e.g. the parts-catalog endpoint's
// own 502 when BAPL's C_ItemMaster connection has a problem - see JobCardsController.PartsCatalog's
// try/catch around SearchItemMasterAsync) looked EXACTLY like "zero parts matched your search",
// which is how a genuine, real-part search could show "does not exist" even though the SQL itself
// (WHERE ItemCode LIKE '%...%' - confirmed from your real IBaplDealerService.cs, no Status filter
// at all, contradicting my earlier guess in SECTION 136 that Status='N' explained this - that guess
// is now WITHDRAWN, this is the corrected diagnosis) would normally match it fine. Same
// describeError pattern already used for Attendance (SECTION 125) - used here so a real failure
// now says so explicitly instead of masquerading as "not found".
function describeSearchError(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { message?: string } } }
  const detail = e?.response?.data?.message
  const status = e?.response?.status
  if (detail) return `${fallback} (${detail})`
  if (status) return `${fallback} (HTTP ${status})`
  return `${fallback} (no response reached the server - check your connection)`
}

// 2026-10-01 REMOVED (per explicit request - "Remove the cap entirely"): the ₹2000 Grand Total
// hard-stop that used to block Part Suggestion/Labour Suggestion from accepting new entries once
// the Estimates Amount Grand Total reached ESTIMATE_TOTAL_LOCK_THRESHOLD has been taken out, along
// with the calcEstimateGrandTotal(jc) helper that only existed to compute that gate (EstimatesCard
// below computes its own displayed Grand Total inline from partRows/labourRows, unaffected by this
// removal). There is now no maximum - Part/Labour Suggestion only locks on the manual Done/Edit
// toggle on the Estimates Amount card (see EstimatesCard / `estimatesLocked` below), same as before
// 2026-09-07.

/** "Set/reset customer portal password" - the dealer/admin side of the new customer password
 * login (POST /api/customers/{id}/admin-reset-password), which runs alongside the customer's
 * existing OTP-based portal login rather than replacing it (see CustomerPortalController.Login's
 * doc comment). Only visible to WorkshopManager and up, matching the backend policy exactly. This
 * SETS the password to whatever the admin/dealer types here (never reveals or "checks" the
 * existing one - only a PBKDF2 hash is ever stored, same as staff Users), so share it with the
 * customer directly afterwards. */
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
 * the read-only Workflow Timeline below and the Update Workflow Stage dropdown further down - NOT
 * removed from the backend, purely a display filter:
 *  - "job_card_created" is folded into "check_in" as one combined "Vehicle Check-In / Job Card
 *    Created" step (see buildTimelineStages) - the wizard's new combined check-in flow means these
 *    are no longer two meaningfully separate moments for a user to see as separate rows.
 *  - "quality_check" and "rework" are hidden as effectively-unused stubs: grepping both web/src and
 *    backend/ for each of the 15 stage keys turned up real, stage-specific business logic for only
 *    "parts_requested", "in_repair" and "ready_for_delivery" (all three used in DashboardController's
 *    KPI counts) - every other stage, these two included, is referenced nowhere but the seed data
 *    and the timeline's icon lookup. "rework" doubly so: nothing in this app ever transitions a job
 *    card into it automatically (no "send back for rework" action exists anywhere), so from the
 *    UI's perspective it is a pure stub. "quality_check" is hidden for the same "least wired up"
 *    reason, and now doubly so since the Quality Check panel itself is hidden below (see QcCard's
 *    usage) - nothing on this page produces or consumes a "quality_check" visit any more either. */
const HIDDEN_WORKFLOW_STAGE_KEYS = new Set(['job_card_created', 'quality_check', 'rework'])
const MERGED_CHECKIN_LABEL = 'Vehicle Check-In / Job Card Created'

/** Quality Check panel toggle - see its usage below. A `const false`, not a literal `false`
 * inline in the JSX: TypeScript's control-flow narrowing of `jc` (JobCardDetail | null -> non-null
 * further up this file) does not survive an inline `{false && <QcCard jc={jc} .../>}` - a real,
 * reproducible TS narrowing gap for JSX attributes on the right of a literal-`false` `&&` - so this
 * named constant is used instead purely to keep the file type-checking cleanly. */
const SHOW_QUALITY_CHECK_PANEL = false

/** The WorkflowStage list actually shown in the timeline - see HIDDEN_WORKFLOW_STAGE_KEYS. */
function buildTimelineStages(stages: WorkflowStage[]): WorkflowStage[] {
  return stages
    .filter((s) => !HIDDEN_WORKFLOW_STAGE_KEYS.has(s.stageKey))
    .map((s) => (s.stageKey === 'check_in' ? { ...s, label: MERGED_CHECKIN_LABEL } : s))
}

/** Stage-history entries for the timeline, with "check_in" and "job_card_created" entries combined
 * into one - using the earliest enteredAt and latest exitedAt of the two, so the merged step shows
 * "reached" as soon as either underlying stage's timestamp is set - and "quality_check"/"rework"
 * entries dropped entirely (see HIDDEN_WORKFLOW_STAGE_KEYS). */
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

/** currentStageId to pass to WorkflowTimeline: unchanged unless the job card's real current stage
 * is one of the hidden ones, in which case this redirects to the nearest earlier stage that IS
 * still shown (for "job_card_created" that's always "check_in", i.e. the merged step). */
function resolveTimelineCurrentStageId(stages: WorkflowStage[], currentStage?: WorkflowStage): string | undefined {
  if (!currentStage) return undefined
  if (!HIDDEN_WORKFLOW_STAGE_KEYS.has(currentStage.stageKey)) return currentStage.id
  const visible = stages.filter((s) => !HIDDEN_WORKFLOW_STAGE_KEYS.has(s.stageKey) && s.seq <= currentStage.seq)
  return visible.sort((a, b) => b.seq - a.seq)[0]?.id
}

/** Raw chronological stage-history log ("grid") shown below the visual Workflow Timeline stepper -
 * unlike the stepper (one row per DEFINED stage, showing only the latest visit), this shows every
 * row that's actually happened, in order, including remarks and who made each change. Worth having
 * now that most stage changes are auto-triggered (see backend WorkflowStageAutomation) and carry a
 * system-generated remark like "Auto-advanced: part suggested." that the stepper alone doesn't
 * surface - this is the audit trail of exactly what moved the job card forward and when. */
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

/** "Print" menu - 3 options (Estimate / JobCard print / Invoice). History: 2026-09-03 replaced the
 * separate standalone "Invoice" card (Download Invoice from DMS - see git history / InvoiceCard)
 * with this single dropdown next to the status badge.
 *
 * 2026-10-04 ("in print button which invoice is there that was repair bill invoice ... we need to
 * print in that same format" - RepairBillInvoice-Format.pdf / JobcardInvoice-Format.pdf):
 *   - Invoice       -> prints the DMS "GST TAX INVOICE" layout (dealer header, Customer Details,
 *                      Vehicle Details, items grid, Amount In Words, Part/Labour/Invoice Total, HSN
 *                      Summary, Remarks, Customer Signature / Authorized Signatory) from this job
 *                      card's Billed Repair Bill (GET /api/repair-bill-docs?jobCardId=...) - see
 *                      lib/repairBillInvoicePrintHtml.ts. (2026-09-28, SECTION 150: the data source
 *                      is this app's OWN RepairBillDocs, not DMS's RepairBillHeader/Detail - the old
 *                      GET /api/jobcards/{id}/invoice-pdf 404'd for every job billed through the new
 *                      Repair Bill flow.) No server-generated PDF: "Save as PDF" from the browser's
 *                      print dialog covers that, same as the other two options.
 *   - JobCard print -> the layout was already the JobcardInvoice-Format (same
 *                      buildJobCardPrintHtml); what differed was DATA: Invoice No, customer State,
 *                      Sale Date and the Battery Details block printed "-" here because this page
 *                      never fetched them. They are now filled in: Invoice No from the Billed
 *                      Repair Bill; Sale Date/Battery Make/Chemical/Capacity (and any missing
 *                      controller/charger/battery no.) from the same Vehicle Sale lookup the wizard
 *                      uses. That lookup is best-effort - if it fails (no access, not found, DMS
 *                      down) the print simply keeps "-" for those fields.
 *   - Estimate      -> unchanged.
 * Every option opens its print window synchronously inside the click (before any await) so the
 * browser popup blocker allows it, then fills it once data arrives. Notices/errors surface through
 * the same `setMsg` line the rest of this page uses for action feedback.
 * Role gate: none - all roles can print (2026-10-03, "For all Role its visible": the old
 * Cashier/DealerAdmin/CorporateAdmin/SystemAdmin gate on Invoice hid it from a WorkshopManager/
 * Supervisor/ServiceAdvisor closing a job card, which looked exactly like "I can't download the
 * invoice"), so this component no longer takes a `hasRole` prop. */
function PrintMenu({ jc, setMsg }: { jc: JobCardDetail; setMsg: (m: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // 2026-09-03 fix ("clicking Print button, no options shown"): this used to close the menu via
  // onBlur on the toggle button itself (setTimeout(() => setOpen(false), 150)), copied from this
  // page's search-box dropdowns (PartSuggestionCard/LabourSuggestionCard) - but those are text
  // INPUTS, which reliably hold focus while the user interacts with them. A plain <button> doesn't
  // reliably take focus on click in every browser (notably Safari, which by default only focuses a
  // button via keyboard navigation, not a mouse click) - without focus, onBlur never fires to have
  // opened anything to begin with in some environments, and in others the focus/blur timing raced
  // against the click that was meant to open it. A click-outside listener has none of that
  // timing/focus dependency - it opens on click and closes only when a real click lands outside
  // this container, regardless of how the browser handles button focus.
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  /** Opens the print window immediately - must happen synchronously in the click handler, before
   * any await (2026-09-03 "invoice not added/opened": once an `await` has run the browser no longer
   * counts window.open as a direct response to the click and its popup blocker refuses it). */
  const openLoadingWindow = (loadingText: string, popupBlockedMsg: string): Window | null => {
    const win = window.open('', '_blank', 'width=900,height=650')
    if (!win) { setMsg(popupBlockedMsg); return null }
    win.document.write(`<p style="font-family:sans-serif;padding:20px;color:#555;">${loadingText}</p>`)
    return win
  }
  /** Replaces the loading text with the real document and opens the native print dialog. The
   * `win.onload = () => win.print()` line is what makes this feel like a "print" action rather than
   * just a preview (2026-09-03 "print option not came" - the wizard's own print button always had it). */
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
    const partRows = jc.partSuggestions.map((p, i) => {
      const mrp = p.mrp ?? 0
      const qty = p.quantity ?? 1
      const isFoc = p.status === 'FOC'
      return { sr: i + 1, code: p.itemCode, description: p.description ?? '-', hsn: p.hsnCode ?? '-', mrp, qty, amount: isFoc ? 0 : mrp * qty }
    })
    const labourRows = jc.labourSuggestions.map((l, i) => {
      const rate = l.rateAtSuggestion ?? 0
      const qty = l.quantity ?? 1
      const isFoc = l.issueType === 'FOC'
      return { sr: i + 1, code: l.labourCode, description: l.labourDescription ?? '-', hsn: l.hsnCode ?? '-', rate, qty, amount: isFoc ? 0 : rate * qty }
    })
    const partsTotal = partRows.reduce((sum, r) => sum + r.amount, 0)
    const labourTotal = labourRows.reduce((sum, r) => sum + r.amount, 0)
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
        customerState, // needs the customerState edit in lib/jobCardPrintHtml.ts (delivered with this file)
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
    } catch {
      win.close()
      setMsg('Could not load the invoice for this job card. Please try again.')
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
  // Estimates Amount "Done"/"Edit" toggle - lifted up here (rather than local to EstimatesCard)
  // because "Done" also hides PartSuggestionCard/LabourSuggestionCard's add-new-suggestion forms,
  // not just EstimatesCard's own UI. See EstimatesCard's doc comment for the full feature.
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

  // Item 7 (wizard): "Continue to Job Card" after creation links straight to
  // /jobcards/{id}#workflow-timeline. Item 10 (list page): a job card's photo count links straight
  // to /jobcards/{id}#photos. Both scroll that section into view once the page (and the matching
  // id) has actually rendered, rather than relying on the browser's own same-navigation hash scroll
  // (which can miss it here since the content loads asynchronously after mount).
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

  // 2026-10-01: the parent-level estimateGrandTotal that used to gate Part/Labour Suggestion via
  // ESTIMATE_TOTAL_LOCK_THRESHOLD has been removed along with that cap (see calcEstimateGrandTotal's
  // doc comment above). EstimatesCard still computes its own Grand Total internally for display.

  const run = async (fn: () => Promise<unknown>, successMsg?: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      await load()
      if (successMsg) setMsg(successMsg)
    } catch (err: unknown) {
      // Surface both the friendly message and the raw exception detail when the backend sends one
      // (see JobCardsController.AddPartSuggestion/AddLabourSuggestion's catch blocks) - this is
      // what actually tells apart "migration wasn't run against this database" from a genuinely
      // new bug, without needing to open DevTools' Network tab.
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

/** DMS's own service/job-card history for this vehicle's chassis (GET
 * /api/bapl-dms/service-history) - a read-only reference panel, kept but unused - see
 * JobCardDetailPage's own doc comments history for why it's no longer rendered. */
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

  const partRows = jc.partSuggestions.map((p, i) => {
    const mrp = p.mrp ?? 0
    const qty = p.quantity ?? 1
    const isFoc = p.status === 'FOC'
    return { sr: i + 1, code: p.itemCode, description: p.description ?? '-', hsn: p.hsnCode ?? '-', mrp, qty, amount: isFoc ? 0 : mrp * qty }
  })
  const labourRows = jc.labourSuggestions.map((l, i) => {
    const rate = l.rateAtSuggestion ?? 0
    const qty = l.quantity ?? 1
    const isFoc = l.issueType === 'FOC'
    return { sr: i + 1, code: l.labourCode, description: l.labourDescription ?? '-', hsn: l.hsnCode ?? '-', rate, qty, amount: isFoc ? 0 : rate * qty }
  })
  const partsTotal = partRows.reduce((sum, r) => sum + r.amount, 0)
  const labourTotal = labourRows.reduce((sum, r) => sum + r.amount, 0)
  const grandTotal = partsTotal + labourTotal
  const closed = jc.status === 'Closed'

  return (
    <div className="card">
      <h3>Estimates Amount</h3>

      <h4>Part Details</h4>
      <table>
        <thead><tr><th>Sr no.</th><th>Item Code</th><th>Description</th><th>HSN</th><th>MRP</th><th>Qty</th><th>Amount</th></tr></thead>
        <tbody>
          {partRows.map((r) => (
            <tr key={r.sr}>
              <td>{r.sr}</td><td>{r.code}</td><td>{r.description}</td><td>{r.hsn}</td>
              <td>{money(r.mrp)}</td><td>{r.qty}</td><td>{money(r.amount)}</td>
            </tr>
          ))}
          {partRows.length === 0 && <tr><td colSpan={7} className="muted">No parts suggested yet.</td></tr>}
        </tbody>
        {partRows.length > 0 && (
          <tfoot><tr><td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>Parts Total</td><td style={{ fontWeight: 600 }}>{money(partsTotal)}</td></tr></tfoot>
        )}
      </table>

      <h4 style={{ marginTop: 16 }}>Labour Details</h4>
      <table>
        <thead><tr><th>Sr no.</th><th>Labour Code</th><th>Description</th><th>HSN</th><th>MRP (Rate)</th><th>Qty</th><th>Amount</th></tr></thead>
        <tbody>
          {labourRows.map((r) => (
            <tr key={r.sr}>
              <td>{r.sr}</td><td>{r.code}</td><td>{r.description}</td><td>{r.hsn}</td>
              <td>{money(r.rate)}</td><td>{r.qty}</td><td>{money(r.amount)}</td>
            </tr>
          ))}
          {labourRows.length === 0 && <tr><td colSpan={7} className="muted">No labour suggested yet.</td></tr>}
        </tbody>
        {labourRows.length > 0 && (
          <tfoot><tr><td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>Labour Total</td><td style={{ fontWeight: 600 }}>{money(labourTotal)}</td></tr></tfoot>
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

function PartSuggestionCard({ jc, run, estimatesLocked }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>, successMsg?: string) => void; estimatesLocked: boolean }) {
  const [availableParts, setAvailableParts] = useState<JobCardsPartsCatalogRow[]>([])
  const [search, setSearch] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [itemCode, setItemCode] = useState('')
  const [qty, setQty] = useState<number>(1)
  const [status, setStatus] = useState<'Paid' | 'U/W' | 'FOC'>('Paid')
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = search.trim()
      if (trimmed.length === 0) { setAvailableParts([]); setSearchError(null); return }
      staffApi.get<JobCardsPartsCatalogRow[]>('/api/jobcards/parts-catalog', {
        params: { q: trimmed, ...(jc.baplServiceLocationCode ? { locationCode: jc.baplServiceLocationCode } : {}) },
      })
        .then(({ data }) => { setAvailableParts(data); setSearchError(null) })
        .catch((err) => {
          setAvailableParts([])
          setSearchError(describeSearchError(err, 'Search failed'))
        })
    }, 300)
    return () => clearTimeout(handle)
  }, [search, jc.baplServiceLocationCode])

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
    await staffApi.post(`/api/jobcards/${jc.id}/part-suggestions`, {
      itemCode,
      availableQtyAtSuggestion: selectedPart?.availableQty ?? null,
      status,
      quantity: qty || 1,
      description: selectedPart?.description ?? null,
      hsnCode: selectedPart?.hsnCode ?? null,
      mrp: selectedPart?.mrp ?? null,
    })
    setItemCode('')
    setSelectedPart(null)
    setSearch('')
    setQty(1)
    setStatus('Paid')
  }

  return (
    <div className="card">
      <h3>Part Suggestion</h3>
      <table>
        <thead><tr><th>Sr no.</th><th>Item Code</th><th>Description</th><th>MRP</th><th>QTY</th><th>Issue Type</th><th>Picture</th><th></th></tr></thead>
        <tbody>
          {jc.partSuggestions.map((p, i) => (
            <tr key={p.id}>
              <td>{i + 1}</td>
              <td>{p.itemCode}</td>
              <td>{p.description ?? '-'}</td>
              <td>{p.mrp != null ? `₹${p.mrp}` : '-'}</td>
              <td>{p.quantity}</td>
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
            <tr><td colSpan={8} className="muted">No parts suggested yet.</td></tr>
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
      <h4>Suggest a part (from Item Master{jc.baplServiceLocationCode ? ' / Part Upload' : ''})</h4>
      {!jc.baplServiceLocationCode && <p className="muted">No Service Location on this job card - Available Qty won't be shown (the part list itself still works).</p>}
      {/* 2026-10-03 ("in 1 row line all and ui make proper"): the Issue Type <select> used to sit
         directly inside .suggest-row with no wrapping .field/.field-compact div and no label -
         unlike every other control in this same row (Item Code/Description's own .field-grow,
         QTY's own .field-compact) - so it had no fixed sizing and no visual grouping with its
         neighbours, which is what made the row read as uneven/overflowing rather than one tidy
         line. Wrapped it in the same .field.field-compact pattern QTY/Add already use, with its
         own "Issue Type" label so all three (QTY/Issue Type/Add) read the same way, and the whole
         row is now wrapped in an overflowX:auto container with flexWrap:'nowrap' forced on
         .suggest-row - the exact same single-line fix already applied to RepairBillCreatePage.tsx's
         Labour staging row (see that file's own 2026-09-23 "SECOND correction" doc comment for the
         full reasoning: .suggest-row's shared flex-wrap:wrap in global.css is left untouched, so
         other .suggest-row users such as Labour Suggestion's own row below are unaffected - this
         override is local to this one row only). No field, data, or save behaviour changed - same
         state (search/itemCode/qty/status), same addSuggestion() call. */}
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
                      <strong>{p.itemCode}</strong>{p.description ? ` — ${p.description}` : ''} <span className="muted">(avail. {p.availableQty ?? '—'})</span>
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
        <p className="muted">MRP {selectedPart.mrp != null ? `₹${selectedPart.mrp}` : '-'} · HSN {selectedPart.hsnCode ?? '-'} · Available {selectedPart.availableQty}</p>
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
  const [editing, setEditing] = useState<{ id: string; qty: number; issueType: string } | null>(null)

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
    await staffApi.post(`/api/jobcards/${jc.id}/labour-suggestions`, {
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
    setSelectedId('')
    setSelected(null)
    setQ('')
    setQty(1)
    setIssueType('')
  }

  const saveEdit = async () => {
    if (!editing) return
    await staffApi.put(`/api/jobcards/labour-suggestions/${editing.id}`, {
      quantity: editing.qty || 1,
      issueType: editing.issueType.trim() || null,
    })
    setEditing(null)
  }

  return (
    <div className="card">
      <h3>Labour Suggestion</h3>
      <table>
        <thead>
          <tr>
            <th>Labour Code</th><th>Description</th><th>Qty</th><th>Rate</th><th>HSN</th>
            <th>SGST</th><th>CGST</th><th>IGST</th><th>Issue Type</th><th></th>
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
                <td>{l.issueType ?? '-'}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => setEditing({ id: l.id, qty: l.quantity, issueType: l.issueType ?? '' })}>Edit</button>{' '}
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
            <tr><td colSpan={10} className="muted">No labour suggested yet.</td></tr>
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