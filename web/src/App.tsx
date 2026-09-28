// web\src\App.tsx
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
// 2026-09-30 (SECTION 165, "create table this 3 master and link in sidebar manu this 3 master") -
// view-only pages for the 3 new masters built in SECTION 163 (Models/ServiceMenuMaster.cs,
// Models/ComplaintMaster.cs, Models/DocPrefixMaster.cs) - see each page's own doc comment.
import { ServiceMenuMasterPage } from './pages/staff/ServiceMenuMasterPage'
import { ComplaintMasterPage } from './pages/staff/ComplaintMasterPage'
import { DocPrefixMasterPage } from './pages/staff/DocPrefixMasterPage'
import { AdminUsersPage } from './pages/staff/AdminUsersPage'
import { EmployeesPage } from './pages/staff/EmployeesPage'
// 2026-09-24 "that supervisor when login then he have access to create Tecnician that tab name
// Technician Employee" - see TechnicianEmployeesPage.tsx's own doc comment.
import { TechnicianEmployeesPage } from './pages/staff/TechnicianEmployeesPage'
import { AdminWorkflowPage } from './pages/staff/AdminWorkflowPage'
// 2026-09-29 (SECTION 155, "for sidebar menu acces provide page make foe which role which menu
// wants to shown a every where") - new HQ-only admin page, same floor/route-guard convention as
// AdminUsersPage/AdminWorkflowPage just above. See MenuAccessPage.tsx's own doc comment and
// StaffLayout.tsx's NAV_ITEMS ("/admin/menu-access" entry, CorporateAdmin/SystemAdmin only) - the
// RequireRole roles list below matches that NAV_ITEMS entry exactly so a role that wouldn't even
// see the sidebar link can't reach the page by URL either.
import { MenuAccessPage } from './pages/admin/MenuAccessPage'
import { ReportsPage } from './pages/staff/ReportsPage'
import { PortalLoginPage } from './pages/portal/PortalLoginPage'
import { PortalMyJobCardsPage } from './pages/portal/PortalMyJobCardsPage'
import { PortalTrackPage } from './pages/portal/PortalTrackPage'
import { AttendancePage } from './pages/staff/AttendancePage'
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
      <Route
        path="/attendance"
        element={
          <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
            <AttendancePage />
          </RequireRole>
        }
      />
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
        {/* 2026-09-30 (SECTION 162, "real access lock" for Supervisor - Supervisor logins should
            ONLY be able to use Dashboard, Job Cards and Attendance, confirmed explicitly after
            flagging the difference between "hide the sidebar link" and "actually block the
            route"). Every route below except /dashboard, /jobcards* and /attendance now excludes
            Supervisor from its RequireRole list, and every route that previously had NO RequireRole
            at all (open to any signed-in staff) now gets one so Supervisor can't reach it by typing
            the URL directly either.

            ASSUMPTION FLAGGED: the "everyone except Supervisor" role lists below
            (['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'WorkshopManager', 'DealerAdmin',
            'CorporateAdmin', 'SystemAdmin']) are every StaffRole name that has actually appeared in
            this codebase this session (same list MenuAccessPage.tsx's own ALL_ROLES uses, and that
            file's doc comment carries the same caveat) - I don't have your real StaffRole enum/
            Models/User.cs in this session. If there's a role that hasn't appeared anywhere I've
            seen, these lists would silently exclude it too until you tell me its name.

            BACKEND NOTE: only MaterialTransferDocsController.cs and RepairBillDocsController.cs
            have had their actual [Authorize] policy narrowed to match (see Program.cs's new
            "ServiceAdvisorUpNoSupervisor"/"WorkshopManagerUpNoSupervisor" policies) - every other
            route below still has its ORIGINAL backend policy unchanged, because I don't have those
            controllers in this session (LabourMasterController, ItemMasterController/whatever backs
            Item Master, ServiceHistoryController, VehicleSaleController, PartsController,
            ReportsController, TechnicianEmployeesController, ExtendedBatteryWarrantySchemesController,
            OemModelsController, OemModelWarrantiesController). Until those are pasted and updated
            too, these frontend route guards stop normal in-app navigation and direct URL typing,
            but a Supervisor's existing token would still be ACCEPTED if the underlying API were
            called directly (Swagger/Postman/a modified client) - this is not yet a complete
            server-side lock for those pages. */}
        <Route
          path="/service-history"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <ServiceHistoryPage />
            </RequireRole>
          }
        />
        <Route
          path="/labour-master"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <LabourMasterPage />
            </RequireRole>
          }
        />
        <Route
          path="/vehicle-sale"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <VehicleSalePage />
            </RequireRole>
          }
        />
        <Route
          path="/parts"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <PartsPage />
            </RequireRole>
          }
        />
        {/* 2026-09-21 "Part Upload" tab - gated to match the backend's PartsUserUp/PartsReadUp
            policies (PartUploadController) exactly, same convention as the routes above.
            2026-09-30 (SECTION 162): Supervisor removed - matches PartsReadUp's own Supervisor
            removal in Program.cs this same section. */}
        <Route
          path="/part-upload"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <PartUploadPage />
            </RequireRole>
          }
        />
        {/* 2026-09-21 "Item Master" - gated the same as Parts & Inventory/Part Upload above (same
            pricing-data audience, matches ItemMasterController's ServiceAdvisorUp backend policy
            at the API level - narrower here in the UI to match its NAV_ITEMS role list).
            2026-09-30 (SECTION 162): Supervisor removed from the UI gate - backend ItemMasterController
            NOT updated yet, see this block's own top-level note. */}
        <Route
          path="/item-master"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <ItemMasterPage />
            </RequireRole>
          }
        />
        {/* 2026-09-19 "Create Repair Bill and Material Transfer Bill" - gated to match the
            backend's policy (RepairBillDocsController/MaterialTransferDocsController) exactly, same
            convention as Labour Master's RequireRole above. Placed before their read-only
            report-page siblings per "Repair Bill tab before Repair Bill Report and Material
            Transfer Bill before Material Transfer Report".
            2026-09-30 (SECTION 162): Supervisor removed - matches the backend's new
            "ServiceAdvisorUpNoSupervisor" policy exactly (see Program.cs/MaterialTransferDocsController.cs
            this same section - this is one of the two routes whose backend is ALSO actually locked
            down, not just the frontend). */}
        <Route
          path="/material-transfer-bill"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <MaterialTransferCreatePage />
            </RequireRole>
          }
        />
        {/* 2026-09-23 - new list page for JobCardScanner's own saved Material Transfers (Draft/
            Confirmed/Cancelled), split out of MaterialTransferCreatePage above - same role gate,
            since it's reached from that same create/edit flow. 2026-09-30 (SECTION 162): Supervisor
            removed to match. */}
        <Route
          path="/material-transfer-list"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <MaterialTransferListPage />
            </RequireRole>
          }
        />
        <Route
          path="/material-transfer"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <MaterialTransferPage />
            </RequireRole>
          }
        />
        {/* 2026-09-30 (SECTION 162): Supervisor removed - matches the backend's new
            "ServiceAdvisorUpNoSupervisor" policy exactly (RepairBillDocsController.cs, this same
            section - the other of the two routes whose backend is actually locked down). */}
        <Route
          path="/repair-bill-new"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <RepairBillCreatePage />
            </RequireRole>
          }
        />
        {/* 2026-09-23 - new list page for JobCardScanner's own saved Repair Bills (Performa/Billed),
            split out of RepairBillCreatePage above - same role gate, since it's reached from that
            same create/edit flow. 2026-09-30 (SECTION 162): Supervisor removed to match. */}
        <Route
          path="/repair-bill-list"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <RepairBillListPage />
            </RequireRole>
          }
        />
        <Route
          path="/repair-bill"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <RepairBillPage />
            </RequireRole>
          }
        />
        {/* 2026-09-22 "needs to create warenty table in jobcardscanner db for this functionality
            and add this in our function" - gated to match the backend's WorkshopManagerUp policy
            (ExtendedBatteryWarrantySchemesController) exactly, same convention as Labour Master.
            2026-09-30 (SECTION 162): Supervisor removed from the UI gate - backend NOT updated yet
            (don't have ExtendedBatteryWarrantySchemesController.cs this session). */}
        <Route
          path="/battery-warranty-schemes"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <ExtendedBatteryWarrantySchemesPage />
            </RequireRole>
          }
        />
        {/* 2026-09-22 - global masters (not dealer-scoped, see OemModelsController's own doc
            comment): List/Get is WorkshopManagerUp so any dealer's staff can browse the catalog
            when linking a scheme; Create/Update/Delete are additionally CorporateAdminUp-gated
            server-side (stacked [Authorize]), not duplicated as a stricter client-side route gate
            here since ICurrentUserService.Role isn't exposed to route guards today - see
            OemModelsPage.tsx's own doc comment. 2026-09-30 (SECTION 162): Supervisor removed from
            the UI gate - backend NOT updated yet (don't have OemModelsController.cs/
            OemModelWarrantiesController.cs this session). */}
        <Route
          path="/oem-models"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <OemModelsPage />
            </RequireRole>
          }
        />
        <Route
          path="/oem-model-warranties"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <OemModelWarrantiesPage />
            </RequireRole>
          }
        />
        {/* 2026-09-30 (SECTION 165) - Service Menu Master / Complaint Master: same WorkshopManagerUp
            floor as the other master-data pages above (Labour Master, Item Master, OEM Model
            Master) - view-only pages, see each one's own doc comment. */}
        <Route
          path="/service-menu-master"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <ServiceMenuMasterPage />
            </RequireRole>
          }
        />
        <Route
          path="/complaint-master"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <ComplaintMasterPage />
            </RequireRole>
          }
        />
        {/* 2026-09-30 (SECTION 165) - Prefix Master: HQ-only, same floor as Admin: Users/Admin:
            Menu Access - document-numbering config is more sensitive than the two view-only
            catalogs above. */}
        <Route
          path="/prefix-master"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <DocPrefixMasterPage />
            </RequireRole>
          }
        />
        <Route
          path="/reports"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <ReportsPage />
            </RequireRole>
          }
        />
        <Route
          path="/employees"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <EmployeesPage />
            </RequireRole>
          }
        />
        {/* 2026-09-24 - gated to Supervisor and up, matching the explicit request ("that
            supervisor when login then he have access to create Tecnician that tab name
            Technician Employee") - a plain WorkshopManager does NOT get this tab, even though it
            shares Supervisor's other ServiceAdvisorUp/WorkshopManagerUp access (see
            StaffRole.Supervisor's backend doc comment).
            2026-09-30 (SECTION 162): Supervisor REMOVED - this route's entire reason to exist
            (give Supervisor this one WorkshopManager-doesn't-have extra) is now moot since
            Supervisor is locked out of it entirely; narrowed to DealerAdmin and up only. FLAG: this
            makes the route's role list identical to /employees above - the backend SupervisorUp
            policy this presumably maps to (I don't have TechnicianEmployeesController.cs to
            confirm) has the same doc-comment flag in Program.cs this section; paste that
            controller and I'll finish this cleanly. */}
        <Route
          path="/technician-employees"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
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
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <AdminWorkflowPage />
            </RequireRole>
          }
        />
        {/* 2026-09-29 (SECTION 155/156) - "Admin: Menu Access", same CorporateAdmin/SystemAdmin
            floor as Admin: Users/Admin: Workflow directly above (matches StaffLayout.tsx's
            NAV_ITEMS entry for this route exactly). */}
        <Route
          path="/admin/menu-access"
          element={
            <RequireRole roles={['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']}>
              <MenuAccessPage />
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
