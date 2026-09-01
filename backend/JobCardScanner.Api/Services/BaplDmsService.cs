using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;

namespace JobCardScanner.Api.Services;

/// <summary>One active dealer/workshop row read from BAPL DMS's own DealerMaster (separate
/// database - BAPLDMSvadConnection - and a separate table from BaplDealerService's
/// C_CustomerMaster, which lives in the BAPL ERP data warehouse instead).</summary>
public record BaplDmsDealerRow(
    string DealerCode,
    string DealerName,
    string City,
    string State,
    string Mobile,
    string Email,
    string ContactPerson);

/// <summary>Everything BAPL DMS knows about one vehicle by chassis/registration number - the
/// "auto fetch everything" payload for the Job Card Wizard, modeled directly on BAPL DMS's own
/// JobCardRepo.GetAllInspectedLotChassisAsync/LotInspectionChassisVM (ported to a single-vehicle
/// lookup - see BaplDmsService.LookupVehicleAsync for the port notes).</summary>
public record BaplDmsVehicleRow(
    string ChassisNo,
    string? RegisterNo,
    string? ModelName,
    string? CustomerName,
    string? CustomerMobile,
    string? BatteryNumber,
    string? MotorNo,
    string? ControllerNo,
    string? ConverterNo,
    string? ChargerNumber,
    DateOnly? SaleDate,
    DateOnly? InsuranceExpDate,
    DateOnly? NextServiceDueDate,
    int? VehiclePrevKms,
    decimal? OdoReading,
    decimal? Duration,
    string? DurationType,
    DateOnly? ExpireWarrantyDate,
    bool IsSold,
    // ---- Added when the lookup was rewritten to source from ChassisDetails/LedgerMaster (BAPL
    // DMS's own vehicle master) instead of only from past job card history - see LookupVehicleAsync.
    // Appended at the end with defaults so existing positional callers don't break. ----
    string? CustomerCity = null,
    int? CustomerLedgerId = null,
    /// <summary>BAPL DMS's LocationMaster.Loccode this vehicle/chassis is registered against
    /// (ChassisDetails.LocationCode) - used to pre-select the Service Location dropdown.</summary>
    string? LocationCode = null,
    string? DealerCode = null,
    /// <summary>Best-effort LedgerMaster.Address/Email for the "(Registered customer Details)"
    /// panel - UNLIKE the other columns in this record, "Address"/"Email" are NOT confirmed via a
    /// `SELECT *` you ran against LedgerMaster (only LedgerName/MobileNumber/City/Id are). Fetched
    /// in a separate best-effort query (see LookupVehicleAsync) that's allowed to fail silently -
    /// if these column names turn out to be wrong, these two fields simply stay null instead of
    /// breaking the vehicle lookup that already works. Run `SELECT TOP 3 * FROM LedgerMaster` and
    /// tell me the real column names if these keep coming back empty.</summary>
    string? CustomerAddress = null,
    string? CustomerEmail = null);

/// <summary>One workshop/service location row from BAPL DMS's own LocationMaster - filtered to the
/// "W" series (Loccode ending in W&lt;digits&gt;, e.g. "CUS0435W1") per your own workshops, as
/// opposed to the "S" (showroom) and "G" (godown/stock point) series LocationMaster also holds for
/// the same dealer. Confirmed via `SELECT * FROM LocationMaster` you ran directly.</summary>
public record BaplDmsWorkshopRow(string LocCode, string LocName, string City, string State, string DealerCode);

/// <summary>One row from BAPL DMS's JobType master (confirmed via `SELECT * FROM JobType`) - the
/// Job Type dropdown's source, first level of the JobType -&gt; ServiceHead -&gt; ServiceType cascade.</summary>
public record BaplDmsJobTypeRow(int Id, string Name);

/// <summary>One row from BAPL DMS's ServiceHead master (confirmed via `SELECT * FROM ServiceHead`),
/// scoped to one JobTypeId - the Service Head dropdown's source, dependent on the Job Type picked.</summary>
public record BaplDmsServiceHeadRow(int Id, int JobTypeId, string Name);

/// <summary>One row from BAPL DMS's ServiceType master (confirmed via `SELECT * FROM ServiceType`),
/// scoped to one ServiceHeadId - the Service Type dropdown's source, dependent on the Service Head
/// picked.</summary>
public record BaplDmsServiceTypeRow(int Id, int ServiceHeadId, string Name);

/// <summary>One row from BAPL DMS's ComplaintMaster (confirmed via `SELECT * FROM ComplaintMaster`)
/// - the "Customer complaints / concerns" dropdown's source. Status is filtered to active (1) rows
/// only.</summary>
public record BaplDmsComplaintRow(int Id, string Name, int? GroupName);

/// <summary>One row from BAPL DMS's JobSource master (confirmed via `SELECT * FROM JobSource`:
/// Walk In, RSA, Mega Camp, Others, ...) - replaces the wizard's old hardcoded WalkIn/PickupAndDrop/
/// Breakdown/Scheduled/Online "Source" dropdown, which was JobCardScanner's own invented list, not
/// anything BAPL DMS actually tracks.</summary>
public record BaplDmsJobSourceRow(int Id, string Name);

/// <summary>Everything needed to write one new job card into BAPL DMS's own database - modeled
/// directly on BAPL DMS's own JobCardRepo.InsertJobCardinfoDetails (pasted into this project's chat
/// history for reference), covering the JobCardHeader/JobCardCustomer/JobCardBatteryDetail/
/// JobCardComplaint columns that repo actually populates on insert. See
/// BaplDmsService.CreateJobCardAsync for what's intentionally left out (columns that repo's
/// ViewModel carries but the Job Card Wizard has no equivalent input for, e.g. AirpressureRearTyre)
/// and the doc comment there on why this is a best-effort sync, not a guaranteed one.</summary>
public record BaplDmsCreateJobCardRequest(
    string DealerCode,
    int JobTypeId,
    int ServiceHeadId,
    string ServiceHeadName,
    int ServiceTypeId,
    string ServiceTypeName,
    string? ServiceLocationCode,
    string ChassisNo,
    string? RegisterNo,
    string? ModelName,
    int VehicleKms,
    string? Supervisor,
    string? Technician,
    string? ManualJobNo,
    string? CustomerName,
    string? CustomerMobile,
    int? CustomerLedgerId,
    string? MotorNo,
    string? BatteryNo,
    string? ControllerNo,
    string? ConverterNo,
    string? ChargerNo,
    DateOnly? SaleDate,
    DateOnly? InsuranceExpDate,
    DateOnly? NextServiceDueDate,
    DateTime? ExpectedDeliveryAt,
    IReadOnlyList<string> Complaints,
    string CreatedBy,
    /// <summary>BAPL DMS's own JobSource.Id (Walk In/RSA/Mega Camp/...), replacing the previously
    /// hardcoded 1 ("Walk In") written to JobCardHeader.JobSource. Still defaults to 1 when not
    /// supplied, so existing callers keep working unchanged.</summary>
    int? JobSourceId = null,
    /// <summary>JobCardScanner's own Normal/High/Urgent priority, written to a NEW Priority column
    /// on BAPL DMS's own JobCardHeader (see add-bapldms-jobcardheader-priority-column.sql). This
    /// column did NOT exist before - if that migration hasn't been run against BAPLDMSvad yet, the
    /// insert below will fail with "Invalid column name 'Priority'" and this whole write-back will
    /// report as Failed (non-blocking - the local job card still saves either way) until it's run.</summary>
    string? Priority = null);

/// <summary>Result of a successful BAPL DMS job card insert - JobCardHeaderId lets JobCardScanner's
/// own JobCard row remember which BAPL DMS record it created (JobCard.BaplJobCardHeaderId), so the
/// Job Card Detail page can link straight to it the same way a BaplDms-sourced /jobcards row does.</summary>
public record BaplDmsCreateJobCardResult(int JobCardHeaderId, int JobNo);

/// <summary>One past visit for a chassis, straight from BAPL DMS's own job card history - the
/// "Service History" section on JobCardScanner's own Job Card Detail page (see
/// BaplDmsService.GetServiceHistoryAsync).</summary>
/// <summary>One row for the /jobcards list page's merged view (JobCardScanner's own job cards +
/// BAPL DMS's) - deliberately narrower than BaplDmsJobCardHistoryRow (no Complaints aggregate,
/// since a list of many rows doing a STRING_AGG subquery per row is unnecessary work for a browse
/// view) but includes customer/vehicle columns that history doesn't need since it's already scoped
/// to one chassis. See BaplDmsService.SearchJobCardsAsync.</summary>
public record BaplDmsJobCardListRow(
    int JobCardHeaderId,
    int? JobNo,
    string? JobPrefix,
    DateOnly? JobInDate,
    string? JobStatus,
    string? DealerCode,
    string? CustomerName,
    string? CustomerMobile,
    string? ModelName,
    string? ChassisNo,
    string? RegisterNo,
    string? Supervisor,
    string? Technician);

/// <summary>Full read-only detail for one BAPL DMS job card, by its JobCardHeaderId - powers the
/// read-only "BAPL DMS Job Card" view a merged /jobcards list row links to (see
/// BaplDmsService.GetJobCardByIdAsync and the /jobcards/bapl/:id page). A superset of
/// BaplDmsJobCardListRow/BaplDmsJobCardHistoryRow's columns - all still the confirmed
/// JobCardHeader/JobCardCustomer/JobCardBatteryDetail/JobCardComplaint schema, just more of it.</summary>
public record BaplDmsJobCardDetailRow(
    int JobCardHeaderId,
    int? JobNo,
    string? JobPrefix,
    DateOnly? JobInDate,
    string? JobStatus,
    string? InwardType,
    int? VehicleKms,
    string? Supervisor,
    string? Technician,
    string? InvoiceNo,
    string? DealerCode,
    string? CustomerName,
    string? CustomerMobile,
    string? CustomerAltMobile,
    string? ModelName,
    string? ChassisNo,
    string? RegisterNo,
    string? MotorNo,
    string? BatteryNo,
    DateOnly? SaleDate,
    DateOnly? InsuranceExpDate,
    DateOnly? NextServiceDueDate,
    DateOnly? RsaRenewalDate,
    string? Remarks,
    string? ControllerNo,
    string? ConverterNo,
    string? ChargerNo,
    string? Complaints);

/// <summary>One repair bill row from BAPL DMS's own RepairBillHeader, scoped to one JobCardHeaderId
/// - for the Job Card Detail page's "Download Invoice from DMS" panel. Deliberately narrow: Id/
/// RepairbillStatus/TotalNetAmount/JobId are the only RepairBillHeader columns already confirmed
/// safe (they're used unchanged in SearchJobCardsAsync/GetJobCardByIdAsync's JobStatus CASE
/// expression) - a "Bill No." column (item.billNo in your pasted repair-bill-list.ts) was NOT
/// independently confirmed, so it's deliberately left out rather than guessed.</summary>
public record BaplDmsRepairBillRow(int Id, string? RepairBillStatus, decimal? TotalNetAmount);

/// <summary>One item's available stock at one workshop location, from BAPL DMS's own PartsInventory
/// - for the Job Card Detail page's "Part Suggestion" panel (and now the general Parts &amp;
/// Inventory catalog - see PartsController.Search). CONFIRMED business rule (you ran
/// `SELECT * FROM PartsInventory` and shared the full column list plus three real rows): each
/// physical batch of an item accumulates transaction rows (TransType 'P' purchase-in / 'S' sale-out,
/// each carrying that batch's BatchOpeningQty/BatchTransQty/BatchClosingQty), and exactly one row
/// per batch is marked FinalStockFlag = 'Y' - the batch's current/latest state. Example confirmed
/// from your data: item 22GE370010AS at CUS0435W1 has a 'P' row (closing qty 1, Flag 'N' - since a
/// later row supersedes it) followed by an 'S' row (closing qty 0, Flag 'Y') - so its real available
/// qty is correctly 0 (sold out), which HAVING SUM(...) > 0 below excludes entirely, exactly as it
/// should. Summing BatchClosingQty across every Flag='Y' row per ItemCode (one such row per batch)
/// therefore gives the item's true total remaining stock across all its batches at that location.</summary>
public record BaplDmsPartStockRow(string ItemCode, int AvailableQty);

