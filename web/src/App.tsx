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
// 2026-09-23 ("this main in 1 page not on same only which are save in jobcard db that in grid
// button"): the combined Repair Bill list (own JobCardScanner rows only) split out of
// RepairBillCreatePage onto its own page/route - see RepairBillListPage.tsx's own doc comment.
import { RepairBillListPage } from './pages/staff/RepairBillListPage'
import { MaterialTransferCreatePage } from './pages/staff/MaterialTransferCreatePage'
// 2026-09-23 ("in repairbill which we added button like this add in material transfer for showing
// which we transferred"): the combined Material Transfer list split out of
// MaterialTransferCreatePage onto its own page/route - see MaterialTransferListPage.tsx's own doc
// comment, mirroring RepairBillListPage.tsx's identical split above.
import { MaterialTransferListPage } from './pages/staff/MaterialTransferListPage'
// 2026-09-22 "needs to create warenty table in jobcardscanner db for this functionality and add
// this in our function" - admin CRUD page for the new Extended Battery Warranty Scheme master.
import { ExtendedBatteryWarrantySchemesPage } from './pages/staff/ExtendedBatteryWarrantySchemesPage'
// 2026-09-22 "this all table add in jobcard db that all functionality need to craete in jc" -
// admin CRUD pages for the new global OEM Model Master / OEM Model Warranty masters.
import { OemModelsPage } from './pages/staff/OemModelsPage'
import { OemModelWarrantiesPage } from './pages/staff/OemModelWarrantiesPage'
import { AdminUsersPage } from './pages/staff/AdminUsersPage'
import { EmployeesPage } from './pages/staff/EmployeesPage'
// 2026-09-24 "that supervisor when login then he have access to create Tecnician that tab name
// Technician Employee" - see TechnicianEmployeesPage.tsx's own doc comment.
import { TechnicianEmployeesPage } from './pages/staff/TechnicianEmployeesPage'
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
            <RequireRole roles={['WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
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
            <RequireRole roles={['PartsUser', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
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
            <RequireRole roles={['PartsUser', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
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
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <MaterialTransferCreatePage />
            </RequireRole>
          }
        />
        {/* 2026-09-23 - new list page for JobCardScanner's own saved Material Transfers (Draft/
            Confirmed/Cancelled), split out of MaterialTransferCreatePage above - same role gate,
            since it's reached from that same create/edit flow. */}
        <Route
          path="/material-transfer-list"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <MaterialTransferListPage />
            </RequireRole>
          }
        />
        <Route path="/material-transfer" element={<MaterialTransferPage />} />
        <Route
          path="/repair-bill-new"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <RepairBillCreatePage />
            </RequireRole>
          }
        />
        {/* 2026-09-23 - new list page for JobCardScanner's own saved Repair Bills (Performa/Billed),
            split out of RepairBillCreatePage above - same role gate, since it's reached from that
            same create/edit flow. */}
        <Route
          path="/repair-bill-list"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <RepairBillListPage />
            </RequireRole>
          }
        />
        <Route path="/repair-bill" element={<RepairBillPage />} />
        {/* 2026-09-22 "needs to create warenty table in jobcardscanner db for this functionality
            and add this in our function" - gated to match the backend's WorkshopManagerUp policy
            (ExtendedBatteryWarrantySchemesController) exactly, same convention as Labour Master. */}
        <Route
          path="/battery-warranty-schemes"
          element={
            <RequireRole roles={['WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <ExtendedBatteryWarrantySchemesPage />
            </RequireRole>
          }
        />
        {/* 2026-09-22 - global masters (not dealer-scoped, see OemModelsController's own doc
            comment): List/Get is WorkshopManagerUp so any dealer's staff can browse the catalog
            when linking a scheme; Create/Update/Delete are additionally CorporateAdminUp-gated
            server-side (stacked [Authorize]), not duplicated as a stricter client-side route gate
            here since ICurrentUserService.Role isn't exposed to route guards today - see
            OemModelsPage.tsx's own doc comment. */}
        <Route
          path="/oem-models"
          element={
            <RequireRole roles={['WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <OemModelsPage />
            </RequireRole>
          }
        />
        <Route
          path="/oem-model-warranties"
          element={
            <RequireRole roles={['WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <OemModelWarrantiesPage />
            </RequireRole>
          }
        />
        <Route path="/reports" element={<ReportsPage />} />
        <Route
          path="/employees"
          element={
            <RequireRole roles={['DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <EmployeesPage />
            </RequireRole>
          }
        />
        {/* 2026-09-24 - gated to Supervisor and up, matching the explicit request ("that
            supervisor when login then he have access to create Tecnician that tab name
            Technician Employee") - a plain WorkshopManager does NOT get this tab, even though it
            shares Supervisor's other ServiceAdvisorUp/WorkshopManagerUp access (see
            StaffRole.Supervisor's backend doc comment). */}
        <Route
          path="/technician-employees"
          element={
            <RequireRole roles={['Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']}>
              <TechnicianEmployeesPage />
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
