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
