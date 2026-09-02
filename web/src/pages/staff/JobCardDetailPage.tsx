// web\src\pages\staff\JobCardDetailPage.tsx
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import { StatusBadge } from '../../components/StatusBadge'
import { WorkflowTimeline, type WorkflowTimelineHistoryEntry } from '../../components/WorkflowTimeline'
import type { BaplDmsJobCardHistory, BaplDmsLabourRow, BaplDmsPartStock, JobCardDetail, PhotoStage, WorkflowStage } from '../../types'

// Photo URLs come back from the API as a relative path (e.g. "/uploads/jobcard-photos/.../x.jpg" -
// see JobCardsController.UploadPhoto), same origin as the API itself, not the frontend dev server.
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL
const photoSrc = (url: string) => (url.startsWith('http') ? url : `${API_BASE_URL}${url}`)

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

export function JobCardDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile, hasRole } = useStaffAuth()
  const [jc, setJc] = useState<JobCardDetail | null>(null)
  const [stages, setStages] = useState<WorkflowStage[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

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

  const run = async (fn: () => Promise<unknown>, successMsg?: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      await load()
      if (successMsg) setMsg(successMsg)
    } catch (err: unknown) {
      setMsg((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{jc.jobCardNumber}</h2>
        <StatusBadge status={jc.status} />
      </div>
      {msg && <p className="muted">{msg}</p>}

      <div className="form-row" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Customer & Vehicle</h3>
          <p><strong>{jc.customer?.name}</strong><br />{jc.customer?.mobile}</p>
          <p>{jc.vehicle?.model} {jc.vehicle?.variant}<br />Reg: {jc.vehicle?.regNo} | Odometer: {jc.odometerAtCheckIn} km</p>
          <p className="muted">Tracking link: /track/{jc.trackingToken}</p>
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
              {/* Show BAPL DMS's own JobNo (what BAPL DMS's own Job Card List calls "JobNo") - not
                 baplJobCardHeaderId, which is only JobCardScanner's internal reference to the row
                 and means nothing to a user looking at BAPL DMS's own screens. */}
              ✅ Synced to BAPL DMS as{' '}
              <a href={`/jobcards/bapl/${jc.baplJobCardHeaderId}`}>
                {jc.baplJobNo != null ? `job card #${jc.baplJobNo}` : 'a job card (BAPL DMS sync pending)'}
              </a>.
            </p>
          )}
          {jc.baplSyncStatus === 'Failed' && (
            <p className="error-text" style={{ marginTop: 4 }}>
              ⚠ Not yet synced to BAPL DMS{jc.baplSyncError ? `: ${jc.baplSyncError}` : '.'}
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
        </div>
      </div>

      {hasRole('ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && (
        <UpdateWorkflowStageCard jc={jc} stages={stages} busy={busy} run={run} canAssignTechnician={hasRole('WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin')} />
      )}

      <ComplaintsCard jc={jc} run={run} />
      <PhotosCard jc={jc} run={run} />
      <WorklogCard jc={jc} run={run} profileId={profile?.id} />
      {/* Quality Check panel hidden per request - kept in code (not deleted) in case it's needed
         again later. QcCard itself is still defined below, just never rendered. */}
      {SHOW_QUALITY_CHECK_PANEL && hasRole('WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && <QcCard jc={jc} run={run} />}
      {/* Item 16: Part Suggestion, then Item 17: Labour Suggestion, then Item 15: Estimates Amount
         moves to AFTER Labour Suggestion (was before both). */}
      <PartSuggestionCard jc={jc} run={run} />
      <LabourSuggestionCard jc={jc} run={run} />
      <EstimatesCard jc={jc} run={run} />
      {hasRole('Cashier', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && <InvoiceCard jc={jc} />}
      {/* Item 13: BAPL DMS Service History moves to AFTER Invoice (was the 2nd card, right after
         Update Workflow Stage). */}
      <BaplServiceHistoryCard chassisNo={jc.vehicle?.vin} dealerCode={jc.dealer?.code} />
      <ClosureCard jc={jc} run={run} />
    </div>
  )
}

/** BAPL DMS's own service/job-card history for this vehicle's chassis (GET
 * /api/bapl-dms/service-history) - a read-only reference panel, separate from JobCardScanner's own
 * records above it, per the explicit answer to "what should the BAPL DMS sync show on this page":
 * "BAPL DMS's own service/job-card history for this chassis". Silently shows nothing if the
 * vehicle has no VIN/chassis on file yet, or if BAPL DMS has never seen this chassis - only a real
 * BAPL DMS problem (502) surfaces as an error, since "no history" is an entirely normal outcome for
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
        // A 502 here is a real BAPL DMS problem; anything else (404/network hiccup) just means
        // "nothing to show", which is normal and not worth alarming the service advisor over.
        if (err?.response?.status === 502) setError(msg ?? 'Could not reach BAPL DMS.')
        setRows([])
      })
  }, [chassisNo, dealerCode])

  if (!chassisNo) return null

  return (
    <div className="card">
      <h3>BAPL DMS Service History</h3>
      {error && <p className="muted">{error}</p>}
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows !== null && rows.length === 0 && !error && <p className="muted">No prior BAPL DMS job cards found for this chassis.</p>}
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
  const [stage, setStage] = useState<PhotoStage>('CheckIn')
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [locationNote, setLocationNote] = useState<string | null>(null)

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
      form.append('Stage', stage)
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

  const stages: PhotoStage[] = ['CheckIn', 'Inspection', 'Repair', 'Qc', 'Delivery']

  return (
    <div className="card" id="photos">
      <h3>Photos</h3>
      <div className="form-row">
        <div className="field">
          <label>Stage</label>
          <select disabled={uploading} value={stage} onChange={(e) => setStage(e.target.value as PhotoStage)}>
            {stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
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
            <div key={p.id} style={{ width: 160 }}>
              <a href={photoSrc(p.url)} target="_blank" rel="noreferrer">
                <img src={photoSrc(p.url)} alt={p.caption ?? p.stage} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6, border: '1px solid #ddd' }} />
              </a>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                {p.stage}{p.caption ? ` · ${p.caption}` : ''}
                {p.latitude != null && p.longitude != null && (
                  <><br /><a href={`https://maps.google.com/?q=${p.latitude},${p.longitude}`} target="_blank" rel="noreferrer">📍 {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</a></>
                )}
              </p>
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
 * "Update Workflow Stage" panel this was modelled on. Kept as two conditionally-fired requests
 * rather than one endpoint since the backend already splits this exact way by role. */
function UpdateWorkflowStageCard({
  jc, stages, busy, run, canAssignTechnician,
}: {
  jc: JobCardDetail
  stages: WorkflowStage[]
  busy: boolean
  run: (fn: () => Promise<unknown>, successMsg?: string) => void
  canAssignTechnician: boolean
}) {
  // Item 12: defaults to the stage right after the last-completed one, instead of starting blank -
  // the advisor can still pick a different stage, but the common "move to the next stage" action
  // no longer needs an extra click just to open the dropdown and find it.
  const nextStageAfterCurrent = (): string => {
    const visible = stages.filter((s) => !HIDDEN_WORKFLOW_STAGE_KEYS.has(s.stageKey)).sort((a, b) => a.seq - b.seq)
    if (visible.length === 0) return ''
    const currentSeq = jc.currentStage && !HIDDEN_WORKFLOW_STAGE_KEYS.has(jc.currentStage.stageKey) ? jc.currentStage.seq : -1
    return (visible.find((s) => s.seq > currentSeq) ?? visible[visible.length - 1]).id
  }
  const [stageId, setStageId] = useState(nextStageAfterCurrent)
  // Free-text technician name (see JobCard.AssignedTechnicianName) rather than a dropdown bound to
  // a User id - there's no confirmed technician catalog to pick from, so this is typed in directly
  // and sent as assignedTechnicianName on the same PUT /api/jobcards/{id} call.
  const [technicianName, setTechnicianName] = useState(jc.assignedTechnicianName ?? '')
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState(jc.expectedDeliveryAt ? jc.expectedDeliveryAt.slice(0, 16) : '')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    setStageId(nextStageAfterCurrent())
    setTechnicianName(jc.assignedTechnicianName ?? '')
    setExpectedDeliveryAt(jc.expectedDeliveryAt ? jc.expectedDeliveryAt.slice(0, 16) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jc.id, jc.currentStage?.id, jc.assignedTechnicianName, jc.expectedDeliveryAt, stages])

  const submit = async () => {
    const tasks: Promise<unknown>[] = []
    if (stageId && stageId !== jc.currentStage?.id) {
      tasks.push(staffApi.post(`/api/jobcards/${jc.id}/stage`, { stageId, notes: notes || null }))
    }
    if (canAssignTechnician) {
      tasks.push(staffApi.put(`/api/jobcards/${jc.id}`, {
        assignedTechnicianName: technicianName || null,
        expectedDeliveryAt: expectedDeliveryAt || null,
      }))
    }
    if (tasks.length > 0) await Promise.all(tasks)
  }

  return (
    <div className="card">
      <h3>Update Workflow Stage</h3>
      <div className="form-row">
        <div className="field">
          <label>Stage</label>
          <select disabled={busy} value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="" disabled>Select new stage…</option>
            {stages.filter((s) => !HIDDEN_WORKFLOW_STAGE_KEYS.has(s.stageKey)).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        {canAssignTechnician && (
          <>
            <div className="field">
              <label>Assign Technician</label>
              <input disabled={busy} value={technicianName} onChange={(e) => setTechnicianName(e.target.value)} placeholder="Technician name" />
            </div>
            <div className="field">
              <label>Expected Completion</label>
              <input type="datetime-local" disabled={busy} value={expectedDeliveryAt} onChange={(e) => setExpectedDeliveryAt(e.target.value)} />
            </div>
          </>
        )}
      </div>
      <div className="field">
        <label>Remarks</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Stage remarks…" />
      </div>
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(submit, 'Workflow stage updated.')}>Update Stage</button>
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
        <button className="btn btn-sm" onClick={() => { run(() => staffApi.post(`/api/jobcards/${jc.id}/inspections`, { component: 'General', condition: 'NeedsAttention', notes: text })); setText('') }}>Log Inspection Note</button>
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

/** Item 14: the timer is now automatic, not manual - starts the moment this job card is open (no
 * running log yet, and the job card isn't Closed) and stops the moment the job card is Closed. Both
 * effects are guarded by their own condition already being false after the reload run() triggers
 * (a fresh openLog appears after auto-start; it disappears - endedAt gets set - after auto-stop),
 * so neither fires more than once per actual state change. */
function WorklogCard({ jc, run, profileId }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>) => void; profileId?: string }) {
  const openLog = jc.worklogs.find((w) => !w.endedAt)

  useEffect(() => {
    if (jc.status !== 'Closed' && !openLog) {
      run(() => staffApi.post(`/api/jobcards/${jc.id}/worklogs/start`, { technicianId: profileId, taskDescription: 'Service work' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jc.id, jc.status, openLog?.id])

  useEffect(() => {
    if (jc.status === 'Closed' && openLog) {
      run(() => staffApi.post(`/api/jobcards/worklogs/${openLog.id}/end`, {}))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jc.status, openLog?.id])

  return (
    <div className="card">
      <h3>Technician Work Log</h3>
      {openLog ? (
        <p className="muted">⏱ Timer running since {new Date(openLog.startedAt).toLocaleTimeString()} (stops automatically when this job card is closed).</p>
      ) : jc.status === 'Closed' ? (
        <p className="muted">Timer stopped - this job card is closed.</p>
      ) : (
        <p className="muted">Starting timer…</p>
      )}
      <table style={{ marginTop: 12 }}>
        <thead><tr><th>Started</th><th>Ended</th><th>Duration (min)</th></tr></thead>
        <tbody>{jc.worklogs.map((w) => <tr key={w.id}><td>{new Date(w.startedAt).toLocaleString()}</td><td>{w.endedAt ? new Date(w.endedAt).toLocaleString() : '-'}</td><td>{w.durationMinutes ?? '-'}</td></tr>)}</tbody>
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
 * longer surfaced on this card. */
function EstimatesCard({ jc }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>) => void }) {
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

  return (
    <div className="card">
      <h3>Estimates Amount</h3>

      <h4>Part Details</h4>
      <table>
        <thead><tr><th>Sr no.</th><th>Part No. (Item Code)</th><th>Description</th><th>HSN</th><th>MRP</th><th>Qty</th><th>Amount</th></tr></thead>
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
        borderTop: '2px solid var(--border)', paddingTop: 10,
      }}>
        <strong style={{ fontSize: 16 }}>Grand Total</strong>
        <strong style={{ fontSize: 18 }}>{money(grandTotal)}</strong>
      </div>
    </div>
  )
}

/** "Part Suggestion" panel (renamed from "Parts Used" - see JobCardPartSuggestion's doc comment in
 * types/index.ts). Parts come from BAPL DMS's own PartsInventory for this job card's service
 * location (GET /api/bapl-dms/parts?locationCode=...), fetched once on mount the same way
 * BaplServiceHistoryCard above fetches its supplementary data; suggesting one just records an
 * itemCode + a Paid/U-W status in JobCardScannerDb (POST .../part-suggestions) - nothing is written
 * back into BAPL DMS itself. Status can be flipped afterwards (PUT .../part-suggestions/{id}). */
/** Item 16: reworked into a type-ahead Item Code search (bound to description, so typing either
 * the code or a word of the description narrows the list), a Qty field (distinct from the
 * available-stock number, which is only shown as a hint), and multi add/remove - each suggested
 * part gets its own Remove button (DELETE /api/jobcards/part-suggestions/{id}), instead of the old
 * Paid/U-W toggle being the only action available. Grid columns per spec: Sr no., Item Code,
 * Description, MRP, QTY, IssueType(Status). */
function PartSuggestionCard({ jc, run }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>, successMsg?: string) => void }) {
  const [availableParts, setAvailableParts] = useState<BaplDmsPartStock[]>([])
  const [search, setSearch] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [itemCode, setItemCode] = useState('')
  const [qty, setQty] = useState<number>(1)
  const [status, setStatus] = useState<'Paid' | 'U/W'>('Paid')

  useEffect(() => {
    if (!jc.baplServiceLocationCode) { setAvailableParts([]); return }
    staffApi.get<BaplDmsPartStock[]>('/api/bapl-dms/parts', { params: { locationCode: jc.baplServiceLocationCode } })
      .then(({ data }) => setAvailableParts(data))
      .catch(() => setAvailableParts([]))
  }, [jc.baplServiceLocationCode])

  const selectedPart = availableParts.find((p) => p.itemCode === itemCode)
  const q = search.trim().toLowerCase()
  const matches = q.length === 0 ? [] : availableParts
    .filter((p) => p.itemCode.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
    .slice(0, 20)

  const pickPart = (p: BaplDmsPartStock) => {
    setItemCode(p.itemCode)
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
    setSearch('')
    setQty(1)
    setStatus('Paid')
  }

  return (
    <div className="card">
      <h3>Part Suggestion</h3>
      <table>
        <thead><tr><th>Sr no.</th><th>Item Code</th><th>Description</th><th>MRP</th><th>QTY</th><th>Issue Type (Status)</th><th></th></tr></thead>
        <tbody>
          {jc.partSuggestions.map((p, i) => (
            <tr key={p.id}>
              <td>{i + 1}</td>
              <td>{p.itemCode}</td>
              <td>{p.description ?? '-'}</td>
              <td>{p.mrp != null ? `₹${p.mrp}` : '-'}</td>
              <td>{p.quantity}</td>
              <td><StatusBadge status={p.status} /></td>
              <td style={{ display: 'flex', gap: 4 }}>
                <button
                  className="btn btn-sm"
                  onClick={() => run(() => staffApi.put(`/api/jobcards/part-suggestions/${p.id}`, { status: p.status === 'Paid' ? 'U/W' : 'Paid' }))}
                >
                  Mark {p.status === 'Paid' ? 'U/W' : 'Paid'}
                </button>
                <button className="btn btn-sm" onClick={() => run(() => staffApi.delete(`/api/jobcards/part-suggestions/${p.id}`))}>Remove</button>
              </td>
            </tr>
          ))}
          {jc.partSuggestions.length === 0 && (
            <tr><td colSpan={7} className="muted">No parts suggested yet.</td></tr>
          )}
        </tbody>
      </table>

      <h4>Suggest a part (from BAPL DMS PartsInventory)</h4>
      {!jc.baplServiceLocationCode && <p className="muted">No BAPL DMS service location on this job card - part list unavailable.</p>}
      <div className="form-row">
        <div className="field" style={{ position: 'relative' }}>
          <label>Item Code / Description</label>
          <input
            value={search}
            placeholder="Start typing an item code or description…"
            onChange={(e) => { setSearch(e.target.value); setItemCode(''); setShowSuggestions(true) }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            autoComplete="off"
          />
          {showSuggestions && matches.length > 0 && (
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
                    <strong>{p.itemCode}</strong>{p.description ? ` — ${p.description}` : ''} <span className="muted">(avail. {p.availableQty})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="field">
          <label>QTY</label>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: '4rem' }} />
        </div>
        <div className="field">
          <label>Issue Type (Status)</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'Paid' | 'U/W')}>
            <option value="Paid">Paid</option>
            <option value="U/W">U/W</option>
          </select>
        </div>
      </div>
      {selectedPart && (
        <p className="muted">MRP {selectedPart.mrp != null ? `₹${selectedPart.mrp}` : '-'} · HSN {selectedPart.hsnCode ?? '-'} · Available {selectedPart.availableQty}</p>
      )}
      <button className="btn btn-sm btn-primary" disabled={!itemCode} onClick={() => run(addSuggestion, 'Part suggestion added.')}>Add Suggestion</button>
    </div>
  )
}

/** "Labour Suggestion" panel (see JobCard.LabourSuggestions) - mirrors PartSuggestionCard above,
 * but pulling from BAPL DMS's own LabourMaster (rate card) instead of PartsInventory. Defaults the
 * candidate list to this job card's own already-selected Job Type/Service Head/Service Type
 * cascade (jc.baplJobTypeId/baplServiceHeadId/baplServiceTypeId, set on the wizard), combined with
 * a free-text search box - see BaplDmsLabourRow's doc comment on the backend for why both matter
 * (most existing LabourMaster rows have no cascade mapping yet, so cascade-only would hide them).
 * Description/HSN/GST/Rate are snapshotted from whichever row is picked, not re-editable once
 * added (Rate especially - see JobCardLabourSuggestion's doc comment); Quantity and Issue Type
 * (free text, not a fixed dropdown) can be edited after the fact. */
// Issue Type is a fixed Paid / Under Warranty choice, not free text - matches how the workshop
// actually bills labour (paid work vs. work covered by the vehicle's warranty).
const LABOUR_ISSUE_TYPES = ['Paid', 'U/W'] as const

function LabourSuggestionCard({ jc, run }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>, successMsg?: string) => void }) {
  const [rows, setRows] = useState<BaplDmsLabourRow[]>([])
  const [q, setQ] = useState('')
  // Tracks the selected LabourMaster row by its own unique int id, NOT by LabourCode - real
  // LabourMaster data has the same LabourCode repeated across several rows for different
  // CityTier/oemmodelname scoping (e.g. "SF0M001" appears 4 times), so keying/looking up by
  // LabourCode both broke React's key uniqueness and silently resolved to the wrong row's
  // rate/HSN/GST (always the first match) regardless of which option was actually picked.
  const [selectedId, setSelectedId] = useState('')
  const [qty, setQty] = useState<number>(1)
  const [issueType, setIssueType] = useState('')
  const [editing, setEditing] = useState<{ id: string; qty: number; issueType: string } | null>(null)

  useEffect(() => {
    const params: Record<string, string | number> = {}
    if (jc.baplJobTypeId) params.jobTypeId = jc.baplJobTypeId
    if (jc.baplServiceHeadId) params.serviceHeadId = jc.baplServiceHeadId
    if (jc.baplServiceTypeId) params.serviceTypeId = jc.baplServiceTypeId
    if (q.trim()) params.q = q.trim()
    staffApi.get<BaplDmsLabourRow[]>('/api/bapl-dms/labour', { params })
      .then(({ data }) => setRows(data))
      .catch(() => setRows([]))
  }, [jc.baplJobTypeId, jc.baplServiceHeadId, jc.baplServiceTypeId, q])

  const selected = rows.find((r) => String(r.id) === selectedId)

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
                  <button className="btn btn-sm" onClick={() => run(() => staffApi.delete(`/api/jobcards/labour-suggestions/${l.id}`))}>Remove</button>
                </td>
              </tr>
            )
          )}
          {jc.labourSuggestions.length === 0 && (
            <tr><td colSpan={10} className="muted">No labour suggested yet.</td></tr>
          )}
        </tbody>
      </table>

      <h4>Suggest labour (from BAPL DMS LabourMaster)</h4>
      {/* Item 17: search, Labour Code, Qty, Issue Type and the Add Suggestion button all in one
         row now - Add sits immediately after Issue Type instead of on its own line below. */}
      <div className="form-row" style={{ alignItems: 'flex-end' }}>
        <div className="field">
          <label>Search (1 word)</label>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. brake" />
        </div>
        <div className="field">
          <label>Labour Code</label>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">Select labour…</option>
            {rows.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.labourCode} - {r.labourDescription ?? 'No description'} (₹{r.labourRate ?? '-'})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Qty</label>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: '4rem' }} />
        </div>
        <div className="field">
          <label>Issue Type</label>
          <select value={issueType} onChange={(e) => setIssueType(e.target.value)}>
            <option value="">Select…</option>
            {LABOUR_ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <button className="btn btn-sm btn-primary" disabled={!selectedId} onClick={() => run(addSuggestion, 'Labour suggestion added.')}>Add Suggestion</button>
        </div>
      </div>
      {selected && (
        <p className="muted">
          Rate ₹{selected.labourRate ?? '-'} · HSN {selected.hsnCode ?? '-'} · SGST {selected.sgst ?? '-'} · CGST {selected.cgst ?? '-'} · IGST {selected.igst ?? '-'}
        </p>
      )}
    </div>
  )
}

/** "Download Invoice from DMS" (replaces the old local Generate-Invoice/Download-PDF flow - BAPL
 * DMS's own repair bill is now the source of truth for a job card's invoice). Streams the PDF
 * through staffApi so the same Bearer token every other call on this page carries is attached (see
 * api/client.ts's interceptor) - a plain <a href> pointed at the API would 401 instead of
 * downloading anything - then hands the blob to the browser via a temporary <a download> element. */
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
      if (status === 404) setNotice('No repair bill saved in BAPL DMS for this job yet.')
      else setError('Could not download the invoice from BAPL DMS. Please try again.')
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

