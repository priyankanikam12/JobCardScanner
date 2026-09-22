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
/// </summary>
[ApiController]
[Route("api/repair-bill-docs")]
[Authorize(Policy = Policies.ServiceAdvisorUp)]
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

    /// <summary>GET /api/repair-bill-docs - this dealer's own JobCardScannerDb-native bills only
    /// (newest first), IsDeleted rows excluded (reference: DeleteRepairbill soft-deletes and the
    /// reference's own list query excludes IsDelete rows too). Search filters mirror the reference
    /// GetAllRepairBillList's own filter set (DealerCode/LocationCode are implicit here - already
    /// scoped to the signed-in user's dealer - so only BillNo/RegNo/ChassisNo/DateFrom/DateTo are
    /// exposed). For the combined DMSBAPLDATA + JobCardScannerDb view, use /combined below.</summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? billNo = null, [FromQuery] string? regNo = null,
        [FromQuery] string? chassisNo = null, [FromQuery] DateOnly? dateFrom = null, [FromQuery] DateOnly? dateTo = null)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null) return Forbid();

        var query = _db.RepairBillDocs.AsNoTracking()
            .Where(r => r.DealerId == dealerId && !r.IsDeleted);

        if (!string.IsNullOrWhiteSpace(billNo)) query = query.Where(r => r.BillNumber.Contains(billNo));
        if (!string.IsNullOrWhiteSpace(regNo)) query = query.Where(r => r.RegNo != null && r.RegNo.Contains(regNo));
        if (!string.IsNullOrWhiteSpace(chassisNo)) query = query.Where(r => r.ChassisNo != null && r.ChassisNo.Contains(chassisNo));
        if (dateFrom is not null) query = query.Where(r => r.BillDate >= dateFrom);
        if (dateTo is not null) query = query.Where(r => r.BillDate <= dateTo);

        var bills = await query.Include(r => r.Items).OrderByDescending(r => r.CreatedAt).ToListAsync();

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
    /// </summary>
    [HttpGet("combined")]
    public async Task<IActionResult> Combined(
        [FromQuery] string? party = "Zomato", [FromQuery] string? billNo = null, [FromQuery] string? jobNo = null,
        [FromQuery] string? chassisNo = null, [FromQuery] string? locationCode = null,
        [FromQuery] DateOnly? dateFrom = null, [FromQuery] DateOnly? dateTo = null)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null) return Forbid();

        var localQuery = _db.RepairBillDocs.AsNoTracking()
            .Where(r => r.DealerId == dealerId && !r.IsDeleted);
        if (!string.IsNullOrWhiteSpace(billNo)) localQuery = localQuery.Where(r => r.BillNumber.Contains(billNo));
        if (!string.IsNullOrWhiteSpace(jobNo)) localQuery = localQuery.Where(r => r.JobCard != null && r.JobCard.JobCardNumber.Contains(jobNo));
        if (!string.IsNullOrWhiteSpace(chassisNo)) localQuery = localQuery.Where(r => r.ChassisNo != null && r.ChassisNo.Contains(chassisNo));
        if (!string.IsNullOrWhiteSpace(locationCode)) localQuery = localQuery.Where(r => r.Location == locationCode);
        if (dateFrom is not null) localQuery = localQuery.Where(r => r.BillDate >= dateFrom);
        if (dateTo is not null) localQuery = localQuery.Where(r => r.BillDate <= dateTo);

        var localBills = await localQuery
            .Include(r => r.Items)
            .Include(r => r.JobCard)
            .Include(r => r.CreatedBy)
            .Include(r => r.UpdatedBy)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync();

        var combined = new List<CombinedRepairBillRow>(localBills.Select(ToCombinedRow));

        string? dmsError = null;
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

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var dealerId = _currentUser.DealerId;
        var bill = await _db.RepairBillDocs.AsNoTracking().Include(r => r.Items)
            .FirstOrDefaultAsync(r => r.Id == id && r.DealerId == dealerId && !r.IsDeleted);
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
        if (dealerId is null) return Forbid();
        if (string.IsNullOrWhiteSpace(req.PartyName)) return BadRequest(new { message = "Party Name is required." });
        if (req.Items is null || req.Items.Count == 0) return BadRequest(new { message = "Add at least one item or labour line." });

        var dealer = await _db.Dealers.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dealerId);
        if (dealer is null) return BadRequest(new { message = "Dealer not found for the signed-in user." });

        static bool IsZeroTax(string? issueType) =>
            string.Equals(issueType, "U/W", StringComparison.OrdinalIgnoreCase)
            || string.Equals(issueType, "FSC", StringComparison.OrdinalIgnoreCase);

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

        // 2026-09-22 (Extended Battery Warranty Scheme, see this method's own doc comment above) -
        // resolved once per save, not per line: candidate schemes only depend on the vehicle's
        // Model/PurchaseDate/Odometer and the bill date, none of which vary line to line.
        var ebwCandidates = new List<ExtendedBatteryWarrantyEligibilityResult>();
        if (req.VehicleId is not null)
        {
            var ebwVehicle = await _db.Vehicles.AsNoTracking()
                .FirstOrDefaultAsync(v => v.Id == req.VehicleId && v.DealerId == dealerId, HttpContext.RequestAborted);
            if (ebwVehicle?.PurchaseDate is not null)
            {
                ebwCandidates = await _ebwEligibility.EvaluateAsync(
                    dealerId.Value, ebwVehicle.Model, ebwVehicle.PurchaseDate.Value,
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
                    return BadRequest(new { message = $"Insufficient Part Upload stock for '{it.ItemCode}' at this location: available {available}, requested {requestedQty}." });
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

        _db.RepairBillDocs.Add(bill);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("RepairBillDoc.Create", "RepairBillDoc", bill.Id.ToString(), new { bill.BillNumber, bill.TotalAmount });

        return Ok(ToRow(bill));
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
    /// </summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.SystemAdminOnly)]
    public async Task<IActionResult> Delete(Guid id)
    {
        var dealerId = _currentUser.DealerId;
        var bill = await _db.RepairBillDocs.Include(r => r.Items)
            .FirstOrDefaultAsync(r => r.Id == id && r.DealerId == dealerId && !r.IsDeleted);
        if (bill is null) return NotFound();

        if (!string.IsNullOrWhiteSpace(bill.Location))
        {
            foreach (var it in bill.Items.Where(i => i.ItemType == RepairBillDocItemType.Part))
            {
                if (string.IsNullOrWhiteSpace(it.ItemCode)) continue;
                var pu = await _db.PartUploads.FirstOrDefaultAsync(
                    p => p.DealerId == dealerId && p.LocationCode == bill.Location && p.PartNo == it.ItemCode, HttpContext.RequestAborted);
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
        b.PartyName,
        b.RegNo,
        b.ChassisNo,
        b.Location,
        b.BillType,
        b.IssueType,
        Status = b.Status.ToString(),
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
