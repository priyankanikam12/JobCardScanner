import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import { PasswordInput } from '../../components/PasswordInput'
import { StatusBadge } from '../../components/StatusBadge'
import { WorkflowTimeline, type WorkflowTimelineHistoryEntry } from '../../components/WorkflowTimeline'
import type { BaplDmsJobCardHistory, JobCardDetail, JobCardPhoto, JobCardsLabourCatalogRow, JobCardsPartsCatalogRow, RepairBillDoc, StaffRole, Technician, WorkflowStage } from '../../types'
import { buildEstimatePrintHtml, buildJobCardPrintHtml } from '../../lib/jobCardPrintHtml'

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

/** 2026-09-28 (SECTION 150, "in print click download invoioce download then it will not download
 * why?"): builds the "Invoice" print option's HTML from THIS APP'S OWN Repair Bill data (a Billed
 * RepairBillDoc - see this section's own diagnosis in printInvoice below for why the old
 * DMS-sourced version always 404'd for a job billed through the new Repair Bill page). Not shared
 * with lib/jobCardPrintHtml.ts (I don't have that file's source this session, so this is a new,
 * self-contained function here instead of risking a guessed edit to a file I can't see) - same
 * per-file-duplication convention this codebase already uses elsewhere (e.g. formatElapsedMs/IST
 * formatters, duplicated between this file and the mobile screen rather than shared). A plain HTML
 * document meant for a print-preview window (see printInvoice's own printWindow call below), not a
 * server-generated PDF - "Save as PDF" from the browser's print dialog covers that, matching how
 * this same menu's Estimate/JobCard print options already work. */
function buildRepairBillInvoicePrintHtml(bill: RepairBillDoc, dealerName?: string, dealerCode?: string): string {
  const rows = bill.items.map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${it.itemType}</td>
      <td>${it.itemCode}</td>
      <td>${it.itemDescription}</td>
      <td>${it.hsnCode ?? '-'}</td>
      <td class="right">${it.qty}</td>
      <td class="right">₹${Number(it.rate).toFixed(2)}</td>
      <td>${!it.discountType || it.discountType === 'None' ? '-' : `${it.discountValue}${it.discountType === 'Percentage' ? '%' : ''}`}</td>
      <td class="right">₹${Number(it.taxableAmount).toFixed(2)}</td>
      <td class="right">₹${Number(it.cgstAmount).toFixed(2)}</td>
      <td class="right">₹${Number(it.sgstAmount).toFixed(2)}</td>
      <td class="right">₹${Number(it.igstAmount).toFixed(2)}</td>
      <td class="right">₹${Number(it.totalAmount).toFixed(2)}</td>
    </tr>`).join('')
  const balance = Number(bill.totalAmount) - Number(bill.amountReceived)

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Invoice ${bill.billNumber}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .muted { color: #555; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 11px; }
  th, td { border: 1px solid #ccc; padding: 5px 6px; text-align: left; }
  th { background: #f3f4f6; }
  .right { text-align: right; }
  .header-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .totals { margin-top: 14px; width: 320px; margin-left: auto; font-size: 13px; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
  .totals .grand { font-weight: 700; border-top: 1px solid #333; margin-top: 4px; padding-top: 6px; }
</style></head>
<body>
  <div class="header-row">
    <div>
      <h1>${dealerName ?? 'Repair Bill Invoice'}</h1>
      <div class="muted">${dealerCode ?? ''}</div>
    </div>
    <div class="muted" style="text-align:right">
      Bill No: <strong>${bill.billNumber}</strong><br/>
      Date: ${bill.billDate ? new Date(bill.billDate).toLocaleDateString('en-IN') : '-'}<br/>
      Status: ${bill.status}
    </div>
  </div>
  <div class="muted">
    Party: <strong>${bill.partyName}</strong> &nbsp; Reg No: ${bill.regNo ?? '-'} &nbsp; Chassis No: ${bill.chassisNo ?? '-'} &nbsp; Location: ${bill.location ?? '-'}
    ${bill.jobCardNumber ? `<br/>Job No: ${bill.jobCardNumber}` : ''}
  </div>
  <table>
    <thead><tr><th>Sr</th><th>Type</th><th>Code</th><th>Description</th><th>HSN</th><th class="right">Qty</th><th class="right">Rate</th><th>Discount</th><th class="right">Taxable</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th><th class="right">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div><span>Taxable Amount</span><span>₹${Number(bill.taxableAmount).toFixed(2)}</span></div>
    <div><span>CGST</span><span>₹${Number(bill.cgstAmount).toFixed(2)}</span></div>
    <div><span>SGST</span><span>₹${Number(bill.sgstAmount).toFixed(2)}</span></div>
    <div><span>IGST</span><span>₹${Number(bill.igstAmount).toFixed(2)}</span></div>
    <div class="grand"><span>Total Amount</span><span>₹${Number(bill.totalAmount).toFixed(2)}</span></div>
    <div><span>Amount Received</span><span>₹${Number(bill.amountReceived).toFixed(2)}</span></div>
    <div><span>Balance</span><span>₹${balance.toFixed(2)}</span></div>
  </div>
  ${bill.remarks ? `<div class="muted" style="margin-top:14px">Remarks: ${bill.remarks}</div>` : ''}
</body></html>`
}

