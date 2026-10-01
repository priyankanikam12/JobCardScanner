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
  // 2026-09-24: Supervisor is a new, distinct StaffRole (see backend Models/MasterData.cs) that
  // keeps the same ServiceAdvisorUp/WorkshopManagerUp floor WorkshopManager already had, PLUS
  // exclusive access to the new Technician Employee tab that WorkshopManager does not get (gated
  // separately - see TechniciansController's SupervisorUp-only write actions, not by ROLE_RANK
  // here). Same rank as WorkshopManager for every "up" check below.
  Supervisor: 2,
  DealerAdmin: 3,
  CorporateAdmin: 4,
  SystemAdmin: 5,
  // 2026-10-01 (TS2739, "Record<StaffRole, number>" missing Captain/ViceCaptain - the web
  // StaffRole TypeScript type gained these two Designation-driven pseudo-roles earlier this
  // session, so this Record literal has to cover them too or it won't compile).
  //
  // ASSUMPTION, flagged - this is a conservative placeholder, not a confirmed business decision:
  // rank 1, the SAME tier as ServiceAdvisor/Technician/PartsUser/Cashier. Deliberately NOT >= 3 -
  // only ranks 3+ get the "Up" semantics below (hasRole() lets DealerAdmin/CorporateAdmin/
  // SystemAdmin act as any lower role in their scope) - guessing a higher rank here could
  // silently hand Captain/ViceCaptain admin-tier "act as any lower role" access with no actual
  // policy decision behind it, which would be a real security mistake if wrong. FACT (confirmed
  // via UsersController.cs's RoleForDesignation, pasted earlier this session): Captain/ViceCaptain
  // have NO defined real backend Role or Auth/Policies.cs policy of their own at all today - their
  // actual server-side permissions ride entirely on whatever (arbitrary, leftover) real Role they
  // happen to carry, completely separate from this ROLE_RANK entry. This value only affects
  // frontend-side hasRole()/"Up" checks that compare against the STRING 'Captain'/'ViceCaptain'
  // directly (there are none yet, since nothing in this codebase currently does that) - it does
  // NOT retroactively give Captain/ViceCaptain any new real access anywhere. Tell me the intended
  // rank once the bigger Designation->Role/policy decision (still open, see UsersController.cs/
  // Auth/Policies.cs discussion) is made, and I'll update this to match.
  Captain: 1,
  ViceCaptain: 1,
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
