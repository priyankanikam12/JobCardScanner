import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth as useAzureAuth } from './AuthContext'
import { getDealerSession, type DealerSession } from './dealerSession'
import { dealerLogout } from '../services/dealerAuthService'
import { setDealerToken } from '../api/client'
import type { CurrentUser, StaffRole } from '../types'

/**
 * Unified staff auth - mirrors web/src/auth/StaffAuthContext.tsx. Staff have two independent
 * sign-in paths on mobile too (see LoginScreen's Dealer/Workshop vs Staff Microsoft tabs): Azure
 * AD (owned entirely by AuthContext.tsx / expo-auth-session) and a local Dealer/Workshop JWT
 * session (owned by dealerSession.ts). This context layers over both so every other screen can
 * just ask "am I signed in, as who, with which role" without caring which path was used - same as
 * the web app's staffApi interceptor not caring which bearer token it's attaching.
 */

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

interface StaffAuthValue {
  /** True if EITHER an Azure AD account OR a local Dealer/Workshop session is present. */
  isAuthenticated: boolean
  /** Which sign-in path is active - used when signing out, to go through the right flow. */
  authMode: 'azureAd' | 'dealer' | null
  /** True only for a Dealer/Workshop (local) session still on its first-login/admin-reset
   * password - RootNavigator redirects to ForceChangePasswordScreen until this clears. Azure AD
   * staff never carry this (Azure AD owns their credential, not us). */
  mustChangePassword: boolean
  profile: CurrentUser | null
  loading: boolean
  error: string | null
  hasRole: (...roles: StaffRole[]) => boolean
  /** Re-checks the local Dealer session (e.g. right after dealerLogin() writes one, or after
   * changeMyPassword() clears mustChangePassword) - the Azure AD side refreshes itself via
   * AuthContext's own effects, so this only ever needs to touch the dealer half. */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const StaffAuthContext = createContext<StaffAuthValue | undefined>(undefined)

function dealerUserToProfile(session: DealerSession): CurrentUser {
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role as StaffRole,
    dealerId: session.user.dealerId ?? null,
    dealerName: session.user.dealerName ?? null,
  }
}

export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const azure = useAzureAuth()
  const [dealerSession, setDealerSessionState] = useState<DealerSession | null>(null)
  const [dealerChecked, setDealerChecked] = useState(false)

  const loadDealerSession = async () => {
    const session = await getDealerSession()
    setDealerSessionState(session)
    // Keep api/client.ts's cached dealer token in sync on every (re)check - covers both app
    // startup (a session saved from a previous run) and right after a fresh dealerLogin().
    setDealerToken(session?.accessToken ?? null)
    setDealerChecked(true)
  }

  useEffect(() => {
    loadDealerSession()
  }, [])

  const authMode: StaffAuthValue['authMode'] = dealerSession ? 'dealer' : azure.profile ? 'azureAd' : null
  const isAuthenticated = !!dealerSession || !!azure.profile
  const mustChangePassword = !!dealerSession?.mustChangePassword
  const profile: CurrentUser | null = dealerSession ? dealerUserToProfile(dealerSession) : azure.profile
  // Only block on the Azure AD side's own loading state while there's no dealer session already
  // resolved - otherwise a signed-in dealer would see an endless spinner every time AuthContext
  // re-checks its (irrelevant, for this user) stored MSAL tokens.
  const loading = !dealerChecked || (!dealerSession && azure.loading)

  const hasRole = (...roles: StaffRole[]) => {
    if (!profile) return false
    if (roles.includes(profile.role)) return true
    // "Up" semantics: DealerAdmin/CorporateAdmin/SystemAdmin can act as any lower role in their scope.
    return roles.some((r) => ROLE_RANK[profile.role] >= 3 && ROLE_RANK[r] <= ROLE_RANK[profile.role])
  }

  const signOut = async () => {
    if (dealerSession) {
      await dealerLogout()
      setDealerSessionState(null)
    } else {
      await azure.signOut()
    }
  }

  return (
    <StaffAuthContext.Provider
      value={{ isAuthenticated, authMode, mustChangePassword, profile, loading, error: azure.error, hasRole, refresh: loadDealerSession, signOut }}
    >
      {children}
    </StaffAuthContext.Provider>
  )
}

export function useStaffAuth() {
  const ctx = useContext(StaffAuthContext)
  if (!ctx) throw new Error('useStaffAuth must be used within StaffAuthProvider')
  return ctx
}
