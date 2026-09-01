using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

public record ResolveBaplDealerRequest(string DealerCode);

/// <summary>
/// Job Card Wizard support for BAPL's own Dealer Management System (DMS) - a separate database
/// (BAPLDMSvadConnection) from both JobCardScannerDb and the BAPL ERP warehouse that
/// AdminDealerImportController/BaplDealerService already read from. Backs three things the wizard
/// needs: searching BAPL's live dealer/workshop list, turning a picked BAPL dealer into a usable
/// local <see cref="Dealer"/> row WITH a DealerAdmin login (find-or-create, same shared default
/// password as the bulk ERP import - see ResolveDealer below), and auto-filling customer/vehicle/
/// battery/warranty details by chassis, registration number, or mobile number (see
/// IBaplDmsService.LookupVehicleAsync, ported from BAPL DMS's own JobCardRepo).
/// </summary>
[ApiController]
[Route("api/bapl-dms")]
[Authorize(Policy = Policies.ServiceAdvisorUp)]
public class BaplDmsController : ControllerBase
{
    private readonly IBaplDmsService _baplDms;
    private readonly JobCardScannerDbContext _db;
    private readonly ILogger<BaplDmsController> _logger;
    private readonly IConfiguration _config;

    public BaplDmsController(IBaplDmsService baplDms, JobCardScannerDbContext db, ILogger<BaplDmsController> logger, IConfiguration config)
    {
        _baplDms = baplDms;
        _db = db;
        _logger = logger;
        _config = config;
    }

    /// <summary>Same shared default password as the bulk BAPL ERP import (AdminDealerImportController -
    /// BaplImport:DefaultDealerPassword in appsettings.json, "Dealer@123" unless overridden) -
    /// hashed with the app's existing PasswordHasher (PBKDF2, same as every other local login),
    /// never stored in plain text. MustChangePassword forces it to be replaced on first sign-in,
    /// same as the bulk import. The plain value is only ever handed back once, in the API response
    /// below, so whoever resolved this dealer can pass it on.</summary>
    private string DefaultDealerPassword => _config["BaplImport:DefaultDealerPassword"] ?? "Dealer@123";

