using System.Text.Json;
using System.Text.RegularExpressions;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services;

/// <summary>One W-series workshop location as read from the ERP table baplfinal.dbo.C_DMS_DealerConsigneeDetail.</summary>
public record DealerLocationSourceRow(
    int? LocId,
    string LocCode,
    string? LocName,
    string? Address,
    string? City,
    string? State,
    string? Pincode,
    string? Gstin,
    string? Email,
    string? Mobile,
    bool IsActive,
    DateTime? ModifiedAt,
    string? DealerCode);

/// <summary>What one sync run did.</summary>
public record DealerLocationSyncResult(
    int SourceRows,
    int Added,
    int Updated,
    int Reactivated,
    int Deactivated,
    int UnmatchedLocations,
    IReadOnlyList<string> UnmatchedDealerCodes,
    IReadOnlyList<string> NewLocationCodes,
    int DealerAdminsUpdated);

public interface IDealerLocationSyncService
{
    /// <summary>Reads the W-series locations from the ERP (BaplConnection) and applies them. Throws <see cref="InvalidOperationException"/> with a readable message when the ERP cannot be read.</summary>
    Task<DealerLocationSyncResult> SyncAsync(CancellationToken ct = default);

    /// <summary>The apply step on its own: upserts the given ERP rows into DealerLocations (no ERP access). SyncAsync = read + this.</summary>
    Task<DealerLocationSyncResult> ApplyAsync(IReadOnlyList<DealerLocationSourceRow> rows, CancellationToken ct = default);
}

