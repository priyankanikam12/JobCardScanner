using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-14 ("405 Method Not Allowed ... use POST"): a TEST RECEIVER for the BGauss -> Zoho push, so the push can be tried end to end before Zoho's own endpoint exists. Pointing ZohoPush:BaseUrl at
/// /api/zoho gives 405, because /api/zoho/items only answers GET (and /api/zoho/customers POST is the "add a customer" call, which expects a different body) - those are the PULL / write APIs, not a place
/// to receive pushes. This controller accepts the pushed events with POST, exactly as Zoho's endpoint should:
///   POST /api/zoho-push-sink/customers   POST /api/zoho-push-sink/items   - answer 200 { received, eventId } (a repeated eventId answers 200 { duplicate: true }).
///   GET  /api/zoho-push-sink/received                                        - the last 50 events received (kept in memory only, lost on restart).
/// Test setup:  "ZohoPush": { "Enabled": true, "BaseUrl": "https://dms.bgauss.com/api/zoho-push-sink", "Headers": { "X-API-Key": "<the Zoho key>" } }  and  "ZohoPush": { "TestSinkEnabled": true }.
/// Authentication = X-API-Key equal to ApiKeys:Zoho. If ZohoPush:SigningSecret is set, the X-BGauss-Signature header is checked too and the result is shown in /received (signatureValid).
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

    public ZohoPushSinkController(IConfiguration config) { _config = config; }

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
        while (Received.Count > Keep && Received.TryDequeue(out _)) { }
        return Ok(new { received = true, eventId });
    }

    [HttpGet("received")]
    public IActionResult ReceivedEvents()
    {
        var denied = Guard();
        if (denied is not null) return denied;
        return Ok(Received.Reverse());
    }
}