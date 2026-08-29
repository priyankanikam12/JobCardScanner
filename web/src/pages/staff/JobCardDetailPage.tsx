import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import { StatusBadge } from '../../components/StatusBadge'
import { WorkflowTimeline } from '../../components/WorkflowTimeline'
import type { BaplDmsJobCardHistory, JobCardDetail, PhotoStage, WorkflowStage } from '../../types'

// Photo URLs come back from the API as a relative path (e.g. "/uploads/jobcard-photos/.../x.jpg" -
// see JobCardsController.UploadPhoto), same origin as the API itself, not the frontend dev server.
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL
const photoSrc = (url: string) => (url.startsWith('http') ? url : `${API_BASE_URL}${url}`)

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
                BAPL DMS
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
              ✅ Synced to BAPL DMS as <a href={`/jobcards/bapl/${jc.baplJobCardHeaderId}`}>job card #{jc.baplJobCardHeaderId}</a>.
            </p>
          )}
          {jc.baplSyncStatus === 'Failed' && (
            <p className="error-text" style={{ marginTop: 4 }}>
              ⚠ Not yet synced to BAPL DMS{jc.baplSyncError ? `: ${jc.baplSyncError}` : '.'}
            </p>
          )}
        </div>

        <div className="card">
          <h3>Workflow Timeline</h3>
          <WorkflowTimeline stages={stages} currentStageId={jc.currentStage?.id} history={jc.stageHistory.map((h) => ({ stageLabel: h.stage?.label, enteredAt: h.enteredAt, exitedAt: h.exitedAt }))} />
        </div>
      </div>

      {hasRole('ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && (
        <UpdateWorkflowStageCard jc={jc} stages={stages} busy={busy} run={run} canAssignTechnician={hasRole('WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin')} />
      )}

      <BaplServiceHistoryCard chassisNo={jc.vehicle?.vin} dealerCode={jc.dealer?.code} />

      <ComplaintsCard jc={jc} run={run} />
      <PhotosCard jc={jc} run={run} />
      <WorklogCard jc={jc} run={run} profileId={profile?.id} />
      {hasRole('WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && <QcCard jc={jc} run={run} />}
      <EstimatesCard jc={jc} run={run} />
      <PartsCard jc={jc} run={run} />
      {hasRole('Cashier', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && <InvoiceCard jc={jc} run={run} />}
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
    <div className="card">
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
  const [stageId, setStageId] = useState(jc.currentStage?.id ?? '')
  const [technicianId, setTechnicianId] = useState(jc.assignedTechnician?.id ?? '')
  const [technicians, setTechnicians] = useState<{ id: string; name: string }[]>([])
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState(jc.expectedDeliveryAt ? jc.expectedDeliveryAt.slice(0, 16) : '')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    setStageId(jc.currentStage?.id ?? '')
    setTechnicianId(jc.assignedTechnician?.id ?? '')
    setExpectedDeliveryAt(jc.expectedDeliveryAt ? jc.expectedDeliveryAt.slice(0, 16) : '')
  }, [jc.id, jc.currentStage?.id, jc.assignedTechnician?.id, jc.expectedDeliveryAt])

  useEffect(() => {
    if (!canAssignTechnician) return
    staffApi.get('/api/jobcards/technicians', { params: jc.dealer?.id ? { dealerId: jc.dealer.id } : {} })
      .then(({ data }) => setTechnicians(data))
      .catch(() => setTechnicians([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAssignTechnician, jc.dealer?.id])

  const submit = async () => {
    const tasks: Promise<unknown>[] = []
    if (stageId && stageId !== jc.currentStage?.id) {
      tasks.push(staffApi.post(`/api/jobcards/${jc.id}/stage`, { stageId, notes: notes || null }))
    }
    if (canAssignTechnician) {
      tasks.push(staffApi.put(`/api/jobcards/${jc.id}`, {
        assignedTechnicianId: technicianId || null,
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
            {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        {canAssignTechnician && (
          <>
            <div className="field">
              <label>Assign Technician</label>
              <select disabled={busy} value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
                <option value="">Unassigned</option>
                {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
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

function WorklogCard({ jc, run, profileId }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>) => void; profileId?: string }) {
  const openLog = jc.worklogs.find((w) => !w.endedAt)
  return (
    <div className="card">
      <h3>Technician Work Log</h3>
      {openLog ? (
        <div>
          <p className="muted">Timer running since {new Date(openLog.startedAt).toLocaleTimeString()}</p>
          <button className="btn btn-sm" onClick={() => run(() => staffApi.post(`/api/jobcards/worklogs/${openLog.id}/end`, {}))}>Stop Timer</button>
        </div>
      ) : (
        <button className="btn btn-sm btn-primary" onClick={() => run(() => staffApi.post(`/api/jobcards/${jc.id}/worklogs/start`, { technicianId: profileId, taskDescription: 'Service work' }))}>Start Timer</button>
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

function EstimatesCard({ jc, run }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>) => void }) {
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState(0)
  const [reason, setReason] = useState('')

  const createAndSend = async () => {
    const { data } = await staffApi.post(`/api/jobcards/${jc.id}/estimates`, {
      reason,
      lines: [{ type: 'Part', description: desc, quantity: 1, unitPrice: amount }],
    })
    await staffApi.post(`/api/estimates/${data.id}/send`)
  }

  return (
    <div className="card">
      <h3>Additional Work / Estimates</h3>
      <table>
        <thead><tr><th>Estimate #</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>{jc.estimates.map((e) => <tr key={e.id}><td>{e.estimateNumber}</td><td>Rs.{e.totalAmount}</td><td><StatusBadge status={e.status} /></td></tr>)}</tbody>
      </table>
      <h4>Raise new estimate (sends OTP-gated approval request to customer)</h4>
      <div className="form-row">
        <div className="field"><label>Description</label><input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="field"><label>Amount (Rs.)</label><input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
        <div className="field"><label>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      <button className="btn btn-sm btn-primary" disabled={!desc || amount <= 0} onClick={() => run(createAndSend)}>Send Estimate to Customer</button>
    </div>
  )
}

function PartsCard({ jc, run }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>) => void }) {
  return (
    <div className="card">
      <h3>Parts Used</h3>
      <table>
        <thead><tr><th>Part</th><th>Qty</th><th>Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {jc.parts.map((p) => (
            <tr key={p.id}>
              <td>{p.part?.name}</td><td>{p.quantity}</td><td>Rs.{p.amount}</td><td><StatusBadge status={p.status} /></td>
              <td>{p.status === 'Requested' && <button className="btn btn-sm" onClick={() => run(() => staffApi.post(`/api/jobcard-parts/${p.id}/issue`))}>Issue</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Use the Parts & Inventory page to search the catalog and request a part against this job card.</p>
    </div>
  )
}

function InvoiceCard({ jc, run }: { jc: JobCardDetail; run: (fn: () => Promise<unknown>) => void }) {
  // jc.invoice comes from GET /api/jobcards/{id} (see JobCardsController.Detail) - without this,
  // the button below stayed visible even after an invoice had already been generated (e.g. a page
  // reload, or a second click before the list refreshed), and clicking it again always failed
  // with 409 "An invoice already exists for this job card." with no indication why.
  if (jc.invoice) {
    const invoiceId = jc.invoice.id
    // Can't just point an <a href> at the API URL - GET /api/invoices/{id}/pdf requires the same
    // Bearer token every other staffApi call carries (see api/client.ts's interceptor), which a
    // plain anchor navigation never sends, so that would 401 instead of downloading anything.
    const downloadPdf = async () => {
      const { data } = await staffApi.get(`/api/invoices/${invoiceId}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(data as Blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
    return (
      <div className="card">
        <h3>Invoice</h3>
        <p><strong>{jc.invoice.invoiceNumber}</strong> &middot; Rs.{jc.invoice.totalAmount.toFixed(2)} &middot; <StatusBadge status={jc.invoice.status} /></p>
        <button className="btn btn-sm" onClick={downloadPdf}>Download PDF</button>
      </div>
    )
  }

  return (
    <div className="card">
      <h3>Invoice</h3>
      <button className="btn btn-primary btn-sm" onClick={() => run(() => staffApi.post(`/api/jobcards/${jc.id}/invoice`, { discountAmount: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0 }))}>
        Generate Invoice
      </button>
      <p className="muted">Once generated, download it here or from the Reports page.</p>
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
