// web\src\pages\staff\CareDeskPage.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import { StatusBadge } from '../../components/StatusBadge'
import { VehiclePicker, type PickedVehicle } from '../../components/VehiclePicker'
import { CARE_DESK_URL, openCareDesk } from '../../lib/careDesk'
import {
  careDeskRaise, careDeskTickets, careDeskVehicle,
  type CareDeskRaiseSetup, type CareDeskTicket, type CareDeskVehicle, type CareDeskVehicleContext, type CareDeskVehicleReply,
} from '../../lib/careDeskApi'
import type { BaplDmsVehicleLookup, JobCardListResponse, JobCardSummary } from '../../types'

/**
 * 2026-10-21 ("raise a ticket from JobCard, for every role ... search a P6 chassis no. or a reg no. in a dropdown and show the whole live flow"): the Care Desk page is now a VEHICLE HUB.
 *   1. Type a chassis no. or registration no. - a live dropdown lists the matches (the same search as the New Job Card wizard).
 *   2. Pick one: the vehicle and its customer (Vehicle Sale), its job cards here, and its Care Desk tickets - live, refreshed every 30 seconds - are shown together.
 *   3. "Raise a ticket" (Off-road) - for every signed-in role. The ticket is created in Care Desk on behalf of the vehicle's company, and says who raised it from JobCardScanner.
 * The vehicle must already be in Care Desk (loaded by BGauss IT: Admin B1 / the data kit); otherwise the page says so and nothing is created. Care Desk itself still decides everything else
 * (photos, hubs, one running ticket per vehicle, TAT, routing to the engineer).
 *
 *   VITE_CARE_DESK_URL    the Care Desk address, no slash at the end (empty = this page says it is not set up yet)
 *   VITE_CARE_DESK_EMBED  "true" shows Care Desk's own login inside this page (an iframe); leave unset for the vehicle hub.
 * Care Desk must list this web address in its JCS_WEB_ORIGINS, and the JobCard API needs CareDeskApi__Secret (= Care Desk's CAREDESK_API_SECRET).
 */
const EMBED = ((import.meta.env.VITE_CARE_DESK_EMBED as string | undefined) ?? '').trim().toLowerCase() === 'true'
const IS_STAGING = /staging|uat|test/i.test(CARE_DESK_URL)
const OTHER = 'Other'

const stamp = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—')
const words = (s: string) => s.replace(/_/g, ' ')
const problem = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Please try again.')
const Req = () => <span style={{ color: '#dc2626' }}> *</span>

export function CareDeskPage() {
  const { profile, hasRole } = useStaffAuth()
  const [params] = useSearchParams()
  const isHq = hasRole('CorporateAdmin', 'SystemAdmin')
  const [picked, setPicked] = useState<PickedVehicle | null>(() => {
    const v = params.get('vehicle')
    return v ? { value: v, chassisNo: null, regNo: null, modelName: null } : null
  })
  const [frameKey, setFrameKey] = useState(0)

  if (!CARE_DESK_URL) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>🎧 Care Desk</h2>
        <p className="muted">
          Care Desk is not set up on this site yet. Ask the system administrator to set <strong>VITE_CARE_DESK_URL</strong> (the Care Desk address from BGauss IT) in the web app's
          environment file and rebuild.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0 }}>🎧 Care Desk</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {EMBED && <button type="button" className="btn btn-sm" onClick={() => setFrameKey((k) => k + 1)}>↻ Reload</button>}
          {/* the one-click sign-in into the Care Desk app is for head-office logins only (its token endpoint is CorporateAdminUp) */}
          {isHq && <button type="button" className="btn btn-sm btn-primary" onClick={() => void openCareDesk()}>Open Care Desk ↗</button>}
        </div>
      </div>

      {IS_STAGING && (
        <p style={{ margin: '10px 0 0', padding: '8px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontWeight: 600 }}>
          ⚠ This is the Care Desk STAGING copy - test data only, not for real tickets.
        </p>
      )}

      {EMBED ? (
        <>
          <iframe
            key={frameKey}
            src={CARE_DESK_URL}
            title="BGauss Care Desk"
            allow="camera; geolocation; clipboard-write"
            style={{ width: '100%', height: 'calc(100vh - 170px)', minHeight: 520, border: '1px solid var(--border)', borderRadius: 8, marginTop: 12, background: '#fff' }}
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>If this frame stays blank or says it refused to connect, Care Desk does not allow embedding yet.</p>
        </>
      ) : (
        <>
          <div className="card" style={{ marginTop: 12 }}>
            <p style={{ marginTop: 0 }} className="muted">
              Search a vehicle by chassis no. or registration no. to see its job cards and its Care Desk tickets together - and to raise a Care Desk ticket for it.
            </p>
            <VehiclePicker dealerId={profile?.dealerId} initial={picked?.value ?? ''} onPick={setPicked} />
          </div>
          {picked && <VehicleHub key={picked.value} picked={picked} dealerId={profile?.dealerId} isHq={isHq} />}
        </>
      )}
    </div>
  )
}

