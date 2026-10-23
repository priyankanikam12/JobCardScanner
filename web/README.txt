Web list pages - sorting, 10-per-page paging, search and a tidier toolbar (23.10.2026). Copy over your web project (paths relative to web\), then npm run build.

  src\pages\staff\TechnicianEmployeesPage.tsx   CHANGED
  src\pages\staff\EmployeesPage.tsx             CHANGED   (Dealer Employees)
  src\pages\staff\ComplaintMasterPage.tsx       CHANGED
  src\pages\staff\ServiceMenuMasterPage.tsx     CHANGED
  src\pages\staff\DocPrefixMasterPage.tsx       CHANGED   (Prefix Master - not in your paste, same pattern as the other two masters)
  src\components\TableControls.tsx              CHANGED   supersedes the earlier copies (Admin: Users / Menu Access); adds TablePager and StatusBadge
  src\components\table-controls.css             CHANGED   supersedes the earlier copies; adds the toolbar bits
  src\components\Pagination.tsx                 same as the Admin: Users update (optional pageSizeOptions prop)

On every table: click a column header to sort (click again to reverse; empty cells last), 10 rows per page (10 / 25 / 50 / 100), and one search box that matches ALL columns (several words = all must match).
The search box, the filters (Location, Job Type, Module, Status, Show inactive) and the row count now sit in ONE flex row of normal-width controls (they were loose grids / long buttons); status shows as a badge.
Nothing else changed: every add / edit / deactivate / delete / bulk-import function is as before. Technician: Location and Show inactive still ask the server. Dealer Employees: Work Area sorts by the number of locations
and is searched by location name; the "view saved data" row still works. Complaint Master: Status is now a switch (Active / Deactivated / All).

Checked: tsc 0 errors, production build OK, 9 tests in a simulated browser (the five pages: 10 per page, sorting, search, filters, toolbar row, server calls).
NOT checked: how it LOOKS in a real browser (no screenshot available).
NOT done: other list pages without sorting - JobCardsListPage, PartsPage, AttendancePage, DealerRoleReportPage, AdminWorkflowPage - and pages that have paging but no sorting (Item Master, Part Upload, Labour Master, Vehicle Sale, Material Transfer, Repair Bill, OEM pages). Tell me which come next.