/// <summary>One labour rate-card row from BAPL DMS's own LabourMaster, for the Job Card Detail
/// page's "Labour Suggestion" panel - mirrors BaplDmsPartStockRow's role for Part Suggestion.
/// CONFIRMED schema (you ran `SELECT * FROM LabourMaster` and shared the full column list plus
/// real rows): LabourCode/LabourDescription/LabourRate/Sgst/Cgst/Igst/HsnCode/Category all
/// populated on every row; JobTypeId/ServiceHeadId/ServiceTypeId (LabourMaster's own
/// Jobtype/ServiceHead/ServiceType columns) are the SAME master ids as JobCard's own
/// BaplJobTypeId/BaplServiceHeadId/BaplServiceTypeId (confirmed by matching values, e.g. a row with
/// Jobtype=3/ServiceHead=3/ServiceType=3) - but are NULL on most existing rows (BAPL DMS's own data
/// hasn't mapped every labour code to the cascade yet), so GetLabourAsync's cascade filter only
/// EXCLUDES a row that has a value there AND it doesn't match the requested id - a row with NULL
/// Jobtype/ServiceHead/ServiceType always passes through regardless of the cascade, since most of
/// LabourMaster is unmapped and hiding it by default made the panel look empty. Always combined
/// with (not replaced by) the free-text search on top. IsActive
/// mirrors LabourMaster's own isLabourActive column, which is NULL (not 0) on many legacy rows -
/// treated as active (not excluded) since NULL here means "never explicitly deactivated", not
/// "inactive".</summary>
public record BaplDmsLabourRow(
    int Id,
    string LabourCode,
    string? LabourDescription,
    string? HsnCode,
    decimal? Sgst,
    decimal? Cgst,
    decimal? Igst,
    decimal? LabourRate,
    string? Category,
    int? JobTypeId,
    int? ServiceHeadId,
    int? ServiceTypeId,
    string? OemModelName);

/// <summary>Full RepairBillHeader row for one BAPL DMS job (RepairBillHeader.JobId), for the
/// "Download Invoice from DMS" PDF (see InvoicePdfService.BuildInvoicePdfAsync). Wider than the
/// existing <see cref="BaplDmsRepairBillRow"/> (which only exposes Id/RepairbillStatus/
/// TotalNetAmount for the repair-bill-list panel) - every column here (LocationCode, Prefix,
/// BillNo, BillType, JobId, CustomerLedgerId, TotalDiscount, TotalTaxableAmount, TotalNetAmount,
/// AmountReceived, RepairbillStatus, Id) comes from the RepairBillHeader schema you pasted directly
/// from your own EF Core model - trusted, not guessed. See GetRepairBillHeaderDetailAsync.</summary>
public record BaplDmsRepairBillHeaderDetail(
    int Id,
    int JobId,
    string? LocationCode,
    string? Prefix,
    int? BillNo,
    string? BillType,
    int? CustomerLedgerId,
    decimal? TotalDiscount,
    decimal? TotalTaxableAmount,
    decimal? TotalNetAmount,
    decimal? AmountReceived,
    string? RepairBillStatus);

/// <summary>One RepairBillDetail line (a part OR a labour charge - see ItemType/Part*/Labour*
/// columns) for one RepairBillHeader, for the "Download Invoice from DMS" PDF's line-items table.
/// Every column here comes from the RepairBillDetail schema pasted directly from your own EF Core
/// model - trusted, not guessed. Deliberately does NOT carry the row's own Id/RepairBillId (those
/// weren't in the confirmed column list you pasted, and aren't needed - InvoicePdfService numbers
/// rows 1..n itself for the "Sr" column). ItemType's own convention (what value means "this is a
/// part" vs "this is labour") was NOT confirmed anywhere in this codebase, so
/// InvoicePdfService.ClassifyLine does NOT trust it blindly - it infers part-vs-labour from
/// whichever of PartItemId/LabourMasterId is actually populated instead, and only falls back to
/// ItemType's text (if it looks like a real label, not a numeric code) as a tie-breaker.</summary>
public record BaplDmsRepairBillDetailRow(
    int? MaterialId,
    int? LabourMasterId,
    int? PartWiseLabourId,
    int? PartItemId,
    string? ItemType,
    decimal? LabourQty,
    decimal? PartQty,
    decimal? LabourRate,
    decimal? PartRate,
    decimal? DiscountValue,
    decimal? LabourDiscount,
    decimal? PartDiscount,
    string? DiscountType,
    decimal? Igstamount,
    decimal? Cgstamount,
    decimal? Sgstamount,
    int? IssutypeId,
    decimal? LabourTaxblAmount,
    decimal? PartTaxblAmount,
    decimal? LabourNetAmount,
    decimal? PartNetAmount,
    decimal? TotalTaxPer);

/// <summary>Customer/ledger detail for the invoice PDF's "Customer Details" panel, by
/// LedgerMaster.Id (RepairBillHeader.CustomerLedgerId). Name/Mobile/City are the same confirmed
/// LedgerMaster/Cities columns LookupVehicleAsync already uses; Address/Email reuse that same
/// method's already-proven best-effort guess (see its doc comment); State/Gstin are a NEW,
/// separately isolated best-effort guess - LedgerMaster was never confirmed to carry either column,
/// so if this query throws (wrong column name), State/Gstin simply come back null and the PDF
/// prints "-" for both instead of failing to render at all. See GetCustomerLedgerDetailAsync.</summary>
public record BaplDmsCustomerLedgerDetail(
    int LedgerId,
    string? Name,
    string? Mobile,
    string? City,
    string? Address,
    string? Email,
    string? State,
    string? Gstin);

/// <summary>Result of a successful BAPL DMS credential check against BAPL DMS's own AspNetUsers
/// (standard ASP.NET Core Identity table) - see VerifyDealerCredentialsAsync. Deliberately narrow:
/// just enough to auto-provision/reuse a local Users row for the dealer-login fallback in
/// DealerAuthController.Login, never the password hash itself.
/// DealerCode is a CONFIRMED custom column on this AspNetUsers table (you ran
/// `SELECT TOP 3 * FROM AspNetUsers` and shared it - e.g. "CUS0001") - BAPL DMS's own DealerMaster
/// dealer code this login belongs to. It's null for some rows (e.g. internal BAPL staff accounts
/// with no dealer of their own), in which case DealerAuthController.Login can't resolve a Dealer
/// and falls back to its inactive/pending-assignment safety net.
/// IsBgEmployeeRole is true when this AspNetUsers row carries BAPL DMS's own "Employee" role
/// (AspNetUserRoles/AspNetRoles - confirmed via your AspNetRoles dump). BAPL DMS's own
/// AuthController.Login branches on exactly this role: an "Employee" account's dealer scope comes
/// from BgEmployeeMaster/EmployeeMaster (by email, possibly MULTIPLE comma-separated dealer codes),
/// never from this row's own DealerCode column - see ResolveEmployeeDealerScopeAsync.
/// DealerAuthController.Login checks this flag first and, when true, ignores DealerCode entirely
/// in favor of that lookup.</summary>
public record BaplDmsDealerCredential(string Email, string? UserName, string? Phone, string? DealerCode, bool IsBgEmployeeRole);

/// <summary>Result of resolving a BAPL DMS "Employee"-role AspNetUsers row to its dealer scope, via
/// BgEmployeeMaster (checked first) or EmployeeMaster (fallback) - mirrors BAPL DMS's own
/// AuthController.ResolveEmployeeLoginInfo (you pasted its real source). Found=false means neither
/// table has a row for this email at all (BAPL DMS's own login would also reject this). IsActive
/// mirrors that row's own IsActive column - an inactive BG employee is rejected the same way BAPL
/// DMS's own login rejects them. DealerCodes is BgEmployeeMaster.DealerCode split on commas (can be
/// 0, 1, or several codes - e.g. "CUS0347,CUS0440" for a regional/zone employee covering multiple
/// dealers) or EmployeeMaster's single DealerCode wrapped in a 1-item list.</summary>
public record BaplDmsEmployeeScope(bool Found, bool IsActive, IReadOnlyList<string> DealerCodes);

public record BaplDmsJobCardHistoryRow(
    int JobCardHeaderId,
    int? JobNo,
    string? JobPrefix,
    DateOnly? JobInDate,
    string? JobStatus,
    string? InwardType,
    int? VehicleKms,
    string? Supervisor,
    string? Technician,
    string? InvoiceNo,
    string? Complaints);

public interface IBaplDmsService
{
    /// <summary>Live search of BAPL DMS's active dealers by name/code (min 2 chars), for the Job
    /// Card Wizard's "search Dealer / Workshop" picker. Throws <see cref="InvalidOperationException"/>
    /// if BAPLDMSvadConnection isn't configured or the query fails.</summary>
    Task<IReadOnlyList<BaplDmsDealerRow>> SearchDealersAsync(string q, CancellationToken ct = default);

    /// <summary>
    /// Looks up one vehicle by chassis number, registration number, or customer mobile number.
    /// Primary source is BAPL DMS's own job card history (JobCardHeader/JobCardCustomer/
    /// JobCardBatteryDetail - table and column names confirmed directly against your database, not
    /// guessed) - the most recent job card for a matching chassis/reg-no/mobile. If nothing has ever
    /// been serviced there, this falls back to BAPL's "inspected lot" tables (LotinspectionHeader/
    /// ChassisDetail/...) for a brand-new, not-yet-sold vehicle - those table/column names are NOT
    /// independently confirmed, so a failure there is logged and swallowed rather than surfaced,
    /// since the primary query already succeeded (there's just nothing more to add).
    /// When <paramref name="dealerCode"/> is given, results are scoped to that dealer; when it's
    /// null, every dealer is searched, which is safe here because the caller is always searching by
    /// an already-specific chassis/reg no/mobile, not browsing a whole inventory.
    /// Returns null ONLY for a genuine "ran fine, zero rows anywhere" - a failure in the PRIMARY
    /// query (wrong table/column name, network, credentials, ...) throws
    /// <see cref="InvalidOperationException"/> instead of silently reporting "not found", so a real
    /// problem surfaces as a 502 with the actual SQL error instead of looking like missing data.
    /// </summary>
    Task<BaplDmsVehicleRow?> LookupVehicleAsync(string value, string? dealerCode, CancellationToken ct = default);

    /// <summary>
    /// This chassis's past job cards in BAPL DMS (JobCardHeader/JobCardCustomer/JobCardComplaint),
    /// most recent first - for the "Service History" section on the Job Card Detail page. Throws
    /// <see cref="InvalidOperationException"/> on a real failure (same reasoning as
    /// LookupVehicleAsync's primary query - this schema is confirmed, so an error here is real).
    /// </summary>
    Task<IReadOnlyList<BaplDmsJobCardHistoryRow>> GetServiceHistoryAsync(string chassisNo, string? dealerCode, CancellationToken ct = default);

    /// <summary>
    /// Browse/search across BAPL DMS's own job cards (JobCardHeader/JobCardCustomer - same
    /// confirmed schema as LookupVehicleAsync's primary query and GetServiceHistoryAsync), for
    /// blending into the /jobcards list page alongside JobCardScanner's own records (see
    /// JobCardsController.List). <paramref name="q"/> matches chassis no., registration no.,
    /// customer name/mobile, or job number - optional, pass null/empty for an unfiltered browse.
    /// <paramref name="dealerCode"/> scopes to one dealer; null searches every dealer, which
    /// JobCardsController.List only ever does for CorporateAdmin/SystemAdmin (same cross-dealer
    /// visibility they already have over JobCardScanner's own data) - a dealer-scoped caller whose
    /// local Dealer row has no BaplDmsDealerCode should skip calling this entirely rather than pass
    /// null, since that would show every dealer's BAPL DMS job cards to a single-dealer user.
    /// Throws <see cref="InvalidOperationException"/> on a real failure (confirmed schema, same
    /// reasoning as the other two methods above) - the list page treats that as "BAPL DMS is
    /// unavailable right now" and still shows JobCardScanner's own rows.
    /// </summary>
    Task<IReadOnlyList<BaplDmsJobCardListRow>> SearchJobCardsAsync(string? q, string? dealerCode, int take, CancellationToken ct = default);

