import { Navigate, Route, Routes } from 'react-router-dom'
import { StaffLayout } from './components/StaffLayout'
import { RequireStaff } from './components/RequireStaff'
import { RequireRole } from './components/RequireRole'
import { LoginPage } from './pages/staff/LoginPage'
import { ForceChangePasswordPage } from './pages/staff/ForceChangePasswordPage'
import { DashboardPage } from './pages/staff/DashboardPage'
import { JobCardsListPage } from './pages/staff/JobCardsListPage'
import { JobCardWizardPage } from './pages/staff/JobCardWizardPage'
import { JobCardDetailPage } from './pages/staff/JobCardDetailPage'
import { PartsPage } from './pages/staff/PartsPage'
import { AdminUsersPage } from './pages/staff/AdminUsersPage'
import { AdminWorkflowPage } from './pages/staff/AdminWorkflowPage'
import { ReportsPage } from './pages/staff/ReportsPage'
import { PortalLoginPage } from './pages/portal/PortalLoginPage'
import { PortalMyJobCardsPage } from './pages/portal/PortalMyJobCardsPage'
import { PortalTrackPage } from './pages/portal/PortalTrackPage'

export default function App() {
  return (
    <Routes>
      {/* Staff app (Azure AD) */}
      <Route path="/login" element={<LoginPage />} />
      {/* Outside StaffLayout on purpose - no sidebar to navigate away with while a password
          change is still required. RequireStaff redirects here itself (see its mustChangePassword
          check) whenever the signed-in dealer session still needs one. */}
      <Route
        path="/change-password"
        element={
          <RequireStaff>
            <ForceChangePasswordPage />
          </RequireStaff>
        }
      />
      <Route
        element={
          <RequireStaff>
            <StaffLayout />
          </RequireStaff>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/jobcards" element={<JobCardsListPage />} />
        <Route path="/jobcards/new" element={<JobCardWizardPage />} />
        <Route path="/jobcards/:id" element={<JobCardDetailPage />} />
        <Route path="/parts" element={<PartsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route
          path="/admin/users"
          element={
            <RequireRole roles={['CorporateAdmin', 'SystemAdmin']}>
              <AdminUsersPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/workflow"
          element={
            <RequireRole roles={['CorporateAdmin', 'SystemAdmin']}>
              <AdminWorkflowPage />
            </RequireRole>
          }
        />
      </Route>

      {/* Customer tracking portal (mobile + OTP, no Azure AD) */}
      <Route path="/portal/login" element={<PortalLoginPage />} />
      <Route path="/portal/jobcards" element={<PortalMyJobCardsPage />} />
      <Route path="/track/:token" element={<PortalTrackPage />} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
