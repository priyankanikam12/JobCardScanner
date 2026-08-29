using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// Backs Admin -> Users' "Bulk Import Dealers from ERP" panel: pulls BGauss's real dealer
/// network from BAPL's C_CustomerMaster (<see cref="IBaplDealerService"/>) and, for each one not
/// already here, creates a JobCardScanner <see cref="Dealer"/> row plus a local ("Dealer /
/// Workshop Login") <see cref="User"/> account with role DealerAdmin so that dealer can sign in
/// and see their own dealer-scoped job cards - the same login mechanism already used by
/// DealerAuthController, just provisioned in bulk instead of one at a time via Admin -> Users'
/// manual form. Restricted to CorporateAdminUp since this creates new dealers network-wide, not
/// just within one existing dealer's scope.
/// </summary>
[ApiController]
[Route("api/admin/bapl-dealers")]
[Authorize(Policy = Policies.CorporateAdminUp)]
public class AdminDealerImportController : ControllerBase
{
    private readonly IBaplDealerService _bapl;
    private readonly JobCardScannerDbContext _db;
    private readonly ILogger<AdminDealerImportController> _logger;
    private readonly IConfiguration _config;

    public AdminDealerImportController(IBaplDealerService bapl, JobCardScannerDbContext db, ILogger<AdminDealerImportController> logger, IConfiguration config)
    {
        _bapl = bapl;
        _db = db;
        _logger = logger;
        _config = config;
    }

    /// <summary>Read from config (BaplImport:DefaultDealerPassword in appsettings.json) rather
    /// than hardcoded here, so it can be changed per-environment / moved to User Secrets or Key
    /// Vault without a code change. Still one shared password for every bulk-imported dealer
    /// (MustChangePassword forces it to be replaced on first sign-in) - a per-dealer random
    /// password is a separate, bigger change this wasn't asked for.</summary>
    private string DefaultDealerPassword => _config["BaplImport:DefaultDealerPassword"] ?? "Dealer@123";

    private async Task<HashSet<string>> ExistingDealerCodesAsync() =>
        (await _db.Dealers.Select(d => d.Code).ToListAsync())
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>GET /api/admin/bapl-dealers/status - counts only, no row data.</summary>
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        IReadOnlyList<BaplDealerRow> rows;
        try { rows = await _bapl.FetchActiveDealersAsync(HttpContext.RequestAborted); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }

        var existing = await ExistingDealerCodesAsync();
        var imported = rows.Count(r => existing.Contains(r.CustomerCode));

