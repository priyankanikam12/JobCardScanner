using System.Security.Cryptography;
using System.Text;

namespace JobCardScanner.Api.Services;

/// <summary>One line of the estimate, in the same fields as a Repair Bill line (itemType, itemCode, itemDescription, hsnCode, issueType, qty, rate, discountType / discountValue / discountAmount, cgst / sgst / igst %, taxableAmount, cgst / sgst / igst amounts, totalAmount) plus grossAmount.</summary>
public sealed record ShadowfaxEstimateLine(Guid Id, string ItemType, string ItemCode, string? ItemDescription, string? HsnCode, string IssueType, double Qty, decimal Rate,
    string? DiscountType, decimal DiscountValue, decimal GrossAmount, decimal DiscountAmount, decimal CgstPct, decimal SgstPct, decimal IgstPct,
    decimal TaxableAmount, decimal CgstAmount, decimal SgstAmount, decimal IgstAmount, decimal TotalAmount);

public sealed record EstimateTotals(decimal PartsTotal, decimal LabourTotal, decimal GrossAmount, decimal DiscountAmount, decimal TaxableAmount, decimal CgstAmount, decimal SgstAmount, decimal IgstAmount, decimal TotalAmount);

/// <summary>
/// 2026-11-01 (Shadowfax, "The estimate on each job card"): the estimate of a job card is its Part Suggestions + Labour Suggestions (the Estimates tab of the job card reads exactly these). This turns a suggestion into a
/// bill-style line with the same rules the job card screen and the repair bill use:
///   gross = qty x rate; discount "Percentage" = % of gross, "Amount" = a flat amount, anything else none, never more than gross (JobCardDetailPage.suggestionLineMoney);
///   a line that is NOT "Paid" (U/W warranty, FOC) is nothing for the customer: taxableAmount, tax and totalAmount are 0 (like a bill line), grossAmount still shows what it is worth;
///   tax: the item's / labour's own GST. Intra-state = CGST + SGST, inter-state = IGST. Labour Master keeps GST as a fraction (0.09 = 9%), so a value above 0 and below 1 is read as a fraction.
/// No database access, so it can be tested on its own.
/// </summary>
public static class EstimateMath
{
    private static decimal R(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    public static decimal GstAsPercent(decimal v) => v > 0m && v < 1m ? v * 100m : v;

    public static ShadowfaxEstimateLine Build(Guid id, string itemType, string code, string? description, string? hsn, string? issueType, double qty, decimal rate,
        string? discountType, decimal discountValue, decimal sgst, decimal cgst, decimal igst, bool interState)
    {
        var issue = string.IsNullOrWhiteSpace(issueType) ? "Paid" : issueType.Trim();
        var q = (decimal)Math.Max(qty, 0d);
        var gross = R(q * Math.Max(rate, 0m));
        var kind = discountType?.Trim();
        var raw = string.Equals(kind, "Percentage", StringComparison.OrdinalIgnoreCase) ? gross * discountValue / 100m
                : string.Equals(kind, "Amount", StringComparison.OrdinalIgnoreCase) ? discountValue : 0m;
        var discount = R(Math.Min(Math.Max(raw, 0m), gross));

        var s = GstAsPercent(sgst); var c = GstAsPercent(cgst); var i = GstAsPercent(igst);
        var gstRate = i > 0m ? i : s + c;
        decimal cgstPct, sgstPct, igstPct;
        if (interState) { cgstPct = 0m; sgstPct = 0m; igstPct = gstRate; }
        else if (s > 0m || c > 0m) { cgstPct = c; sgstPct = s; igstPct = 0m; }
        else { cgstPct = gstRate / 2m; sgstPct = gstRate / 2m; igstPct = 0m; }

        var taxable = string.Equals(issue, "Paid", StringComparison.OrdinalIgnoreCase) ? R(gross - discount) : 0m;
        var cgstAmt = R(taxable * cgstPct / 100m); var sgstAmt = R(taxable * sgstPct / 100m); var igstAmt = R(taxable * igstPct / 100m);
        return new ShadowfaxEstimateLine(id, itemType, code, description, hsn, issue, qty, rate, kind, discountValue, gross, discount, cgstPct, sgstPct, igstPct, taxable, cgstAmt, sgstAmt, igstAmt, taxable + cgstAmt + sgstAmt + igstAmt);
    }

    public static EstimateTotals Total(IEnumerable<ShadowfaxEstimateLine> lines)
    {
        var l = lines.ToList();
        return new EstimateTotals(
            l.Where(x => x.ItemType == "Part").Sum(x => x.TotalAmount), l.Where(x => x.ItemType == "Labour").Sum(x => x.TotalAmount),
            l.Sum(x => x.GrossAmount), l.Sum(x => x.DiscountAmount), l.Sum(x => x.TaxableAmount),
            l.Sum(x => x.CgstAmount), l.Sum(x => x.SgstAmount), l.Sum(x => x.IgstAmount), l.Sum(x => x.TotalAmount));
    }

    /// <summary>Inter-state when the dealer's state and the customer's state are both known and different (compared without case or spaces); otherwise intra-state.</summary>
    public static bool IsInterState(string? dealerState, string? customerState)
    {
        static string N(string? s) => (s ?? "").Replace(" ", "").ToUpperInvariant();
        var d = N(dealerState); var c = N(customerState);
        return d.Length > 0 && c.Length > 0 && d != c;
    }
}

public sealed class DecisionLineIn
{
    public Guid? LineId { get; set; }
    public string? ItemCode { get; set; }
    public string? Result { get; set; }
}

public sealed class DecisionIn
{
    public string? DecisionId { get; set; }
    public int? EstimateVersion { get; set; }
    public string? Decision { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? DecidedBy { get; set; }
    public string? Reason { get; set; }
    public List<DecisionLineIn>? Lines { get; set; }
}

/// <summary>
/// 2026-11-01 (Shadowfax, "A way for us to send our decision back to you"): the rules for POST /api/shadowfax-data/jobcards/{id}/decisions.
///   * decisionId is the idempotency key: a repeat with the same content is answered "duplicate" (HTTP 200) and changes nothing; the same decisionId with DIFFERENT content is a conflict (HTTP 409).
///   * decision APPROVED needs every line ACCEPTED; DENIED needs at least one DENIED line and a reason ("which parts we accept, which we deny and why").
///   * every line must be a line of the estimate (lineId) and carry that line's itemCode, so a denial always points to the right part.
/// No database access, so it can be tested on its own.
/// </summary>
public static class DecisionRules
{
    public static readonly string[] Decisions = { "APPROVED", "DENIED" };
    public static readonly string[] Results = { "ACCEPTED", "DENIED" };