    /// <summary>GET /api/bapl-dms/dealers?q=... - live search, min 2 chars.</summary>
    [HttpGet("dealers")]
    public async Task<IActionResult> SearchDealers([FromQuery] string q)
    {
        try
        {
            var rows = await _baplDms.SearchDealersAsync(q, HttpContext.RequestAborted);
            return Ok(rows);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>
    /// POST /api/bapl-dms/dealers/resolve - given a BAPL DMS dealer code (from the search above),
    /// finds-or-creates the matching local <see cref="Dealer"/> row AND ensures it has a
    /// DealerAdmin login, same as AdminDealerImportController's bulk ERP import: shared default
    /// password (BaplImport:DefaultDealerPassword, "Dealer@123" unless you've changed it),
    /// PBKDF2-hashed (never stored in plain text - see DefaultDealerPassword's doc comment above),
    /// MustChangePassword forces it to be replaced on first sign-in. Returns the dealer plus
    /// loginEmail/defaultPassword/loginCreated so the caller can hand the credentials to the dealer
    /// - that's the one and only place the plain password is ever exposed.
    /// </summary>
    [HttpPost("dealers/resolve")]
    public async Task<IActionResult> ResolveDealer(ResolveBaplDealerRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DealerCode)) return BadRequest(new { message = "dealerCode is required." });
        var code = req.DealerCode.Trim();

        // Already known locally, however it originally got here (BaplImport from ERP, manual, or a
        // previous resolve like this one) - match on either code field, since a dealer imported
        // from the ERP side may happen to share the same code BAPL DMS uses.
        var existing = await _db.Dealers.FirstOrDefaultAsync(d => d.Code == code || d.BaplDmsDealerCode == code);
        if (existing is not null)
        {
            if (existing.BaplDmsDealerCode != code)
            {
                existing.BaplDmsDealerCode = code;
                await _db.SaveChangesAsync();
            }
            // Backfill a login for a dealer that already exists here (e.g. imported from the ERP
            // side, or resolved before this login step was added) but has none yet.
            var hasLogin = await _db.Users.AnyAsync(u => u.DealerId == existing.Id);
            if (hasLogin) return Ok(new { existing.Id, existing.Name, existing.Code, existing.City, existing.BaplDmsDealerCode, loginCreated = false });

            IReadOnlyList<BaplDmsDealerRow> existingMatches;
            try { existingMatches = await _baplDms.SearchDealersAsync(code, HttpContext.RequestAborted); }
            catch (InvalidOperationException) { existingMatches = Array.Empty<BaplDmsDealerRow>(); } // dealer row still returned below even if BAPL DMS is unreachable right now
            var existingRow = existingMatches.FirstOrDefault(m => string.Equals(m.DealerCode, code, StringComparison.OrdinalIgnoreCase));
            var (loginEmail, defaultPassword) = await CreateDealerLoginAsync(existing, existingRow);
            return Ok(new { existing.Id, existing.Name, existing.Code, existing.City, existing.BaplDmsDealerCode, loginCreated = loginEmail is not null, loginEmail, defaultPassword });
        }

        IReadOnlyList<BaplDmsDealerRow> matches;
        try { matches = await _baplDms.SearchDealersAsync(code, HttpContext.RequestAborted); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }

        var row = matches.FirstOrDefault(m => string.Equals(m.DealerCode, code, StringComparison.OrdinalIgnoreCase));
        if (row is null) return NotFound(new { message = $"'{code}' was not found in BAPL DMS's dealer master." });

        var dealer = new Dealer
        {
            Name = row.DealerName,
            Code = row.DealerCode,
            BaplDmsDealerCode = row.DealerCode,
            City = string.IsNullOrWhiteSpace(row.City) ? null : row.City,
            State = string.IsNullOrWhiteSpace(row.State) ? null : row.State,
            Phone = string.IsNullOrWhiteSpace(row.Mobile) ? null : row.Mobile,
            Email = string.IsNullOrWhiteSpace(row.Email) || !row.Email.Contains('@') ? null : row.Email.Trim(),
            Source = DealerSource.BaplImport,
        };
        _db.Dealers.Add(dealer);
        await _db.SaveChangesAsync(); // need dealer.Id before creating its login
        _logger.LogInformation("Created Dealer {DealerId} from BAPL DMS dealer {DealerCode} via wizard resolve", dealer.Id, code);

        var (createdEmail, createdPassword) = await CreateDealerLoginAsync(dealer, row);
        return Ok(new { dealer.Id, dealer.Name, dealer.Code, dealer.City, dealer.BaplDmsDealerCode, loginCreated = createdEmail is not null, loginEmail = createdEmail, defaultPassword = createdPassword });
    }

    /// <summary>Creates the DealerAdmin login for a resolved dealer (see ResolveDealer above).
    /// Returns (null, null) if a login already exists for this email (extremely unlikely for a
    /// brand-new dealer, but the same defensive de-dup AdminDealerImportController uses) so the
    /// caller can still report the dealer without pretending a login was (re)created.</summary>
    private async Task<(string? Email, string? Password)> CreateDealerLoginAsync(Dealer dealer, BaplDmsDealerRow? row)
    {
        var email = row is not null && !string.IsNullOrWhiteSpace(row.Email) && row.Email.Contains('@') ? row.Email.Trim().ToLower()
            : row is not null && !string.IsNullOrWhiteSpace(row.Mobile) ? $"{row.Mobile.Trim()}@dealer.bgauss.local"
            : !string.IsNullOrWhiteSpace(dealer.Email) ? dealer.Email!.Trim().ToLower()
            : $"{dealer.Code.Trim().ToLower()}@dealer.bgauss.local";
        if (await _db.Users.AnyAsync(u => u.Email.ToLower() == email))
            email = $"{dealer.Code.Trim().ToLower()}@dealer.bgauss.local";
        if (await _db.Users.AnyAsync(u => u.Email.ToLower() == email))
        {
            _logger.LogWarning("Could not create a BAPL DMS dealer login for {DealerId} - {Email} already in use", dealer.Id, email);
            return (null, null);
        }

        var password = DefaultDealerPassword;
        _db.Users.Add(new User
        {
            Name = row is not null && !string.IsNullOrWhiteSpace(row.ContactPerson) ? row.ContactPerson : dealer.Name,
            Email = email,
            Mobile = row is not null && !string.IsNullOrWhiteSpace(row.Mobile) ? row.Mobile : dealer.Phone,
            Role = StaffRole.DealerAdmin,
            DealerId = dealer.Id,
            AuthType = UserAuthType.Local,
            PasswordHash = PasswordHasher.Hash(password),
            MustChangePassword = true,
        });
        await _db.SaveChangesAsync();
        return (email, password);
    }

