/**
 * Attendance page - 2026-09-25 ("give attendance page for all dealer ... give only this page for
 * android and web ... only this page give now").
 *
 * STANDARD/ASSUMED design - read this before trusting it. I searched this whole session (including
 * the raw transcript) for the "morning scenario" you referenced and found nothing anywhere:
 * no attendance screenshot, field list, or spec was ever shared here, and there was no existing
 * Attendance backend/table/controller in anything you'd pasted before. You picked "Build a standard
 * version" when I asked, so this is my best reasonable design, NOT something built from your real
 * requirements - please correct anything that doesn't match what you actually need.
 *
 * 2026-09-28 ACCESS-CONTROL REWORK ("only that login supervisor or technitian attendance shown
 * his page ... for main dealer his under all location technitian supervisor all users attendance
 * ... if this user miss then this main dealer can adjust this ... dont give access for unders
 * users of dealer") - see AttendanceController.cs's own class doc comment for the full backend
 * side of this. Two very different views now live in this one component:
 *
 *   A) MANAGER VIEW (WorkshopManagerUp+ - "main dealer"): the original two-level flow, unchanged
 *      in shape, now with a Location column added to the roster (SECTION 118). Sees/adjusts every
 *      Technician/Supervisor's attendance across every location under their dealer.
 *   B) SELF VIEW (everyone else - "Supervisor"/any other logged-in staff): a small read-only table
 *      of just THEIR OWN last 14 days (GET /api/attendance/me) - no roster, no editing, no ability
 *      to see or touch anyone else's row.
 *
 * HOW THE SPLIT IS DECIDED, deliberately NOT via profile.role: I don't have StaffAuthContext.tsx in
 * this session, so I don't know the exact shape/naming of whatever role field lives on `profile` -
 * guessing a field name here risks silently showing the wrong view to everyone if I guess wrong.
 * Instead, this component tries the manager-only GET /api/attendance/dealers-summary call first;
 * if the BACKEND says 403 (Policies.WorkshopManagerUp denied it - see AttendanceController.cs),
 * it falls back to the self view. This makes the UI's split exactly as correct as the server-side
 * policy, with no separate/duplicated assumption about role names to keep in sync.
 *
 * NOT wired up (needs your input, not guessed): no route was added to your router (I don't have
 * that file) and no nav link was added to your sidebar - see README SECTION 98 for the one line to
 * add. No CSV export, no monthly view, no leave-approval workflow.
 *
 * 2026-10-05 DESIGNATION COLUMN ("in that web and android attendance page add Designation
 * column"): the manager roster table now shows a Designation column right after Name, ahead of
 * the existing Role column. FACT: Designation is its own field on the Users table (User.Designation,
 * the Supervisor / Captain / ViceCaptain / Technician display label set on the Employees page) -
 * it is NOT the same thing as `role`, which is the login role Designation gets mapped onto at save
 * time (e.g. a "Supervisor" designation saves with role WorkshopManager), so the two columns can
 * legitimately read differently and are both kept. The roster endpoint (GET /api/attendance) is
 * what has to send it: this page reads `designation` off each StaffRow and prints "-" when the
 * backend doesn't include it (or the user has none set) - it deliberately does NOT fall back to
 * `role`, because showing a role under a "Designation" heading would be wrong data. See the
 * delivery note for the one backend line (AttendanceController's roster projection) that supplies
 * it. The self view (My Attendance) is unchanged: it lists one person's own days, so a per-row
 * Designation column would just repeat the same value.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'

type AttendanceStatus = 'Present' | 'Absent' | 'HalfDay' | 'OnLeave'

const STATUS_OPTIONS: [AttendanceStatus, string][] = [
  ['Present', 'Present'],
  ['Absent', 'Absent'],
  ['HalfDay', 'Half Day'],
  ['OnLeave', 'On Leave'],
]

interface DealerSummaryRow {
  dealerId: string
  dealerName: string
  totalStaff: number
  present: number
  absent: number
  halfDay: number
  onLeave: number
  notMarked: number
}

interface StaffRow {
  employeeId: string
  employeeName: string
  // 2026-10-05: User.Designation (Supervisor / Captain / ViceCaptain / Technician ...) - optional
  // because it only appears once AttendanceController's roster response includes it, and any user
  // with no designation set comes back null. See this file's own Designation doc comment above.
  designation?: string | null
  role: string
  location: string | null
  status: AttendanceStatus | null
  checkInTime: string | null
  checkOutTime: string | null
  remarks: string | null
  marked: boolean
}

interface MyAttendanceRow {
  date: string
  status: AttendanceStatus | null
  location: string | null
  checkInTime: string | null
  checkOutTime: string | null
  shift: string | null
  remarks: string | null
  // 2026-09-28 (SECTION 143, "after 9 hrs complete auto checkout ... that shown in page and
  // maintain") - see AttendanceController.Me's own doc comment: a DISPLAY-ONLY value computed
  // fresh by the backend on every call, not a stored/auto-written CheckOutTime. For today's still
  // open row it's the live elapsed hours since check-in (uncapped, per your confirmed answer); for
  // a past day with no checkout ever recorded it's null.
  hoursWorked: number | null
}

/** Formats AttendanceController.Me's `hoursWorked` (a plain decimal number of hours, e.g. 9.25)
 * as "9h 15m" - matches how WorklogCard elsewhere on this site already shows durations, so the
 * same "hours worked" concept reads the same way everywhere in the app. */
