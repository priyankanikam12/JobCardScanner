// web\src\lib\sessionRevoke.ts
// 2026-10-23 (VAPT DMS-16): "signing out only deletes the key locally; the token itself remains valid on the server". Signing out now also tells the API to refuse that token from then on
// (POST /api/session/logout, backend SessionController). It never blocks or breaks sign-out: at most 3 seconds, every error ignored.
import axios from 'axios'
import { staffApi } from '../api/client'

const baseURL = import.meta.env.VITE_API_BASE_URL

/** Staff (Dealer / Workshop login or Microsoft): staffApi attaches the token that is in use right now. Await it BEFORE the local session is cleared. */
export async function revokeStaffSession(): Promise<void> {
  try {
    await staffApi.post('/api/session/logout', null, { timeout: 3000 })
  } catch {
    // already expired / offline / API older than this fix: sign-out goes on
  }
}

/** Customer portal: the token is passed in explicitly, because the caller clears the stored session right after calling this. */
export function revokeToken(token: string | null | undefined): void {
  if (!token) return
  void axios.post(`${baseURL}/api/session/logout`, null, { headers: { Authorization: `Bearer ${token}` }, timeout: 3000 }).catch(() => undefined)
}
