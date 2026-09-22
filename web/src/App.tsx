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
import { PartUploadPage } from './pages/staff/PartUploadPage'
import { ItemMasterPage } from './pages/staff/ItemMasterPage'
import { ServiceHistoryPage } from './pages/staff/ServiceHistoryPage'
import { LabourMasterPage } from './pages/staff/LabourMasterPage'
import { VehicleSalePage } from './pages/staff/VehicleSalePage'
import { MaterialTransferPage } from './pages/staff/MaterialTransferPage'
import { RepairBillPage } from './pages/staff/RepairBillPage'
// 2026-09-19 "now i want Create Repair Bill and Material Transfer Bill" - NEW create pages, saved
// into JobCardScannerDb (see their own doc comments). Distinct from RepairBillPage/
// MaterialTransferPage above (the existing read-only DMSBAPLDATA report pages), which are
// unchanged.
import { RepairBillCreatePage } from './pages/staff/RepairBillCreatePage'
import { MaterialTransferCreatePage } from './pages/staff/MaterialTransferCreatePage'
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
        {/* 2026-09-21 "Part Upload" tab - gated to match the backend's PartsUserUp policy
            (PartUploadController) exactly, same convention as the routes above. */}
        <Route
          path="/part-upload"
          element={
            <RequireRole roles={['PartsUser', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <PartUploadPage />
            </RequireRole>
          }
        />
        {/* 2026-09-21 "Item Master" - gated the same as Parts & Inventory/Part Upload above (same
            pricing-data audience, matches ItemMasterController's ServiceAdvisorUp backend policy
            at the API level - narrower here in the UI to match its NAV_ITEMS role list). */}
        <Route
          path="/item-master"
          element={
            <RequireRole roles={['PartsUser', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <ItemMasterPage />
            </RequireRole>
          }
        />
        {/* 2026-09-19 "Create Repair Bill and Material Transfer Bill" - gated to match the
            backend's ServiceAdvisorUp policy (RepairBillDocsController/MaterialTransferDocsController)
            exactly, same convention as Labour Master's RequireRole above. Placed before their
            read-only report-page siblings per "Repair Bill tab before Repair Bill Report and
            Material Transfer Bill before Material Transfer Report". */}
        <Route
          path="/material-transfer-bill"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <MaterialTransferCreatePage />
            </RequireRole>
          }
        />
        <Route path="/material-transfer" element={<MaterialTransferPage />} />
        <Route
          path="/repair-bill-new"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <RepairBillCreatePage />
            </RequireRole>
          }
        />
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
