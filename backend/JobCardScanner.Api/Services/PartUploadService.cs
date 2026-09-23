using ClosedXML.Excel;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services;

// =====================================================================================
// 2026-09-21 "Part Upload" tab - see Models/PartUploads.cs's doc comment for the confirmed Excel
// column layout, why this writes to JobCardScannerDb (not DMS), and why Location+Date are now
// required inputs on the upload form itself (2026-09-21 correction) rather than parsed from the
// file. Column-detection/parsing helpers below mirror LabourMasterImportService.cs's own
// (case/space/punctuation-insensitive header match, raw-numeric-first cell reads) for the same
// reasons documented there, adapted from raw ADO.NET to EF Core since this table lives in
// JobCardScannerDb, where every other *Docs table already has a DbContext.
// =====================================================================================

public record PartUploadImportResult(int TotalDataRows, int Inserted, int Updated, int Unchanged, int SkippedBlank, IReadOnlyList<string> Warnings);

/// <summary>Editable fields for one uploaded part row (the grid's own Edit button) - matches the
/// columns actually shown in the grid (Part No/Location/Report Date/upload metadata are not
/// editable here: Part No and Location are the row's identity, Report Date and upload metadata
/// are provenance, not part data).</summary>
public record PartUploadUpdate(
    string? Description, decimal? BalQty, decimal? BalAmnt, decimal? BillPrice,
    decimal? QtyReqd, decimal? MinOrder, string? HsnSacCode, string? GroupName, string? ItemType);

public interface IPartUploadService
{
    Task<IReadOnlyList<PartUpload>> GetAsync(Guid dealerId, string? locationCode, string? search, CancellationToken ct = default);
    Task<PartUploadImportResult> ImportAsync(Stream excelStream, Guid dealerId, string locationCode, DateOnly reportDate, string fileName, string? actor, CancellationToken ct = default);
    Task<PartUpload?> UpdateAsync(Guid id, Guid dealerId, PartUploadUpdate update, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, Guid dealerId, CancellationToken ct = default);
}

public class PartUploadService : IPartUploadService
{
    private readonly JobCardScannerDbContext _db;

    public PartUploadService(JobCardScannerDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<PartUpload>> GetAsync(Guid dealerId, string? locationCode, string? search, CancellationToken ct = default)
    {
        var query = _db.PartUploads.AsNoTracking().Where(p => p.DealerId == dealerId);
        if (!string.IsNullOrWhiteSpace(locationCode))
            query = query.Where(p => p.LocationCode == locationCode.Trim());
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            query = query.Where(p => p.PartNo.Contains(s) || (p.Description != null && p.Description.Contains(s)) || (p.HsnSacCode != null && p.HsnSacCode.Contains(s)));
        }
        var rows = await query.OrderBy(p => p.PartNo).Take(2000).ToListAsync(ct);
        if (rows.Count > 0) await AttachMtTransferQtyAsync(rows, dealerId, ct);
        return rows;
    }

    /// <summary>2026-09-22 ("after Bal Qty column add MT Transfer Qty column for maintaining how
    /// much qty was transfered"): populates PartUpload.MtTransferQty (a computed, [NotMapped]
    /// field - see its own doc comment in Models/PartUploads.cs for the exact match key and why
    /// Cancelled transfer docs are deliberately included in the sum) for a page of already-loaded
    /// rows. Grouped in one query rather than per-row to avoid an N+1 for a 2000-row page.</summary>
    private async Task AttachMtTransferQtyAsync(IReadOnlyList<PartUpload> rows, Guid dealerId, CancellationToken ct)
    {
        var partNos = rows.Select(r => r.PartNo).Distinct().ToList();
        var items = await _db.MaterialTransferDocItems.AsNoTracking()
            .Where(i => i.MaterialTransferDoc!.DealerId == dealerId && partNos.Contains(i.ItemCode))
            .Select(i => new { i.ItemCode, i.MaterialTransferDoc!.Location, i.Qty })
            .ToListAsync(ct);

        // Same match key as MaterialTransferDocsController.Create's own partUploadCache lookup
        // (ItemCode == PartNo, doc.Location == LocationCode, raw string equality - no
        // trim/case-fold, matching that existing lookup exactly so the two stay consistent).
        var totals = items
            .GroupBy(i => (i.ItemCode, Location: i.Location ?? string.Empty))
            .ToDictionary(g => g.Key, g => (decimal)g.Sum(i => i.Qty));

        foreach (var row in rows)
            row.MtTransferQty = totals.TryGetValue((row.PartNo, row.LocationCode), out var qty) ? qty : 0m;
    }

