// mobile\src\api\client.ts
import axios from 'axios'

const baseURL = process.env.EXPO_PUBLIC_API_BASE_URL

export const apiClient = axios.create({ baseURL })

// Staff have two possible sign-in paths on mobile, same as web (see LoginScreen's Dealer/Workshop
// vs Staff Microsoft tabs): a cached Dealer JWT always wins over a cached Azure AD token when both
// are present - mirrors web/src/api/client.ts's interceptor precedence exactly. The backend
// accepts both schemes on every staff policy (see Program.cs AuthSchemes.AzureAd /
// AuthSchemes.DealerJwt), so nothing downstream of this interceptor needs to know which one
// actually signed a given session in.
let cachedAzureAdToken: string | null = null
let cachedDealerToken: string | null = null

/** Called by AuthContext (Azure AD) whenever its access token is issued/refreshed/cleared. */
export function setAccessToken(token: string | null) {
  cachedAzureAdToken = token
}

/** Called by dealerAuthService/StaffAuthContext whenever the Dealer/Workshop session changes. */
export function setDealerToken(token: string | null) {
  cachedDealerToken = token
}

apiClient.interceptors.request.use((config) => {
  const token = cachedDealerToken ?? cachedAzureAdToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 2026-09-18 (web/src/api/client.ts): a Dealer/Workshop session has NO refresh mechanism - DealerJwtTokenService issues one bearer JWT with a flat expiry (default 8 h). Once it expires every request
// 401s forever while the app still believes the person is signed in. Web fixes this with a response interceptor that clears the stale session and returns to /login. Same here: on any 401 while a
// Dealer session token is on file the registered handler (StaffAuthContext - clears the stored session and shows the login screen) is called. A 401 while signed in through Azure AD with NO dealer
// session is left alone on purpose (that is the "valid Microsoft account but no JobCardScanner user yet" case, which must keep its own message).
let unauthorizedHandler: (() => void) | null = null

/** Called by StaffAuthContext once, to say what "the dealer session expired" does. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn
}

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const status = (error as { response?: { status?: number } })?.response?.status
    if (status === 401 && cachedDealerToken && unauthorizedHandler) unauthorizedHandler()
    return Promise.reject(error)
  },
)
