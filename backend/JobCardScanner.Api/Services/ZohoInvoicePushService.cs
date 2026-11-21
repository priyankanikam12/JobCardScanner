using System.Text.Json;
using System.Text.Json.Nodes;
using JobCardScanner.Api.Services.Zoho;
using JobCardScanner.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services;

/// <summary>One bill's outcome of a dry run or a live push.</summary>
public sealed record ZohoInvoiceOutcome(string BillNumber, string Result, string Detail, decimal DmsTotal, decimal? ZohoTotal = null, string? ZohoInvoiceId = null, JsonObject? Payload = null);

/// <summary>
/// 2026-11-20: the DMS -> Zoho Books invoice push (repair bills as invoices). OFF unless ZohoInvoicePush:Enabled = true; a live call also needs dryRun=false. Invoice number = the DMS bill number
/// (decision 20.11.2026). Customer id from dbo.ZohoCustomerKeys (one Zoho contact per real customer); location from dbo.ZohoLocationMap rows with Confirmed = 1 only; bills are taken in date order;
/// a bill that fails a check is not sent. Results in dbo.ZohoInvoicePush (run sql/2026-11-20_zoho_invoice_push.sql first); a bill already Sent is never sent again.
/// Dry run: reads Zoho (item / contact lookups only), builds and checks every body, writes nothing to Zoho and nothing to the database.
/// Uses the project's own Services.Zoho.ZohoBooksApiClient (OAuth, throttle, validation). A created invoice is a DRAFT in Zoho: it is marked Sent right after (section 7.2) because only then does stock at the location go down.
/// Labour items are NOT created here: they come from the labour import (v2 export), a missing item blocks the bill. Config: ZohoInvoicePush:Enabled (false), ZohoInvoicePush:CreateCustomers (false).
/// </summary>
public sealed class ZohoInvoicePushService
{
    public sealed class BillRow { public Guid Id { get; set; } public string BillNumber { get; set; } = ""; public DateTime BillDate { get; set; } public string? JobCardNumber { get; set; } public string Status { get; set; } = ""; public string? Remarks { get; set; } public decimal TotalAmount { get; set; } public string? DealerCode { get; set; } public string? SubLocation { get; set; } public DateTime CreatedAt { get; set; } public Guid? CanonicalCustomerId { get; set; } }
    public sealed class LineRow { public Guid BillId { get; set; } public Guid Id { get; set; } public string ItemType { get; set; } = ""; public string ItemCode { get; set; } = ""; public string? ItemDescription { get; set; } public string? IssueType { get; set; } public double Qty { get; set; } public decimal Rate { get; set; } public string? DiscountType { get; set; } public decimal DiscountValue { get; set; } public decimal CgstPct { get; set; } public decimal SgstPct { get; set; } public decimal IgstPct { get; set; } }
    public sealed class CustRow { public Guid CustomerId { get; set; } public string Name { get; set; } = ""; public string? Mobile { get; set; } public string? State { get; set; } public string? Address { get; set; } public string? City { get; set; } }
    public sealed class LocRow { public string ZohoLocationId { get; set; } = ""; public string? DealerCode { get; set; } public string? SubLocation { get; set; } }
    public sealed class StrRow { public string Value { get; set; } = ""; }

    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _cfg;
    private readonly ZohoBooksApiClient _client;

    public ZohoInvoicePushService(JobCardScannerDbContext db, IConfiguration cfg, ZohoBooksApiClient client) { _db = db; _cfg = cfg; _client = client; }

    public static bool Enabled(IConfiguration c) => c.GetValue("ZohoInvoicePush:Enabled", false);

    /// <summary>Billed bills not yet Sent, in date order. billNumber = just that bill (exact match).</summary>
    public async Task<List<BillRow>> LoadBillsAsync(string? billNumber, CancellationToken ct)
    {
        var sql = @"SELECT r.Id, r.BillNumber, CAST(r.BillDate AS DATETIME2) AS BillDate, j.JobCardNumber, r.Status, r.Remarks, r.TotalAmount, d.BaplDmsDealerCode AS DealerCode, j.BaplServiceLocationCode AS SubLocation, j.CreatedAt, k.CanonicalCustomerId
FROM dbo.RepairBillDocs r
JOIN dbo.Dealers d ON d.Id = r.DealerId
JOIN dbo.JobCards j ON j.Id = r.JobCardId
JOIN dbo.Customers c ON c.Id = j.CustomerId
LEFT JOIN dbo.ZohoCustomerKeys k ON k.CustomerKey = UPPER(LTRIM(RTRIM(c.Name))) + N'|' + LTRIM(RTRIM(ISNULL(c.Mobile, N'')))
WHERE r.IsDeleted = 0 AND r.Status = 'Billed'
  AND NOT EXISTS (SELECT 1 FROM dbo.ZohoInvoicePush p WHERE p.BillId = r.Id AND p.Status = 'Sent')
  AND (@bn IS NULL OR r.BillNumber = @bn)";
        var rows = await _db.Database.SqlQueryRaw<BillRow>(sql, new Microsoft.Data.SqlClient.SqlParameter("@bn", (object?)billNumber ?? DBNull.Value)).ToListAsync(ct);
        return ZohoInvoiceBuilder.InDateOrder(rows, b => DateOnly.FromDateTime(b.BillDate), b => b.CreatedAt, _ => 0);
    }

