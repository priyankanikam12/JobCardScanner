// "Dealer / Workshop Login" session storage - the local email+password sign-in path for
// dealer-level staff who don't have an Azure AD account (see backend
// Controllers/DealerAuthController.cs and Auth/AuthSchemes.DealerJwt). Kept as a small,
// dependency-free module (localStorage, not Zustand) so it slots into the existing
// axios-interceptor pattern already used for the customer portal in api/client.ts.

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

export function getDealerSession(): DealerSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DealerSession) : null
  } catch {
    return null
  }
}

export function getDealerToken(): string | null {
  return getDealerSession()?.accessToken ?? null
}

export function setDealerSession(session: DealerSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearDealerSession() {
  localStorage.removeItem(STORAGE_KEY)
}

/** Called right after changeMyPassword()/resetDealerPassword() succeeds, so the forced
 * /change-password redirect (see RequireStaff.tsx) stops firing without requiring a fresh
 * login. No-op if there's no dealer session (e.g. an Azure AD user, or already logged out). */
export function clearMustChangePassword() {
  const session = getDealerSession()
  if (session) setDealerSession({ ...session, mustChangePassword: false })
}