/** "Print" menu (2026-09-03) - replaces the separate standalone "Invoice" card that used to sit
 * further down the page (Download Invoice from DMS - see git history / InvoiceCard) with a single
 * dropdown next to the status badge, 3 options per explicit request:
 *   1. Estimate    - customer/dealer/vehicle identity + the Estimates Amount tables only (Part
 *                    Details, Labour Details, Grand Total) - see buildEstimatePrintHtml.
 *   2. JobCard print - the same DMS "Job Card + Gate Pass" paper layout the wizard's own
 *                    pre-creation Print button uses (buildJobCardPrintHtml, now shared - see
 *                    lib/jobCardPrintHtml.ts), but filled from this job card's real saved data
 *                    (and its real Job No/Invoice No once known, instead of the wizard's "-"
 *                    placeholders).
 *   3. Invoice     - CHANGED 2026-09-28 (SECTION 150, "in print click download invoioce download
 *                    then it will not download why?"): used to fetch DMS's own repair bill PDF
 *                    (GET /api/jobcards/{id}/invoice-pdf) - FACT, confirmed by re-reading that
 *                    endpoint's own doc comment in JobCardsController.cs: it reads DMS's own
 *                    RepairBillHeader/RepairBillDetail tables LIVE, which this app never writes to
 *                    (repair bills you save from the Repair Bill page go into JobCardScanner's own
 *                    RepairBillDocs table instead - see RepairBillDocsController.cs) - so that
 *                    endpoint 404'd ("no repair bill in DMS") for every job billed through the new
 *                    Repair Bill flow, which is why nothing downloaded. Per your confirmed answer,
 *                    this now reads THIS APP'S OWN Billed Repair Bill for this job card instead
 *                    (GET /api/repair-bill-docs?jobCardId=..., no DMS fallback) and renders it as a
 *                    print-preview window (buildRepairBillInvoicePrintHtml above), same pattern as
 *                    Estimate/JobCard print - not a server-generated PDF, since I don't have
 *                    IInvoicePdfService's source to safely extend it (per your confirmed answer).
 *                    Same role gate as before (Cashier/DealerAdmin/CorporateAdmin/SystemAdmin) -
 *                    not everyone should be pulling repair bills.
 * Notices/errors from the Invoice option are surfaced through the same `setMsg` line the rest of
 * this page already uses for action feedback, rather than a second, separate message area. */
