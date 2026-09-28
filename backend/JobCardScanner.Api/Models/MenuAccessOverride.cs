using System.ComponentModel.DataAnnotations;

namespace JobCardScanner.Api.Models;

// =====================================================================================
// SECTION 155 (2026-09-29) - "for sidebar menu acces provide page make foe which role which menu
// wants to shown a every where" (first asked in the SECTION 153 combined message, backend for it
// only now, once web/src/components/StaffLayout.tsx - the file that actually defines the sidebar,
// NAV_ITEMS and its per-item `roles` arrays - was pasted for the first time this session).
//
// One row per sidebar item, keyed by NavItem.key (a new field added to StaffLayout.tsx's NAV_ITEMS
// - see that file's own doc comment for the full current key list). RolesCsv is a comma-joined
// list of StaffRole names (e.g. "Supervisor,WorkshopManager,DealerAdmin"); an EMPTY string means
// "visible to every staff role", matching NAV_ITEMS[].roles being left undefined in code.
//
// INTERPRETATION, flagged: no row for a given NavKey means "no override yet - use StaffLayout.tsx's
// own hardcoded default `roles` for that item instead" (see StaffLayoutPage's GET /api/menu-access
// consumer). This table only ever OVERRIDES the code default, never replaces it outright - so a
// fresh install with an empty table behaves identically to before this feature existed, and you
// only need to touch the new Admin: Menu Access page for the specific items you actually want to
// change from their shipped default.
// =====================================================================================

public class MenuAccessOverride
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Matches one of StaffLayout.tsx's NAV_ITEMS[].key values exactly (e.g. "dashboard",
    /// "part-upload") - not enforced by a foreign key (there's no server-side table of valid nav
    /// keys, since NAV_ITEMS lives in the frontend bundle), so a typo'd/stale key here just never
    /// matches anything on the frontend rather than erroring.</summary>
    [Required, MaxLength(80)]
    public string NavKey { get; set; } = default!;

    /// <summary>Comma-joined StaffRole names, no spaces (e.g. "Supervisor,DealerAdmin"). Empty
    /// string = every staff role can see this item - see class doc comment.</summary>
    [MaxLength(400)]
    public string RolesCsv { get; set; } = "";

    public string? UpdatedBy { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
