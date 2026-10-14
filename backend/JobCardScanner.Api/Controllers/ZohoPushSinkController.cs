using System.Collections.Concurrent;
using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using JobCardScanner.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-14 ("405 Method Not Allowed ... use POST"): a TEST RECEIVER for the BGauss -> Zoho push, so the push can be tried end to end before Zoho's own endpoint exists. Pointing ZohoPush:BaseUrl at
/// /api/zoho gives 405, because /api/zoho/items only answers GET (and /api/zoho/customers POST is the "add a customer" call, which expects a different body) - those are the PULL / write APIs, not a place
/// to receive pushes. This controller accepts the pushed events with POST, exactly as Zoho's endpoint should:
///   POST /api/zoho-push-sink/customers   POST /api/zoho-push-sink/items   - answer 200 { received, eventId } (a repeated eventId answers 200 { duplicate: true }).
///   POST /api/zoho-push-sink/customers/bulk   POST /api/zoho-push-sink/items/bulk - the BULK mode (ZohoPush:Mode = "bulk"): one POST carries many events; answers 200 { received, duplicates, failed: [] }.
///   GET  /api/zoho-push-sink/received                                        - the last 50 events received (kept in memory only, lost on restart).
/// Test setup:  "ZohoPush": { "Enabled": true, "BaseUrl": "https://dms.bgauss.com/api/zoho-push-sink", "Headers": { "X-API-Key": "<the Zoho key>" } }  and  "ZohoPush": { "TestSinkEnabled": true }.
/// Authentication = X-API-Key equal to ApiKeys:Zoho. If ZohoPush:SigningSecret is set, the X-BGauss-Signature header is checked too and the result is shown in /received (signatureValid).
/// SAVING: by default events are kept in MEMORY only (last 50, lost on restart) - nothing is written to any database. With ZohoPush:SinkSaveToDb = true every accepted event is ALSO saved in
/// dbo.ZohoPushReceived of JobCardScannerDb (sql/2026-10-14_zoho_push_received.sql) and GET /api/zoho-push-sink/received-db lists them. That table stands in for Zoho's own database - for testing only.
/// Switched OFF unless ZohoPush:TestSinkEnabled is true - turn it off again (or remove this file) once Zoho's real endpoint is in use.
/// </summary>
[ApiController]
[Route("api/zoho-push-sink")]
[AllowAnonymous]
public class ZohoPushSinkController : ControllerBase
{
    private static readonly ConcurrentQueue<object> Received = new();
    private static readonly ConcurrentDictionary<string, byte> SeenEventIds = new();
    private const int Keep = 50;

    private readonly IConfiguration _config;
    private readonly JobCardScannerDbContext _db;
    private readonly ILogger<ZohoPushSinkController> _logger;

    public ZohoPushSinkController(IConfiguration config, JobCardScannerDbContext db, ILogger<ZohoPushSinkController> logger) { _config = config; _db = db; _logger = logger; }

    public sealed class ReceivedDbRow
    {
        public long Id { get; set; }
        public DateTime ReceivedAt { get; set; }
        public string EventId { get; set; } = "";
        public string Entity { get; set; } = "";
        public string? EventName { get; set; }
        public string? BatchId { get; set; }
        public bool? SignatureValid { get; set; }
        public string Body { get; set; } = "";
    }

    /// <summary>Only when ZohoPush:SinkSaveToDb is true: saves one accepted event into dbo.ZohoPushReceived (a repeated eventId is skipped). Best-effort - never fails the request.</summary>
    private bool DbSavingOn => _config.GetValue("ZohoPush:SinkSaveToDb", false);

