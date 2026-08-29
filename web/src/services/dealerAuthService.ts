// API calls for the "Dealer / Workshop Login" tab - see backend Controllers/DealerAuthController.cs.
// Uses a bare axios call (not `staffApi`) for login/forgot/reset because those three endpoints
// are anonymous and must run *before* a session/token exists; everything after login goes back
// through `staffApi`, whose interceptor (api/client.ts) already knows to prefer a dealer session
// token over an MSAL one when both could apply.
import axios from 'axios'
import { staffApi } from '../api/client'
import { setDealerSession, clearDealerSession, type DealerSession } from '../auth/dealerSession'

const baseURL = import.meta.env.VITE_API_BASE_URL

export interface DealerLoginResult extends DealerSession {}

export async function dealerLogin(email: string, password: string): Promise<DealerLoginResult> {
  const { data } = await axios.post<DealerLoginResult>(`${baseURL}/api/dealer-auth/login`, { email, password })
  setDealerSession(data)
  return data
}

export function dealerLogout() {
  clearDealerSession()
}

export async function forgotDealerPassword(email: string): Promise<{ message: string; devResetToken?: string }> {
  const { data } = await axios.post(`${baseURL}/api/dealer-auth/forgot-password`, { email })
  return data
}

export async function resetDealerPassword(email: string, token: string, newPassword: string): Promise<{ message: string }> {
  const { data } = await axios.post(`${baseURL}/api/dealer-auth/reset-password`, { email, token, newPassword })
  return data
}

/** Signed-in dealer/workshop user changing their own password (also clears MustChangePassword). */
export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  const { data } = await staffApi.patch('/api/dealer-auth/change-password', { currentPassword, newPassword })
  return data
}

/** Dealer/Corporate/System Admin resetting another local user's password. */
export async function adminResetDealerPassword(userId: string, newPassword: string): Promise<{ message: string }> {
  const { data } = await staffApi.post(`/api/dealer-auth/${userId}/admin-reset-password`, { newPassword })
  return data
}
