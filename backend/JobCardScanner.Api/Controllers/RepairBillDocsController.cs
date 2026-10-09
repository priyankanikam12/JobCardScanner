using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-09-19 "now i want Create Repair Bill and Material Transfer Bill ... only give changes
/// this new created 2 page dont change other pages ... i want to now this both pages data i want
/// save in JobCardScannerDb ... fetched data both from DMSBAPLDATAConnection from this db repair
/// bill and material transfer this both data wants to show in 1 place". A brand-new controller
/// (not a change to the existing read-only DmsBaplDataController/RepairBillPage.tsx "Repair Bill
/// Report" page) backing the new "Repair Bill" sidebar page: creates bills into JobCardScannerDb's
/// own RepairBillDocs/RepairBillDocItems tables (see Models/RepairBillDocs.cs), and separately
/// offers a "combined" listing that merges those JobCardScannerDb-native rows with the existing
/// read-only DMSBAPLDATA-synced DMS_RepairBill rows (via the already-built IDmsBaplDataService,
/// reused as-is) into one array - each row tagged with its Source so the two are shown together
/// without being conflated as if they were the same underlying record.
///
/// 2026-09-30 (SECTION 162, "real access lock" for Supervisor - Supervisor should only be able to
/// use Dashboard, Job Cards and Attendance): class-level gate switched from
/// Policies.ServiceAdvisorUp to the new "ServiceAdvisorUpNoSupervisor" policy (see Program.cs's
/// AddAuthorization block) - same reasoning as MaterialTransferDocsController's identical change:
/// ServiceAdvisorUp is shared with JobCardsController (which Supervisor keeps), but this controller
/// is unrelated to Job Cards, so narrowing THIS controller's own policy doesn't touch that one. The
/// separate SystemAdminOnly-gated action further down (Delete, line ~533) is untouched.
///
/// 2026-10-05 ("for systemadmin and corporate admin dont have dealerid but they will show all"):
/// CorporateAdmin and SystemAdmin have NO dealer of their own, and every READ below used to be
/// hard-wired to `DealerId == the caller's dealer` - a null for these two roles, so their lists were
/// empty or failed outright (a bare `Forbid()` with no usable authentication scheme can even surface
/// as an HTTP 500). Reads (List, Combined, Get) and the SystemAdmin-only Delete now cover EVERY dealer
/// for those two roles (IsOrgWideRole below), the same convention JobCardsController.List already
/// uses; every other role is still scoped to its own dealer exactly as before. WRITES (Create,
/// Update, UpdateStatus) are deliberately left dealer-scoped - a bill is created under a dealer, and
/// an org-wide login has none to create it under - and now answer with a plain 403 + message instead
/// of a bare Forbid(). The list actions also catch a failed database read and return its real
/// message, so a missing column shows up on the page instead of an anonymous 500.
/// </summary>
[ApiController]
[Route("api/repair-bill-docs")]
[Authorize(Policy = Policies.Staff)]
public class RepairBillDocsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IJobCardNumberingService _numbering;
    private readonly IDmsBaplDataService _dmsBaplData;
    private readonly IExtendedBatteryWarrantyEligibilityService _ebwEligibility;
    private readonly IAuditLogService _audit;
    private readonly ILogger<RepairBillDocsController> _logger;

    public RepairBillDocsController(
        JobCardScannerDbContext db, ICurrentUserService currentUser, IJobCardNumberingService numbering,
        IDmsBaplDataService dmsBaplData, IExtendedBatteryWarrantyEligibilityService ebwEligibility,
        IAuditLogService audit, ILogger<RepairBillDocsController> logger)
    {
        _db = db;
        _currentUser = currentUser;
        _numbering = numbering;
        _dmsBaplData = dmsBaplData;
        _ebwEligibility = ebwEligibility;
        _audit = audit;
        _logger = logger;
    }

    /// <summary>2026-10-05: CorporateAdmin / SystemAdmin have no dealer of their own and read EVERY
    /// dealer's repair bills (same convention as JobCardsController.List's isOrgWideRole). Writes stay
    /// dealer-scoped - see this controller's doc comment.</summary>
    private bool IsOrgWideRole => _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;

    /// <summary>GET /api/repair-bill-docs - this dealer's own JobCardScannerDb-native bills only
    /// (newest first), IsDeleted rows excluded (reference: DeleteRepairbill soft-deletes and the
    /// reference's own list query excludes IsDelete rows too). Search filters mirror the reference
    /// GetAllRepairBillList's own filter set (DealerCode/LocationCode are implicit here - already
    /// scoped to the signed-in user's dealer - so only BillNo/RegNo/ChassisNo/DateFrom/DateTo are
    /// exposed). For the combined DMSBAPLDATA + JobCardScannerDb view, use /combined below.
    ///
    /// 2026-09-28 (SECTION 150, "in print click download invoioce download then it will not
    /// download why?"): added `jobCardId` - lets a caller ask "does THIS job card have a Repair
    /// Bill here" directly, instead of pulling every bill for the dealer and filtering client-side.
    /// Added specifically for the Job Card Detail page/screen's Print menu's new "Invoice" option
    /// (see JobCardDetailPage.tsx/JobCardDetailScreen.tsx's own PrintMenu.printInvoice) - the old
    /// version of that option read DMS's own invoice-pdf endpoint
    /// (JobCardsController.InvoicePdf), which always 404s for a job whose repair bill was saved
    /// through THIS controller instead (this app never writes bills back to DMS - see this
    /// controller's own top-of-file doc comment). Also now Includes JobCard, so ToRow's own
    /// JobCardNumber projection (previously always null from this action - JobCard was never
    /// loaded here, only Get()/Combined() below ever Included it) actually returns a value.
    ///
    /// 2026-10-05: CorporateAdmin/SystemAdmin (no dealer of their own) get EVERY dealer's bills; other
    /// roles are scoped to their own dealer as before.</summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? billNo = null, [FromQuery] string? regNo = null,
        [FromQuery] string? chassisNo = null, [FromQuery] DateOnly? dateFrom = null, [FromQuery] DateOnly? dateTo = null,
        [FromQuery] Guid? jobCardId = null)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null && !IsOrgWideRole)
            return StatusCode(403, new { message = "This login is not linked to a dealer, so it has no repair bill list of its own." });

        var query = _db.RepairBillDocs.AsNoTracking().Where(r => !r.IsDeleted);
        if (!IsOrgWideRole) query = query.Where(r => r.DealerId == dealerId);

        if (!string.IsNullOrWhiteSpace(billNo)) query = query.Where(r => r.BillNumber.Contains(billNo));
        if (!string.IsNullOrWhiteSpace(regNo)) query = query.Where(r => r.RegNo != null && r.RegNo.Contains(regNo));
        if (!string.IsNullOrWhiteSpace(chassisNo)) query = query.Where(r => r.ChassisNo != null && r.ChassisNo.Contains(chassisNo));
        if (dateFrom is not null) query = query.Where(r => r.BillDate >= dateFrom);
        if (dateTo is not null) query = query.Where(r => r.BillDate <= dateTo);
        if (jobCardId is not null) query = query.Where(r => r.JobCardId == jobCardId);

        List<RepairBillDoc> bills;
        try
        {
            bills = await query.Include(r => r.Items).Include(r => r.JobCard).OrderByDescending(r => r.CreatedAt).ToListAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Repair bill list: could not read RepairBillDocs.");
            return StatusCode(500, new { message = $"Could not read the repair bills: {ex.GetBaseException().Message}" });
        }

        return Ok(bills.Select(ToRow));
    }

    /// <summary>
    /// GET /api/repair-bill-docs/combined?party=Zomato - "this both data wants to show in 1
    /// place": this dealer's own newly-created JobCardScannerDb bills, UNION'd with the existing
    /// read-only DMSBAPLDATA repair-bill rows (same data source/endpoint the "Repair Bill Report"
    /// page already reads, GetRepairBillsAsync - not re-queried or duplicated logic, just reused),
    /// sorted by date descending. DMSBAPLDATA connectivity problems don't fail the whole request -
    /// this app's own rows still come back, with dmsBaplDataError set so the page can say so,
    /// since the two data sources are independent and one being briefly unreachable shouldn't hide
    /// the other.
    ///
    /// 2026-09-21 sixth round ("according /repair-bill-list do in our repair bill"): billNo/jobNo/
    /// chassisNo/locationCode/dateFrom/dateTo added, matching the reference repair-bill-list.ts's
    /// own filter set (repairbillsearchModel) - applied only to this dealer's own JobCardScannerDb
    /// rows (List above already supports the same filters for the non-combined endpoint). The
    /// existing DMSBAPLDATA side of this endpoint only ever supported a `party` filter
    /// (GetRepairBillsAsync's own signature) - that is unchanged; the new filters simply don't
    /// narrow the DMSBAPLDATA half, since IDmsBaplDataService has no location/date/bill-no/job-no
    /// filtering capability to call into, and inventing one here would mean guessing at a query
    /// shape DmsBaplDataService.cs was never built to support.
    ///
    /// 2026-10-05: CorporateAdmin/SystemAdmin (no dealer of their own) get EVERY dealer's own bills here;
    /// other roles are scoped to their own dealer as before.
    /// </summary>
    [HttpGet("combined")]
    public async Task<IActionResult> Combined(
        [FromQuery] string? party = "Zomato", [FromQuery] string? billNo = null, [FromQuery] string? jobNo = null,
        [FromQuery] string? chassisNo = null, [FromQuery] string? locationCode = null,
        [FromQuery] DateOnly? dateFrom = null, [FromQuery] DateOnly? dateTo = null,
        // 2026-09-23 ("only which are save in jobcard db"): the new RepairBillListPage.tsx/
        // RepairBillListScreen.tsx (Web/Android) show ONLY this dealer's own JobCardScanner-saved
        // bills, never the read-only DMSBAPLDATA-synced ones - passing ownOnly=true skips the
        // DMSBAPLDATA call entirely instead of fetching it and then discarding it client-side, so
        // that list also loads faster and can't be slowed/failed by a DMSBAPLDATA outage it never
        // needed to begin with. Defaults to false so every existing caller (RepairBillCreatePage.tsx
        // itself, which still blends both sources) is unaffected.
        [FromQuery] bool ownOnly = false)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null && !IsOrgWideRole)
            return StatusCode(403, new { message = "This login is not linked to a dealer, so it has no repair bill list of its own." });

        var localQuery = _db.RepairBillDocs.AsNoTracking().Where(r => !r.IsDeleted);
        if (!IsOrgWideRole) localQuery = localQuery.Where(r => r.DealerId == dealerId);
        if (!string.IsNullOrWhiteSpace(billNo)) localQuery = localQuery.Where(r => r.BillNumber.Contains(billNo));
        if (!string.IsNullOrWhiteSpace(jobNo)) localQuery = localQuery.Where(r => r.JobCard != null && r.JobCard.JobCardNumber.Contains(jobNo));
        if (!string.IsNullOrWhiteSpace(chassisNo)) localQuery = localQuery.Where(r => r.ChassisNo != null && r.ChassisNo.Contains(chassisNo));
        if (!string.IsNullOrWhiteSpace(locationCode)) localQuery = localQuery.Where(r => r.Location == locationCode);
        if (dateFrom is not null) localQuery = localQuery.Where(r => r.BillDate >= dateFrom);
        if (dateTo is not null) localQuery = localQuery.Where(r => r.BillDate <= dateTo);

        List<RepairBillDoc> localBills;
        try
        {
            localBills = await localQuery
                .Include(r => r.Items)
                .Include(r => r.JobCard)
                .Include(r => r.CreatedBy)
                .Include(r => r.UpdatedBy)
                .OrderByDescending(r => r.CreatedAt)
                .ToListAsync();
        }
        catch (Exception ex)
        {
            // 2026-10-05: return the database's own message (e.g. "Invalid column name ...") so a missing
            // column is visible on the page instead of an anonymous HTTP 500.
            _logger.LogError(ex, "Repair bill list: could not read RepairBillDocs.");
            return StatusCode(500, new { message = $"Could not read the repair bills: {ex.GetBaseException().Message}" });
        }

        var combined = new List<CombinedRepairBillRow>(localBills.Select(ToCombinedRow));

        string? dmsError = null;
        if (!ownOnly)
        try
        {
            var dmsRows = await _dmsBaplData.GetRepairBillsAsync(party, HttpContext.RequestAborted);
            combined.AddRange(dmsRows.Select(r => new CombinedRepairBillRow(
                Source: "DMSBAPLDATA",
                Id: $"dms-{r.Id}",
                BillNumber: r.InvoiceNo?.ToString() ?? "—",
                SortDate: r.InvoiceDate ?? r.CreatedAt ?? DateTime.MinValue,
                PartyName: r.PartyName,
                RegNo: r.RegNo,
                ChassisNo: r.ChassisNo,
                Location: r.Location,
                BillType: r.BillType?.ToString(),
                Status: null,
                TotalAmount: r.Items.Sum(i => i.TotAmnt ?? 0),
                ItemCount: r.Items.Count,
                Items: r.Items.Select(i => (object)new
                {
                    i.Id, i.ItemIdno, i.ItemCode, i.ItemDesc, i.ItemType, i.Qty, i.Rate, i.IssueType,
                    i.SgstPer, i.SgstAmount, i.CgstPer, i.CgstAmount, i.IgstPer, i.IgstAmount,
                    i.WavRate, i.TotAmnt, i.MtrlIssue,
                }).ToList())));
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Combined repair-bill view: DMSBAPLDATA unreachable (party filter: {Party})", party);
            dmsError = ex.Message;
        }

        return Ok(new { rows = combined.OrderByDescending(r => r.SortDate), dmsBaplDataError = dmsError });
    }

    // 2026-09-23 ("this grid button click from db which material transfer that will shown for
    // Save as proforma and save as invoice" - see RepairBillCreatePage.tsx's own "startEditBill"
    // doc comment): now also Includes JobCard, and ToRow below now returns JobCardId/JobCardNumber
    // - needed so the web page can re-link the same Job (and, through that, re-fetch its current
    // Material Transfer items) when a Performa bill is reopened for editing. Neither field was
    // exposed here before since nothing previously needed to reconstruct a bill's Job link from
    // this endpoint alone.
    //
    // 2026-10-05: CorporateAdmin/SystemAdmin can open ANY dealer's bill (so Print Invoice works from the
    // all-dealers list); other roles only their own dealer's.
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var dealerId = _currentUser.DealerId;
        var orgWide = IsOrgWideRole;
        var bill = await _db.RepairBillDocs.AsNoTracking().Include(r => r.Items).Include(r => r.JobCard)
            .FirstOrDefaultAsync(r => r.Id == id && (orgWide || r.DealerId == dealerId) && !r.IsDeleted);
        return bill is null ? NotFound() : Ok(ToRow(bill));
    }

    /// <summary>
    /// POST /api/repair-bill-docs - creates and saves a repair bill into JobCardScannerDb.
    /// Corrected 2026-09-21 ("dont chnage Repair Bill ... logic"): matches the reference
    /// RepairBillRepo.InsertRepairBill exactly in division of responsibility - the reference NEVER
    /// decides same-state vs different-state or which GST rate applies; it only persists whatever
    /// Cgstamount/Sgstamount/Igstamount the caller already resolved (Angular, from
    /// LabourMaster/PartWiseLabour's own stored rates). So here too: CgstPct/SgstPct/IgstPct come
    /// directly from the request, independent of each other, and this action only does the
    /// arithmetic (discount off the base, then rate% x taxable amount) - it does not guess which
    /// of the three applies from Customer/Dealer state. IssueType "U/W" or "FSC" zeroes every
    /// line's taxable/tax amounts, matching the reference app's own special-casing for
    /// warranty/free-service work (confirmed in the reference's Angular sanitizeForSave).
    ///
    /// 2026-09-22 "needs to create warenty table in jobcardscanner db for this functionality and
    /// add this in our function": each Part line is checked, NON-DESTRUCTIVELY, against this
    /// dealer's Extended Battery Warranty Schemes (see Models/ExtendedBatteryWarrantySchemes.cs
    /// and Services/IExtendedBatteryWarrantyEligibilityService.cs for the formula) when req.VehicleId
    /// resolves to a Vehicle with a PurchaseDate on file. A match is found by the line's ItemCode
    /// equalling a candidate scheme's BatteryPartCode or PartCode (case-insensitive) - when found,
    /// RepairBillDocItem.ExtendedBatteryWarrantySchemeId/IsUnderExtendedWarranty are set for
    /// audit/display only. This NEVER changes Rate/DiscountValue/CgstPct/SgstPct/IgstPct/
    /// TaxableAmount/TotalAmount above, which stay exactly what the caller submitted - a dealer's
    /// own pricing entry always wins, this is metadata layered on top of it, not a substitute for
    /// it. No match (no VehicleId, no PurchaseDate on file, or no scheme configured for this
    /// model/part) silently leaves both fields null, same as any bill saved before this feature
    /// existed.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create(CreateRepairBillRequest req)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null)
            return StatusCode(403, new { message = "A repair bill is created under a dealer - this login is not linked to one." });
        if (string.IsNullOrWhiteSpace(req.PartyName)) return BadRequest(new { message = "Party Name is required." });
        if (req.Items is null || req.Items.Count == 0) return BadRequest(new { message = "Add at least one item or labour line." });

        var dealer = await _db.Dealers.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dealerId);
        if (dealer is null) return BadRequest(new { message = "Dealer not found for the signed-in user." });

        var bill = new RepairBillDoc
        {
            DealerId = dealerId.Value,
            BillNumber = await _numbering.NextRepairBillNumberAsync(dealerId.Value),
            JobCardId = req.JobCardId,
            CustomerId = req.CustomerId,
            VehicleId = req.VehicleId,
            PartyName = req.PartyName.Trim(),
            RegNo = req.RegNo,
            ChassisNo = req.ChassisNo,
            Location = req.Location,
            BillType = req.BillType,
            IssueType = req.IssueType,
            Remarks = req.Remarks,
            InsuranceCompanyName = req.InsuranceCompanyName,
            InsuranceDescription = req.InsuranceDescription,
            SurveyorName = req.SurveyorName,
            SurveyorContactNumber = req.SurveyorContactNumber,
            PolicyNo = req.PolicyNo,
            InsuranceValidTill = req.InsuranceValidTill,
            ZeroDepreciation = req.ZeroDepreciation,
            TotalDiscount = req.TotalDiscount,
            AmountReceived = req.AmountReceived,
            BillDate = req.BillDate ?? DateOnly.FromDateTime(DateTime.UtcNow),
            CreatedById = _currentUser.UserId,
            Status = RepairBillDocStatus.Performa,
        };

        var error = await BuildAndAttachItemsAsync(bill, req, dealerId.Value);
        if (error is not null) return BadRequest(new { message = error });

        _db.RepairBillDocs.Add(bill);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("RepairBillDoc.Create", "RepairBillDoc", bill.Id.ToString(), new { bill.BillNumber, bill.TotalAmount });

        return Ok(ToRow(bill));
    }

    /// <summary>
    /// PUT /api/repair-bill-docs/{id} - 2026-09-23 ("this grid button click from db which
    /// material transfer that will shown for Save as proforma and save as invoice", confirmed via
    /// video: the reference DMS app's own Repair Bill List lets you click a saved bill and it
    /// reopens as the SAME editable create form - Job Details/Labour/Part Details List all
    /// pre-filled - with Save As Proforma / Save As Invoice right there on that page, not a
    /// read-only popup): lets the "New Repair Bill" form on the web page above re-save an
    /// EXISTING bill's header + full Items list in place, instead of always creating a new one.
    /// Reuses the same CreateRepairBillRequest shape as POST (this is a full replace of Items, not
    /// a partial patch) and the same tax/EBW/stock calculation (BuildAndAttachItemsAsync, shared
    /// with Create below) - nothing about how a line's tax or stock impact is computed differs
    /// between creating and editing a bill.
    ///
    /// Only ever allowed while Status is still Performa - the reference's own lifecycle has no
    /// "un-invoice" step, and neither does this app's (see UpdateStatus's own doc comment); a
    /// Billed or Cancelled bill returns 400 rather than silently no-op'ing or letting an
    /// already-finalized bill's totals change under it. Status itself is never touched by this
    /// endpoint - moving Performa -> Billed still only ever happens via PUT .../status.
    ///
    /// Part Upload stock (PartUploads.BalQty - see Create's own doc comment): the OLD items' stock
    /// impact is restored first (the exact same restore Delete already performs), then the NEW
    /// items are decremented against that restored baseline via BuildAndAttachItemsAsync - so
    /// editing a Part line's Qty (or removing/adding a Part line entirely) nets out correctly
    /// instead of double-counting either the old or the new quantity.
    /// </summary>
    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, CreateRepairBillRequest req)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null)
            return StatusCode(403, new { message = "A repair bill is edited under its dealer - this login is not linked to one." });
        if (string.IsNullOrWhiteSpace(req.PartyName)) return BadRequest(new { message = "Party Name is required." });
        if (req.Items is null || req.Items.Count == 0) return BadRequest(new { message = "Add at least one item or labour line." });

        var bill = await _db.RepairBillDocs.Include(r => r.Items)
            .FirstOrDefaultAsync(r => r.Id == id && r.DealerId == dealerId && !r.IsDeleted);
        if (bill is null) return NotFound();
        if (bill.Status != RepairBillDocStatus.Performa)
            return BadRequest(new { message = $"Bill {bill.BillNumber} is already {bill.Status} - only a Proforma bill can be edited." });

        var dealer = await _db.Dealers.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dealerId);
        if (dealer is null) return BadRequest(new { message = "Dealer not found for the signed-in user." });

        // Restore PartUploads stock committed by the OLD items (see Delete's own identical
        // restore) BEFORE BuildAndAttachItemsAsync decrements stock again for the new items -
        // keyed off the bill's Location as it was before this update, since that's what the old
        // stock was actually committed against.
        if (!string.IsNullOrWhiteSpace(bill.Location))
        {
            foreach (var oldIt in bill.Items.Where(i => i.ItemType == RepairBillDocItemType.Part))
            {
                if (string.IsNullOrWhiteSpace(oldIt.ItemCode)) continue;
                var pu = await _db.PartUploads.FirstOrDefaultAsync(
                    p => p.DealerId == dealerId && p.LocationCode == bill.Location && p.PartNo == oldIt.ItemCode, HttpContext.RequestAborted);
                if (pu is not null) pu.BalQty = (pu.BalQty ?? 0) + (decimal)oldIt.Qty;
            }
        }

        bill.JobCardId = req.JobCardId;
        bill.CustomerId = req.CustomerId;
        bill.VehicleId = req.VehicleId;
        bill.PartyName = req.PartyName.Trim();
        bill.RegNo = req.RegNo;
        bill.ChassisNo = req.ChassisNo;
        bill.Location = req.Location;
        bill.BillType = req.BillType;
        bill.IssueType = req.IssueType;
        bill.Remarks = req.Remarks;
        bill.InsuranceCompanyName = req.InsuranceCompanyName;
        bill.InsuranceDescription = req.InsuranceDescription;
        bill.SurveyorName = req.SurveyorName;
        bill.SurveyorContactNumber = req.SurveyorContactNumber;
        bill.PolicyNo = req.PolicyNo;
        bill.InsuranceValidTill = req.InsuranceValidTill;
        bill.ZeroDepreciation = req.ZeroDepreciation;
        bill.TotalDiscount = req.TotalDiscount;
        bill.AmountReceived = req.AmountReceived;
        if (req.BillDate is not null) bill.BillDate = req.BillDate.Value;
        bill.UpdatedById = _currentUser.UserId;
        bill.UpdatedAt = DateTime.UtcNow;

        _db.RepairBillDocItems.RemoveRange(bill.Items);
        bill.Items.Clear();

        // 2026-10-09 ("i add discount and try to update then shown 'Could not update the repair bill'"): an unexpected failure here (a database error, a foreign-key problem, ...) used to escape
        // as a bare HTTP 500 with no body, so the page could only show its generic fallback text. It now answers with the real reason, like the list actions do. The audit entry is best-effort -
        // a failure writing it must not turn an already-saved update into an error.
        string? error;
        try
        {
            error = await BuildAndAttachItemsAsync(bill, req, dealerId.Value);
            if (error is null)
            {
                // 2026-10-09 FIX ("expected to affect 1 row(s), but actually affected 0 row(s)"): the replacement lines were added to the TRACKED bill's collection already carrying a key
                // (RepairBillDocItem.Id is pre-filled), so EF Core classed them as existing rows and sent UPDATEs that match nothing. Mark them Added explicitly so they are INSERTed.
                // (Create never hit this - it adds the whole new graph in one go.)
                foreach (var line in bill.Items) _db.Entry(line).State = EntityState.Added;
                await _db.SaveChangesAsync();
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Repair bill update failed for bill {BillId}.", id);
            return StatusCode(500, new { message = $"Could not update the repair bill: {ex.GetBaseException().Message}" });
        }
        if (error is not null) return BadRequest(new { message = error });

        try { await _audit.LogAsync("RepairBillDoc.Update", "RepairBillDoc", bill.Id.ToString(), new { bill.BillNumber, bill.TotalAmount }); }
        catch (Exception ex) { _logger.LogWarning(ex, "Audit entry for RepairBillDoc.Update could not be written."); }

        return Ok(ToRow(bill));
    }

    /// <summary>Shared by Create and Update above - builds RepairBillDocItem rows (per-line
    /// discount/tax calc, Extended Battery Warranty Scheme match, PartUploads stock decrement +
    /// validation) onto `bill.Items`, and sets the bill's own rollup Taxable/Cgst/Sgst/Igst/
    /// TotalAmount from them. Returns an insufficient-stock error message for the caller to
    /// return as 400, or null on success - see Create's original doc comment (now here) for the
    /// full reasoning behind each piece of this calculation; nothing about the calculation itself
    /// changed when this was extracted out of Create to also be reusable by Update.</summary>
    private async Task<string?> BuildAndAttachItemsAsync(RepairBillDoc bill, CreateRepairBillRequest req, Guid dealerId)
    {
        // 2026-10-07: "FOC" (free of cost) joins U/W and FSC. The Repair Bill screens (web and Android) already treated FOC as a zero-amount line on screen, but this
        // save-time calculation did not, so a saved FOC line came back with a non-zero taxable amount / total (and printed on the invoice). Now an FOC line is stored
        // with taxable, GST and total all 0 - the same as the screen shows.
        static bool IsZeroTax(string? issueType) =>
            string.Equals(issueType, "U/W", StringComparison.OrdinalIgnoreCase)
            || string.Equals(issueType, "FSC", StringComparison.OrdinalIgnoreCase)
            || string.Equals(issueType, "FOC", StringComparison.OrdinalIgnoreCase);

        // 2026-09-28 ("if qty 0 then give alert update qty") - same guard, same reasoning, as
        // MaterialTransferDocsController.ApplyStockAndBuildItemsAsync's own copy: a Part or Labour
        // line with Qty 0 is rejected with a message naming the line, surfaced as an on-screen
        // alert via the same err.response.data.message handling every other validation error on
        // this page already uses (e.g. "Add at least one item or labour line." above). I don't have
        // RepairBillCreatePage.tsx (or its mobile screen) staged this session to add a matching
        // client-side check on the qty input itself - paste it if you want that too.
        foreach (var it in req.Items)
        {
            if (it.Qty <= 0)
            {
                var label = !string.IsNullOrWhiteSpace(it.ItemDescription) ? it.ItemDescription
                    : !string.IsNullOrWhiteSpace(it.ItemCode) ? it.ItemCode : "This line";
                return $"'{label}' has Qty 0 - please update the quantity before saving.";
            }
        }

        // 2026-09-22 (Extended Battery Warranty Scheme) - resolved once per save, not per line:
        // candidate schemes only depend on the vehicle's Model/PurchaseDate/Odometer and the bill
        // date, none of which vary line to line.
        var ebwCandidates = new List<ExtendedBatteryWarrantyEligibilityResult>();
        if (req.VehicleId is not null)
        {
            var ebwVehicle = await _db.Vehicles.AsNoTracking()
                .FirstOrDefaultAsync(v => v.Id == req.VehicleId && v.DealerId == dealerId, HttpContext.RequestAborted);
            if (ebwVehicle?.PurchaseDate is not null)
            {
                ebwCandidates = await _ebwEligibility.EvaluateAsync(
                    dealerId, ebwVehicle.Model, ebwVehicle.PurchaseDate.Value,
                    (decimal)ebwVehicle.Odometer, bill.BillDate, HttpContext.RequestAborted);
            }
        }

        // 2026-09-21 ("part-upload balance qty use for that stock and when this will we saved
        // from part-upload balance qty minus from"): same PartUploads.BalQty decrement as
        // MaterialTransferDocsController.Create - see that method's doc comment for the full
        // reasoning (cumulative-across-lines cache, atomic with the bill save, live-DMS-picked
        // lines left untouched). Scoped to Part lines only here - a Labour line's ItemCode is a
        // labour code, not a part number, and never matches a PartUploads row anyway, but the
        // ItemType check makes that explicit rather than relying on the lookup simply missing.
        var partUploadCache = new Dictionary<string, PartUpload>(StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(req.Location))
        {
            foreach (var it in req.Items)
            {
                if (it.ItemType != RepairBillDocItemType.Part || string.IsNullOrWhiteSpace(it.ItemCode) || partUploadCache.ContainsKey(it.ItemCode)) continue;
                var pu = await _db.PartUploads.FirstOrDefaultAsync(
                    p => p.DealerId == dealerId && p.LocationCode == req.Location && p.PartNo == it.ItemCode, HttpContext.RequestAborted);
                if (pu is not null) partUploadCache[it.ItemCode] = pu;
            }
            foreach (var it in req.Items)
            {
                if (it.ItemType != RepairBillDocItemType.Part || !partUploadCache.TryGetValue(it.ItemCode, out var pu)) continue;
                var requestedQty = (decimal)it.Qty;
                var available = pu.BalQty ?? 0;
                if (requestedQty > available)
                    return $"Insufficient Part Upload stock for '{it.ItemCode}' at this location: available {available}, requested {requestedQty}.";
                pu.BalQty = available - requestedQty;
            }
        }

        foreach (var it in req.Items)
        {
            // 2026-09-21 correction: zero-tax is decided PER LINE (RepairBillDetail.IssutypeId is
            // a detail-row column in the reference, confirmed by re-reading that entity) - a line
            // with no IssueType of its own falls back to the bill-level default, not the other
            // way round, so an older caller that only ever sent the bill-level value still works.
            var zeroTax = IsZeroTax(it.IssueType ?? req.IssueType);

            decimal gross = (decimal)it.Qty * it.Rate;
            // Discount first, then GST on the discounted base - same order as the reference's own
            // Angular save flow (sanitizeForSave discounts before computing tax).
            decimal discountAmt = string.Equals(it.DiscountType, "Percentage", StringComparison.OrdinalIgnoreCase)
                ? gross * it.DiscountValue / 100m
                : it.DiscountValue;
            if (discountAmt > gross) discountAmt = gross;

            decimal taxable = zeroTax ? 0 : gross - discountAmt;
            decimal cgstPct = zeroTax ? 0 : it.CgstPct;
            decimal sgstPct = zeroTax ? 0 : it.SgstPct;
            decimal igstPct = zeroTax ? 0 : it.IgstPct;
            decimal cgstAmt = taxable * cgstPct / 100m;
            decimal sgstAmt = taxable * sgstPct / 100m;
            decimal igstAmt = taxable * igstPct / 100m;

            // Extended Battery Warranty Scheme match (see this method's own doc comment above) -
            // Part lines only; a Labour line's ItemCode is a labour code and never matches a
            // scheme's BatteryPartCode/PartCode. Audit/display metadata only - never feeds back
            // into taxable/cgstAmt/sgstAmt/igstAmt computed above.
            Guid? ebwSchemeId = null;
            bool? isUnderEbw = null;
            if (it.ItemType == RepairBillDocItemType.Part && !string.IsNullOrWhiteSpace(it.ItemCode) && ebwCandidates.Count > 0)
            {
                var ebwMatch = ebwCandidates.FirstOrDefault(s =>
                    (s.BatteryPartCode is not null && string.Equals(s.BatteryPartCode, it.ItemCode, StringComparison.OrdinalIgnoreCase))
                    || (s.PartCode is not null && string.Equals(s.PartCode, it.ItemCode, StringComparison.OrdinalIgnoreCase)));
                if (ebwMatch is not null)
                {
                    ebwSchemeId = ebwMatch.SchemeId;
                    isUnderEbw = ebwMatch.IsEligible;
                }
            }

            bill.Items.Add(new RepairBillDocItem
            {
                ItemType = it.ItemType,
                ItemCode = it.ItemCode,
                ItemDescription = it.ItemDescription,
                HsnCode = it.HsnCode,
                IssueType = it.IssueType,
                Qty = it.Qty,
                Rate = it.Rate,
                DiscountType = it.DiscountType,
                DiscountValue = it.DiscountValue,
                CgstPct = cgstPct,
                SgstPct = sgstPct,
                IgstPct = igstPct,
                TaxableAmount = taxable,
                CgstAmount = cgstAmt,
                SgstAmount = sgstAmt,
                IgstAmount = igstAmt,
                TotalAmount = taxable + cgstAmt + sgstAmt + igstAmt,
                ExtendedBatteryWarrantySchemeId = ebwSchemeId,
                IsUnderExtendedWarranty = isUnderEbw,
            });
        }

        bill.TaxableAmount = bill.Items.Sum(i => i.TaxableAmount);
        bill.CgstAmount = bill.Items.Sum(i => i.CgstAmount);
        bill.SgstAmount = bill.Items.Sum(i => i.SgstAmount);
        bill.IgstAmount = bill.Items.Sum(i => i.IgstAmount);
        bill.TotalAmount = bill.Items.Sum(i => i.TotalAmount);

        return null;
    }

    /// <summary>
    /// DELETE /api/repair-bill-docs/{id} - reference: RepairBillRepo.DeleteRepairbill, gated to
    /// "Only SuperAdmin can delete" (case-insensitive role check, else throws Unauthorized) and a
    /// SOFT delete (IsDelete = true), not a row removal. Ported as-is: SystemAdminOnly on top of
    /// this controller's own ServiceAdvisorUp gate, and IsDeleted = true rather than Remove(). The
    /// reference also recomputes the linked JobCardHeader.JobStatus from FFIR/IsMaterialTransfer
    /// state afterwards - that is BAPL-DMS-specific (JobCardHeader/FFIR live only in BAPLDMSvad,
    /// which this app never writes to) and is NOT ported; this bill's own JobCard (if linked) is
    /// left untouched, matching how this app's Estimate/Invoice deletes already behave.
    ///
    /// 2026-09-21 ("we delete thi material tranfer then as it is add this bal qty in part-upload
    /// page"): same restore as MaterialTransferDocsController.Delete, for this bill's own Part
    /// lines - see that method's doc comment. Applied on this soft delete too, not just a hard
    /// row removal, since IsDeleted = true is this app's real "undo" for a bill.
    ///
    /// 2026-10-05: SystemAdmin has no dealer of their own, so this now finds ANY dealer's bill (the
    /// all-dealers list shows them all) and restores stock against the BILL's own dealer
    /// (bill.DealerId), not the caller's.
    /// </summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.SystemAdminOnly)]
    public async Task<IActionResult> Delete(Guid id)
    {
        var dealerId = _currentUser.DealerId;
        var orgWide = IsOrgWideRole;
        var bill = await _db.RepairBillDocs.Include(r => r.Items)
            .FirstOrDefaultAsync(r => r.Id == id && (orgWide || r.DealerId == dealerId) && !r.IsDeleted);
        if (bill is null) return NotFound();

        if (!string.IsNullOrWhiteSpace(bill.Location))
        {
            foreach (var it in bill.Items.Where(i => i.ItemType == RepairBillDocItemType.Part))
            {
                if (string.IsNullOrWhiteSpace(it.ItemCode)) continue;
                var pu = await _db.PartUploads.FirstOrDefaultAsync(
                    p => p.DealerId == bill.DealerId && p.LocationCode == bill.Location && p.PartNo == it.ItemCode, HttpContext.RequestAborted);
                if (pu is not null) pu.BalQty = (pu.BalQty ?? 0) + (decimal)it.Qty;
            }
        }

        bill.IsDeleted = true;
        bill.UpdatedById = _currentUser.UserId;
        bill.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("RepairBillDoc.Delete", "RepairBillDoc", bill.Id.ToString(), new { bill.BillNumber });

        return NoContent();
    }

    /// <summary>PUT /api/repair-bill-docs/{id}/status - moves Performa -> Billed (or Cancelled).
    /// Simple status change only (no line-item edits once created), matching the reference app's
    /// own "Performa created -> Billed" lifecycle in spirit without porting its BAPL-DMS-specific
    /// JobCardHeader.InvoiceNo write-back (there's no DMS job card to write back to here).</summary>
    [HttpPut("{id:guid}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] RepairBillDocStatus status)
    {
        var dealerId = _currentUser.DealerId;
        var bill = await _db.RepairBillDocs.FirstOrDefaultAsync(r => r.Id == id && r.DealerId == dealerId);
        if (bill is null) return NotFound();
        bill.Status = status;

        // 2026-09-28 (SECTION 147, "when i click Generate Invoice ... we cant close jobcards
        // without repair ... save as proforma then save as invoice then this jobcard close"):
        // WITHDRAWS the SECTION 145 manual "Generate Invoice & Close Job Card" button (removed
        // from both apps this same section) in favour of THIS being the real close trigger - the
        // moment a bill linked to a job card is marked Billed (this app's own "Invoice" step, per
        // your wording), close that job card and advance it to the workflow's terminal
        // "invoice_generated" stage.
        //
        // CORRECTED same day (SECTION 149, "after repair bill also jobcrad not shown closed" -
        // your real report that SECTION 147's first version of this fix did not actually close the
        // job card): that first version relied only on WorkflowStageAutomation.AdvanceIfAheadAsync
        // to set JobCard.Status -> Closed, inferred from a doc comment on
        // JobCardsController.SyncClosedFromDmsAsync (its own DMS-closed sync sets Status/ClosedAt/
        // ActualDeliveryAt EXPLICITLY, itself, before ALSO calling AdvanceIfAheadAsync for the
        // stage/StageHistory side) - I do not have WorkflowStageAutomation.cs's actual source in
        // this session to confirm whether AdvanceIfAheadAsync closes the job card on its own, and
        // your real-world result shows it evidently does not (or at least not reliably). FIXED by
        // no longer depending on that assumption: this now sets jc.Status/ClosedAt/ActualDeliveryAt
        // EXPLICITLY itself, mirroring ChangeStage()'s own `if (stage.IsTerminal && jc.Status !=
        // JobCardStatus.Closed) {...}` logic and SyncClosedFromDmsAsync's identical pattern exactly
        // - AdvanceIfAheadAsync is still called afterwards, now purely for the
        // CurrentStage/StageHistory side (which SECTION 147's report didn't say was broken, only
        // that the job card wasn't "shown closed" - the stage advance may have been working while
        // Status silently wasn't). Never re-closes an already-closed job card (guarded by
        // `jc.Status != JobCardStatus.Closed`, same guard ChangeStage() uses) or overwrites an
        // earlier ActualDeliveryAt (`??=`).
        //
        // This also IS the "can't close jobcards without repair" rule you stated: since SECTION 147
        // removed every other way to reach "invoice_generated" from either app's UI, a job card can
        // now only close by a Repair Bill actually being saved as Invoice here. FLAGGED, not acted
        // on (out of scope for this request, but real): the OTP-based Closure flow
        // (InitiateClosureOtp/VerifyClosureOtp on JobCardsController) is still live on the backend
        // even though its UI card is hidden - it could still close a job card without a repair bill
        // if called directly. Tell me if you want that endpoint blocked/removed too.
        //
        // A bill with no JobCardId (not linked to any job card - e.g. a walk-in/party bill) or a
        // status other than Billed leaves the job card untouched, same as before this change.
        if (status == RepairBillDocStatus.Billed && bill.JobCardId is not null)
        {
            var jc = await _db.JobCards.FirstOrDefaultAsync(j => j.Id == bill.JobCardId.Value);
            if (jc is not null)
            {
                if (jc.Status != JobCardStatus.Closed)
                {
                    jc.Status = JobCardStatus.Closed;
                    jc.ClosedAt = DateTime.UtcNow;
                    jc.ActualDeliveryAt ??= DateTime.UtcNow;
                }
                await WorkflowStageAutomation.AdvanceIfAheadAsync(_db, jc, "invoice_generated", _currentUser.UserId, "Auto-advanced: repair bill saved as Invoice.");
            }
        }

        await _db.SaveChangesAsync();
        await _audit.LogAsync("RepairBillDoc.StatusChange", "RepairBillDoc", bill.Id.ToString(), new { bill.Status });
        return Ok(ToRow(bill));
    }

    private static object ToRow(RepairBillDoc b) => new
    {
        Source = "JobCardScanner",
        b.Id,
        b.BillNumber,
        BillDate = b.BillDate,
        // 2026-09-23 - see Get's own doc comment just above for why these two are now returned.
        b.JobCardId,
        JobCardNumber = b.JobCard?.JobCardNumber,
        b.PartyName,
        b.RegNo,
        b.ChassisNo,
        b.Location,
        b.BillType,
        b.IssueType,
        Status = b.Status.ToString(),
        // 2026-09-23 - Remarks was never returned here before (only ever saved). Now exposed too,
        // so re-opening a bill for editing (see the JobCardId/JobCardNumber note above) round-trips
        // it correctly instead of the edit form's Remarks field silently reverting to blank and
        // wiping it out on save.
        b.Remarks,
        b.InsuranceCompanyName,
        b.InsuranceDescription,
        b.SurveyorName,
        b.SurveyorContactNumber,
        b.PolicyNo,
        b.InsuranceValidTill,
        b.ZeroDepreciation,
        b.TotalDiscount,
        b.AmountReceived,
        b.TaxableAmount,
        b.CgstAmount,
        b.SgstAmount,
        b.IgstAmount,
        b.TotalAmount,
        ItemCount = b.Items.Count,
        Items = b.Items.Select(i => new
        {
            i.Id,
            ItemType = i.ItemType.ToString(),
            i.ItemCode,
            i.ItemDescription,
            i.HsnCode,
            i.IssueType,
            i.Qty,
            i.Rate,
            i.DiscountType,
            i.DiscountValue,
            i.CgstPct,
            i.SgstPct,
            i.IgstPct,
            i.TaxableAmount,
            i.CgstAmount,
            i.SgstAmount,
            i.IgstAmount,
            i.TotalAmount,
            i.ExtendedBatteryWarrantySchemeId,
            i.IsUnderExtendedWarranty,
        }),
    };

    private static CombinedRepairBillRow ToCombinedRow(RepairBillDoc b) => new(
        Source: "JobCardScanner",
        Id: b.Id.ToString(),
        BillNumber: b.BillNumber,
        SortDate: b.BillDate.ToDateTime(TimeOnly.MinValue),
        PartyName: b.PartyName,
        RegNo: b.RegNo,
        ChassisNo: b.ChassisNo,
        Location: b.Location,
        BillType: b.BillType,
        Status: b.Status.ToString(),
        TotalAmount: b.TotalAmount,
        ItemCount: b.Items.Count,
        JobNo: b.JobCard?.JobCardNumber,
        PreparedBy: b.CreatedBy?.Name,
        ModifiedBy: b.UpdatedBy?.Name,
        Items: b.Items.Select(i => (object)new
        {
            i.Id,
            ItemType = i.ItemType.ToString(),
            i.ItemCode,
            i.ItemDescription,
            i.HsnCode,
            i.IssueType,
            i.Qty,
            i.Rate,
            i.DiscountType,
            i.DiscountValue,
            i.CgstPct,
            i.SgstPct,
            i.IgstPct,
            i.TaxableAmount,
            i.CgstAmount,
            i.SgstAmount,
            i.IgstAmount,
            i.TotalAmount,
            i.ExtendedBatteryWarrantySchemeId,
            i.IsUnderExtendedWarranty,
        }).ToList());
}

