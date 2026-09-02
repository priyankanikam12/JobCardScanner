// API calls for the "Dealer / Workshop Login" tab - see backend Controllers/DealerAuthController.cs
// and web/src/services/dealerAuthService.ts (this mirrors it, adapted for async SecureStore
// instead of synchronous localStorage). Login/forgot-password/reset-password are anonymous
// endpoints, so they work the same whether or not a token is currently cached.
import { apiClient, setDealerToken } from '../api/client'
import { setDealerSession, clearDealerSession, type DealerSession } from '../auth/dealerSession'

export interface DealerLoginResult extends DealerSession {}

export async function dealerLogin(email: string, password: string): Promise<DealerLoginResult> {
  const { data } = await apiClient.post<DealerLoginResult>('/api/dealer-auth/login', { email, password })
  await setDealerSession(data)
  setDealerToken(data.accessToken)
  return data
}

export async function dealerLogout(): Promise<void> {
  await clearDealerSession()
  setDealerToken(null)
}

export async function forgotDealerPassword(email: string): Promise<{ message: string; devResetToken?: string }> {
  const { data } = await apiClient.post('/api/dealer-auth/forgot-password', { email })
  return data
}

export async function resetDealerPassword(email: string, token: string, newPassword: string): Promise<{ message: string }> {
  const { data } = await apiClient.post('/api/dealer-auth/reset-password', { email, token, newPassword })
  return data
}

/** Signed-in dealer/workshop user changing their own password (also clears mustChangePassword
 * server-side). Goes through apiClient - by the time this is called, setDealerToken() from
 * dealerLogin() above has already made apiClient attach the right bearer token. */
export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  const { data } = await apiClient.patch('/api/dealer-auth/change-password', { currentPassword, newPassword })
  return data
}
