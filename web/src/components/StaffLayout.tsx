import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMsal } from '@azure/msal-react'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { dealerLogout } from '../services/dealerAuthService'
import type { StaffRole } from '../types'

interface NavItem {
  to: string
  label: string
  roles?: StaffRole[]
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/jobcards', label: 'Job Cards' },
  { to: '/parts', label: 'Parts & Inventory', roles: ['PartsUser', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'] },
  { to: '/reports', label: 'Reports & Search' },
  // Restricted to true HQ admins (CorporateAdmin/SystemAdmin) - a dealer's own DealerAdmin login
  // (created by the BAPL bulk import, or WorkshopManager) no longer sees these two links. The
  // routes themselves are guarded to match (see RequireRole in App.tsx), so this isn't just
  // cosmetic - a DealerAdmin/WorkshopManager typing the URL directly is redirected away too.
  { to: '/admin/users', label: 'Admin: Users', roles: ['CorporateAdmin', 'SystemAdmin'] },
  { to: '/admin/workflow', label: 'Admin: Workflow', roles: ['CorporateAdmin', 'SystemAdmin'] },
]

export function StaffLayout() {
  const { profile, hasRole, authMode } = useStaffAuth()
  const { instance } = useMsal()
  const navigate = useNavigate()
  const location = useLocation()

  // Sidebar drawer state - applies at every screen width (see global.css). Toggled via the
  // hamburger button; .main gets a matching "sidebar-open" class so the page content shifts over
  // to make room for it instead of the drawer overlaying on top of the content.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = () => setSidebarOpen(false)

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
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <h1>JobCardScanner</h1>
        <p className="sub">{profile?.dealerName ?? 'All Dealers'}</p>
        <nav>
          {NAV_ITEMS.filter((item) => !item.roles || hasRole(...item.roles)).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')} onClick={closeSidebar}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <a href="#" className="logout-link" onClick={(e) => { e.preventDefault(); closeSidebar(); signOut() }}>
            ⎋ Logout
          </a>
        </div>
      </aside>
      <div className={`main ${sidebarOpen ? 'sidebar-open' : ''}`} onClick={() => sidebarOpen && closeSidebar()}>
        <header className="topbar">
          <button
            className="hamburger-btn"
            aria-label="Toggle menu"
            onClick={(e) => { e.stopPropagation(); setSidebarOpen((v) => !v) }}
          >
            ☰
          </button>
          <div className="profile-menu" ref={profileRef} onClick={(e) => e.stopPropagation()}>
            <button className="profile-trigger" onClick={() => setProfileOpen((v) => !v)}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{profile?.name}</div>
                <div className="muted">{profile?.role}</div>
              </div>
              <span className="profile-caret">{profileOpen ? '▲' : '▼'}</span>
            </button>
            {profileOpen && (
              <div className="profile-dropdown">
                <div className="profile-dropdown-header">
                  <div style={{ fontWeight: 600 }}>{profile?.name}</div>
                  <span className="badge" style={{ marginTop: 4 }}>{profile?.role}</span>
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