    private async Task<(bool Saved, string? Error)> SaveAsync(string entity, string eventId, string? eventName, string? batchId, bool? signatureValid, string rawJson)
    {
        if (!DbSavingOn) return (false, null);
        try
        {
            await _db.Database.ExecuteSqlRawAsync(
                @"IF NOT EXISTS (SELECT 1 FROM [dbo].[ZohoPushReceived] WHERE [EventId] = @e)
                    INSERT INTO [dbo].[ZohoPushReceived] ([EventId], [Entity], [EventName], [BatchId], [SignatureValid], [Body]) VALUES (@e, @t, @n, @b, @s, @p)",
                new object[]
                {
                    new SqlParameter("@e", eventId), new SqlParameter("@t", entity),
                    new SqlParameter("@n", SqlDbType.NVarChar, 40) { Value = (object?)eventName ?? DBNull.Value },
                    new SqlParameter("@b", SqlDbType.NVarChar, 64) { Value = (object?)batchId ?? DBNull.Value },
                    new SqlParameter("@s", SqlDbType.Bit) { Value = signatureValid.HasValue ? signatureValid.Value : DBNull.Value },
                    new SqlParameter("@p", SqlDbType.NVarChar, -1) { Value = rawJson },
                });
            return (true, null);
        }
        catch (Exception ex)
        {
            // test table missing or DB down: the in-memory copy still works, and the reason is returned in the response (dbSaveError) and logged
            _logger.LogWarning(ex, "Zoho push sink: could not save event {EventId} into dbo.ZohoPushReceived.", eventId);
            return (false, ex.GetBaseException().Message);
        }
    }