function PrintMenu({ jc, hasRole, setMsg }: { jc: JobCardDetail; hasRole: (...roles: StaffRole[]) => boolean; setMsg: (m: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [invoiceBusy, setInvoiceBusy] = useState(false)
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

  const printWindow = (html: string, popupBlockedMsg: string) => {
    const win = window.open('', '_blank', 'width=900,height=650')
    if (!win) { setMsg(popupBlockedMsg); return }
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
    // 2026-09-03 fix ("print option not came") - this used to stop at just opening the preview
    // and left the user to trigger printing themselves (Ctrl+P). The wizard's own print button
    // (JobCardWizardPage.printPreview, same buildJobCardPrintHtml) always auto-opened the
    // browser's native print dialog via win.onload = () => win.print() - this menu's Estimate/
    // JobCard print options were missing that one line, so the preview opened but nothing looked
    // like a "print" action actually happened.
    win.onload = () => win.print()
  }

  const printEstimate = () => {
    setOpen(false)
    const money = (n: number) => n
    const partRows = jc.partSuggestions.map((p, i) => {
      const mrp = p.mrp ?? 0
      const qty = p.quantity ?? 1
      return { sr: i + 1, code: p.itemCode, description: p.description ?? '-', hsn: p.hsnCode ?? '-', mrp: money(mrp), qty, amount: mrp * qty }
    })
    const labourRows = jc.labourSuggestions.map((l, i) => {
      const rate = l.rateAtSuggestion ?? 0
      const qty = l.quantity ?? 1
      return { sr: i + 1, code: l.labourCode, description: l.labourDescription ?? '-', hsn: l.hsnCode ?? '-', rate: money(rate), qty, amount: rate * qty }
    })
    const partsTotal = partRows.reduce((sum, r) => sum + r.amount, 0)
    const labourTotal = labourRows.reduce((sum, r) => sum + r.amount, 0)
    printWindow(buildEstimatePrintHtml({
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
    }), 'Please allow popups to print the estimate.')
  }

  const printJobCard = () => {
    setOpen(false)
    printWindow(buildJobCardPrintHtml({
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
      technician: jc.baplTechnicianName,
      customerName: jc.customer?.name,
      customerMobile: jc.customer?.mobile,
      address: jc.customer?.address,
      city: jc.customer?.city,
      chassisNo: jc.vehicle?.vin,
      batteryNo: jc.vehicle?.batteryNo,
      chargerNo: jc.vehicle?.chargerNo,
      controllerNo: jc.vehicle?.controllerNo,
      registerNo: jc.vehicle?.regNo,
      modelName: jc.vehicle?.model,
      colour: jc.vehicle?.color,
      insuranceExpiry: jc.vehicle?.insuranceExpiry,
      complaints: jc.complaints.map((c) => c.description),
      jobNo: jc.baplJobNo != null ? String(jc.baplJobNo) : jc.jobCardNumber,
      invoiceNo: jc.invoice?.invoiceNumber,
    }), 'Please allow popups to print the job card.')
  }

  // 2026-09-28 (SECTION 150) - see this component's own doc comment above ("3. Invoice - CHANGED
  // ...") for the full diagnosis. Keeps the exact same "open the window synchronously first, before
  // any await" fix the 2026-09-03 comment below documents (still true and still needed - only the
  // data source changed, not this popup-blocker workaround).
  const printInvoice = async () => {
    setOpen(false)
    setInvoiceBusy(true)
    setMsg(null)
    // 2026-09-03 fix ("invoice not added/opened") - opening a new window/tab is only ever reliably
    // allowed by the browser's popup blocker when it happens synchronously inside the click handler
    // that started it - once an `await` has run, the browser no longer counts it as a direct
    // response to the click. Opening the window FIRST, synchronously, then loading content into it
    // once the fetch finishes - same pattern printWindow above uses - sidesteps the whole issue.
    const win = window.open('', '_blank', 'width=900,height=650')
    if (!win) { setMsg('Please allow popups to view/print the invoice.'); setInvoiceBusy(false); return }
    win.document.write('<p style="font-family:sans-serif;padding:20px;color:#555;">Loading invoice…</p>')
    try {
      const { data } = await staffApi.get<RepairBillDoc[]>('/api/repair-bill-docs', { params: { jobCardId: jc.id } })
      const billed = data.find((b) => b.status === 'Billed')
      if (!billed) {
        win.close()
        setMsg('No Repair Bill has been saved as Invoice for this job card yet.')
        return
      }
      const html = buildRepairBillInvoicePrintHtml(billed, jc.dealer?.name, jc.dealer?.code)
      win.document.open()
      win.document.write(html)
      win.document.close()
      win.focus()
      win.onload = () => win.print()
    } catch {
      win.close()
      setMsg('Could not load the invoice for this job card. Please try again.')
    } finally {
      setInvoiceBusy(false)
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn"
        style={{ border: '1px solid var(--border)' }}
        onClick={() => setOpen((o) => !o)}
        disabled={invoiceBusy}
      >
        🖨️ {invoiceBusy ? 'Opening…' : 'Print'} ▾
      </button>
      {open && (
        <ul style={{
          position: 'absolute', zIndex: 10, top: '100%', right: 0, marginTop: 2, minWidth: 160,
          background: 'var(--card-bg, #fff)', border: '1px solid var(--border)', borderRadius: 8,
          listStyle: 'none', padding: 4, boxShadow: '0 6px 18px rgba(0,0,0,.12)',
        }}>
          <li><button type="button" className="btn btn-sm" style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }} onMouseDown={(e) => { e.preventDefault(); printEstimate() }}>Estimate</button></li>
          <li><button type="button" className="btn btn-sm" style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }} onMouseDown={(e) => { e.preventDefault(); printJobCard() }}>JobCard print</button></li>
          {hasRole('Cashier', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && (
            <li><button type="button" className="btn btn-sm" style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }} onMouseDown={(e) => { e.preventDefault(); printInvoice() }}>Invoice</button></li>
          )}
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
          <PrintMenu jc={jc} hasRole={hasRole} setMsg={setMsg} />
          <StatusBadge status={jc.status} />
        </div>
      </div>
      {msg && <p className="muted">{msg}</p>}

      <div className="form-row" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Customer & Vehicle</h3>
          <p><strong>{jc.customer?.name}</strong><br />{jc.customer?.mobile}</p>
          <p>{jc.vehicle?.model} {jc.vehicle?.variant}<br />Reg: {jc.vehicle?.regNo} | Odometer: {jc.odometerAtCheckIn} km</p>
          <p className="muted">Tracking link: /track/{jc.trackingToken}</p>
          {jc.customer && hasRole('WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && (
            <CustomerPasswordResetButton customerId={jc.customer.id} customerName={jc.customer.name} />
          )}
          {(jc.baplJobType || jc.baplServiceLocation || jc.baplSupervisorName || jc.baplTechnicianName || jc.baplManualJobNo) && (
            <p className="muted" style={{ marginTop: 8 }}>
              <span style={{ background: '#1c64f2', color: '#fff', fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 999, marginRight: 6 }}>
                DMS
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
              {/* Show DMS's own JobNo (what DMS's own Job Card List calls "JobNo") - not
                 baplJobCardHeaderId, which is only JobCardScanner's internal reference to the row
                 and means nothing to a user looking at DMS's own screens. */}
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
        <UpdateWorkflowStageCard jc={jc} stages={stages} busy={busy} run={run} canAssignTechnician={hasRole('WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin')} />
      )}

      <ComplaintsCard jc={jc} run={run} />
      <PhotosCard jc={jc} run={run} />
      <WorklogCard jc={jc} run={run} profileId={profile?.id} />
      {/* Quality Check panel hidden per request - kept in code (not deleted) in case it's needed
         again later. QcCard itself is still defined below, just never rendered. */}
      {SHOW_QUALITY_CHECK_PANEL && hasRole('WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && <QcCard jc={jc} run={run} />}
      {/* Item 16: Part Suggestion, then Item 17: Labour Suggestion, then Item 15: Estimates Amount
         moves to AFTER Labour Suggestion (was before both). */}
      {/* 2026-10-01: the ₹2000 Grand Total auto-lock on these two add-forms has been removed per
         explicit request - no maximum any more. Only the manual Done/Edit `estimatesLocked` state
         gates them now. */}
      <PartSuggestionCard jc={jc} run={run} estimatesLocked={estimatesLocked} />
      <LabourSuggestionCard jc={jc} run={run} estimatesLocked={estimatesLocked} />
      <EstimatesCard jc={jc} run={run} estimatesLocked={estimatesLocked} setEstimatesLocked={setEstimatesLocked} />
      {/* 2026-09-28 CHANGE ("remove DMS Service History" from both web and android): this card
         (DMS's own service/job-card history for this vehicle's chassis, GET /api/bapl-dms/
         service-history) is no longer rendered here - consistent with the same session's broader
         "dont fetch jobcards and dont save jobcards from/to dms" instruction (see
         JobCardsController's matching removals). BaplServiceHistoryCard is left defined below (not
         deleted), same "kept, not deleted" convention as QcCard/InvoiceCard/ClosureCard, in case
         this needs to come back. */}
      {/* 2026-09-24 CHANGE ("hide Invoice and OTP-Based Closure that both coz already have in this
         invoice in Print button"): both cards removed from this page - the Print menu (next to the
         status badge above) already has its own "Invoice" option that opens/downloads the exact
         same PDF InvoiceCard did, and OTP-Based Closure's flow duplicated that same Print/Invoice
         path with an extra SMS-OTP step this request treats as no longer needed here. InvoiceCard/
         ClosureCard are left defined below (not deleted) in case this needs to be revisited -
         same convention as SHOW_QUALITY_CHECK_PANEL's QcCard above. */}
    </div>
  )
}

/** DMS's own service/job-card history for this vehicle's chassis (GET
 * /api/bapl-dms/service-history) - a read-only reference panel, separate from JobCardScanner's own
 * records above it, per the explicit answer to "what should the DMS sync show on this page":
 * "DMS's own service/job-card history for this chassis". Silently shows nothing if the
 * vehicle has no VIN/chassis on file yet, or if DMS has never seen this chassis - only a real
 * DMS problem (502) surfaces as an error, since "no history" is an entirely normal outcome for
 * a brand new vehicle. */
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
        // A 502 here is a real DMS problem; anything else (404/network hiccup) just means
        // "nothing to show", which is normal and not worth alarming the service advisor over.
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

/** Photo capture + upload, added to the Job Card Detail page (not the wizard - see the explicit
 * "On the Job Card Detail page only, after creation" answer). Captures the browser's GPS location
 * (Geolocation API) at the same moment a photo is picked, so the two travel together to
 * POST /api/jobcards/{id}/photos/upload as one multipart/form-data request; location is best-effort
 * and the upload still proceeds without it (denied permission, no GPS fix, desktop browser, etc). */
function PhotosCard({ jc, run }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>, successMsg?: string) => void }) {
  // Item 8: Stage field removed from this card entirely (still sent to the API as a fixed
  // default, since JobCardPhoto.Stage is a required column - it's just no longer something the
  // user picks or sees here). Caption moved from "pre-upload only" to editable per-photo below.
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
        () => resolve(null), // permission denied / unavailable - upload proceeds without coordinates
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
        {/* capture="environment" hints the rear camera on a phone; still falls back to a normal
           file picker on desktop, where "capture" is simply ignored. */}
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
              {/* Item 8: Caption now lives here, editable per photo, instead of only being set
                 once before upload. */}
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

/** The interactive counterpart to the read-only WorkflowTimeline above: moves the job card to a
 * new stage (POST /stage, ServiceAdvisor+) and, for WorkshopManager+, also assigns a technician
 * and expected-completion date (PUT /api/jobcards/{id}) in the same action - mirrors the combined
 * "Update Workflow Stage" panel this was modelled on.
 *
 * No longer has a manual stage picker (per explicit request: "dont want manual whole... stage
 * automatically update") - the job card's stage now advances itself as real work happens (see
 * backend WorkflowStageAutomation): adding a part/labour suggestion, drafting an estimate, or
 * starting a technician worklog each auto-advance to the matching stage the first time they
 * happen. Only two of the 8 stages have no such unambiguous trigger anywhere else in the app -
 * "Repair Completed" and "Ready for Delivery" - so those stay one explicit button each below,
 * never a dropdown. Assign Technician / Expected Completion / Remarks stay manual fields, exactly
 * as asked. */
function UpdateWorkflowStageCard({
  jc, stages, busy, run, canAssignTechnician,
}: {
  jc: JobCardDetail
  stages: WorkflowStage[]
  busy: boolean
  run: (fn: () => Promise<unknown>, successMsg?: string) => void
  canAssignTechnician: boolean
}) {
  // 2026-09-24 CHANGE ("that bind in jobcard ... Assign Technician name update"): was a free-text
  // name (no confirmed technician catalog existed); now a dropdown bound to the new login-less
  // Technician Employee roster (see types/Technician.cs), scoped to this job card's own Service
  // Location - same GET /api/technicians?locationCode=... the Job Card Wizard's own Technician
  // field uses. Still sent as the plain assignedTechnicianName string on PUT /api/jobcards/{id}
  // (unchanged field/shape on the backend - see JobCardsController.Update) - the dropdown only
  // changes how the value is picked, not what's stored.
  const [technicianName, setTechnicianName] = useState(jc.assignedTechnicianName ?? '')
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState(jc.expectedDeliveryAt ? jc.expectedDeliveryAt.slice(0, 16) : '')
  const [notes, setNotes] = useState('')
  const [technicianOptions, setTechnicianOptions] = useState<Technician[]>([])

  useEffect(() => {
    setTechnicianName(jc.assignedTechnicianName ?? '')
    setExpectedDeliveryAt(jc.expectedDeliveryAt ? jc.expectedDeliveryAt.slice(0, 16) : '')
  }, [jc.id, jc.assignedTechnicianName, jc.expectedDeliveryAt])

  useEffect(() => {
    // No dealerId param for a regular dealer-scoped login (TechniciansController.List already
    // scopes to _currentUser.DealerId) - only relevant for a Corporate/System Admin viewing a job
    // card outside their own dealer, hence jc.dealer?.id here.
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
  // 2026-09-28 (SECTION 145, then REVERTED same day - SECTION 147): a "Generate Invoice & Close Job
  // Card" button briefly lived here, moving the job card straight to the terminal
  // "invoice_generated" stage on a click. WITHDRAWN per your correction: "we cant close jobcards
  // without repair ... save as proforma then save as invoice then this jobcard close" - closing is
  // tied to your existing Repair Bill flow (Proforma -> Invoice save) elsewhere in the app, not a
  // button on this page. See README SECTION 147.
  //
  // 2026-09-29 (SECTION 156, "not update stagw which i told befre Ready for Delivery / wants
  // Invoice Generated stage and manually we can done stage of Invoice Generated") - REINSTATED,
  // corrected: a manual "Mark Invoice Generated" button is back below, ADDITIVE to (not replacing)
  // the automatic trigger SECTION 147/149 built into RepairBillDocsController.UpdateStatus (a
  // linked Repair Bill saved as Invoice still auto-advances + auto-closes on its own, unchanged).
  // "Repair Completed"/"Ready for Delivery" above are UNTOUCHED per your explicit "not update
  // stage ... Ready for Delivery" instruction - same disabled-once-past pattern, same markStage().
  //
  // FLAGGED - please confirm this is what you want: this is the opposite of what SECTION 147
  // withdrew ("we cant close jobcards without repair"). I'm implementing it because it's your most
  // recent explicit instruction, but since RepairBillDocsController's generic ChangeStage() action
  // (the same POST /api/jobcards/{id}/stage this button calls, via markStage()) closes the job card
  // whenever a stage marked IsTerminal is reached, clicking this button WILL close the job card
  // immediately - with no Repair Bill required at all, and no Invoice PDF necessarily on file. If
  // you only meant "let us mark it manually when the repair bill was already generated/invoiced
  // outside a saved Repair Bill row here" (e.g. a walk-in bill, or one entered directly in
  // DMS/BAPL), this button does that correctly. If you meant something narrower - e.g. only enabled
  // once a Repair Bill row for this job card already shows Status=Billed - tell me and I'll add
  // that guard (the PrintMenu.printInvoice() function just below already fetches
  // `/api/repair-bill-docs?jobCardId=...` and checks `b.status === 'Billed'`, so the same check is
  // easy to reuse here).
  const invoiceGeneratedStage = stages.find((s) => s.stageKey === 'invoice_generated')
  const markStage = (stage?: WorkflowStage) => {
    if (!stage) return Promise.resolve()
    return staffApi.post(`/api/jobcards/${jc.id}/stage`, { stageId: stage.id, notes: notes || null })
  }

  return (
    <div className="card">
      <h3>Update Workflow Stage</h3>
      <p className="muted" style={{ marginTop: -6 }}>
        The stage above now advances automatically as work happens - parts/labour suggested, an
        estimate drafted, a technician's first worklog started. Use the buttons below for the steps
        with no automatic trigger. A linked Repair Bill saved as Invoice still auto-advances and
        auto-closes this job card on its own (unchanged) - "Mark Invoice Generated" below is an
        additional MANUAL way to reach that same stage, and closes the job card immediately when
        clicked, with or without a Repair Bill on file. See this card's own SECTION 156 code comment
        if you want that tightened to only work once a Repair Bill here already shows Billed.
      </p>
      {/* 2026-09-24 CHANGE ("before start required Assign Technician name update"): every stage
         change - the two manual buttons below AND every automatic trigger elsewhere on this page
         (worklog start, part/labour suggestion) - is now refused with a 400 until a Technician is
         assigned here first (see JobCardsController.RequireAssignedTechnician). The refusal's own
         message already surfaces through the page's msg banner (see run()'s catch block above),
         but this note says so up front instead of only after a first failed attempt. */}
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
              {/* A pre-existing name (saved as free text before this dropdown existed, or a
                 Technician later deactivated/removed) that no longer matches any option - keep it
                 selectable so opening this dropdown never silently blanks/overwrites it on Save. */}
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
        {/* 2026-10-01 ("in Workflow Timeline after Repair Completed shift Invoice Generated after
           this Ready for Delivery"): this button moved ahead of "Mark Ready for Delivery" below,
           per explicit request, so the button ROW now reads Repair Completed -> Invoice Generated
           -> Ready for Delivery. See this component's own doc comment above (just before
           markStage) for the full history/interpretation flag on this button. Same disabled-once-
           past pattern as the other two buttons; markStage() posts to the same generic
           /api/jobcards/{id}/stage endpoint the automatic Repair-Bill-Billed trigger's
           WorkflowStageAutomation call also feeds into, so a job card marked this way ends up in
           an identical CurrentStage/StageHistory state either way.
           NOTE - FLAGGED, not yet done: the read-only Workflow Timeline STEPPER further up this
           page (<WorkflowTimeline stages={buildTimelineStages(stages)} .../>) is a separate
           component from this button row, and its left-to-right order comes from the `stages`
           array's own Seq values as seeded on the backend (GET /api/workflow-stages) - I don't have
           that seed source (DbSeeder.cs or equivalent) or WorkflowTimeline.tsx's own rendering
           logic in this session, so I have NOT reordered that stepper itself here, only this
           action-button row. See my reply for what I need from you to also fix the stepper. */}
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
        {/* 2026-09-29 (SECTION 156) - see this component's own doc comment above (just before
           markStage) for the full history/interpretation flag on this button. Same disabled-once-
           past pattern as the two buttons above; markStage() posts to the same generic
           /api/jobcards/{id}/stage endpoint the automatic Repair-Bill-Billed trigger's
           WorkflowStageAutomation call also feeds into, so a job card marked this way ends up in
           an identical CurrentStage/StageHistory state either way. */}
        {invoiceGeneratedStage && (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || currentSeq >= invoiceGeneratedStage.seq}
            onClick={() => run(() => markStage(invoiceGeneratedStage), 'Marked Invoice Generated. Job card closed.')}
          >
            Mark Invoice Generated
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

// 2026-09-07: timer is manual again per explicit request ("timer start button add manual start...
// remove condition when it is in Work In Progress then start that timer button add"). Starting the
// timer (POST /worklogs/start) already flips jc.status to InProgress as a side effect on the
// backend (StartWorklog) and auto-advances the workflow stage - so clicking "Start Timer" IS what
// puts the job card into Work In Progress, there's no separate InProgress-gated visibility to
// remove beyond the old auto-start effect itself. A manual "Stop Timer" button ends the open log;
// the job-card-closed auto-stop effect below stays as a safety net so a forgotten timer doesn't run
// forever, but starting is never automatic anymore. All timestamps are shown explicitly in IST
// (Asia/Kolkata) rather than the browser's own locale/timezone, per explicit request ("dont use utc
// show actual time current time zone is IST").
const IST_TIME_ZONE = 'Asia/Kolkata'
const formatIST = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-IN', { timeZone: IST_TIME_ZONE, ...opts })
const formatISTTime = (iso: string) => formatIST(iso, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
const formatISTDateTime = (iso: string) => formatIST(iso, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })

/** "now i start timer but still another time show current time 11.51 not shown in timer" - formats
 * a millisecond duration as H:MM:SS (or M:SS under an hour) for WorklogCard's live elapsed-time
 * display below. */
function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Whether a Part/Labour suggestion can be added right now - gated on an open (not-yet-ended)
 * worklog existing, per explicit request ("Part Suggestion, Labour Suggestion not can update give
 * alret in this process start the timer"). Exported-shape helper (not exported, just shared) so
 * PartSuggestionCard/LabourSuggestionCard below check the exact same condition WorklogCard uses to
 * decide whether the timer looks "running". */
const hasOpenWorklog = (jc: JobCardDetail) => jc.worklogs.some((w) => !w.endedAt)

function WorklogCard({ jc, run, profileId }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>) => void; profileId?: string }) {
  const openLog = jc.worklogs.find((w) => !w.endedAt)

  // "now i start timer but still another time show current time 11.51 not shown in timer" - the
  // "Timer running since ..." line below only ever rendered once, from whatever jc.worklogs looked
  // like the moment the page last fetched it, so it silently froze at the start time forever and
  // never reflected that real time kept passing while the timer ran - there was nothing here to
  // ever trigger a re-render on its own. This ticks nowMs once a second (only while a worklog is
  // actually open, so it's a complete no-op the rest of the time - not a page-wide poller) purely
  // so the elapsed-time text below stays live instead of static.
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
            {formatElapsedMs(nowMs - new Date(openLog.startedAt).getTime())}.
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

/** Item 18: redefined from an OTP-gated customer-approval flow into a pure calculation view - a
 * Part Details table (Sr no., Part No./Item Code, Description, HSN, MRP, Qty, Amount = MRP x Qty)
 * sourced from jc.partSuggestions, a Labour Details table (same shape, Amount = Rate x Qty) sourced
 * from jc.labourSuggestions, and a Grand Total row summing both. Per an explicit decision, this
 * REPLACES the old Description/Amount/Reason + "Send Estimate to Customer" OTP flow entirely -
 * that flow (and the Estimate/estimateNumber data behind it) still exists in the backend, just no
 * longer surfaced on this card.
 *
 * 2026-09-07: added a "Done"/"Edit" toggle per explicit request. "Done" (blue button) locks the
 * estimate - PartSuggestionCard/LabourSuggestionCard's "add a new suggestion" forms hide (their
 * already-added grids stay visible - see `estimatesLocked` threaded down from JobCardDetailPage)
 * and an email textbox + Send button appear right here so the estimate can be mailed out as a PDF
 * attachment (POST /api/jobcards/{id}/estimates/email - see JobCardsController.EmailEstimate /
 * IEstimatePdfService). "Edit" flips back, re-showing the add-suggestion forms and hiding the email
 * box. This toggle is plain client-side UI state (see JobCardDetailPage's `estimatesLocked`) - it
 * is NOT persisted to the backend, so it resets to unlocked on a fresh page load; nothing about
 * this changes what's actually saved (the parts/labour suggestions themselves still save
 * immediately as before).
 *
 * 2026-10-01 ("after close Jobcard this done button remove"): once jc.status === 'Closed', the
 * Done/Edit toggle itself is no longer rendered at all - a closed job card's estimate has nothing
 * left to lock/unlock, so just the Grand Total shows.
 *
 * 2026-10-01 follow-up ("this jobcard closed still shown done button and Edit and send mail
 * fuctionality hide this after close"): the email-estimate box (address field + Send Estimate
 * button) is now ALSO hidden once closed - previously it stayed visible on a closed job card on
 * the theory that mailing out the final estimate was still useful after closure; that was an
 * unconfirmed Assumption and this instruction replaces it. Now: email box shows only while
 * `estimatesLocked && !closed` (same "Done" lock as before, but closed always wins and hides it).
 *
 * NOTE on "closed": jc.status only becomes 'Closed' when a workflow stage flagged IsTerminal is
 * reached (see backend JobCardsController.ChangeStage: `if (stage.IsTerminal && jc.Status !=
 * Closed) jc.Status = Closed`). Today only "Invoice Generated" carries IsTerminal=true. If a job
 * card looks finished to you but this card's Edit/Done + email box are still showing, it most
 * likely means that job card's Status field isn't actually 'Closed' yet (it hasn't been moved to
 * the Invoice Generated stage) - worth confirming on the specific job card via its status badge
 * before assuming this code path isn't working. */
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
    return { sr: i + 1, code: p.itemCode, description: p.description ?? '-', hsn: p.hsnCode ?? '-', mrp, qty, amount: mrp * qty }
  })
  const labourRows = jc.labourSuggestions.map((l, i) => {
    const rate = l.rateAtSuggestion ?? 0
    const qty = l.quantity ?? 1
    return { sr: i + 1, code: l.labourCode, description: l.labourDescription ?? '-', hsn: l.hsnCode ?? '-', rate, qty, amount: rate * qty }
  })
  const partsTotal = partRows.reduce((sum, r) => sum + r.amount, 0)
  const labourTotal = labourRows.reduce((sum, r) => sum + r.amount, 0)
  const grandTotal = partsTotal + labourTotal
  // 2026-10-01: a closed job card has nothing left to lock/unlock, so the Done/Edit toggle is
  // hidden entirely below - see this component's doc comment.
  const closed = jc.status === 'Closed'

  return (
    <div className="card">
      <h3>Estimates Amount</h3>

      <h4>Part Details</h4>
      <table>
        {/* 2026-09-03: header text matched to Part Suggestion's own "Item Code" column above (was
           "Part No. (Item Code)") - same table, same field, should read the same everywhere. */}
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

/** "Part Suggestion" panel (renamed from "Parts Used" - see JobCardPartSuggestion's doc comment in
 * types/index.ts). 2026-09-24 CHANGE ("Part Suggestion and Labour Suggestion that link with our
 * labour-master, item-master and part-upload"): parts now come from this app's OWN Item Master +
 * Part Upload data (GET /api/jobcards/parts-catalog?locationCode=... -
 * JobCardsController.PartsCatalog) instead of DMS's live PartsInventory (the old
 * GET /api/bapl-dms/parts) - consistent with job cards no longer being written into/read from DMS.
 * Fetched once on mount the same way BaplServiceHistoryCard above fetches its supplementary data;
 * suggesting one just records an itemCode + a Paid/U-W status in JobCardScannerDb
 * (POST .../part-suggestions) - nothing is written back into DMS. Status can be flipped afterwards
 * (PUT .../part-suggestions/{id}). */
/** Item 16: reworked into a type-ahead Item Code search (bound to description, so typing either
 * the code or a word of the description narrows the list), a Qty field (distinct from the
 * available-stock number, which is only shown as a hint), and multi add/remove - each suggested
 * part gets its own Remove button (DELETE /api/jobcards/part-suggestions/{id}), instead of the old
 * Paid/U-W toggle being the only action available. Grid columns per spec: Sr no., Item Code,
 * Description, MRP, QTY, IssueType(Status). */
function PartSuggestionCard({ jc, run, estimatesLocked }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>, successMsg?: string) => void; estimatesLocked: boolean }) {
  const [availableParts, setAvailableParts] = useState<JobCardsPartsCatalogRow[]>([])
  const [search, setSearch] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [itemCode, setItemCode] = useState('')
  const [qty, setQty] = useState<number>(1)
  const [status, setStatus] = useState<'Paid' | 'U/W'>('Paid')
  // 2026-09-28 (SECTION 137) - see describeSearchError's own doc comment above: distinguishes a
  // real backend failure on this search from a genuine zero-match, instead of both looking
  // identical ("does not exist").
  const [searchError, setSearchError] = useState<string | null>(null)

  // 2026-09-28 fix ("search from select * from C_ItemMaster and 3/part-upload but still not
  // search why" - a real part, confirmed by you in both PartUploads and C_ItemMaster, still never
  // showed up here): FACT, root cause - this used to fetch ONCE on mount with NO `q` param, then
  // filter that one batch client-side as you typed. GET .../parts-catalog's Item Master list comes
  // from IBaplDealerService.SearchItemMasterAsync, which (per ItemMasterPage.tsx's own doc
  // comment) is server-capped to roughly the first 1000 items, ALPHABETICALLY, whenever `q` is
  // blank. A part that falls outside that one capped, alphabetically-sorted batch could never
  // appear here no matter what you typed - nothing ever asked the backend again with your actual
  // search text, it only ever filtered whatever happened to already be in that first blank-query
  // page. FIXED: now sends your typed text as a real `q` param on every keystroke (debounced
  // 300ms, same pattern LabourSuggestionCard below already uses), so SearchItemMasterAsync
  // actually searches/narrows server-side instead of relying on an unfiltered, capped batch - this
  // should now find a part regardless of where it falls alphabetically in the full catalog.
  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = search.trim()
      if (trimmed.length === 0) { setAvailableParts([]); setSearchError(null); return }
      staffApi.get<JobCardsPartsCatalogRow[]>('/api/jobcards/parts-catalog', {
        params: { q: trimmed, ...(jc.baplServiceLocationCode ? { locationCode: jc.baplServiceLocationCode } : {}) },
      })
        .then(({ data }) => { setAvailableParts(data); setSearchError(null) })
        .catch((err) => {
          // 2026-09-28 (SECTION 137): was `.catch(() => setAvailableParts([]))` - a REAL backend
          // failure here (e.g. this endpoint's own 502 when the BAPL C_ItemMaster connection has a
          // problem) looked byte-for-byte identical to "your search text matched nothing", which
          // is how a confirmed-real part ("0301-A01-1025", confirmed in both C_ItemMaster and
          // PartUploads via your real SQL) could show "does not exist" even though
          // IBaplDealerService.SearchItemMasterAsync's own WHERE clause (confirmed from your real
          // pasted source - a plain `ItemCode LIKE @q`, no Status filter at all) should match it
          // directly. Now shows the real HTTP status/message instead of silently pretending
          // nothing matched, so the next time this happens you'll see exactly what failed.
          setAvailableParts([])
          setSearchError(describeSearchError(err, 'Search failed'))
        })
    }, 300)
    return () => clearTimeout(handle)
  }, [search, jc.baplServiceLocationCode])

  // 2026-09-28: selectedPart is now set directly at pick time (see pickPart below) instead of
  // derived via `availableParts.find(...)` - the same fix already applied to Labour Suggestion's
  // `selected` state (see LabourSuggestionCard's own 2026-09-03 doc comment for the full story).
  // Deriving it from availableParts broke the instant you picked a part: pickPart sets `search` to
  // the picked part's own "code - description" text, which is also this effect's fetch trigger, so
  // that same assignment re-fires the debounced search a moment later against that literal string -
  // which rarely matches anything, replacing availableParts with an empty (or different) list and
  // silently un-picking whatever had just been selected.
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
        <thead><tr><th>Sr no.</th><th>Item Code</th><th>Description</th><th>MRP</th><th>QTY</th><th>Issue Type (Status)</th><th>Picture</th><th></th></tr></thead>
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
                <button
                  className="btn btn-sm"
                  onClick={() => run(() => staffApi.put(`/api/jobcards/part-suggestions/${p.id}`, { status: p.status === 'Paid' ? 'U/W' : 'Paid' }))}
                >
                  Mark {p.status === 'Paid' ? 'U/W' : 'Paid'}
                </button>
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

      {/* Estimates Amount "Done" hides this add-new-suggestion form (grid above stays visible) -
         see EstimatesCard's doc comment for the full Done/Edit toggle. 2026-10-01: the separate
         ₹2000 Grand Total auto-lock that used to apply here has been removed per explicit request -
         this form now has no maximum and only respects the manual Done/Edit toggle, plus a closed
         job card (jc.status === 'Closed') also hides it - estimatesLocked resets to false on every
         fresh page load, and a closed job card's Done/Edit toggle is itself gone now (see
         EstimatesCard), so without this a closed job card's add-forms would otherwise reopen. */}
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
      {/* Item-code/description, QTY, Issue Type and the Add Suggestion button all in one row now,
         matching Suggest labour's layout below - Add sits at the end of the row instead of on its
         own line underneath. .suggest-row (not .form-row) so the search field grows and Qty/Issue
         Type/Add stay sized to their content instead of being stretched into equal-width columns. */}
      <div className="suggest-row">
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
              // Item 4: was silently blank when nothing matched - now says explicitly why, instead
              // of looking like the search itself is broken. 2026-09-28 (SECTION 137): now branches
              // on searchError - a real backend failure no longer shows the misleading "does not
              // exist" text (see describeSearchError's own doc comment above for why that mattered).
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
          <label>Issue Type (Status)</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'Paid' | 'U/W')}>
            <option value="Paid">Paid</option>
            <option value="U/W">U/W</option>
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
      {selectedPart && (
        <p className="muted">MRP {selectedPart.mrp != null ? `₹${selectedPart.mrp}` : '-'} · HSN {selectedPart.hsnCode ?? '-'} · Available {selectedPart.availableQty}</p>
      )}
      </>
      )}
    </div>
  )
}

