using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-14 ("we want PUSH API ... make push api"): admin controls for the BGauss -> Zoho push (see ZohoPushDispatcher for how events are sent and ZohoPushStore for what is queued).
/// CorporateAdmin / SystemAdmin only.
///   GET  /api/zoho-push/status          - is it enabled / configured, how many events are Pending / Sent / Failed, and the latest failures with Zoho's answer.
///   POST /api/zoho-push/run             - send the due events now (instead of waiting for the background cycle).
///   POST /api/zoho-push/retry-failed    - put every Failed event back to Pending (after Zoho fixed what it rejected).
///   POST /api/zoho-push/load-customers?confirm=true - initial load: queue EVERY active Party / Insurance customer of the in-scope dealers as customer.created.
///   POST /api/zoho-push/load-items?confirm=true     - initial load: queue EVERY continuing item as item.created.
/// The initial loads need confirm=true because they queue thousands of events; run each once, after Zoho's endpoint is ready, then Run (or wait).
/// </summary>
[ApiController]
[Route("api/zoho-push")]
[Authorize(Policy = Policies.CorporateAdminUp)]
public class ZohoPushController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<ZohoPushController> _logger;

    public ZohoPushController(JobCardScannerDbContext db, IConfiguration config, ILogger<ZohoPushController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
        ZohoPushStore.Configure(config);
    }

    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
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
        if (!ZohoPushDispatcher.IsConfigured(_config))
            return BadRequest(new { message = "The push is not enabled: set ZohoPush:Enabled = true and ZohoPush:BaseUrl (or, for Zoho Books, ZohoPush:Provider = ZohoBooks and ZohoPush:ItemsUrl). Events are still being queued meanwhile." });
        var (sent, failed) = await ZohoPushDispatcher.RunOnceAsync(_db, _config, _logger, ct);
        return Ok(new { sent, failed });
    }

    [HttpPost("retry-failed")]
    public async Task<IActionResult> RetryFailed(CancellationToken ct) => Ok(new { requeued = await ZohoPushStore.RetryFailedAsync(_db, ct) });

    /// <summary>After Learnall confirms the Zoho endpoint is LIVE (creating items): put every event Zoho only logged in test mode back in the queue, so it is sent for real.</summary>
    [HttpPost("requeue-logged-only")]
    public async Task<IActionResult> RequeueLoggedOnly(CancellationToken ct)
    {
        return Ok(new { requeued = await ZohoPushStore.RequeueLoggedOnlyAsync(_db, ct) });
    }

    /// <summary>Un-pause the push after a 401 (wrong / old Zoho URL key) once ZohoPush:ItemsUrl has been updated.</summary>
    [HttpPost("resume")]
    public IActionResult Resume()
    {
        ZohoPushDispatcher.Resume();
        return Ok(new { paused = false });
    }

    [HttpPost("load-customers")]
    public async Task<IActionResult> LoadCustomers([FromQuery] bool confirm = false, CancellationToken ct = default)
    {
        if (!confirm) return BadRequest(new { message = "This queues every customer for Zoho. Call again with ?confirm=true." });
        return Ok(new { queued = await ZohoPushStore.EnqueueAllCustomersAsync(_db, ct) });
    }

    [HttpPost("load-items")]
    public async Task<IActionResult> LoadItems([FromQuery] bool confirm = false, [FromQuery] string? codes = null, CancellationToken ct = default)
    {
        var wanted = string.IsNullOrWhiteSpace(codes) ? null : codes.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        // ?codes=A,B,C queues just those items (no confirm needed); without codes it queues EVERY continuing item and needs ?confirm=true
        if (wanted is null && !confirm) return BadRequest(new { message = "This queues every continuing item for Zoho. Call again with ?confirm=true, or give ?codes=ITEM1,ITEM2 to queue only those items." });
        var queued = await ZohoPushStore.EnqueueItemsAsync(_db, null, ct, wanted);
        return Ok(new { queued, heldBack = await ZohoPushStore.CountHeldBackItemsAsync(_db, ct), note = "heldBack = continuing items Zoho Books would reject (price 0, bad HSN, GST ...) - not queued while ZohoPush:SkipInvalidItems is on." });
    }
}