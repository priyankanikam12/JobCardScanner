import axios from 'axios'
import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { msalInstance, apiLoginRequest } from '../auth/msalConfig'
import { getDealerToken } from '../auth/dealerSession'

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
