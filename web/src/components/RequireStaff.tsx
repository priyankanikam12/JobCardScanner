import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useMsal } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import { useStaffAuth } from '../auth/StaffAuthContext'

export function RequireStaff({ children }: { children: ReactNode }) {
  // isAuthenticated here covers BOTH sign-in paths - Azure AD (MSAL) and the local
  // "Dealer / Workshop Login" session - see StaffAuthContext.
  const { isAuthenticated, mustChangePassword, profile, loading, error } = useStaffAuth()
  const { inProgress } = useMsal()
  const location = useLocation()

  // The redirect URI is the site root ("/"), which this component guards. Right after
  // "Continue with Microsoft" sends the browser back here, MSAL still needs to run
  // handleRedirectPromise() (async) to read the auth response out of the URL - during that
  // brief window isAuthenticated is still false. Redirecting to /login before that finishes
  // would rewrite the URL and destroy the auth response before MSAL ever reads it, which
  // looks exactly like "sign-in loops back to /login". So: wait for MSAL to settle first.
  if (inProgress !== InteractionStatus.None) {
    return (
      <div className="center-screen">
        <p className="muted">Signing you in…</p>
      </div>
    )
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />

  // Every dealer login created by Admin -> Users' bulk ERP import (or reset by an admin) starts
  // on the same shared default password - force it to be replaced with something only the
  // dealer knows before letting them anywhere else in the app. Reading straight from the local
  // dealer session (not a server round trip), so this fires instantly, no loading state needed.
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  if (loading && !profile) {
    return (
      <div className="center-screen">
        <p className="muted">Loading your profile...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="center-screen">
        <div className="login-card">
          <h2>Access not set up yet</h2>
          <p className="muted">{error}</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
