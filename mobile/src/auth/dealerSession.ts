// "Dealer / Workshop Login" session storage - the local email+password sign-in path for
// dealer-level staff who don't have an Azure AD account (see backend
// Controllers/DealerAuthController.cs and Auth/AuthSchemes.DealerJwt). Mirrors
// web/src/auth/dealerSession.ts field-for-field; the one real difference is that
// expo-secure-store's API is async (unlike web's synchronous localStorage), so every function
// here returns a Promise - callers (StaffAuthContext, dealerAuthService) already account for that.
import * as SecureStore from 'expo-secure-store'

export interface DealerUser {
  id: string
  name: string
  email: string
  mobile?: string | null
  role: string
  dealerId?: string | null
  dealerName?: string | null
  avatarColor?: string | null
}

export interface DealerSession {
  accessToken: string
  mustChangePassword: boolean
  user: DealerUser
}

const STORAGE_KEY = 'jobcardscanner.dealerSession'

export async function getDealerSession(): Promise<DealerSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DealerSession) : null
  } catch {
    return null
  }
}

export async function setDealerSession(session: DealerSession): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(session))
}

export async function clearDealerSession(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY)
}

/** Called right after changeMyPassword() succeeds, so the forced ForceChangePasswordScreen
 * redirect (see RootNavigator) stops firing without requiring a fresh login. No-op if there's no
 * dealer session (e.g. an Azure AD user, or already logged out). */
export async function clearMustChangePassword(): Promise<void> {
  const session = await getDealerSession()
  if (session) await setDealerSession({ ...session, mustChangePassword: false })
}
