// mobile\src\auth\tokenRenew.ts  (a copy of web/src/auth/dealerRenew.ts - keep the two in step)
/**
 * 2026-10-23 (VAPT DMS-16: "token lifetimes of 1 hour or less with silent renewal"): the Dealer / Workshop token now lives at most an hour (the API refuses an older one, Security:MaxTokenMinutes). So that a
 * person who keeps working is not signed out, the apps swap it for a fresh one (POST /api/session/renew) during its last 15 minutes. Written without any browser / React dependency so the web and the Android app use
 * the same code (mobile/src/auth/tokenRenew.ts is a copy) and it can be tested on its own.
 *  - One renewal at a time: requests that arrive while it runs simply wait for it.
 *  - Quiet on failure: an old API without the endpoint (404), a Microsoft session (400) or a token that already ran out (401) just carries on - the normal "401 = sign in again" handling is untouched.
 */
export const RENEW_WINDOW_MS = 15 * 60 * 1000

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The "exp" of a JWT in milliseconds, or null when the token cannot be read. (Own base64 decoder: no atob / Buffer needed on any platform.) */
export function tokenExpiryMs(token: string): number | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const s = part.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
    let bits = 0
    let acc = 0
    let out = ''
    for (const ch of s) {
      const v = B64.indexOf(ch)
      if (v < 0) return null
      acc = (acc << 6) | v
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out += String.fromCharCode((acc >> bits) & 0xff)
      }
    }
    const exp = (JSON.parse(out) as { exp?: number }).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

export interface RenewerDeps {
  getToken: () => string | null
  /** Store the new token (and use it from the next request on). */
  saveToken: (token: string) => void | Promise<void>
  /** POST /api/session/renew with the current token; resolves the new token. */
  post: (currentToken: string) => Promise<string | null | undefined>
  now?: () => number
}

export function createRenewer(deps: RenewerDeps) {
  let inflight: Promise<void> | null = null
  const now = deps.now ?? Date.now
  return async function renewIfNeeded(): Promise<void> {
    if (inflight) return inflight
    const token = deps.getToken()
    if (!token) return
    const exp = tokenExpiryMs(token)
    if (exp === null || exp - now() > RENEW_WINDOW_MS) return
    inflight = (async () => {
      try {
        const fresh = await deps.post(token)
        if (fresh && fresh !== token) await deps.saveToken(fresh)
      } catch {
        // see the header comment: failures are left to the normal 401 handling
      } finally {
        inflight = null
      }
    })()
    return inflight
  }
}