/// <summary>
/// 2026-11-25 ("W series location wants to fetch in our JobCardScannerDb ... new location added in ERP that direct synced with their particular dealer").
///
/// Source: baplfinal.dbo.C_DMS_DealerConsigneeDetail, read through the same BaplConnection BaplDealerService already uses (read-only user). Rows whose Loc_Code ends in W + digits
/// (CUS0316W1 ... CUS0316W7) are the dealer's workshop locations; Dealer_Code (CUS0316) says which dealer they belong to.
/// Target: JobCardScannerDb.dbo.DealerLocations (sql/2026-11-25_DealerLocations.sql), upserted by LocationCode.
///
/// Dealer match: ERP Dealer_Code = Dealers.BaplDmsDealerCode, else = Dealers.Code (case-insensitive). ASSUMPTION: for your dealers one of the two holds the CUS code
/// (the Employees page already matches CUS0288W4 -> CUS0288 against BaplDmsDealerCode). A location with no matching dealer is still stored (DealerId null) and linked on a later run.
///
/// Rules: new ERP location = added; changed fields = updated; ERP Status other than 1 (or Status empty = active) = IsActive false; a location that has disappeared from the ERP is
/// switched off (never deleted) - but only when the ERP read returned rows, so an empty or failed read can never switch everything off.
/// Optional (default ON, DealerLocationSync:AddNewLocationsToDealerAdmins): a location that is NEW (or switched back on) is added to the Work Area of that dealer's active DealerAdmin logins who
/// already have a restricted list. An empty list means "unrestricted" everywhere in this app and is left alone; nobody is ever REMOVED from a location here. A changed Work Area takes effect
/// at that user's next sign-in (it is stamped into the token).
/// </summary>
public class DealerLocationSyncService : IDealerLocationSyncService
{
    private static readonly Regex WSeries = new(@"^(?<dealer>.+?)W(?<n>\d+)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<DealerLocationSyncService> _logger;

    public DealerLocationSyncService(JobCardScannerDbContext db, IConfiguration config, ILogger<DealerLocationSyncService> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    public async Task<DealerLocationSyncResult> SyncAsync(CancellationToken ct = default)
    {
        var rows = await FetchSourceRowsAsync(ct);
        return await ApplyAsync(rows, ct);
    }

    private async Task<IReadOnlyList<DealerLocationSourceRow>> FetchSourceRowsAsync(CancellationToken ct)
    {
        var connStr = _config.GetConnectionString("BaplConnection");
        if (string.IsNullOrWhiteSpace(connStr))
            throw new InvalidOperationException("BaplConnection isn't configured in appsettings.json's ConnectionStrings section.");

        // Column names are the ones in your pasted `select * from C_DMS_DealerConsigneeDetail`. The pre-filter is loose (any code with W + a digit); the exact W-series rule is applied in C# below.
        const string sql = @"
            SELECT Loc_Idno, Loc_Code, Loc_Name, Addr1, Addr2, City, State, PinCode, LocGSTIN_No, Email_Id, Mobile_No, Status, Date_Modified, Dealer_Code
            FROM [dbo].[C_DMS_DealerConsigneeDetail]
            WHERE Loc_Code LIKE '%W[0-9]%'";

        var result = new List<DealerLocationSourceRow>();
        try
        {
            await using var conn = new SqlConnection(connStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var locCode = Str(rdr["Loc_Code"]);
                if (locCode is null) continue;
                var m = WSeries.Match(locCode);
                if (!m.Success) continue;                                    // not a W-series workshop location

                var dealerCode = Str(rdr["Dealer_Code"]) ?? m.Groups["dealer"].Value.Trim();
                var address = string.Join(", ", new[] { Str(rdr["Addr1"]), Str(rdr["Addr2"]) }.Where(s => !string.IsNullOrWhiteSpace(s)));

                result.Add(new DealerLocationSourceRow(
                    rdr["Loc_Idno"] is DBNull ? null : Convert.ToInt32(rdr["Loc_Idno"]),
                    locCode.ToUpperInvariant(),
                    Str(rdr["Loc_Name"]),
                    address.Length == 0 ? null : address,
                    Str(rdr["City"]),
                    Str(rdr["State"]),
                    Str(rdr["PinCode"]),
                    Str(rdr["LocGSTIN_No"]),
                    Str(rdr["Email_Id"]),
                    Str(rdr["Mobile_No"]),
                    IsActiveStatus(Str(rdr["Status"])),
                    rdr["Date_Modified"] is DBNull ? null : Convert.ToDateTime(rdr["Date_Modified"]),
                    dealerCode.ToUpperInvariant()));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read the ERP dealer locations (C_DMS_DealerConsigneeDetail): {ex.Message}", ex);
        }
        return result;
    }

    private static string? Str(object v)
    {
        if (v is DBNull) return null;
        var s = v.ToString()?.Trim();
        return string.IsNullOrEmpty(s) ? null : s;
    }

    /// <summary>Status 1 (also Y / true / A / active) = active; an empty Status = active; anything else (0, N, false, ...) = inactive.
    /// The column's SQL type is not known, so it is read as text.</summary>
    private static bool IsActiveStatus(string? status) =>
        status is null || status.Trim().ToLowerInvariant() is "1" or "y" or "yes" or "true" or "a" or "active";

    public async Task<DealerLocationSyncResult> ApplyAsync(IReadOnlyList<DealerLocationSourceRow> rows, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;

        // One row per location code (the latest ERP change wins if the ERP ever lists a code twice).
        var source = rows
            .Where(r => !string.IsNullOrWhiteSpace(r.LocCode))
            .GroupBy(r => r.LocCode.Trim().ToUpperInvariant())
            .Select(g => g.OrderByDescending(r => r.ModifiedAt ?? DateTime.MinValue).First() with { LocCode = g.Key })
            .ToList();

        // Dealer lookup: DMS dealer code first, then the ERP customer code.
        var dealers = await _db.Dealers.AsNoTracking().Select(d => new { d.Id, d.Code, d.BaplDmsDealerCode }).ToListAsync(ct);
        var dealerByCode = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var d in dealers.Where(d => !string.IsNullOrWhiteSpace(d.BaplDmsDealerCode))) dealerByCode.TryAdd(d.BaplDmsDealerCode!.Trim(), d.Id);
        foreach (var d in dealers.Where(d => !string.IsNullOrWhiteSpace(d.Code))) dealerByCode.TryAdd(d.Code.Trim(), d.Id);

        var existing = await _db.DealerLocations.ToListAsync(ct);
        var existingByCode = new Dictionary<string, DealerLocation>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in existing) existingByCode.TryAdd(e.LocationCode, e);

        int added = 0, updated = 0, reactivated = 0, deactivated = 0, unmatched = 0;
        var unmatchedCodes = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var newCodes = new List<string>();
        var newlyActive = new List<DealerLocation>();

        foreach (var r in source)
        {
            var dealerCode = (r.DealerCode ?? "").Trim();
            Guid? dealerId = dealerByCode.TryGetValue(dealerCode, out var did) ? did : null;
            if (dealerId is null) { unmatched++; unmatchedCodes.Add(dealerCode); }

            if (existingByCode.TryGetValue(r.LocCode, out var row))
            {
                var wasActive = row.IsActive;
                var changed =
                    row.DealerId != dealerId || row.DealerCode != dealerCode || row.LocationName != r.LocName || row.Address != r.Address ||
                    row.City != r.City || row.State != r.State || row.Pincode != r.Pincode || row.Gstin != r.Gstin || row.Email != r.Email ||
                    row.Mobile != r.Mobile || row.SourceLocId != r.LocId || row.IsActive != r.IsActive || row.SourceModifiedAt != r.ModifiedAt;

                row.DealerId = dealerId; row.DealerCode = dealerCode; row.LocationName = r.LocName; row.Address = r.Address;
                row.City = r.City; row.State = r.State; row.Pincode = r.Pincode; row.Gstin = r.Gstin; row.Email = r.Email;
                row.Mobile = r.Mobile; row.SourceLocId = r.LocId; row.IsActive = r.IsActive; row.SourceModifiedAt = r.ModifiedAt;
                row.LastSyncedAt = now;

                if (changed) updated++;
                if (!wasActive && row.IsActive) { reactivated++; newlyActive.Add(row); }
                if (wasActive && !row.IsActive) deactivated++;
            }
            else
            {
                var created = new DealerLocation
                {
                    DealerId = dealerId, DealerCode = dealerCode, LocationCode = r.LocCode, LocationName = r.LocName, Address = r.Address,
                    City = r.City, State = r.State, Pincode = r.Pincode, Gstin = r.Gstin, Email = r.Email, Mobile = r.Mobile,
                    SourceLocId = r.LocId, IsActive = r.IsActive, SourceModifiedAt = r.ModifiedAt, FirstSyncedAt = now, LastSyncedAt = now,
                };
                _db.DealerLocations.Add(created);
                existingByCode[created.LocationCode] = created;
                added++;
                newCodes.Add(created.LocationCode);
                if (created.IsActive) newlyActive.Add(created);
            }
        }

        // A location the ERP no longer lists is switched off - only when this read returned rows (an empty/failed read must never switch everything off).
        if (source.Count > 0)
        {
            var seen = source.Select(r => r.LocCode).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var e in existing.Where(e => e.IsActive && !seen.Contains(e.LocationCode)))
            {
                e.IsActive = false;
                e.LastSyncedAt = now;
                deactivated++;
            }
        }

        var adminsUpdated = 0;
        if (_config.GetValue("DealerLocationSync:AddNewLocationsToDealerAdmins", true))
            adminsUpdated = await AddToDealerAdminsAsync(newlyActive, ct);

        await _db.SaveChangesAsync(ct);

        var result = new DealerLocationSyncResult(source.Count, added, updated, reactivated, deactivated, unmatched,
            unmatchedCodes.Where(c => c.Length > 0).ToList(), newCodes, adminsUpdated);
        _logger.LogInformation(
            "Dealer location sync: {Source} ERP rows, {Added} added, {Updated} updated, {Reactivated} switched back on, {Deactivated} switched off, {Unmatched} with no matching dealer, {Admins} DealerAdmin Work Area(s) extended.",
            result.SourceRows, result.Added, result.Updated, result.Reactivated, result.Deactivated, result.UnmatchedLocations, result.DealerAdminsUpdated);
        if (unmatchedCodes.Count > 0)
            _logger.LogWarning("Dealer location sync: no JobCardScannerDb dealer matches ERP dealer code(s) {Codes} - those locations are stored without a dealer until the dealer exists.", string.Join(", ", unmatchedCodes));
        return result;
    }

