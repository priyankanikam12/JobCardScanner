using ClosedXML.Excel;
using Microsoft.Data.SqlClient;

namespace JobCardScanner.Api.Services;

// =====================================================================================
// 2026-09-19 "Labour Master" sidebar page ("i want create 1 sidebar option also in that
// Labour Master after Service History ... i want 1. Partwise 2. Without partwise ... just
// want Effective Date * , Rate Type *, Upload Excel *(import ) in below grid shown and also
// duplicate data dont add update same data and dont override this data give for both").
//
// FACT (confirmed by opening the two .xlsx files you attached, "1789815567941_Without
// PartWise.xlsx" and "1789815567941_Partwise.xlsx"):
//   Without Partwise headers (row 1): Sr. | Labor Code | Job Descriptions | Model | Labour Rate
//     | IGST | CGST | SGST | Tier | Categeory
//   Partwise headers (row 1): Sr. | Part Code | Part Name | Labor Code | Job Descriptions
//     | Model | Labour Rate | IGST | CGST | SGST | Tier | Categeory
//   IGST/CGST/SGST are stored as a plain decimal fraction in the sheet (e.g. 0.18), not a
//   percentage (18) - this service stores that same number as-is, no unit conversion.
//
// ARCHITECTURE NOTE (flagging this since it's a departure from how every other DMSBAPLDATA
// service in this codebase behaves): DmsBaplDataService.cs and every "...Connection" comment
// in appsettings.json describe DMSBAPLDATA as read-only - a synced replica this app never
// writes to. You explicitly asked for these two new tables to live IN that same database
// ("in this datbase give this"), and this service DOES write to them (import/update/delete).
// This is technically possible only because DMSBAPLDATAConnection happens to use the same
// "admin" SQL login as JobCardScannerDb (see appsettings.json - both are the same AWS RDS
// instance, just a different Database= name), so that login already has write permission
// there. Nothing this service does touches the EXISTING synced tables (DMS_ServiceHistory,
// DMS_RepairBill, etc.) - only the two new, this-app-owned tables below
// (LabourMasterWithoutPartwise / LabourMasterPartwise), created by the SQL script delivered
// alongside this file. If DMSBAPLDATA's credentials are ever locked down to genuinely
// read-only (matching the documented intent), this feature would need its own writable
// connection string (e.g. pointed at JobCardScannerDb instead) - worth deciding deliberately
// rather than discovering it as a runtime failure.
//
// 2026-09-29 (SECTION 154, "in labor-master also i upload wrong fix IGST CGST SGST in that 18%
// and 9% that only ... this is wrong IGST CGST SGST"): your real screenshot showed IGST/CGST/
// SGST reading things like "18000%"/"9000%"/"9000%" for a Rate-1000 row, "1800%"/"900%"/"900%"
// for a Rate-100 row, "90%" for a Rate-5 row - i.e. the displayed value is exactly (true GST% x
// Labour Rate), not the GST% itself. FACT, confirmed by re-reading this whole file plus web's
// LabourMasterPage.tsx and mobile's LabourMasterScreen.tsx: nothing in any of those three files
// ever multiplies Igst/Cgst/Sgst by LabourRate - CellDecimal (still used for LabourRate itself,
// unchanged below) reads each column completely independently, and both frontends' fmtPct just
// does `value * 100`. Since the numbers you saw scale exactly with Rate, the raw cell being
// imported must ALREADY be Rate-scaled - almost certainly because the real file's IGST/CGST/SGST
// columns are FORMULA cells (e.g. "=LabourRateCell*18%") rather than a plain fraction like your
// two original sample files had - ClosedXML's cell.GetDouble() returns a formula's cached
// calculated result, not its formula text, so it faithfully imports the computed rupee amount.
//
// FIX (new CellGstFraction helper below, used ONLY for Igst/Cgst/Sgst - LabourRate/Tier still use
// the original CellDecimal/CellInt unchanged): no real Indian GST slab exceeds 28%, so any raw
// value above GstFractionMax (0.30, a deliberately generous ceiling) cannot already be a valid
// fraction. In that case ONLY, this divides by the row's own LabourRate to recover the implied
// fraction (the inverse of the Rate x fraction pattern your screenshot showed) - and if THAT
// recovered value still isn't plausible either (or Rate is null/zero, so division isn't possible),
// the cell is left NULL and a warning is added instead of silently guessing. A raw value already
// <= GstFractionMax (e.g. a plain 0.18, matching your original two sample files) is returned
// completely unchanged - this only changes behavior for the amount-not-fraction case.
//
// FLAGGED, not yet confirmed: I have not seen your actual current upload file, so this is my best
// inference from the numbers in your screenshot, not a certainty. Please check that file's IGST/
// CGST/SGST cells directly (click one and look at the formula bar) to confirm they're really
// formulas computing Rate x %, rather than something else I haven't considered. If this fix is
// right, simply re-importing the SAME file (same Effective Date) will correct the rows already
// sitting in the database too - the existing upsert-by-key logic below already treats a changed
// Igst/Cgst/Sgst as an UPDATE to the same row, not a new duplicate, so no separate cleanup script
// is needed.
// =====================================================================================

public record LabourMasterWithoutPartwiseRow(
    int Id,
    string LabourCode,
    string? JobDescription,
    string? Model,
    decimal? LabourRate,
    decimal? Igst,
    decimal? Cgst,
    decimal? Sgst,
    int? Tier,
    string? Category,
    DateOnly? EffectiveDate,
    bool IsActive,
    string? CreatedBy,
    DateTime CreatedDate,
    string? UpdatedBy,
    DateTime? UpdatedDate);