        return Ok(new
        {
            totalDealersInBapl = rows.Count,
            dealersImported = imported,
            pendingImport = rows.Count - imported,
        });
    }

    /// <summary>POST /api/admin/bapl-dealers/preview - dry run, no writes.</summary>
    [HttpPost("preview")]
    public async Task<IActionResult> Preview()
    {
        IReadOnlyList<BaplDealerRow> rows;
        try { rows = await _bapl.FetchActiveDealersAsync(HttpContext.RequestAborted); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }

        var existing = await ExistingDealerCodesAsync();

        var toCreate = rows
            .Where(r => !existing.Contains(r.CustomerCode))
            .Select(r => new
            {
                r.CustomerCode,
                r.CustomerName,
                r.City,
                r.State,
                r.Mobile,
                r.ContactPerson,
                r.AssignedRepCode,
                proposedEmail = BuildDealerEmail(r),
                hasRealEmail = !string.IsNullOrWhiteSpace(r.ContactEmail) && r.ContactEmail.Contains('@'),
            })
            .ToList();

        return Ok(new
        {
            totalInBapl = rows.Count,
            alreadyImported = existing.Count,
            toCreate = toCreate.Count,
            dealers = toCreate,
        });
    }

    /// <summary>
    /// POST /api/admin/bapl-dealers/import - creates a Dealer + a DealerAdmin login (password from
    /// config - see DefaultDealerPassword above - MustChangePassword) for every active BAPL dealer
    /// not already imported.
    /// Each dealer+login pair is created in its own DB transaction, so a failure on one dealer
    /// (bad data, duplicate email, etc.) can never leave an orphaned Dealer with no login - it's
    /// rolled back and reported in `errors`, and will simply be retried the next time Import is
    /// run (since it won't be in `existing` yet).
    /// </summary>
    [HttpPost("import")]
    public async Task<IActionResult> Import()
    {
        IReadOnlyList<BaplDealerRow> rows;
        try { rows = await _bapl.FetchActiveDealersAsync(HttpContext.RequestAborted); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }

        // Tracked, keyed by Code (not just the HashSet the other two actions use) so an already-
        // imported dealer's AssignedRepCode can be backfilled/kept in sync below, not just used to
        // decide skip-vs-create.
        var existingDealers = await _db.Dealers.ToDictionaryAsync(d => d.Code, StringComparer.OrdinalIgnoreCase);

        var defaultPassword = DefaultDealerPassword;
        var passwordHash = PasswordHasher.Hash(defaultPassword);

        int created = 0, skipped = 0, failed = 0, repCodeUpdated = 0;
        var errors = new List<string>();
        var createdList = new List<object>();

        foreach (var row in rows)
        {
            if (existingDealers.TryGetValue(row.CustomerCode, out var existingDealer))
            {
                // Cheap to keep in sync since we're already reading every active BAPL row on every
                // run: covers dealers imported before AssignedRepCode existed, and reps reassigned
                // in BAPL after the fact.
                if (!string.IsNullOrWhiteSpace(row.AssignedRepCode) && existingDealer.AssignedRepCode != row.AssignedRepCode)
                {
                    existingDealer.AssignedRepCode = row.AssignedRepCode;
                    await _db.SaveChangesAsync();
                    repCodeUpdated++;
                }
                skipped++;
                continue;
            }

            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                var dealer = new Dealer
                {
                    Name = row.CustomerName,
                    Code = row.CustomerCode,
                    City = string.IsNullOrWhiteSpace(row.City) ? null : row.City,
                    State = string.IsNullOrWhiteSpace(row.State) ? null : row.State,
                    Phone = string.IsNullOrWhiteSpace(row.Mobile) ? null : row.Mobile,
                    Email = !string.IsNullOrWhiteSpace(row.ContactEmail) && row.ContactEmail.Contains('@')
                        ? row.ContactEmail.Trim() : null,
                    AssignedRepCode = string.IsNullOrWhiteSpace(row.AssignedRepCode) ? null : row.AssignedRepCode,
                    Source = DealerSource.BaplImport,
                };
                _db.Dealers.Add(dealer);
                await _db.SaveChangesAsync(); // need dealer.Id before we can create its login

                var email = BuildDealerEmail(row);
                if (await _db.Users.AnyAsync(u => u.Email.ToLower() == email.ToLower()))
                    email = $"{row.CustomerCode.Trim().ToLower()}@dealer.bgauss.local";

                var login = new User
                {
                    Name = string.IsNullOrWhiteSpace(row.ContactPerson) ? row.CustomerName : row.ContactPerson,
                    Email = email,
                    Mobile = string.IsNullOrWhiteSpace(row.Mobile) ? null : row.Mobile,
                    Role = StaffRole.DealerAdmin,
                    DealerId = dealer.Id,
                    AuthType = UserAuthType.Local,
                    PasswordHash = passwordHash,
                    MustChangePassword = true,
                };
                _db.Users.Add(login);
                await _db.SaveChangesAsync();

                await tx.CommitAsync();
                existingDealers[row.CustomerCode] = dealer;
                created++;
                createdList.Add(new { row.CustomerCode, row.CustomerName, row.City, row.State, email });
            }
            catch (Exception ex)
            {
                await tx.RollbackAsync();
                _db.ChangeTracker.Clear(); // drop anything left tracked from the failed attempt
                failed++;
                errors.Add($"{row.CustomerCode} ({row.CustomerName}): {ex.Message}");
                _logger.LogWarning(ex, "BAPL dealer import failed for {Code}", row.CustomerCode);
            }
        }

        _logger.LogInformation("BAPL dealer import: created={Created}, skipped={Skipped}, failed={Failed}, repCodeUpdated={RepCodeUpdated}", created, skipped, failed, repCodeUpdated);

        return Ok(new
        {
            message = $"Import complete: {created} created, {skipped} already existed ({repCodeUpdated} rep codes updated), {failed} failed.",
            created,
            skipped,
            failed,
            repCodeUpdated,
            defaultPassword,
            errors,
            dealers = createdList,
        });
    }

    private static string BuildDealerEmail(BaplDealerRow row)
    {
        if (!string.IsNullOrWhiteSpace(row.ContactEmail) && row.ContactEmail.Contains('@'))
            return row.ContactEmail.Trim().ToLower();
        if (!string.IsNullOrWhiteSpace(row.Mobile))
            return $"{row.Mobile.Trim()}@dealer.bgauss.local";
        return $"{row.CustomerCode.Trim().ToLower()}@dealer.bgauss.local";
    }
}