function formatHoursWorked(hours: number | null): string {
  if (hours == null) return '-'
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** 2026-10-02 (SECTION 187, "system time shown" / "in that check in and chekout and in jobcard
 * timer correct this") - DEFENSIVE: AttendanceController.CheckIn/CheckOut now write whole-second
 * TimeSpans going forward (see AttendanceController.cs SECTION 187), but any row saved before that
 * backend fix still has the old raw value sitting in the database exactly as it was written, e.g.
 * "17:57:19.1741354" (System.Text.Json's default TimeSpan serialization, full sub-second ticks) -
 * it does not get rewritten retroactively just because the backend changed. This strips any
 * residual fractional-seconds suffix so those already-stored rows also display cleanly, not just
 * newly-created ones. It also makes the value safe to feed into the manager Mark() view's HTML
 * <input type="time"> further down, which silently rejects/blanks anything beyond "HH:mm:ss".
 * Any value that doesn't match the expected "HH:mm:ss[...]" shape is returned as-is rather than
 * dropped, so an unexpected format is still visible instead of hidden. */
function formatTimeOfDay(raw: string | null | undefined): string {
  if (!raw) return ''
  const match = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})/)
  if (!match) return raw
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}`
}

function todayIso(): string {
  // Local (browser) date, not UTC - avoids the classic "it's already tomorrow in UTC" off-by-one
  // for IST users after ~5:30pm UTC.
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isForbidden(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  return status === 403
}

// 2026-09-29 (SECTION 159, "this attence ui also make attractive and small table make proper this
// much big dont show" - with a screenshot of the manager roster table): the row height was blown
// up mainly by the 4-button status picker (STATUS_OPTIONS.map(...) below) wrapping onto multiple
// lines inside a narrow column - replaced with a single compact <select> per row (see the roster
// table further down), plus tighter padding/font-size everywhere via this one scoped stylesheet,
// reused by all three tables on this page (dealer summary, staff roster, self view) so the whole
// page reads as one compact, consistent design rather than three different table styles.
const ATTENDANCE_STYLES = `
  .attn-table-wrap { overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 10px; }
  .attn-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .attn-table th {
    text-align: left; padding: 8px 12px; background: #f8fafc; font-weight: 600;
    color: #475569; border-bottom: 1px solid #e5e7eb; white-space: nowrap;
  }
  .attn-table td { padding: 6px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; line-height: 1.3; }
  .attn-table tbody tr:last-child td { border-bottom: none; }
  .attn-table tbody tr:hover { background: #f8fafc; }
  .attn-status-select {
    padding: 3px 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12px;
    min-width: 108px; background: #fff; color: #334155;
  }
  .attn-status-select.present { border-color: #16a34a; color: #15803d; font-weight: 600; }
  .attn-status-select.absent { border-color: #dc2626; color: #b91c1c; font-weight: 600; }
  .attn-status-select.halfday { border-color: #d97706; color: #b45309; font-weight: 600; }
  .attn-status-select.onleave { border-color: #64748b; color: #475569; font-weight: 600; }
  .attn-time-input { padding: 2px 6px; font-size: 12px; width: 88px; }
  .attn-loc-chip {
    display: inline-block; background: #eef2ff; color: #4338ca; border-radius: 999px;
    padding: 1px 8px; font-size: 11px; margin: 1px 3px 1px 0; white-space: nowrap;
  }
`

/** 2026-09-29 (SECTION 159) - DEFENSIVE, FLAGGED: your screenshot's Location column showed raw
 * text like ["CUS0288W1"] and ["CUS0288W1","CUS0288W7",...] instead of a plain location name. I
 * don't have confirmation the backend actually changed StaffRow.location's shape (still typed as
 * a single `string | null` above, unchanged from before) - what's most likely is this column is
 * now returning a JSON-encoded array (probably WorkLocationCodes) as a STRING rather than a single
 * location code as originally designed. Rather than guess at and rewrite the type to match, this
 * parses that shape defensively wherever it shows up and renders it as small chips instead of raw
 * JSON, without assuming it's the only possible shape - a plain single location string still
 * renders exactly as before. If this keeps happening, paste AttendanceController.cs's current
 * source (already staged once, but may have changed) and I'll fix the actual field name/type. */
function formatLocation(loc: string | null): ReactNode {
  if (!loc) return '-'
  const trimmed = loc.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.length === 0
          ? '-'
          : (
            <>
              {parsed.map((code, i) => <span key={i} className="attn-loc-chip">{String(code)}</span>)}
            </>
          )
      }
    } catch {
      // Not valid JSON after all - fall through and show the raw text below.
    }
  }
  return trimmed
}

// 2026-09-28 ("also in attendance Could not load the staff list for this dealer. Try again." -
// reported with no screenshot/console log this time): every catch below used to show a fixed
// generic string regardless of the real cause, same blind-spot already hit (and fixed) twice
// elsewhere this session for the job-card 500 and the VehicleSaleOverride error - the real HTTP
// status and this app's own `{ message: ... }` body (every controller in this codebase returns
// one on a 4xx/5xx) were being discarded. Now appended in parentheses so the NEXT time this fires,
// the on-screen text itself says why (e.g. a 401 vs 404 vs 500 vs a genuine network drop each look
// completely different) instead of needing another screenshot round-trip to find out.
function describeError(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { message?: string } } }
  const detail = e?.response?.data?.message
  const status = e?.response?.status
  if (detail) return `${fallback} (${detail})`
  if (status) return `${fallback} (HTTP ${status})`
  return `${fallback} (no response reached the server - check your connection)`
}

export function AttendancePage() {
  const { profile } = useStaffAuth()
  const isOrgWide = !profile?.dealerId

  const [date, setDate] = useState(todayIso())

  // null = still figuring out which view this login gets; true/false once the dealers-summary
  // call above has actually resolved (see this file's own doc comment on why this is decided by
  // the server's response, not a guessed profile.role field).
  const [isManager, setIsManager] = useState<boolean | null>(null)

  const [dealers, setDealers] = useState<DealerSummaryRow[]>([])
  const [dealersLoading, setDealersLoading] = useState(false)
  const [dealersError, setDealersError] = useState<string | null>(null)

  const [selectedDealerId, setSelectedDealerId] = useState<string | null>(profile?.dealerId || null)
  const [selectedDealerName, setSelectedDealerName] = useState<string>('')
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [staffLoading, setStaffLoading] = useState(false)
  const [staffError, setStaffError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [myRows, setMyRows] = useState<MyAttendanceRow[]>([])
  const [myLoading, setMyLoading] = useState(false)
  const [myError, setMyError] = useState<string | null>(null)

  // ---------------- Step 1: all-dealers summary (manager view) - also doubles as the access probe ----------------
  useEffect(() => {
    setDealersLoading(true)
    setDealersError(null)
    staffApi
      .get<{ date: string; dealers: DealerSummaryRow[] }>('/api/attendance/dealers-summary', { params: { date } })
      .then(({ data }) => {
        setIsManager(true)
        setDealers(data.dealers)
        // Dealer-scoped user: only one row ever comes back - auto-select it so they land
        // straight on their roster instead of an extra click on a table with one row.
        if (!isOrgWide && data.dealers.length === 1 && !selectedDealerId) {
          setSelectedDealerId(data.dealers[0].dealerId)
          setSelectedDealerName(data.dealers[0].dealerName)
        }
      })
      .catch((err) => {
        if (isForbidden(err)) {
          // Not a manager login - this is expected for a Supervisor/other non-WorkshopManagerUp+
          // role, not an error. Fall through to the self view below.
          setIsManager(false)
          return
        }
        setIsManager(true) // assume manager view so the real error actually surfaces, rather than silently hiding it behind the self view
        setDealersError(describeError(err, 'Could not load the dealer summary. Try again.'))
      })
      .finally(() => setDealersLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  // ---------------- Step 2: selected dealer's roster (manager view) ----------------
  useEffect(() => {
    if (!isManager || !selectedDealerId) return
    setStaffLoading(true)
    setStaffError(null)
    staffApi
      .get<{ date: string; items: StaffRow[] }>('/api/attendance', { params: { date, dealerId: selectedDealerId } })
      .then(({ data }) => setStaff(data.items))
      .catch((err) => setStaffError(describeError(err, 'Could not load the staff list for this dealer. Try again.')))
      .finally(() => setStaffLoading(false))
  }, [date, selectedDealerId, isManager])

  // ---------------- Self view: just my own last 14 days ----------------
  useEffect(() => {
    if (isManager !== false) return
    setMyLoading(true)
    setMyError(null)
    staffApi
      .get<{ fromDate: string; toDate: string; items: MyAttendanceRow[] }>('/api/attendance/me', { params: { date } })
      .then(({ data }) => setMyRows(data.items))
      .catch((err) => setMyError(describeError(err, 'Could not load your attendance. Try again.')))
      .finally(() => setMyLoading(false))
  }, [date, isManager])

  const openDealer = (row: DealerSummaryRow) => {
    setSelectedDealerId(row.dealerId)
    setSelectedDealerName(row.dealerName)
  }

  const backToAllDealers = () => {
    setSelectedDealerId(null)
    setSelectedDealerName('')
    setStaff([])
  }

  const markStatus = async (row: StaffRow, status: AttendanceStatus) => {
    setSavingId(row.employeeId)
    // Keep any check-in/out time already entered when just switching status; clear both if the
    // new status is Absent/OnLeave (they're hidden for those anyway).
    const keepTimes = status === 'Present' || status === 'HalfDay'
    try {
      const { data } = await staffApi.post('/api/attendance/mark', {
        employeeId: row.employeeId,
        date,
        status,
        checkInTime: keepTimes ? row.checkInTime || null : null,
        checkOutTime: keepTimes ? row.checkOutTime || null : null,
        remarks: row.remarks || null,
      })
      setStaff((prev) =>
        prev.map((s) =>
          s.employeeId === row.employeeId
            ? { ...s, status: data.status, checkInTime: data.checkInTime, checkOutTime: data.checkOutTime, marked: true }
            : s,
        ),
      )
      // Refresh the all-dealers counts in the background so they stay correct if the user goes back.
      staffApi
        .get<{ date: string; dealers: DealerSummaryRow[] }>('/api/attendance/dealers-summary', { params: { date } })
        .then(({ data: d }) => setDealers(d.dealers))
        .catch(() => {})
    } catch {
      setStaffError(`Could not save attendance for ${row.employeeName}. Try again.`)
    } finally {
      setSavingId(null)
    }
  }

  const updateTime = (employeeId: string, field: 'checkInTime' | 'checkOutTime', value: string) => {
    setStaff((prev) => prev.map((s) => (s.employeeId === employeeId ? { ...s, [field]: value || null } : s)))
  }

  const saveTimes = (row: StaffRow) => {
    if (row.status === 'Present' || row.status === 'HalfDay') markStatus(row, row.status)
  }

  // ---------------- Self view render (Supervisor / any other non-manager login) ----------------
  if (isManager === false) {
    return (
      <div className="card">
        <style>{ATTENDANCE_STYLES}</style>
        <h2>My Attendance</h2>
        {/* <p className="muted">
          Your own attendance only - if a day looks wrong, ask your dealer's Workshop Manager to correct it; you
          can't edit this yourself here.
        </p> */}

        <div className="form-row" style={{ marginBottom: 16 }}>
          <div className="field">
            <label>Up to date</label>
            <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        {myLoading && <p className="muted">Loading...</p>}
        {myError && <p className="error-text">{myError}</p>}
        {!myLoading && !myError && myRows.length === 0 && <p className="muted">No attendance recorded in this range yet.</p>}
        {!myLoading && myRows.length > 0 && (
          <div className="attn-table-wrap">
            <table className="attn-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Shift</th>
                  <th>Hours</th>
                </tr>
              </thead>
              <tbody>
                {myRows.map((r) => (
                  <tr key={r.date}>
                    <td>{r.date.slice(0, 10)}</td>
                    <td>{r.status ?? <span className="muted">Not marked</span>}</td>
                    <td className="muted">{formatLocation(r.location)}</td>
                    <td>{formatTimeOfDay(r.checkInTime) || '-'}</td>
                    <td>{formatTimeOfDay(r.checkOutTime) || '-'}</td>
                    <td className="muted">{r.shift ?? '-'}</td>
                    {/* 2026-09-28 (SECTION 143): still-open (no checkout yet) rows show this as a
                       live-ish figure - it reflects hours worked as of the last time this page
                       fetched /api/attendance/me, not a per-second ticking clock (see this file's
                       hoursWorked doc comment above for why it's computed this way). */}
                    <td className="muted">{formatHoursWorked(r.hoursWorked)}{r.checkInTime && !r.checkOutTime && r.date.slice(0, 10) === todayIso() ? ' (ongoing)' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ---------------- Manager view render (unchanged flow, still loading if isManager is null) ----------------
  return (
    <div className="card">
      <style>{ATTENDANCE_STYLES}</style>
      <h2>Attendance</h2>
      <p className="muted">
        {selectedDealerId ? `Marking attendance for ${selectedDealerName || 'this dealer'}.` : 'Select a dealer to mark or review attendance.'}
      </p>

      <div className="form-row" style={{ marginBottom: 16 }}>
        <div className="field">
          <label>Date</label>
          <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {!selectedDealerId && (
        <>
          {dealersLoading && <p className="muted">Loading dealers...</p>}
          {dealersError && <p className="error-text">{dealersError}</p>}
          {!dealersLoading && !dealersError && dealers.length === 0 && (
            <p className="muted">No dealers found for your account.</p>
          )}
          {!dealersLoading && dealers.length > 0 && (
            <div className="attn-table-wrap">
              <table className="attn-table">
                <thead>
                  <tr>
                    <th>Dealer</th>
                    <th>Total Staff</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Half Day</th>
                    <th>On Leave</th>
                    <th>Not Marked</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dealers.map((d) => (
                    <tr key={d.dealerId}>
                      <td>{d.dealerName}</td>
                      <td>{d.totalStaff}</td>
                      <td>{d.present}</td>
                      <td>{d.absent}</td>
                      <td>{d.halfDay}</td>
                      <td>{d.onLeave}</td>
                      <td>{d.notMarked}</td>
                      <td>
                        <button className="btn btn-sm btn-primary" onClick={() => openDealer(d)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {selectedDealerId && (
        <>
          {isOrgWide && (
            <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={backToAllDealers}>
              &larr; All Dealers
            </button>
          )}
          {staffLoading && <p className="muted">Loading staff...</p>}
          {staffError && <p className="error-text">{staffError}</p>}
          {!staffLoading && !staffError && staff.length === 0 && (
            <p className="muted">No active staff found for this dealer.</p>
          )}
          {!staffLoading && staff.length > 0 && (
            <div className="attn-table-wrap">
              <table className="attn-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Designation</th>
                    <th>Role</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Check-in</th>
                    <th>Check-out</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.employeeId}>
                      <td>{s.employeeName}</td>
                      {/* 2026-10-05: Designation column - see this file's own Designation doc
                         comment. "-" (not the role) when the roster response has none. */}
                      <td>{s.designation && s.designation.trim() ? s.designation : <span className="muted">-</span>}</td>
                      <td className="muted">{s.role}</td>
                      <td className="muted">{formatLocation(s.location)}</td>
                      {/* 2026-09-29 (SECTION 159, "make attractive and small table ... this much
                         big dont show"): the 4 separate wrapping status buttons this used to be
                         were the main cause of the oversized rows in your screenshot - once the
                         column got narrow, they wrapped onto 2-3 lines and every row in the whole
                         table grew to match the tallest one. Replaced with one compact <select> -
                         same markStatus() call as before, just triggered onChange instead of
                         onClick, and color-coded via the attn-status-select.<status> CSS classes
                         above so the current status is still obvious at a glance. */}
                      <td>
                        <select
                          className={`attn-status-select${s.status ? ` ${s.status.toLowerCase()}` : ''}`}
                          value={s.status ?? ''}
                          disabled={savingId === s.employeeId}
                          onChange={(e) => markStatus(s, e.target.value as AttendanceStatus)}
                        >
                          <option value="" disabled>Not marked</option>
                          {STATUS_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {(s.status === 'Present' || s.status === 'HalfDay') && (
                          <input
                            type="time"
                            className="attn-time-input"
                            value={formatTimeOfDay(s.checkInTime)}
                            onChange={(e) => updateTime(s.employeeId, 'checkInTime', e.target.value)}
                            onBlur={() => saveTimes(s)}
                          />
                        )}
                      </td>
                      <td>
                        {(s.status === 'Present' || s.status === 'HalfDay') && (
                          <input
                            type="time"
                            className="attn-time-input"
                            value={formatTimeOfDay(s.checkOutTime)}
                            onChange={(e) => updateTime(s.employeeId, 'checkOutTime', e.target.value)}
                            onBlur={() => saveTimes(s)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