/** Part Suggestion grid's "Picture" column (2026-09-03 - "which partcode we added after added we
 * upload phtoos and video"). One cell per already-added suggestion row: shows whatever
 * photos/videos have already been uploaded against it (small clickable thumbnails - a video shows
 * a "▶" badge instead of trying to render a full inline player in a table cell) plus a small "+"
 * button that opens the file picker straight to POST /api/jobcards/{id}/photos/upload with
 * PartSuggestionId set to this row's id and Stage fixed to 'PartSuggestion'. Deliberately has no
 * caption/GPS capture like the general Photos card - this is just "attach evidence to this part",
 * not a dated site-visit record. */
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
        // eslint-disable-next-line no-await-in-loop -- uploads one file at a time on purpose, so a
        // failure partway through a multi-file pick still keeps the ones that already succeeded
        // (run() reloads jc after every call, so each upload shows up as soon as it lands).
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
        // 2026-09-03 fix ("uploaded photos not shown") - JobCardPhoto.Url is a relative path
        // (e.g. "/uploads/jobcard-photos/..."), served by the BACKEND, not the Vite dev server
        // this page itself runs on - a bare `src={ph.url}` resolves against the page's own origin
        // (localhost:5173) and 404s there. Every other photo on this page already goes through the
        // photoSrc() helper (see the top of this file) for exactly this reason; this cell was the
        // one place that used ph.url directly instead.
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

