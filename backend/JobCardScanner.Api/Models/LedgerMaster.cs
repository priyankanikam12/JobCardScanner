using System.ComponentModel.DataAnnotations;

namespace JobCardScanner.Api.Models;

// =====================================================================================
// SECTION 188 (2026-10-02) "now we work on Ledger master ... create Ledger master for that which
// data we fetched and saved that all in our JobCard DB ... for 3 pages Jobcard, Material Transfer,
// RepairBill ... only 4 types in dropdown Company, Dealer, Party, Insurance ... company and dealer
// fetch from Erp which already we fetch ... work on Party and Insurance ... dont want Gender,
// Occupation, DOB ... Created By/Created DateTime/Updated By/Updated DateTime dont show on ui that
// main in backend just create like that".
//
// Confirmed via AskUserQuestion:
//   - THIS TABLE stores ONLY locally-created "Party" and "Insurance" ledger rows. "Company" and
//     "Dealer" are NOT stored here - those two Ledger Type options are meant to be read LIVE from
//     your ERP via IBaplDealerService (already registered in Program.cs, already used in
//     JobCardsController.cs for parts catalog search) - but BaplDealerService.cs's actual source has
//     never been pasted into this session, so its Company/Dealer lookup method(s) are unknown and
//     NOT wired yet. LedgerMasterController.cs below does not expose Company/Dealer at all for now;
//     LedgerMasterPage.tsx shows a "Coming soon" note for those two Ledger Type options until that
//     file is provided - see that page's own doc comment.
//   - LedgerCode is auto-generated on insert using the EXISTING Prefix Master / DocNumberSequence
//     mechanism (DocPrefixMasterController.cs/Models/DocPrefixMaster.cs, built earlier this
//     session) under a new ModuleKey "ledger-master", Prefix "LED", UsesFinancialYear=false (matches
//     your "Financial Year is not required" SECTION 184 decision) - see
//     LedgerMasterController.ConsumeNextLedgerCodeAsync. This is the first real "consume and
//     reserve a number" writer against DocNumberSequences in the whole app - DocPrefixMasterController's
//     own Preview() endpoint deliberately never reserves anything.
//   - CreatedById/CreatedAt/UpdatedById/UpdatedAt are NOT shown on the UI (per your instruction) but
//     ARE still recorded automatically server-side, using this app's own established Guid?/DateTime
//     FK-to-Users convention (same as DocPrefixMaster, ComplaintMaster, ServiceMenuMaster) - NOT the
//     DMS reference's plain `string CreatedBy` + `DateTime.Now`, which doesn't match this app's own
//     pattern.
//   - Gender/Occupation/DateOfBirth are DROPPED ENTIRELY (not just hidden) - fields you explicitly
//     said you don't want, and which only ever applied to DMS's "Party" ledger type for KYC-style
//     individual-customer capture, not relevant here.
//   - "Fuller set" fields confirmed via AskUserQuestion: MobileNumber, AlternateMobileNo, EMail,
//     Address, Pin, Gstno, Pan, AadharNumber. City/State are SKIPPED (also confirmed) -
//     JobCardScanner's own DB has no City/State master tables, unlike the DMS reference which joins
//     to its own Cities/States lookup tables - these would need to be free-text if ever added later.
//
// SECTION 189 (2026-10-02) "same ui give like which i give code of dms" - your screenshot of the
// real DMS Customer Ledger page showed every row scoped to a Dealer Code, with a SuperAdmin-only
// Dealer Code filter. This table had NO DealerId at all until now - a real gap, not a style choice
// - confirmed via AskUserQuestion: Party/Insurance ledgers ARE scoped per dealer, same convention as
// every other table in this app (JobCard.DealerId, Technician.DealerId, PartUpload.DealerId, ...).
// DealerId is required (not nullable) - every ledger belongs to exactly one dealer. See
// LedgerMasterController.cs for how CorporateAdmin/SystemAdmin (org-wide roles) pick a dealer
// explicitly on create and can filter/see across all dealers, while every other role is always
// forced to their own _currentUser.DealerId server-side (never trusts a client-supplied DealerId).
// =====================================================================================

/// <summary>One locally-created "Party" or "Insurance" ledger entry - see the file-level doc comment
/// above for the full reasoning, especially around what is deliberately NOT in this table (Company/
/// Dealer rows, Gender/Occupation/DOB, City/State).</summary>
public class LedgerMaster
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>SECTION 189 - which dealer this ledger belongs to. Required, never nullable - set
    /// server-side on Create, either forced to the creating user's own dealer (every role except
    /// CorporateAdmin/SystemAdmin) or explicitly chosen from a dealer dropdown (CorporateAdmin/
    /// SystemAdmin, who have no dealer of their own) - see LedgerMasterController.Create.</summary>
    public Guid DealerId { get; set; }

    /// <summary>Only "Party" or "Insurance" - validated in LedgerMasterController.Create/Update
    /// against exactly these two values. Not an enum so a 3rd locally-created type could be added
    /// later without a schema change (unlike "Company"/"Dealer", which are never meant to be rows in
    /// this table at all - see class doc comment).</summary>
    [Required, MaxLength(20)]
    public string LedgerType { get; set; } = default!;

    /// <summary>Auto-generated on insert via the Prefix Master "ledger-master" module (e.g.
    /// "LED/001") - never editable afterward, same convention as every other document number in this
    /// app.</summary>
    [Required, MaxLength(40)]
    public string LedgerCode { get; set; } = default!;

    [Required, MaxLength(200)]
    public string LedgerName { get; set; } = default!;

    [MaxLength(10)]
    public string? MobileNumber { get; set; }

    [MaxLength(10)]
    public string? AlternateMobileNo { get; set; }

    [MaxLength(200)]
    public string? EMail { get; set; }

    [MaxLength(400)]
    public string? Address { get; set; }

    [MaxLength(10)]
    public string? Pin { get; set; }

    [MaxLength(20)]
    public string? Gstno { get; set; }

    [MaxLength(10)]
    public string? Pan { get; set; }

    [MaxLength(20)]
    public string? AadharNumber { get; set; }

    /// <summary>SOFT delete flag - same reversible-deactivate convention as ComplaintMaster/
    /// ServiceMenuMaster/DocPrefixMaster (IsActive=false via DELETE, reversible via PUT
    /// isActive=true) rather than a hard row delete, since a ledger already referenced elsewhere
    /// (once Jobcard/Material Transfer/RepairBill actually start pointing at LedgerMaster rows -
    /// not yet wired, see class doc comment) should never disappear outright.</summary>
    public bool IsActive { get; set; } = true;

    public Guid? CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedById { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
