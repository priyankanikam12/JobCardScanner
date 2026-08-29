import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useStaffAuth } from '../auth/StaffAuthContext'
import type { StaffRole } from '../types'

/**
 * Route-level companion to StaffLayout's role-filtered sidebar links: a link that's hidden for a
 * role (e.g. "Admin: Users"/"Admin: Workflow" now only showing for CorporateAdmin/SystemAdmin)
 * is only a real restriction if typing the URL directly is blocked too - otherwise it's just
 * cosmetic. Sits inside RequireStaff (so auth/loading/mustChangePassword are already handled) and
 * simply bounces anyone whose role isn't in the allowed list back to the dashboard.
 */
export function RequireRole({ roles, children }: { roles: StaffRole[]; children: ReactNode }) {
  const { hasRole, profile } = useStaffAuth()
  if (!profile) return null // RequireStaff is still loading the profile - render nothing briefly rather than a false redirect
  if (!hasRole(...roles)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