/** "Labour Suggestion" panel (see JobCard.LabourSuggestions) - mirrors PartSuggestionCard above.
 * 2026-09-24 CHANGE ("Part Suggestion and Labour Suggestion that link with our labour-master"):
 * now pulls from this app's OWN imported Labour Master rate card (GET
 * /api/jobcards/labour-catalog?search=... - JobCardsController.LabourCatalog, unions
 * LabourMasterWithoutPartwise + LabourMasterPartwise) instead of DMS's live LabourMaster (the old
 * GET /api/bapl-dms/labour). The old Job Type/Service Head/Service Type cascade scoping is gone
 * along with it - JobCardScanner's own imported Labour Master has no such cascade concept - so
 * this is now a plain free-text search-as-you-type over labour code/description only. HSN is
 * always null from this source (Labour Master doesn't carry a per-row HSN - see
 * JobCardsLabourCatalogRow's doc comment); Description/GST/Rate are snapshotted from whichever
 * row is picked, not re-editable once added (Rate especially - see JobCardLabourSuggestion's doc
 * comment); Quantity and Issue Type (free text, not a fixed dropdown) can be edited after the
 * fact. */
// Issue Type is a fixed Paid / Under Warranty choice, not free text - matches how the workshop
// actually bills labour (paid work vs. work covered by the vehicle's warranty).
const LABOUR_ISSUE_TYPES = ['Paid', 'U/W'] as const

