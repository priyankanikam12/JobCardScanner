// mobile\src\navigation\menuAccess.ts
import { useCallback, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import type { StaffRole } from '../types'
import { effectiveRoles, isNavItemVisible } from './menuRules'
import type { NavItem } from './menuItems'

// The page list, the default roles and the route-level role lists live in menuItems.ts, the visibility rule in menuRules.ts (both free of React so the rules can be tested on their own);
// this file is the hook that feeds the rule with the live Menu Access settings, and re-exports the lot so every screen keeps importing from one place.
export * from './menuItems'
export { ALWAYS_VISIBLE_KEYS_FOR_HQ_ADMIN, effectiveRoles, isNavItemVisible } from './menuRules'

/**
 * Menu rights as a hook (web's useMenuAccess). The overrides and role modes are fetched when the screen that uses it comes into focus (web re-reads them on every navigation), and every fetch fails
 * OPEN - a slow or down endpoint never hides the whole menu. isVisibleForCurrentRole(item) is the rule in menuRules.ts applied to the signed-in user.
 */
export function useMenuAccess() {
  const { profile, hasRole } = useStaffAuth()
  const [menuOverrides, setMenuOverrides] = useState<Record<string, string[]>>({})
  const [roleModes, setRoleModes] = useState<Record<string, boolean>>({})
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(() => {
    apiClient
      .get<{ navKey: string; roles: string[] }[]>('/api/menu-access')
      .then((res) => {
        const map: Record<string, string[]> = {}
        res.data.forEach((row) => { map[row.navKey] = row.roles })
        setMenuOverrides(map)
      })
      .catch(() => { /* fail-open to each item's shipped default roles */ })
    apiClient
      .get<{ role: string; onlyShowChecked: boolean }[]>('/api/menu-access/role-modes')
      .then((res) => {
        const map: Record<string, boolean> = {}
        res.data.forEach((row) => { map[row.role] = row.onlyShowChecked })
        setRoleModes(map)
      })
      .catch(() => { /* fail-open: no role is in allow-list mode */ })
      .finally(() => setLoaded(true))
  }, [])

  useFocusEffect(useCallback(() => { reload() }, [reload]))

  const isVisibleForCurrentRole = (item: NavItem): boolean =>
    isNavItemVisible(item, { role: profile?.role, designation: profile?.designation, hasRole: (...roles: StaffRole[]) => hasRole(...roles), overrides: menuOverrides, roleModes })

  return { isVisibleForCurrentRole, effectiveRoles: (item: NavItem) => effectiveRoles(item, menuOverrides), loaded, reload, menuOverrides, roleModes }
}