    /// <param name="estimateLines">lineId -> itemCode of the CURRENT estimate.</param>
    public static List<string> Validate(DecisionIn d, IReadOnlyDictionary<Guid, string> estimateLines, DateTimeOffset now)
    {
        var errors = new List<string>();
        var id = d.DecisionId?.Trim();
        if (string.IsNullOrEmpty(id)) errors.Add("decisionId is required.");
        else if (id.Length > 100) errors.Add("decisionId is longer than 100 characters.");
        if (d.EstimateVersion is null || d.EstimateVersion < 1) errors.Add("estimateVersion is required (1 or more).");
        var decision = d.Decision?.Trim().ToUpperInvariant();
        if (decision is null || !Decisions.Contains(decision)) errors.Add("decision must be APPROVED or DENIED.");
        if (d.DecidedAt is null) errors.Add("decidedAt is required (ISO 8601, for example 2026-10-27T09:30:00Z).");
        else if (d.DecidedAt.Value > now.AddMinutes(10)) errors.Add("decidedAt is in the future.");
        if ((d.DecidedBy?.Length ?? 0) > 200) errors.Add("decidedBy is longer than 200 characters.");
        if ((d.Reason?.Length ?? 0) > 1000) errors.Add("reason is longer than 1000 characters.");
        if (d.Lines is null || d.Lines.Count == 0) { errors.Add("lines is required: one entry per estimate line."); return errors; }

        var seen = new HashSet<Guid>();
        var anyDenied = false; var allAccepted = true;
        for (var i = 0; i < d.Lines.Count; i++)
        {
            var l = d.Lines[i]; var at = $"lines[{i}]";
            if (l.LineId is null || l.LineId == Guid.Empty) { errors.Add($"{at}.lineId is required."); continue; }
            if (!seen.Add(l.LineId.Value)) errors.Add($"{at}.lineId appears twice.");
            var result = l.Result?.Trim().ToUpperInvariant();
            if (result is null || !Results.Contains(result)) errors.Add($"{at}.result must be ACCEPTED or DENIED.");
            if (result == "DENIED") anyDenied = true;
            if (result != "ACCEPTED") allAccepted = false;
            if (!estimateLines.TryGetValue(l.LineId.Value, out var code)) errors.Add($"{at}.lineId {l.LineId} is not a line of this job card's current estimate.");
            else if (!string.Equals(code, l.ItemCode?.Trim(), StringComparison.OrdinalIgnoreCase)) errors.Add($"{at}.itemCode \"{l.ItemCode}\" does not match the estimate line ({code}).");
        }
        if (decision == "APPROVED" && !allAccepted) errors.Add("decision APPROVED needs every line ACCEPTED.");
        if (decision == "DENIED" && !anyDenied) errors.Add("decision DENIED needs at least one line DENIED.");
        if (anyDenied && string.IsNullOrWhiteSpace(d.Reason)) errors.Add("reason is required when a line is DENIED.");
        return errors;
    }

