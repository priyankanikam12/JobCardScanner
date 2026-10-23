// web\src\auth\tokenStorage.ts
// 2026-10-23 (VAPT DMS-16): where the app keeps its sign-in tokens. They used to sit in localStorage (readable by any script on the site and kept after the browser closes). Now they go to
// sessionStorage by default: gone when the tab is closed, not shared with other tabs or windows. That also means a link opened in a NEW tab asks for the sign-in again (Microsoft sign-in is one
// click when the Microsoft session is still alive; a Dealer / Workshop login types its password again). If that is too much for your users, set VITE_TOKEN_STORAGE=local in .env.production and
// rebuild - nothing else changes. (The full fix the report recommends - an HttpOnly cookie set by the API - needs DealerAuthController; see docs/VAPT-remaining-23.10.2026.md.)
const wantsLocal = String(import.meta.env.VITE_TOKEN_STORAGE ?? '').toLowerCase() === 'local'

export const tokenStorage: Storage = wantsLocal ? window.localStorage : window.sessionStorage
export const msalCacheLocation: 'localStorage' | 'sessionStorage' = wantsLocal ? 'localStorage' : 'sessionStorage'

/** Removes the copies an older build left in localStorage (so an old token does not stay behind for months). Called once at start-up. */
export function purgeLegacyTokenCopies(): void {
  if (wantsLocal) return
  try {
    localStorage.removeItem('jobcardscanner.dealerSession')
    localStorage.removeItem('jobcardscanner.customerSession')
    for (const key of Object.keys(localStorage)) {
      // MSAL's own cache entries (access / refresh / id tokens, accounts) from the old localStorage setting
      if (key.startsWith('msal.') || key.includes('login.windows.net') || key.includes('login.microsoftonline.com')) localStorage.removeItem(key)
    }
  } catch {
    // storage blocked by the browser: nothing to clean
  }
}
