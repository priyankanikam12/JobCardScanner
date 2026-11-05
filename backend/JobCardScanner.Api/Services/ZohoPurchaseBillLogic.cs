using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace JobCardScanner.Api.Services;

public sealed class PurchaseBillLineIn
{
    public string? LineItemId { get; set; } public string? ItemCode { get; set; } public string? ItemName { get; set; } public string? HsnCode { get; set; } public string? Unit { get; set; }
    public decimal? Quantity { get; set; } public decimal? Rate { get; set; } public decimal? Discount { get; set; }
    public string? TaxName { get; set; } public decimal? TaxPercentage { get; set; } public decimal? TaxAmount { get; set; } public decimal? LineTotal { get; set; }
}

public sealed class PurchaseBillIn
{
    public string? Event { get; set; } public string? BillId { get; set; } public string? BillNumber { get; set; } public string? BillDate { get; set; } public string? Status { get; set; }
    public string? ReferenceNumber { get; set; } public string? VendorId { get; set; } public string? VendorName { get; set; } public string? VendorGstin { get; set; }
    public string? SourceOfSupply { get; set; } public string? DestinationOfSupply { get; set; } public string? LocationId { get; set; } public string? LocationName { get; set; } public string? DealerCode { get; set; }
    public decimal? SubTotal { get; set; } public decimal? TaxTotal { get; set; } public decimal? Total { get; set; }
    public List<PurchaseBillLineIn>? Lines { get; set; }
}

public enum PurchaseBillAction { Create, Update, Duplicate, Void, VoidAgain, RejectEditOfVoided }
public sealed record ExistingPurchaseBill(string PayloadHash, bool IsVoided);

/// <summary>
/// 2026-11-04 (Learnall, "BGauss DMS - Zoho Books: Purchase Bills and Location IDs"): the rules for POST /api/zoho-purchase-bills. Zoho Books sends a purchase bill each time it is saved (bill.created), edited (bill.updated) or voided
/// (bill.voided), with ALL lines every time. billId (Zoho's own id) is the unique key. DMS: created -> record the bill and ADD the line quantities to the stock of the dealer's location (PartUploads.BalQty, the stock the repair
/// bills and material transfers already reduce); updated -> replace the bill and apply only the DIFFERENCE to stock; voided -> reverse the stock; the same event twice -> the second is "already processed".
/// Pure logic (no database, no HTTP) so every rule can be tested. A part that has no PartUploads row at that location is NOT added to stock (the row's other columns are not known to this code): it is recorded as "not applied" and reported.
/// </summary>
public static class PurchaseBillRules
{
    public static readonly string[] Events = { "bill.created", "bill.updated", "bill.voided" };
    public static readonly string[] Statuses = { "open", "paid", "overdue", "void" };

    public static List<string> Validate(PurchaseBillIn b)
    {
        var e = new List<string>();
        var ev = b.Event?.Trim().ToLowerInvariant();
        if (ev is null || !Events.Contains(ev)) e.Add("event must be bill.created, bill.updated or bill.voided.");
        if (string.IsNullOrWhiteSpace(b.BillId)) e.Add("billId is required."); else if (b.BillId.Trim().Length > 40) e.Add("billId is longer than 40 characters.");
        if (string.IsNullOrWhiteSpace(b.LocationId)) e.Add("locationId is required.");
        if (string.IsNullOrWhiteSpace(b.DealerCode)) e.Add("dealerCode is required.");
        if (!string.IsNullOrWhiteSpace(b.Status) && !Statuses.Contains(b.Status.Trim().ToLowerInvariant())) e.Add($"status \"{b.Status}\" is not open, paid, overdue or void.");
        if (ev == "bill.voided") return e;

        if (string.IsNullOrWhiteSpace(b.BillNumber)) e.Add("billNumber is required."); else if (b.BillNumber.Trim().Length > 100) e.Add("billNumber is longer than 100 characters.");
        if (!DateOnly.TryParseExact(b.BillDate?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) e.Add("billDate is required, as YYYY-MM-DD.");
        if (b.Lines is null || b.Lines.Count == 0) { e.Add("lines is required: a bill with no line is not sent."); return e; }
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < b.Lines.Count; i++)
        {
            var l = b.Lines[i]; var at = $"lines[{i}]";
            if (string.IsNullOrWhiteSpace(l.LineItemId)) e.Add($"{at}.lineItemId is required."); else if (!seen.Add(l.LineItemId.Trim())) e.Add($"{at}.lineItemId appears twice.");
            if (string.IsNullOrWhiteSpace(l.ItemCode)) e.Add($"{at}.itemCode is required."); else if (l.ItemCode.Trim().Length > 60) e.Add($"{at}.itemCode is longer than 60 characters.");
            if (l.Quantity is null || l.Quantity <= 0) e.Add($"{at}.quantity must be more than 0.");
            if (l.Rate is null || l.Rate < 0) e.Add($"{at}.rate is required (0 or more).");
        }
        return e;
    }

