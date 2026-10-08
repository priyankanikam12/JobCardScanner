using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Services;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// Ledger Master (2026-10-06). The ledger TYPES come from the Ledger Type master (LedgerTypeMasters: Id / CustomerType - 1 Dealer, 5 Company, 3 Insurance,
/// 4 Party); every ledger points at it by LedgerTypeId, and the page's Ledger Type filter and Add form are built from GET /api/ledger-master/types. What a type
/// MEANS comes from flags on its master row, not from its name, so a new type needs no code change:
///   IsErpSourced (+ ErpCustomerTypeId) - Dealer and Company. These ledgers are COPIED from the ERP (BAPLDMSvadConnection: C_CustomerMaster, picked through
///                    C_CustomerTypeGroupDetail.CustomerType = ErpCustomerTypeId; 1 = Dealer, 5 = "B2B" = our Company) by <see cref="SyncErpLedgersAsync"/>, on
///                    the first list call, every 15 minutes after that, and on the "Sync from ERP" button. They are READ-ONLY here (the ERP is the source of
///                    truth): never CREATED by hand; the sync keeps name, contact details and active flag current. Only a SystemAdmin may edit or delete one - doing so flags it ErpOverride
///                    and the sync then leaves that ledger alone.
///   IsOrgLevel     - organisation-level: no dealer, always shared (Company).
///   neither        - a normal per-dealer ledger created here (Party, Insurance, and any type added later).
/// An ERP dealer is tied to a dealer of this app through dbo.Dealers.BaplDmsDealerCode == the ERP customer code (so "select dealer, then type Dealer" shows
/// that dealer's own ledger); an ERP dealer not onboarded in this app has no DealerId yet and is still listed.
///
/// WHO SEES WHAT (the DMS rule): CorporateAdmin / SystemAdmin see everything (and can filter to one dealer). Everyone else sees shared ledgers (always the
/// ERP Dealer and Company ones) and their OWN dealer's. A client-supplied dealerId is ignored for them; a row they may not see answers 404, not 403.
/// WHO CAN CHANGE WHAT: ERP ledgers (Dealer, Company): SystemAdmin only. Ledgers created here (Party / Insurance ...): org-wide roles any, every other role its own dealer's.
/// 2026-10-07: EVERY staff role can create and edit (Policies.Staff on POST / PUT, within the scope above); only CorporateAdmin / SystemAdmin can DELETE or reactivate
/// (Policies.CorporateAdminUp on DELETE, and PUT refuses an IsActive change from anyone else). DELETE is a soft delete (IsActive = false).
/// Schema: sql/2026-10-06_ledger_type_master.sql, then sql/2026-10-06_ledger_erp_sourced.sql.
/// </summary>
[ApiController]
[Route("api/ledger-master")]
[Authorize(Policy = Policies.Staff)]
public class LedgerMasterController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;
    private readonly IBaplLedgerService _erpLedgers;   // reads the ERP customers (Dealer / Company ledgers) - see Services/BaplLedgerService.cs
    private readonly ILogger<LedgerMasterController> _logger;

    private const string LedgerModuleKey = "ledger-master";

    /// <summary>The master's four rows - only used to put them back if one is missing (a dev database); the SQL scripts are the normal way they get there.</summary>
    private static readonly (int Id, string Name, bool ErpSourced, int? ErpTypeId, bool OrgLevel, string? ErpCodes)[] SeedTypes =
    {
        (1, "Dealer", true, 1, false, null),
        (5, "Company", true, 5, true, "CUS0032"),   // only BGAUSS AUTO PRIVATE LIMITED is a Company
        (3, "Insurance", false, null, false, null),
        (4, "Party", false, null, false, null),
    };

    // ---- ERP sync state (shared by every request) ----
    private static readonly SemaphoreSlim ErpSyncLock = new(1, 1);
    private static DateTime _nextErpSyncUtc = DateTime.MinValue;
    private static string? _lastErpWarning;   // null = the last ERP copy worked (or none ran yet)
    private static readonly TimeSpan ErpSyncEvery = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan ErpRetryAfterFailure = TimeSpan.FromMinutes(2);

    public LedgerMasterController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit, IBaplLedgerService erpLedgers, ILogger<LedgerMasterController> logger)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _erpLedgers = erpLedgers;
        _logger = logger;
    }

    private bool IsOrgWideRole => _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;

    public record LedgerTypeOption(int Id, string CustomerType, bool IsErpSourced, bool IsOrgLevel);

    public record LedgerRow(
        Guid Id,
        Guid? DealerId,
        string? DealerName,
        /// <summary>The dealer's DMS-style code (BaplDmsDealerCode, else the local Code; for an ERP dealer without a local dealer, its ERP code) - the "CUS0364" shown before the dealer's name.</summary>
        string? DealerCode,
        int LedgerTypeId,
        string LedgerType,
        string LedgerCode,
        string LedgerName,
        string? MobileNumber,
        string? AlternateMobileNo,
        string? EMail,
        string? Address,
        string? Address2,
        string? City,
        string? State,
        string? Pin,
        string? Gstno,
        string? Pan,
        string? AadharNumber,
        bool IsShared,
        bool IsActive,
        DateTime CreatedAt,
        DateTime? UpdatedAt,
        /// <summary>true = an ERP ledger a SystemAdmin edited / deleted here - the ERP sync no longer overwrites it.</summary>
        bool ErpOverride,
        /// <summary>E-mail of the user who created / last updated the ledger (blank for a ledger copied from the ERP and never edited).</summary>
        string? CreatedBy,
        string? UpdatedBy);

    /// <summary>SyncWarning: why the last ERP copy (Dealer / Company ledgers) failed, or null when it is fine - the page shows it instead of an unexplained empty list.</summary>
    public record PagedLedgerResponse(IReadOnlyList<LedgerRow> Data, int TotalRecords, string? SyncWarning = null);

    /// <summary>One entry of the Dealer dropdown: "CUS0364 - A K ENTERPRISES" is Code + " - " + Name.</summary>
    public record DealerOptionRow(Guid Id, string? Code, string Name);

    /// <summary>One dealer fetched from the ERP (an active Dealer-type ledger) - the Dealer Code dropdown of the Ledger Master list. DealerId = the matching dealer of this app (null when
    /// that ERP dealer isn't onboarded here yet).</summary>
    public record ErpDealerOption(string Code, string Name, Guid? DealerId);

    /// <summary>Source: which connection / database / schema the ERP customers were read from (e.g. "BaplConnection (baplfinal, dbo)").</summary>
    public record ErpSyncResult(int Created, int Updated, int Deactivated, string? Warning, string? Source = null);

    public record CreateLedgerRequest(
        int LedgerTypeId,
        string LedgerName,
        string? MobileNumber,
        string? AlternateMobileNo,
        string? EMail,
        string? Address,
        string? Address2,
        string? City,
        string? State,
        string? Pin,
        string? Gstno,
        string? Pan,
        string? AadharNumber,
        /// <summary>Org-wide roles only, for a per-dealer type (required there). Ignored for every other role (forced to their own dealer) and for an org-level type.</summary>
        Guid? DealerId = null,
        /// <summary>Org-wide roles only: make a per-dealer ledger visible to every dealer. Ignored otherwise.</summary>
        bool? IsShared = null);

    public record UpdateLedgerRequest(
        string LedgerName,
        string? MobileNumber,
        string? AlternateMobileNo,
        string? EMail,
        string? Address,
        string? Address2,
        string? City,
        string? State,
        string? Pin,
        string? Gstno,
        string? Pan,
        string? AadharNumber,
        bool IsActive,
        bool? IsShared = null);

    // ------------------------------------------------------------------ ledger type master

    /// <summary>The active ledger types, A-Z - what the Ledger Type filter and the Add form show.</summary>
    [HttpGet("types")]
    public async Task<ActionResult<IReadOnlyList<LedgerTypeOption>>> Types(CancellationToken ct)
    {
        var types = await LoadTypesAsync(ct);
        return Ok(types.Select(t => new LedgerTypeOption(t.Id, t.CustomerType, t.IsErpSourced, t.IsOrgLevel)).ToList());
    }

    private async Task<List<LedgerTypeMaster>> LoadTypesAsync(CancellationToken ct)
    {
        await EnsureSeedTypesAsync(ct);
        return await _db.Set<LedgerTypeMaster>().AsNoTracking().Where(t => t.IsActive).OrderBy(t => t.CustomerType).ToListAsync(ct);
    }

    private async Task EnsureSeedTypesAsync(CancellationToken ct)
    {
        try
        {
            var have = await _db.Set<LedgerTypeMaster>().AsNoTracking().Select(t => t.Id).ToListAsync(ct);
            var missing = SeedTypes.Where(s => !have.Contains(s.Id)).ToList();
            if (missing.Count == 0) return;
            foreach (var s in missing)
                _db.Set<LedgerTypeMaster>().Add(new LedgerTypeMaster { Id = s.Id, CustomerType = s.Name, IsErpSourced = s.ErpSourced, ErpCustomerTypeId = s.ErpTypeId, ErpCustomerCodes = s.ErpCodes, IsOrgLevel = s.OrgLevel, IsActive = true });
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Ledger Master: could not put the default Ledger Type master rows back - run the Ledger Type SQL scripts.");
            _db.ChangeTracker.Clear();
        }
    }

    private async Task<LedgerTypeMaster?> FindTypeAsync(int id, CancellationToken ct) =>
        await _db.Set<LedgerTypeMaster>().AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, ct);

    // ------------------------------------------------------------------ visibility / permissions

    /// <summary>The DMS visibility rule as a query filter: org-wide sees all; everyone else sees shared ledgers (always the ERP Dealer + Company ones) and their own dealer's.</summary>
    private IQueryable<LedgerMaster> Visible(IQueryable<LedgerMaster> query)
    {
        if (IsOrgWideRole) return query;
        var myDealerId = _currentUser.DealerId;
        return query.Where(x => x.IsShared || (myDealerId != null && x.DealerId == myDealerId));
    }

    private bool IsVisible(LedgerMaster x) =>
        IsOrgWideRole || x.IsShared || (_currentUser.DealerId != null && x.DealerId == _currentUser.DealerId);

    /// <summary>Org-wide may change any ledger created here; every other role only its own dealer's, never an org-level one. (ERP ledgers are refused earlier.)</summary>
    private bool CanChange(LedgerMaster x, LedgerTypeMaster? type)
    {
        // Company and Dealer ledgers (copied from the ERP): only a SystemAdmin may edit or delete them.
        if (type?.IsErpSourced == true || x.ErpCustomerCode is not null) return _currentUser.Role == StaffRole.SystemAdmin;
        return IsOrgWideRole || (type?.IsOrgLevel != true && _currentUser.DealerId != null && x.DealerId == _currentUser.DealerId);
    }

    /// <summary>2026-10-07: delete / reactivate is for CorporateAdmin and SystemAdmin only - and a ledger copied from the ERP (Dealer, Company) only for a SystemAdmin, as before.</summary>
    private bool CanDelete(LedgerMaster x, LedgerTypeMaster? type)
    {
        if (type?.IsErpSourced == true || x.ErpCustomerCode is not null) return _currentUser.Role == StaffRole.SystemAdmin;
        return IsOrgWideRole;
    }

    // ------------------------------------------------------------------ list

    /// <summary>Paged list (pageIndex is 0-based). `ledgerTypeId` filters to one type of the Ledger Type master, blank = all. `includeInactive` defaults to
    /// false. `dealerCode` (an ERP dealer code such as CUS0030, from the Dealer Code dropdown) and `dealerId` are honoured for org-wide roles only (and ignored for an org-level type such as Company, which has no dealer). Ordered dealer-wise.</summary>
    [HttpGet]
    public async Task<ActionResult<PagedLedgerResponse>> Get(
        [FromQuery] string? searchTerm = null,
        [FromQuery] int pageIndex = 0,
        [FromQuery] int pageSize = 10,
        [FromQuery] int? ledgerTypeId = null,
        [FromQuery] bool includeInactive = false,
        [FromQuery] Guid? dealerId = null,
        [FromQuery] string? dealerCode = null,
        CancellationToken ct = default)
    {
        if (pageIndex < 0) pageIndex = 0;
        if (pageSize <= 0 || pageSize > 5000) pageSize = 10;

        if (!IsOrgWideRole && _currentUser.DealerId is null)
            return Ok(new PagedLedgerResponse(Array.Empty<LedgerRow>(), 0));

        var types = await LoadTypesAsync(ct);
        if (DateTime.UtcNow >= _nextErpSyncUtc) await SyncErpLedgersAsync(types, ct); // best-effort, throttled

        LedgerTypeMaster? wanted = null;
        if (ledgerTypeId is not null)
        {
            wanted = types.FirstOrDefault(t => t.Id == ledgerTypeId);
            if (wanted is null) return Ok(new PagedLedgerResponse(Array.Empty<LedgerRow>(), 0));
        }

        var query = Visible(_db.LedgerMasters.AsNoTracking());
        if (IsOrgWideRole && !string.IsNullOrWhiteSpace(dealerCode) && wanted?.IsOrgLevel != true)
        {
            // the dealer picked in the Dealer Code dropdown (an ERP dealer): its own Dealer ledger (same ERP code), plus any ledger of the dealer of this app that carries that code
            var code = dealerCode.Trim();
            var localDealerId = await _db.Dealers.AsNoTracking().Where(d => d.BaplDmsDealerCode == code)
                .Select(d => (Guid?)d.Id).FirstOrDefaultAsync(ct);
            query = query.Where(x => x.ErpCustomerCode == code || (localDealerId != null && x.DealerId == localDealerId));
        }
        else if (IsOrgWideRole && dealerId is not null && wanted?.IsOrgLevel != true)
        {
            // the dealer's own ledgers - linked by DealerId, or (an ERP ledger not linked yet) carrying the dealer's ERP code
            var dealerErpCode = await _db.Dealers.AsNoTracking().Where(d => d.Id == dealerId)
                .Select(d => d.BaplDmsDealerCode ?? d.Code).FirstOrDefaultAsync(ct);
            query = query.Where(x => x.DealerId == dealerId || (dealerErpCode != null && x.ErpCustomerCode == dealerErpCode));
        }
        if (!includeInactive) query = query.Where(x => x.IsActive);
        if (wanted is not null) query = query.Where(x => x.LedgerTypeId == wanted.Id);

        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var term = searchTerm.Trim();
            query = query.Where(x =>
                x.LedgerName.Contains(term)
                || x.LedgerCode.Contains(term)
                || (x.MobileNumber != null && x.MobileNumber.Contains(term))
                || (x.EMail != null && x.EMail.Contains(term))
                || (x.City != null && x.City.Contains(term))
                || (x.Gstno != null && x.Gstno.Contains(term)));
        }

        var totalRecords = await query.CountAsync(ct);

        var rows = await (
            from lm in query
            join t in _db.Set<LedgerTypeMaster>() on lm.LedgerTypeId equals t.Id
            join d in _db.Dealers on lm.DealerId equals (Guid?)d.Id into dealerGroup
            from dealer in dealerGroup.DefaultIfEmpty()
            join cu in _db.Users on lm.CreatedById equals (Guid?)cu.Id into createdGroup
            from createdUser in createdGroup.DefaultIfEmpty()
            join uu in _db.Users on lm.UpdatedById equals (Guid?)uu.Id into updatedGroup
            from updatedUser in updatedGroup.DefaultIfEmpty()
            orderby dealer.Name, t.CustomerType, lm.LedgerName
            select new LedgerRow(
                // Dealer Code / Name: the linked dealer's; for an ERP ledger with no dealer of this app (Company, or an ERP dealer not onboarded here) its own ERP code and name
                lm.Id, lm.DealerId, dealer != null ? dealer.Name : (lm.ErpCustomerCode != null ? lm.LedgerName : null),
                dealer != null ? (dealer.BaplDmsDealerCode ?? dealer.Code) : lm.ErpCustomerCode,
                lm.LedgerTypeId, t.CustomerType, lm.LedgerCode, lm.LedgerName,
                lm.MobileNumber, lm.AlternateMobileNo, lm.EMail, lm.Address, lm.Address2, lm.City, lm.State, lm.Pin,
                lm.Gstno, lm.Pan, lm.AadharNumber, lm.IsShared, lm.IsActive, lm.CreatedAt, lm.UpdatedAt, lm.ErpOverride,
                createdUser != null ? createdUser.Email : null, updatedUser != null ? updatedUser.Email : null)
        )
        .Skip(pageIndex * pageSize)
        .Take(pageSize)
        .ToListAsync(ct);

        return Ok(new PagedLedgerResponse(rows, totalRecords, _lastErpWarning));
    }

    /// <summary>The Dealer dropdown ("CUS0364 - A K ENTERPRISES"): every dealer for CorporateAdmin / SystemAdmin, only the caller's own dealer for everyone else.</summary>
    [HttpGet("dealers")]
    public async Task<ActionResult<IReadOnlyList<DealerOptionRow>>> Dealers(CancellationToken ct)
    {
        var query = _db.Dealers.AsNoTracking().AsQueryable();
        if (!IsOrgWideRole)
        {
            var myDealerId = _currentUser.DealerId;
            query = query.Where(d => d.Id == myDealerId);
        }
        var list = await query
            .OrderBy(d => d.BaplDmsDealerCode ?? d.Code)
            .Select(d => new DealerOptionRow(d.Id, d.BaplDmsDealerCode ?? d.Code, d.Name))
            .ToListAsync(ct);
        return Ok(list);
    }

    /// <summary>The Dealer Code dropdown for CorporateAdmin / SystemAdmin: the dealers fetched from the ERP - every active ledger of the ERP-sourced Dealer type, A-Z by code.
    /// Other roles get an empty list (their dealer box is locked to their own dealer).</summary>
    [HttpGet("erp-dealers")]
    public async Task<ActionResult<IReadOnlyList<ErpDealerOption>>> ErpDealers(CancellationToken ct)
    {
        if (!IsOrgWideRole) return Ok(Array.Empty<ErpDealerOption>());

        var types = await LoadTypesAsync(ct);
        if (DateTime.UtcNow >= _nextErpSyncUtc) await SyncErpLedgersAsync(types, ct);   // best-effort, throttled - so the first load already has the dealers

        var dealerType = types.FirstOrDefault(t => t.IsErpSourced && !t.IsOrgLevel);
        if (dealerType is null) return Ok(Array.Empty<ErpDealerOption>());

        var list = await _db.LedgerMasters.AsNoTracking()
            .Where(x => x.LedgerTypeId == dealerType.Id && x.IsActive && x.ErpCustomerCode != null)
            .OrderBy(x => x.ErpCustomerCode)
            .Select(x => new ErpDealerOption(x.ErpCustomerCode!, x.LedgerName, x.DealerId))
            .ToListAsync(ct);
        return Ok(list);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<LedgerRow>> GetById(Guid id, CancellationToken ct)
    {
        var entity = await _db.LedgerMasters.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null || !IsVisible(entity)) return NotFound(new { message = "That ledger no longer exists." });
        return Ok(await ToRowAsync(entity, ct));
    }

    /// <summary>Best-effort duplicate-mobile hint for the form (not a uniqueness rule). Looks at the caller's own dealer's ledgers (org-wide: all).</summary>
    [HttpGet("check-mobile")]
    public async Task<ActionResult<bool>> CheckMobileExists([FromQuery] string mobile, [FromQuery] Guid? excludeId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return Ok(false);

        var query = _db.LedgerMasters.AsNoTracking().Where(x => x.MobileNumber == mobile && x.IsActive && (excludeId == null || x.Id != excludeId));
        if (!IsOrgWideRole)
        {
            var myDealerId = _currentUser.DealerId;
            if (myDealerId is null) return Ok(false);
            query = query.Where(x => x.DealerId == myDealerId);
        }
        return Ok(await query.AnyAsync(ct));
    }

    // ------------------------------------------------------------------ create / update / deactivate

    [HttpPost]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Create([FromBody] CreateLedgerRequest req, CancellationToken ct)
    {
        await EnsureSeedTypesAsync(ct);
        var type = await FindTypeAsync(req.LedgerTypeId, ct);
        if (type is null || !type.IsActive)
            return BadRequest(new { message = "Ledger Type is not in the Ledger Type master." });
        if (type.IsErpSourced)
            return BadRequest(new { message = $"{type.CustomerType} ledgers come from the ERP and can't be added here." });
        if (type.IsOrgLevel && !IsOrgWideRole)
            return StatusCode(403, new { message = $"Only a CorporateAdmin or SystemAdmin can create a {type.CustomerType} ledger." });

        var ledgerName = req.LedgerName?.Trim();
        if (string.IsNullOrWhiteSpace(ledgerName))
            return BadRequest(new { message = "Ledger Name is required." });

        Guid? effectiveDealerId;
        var isShared = true;
        if (type.IsOrgLevel)
        {
            effectiveDealerId = null; // organisation-level
        }
        else if (IsOrgWideRole)
        {
            if (req.DealerId is null) return BadRequest(new { message = "Dealer is required." });
            if (!await _db.Dealers.AsNoTracking().AnyAsync(d => d.Id == req.DealerId, ct))
                return BadRequest(new { message = "That dealer no longer exists." });
            effectiveDealerId = req.DealerId;
            isShared = req.IsShared == true;
        }
        else
        {
            if (_currentUser.DealerId is null)
                return BadRequest(new { message = "Your account has no dealer assigned, so a ledger can't be created." });
            effectiveDealerId = _currentUser.DealerId;
            isShared = false;
        }

        string ledgerCode;
        try
        {
            ledgerCode = (await ReserveLedgerCodesAsync(1, ct))[0];
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Ledger Master: could not generate a Ledger Code.");
            return StatusCode(500, new { message = $"Could not generate the Ledger Code: {ex.GetBaseException().Message}" });
        }
        var actorId = await ActorIdAsync(ct);

        var entity = new LedgerMaster
        {
            DealerId = effectiveDealerId,
            LedgerTypeId = type.Id,
            LedgerCode = ledgerCode,
            LedgerName = ledgerName,
            MobileNumber = Trimmed(req.MobileNumber),
            AlternateMobileNo = Trimmed(req.AlternateMobileNo),
            EMail = Trimmed(req.EMail),
            Address = Trimmed(req.Address),
            Address2 = Trimmed(req.Address2),
            City = Trimmed(req.City),
            State = Trimmed(req.State),
            Pin = Trimmed(req.Pin),
            Gstno = Upper(req.Gstno),
            Pan = Upper(req.Pan),
            AadharNumber = Trimmed(req.AadharNumber),
            IsShared = isShared,
            IsActive = true,
            CreatedById = actorId,
            CreatedAt = DateTime.UtcNow,
        };
        _db.LedgerMasters.Add(entity);
        var saveError = await TrySaveAsync("save the ledger", ct);
        if (saveError is not null) return saveError;

        await TryAuditAsync("LedgerMaster.Create", "LedgerMaster", entity.Id.ToString(), new { entity.DealerId, entity.LedgerTypeId, entity.LedgerCode, entity.LedgerName });
        return Ok(await ToRowAsync(entity, ct));
    }

    /// <summary>The type, ledger code and dealer are fixed after creation. ERP-sourced ledgers (Dealer, Company) are read-only.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateLedgerRequest req, CancellationToken ct)
    {
        var entity = await _db.LedgerMasters.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null || !IsVisible(entity)) return NotFound(new { message = "That ledger no longer exists." });

        var type = await FindTypeAsync(entity.LedgerTypeId, ct);
        var isErpLedger = type?.IsErpSourced == true || entity.ErpCustomerCode is not null;
        if (!CanChange(entity, type))
            return StatusCode(403, new { message = isErpLedger
                ? $"A {type?.CustomerType ?? "ERP"} ledger comes from the ERP - only a SystemAdmin can edit it."
                : type?.IsOrgLevel == true
                    ? $"Only a CorporateAdmin or SystemAdmin can change a {type.CustomerType} ledger."
                    : "This ledger belongs to another dealer, so you can view it but not change it." });

        var ledgerName = req.LedgerName?.Trim();
        if (string.IsNullOrWhiteSpace(ledgerName)) return BadRequest(new { message = "Ledger Name is required." });
        entity.LedgerName = ledgerName;

        entity.MobileNumber = Trimmed(req.MobileNumber);
        entity.AlternateMobileNo = Trimmed(req.AlternateMobileNo);
        entity.EMail = Trimmed(req.EMail);
        entity.Address = Trimmed(req.Address);
        entity.Address2 = Trimmed(req.Address2);
        entity.City = Trimmed(req.City);
        entity.State = Trimmed(req.State);
        entity.Pin = Trimmed(req.Pin);
        entity.Gstno = Upper(req.Gstno);
        entity.Pan = Upper(req.Pan);
        entity.AadharNumber = Trimmed(req.AadharNumber);

        // 2026-10-07: deleting (IsActive = false) or reactivating is not part of "edit" - CorporateAdmin / SystemAdmin only. Everyone else may save the form, but not flip this.
        if (req.IsActive != entity.IsActive)
        {
            if (!CanDelete(entity, type))
                return StatusCode(403, new { message = "Only a CorporateAdmin or SystemAdmin can delete or reactivate a ledger." });
            entity.IsActive = req.IsActive;
        }
        if (isErpLedger) entity.ErpOverride = true;                    // edited here: the ERP sync leaves this ledger alone from now on
        if (type?.IsOrgLevel == true) entity.IsShared = true;
        else if (IsOrgWideRole && req.IsShared is not null) entity.IsShared = req.IsShared.Value;

        entity.UpdatedById = await ActorIdAsync(ct);
        entity.UpdatedAt = DateTime.UtcNow;
        var saveError = await TrySaveAsync("save the ledger", ct);
        if (saveError is not null) return saveError;

        await TryAuditAsync("LedgerMaster.Update", "LedgerMaster", entity.Id.ToString(), new { entity.LedgerName, entity.IsActive });
        return Ok(await ToRowAsync(entity, ct));
    }

    /// <summary>SOFT delete (IsActive = false), reversible with PUT isActive = true. ERP-sourced ledgers cannot be deactivated here.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.CorporateAdminUp)]   // 2026-10-07: was WorkshopManagerUp - delete is for CorporateAdmin / SystemAdmin only
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var entity = await _db.LedgerMasters.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null || !IsVisible(entity)) return NotFound(new { message = "That ledger no longer exists." });

        var type = await FindTypeAsync(entity.LedgerTypeId, ct);
        var isErpLedger = type?.IsErpSourced == true || entity.ErpCustomerCode is not null;
        if (!CanChange(entity, type))
            return StatusCode(403, new { message = isErpLedger
                ? $"A {type?.CustomerType ?? "ERP"} ledger comes from the ERP - only a SystemAdmin can delete it."
                : "You can't change this ledger." });
        if (!CanDelete(entity, type))
            return StatusCode(403, new { message = "Only a CorporateAdmin or SystemAdmin can delete a ledger." });

        entity.IsActive = false;
        if (isErpLedger) entity.ErpOverride = true;                    // deleted here: the sync must not bring it back
        entity.UpdatedById = await ActorIdAsync(ct);
        entity.UpdatedAt = DateTime.UtcNow;
        var saveError = await TrySaveAsync("delete the ledger", ct);
        if (saveError is not null) return saveError;

        await TryAuditAsync("LedgerMaster.Deactivate", "LedgerMaster", entity.Id.ToString(), new { entity.LedgerName });
        return Ok();
    }

    // ------------------------------------------------------------------ ERP sync (Dealer + Company)

    /// <summary>"Sync from ERP" button - CorporateAdmin / SystemAdmin only. Copies the Dealer and Company ledgers from the ERP right now.</summary>
    [HttpPost("sync-erp")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> SyncErp(CancellationToken ct)
    {
        if (!IsOrgWideRole) return StatusCode(403, new { message = "Only a CorporateAdmin or SystemAdmin can sync the ledgers from the ERP." });
        var types = await LoadTypesAsync(ct);
        var result = await SyncErpLedgersAsync(types, ct, force: true);
        if (result.Warning is not null && result.Created + result.Updated + result.Deactivated == 0)
            return StatusCode(502, new { message = result.Warning });
        return Ok(result);
    }

    /// <summary>Copies every ERP-sourced ledger type (Dealer, Company ...) from the ERP (read through <see cref="IBaplLedgerService") into LedgerMasters: creates the missing ledgers, refreshes name / contact
    /// details / active flag of the existing ones from the ERP, and deactivates ledgers the ERP no longer lists (only when the ERP returned rows for that type).
    /// Never throws - a failure is logged, returned as a warning, and retried in 2 minutes; the list keeps working from the last copy. One sync at a time.</summary>
    private async Task<ErpSyncResult> SyncErpLedgersAsync(IReadOnlyList<LedgerTypeMaster> types, CancellationToken ct, bool force = false)
    {
        var erpTypes = types.Where(t => t.IsErpSourced && t.ErpCustomerTypeId != null).ToList();
        if (erpTypes.Count == 0) { _lastErpWarning = "No Ledger Type is marked as ERP-sourced - run sql/2026-10-06_ledger_erp_sourced.sql."; return new ErpSyncResult(0, 0, 0, _lastErpWarning); }
        if (!await ErpSyncLock.WaitAsync(0, ct)) return new ErpSyncResult(0, 0, 0, "A sync is already running.");
        if (!force && DateTime.UtcNow < _nextErpSyncUtc) { ErpSyncLock.Release(); return new ErpSyncResult(0, 0, 0, null); }

        try
        {
            // ERP dealer code -> dealer of this app (dbo.Dealers.BaplDmsDealerCode)
            var dealerIdByCode = (await _db.Dealers.AsNoTracking().Where(d => d.BaplDmsDealerCode != null)
                    .Select(d => new { d.Id, Code = d.BaplDmsDealerCode! }).ToListAsync(ct))
                .GroupBy(d => d.Code.Trim().ToUpperInvariant())
                .ToDictionary(g => g.Key, g => g.First().Id);

            var usedCodes = new HashSet<string>(await _db.LedgerMasters.Select(x => x.LedgerCode).ToListAsync(ct), StringComparer.OrdinalIgnoreCase);
            var now = DateTime.UtcNow;
            var noRowsFor = new List<string>();

            foreach (var type in erpTypes)
            {
                // the master row can narrow the type to specific ERP customers (Company = CUS0032 only); blank = every customer of the ERP type
                var onlyCodes = SplitCodes(type.ErpCustomerCodes);
                var erpRows = await _erpLedgers.GetCustomersByTypeAsync(type.ErpCustomerTypeId!.Value, onlyCodes, ct);   // throws a readable error when the ERP can't be read
                if (erpRows.Count == 0)
                {
                    _logger.LogWarning("Ledger Master ERP sync: the ERP returned no customers for type {Type} (ERP customer type {ErpType}) - leaving its ledgers as they are.", type.CustomerType, type.ErpCustomerTypeId);
                    noRowsFor.Add(type.CustomerType);
                    continue;
                }

                var ledgers = await _db.LedgerMasters.Where(x => x.LedgerTypeId == type.Id).ToListAsync(ct);
                if (onlyCodes is not null)
                {
                    // ledgers of this type from an earlier, wider copy (every B2B customer) that are not in the master row's list are not part of the type - remove them
                    var allowed = new HashSet<string>(onlyCodes, StringComparer.OrdinalIgnoreCase);
                    var outside = ledgers.Where(x => !x.ErpOverride && x.ErpCustomerCode != null && !allowed.Contains(x.ErpCustomerCode)).ToList();
                    if (outside.Count > 0)
                    {
                        _db.LedgerMasters.RemoveRange(outside);
                        ledgers.RemoveAll(outside.Contains);
                        _logger.LogInformation("Ledger Master ERP sync: removed {Count} {Type} ledger(s) that are not in the Ledger Type master's ERP customer list ({Codes}).", outside.Count, type.CustomerType, type.ErpCustomerCodes);
                    }
                }
                var byErpCode = ledgers.Where(x => x.ErpCustomerCode != null).ToDictionary(x => x.ErpCustomerCode!, StringComparer.OrdinalIgnoreCase);
                // ledgers made by the earlier "one per Dealers row" version have no ERP code yet - adopt them by dealer instead of duplicating
                var adoptableByDealer = ledgers.Where(x => x.ErpCustomerCode == null && x.DealerId != null)
                    .GroupBy(x => x.DealerId!.Value).ToDictionary(g => g.Key, g => g.First());
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                foreach (var c in erpRows)
                {
                    seen.Add(c.CustomerCode);
                    Guid? dealerId = type.IsOrgLevel ? null : (dealerIdByCode.TryGetValue(c.CustomerCode.ToUpperInvariant(), out var did) ? did : null);

                    if (!byErpCode.TryGetValue(c.CustomerCode, out var ledger))
                    {
                        if (dealerId is not null && adoptableByDealer.TryGetValue(dealerId.Value, out var adopt)) { ledger = adopt; adoptableByDealer.Remove(dealerId.Value); }
                    }

                    if (ledger is { ErpOverride: true }) continue;   // a SystemAdmin edited / deleted this ledger here - keep it as they left it

                    if (ledger is null)
                    {
                        // the ERP customer code is the ledger code (unique across the table - a customer that is in two ERP types gets "CODE/typeId" for the second)
                        var code = usedCodes.Contains(c.CustomerCode) ? $"{c.CustomerCode}/{type.Id}" : c.CustomerCode;
                        if (code.Length > 40) code = code[..40];
                        usedCodes.Add(code);
                        ledger = new LedgerMaster { LedgerTypeId = type.Id, LedgerCode = code, CreatedAt = c.CreatedOn ?? now, CreatedById = null };
                        _db.LedgerMasters.Add(ledger);
                    }
                    else if (ledger.ErpCustomerCode is null && !usedCodes.Contains(c.CustomerCode))
                    {
                        usedCodes.Remove(ledger.LedgerCode);   // a ledger adopted from the old version takes the ERP code as its Ledger Code
                        ledger.LedgerCode = c.CustomerCode;
                        usedCodes.Add(c.CustomerCode);
                    }

                    ledger.ErpCustomerCode = c.CustomerCode;
                    ledger.DealerId = dealerId;
                    ledger.LedgerName = Cap(c.CustomerName, 200) ?? c.CustomerCode;
                    ledger.MobileNumber = Digits10(c.Mobile);
                    ledger.EMail = Cap(c.Email, 200);
                    ledger.Address = Cap(c.Address1, 400);
                    ledger.Address2 = Cap(string.Join(", ", new[] { c.Address2, c.Address3 }.Where(a => !string.IsNullOrWhiteSpace(a)).Select(a => a!.Trim())), 400);
                    ledger.City = Cap(c.City, 100);
                    ledger.State = Cap(c.State, 100);
                    ledger.Pin = Cap(c.ZipCode, 10);
                    ledger.IsShared = true;                                     // ERP dealers and companies are visible to everyone
                    ledger.IsActive = !string.Equals(c.Active?.Trim(), "N", StringComparison.OrdinalIgnoreCase);
                    ledger.UpdatedAt = c.ModifiedOn is { } m && (c.CreatedOn is null || m > c.CreatedOn) ? m : null;
                }

                // ledgers of this type the ERP no longer lists (or old local copies with no ERP code) are deactivated, not deleted
                foreach (var stale in ledgers.Where(x => x.IsActive && !x.ErpOverride && (x.ErpCustomerCode == null || !seen.Contains(x.ErpCustomerCode))))
                    stale.IsActive = false;
            }

            _db.ChangeTracker.DetectChanges();
            var entries = _db.ChangeTracker.Entries<LedgerMaster>().ToList();
            var created = entries.Count(e => e.State == EntityState.Added);
            var updated = entries.Count(e => e.State == EntityState.Modified);
            var deactivated = entries.Count(e => e.State == EntityState.Modified && !e.Entity.IsActive) + entries.Count(e => e.State == EntityState.Deleted);   // deactivated or removed
            if (_db.ChangeTracker.HasChanges()) await _db.SaveChangesAsync(ct);

            _nextErpSyncUtc = DateTime.UtcNow + ErpSyncEvery;
            _lastErpWarning = noRowsFor.Count == 0 ? null
                : $"the ERP returned no customers for {string.Join(", ", noRowsFor)} (check C_CustomerTypeGroupDetail.CustomerType and the ERP customer type Ids in the Ledger Type master).";
            _logger.LogInformation("Ledger Master ERP sync from {Source}: {Created} created, {Updated} updated ({Deactivated} deactivated).", _erpLedgers.SourceDescription, created, updated, deactivated);
            return new ErpSyncResult(created, updated - deactivated, deactivated, null, _erpLedgers.SourceDescription);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Ledger Master: could not sync the Dealer / Company ledgers from the ERP (BAPLDMSvadConnection) this time.");
            _db.ChangeTracker.Clear();
            _nextErpSyncUtc = DateTime.UtcNow + ErpRetryAfterFailure;
            _lastErpWarning = $"Could not read the ERP: {ex.GetBaseException().Message}";
            return new ErpSyncResult(0, 0, 0, _lastErpWarning);
        }
        finally
        {
            ErpSyncLock.Release();
        }
    }

    /// <summary>"CUS0032, CUS0099" (commas / semicolons / spaces) -> the codes; null when blank (= no narrowing).</summary>
    private static List<string>? SplitCodes(string? csv)
    {
        var codes = (csv ?? "").Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(c => c.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return codes.Count == 0 ? null : codes;
    }

    private static string? Cap(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : (s.Trim().Length <= max ? s.Trim() : s.Trim()[..max]);

    /// <summary>The last 10 digits of a phone text ("+91 97948-55937" -> "9794855937"); null when there are none.</summary>
    private static string? Digits10(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return null;
        var digits = new string(phone.Where(char.IsDigit).ToArray());
        if (digits.Length == 0) return null;
        return digits.Length > 10 ? digits[^10..] : digits;
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>One ledger as the list shows it (needs the dealer's name / code and the type's name).</summary>
    private async Task<LedgerRow> ToRowAsync(LedgerMaster x, CancellationToken ct)
    {
        string? dealerName = null, dealerCode = null;
        if (x.DealerId is not null)
        {
            var d = await _db.Dealers.AsNoTracking().Where(y => y.Id == x.DealerId)
                .Select(y => new { y.Name, Code = y.BaplDmsDealerCode ?? y.Code }).FirstOrDefaultAsync(ct);
            dealerName = d?.Name;
            dealerCode = d?.Code;
        }
        if (x.DealerId is null && x.ErpCustomerCode is not null) { dealerName = x.LedgerName; dealerCode = x.ErpCustomerCode; }   // an ERP ledger with no local dealer: its own code / name
        var createdBy = x.CreatedById is null ? null : await _db.Users.AsNoTracking().Where(u => u.Id == x.CreatedById).Select(u => u.Email).FirstOrDefaultAsync(ct);
        var updatedBy = x.UpdatedById is null ? null : await _db.Users.AsNoTracking().Where(u => u.Id == x.UpdatedById).Select(u => u.Email).FirstOrDefaultAsync(ct);
        var typeName = (await FindTypeAsync(x.LedgerTypeId, ct))?.CustomerType ?? "";
        return new LedgerRow(
            x.Id, x.DealerId, dealerName, dealerCode, x.LedgerTypeId, typeName, x.LedgerCode, x.LedgerName, x.MobileNumber, x.AlternateMobileNo,
            x.EMail, x.Address, x.Address2, x.City, x.State, x.Pin, x.Gstno, x.Pan, x.AadharNumber, x.IsShared, x.IsActive, x.CreatedAt, x.UpdatedAt, x.ErpOverride, createdBy, updatedBy);
    }

    private static string? Trimmed(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    private static string? Upper(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim().ToUpperInvariant();

    /// <summary>Reserves (not just previews) the next <paramref name="count"/> "LED/###" numbers from the Prefix Master / DocNumberSequence tables under
    /// ModuleKey "ledger-master", inside one transaction so concurrent callers can't read-then-write the same LastSequence. Used for ledgers created here
    /// (Party, Insurance ...); ERP ledgers use the ERP customer code instead.</summary>
    private async Task<List<string>> ReserveLedgerCodesAsync(int count, CancellationToken ct)
    {
        try
        {
            return await ReserveFromPrefixMasterAsync(count, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // e.g. the Prefix Master tables don't accept the self-created "ledger-master" row - never block saving a ledger on that: number from the existing LED/### codes instead.
            _logger.LogWarning(ex, "Ledger Master: the Prefix Master numbering for \"{Module}\" failed - numbering from the existing LED/### codes instead.", LedgerModuleKey);
            _db.ChangeTracker.Clear();
            return await ReserveFromExistingCodesAsync(count, ct);
        }
    }

    private Task<List<string>> ReserveFromPrefixMasterAsync(int count, CancellationToken ct)
    {
        // The execution strategy makes the explicit transaction work whether or not the DbContext was set up with EnableRetryOnFailure (a retrying strategy rejects a
        // user-started transaction otherwise).
        var strategy = _db.Database.CreateExecutionStrategy();
        return strategy.ExecuteAsync(async () =>
        {
            _db.ChangeTracker.Clear();
            await using var tx = await _db.Database.BeginTransactionAsync(ct);

            var prefixRow = await _db.DocPrefixMasters.FirstOrDefaultAsync(x => x.ModuleKey == LedgerModuleKey, ct);
            if (prefixRow is null)
            {
                // Self-heal: Program.cs's startup catch-up should already have seeded this.
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

            var first = seqRow.LastSequence + 1;
            seqRow.LastSequence += count;
            seqRow.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);

            var codes = new List<string>(count);
            for (var i = 0; i < count; i++) codes.Add($"{prefixRow.Prefix}/{(first + i):000}");
            return codes;
        });
    }

    /// <summary>Fallback numbering: the next LED/### after the highest one already in LedgerMasters. (The unique index on LedgerCode stops two simultaneous saves from sharing one.)</summary>
    private async Task<List<string>> ReserveFromExistingCodesAsync(int count, CancellationToken ct)
    {
        var existing = await _db.LedgerMasters.AsNoTracking().Where(x => x.LedgerCode.StartsWith("LED/")).Select(x => x.LedgerCode).ToListAsync(ct);
        var max = 0;
        foreach (var code in existing)
            if (int.TryParse(code.AsSpan(4), out var n) && n > max) max = n;
        return Enumerable.Range(1, count).Select(i => $"LED/{(max + i):000}").ToList();
    }

    /// <summary>The signed-in user's id for Created By / Updated By - only if that user really is a row of dbo.Users (the column is a foreign key to it), otherwise null.</summary>
    private async Task<Guid?> ActorIdAsync(CancellationToken ct)
    {
        Guid? id = _currentUser.UserId;
        if (id is null) return null;
        return await _db.Users.AsNoTracking().AnyAsync(u => u.Id == id, ct) ? id : null;
    }

    /// <summary>SaveChanges that turns a database failure into a readable JSON error (the real reason, not a bare HTTP 500). Returns null when it saved.</summary>
    private async Task<IActionResult?> TrySaveAsync(string what, CancellationToken ct)
    {
        try
        {
            await _db.SaveChangesAsync(ct);
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Ledger Master: could not {What}.", what);
            _db.ChangeTracker.Clear();
            return StatusCode(500, new { message = $"Could not {what}: {ex.GetBaseException().Message}" });
        }
    }

    /// <summary>The audit trail is best-effort: a failure there must not turn a saved ledger into an error.</summary>
    private async Task TryAuditAsync(string action, string entityType, string entityId, object details)
    {
        try { await _audit.LogAsync(action, entityType, entityId, details); }
        catch (Exception ex) { _logger.LogWarning(ex, "Ledger Master: the audit log entry for {Action} could not be written.", action); }
    }
}
