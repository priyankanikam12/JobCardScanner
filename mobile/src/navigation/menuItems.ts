// mobile\src\navigation\menuItems.ts
import type { StaffRole } from '../types'
import type { RootStackParamList } from './RootNavigator'

/**
 * 2026-10-22 ("apply all web changes on Android - menu rights, Care Desk, all pages, all roles"): the Android counterpart of web/src/components/StaffLayout.tsx's NAV_ITEMS + useMenuAccess().
 * ONE list of every page of the app (the SAME items, keys, default roles and order as the web sidebar) and ONE visibility rule, shared by the Dashboard's "All Pages" cards and every screen guard,
 * so what a role sees on Android is decided exactly like on web:
 *   1. an item's shipped default `roles` (undefined = every staff role),
 *   2. Admin: Menu Access overrides (GET /api/menu-access: navKey -> roles; an empty list = everyone),
 *   3. "Only show checked items" mode per role / per Captain-ViceCaptain designation (GET /api/menu-access/role-modes) which turns a role into an allow-list,
 *   4. CorporateAdmin / SystemAdmin always keep Dashboard + Admin: Menu Access (a hard floor so they can never lock themselves out of the screen that controls it).
 * The `key` of an item is derived from its web route exactly as web does (navKeyOf), so ONE Menu Access row controls the web sidebar AND the Android Dashboard.
 *
 * `screen` is the Android destination (a RootStackParamList route). An item without `screen` has no Android page - it is in the list so Menu Access shows the same rows as web, but nothing is
 * shown for it on the Android Dashboard.
 */
export interface NavItem {
  /** the web route - only used to derive `key` and to read the list side by side with web's NAV_ITEMS_BASE */
  to: string
  label: string
  icon: string
  subtitle?: string
  roles?: StaffRole[]
  /** Android destination screen (undefined = this page does not exist on Android) */
  screen?: keyof RootStackParamList
  /** route params the Dashboard card passes along */
  params?: object
  key: string
}

