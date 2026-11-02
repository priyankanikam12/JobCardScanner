using System.Security.Cryptography;
using System.Text;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-11-01 (Shadowfax, e-mail of Ananth Srinath): what Shadowfax needs besides the read-only lists of ShadowfaxDataController.
///   GET  /api/shadowfax-data/jobcards/{id}/estimate      the estimate of a job card - its Part and Labour Suggestions - as bill-style lines (qty, rate, discount, tax, total), with a VERSION number
///   POST /api/shadowfax-data/jobcards/{id}/decisions     Shadowfax sends its decision: which lines it accepts / denies and why. Answered 201 (received), 200 when the same decisionId arrives again with the
///                                                        same content (nothing is stored twice), 409 for the same decisionId with different content or for a decision about an older estimate version
///   GET  /api/shadowfax-data/jobcards/{id}/decisions     the decisions received for one job card
///   GET  /api/shadowfax-data/decisions?since=            every decision received (paged), so both sides can check what was sent
/// Same key (X-API-Key = ApiKeys:Shadowfax) and same scope as ShadowfaxDataController: a job card of a MAGNEMITE dealer whose customer name contains SHADOWFAX; anything else is "not found".
/// The estimate version comes from dbo.JobCardEstimateVersions, kept by triggers (sql/2026-11-01_shadowfax_decisions_estimates.sql): +1 on every change of a part or labour suggestion; a suggestion keeps its id while it stays.
/// </summary>
[ApiController]
[Route("api/shadowfax-data")]
[AllowAnonymous]
public class ShadowfaxEstimatesDecisionsController : ControllerBase
{
    private const string ApiKeyConfigName = "ApiKeys:Shadowfax";
    private const string PartnerKeyword = "SHADOWFAX";
    private const int MaxPageSize = 1000;

    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<ShadowfaxEstimatesDecisionsController> _logger;

    public ShadowfaxEstimatesDecisionsController(JobCardScannerDbContext db, IConfiguration config, ILogger<ShadowfaxEstimatesDecisionsController> logger)
    {
        _db = db; _config = config; _logger = logger;
    }

    // ------------------------------------------------------------------ plumbing

    private IActionResult? CheckApiKey()
    {
        var configured = _config[ApiKeyConfigName];
        if (string.IsNullOrWhiteSpace(configured)) return StatusCode(503, new { message = "This integration is not yet configured." });
        if (!Request.Headers.TryGetValue("X-API-Key", out var provided) || !SameKey(provided.ToString(), configured))
            return Unauthorized(new { message = "Missing or invalid X-API-Key." });
        return null;
    }