    /// <summary>
    /// Full read-only detail for one BAPL DMS job card by its JobCardHeaderId - what a BAPL DMS row
    /// on the /jobcards list links to, since there's no JobCardScanner record to open for one.
    /// Returns null for a genuine "no such id"; throws <see cref="InvalidOperationException"/> on a
    /// real failure (confirmed schema, same reasoning as the other methods above).
    /// </summary>
    Task<BaplDmsJobCardDetailRow?> GetJobCardByIdAsync(int jobCardHeaderId, CancellationToken ct = default);

    /// <summary>Active workshop locations from BAPL DMS's own LocationMaster, filtered to the "W"
    /// series (Loccode ending in W&lt;digits&gt;) - i.e. actual workshops, not showrooms ("S") or
    /// godowns ("G") that the same table also holds. <paramref name="dealerCode"/> scopes to one
    /// dealer; null browses every dealer's workshops (only used for a free-text search, never for
    /// the per-dealer Service Location dropdown). Throws <see cref="InvalidOperationException"/> on
    /// a real failure.</summary>
    Task<IReadOnlyList<BaplDmsWorkshopRow>> GetWorkshopsAsync(string? dealerCode, string? q, CancellationToken ct = default);

    /// <summary>BAPL DMS's JobType master, for the wizard's Job Type dropdown (first level of the
    /// JobType -&gt; ServiceHead -&gt; ServiceType cascade).</summary>
    Task<IReadOnlyList<BaplDmsJobTypeRow>> GetJobTypesAsync(CancellationToken ct = default);

    /// <summary>BAPL DMS's ServiceHead master scoped to one JobTypeId, for the wizard's Service Head
    /// dropdown (second level of the cascade - populated only after a Job Type is picked).</summary>
    Task<IReadOnlyList<BaplDmsServiceHeadRow>> GetServiceHeadsAsync(int jobTypeId, CancellationToken ct = default);

    /// <summary>BAPL DMS's ServiceType master scoped to one ServiceHeadId, for the wizard's Service
    /// Type dropdown (third level of the cascade - populated only after a Service Head is picked).</summary>
    Task<IReadOnlyList<BaplDmsServiceTypeRow>> GetServiceTypesAsync(int serviceHeadId, CancellationToken ct = default);

    /// <summary>BAPL DMS's active ComplaintMaster rows, for the "Customer complaints / concerns"
    /// dropdown.</summary>
    Task<IReadOnlyList<BaplDmsComplaintRow>> GetComplaintsAsync(CancellationToken ct = default);

    /// <summary>BAPL DMS's JobSource master (Walk In/RSA/Mega Camp/...), for the wizard's "Source"
    /// dropdown - replaces the WalkIn/PickupAndDrop/Breakdown/Scheduled/Online list that used to be
    /// hardcoded there (JobCardScanner's own invented values, not anything BAPL DMS tracks).</summary>
    Task<IReadOnlyList<BaplDmsJobSourceRow>> GetJobSourcesAsync(CancellationToken ct = default);

    /// <summary>
    /// Writes one new job card into BAPL DMS's own database (JobCardHeader/JobCardCustomer/
    /// JobCardBatteryDetail/JobCardComplaint), mirroring BAPL DMS's own JobCardRepo.
    /// InsertJobCardinfoDetails in a single transaction. This is a BEST-EFFORT sync called only
    /// AFTER JobCardScanner's own local job card is already saved - a failure here throws
    /// <see cref="InvalidOperationException"/>, which the caller (JobCardsController.Create) catches
    /// and surfaces as a warning on an otherwise-successful response, never as a reason to fail or
    /// roll back the local job card. See the doc comment on CreateJobCardAsync's implementation for
    /// exactly which columns/defaults this fills in and which ones are still guesses (JobNo
    /// generation, CreatedBy's format, Jobprefix) since they could only be inferred from your pasted
    /// repository code, not independently confirmed against a live insert.
    /// </summary>
    Task<BaplDmsCreateJobCardResult> CreateJobCardAsync(BaplDmsCreateJobCardRequest req, CancellationToken ct = default);

    /// <summary>Repair bill(s) BAPL DMS has for this job card (RepairBillHeader.JobId), for the
    /// "Download Invoice from DMS" panel on the Job Card Detail page. Empty list is normal (no bill
    /// raised yet); throws <see cref="InvalidOperationException"/> on a real failure.</summary>
    Task<IReadOnlyList<BaplDmsRepairBillRow>> GetRepairBillsForJobAsync(int jobCardHeaderId, CancellationToken ct = default);

    /// <summary>Available stock per item at one workshop location, from BAPL DMS's own
    /// PartsInventory - for the "Part Suggestion" panel and the general Parts &amp; Inventory
    /// catalog page. See <see cref="BaplDmsPartStockRow"/>'s doc comment for the (now confirmed via
    /// a live SELECT *) "available" rule this uses.</summary>
    Task<IReadOnlyList<BaplDmsPartStockRow>> GetPartsInventoryAsync(string locationCode, CancellationToken ct = default);

    /// <summary>Active labour rate-card rows from BAPL DMS's own LabourMaster, for the "Labour
    /// Suggestion" panel - see BaplDmsLabourRow's doc comment for the confirmed schema and the
    /// cascade-id/NULL-handling caveats. jobTypeId/serviceHeadId/serviceTypeId are each optional and,
    /// when given, EXCLUDE only a row that has a value there AND it doesn't match - a row with NULL
    /// Jobtype/ServiceHead/ServiceType always passes through (most of LabourMaster is unmapped to
    /// the cascade, so a strict filter would hide nearly everything); q (optional) further narrows
    /// by LabourCode/LabourDescription substring, combined with (not replacing) the cascade filter.
    /// All null/empty -> every active labour row, capped at 500 like SearchAspNetUsersAsync. Throws
    /// <see cref="InvalidOperationException"/> on a real failure (confirmed schema, so a failure
    /// here is real, not "table doesn't exist" - same reasoning as GetPartsInventoryAsync).</summary>
    Task<IReadOnlyList<BaplDmsLabourRow>> GetLabourAsync(int? jobTypeId, int? serviceHeadId, int? serviceTypeId, string? q, CancellationToken ct = default);

    /// <summary>Most recent (non-deleted) RepairBillHeader row for one BAPL DMS job card, for the
    /// "Download Invoice from DMS" PDF (see InvoicePdfService.BuildInvoicePdfAsync). Returns null
    /// for a genuine "no repair bill raised yet for this job" (normal - most open job cards have
    /// none); throws <see cref="InvalidOperationException"/> on a real failure, same as
    /// GetRepairBillsForJobAsync above (RepairBillHeader is confirmed schema, so a failure here is
    /// real, not "table doesn't exist").</summary>
    Task<BaplDmsRepairBillHeaderDetail?> GetRepairBillHeaderDetailAsync(int jobCardHeaderId, CancellationToken ct = default);

    /// <summary>Every RepairBillDetail line (parts + labour) for one RepairBillHeader.Id, in
    /// insertion order, for the invoice PDF's line-items table. Empty list is normal (a saved bill
    /// with no lines yet); throws <see cref="InvalidOperationException"/> on a real failure
    /// (confirmed schema).</summary>
    Task<IReadOnlyList<BaplDmsRepairBillDetailRow>> GetRepairBillDetailLinesAsync(int repairBillId, CancellationToken ct = default);

    /// <summary>Customer/ledger detail (name/mobile/address/city/state/GSTIN) by LedgerMaster.Id,
    /// for the invoice PDF's "Customer Details" panel. See <see cref="BaplDmsCustomerLedgerDetail"/>'s
    /// doc comment for which columns are confirmed vs. best-effort. Returns null only if the ledger
    /// row itself can't be found or the confirmed part of the query fails - State/Gstin missing on
    /// an otherwise-found row just come back null, they never cause this to return null.</summary>
    Task<BaplDmsCustomerLedgerDetail?> GetCustomerLedgerDetailAsync(int ledgerId, CancellationToken ct = default);

    /// <summary>
    /// Best-effort write of one job-card photo into BAPL DMS's own database (a brand-new table,
    /// dbo.JobCardScannerMedia - see add-bapldms-jobcard-media-table.sql - since no existing BAPL
    /// DMS media/photo table is confirmed anywhere in this codebase). Called ONLY after
    /// JobCardScanner's own local photo upload has already succeeded (see
    /// JobCardsController.UploadPhoto) and is purely additive - failure here must never surface as
    /// anything other than a caught, logged warning, so this throws
    /// <see cref="InvalidOperationException"/> on failure exactly like every other write in this
    /// file, leaving it entirely up to the caller to catch-and-ignore (which UploadPhoto does).
    /// </summary>
    Task SaveJobCardPhotoAsync(int jobId, string fileName, string? contentType, string? stage, string? caption, byte[] bytes, CancellationToken ct = default);

    /// <summary>
    /// Verifies an email+password against BAPL DMS's own AspNetUsers (standard ASP.NET Core
    /// Identity table, in the same BAPLDMSvad database) - the fallback path in
    /// DealerAuthController.Login when JobCardScanner's own local Users lookup fails. Column names
    /// (Id/Email/UserName/PasswordHash/PhoneNumber/NormalizedEmail) are framework-standard ASP.NET
    /// Core Identity defaults, not guessed; DealerCode is a confirmed custom column on this same
    /// table (via a live SELECT * you ran) that DealerAuthController.Login uses to resolve/assign
    /// the right local Dealer automatically. This still NEVER throws (unlike every other method
    /// in this interface): a login endpoint must degrade to "wrong password" on ANY unexpected
    /// failure here (network blip, BAPL DMS down, a real schema surprise), never crash the whole
    /// sign-in flow. Returns null for "no such user", "wrong password", or any failure alike -
    /// DealerAuthController.Login treats all three the same way (falls through to its existing
    /// Unauthorized response) since a login endpoint should never reveal which one occurred anyway.
    /// </summary>
    Task<BaplDmsDealerCredential?> VerifyDealerCredentialsAsync(string email, string password, CancellationToken ct = default);

    /// <summary>
    /// For a BAPL DMS "Employee"-role login (see BaplDmsDealerCredential.IsBgEmployeeRole) - resolves
    /// its dealer scope via BgEmployeeMaster (checked first, by EmailId) then EmployeeMaster
    /// (fallback, by EmailId), mirroring BAPL DMS's own AuthController.ResolveEmployeeLoginInfo.
    /// Like VerifyDealerCredentialsAsync, this NEVER throws - a login-path failure here degrades to
    /// Found=false (treated the same as "no such employee row") rather than crashing sign-in.
    /// </summary>
    Task<BaplDmsEmployeeScope> ResolveEmployeeDealerScopeAsync(string email, CancellationToken ct = default);

    /// <summary>
    /// Browses BAPL DMS's own AspNetUsers (same table VerifyDealerCredentialsAsync checks a single
    /// row of) - backs Admin -&gt; Users' "BAPL DMS Logins" panel, so an admin can see every
    /// dealer/workshop login BAPL DMS knows about (and its DealerCode) without pasting SQL dumps
    /// back and forth. PasswordHash/SecurityStamp/ConcurrencyStamp are deliberately never selected -
    /// this is a read-only directory browse, not a credential surface. q (optional) filters by
    /// Email/UserName/DealerCode substring; omit to list everyone, capped at 500 rows like
    /// AdminDirectoryController's Azure AD equivalent. Throws <see cref="InvalidOperationException"/>
    /// on a real failure (unlike VerifyDealerCredentialsAsync, this is an admin browse, not a login
    /// path, so a real problem should surface as a 502, not be silently swallowed).
    /// </summary>
    Task<IReadOnlyList<BaplDmsAspNetUserRow>> SearchAspNetUsersAsync(string? q, CancellationToken ct = default);
}

