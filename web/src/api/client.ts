import axios from 'axios'
import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { msalInstance, apiLoginRequest } from '../auth/msalConfig'
import { getDealerToken, getDealerSession, clearDealerSession } from '../auth/dealerSession'

const baseURL = import.meta.env.VITE_API_BASE_URL

/**
 * Staff API client - attaches a fresh access token to every request. Staff have two possible
 * sign-in paths (see pages/staff/LoginPage.tsx "Staff" vs "Dealer / Workshop Login" tabs), so
 * this checks for a local Dealer JWT session first (cheap, synchronous, no network round trip)
 * and only falls back to the Azure AD / MSAL flow if there isn't one. The backend accepts both
 * schemes on every staff policy (see Program.cs AuthSchemes.AzureAd / AuthSchemes.DealerJwt), so
 * everything downstream of this interceptor is unaware of which path signed the user in.
 */
export const staffApi = axios.create({ baseURL })

staffApi.interceptors.request.use(async (config) => {
  const dealerToken = getDealerToken()
  if (dealerToken) {
    config.headers.Authorization = `Bearer ${dealerToken}`
    return config
  }

  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0]
  if (!account) return config

  try {
    const result = await msalInstance.acquireTokenSilent({ ...apiLoginRequest, account })
    config.headers.Authorization = `Bearer ${result.accessToken}`
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      const result = await msalInstance.acquireTokenPopup(apiLoginRequest)
      config.headers.Authorization = `Bearer ${result.accessToken}`
    } else {
      throw err
    }
  }
  return config
})

/**
 * 2026-09-18: a "Dealer / Workshop Login" session has no refresh mechanism - unlike the Azure AD
 * path above (acquireTokenSilent transparently renews using MSAL's own refresh token),
 * DealerJwtTokenService issues one bearer JWT with a flat expiry (DealerAuthJwt:ExpiryMinutes,
 * default 480 = 8h) and nothing ever replaces it. getDealerSession()/isAuthenticated in
 * StaffAuthContext only check whether a session OBJECT still exists in localStorage, not whether
 * its token is still valid, so once that JWT expires every request just 401s forever and the
 * person got stuck on RequireStaff's "Access not set up yet" card - the app still believed they
 * were signed in, so it never fell through to the "redirect to /login" branch. Diagnosed from a
 * pasted backend log: repeated `IDX10517 ... kid is missing` lines are expected noise (this app's
 * policies try BOTH the AzureAd and DealerJwt schemes on every request, see Program.cs - a real
 * Dealer JWT has no "kid" header since it's HMAC-signed, so the AzureAd handler always rejects it,
 * which is harmless as long as the DealerJwt handler accepts it); the actual failure was DealerJwt
 * itself rejecting the same token with `IDX10223 ... token is expired`.
 *
 * Fix: on any 401 while a dealer session is on file, treat it as "your session expired" - clear
 * the stale session and hard-navigate to /login (a full reload, not just a route change, so MSAL/
 * StaffAuthContext re-initialize cleanly from nothing - the same thing StaffLayout's manual
 * signOut() already does). Left untouched: a 401 while signed in via Azure AD with NO dealer
 * session on file - that's the intentional "you're a valid Microsoft account but no JobCardScanner
 * User row exists for you yet" case (see AppClaimsTransformation/UsersController), which should
 * keep showing "Access not set up yet, contact your admin", not bounce to /login.
 */
staffApi.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const status = (error as { response?: { status?: number } })?.response?.status
    if (status === 401 && getDealerSession() && !window.location.pathname.startsWith('/login')) {
      clearDealerSession()
      window.location.assign('/login')
    }
    return Promise.reject(error)
  },
)

const CUSTOMER_TOKEN_KEY = 'jobcardscanner.customerSession'

/** Customer tracking-portal API client - attaches the OTP-issued JWT (if the customer is logged in). */
export const portalApi = axios.create({ baseURL })

portalApi.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem(CUSTOMER_TOKEN_KEY)
    if (raw) {
      const session = JSON.parse(raw) as { accessToken: string }
      config.headers.Authorization = `Bearer ${session.accessToken}`
    }
  } catch {
    // ignore malformed/missing session - request proceeds unauthenticated
  }
  return config
})