    private IActionResult? Guard()
    {
        if (!_config.GetValue("ZohoPush:TestSinkEnabled", false))
            return StatusCode(503, new { message = "The push test receiver is switched off (set ZohoPush:TestSinkEnabled = true)." });
        var key = _config["ApiKeys:Zoho"];
        if (string.IsNullOrWhiteSpace(key)) return StatusCode(503, new { message = "ApiKeys:Zoho is not configured." });
        if (!Request.Headers.TryGetValue("X-API-Key", out var provided)) return Unauthorized(new { message = "Missing X-API-Key." });
        var a = Encoding.UTF8.GetBytes(provided.ToString());
        var b = Encoding.UTF8.GetBytes(key);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b) ? null : Unauthorized(new { message = "Invalid X-API-Key." });
    }

    [HttpPost("customers")]
    public Task<IActionResult> Customers() => Receive("Customer");

    [HttpPost("items")]
    public Task<IActionResult> Items() => Receive("Item");

    [HttpPost("customers/bulk")]
    public Task<IActionResult> CustomersBulk() => ReceiveBulk("Customer");

    [HttpPost("items/bulk")]
    public Task<IActionResult> ItemsBulk() => ReceiveBulk("Item");

    /// <summary>Bulk body: { batchId, entity, event, sentAt, source, count, events: [ { eventId, event, occurredAt, data }, ... ] } - every event is recorded; a repeated eventId is counted as a duplicate.</summary>
    private async Task<IActionResult> ReceiveBulk(string entity)
    {
        var denied = Guard();
        if (denied is not null) return denied;

        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        var body = await reader.ReadToEndAsync();
        JsonDocument doc;
        try { doc = JsonDocument.Parse(body); }
        catch (JsonException) { return BadRequest(new { message = "The body is not valid JSON." }); }
        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object || !doc.RootElement.TryGetProperty("events", out var events) || events.ValueKind != JsonValueKind.Array)
                return BadRequest(new { message = "The body has no events array." });

            bool? signatureValid = null;
            var secret = _config["ZohoPush:SigningSecret"];
            if (!string.IsNullOrEmpty(secret))
            {
                using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
                var expected = "sha256=" + Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
                signatureValid = Request.Headers.TryGetValue("X-BGauss-Signature", out var sig) && string.Equals(sig.ToString(), expected, StringComparison.Ordinal);
            }

            int received = 0, duplicates = 0, savedToDb = 0;
            string? dbSaveError = null;
            var failed = new List<object>();
            var batchId = doc.RootElement.TryGetProperty("batchId", out var b) ? b.GetString() : null;
            foreach (var ev in events.EnumerateArray())
            {
                var eventId = ev.ValueKind == JsonValueKind.Object && ev.TryGetProperty("eventId", out var e) ? e.GetString() : null;
                if (string.IsNullOrWhiteSpace(eventId)) { failed.Add(new { eventId = (string?)null, error = "no eventId" }); continue; }
                if (!SeenEventIds.TryAdd(eventId, 0)) { duplicates++; continue; }
                var raw = ev.GetRawText();
                Received.Enqueue(new
                {
                    receivedAt = DateTime.UtcNow, entity, eventId, @event = ev.TryGetProperty("event", out var n) ? n.GetString() : null,
                    batchId, headerEvent = Request.Headers["X-BGauss-Event"].ToString(), signatureValid,
                    bodyPreview = raw.Length > 600 ? raw[..600] + "..." : raw,
                });
                var (saved, saveError) = await SaveAsync(entity, eventId!, ev.TryGetProperty("event", out var en) ? en.GetString() : null, batchId, signatureValid, raw);
                if (saved) savedToDb++; else dbSaveError ??= saveError;
                received++;
            }
            while (Received.Count > Keep && Received.TryDequeue(out _)) { }
            return Ok(new { received, duplicates, failed, dbSaving = DbSavingOn ? "on" : "off (set ZohoPush:SinkSaveToDb = true)", savedToDb, dbSaveError });
        }
    }

    private async Task<IActionResult> Receive(string entity)
    {
        var denied = Guard();
        if (denied is not null) return denied;

        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        var body = await reader.ReadToEndAsync();
        string? eventId = null, eventName = null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("eventId", out var e)) eventId = e.GetString();
            if (doc.RootElement.TryGetProperty("event", out var n)) eventName = n.GetString();
        }
        catch (JsonException) { return BadRequest(new { message = "The body is not valid JSON." }); }
        if (string.IsNullOrWhiteSpace(eventId)) return BadRequest(new { message = "The body has no eventId." });

        bool? signatureValid = null;
        var secret = _config["ZohoPush:SigningSecret"];
        if (!string.IsNullOrEmpty(secret))
        {
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
            var expected = "sha256=" + Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
            signatureValid = Request.Headers.TryGetValue("X-BGauss-Signature", out var sig) && string.Equals(sig.ToString(), expected, StringComparison.Ordinal);
        }

        if (!SeenEventIds.TryAdd(eventId, 0))
            return Ok(new { received = true, duplicate = true, eventId });

        Received.Enqueue(new
        {
            receivedAt = DateTime.UtcNow, entity, eventId, @event = eventName,
            headerEvent = Request.Headers["X-BGauss-Event"].ToString(), signatureValid,
            bodyPreview = body.Length > 600 ? body[..600] + "..." : body,
        });
        var (savedOne, saveErr) = await SaveAsync(entity, eventId, eventName, null, signatureValid, body);
        while (Received.Count > Keep && Received.TryDequeue(out _)) { }
        return Ok(new { received = true, eventId, dbSaving = DbSavingOn ? "on" : "off (set ZohoPush:SinkSaveToDb = true)", savedToDb = savedOne, dbSaveError = saveErr });
    }

    /// <summary>The last 50 events saved in dbo.ZohoPushReceived (needs ZohoPush:SinkSaveToDb = true and the table).</summary>
    [HttpGet("received-db")]
    public async Task<IActionResult> ReceivedFromDb()
    {
        var denied = Guard();
        if (denied is not null) return denied;
        try
        {
            var rows = await _db.Database.SqlQueryRaw<ReceivedDbRow>(
                @"SELECT TOP (50) [Id] AS Id, [ReceivedAt] AS ReceivedAt, [EventId] AS EventId, [Entity] AS Entity, [EventName] AS EventName, [BatchId] AS BatchId, [SignatureValid] AS SignatureValid, [Body] AS Body
                  FROM [dbo].[ZohoPushReceived] ORDER BY [Id] DESC").ToListAsync();
            return Ok(rows);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Could not read dbo.ZohoPushReceived (run sql/2026-10-14_zoho_push_received.sql): {ex.GetBaseException().Message}" });
        }
    }

    [HttpGet("received")]
    public IActionResult ReceivedEvents()
    {
        var denied = Guard();
        if (denied is not null) return denied;
        return Ok(Received.Reverse());
    }
}