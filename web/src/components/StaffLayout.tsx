// web\src\components\StaffLayout.tsx
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMsal } from '@azure/msal-react'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { dealerLogout } from '../services/dealerAuthService'
import { staffApi } from '../api/client'
import type { StaffRole } from '../types'
// 2026-09-18 "in place of JobCardScanner i want add web\src\assets\BGauss_Logo.png": this file lives
// at src/components/StaffLayout.tsx, one level up from src/ - so the correct relative path is
// '../assets/...', NOT '../../assets/...' (that extra '../' is what broke the earlier attempt: from
// this file, two levels up lands outside src/ entirely, at web/assets/, which doesn't exist -
// LoginPage.tsx/ForceChangePasswordPage.tsx use '../../assets/...' correctly because THEY live one
// directory deeper, at src/pages/staff/).
import bgaussLogo from '../assets/BGauss_Logo.png'

// Exported (2026-09-18 "in dashboardpage add this all page landing page linking") so
// DashboardPage.tsx's "All Pages" quick-links grid can reuse this SAME list/role-gating instead of
// keeping a second, easily-drifting copy of every route+icon+role rule - this is the one place a
// new sidebar page's roles get defined, and the dashboard link for it just follows automatically.
export interface NavItem {
  to: string
  label: string
  /** 2026-09-18: shown alone in the collapsed desktop icon rail (see .sidebar's comment in
   * global.css) - the label is hidden in that state, so every item needs a recognizable icon. */
  icon: string
  roles?: StaffRole[]
  /** One-line description shown on DashboardPage's "All Pages" cards only - the sidebar itself
   * never renders this, so it's fine to leave off items added before the dashboard linking existed
   * (falls back to the bare label there). */
  subtitle?: string
  /** 2026-09-29 (SECTION 155, "sidebar menu acces provide page"): stable identity for this item,
   * independent of its route/label (either of which could change later) - used as the key into
   * GET /api/menu-access's role overrides below, and as the row identity on the new Admin: Menu
   * Access page. Derived automatically from `to` (see navKeyOf below) so every existing item gets
   * one without having to hand-write 17 of them - a new item just needs `to` set as usual. */
  key: string
}

/** '/admin/users' -> 'admin-users', '/part-upload' -> 'part-upload' - see NavItem.key's doc
 * comment. Deliberately deterministic from `to` alone so it can't drift out of sync with a
 * relabeled/rerouted item. */
