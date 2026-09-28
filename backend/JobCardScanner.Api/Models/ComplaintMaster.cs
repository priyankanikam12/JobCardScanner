using System.ComponentModel.DataAnnotations;

namespace JobCardScanner.Api.Models;

// =====================================================================================
// SECTION 163 (2026-09-30) - "2. Complain master" ... then, mid-turn, explicitly re-confirmed:
// "then also 1 master wants to create for Complaint * we need to fetched from mastertable not
// hardcoded dont want to show that". This replaces web/src/data/serviceCatalog.ts's hardcoded
// COMPLAINTS array (web) and mobile's live GET /api/bapl-dms/complaints call (mobile) - BOTH must
// be repointed at this table's read API (see ComplaintMasterController) so no complaint text is
// ever hardcoded in either app again.
//
// SCOPE, per your answer to "should Complaint Master be per-dealer or one shared list": "One
// shared global list (Recommended)" - so, deliberately, NO DealerId column here. Every dealer's
// Job Card Wizard sees the exact same complaint list. If a future request needs per-dealer
// complaints, that would be a breaking schema change (adding a NOT NULL DealerId retroactively to
// rows a user already populated manually) - flagging that now so it's a conscious choice if it
// comes up later, not a surprise.
//
// Table + read API only (per your answer) - no admin CRUD page. You add/edit rows directly via
// SQL against dbo.ComplaintMasters.
// =====================================================================================

public class ComplaintMaster
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required, MaxLength(300)]
    public string ComplaintText { get; set; } = default!;

    public int SortOrder { get; set; } = 0;

    public bool IsActive { get; set; } = true;

    public Guid? CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedById { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
