// mobile\src\navigation\menuRules.ts
import type { StaffRole } from '../types'
import type { NavItem } from './menuItems'

/** Menu Access rows are keyed by the web route; these two are the ones HQ admins always keep (web SECTION 174). */
export const ALWAYS_VISIBLE_KEYS_FOR_HQ_ADMIN = new Set(['dashboard', 'admin-menu-access'])

/** Who is asking, and the Menu Access settings in force - everything isNavItemVisible needs (no React, so it can be tested on its own). */
export interface MenuContext {
  role?: StaffRole | null
  designation?: string | null
  /** web's hasRole(): the role is in the list, or DealerAdmin / CorporateAdmin / SystemAdmin acting as a lower role ("Up" semantics) */
  hasRole: (...roles: StaffRole[]) => boolean
  /** GET /api/menu-access: navKey -> roles (an empty list = everyone) */
  overrides: Record<string, string[]>
  /** GET /api/menu-access/role-modes: role (or Captain / ViceCaptain) -> "only show checked items" */
  roleModes: Record<string, boolean>
}

/** undefined = every staff role. An override that exists but is empty also means "everyone"; no override = the item's own default roles. */
export function effectiveRoles(item: NavItem, overrides: Record<string, string[]>): StaffRole[] | undefined {
  const override = overrides[item.key]
  if (override === undefined) return item.roles
  return override.length > 0 ? (override as StaffRole[]) : undefined
}

/** "Captain" / "ViceCaptain" are Designations, not backend Roles - a saved role list also matches a user whose Designation is one of the two (web SECTION 181). */
function matchesCurrentUser(ctx: MenuContext, roleList: string[]): boolean {
  if ((ctx.designation === 'Captain' || ctx.designation === 'ViceCaptain') && roleList.includes(ctx.designation)) return true
  return !!ctx.role && roleList.includes(ctx.role)
}

/**
 * The visibility rule of web's useMenuAccess().isVisibleForCurrentRole (SECTIONS 155 / 170 / 174 / 180 / 181 / 183), unchanged in behaviour:
 *   1. CorporateAdmin / SystemAdmin always keep Dashboard and Admin: Menu Access;
 *   2. a role in "only show checked items" mode (and, independently, a Captain / ViceCaptain designation in that mode) sees ONLY the items whose saved, non-empty override names it - the shipped
 *      default roles are never consulted while in that mode;
 *   3. everyone else: the item's effective roles (override, else default) - no roles = everyone.
 */
export function isNavItemVisible(item: NavItem, ctx: MenuContext): boolean {
  if ((ctx.role === 'CorporateAdmin' || ctx.role === 'SystemAdmin') && ALWAYS_VISIBLE_KEYS_FOR_HQ_ADMIN.has(item.key)) return true

  const activeAllowListKeys: string[] = []
  if (ctx.role && ctx.roleModes[ctx.role]) activeAllowListKeys.push(ctx.role)
  if ((ctx.designation === 'Captain' || ctx.designation === 'ViceCaptain') && ctx.roleModes[ctx.designation]) activeAllowListKeys.push(ctx.designation)
  if (activeAllowListKeys.length > 0) {
    const override = ctx.overrides[item.key]
    return !!override && override.length > 0 && activeAllowListKeys.some((key) => override.includes(key))
  }

  const roles = effectiveRoles(item, ctx.overrides)
  return !roles || ctx.hasRole(...roles) || matchesCurrentUser(ctx, roles)
}
