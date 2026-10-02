/**
 * Attendance screen (Android/Expo) - 2026-09-25, same request/build as web's AttendancePage.tsx
 * (see that file's doc comment for the full "morning scenario not found, standard design" context
 * - it applies here identically, please read it too).
 *
 * UPDATE 2026-09-26 - API CLIENT IMPORT FIXED FROM YOUR REAL FILE: you pasted the real
 * mobile/src/api/client.ts. It exports a NAMED `apiClient` (an axios instance), not a named `api`
 * (that was my original guess, and it's what caused your TS2305 "has no exported member 'api'"
 * error). Fixed below - every call now goes through `apiClient.get(...)` / `apiClient.post(...)`.
 * Your real client.ts also confirms request auth is handled entirely inside its own axios
 * interceptor (a cached Dealer JWT or Azure AD token, attached automatically as an Authorization
 * header) - so this screen does NOT need to read or pass a token itself; it only needs to know
 * WHICH dealer/role the signed-in user is, for the isOrgWide check below.
 *
 * STILL A GUESS, NOT YET CONFIRMED: the auth/profile hook. Your real client.ts references
 * `AuthContext` (Azure AD) and a separate `StaffAuthContext`/`dealerAuthService` (Dealer/Workshop
 * login) as the two things that call `setAccessToken`/`setDealerToken` - but I have not seen
 * either of those context files themselves, so I don't actually know the hook's real name or
 * whether `profile.dealerId` is the right field on it. `useAuth()` returning `{ profile }` below
 * is still the same guess as before - paste AuthContext.tsx (or StaffAuthContext.tsx, whichever
 * one exposes the signed-in user's dealerId/role on mobile) and I'll correct this the same way the
 * API client import was just corrected.
 *
 * Also still guessed, unconfirmed: plain React Native components + StyleSheet (no UI kit) - if
 * your app uses one (react-native-paper, tamagui, etc.) the styling below won't match it visually,
 * even though the logic underneath will still be correct. Also still not wired into any navigator -
 * add a screen entry for this component wherever your other staff screens are registered.
 *
 * The business logic and the endpoints it calls (GET /api/attendance/dealers-summary,
 * GET /api/attendance, POST /api/attendance/mark, GET /api/attendance/me) are the SAME ones
 * AttendancePage.tsx (web) uses and the SAME ones AttendanceController.cs implements - that part is
 * solid; only the auth-hook import above is still an open guess.
 *
 * 2026-09-28 ACCESS-CONTROL REWORK - mirrors web/src/pages/staff/AttendancePage.tsx's own
 * 2026-09-28 update exactly (see that file's doc comment for the full reasoning): the
 * dealers-summary/roster/mark flow below is now WorkshopManagerUp+ ("main dealer") only on the
 * backend, and a 403 from that first call now means "not a manager login" - not an error - and
 * falls back to a small read-only "my own attendance" list (GET /api/attendance/me) instead. Same
 * reasoning as the web page for why this is decided by the server's actual response rather than a
 * guessed profile.role field.
 *
 * SECTION 172 (2026-09-30) "in dashboardpage in android show only menu ... 6. Attendance only
 * personal" - DashboardScreen.tsx's Attendance card now passes route param { onlyMine: true },
 * read below via `route.params?.onlyMine`. When set, loadDealers below is short-circuited entirely
 * (no GET /api/attendance/dealers-summary call at all, manager or not) and this screen goes
 * straight to the same read-only "my own attendance" branch a 403 would otherwise produce - so a
 * WorkshopManager+ login opening Attendance FROM THE DASHBOARD always sees only their own record,
 * never the dealer-wide staff roster/marking view. The full manager flow itself is UNCHANGED and
 * still reachable exactly as before for any other entry point that navigates here without the
 * param (there is none registered elsewhere in RootNavigator.tsx today, but this keeps the
 * distinction real rather than deleting the manager code path outright, in case a future
 * "Mark Staff Attendance" entry point is added back later - see AttendanceScreen's own admin-side
 * marking UI further down, all still intact).
 */
