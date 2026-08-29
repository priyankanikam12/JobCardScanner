import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { staffApi } from '../api/client'
import { getDealerSession } from './dealerSession'
import type { CurrentUser, StaffRole } from '../types'

interface StaffAuthValue {
  /** True if EITHER an Azure AD (MSAL) account OR a local Dealer/Workshop session is present. */
  isAuthenticated: boolean
  /** Which sign-in path is active - used by StaffLayout to sign out through the right flow. */
  authMode: 'azureAd' | 'dealer' | null
  /** True only for a Dealer/Workshop (local) session still on its first-login/admin-reset
   * password - RequireStaff redirects to /change-password until this clears. Azure AD staff
   * never carry this (Azure AD owns their credential, not us). */
  mustChangePassword: boolean
  profile: CurrentUser | null
  loading: boolean
  error: string | null
  hasRole: (...roles: StaffRole[]) => boolean
  refresh: () => Promise<void>
}

const ROLE_RANK: Record<StaffRole, number> = {
  ServiceAdvisor: 1,
  Technician: 1,
  PartsUser: 1,
  Cashier: 1,
  WorkshopManager: 2,
  DealerAdmin: 3,
  CorporateAdmin: 4,
  SystemAdmin: 5,
}

const StaffAuthContext = createContext<StaffAuthValue | undefined>(undefined)

export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const isMsalAuthenticated = useIsAuthenticated()
  const { accounts } = useMsal()
  const [hasDealerSession, setHasDealerSession] = useState(() => !!getDealerSession())
  const [mustChangePassword, setMustChangePassword] = useState(() => !!getDealerSession()?.mustChangePassword)
  const isAuthenticated = isMsalAuthenticated || hasDealerSession
  const authMode: StaffAuthValue['authMode'] = hasDealerSession ? 'dealer' : isMsalAuthenticated ? 'azureAd' : null
  const [profile, setProfile] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    // Re-check the dealer session synchronously each time load() runs (e.g. right after
    // dealerLogin() writes it to localStorage but before this component re-renders).
    const session = getDealerSession()
    const dealerSessionNow = !!session
    setHasDealerSession(dealerSessionNow)
    setMustChangePassword(!!session?.mustChangePassword)

    if (!isMsalAuthenticated && !dealerSessionNow) {
      setProfile(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data } = await staffApi.get<CurrentUser>('/api/auth/me')
      setProfile(data)
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not load your JobCardScanner profile. Contact your admin.'
      setError(message)
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMsalAuthenticated, accounts.length])

  const hasRole = (...roles: StaffRole[]) => {
    if (!profile) return false
    if (roles.includes(profile.role)) return true
    // "Up" semantics: DealerAdmin/CorporateAdmin/SystemAdmin can act as any lower role in their scope
    return roles.some((r) => ROLE_RANK[profile.role] >= 3 && ROLE_RANK[r] <= ROLE_RANK[profile.role])
  }

  return (
    <StaffAuthContext.Provider value={{ isAuthenticated, authMode, mustChangePassword, profile, loading, error, hasRole, refresh: load }}>
      {children}
    </StaffAuthContext.Provider>
  )
}

export function useStaffAuth() {
  const ctx = useContext(StaffAuthContext)
  if (!ctx) throw new Error('useStaffAuth must be used within StaffAuthProvider')
  return ctx
}