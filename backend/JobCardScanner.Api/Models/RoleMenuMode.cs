using System.ComponentModel.DataAnnotations;

namespace JobCardScanner.Api.Models;

// =====================================================================================
// SECTION 170 (2026-09-30) - "menu assign page fix which sidebar access provide oinly that shown
// in sidebar other dont need to see only give 3 sidebar menu acess only in sidebar this 3 option".
//
// PROBLEM this fixes: Models/MenuAccessOverride.cs (SECTION 155) is "fail-open" - an item with no
// restriction, or a role not excluded from one, stays VISIBLE by default. That means checking only
// 3 items for a role on the Admin: Menu Access page never hid the OTHER items from that role - it
// only ever restricted the specific items an admin explicitly touched. To get "only these 3, hide
// everything else" under that model, an admin would have to manually restrict EVERY OTHER nav item
// too, one at a time, and would have to remember to do it again for every NEW nav item added later.
//
// FIX: this table adds an explicit "allow-list mode" flag PER ROLE, independent from
// MenuAccessOverride's per-item rows. When OnlyShowChecked is true for a role, both StaffLayout.tsx
// (web sidebar) and DashboardScreen.tsx (mobile) switch that role from "visible unless excluded" to
// "hidden unless an explicit MenuAccessOverride row for this item lists this role" - see each
// file's own effectiveRoles()/menuVisible() doc comment for the exact logic. An item with NO
// override at all (the "everyone" default) is now correctly treated as HIDDEN for an allow-listed
// role, and so is any FUTURE nav item added later, unless an admin explicitly checks that role for
// it - this is the actual behavior change that makes "only 3 items" durable rather than a one-time
// fix that quietly breaks again the next time a page is added.
//
// One row per StaffRole name (see MenuAccessOverride.cs's own note on the ALL_ROLES list not being
// a confirmed-complete StaffRole enum - same caveat applies here). No row for a role at all means
// OnlyShowChecked=false (today's existing fail-open behavior, completely unchanged) - so a fresh
// install with an empty table behaves identically to before this feature existed, exactly like
// MenuAccessOverride's own convention.
// =====================================================================================

public class RoleMenuMode
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>A StaffRole name (e.g. "DealerAdmin") - not a foreign key (StaffRole is a frontend/
    /// backend enum, not its own table), matching MenuAccessOverride.NavKey's same convention.</summary>
    [Required, MaxLength(40)]
    public string Role { get; set; } = default!;

    /// <summary>false (default) = today's existing fail-open behavior, completely unchanged. true =
    /// this role only sees a nav item when an explicit MenuAccessOverride row for that item lists
    /// this role - see class doc comment.</summary>
    public bool OnlyShowChecked { get; set; } = false;

    public string? UpdatedBy { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
