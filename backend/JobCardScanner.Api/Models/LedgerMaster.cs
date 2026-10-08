using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

// =====================================================================================
// Ledger Master - the one table behind the Dealer / Company / Insurance / Party ledgers (and any type later added to the Ledger Type master).
//
// 2026-10-06:
//   - The type is now a reference to the LEDGER TYPE MASTER (LedgerTypeMaster: 1 Dealer, 5 Company, 3 Insurance, 4 Party) instead of free text.
//   - Dealer  : copied from the ERP (BAPLDMSvad, customer type 1) by LedgerMasterController.SyncErpLedgersAsync - read-only here. DealerId = the matching row of
//               dbo.Dealers (by BaplDmsDealerCode), or null when that ERP dealer isn't onboarded in this app.
//   - Company : copied from the ERP (customer type 5, "B2B") - read-only, organisation-level (DealerId NULL).
//   - Party / Insurance (and any other plain type): created for a dealer; CorporateAdmin / SystemAdmin choose the dealer.
//   Visibility (DMS rule): everyone sees shared ledgers (IsShared: always Dealer + Company) and their own dealer's; CorporateAdmin / SystemAdmin see all.
//   Schema: sql/2026-10-06_ledger_type_master.sql.
// Deliberately NOT here (earlier decisions): Gender, Occupation, Date of Birth. Created / Updated by-and-when are recorded but not shown.
// =====================================================================================

public class LedgerMaster
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Owning dealer (for a Dealer-type ledger: the dealer it represents). NULL for an org-level type (Company), and for an ERP dealer not onboarded here yet.</summary>
    public Guid? DealerId { get; set; }

    /// <summary>Which Ledger Type master row this ledger is (1 Dealer, 5 Company, 3 Insurance, 4 Party ...).</summary>
    public int LedgerTypeId { get; set; }

    [ForeignKey(nameof(LedgerTypeId))]
    public LedgerTypeMaster? LedgerTypeMaster { get; set; }

    /// <summary>The ERP customer code (e.g. CUS0032) when this ledger was copied from the ERP (Dealer / Company types); null for a ledger created here.</summary>
    [MaxLength(30)]
    public string? ErpCustomerCode { get; set; }

    /// <summary>Generated from the Prefix Master module "ledger-master" (e.g. LED/001) for a ledger created here; for an ERP ledger it is the ERP customer code. Never editable.</summary>
    [Required, MaxLength(40)]
    public string LedgerCode { get; set; } = default!;

    /// <summary>For a Dealer-type ledger this follows dbo.Dealers.Name and cannot be edited here.</summary>
    [Required, MaxLength(200)]
    public string LedgerName { get; set; } = default!;

    [MaxLength(10)] public string? MobileNumber { get; set; }
    [MaxLength(10)] public string? AlternateMobileNo { get; set; }
    [MaxLength(200)] public string? EMail { get; set; }

    [MaxLength(400)] public string? Address { get; set; }
    [MaxLength(400)] public string? Address2 { get; set; }
    [MaxLength(100)] public string? City { get; set; }

    /// <summary>Free text on purpose - compared case-insensitively with the dealer's State to pick CGST+SGST vs IGST, like Customer.State.</summary>
    [MaxLength(100)] public string? State { get; set; }

    [MaxLength(10)] public string? Pin { get; set; }
    [MaxLength(20)] public string? Gstno { get; set; }
    [MaxLength(10)] public string? Pan { get; set; }
    [MaxLength(20)] public string? AadharNumber { get; set; }

    /// <summary>An ERP-sourced ledger (Dealer / Company) that a SystemAdmin edited or deleted here: the ERP copy no longer overwrites it. Reset with
    /// UPDATE dbo.LedgerMasters SET ErpOverride = 0 WHERE Id = ... to let the ERP value flow in again.</summary>
    public bool ErpOverride { get; set; }

    /// <summary>Visible to every dealer. Always true for Dealer and org-level (Company) ledgers; an admin can tick it on any other ledger.</summary>
    public bool IsShared { get; set; }

    /// <summary>Soft delete - same reversible-deactivate convention as the other masters.</summary>
    public bool IsActive { get; set; } = true;

    public Guid? CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedById { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