    /// <summary>
    /// GET /api/bapl-dms/vehicle-lookup?value=...&amp;dealerCode=... - the "auto fetch everything"
    /// endpoint for a chassis number, registration number, or customer mobile number entered in the
    /// Job Card Wizard. dealerCode is optional (see IBaplDmsService.LookupVehicleAsync doc comment
    /// on why an unscoped search is safe here). Returns 404 for a genuine "searched, nothing found"
    /// (expected for a brand new/manually-entered vehicle) and 502 with the real error message for
    /// an actual BAPL DMS problem (bad connection/schema mismatch/etc.) - these used to both look
    /// like a 404 from the frontend, which made a real integration bug indistinguishable from
    /// "this vehicle just isn't in BAPL DMS".
    /// </summary>
    [HttpGet("vehicle-lookup")]
    public async Task<IActionResult> VehicleLookup([FromQuery] string value, [FromQuery] string? dealerCode)
    {
        if (string.IsNullOrWhiteSpace(value)) return BadRequest(new { message = "value (chassis no., registration no., or mobile number) is required." });
        try
        {
            var hit = await _baplDms.LookupVehicleAsync(value, dealerCode, HttpContext.RequestAborted);
            return hit is null ? NotFound(new { message = $"'{value}' was not found in BAPL DMS." }) : Ok(hit);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/bapl-dms/service-history?chassisNo=...&amp;dealerCode=... - this chassis's past job
    /// cards straight from BAPL DMS's own JobCardHeader/JobCardCustomer/JobCardComplaint tables, for
    /// the "Service History" section on JobCardScanner's own Job Card Detail page. Always returns 200
    /// with an (possibly empty) array on a genuine "nothing found" - only a real BAPL DMS problem
    /// (bad connection/schema mismatch/etc.) returns 502 with the real error message.
    /// </summary>
    [HttpGet("service-history")]
    public async Task<IActionResult> ServiceHistory([FromQuery] string chassisNo, [FromQuery] string? dealerCode)
    {
        if (string.IsNullOrWhiteSpace(chassisNo)) return BadRequest(new { message = "chassisNo is required." });
        try
        {
            var rows = await _baplDms.GetServiceHistoryAsync(chassisNo, dealerCode, HttpContext.RequestAborted);
            return Ok(rows);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/bapl-dms/job-cards/{jobCardHeaderId} - full read-only detail for one BAPL DMS job
    /// card. This is what a BAPL DMS row on the /jobcards list links to (see JobCardsListPage.tsx),
    /// since a BaplDms-sourced row has no JobCardScanner record to open instead.
    /// </summary>
    [HttpGet("job-cards/{jobCardHeaderId:int}")]
    public async Task<IActionResult> GetJobCard(int jobCardHeaderId)
    {
        try
        {
            var row = await _baplDms.GetJobCardByIdAsync(jobCardHeaderId, HttpContext.RequestAborted);
            return row is null ? NotFound(new { message = $"BAPL DMS job card {jobCardHeaderId} was not found." }) : Ok(row);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/bapl-dms/workshops?dealerId=&amp;q= - active "W" series workshop locations from BAPL
    /// DMS's own LocationMaster, for the wizard's Dealer/Workshop and Service Location pickers.
    /// dealerId is a LOCAL JobCardScanner Dealer id (not a raw BAPL DMS dealer code) - this resolves
    /// it to the dealer's BaplDmsDealerCode itself so the frontend never has to know or carry that
    /// code around. Omit dealerId to search every dealer's workshops by name/code (q).
    /// </summary>
    [HttpGet("workshops")]
    public async Task<IActionResult> Workshops([FromQuery] Guid? dealerId, [FromQuery] string? q)
    {
        string? baplDealerCode = null;
        if (dealerId.HasValue)
        {
            baplDealerCode = await _db.Dealers.AsNoTracking().Where(d => d.Id == dealerId).Select(d => d.BaplDmsDealerCode).FirstOrDefaultAsync();
            if (string.IsNullOrWhiteSpace(baplDealerCode))
                return Ok(Array.Empty<BaplDmsWorkshopRow>()); // dealer not linked to BAPL DMS yet - nothing to show, not an error
        }
        try
        {
            var rows = await _baplDms.GetWorkshopsAsync(baplDealerCode, q, HttpContext.RequestAborted);
            return Ok(rows);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(502, new { message = ex.Message });
        }
    }

    /// <summary>GET /api/bapl-dms/job-types - BAPL DMS's JobType master (Job Type dropdown).</summary>
    [HttpGet("job-types")]
    public async Task<IActionResult> JobTypes()
    {
        try { return Ok(await _baplDms.GetJobTypesAsync(HttpContext.RequestAborted)); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }
    }

    /// <summary>GET /api/bapl-dms/service-heads/{jobTypeId} - Service Head dropdown, dependent on
    /// the Job Type picked.</summary>
    [HttpGet("service-heads/{jobTypeId:int}")]
    public async Task<IActionResult> ServiceHeads(int jobTypeId)
    {
        try { return Ok(await _baplDms.GetServiceHeadsAsync(jobTypeId, HttpContext.RequestAborted)); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }
    }

    /// <summary>GET /api/bapl-dms/service-types/{serviceHeadId} - Service Type dropdown, dependent
    /// on the Service Head picked.</summary>
    [HttpGet("service-types/{serviceHeadId:int}")]
    public async Task<IActionResult> ServiceTypes(int serviceHeadId)
    {
        try { return Ok(await _baplDms.GetServiceTypesAsync(serviceHeadId, HttpContext.RequestAborted)); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }
    }

    /// <summary>GET /api/bapl-dms/complaints - BAPL DMS's active ComplaintMaster rows, for the
    /// "Customer complaints / concerns" dropdown.</summary>
    [HttpGet("complaints")]
    public async Task<IActionResult> Complaints()
    {
        try { return Ok(await _baplDms.GetComplaintsAsync(HttpContext.RequestAborted)); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }
    }

    /// <summary>GET /api/bapl-dms/job-sources - BAPL DMS's JobSource master (Walk In/RSA/Mega
    /// Camp/...), for the wizard's "Source" dropdown.</summary>
    [HttpGet("job-sources")]
    public async Task<IActionResult> JobSources()
    {
        try { return Ok(await _baplDms.GetJobSourcesAsync(HttpContext.RequestAborted)); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }
    }

    /// <summary>GET /api/bapl-dms/repair-bills/{jobCardHeaderId} - repair bill(s) BAPL DMS has for
    /// one job card, for the Job Card Detail page's "Download Invoice from DMS" panel. Empty array
    /// is normal (no bill raised for this job yet).</summary>
    [HttpGet("repair-bills/{jobCardHeaderId:int}")]
    public async Task<IActionResult> RepairBills(int jobCardHeaderId)
    {
        try { return Ok(await _baplDms.GetRepairBillsForJobAsync(jobCardHeaderId, HttpContext.RequestAborted)); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }
    }

    /// <summary>GET /api/bapl-dms/parts?locationCode=... - available stock per item at one workshop
    /// location (BAPL DMS's own PartsInventory), for the Job Card Detail page's "Part Suggestion"
    /// panel. See BaplDmsPartStockRow's doc comment for the (best-effort, unconfirmed) "available"
    /// rule this uses.</summary>
    [HttpGet("parts")]
    public async Task<IActionResult> Parts([FromQuery] string locationCode)
    {
        if (string.IsNullOrWhiteSpace(locationCode)) return Ok(Array.Empty<BaplDmsPartStockRow>());
        try { return Ok(await _baplDms.GetPartsInventoryAsync(locationCode, HttpContext.RequestAborted)); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }
    }

    /// <summary>
    /// GET /api/bapl-dms/labour?jobTypeId=&amp;serviceHeadId=&amp;serviceTypeId=&amp;q=... - backs the
    /// Job Card Detail page's "Labour Suggestion" panel. All params optional - jobTypeId/
    /// serviceHeadId/serviceTypeId default the list to the job card's own already-selected cascade
    /// (see JobCardDetail.baplJobTypeId etc on the frontend), q is a free-text search across
    /// LabourCode/LabourDescription combined with (not replacing) any cascade filter - see
    /// BaplDmsLabourRow's doc comment for why both matter (many LabourMaster rows have no cascade
    /// mapping yet).
    /// </summary>
    [HttpGet("labour")]
    public async Task<IActionResult> Labour([FromQuery] int? jobTypeId, [FromQuery] int? serviceHeadId, [FromQuery] int? serviceTypeId, [FromQuery] string? q)
    {
        try { return Ok(await _baplDms.GetLabourAsync(jobTypeId, serviceHeadId, serviceTypeId, q, HttpContext.RequestAborted)); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }
    }

    /// <summary>
    /// GET /api/bapl-dms/aspnet-users?q=... - backs Admin -&gt; Users' "BAPL DMS Logins" panel: lists
    /// every dealer/workshop login BAPL DMS's own AspNetUsers table knows about (the same table the
    /// "Dealer / Workshop Login" fallback checks - see BaplDmsService.VerifyDealerCredentialsAsync),
    /// cross-referenced against JobCardScannerDb's own Dealers (does this row's DealerCode already
    /// resolve to a known local Dealer?) and Users (has anyone actually signed in with this email
    /// yet, and are they active?). Lets an admin see, at a glance, exactly why a given login is or
    /// isn't working yet - no DealerCode, an unresolved DealerCode, or simply never signed in -
    /// instead of everyone pasting raw SQL dumps back and forth to figure it out. Read-only:
    /// PasswordHash is never read (see SearchAspNetUsersAsync) or returned. Admin-gated
    /// (DealerAdminUp) since this spans every dealer's login accounts, not just one dealer's own -
    /// same gate as the existing Azure AD directory browse (AdminDirectoryController).
    /// </summary>
    [HttpGet("aspnet-users")]
    [Authorize(Policy = Policies.DealerAdminUp)]
    public async Task<IActionResult> AspNetUsers([FromQuery] string? q)
    {
        IReadOnlyList<BaplDmsAspNetUserRow> rows;
        try { rows = await _baplDms.SearchAspNetUsersAsync(q, HttpContext.RequestAborted); }
        catch (InvalidOperationException ex) { return StatusCode(502, new { message = ex.Message }); }

        var codes = rows.Where(r => !string.IsNullOrWhiteSpace(r.DealerCode))
            .Select(r => r.DealerCode!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var knownDealers = await _db.Dealers.AsNoTracking()
            .Where(d => codes.Contains(d.Code) || (d.BaplDmsDealerCode != null && codes.Contains(d.BaplDmsDealerCode)))
            .Select(d => new { d.Id, d.Name, d.Code, d.BaplDmsDealerCode })
            .ToListAsync();

        var emails = rows.Where(r => !string.IsNullOrWhiteSpace(r.Email)).Select(r => r.Email.Trim().ToLower()).ToList();
        var localUsers = await _db.Users.AsNoTracking()
            .Where(u => u.AuthType == UserAuthType.Local && emails.Contains(u.Email.ToLower()))
            .ToDictionaryAsync(u => u.Email.ToLower(), u => u);

        var results = rows.Select(r =>
        {
            var dealer = string.IsNullOrWhiteSpace(r.DealerCode) ? null
                : knownDealers.FirstOrDefault(d =>
                    string.Equals(d.Code, r.DealerCode, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(d.BaplDmsDealerCode, r.DealerCode, StringComparison.OrdinalIgnoreCase));
            localUsers.TryGetValue(r.Email.Trim().ToLower(), out var local);
            return new
            {
                r.Id,
                r.Email,
                r.UserName,
                r.PhoneNumber,
                r.DealerCode,
                r.LockoutEnabled,
                r.EmailConfirmed,
                ResolvedDealerId = dealer?.Id,
                ResolvedDealerName = dealer?.Name,
                Provisioned = local is not null,
                LocalActive = local?.Active,
                LocalUserId = local?.Id,
            };
        });

        return Ok(results);
    }
}
