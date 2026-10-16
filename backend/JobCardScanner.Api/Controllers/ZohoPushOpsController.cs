using System.Security.Cryptography;
using System.Text;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-14 ("for bearer token generate api give"): BGauss cannot hand out the staff bearer token itself - it is issued by Microsoft when someone signs in - so the push's operator controls are ALSO
/// available here with an API key instead of a token, for testing from Postman / curl and for a scheduled task. Same actions as ZohoPushController (status, run, retry-failed, load-customers,
/// load-items) but authenticated by the header  X-API-Key: &lt;ApiKeys:ZohoPushAdmin&gt;  - a DEDICATED key (not the Zoho key, not the Internal key) that only opens these five push controls. Not configured =
/// 503 for every call (fails closed). Keep the key secret: anyone who holds it can see the push queue and trigger sends. Route: /api/zoho-push-ops/...
/// </summary>
[ApiController]
[Route("api/zoho-push-ops")]
[AllowAnonymous]
public class ZohoPushOpsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<ZohoPushOpsController> _logger;

    public ZohoPushOpsController(JobCardScannerDbContext db, IConfiguration config, ILogger<ZohoPushOpsController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
        ZohoPushStore.Configure(config);
    }

    private IActionResult? CheckKey()
    {
        var configured = _config["ApiKeys:ZohoPushAdmin"];
        if (string.IsNullOrWhiteSpace(configured))
            return StatusCode(503, new { message = "ApiKeys:ZohoPushAdmin is not set in appsettings.json, so these controls are switched off." });
        if (!Request.Headers.TryGetValue("X-API-Key", out var provided)) return Unauthorized(new { message = "Missing X-API-Key." });
        var a = Encoding.UTF8.GetBytes(provided.ToString());
        var b = Encoding.UTF8.GetBytes(configured);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b) ? null : Unauthorized(new { message = "Invalid X-API-Key." });
    }

    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        try
        {
            var counts = await ZohoPushStore.CountsAsync(_db, ct);
            var failures = await ZohoPushStore.RecentFailuresAsync(_db, 20, ct);
            return Ok(new
            {
                enabled = _config.GetValue("ZohoPush:Enabled", false),
                configured = ZohoPushDispatcher.IsConfigured(_config),
                provider = _config["ZohoPush:Provider"] ?? "generic",
                paused = ZohoPushDispatcher.PauseReason is not null,
                pauseReason = ZohoPushDispatcher.PauseReason,
                baseUrl = _config["ZohoPush:BaseUrl"],
                counts = counts.Select(c => new { c.Status, c.EntityType, c.Events }),
                recentFailures = failures,
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Could not read the push queue (has sql/2026-10-14_zoho_push_outbox.sql been run?): {ex.GetBaseException().Message}" });
        }
    }

    [HttpPost("run")]
    public async Task<IActionResult> Run(CancellationToken ct)
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        if (!ZohoPushDispatcher.IsConfigured(_config))
            return BadRequest(new { message = "The push is not enabled: set ZohoPush:Enabled = true and ZohoPush:BaseUrl (or, for Zoho Books, ZohoPush:Provider = ZohoBooks and ZohoPush:ItemsUrl). Events are still being queued meanwhile." });
        var (sent, failed) = await ZohoPushDispatcher.RunOnceAsync(_db, _config, _logger, ct);
        return Ok(new { sent, failed });
    }

    [HttpPost("retry-failed")]
    public async Task<IActionResult> RetryFailed(CancellationToken ct)
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        return Ok(new { requeued = await ZohoPushStore.RetryFailedAsync(_db, ct) });
    }

    /// <summary>After Learnall confirms the Zoho endpoint is LIVE (creating items): put every event Zoho only logged in test mode back in the queue, so it is sent for real.</summary>
    [HttpPost("requeue-logged-only")]
    public async Task<IActionResult> RequeueLoggedOnly(CancellationToken ct)
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        return Ok(new { requeued = await ZohoPushStore.RequeueLoggedOnlyAsync(_db, ct) });
    }

    /// <summary>Un-pause the push after a 401 (wrong / old Zoho URL key) once ZohoPush:ItemsUrl has been updated.</summary>
    [HttpPost("resume")]
    public IActionResult Resume()
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        ZohoPushDispatcher.Resume();
        return Ok(new { paused = false });
    }

    [HttpPost("load-customers")]
    public async Task<IActionResult> LoadCustomers([FromQuery] bool confirm = false, CancellationToken ct = default)
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        if (!confirm) return BadRequest(new { message = "This queues every customer for Zoho. Call again with ?confirm=true." });
        return Ok(new { queued = await ZohoPushStore.EnqueueAllCustomersAsync(_db, ct) });
    }

    [HttpPost("load-items")]
    public async Task<IActionResult> LoadItems([FromQuery] bool confirm = false, [FromQuery] string? codes = null, CancellationToken ct = default)
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        var wanted = string.IsNullOrWhiteSpace(codes) ? null : codes.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        // ?codes=A,B,C queues just those items (no confirm needed); without codes it queues EVERY continuing item and needs ?confirm=true
        if (wanted is null && !confirm) return BadRequest(new { message = "This queues every continuing item for Zoho. Call again with ?confirm=true, or give ?codes=ITEM1,ITEM2 to queue only those items." });
        var queued = await ZohoPushStore.EnqueueItemsAsync(_db, null, ct, wanted);
        return Ok(new { queued, heldBack = await ZohoPushStore.CountHeldBackItemsAsync(_db, ct), note = "heldBack = continuing items Zoho Books would reject (price 0, bad HSN, GST ...) - not queued while ZohoPush:SkipInvalidItems is on." });
    }
}