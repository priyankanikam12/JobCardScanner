using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Services;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// SECTION 188/189 (2026-10-02) - "Ledger Master" for Party/Insurance only. See Models/LedgerMaster.cs
/// for the full reasoning, especially around what this deliberately does NOT cover yet:
///   - "Company" and "Dealer" Ledger Type options are NOT served by this controller at all - those
///     are meant to come from your ERP (baplfinal, via the existing BaplConnection) - still being
///     pinned down with you, not guessed at here.
///   - Not yet wired into the Jobcard / Material Transfer / Repair Bill creation flows themselves -
///     this is the master-data CRUD + lookup API first.
///
/// SECTION 189 ("same ui give like which i give code of dms" - your screenshot showed every ledger
/// scoped to a Dealer Code, SuperAdmin-only cross-dealer filter): every row now belongs to exactly
/// one DealerId. Confirmed via AskUserQuestion - same "isOrgWideRole" pattern already used in
/// AttendanceController.cs/JobCardsController.cs:
///   - CorporateAdmin/SystemAdmin ("org-wide roles"): see/filter across ALL dealers, and must pick a
///     dealer explicitly on Create (they have no dealer of their own - _currentUser.DealerId is
///     null for them).
///   - Every other role (DealerAdmin, WorkshopManager, ...): always forced to their OWN
///     _currentUser.DealerId server-side - a client-supplied DealerId is never trusted for these
///     roles, same security posture as Attendance/JobCards. GetById/Update/Delete 404 (not 403 -
///     doesn't confirm to a non-owner that the row even exists) if the row belongs to a different
///     dealer.
///
/// Same role-floor convention as ComplaintMasterController/ServiceMenuMasterController: broad
/// Policies.Staff read access, Policies.WorkshopManagerUp for all writes. DELETE is a SOFT delete
/// (IsActive=false), reversible via PUT isActive=true.
/// </summary>
[ApiController]
[Route("api/ledger-master")]
[Authorize(Policy = Policies.Staff)]
public class LedgerMasterController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;

    /// <summary>Closed to exactly these two values - "Company"/"Dealer" are intentionally never
    /// accepted here, see class doc comment.</summary>
    private static readonly string[] AllowedLedgerTypes = { "Party", "Insurance" };

    private const string LedgerModuleKey = "ledger-master";

    public LedgerMasterController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    private bool IsOrgWideRole => _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;

    public record LedgerRow(
        Guid Id,
        Guid DealerId,
        string? DealerName,
        string LedgerType,
        string LedgerCode,
        string LedgerName,
        string? MobileNumber,
        string? AlternateMobileNo,
        string? EMail,
        string? Address,
        string? Pin,
        string? Gstno,
        string? Pan,
        string? AadharNumber,
        bool IsActive,
        DateTime CreatedAt,
        DateTime? UpdatedAt);

    public record PagedLedgerResponse(IReadOnlyList<LedgerRow> Data, int TotalRecords);

    public record CreateLedgerRequest(
        string LedgerType,
        string LedgerName,
        string? MobileNumber,
        string? AlternateMobileNo,
        string? EMail,
        string? Address,
        string? Pin,
        string? Gstno,
        string? Pan,
        string? AadharNumber,
        /// <summary>Required for CorporateAdmin/SystemAdmin (no dealer of their own) - ignored for
        /// every other role, which is always forced to its own _currentUser.DealerId instead.</summary>
        Guid? DealerId);

    public record UpdateLedgerRequest(
        string LedgerName,
        string? MobileNumber,
        string? AlternateMobileNo,
        string? EMail,
        string? Address,
        string? Pin,
        string? Gstno,
        string? Pan,
        string? AadharNumber,
        bool IsActive);

    /// <summary>Paged list - mirrors the DMS reference's GetLedgerByPagedAsync shape (pageIndex is
    /// 0-based, matching the Angular reference's `this.page - 1`), scoped down to this table's only
    /// two real Ledger Types. `ledgerType` filters to exactly "Party" or "Insurance"; omitted/blank
    /// returns both. `includeInactive` defaults to false - the admin page passes true to show
    /// everything for maintenance. `dealerId` is honored ONLY for org-wide roles (filters to one
    /// dealer; omitted shows all dealers) - every other role is always scoped to its own dealer
    /// regardless of what's passed here.</summary>
    [HttpGet]
    public async Task<ActionResult<PagedLedgerResponse>> Get(
        [FromQuery] string? searchTerm = null,
        [FromQuery] int pageIndex = 0,
        [FromQuery] int pageSize = 10,
        [FromQuery] string? ledgerType = null,
        [FromQuery] bool includeInactive = false,
        [FromQuery] Guid? dealerId = null,
        CancellationToken ct = default)
    {
        if (pageIndex < 0) pageIndex = 0;
        if (pageSize <= 0 || pageSize > 200) pageSize = 10;

        var query = _db.LedgerMasters.AsNoTracking().AsQueryable();

        if (IsOrgWideRole)
        {
            if (dealerId is not null) query = query.Where(x => x.DealerId == dealerId);
        }
        else
        {
            if (_currentUser.DealerId is null) return Ok(new PagedLedgerResponse(Array.Empty<LedgerRow>(), 0));
            query = query.Where(x => x.DealerId == _currentUser.DealerId);
        }

        if (!includeInactive)
            query = query.Where(x => x.IsActive);

        if (!string.IsNullOrWhiteSpace(ledgerType))
            query = query.Where(x => x.LedgerType == ledgerType);

        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            query = query.Where(x =>
                x.LedgerName.Contains(term)
                || x.LedgerCode.Contains(term)
                || (x.MobileNumber != null && x.MobileNumber.Contains(term))
                || (x.EMail != null && x.EMail.Contains(term)));
        }

        var totalRecords = await query.CountAsync(ct);

        var rows = await (
            from lm in query
            join d in _db.Dealers on lm.DealerId equals d.Id into dealerGroup
            from dealer in dealerGroup.DefaultIfEmpty()
            orderby lm.CreatedAt descending
            select new LedgerRow(
                lm.Id, lm.DealerId, dealer != null ? dealer.Name : null, lm.LedgerType, lm.LedgerCode, lm.LedgerName,
                lm.MobileNumber, lm.AlternateMobileNo, lm.EMail, lm.Address, lm.Pin, lm.Gstno, lm.Pan, lm.AadharNumber,
                lm.IsActive, lm.CreatedAt, lm.UpdatedAt)
        )
        .Skip(pageIndex * pageSize)
        .Take(pageSize)
        .ToListAsync(ct);

        return Ok(new PagedLedgerResponse(rows, totalRecords));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<LedgerRow>> GetById(Guid id, CancellationToken ct)
    {
        var entity = await _db.LedgerMasters.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null || !CanAccess(entity.DealerId)) return NotFound(new { message = "That ledger no longer exists." });

        var dealerName = await _db.Dealers.AsNoTracking().Where(d => d.Id == entity.DealerId).Select(d => d.Name).FirstOrDefaultAsync(ct);
        return Ok(ToRow(entity, dealerName));
    }

    /// <summary>Best-effort duplicate-mobile check for the form's inline warning (same UX idea as
    /// the DMS reference's checkPhoneNumberExist) - NOT a hard uniqueness constraint, since the DMS
    /// reference itself doesn't enforce one at the DB level either. Scoped to the caller's own
    /// dealer (org-wide roles check globally, across every dealer). `excludeId` lets the Edit form
    /// check without tripping over the row's own existing mobile number.</summary>
    [HttpGet("check-mobile")]
    public async Task<ActionResult<bool>> CheckMobileExists([FromQuery] string mobile, [FromQuery] Guid? excludeId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return Ok(false);

        var query = _db.LedgerMasters.AsNoTracking().Where(x => x.MobileNumber == mobile && x.IsActive && (excludeId == null || x.Id != excludeId));
        if (!IsOrgWideRole)
        {
            if (_currentUser.DealerId is null) return Ok(false);
            query = query.Where(x => x.DealerId == _currentUser.DealerId);
        }

        return Ok(await query.AnyAsync(ct));
    }

    [HttpPost]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Create([FromBody] CreateLedgerRequest req, CancellationToken ct)
    {
        var ledgerType = req.LedgerType?.Trim();
        if (string.IsNullOrWhiteSpace(ledgerType) || !AllowedLedgerTypes.Contains(ledgerType, StringComparer.OrdinalIgnoreCase))
            return BadRequest(new { message = $"Ledger Type must be one of: {string.Join(", ", AllowedLedgerTypes)}. \"Company\"/\"Dealer\" come from the ERP, not this form." });

        // Normalize to the canonical casing from AllowedLedgerTypes rather than whatever casing the
        // client sent, so LedgerType filtering/grouping never silently splits "party" vs "Party".
        ledgerType = AllowedLedgerTypes.First(t => string.Equals(t, ledgerType, StringComparison.OrdinalIgnoreCase));

        var ledgerName = req.LedgerName?.Trim();
        if (string.IsNullOrWhiteSpace(ledgerName))
            return BadRequest(new { message = "Ledger Name is required." });

        Guid effectiveDealerId;
        if (IsOrgWideRole)
        {
            if (req.DealerId is null) return BadRequest(new { message = "Dealer is required." });
            var dealerExists = await _db.Dealers.AsNoTracking().AnyAsync(d => d.Id == req.DealerId, ct);
            if (!dealerExists) return BadRequest(new { message = "That dealer no longer exists." });
            effectiveDealerId = req.DealerId.Value;
        }
        else
        {
            if (_currentUser.DealerId is null)
                return BadRequest(new { message = "Your account has no dealer assigned, so a ledger can't be created." });
            effectiveDealerId = _currentUser.DealerId.Value;
        }

        var ledgerCode = await ConsumeNextLedgerCodeAsync(ct);

        var entity = new LedgerMaster
        {
            DealerId = effectiveDealerId,
            LedgerType = ledgerType,
            LedgerCode = ledgerCode,
            LedgerName = ledgerName,
            MobileNumber = Trimmed(req.MobileNumber),
            AlternateMobileNo = Trimmed(req.AlternateMobileNo),
            EMail = Trimmed(req.EMail),
            Address = Trimmed(req.Address),
            Pin = Trimmed(req.Pin),
            Gstno = Trimmed(req.Gstno),
            Pan = Trimmed(req.Pan),
            AadharNumber = Trimmed(req.AadharNumber),
            IsActive = true,
            CreatedById = _currentUser.UserId,
            CreatedAt = DateTime.UtcNow,
        };
        _db.LedgerMasters.Add(entity);
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync("LedgerMaster.Create", "LedgerMaster", entity.Id.ToString(), new { entity.DealerId, entity.LedgerType, entity.LedgerCode, entity.LedgerName });

        var dealerName = await _db.Dealers.AsNoTracking().Where(d => d.Id == entity.DealerId).Select(d => d.Name).FirstOrDefaultAsync(ct);
        return Ok(ToRow(entity, dealerName));
    }

    /// <summary>LedgerType, LedgerCode and DealerId are NOT editable here - same "identity fields
    /// fixed after creation" convention as DocPrefixMaster's ModuleKey.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateLedgerRequest req, CancellationToken ct)
    {
        var entity = await _db.LedgerMasters.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null || !CanAccess(entity.DealerId)) return NotFound(new { message = "That ledger no longer exists." });

        var ledgerName = req.LedgerName?.Trim();
        if (string.IsNullOrWhiteSpace(ledgerName))
            return BadRequest(new { message = "Ledger Name is required." });

        entity.LedgerName = ledgerName;
        entity.MobileNumber = Trimmed(req.MobileNumber);
        entity.AlternateMobileNo = Trimmed(req.AlternateMobileNo);
        entity.EMail = Trimmed(req.EMail);
        entity.Address = Trimmed(req.Address);
        entity.Pin = Trimmed(req.Pin);
        entity.Gstno = Trimmed(req.Gstno);
        entity.Pan = Trimmed(req.Pan);
        entity.AadharNumber = Trimmed(req.AadharNumber);
        entity.IsActive = req.IsActive;
        entity.UpdatedById = _currentUser.UserId;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync("LedgerMaster.Update", "LedgerMaster", entity.Id.ToString(), new { entity.LedgerName, entity.IsActive });

        var dealerName = await _db.Dealers.AsNoTracking().Where(d => d.Id == entity.DealerId).Select(d => d.Name).FirstOrDefaultAsync(ct);
        return Ok(ToRow(entity, dealerName));
    }

    /// <summary>SOFT delete (IsActive=false) - reversible via PUT isActive=true.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var entity = await _db.LedgerMasters.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null || !CanAccess(entity.DealerId)) return NotFound(new { message = "That ledger no longer exists." });

        entity.IsActive = false;
        entity.UpdatedById = _currentUser.UserId;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync("LedgerMaster.Deactivate", "LedgerMaster", entity.Id.ToString(), new { entity.LedgerName });

        return Ok();
    }

    /// <summary>Org-wide roles (CorporateAdmin/SystemAdmin) can access any dealer's row; every other
    /// role only its own dealer's rows.</summary>
    private bool CanAccess(Guid rowDealerId) => IsOrgWideRole || rowDealerId == _currentUser.DealerId;

    private static LedgerRow ToRow(LedgerMaster x, string? dealerName) => new(
        x.Id, x.DealerId, dealerName, x.LedgerType, x.LedgerCode, x.LedgerName, x.MobileNumber, x.AlternateMobileNo,
        x.EMail, x.Address, x.Pin, x.Gstno, x.Pan, x.AadharNumber, x.IsActive, x.CreatedAt, x.UpdatedAt);

    private static string? Trimmed(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>Reserves (not just previews) the next "LED/###" number for a new Ledger row, using
    /// the existing Prefix Master / DocNumberSequence tables under ModuleKey "ledger-master" (seeded
    /// by Program.cs's RunLedgerMasterCatchUpAsync at startup). Wrapped in a transaction so two
    /// concurrent Ledger creations can't read-then-write the same LastSequence and collide on the
    /// unique LedgerCode index - the loser of that race gets a normal DB exception instead of a
    /// silently duplicated code. This is this app's FIRST real "consume a number" writer against
    /// DocNumberSequences; DocPrefixMasterController.Preview() deliberately never reserves one.
    /// NOTE: the running number is GLOBAL across all dealers (one shared "LED/001, LED/002, ..."
    /// sequence), not per-dealer - the DMS reference's own LedgerCode scheme is per-dealer
    /// (dealerSuffix embedded in the code), but SECTION 184's Prefix Master design this reuses has
    /// no per-dealer dimension at all (ModuleKey+FinancialYear only) - flagging this as a difference
    /// from the DMS reference, not a bug, unless you'd rather have a per-dealer running number.</summary>
    private async Task<string> ConsumeNextLedgerCodeAsync(CancellationToken ct)
    {
        await using var tx = await _db.Database.BeginTransactionAsync(ct);

        var prefixRow = await _db.DocPrefixMasters.FirstOrDefaultAsync(x => x.ModuleKey == LedgerModuleKey, ct);
        if (prefixRow is null)
        {
            // Self-heal fallback - Program.cs's startup catch-up should have already seeded this,
            // but a hot-reloaded dev session or a database created before this feature shipped
            // shouldn't hard-fail every single Ledger insert because of it.
            prefixRow = new DocPrefixMaster { ModuleKey = LedgerModuleKey, Prefix = "LED", UsesFinancialYear = false, IsActive = true, CreatedAt = DateTime.UtcNow };
            _db.DocPrefixMasters.Add(prefixRow);
        }

        const string fyKey = ""; // UsesFinancialYear=false sentinel - see DocNumberSequence.FinancialYear's doc comment
        var seqRow = await _db.DocNumberSequences.FirstOrDefaultAsync(x => x.ModuleKey == LedgerModuleKey && x.FinancialYear == fyKey, ct);
        if (seqRow is null)
        {
            seqRow = new DocNumberSequence { ModuleKey = LedgerModuleKey, FinancialYear = fyKey, LastSequence = 0 };
            _db.DocNumberSequences.Add(seqRow);
        }

        seqRow.LastSequence += 1;
        seqRow.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        var seqText = seqRow.LastSequence.ToString("000");
        return $"{prefixRow.Prefix}/{seqText}";
    }
}
