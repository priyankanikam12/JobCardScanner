import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMsal } from '@azure/msal-react'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { dealerLogout } from '../services/dealerAuthService'
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
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/jobcards', label: 'Job Cards', icon: '📋', subtitle: 'View and manage all job cards' },
  // 2026-09-18 "here i want after Jobcards this table Servive History From DMSBAPLDATA databse":
  // read-only Service History lookup (search by Chassis No. or Reg No., one box) against
  // DMSBAPLDATA's DMS_ServiceHistory - placed immediately after Job Cards per that instruction, same
  // "no roles = every staff role can see it" convention as its sibling DMSBAPLDATA pages below.
  { to: '/service-history', label: 'Service History', icon: '🛠️', subtitle: 'Search a vehicle\'s past service visits' },
  // 2026-09-19 "i want create 1 sidebar option also in that Labour Master after Service History":
  // import/edit/delete/export labour rate master data (Partwise / Without Partwise) - this is
  // the one DMSBAPLDATA-adjacent page that actually WRITES data, so unlike its read-only siblings
  // it's gated to WorkshopManager and up (pricing data), matching LabourMasterController's own
  // WorkshopManagerUp policy exactly - see App.tsx's RequireRole wrapper on this route.
  { to: '/labour-master', label: 'Labour Master', icon: '🧮', subtitle: 'Import & manage labour rate master data', roles: ['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-18 "add in that after jobcards sidebar menu": read-only Vehicle Sale lookup against
  // DMSBAPLDATA's DMS_VehicleSales, same "no roles = every staff role can see it" convention as its
  // sibling DMSBAPLDATA pages (Material Transfer, Repair Bill) below.
  { to: '/vehicle-sale', label: 'Vehicle Sale', icon: '🚗', subtitle: 'Synced vehicle sale data (DMSBAPLDATA)' },
  { to: '/parts', label: 'Parts & Inventory', icon: '📦', subtitle: 'Stock, DMS parts, suggestions', roles: ['PartsUser', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-21 "add in sidebar option in Item master page fetch data from C _ItemMaster table from
  // baplfinal databse": read-only browse of BAPL's item catalog (Dealer Price + per-item GST%) -
  // the same source Material Transfer Bill/Repair Bill's Rate/MRP/GST calculation now reads from.
  // Same role floor as Parts & Inventory/Part Upload - it's the same pricing-data audience.
  { to: '/item-master', label: 'Item Master', icon: '🗂️', subtitle: 'BAPL item catalog - Dealer Price & GST% (baplfinal)', roles: ['PartsUser', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // 2026-09-21 "Part Upload" tab ("new tab add Part Upload using this excel create table and
  // functionality to upload using this excel file for upload") - same role floor as Parts &
  // Inventory above, matching PartUploadController's PartsUserUp policy.
  { to: '/part-upload', label: 'Part Upload', icon: '📤', subtitle: 'Import a Stock Summary Detail Report (.xlsx)', roles: ['PartsUser', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
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
  { to: '/material-transfer', label: 'Material Transfer Report', icon: '🔄', subtitle: 'Synced material transfer docs (DMSBAPLDATA)' },
  { to: '/repair-bill-new', label: 'Repair Bill', icon: '🧾', subtitle: 'Create a repair bill - saves to JobCardScanner', roles: ['ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  { to: '/repair-bill', label: 'Repair Bill Report', icon: '📄', subtitle: 'Synced repair bill data (DMSBAPLDATA)' },
  { to: '/reports', label: 'Reports & Search', icon: '📊', subtitle: 'Excel & PDF, by date range' },
  // Employees (2026-09-17): create/edit/delete local dealer logins with Work Area location
  // scoping. Gated to DealerAdmin and up - the same DealerAdminUp floor UsersController's API
  // already enforces - so a dealer's own DealerAdmin can manage their own staff here, distinct
  // from "Admin: Users" below which stays HQ-only for its bulk/sync tools.
  { to: '/employees', label: 'Employees', icon: '👥', subtitle: 'Add staff, edit Work Area', roles: ['DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  // Restricted to true HQ admins (CorporateAdmin/SystemAdmin) - a dealer's own DealerAdmin login
  // (created by the BAPL bulk import, or WorkshopManager) no longer sees these two links. The
  // routes themselves are guarded to match (see RequireRole in App.tsx), so this isn't just
  // cosmetic - a DealerAdmin/WorkshopManager typing the URL directly is redirected away too.
  { to: '/admin/users', label: 'Admin: Users', icon: '⚙️', subtitle: 'Manage users, roles, Work Area', roles: ['CorporateAdmin', 'SystemAdmin'] },
  { to: '/admin/workflow', label: 'Admin: Workflow', icon: '🔧', subtitle: 'Configure job card stages', roles: ['CorporateAdmin', 'SystemAdmin'] },
]

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
  if (role === 'WorkshopManager') return 'manager'
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
          {NAV_ITEMS.filter((item) => !item.roles || hasRole(...item.roles)).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')} onClick={closeSidebar} title={item.label}>
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