    private static bool SameKey(string provided, string configured)
    {
        var a = Encoding.UTF8.GetBytes(provided); var b = Encoding.UTF8.GetBytes(configured);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    private static decimal D(object? v) => v is null ? 0m : Convert.ToDecimal(v);
    private static DateTime Utc(DateTime v) => DateTime.SpecifyKind(v, DateTimeKind.Utc);

    private Task<JobCard?> ScopedJobCardAsync(Guid id, CancellationToken ct) =>
        _db.JobCards.AsNoTracking().Include(j => j.Customer).Include(j => j.Dealer).Include(j => j.CurrentStage).Include(j => j.Vehicle)
            .FirstOrDefaultAsync(j => j.Id == id
                && j.Dealer != null && j.Dealer.Name.ToUpper().Contains("MAGNEMITE")
                && j.Customer != null && j.Customer.Name.ToUpper().Contains(PartnerKeyword), ct);

    // rows read with raw SQL (the tables are new and have no EF entity)
    public sealed class ItemTaxRow { public string ItemCode { get; set; } = ""; public decimal? Sgst { get; set; } public decimal? Cgst { get; set; } public decimal? Igst { get; set; } }
    public sealed class VersionRow { public int Version { get; set; } public DateTime UpdatedAt { get; set; } }
    public sealed class DecisionRow
    {
        public long Id { get; set; } public string DecisionId { get; set; } = ""; public Guid JobCardId { get; set; } public int EstimateVersion { get; set; } public int? CurrentEstimateVersion { get; set; }
        public string Decision { get; set; } = ""; public DateTime DecidedAt { get; set; } public string? DecidedBy { get; set; } public string? Reason { get; set; } public string PayloadHash { get; set; } = ""; public DateTime ReceivedAt { get; set; }
    }
    public sealed class DecisionLineRow { public long DecisionRowId { get; set; } public Guid LineId { get; set; } public string ItemCode { get; set; } = ""; public string Result { get; set; } = ""; }

    private sealed record EstimateData(int Version, DateTime? UpdatedAt, List<ShadowfaxEstimateLine> Lines, bool InterState);

    private async Task<EstimateData> LoadEstimateAsync(JobCard jc, CancellationToken ct)
    {
        var parts = await _db.JobCardPartSuggestions.AsNoTracking().Where(s => s.JobCardId == jc.Id).OrderBy(s => s.CreatedAt).ToListAsync(ct);
        var labour = await _db.JobCardLabourSuggestions.AsNoTracking().Where(s => s.JobCardId == jc.Id).OrderBy(s => s.CreatedAt).ToListAsync(ct);

        // a part suggestion keeps no GST of its own: the item's CGST / SGST / IGST come from the Item Master. Labour suggestions snapshot their own.
        var tax = new Dictionary<string, ItemTaxRow>(StringComparer.OrdinalIgnoreCase);
        var codes = parts.Select(p => (p.ItemCode ?? "").Trim()).Where(c => c.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (codes.Count > 0)
        {
            var sql = "SELECT [ItemCode] AS ItemCode, [SGST] AS Sgst, [CGST] AS Cgst, [IGST] AS Igst FROM [dbo].[C_ItemMaster] WHERE [ItemCode] IN (" + string.Join(",", codes.Select((_, i) => "@c" + i)) + ")";
            var rows = await _db.Database.SqlQueryRaw<ItemTaxRow>(sql, codes.Select((c, i) => (object)new SqlParameter("@c" + i, c)).ToArray()).ToListAsync(ct);
            foreach (var r in rows) tax[r.ItemCode.Trim()] = r;
        }

        var interState = EstimateMath.IsInterState(jc.Dealer?.State, jc.Customer?.State);
        var lines = new List<ShadowfaxEstimateLine>();
        foreach (var p in parts)
        {
            tax.TryGetValue((p.ItemCode ?? "").Trim(), out var t);
            lines.Add(EstimateMath.Build(p.Id, "Part", p.ItemCode ?? "", p.Description, p.HsnCode, p.Status, Convert.ToDouble(p.Quantity), D(p.Mrp), p.DiscountType, D(p.DiscountValue), D(t?.Sgst), D(t?.Cgst), D(t?.Igst), interState));
        }
        foreach (var l in labour)
            lines.Add(EstimateMath.Build(l.Id, "Labour", l.LabourCode ?? "", l.LabourDescription, l.HsnCode, l.IssueType, Convert.ToDouble(l.Quantity), D(l.RateAtSuggestion), l.DiscountType, D(l.DiscountValue), D(l.Sgst), D(l.Cgst), D(l.Igst), interState));

        var v = (await _db.Database.SqlQueryRaw<VersionRow>("SELECT [Version] AS Version, [UpdatedAt] AS UpdatedAt FROM [dbo].[JobCardEstimateVersions] WHERE [JobCardId] = {0}", jc.Id).ToListAsync(ct)).FirstOrDefault();
        return new EstimateData(v?.Version ?? (lines.Count > 0 ? 1 : 0), v is null ? null : Utc(v.UpdatedAt), lines, interState);
    }

    // ------------------------------------------------------------------ estimate

    /// <summary>The estimate of a job card: every part and labour line in the fields of a repair bill line, with the version number. estimateVersion 0 = no estimate yet (no suggestions).</summary>
    [HttpGet("jobcards/{id:guid}/estimate")]
    public async Task<IActionResult> Estimate(Guid id, CancellationToken ct)
    {
        var authFail = CheckApiKey(); if (authFail is not null) return authFail;
        var jc = await ScopedJobCardAsync(id, ct);
        if (jc is null) return NotFound(new { message = "Job card not found." });
        var e = await LoadEstimateAsync(jc, ct);
        return Ok(new
        {
            JobCardId = jc.Id, jc.JobCardNumber, Status = jc.Status.ToString(), Stage = jc.CurrentStage?.Label, ChassisNo = jc.Vehicle?.Vin,
            EstimateVersion = e.Version, EstimateUpdatedAt = e.UpdatedAt, TaxMode = e.InterState ? "InterState" : "IntraState",
            e.Lines, Totals = EstimateMath.Total(e.Lines),
        });
    }

    // ------------------------------------------------------------------ decisions

    private async Task<DecisionRow?> FindDecisionAsync(string decisionId, CancellationToken ct) =>
        (await _db.Database.SqlQueryRaw<DecisionRow>(DecisionSelect + " WHERE [DecisionId] = {0}", decisionId).ToListAsync(ct)).FirstOrDefault();

    private const string DecisionSelect =
        "SELECT [Id] AS Id, [DecisionId] AS DecisionId, [JobCardId] AS JobCardId, [EstimateVersion] AS EstimateVersion, [CurrentEstimateVersion] AS CurrentEstimateVersion, [Decision] AS Decision, " +
        "[DecidedAt] AS DecidedAt, [DecidedBy] AS DecidedBy, [Reason] AS Reason, [PayloadHash] AS PayloadHash, [ReceivedAt] AS ReceivedAt FROM [dbo].[ShadowfaxDecisions]";

    private static object Receipt(DecisionRow d, bool duplicate) => new
    {
        d.DecisionId, Status = "RECEIVED", Duplicate = duplicate, d.JobCardId, d.EstimateVersion, d.CurrentEstimateVersion, ReceivedAt = Utc(d.ReceivedAt),
    };

    private IActionResult ReplyForExisting(DecisionRow existing, string hash, Guid jobCardId)
    {
        if (existing.JobCardId != jobCardId) return Conflict(new { message = "This decisionId was already used for another job card.", existing.DecisionId });
        if (!string.Equals(existing.PayloadHash, hash, StringComparison.OrdinalIgnoreCase))
            return Conflict(new { message = "This decisionId was already received with different content. Send a changed decision with a new decisionId.", existing.DecisionId, ReceivedAt = Utc(existing.ReceivedAt) });
        return Ok(Receipt(existing, duplicate: true));   // the same decision again: nothing is stored twice
    }

    private static bool IsUniqueViolation(Exception ex) => ex.GetBaseException() is SqlException { Number: 2627 or 2601 };

    /// <summary>Shadowfax sends its decision for a job card's estimate. Validation, the repeat rule and the answers are described in DecisionRules and in the class comment.</summary>
    [HttpPost("jobcards/{id:guid}/decisions")]
    public async Task<IActionResult> PostDecision(Guid id, [FromBody] DecisionIn body, CancellationToken ct)
    {
        var authFail = CheckApiKey(); if (authFail is not null) return authFail;
        var jc = await ScopedJobCardAsync(id, ct);
        if (jc is null) return NotFound(new { message = "Job card not found." });
        body ??= new DecisionIn();
        var decisionId = body.DecisionId?.Trim();
        if (string.IsNullOrEmpty(decisionId)) return BadRequest(new { message = "Invalid decision.", errors = new[] { "decisionId is required." } });

        var hash = DecisionRules.Hash(body);
        var existing = await FindDecisionAsync(decisionId, ct);
        if (existing is not null) return ReplyForExisting(existing, hash, id);

        var estimate = await LoadEstimateAsync(jc, ct);
        if (body.EstimateVersion is int sent && sent != estimate.Version)
            return Conflict(new { message = "The estimate has changed since this version. Read the estimate again and send the decision for the current version.", EstimateVersion = sent, CurrentEstimateVersion = estimate.Version });
        var errors = DecisionRules.Validate(body, estimate.Lines.ToDictionary(l => l.Id, l => l.ItemCode), DateTimeOffset.UtcNow);
        if (errors.Count > 0) return BadRequest(new { message = "Invalid decision.", errors });

        try
        {
            await using var tx = await _db.Database.BeginTransactionAsync(ct);
            var headerId = (await _db.Database.SqlQueryRaw<long>(
                "INSERT INTO [dbo].[ShadowfaxDecisions] ([DecisionId],[JobCardId],[EstimateVersion],[CurrentEstimateVersion],[Decision],[DecidedAt],[DecidedBy],[Reason],[PayloadHash]) " +
                "OUTPUT INSERTED.[Id] AS [Value] VALUES ({0},{1},{2},{3},{4},{5},{6},{7},{8})",
                decisionId, id, body.EstimateVersion!.Value, estimate.Version, body.Decision!.Trim().ToUpperInvariant(), body.DecidedAt!.Value.UtcDateTime,
                (object?)body.DecidedBy?.Trim() ?? DBNull.Value, (object?)body.Reason?.Trim() ?? DBNull.Value, hash).ToListAsync(ct)).Single();
            foreach (var line in body.Lines!)
                await _db.Database.ExecuteSqlRawAsync("INSERT INTO [dbo].[ShadowfaxDecisionLines] ([DecisionRowId],[LineId],[ItemCode],[Result]) VALUES ({0},{1},{2},{3})",
                    new object[] { headerId, line.LineId!.Value, line.ItemCode!.Trim(), line.Result!.Trim().ToUpperInvariant() }, ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception ex) when (IsUniqueViolation(ex))
        {
            // the same decisionId arrived twice at the same moment: the other request won; answer as for a repeat
            var winner = await FindDecisionAsync(decisionId, ct);
            if (winner is not null) return ReplyForExisting(winner, hash, id);
            throw;
        }

        var saved = await FindDecisionAsync(decisionId, ct);
        _logger.LogInformation("Shadowfax decision {DecisionId} received for job card {JobCard}: {Decision}", decisionId, jc.JobCardNumber, body.Decision);
        return StatusCode(201, Receipt(saved!, duplicate: false));
    }

    private async Task<object[]> WithLinesAsync(List<DecisionRow> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return Array.Empty<object>();
        var sql = "SELECT [DecisionRowId] AS DecisionRowId, [LineId] AS LineId, [ItemCode] AS ItemCode, [Result] AS Result FROM [dbo].[ShadowfaxDecisionLines] WHERE [DecisionRowId] IN (" +
                  string.Join(",", rows.Select((_, i) => "@d" + i)) + ") ORDER BY [Id]";
        var lines = await _db.Database.SqlQueryRaw<DecisionLineRow>(sql, rows.Select((r, i) => (object)new SqlParameter("@d" + i, r.Id)).ToArray()).ToListAsync(ct);
        var byDecision = lines.GroupBy(l => l.DecisionRowId).ToDictionary(g => g.Key, g => g.Select(l => new { l.LineId, l.ItemCode, l.Result }).ToList());
        return rows.Select(d => (object)new
        {
            d.DecisionId, d.JobCardId, d.EstimateVersion, d.CurrentEstimateVersion, d.Decision, DecidedAt = Utc(d.DecidedAt), d.DecidedBy, d.Reason, ReceivedAt = Utc(d.ReceivedAt), Status = "RECEIVED",
            Lines = byDecision.TryGetValue(d.Id, out var l) ? l : new(),
        }).ToArray();
    }

    /// <summary>The decisions received for one job card, oldest first.</summary>
    [HttpGet("jobcards/{id:guid}/decisions")]
    public async Task<IActionResult> JobCardDecisions(Guid id, CancellationToken ct)
    {
        var authFail = CheckApiKey(); if (authFail is not null) return authFail;
        var jc = await ScopedJobCardAsync(id, ct);
        if (jc is null) return NotFound(new { message = "Job card not found." });
        var rows = await _db.Database.SqlQueryRaw<DecisionRow>(DecisionSelect + " WHERE [JobCardId] = {0} ORDER BY [Id]", id).ToListAsync(ct);
        return Ok(await WithLinesAsync(rows, ct));
    }

    /// <summary>Every decision received for Shadowfax's job cards, oldest first, optionally since a moment (ISO 8601, UTC) - so both sides can compare what was sent. Paged: pageIndex from 0, pageSize up to 1000; X-Total-Count.</summary>
    [HttpGet("decisions")]
    public async Task<IActionResult> Decisions([FromQuery] DateTimeOffset? since, [FromQuery] int pageIndex = 0, [FromQuery] int pageSize = 0, CancellationToken ct = default)
    {
        var authFail = CheckApiKey(); if (authFail is not null) return authFail;
        var size = pageSize <= 0 ? 500 : Math.Min(pageSize, MaxPageSize);
        var skip = Math.Max(0, pageIndex) * size;
        var from = (since ?? DateTimeOffset.MinValue.AddYears(1)).UtcDateTime;
        const string scope =
            " FROM [dbo].[ShadowfaxDecisions] d JOIN [dbo].[JobCards] j ON j.[Id] = d.[JobCardId] JOIN [dbo].[Dealers] dl ON dl.[Id] = j.[DealerId] JOIN [dbo].[Customers] c ON c.[Id] = j.[CustomerId] " +
            "WHERE UPPER(dl.[Name]) LIKE '%MAGNEMITE%' AND UPPER(c.[Name]) LIKE '%SHADOWFAX%' AND d.[ReceivedAt] >= {0}";
        var total = (await _db.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS [Value]" + scope, from).ToListAsync(ct)).Single();
        Response.Headers["X-Total-Count"] = total.ToString();
        var rows = await _db.Database.SqlQueryRaw<DecisionRow>(
            "SELECT d.[Id] AS Id, d.[DecisionId] AS DecisionId, d.[JobCardId] AS JobCardId, d.[EstimateVersion] AS EstimateVersion, d.[CurrentEstimateVersion] AS CurrentEstimateVersion, d.[Decision] AS Decision, " +
            "d.[DecidedAt] AS DecidedAt, d.[DecidedBy] AS DecidedBy, d.[Reason] AS Reason, d.[PayloadHash] AS PayloadHash, d.[ReceivedAt] AS ReceivedAt" + scope +
            " ORDER BY d.[Id] OFFSET {1} ROWS FETCH NEXT {2} ROWS ONLY", from, skip, size).ToListAsync(ct);
        return Ok(await WithLinesAsync(rows, ct));
    }
}