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
    /// to text parsing only for a cell ClosedXML sees as text (e.g. "1" typed as text, not a number).</summary>
    private static decimal? CellDecimal(IXLWorksheet ws, int row, int col)
    {
        if (col < 1) return null;
        var cell = ws.Cell(row, col);
        if (cell.IsEmpty()) return null;
        if (cell.DataType == XLDataType.Number) return (decimal)cell.GetDouble();
        var s = cell.GetString().Trim().TrimEnd('%');
        return s.Length > 0 && decimal.TryParse(s, out var d) ? d : null;
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
                    var igst = CellDecimal(ws, r, colIgst);
                    var cgst = CellDecimal(ws, r, colCgst);
                    var sgst = CellDecimal(ws, r, colSgst);
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
                    var igst = CellDecimal(ws, r, colIgst);
                    var cgst = CellDecimal(ws, r, colCgst);
                    var sgst = CellDecimal(ws, r, colSgst);
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
    // Manual edit / delete (the grid's own Edit/Delete buttons, independent of import)
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