import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
// FIXED 2026-09-26 - real named export confirmed from your mobile/src/api/client.ts.
import { apiClient } from '../api/client'
// GUESS - still unconfirmed, see file doc comment above.
import { useAuth } from '../auth/AuthContext'
import type { RootStackParamList } from '../navigation/RootNavigator'

type Props = NativeStackScreenProps<RootStackParamList, 'Attendance'>

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
  // maintain") - mirrors web/src/pages/staff/AttendancePage.tsx's own same-day fix. DISPLAY-ONLY,
  // computed fresh by AttendanceController.Me() on every call - CheckOutTime in the database is
  // still only ever set by a real check-out/mark, never auto-written here. For today's still-open
  // row this is the live elapsed hours since check-in (uncapped, per your confirmed answer); for a
  // past day with no checkout ever recorded it's null.
  hoursWorked: number | null
}

/** Formats hoursWorked (e.g. 9.25) as "9h 15m" - same format as the web page uses. */
function formatHoursWorked(hours: number | null): string {
  if (hours == null) return '-'
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** 2026-10-02 (SECTION 187, "system time shown" / "in that check in and chekout and in jobcard
 * timer correct this") - DEFENSIVE, same fix as the web AttendancePage.tsx: the backend now writes
 * whole-second check-in/check-out times going forward (AttendanceController.cs SECTION 187), but
 * rows saved before that fix still hold the old raw value, e.g. "17:57:19.1741354"
 * (System.Text.Json's default TimeSpan serialization, full sub-second ticks) - it isn't rewritten
 * retroactively. This strips any residual fractional-seconds suffix so those already-stored rows
 * also display cleanly, not just newly-created ones. An unexpected format is returned as-is rather
 * than dropped, so it stays visible instead of silently disappearing. */
function formatTimeOfDay(raw: string | null | undefined): string {
  if (!raw) return ''
  const match = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})/)
  if (!match) return raw
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}`
}

function todayIso(): string {
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

// 2026-09-28 - mirrors web/src/pages/staff/AttendancePage.tsx's own describeError added the same
// round ("also in attendance Could not load the staff list for this dealer. Try again." reported
// with no console log this time): appends the real HTTP status and this app's own `{ message }`
// body to the fallback text instead of always showing the same fixed string, so the next
// occurrence says why on-screen.
function describeError(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { message?: string } } }
  const detail = e?.response?.data?.message
  const status = e?.response?.status
  if (detail) return `${fallback} (${detail})`
  if (status) return `${fallback} (HTTP ${status})`
  return `${fallback} (no response reached the server - check your connection)`
}

export default function AttendanceScreen({ route }: Props) {
  const { profile } = useAuth()
  const isOrgWide = !profile?.dealerId
  // SECTION 172 - see this file's own doc comment above.
  const onlyMine = route.params?.onlyMine ?? false

  const [date] = useState(todayIso())
  // Date picking kept to "today" only for this first version - a real date picker needs an Expo
  // module (@react-native-community/datetimepicker) I don't know is already installed here. Say
  // the word and I'll add a past-date picker once I know which one your app already uses.
  const [dealers, setDealers] = useState<DealerSummaryRow[]>([])
  const [dealersLoading, setDealersLoading] = useState(false)
  const [dealersError, setDealersError] = useState<string | null>(null)

  const [selectedDealerId, setSelectedDealerId] = useState<string | null>(profile?.dealerId || null)
  const [selectedDealerName, setSelectedDealerName] = useState<string>('')
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [staffLoading, setStaffLoading] = useState(false)
  const [staffError, setStaffError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  // null = still figuring out which view this login gets, per this file's own 2026-09-28 doc
  // comment - decided by whether dealers-summary below succeeds or comes back 403.
  const [isManager, setIsManager] = useState<boolean | null>(null)
  const [myRows, setMyRows] = useState<MyAttendanceRow[]>([])
  const [myLoading, setMyLoading] = useState(false)
  const [myError, setMyError] = useState<string | null>(null)

  const loadDealers = useCallback(() => {
    // SECTION 172 - onlyMine skips the manager check entirely, so this screen goes straight to
    // the personal-only branch below (isManager === false) without ever calling
    // dealers-summary - see this file's own doc comment above.
    if (onlyMine) {
      setIsManager(false)
      return
    }
    setDealersLoading(true)
    setDealersError(null)
    apiClient
      .get<{ date: string; dealers: DealerSummaryRow[] }>('/api/attendance/dealers-summary', { params: { date } })
      .then(({ data }: any) => {
        setIsManager(true)
        setDealers(data.dealers)
        if (!isOrgWide && data.dealers.length === 1 && !selectedDealerId) {
          setSelectedDealerId(data.dealers[0].dealerId)
          setSelectedDealerName(data.dealers[0].dealerName)
        }
      })
      .catch((err: unknown) => {
        if (isForbidden(err)) {
          setIsManager(false) // not a manager login - expected, not an error, see doc comment above
          return
        }
        setIsManager(true) // let the real error surface instead of silently hiding it behind the self view
        setDealersError(describeError(err, 'Could not load the dealer summary. Pull to retry.'))
      })
      .finally(() => setDealersLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, onlyMine])

  useEffect(() => {
    loadDealers()
  }, [loadDealers])

  const loadStaff = useCallback(() => {
    if (!isManager || !selectedDealerId) return
    setStaffLoading(true)
    setStaffError(null)
    apiClient
      .get<{ date: string; items: StaffRow[] }>('/api/attendance', { params: { date, dealerId: selectedDealerId } })
      .then(({ data }: any) => setStaff(data.items))
      .catch((err: unknown) => setStaffError(describeError(err, 'Could not load the staff list for this dealer. Pull to retry.')))
      .finally(() => setStaffLoading(false))
  }, [date, selectedDealerId, isManager])

  useEffect(() => {
    loadStaff()
  }, [loadStaff])

  const loadMine = useCallback(() => {
    if (isManager !== false) return
    setMyLoading(true)
    setMyError(null)
    apiClient
      .get<{ fromDate: string; toDate: string; items: MyAttendanceRow[] }>('/api/attendance/me', { params: { date } })
      .then(({ data }: any) => setMyRows(data.items))
      .catch((err: unknown) => setMyError(describeError(err, 'Could not load your attendance. Pull to retry.')))
      .finally(() => setMyLoading(false))
  }, [date, isManager])

  useEffect(() => {
    loadMine()
  }, [loadMine])

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
    const keepTimes = status === 'Present' || status === 'HalfDay'
    try {
      const { data }: any = await apiClient.post('/api/attendance/mark', {
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
      loadDealers()
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

  if (isManager === false) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>My Attendance</Text>
        <Text style={styles.subtitle}>{date} - your own record only</Text>
        {myLoading && <ActivityIndicator style={{ marginTop: 16 }} />}
        {myError && <Text style={styles.errorText}>{myError}</Text>}
        <FlatList
          data={myRows}
          keyExtractor={(r) => r.date}
          refreshControl={<RefreshControl refreshing={myLoading} onRefresh={loadMine} />}
          ListEmptyComponent={!myLoading ? <Text style={styles.muted}>No attendance recorded in this range yet.</Text> : null}
          renderItem={({ item }) => (
            <View style={styles.staffCard}>
              <Text style={styles.staffName}>{item.date.slice(0, 10)}</Text>
              <Text style={styles.muted}>{item.status ?? 'Not marked'}{item.location ? ` - ${item.location}` : ''}</Text>
              <Text style={styles.muted}>
                In: {formatTimeOfDay(item.checkInTime) || '-'}  Out: {formatTimeOfDay(item.checkOutTime) || '-'}
              </Text>
              {/* 2026-09-28 (SECTION 143) - see MyAttendanceRow's own doc comment above. */}
              <Text style={styles.muted}>
                Hours: {formatHoursWorked(item.hoursWorked)}
                {item.checkInTime && !item.checkOutTime && item.date.slice(0, 10) === date ? ' (ongoing)' : ''}
              </Text>
            </View>
          )}
        />
      </View>
    )
  }

  if (!selectedDealerId) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Attendance</Text>
        <Text style={styles.subtitle}>{date} - select a dealer</Text>
        {dealersLoading && <ActivityIndicator style={{ marginTop: 16 }} />}
        {dealersError && <Text style={styles.errorText}>{dealersError}</Text>}
        <FlatList
          data={dealers}
          keyExtractor={(d) => d.dealerId}
          refreshControl={<RefreshControl refreshing={dealersLoading} onRefresh={loadDealers} />}
          ListEmptyComponent={!dealersLoading ? <Text style={styles.muted}>No dealers found.</Text> : null}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.dealerRow} onPress={() => openDealer(item)}>
              <Text style={styles.dealerName}>{item.dealerName}</Text>
              <Text style={styles.muted}>
                {item.present} present / {item.absent} absent / {item.notMarked} not marked (of {item.totalStaff})
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        {isOrgWide && (
          <TouchableOpacity onPress={backToAllDealers}>
            <Text style={styles.backLink}>&larr; All Dealers</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>{selectedDealerName || 'Attendance'}</Text>
        <Text style={styles.subtitle}>{date}</Text>
      </View>
      {staffLoading && <ActivityIndicator style={{ marginTop: 16 }} />}
      {staffError && <Text style={styles.errorText}>{staffError}</Text>}
      <FlatList
        data={staff}
        keyExtractor={(s) => s.employeeId}
        refreshControl={<RefreshControl refreshing={staffLoading} onRefresh={loadStaff} />}
        ListEmptyComponent={!staffLoading ? <Text style={styles.muted}>No active staff found.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.staffCard}>
            <Text style={styles.staffName}>{item.employeeName}</Text>
            <Text style={styles.muted}>{item.role}{item.location ? ` - ${item.location}` : ''}</Text>
            <View style={styles.statusRow}>
              {STATUS_OPTIONS.map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  disabled={savingId === item.employeeId}
                  style={[styles.statusButton, item.status === value && styles.statusButtonActive]}
                  onPress={() => markStatus(item, value)}
                >
                  <Text style={[styles.statusButtonText, item.status === value && styles.statusButtonTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {(item.status === 'Present' || item.status === 'HalfDay') && (
              <View style={styles.timeRow}>
                <TextInput
                  style={styles.timeInput}
                  placeholder="Check-in (HH:MM)"
                  value={formatTimeOfDay(item.checkInTime)}
                  onChangeText={(v) => updateTime(item.employeeId, 'checkInTime', v)}
                  onBlur={() => saveTimes(item)}
                />
                <TextInput
                  style={styles.timeInput}
                  placeholder="Check-out (HH:MM)"
                  value={formatTimeOfDay(item.checkOutTime)}
                  onChangeText={(v) => updateTime(item.employeeId, 'checkOutTime', v)}
                  onBlur={() => saveTimes(item)}
                />
              </View>
            )}
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff', padding: 16 },
  headerRow: { marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 13, color: '#666', marginTop: 2 },
  muted: { fontSize: 13, color: '#666' },
  errorText: { color: '#b00020', marginTop: 8 },
  backLink: { color: '#2563eb', marginBottom: 8 },
  dealerRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  dealerName: { fontSize: 16, fontWeight: '500' },
  staffCard: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  staffName: { fontSize: 16, fontWeight: '500' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  statusButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  statusButtonActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  statusButtonText: { fontSize: 13, color: '#333' },
  statusButtonTextActive: { color: '#fff' },
  timeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  timeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
  },
})