public record LabourMasterPartwiseRow(
    int Id,
    string? PartCode,
    string? PartName,
    string LabourCode,
    string? JobDescription,
    string? Model,
    decimal? LabourRate,
    decimal? Igst,
    decimal? Cgst,
    decimal? Sgst,
    int? Tier,
    string? Category,
    DateOnly? EffectiveDate,
    bool IsActive,
    string? CreatedBy,
    DateTime CreatedDate,
    string? UpdatedBy,
    DateTime? UpdatedDate);

/// <summary>Editable fields for one Without-Partwise row - everything except Id/LabourCode
/// (LabourCode is the row's identity, matched against the imported Excel's own "Labor Code"
/// column, so it isn't offered as an editable field here to avoid accidentally orphaning a
/// row from future re-imports).</summary>
public record LabourMasterWithoutPartwiseUpdate(
    string? JobDescription, string? Model, decimal? LabourRate, decimal? Igst, decimal? Cgst,
    decimal? Sgst, int? Tier, string? Category, DateOnly? EffectiveDate, bool IsActive);

public record LabourMasterPartwiseUpdate(
    string? PartName, string? JobDescription, string? Model, decimal? LabourRate, decimal? Igst,
    decimal? Cgst, decimal? Sgst, int? Tier, string? Category, DateOnly? EffectiveDate, bool IsActive);

/// <summary>Result of one Import Excel click, shown back to the user so a re-import of the
/// same/overlapping file is visibly a no-op rather than silent. Counts are mutually exclusive
/// per row: every non-blank row lands in exactly one of Inserted/Updated/Unchanged.</summary>
public record LabourMasterImportResult(int TotalDataRows, int Inserted, int Updated, int Unchanged, int SkippedBlank, IReadOnlyList<string> Warnings);

public interface ILabourMasterImportService
{
    Task<IReadOnlyList<LabourMasterWithoutPartwiseRow>> GetWithoutPartwiseAsync(string? search, CancellationToken ct = default);
    Task<IReadOnlyList<LabourMasterPartwiseRow>> GetPartwiseAsync(string? search, CancellationToken ct = default);

    /// <summary>2026-09-22 ("which Rate Type * is Partwise from this we upload FOR Part Code add
    /// Labour Code also that was wants to integrate in material transfer") - exact (not LIKE/
    /// Contains) Part Code match, Active rows only, for MaterialTransferCreatePage.tsx's new
    /// "Labour" picker. Deliberately exact, not the same broad multi-field LIKE search
    /// GetPartwiseAsync's own `search` param does (used by the Labour Master admin grid) - the
    /// AskUserQuestion answer for this feature was "Part Code only (Recommended - matches the
    /// video exactly)", scoped narrow rather than also fuzzy-matching Vehicle Model text.</summary>
    Task<IReadOnlyList<LabourMasterPartwiseRow>> GetPartwiseByPartCodeAsync(string partCode, CancellationToken ct = default);

    /// <summary>2026-09-22 ("that also going in repair bill"): batch, exact-match lookup by Labour
    /// Code (not Part Code) - Active rows only. RepairBillCreatePage.tsx's materialTransferItems
    /// sync effect uses this to recover a synced Labour row's real IGST/CGST/SGST for its own
    /// CGST Amt/SGST Amt/IGST Amt columns, the same reason its Part rows already do an equivalent
    /// by-code C_ItemMaster lookup - MaterialTransferDocItem itself stores no tax columns (see that
    /// model's own doc comment), so this is always a fresh read, never a persisted value. Mirrors
    /// ItemMasterController's own GET /api/item-master/by-codes batch-lookup shape/convention.</summary>
    Task<IReadOnlyList<LabourMasterPartwiseRow>> GetPartwiseByLabourCodesAsync(IReadOnlyCollection<string> labourCodes, CancellationToken ct = default);

    Task<LabourMasterImportResult> ImportWithoutPartwiseAsync(Stream excelStream, DateOnly effectiveDate, string? actor, CancellationToken ct = default);
    Task<LabourMasterImportResult> ImportPartwiseAsync(Stream excelStream, DateOnly effectiveDate, string? actor, CancellationToken ct = default);

    Task<LabourMasterWithoutPartwiseRow?> UpdateWithoutPartwiseAsync(int id, LabourMasterWithoutPartwiseUpdate update, string? actor, CancellationToken ct = default);
    Task<LabourMasterPartwiseRow?> UpdatePartwiseAsync(int id, LabourMasterPartwiseUpdate update, string? actor, CancellationToken ct = default);

    Task<bool> DeleteWithoutPartwiseAsync(int id, CancellationToken ct = default);
    Task<bool> DeletePartwiseAsync(int id, CancellationToken ct = default);
}

public class LabourMasterImportService : ILabourMasterImportService
{
    private readonly IConfiguration _config;
    private readonly ILogger<LabourMasterImportService> _logger;

    public LabourMasterImportService(IConfiguration config, ILogger<LabourMasterImportService> logger)
    {
        _config = config;
        _logger = logger;
    }

    private string ConnStr => _config.GetConnectionString("DMSBAPLDATAConnection")
        ?? throw new InvalidOperationException("DMSBAPLDATAConnection isn't configured in appsettings.json's ConnectionStrings section.");

    // ---------------------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------------------

