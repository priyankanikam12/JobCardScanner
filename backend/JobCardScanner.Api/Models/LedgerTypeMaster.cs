using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

/// <summary>
/// Ledger Type master (2026-10-06): Id / CustomerType - 1 Dealer, 5 Company, 3 Insurance, 4 Party. The Ledger Type filter and the Add form of the Ledger
/// Master page are built from this table, and every LedgerMaster row points at it by LedgerTypeId. A new type is one more row: with every flag false it
/// behaves like Party / Insurance (a normal per-dealer ledger).
/// Tables: sql/2026-10-06_ledger_type_master.sql, then sql/2026-10-06_ledger_erp_sourced.sql.
/// </summary>
[Table("LedgerTypeMasters")]
public class LedgerTypeMaster
{
    [DatabaseGenerated(DatabaseGeneratedOption.None)]
    public int Id { get; set; }

    /// <summary>The name shown in the UI ("Dealer", "Company", "Insurance", "Party"). Unique.</summary>
    [Required, MaxLength(50)]
    public string CustomerType { get; set; } = default!;

    /// <summary>Ledgers of this type are COPIED from the ERP (BAPLDMSvad C_CustomerMaster, picked by <see cref="ErpCustomerTypeId"/>) and are read-only here (Dealer, Company).</summary>
    public bool IsErpSourced { get; set; }

    /// <summary>The ERP's C_CustomerTypeMaster.Id this type is fetched from: 1 = Dealer, and 5 = "B2B", which is our "Company". Null for a type that is not ERP-sourced.</summary>
    public int? ErpCustomerTypeId { get; set; }

    /// <summary>Optional comma-separated ERP customer codes to copy for this type (e.g. "CUS0032" for Company - only BGAUSS AUTO PRIVATE LIMITED is a Company, although the
    /// ERP files many customers under customer type 5 / B2B). Null or blank = every customer of <see cref="ErpCustomerTypeId"/>. Ledgers of this type that are not in the list are
    /// removed by the next sync.</summary>
    [MaxLength(400)]
    public string? ErpCustomerCodes { get; set; }

    /// <summary>Organisation-level: no dealer, always visible to everyone, only CorporateAdmin / SystemAdmin may change it (Company).</summary>
    public bool IsOrgLevel { get; set; }

    /// <summary>false hides the type from the dropdowns without touching the ledgers already of that type.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}