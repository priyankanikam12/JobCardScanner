// web\src\lib\careDesk.ts
import { staffApi } from '../api/client'

/**
 * 2026-10-19 ("click the button -> Care Desk opens already signed in, directly on the right page"): the ONE way this app opens Care Desk.
 *   1. asks the JobCard API for a 60-second, single-use token for the person who is signed in HERE (Microsoft or Dealer login - both work): POST /api/care-desk/sso-token
 *   2. opens Care Desk's /api/auth/sso with that token and the page to land on (path); Care Desk signs the same person in and redirects to the page - no second login.
 * path: '' or '/' = the person's own home in Care Desk (an Admin lands on the admin dashboard); '/field/search?q=<chassis>' = the search for a vehicle; '/field/tickets/<ticket no>' = one ticket.
 * The new tab is opened first (inside the click, so the browser does not block it) and pointed at Care Desk once the token has arrived.
 * Care Desk must have the person's work email registered (screen B4) - otherwise its login page says so.
 */
export const CARE_DESK_URL: string = ((import.meta.env.VITE_CARE_DESK_URL as string | undefined) ?? '').trim().replace(/\/+$/, '')

export async function openCareDesk(path = ''): Promise<void> {
  if (!CARE_DESK_URL) { alert('Care Desk is not set up on this site (VITE_CARE_DESK_URL).'); return }
  const w = window.open('', '_blank')
  try {
    const { data } = await staffApi.post<{ token: string }>('/api/care-desk/sso-token')
    const next = path && path !== '/' ? `&next=${encodeURIComponent(path)}` : ''
    const url = `${CARE_DESK_URL}/api/auth/sso?token=${encodeURIComponent(data.token)}${next}`
    if (w) { w.opener = null; w.location.href = url } else window.location.href = url
  } catch (err) {
    w?.close()
    const status = (err as { response?: { status?: number; data?: { message?: string } } })?.response?.status
    alert(status === 403 ? 'Your login is not allowed to open Care Desk (CorporateAdmin / SystemAdmin only).' : 'Could not open Care Desk. Please try again.')
  }
}