/// <summary>One row of BAPL DMS's own AspNetUsers, for the admin "BAPL DMS Logins" browse panel -
/// see IBaplDmsService.SearchAspNetUsersAsync. Same confirmed columns as
/// VerifyDealerCredentialsAsync's query, minus PasswordHash (never surfaced outside that one
/// verification method).</summary>
public record BaplDmsAspNetUserRow(string Id, string Email, string? UserName, string? PhoneNumber, string? DealerCode, bool LockoutEnabled, bool EmailConfirmed);

/// <summary>
/// Reads BAPL's own Dealer Management System (DMS) database - a separate SQL Server/database from
/// both JobCardScannerDb and the BAPL ERP warehouse BaplDealerService reads from - to power the Job
/// Card Wizard's dealer search and chassis/registration-number vehicle auto-fill. Plain ADO.NET
/// (Microsoft.Data.SqlClient), same as BaplDealerService, rather than a second EF DbContext: this
/// is a read-only integration against a schema this app doesn't own or migrate, and BAPL DMS's own
/// backend (JobCardRepo.GetAllInspectedLotChassisAsync, pasted into this project's chat history for
/// reference) already defines the exact joins/columns to copy - see the inline comments below for
/// where each piece came from and the one bug intentionally NOT carried over.
/// </summary>
public class BaplDmsService : IBaplDmsService
{
    private readonly IConfiguration _config;
    private readonly ILogger<BaplDmsService> _logger;

    public BaplDmsService(IConfiguration config, ILogger<BaplDmsService> logger)
    {
        _config = config;
        _logger = logger;
    }

    private string ConnStr => _config.GetConnectionString("BAPLDMSvadConnection")
        ?? throw new InvalidOperationException("BAPLDMSvadConnection isn't configured in appsettings.json's ConnectionStrings section.");

    public async Task<IReadOnlyList<BaplDmsDealerRow>> SearchDealersAsync(string q, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2) return Array.Empty<BaplDmsDealerRow>();

        const string sql = @"
            SELECT TOP 20
                d.Dealercode  AS DealerCode,
                d.Compname    AS DealerName,
                ISNULL(d.City, '')            AS City,
                ISNULL(d.State, '')           AS State,
                ISNULL(d.Mobile, '')          AS Mobile,
                ISNULL(d.Email, '')           AS Email,
                ISNULL(d.Contactperson, '')   AS ContactPerson
            FROM [dbo].[DealerMaster] d
            WHERE d.IsActive = 1
              AND (d.Compname LIKE @q OR d.Dealercode LIKE @q)
            ORDER BY d.Compname";