const navKeyOf = (to: string): string => to.replace(/^\//, '').replace(/\//g, '-')

type Base = Omit<NavItem, 'key'>

// Same entries, same order and same default roles as web/src/components/StaffLayout.tsx NAV_ITEMS_BASE (items web has commented out - Parts & Inventory, Material Transfer List, Repair Bill List,
// Battery Warranty Schemes, OEM Model Master / Warranty - are not here either).
const NAV_ITEMS_BASE: Base[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦', screen: 'Dashboard' },
  { to: '/jobcards', label: 'Job Cards', icon: '📋', subtitle: 'View and manage all job cards', screen: 'JobCardsList' },
  { to: '/service-history', label: 'Service History', icon: '🛠️', subtitle: "Search a vehicle's past service visits", roles: ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'ServiceHistory' },
  { to: '/labour-master', label: 'Labour Master', icon: '🧮', subtitle: 'Import & manage labour rate master data', roles: ['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'LabourMaster' },
  { to: '/vehicle-sale', label: 'Vehicle Sale', icon: '🚗', subtitle: 'Synced vehicle sale data (DMSBAPLDATA)', roles: ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'VehicleSale' },
  { to: '/item-master', label: 'Item Master', icon: '🗂️', subtitle: 'BAPL item catalog - Dealer Price & GST% (baplfinal)', roles: ['PartsUser', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'ItemMaster' },
  { to: '/service-menu-master', label: 'Service Menu Master', icon: '🧭', subtitle: 'Job Type -> Service Head -> Priority (Job Card Wizard)', roles: ['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'ServiceMenuMaster' },
  { to: '/complaint-master', label: 'Complaint Master', icon: '💬', subtitle: 'Shared complaint list (Job Card Wizard)', roles: ['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'ComplaintMaster' },
  { to: '/prefix-master', label: 'Prefix Master', icon: '#️⃣', subtitle: 'JC / MT / RB document numbering prefixes', roles: ['CorporateAdmin', 'SystemAdmin'], screen: 'PrefixMaster' },
  { to: '/ledger-master', label: 'Ledger Master', icon: '📒', subtitle: 'Party & Insurance ledgers (Company/Dealer via ERP)', roles: ['WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'LedgerMaster' },
  { to: '/part-upload', label: 'Stock Report', icon: '📤', subtitle: 'Import a Stock Summary Detail Report (.xlsx)', roles: ['PartsUser', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'PartUpload' },
  { to: '/material-transfer-bill', label: 'Material Transfer Bill', icon: '🆕', subtitle: 'Create a material transfer - saves to JobCardScanner', roles: ['ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'MaterialTransferCreate' },
  { to: '/material-transfer', label: 'Material Transfer Report', icon: '🔄', subtitle: 'Synced material transfer docs (DMSBAPLDATA)', roles: ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'MaterialTransferReport' },
  { to: '/repair-bill-new', label: 'Repair Bill', icon: '🧾', subtitle: 'Create a repair bill - saves to JobCardScanner', roles: ['ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'RepairBillCreate' },
  { to: '/repair-bill', label: 'Repair Bill Report', icon: '📄', subtitle: 'Synced repair bill data (DMSBAPLDATA)', roles: ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'RepairBillReport' },
  { to: '/reports', label: 'Reports & Search', icon: '📊', subtitle: 'Excel & PDF, by date range', roles: ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'Reports' },
  { to: '/care-desk', label: 'Care Desk', icon: '🎧', subtitle: 'Fleet ticketing - off-road, warranty & spare-part tickets', roles: ['CorporateAdmin', 'SystemAdmin'], screen: 'CareDesk' },
  { to: '/employees', label: 'Dealer Employees', icon: '👥', subtitle: 'Add staff, edit Work Area', roles: ['DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'Employees' },
  { to: '/technician-employees', label: 'Technician Employee', icon: '🛠️', subtitle: 'Login-less technician roster for Job Card dropdowns', roles: ['DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'TechnicianEmployees' },
  { to: '/admin/users', label: 'Admin: Users', icon: '⚙️', subtitle: 'Manage users, roles, Work Area', roles: ['CorporateAdmin', 'SystemAdmin'], screen: 'AdminUsers' },
  // Android keeps Attendance as "my own attendance" (SECTION 172, 30.09.2026) - the full roster/marking view stays on web.
  { to: '/attendance', label: 'Attendance', icon: '🗓️', subtitle: 'Mark daily staff attendance by dealer', roles: ['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin'], screen: 'Attendance', params: { onlyMine: true } },
  { to: '/admin/workflow', label: 'Admin: Workflow', icon: '🔧', subtitle: 'Configure job card stages', roles: ['CorporateAdmin', 'SystemAdmin'], screen: 'AdminWorkflow' },
  { to: '/admin/menu-access', label: 'Admin: Menu Access', icon: '🔐', subtitle: 'Choose which roles see which sidebar page', roles: ['CorporateAdmin', 'SystemAdmin'], screen: 'MenuAccess' },
]

export const NAV_ITEMS: NavItem[] = NAV_ITEMS_BASE.map((item) => ({ ...item, key: navKeyOf(item.to) }))

/** Every Android page that has a card on the Dashboard's "All Pages" list (Dashboard itself is excluded - you are on it). */
export const ANDROID_PAGES: NavItem[] = NAV_ITEMS.filter((n) => n.screen && n.screen !== 'Dashboard')

/**
 * Route-level role lists - what web/src/App.tsx's RequireRole wraps each page with. Web lists the same nine roles on almost every page and only the two head-office pages (Care Desk, Dealer Role
 * Report) are narrower; WHAT A ROLE SEES is decided by the Menu Access rules above, and these lists only stop a role that is not in them from opening the screen at all. Kept in ONE place so
 * a change on web is a one-line change here. NOTE (same as web): PartsUser and Cashier are not in the nine, so they can see the pages their menu rights show but are bounced from the screens.
 */
export const STAFF_ROUTE_ROLES: StaffRole[] = ['ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain', 'Technician']
export const HQ_ROLES: StaffRole[] = ['CorporateAdmin', 'SystemAdmin']