function LabourSuggestionCard({ jc, run, estimatesLocked }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>, successMsg?: string) => void; estimatesLocked: boolean }) {
  const [rows, setRows] = useState<JobCardsLabourCatalogRow[]>([])
  const [q, setQ] = useState('')
  // Type-ahead dropdown state, mirroring PartSuggestionCard's search/pickPart pattern above -
  // "search, see a list appear below, pick one, it locks" instead of the old plain <select> (which
  // needed an extra click to open and, with a search box that looked inert above it, read as
  // "typing 'P' then Enter does nothing").
  const [showSuggestions, setShowSuggestions] = useState(false)
  // Tracks the selected LabourMaster row by its own unique int id, NOT by LabourCode - real
  // LabourMaster data has the same LabourCode repeated across several rows for different
  // CityTier/oemmodelname scoping (e.g. "SF0M001" appears 4 times), so keying/looking up by
  // LabourCode both broke React's key uniqueness and silently resolved to the wrong row's
  // rate/HSN/GST (always the first match) regardless of which option was actually picked.
  const [selectedId, setSelectedId] = useState('')
  // Holds the actually-picked row's own data, set once at pick time - see pickLabour below for why
  // this can no longer be derived as `rows.find(...)` (2026-09-03 fix).
  const [selected, setSelected] = useState<JobCardsLabourCatalogRow | null>(null)
  const [qty, setQty] = useState<number>(1)
  const [issueType, setIssueType] = useState('')
  const [editing, setEditing] = useState<{ id: string; qty: number; issueType: string } | null>(null)

  useEffect(() => {
    // Debounced (300ms) same as every other search-as-you-type box in this app - was firing a
    // request on every single keystroke before.
    const handle = setTimeout(() => {
      staffApi.get<JobCardsLabourCatalogRow[]>('/api/jobcards/labour-catalog', { params: q.trim() ? { search: q.trim() } : {} })
        .then(({ data }) => setRows(data))
        .catch(() => setRows([]))
    }, 300)
    return () => clearTimeout(handle)
  }, [q])

  // 2026-09-03 fix ("Add Suggestion" silently doing nothing under Labour Suggestion): this used to
  // be `rows.find((r) => String(r.id) === selectedId)`. pickLabour below sets `q` to the picked
  // row's own "Code - Description" text so the input shows what was chosen - but `q` is also this
  // effect's search trigger, so that same assignment re-fires the debounced search a moment later,
  // searching DMS for the literal string "SF0M001 - Some Description". That essentially never
  // matches a real LabourCode/Description on its own, so `rows` comes back empty and `selected`
  // (when derived from `rows`) would go right back to undefined - even though selectedId (and so
  // the enabled Add Suggestion button) still looked picked. Clicking Add Suggestion then hit
  // `if (!selected) return` and silently did nothing: no request, no error, nothing added to the
  // grid. Storing the picked row directly (see pickLabour) instead of re-deriving it from `rows`
  // means a later, unrelated re-search can no longer un-pick it.

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

      {/* Estimates Amount "Done" hides this add-new-suggestion form (grid above stays visible) -
         see EstimatesCard's doc comment for the full Done/Edit toggle. 2026-10-01: the separate
         ₹2000 Grand Total auto-lock that used to apply here has been removed per explicit request -
         this form now has no maximum and only respects the manual Done/Edit toggle, plus a closed
         job card (jc.status === 'Closed') also hides it - see PartSuggestionCard's matching
         2026-10-01 doc comment above for why. */}
      {estimatesLocked || jc.status === 'Closed' ? (
        <p className="muted">
          {jc.status === 'Closed'
            ? 'Job card is closed - no more labour can be suggested.'
            : 'Estimate is marked Done - click Edit on the Estimates Amount card below to add more labour.'}
        </p>
      ) : (
      <>
      <h4>Suggest labour (from Labour Master)</h4>
      {/* Item 17: Labour Code, Qty, Issue Type and the Add Suggestion button all in one row now -
         no separate "Search" field/label any more, same as Item Code / Description above: the
         Labour Code field itself IS the search box (typing filters the dropdown below it), matching
         PartSuggestionCard's pattern instead of presenting search as a distinct extra step.
         .suggest-row (not .form-row) so this field grows and Qty/Issue Type/Add stay sized to their
         content instead of being stretched into equal-width columns. */}
      <div className="suggest-row">
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
                      {/* 2026-09-03: PartWiseLabourMaster rows are tied to a specific part - shown
                         here so it's clear this rate applies to that part, not labour in general
                         (plain LabourMaster rows have no partCode, so this never shows for those). */}
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

/** "Download Invoice from DMS" - DMS's own repair bill is the source of truth for a job
 * card's invoice. Streams the PDF through staffApi so the same Bearer token every other call on
 * this page carries is attached (see api/client.ts's interceptor) - a plain <a href> pointed at
 * the API would 401 instead of downloading anything - then hands the blob to the browser via a
 * temporary <a download> element. Re-added 2026-09-03 as its own card below DMS Service
 * History (it briefly lived only inside the header's Print menu - see PrintMenu's "Invoice"
 * option, which stays too and opens the same PDF in a new tab instead of forcing a download). */
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
          // Only ever populated when the API is running in Development - there's no real SMS
          // provider wired up yet (see OtpService), so without this there was no way to actually
          // complete this flow outside of digging through server logs, which is what was causing
          // "Verify & Close" to always 400 with "Invalid or expired OTP."
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