    private static string N(decimal? v) => (v ?? 0m).ToString("0.######", CultureInfo.InvariantCulture);

    /// <summary>The content of a bill without the event name: the same bill sent as created and again as updated, with nothing changed, has the same hash (case and line order do not matter).</summary>
    public static string Hash(PurchaseBillIn b)
    {
        var lines = (b.Lines ?? new List<PurchaseBillLineIn>()).OrderBy(l => l.LineItemId, StringComparer.Ordinal)
            .Select(l => string.Join("|", (l.LineItemId ?? "").Trim(), (l.ItemCode ?? "").Trim().ToUpperInvariant(), N(l.Quantity), N(l.Rate), N(l.Discount), (l.TaxName ?? "").Trim(), N(l.TaxPercentage), N(l.TaxAmount), N(l.LineTotal)));
        var canonical = string.Join("\n", new[] { (b.BillId ?? "").Trim(), (b.BillNumber ?? "").Trim(), (b.BillDate ?? "").Trim(), (b.Status ?? "").Trim().ToLowerInvariant(), (b.LocationId ?? "").Trim(), (b.DealerCode ?? "").Trim().ToUpperInvariant(),
            (b.VendorId ?? "").Trim(), N(b.SubTotal), N(b.TaxTotal), N(b.Total) }.Concat(lines));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }

    public static PurchaseBillAction Decide(string eventName, ExistingPurchaseBill? existing, string newHash)
    {
        if (string.Equals(eventName, "bill.voided", StringComparison.OrdinalIgnoreCase)) return existing is { IsVoided: true } ? PurchaseBillAction.VoidAgain : PurchaseBillAction.Void;
        if (existing is null) return PurchaseBillAction.Create;
        if (existing.IsVoided) return PurchaseBillAction.RejectEditOfVoided;
        return string.Equals(existing.PayloadHash, newHash, StringComparison.OrdinalIgnoreCase) ? PurchaseBillAction.Duplicate : PurchaseBillAction.Update;
    }

    public sealed record StockPlan(Dictionary<string, decimal> LineApplied, Dictionary<string, decimal> DeltaByPart, List<string> NotApplied);

