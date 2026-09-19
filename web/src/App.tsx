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
import { BaplJobCardDetailPage } from './pages/staff/BaplJobCardDetailPage'
import { PartsPage } from './pages/staff/PartsPage'
import { ServiceHistoryPage } from './pages/staff/ServiceHistoryPage'
import { LabourMasterPage } from './pages/staff/LabourMasterPage'
import { VehicleSalePage } from './pages/staff/VehicleSalePage'
import { MaterialTransferPage } from './pages/staff/MaterialTransferPage'
import { RepairBillPage } from './pages/staff/RepairBillPage'
import { AdminUsersPage } from './pages/staff/AdminUsersPage'
import { EmployeesPage } from './pages/staff/EmployeesPage'
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
        {/* Read-only view for a DMS-sourced row on the /jobcards list - see
            JobCardsListPage.tsx and BaplJobCardDetailPage.tsx's doc comment. A distinct 2-segment
            path, so it never collides with /jobcards/:id above (React Router matches by segment
            count/specificity, not just prefix). */}
        <Route path="/jobcards/bapl/:jobCardHeaderId" element={<BaplJobCardDetailPage />} />
        <Route path="/service-history" element={<ServiceHistoryPage />} />
        {/* 2026-09-19 "Labour Master" - gated to match the backend's WorkshopManagerUp policy
            (LabourMasterController) exactly, so a role that would get a 403 from the API never
            even sees the page render. */}
        <Route
          path="/labour-master"
          element={
            <RequireRole roles={['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <LabourMasterPage />
            </RequireRole>
          }
        />
        <Route path="/vehicle-sale" element={<VehicleSalePage />} />
        <Route path="/parts" element={<PartsPage />} />
        <Route path="/material-transfer" element={<MaterialTransferPage />} />
        <Route path="/repair-bill" element={<RepairBillPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route
          path="/employees"
          element={
            <RequireRole roles={['DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <EmployeesPage />
            </RequireRole>
          }
        />
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