    public async Task<PartUpload?> UpdateAsync(Guid id, Guid dealerId, PartUploadUpdate u, CancellationToken ct = default)
    {
        var row = await _db.PartUploads.FirstOrDefaultAsync(p => p.Id == id && p.DealerId == dealerId, ct);
        if (row is null) return null;
        row.Description = u.Description;
        row.BalQty = u.BalQty;
        row.BalAmnt = u.BalAmnt;
        row.BillPrice = u.BillPrice;
        row.QtyReqd = u.QtyReqd;
        row.MinOrder = u.MinOrder;
        row.HsnSacCode = u.HsnSacCode;
        row.GroupName = u.GroupName;
        row.ItemType = u.ItemType;
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return row;
    }

    public async Task<bool> DeleteAsync(Guid id, Guid dealerId, CancellationToken ct = default)
    {
        var row = await _db.PartUploads.FirstOrDefaultAsync(p => p.Id == id && p.DealerId == dealerId, ct);
        if (row is null) return false;
        _db.PartUploads.Remove(row);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    // ---------------------------------------------------------------------------------
    // Excel parsing helpers (same forgiving approach as LabourMasterImportService.cs)
    // ---------------------------------------------------------------------------------

    private static string Normalize(string s) => s.Trim().ToLowerInvariant().Replace(".", "").Replace("_", " ").Replace("  ", " ");

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

    private static decimal? CellDecimal(IXLWorksheet ws, int row, int col)
    {
        if (col < 1) return null;
        var cell = ws.Cell(row, col);
        if (cell.IsEmpty()) return null;
        if (cell.DataType == XLDataType.Number) return (decimal)cell.GetDouble();
        var s = cell.GetString().Trim().TrimEnd('%');
        return s.Length > 0 && decimal.TryParse(s, out var d) ? d : null;
    }

    public async Task<PartUploadImportResult> ImportAsync(Stream excelStream, Guid dealerId, string locationCode, DateOnly reportDate, string fileName, string? actor, CancellationToken ct = default)
    {
        locationCode = locationCode.Trim();
        using var workbook = new XLWorkbook(excelStream);
        var ws = workbook.Worksheets.First();
        var headerMap = BuildHeaderMap(ws);

        var colPartNo = FindCol(headerMap, "Part_No", "Part No", "PartNo");
        var colDesc = FindCol(headerMap, "Description");
        var colOpenBal = FindCol(headerMap, "OpenBal");
        var colPurchase = FindCol(headerMap, "Purchase");
        var colReceipt = FindCol(headerMap, "Receipt");
        var colPPurChln = FindCol(headerMap, "PPurChln");
        var colTotal = FindCol(headerMap, "Total");
        var colSale = FindCol(headerMap, "Sale");
        var colBrIss = FindCol(headerMap, "BrIss");
        var colMtrlIss = FindCol(headerMap, "MtrlIss");
        var colStAdj = FindCol(headerMap, "StAdj");
        var colPartsChln = FindCol(headerMap, "PartsChln");
        var colPurReturn = FindCol(headerMap, "PurReturn");
        var colSaleReturn = FindCol(headerMap, "SaleReturn");
        var colSaleChln = FindCol(headerMap, "SaleChln");
        var colBalQty = FindCol(headerMap, "BalQty");
        var colBalAmnt = FindCol(headerMap, "BalAmnt");
        var colQtyReqd = FindCol(headerMap, "QtyReqd");
        var colMinOrder = FindCol(headerMap, "MinOrder");
        var colBillPrice = FindCol(headerMap, "BillPrice");
        var colHsn = FindCol(headerMap, "HSNSAC_Code", "HSNSAC Code", "HSN SAC Code", "HSN Code");
        var colGroup = FindCol(headerMap, "Group Name", "GroupName");
        var colItemType = FindCol(headerMap, "Item Type", "ItemType");

        var warnings = new List<string>();
        if (colPartNo < 0)
        {
            warnings.Add("Could not find a 'Part_No' column - every row was skipped.");
            return new PartUploadImportResult(0, 0, 0, 0, 0, warnings);
        }

        var lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;

        // Upsert key is (LocationCode, PartNo) WITHIN this dealer - a part's stock genuinely
        // differs by location, same as DMS's own PartsInventory, so only rows already uploaded for
        // THIS location are candidates for update; a part uploaded before for a different location
        // is left alone and this upload adds its own row for the new location.
        var existing = await _db.PartUploads
            .Where(p => p.DealerId == dealerId && p.LocationCode == locationCode)
            .ToDictionaryAsync(p => p.PartNo.Trim().ToUpperInvariant(), ct);

        int inserted = 0, updated = 0, unchanged = 0, skipped = 0, total = 0;
        for (var r = 2; r <= lastRow; r++)
        {
            var partNo = CellText(ws, r, colPartNo);
            if (string.IsNullOrWhiteSpace(partNo))
            {
                var anyOther = new[] { colDesc, colBalQty, colBillPrice }.Any(c => !string.IsNullOrWhiteSpace(CellText(ws, r, c)));
                if (anyOther) skipped++;
                continue;
            }
            total++;

            var desc = CellText(ws, r, colDesc);
            var openBal = CellDecimal(ws, r, colOpenBal);
            var purchase = CellDecimal(ws, r, colPurchase);
            var receipt = CellDecimal(ws, r, colReceipt);
            var pPurChln = CellDecimal(ws, r, colPPurChln);
            var totalCol = CellDecimal(ws, r, colTotal);
            var sale = CellDecimal(ws, r, colSale);
            var brIss = CellDecimal(ws, r, colBrIss);
            var mtrlIss = CellDecimal(ws, r, colMtrlIss);
            var stAdj = CellDecimal(ws, r, colStAdj);
            var partsChln = CellDecimal(ws, r, colPartsChln);
            var purReturn = CellDecimal(ws, r, colPurReturn);
            var saleReturn = CellDecimal(ws, r, colSaleReturn);
            var saleChln = CellDecimal(ws, r, colSaleChln);
            var balQty = CellDecimal(ws, r, colBalQty);
            var balAmnt = CellDecimal(ws, r, colBalAmnt);
            var qtyReqd = CellDecimal(ws, r, colQtyReqd);
            var minOrder = CellDecimal(ws, r, colMinOrder);
            var billPrice = CellDecimal(ws, r, colBillPrice);
            var hsn = CellText(ws, r, colHsn);
            var group = CellText(ws, r, colGroup);
            var itemType = CellText(ws, r, colItemType);

            var key = partNo.Trim().ToUpperInvariant();
            if (existing.TryGetValue(key, out var row))
            {
                var changed = row.Description != desc || row.OpenBal != openBal || row.Purchase != purchase || row.Receipt != receipt
                    || row.PPurChln != pPurChln || row.Total != totalCol || row.Sale != sale || row.BrIss != brIss || row.MtrlIss != mtrlIss
                    || row.StAdj != stAdj || row.PartsChln != partsChln || row.PurReturn != purReturn || row.SaleReturn != saleReturn
                    || row.SaleChln != saleChln || row.BalQty != balQty || row.BalAmnt != balAmnt || row.QtyReqd != qtyReqd
                    || row.MinOrder != minOrder || row.BillPrice != billPrice || row.HsnSacCode != hsn || row.GroupName != group
                    || row.ItemType != itemType || row.ReportDate != reportDate;
                if (!changed) { unchanged++; continue; }

                row.Description = desc; row.OpenBal = openBal; row.Purchase = purchase; row.Receipt = receipt;
                row.PPurChln = pPurChln; row.Total = totalCol; row.Sale = sale; row.BrIss = brIss; row.MtrlIss = mtrlIss;
                row.StAdj = stAdj; row.PartsChln = partsChln; row.PurReturn = purReturn; row.SaleReturn = saleReturn;
                row.SaleChln = saleChln; row.BalQty = balQty; row.BalAmnt = balAmnt; row.QtyReqd = qtyReqd;
                row.MinOrder = minOrder; row.BillPrice = billPrice; row.HsnSacCode = hsn; row.GroupName = group; row.ItemType = itemType;
                row.ReportDate = reportDate; row.SourceFileName = fileName; row.UploadedBy = actor; row.UpdatedAt = DateTime.UtcNow;
                updated++;
            }
            else
            {
                var newRow = new PartUpload
                {
                    DealerId = dealerId, LocationCode = locationCode, ReportDate = reportDate,
                    PartNo = partNo, Description = desc,
                    OpenBal = openBal, Purchase = purchase, Receipt = receipt, PPurChln = pPurChln, Total = totalCol,
                    Sale = sale, BrIss = brIss, MtrlIss = mtrlIss, StAdj = stAdj, PartsChln = partsChln,
                    PurReturn = purReturn, SaleReturn = saleReturn, SaleChln = saleChln, BalQty = balQty, BalAmnt = balAmnt,
                    QtyReqd = qtyReqd, MinOrder = minOrder, BillPrice = billPrice, HsnSacCode = hsn, GroupName = group,
                    ItemType = itemType, SourceFileName = fileName, UploadedBy = actor,
                };
                _db.PartUploads.Add(newRow);
                existing[key] = newRow; // guards against two identical PartNo rows within the same file
                inserted++;
            }
        }

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            throw new InvalidOperationException($"Import failed partway through and was rolled back - no rows were changed: {ex.Message}", ex);
        }

        return new PartUploadImportResult(total, inserted, updated, unchanged, skipped, warnings);
    }
}
