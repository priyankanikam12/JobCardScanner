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
/// 2026-09-19 "now i want Create Repair Bill and Material Transfer Bill" - the Material Transfer
/// sibling of RepairBillDocsController.cs; see that controller's doc comment for the shared
/// reasoning (new controller, JobCardScannerDb-native save target, combined view reusing the
/// existing read-only IDmsBaplDataService rather than duplicating it). Backs the new "Material
/// Transfer Bill" sidebar page - NOT a change to the existing read-only
/// MaterialTransferPage.tsx/"Material Transfer Report" page.
///
/// 2026-09-30 (SECTION 162, "real access lock" for Supervisor - Supervisor should only be able to
/// use Dashboard, Job Cards and Attendance): gate switched from Policies.ServiceAdvisorUp to the
/// new "ServiceAdvisorUpNoSupervisor" policy (see Program.cs's AddAuthorization block). Confirmed
/// safe to change here specifically: ServiceAdvisorUp is ALSO used by JobCardsController.cs (which
/// Supervisor must keep), but this controller is unrelated to Job Cards, so narrowing THIS
/// controller's own policy has no effect on that one.
///
/// 2026-10-05 ("for systemadmin and corporate admin dont have dealerid but they will show all"):
/// CorporateAdmin and SystemAdmin have NO dealer of their own, and every READ below used to be
/// hard-wired to `DealerId == the caller's dealer` - a null for these two roles, so their lists were
/// empty or failed outright (a bare `Forbid()` with no usable authentication scheme can even surface
/// as an HTTP 500). Reads (List, Combined, Get) and Delete now cover EVERY dealer for those two roles
/// (IsOrgWideRole below), the same convention JobCardsController.List already uses; every other role
/// is still scoped to its own dealer exactly as before. WRITES (Create, Update, UpdateStatus) and the
/// per-job helper (ForJob) are deliberately left dealer-scoped - a transfer is created under a
/// dealer, and an org-wide login has none to create it under - and now answer with a plain 403 +
/// message instead of a bare Forbid(). NOTE: this controller's class-level policy
/// ("ServiceAdvisorUpNoSupervisor") is unchanged - make sure CorporateAdmin/SystemAdmin satisfy it
/// (they are above ServiceAdvisor, so they should; a 403 here would say so). The list actions also
/// catch a failed database read and return its real message, so a missing column shows up on the
/// page instead of an anonymous 500.
/// </summary>
[ApiController]
[Route("api/material-transfer-docs")]
[Authorize(Policy = "ServiceAdvisorUpNoSupervisor")]
public class MaterialTransferDocsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IJobCardNumberingService _numbering;
    private readonly IDmsBaplDataService _dmsBaplData;
    private readonly IAuditLogService _audit;
    private readonly ILogger<MaterialTransferDocsController> _logger;
    private readonly ILabourMasterImportService _labourMaster;

    public MaterialTransferDocsController(
        JobCardScannerDbContext db, ICurrentUserService currentUser, IJobCardNumberingService numbering,
        IDmsBaplDataService dmsBaplData, IAuditLogService audit, ILogger<MaterialTransferDocsController> logger,
        ILabourMasterImportService labourMaster)
    {
        _db = db;
        _currentUser = currentUser;
        _numbering = numbering;
        _dmsBaplData = dmsBaplData;
        _audit = audit;
        _logger = logger;
        _labourMaster = labourMaster;
    }

    /// <summary>2026-10-05: CorporateAdmin / SystemAdmin have no dealer of their own and read EVERY
    /// dealer's material transfers (same convention as JobCardsController.List's isOrgWideRole). Writes
    /// stay dealer-scoped - see this controller's doc comment.</summary>
    private bool IsOrgWideRole => _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;

    /// <summary>GET /api/material-transfer-docs/labour-by-part-code/{partCode} - 2026-09-22
    /// ("which Rate Type * is Partwise from this we upload FOR Part Code add Labour Code also
    /// that was wants to integrate in material transfer"): backs the new "Labour" picker on
    /// MaterialTransferCreatePage.tsx (and the mobile equivalent) - confirmed against the
    /// mt-labour_add.mp4 recording of the real BGauss DMS, whose own Material Transfer screen has
    /// a "Labour" button next to a picked Part that opens a "Part wise Labour Detail" popup scoped
    /// to that exact Part Code. Lives here (not on LabourMasterController, which is
    /// WorkshopManagerUp) so a plain ServiceAdvisor - who can already use Material Transfer itself
    /// - can call it too; see LabourMasterController's own doc comment for why stacking
    /// [Authorize] there wouldn't have worked. Calls ILabourMasterImportService directly, exactly
    /// the same service LabourMasterController itself uses - no logic duplicated, just a second,
    /// more narrowly-scoped entry point into it.</summary>
    [HttpGet("labour-by-part-code/{partCode}")]
    public async Task<IActionResult> LabourByPartCode(string partCode)
    {
        if (string.IsNullOrWhiteSpace(partCode)) return BadRequest(new { message = "Part Code is required." });
        try
        {
            return Ok(await _labourMaster.GetPartwiseByPartCodeAsync(partCode, HttpContext.RequestAborted));
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "LabourByPartCode failed for {PartCode}", partCode);
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>GET /api/material-transfer-docs/labour-by-codes?codes=A,B,C - 2026-09-22 ("that
    /// also going in repair bill"): batch by-Labour-Code lookup, used by
    /// RepairBillCreatePage.tsx's materialTransferItems sync effect to recover a synced Labour
    /// row's real IGST/CGST/SGST for its own CGST Amt/SGST Amt/IGST Amt columns - mirrors
    /// ItemMasterController's own GET /api/item-master/by-codes shape (comma-separated codes query
    /// param, one round trip). See GetPartwiseByLabourCodesAsync's own doc comment on the service
    /// interface for why this is always a fresh read (MaterialTransferDocItem stores no tax
    /// columns), never a persisted value.</summary>
    [HttpGet("labour-by-codes")]
    public async Task<IActionResult> LabourByCodes([FromQuery] string? codes)
    {
        var list = (codes ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (list.Length == 0) return Ok(Array.Empty<object>());
        try
        {
            return Ok(await _labourMaster.GetPartwiseByLabourCodesAsync(list, HttpContext.RequestAborted));
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "LabourByCodes failed for {Codes}", codes);
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>GET /api/material-transfer-docs - this dealer's own JobCardScannerDb-native
    /// transfers only (newest first). Search filters mirror the reference
    /// GetMaterialTransferDetailByDealer's own filter set (dealer scoping is implicit here - the
    /// current user's dealer - so only searchTerm/dateFrom/dateTo are exposed; searchTerm matches
    /// TransferNumber or ItemCode/ItemDescription on any line). For the combined DMSBAPLDATA +
    /// JobCardScannerDb view, use /combined below.
    ///
    /// 2026-10-05: CorporateAdmin/SystemAdmin (no dealer of their own) get EVERY dealer's transfers;
    /// other roles are scoped to their own dealer as before.</summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? searchTerm = null, [FromQuery] DateOnly? dateFrom = null, [FromQuery] DateOnly? dateTo = null)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null && !IsOrgWideRole)
            return StatusCode(403, new { message = "This login is not linked to a dealer, so it has no material transfer list of its own." });

        var query = _db.MaterialTransferDocs.AsNoTracking().AsQueryable();
        if (!IsOrgWideRole) query = query.Where(m => m.DealerId == dealerId);

        if (!string.IsNullOrWhiteSpace(searchTerm))
            query = query.Where(m => m.TransferNumber.Contains(searchTerm)
                || m.Items.Any(i => i.ItemCode.Contains(searchTerm) || i.ItemDescription.Contains(searchTerm)));
        if (dateFrom is not null) query = query.Where(m => m.TransferDate >= dateFrom);
        if (dateTo is not null) query = query.Where(m => m.TransferDate <= dateTo);

        List<MaterialTransferDoc> docs;
        try
        {
            docs = await query.Include(m => m.Items).Include(m => m.JobCard).OrderByDescending(m => m.CreatedAt).ToListAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Material transfer list: could not read MaterialTransferDocs.");
            return StatusCode(500, new { message = $"Could not read the material transfers: {ex.GetBaseException().Message}" });
        }

        return Ok(docs.Select(ToRow));
    }

    /// <summary>
    /// GET /api/material-transfer-docs/combined?locCode=CUS0288W5 - "this both data wants to show
    /// in 1 place": this dealer's own newly-created JobCardScannerDb transfers, UNION'd with the
    /// existing read-only DMSBAPLDATA transfer rows for that workshop location (reusing
    /// GetMaterialTransfersAsync exactly as the "Material Transfer Report" page already does - no
    /// query logic duplicated), sorted by date descending. A missing/blank locCode returns only
    /// this app's own rows (DMSBAPLDATA's own endpoint requires one; JobCardScannerDb rows don't
    /// carry a LocCode at all - see MaterialTransferDoc's doc comment). DMSBAPLDATA connectivity
    /// problems don't fail the whole request - dmsBaplDataError is set instead so the page can say
    /// so without hiding this app's own rows.
    ///
    /// 2026-09-23 ("in repairbill which we added button like this add in material transfer for
    /// showing which we transferred" - the new MaterialTransferListPage.tsx/
    /// MaterialTransferListScreen.tsx mirror RepairBillListPage.tsx/RepairBillListScreen.tsx's own
    /// split exactly): transferNo/jobNo/locationCode/dateFrom/dateTo filters and an `ownOnly` flag
    /// added, matching RepairBillDocsController.Combined's own identical addition - applied only to
    /// this dealer's own JobCardScannerDb rows (`localQuery` below); `locCode`'s existing behaviour
    /// (which ALSO gates whether DMSBAPLDATA is queried at all, not just how it's filtered) is
    /// completely unchanged for every existing caller. `ownOnly=true` skips the DMSBAPLDATA call
    /// entirely (same reasoning as Repair Bill's own ownOnly) - the new list pages/screens use it so
    /// they never even attempt that round trip. Defaults (ownOnly=false, filters null) leave
    /// MaterialTransferCreatePage.tsx/MaterialTransferCreateScreen.tsx (which still call this with
    /// only `locCode`, unchanged) completely unaffected.
    ///
    /// 2026-10-05: CorporateAdmin/SystemAdmin (no dealer of their own) get EVERY dealer's own transfers
    /// here; other roles are scoped to their own dealer as before.
    /// </summary>
    [HttpGet("combined")]
    public async Task<IActionResult> Combined(
        [FromQuery] string? locCode, [FromQuery] bool ownOnly = false,
        [FromQuery] string? transferNo = null, [FromQuery] string? jobNo = null,
        [FromQuery] string? locationCode = null,
        [FromQuery] DateOnly? dateFrom = null, [FromQuery] DateOnly? dateTo = null)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null && !IsOrgWideRole)
            return StatusCode(403, new { message = "This login is not linked to a dealer, so it has no material transfer list of its own." });

        var localQuery = _db.MaterialTransferDocs.AsNoTracking().AsQueryable();
        if (!IsOrgWideRole) localQuery = localQuery.Where(m => m.DealerId == dealerId);
        if (!string.IsNullOrWhiteSpace(transferNo)) localQuery = localQuery.Where(m => m.TransferNumber.Contains(transferNo));
        if (!string.IsNullOrWhiteSpace(jobNo)) localQuery = localQuery.Where(m => m.JobCard != null && m.JobCard.JobCardNumber.Contains(jobNo));
        if (!string.IsNullOrWhiteSpace(locationCode)) localQuery = localQuery.Where(m => m.Location == locationCode);
        if (dateFrom is not null) localQuery = localQuery.Where(m => m.TransferDate >= dateFrom);
        if (dateTo is not null) localQuery = localQuery.Where(m => m.TransferDate <= dateTo);

        List<MaterialTransferDoc> localDocs;
        try
        {
            localDocs = await localQuery
                .Include(m => m.Items)
                .Include(m => m.JobCard)
                .OrderByDescending(m => m.CreatedAt)
                .ToListAsync();
        }
        catch (Exception ex)
        {
            // 2026-10-05: return the database's own message (e.g. "Invalid column name ...") so a missing
            // column is visible on the page instead of an anonymous HTTP 500.
            _logger.LogError(ex, "Material transfer list: could not read MaterialTransferDocs.");
            return StatusCode(500, new { message = $"Could not read the material transfers: {ex.GetBaseException().Message}" });
        }

        var combined = new List<CombinedMaterialTransferRow>(localDocs.Select(ToCombinedRow));

        string? dmsError = null;
        if (!ownOnly && !string.IsNullOrWhiteSpace(locCode))
        {
            try
            {
                var dmsRows = await _dmsBaplData.GetMaterialTransfersAsync(locCode, HttpContext.RequestAborted);
                combined.AddRange(dmsRows.Select(t => new CombinedMaterialTransferRow(
                    Source: "DMSBAPLDATA",
                    Id: $"dms-{t.Id}",
                    TransferNumber: t.DocNo?.ToString() ?? "—",
                    SortDate: t.DocDate ?? t.CreatedAt,
                    Location: t.Location ?? t.LocCode,
                    TransferType: t.DocType,
                    PartyName: t.TechnicianName,
                    Status: null,
                    TotalAmount: t.Items.Sum(i => i.Qty * i.Rate - i.Discount + i.SgstAmount + i.CgstAmount + i.IgstAmount),
                    ItemCount: t.Items.Count,
                    Items: t.Items.Select(i => (object)new
                    {
                        i.Id, i.ItemIdno, i.ItemName, i.ItemDescription, i.ItemType, i.Qty, i.Rate,
                        i.SgstPer, i.SgstAmount, i.CgstPer, i.CgstAmount, i.IgstPer, i.IgstAmount,
                        i.Discount, i.Mrp,
                    }).ToList())));
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning(ex, "Combined material-transfer view: DMSBAPLDATA unreachable (locCode: {LocCode})", locCode);
                dmsError = ex.Message;
            }
        }

        return Ok(new { rows = combined.OrderByDescending(r => r.SortDate), dmsBaplDataError = dmsError });
    }

    /// <summary>
    /// GET /api/material-transfer-docs/for-job/{jobCardId} - 2026-09-22 ("now i saved from
    /// material transfer bill now this will shown in repair bill with which i material transfer"):
    /// the real DMS reference you pasted (repair-bill.ts's loadMaterialedJobCardList calling
    /// JobCardService.getMaterialedJobCardList(jobId, dealerCode)) auto-populates a Repair Bill's
    /// own Part grid from whatever Material Transfer items already exist for the SAME job - Parts
    /// are never manually searched/added inside Repair Bill itself there (confirmed: the pasted
    /// repair-bill.html's Part search dropdown is commented out entirely; only Labour has a live
    /// search-and-add flow, addLabour()). This is the equivalent lookup for JobCardScannerDb's own
    /// MaterialTransferDocs: every item line from every Draft/Confirmed (not Cancelled) transfer
    /// doc linked to this JobCardId, for the caller's own dealer. Flattened (not grouped by
    /// document) since Repair Bill's Part grid shows one row per item regardless of which transfer
    /// it came from - each row still carries its source TransferNumber/TransferDate so the UI can
    /// show where it came from. Rate/Mrp on each row already reflect SECTION 64's C_ItemMaster-
    /// driven calculation from when the part was transferred - this endpoint does not recompute
    /// them, only re-exposes what Material Transfer already saved.
    /// </summary>
    [HttpGet("for-job/{jobCardId:guid}")]
    public async Task<IActionResult> ForJob(Guid jobCardId)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null)
            return StatusCode(403, new { message = "This lookup is per dealer - this login is not linked to one." });

        var docs = await _db.MaterialTransferDocs.AsNoTracking()
            .Where(m => m.DealerId == dealerId && m.JobCardId == jobCardId && m.Status != MaterialTransferDocStatus.Cancelled)
            .Include(m => m.Items)
            .OrderBy(m => m.TransferDate)
            .ToListAsync();

        var rows = docs.SelectMany(d => d.Items.Select(i => new
        {
            MaterialTransferDocId = d.Id,
            d.TransferNumber,
            d.TransferDate,
            i.Id,
            i.ItemCode,
            i.ItemDescription,
            i.HsnCode,
            i.IssueType,
            i.Qty,
            i.Rate,
            i.Amount,
            i.Mrp,
            // 2026-09-22 - see this controller's own doc comment update above: RepairBillCreatePage.tsx
            // now needs to tell a Labour line (added via MaterialTransferCreatePage.tsx's new
            // "Labour" picker) apart from a Part line, instead of assuming every row here is a Part.
            ItemType = i.ItemType.ToString(),
        }));

        return Ok(rows);
    }

    // 2026-09-23 ("history maintain in which job card which item material transfered ... please
    // add [the reopen-for-edit button]" - see MaterialTransferCreatePage.tsx's own
    // "startEditTransfer" doc comment, the Material Transfer sibling of
    // RepairBillDocsController.Get's identical 2026-09-23 change): now also Includes JobCard so
    // ToRow can return JobCardId/JobCardNumber - needed so the web page can re-link the same Job
    // when an existing Draft transfer is reopened for editing.
    //
    // 2026-10-05: CorporateAdmin/SystemAdmin can open ANY dealer's transfer; other roles only their
    // own dealer's.
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var dealerId = _currentUser.DealerId;
        var orgWide = IsOrgWideRole;
        var doc = await _db.MaterialTransferDocs.AsNoTracking().Include(m => m.Items).Include(m => m.JobCard)
            .FirstOrDefaultAsync(m => m.Id == id && (orgWide || m.DealerId == dealerId));
        return doc is null ? NotFound() : Ok(ToRow(doc));
    }

    /// <summary>POST /api/material-transfer-docs - creates and saves a material transfer document
    /// into JobCardScannerDb. Live DMS PartsInventory is still NOT touched (see MaterialTransferDoc's
    /// doc comment for why the reference app's own debit/credit against that table isn't ported
    /// here - this app has no write access to BAPLDMSvad).
    ///
    /// 2026-09-21 ("part-upload balance qty use for that stock and when this will we saved from
    /// part-upload balance qty minus from"): for any line whose Item Code matches a PartUploads
    /// row at this dealer's SAME Location (the merge-in source the Item Code picker already reads
    /// - see MaterialTransferCreatePage.tsx), that row's BalQty is decremented by the line's Qty,
    /// in the same SaveChangesAsync transaction as the transfer itself (so a request that can't be
    /// fully stocked fails atomically - nothing is half-saved). A line with no matching PartUploads
    /// row (e.g. picked from live DMS stock, or a hand-typed code) is left untouched - only rows
    /// that genuinely exist in Part Upload are adjusted, matching "part-upload balance qty" being
    /// the explicit, named source of truth here, not live DMS stock (which this app can't write to
    /// regardless). Two or more lines for the same Item Code accumulate against the same tracked
    /// row (partUploadCache keeps one EF-tracked instance per Item Code), so the check below is
    /// already cumulative across the whole request, not just per-line.</summary>
    [HttpPost]
    public async Task<IActionResult> Create(CreateMaterialTransferRequest req)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null)
            return StatusCode(403, new { message = "A material transfer is created under a dealer - this login is not linked to one." });
        if (req.Items is null || req.Items.Count == 0) return BadRequest(new { message = "Add at least one item line." });

        var doc = new MaterialTransferDoc
        {
            DealerId = dealerId.Value,
            TransferNumber = await _numbering.NextMaterialTransferNumberAsync(dealerId.Value),
            JobCardId = req.JobCardId,
            Location = req.Location,
            TransferType = req.TransferType,
            IssueType = req.IssueType,
            PartyName = req.PartyName,
            TechnicianId = req.TechnicianId,
            Remarks = req.Remarks,
            TransferDate = req.TransferDate ?? DateOnly.FromDateTime(DateTime.UtcNow),
            CreatedById = _currentUser.UserId,
            Status = MaterialTransferDocStatus.Draft,
        };

        var error = await ApplyStockAndBuildItemsAsync(doc, req, dealerId.Value);
        if (error is not null) return BadRequest(new { message = error });

        _db.MaterialTransferDocs.Add(doc);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("MaterialTransferDoc.Create", "MaterialTransferDoc", doc.Id.ToString(), new { doc.TransferNumber, doc.TotalAmount });

        return Ok(ToRow(doc));
    }

    /// <summary>
    /// PUT /api/material-transfer-docs/{id} - 2026-09-23 ("this button not added why? please add
    /// and there history maintain in which job card which item material transfered and there we
    /// can add labour"): the Material Transfer sibling of RepairBillDocsController.Update (added
    /// the same round for the Repair Bill page's own reopen-for-editing flow, confirmed via
    /// video+AskUserQuestion) - reopens an existing, still-Draft transfer as the SAME "New
    /// Material Transfer" form on the web page, editable, so a Part or Labour line can be added to
    /// (or removed from) a transfer that was already saved, instead of only being able to view it
    /// read-only. Reuses CreateMaterialTransferRequest as-is (a full replace of Items, not a
    /// partial patch) and the same stock-decrement logic as Create (ApplyStockAndBuildItemsAsync,
    /// shared below).
    ///
    /// Only ever allowed while Status is still Draft - Confirmed/Cancelled has no "undo" here
    /// (same reasoning as RepairBillDocsController.Update's Performa-only gate). ALSO blocked, for
    /// a non-SystemAdmin, once the same Job's own Repair Bill has already been Billed - identical
    /// rule to this controller's own Delete above (editing what was transferred after the
    /// resulting bill is finalized would silently make what's billed and what's on hand disagree),
    /// re-using that exact check rather than inventing a looser one for Update alone.
    ///
    /// Part Upload stock (PartUploads.BalQty - see Create's own doc comment): the OLD items' stock
    /// impact is restored first (the same restore Delete already performs), then the NEW items are
    /// decremented against that restored baseline via ApplyStockAndBuildItemsAsync - so editing a
    /// Part line's Qty (or adding/removing one) nets out correctly instead of double-counting.
    /// </summary>
    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, CreateMaterialTransferRequest req)
    {
        var dealerId = _currentUser.DealerId;
        if (dealerId is null)
            return StatusCode(403, new { message = "A material transfer is edited under its dealer - this login is not linked to one." });
        if (req.Items is null || req.Items.Count == 0) return BadRequest(new { message = "Add at least one item line." });

        var doc = await _db.MaterialTransferDocs.Include(m => m.Items)
            .FirstOrDefaultAsync(m => m.Id == id && m.DealerId == dealerId);
        if (doc is null) return NotFound();
        if (doc.Status != MaterialTransferDocStatus.Draft)
            return BadRequest(new { message = $"Transfer {doc.TransferNumber} is already {doc.Status} - only a Draft transfer can be edited." });

        var isSystemAdmin = _currentUser.Role == StaffRole.SystemAdmin;
        if (!isSystemAdmin && doc.JobCardId is not null)
        {
            var jobBilled = await _db.RepairBillDocs.AsNoTracking()
                .AnyAsync(r => r.JobCardId == doc.JobCardId && r.DealerId == dealerId
                    && !r.IsDeleted && r.Status == RepairBillDocStatus.Billed);
            if (jobBilled)
                return BadRequest(new { message = "This job card has already been billed and its material transfer can no longer be edited." });
        }

        // Restore PartUploads stock committed by the OLD items (see Delete's own identical
        // restore) BEFORE ApplyStockAndBuildItemsAsync decrements stock again for the new items -
        // keyed off the doc's Location as it was before this update.
        if (!string.IsNullOrWhiteSpace(doc.Location))
        {
            foreach (var oldIt in doc.Items)
            {
                if (string.IsNullOrWhiteSpace(oldIt.ItemCode)) continue;
                var pu = await _db.PartUploads.FirstOrDefaultAsync(
                    p => p.DealerId == dealerId && p.LocationCode == doc.Location && p.PartNo == oldIt.ItemCode, HttpContext.RequestAborted);
                if (pu is not null) pu.BalQty = (pu.BalQty ?? 0) + (decimal)oldIt.Qty;
            }
        }

        doc.JobCardId = req.JobCardId;
        doc.Location = req.Location;
        doc.TransferType = req.TransferType;
        doc.IssueType = req.IssueType;
        doc.PartyName = req.PartyName;
        doc.TechnicianId = req.TechnicianId;
        doc.Remarks = req.Remarks;
        if (req.TransferDate is not null) doc.TransferDate = req.TransferDate.Value;

        _db.MaterialTransferDocItems.RemoveRange(doc.Items);
        doc.Items.Clear();

        // 2026-10-09 ("same for mt"): same as RepairBillDocsController.Update - an unexpected failure used to be a bare HTTP 500 with no body; it now answers with the real reason, and the audit
        // entry is best-effort.
        string? error;
        try
        {
            error = await ApplyStockAndBuildItemsAsync(doc, req, dealerId.Value);
            if (error is null)
            {
                // 2026-10-09 FIX - same cause as RepairBillDocsController.Update: the replacement lines carry a pre-filled key, so EF Core treated them as existing rows (UPDATE ... affected 0 rows).
                // Mark them Added so they are INSERTed.
                foreach (var line in doc.Items) _db.Entry(line).State = EntityState.Added;
                await _db.SaveChangesAsync();
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Material transfer update failed for transfer {TransferId}.", id);
            return StatusCode(500, new { message = $"Could not update the material transfer: {ex.GetBaseException().Message}" });
        }
        if (error is not null) return BadRequest(new { message = error });

        try { await _audit.LogAsync("MaterialTransferDoc.Update", "MaterialTransferDoc", doc.Id.ToString(), new { doc.TransferNumber, doc.TotalAmount }); }
        catch (Exception ex) { _logger.LogWarning(ex, "Audit entry for MaterialTransferDoc.Update could not be written."); }

        return Ok(ToRow(doc));
    }

    /// <summary>Shared by Create and Update above - decrements/validates PartUploads.BalQty for
    /// every Part line (see Create's original doc comment, now here, for the full reasoning) and
    /// builds MaterialTransferDocItem rows onto `doc.Items`, then sets doc.TotalAmount from them.
    /// Returns an insufficient-stock error message for the caller to return as 400, or null on
    /// success.</summary>
    private async Task<string?> ApplyStockAndBuildItemsAsync(MaterialTransferDoc doc, CreateMaterialTransferRequest req, Guid dealerId)
    {
        // 2026-09-28 ("if qty 0 then give alert update qty"): a Part or Labour line saved with
        // Qty 0 (blank quantity field left as its default, or cleared by mistake) is not a useful
        // transfer line - reject it here with a message naming the exact line, rather than saving
        // a 0-qty row silently. This is a server-side safety net: it fires regardless of whether
        // MaterialTransferCreatePage.tsx (web) or its mobile screen already blocks this client-side
        // - I don't have either of those files staged this session, so I can't add a matching
        // client-side check yet, but every existing caller already surfaces this controller's 400
        // { message } as an on-screen alert (same err.response.data.message handling used for every
        // other validation error on this page already, e.g. "Add at least one item line." above) -
        // so this alone gives you the "give alert update qty" behaviour without guessing at either
        // page's field names/structure. Paste those two files if you also want the qty input
        // itself to warn/disable Save before the request is even sent.
        foreach (var it in req.Items)
        {
            if (it.Qty <= 0)
            {
                var label = !string.IsNullOrWhiteSpace(it.ItemDescription) ? it.ItemDescription
                    : !string.IsNullOrWhiteSpace(it.ItemCode) ? it.ItemCode : "This line";
                return $"'{label}' has Qty 0 - please update the quantity before saving.";
            }
        }

        var partUploadCache = new Dictionary<string, PartUpload>(StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(req.Location))
        {
            // 2026-09-22 - only Part lines ever touch PartUploads stock (see
            // MaterialTransferDocItem.ItemType's own doc comment); a Labour Code is never a real
            // PartUploads.PartNo, but this guard makes that explicit rather than relying on the
            // two ID spaces simply never colliding in practice.
            foreach (var it in req.Items)
            {
                if (it.ItemType != MaterialTransferDocItemType.Part) continue;
                if (string.IsNullOrWhiteSpace(it.ItemCode) || partUploadCache.ContainsKey(it.ItemCode)) continue;
                var pu = await _db.PartUploads.FirstOrDefaultAsync(
                    p => p.DealerId == dealerId && p.LocationCode == req.Location && p.PartNo == it.ItemCode, HttpContext.RequestAborted);
                if (pu is not null) partUploadCache[it.ItemCode] = pu;
            }
            foreach (var it in req.Items)
            {
                if (it.ItemType != MaterialTransferDocItemType.Part) continue;
                if (!partUploadCache.TryGetValue(it.ItemCode, out var pu)) continue;
                var requestedQty = (decimal)it.Qty;
                var available = pu.BalQty ?? 0;
                if (requestedQty > available)
                    return $"Insufficient Part Upload stock for '{it.ItemCode}' at this location: available {available}, requested {requestedQty}.";
                pu.BalQty = available - requestedQty;
            }
        }

        foreach (var it in req.Items)
        {
            // 2026-10-07: an FOC (free of cost) line carries no amount - the same rule the Repair Bill uses for FOC. Qty, Rate and the stock decrement above are
            // still recorded; only the line's Amount (and so the document's TotalAmount) is 0.
            var amount = string.Equals(it.IssueType, "FOC", StringComparison.OrdinalIgnoreCase) ? 0m : (decimal)it.Qty * it.Rate;
            doc.Items.Add(new MaterialTransferDocItem
            {
                PartId = it.PartId,
                ItemCode = it.ItemCode,
                ItemDescription = it.ItemDescription,
                HsnCode = it.HsnCode,
                IssueType = it.IssueType,
                Qty = it.Qty,
                Rate = it.Rate,
                Amount = amount,
                RackNo = it.RackNo,
                Bin = it.Bin,
                SerialNo = it.SerialNo,
                Mrp = it.Mrp,
                ValidDays = it.ValidDays,
                ItemReceived = it.ItemReceived,
                ItemType = it.ItemType,
                TechnicianId = it.TechnicianId,
            });
        }
        doc.TotalAmount = doc.Items.Sum(i => i.Amount);

        return null;
    }

    /// <summary>
    /// DELETE /api/material-transfer-docs/{id} - reference: MaterialTransferService.
    /// DeleteMaterialsByJobId blocks a non-SuperAdmin delete when the same job's repair bill is
    /// already Billed ("This job card has already been billed and its material transfer cannot be
    /// deleted."), else hard-deletes (ExecuteDeleteAsync). Ported as-is: SystemAdmin bypasses the
    /// check (matching the reference's SuperAdmin bypass), everyone else is blocked when a
    /// RepairBillDoc for the same JobCardId has Status == Billed, and the row is hard-removed, not
    /// soft-deleted (MaterialTransferDoc has no IsDelete column, matching the reference). The
    /// reference's stock-ledger reversal (a PartsInventory "SD" transaction against BAPLDMSvad's
    /// own live inventory) is NOT ported - this app has no equivalent live-stock table to reverse
    /// against; see MaterialTransferDoc's doc comment.
    ///
    /// 2026-10-05: CorporateAdmin/SystemAdmin (no dealer of their own) can now find ANY dealer's
    /// transfer - the all-dealers list shows them all - and the "already billed" check and the stock
    /// restore both use the TRANSFER's own dealer (doc.DealerId), not the caller's.
    /// </summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var dealerId = _currentUser.DealerId;
        var orgWide = IsOrgWideRole;
        var doc = await _db.MaterialTransferDocs.Include(m => m.Items)
            .FirstOrDefaultAsync(m => m.Id == id && (orgWide || m.DealerId == dealerId));
        if (doc is null) return NotFound();

        var isSystemAdmin = _currentUser.Role == StaffRole.SystemAdmin;
        if (!isSystemAdmin && doc.JobCardId is not null)
        {
            var jobBilled = await _db.RepairBillDocs.AsNoTracking()
                .AnyAsync(r => r.JobCardId == doc.JobCardId && r.DealerId == doc.DealerId
                    && !r.IsDeleted && r.Status == RepairBillDocStatus.Billed);
            if (jobBilled)
                return BadRequest(new { message = "This job card has already been billed and its material transfer cannot be deleted." });
        }

        // 2026-09-21 ("we delete thi material tranfer then as it is add this bal qty in
        // part-upload page"): reverses the Create-time decrement above, for any line whose Item
        // Code still matches a PartUploads row at this doc's own Location - restores BalQty by
        // the line's Qty. Scoped to Delete only (not the UpdateStatus "Cancelled" transition
        // below, which the user didn't ask about and which this app treats as a status change,
        // not a removal).
        if (!string.IsNullOrWhiteSpace(doc.Location))
        {
            foreach (var it in doc.Items)
            {
                if (string.IsNullOrWhiteSpace(it.ItemCode)) continue;
                var pu = await _db.PartUploads.FirstOrDefaultAsync(
                    p => p.DealerId == doc.DealerId && p.LocationCode == doc.Location && p.PartNo == it.ItemCode, HttpContext.RequestAborted);
                if (pu is not null) pu.BalQty = (pu.BalQty ?? 0) + (decimal)it.Qty;
            }
        }

        _db.MaterialTransferDocs.Remove(doc);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("MaterialTransferDoc.Delete", "MaterialTransferDoc", doc.Id.ToString(), new { doc.TransferNumber });

        return NoContent();
    }

    /// <summary>PUT /api/material-transfer-docs/{id}/status - Draft -> Confirmed/Cancelled.</summary>
    [HttpPut("{id:guid}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] MaterialTransferDocStatus status)
    {
        var dealerId = _currentUser.DealerId;
        var doc = await _db.MaterialTransferDocs.FirstOrDefaultAsync(m => m.Id == id && m.DealerId == dealerId);
        if (doc is null) return NotFound();
        doc.Status = status;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("MaterialTransferDoc.StatusChange", "MaterialTransferDoc", doc.Id.ToString(), new { doc.Status });
        return Ok(ToRow(doc));
    }

    private static object ToRow(MaterialTransferDoc m) => new
    {
        Source = "JobCardScanner",
        m.Id,
        m.TransferNumber,
        TransferDate = m.TransferDate,
        // 2026-09-23 - see Get's own doc comment just above for why these two are now returned
        // (needed so the web page can re-link the same Job when reopening a Draft transfer for
        // editing).
        m.JobCardId,
        JobCardNumber = m.JobCard?.JobCardNumber,
        m.Location,
        TransferType = m.TransferType.ToString(),
        m.IssueType,
        m.PartyName,
        m.TechnicianId,
        m.Remarks,
        Status = m.Status.ToString(),
        m.TotalAmount,
        ItemCount = m.Items.Count,
        Items = m.Items.Select(i => new
        {
            i.Id, i.ItemCode, i.ItemDescription, i.HsnCode, i.IssueType, i.Qty, i.Rate, i.Amount,
            i.RackNo, i.Bin, i.SerialNo, i.Mrp, i.ValidDays, i.ItemReceived,
            ItemType = i.ItemType.ToString(),
        }),
    };

    private static CombinedMaterialTransferRow ToCombinedRow(MaterialTransferDoc m) => new(
        Source: "JobCardScanner",
        Id: m.Id.ToString(),
        TransferNumber: m.TransferNumber,
        SortDate: m.TransferDate.ToDateTime(TimeOnly.MinValue),
        Location: m.Location,
        TransferType: m.TransferType.ToString(),
        PartyName: m.PartyName,
        Status: m.Status.ToString(),
        TotalAmount: m.TotalAmount,
        ItemCount: m.Items.Count,
        Items: m.Items.Select(i => (object)new
        {
            i.Id, i.ItemCode, i.ItemDescription, i.HsnCode, i.IssueType, i.Qty, i.Rate, i.Amount,
            i.RackNo, i.Bin, i.SerialNo, i.Mrp, i.ValidDays, i.ItemReceived,
            ItemType = i.ItemType.ToString(),
        }).ToList(),
        // 2026-09-23 ("history maintain in which job card which item material transfered") - see
        // CombinedMaterialTransferRow.JobNo's own doc comment.
        JobNo: m.JobCard?.JobCardNumber);
}