    public async Task<IReadOnlyList<LabourMasterWithoutPartwiseRow>> GetWithoutPartwiseAsync(string? search, CancellationToken ct = default)
    {
        var rows = new List<LabourMasterWithoutPartwiseRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            const string sql = @"
                SELECT Id, LabourCode, JobDescription, Model, LabourRate, Igst, Cgst, Sgst, Tier,
                       Category, EffectiveDate, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
                FROM [dbo].[LabourMasterWithoutPartwise]
                WHERE (@search IS NULL
                    OR LabourCode LIKE @search OR Model LIKE @search
                    OR Category LIKE @search OR JobDescription LIKE @search)
                ORDER BY Model, LabourCode";
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@search", string.IsNullOrWhiteSpace(search) ? DBNull.Value : $"%{search.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct)) rows.Add(ReadWithoutPartwiseRow(rdr));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read DMSBAPLDATA's LabourMasterWithoutPartwise table: {ex.Message}", ex);
        }
        return rows;
    }

    public async Task<IReadOnlyList<LabourMasterPartwiseRow>> GetPartwiseAsync(string? search, CancellationToken ct = default)
    {
        var rows = new List<LabourMasterPartwiseRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            const string sql = @"
                SELECT Id, PartCode, PartName, LabourCode, JobDescription, Model, LabourRate, Igst,
                       Cgst, Sgst, Tier, Category, EffectiveDate, IsActive, CreatedBy, CreatedDate,
                       UpdatedBy, UpdatedDate
                FROM [dbo].[LabourMasterPartwise]
                WHERE (@search IS NULL
                    OR LabourCode LIKE @search OR Model LIKE @search OR PartCode LIKE @search
                    OR PartName LIKE @search OR Category LIKE @search OR JobDescription LIKE @search)
                ORDER BY Model, PartCode, LabourCode";
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@search", string.IsNullOrWhiteSpace(search) ? DBNull.Value : $"%{search.Trim()}%");
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct)) rows.Add(ReadPartwiseRow(rdr));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read DMSBAPLDATA's LabourMasterPartwise table: {ex.Message}", ex);
        }
        return rows;
    }

    public async Task<IReadOnlyList<LabourMasterPartwiseRow>> GetPartwiseByPartCodeAsync(string partCode, CancellationToken ct = default)
    {
        var rows = new List<LabourMasterPartwiseRow>();
        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            const string sql = @"
                SELECT Id, PartCode, PartName, LabourCode, JobDescription, Model, LabourRate, Igst,
                       Cgst, Sgst, Tier, Category, EffectiveDate, IsActive, CreatedBy, CreatedDate,
                       UpdatedBy, UpdatedDate
                FROM [dbo].[LabourMasterPartwise]
                WHERE PartCode = @partCode AND IsActive = 1
                ORDER BY JobDescription, LabourCode";
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@partCode", partCode.Trim());
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct)) rows.Add(ReadPartwiseRow(rdr));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read DMSBAPLDATA's LabourMasterPartwise table: {ex.Message}", ex);
        }
        return rows;
    }

    public async Task<IReadOnlyList<LabourMasterPartwiseRow>> GetPartwiseByLabourCodesAsync(IReadOnlyCollection<string> labourCodes, CancellationToken ct = default)
    {
        var rows = new List<LabourMasterPartwiseRow>();
        var codes = labourCodes.Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c.Trim()).Distinct().ToList();
        if (codes.Count == 0) return rows;

        try
        {
            await using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync(ct);
            // Parameterized IN (...) - one @p0, @p1, ... per code, same guard against SQL injection
            // every other raw-ADO.NET query in this file already uses via AddWithValue.
            var paramNames = codes.Select((_, i) => $"@p{i}").ToList();
            var sql = $@"
                SELECT Id, PartCode, PartName, LabourCode, JobDescription, Model, LabourRate, Igst,
                       Cgst, Sgst, Tier, Category, EffectiveDate, IsActive, CreatedBy, CreatedDate,
                       UpdatedBy, UpdatedDate
                FROM [dbo].[LabourMasterPartwise]
                WHERE LabourCode IN ({string.Join(",", paramNames)}) AND IsActive = 1
                ORDER BY LabourCode";
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            for (var i = 0; i < codes.Count; i++) cmd.Parameters.AddWithValue(paramNames[i], codes[i]);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct)) rows.Add(ReadPartwiseRow(rdr));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Could not read DMSBAPLDATA's LabourMasterPartwise table: {ex.Message}", ex);
        }
        return rows;
    }

    private static LabourMasterWithoutPartwiseRow ReadWithoutPartwiseRow(SqlDataReader rdr) => new(
        (int)rdr["Id"],
        (string)rdr["LabourCode"],
        rdr["JobDescription"] as string,
        rdr["Model"] as string,
        rdr["LabourRate"] as decimal?,
        rdr["Igst"] as decimal?,
        rdr["Cgst"] as decimal?,
        rdr["Sgst"] as decimal?,
        rdr["Tier"] as int?,
        rdr["Category"] as string,
        rdr["EffectiveDate"] is DateTime ed ? DateOnly.FromDateTime(ed) : null,
        (bool)rdr["IsActive"],
        rdr["CreatedBy"] as string,
        (DateTime)rdr["CreatedDate"],
        rdr["UpdatedBy"] as string,
        rdr["UpdatedDate"] as DateTime?);

    private static LabourMasterPartwiseRow ReadPartwiseRow(SqlDataReader rdr) => new(
        (int)rdr["Id"],
        rdr["PartCode"] as string,
        rdr["PartName"] as string,
        (string)rdr["LabourCode"],
        rdr["JobDescription"] as string,
        rdr["Model"] as string,
        rdr["LabourRate"] as decimal?,
        rdr["Igst"] as decimal?,
        rdr["Cgst"] as decimal?,
        rdr["Sgst"] as decimal?,
        rdr["Tier"] as int?,
        rdr["Category"] as string,
        rdr["EffectiveDate"] is DateTime ed ? DateOnly.FromDateTime(ed) : null,
        (bool)rdr["IsActive"],
        rdr["CreatedBy"] as string,
        (DateTime)rdr["CreatedDate"],
        rdr["UpdatedBy"] as string,
        rdr["UpdatedDate"] as DateTime?);

    // ---------------------------------------------------------------------------------
    // Excel parsing helpers (shared by both import methods)
    // ---------------------------------------------------------------------------------

    /// <summary>Header match is case/space/punctuation-insensitive, same forgiving approach
    /// VehicleSalePage.tsx's own normalizeHeader uses on the frontend for its own Excel import -
    /// so "Labor Code", "labour code", "LABOR  CODE" etc. all resolve to the same column.</summary>
    private static string Normalize(string s) => s.Trim().ToLowerInvariant().Replace(".", "").Replace("  ", " ");

    private static Dictionary<string, int> BuildHeaderMap(IXLWorksheet ws)
    {
        var map = new Dictionary<string, int>();
        var lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 0;
        for (var c = 1; c <= lastCol; c++)
        {
            var h = Normalize(ws.Cell(1, c).GetString());
            if (!string.IsNullOrEmpty(h) && !map.ContainsKey(h)) map[h] = c;
        }
        return map;
    }

    private static int FindCol(Dictionary<string, int> headerMap, params string[] candidates)
    {
        foreach (var c in candidates)
            if (headerMap.TryGetValue(Normalize(c), out var col)) return col;
        return -1;
    }

    private static string? CellText(IXLWorksheet ws, int row, int col) =>
        col < 1 ? null : (ws.Cell(row, col).GetString() is { Length: > 0 } s ? s.Trim() : null);

    /// <summary>Reads the cell's raw underlying numeric value (via ClosedXML's typed accessor)
    /// rather than its formatted display text, when the cell is actually numeric-typed - this
    /// matters specifically for the IGST/CGST/SGST columns: the sample files you attached store
    /// these as a plain decimal (0.18), but if a real-world file instead has those cells
    /// PERCENTAGE-FORMATTED in Excel (displaying "18%" while still storing 0.18 underneath),
    /// GetString() would return the literal text "18%" and silently fail to parse as a number.
    /// Reading the raw double sidesteps that ambiguity entirely - it's 0.18 either way. Falls back
    /// to text parsing only for a cell ClosedXML sees as text (e.g. "1" typed as text, not a number).
    /// Still used as-is for LabourRate/Tier - see CellGstFraction below for the GST-specific
    /// variant added in SECTION 154.</summary>
    private static decimal? CellDecimal(IXLWorksheet ws, int row, int col)
    {
        if (col < 1) return null;
        var cell = ws.Cell(row, col);
        if (cell.IsEmpty()) return null;
        if (cell.DataType == XLDataType.Number) return (decimal)cell.GetDouble();
        var s = cell.GetString().Trim().TrimEnd('%');
        return s.Length > 0 && decimal.TryParse(s, out var d) ? d : null;
    }

    /// <summary>2026-09-29 (SECTION 154) - see this file's class-level doc comment for the full
    /// explanation. Deliberately separate from CellDecimal above (which stays unchanged for
    /// LabourRate/Tier) - only Igst/Cgst/Sgst go through this. No real Indian GST slab exceeds
    /// 28%, so GstFractionMax (0.30, a deliberately generous ceiling) is used as the boundary
    /// between "already a valid fraction" and "looks like something else that needs recovering".
    ///
    /// SECTION 178 (2026-09-30) ("according thi excel file i upload partwise labour but cgst isgt
    /// all not going as it is give proper") - CONFIRMED by actually opening the uploaded file
    /// (1790763818913_Labour_Master_Partwise_1.xlsx, 414 data rows) with openpyxl: every row
    /// stored IGST=18, CGST=9, SGST=9 as a PLAIN PERCENTAGE NUMBER (literal 18, meaning "18%"),
    /// completely independent of that row's Labour Rate (Rate 600, 300, 1400, 200, 133.33... all
    /// showed the same IGST=18) - a THIRD format, different from both cases SECTION 154 handled
    /// (not already a fraction, and not a Rate-scaled rupee amount either). SECTION 154's single
    /// recovery strategy (divide by Rate) silently produced a WRONG but still-plausible value here
    /// (raw 18 / Rate 600 = 0.03, i.e. 3%, which passes the 0.30 ceiling and was accepted) - that
    /// was exactly "cgst isgt all not going as it is."
    ///
    /// Now tries TWO recovery strategies in order instead of one: (1) raw / 100 - treat raw as a
    /// plain percentage number (18 -> 0.18), tried FIRST since a real Indian GST rate divided by
    /// 100 is almost always immediately plausible, and this is what the Partwise file needs; (2)
    /// raw / LabourRate - SECTION 154's original Rate-scaled-rupee-amount recovery, tried only if
    /// (1) wasn't plausible - still needed for files formatted the other way (a formula cell
    /// computing Rate x true%, e.g. Rate 1000 / raw 180: 180/100=1.8 fails the ceiling, falls
    /// through to 180/1000=0.18, still correctly recovered). Verified against both the original
    /// Rate-scaled case and this new constant-percentage case - both now resolve correctly.
    /// If the raw cell exceeds the ceiling, this value is left NULL and a warning is appended
    /// rather than storing a guess.</summary>
    private const decimal GstFractionMax = 0.30m;

    private static decimal? CellGstFraction(IXLWorksheet ws, int row, int col, decimal? rate, string? labourCode, List<string> warnings)
    {
        if (col < 1) return null;
        var cell = ws.Cell(row, col);
        if (cell.IsEmpty()) return null;

        decimal raw;
        if (cell.DataType == XLDataType.Number) raw = (decimal)cell.GetDouble();
        else
        {
            var s = cell.GetString().Trim().TrimEnd('%');
            if (s.Length == 0 || !decimal.TryParse(s, out raw)) return null;
        }

        if (raw <= GstFractionMax) return raw; // already a plausible fraction - unchanged from SECTION 154

        // SECTION 178: try "plain percentage number" first (18 -> 0.18) - this is what the real
        // Partwise file uses, and it's the more common/likely format for a hand-maintained sheet.
        var asPercent = raw / 100m;
        if (asPercent <= GstFractionMax) return asPercent;

        // Fall back to SECTION 154's original "Rate-scaled rupee amount" recovery (e.g. a formula
        // cell computing Rate * true%) - only reached if the percent interpretation above wasn't
        // plausible.
        if (rate is > 0)
        {
            var recoveredFromRate = raw / rate.Value;
            if (recoveredFromRate <= GstFractionMax) return recoveredFromRate;
        }

        warnings.Add($"Row \"{labourCode}\": a GST column read {raw}, which isn't a plausible tax rate " +
                     "as a percentage (÷100) or after dividing by the Labour Rate - left blank rather than " +
                     "guessed. Please check this row's IGST/CGST/SGST cells in the source file.");
        return null;
    }


    private static int? CellInt(IXLWorksheet ws, int row, int col)
    {
        if (col < 1) return null;
        var cell = ws.Cell(row, col);
        if (cell.IsEmpty()) return null;
        if (cell.DataType == XLDataType.Number) return (int)Math.Round(cell.GetDouble());
        var s = cell.GetString().Trim();
        return s.Length > 0 && int.TryParse(s, out var i) ? i : null;
    }

    /// <summary>Case-insensitive natural key so "SF0RUV1M001"/"sf0ruv1m001" and "RUV 350 max"/
    /// "ruv 350 MAX" match as the same row on re-import - trimmed, upper-cased, joined with a
    /// separator that can't appear in any of the source values.</summary>
    private static string BuildKey(params string?[] parts) =>
        string.Join("␟", parts.Select(p => (p ?? "").Trim().ToUpperInvariant()));

    // ---------------------------------------------------------------------------------
    // Import (upsert): existing key -> update only the fields that actually changed;
    // unseen key -> insert; identical row -> left alone entirely (no UpdatedDate churn).
    // "duplicate data dont add update same data and dont override this data" - this is what
    // implements all three of those: no duplicate rows for the same LabourCode/Model/Tier (or
    // PartCode/LabourCode/Model/Tier), a changed rate/GST/category is applied as an UPDATE to
    // the same row rather than a second insert, and a re-import of unchanged rows is a true
    // no-op (CreatedBy/CreatedDate/UpdatedBy/UpdatedDate all stay exactly as they were).
    // ---------------------------------------------------------------------------------

    public async Task<LabourMasterImportResult> ImportWithoutPartwiseAsync(Stream excelStream, DateOnly effectiveDate, string? actor, CancellationToken ct = default)
    {
        using var workbook = new XLWorkbook(excelStream);
        var ws = workbook.Worksheets.First();
        var headerMap = BuildHeaderMap(ws);

        var colLabourCode = FindCol(headerMap, "Labor Code", "Labour Code");
        var colJobDesc = FindCol(headerMap, "Job Descriptions", "Job Description");
        var colModel = FindCol(headerMap, "Model");
        var colRate = FindCol(headerMap, "Labour Rate", "Labor Rate");
        var colIgst = FindCol(headerMap, "IGST");
        var colCgst = FindCol(headerMap, "CGST");
        var colSgst = FindCol(headerMap, "SGST");
        var colTier = FindCol(headerMap, "Tier");
        var colCategory = FindCol(headerMap, "Categeory", "Category");

        var warnings = new List<string>();
        if (colLabourCode < 0)
        {
            warnings.Add("Could not find a 'Labor Code' column - every row was skipped.");
            return new LabourMasterImportResult(0, 0, 0, 0, 0, warnings);
        }

        var lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;

        // Preload every existing row's key -> (Id, current values) in ONE round trip, rather
        // than one SELECT per Excel row - the same "batch, don't loop queries" approach
        // DmsBaplDataService.GetRepairBillsAsync uses for its child rows.
        var existing = new Dictionary<string, (int Id, string? JobDescription, string? Model, decimal? LabourRate, decimal? Igst, decimal? Cgst, decimal? Sgst, int? Tier, string? Category, DateOnly? EffectiveDate)>();
        await using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync(ct);
            await using (var cmd = new SqlCommand("SELECT Id, LabourCode, JobDescription, Model, LabourRate, Igst, Cgst, Sgst, Tier, Category, EffectiveDate FROM [dbo].[LabourMasterWithoutPartwise]", conn) { CommandTimeout = 30 })
            await using (var rdr = await cmd.ExecuteReaderAsync(ct))
            {
                while (await rdr.ReadAsync(ct))
                {
                    var key = BuildKey(rdr["LabourCode"] as string, rdr["Model"] as string, (rdr["Tier"] as int?)?.ToString());
                    existing[key] = (
                        (int)rdr["Id"], rdr["JobDescription"] as string, rdr["Model"] as string,
                        rdr["LabourRate"] as decimal?, rdr["Igst"] as decimal?, rdr["Cgst"] as decimal?, rdr["Sgst"] as decimal?,
                        rdr["Tier"] as int?, rdr["Category"] as string,
                        rdr["EffectiveDate"] is DateTime ed ? DateOnly.FromDateTime(ed) : null);
                }
            }

            int inserted = 0, updated = 0, unchanged = 0, skipped = 0, total = 0;
            await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);
            try
            {
                for (var r = 2; r <= lastRow; r++)
                {
                    var labourCode = CellText(ws, r, colLabourCode);
                    if (string.IsNullOrWhiteSpace(labourCode))
                    {
                        // A fully blank row (or a stray Sr.-only row) - not counted as a data row.
                        var anyOther = new[] { colJobDesc, colModel, colRate }.Any(c => !string.IsNullOrWhiteSpace(CellText(ws, r, c)));
                        if (anyOther) skipped++;
                        continue;
                    }
                    total++;

                    var jobDesc = CellText(ws, r, colJobDesc);
                    var model = CellText(ws, r, colModel);
                    var rate = CellDecimal(ws, r, colRate);
                    // 2026-09-29 (SECTION 154): was CellDecimal(ws, r, colIgst/colCgst/colSgst) -
                    // see class doc comment and CellGstFraction's own doc comment above.
                    var igst = CellGstFraction(ws, r, colIgst, rate, labourCode, warnings);
                    var cgst = CellGstFraction(ws, r, colCgst, rate, labourCode, warnings);
                    var sgst = CellGstFraction(ws, r, colSgst, rate, labourCode, warnings);
                    var tier = CellInt(ws, r, colTier);
                    var category = CellText(ws, r, colCategory);

                    var key = BuildKey(labourCode, model, tier?.ToString());
                    if (existing.TryGetValue(key, out var ex))
                    {
                        var changed = ex.JobDescription != jobDesc || ex.Model != model || ex.LabourRate != rate
                            || ex.Igst != igst || ex.Cgst != cgst || ex.Sgst != sgst || ex.Category != category
                            || ex.EffectiveDate != effectiveDate;
                        if (!changed) { unchanged++; continue; }

                        await using var upd = new SqlCommand(@"
                            UPDATE [dbo].[LabourMasterWithoutPartwise]
                            SET JobDescription=@jd, Model=@model, LabourRate=@rate, Igst=@igst, Cgst=@cgst,
                                Sgst=@sgst, Category=@cat, EffectiveDate=@eff, UpdatedBy=@by, UpdatedDate=SYSUTCDATETIME()
                            WHERE Id=@id", conn, tx) { CommandTimeout = 30 };
                        upd.Parameters.AddWithValue("@jd", (object?)jobDesc ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@model", (object?)model ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@rate", (object?)rate ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@igst", (object?)igst ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@cgst", (object?)cgst ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@sgst", (object?)sgst ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@cat", (object?)category ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@eff", effectiveDate.ToDateTime(TimeOnly.MinValue));
                        upd.Parameters.AddWithValue("@by", (object?)actor ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@id", ex.Id);
                        await upd.ExecuteNonQueryAsync(ct);
                        updated++;
                    }
                    else
                    {
                        await using var ins = new SqlCommand(@"
                            INSERT INTO [dbo].[LabourMasterWithoutPartwise]
                                (LabourCode, JobDescription, Model, LabourRate, Igst, Cgst, Sgst, Tier, Category, EffectiveDate, IsActive, CreatedBy, CreatedDate)
                            VALUES (@code, @jd, @model, @rate, @igst, @cgst, @sgst, @tier, @cat, @eff, 1, @by, SYSUTCDATETIME())", conn, tx) { CommandTimeout = 30 };
                        ins.Parameters.AddWithValue("@code", labourCode);
                        ins.Parameters.AddWithValue("@jd", (object?)jobDesc ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@model", (object?)model ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@rate", (object?)rate ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@igst", (object?)igst ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@cgst", (object?)cgst ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@sgst", (object?)sgst ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@tier", (object?)tier ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@cat", (object?)category ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@eff", effectiveDate.ToDateTime(TimeOnly.MinValue));
                        ins.Parameters.AddWithValue("@by", (object?)actor ?? DBNull.Value);
                        await ins.ExecuteNonQueryAsync(ct);
                        inserted++;
                        // Guard against two identical rows WITHIN the same file - the second one
                        // now updates the first's freshly-inserted row instead of inserting again.
                        existing[key] = (0, jobDesc, model, rate, igst, cgst, sgst, tier, category, effectiveDate);
                    }
                }
                await tx.CommitAsync(ct);
                return new LabourMasterImportResult(total, inserted, updated, unchanged, skipped, warnings);
            }
            catch (Exception ex)
            {
                await tx.RollbackAsync(ct);
                throw new InvalidOperationException($"Import failed partway through and was rolled back - no rows were changed: {ex.Message}", ex);
            }
        }
    }

    public async Task<LabourMasterImportResult> ImportPartwiseAsync(Stream excelStream, DateOnly effectiveDate, string? actor, CancellationToken ct = default)
    {
        using var workbook = new XLWorkbook(excelStream);
        var ws = workbook.Worksheets.First();
        var headerMap = BuildHeaderMap(ws);

        var colPartCode = FindCol(headerMap, "Part Code");
        var colPartName = FindCol(headerMap, "Part Name");
        var colLabourCode = FindCol(headerMap, "Labor Code", "Labour Code");
        var colJobDesc = FindCol(headerMap, "Job Descriptions", "Job Description");
        var colModel = FindCol(headerMap, "Model");
        var colRate = FindCol(headerMap, "Labour Rate", "Labor Rate");
        var colIgst = FindCol(headerMap, "IGST");
        var colCgst = FindCol(headerMap, "CGST");
        var colSgst = FindCol(headerMap, "SGST");
        var colTier = FindCol(headerMap, "Tier");
        var colCategory = FindCol(headerMap, "Categeory", "Category");

        var warnings = new List<string>();
        if (colLabourCode < 0)
        {
            warnings.Add("Could not find a 'Labor Code' column - every row was skipped.");
            return new LabourMasterImportResult(0, 0, 0, 0, 0, warnings);
        }
        if (colPartCode < 0) warnings.Add("Could not find a 'Part Code' column - rows were imported with a blank Part Code.");

        var lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;

        var existing = new Dictionary<string, (int Id, string? PartName, string? JobDescription, string? Model, decimal? LabourRate, decimal? Igst, decimal? Cgst, decimal? Sgst, int? Tier, string? Category, DateOnly? EffectiveDate)>();
        await using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync(ct);
            await using (var cmd = new SqlCommand("SELECT Id, PartCode, PartName, LabourCode, JobDescription, Model, LabourRate, Igst, Cgst, Sgst, Tier, Category, EffectiveDate FROM [dbo].[LabourMasterPartwise]", conn) { CommandTimeout = 30 })
            await using (var rdr = await cmd.ExecuteReaderAsync(ct))
            {
                while (await rdr.ReadAsync(ct))
                {
                    var key = BuildKey(rdr["PartCode"] as string, rdr["LabourCode"] as string, rdr["Model"] as string, (rdr["Tier"] as int?)?.ToString());
                    existing[key] = (
                        (int)rdr["Id"], rdr["PartName"] as string, rdr["JobDescription"] as string, rdr["Model"] as string,
                        rdr["LabourRate"] as decimal?, rdr["Igst"] as decimal?, rdr["Cgst"] as decimal?, rdr["Sgst"] as decimal?,
                        rdr["Tier"] as int?, rdr["Category"] as string,
                        rdr["EffectiveDate"] is DateTime ed ? DateOnly.FromDateTime(ed) : null);
                }
            }

            int inserted = 0, updated = 0, unchanged = 0, skipped = 0, total = 0;
            await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);
            try
            {
                for (var r = 2; r <= lastRow; r++)
                {
                    var labourCode = CellText(ws, r, colLabourCode);
                    var partCode = CellText(ws, r, colPartCode);
                    if (string.IsNullOrWhiteSpace(labourCode))
                    {
                        var anyOther = new[] { colPartCode, colJobDesc, colModel, colRate }.Any(c => !string.IsNullOrWhiteSpace(CellText(ws, r, c)));
                        if (anyOther) skipped++;
                        continue;
                    }
                    total++;

                    var partName = CellText(ws, r, colPartName);
                    var jobDesc = CellText(ws, r, colJobDesc);
                    var model = CellText(ws, r, colModel);
                    var rate = CellDecimal(ws, r, colRate);
                    // 2026-09-29 (SECTION 154): was CellDecimal(ws, r, colIgst/colCgst/colSgst) -
                    // see class doc comment and CellGstFraction's own doc comment above.
                    var igst = CellGstFraction(ws, r, colIgst, rate, labourCode, warnings);
                    var cgst = CellGstFraction(ws, r, colCgst, rate, labourCode, warnings);
                    var sgst = CellGstFraction(ws, r, colSgst, rate, labourCode, warnings);
                    var tier = CellInt(ws, r, colTier);
                    var category = CellText(ws, r, colCategory);

                    var key = BuildKey(partCode, labourCode, model, tier?.ToString());
                    if (existing.TryGetValue(key, out var ex))
                    {
                        var changed = ex.PartName != partName || ex.JobDescription != jobDesc || ex.Model != model
                            || ex.LabourRate != rate || ex.Igst != igst || ex.Cgst != cgst || ex.Sgst != sgst
                            || ex.Category != category || ex.EffectiveDate != effectiveDate;
                        if (!changed) { unchanged++; continue; }

                        await using var upd = new SqlCommand(@"
                            UPDATE [dbo].[LabourMasterPartwise]
                            SET PartName=@pn, JobDescription=@jd, Model=@model, LabourRate=@rate, Igst=@igst,
                                Cgst=@cgst, Sgst=@sgst, Category=@cat, EffectiveDate=@eff, UpdatedBy=@by, UpdatedDate=SYSUTCDATETIME()
                            WHERE Id=@id", conn, tx) { CommandTimeout = 30 };
                        upd.Parameters.AddWithValue("@pn", (object?)partName ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@jd", (object?)jobDesc ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@model", (object?)model ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@rate", (object?)rate ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@igst", (object?)igst ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@cgst", (object?)cgst ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@sgst", (object?)sgst ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@cat", (object?)category ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@eff", effectiveDate.ToDateTime(TimeOnly.MinValue));
                        upd.Parameters.AddWithValue("@by", (object?)actor ?? DBNull.Value);
                        upd.Parameters.AddWithValue("@id", ex.Id);
                        await upd.ExecuteNonQueryAsync(ct);
                        updated++;
                    }
                    else
                    {
                        await using var ins = new SqlCommand(@"
                            INSERT INTO [dbo].[LabourMasterPartwise]
                                (PartCode, PartName, LabourCode, JobDescription, Model, LabourRate, Igst, Cgst, Sgst, Tier, Category, EffectiveDate, IsActive, CreatedBy, CreatedDate)
                            VALUES (@partCode, @pn, @code, @jd, @model, @rate, @igst, @cgst, @sgst, @tier, @cat, @eff, 1, @by, SYSUTCDATETIME())", conn, tx) { CommandTimeout = 30 };
                        ins.Parameters.AddWithValue("@partCode", (object?)partCode ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@pn", (object?)partName ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@code", labourCode);
                        ins.Parameters.AddWithValue("@jd", (object?)jobDesc ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@model", (object?)model ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@rate", (object?)rate ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@igst", (object?)igst ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@cgst", (object?)cgst ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@sgst", (object?)sgst ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@tier", (object?)tier ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@cat", (object?)category ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@eff", effectiveDate.ToDateTime(TimeOnly.MinValue));
                        ins.Parameters.AddWithValue("@by", (object?)actor ?? DBNull.Value);
                        await ins.ExecuteNonQueryAsync(ct);
                        inserted++;
                        existing[key] = (0, partName, jobDesc, model, rate, igst, cgst, sgst, tier, category, effectiveDate);
                    }
                }
                await tx.CommitAsync(ct);
                return new LabourMasterImportResult(total, inserted, updated, unchanged, skipped, warnings);
            }
            catch (Exception ex)
            {
                await tx.RollbackAsync(ct);
                throw new InvalidOperationException($"Import failed partway through and was rolled back - no rows were changed: {ex.Message}", ex);
            }
        }
    }

    // ---------------------------------------------------------------------------------
    // Manual edit / delete (the grid's own Edit/Delete buttons, independent of import) -
    // UNCHANGED by SECTION 154: these take Igst/Cgst/Sgst as already-typed fractions straight
    // from the Edit modal's own "IGST (fraction, e.g. 0.18 = 18%)" input, not parsed from Excel,
    // so the CellGstFraction heuristic above does not apply here - the value you type is stored
    // exactly as typed, same as before this fix.
    // ---------------------------------------------------------------------------------

    public async Task<LabourMasterWithoutPartwiseRow?> UpdateWithoutPartwiseAsync(int id, LabourMasterWithoutPartwiseUpdate u, string? actor, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(ConnStr);
        await conn.OpenAsync(ct);
        await using (var cmd = new SqlCommand(@"
            UPDATE [dbo].[LabourMasterWithoutPartwise]
            SET JobDescription=@jd, Model=@model, LabourRate=@rate, Igst=@igst, Cgst=@cgst, Sgst=@sgst,
                Tier=@tier, Category=@cat, EffectiveDate=@eff, IsActive=@active, UpdatedBy=@by, UpdatedDate=SYSUTCDATETIME()
            WHERE Id=@id", conn) { CommandTimeout = 30 })
        {
            cmd.Parameters.AddWithValue("@jd", (object?)u.JobDescription ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@model", (object?)u.Model ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@rate", (object?)u.LabourRate ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@igst", (object?)u.Igst ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@cgst", (object?)u.Cgst ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@sgst", (object?)u.Sgst ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@tier", (object?)u.Tier ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@cat", (object?)u.Category ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@eff", u.EffectiveDate.HasValue ? u.EffectiveDate.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value);
            cmd.Parameters.AddWithValue("@active", u.IsActive);
            cmd.Parameters.AddWithValue("@by", (object?)actor ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@id", id);
            var affected = await cmd.ExecuteNonQueryAsync(ct);
            if (affected == 0) return null;
        }

        await using var sel = new SqlCommand(@"
            SELECT Id, LabourCode, JobDescription, Model, LabourRate, Igst, Cgst, Sgst, Tier, Category,
                   EffectiveDate, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
            FROM [dbo].[LabourMasterWithoutPartwise] WHERE Id=@id", conn) { CommandTimeout = 30 };
        sel.Parameters.AddWithValue("@id", id);
        await using var rdr = await sel.ExecuteReaderAsync(ct);
        return await rdr.ReadAsync(ct) ? ReadWithoutPartwiseRow(rdr) : null;
    }

    public async Task<LabourMasterPartwiseRow?> UpdatePartwiseAsync(int id, LabourMasterPartwiseUpdate u, string? actor, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(ConnStr);
        await conn.OpenAsync(ct);
        await using (var cmd = new SqlCommand(@"
            UPDATE [dbo].[LabourMasterPartwise]
            SET PartName=@pn, JobDescription=@jd, Model=@model, LabourRate=@rate, Igst=@igst, Cgst=@cgst,
                Sgst=@sgst, Tier=@tier, Category=@cat, EffectiveDate=@eff, IsActive=@active, UpdatedBy=@by, UpdatedDate=SYSUTCDATETIME()
            WHERE Id=@id", conn) { CommandTimeout = 30 })
        {
            cmd.Parameters.AddWithValue("@pn", (object?)u.PartName ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@jd", (object?)u.JobDescription ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@model", (object?)u.Model ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@rate", (object?)u.LabourRate ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@igst", (object?)u.Igst ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@cgst", (object?)u.Cgst ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@sgst", (object?)u.Sgst ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@tier", (object?)u.Tier ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@cat", (object?)u.Category ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@eff", u.EffectiveDate.HasValue ? u.EffectiveDate.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value);
            cmd.Parameters.AddWithValue("@active", u.IsActive);
            cmd.Parameters.AddWithValue("@by", (object?)actor ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@id", id);
            var affected = await cmd.ExecuteNonQueryAsync(ct);
            if (affected == 0) return null;
        }

        await using var sel = new SqlCommand(@"
            SELECT Id, PartCode, PartName, LabourCode, JobDescription, Model, LabourRate, Igst, Cgst,
                   Sgst, Tier, Category, EffectiveDate, IsActive, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
            FROM [dbo].[LabourMasterPartwise] WHERE Id=@id", conn) { CommandTimeout = 30 };
        sel.Parameters.AddWithValue("@id", id);
        await using var rdr = await sel.ExecuteReaderAsync(ct);
        return await rdr.ReadAsync(ct) ? ReadPartwiseRow(rdr) : null;
    }

    public async Task<bool> DeleteWithoutPartwiseAsync(int id, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(ConnStr);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand("DELETE FROM [dbo].[LabourMasterWithoutPartwise] WHERE Id=@id", conn) { CommandTimeout = 30 };
        cmd.Parameters.AddWithValue("@id", id);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    public async Task<bool> DeletePartwiseAsync(int id, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(ConnStr);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand("DELETE FROM [dbo].[LabourMasterPartwise] WHERE Id=@id", conn) { CommandTimeout = 30 };
        cmd.Parameters.AddWithValue("@id", id);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }
}