    /// <summary>Adds each newly active location to the Work Area of its dealer's active DealerAdmin logins that already have a non-empty list (see the class comment).</summary>
    private async Task<int> AddToDealerAdminsAsync(List<DealerLocation> newlyActive, CancellationToken ct)
    {
        var updatedUsers = 0;
        foreach (var group in newlyActive.Where(l => l.DealerId.HasValue).GroupBy(l => l.DealerId!.Value))
        {
            var codes = group.Select(l => l.LocationCode).ToList();
            var admins = await _db.Users
                .Where(u => u.DealerId == group.Key && u.Role == StaffRole.DealerAdmin && u.Active && u.WorkLocationCodes != null && u.WorkLocationCodes != "")
                .ToListAsync(ct);
            foreach (var admin in admins)
            {
                List<string> current;
                try { current = JsonSerializer.Deserialize<List<string>>(admin.WorkLocationCodes!) ?? new List<string>(); }
                catch { continue; }                                            // hand-edited / corrupt value: leave it alone
                if (current.Count == 0) continue;                              // empty = unrestricted: leave alone
                var missing = codes.Where(c => !current.Contains(c, StringComparer.OrdinalIgnoreCase)).ToList();
                if (missing.Count == 0) continue;

                var next = JsonSerializer.Serialize(current.Concat(missing).ToList());
                if (next.Length > 2000)                                        // User.WorkLocationCodes is MaxLength(2000)
                {
                    _logger.LogWarning("Dealer location sync: Work Area of {Email} would exceed 2000 characters - not extended.", admin.Email);
                    continue;
                }
                admin.WorkLocationCodes = next;
                updatedUsers++;
            }
        }
        return updatedUsers;
    }
}