    /// <summary>The same decision always gives the same hash (case, spaces, line order and the time zone do not matter), so a repeat can be told from a changed one.</summary>
    public static string Hash(DecisionIn d)
    {
        var lines = (d.Lines ?? new List<DecisionLineIn>())
            .OrderBy(l => l.LineId).Select(l => $"{l.LineId}|{(l.ItemCode ?? "").Trim().ToUpperInvariant()}|{(l.Result ?? "").Trim().ToUpperInvariant()}");
        var canonical = string.Join("\n", new[]
        {
            (d.DecisionId ?? "").Trim(), (d.EstimateVersion ?? 0).ToString(), (d.Decision ?? "").Trim().ToUpperInvariant(),
            d.DecidedAt?.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss") ?? "", (d.DecidedBy ?? "").Trim(), (d.Reason ?? "").Trim(),
        }.Concat(lines));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }
}

/// <summary>
/// 2026-11-01: the SQL that stores one decision (header + lines) as ONE batch. The app uses SqlServerRetryingExecutionStrategy, which refuses a transaction started by hand (BeginTransactionAsync), so atomicity comes from the
/// batch itself: SET XACT_ABORT ON means any failing statement rolls back the whole batch. Parameters are returned by name and value so the controller can turn them into SqlParameter.
/// </summary>
public static class DecisionSql
{
    public static (string Sql, List<(string Name, object? Value)> Params) BuildInsert(string decisionId, Guid jobCardId, DecisionIn d, int currentEstimateVersion, string payloadHash)
    {
        var ps = new List<(string, object?)>
        {
            ("@h0", decisionId), ("@h1", jobCardId), ("@h2", d.EstimateVersion!.Value), ("@h3", currentEstimateVersion), ("@h4", d.Decision!.Trim().ToUpperInvariant()),
            ("@h5", d.DecidedAt!.Value.UtcDateTime), ("@h6", string.IsNullOrWhiteSpace(d.DecidedBy) ? null : d.DecidedBy.Trim()), ("@h7", string.IsNullOrWhiteSpace(d.Reason) ? null : d.Reason.Trim()), ("@h8", payloadHash),
        };
        var sb = new StringBuilder();
        sb.Append("SET XACT_ABORT ON; DECLARE @id BIGINT; ");
        sb.Append("INSERT INTO [dbo].[ShadowfaxDecisions] ([DecisionId],[JobCardId],[EstimateVersion],[CurrentEstimateVersion],[Decision],[DecidedAt],[DecidedBy],[Reason],[PayloadHash]) VALUES (@h0,@h1,@h2,@h3,@h4,@h5,@h6,@h7,@h8); ");
        sb.Append("SET @id = SCOPE_IDENTITY(); ");
        var lines = d.Lines ?? new List<DecisionLineIn>();
        for (var i = 0; i < lines.Count; i++)
        {
            sb.Append($"INSERT INTO [dbo].[ShadowfaxDecisionLines] ([DecisionRowId],[LineId],[ItemCode],[Result]) VALUES (@id, @l{i}, @c{i}, @r{i}); ");
            ps.Add(($"@l{i}", lines[i].LineId!.Value)); ps.Add(($"@c{i}", lines[i].ItemCode!.Trim())); ps.Add(($"@r{i}", lines[i].Result!.Trim().ToUpperInvariant()));
        }
        return (sb.ToString(), ps);
    }
}