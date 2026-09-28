using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Services;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// SECTION 163 (2026-09-30) - read API for the new Prefix Master (JC/MT/RB document numbering
/// prefixes) - see Models/DocPrefixMaster.cs for the full reasoning, and IMPORTANTLY the flagged
/// Fact that this is NOT yet wired to your actual Job Card / Material Transfer / Repair Bill
/// numbers, which still come from the existing (unseen in this session) JobCardNumberingService.
///
/// Preview(docType) shows what the NEXT number would look like if this table were wired in, using
/// its own decoupled DocNumberSequences counter - calling Preview does NOT reserve or consume a
/// number (repeated calls with no real document created show the same next number), unlike the
/// real numbering service's own Next...NumberAsync calls which do consume one.
///
/// UPDATE - SECTION 166 (2026-09-30) "for this 3 master create edit delete access ?": added
/// POST/PUT/DELETE below for the Prefix list (dbo.DocPrefixMasters) ONLY - gated to
/// Policies.CorporateAdminOnly, the SAME narrower floor already used for this page's sidebar link
/// (unlike Service Menu/Complaint Master, this one was never opened to WorkshopManager/DealerAdmin
/// even for viewing). DocType (JC/MT/RB) is NOT editable on PUT - it's the stable key this table is
/// looked up by; to change a DocType you'd deactivate the old row and Create a new one. DELETE is a
/// SOFT delete (IsActive=false, reversible via PUT isActive=true), same reasoning as the other two
/// masters' controllers.
///
/// STILL NOT DONE: no CRUD was added for DocNumberSequences (the running-counter table) - that
/// wasn't one of "this 3 master" (the 3 masters are Service Menu, Complaint, and Prefix - the
/// sequence table is Prefix Master's own internal counter, not a 4th master), and it remains
/// read-only/preview-only exactly as before.
/// </summary>
[ApiController]
[Route("api/doc-prefix-master")]
[Authorize(Policy = Policies.Staff)]
public class DocPrefixMasterController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;

    public DocPrefixMasterController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    public record PrefixRow(Guid Id, string DocType, string Prefix, bool IsActive);
    public record PreviewRow(string DocType, string Prefix, string FinancialYear, int NextSequence, string NextNumber);
    public record CreateDocPrefixRequest(string DocType, string Prefix);
    public record UpdateDocPrefixRequest(string Prefix, bool IsActive);

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PrefixRow>>> All(CancellationToken ct)
    {
        var rows = await _db.DocPrefixMasters.AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.DocType)
            .Select(x => new PrefixRow(x.Id, x.DocType, x.Prefix, x.IsActive))
            .ToListAsync(ct);
        return Ok(rows);
    }

    /// <summary>SECTION 166 - includes deactivated rows too, for the admin CRUD page.</summary>
    [HttpGet("admin-list")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<ActionResult<IReadOnlyList<PrefixRow>>> AdminList(CancellationToken ct)
    {
        var rows = await _db.DocPrefixMasters.AsNoTracking()
            .OrderBy(x => x.DocType)
            .Select(x => new PrefixRow(x.Id, x.DocType, x.Prefix, x.IsActive))
            .ToListAsync(ct);
        return Ok(rows);
    }

    /// <summary>Preview-only - see class doc comment. `financialYear` must be passed explicitly
    /// (e.g. "26-25") since this table does not compute FY from today's date - see
    /// Models/DocPrefixMaster.cs's FY-format Assumption for why.</summary>
    [HttpGet("preview")]
    public async Task<ActionResult<PreviewRow>> Preview([FromQuery] string docType, [FromQuery] string financialYear, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(docType) || string.IsNullOrWhiteSpace(financialYear))
            return BadRequest(new { message = "docType and financialYear are both required, e.g. ?docType=JC&financialYear=26-25" });

        var prefixRow = await _db.DocPrefixMasters.AsNoTracking()
            .FirstOrDefaultAsync(x => x.IsActive && x.DocType == docType, ct);
        if (prefixRow == null)
            return NotFound(new { message = $"No active Prefix Master row for DocType '{docType}'." });

        var seqRow = await _db.DocNumberSequences.AsNoTracking()
            .FirstOrDefaultAsync(x => x.DocType == docType && x.FinancialYear == financialYear, ct);
        var nextSeq = (seqRow?.LastSequence ?? 0) + 1;
        var nextNumber = $"{prefixRow.Prefix}/{financialYear}/{nextSeq:0000}";

        return Ok(new PreviewRow(docType, prefixRow.Prefix, financialYear, nextSeq, nextNumber));
    }

    /// <summary>SECTION 166 - add a new DocType/Prefix row (e.g. a 4th document type beyond
    /// JC/MT/RB). DocType is upper-cased and trimmed; uniqueness is enforced by the DB index on
    /// DocType.</summary>
    [HttpPost]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Create([FromBody] CreateDocPrefixRequest req, CancellationToken ct)
    {
        var docType = req.DocType?.Trim().ToUpperInvariant();
        var prefix = req.Prefix?.Trim();
        if (string.IsNullOrWhiteSpace(docType) || string.IsNullOrWhiteSpace(prefix))
            return BadRequest(new { message = "Doc Type and Prefix are both required." });

        var entity = new DocPrefixMaster
        {
            DocType = docType,
            Prefix = prefix,
            IsActive = true,
            CreatedById = _currentUser.UserId,
            CreatedAt = DateTime.UtcNow,
        };
        _db.DocPrefixMasters.Add(entity);

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict(new { message = $"A Prefix Master row for DocType '{docType}' already exists." });
        }

        await _audit.LogAsync("DocPrefixMaster.Create", "DocPrefixMaster", entity.Id.ToString(), new { entity.DocType, entity.Prefix });

        return Ok(new PrefixRow(entity.Id, entity.DocType, entity.Prefix, entity.IsActive));
    }

    /// <summary>SECTION 166 - edit the Prefix text / active flag only. DocType is NOT editable
    /// here - see class doc comment.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateDocPrefixRequest req, CancellationToken ct)
    {
        var entity = await _db.DocPrefixMasters.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null) return NotFound(new { message = "That Prefix Master row no longer exists." });

        var prefix = req.Prefix?.Trim();
        if (string.IsNullOrWhiteSpace(prefix)) return BadRequest(new { message = "Prefix is required." });

        entity.Prefix = prefix;
        entity.IsActive = req.IsActive;
        entity.UpdatedById = _currentUser.UserId;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync("DocPrefixMaster.Update", "DocPrefixMaster", entity.Id.ToString(), new { entity.DocType, entity.Prefix, entity.IsActive });

        return Ok(new PrefixRow(entity.Id, entity.DocType, entity.Prefix, entity.IsActive));
    }

    /// <summary>SOFT delete (IsActive=false) - reversible via PUT isActive=true. Deactivating JC/MT/RB
    /// will make Preview() 404 for that DocType (and, if this table is ever wired into the real
    /// numbering service in future, would presumably block real document creation too) - so treat
    /// deactivating any of the three defaults with real caution.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var entity = await _db.DocPrefixMasters.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null) return NotFound(new { message = "That Prefix Master row no longer exists." });

        entity.IsActive = false;
        entity.UpdatedById = _currentUser.UserId;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync("DocPrefixMaster.Deactivate", "DocPrefixMaster", entity.Id.ToString(), new { entity.DocType, entity.Prefix });

        return Ok();
    }
}
