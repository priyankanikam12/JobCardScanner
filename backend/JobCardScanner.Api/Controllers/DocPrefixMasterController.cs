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
/// SECTION 184 (2026-10-02) "module our sidebar option page name for every page ... Financial Year
/// is not required ... none option ... Padding, Next Number, Separator dont add ... auto increase" -
/// confirmed via AskUserQuestion. DocType (closed JC/MT/RB vocabulary) is now ModuleKey (any
/// StaffLayout.tsx NAV_ITEMS page key) - see Models/DocPrefixMaster.cs's class doc comment for the
/// full reasoning and the migration SQL script this needs run first
/// (backend/add-module-prefix-master-columns.sql). SEPARATOR below is the one fixed "/" this whole
/// feature uses - not a per-row column, per your "Separator ... dont add" instruction.
///
/// Preview(moduleKey) shows what the NEXT number would look like if this table were wired in, using
/// its own decoupled DocNumberSequences counter - calling Preview does NOT reserve or consume a
/// number (repeated calls with no real document created show the same next number).
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

    /// <summary>The one fixed separator every generated number uses between Prefix / [Financial
    /// Year /] running number - SECTION 184: not admin-editable, per your explicit "Separator ...
    /// dont add" instruction. If a dealer needs a different character, it goes directly into the
    /// Prefix text itself instead (e.g. Prefix "RB-hgh" already embeds its own separator before
    /// this one is appended).</summary>
    private const string SEPARATOR = "/";

    public record PrefixRow(Guid Id, string ModuleKey, string Prefix, bool UsesFinancialYear, bool IsActive);
    public record PreviewRow(string ModuleKey, string Prefix, string? FinancialYear, int NextSequence, string NextNumber);
    public record CreateDocPrefixRequest(string ModuleKey, string Prefix, bool UsesFinancialYear);
    public record UpdateDocPrefixRequest(string Prefix, bool UsesFinancialYear, bool IsActive);

    /// <summary>SECTION 184: the running-number auto-expands past 999 to 4 digits, past 9999 to 5,
    /// and so on, purely from C#'s own "000" (3-digit MINIMUM, not maximum) numeric format string -
    /// nothing here caps or truncates it. This is what gives you "001...999 then auto 4-digit, then
    /// auto 5-digit" with no Padding column to configure.</summary>
    private static string FormatNumber(string prefix, bool usesFinancialYear, string? financialYear, int nextSeq)
    {
        var seqText = nextSeq.ToString("000");
        return usesFinancialYear
            ? $"{prefix}{SEPARATOR}{financialYear}{SEPARATOR}{seqText}"
            : $"{prefix}{SEPARATOR}{seqText}";
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PrefixRow>>> All(CancellationToken ct)
    {
        var rows = await _db.DocPrefixMasters.AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.ModuleKey)
            .Select(x => new PrefixRow(x.Id, x.ModuleKey, x.Prefix, x.UsesFinancialYear, x.IsActive))
            .ToListAsync(ct);
        return Ok(rows);
    }

    /// <summary>SECTION 166 - includes deactivated rows too, for the admin CRUD page.</summary>
    [HttpGet("admin-list")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<ActionResult<IReadOnlyList<PrefixRow>>> AdminList(CancellationToken ct)
    {
        var rows = await _db.DocPrefixMasters.AsNoTracking()
            .OrderBy(x => x.ModuleKey)
            .Select(x => new PrefixRow(x.Id, x.ModuleKey, x.Prefix, x.UsesFinancialYear, x.IsActive))
            .ToListAsync(ct);
        return Ok(rows);
    }

    /// <summary>Preview-only - see class doc comment. `financialYear` is required ONLY when the
    /// module's own row has UsesFinancialYear=true - SECTION 184's "None" case omits it entirely
    /// and the preview number is just Prefix/running-number.</summary>
    [HttpGet("preview")]
    public async Task<ActionResult<PreviewRow>> Preview([FromQuery] string moduleKey, [FromQuery] string? financialYear, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(moduleKey))
            return BadRequest(new { message = "moduleKey is required, e.g. ?moduleKey=jobcards&financialYear=26-25" });

        var prefixRow = await _db.DocPrefixMasters.AsNoTracking()
            .FirstOrDefaultAsync(x => x.IsActive && x.ModuleKey == moduleKey, ct);
        if (prefixRow == null)
            return NotFound(new { message = $"No active Prefix Master row for Module '{moduleKey}'." });

        if (prefixRow.UsesFinancialYear && string.IsNullOrWhiteSpace(financialYear))
            return BadRequest(new { message = "This module's prefix uses a Financial Year - pass ?financialYear=26-25 (or similar)." });

        // SECTION 184: a module with UsesFinancialYear=false always looks its counter up under the
        // fixed "" sentinel (see DocNumberSequence.FinancialYear's doc comment) - whatever the
        // caller passed in financialYear for such a module is ignored rather than erroring, since
        // the field simply isn't meaningful here.
        var fyKey = prefixRow.UsesFinancialYear ? financialYear!.Trim() : "";

        var seqRow = await _db.DocNumberSequences.AsNoTracking()
            .FirstOrDefaultAsync(x => x.ModuleKey == moduleKey && x.FinancialYear == fyKey, ct);
        var nextSeq = (seqRow?.LastSequence ?? 0) + 1;
        var nextNumber = FormatNumber(prefixRow.Prefix, prefixRow.UsesFinancialYear, prefixRow.UsesFinancialYear ? fyKey : null, nextSeq);

        return Ok(new PreviewRow(moduleKey, prefixRow.Prefix, prefixRow.UsesFinancialYear ? fyKey : null, nextSeq, nextNumber));
    }

    /// <summary>SECTION 166/184 - add a new Module/Prefix row. ModuleKey is NOT upper-cased any
    /// more (SECTION 163's JC/MT/RB convention doesn't apply now that ModuleKey can be any
    /// NAV_ITEMS page key, which are lower-case/hyphenated, e.g. "repair-bill-new") - just trimmed.
    /// Uniqueness is enforced by the DB index on ModuleKey (one prefix row per page).</summary>
    [HttpPost]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Create([FromBody] CreateDocPrefixRequest req, CancellationToken ct)
    {
        var moduleKey = req.ModuleKey?.Trim();
        var prefix = req.Prefix?.Trim();
        if (string.IsNullOrWhiteSpace(moduleKey) || string.IsNullOrWhiteSpace(prefix))
            return BadRequest(new { message = "Module and Prefix are both required." });

        var entity = new DocPrefixMaster
        {
            ModuleKey = moduleKey,
            Prefix = prefix,
            UsesFinancialYear = req.UsesFinancialYear,
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
            return Conflict(new { message = $"A Prefix Master row for Module '{moduleKey}' already exists." });
        }

        await _audit.LogAsync("DocPrefixMaster.Create", "DocPrefixMaster", entity.Id.ToString(), new { entity.ModuleKey, entity.Prefix, entity.UsesFinancialYear });

        return Ok(new PrefixRow(entity.Id, entity.ModuleKey, entity.Prefix, entity.UsesFinancialYear, entity.IsActive));
    }

    /// <summary>SECTION 166 - edit the Prefix text / Uses Financial Year / active flag only.
    /// ModuleKey is NOT editable here - see class doc comment.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateDocPrefixRequest req, CancellationToken ct)
    {
        var entity = await _db.DocPrefixMasters.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null) return NotFound(new { message = "That Prefix Master row no longer exists." });

        var prefix = req.Prefix?.Trim();
        if (string.IsNullOrWhiteSpace(prefix)) return BadRequest(new { message = "Prefix is required." });

        entity.Prefix = prefix;
        entity.UsesFinancialYear = req.UsesFinancialYear;
        entity.IsActive = req.IsActive;
        entity.UpdatedById = _currentUser.UserId;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync("DocPrefixMaster.Update", "DocPrefixMaster", entity.Id.ToString(), new { entity.ModuleKey, entity.Prefix, entity.UsesFinancialYear, entity.IsActive });

        return Ok(new PrefixRow(entity.Id, entity.ModuleKey, entity.Prefix, entity.UsesFinancialYear, entity.IsActive));
    }

    /// <summary>SOFT delete (IsActive=false) - reversible via PUT isActive=true. Deactivating a
    /// module's prefix will make Preview() 404 for that Module (and, if this table is ever wired
    /// into the real numbering service in future, would presumably block real document creation
    /// too for that module) - so treat deactivating Job Card/Material Transfer Bill/Repair Bill's
    /// rows with real caution.</summary>
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

        await _audit.LogAsync("DocPrefixMaster.Deactivate", "DocPrefixMaster", entity.Id.ToString(), new { entity.ModuleKey, entity.Prefix });

        return Ok();
    }
}