function VehicleHub({ picked, dealerId, isHq }: { picked: PickedVehicle; dealerId?: string | null; isHq: boolean }) {
  const [jc, setJc] = useState<BaplDmsVehicleLookup | null>(null)
  const [jcError, setJcError] = useState<string | null>(null)
  const [allJobCards, setAllJobCards] = useState<JobCardSummary[] | null>(null)
  const [cd, setCd] = useState<CareDeskVehicleReply | null>(null)
  const [cdError, setCdError] = useState<string | null>(null)
  const [tickets, setTickets] = useState<CareDeskTicket[] | null>(null)
  const [ticketsAt, setTicketsAt] = useState<Date | null>(null)
  const [raising, setRaising] = useState(false)
  const [raisedNo, setRaisedNo] = useState<string | null>(null)

  // what JobCardScanner knows: the vehicle + its customer (Vehicle Sale), and its job cards
  useEffect(() => {
    let cancelled = false
    staffApi.get<BaplDmsVehicleLookup>('/api/jobcards/vehicle-lookup', { params: { value: picked.value, dealerId: dealerId || undefined } })
      .then(({ data }) => { if (!cancelled) setJc(data) })
      .catch(() => { if (!cancelled) setJcError(`"${picked.value}" was not found in Vehicle Sale${dealerId ? ' for your dealer' : ''}.`) })
    staffApi.get<JobCardListResponse>('/api/jobcards', { params: { q: picked.regNo ?? picked.value } })
      .then(({ data }) => { if (!cancelled) setAllJobCards(data.items) })
      .catch(() => { if (!cancelled) setAllJobCards([]) })
    return () => { cancelled = true }
  }, [picked.value, picked.regNo, dealerId])

  const chassis = (jc?.chassisNo ?? picked.chassisNo ?? picked.value).toUpperCase()
  const reg = (jc?.registerNo ?? picked.regNo ?? '').toUpperCase().replace(/[\s-]/g, '')
  const jobCards = useMemo(() => (allJobCards ?? []).filter((j) =>
    (j.vehicleChassisNo ?? '').toUpperCase() === chassis || (reg !== '' && (j.vehicleRegNo ?? '').toUpperCase().replace(/[\s-]/g, '') === reg)), [allJobCards, chassis, reg])

  // what Care Desk knows: is it registered, the raise form's set-up, and the live tickets
  const loadVehicle = useCallback(async () => {
    try { setCdError(null); setCd(await careDeskVehicle(picked.value)) } catch (e) { setCdError(problem(e)) }
  }, [picked.value])
  const loadTickets = useCallback(async () => {
    try { const r = await careDeskTickets(picked.value); setTickets(r.tickets); setTicketsAt(new Date()) } catch (e) { setCdError(problem(e)) }
  }, [picked.value])
  useEffect(() => { void loadVehicle(); void loadTickets() }, [loadVehicle, loadTickets])
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') void loadTickets() }, 30_000)
    return () => clearInterval(id)
  }, [loadTickets])

  const registered = cd && cd.registered ? cd : null

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Vehicle &amp; customer <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(JobCardScanner · Vehicle Sale)</span></h3>
        {jcError && <p className="muted">{jcError}</p>}
        {!jcError && !jc && <p className="muted">Loading…</p>}
        {jc && (
          <p style={{ margin: 0 }}>
            <strong>{jc.chassisNo}</strong>{jc.registerNo ? ` · ${jc.registerNo}` : ''}{jc.modelName ? ` — ${jc.modelName}` : ''}<br />
            <span className="muted">
              Customer: {jc.customerName || '—'}{jc.customerMobile ? ` (${jc.customerMobile})` : ''}
              {jc.saleDate ? ` · sold ${new Date(jc.saleDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ' · not yet sold'}
              {jc.vehiclePrevKms != null ? ` · last ${jc.vehiclePrevKms} km` : ''}
            </span>
          </p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Job cards of this vehicle</h3>
        {allJobCards === null ? <p className="muted">Loading…</p> : jobCards.length === 0 ? <p className="muted">No job card found for this vehicle.</p> : (
          <table>
            <thead><tr><th>Job Card #</th><th>Stage</th><th>Status</th><th>Technician</th><th>Created</th></tr></thead>
            <tbody>
              {jobCards.map((j) => (
                <tr key={j.id}>
                  <td><Link to={j.source === 'BaplDms' ? `/jobcards/bapl/${j.id.replace(/^bapl-/, '')}` : `/jobcards/${j.id}`}>{j.jobCardNumber}</Link></td>
                  <td>{j.source === 'BaplDms' ? '-' : j.stageLabel}</td>
                  <td><StatusBadge status={j.status} /></td>
                  <td>{j.technicianName ?? '-'}</td>
                  <td>{j.createdAt ? new Date(j.createdAt).toLocaleDateString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Care Desk tickets <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(live{ticketsAt ? ` · updated ${ticketsAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''})</span></h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => { void loadVehicle(); void loadTickets() }}>↻ Refresh</button>
            {isHq && <button type="button" className="btn btn-sm" onClick={() => void openCareDesk(`/field/search?q=${encodeURIComponent(picked.value)}`)}>Open in Care Desk ↗</button>}
          </div>
        </div>

        {cdError && <p className="error-text">{cdError}</p>}
        {!cdError && cd === null && <p className="muted">Loading…</p>}

        {cd && !cd.registered && (
          <p style={{ margin: '10px 0 0', padding: '10px 14px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
            This vehicle is not in Care Desk yet, so no ticket can be raised or shown. Its company and vehicle have to be loaded in Care Desk first (Admin screen B1, or the data load kit) - ask BGauss IT.
          </p>
        )}

        {registered && (
          <>
            <p className="muted" style={{ margin: '8px 0' }}>
              {registered.vehicle.customer} · {registered.vehicle.city} · {registered.vehicle.model} · sold {registered.vehicle.saleDate}
              {registered.vehicle.warrantyTill ? ` · warranty till ${registered.vehicle.warrantyTill}` : ''}
            </p>
            {tickets === null ? <p className="muted">Loading…</p> : tickets.length === 0 ? <p className="muted">No Care Desk ticket for this vehicle yet.</p> : (
              <table>
                <thead><tr><th>Ticket</th><th>Type</th><th>Status</th><th>Level</th><th>Raised</th><th>Level due</th><th>Owner</th></tr></thead>
                <tbody>
                  {tickets.map((t) => {
                    const late = t.open && !!t.levelDueAt && new Date(t.levelDueAt).getTime() < Date.now()
                    return (
                      <tr key={t.ticketNo}>
                        <td>{t.ticketNo}{t.isRepeat && <span className="muted"> · repeat</span>}{t.description && <div className="muted" style={{ fontSize: 12 }}>{t.description}</div>}</td>
                        <td>{words(t.category)}</td>
                        <td>{words(t.status)}{t.open ? '' : ' ✓'}</td>
                        <td>{t.level ?? '—'}</td>
                        <td>{stamp(t.createdAt)}</td>
                        <td style={late ? { color: '#dc2626', fontWeight: 600 } : undefined}>{t.open ? `${stamp(t.levelDueAt)}${late ? ' · overdue' : ''}` : stamp(t.closedAt)}</td>
                        <td>{t.owner ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {raisedNo && <p style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', fontWeight: 600 }}>✓ Ticket {raisedNo} raised in Care Desk.</p>}

            {!registered.raise.allowed ? (
              <p className="muted" style={{ marginTop: 12 }}>Cannot raise a ticket here: {registered.raise.reason}</p>
            ) : registered.raise.context.running ? (
              <p className="muted" style={{ marginTop: 12 }}>
                A ticket is already running for this vehicle: <strong>{registered.raise.context.running.ticketNo}</strong> ({words(registered.raise.context.running.category)}). Care Desk allows one at a time.
              </p>
            ) : raising ? (
              <RaiseOffRoad
                vehicle={registered.vehicle}
                ctx={registered.raise.context}
                setup={registered.raise.setup}
                onCancel={() => setRaising(false)}
                onRaised={(no) => { setRaising(false); setRaisedNo(no); void loadVehicle(); void loadTickets() }}
              />
            ) : (
              <div style={{ marginTop: 12 }}>
                {registered.raise.setup.pendingRating && (
                  <p className="muted" style={{ margin: '0 0 8px' }}>⚠ The client has a closed ticket waiting for its rating ({registered.raise.setup.pendingRating.ticketNo}). Care Desk may refuse a new ticket until it is rated.</p>
                )}
                <button type="button" className="btn btn-primary" onClick={() => { setRaisedNo(null); setRaising(true) }}>+ Raise a ticket (Off-road)</button>
                <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>Warranty and Spare-parts tickets: next release.</span>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function RaiseOffRoad({ vehicle, ctx, setup, onCancel, onRaised }: {
  vehicle: CareDeskVehicle; ctx: CareDeskVehicleContext; setup: CareDeskRaiseSetup; onCancel: () => void; onRaised: (ticketNo: string) => void
}) {
  const hubs = setup.hubs.filter((h) => h.cityId === ctx.vehicle.cityId)
  const [concerns, setConcerns] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [odometer, setOdometer] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactMobile, setContactMobile] = useState('')
  const [locKind, setLocKind] = useState<'hub' | 'pin'>(hubs.length > 0 ? 'hub' : 'pin')
  const [hubId, setHubId] = useState(ctx.vehicle.hubId && hubs.some((h) => h.id === ctx.vehicle.hubId) ? ctx.vehicle.hubId : hubs[0]?.id ?? '')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [landmark, setLandmark] = useState('')
  const [repeat, setRepeat] = useState<'' | 'yes' | 'no'>('')
  const [repeatOf, setRepeatOf] = useState('')
  const [front, setFront] = useState<File | null>(null)
  const [more, setMore] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (c: string) => setConcerns((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  const useMyLocation = () => navigator.geolocation?.getCurrentPosition(
    (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)) },
    () => setError('Location is not available - type the latitude and longitude.'),
    { enableHighAccuracy: true, timeout: 8000 },
  )

  const missing = (): string | null => {
    if (concerns.length === 0) return 'Select at least one affected part (or Other / not sure).'
    if (!description.trim()) return 'Describe the problem.'
    if (!contactName.trim()) return 'Type the on-site contact name.'
    if (locKind === 'hub' && !hubId) return 'Choose the hub where the vehicle is.'
    if (locKind === 'pin' && (!Number.isFinite(Number(lat)) || lat === '' || !Number.isFinite(Number(lng)) || lng === '')) return 'Type the latitude and longitude, or use "My location".'
    if (!front) return 'The vehicle front-side photo (number plate visible) is mandatory.'
    if (!repeat) return 'Answer: is this a repeat issue?'
    if (repeat === 'yes' && !repeatOf) return 'Choose the earlier ticket (or "Earlier problem was not logged here").'
    return null
  }

  const submit = async () => {
    const why = missing()
    if (why) { setError(why); return }
    setBusy(true)
    setError(null)
    try {
      const data: Record<string, unknown> = {
        category: 'off_road', vehicleId: vehicle.id, concerns, description: description.trim(), odometerKm: odometer.trim() || undefined,
        contactName: contactName.trim(), contactMobile: contactMobile.trim() || undefined,
        location: locKind === 'hub' ? { kind: 'hub', hubId } : { kind: 'pin', lat: Number(lat), lng: Number(lng), landmark: landmark.trim() || undefined },
        repeat, ...(repeat === 'yes' ? { repeatOf } : {}),
      }
      const files: [string, File][] = [['vehicle_front_photo', front as File], ...more.slice(0, 5).map((f): [string, File] => ['issue_media', f])]
      const r = await careDeskRaise(data, files)
      onRaised(r.ticketNo)
    } catch (e) {
      setError(problem(e))
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 14, padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: '#f9fafb' }}>
      <h4 style={{ marginTop: 0 }}>Raise an Off-road ticket · {vehicle.regNo ?? vehicle.vin}</h4>
      <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>
        Raised in Care Desk for <strong>{vehicle.customer}</strong>, who are told as usual; it records that you raised it from JobCardScanner. First response within {setup.tat.off_road.response} working hours ({setup.window.start}–{setup.window.end}).
      </p>

      <div className="field">
        <label>Affected part(s)<Req /></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[...setup.parts, OTHER].map((c) => (
            <button key={c} type="button" className="btn btn-sm" aria-pressed={concerns.includes(c)} onClick={() => toggle(c)}
              style={concerns.includes(c) ? { background: '#2563eb', color: '#fff', border: '1px solid #2563eb' } : undefined}>{c === OTHER ? 'Other / not sure' : c}</button>
          ))}
        </div>
      </div>

      <div className="field"><label>Describe the problem<Req /></label><textarea rows={3} maxLength={900} value={description} onChange={(e) => setDescription(e.target.value)} /></div>

      <div className="form-row">
        <div className="field"><label>Odometer (km)</label><input inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} /></div>
        <div className="field"><label>On-site contact<Req /></label><input maxLength={80} value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
        <div className="field"><label>Contact mobile</label><input inputMode="tel" maxLength={20} value={contactMobile} onChange={(e) => setContactMobile(e.target.value)} placeholder="10-digit mobile" /></div>
      </div>

      <div className="field">
        <label>Where is the vehicle?<Req /></label>
        <div style={{ display: 'flex', gap: 14, marginBottom: 6 }}>
          <label><input type="radio" checked={locKind === 'hub'} disabled={hubs.length === 0} onChange={() => setLocKind('hub')} /> At a hub of {vehicle.customer}</label>
          <label><input type="radio" checked={locKind === 'pin'} onChange={() => setLocKind('pin')} /> Drop a pin</label>
        </div>
        {locKind === 'hub' ? (
          <select value={hubId} onChange={(e) => setHubId(e.target.value)}>
            {hubs.length === 0 && <option value="">No hub in {vehicle.city}</option>}
            {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}{h.address ? ` — ${h.address}` : ''}</option>)}
          </select>
        ) : (
          <div className="form-row">
            <div className="field"><label>Latitude</label><input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} /></div>
            <div className="field"><label>Longitude</label><input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} /></div>
            <div className="field"><label>Landmark</label><input maxLength={200} value={landmark} onChange={(e) => setLandmark(e.target.value)} /></div>
            <div className="field" style={{ alignSelf: 'flex-end' }}><button type="button" className="btn btn-sm" onClick={useMyLocation}>📍 My location</button></div>
          </div>
        )}
      </div>

      <div className="field">
        <label>Is this a repeat issue?<Req /></label>
        <div style={{ display: 'flex', gap: 14 }}>
          <label><input type="radio" checked={repeat === 'no'} onChange={() => setRepeat('no')} /> No</label>
          <label><input type="radio" checked={repeat === 'yes'} onChange={() => setRepeat('yes')} /> Yes</label>
        </div>
        {repeat === 'yes' && (
          <select value={repeatOf} onChange={(e) => setRepeatOf(e.target.value)} style={{ marginTop: 6 }}>
            <option value="">Choose the earlier ticket…</option>
            {ctx.closed.map((c) => <option key={c.id} value={c.id}>{c.ticketNo} — {words(c.category)}{c.parts ? ` (${c.parts})` : ''}{c.closedOn ? ` · closed ${c.closedOn}` : ''}</option>)}
            <option value="not_logged">Earlier problem was not logged here</option>
          </select>
        )}
      </div>

      <div className="form-row">
        <div className="field">
          <label>Vehicle front-side photo (number plate visible)<Req /></label>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setFront(e.target.files?.[0] ?? null)} />
        </div>
        <div className="field">
          <label>More photos / a short video (up to 5)</label>
          <input type="file" accept="image/*,video/*" multiple onChange={(e) => setMore(Array.from(e.target.files ?? []).slice(0, 5))} />
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Raising…' : 'Raise ticket'}</button>
      </div>
    </div>
  )
}