    private async Task<List<LineRow>> LoadLinesAsync(Guid billId, CancellationToken ct) =>
        await _db.Database.SqlQueryRaw<LineRow>(@"SELECT RepairBillDocId AS BillId, Id, ItemType, ItemCode, ItemDescription, IssueType, CAST(Qty AS FLOAT) AS Qty, Rate, DiscountType, ISNULL(DiscountValue, 0) AS DiscountValue, ISNULL(CgstPct, 0) AS CgstPct, ISNULL(SgstPct, 0) AS SgstPct, ISNULL(IgstPct, 0) AS IgstPct
FROM dbo.RepairBillDocItems WHERE RepairBillDocId = @b", new Microsoft.Data.SqlClient.SqlParameter("@b", billId)).ToListAsync(ct);

    private async Task<CustRow?> LoadCustomerAsync(Guid id, CancellationToken ct) =>
        (await _db.Database.SqlQueryRaw<CustRow>(@"SELECT cu.Id AS CustomerId, cu.Name, cu.Mobile,
 (SELECT MAX(NULLIF(LTRIM(RTRIM(c2.State)), N'')) FROM dbo.Customers c2 WHERE UPPER(LTRIM(RTRIM(c2.Name))) = UPPER(LTRIM(RTRIM(cu.Name))) AND LTRIM(RTRIM(ISNULL(c2.Mobile, N''))) = LTRIM(RTRIM(ISNULL(cu.Mobile, N'')))) AS State,
 cu.Address, cu.City FROM dbo.Customers cu WHERE cu.Id = @c", new Microsoft.Data.SqlClient.SqlParameter("@c", id)).ToListAsync(ct)).FirstOrDefault();

    private async Task<Dictionary<string, string>> LoadLocationMapAsync(CancellationToken ct)
    {
        var rows = await _db.Database.SqlQueryRaw<LocRow>("SELECT ZohoLocationId, DealerCode, SubLocation FROM dbo.ZohoLocationMap WHERE Confirmed = 1").ToListAsync(ct);
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows)
        {
            var key = !string.IsNullOrWhiteSpace(r.SubLocation) ? r.SubLocation!.Trim() : r.DealerCode?.Trim();
            if (!string.IsNullOrEmpty(key)) map[key] = r.ZohoLocationId;
        }
        return map;
    }

    /// <summary>Dry run or live push of the selected bills. A live push stops at the first retryable Zoho failure (outage, rate limit, auth).</summary>
    public async Task<List<ZohoInvoiceOutcome>> RunAsync(string? billNumber, bool dryRun, int max, CancellationToken ct)
    {
        var results = new List<ZohoInvoiceOutcome>();
        var client = _client;
        var createCust = _cfg.GetValue("ZohoInvoicePush:CreateCustomers", false);
        var locations = await LoadLocationMapAsync(ct);
        var itemCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var bills = await LoadBillsAsync(billNumber, ct);
        if (bills.Count == 0) { results.Add(new(billNumber ?? "-", "Nothing", "No Billed bill waiting (not found, not Billed, deleted, or already Sent).", 0)); return results; }

        foreach (var b in bills.Take(Math.Max(1, max)))
        {
            ct.ThrowIfCancellationRequested();
            var errors = new List<string>();
            var lines = await LoadLinesAsync(b.Id, ct);
            var locationId = ZohoInvoiceBuilder.ResolveLocation(locations, b.DealerCode, b.SubLocation);
            if (locationId is null) errors.Add($"location not mapped / not confirmed ({b.SubLocation ?? b.DealerCode}).");

            // customer: stored map, else Zoho lookup by DMS customer id, else create (only when allowed)
            string? contactId = null;
            if (b.CanonicalCustomerId is null) errors.Add("customer is not in dbo.ZohoCustomerKeys (run sql/2026-11-04_zoho_customer_keys.sql).");
            else
            {
                var cid = b.CanonicalCustomerId.Value;
                contactId = (await _db.Database.SqlQueryRaw<StrRow>("SELECT ZohoContactId AS Value FROM dbo.ZohoContactMap WHERE CanonicalCustomerId = @c", new Microsoft.Data.SqlClient.SqlParameter("@c", cid)).ToListAsync(ct)).FirstOrDefault()?.Value;
                if (contactId is null)
                {
                    var found = await client.FindCustomerByDmsIdAsync(cid.ToString(), ct);
                    if (!found.Success) { results.Add(new(b.BillNumber, "Stopped", found.Message ?? "customer lookup failed", b.TotalAmount)); return results; }
                    contactId = found.Data?.ContactId;
                }
                if (contactId is null)
                {
                    var cust = await LoadCustomerAsync(cid, ct);
                    if (cust is null) errors.Add("customer record not found.");
                    else
                    {
                        var (cBody, cErr) = ZohoInvoiceBuilder.BuildCustomer(new ZohoCustomerData(cust.CustomerId, cust.Name, cust.Mobile, null, null, cust.State, cust.Address, cust.City, null));
                        if (cBody is null) errors.AddRange(cErr.Select(x => "customer: " + x));
                        else if (dryRun) contactId = "DRYRUN-CONTACT";
                        else if (!createCust) errors.Add("customer is not in Zoho Books and ZohoInvoicePush:CreateCustomers is off (link the customer in Zoho first, or switch it on).");
                        else
                        {
                            var req = cBody.Deserialize<ZohoCreateContactRequest>()!;
                            var made = await client.CreateCustomerAsync(req, ct);
                            if (made.Success) contactId = made.Data!.ContactId;
                            else if (made.ConflictingId is not null) contactId = made.ConflictingId;
                            else { errors.Add("customer: " + made.Message); if (made.Retryable) { results.Add(new(b.BillNumber, "Stopped", made.Message ?? "", b.TotalAmount)); return results; } }
                        }
                    }
                }
                if (contactId is not null && contactId != "DRYRUN-CONTACT" && !dryRun)
                    await _db.Database.ExecuteSqlRawAsync("IF NOT EXISTS (SELECT 1 FROM dbo.ZohoContactMap WHERE CanonicalCustomerId = @c) INSERT INTO dbo.ZohoContactMap (CanonicalCustomerId, ZohoContactId) VALUES (@c, @z)",
                        new Microsoft.Data.SqlClient.SqlParameter("@c", cid), new Microsoft.Data.SqlClient.SqlParameter("@z", contactId));
            }

            // items (parts and labour) must already exist in Zoho
            foreach (var l in lines)
            {
                var code = l.ItemCode?.Trim() ?? "";
                if (code.Length == 0 || itemCache.ContainsKey(code)) continue;
                var f = await client.FindItemBySkuAsync(code, ct);
                if (!f.Success) { results.Add(new(b.BillNumber, "Stopped", f.Message ?? "item lookup failed", b.TotalAmount)); return results; }
                if (f.Data is null) errors.Add($"item {code} is not in Zoho Books" + (string.Equals(l.ItemType, "Labour", StringComparison.OrdinalIgnoreCase) ? " (labour items come from the labour import)." : "."));
                else itemCache[code] = f.Data.ItemId;
            }

            var bill = new ZohoBill(b.Id, b.BillNumber, DateOnly.FromDateTime(b.BillDate), b.JobCardNumber ?? "", b.Status, b.Remarks, b.TotalAmount,
                lines.Select(l => new ZohoBillLine(l.Id, l.ItemType, l.ItemCode, l.ItemDescription, l.IssueType, l.Qty, l.Rate, l.DiscountType, l.DiscountValue, l.CgstPct, l.SgstPct, l.IgstPct)).ToList());
            var (payload, bErrors) = ZohoInvoiceBuilder.BuildInvoice(bill, contactId ?? "", locationId ?? "", itemCache);
            errors.AddRange(bErrors);
            errors = errors.Distinct().ToList();

            if (errors.Count > 0 || payload is null)
            {
                var detail = string.Join(" | ", errors);
                results.Add(new(b.BillNumber, "NotSent", detail, b.TotalAmount));
                if (!dryRun) await SaveAsync(b, "Failed", null, null, detail, ct);
                continue;
            }
            if (dryRun) { results.Add(new(b.BillNumber, "DryRunOK", "payload built, all checks passed; nothing sent.", b.TotalAmount, null, null, payload)); continue; }

            // an earlier half-finished send: the invoice may already exist (draft)
            string? invId; decimal? zTotal = null; string note;
            var existing = await client.FindInvoiceByNumberAsync(ZohoInvoiceBuilder.ZohoInvoiceNumber(b.BillNumber) ?? b.BillNumber, ct);
            if (!existing.Success) { results.Add(new(b.BillNumber, "Stopped", existing.Message ?? "invoice lookup failed", b.TotalAmount)); return results; }
            if (existing.Data is not null)
            {
                invId = existing.Data.InvoiceId; zTotal = existing.Data.Total; note = "already in Zoho Books (found by invoice number)";
                if (string.Equals(existing.Data.Status, "sent", StringComparison.OrdinalIgnoreCase) || string.Equals(existing.Data.Status, "void", StringComparison.OrdinalIgnoreCase)) { await SaveAsync(b, "Sent", invId, zTotal, note + ", status " + existing.Data.Status, ct); results.Add(new(b.BillNumber, "AlreadyInZoho", note, b.TotalAmount, zTotal, invId)); continue; }
            }
            else
            {
                var req = payload.Deserialize<ZohoCreateInvoiceRequest>()!;
                var created = await client.CreateInvoiceAsync(req, ct);
                if (!created.Success)
                {
                    var d = $"Zoho code {created.ZohoCode}: {created.Message}";
                    results.Add(new(b.BillNumber, created.Retryable ? "Stopped" : "Failed", d, b.TotalAmount));
                    if (created.Retryable) return results;
                    await SaveAsync(b, "Failed", null, null, d, ct); continue;
                }
                invId = created.Data!.InvoiceId; zTotal = created.Data.Total; note = "created";
                await SaveAsync(b, "Created", invId, zTotal, "draft created in Zoho Books, not yet marked Sent", ct);
            }
            // a draft does not move stock: mark it Sent (section 7.2)
            var sent = await client.MarkInvoiceSentAsync(invId!, ct);
            if (!sent.Success)
            {
                var d = $"invoice {invId} exists as a draft but marking it Sent failed - Zoho code {sent.ZohoCode}: {sent.Message}. Run the push for this bill again.";
                await SaveAsync(b, "Created", invId, zTotal, d, ct); results.Add(new(b.BillNumber, "DraftOnly", d, b.TotalAmount, zTotal, invId));
                if (sent.Retryable) return results; continue;
            }
            var agree = zTotal is null || ZohoInvoiceBuilder.TotalsAgree(b.TotalAmount, zTotal.Value);
            note = agree ? note + " and marked Sent" : $"{note} and marked Sent, but Zoho total {zTotal} differs from DMS total {b.TotalAmount} by more than Rs 1 - check the bill";
            await SaveAsync(b, "Sent", invId, zTotal, note, ct);
            results.Add(new(b.BillNumber, agree ? "Sent" : "SentTotalDiffers", note, b.TotalAmount, zTotal, invId));
        }
        return results;
    }

    private Task SaveAsync(BillRow b, string status, string? zohoId, decimal? zohoTotal, string detail, CancellationToken ct) =>
        _db.Database.ExecuteSqlRawAsync(@"IF EXISTS (SELECT 1 FROM dbo.ZohoInvoicePush WHERE BillId = @id)
 UPDATE dbo.ZohoInvoicePush SET Status = @st, ZohoInvoiceId = @z, DmsTotal = @dt, ZohoTotal = @zt, Detail = @d, UpdatedAt = SYSUTCDATETIME() WHERE BillId = @id
ELSE INSERT INTO dbo.ZohoInvoicePush (BillId, BillNumber, Status, ZohoInvoiceId, DmsTotal, ZohoTotal, Detail) VALUES (@id, @bn, @st, @z, @dt, @zt, @d)",
            new[] {
                new Microsoft.Data.SqlClient.SqlParameter("@id", b.Id), new Microsoft.Data.SqlClient.SqlParameter("@bn", b.BillNumber), new Microsoft.Data.SqlClient.SqlParameter("@st", status),
                new Microsoft.Data.SqlClient.SqlParameter("@z", (object?)zohoId ?? DBNull.Value), new Microsoft.Data.SqlClient.SqlParameter("@dt", b.TotalAmount),
                new Microsoft.Data.SqlClient.SqlParameter("@zt", (object?)zohoTotal ?? DBNull.Value), new Microsoft.Data.SqlClient.SqlParameter("@d", detail.Length > 2000 ? detail[..2000] : detail) }, ct);
}
