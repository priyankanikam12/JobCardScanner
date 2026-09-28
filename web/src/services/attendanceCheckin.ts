/**
 * Self check-in/check-out, tied to the WEB app's OWN login/logout - 2026-09-28 ("when i login then
 * in that automatically check in time shown and when last sign out that was sign out that
 * update"), asked against AttendancePage.tsx (SECTION 98's supervisor-facing "mark someone else's
 * attendance" page).
 *
 * NO BACKEND CHANGE NEEDED - this reuses the exact POST /api/attendance/check-in and
 * POST /api/attendance/check-out endpoints already built 2026-09-26 for the mobile app (see
 * AttendanceController.CheckIn/CheckOut and mobile/src/services/attendanceCheckin.ts, which this
 * file is a straight web port of - same two functions, same fire-and-forget/never-throw contract,
 * just calling `staffApi` instead of the mobile app's `apiClient`). Once check-in fires, the
 * "shown automatically" part needs nothing extra either: AttendancePage.tsx's Step 2 roster already
 * reads checkInTime/checkOutTime straight from GET /api/attendance and renders them - it just had
 * nothing to show before because nothing was calling check-in/check-out from the web app yet.
 *
 * NOT WIRED IN YET - same caveat as the mobile file: I don't have your real web login/logout code
 * in this session (StaffAuthContext.tsx, or wherever staff sign in/out on web, was never pasted
 * here), so nothing there has been touched. Wire these in yourself:
 *
 *   - Call `checkInAfterLogin()` right after a successful staff sign-in completes (token stored,
 *     profile loaded). Fire-and-forget is fine - don't await it if that would delay showing the
 *     dashboard; it never throws (see below).
 *   - Call `await checkOutBeforeLogout()` at the VERY START of your sign-out handler, before
 *     clearing the auth token or navigating to the login page - same "before log out chek out need
 *     to do" ordering as mobile. IMPORTANT: this never throws - if the API call fails (network,
 *     server down, session already expired), logout must still proceed, so both functions swallow
 *     their own errors rather than letting the caller decide per call-site.
 *
 * If you paste your real StaffAuthContext.tsx/login page, I'll wire the two calls in directly
 * instead of leaving this as a manual step.
 *
 * SAME SERVER-SIDE ASSUMPTIONS as the mobile version apply here too (this file has no say over
 * them - see AttendanceController.CheckIn's doc comment / README SECTION 101):
 *   - Technicians are a separate, login-less table - they never sign into the app (web or mobile),
 *     so check-in/check-out can never fire for them; their attendance still only goes through the
 *     supervisor-marked Mark() flow AttendancePage.tsx already has.
 *   - Shift 1 = 09:00-18:00 IST, Shift 2 = 18:00-24:00 IST, fixed UTC+5:30 offset (no OS timezone
 *     lookup). A login before 09:00 counts as Shift 1.
 *   - Logging in always sets today's Status to Present, even overriding an earlier manual mark
 *     (e.g. a supervisor who'd already set this person OnLeave for today).
 *   - Only the day's FIRST login sets CheckInTime/Shift; later same-day logins just re-confirm
 *     Present without moving the check-in time.
 *
 * ASSUMPTION specific to this port, not yet confirmed: staffApi (web/src/api/client.ts) attaches
 * the staff auth token automatically the same way mobile's apiClient does, since AttendancePage.tsx
 * and every other staff page already call staffApi.get/post without passing a token explicitly. If
 * that's wrong, tell me and I'll adjust - I have not seen your real web api/client.ts this session.
 */
import { staffApi } from '../api/client'

export async function checkInAfterLogin(): Promise<void> {
  try {
    await staffApi.post('/api/attendance/check-in')
  } catch {
    // Swallowed on purpose - a failed check-in must never block or fail the login flow itself.
  }
}

export async function checkOutBeforeLogout(): Promise<void> {
  try {
    await staffApi.post('/api/attendance/check-out')
  } catch {
    // Swallowed on purpose - see file doc comment: logout must proceed even if this call fails.
  }
}