    /// <summary>Which line quantities reach the stock, and by how much each part changes. newLines: lineItemId, part, quantity. existingParts: the parts that HAVE a PartUploads row at the location. oldAppliedByPart: what the earlier version of this bill added.</summary>
    public static StockPlan Plan(IEnumerable<(string LineItemId, string Part, decimal Qty)> newLines, ISet<string> existingParts, IReadOnlyDictionary<string, decimal> oldAppliedByPart)
    {
        var parts = new HashSet<string>(existingParts, StringComparer.OrdinalIgnoreCase);
        var applied = new Dictionary<string, decimal>(); var newApplied = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase); var notApplied = new List<string>();
        foreach (var (lineId, part, qty) in newLines)
        {
            if (parts.Contains(part)) { applied[lineId] = qty; newApplied[part] = newApplied.GetValueOrDefault(part) + qty; }
            else { applied[lineId] = 0m; if (!notApplied.Contains(part, StringComparer.OrdinalIgnoreCase)) notApplied.Add(part); }
        }
        var delta = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in newApplied.Keys.Concat(oldAppliedByPart.Keys).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var d = newApplied.GetValueOrDefault(part) - oldAppliedByPart.GetValueOrDefault(part);
            if (d != 0m) delta[part] = d;
        }
        return new StockPlan(applied, delta, notApplied);
    }

    /// <summary>A void takes back everything the bill added.</summary>
    public static Dictionary<string, decimal> PlanVoid(IReadOnlyDictionary<string, decimal> oldAppliedByPart) =>
        oldAppliedByPart.Where(kv => kv.Value != 0m).ToDictionary(kv => kv.Key, kv => -kv.Value, StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// The SQL that stores one purchase bill event as ONE batch (SET XACT_ABORT ON: all statements or none), because the app's retrying execution strategy refuses a transaction started by hand (see DecisionSql).
/// Statement order: stock first, then the bill header, then its lines. Parameters are returned by name and value.
/// </summary>
public static class PurchaseBillSql
{
    public static (string Sql, List<(string Name, object? Value)> Params) Build(PurchaseBillAction action, PurchaseBillIn b, Guid dealerId, string subLocation, string payloadHash,
        IReadOnlyDictionary<string, decimal> stockDelta, IReadOnlyDictionary<string, decimal>? lineApplied)
    {
        var ps = new List<(string, object?)> { ("@bid", b.BillId!.Trim()), ("@dealer", dealerId), ("@loc", subLocation) };
        var sb = new StringBuilder("SET XACT_ABORT ON; ");
        var i = 0;
        foreach (var kv in stockDelta.Where(x => x.Value != 0m))
        {
            sb.Append($"UPDATE [dbo].[PartUploads] SET [BalQty] = ISNULL([BalQty], 0) + @s{i} WHERE [DealerId] = @dealer AND [LocationCode] = @loc AND [PartNo] = @p{i}; ");
            ps.Add(($"@s{i}", kv.Value)); ps.Add(($"@p{i}", kv.Key)); i++;
        }
        if (action is PurchaseBillAction.Void)
        {
            sb.Append("IF EXISTS (SELECT 1 FROM [dbo].[ZohoPurchaseBills] WHERE [BillId] = @bid) ");
            sb.Append("UPDATE [dbo].[ZohoPurchaseBills] SET [IsVoided] = 1, [Status] = N'void', [LastEvent] = N'bill.voided', [UpdatedAt] = SYSUTCDATETIME() WHERE [BillId] = @bid ");
            sb.Append("ELSE INSERT INTO [dbo].[ZohoPurchaseBills] ([BillId],[BillNumber],[Status],[LocationId],[DealerCode],[SubLocation],[DealerId],[PayloadHash],[LastEvent],[IsVoided]) VALUES (@bid, @bn, N'void', @lid, @dc, @loc, @dealer, @ph, N'bill.voided', 1); ");
            sb.Append("UPDATE [dbo].[ZohoPurchaseBillLines] SET [AppliedQty] = 0 WHERE [BillId] = @bid; ");
            ps.Add(("@bn", b.BillNumber?.Trim() ?? "")); ps.Add(("@lid", b.LocationId!.Trim())); ps.Add(("@dc", b.DealerCode!.Trim())); ps.Add(("@ph", payloadHash));
            return (sb.ToString(), ps);
        }
        ps.Add(("@bn", b.BillNumber!.Trim())); ps.Add(("@bd", DateTime.ParseExact(b.BillDate!.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture))); ps.Add(("@st", (b.Status ?? "open").Trim().ToLowerInvariant()));
        ps.Add(("@vid", b.VendorId?.Trim())); ps.Add(("@vn", b.VendorName?.Trim())); ps.Add(("@vg", string.IsNullOrWhiteSpace(b.VendorGstin) ? null : b.VendorGstin.Trim())); ps.Add(("@ref", string.IsNullOrWhiteSpace(b.ReferenceNumber) ? null : b.ReferenceNumber.Trim()));
        ps.Add(("@lid", b.LocationId!.Trim())); ps.Add(("@dc", b.DealerCode!.Trim())); ps.Add(("@sub", b.SubTotal ?? 0m)); ps.Add(("@tax", b.TaxTotal ?? 0m)); ps.Add(("@tot", b.Total ?? 0m)); ps.Add(("@ph", payloadHash)); ps.Add(("@ev", b.Event!.Trim().ToLowerInvariant()));
        sb.Append("IF EXISTS (SELECT 1 FROM [dbo].[ZohoPurchaseBills] WHERE [BillId] = @bid) ");
        sb.Append("UPDATE [dbo].[ZohoPurchaseBills] SET [BillNumber] = @bn, [BillDate] = @bd, [Status] = @st, [VendorId] = @vid, [VendorName] = @vn, [VendorGstin] = @vg, [ReferenceNumber] = @ref, [LocationId] = @lid, [DealerCode] = @dc, [SubLocation] = @loc, [DealerId] = @dealer, [SubTotal] = @sub, [TaxTotal] = @tax, [Total] = @tot, [PayloadHash] = @ph, [LastEvent] = @ev, [UpdatedAt] = SYSUTCDATETIME() WHERE [BillId] = @bid ");
        sb.Append("ELSE INSERT INTO [dbo].[ZohoPurchaseBills] ([BillId],[BillNumber],[BillDate],[Status],[VendorId],[VendorName],[VendorGstin],[ReferenceNumber],[LocationId],[DealerCode],[SubLocation],[DealerId],[SubTotal],[TaxTotal],[Total],[PayloadHash],[LastEvent],[IsVoided]) VALUES (@bid, @bn, @bd, @st, @vid, @vn, @vg, @ref, @lid, @dc, @loc, @dealer, @sub, @tax, @tot, @ph, @ev, 0); ");
        sb.Append("DELETE FROM [dbo].[ZohoPurchaseBillLines] WHERE [BillId] = @bid; ");
        var lines = b.Lines ?? new List<PurchaseBillLineIn>();
        for (var n = 0; n < lines.Count; n++)
        {
            var l = lines[n]; var applied = lineApplied is not null && lineApplied.TryGetValue(l.LineItemId!.Trim(), out var a) ? a : 0m;
            sb.Append($"INSERT INTO [dbo].[ZohoPurchaseBillLines] ([BillId],[LineItemId],[ItemCode],[ItemName],[HsnCode],[Quantity],[Unit],[Rate],[Discount],[TaxName],[TaxPercentage],[TaxAmount],[LineTotal],[AppliedQty]) VALUES (@bid, @li{n}, @ic{n}, @in{n}, @hs{n}, @q{n}, @un{n}, @r{n}, @di{n}, @tn{n}, @tp{n}, @ta{n}, @lt{n}, @ap{n}); ");
            ps.Add(($"@li{n}", l.LineItemId!.Trim())); ps.Add(($"@ic{n}", l.ItemCode!.Trim())); ps.Add(($"@in{n}", l.ItemName?.Trim())); ps.Add(($"@hs{n}", string.IsNullOrWhiteSpace(l.HsnCode) ? null : l.HsnCode.Trim()));
            ps.Add(($"@q{n}", l.Quantity ?? 0m)); ps.Add(($"@un{n}", l.Unit?.Trim())); ps.Add(($"@r{n}", l.Rate ?? 0m)); ps.Add(($"@di{n}", l.Discount ?? 0m)); ps.Add(($"@tn{n}", l.TaxName?.Trim()));
            ps.Add(($"@tp{n}", l.TaxPercentage ?? 0m)); ps.Add(($"@ta{n}", l.TaxAmount ?? 0m)); ps.Add(($"@lt{n}", l.LineTotal ?? 0m)); ps.Add(($"@ap{n}", applied));
        }
        return (sb.ToString(), ps);
    }
}