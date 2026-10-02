// mobile\src\services\attendanceCheckin.ts
/**
 * Self check-in/check-out, tied to the mobile app's OWN login/logout - 2026-09-26 ("when i login
 * then this time was login time and add in that shift when i login on 9 am then 1st shift 9 am to
 * 6pm 1st shift and then 6 pm to 12 2nd shift before log out chek out need to do that will
 * update").
 *
 * THIS IS SEPARATE FROM AttendanceScreen.tsx (SECTION 98/99 - the supervisor-facing "mark someone
 * else's attendance for a dealer" screen). These two functions are meant to be called from your
 * app's OWN login/logout code, which I have never seen in this session (same caveat as
 * AttendanceScreen.tsx's guessed API-client import - see that file's doc comment) - so nothing in
 * your real login/logout screens has been touched. Wire these in yourself:
 *
 *   - Call `checkInAfterLogin()` right after a successful sign-in completes (token stored, user
 *     profile loaded). Fire-and-forget is fine - don't await it if that would delay showing your
 *     home screen; it never throws (see below).
 *   - Call `await checkOutBeforeLogout()` at the VERY START of your sign-out handler, before you
 *     clear the auth token or navigate to the login screen - "before log out chek out need to do".
 *     IMPORTANT: this never throws. If the network call fails (no signal, server down, timeout),
 *     logout must still proceed - don't let a failed check-out trap someone on the app. That's why
 *     both functions swallow their own errors instead of letting you decide per call-site.
 *
 * CONFIRMED LIMITATION (from your own JobCardScannerDbContext.cs comment, not a guess): technicians
 * live in a separate, login-less Technician table - they never sign into the app, so check-in/
 * check-out can never fire for them. If technician attendance also needs tracking, that still has
 * to go through the supervisor-marked AttendancePage.tsx (web, SECTION 98) - say so if you want an
 * Android version of that page too; this file doesn't attempt it.
 *
 * ASSUMPTIONS made server-side (AttendanceController.CheckIn/CheckOut) that this file has no say
 * over - see README SECTION 101 for the full list:
 *   - Shift 1 = 09:00-18:00 IST, Shift 2 = 18:00-24:00 IST, computed from a fixed UTC+5:30 offset.
 *   - A login before 09:00 counts as Shift 1 (not covered by what you described).
 *   - Logging in always sets today's Status to Present, even overriding an earlier manual mark.
 *   - Only the day's FIRST login sets the check-in time/shift; later same-day logins just
 *     re-confirm Present.
 *
 * UPDATE 2026-09-26 - FIXED from your real mobile/src/api/client.ts: the named export is
 * `apiClient` (an axios instance), not `api` - that was my original guess, and it's what caused
 * the identical TS2305 error AttendanceScreen.tsx also hit. Your real client.ts also confirms auth
 * (Dealer JWT or Azure AD token) is attached automatically by its own request interceptor, so
 * nothing here needs to read or pass a token itself.
 */
import { apiClient } from '../api/client' // FIXED 2026-09-26 - real named export, confirmed from your api/client.ts.

export async function checkInAfterLogin(): Promise<void> {
  try {
    await apiClient.post('/api/attendance/check-in')
  } catch {
    // Swallowed on purpose - a failed check-in must never block or fail the login flow itself.
  }
}

export async function checkOutBeforeLogout(): Promise<void> {
  try {
    await apiClient.post('/api/attendance/check-out')
  } catch {
    // Swallowed on purpose - see file doc comment: logout must proceed even if this call fails.
  }
}