        var results = new List<BaplDmsDealerRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@q", $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new BaplDmsDealerRow(
                    rdr["DealerCode"] as string ?? "",
                    rdr["DealerName"] as string ?? "",
                    rdr["City"] as string ?? "",
                    rdr["State"] as string ?? "",
                    rdr["Mobile"] as string ?? "",
                    rdr["Email"] as string ?? "",
                    rdr["ContactPerson"] as string ?? ""));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not search BAPL DMS's dealer master (DealerMaster): {ex.Message}", ex);
        }

        return results;
    }

    public async Task<BaplDmsVehicleRow?> LookupVehicleAsync(string value, string? dealerCode, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        value = value.Trim();

        await using var conn = new SqlConnection(ConnStr);

        // ----- PRIMARY: BAPL DMS's own vehicle master - ChassisDetails (confirmed directly via a
        // `SELECT TOP 5 * FROM ChassisDetails` you ran) joined to LedgerMaster for the owning
        // customer's identity. This covers BOTH a brand-new, not-yet-sold vehicle (SaleDate IS NULL,
        // LedgerId IS NULL - rows 3/4 in your sample) and an already-sold one (SaleDate populated,
        // LedgerId set - row 2) in one query, which is why this replaced the old two-step "job card
        // history, then a separate not-yet-sold fallback" approach below. ModelName comes straight
        // from ItemName - BAPL DMS doesn't split Model/Variant into two fields, it's one combined
        // name (e.g. "BGauss C12i MAX 2.0 Monolith Grey"), so the wizard now only fills a single
        // Model field from this instead of trying to match it against a separate Model/Variant
        // catalog.
        //
        // NOTE: this LEFT JOINs a "Cities" table for CustomerCity - the first attempt guessed its
        // columns as CityId/CityName (from your pasted repo's `_context.Cities`/`ct.CityId`/
        // `ct.CityName` EF property names) and that was wrong: this database's real Cities columns
        // are snake_case (city_id, city_name - confirmed via `SELECT TOP 3 * FROM Cities` you ran),
        // not PascalCase like the EF entity's property names suggested. Lesson carried forward: this
        // schema mixes naming conventions table-to-table (ChassisDetails/JobCardHeader are
        // PascalCase, LocationMaster's business columns are lowercase, Cities' are snake_case), so
        // pasted EF code's C# property spelling is a guide to which JOINs exist, never proof of the
        // real column names - only a `SELECT *` you actually ran confirms that. lg.City/lg.Id/
        // lg.LedgerName/lg.MobileNumber were NOT in the error this raised the first time (only
        // CityId/CityName were), which is why they're trusted here unchanged. -----
        const string chassisSql = @"
            SELECT TOP 1
                ch.ChassisNo, ch.RegNo, ch.ItemName, ch.DealerId, ch.LocationCode, ch.SaleDate, ch.LedgerId,
                lg.LedgerName, lg.MobileNumber,
                cty.city_name
            FROM [dbo].[ChassisDetails] ch
            LEFT JOIN [dbo].[LedgerMaster] lg ON ch.LedgerId = lg.Id
            LEFT JOIN [dbo].[Cities] cty ON lg.City = cty.city_id
            WHERE (ch.ChassisNo = @val OR ch.RegNo = @val)
              AND (@dealerCode IS NULL OR ch.DealerId = @dealerCode)
            ORDER BY ch.SaleDate DESC";

        string? chassisNo = null, regNo = null, modelName = null, customerName = null, customerMobile = null,
            customerCity = null, locationCode = null, foundDealerCode = null;
        int? customerLedgerId = null;
        DateOnly? saleDate = null;
        bool found = false;

        try
        {
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(chassisSql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@val", value);
            cmd.Parameters.AddWithValue("@dealerCode", (object?)dealerCode ?? DBNull.Value);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (await rdr.ReadAsync(ct))
            {
                found = true;
                chassisNo = rdr["ChassisNo"] as string ?? value;
                regNo = rdr["RegNo"] as string;
                modelName = rdr["ItemName"] as string;
                foundDealerCode = rdr["DealerId"] as string;
                locationCode = rdr["LocationCode"] as string;
                saleDate = ToDateOnly(rdr["SaleDate"]);
                customerLedgerId = rdr["LedgerId"] as int?;
                customerName = rdr["LedgerName"] as string;
                customerMobile = rdr["MobileNumber"] as string;
                customerCity = rdr["city_name"] as string;
            }
        }
        catch (Exception ex)
        {
            // Confirmed-schema query - a real failure here (network, credentials, or the schema
            // drifted since you ran that SELECT *) is surfaced as a thrown exception (the controller
            // maps this to a 502 with the message) instead of silently reporting "not found".
            _logger.LogWarning(ex, "BAPL DMS vehicle lookup (ChassisDetails) failed for {Value} (dealerCode={DealerCode})", value, dealerCode);
            throw new InvalidOperationException($"BAPL DMS vehicle lookup failed for '{value}': {ex.Message}", ex);
        }

        if (!found) return null;

        // ----- ENRICHMENT: this chassis's most recent past job card (if any), for Previous Km,
        // insurance/next-service dates, and battery/motor/controller/charger numbers - same
        // confirmed JobCardHeader/JobCardCustomer/JobCardBatteryDetail schema already used elsewhere
        // in this file. A brand-new vehicle with no service history yet simply won't have one of
        // these rows - that's normal, not an error, so this is best-effort and never throws. -----
        int? vehicleKms = null;
        string? motorNo = null, batteryNo = null, controllerNo = null, converterNo = null, chargerNo = null;
        DateOnly? insuranceExpDate = null, nextServiceDueDate = null;
        try
        {
            const string historySql = @"
                SELECT TOP 1
                    h.Vehiclekms, c.MotorNo, c.BatteryNo, c.InsuranceExpDate, c.NextserviceDueDate,
                    b.ControllerNo, b.ConverterNo, b.ChargerNo
                FROM [dbo].[JobCardHeader] h
                JOIN [dbo].[JobCardCustomer] c ON c.JobCardHeaderId = h.Id
                LEFT JOIN [dbo].[JobCardBatteryDetail] b ON b.JobCardHeaderId = h.Id
                WHERE ISNULL(h.IsDelete, 0) = 0
                  AND (h.Chassisno = @chassisNo OR c.ChassisNo = @chassisNo)
                ORDER BY h.JobinDate DESC, h.CreatedDate DESC";
            await using var cmd = new SqlCommand(historySql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@chassisNo", chassisNo!);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (await rdr.ReadAsync(ct))
            {
                vehicleKms = rdr["Vehiclekms"] as int?;
                motorNo = rdr["MotorNo"] as string;
                batteryNo = rdr["BatteryNo"] as string;
                insuranceExpDate = ToDateOnly(rdr["InsuranceExpDate"]);
                nextServiceDueDate = ToDateOnly(rdr["NextserviceDueDate"]);
                controllerNo = rdr["ControllerNo"] as string;
                converterNo = rdr["ConverterNo"] as string;
                chargerNo = rdr["ChargerNo"] as string;
            }
        }
        catch (Exception ex)
        {
            _logger.LogInformation(ex, "BAPL DMS job-card-history enrichment skipped for chassis {ChassisNo}", chassisNo);
        }

        // ----- ENRICHMENT 2: LedgerMaster.Address/Email for this customer, for the "(Registered
        // customer Details)" panel (per your request to show Name/Mobile/Address/Email/City after a
        // chassis/reg-no lookup). "Address"/"Email" are GUESSED column names - not confirmed via a
        // SELECT * the way LedgerName/MobileNumber/City were - so this is a separate, independently
        // best-effort query: if the guess is wrong it's logged and swallowed, exactly like the
        // history enrichment above, rather than breaking the (already-working) primary lookup. -----
        string? customerAddress = null, customerEmail = null;
        if (customerLedgerId.HasValue)
        {
            try
            {
                const string ledgerSql = "SELECT Address, Email FROM [dbo].[LedgerMaster] WHERE Id = @id";
                await using var cmd = new SqlCommand(ledgerSql, conn) { CommandTimeout = 30 };
                cmd.Parameters.AddWithValue("@id", customerLedgerId.Value);
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    customerAddress = rdr["Address"] as string;
                    customerEmail = rdr["Email"] as string;
                }
            }
            catch (Exception ex)
            {
                _logger.LogInformation(ex, "BAPL DMS LedgerMaster Address/Email enrichment skipped for ledger {LedgerId} (unconfirmed column names)", customerLedgerId);
            }
        }

        return new BaplDmsVehicleRow(
            chassisNo!,
            regNo,
            modelName,
            customerName,
            customerMobile,
            batteryNo,
            motorNo,
            controllerNo,
            converterNo,
            chargerNo,
            saleDate,
            insuranceExpDate,
            nextServiceDueDate,
            vehicleKms,
            OdoReading: null, Duration: null, DurationType: null, ExpireWarrantyDate: null, // not wired up
            IsSold: saleDate.HasValue,
            CustomerCity: customerCity,
            CustomerLedgerId: customerLedgerId,
            LocationCode: locationCode,
            DealerCode: foundDealerCode,
            CustomerAddress: customerAddress,
            CustomerEmail: customerEmail);
    }

    public async Task<IReadOnlyList<BaplDmsJobCardHistoryRow>> GetServiceHistoryAsync(string chassisNo, string? dealerCode, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(chassisNo)) return Array.Empty<BaplDmsJobCardHistoryRow>();
        chassisNo = chassisNo.Trim();

        // STRING_AGG needs SQL Server 2017+/Azure SQL - BAPLDMSvad is an Azure SQL Database
        // (*.database.windows.net), which always supports it.
        const string sql = @"
            SELECT TOP 20
                h.Id AS JobCardHeaderId, h.JobNo, h.Jobprefix, h.JobinDate, h.JobStatus, h.InwardType,
                h.Vehiclekms, h.Supervisor, h.Technician, h.InvoiceNo,
                (SELECT STRING_AGG(cp.Complaint, '; ') FROM [dbo].[JobCardComplaint] cp WHERE cp.JobCardHeaderId = h.Id) AS Complaints
            FROM [dbo].[JobCardHeader] h
            JOIN [dbo].[JobCardCustomer] c ON c.JobCardHeaderId = h.Id
            WHERE ISNULL(h.IsDelete, 0) = 0
              AND (h.Chassisno = @chassisNo OR c.ChassisNo = @chassisNo)
              AND (@dealerCode IS NULL OR h.DealerCode = @dealerCode)
            ORDER BY h.JobinDate DESC, h.CreatedDate DESC";

        var results = new List<BaplDmsJobCardHistoryRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@chassisNo", chassisNo);
            cmd.Parameters.AddWithValue("@dealerCode", (object?)dealerCode ?? DBNull.Value);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new BaplDmsJobCardHistoryRow(
                    (int)rdr["JobCardHeaderId"],
                    rdr["JobNo"] as int?,
                    rdr["Jobprefix"] as string,
                    ToDateOnly(rdr["JobinDate"]),
                    rdr["JobStatus"] as string,
                    rdr["InwardType"] as string,
                    rdr["Vehiclekms"] as int?,
                    rdr["Supervisor"] as string,
                    rdr["Technician"] as string,
                    rdr["InvoiceNo"] as string,
                    rdr["Complaints"] as string));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's service history for chassis '{chassisNo}': {ex.Message}", ex);
        }

        return results;
    }

    public async Task<IReadOnlyList<BaplDmsJobCardListRow>> SearchJobCardsAsync(string? q, string? dealerCode, int take, CancellationToken ct = default)
    {
        if (take <= 0) take = 50;

        // JobStatus is NOT read off a stored column here - h.JobStatus turned out to be
        // unpopulated/unreliable in practice (every BAPL DMS row was coming through as "Unknown" on
        // the merged /jobcards list). BAPL DMS's own Job Card List screen instead computes status
        // live from RepairBillHeader/Ffirheader/IsMaterialTransfer - ported directly from your own
        // JobCardRepo.GetJobCardListViewAsync's JobStatus CASE expression (RepairBillHeader/
        // Ffirheader table names inferred from that same pasted code: their EF entity class names -
        // JobCardHeader, JobCardCustomer, etc. - have always matched the real table names exactly
        // everywhere else in this file, so RepairBillHeader/Ffirheader singular are used the same
        // way). Uses the same-priority order as that CASE: Billed > has a net amount > material
        // transfer > FFIR closed > FFIR created > Open.
        const string sql = @"
            SELECT TOP (@take)
                h.Id AS JobCardHeaderId, h.JobNo, h.Jobprefix, h.JobinDate, h.DealerCode,
                c.CustomerName, c.CustomerMobile, c.ModelName, c.ChassisNo, c.RegisterNo,
                h.Supervisor, h.Technician,
                CASE
                    WHEN rb.RepairbillStatus = 'Billed' THEN 'Closed'
                    WHEN rb.TotalNetAmount > 0 THEN 'Complete'
                    WHEN h.IsMaterialTransfer = 1 THEN 'Material Transfer'
                    WHEN fr.Ffirstatus = 'Closed' THEN 'FFIR Closed'
                    WHEN fr.Id IS NOT NULL THEN 'FFIR Created'
                    ELSE 'Open'
                END AS JobStatus
            FROM [dbo].[JobCardHeader] h
            JOIN [dbo].[JobCardCustomer] c ON c.JobCardHeaderId = h.Id
            OUTER APPLY (
                SELECT TOP 1 rb2.RepairbillStatus, rb2.TotalNetAmount
                FROM [dbo].[RepairBillHeader] rb2 WHERE rb2.JobId = h.Id ORDER BY rb2.Id DESC
            ) rb
            OUTER APPLY (
                SELECT TOP 1 fr2.Id, fr2.Ffirstatus
                FROM [dbo].[Ffirheader] fr2 WHERE fr2.JobCardHeaderId = h.Id ORDER BY fr2.Id DESC
            ) fr
            WHERE ISNULL(h.IsDelete, 0) = 0
              AND (@dealerCode IS NULL OR h.DealerCode = @dealerCode)
              AND (@qLike IS NULL
                   OR c.ChassisNo LIKE @qLike OR c.RegisterNo LIKE @qLike
                   OR c.CustomerName LIKE @qLike OR c.CustomerMobile LIKE @qLike
                   OR (h.Jobprefix + CAST(h.JobNo AS nvarchar(20))) LIKE @qLike)
            ORDER BY h.JobinDate DESC, h.CreatedDate DESC";

        var results = new List<BaplDmsJobCardListRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@take", take);
            cmd.Parameters.AddWithValue("@dealerCode", (object?)dealerCode ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@qLike", string.IsNullOrWhiteSpace(q) ? (object)DBNull.Value : $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new BaplDmsJobCardListRow(
                    (int)rdr["JobCardHeaderId"],
                    rdr["JobNo"] as int?,
                    rdr["Jobprefix"] as string,
                    ToDateOnly(rdr["JobinDate"]),
                    rdr["JobStatus"] as string,
                    rdr["DealerCode"] as string,
                    rdr["CustomerName"] as string,
                    rdr["CustomerMobile"] as string,
                    rdr["ModelName"] as string,
                    rdr["ChassisNo"] as string,
                    rdr["RegisterNo"] as string,
                    rdr["Supervisor"] as string,
                    rdr["Technician"] as string));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not search BAPL DMS's job cards: {ex.Message}", ex);
        }

        return results;
    }

    public async Task<BaplDmsJobCardDetailRow?> GetJobCardByIdAsync(int jobCardHeaderId, CancellationToken ct = default)
    {
        // JobStatus computed the same way as SearchJobCardsAsync above - see that method's comment
        // on why a stored h.JobStatus column isn't trustworthy here.
        const string sql = @"
            SELECT TOP 1
                h.Id AS JobCardHeaderId, h.JobNo, h.Jobprefix, h.JobinDate, h.InwardType,
                h.Vehiclekms, h.Supervisor, h.Technician, h.InvoiceNo, h.DealerCode,
                c.CustomerName, c.CustomerMobile, c.CustomerAltMobile, c.ModelName, c.ChassisNo, c.RegisterNo,
                c.MotorNo, c.BatteryNo, c.SaleDate, c.InsuranceExpDate, c.NextserviceDueDate, c.RSARenewalDate, c.Remarks,
                b.ControllerNo, b.ConverterNo, b.ChargerNo,
                (SELECT STRING_AGG(cp.Complaint, '; ') FROM [dbo].[JobCardComplaint] cp WHERE cp.JobCardHeaderId = h.Id) AS Complaints,
                CASE
                    WHEN rb.RepairbillStatus = 'Billed' THEN 'Closed'
                    WHEN rb.TotalNetAmount > 0 THEN 'Complete'
                    WHEN h.IsMaterialTransfer = 1 THEN 'Material Transfer'
                    WHEN fr.Ffirstatus = 'Closed' THEN 'FFIR Closed'
                    WHEN fr.Id IS NOT NULL THEN 'FFIR Created'
                    ELSE 'Open'
                END AS JobStatus
            FROM [dbo].[JobCardHeader] h
            JOIN [dbo].[JobCardCustomer] c ON c.JobCardHeaderId = h.Id
            LEFT JOIN [dbo].[JobCardBatteryDetail] b ON b.JobCardHeaderId = h.Id
            OUTER APPLY (
                SELECT TOP 1 rb2.RepairbillStatus, rb2.TotalNetAmount
                FROM [dbo].[RepairBillHeader] rb2 WHERE rb2.JobId = h.Id ORDER BY rb2.Id DESC
            ) rb
            OUTER APPLY (
                SELECT TOP 1 fr2.Id, fr2.Ffirstatus
                FROM [dbo].[Ffirheader] fr2 WHERE fr2.JobCardHeaderId = h.Id ORDER BY fr2.Id DESC
            ) fr
            WHERE h.Id = @id AND ISNULL(h.IsDelete, 0) = 0";

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@id", jobCardHeaderId);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (!await rdr.ReadAsync(ct)) return null;

            return new BaplDmsJobCardDetailRow(
                (int)rdr["JobCardHeaderId"],
                rdr["JobNo"] as int?,
                rdr["Jobprefix"] as string,
                ToDateOnly(rdr["JobinDate"]),
                rdr["JobStatus"] as string,
                rdr["InwardType"] as string,
                rdr["Vehiclekms"] as int?,
                rdr["Supervisor"] as string,
                rdr["Technician"] as string,
                rdr["InvoiceNo"] as string,
                rdr["DealerCode"] as string,
                rdr["CustomerName"] as string,
                rdr["CustomerMobile"] as string,
                rdr["CustomerAltMobile"] as string,
                rdr["ModelName"] as string,
                rdr["ChassisNo"] as string,
                rdr["RegisterNo"] as string,
                rdr["MotorNo"] as string,
                rdr["BatteryNo"] as string,
                ToDateOnly(rdr["SaleDate"]),
                ToDateOnly(rdr["InsuranceExpDate"]),
                ToDateOnly(rdr["NextserviceDueDate"]),
                ToDateOnly(rdr["RSARenewalDate"]),
                rdr["Remarks"] as string,
                rdr["ControllerNo"] as string,
                rdr["ConverterNo"] as string,
                rdr["ChargerNo"] as string,
                rdr["Complaints"] as string);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS job card {jobCardHeaderId}: {ex.Message}", ex);
        }
    }

    // Matches a Loccode ending in "W" followed by one or more digits (e.g. "CUS0435W1") - BAPL
    // DMS's own convention for the workshop location in a dealer's S/W/G location series (Showroom/
    // Workshop/Godown), confirmed against the sample rows you pasted from LocationMaster.
    private static readonly Regex WorkshopLocCodeRegex = new(@"W\d+$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public async Task<IReadOnlyList<BaplDmsWorkshopRow>> GetWorkshopsAsync(string? dealerCode, string? q, CancellationToken ct = default)
    {
        // LocationMaster is a small master table (one row per dealer per S/W/G location), so it's
        // simplest and safest to filter the W-series in C# with a regex rather than trying to
        // express "ends in a letter then any number of digits" in a portable SQL LIKE pattern.
        const string sql = @"
            SELECT loccode, locname, ISNULL(city, '') AS city, ISNULL(state, '') AS state, dealercode
            FROM [dbo].[LocationMaster]
            WHERE active = 'Y'
              AND (@dealerCode IS NULL OR dealercode = @dealerCode)
              AND (@qLike IS NULL OR locname LIKE @qLike OR loccode LIKE @qLike)
            ORDER BY locname";

        var results = new List<BaplDmsWorkshopRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@dealerCode", (object?)dealerCode ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@qLike", string.IsNullOrWhiteSpace(q) ? (object)DBNull.Value : $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var loccode = rdr["loccode"] as string ?? "";
                if (!WorkshopLocCodeRegex.IsMatch(loccode)) continue;
                results.Add(new BaplDmsWorkshopRow(
                    loccode,
                    rdr["locname"] as string ?? loccode,
                    rdr["city"] as string ?? "",
                    rdr["state"] as string ?? "",
                    rdr["dealercode"] as string ?? ""));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's workshop locations (LocationMaster): {ex.Message}", ex);
        }

        return results;
    }

    public async Task<IReadOnlyList<BaplDmsJobTypeRow>> GetJobTypesAsync(CancellationToken ct = default)
    {
        const string sql = "SELECT id, JobTypeName FROM [dbo].[JobType] ORDER BY JobTypeName";
        var results = new List<BaplDmsJobTypeRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsJobTypeRow((int)rdr["id"], rdr["JobTypeName"] as string ?? ""));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's job types (JobType): {ex.Message}", ex);
        }
        return results;
    }

    public async Task<IReadOnlyList<BaplDmsServiceHeadRow>> GetServiceHeadsAsync(int jobTypeId, CancellationToken ct = default)
    {
        const string sql = "SELECT id, JobTypeId, ServiceHeadName FROM [dbo].[ServiceHead] WHERE JobTypeId = @jobTypeId ORDER BY ServiceHeadName";
        var results = new List<BaplDmsServiceHeadRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@jobTypeId", jobTypeId);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsServiceHeadRow((int)rdr["id"], (int)rdr["JobTypeId"], rdr["ServiceHeadName"] as string ?? ""));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's service heads (ServiceHead): {ex.Message}", ex);
        }
        return results;
    }

    public async Task<IReadOnlyList<BaplDmsServiceTypeRow>> GetServiceTypesAsync(int serviceHeadId, CancellationToken ct = default)
    {
        const string sql = "SELECT id, ServiceHeadId, ServiceTypeName FROM [dbo].[ServiceType] WHERE ServiceHeadId = @serviceHeadId ORDER BY ServiceTypeName";
        var results = new List<BaplDmsServiceTypeRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@serviceHeadId", serviceHeadId);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsServiceTypeRow((int)rdr["id"], (int)rdr["ServiceHeadId"], rdr["ServiceTypeName"] as string ?? ""));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's service types (ServiceType): {ex.Message}", ex);
        }
        return results;
    }

    public async Task<IReadOnlyList<BaplDmsComplaintRow>> GetComplaintsAsync(CancellationToken ct = default)
    {
        const string sql = "SELECT Id, ComplaintName, GroupName FROM [dbo].[ComplaintMaster] WHERE Status = 1 ORDER BY ComplaintName";
        var results = new List<BaplDmsComplaintRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsComplaintRow((int)rdr["Id"], rdr["ComplaintName"] as string ?? "", rdr["GroupName"] as int?));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's complaint master (ComplaintMaster): {ex.Message}", ex);
        }
        return results;
    }

    public async Task<IReadOnlyList<BaplDmsJobSourceRow>> GetJobSourcesAsync(CancellationToken ct = default)
    {
        const string sql = "SELECT id, JobSourceName FROM [dbo].[JobSource] ORDER BY id";
        var results = new List<BaplDmsJobSourceRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsJobSourceRow((int)rdr["id"], rdr["JobSourceName"] as string ?? ""));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's job sources (JobSource): {ex.Message}", ex);
        }
        return results;
    }

    /// <summary>
    /// Writes one new job card into BAPL DMS's own JobCardHeader/JobCardCustomer/
    /// JobCardBatteryDetail/JobCardComplaint tables, mirroring your own JobCardRepo.
    /// InsertJobCardinfoDetails as closely as an ADO.NET insert can (this project reads BAPLDMSvad
    /// with plain SqlClient rather than a second EF DbContext - see this class's header comment for
    /// why - so this is a hand-written parameterized-SQL equivalent of that EF code, not a literal
    /// port). Three things could NOT be copied exactly from your pasted code and are best-effort
    /// guesses instead, called out here so a first failed attempt is easy to diagnose:
    ///   - JobNo: your GetNextJobNumber(dealerCode) logic (MAX(JobNo) WHERE DealerCode = ... + 1) IS
    ///     copied exactly, but if two job cards are created for the same dealer at the same moment
    ///     from different places, there's a small race window your real backend likely closes with
    ///     a lock/sequence/unique constraint this insert doesn't take out.
    ///   - Jobprefix: your code only ever strips a numeric suffix off whatever prefix is passed in
    ///     (NormalizeJobPrefix) - it's never generated from scratch anywhere in what you pasted, so
    ///     this insert sends an empty string. If BAPL DMS's UI always shows a specific prefix (a
    ///     dealer code, a location code, ...), tell me the rule and I'll generate it here too.
    ///   - CreatedBy: your schema stores this as a string that looks like a BAPL DMS user's GUID
    ///     (e.g. "973620f2-a192-41c6-af0d-2d515e5ad5e9") - JobCardScanner has no such BAPL DMS user
    ///     id, so this sends a JobCardScanner staff id instead, prefixed so it's identifiable in
    ///     BAPL DMS's own audit trail. If CreatedBy has a foreign key or format constraint that
    ///     rejects that, this insert will throw and the exact SQL error will say so.
    /// Columns your ViewModel carries that the Job Card Wizard has no equivalent input for yet
    /// (AirpressureRearTyre/AirpressurefrontTyre, Observation, SupervisorComment, IsPdiSuccess,
    /// Couponno, InvoiceNo, EstNo/Jobestmate) are left at their column defaults/NULL rather than
    /// guessed.
    /// </summary>
    public async Task<BaplDmsCreateJobCardResult> CreateJobCardAsync(BaplDmsCreateJobCardRequest req, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(ConnStr);
        await conn.OpenAsync(ct);
        var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);
        try
        {
            int jobNo;
            await using (var cmd = new SqlCommand(
                "SELECT ISNULL(MAX(JobNo), 0) + 1 FROM [dbo].[JobCardHeader] WHERE DealerCode = @dealerCode", conn, tx))
            {
                cmd.Parameters.AddWithValue("@dealerCode", req.DealerCode);
                jobNo = (int)(await cmd.ExecuteScalarAsync(ct))!;
            }

            var now = DateTime.Now;
            var jobInDate = DateOnly.FromDateTime(now);
            var estDelDate = req.ExpectedDeliveryAt.HasValue ? DateOnly.FromDateTime(req.ExpectedDeliveryAt.Value) : jobInDate;
            var estDelTime = req.ExpectedDeliveryAt?.TimeOfDay ?? now.TimeOfDay;

            int headerId;
            const string insertHeaderSql = @"
                INSERT INTO [dbo].[JobCardHeader]
                    (Jobtype, DealerCode, Chassisno, Vehiclekms, Servicehead, Servicetype, Serviceloc,
                     InwardType, Jobprefix, JobinDate, JobinTime, JobNo, ManualjobNo, EstdelDate, EstdelTime,
                     JobSource, Supervisor, Technician, Priority, IsDelete, CreatedBy, CreatedDate)
                VALUES
                    (@jobType, @dealerCode, @chassisNo, @vehicleKms, @serviceHead, @serviceType, @serviceLoc,
                     @inwardType, @jobPrefix, @jobinDate, @jobinTime, @jobNo, @manualJobNo, @estDelDate, @estDelTime,
                     @jobSource, @supervisor, @technician, @priority, 0, @createdBy, @createdDate);
                SELECT CAST(SCOPE_IDENTITY() AS int);";
            await using (var cmd = new SqlCommand(insertHeaderSql, conn, tx))
            {
                cmd.Parameters.AddWithValue("@jobType", req.JobTypeId);
                cmd.Parameters.AddWithValue("@dealerCode", req.DealerCode);
                cmd.Parameters.AddWithValue("@chassisNo", req.ChassisNo);
                cmd.Parameters.AddWithValue("@vehicleKms", req.VehicleKms);
                cmd.Parameters.AddWithValue("@serviceHead", req.ServiceHeadId);
                cmd.Parameters.AddWithValue("@serviceType", req.ServiceTypeId);
                cmd.Parameters.AddWithValue("@serviceLoc", (object?)req.ServiceLocationCode ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@inwardType", "Service");
                cmd.Parameters.AddWithValue("@jobPrefix", "");
                cmd.Parameters.AddWithValue("@jobinDate", jobInDate.ToDateTime(TimeOnly.MinValue));
                cmd.Parameters.AddWithValue("@jobinTime", now.TimeOfDay);
                cmd.Parameters.AddWithValue("@jobNo", jobNo);
                cmd.Parameters.AddWithValue("@manualJobNo", (object?)req.ManualJobNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@estDelDate", estDelDate.ToDateTime(TimeOnly.MinValue));
                cmd.Parameters.AddWithValue("@estDelTime", estDelTime);
                cmd.Parameters.AddWithValue("@jobSource", req.JobSourceId ?? 1);
                cmd.Parameters.AddWithValue("@supervisor", (object?)req.Supervisor ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@technician", (object?)req.Technician ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@priority", (object?)req.Priority ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@createdBy", req.CreatedBy);
                cmd.Parameters.AddWithValue("@createdDate", now);
                headerId = (int)(await cmd.ExecuteScalarAsync(ct))!;
            }

            const string insertCustomerSql = @"
                INSERT INTO [dbo].[JobCardCustomer]
                    (JobCardHeaderId, CustomerLedgerId, CustomerName, CustomerMobile, ModelName, ChassisNo,
                     RegisterNo, MotorNo, BatteryNo, SaleDate, InsuranceExpDate, NextserviceDueDate, CreatedBy, CreatedDate)
                VALUES
                    (@headerId, @customerLedgerId, @customerName, @customerMobile, @modelName, @chassisNo,
                     @registerNo, @motorNo, @batteryNo, @saleDate, @insuranceExpDate, @nextServiceDueDate, @createdBy, @createdDate)";
            await using (var cmd = new SqlCommand(insertCustomerSql, conn, tx))
            {
                cmd.Parameters.AddWithValue("@headerId", headerId);
                cmd.Parameters.AddWithValue("@customerLedgerId", (object?)req.CustomerLedgerId ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@customerName", (object?)req.CustomerName ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@customerMobile", (object?)req.CustomerMobile ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@modelName", (object?)req.ModelName ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@chassisNo", req.ChassisNo);
                cmd.Parameters.AddWithValue("@registerNo", (object?)req.RegisterNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@motorNo", (object?)req.MotorNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@batteryNo", (object?)req.BatteryNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@saleDate", req.SaleDate.HasValue ? req.SaleDate.Value.ToDateTime(TimeOnly.MinValue) : (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@insuranceExpDate", req.InsuranceExpDate.HasValue ? req.InsuranceExpDate.Value.ToDateTime(TimeOnly.MinValue) : (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@nextServiceDueDate", req.NextServiceDueDate.HasValue ? req.NextServiceDueDate.Value.ToDateTime(TimeOnly.MinValue) : (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@createdBy", req.CreatedBy);
                cmd.Parameters.AddWithValue("@createdDate", now);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            if (!string.IsNullOrWhiteSpace(req.ControllerNo) || !string.IsNullOrWhiteSpace(req.ConverterNo) || !string.IsNullOrWhiteSpace(req.ChargerNo))
            {
                const string insertBatterySql = @"
                    INSERT INTO [dbo].[JobCardBatteryDetail]
                        (JobCardHeaderId, DealerCode, ControllerNo, ConverterNo, ChargerNo, CreatedBy, CreatedDate)
                    VALUES
                        (@headerId, @dealerCode, @controllerNo, @converterNo, @chargerNo, @createdBy, @createdDate)";
                await using var cmd = new SqlCommand(insertBatterySql, conn, tx);
                cmd.Parameters.AddWithValue("@headerId", headerId);
                cmd.Parameters.AddWithValue("@dealerCode", req.DealerCode);
                cmd.Parameters.AddWithValue("@controllerNo", (object?)req.ControllerNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@converterNo", (object?)req.ConverterNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@chargerNo", (object?)req.ChargerNo ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@createdBy", req.CreatedBy);
                cmd.Parameters.AddWithValue("@createdDate", now);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            foreach (var complaint in req.Complaints.Where(c => !string.IsNullOrWhiteSpace(c)))
            {
                const string insertComplaintSql = @"
                    INSERT INTO [dbo].[JobCardComplaint] (DealerCode, JobCardHeaderId, Complaint, CreatedBy, CreatedDate)
                    VALUES (@dealerCode, @headerId, @complaint, @createdBy, @createdDate)";
                await using var cmd = new SqlCommand(insertComplaintSql, conn, tx);
                cmd.Parameters.AddWithValue("@dealerCode", req.DealerCode);
                cmd.Parameters.AddWithValue("@headerId", headerId);
                cmd.Parameters.AddWithValue("@complaint", complaint);
                cmd.Parameters.AddWithValue("@createdBy", req.CreatedBy);
                cmd.Parameters.AddWithValue("@createdDate", now);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            await tx.CommitAsync(ct);
            return new BaplDmsCreateJobCardResult(headerId, jobNo);
        }
        catch (Exception ex)
        {
            try { await tx.RollbackAsync(ct); } catch { /* connection may already be unusable */ }
            _logger.LogWarning(ex, "Could not create BAPL DMS job card for chassis {ChassisNo}/dealer {DealerCode}", req.ChassisNo, req.DealerCode);
            throw new InvalidOperationException($"Could not create the job card in BAPL DMS: {ex.Message}", ex);
        }
    }

    public async Task<IReadOnlyList<BaplDmsRepairBillRow>> GetRepairBillsForJobAsync(int jobCardHeaderId, CancellationToken ct = default)
    {
        const string sql = @"
            SELECT Id, RepairbillStatus, TotalNetAmount
            FROM [dbo].[RepairBillHeader]
            WHERE JobId = @jobId
            ORDER BY Id DESC";
        var results = new List<BaplDmsRepairBillRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@jobId", jobCardHeaderId);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsRepairBillRow((int)rdr["Id"], rdr["RepairbillStatus"] as string, rdr["TotalNetAmount"] as decimal?));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's repair bills for job card {jobCardHeaderId}: {ex.Message}", ex);
        }
        return results;
    }

    public async Task<IReadOnlyList<BaplDmsPartStockRow>> GetPartsInventoryAsync(string locationCode, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(locationCode)) return Array.Empty<BaplDmsPartStockRow>();

        // See BaplDmsPartStockRow's doc comment - CONFIRMED rule: FinalStockFlag = 'Y' marks each
        // batch's current transaction row, summed by ItemCode. Only items with a positive remaining
        // balance are worth suggesting.
        const string sql = @"
            SELECT ItemCode, SUM(BatchClosingQty) AS AvailableQty
            FROM [dbo].[PartsInventory]
            WHERE DealerLocation = @loc AND FinalStockFlag = 'Y'
            GROUP BY ItemCode
            HAVING SUM(BatchClosingQty) > 0
            ORDER BY ItemCode";
        var results = new List<BaplDmsPartStockRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@loc", locationCode.Trim());
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                results.Add(new BaplDmsPartStockRow(rdr["ItemCode"] as string ?? "", Convert.ToInt32(rdr["AvailableQty"])));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's parts inventory (PartsInventory) for location '{locationCode}': {ex.Message}", ex);
        }
        return results;
    }

    /// <summary>See IBaplDmsService.GetLabourAsync's doc comment.</summary>
    public async Task<IReadOnlyList<BaplDmsLabourRow>> GetLabourAsync(int? jobTypeId, int? serviceHeadId, int? serviceTypeId, string? q, CancellationToken ct = default)
    {
        // isLabourActive is NULL (not 0) on many legacy rows - treated as active.
        //
        // FIXED: cascade ids used to be a strict `Jobtype = @jobTypeId` AND filter, which - given a
        // live SELECT * you shared - excludes almost every row in your LabourMaster: only a
        // handful of rows have Jobtype/ServiceHead/ServiceType populated at all (e.g. Id 162 has
        // 3/3/3), the rest are NULL there (never mapped to the cascade). A strict AND meant picking
        // any job card with a Job Type set hid nearly the entire rate card - exactly the "Labour
        // Suggestion already there in LabourMaster... why not showing" you ran into. Now a row with
        // NULL Jobtype/ServiceHead/ServiceType is ALWAYS included regardless of the job card's own
        // cascade (can't tell if it's relevant, so default to showing it) - the cascade id only
        // EXCLUDES a row that has a value there AND it doesn't match, e.g. a row explicitly mapped
        // to a different Job Type is correctly hidden, but the many unmapped legacy rows always
        // show. q (free-text) still narrows further on top of this, same as before.
        const string sql = @"
            SELECT TOP 500 Id, LabourCode, LabourDescription, HSNCode, SGST, CGST, IGST, LabourRate,
                   Category, Jobtype, ServiceHead, ServiceType, oemmodelname
            FROM [dbo].[LabourMaster]
            WHERE (isLabourActive IS NULL OR isLabourActive = 1)
              AND (@jobTypeId IS NULL OR Jobtype IS NULL OR Jobtype = @jobTypeId)
              AND (@serviceHeadId IS NULL OR ServiceHead IS NULL OR ServiceHead = @serviceHeadId)
              AND (@serviceTypeId IS NULL OR ServiceType IS NULL OR ServiceType = @serviceTypeId)
              AND (@qLike IS NULL OR LabourCode LIKE @qLike OR LabourDescription LIKE @qLike)
            ORDER BY LabourDescription";

        var results = new List<BaplDmsLabourRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@jobTypeId", (object?)jobTypeId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@serviceHeadId", (object?)serviceHeadId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@serviceTypeId", (object?)serviceTypeId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@qLike", string.IsNullOrWhiteSpace(q) ? (object)DBNull.Value : $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new BaplDmsLabourRow(
                    Convert.ToInt32(rdr["Id"]),
                    rdr["LabourCode"] as string ?? "",
                    rdr["LabourDescription"] as string,
                    rdr["HSNCode"] as string,
                    ToNullableDecimal(rdr["SGST"]),
                    ToNullableDecimal(rdr["CGST"]),
                    ToNullableDecimal(rdr["IGST"]),
                    ToNullableDecimal(rdr["LabourRate"]),
                    rdr["Category"] as string,
                    ToNullableInt(rdr["Jobtype"]),
                    ToNullableInt(rdr["ServiceHead"]),
                    ToNullableInt(rdr["ServiceType"]),
                    rdr["oemmodelname"] as string));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's labour rate card (LabourMaster): {ex.Message}", ex);
        }
        return results;
    }

    public async Task<BaplDmsRepairBillHeaderDetail?> GetRepairBillHeaderDetailAsync(int jobCardHeaderId, CancellationToken ct = default)
    {
        const string sql = @"
            SELECT TOP 1
                Id, JobId, LocationCode, Prefix, BillNo, BillType, CustomerLedgerId,
                TotalDiscount, TotalTaxableAmount, TotalNetAmount, AmountReceived, RepairbillStatus
            FROM [dbo].[RepairBillHeader]
            WHERE JobId = @jobId AND ISNULL(IsDelete, 0) = 0
            ORDER BY Id DESC";
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@jobId", jobCardHeaderId);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (!await rdr.ReadAsync(ct)) return null;

            return new BaplDmsRepairBillHeaderDetail(
                (int)rdr["Id"],
                (int)rdr["JobId"],
                rdr["LocationCode"] as string,
                rdr["Prefix"] as string,
                rdr["BillNo"] as int?,
                rdr["BillType"] as string,
                rdr["CustomerLedgerId"] as int?,
                rdr["TotalDiscount"] as decimal?,
                rdr["TotalTaxableAmount"] as decimal?,
                rdr["TotalNetAmount"] as decimal?,
                rdr["AmountReceived"] as decimal?,
                rdr["RepairbillStatus"] as string);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's repair bill header for job card {jobCardHeaderId}: {ex.Message}", ex);
        }
    }

    public async Task<IReadOnlyList<BaplDmsRepairBillDetailRow>> GetRepairBillDetailLinesAsync(int repairBillId, CancellationToken ct = default)
    {
        const string sql = @"
            SELECT
                MaterialId, LabourMasterId, PartWiseLabourId, PartItemId, ItemType,
                LabourQty, PartQty, LabourRate, PartRate, DiscountValue, LabourDiscount, PartDiscount, DiscountType,
                Igstamount, Cgstamount, Sgstamount, IssutypeId, LabourTaxblAmount, PartTaxblAmount,
                LabourNetAmount, PartNetAmount, TotalTaxPer
            FROM [dbo].[RepairBillDetail]
            WHERE RepairBillId = @id";
        var results = new List<BaplDmsRepairBillDetailRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@id", repairBillId);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new BaplDmsRepairBillDetailRow(
                    rdr["MaterialId"] as int?,
                    rdr["LabourMasterId"] as int?,
                    rdr["PartWiseLabourId"] as int?,
                    rdr["PartItemId"] as int?,
                    rdr["ItemType"]?.ToString(),
                    rdr["LabourQty"] as decimal?,
                    rdr["PartQty"] as decimal?,
                    rdr["LabourRate"] as decimal?,
                    rdr["PartRate"] as decimal?,
                    rdr["DiscountValue"] as decimal?,
                    rdr["LabourDiscount"] as decimal?,
                    rdr["PartDiscount"] as decimal?,
                    rdr["DiscountType"]?.ToString(),
                    rdr["Igstamount"] as decimal?,
                    rdr["Cgstamount"] as decimal?,
                    rdr["Sgstamount"] as decimal?,
                    rdr["IssutypeId"] as int?,
                    rdr["LabourTaxblAmount"] as decimal?,
                    rdr["PartTaxblAmount"] as decimal?,
                    rdr["LabourNetAmount"] as decimal?,
                    rdr["PartNetAmount"] as decimal?,
                    rdr["TotalTaxPer"] as decimal?));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's repair bill lines for bill {repairBillId}: {ex.Message}", ex);
        }
        return results;
    }

    public async Task<BaplDmsCustomerLedgerDetail?> GetCustomerLedgerDetailAsync(int ledgerId, CancellationToken ct = default)
    {
        // PRIMARY: same confirmed LedgerMaster/Cities columns LookupVehicleAsync already uses.
        const string primarySql = @"
            SELECT TOP 1 lg.Id, lg.LedgerName, lg.MobileNumber, cty.city_name
            FROM [dbo].[LedgerMaster] lg
            LEFT JOIN [dbo].[Cities] cty ON lg.City = cty.city_id
            WHERE lg.Id = @id";

        string? name = null, mobile = null, city = null;
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);

            await using (var cmd = new SqlCommand(primarySql, conn) { CommandTimeout = 30 })
            {
                cmd.Parameters.AddWithValue("@id", ledgerId);
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                if (!await rdr.ReadAsync(ct)) return null;
                name = rdr["LedgerName"] as string;
                mobile = rdr["MobileNumber"] as string;
                city = rdr["city_name"] as string;
            }

            // ENRICHMENT 1: Address/Email - the same already-proven best-effort guess
            // LookupVehicleAsync uses (see its doc comment) - isolated so a wrong guess here still
            // leaves Name/Mobile/City intact.
            string? address = null, email = null;
            try
            {
                const string addrSql = "SELECT Address, Email FROM [dbo].[LedgerMaster] WHERE Id = @id";
                await using var cmd = new SqlCommand(addrSql, conn) { CommandTimeout = 30 };
                cmd.Parameters.AddWithValue("@id", ledgerId);
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    address = rdr["Address"] as string;
                    email = rdr["Email"] as string;
                }
            }
            catch (Exception ex)
            {
                _logger.LogInformation(ex, "BAPL DMS LedgerMaster Address/Email enrichment skipped for invoice ledger {LedgerId}", ledgerId);
            }

            // ENRICHMENT 2: State/Gstin - a NEW guess (never confirmed against a live SELECT *),
            // isolated from everything above so a wrong column name here only means the invoice
            // prints "-" for State/GSTIN, nothing else.
            string? state = null, gstin = null;
            try
            {
                const string stateGstSql = "SELECT State, Gstin FROM [dbo].[LedgerMaster] WHERE Id = @id";
                await using var cmd = new SqlCommand(stateGstSql, conn) { CommandTimeout = 30 };
                cmd.Parameters.AddWithValue("@id", ledgerId);
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    state = rdr["State"] as string;
                    gstin = rdr["Gstin"] as string;
                }
            }
            catch (Exception ex)
            {
                _logger.LogInformation(ex, "BAPL DMS LedgerMaster State/Gstin lookup skipped for invoice ledger {LedgerId} (unconfirmed column names)", ledgerId);
            }

            return new BaplDmsCustomerLedgerDetail(ledgerId, name, mobile, city, address, email, state, gstin);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's customer ledger {ledgerId}: {ex.Message}", ex);
        }
    }

    /// <summary>
    /// See add-bapldms-jobcard-media-table.sql - a NEW, JobCardScanner-owned table in BAPLDMSvad
    /// (never an existing BAPL DMS table, since none was confirmed to hold photos anywhere in this
    /// codebase). Best-effort only: JobCardsController.UploadPhoto calls this AFTER its own local
    /// save already succeeded, and catches whatever this throws without letting it affect the HTTP
    /// response.
    /// </summary>
    public async Task SaveJobCardPhotoAsync(int jobId, string fileName, string? contentType, string? stage, string? caption, byte[] bytes, CancellationToken ct = default)
    {
        const string sql = @"
            INSERT INTO [dbo].[JobCardScannerMedia]
                (Id, JobId, FileName, ContentType, Stage, Caption, PhotoBytes, UploadedAtUtc)
            VALUES
                (@id, @jobId, @fileName, @contentType, @stage, @caption, @bytes, SYSUTCDATETIME())";
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@id", Guid.NewGuid());
            cmd.Parameters.AddWithValue("@jobId", jobId);
            cmd.Parameters.AddWithValue("@fileName", (object?)fileName ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@contentType", (object?)contentType ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@stage", (object?)stage ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@caption", (object?)caption ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@bytes", bytes);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not write job card photo into BAPL DMS (dbo.JobCardScannerMedia) for job {jobId}: {ex.Message}", ex);
        }
    }

    /// <summary>
    /// See IBaplDmsService.VerifyDealerCredentialsAsync's doc comment - this NEVER throws past the
    /// caller (unlike every other method in this class): a login endpoint must degrade to "not
    /// found" on any unexpected failure, not surface a 500.
    ///
    /// Matches by NormalizedUserName OR NormalizedEmail - confirmed against BAPL DMS's own real
    /// AuthController.Login source (you pasted it), which does
    /// <c>_userManager.FindByNameAsync(x) ?? _userManager.FindByEmailAsync(x)</c>. Several AspNetUsers
    /// rows have a UserName that isn't their Email at all (e.g. "CUS0486" with email
    /// naveenbijliride@gmail.com) - BAPL DMS's own login screen accepts either, so whoever owns that
    /// account may only know "CUS0486" as their sign-in, not the email behind it. Matching email-only
    /// (the original version of this query) would silently 401 that person even with the exact right
    /// password. TOP 1 with an OR is a safe stand-in for BAPL DMS's try-username-then-email order:
    /// a real account's UserName and Email don't collide with a DIFFERENT account's Email/UserName in
    /// practice, since AspNetUsers enforces both as unique on their own.
    /// </summary>
    public async Task<BaplDmsDealerCredential?> VerifyDealerCredentialsAsync(string emailOrUserName, string password, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(emailOrUserName) || string.IsNullOrWhiteSpace(password)) return null;

        const string sql = @"
            SELECT TOP 1 Id, Email, UserName, PasswordHash, PhoneNumber, DealerCode
            FROM [dbo].[AspNetUsers]
            WHERE NormalizedUserName = @id OR NormalizedEmail = @id";

        try
        {
            string userId;
            string? actualEmail, userName, phone, dealerCode;

            await using (var conn = new SqlConnection(ConnStr))
            {
                await conn.OpenAsync(ct);
                await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
                cmd.Parameters.AddWithValue("@id", emailOrUserName.Trim().ToUpperInvariant());
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                if (!await rdr.ReadAsync(ct)) return null;

                var storedHash = rdr["PasswordHash"] as string;
                userId = (string)rdr["Id"];
                actualEmail = rdr["Email"] as string;
                userName = rdr["UserName"] as string;
                phone = rdr["PhoneNumber"] as string;
                dealerCode = rdr["DealerCode"] as string;

                if (string.IsNullOrWhiteSpace(storedHash)) return null;

                var hasher = new PasswordHasher<IdentityUser>();
                var result = hasher.VerifyHashedPassword(new IdentityUser(), storedHash, password);
                if (result != PasswordVerificationResult.Success && result != PasswordVerificationResult.SuccessRehashNeeded)
                    return null;

                // Second query, same connection/row, isolated in its own try/catch below - whether
                // this account carries BAPL DMS's own "Employee" role (AspNetUserRoles/AspNetRoles,
                // confirmed via your AspNetRoles dump). A schema surprise here must never turn an
                // otherwise-successful password check into a failed login, so IsBgEmployeeRole just
                // defaults to false (treated as the simple single-DealerCode case) if this throws.
                var isBgEmployeeRole = false;
                try
                {
                    const string roleSql = @"
                        SELECT COUNT(1)
                        FROM [dbo].[AspNetUserRoles] ur
                        JOIN [dbo].[AspNetRoles] r ON r.Id = ur.RoleId
                        WHERE ur.UserId = @userId AND r.Name = 'Employee'";
                    await using var roleCmd = new SqlCommand(roleSql, conn) { CommandTimeout = 30 };
                    roleCmd.Parameters.AddWithValue("@userId", userId);
                    var count = await roleCmd.ExecuteScalarAsync(ct);
                    isBgEmployeeRole = count is int n && n > 0;
                }
                catch (Exception roleEx)
                {
                    _logger.LogWarning(roleEx, "BAPL DMS Employee-role check failed/unavailable for {EmailOrUserName}, defaulting to false", emailOrUserName);
                }

                // actualEmail comes from the matched row's own Email column, which every AspNetUsers
                // row has populated (confirmed - none of yours are blank) - this only falls back to
                // whatever was typed in if that ever isn't true, and only when it actually looks like
                // an email, since the typed value may have been a bare UserName (e.g. "CUS0486") that
                // would be the wrong thing to store as this person's JobCardScanner login email.
                var resolvedEmail = !string.IsNullOrWhiteSpace(actualEmail) ? actualEmail
                    : emailOrUserName.Trim().Contains('@') ? emailOrUserName.Trim()
                    : null;
                if (resolvedEmail is null) return null; // no usable email anywhere - can't provision a JobCardScanner login without one

                return new BaplDmsDealerCredential(
                    resolvedEmail,
                    userName,
                    phone,
                    string.IsNullOrWhiteSpace(dealerCode) ? null : dealerCode.Trim(),
                    isBgEmployeeRole);
            }
        }
        catch (Exception ex)
        {
            // Deliberately swallowed (logged only) - see this method's doc comment on the interface:
            // a login flow must never crash because BAPL DMS's AspNetUsers schema surprised us.
            _logger.LogWarning(ex, "BAPL DMS dealer credential check failed/unavailable for {EmailOrUserName}", emailOrUserName);
            return null;
        }
    }

    /// <summary>See IBaplDmsService.ResolveEmployeeDealerScopeAsync's doc comment. Checks
    /// BgEmployeeMaster first (confirmed schema - you ran `SELECT TOP 3 * FROM BgEmployeeMaster`),
    /// falling back to EmployeeMaster (a separate table per BAPL DMS's own EmployeeMasterRepo.cs,
    /// NOT independently confirmed via a live SELECT - a schema surprise there is swallowed exactly
    /// like the primary lookup, both degrade to Found=false rather than throwing) only when
    /// BgEmployeeMaster has no matching row at all.</summary>
    public async Task<BaplDmsEmployeeScope> ResolveEmployeeDealerScopeAsync(string email, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(email)) return new BaplDmsEmployeeScope(false, false, Array.Empty<string>());

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);

            const string bgSql = @"
                SELECT TOP 1 IsActive, DealerCode
                FROM [dbo].[BgEmployeeMaster]
                WHERE EmailId = @email OR Email = @email";
            await using (var bgCmd = new SqlCommand(bgSql, conn) { CommandTimeout = 30 })
            {
                bgCmd.Parameters.AddWithValue("@email", email.Trim());
                await using var rdr = await bgCmd.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    var isActive = rdr["IsActive"] is bool b && b;
                    var raw = rdr["DealerCode"] as string;
                    var codes = SplitDealerCodes(raw);
                    return new BaplDmsEmployeeScope(true, isActive, codes);
                }
            }

            try
            {
                const string empSql = @"
                    SELECT TOP 1 DealerCode
                    FROM [dbo].[EmployeeMaster]
                    WHERE EmailId = @email";
                await using var empCmd = new SqlCommand(empSql, conn) { CommandTimeout = 30 };
                empCmd.Parameters.AddWithValue("@email", email.Trim());
                await using var rdr = await empCmd.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    var raw = rdr["DealerCode"] as string;
                    // EmployeeMaster has no IsActive column confirmed - treat "row exists" as active,
                    // same as BAPL DMS's own EmployeeMasterRepo fallback implicitly does.
                    return new BaplDmsEmployeeScope(true, true, SplitDealerCodes(raw));
                }
            }
            catch (Exception empEx)
            {
                _logger.LogWarning(empEx, "BAPL DMS EmployeeMaster fallback lookup failed/unavailable for {Email}", email);
            }

            return new BaplDmsEmployeeScope(false, false, Array.Empty<string>());
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "BAPL DMS employee dealer-scope resolution failed/unavailable for {Email}", email);
            return new BaplDmsEmployeeScope(false, false, Array.Empty<string>());
        }
    }

    /// <summary>Reads a nullable numeric column (decimal/float/real/int - LabourMaster's exact
    /// underlying SQL type for SGST/CGST/IGST/LabourRate isn't pinned down, only that its values are
    /// numeric, e.g. 9.00/53.333333) as decimal, without the `as decimal?` cast operator's failure
    /// mode of silently returning null for a boxed value that isn't EXACTLY System.Decimal (e.g. a
    /// boxed double from a float/real column) - Convert.ToDecimal handles any numeric type.</summary>
    private static decimal? ToNullableDecimal(object val) => val is DBNull ? null : Convert.ToDecimal(val);

    private static int? ToNullableInt(object val) => val is DBNull ? null : Convert.ToInt32(val);

    private static IReadOnlyList<string> SplitDealerCodes(string? raw) =>
        string.IsNullOrWhiteSpace(raw)
            ? Array.Empty<string>()
            : raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(c => c.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

    /// <summary>See IBaplDmsService.SearchAspNetUsersAsync's doc comment.</summary>
    public async Task<IReadOnlyList<BaplDmsAspNetUserRow>> SearchAspNetUsersAsync(string? q, CancellationToken ct = default)
    {
        const string sql = @"
            SELECT TOP 500 Id, Email, UserName, PhoneNumber, DealerCode, LockoutEnabled, EmailConfirmed
            FROM [dbo].[AspNetUsers]
            WHERE (@qLike IS NULL OR Email LIKE @qLike OR UserName LIKE @qLike OR DealerCode LIKE @qLike)
            ORDER BY Email";

        var results = new List<BaplDmsAspNetUserRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@qLike", string.IsNullOrWhiteSpace(q) ? (object)DBNull.Value : $"%{q.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new BaplDmsAspNetUserRow(
                    rdr["Id"] as string ?? "",
                    rdr["Email"] as string ?? "",
                    rdr["UserName"] as string,
                    rdr["PhoneNumber"] as string,
                    rdr["DealerCode"] as string,
                    rdr["LockoutEnabled"] is bool le && le,
                    rdr["EmailConfirmed"] is bool ec && ec));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read BAPL DMS's AspNetUsers: {ex.Message}", ex);
        }

        return results;
    }

    private static DateOnly? ToDateOnly(object? value) =>
        value is DateTime dt ? DateOnly.FromDateTime(dt) : null;
}