function navKeyOf(to: string): string {
  return to.replace(/^\//, '').replace(/\//g, '-')
}

// 2026-09-30 (SECTION 162, "real access lock" for Supervisor - confirmed explicitly: Supervisor
// logins should ONLY see/use Dashboard, Job Cards and Attendance, not just have those 3 pinned to
// the top with everything else still reachable). Every `roles` array below that used to include
// 'Supervisor' has it removed, and every item that had NO `roles` at all (meaning "everyone",
// including Supervisor) now gets an explicit list of every OTHER role - see App.tsx's own matching
// route-guard changes (and that file's top-of-block note) for the full narrative, the residual
// backend-policy gap for pages whose controller I don't have this session, and the flagged
// assumption about this being the complete StaffRole list.
const NAV_ITEMS_BASE: Omit<NavItem, 'key'>[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/jobcards', label: 'Job Cards', icon: '📋', subtitle: 'View and manage all job cards' },
  // 2026-09-18 "here i want after Jobcards this table Servive History From DMSBAPLDATA databse":
  // read-only Service History lookup (search by Chassis No. or Reg No., one box) against
  // DMSBAPLDATA's DMS_ServiceHistory - placed immediately after Job Cards per that instruction.
  { to: '/service-history', label: 'Service History', icon: '🛠️', subtitle: 'Search a vehicle\'s past service visits', roles: ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-19 "i want create 1 sidebar option also in that Labour Master after Service History":
  // import/edit/delete/export labour rate master data (Partwise / Without Partwise) - this is
  // the one DMSBAPLDATA-adjacent page that actually WRITES data, so unlike its read-only siblings
  // it's gated to WorkshopManager and up (pricing data), matching LabourMasterController's own
  // WorkshopManagerUp policy exactly - see App.tsx's RequireRole wrapper on this route.
  { to: '/labour-master', label: 'Labour Master', icon: '🧮', subtitle: 'Import & manage labour rate master data', roles: ['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-18 "add in that after jobcards sidebar menu": read-only Vehicle Sale lookup against
  // DMSBAPLDATA's DMS_VehicleSales.
  { to: '/vehicle-sale', label: 'Vehicle Sale', icon: '🚗', subtitle: 'Synced vehicle sale data (DMSBAPLDATA)', roles: ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // { to: '/parts', label: 'Parts & Inventory', icon: '📦', subtitle: 'Stock, DMS parts, suggestions', roles: ['PartsUser', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-21 "add in sidebar option in Item master page fetch data from C _ItemMaster table from
  // baplfinal databse": read-only browse of BAPL's item catalog (Dealer Price + per-item GST%) -
  // the same source Material Transfer Bill/Repair Bill's Rate/MRP/GST calculation now reads from.
  // Same role floor as Parts & Inventory/Part Upload - it's the same pricing-data audience.
  { to: '/item-master', label: 'Item Master', icon: '🗂️', subtitle: 'BAPL item catalog - Dealer Price & GST% (baplfinal)', roles: ['PartsUser', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-30 (SECTION 165, "create table this 3 master and link in sidebar manu this 3 master") -
  // the 3 new masters built in SECTION 163 (Job Card Wizard's Job Type -> Service Head -> Priority
  // cascade, the shared Complaint list, and JC/MT/RB numbering prefixes) - see
  // web/src/pages/staff/ServiceMenuMasterPage.tsx / ComplaintMasterPage.tsx / DocPrefixMasterPage.tsx
  // for the full reasoning. Service Menu Master/Complaint Master share Item Master's role floor
  // (master reference data); Prefix Master is HQ-only (document numbering) - see App.tsx's matching
  // RequireRole for each route.
  { to: '/service-menu-master', label: 'Service Menu Master', icon: '🧭', subtitle: 'Job Type -> Service Head -> Priority (Job Card Wizard)', roles: ['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  { to: '/complaint-master', label: 'Complaint Master', icon: '💬', subtitle: 'Shared complaint list (Job Card Wizard)', roles: ['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  { to: '/prefix-master', label: 'Prefix Master', icon: '#️⃣', subtitle: 'JC / MT / RB document numbering prefixes', roles: ['CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-21 "Part Upload" tab ("new tab add Part Upload using this excel create table and
  // functionality to upload using this excel file for upload") - same role floor as Parts &
  // Inventory above, matching PartUploadController's PartsUserUp/PartsReadUp policies.
  { to: '/part-upload', label: 'Stock Report', icon: '📤', subtitle: 'Import a Stock Summary Detail Report (.xlsx)', roles: ['PartsUser', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-19 "now i want Create Repair Bill and Material Transfer Bill ... Repair Bill tab
  // before Repair Bill Report and Material Transfer Bill before Material Transfer Report" - these
  // two CREATE pages save into JobCardScannerDb's own tables (see RepairBillCreatePage.tsx/
  // MaterialTransferCreatePage.tsx), unlike their read-only DMSBAPLDATA-report siblings right
  // below, so they're gated to ServiceAdvisorUp (same floor as Estimates/JobCard creation) rather
  // than open to every staff role. The two report items just below were relabelled with "Report"
  // (were "Material Transfer"/"Repair Bill") so the two pairs read distinctly in the sidebar - the
  // ROUTES/PAGES those relabelled items point to (MaterialTransferPage.tsx/RepairBillPage.tsx) are
  // completely unchanged, only the nav label text and subtitle wording were touched.
  { to: '/material-transfer-bill', label: 'Material Transfer Bill', icon: '🆕', subtitle: 'Create a material transfer - saves to JobCardScanner', roles: ['ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-23 - new list page for transfers already saved in JobCardScanner (Draft/Confirmed/
  // Cancelled) - split out of the Material Transfer Bill create page above, mirroring the Repair
  // Bill List entry below.
  //{ to: '/material-transfer-list', label: 'Material Transfer List', icon: '📋', subtitle: 'Saved material transfers (JobCardScanner) - view, edit, Confirm Transfer', roles: ['ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  { to: '/material-transfer', label: 'Material Transfer Report', icon: '🔄', subtitle: 'Synced material transfer docs (DMSBAPLDATA)', roles: ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  { to: '/repair-bill-new', label: 'Repair Bill', icon: '🧾', subtitle: 'Create a repair bill - saves to JobCardScanner', roles: ['ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-23 - new list page for bills already saved in JobCardScanner (Performa/Billed) -
  // split out of the Repair Bill create page above.
  //{ to: '/repair-bill-list', label: 'Repair Bill List', icon: '📋', subtitle: 'Saved repair bills (JobCardScanner) - view, edit, Save as Invoice', roles: ['ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  { to: '/repair-bill', label: 'Repair Bill Report', icon: '📄', subtitle: 'Synced repair bill data (DMSBAPLDATA)', roles: ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-22 "needs to create warenty table in jobcardscanner db for this functionality and add
  // this in our function" - gated the same as Labour Master (WorkshopManagerUp): pricing data.
  //{ to: '/battery-warranty-schemes', label: 'Battery Warranty Schemes', icon: '🔋', subtitle: 'Extended Battery Warranty pricing & coverage by model', roles: ['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-22 "this all table add in jobcard db that all functionality need to craete in jc" -
  // global masters (see OemModelsController's own doc comment for why List/Get is
  // WorkshopManagerUp here even though writes are CorporateAdminUp-only server-side).
  // { to: '/oem-models', label: 'OEM Model Master', icon: '🚗', subtitle: 'Shared vehicle model catalog (global, not per-dealer)', roles: ['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  //{ to: '/oem-model-warranties', label: 'OEM Model Warranty', icon: '🛡️', subtitle: 'Standard manufacturer warranty terms by model', roles: ['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  { to: '/reports', label: 'Reports & Search', icon: '📊', subtitle: 'Excel & PDF, by date range', roles: ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // Employees (2026-09-17): create/edit/delete local dealer logins with Work Area location
  // scoping. Gated to DealerAdmin and up - the same DealerAdminUp floor UsersController's API
  // already enforces - so a dealer's own DealerAdmin can manage their own staff here, distinct
  // from "Admin: Users" below which stays HQ-only for its bulk/sync tools.
  { to: '/employees', label: 'Dealer Employees', icon: '👥', subtitle: 'Add staff, edit Work Area', roles: ['DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-24 "Technician Employee" - was Supervisor and up (see App.tsx route's own comment for
  // why a plain WorkshopManager did not see this link either). 2026-09-30 (SECTION 162): Supervisor
  // removed per this section's access lock - narrowed to DealerAdmin and up, same floor as Dealer
  // Employees above.
  { to: '/technician-employees', label: 'Technician Employee', icon: '🛠️', subtitle: 'Login-less technician roster for Job Card dropdowns', roles: ['DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // Restricted to true HQ admins (CorporateAdmin/SystemAdmin) - a dealer's own DealerAdmin login
  // (created by the BAPL bulk import, or WorkshopManager) no longer sees these two links. The
  // routes themselves are guarded to match (see RequireRole in App.tsx), so this isn't just
  // cosmetic - a DealerAdmin/WorkshopManager typing the URL directly is redirected away too.
  { to: '/admin/users', label: 'Admin: Users', icon: '⚙️', subtitle: 'Manage users, roles, Work Area', roles: ['CorporateAdmin', 'SystemAdmin'] },
  { to: '/attendance', label: 'Attendance', icon: '🗓️', subtitle: 'Mark daily staff attendance by dealer', roles: ['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  { to: '/admin/workflow', label: 'Admin: Workflow', icon: '🔧', subtitle: 'Configure job card stages', roles: ['CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-29 (SECTION 155, "for sidebar menu acces provide page make foe which role which menu
  // wants to shown a every where") - new admin page for the role-override feature this whole
  // block of comments is about. HQ-only, same floor as Admin: Users/Admin: Workflow just above.
  { to: '/admin/menu-access', label: 'Admin: Menu Access', icon: '🔐', subtitle: 'Choose which roles see which sidebar page', roles: ['CorporateAdmin', 'SystemAdmin'] },
]

export const NAV_ITEMS: NavItem[] = NAV_ITEMS_BASE.map((item) => ({ ...item, key: navKeyOf(item.to) }))

/**
 * SECTION 171 (2026-09-30) - "i checkbox select from DealerAdmin only 3 page but all option shown
 * in sidebar as well on dashboard". Root cause: DashboardPage.tsx's own "All Pages" grid was
 * filtering by each NavItem's hardcoded default `roles` directly (`!n.roles || hasRole(...n.roles)`)
 * - it never looked at the Menu Access overrides OR the SECTION 170 per-role "only show checked"
 * mode at all, so SECTION 170 only ever fixed the SIDEBAR; the Dashboard's own grid kept showing
 * every page regardless of what was checked/toggled on the Admin: Menu Access page.
 *
 * Fix: the override-fetch + effectiveRoles + isVisibleForCurrentRole logic that used to live only
 * inside StaffLayout's own component body (added by SECTION 155/170) is pulled out into this
 * exported hook, so DashboardPage.tsx's own "All Pages" grid can call the EXACT same function
 * instead of keeping a second, already-proven-to-drift copy. StaffLayout itself below now just
 * calls this hook too - same fetch, same dependency array, same behavior, just moved so it has one
 * home instead of two.
 */
export function useMenuAccess() {
  const { profile, hasRole } = useStaffAuth()
  const location = useLocation()
  const [menuOverrides, setMenuOverrides] = useState<Record<string, string[]>>({})
  const [roleModes, setRoleModes] = useState<Record<string, boolean>>({})

  useEffect(() => {
    staffApi
      .get<{ navKey: string; roles: string[] }[]>('/api/menu-access')
      .then((res) => {
        const map: Record<string, string[]> = {}
        res.data.forEach((row) => { map[row.navKey] = row.roles })
        setMenuOverrides(map)
      })
      .catch(() => {
        // Fail-open to each item's shipped default roles - never let this one endpoint being
        // down/slow take the whole sidebar/dashboard grid with it.
      })
    staffApi
      .get<{ role: string; onlyShowChecked: boolean }[]>('/api/menu-access/role-modes')
      .then((res) => {
        const map: Record<string, boolean> = {}
        res.data.forEach((row) => { map[row.role] = row.onlyShowChecked })
        setRoleModes(map)
      })
      .catch(() => {
        // Fail-open (mode stays false for every role) - same reasoning as the overrides fetch above.
      })
  }, [location.pathname])

  /** undefined = every staff role can see this item (matches NAV_ITEMS' own `roles` convention).
   * An override entry that exists but is an EMPTY array also means "everyone" (explicitly cleared
   * by an admin on the Menu Access page) - only a NON-empty override narrows to those roles. No
   * entry at all for this item's key means no override has been saved, so the item's own
   * hardcoded default `roles` still applies exactly as before this feature existed. */
  const effectiveRoles = (item: NavItem): StaffRole[] | undefined => {
    const override = menuOverrides[item.key]
    if (override === undefined) return item.roles
    return override.length > 0 ? (override as StaffRole[]) : undefined
  }

  /** SECTION 174 (2026-09-30) - "where all menu": a SystemAdmin login was switched into SECTION
   * 170's "only show checked" allow-list mode with zero MenuAccessOverride rows explicitly naming
   * SystemAdmin for ANY item. FACT (confirmed by reading isVisibleForCurrentRole below): under
   * allow-list mode an item only shows when effectiveRoles(item) is a non-empty explicit list
   * naming the signed-in role - Dashboard and Admin: Menu Access both ship with no `roles`
   * restriction (undefined = "everyone" under the normal/fail-open rule), which counts for
   * nothing in allow-list mode, so they vanished along with every other item. That's the entire
   * sidebar except the two unconditional elements outside NAV_ITEMS ("All Dealers" header,
   * "Logout" link - see render below) - which is exactly what was reported. Worse: it took down
   * the one page (Admin: Menu Access) that could undo it, leaving only a direct SQL fix as a way
   * back in.
   *
   * FIX: CorporateAdmin and SystemAdmin can now ALWAYS see Dashboard and Admin: Menu Access,
   * regardless of roleModes/menuOverrides - a hardcoded floor under the allow-list feature so
   * these two roles can never fully lock themselves out of the one screen that controls it. This
   * does not change what any OTHER role sees, and an HQ admin can still restrict every OTHER item
   * for their own role if they want to - only these two keys are exempted from allow-list mode. */
  const ALWAYS_VISIBLE_KEYS_FOR_HQ_ADMIN = new Set(['dashboard', 'admin-menu-access'])

  /** SECTION 170 - true if this item should show for the CURRENTLY SIGNED-IN user's own role.
   * Normal (non-allow-list) roles keep the exact same fail-open check as before (no restriction, or
   * this role isn't excluded from one). A role in allow-list mode is the opposite: hidden unless an
   * EXPLICIT, saved, non-empty override names this role - see SECTION 180 below for why that is no
   * longer effectiveRoles(item).
   * SECTION 174: except Dashboard/Admin: Menu Access for CorporateAdmin/SystemAdmin - see that
   * section's doc comment just above - which are always visible to those two roles no matter what.
   *
   * SECTION 180 (2026-09-30) ("stiull from sidebar menu not remove in every page there is need to
   * add anything?") - CONFIRMED BUG, traced through the real code: the allow-list branch used to
   * call effectiveRoles(item) first, which falls back to the item's shipped default `roles` array
   * whenever no override has been saved for that item yet. Since almost every NAV_ITEMS_BASE entry
   * already lists 'DealerAdmin' in its default roles (Service History, Vehicle Sale, Labour Master,
   * Item Master, Service Menu Master, Complaint Master, Part Upload, both Report pages, Reports &
   * Search, Employees, Technician Employees, Attendance), turning Role Sidebar Mode ON for
   * DealerAdmin did NOT hide any of those - hasRole(...roles) still passed because DealerAdmin was
   * already baked into that default array, even though nobody explicitly checked that item for
   * DealerAdmin on the Menu Access page. Only items with NO default roles at all (Dashboard, Job
   * Cards) were correctly hidden. That's exactly "still not remove in every page."
   * FIX: while in allow-list mode, the shipped default `roles` is never consulted any more - only
   * an EXPLICIT, saved, non-empty override that names this role counts, read straight off
   * menuOverrides instead of through effectiveRoles' default-fallback. effectiveRoles() itself is
   * UNCHANGED (still used by the normal/non-allow-list branch below, and by DashboardPage.tsx's
   * "All Pages" grid via this same hook). */
  const isVisibleForCurrentRole = (item: NavItem): boolean => {
    if (
      (profile?.role === 'CorporateAdmin' || profile?.role === 'SystemAdmin') &&
      ALWAYS_VISIBLE_KEYS_FOR_HQ_ADMIN.has(item.key)
    ) {
      return true
    }
    const role = profile?.role
    if (role && roleModes[role]) {
      const override = menuOverrides[item.key]
      return !!override && override.length > 0 && (override as StaffRole[]).includes(role as StaffRole)
    }
    const roles = effectiveRoles(item)
    return !roles || hasRole(...roles)
  }

  return { isVisibleForCurrentRole }
}

/** Item 5: "add a back button at the start/top of every page". A single button in the topbar,
 * shown on every staff page except the Dashboard (nothing to go "back" to from the app's own
 * home) - resolves to that page's logical parent rather than raw browser history, so it behaves
 * predictably even when a page was opened via a direct link/refresh rather than in-app
 * navigation (where plain browser-back could leave the app entirely). */
function resolveBackTarget(pathname: string): string | null {
  if (pathname === '/dashboard' || pathname === '/') return null
  if (pathname.startsWith('/jobcards')) return pathname === '/jobcards' ? '/dashboard' : '/jobcards'
  return '/dashboard'
}

/** 2026-09-18 topbar redesign: which of the three role-pill/avatar colors (see .role-pill/
 * .avatar-circle in global.css) a StaffRole falls into - not a color per individual role, just a
 * tier, so the avatar/pill stay meaningful at a glance instead of a rainbow of one-off hues. */
function roleTier(role?: StaffRole): 'admin' | 'manager' | 'staff' {
  if (role === 'CorporateAdmin' || role === 'SystemAdmin' || role === 'DealerAdmin') return 'admin'
  if (role === 'WorkshopManager' || role === 'Supervisor') return 'manager'
  return 'staff'
}

/** Up to two initials from a display name (e.g. "Vishal Rankawat" -> "VR", "Vishal" -> "V") for
 * the topbar avatar circle - falls back to "?" for a not-yet-loaded profile. */
function initialsOf(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function StaffLayout() {
  const { profile, hasRole, authMode } = useStaffAuth()
  const { instance } = useMsal()
  const navigate = useNavigate()
  const location = useLocation()
  const backTarget = resolveBackTarget(location.pathname)

  // Sidebar rail/expand state (see .sidebar's own comment in global.css for the full rationale).
  // 2026-09-18: the hamburger button is gone per your request - the sidebar is now always visible
  // as a 64px icon rail, and clicking its own background (handleSidebarClick below) toggles it out
  // to the full 240px labeled panel and back. .main gets a matching "sidebar-open" class so the
  // page content shifts over to make room when expanded.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = () => setSidebarOpen(false)

  // Clicking anywhere on the sidebar's own background toggles it open/closed - but a click that
  // actually landed on a nav link or the logout link should just do ITS job (navigate / sign out),
  // not also fight over sidebarOpen, so those are excluded here via closest('a, button').
  const handleSidebarClick = (e: ReactMouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('a, button')) return
    setSidebarOpen((v) => !v)
  }

  // Any in-app navigation (nav link click, or a redirect triggered elsewhere) auto-closes the
  // drawer so the user isn't left staring at the menu after picking a page.
  useEffect(() => {
    closeSidebar()
  }, [location.pathname])

  // SECTION 171 (2026-09-30): the override-fetch + effectiveRoles + isVisibleForCurrentRole logic
  // that used to live here (SECTION 155/164/170) now lives in the exported useMenuAccess() hook
  // above, so DashboardPage.tsx's "All Pages" grid can share it instead of drifting out of sync -
  // see that hook's own doc comment for the full history. No behavior change for the sidebar
  // itself: same fetch, same re-fetch-on-navigation dependency, same fail-open fallback.
  const { isVisibleForCurrentRole } = useMenuAccess()

  // Profile menu (topbar): click-to-open, click-anywhere-else-to-close.
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!profileOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [profileOpen])

  const signOut = () => {
    if (authMode === 'dealer') {
      dealerLogout()
      navigate('/login', { replace: true })
      window.location.reload() // clears in-memory profile/context state cleanly
    } else {
      instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin })
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} onClick={handleSidebarClick} title={sidebarOpen ? 'Click to collapse' : 'Click to expand'}>
        {/* Collapsed-rail-only monogram (see .sidebar-brand-mark in global.css) - hidden once
            expanded, when the full wordmark below takes over. */}
        <div className="sidebar-brand-mark">JC</div>
        {/* 2026-09-18 "in place of JobCardScanner i want add ... BGauss_Logo.png remove header
            JobCardScanner" - the "JobCardScanner" wordmark (and the emoji sticker placeholder that
            briefly stood in for it) is gone; the real logo now takes its place, shown only in the
            EXPANDED sidebar (same visibility rule the wordmark itself had - see .sidebar-logo in
            global.css). The collapsed-rail monogram above ("JC") is unrelated and untouched. */}
        <img src={bgaussLogo} alt="BGauss" className="sidebar-logo" />
        <p className="sub">{profile?.dealerName ?? 'All Dealers'}</p>
        <nav>
          {/* 2026-09-23 ("in sidebar menu when close and any icon click then this will open that
              also add"): while the sidebar is collapsed (the 64px icon-only rail), clicking a nav
              icon now OPENS the sidebar (expands to the full labeled panel) instead of navigating
              straight away - the first click on any icon just reveals the menu so its label is
              visible; navigation happens (and the drawer auto-collapses again, unchanged from
              before) on a second click once it's already expanded. This is on top of the existing
              click-the-sidebar's-own-background toggle above (handleSidebarClick) - that one is
              unchanged.
              2026-09-29 (SECTION 155): the filter below now checks effectiveRoles(item) - the
              Menu Access override when one is saved, else item's own hardcoded default `roles` -
              instead of reading item.roles directly. 2026-09-30 (SECTION 170): now goes through
              isVisibleForCurrentRole(item) instead, which additionally hides anything not
              explicitly checked when the signed-in user's own role is in "only show checked"
              allow-list mode - see that function's own doc comment. */}
          {NAV_ITEMS.filter(isVisibleForCurrentRole).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'active' : '')}
              title={item.label}
              onClick={(e) => {
                if (!sidebarOpen) {
                  e.preventDefault()
                  setSidebarOpen(true)
                  return
                }
                closeSidebar()
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <a href="#" className="logout-link" title="Logout" onClick={(e) => { e.preventDefault(); closeSidebar(); signOut() }}>
            <span className="nav-icon">⎋</span>
            <span className="logout-label">Logout</span>
          </a>
        </div>
      </aside>
      <div className={`main ${sidebarOpen ? 'sidebar-open' : ''}`} onClick={() => sidebarOpen && closeSidebar()}>
        <header className="topbar">
          {/* 2026-09-18 "also in navbar add logo" - same BGauss logo as the sidebar, shown here at
              a smaller size since the topbar is a slim 14px-padded bar rather than the sidebar's
              full-height panel (see .topbar-logo in global.css). Placed first so it sits at the
              far left of the bar, ahead of the "← Back" button. */}
          <img src={bgaussLogo} alt="BGauss" className="topbar-logo" />
          {backTarget && (
            <button
              className="btn btn-sm back-btn"
              aria-label="Back"
              onClick={(e) => { e.stopPropagation(); navigate(backTarget) }}
              style={{ marginLeft: 8 }}
            >
              ← Back
            </button>
          )}
          <div className="profile-menu" ref={profileRef} onClick={(e) => e.stopPropagation()}>
            <button className="profile-trigger" aria-label={`Account menu${profile?.name ? ` for ${profile.name}` : ''}`} onClick={() => setProfileOpen((v) => !v)}>
              {/* 2026-09-18: matched against the BTL reference screenshot's topbar - a solid role
                  pill (see .role-pill's own comment) sits immediately left of the avatar, not
                  tucked under the name, and the avatar uses this user's own saved AvatarColor
                  (User.AvatarColor, already set on every account - see UsersController) when
                  there is one, falling back to a role-tier color only for the rare account with
                  none set. */}
              <span className={`role-pill ${roleTier(profile?.role) !== 'admin' ? `role-pill-${roleTier(profile?.role)}` : ''}`}>{profile?.role}</span>
              <div
                className={`avatar-circle tier-${roleTier(profile?.role)}`}
                style={profile?.avatarColor ? { background: profile.avatarColor } : undefined}
              >
                {initialsOf(profile?.name)}
              </div>
              <span className="profile-caret">{profileOpen ? '▲' : '▼'}</span>
            </button>
            {profileOpen && (
              <div className="profile-dropdown">
                <div className="profile-dropdown-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    className={`avatar-circle tier-${roleTier(profile?.role)}`}
                    style={profile?.avatarColor ? { background: profile.avatarColor } : undefined}
                  >
                    {initialsOf(profile?.name)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{profile?.name}</div>
                    <span className={`role-pill ${roleTier(profile?.role) !== 'admin' ? `role-pill-${roleTier(profile?.role)}` : ''}`} style={{ marginTop: 4 }}>{profile?.role}</span>
                  </div>
                </div>
                <dl className="profile-details">
                  <dt>Email</dt>
                  <dd>{profile?.email || '—'}</dd>
                  {profile?.mobile && (<><dt>Mobile</dt><dd>{profile.mobile}</dd></>)}
                  <dt>Dealer</dt>
                  <dd>{profile?.dealerName ?? 'All Dealers (HQ)'}</dd>
                  {/* 2026-09-29 (SECTION 153/155, "which location assign ... not shown in ...
                      navbar") - shows this account's Work Area (User.WorkLocationCodes), the same
                      field PartUploadPage.tsx's own Location dropdown already scopes by. Only
                      rendered when non-empty - an account with no Work Area restriction (the
                      "unrestricted" convention used everywhere else in this app) shows nothing
                      here, same as the optional Mobile row above. INTERPRETATION, flagged: I'm
                      reading this off `profile?.workLocationCodes` - the exact field name/shape
                      your real StaffAuthContext.tsx profile object uses, confirmed earlier this
                      session from PartUploadPage.tsx's own use of the same field - but I don't
                      have StaffAuthContext.tsx itself in this session to double-check its type
                      definition. If your build reports this field doesn't exist on `profile`,
                      tell me the real field name and it's a one-line fix. */}
                  {profile?.workLocationCodes && profile.workLocationCodes.length > 0 && (
                    <>
                      <dt>Work Area</dt>
                      <dd>{profile.workLocationCodes.join(', ')}</dd>
                    </>
                  )}
                  <dt>Sign-in method</dt>
                  <dd>{authMode === 'dealer' ? 'Dealer / Workshop login' : 'Azure AD (Microsoft)'}</dd>
                </dl>
                <button className="btn btn-sm btn-primary" style={{ width: '100%' }} onClick={signOut}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
