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
 * Flow (two levels, matching "for all dealer"):
 *   1. "All Dealers" table for the selected date - one row per dealer with Present/Absent/Half
 *      Day/On Leave/Not Marked counts (GET /api/attendance/dealers-summary). Org-wide roles
 *      (profile.dealerId is null, same convention JobCardWizardPage.tsx already uses for
 *      needsDealerPicker) see every dealer here; a dealer-scoped user sees just their own row and
 *      it's already "selected" (skips straight to step 2).
 *   2. Click a dealer row to drill into that dealer's full staff roster for the date
 *      (GET /api/attendance) and mark each person Present / Absent / Half Day / On Leave, with
 *      optional check-in/check-out time for Present/Half Day (POST /api/attendance/mark, saves
 *      immediately per row - no separate "Save" step, matching how the button-grid Complaints
 *      picker on the Job Card Wizard behaves: click = committed).
 *
 * NOT wired up (needs your input, not guessed): no route was added to your router (I don't have
 * that file) and no nav link was added to your sidebar - see README SECTION 98 for the one line to
 * add. No CSV export, no monthly view, no leave-approval workflow.
 */
import { useEffect, useState } from 'react'
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
  role: string
  status: AttendanceStatus | null
  checkInTime: string | null
  checkOutTime: string | null
  remarks: string | null
  marked: boolean
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

export function AttendancePage() {
  const { profile } = useStaffAuth()
  const isOrgWide = !profile?.dealerId

  const [date, setDate] = useState(todayIso())
  const [dealers, setDealers] = useState<DealerSummaryRow[]>([])
  const [dealersLoading, setDealersLoading] = useState(false)
  const [dealersError, setDealersError] = useState<string | null>(null)

  const [selectedDealerId, setSelectedDealerId] = useState<string | null>(profile?.dealerId || null)
  const [selectedDealerName, setSelectedDealerName] = useState<string>('')
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [staffLoading, setStaffLoading] = useState(false)
  const [staffError, setStaffError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  // ---------------- Step 1: all-dealers summary ----------------
  useEffect(() => {
    setDealersLoading(true)
    setDealersError(null)
    staffApi
      .get<{ date: string; dealers: DealerSummaryRow[] }>('/api/attendance/dealers-summary', { params: { date } })
      .then(({ data }) => {
        setDealers(data.dealers)
        // Dealer-scoped user: only one row ever comes back - auto-select it so they land
        // straight on their roster instead of an extra click on a table with one row.
        if (!isOrgWide && data.dealers.length === 1 && !selectedDealerId) {
          setSelectedDealerId(data.dealers[0].dealerId)
          setSelectedDealerName(data.dealers[0].dealerName)
        }
      })
      .catch(() => setDealersError('Could not load the dealer summary. Try again.'))
      .finally(() => setDealersLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  // ---------------- Step 2: selected dealer's roster ----------------
  useEffect(() => {
    if (!selectedDealerId) return
    setStaffLoading(true)
    setStaffError(null)
    staffApi
      .get<{ date: string; items: StaffRow[] }>('/api/attendance', { params: { date, dealerId: selectedDealerId } })
      .then(({ data }) => setStaff(data.items))
      .catch(() => setStaffError('Could not load the staff list for this dealer. Try again.'))
      .finally(() => setStaffLoading(false))
  }, [date, selectedDealerId])

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

  return (
    <div className="card">
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
            <table>
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
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.employeeId}>
                    <td>{s.employeeName}</td>
                    <td className="muted">{s.role}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {STATUS_OPTIONS.map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={`btn btn-sm ${s.status === value ? 'btn-primary' : ''}`}
                            disabled={savingId === s.employeeId}
                            onClick={() => markStatus(s, value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td>
                      {(s.status === 'Present' || s.status === 'HalfDay') && (
                        <input
                          type="time"
                          value={s.checkInTime || ''}
                          onChange={(e) => updateTime(s.employeeId, 'checkInTime', e.target.value)}
                          onBlur={() => saveTimes(s)}
                        />
                      )}
                    </td>
                    <td>
                      {(s.status === 'Present' || s.status === 'HalfDay') && (
                        <input
                          type="time"
                          value={s.checkOutTime || ''}
                          onChange={(e) => updateTime(s.employeeId, 'checkOutTime', e.target.value)}
                          onBlur={() => saveTimes(s)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}
