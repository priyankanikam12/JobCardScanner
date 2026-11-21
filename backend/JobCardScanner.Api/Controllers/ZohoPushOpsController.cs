using System.Security.Cryptography;
using System.Text;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

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
    public async Task<IActionResult> LoadItems([FromQuery] bool confirm = false, [FromQuery] string? codes = null, [FromQuery] bool force = false, CancellationToken ct = default)
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        var wanted = string.IsNullOrWhiteSpace(codes) ? null : codes.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        // ?codes=A,B,C queues just those items (no confirm needed); without codes it queues EVERY continuing item and needs ?confirm=true
        if (wanted is null && !confirm) return BadRequest(new { message = "This queues every continuing item for Zoho. Call again with ?confirm=true, or give ?codes=ITEM1,ITEM2 to queue only those items." });
        // 2026-11-21 ?force=true (needs ?codes=): also queues listed items that are discontinued (status N) or whose name starts with A2 / B8 - the Zoho field rules still apply
        if (force && wanted is null) return BadRequest(new { message = "force=true only works together with ?codes=ITEM1,ITEM2 (it never queues the whole item master)." });
        var queued = await ZohoPushStore.EnqueueItemsAsync(_db, null, ct, wanted, force);
        return Ok(new { queued, heldBack = await ZohoPushStore.CountHeldBackItemsAsync(_db, ct), note = "heldBack = continuing items Zoho Books would reject (price 0, bad HSN, GST ...) - not queued while ZohoPush:SkipInvalidItems is on." });
    }

    /// <summary>
    /// 2026-11-20 invoice push. DRY RUN is the default: builds and checks the invoice of each waiting Billed bill (reads items / customers in Zoho, sends nothing).
    /// Live send needs ZohoInvoicePush:Enabled = true AND dryRun=false AND confirm=true. Use ?billNumber=... for one bill; ?max= limits the batch (default 1).
    /// </summary>
    [HttpPost("invoice-push")]
    public async Task<IActionResult> InvoicePush([FromQuery] string? billNumber = null, [FromQuery] bool dryRun = true, [FromQuery] bool confirm = false, [FromQuery] int max = 1, CancellationToken ct = default)
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        if (!dryRun)
        {
            if (!ZohoInvoicePushService.Enabled(_config)) return BadRequest(new { message = "ZohoInvoicePush:Enabled is false, so no invoice is sent. A dry run is still allowed (dryRun=true)." });
            if (!confirm) return BadRequest(new { message = "A live send needs confirm=true as well." });
        }
        try
        {
            var svc = new ZohoInvoicePushService(_db, _config, HttpContext.RequestServices.GetRequiredService<JobCardScanner.Api.Services.Zoho.ZohoBooksApiClient>());
            var results = await svc.RunAsync(billNumber, dryRun, Math.Clamp(max, 1, 500), ct);
            return Ok(new { dryRun, count = results.Count, results = results.Select(r => new { r.BillNumber, r.Result, r.Detail, r.DmsTotal, r.ZohoTotal, r.ZohoInvoiceId, payload = dryRun ? r.Payload : null }) });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Invoice push failed (has sql/2026-11-20_zoho_invoice_push.sql been run?): {ex.GetBaseException().Message}" });
        }
    }

    /// <summary>
    /// 2026-11-20 inventory adjustment push (source dbo.PartUploads, one location per call). DRY RUN is the default. Live needs ZohoAdjustmentPush:Enabled = true AND dryRun=false AND confirm=true.
    /// </summary>
    [HttpPost("adjustment-push")]
    public async Task<IActionResult> AdjustmentPush([FromQuery] string locationCode = "", [FromQuery] bool dryRun = true, [FromQuery] bool confirm = false, CancellationToken ct = default)
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        if (!dryRun)
        {
            if (!ZohoAdjustmentPushService.Enabled(_config)) return BadRequest(new { message = "ZohoAdjustmentPush:Enabled is false, so no adjustment is sent. A dry run is still allowed (dryRun=true)." });
            if (!confirm) return BadRequest(new { message = "A live send needs confirm=true as well." });
        }
        try
        {
            var svc = new ZohoAdjustmentPushService(_db, _config, HttpContext.RequestServices.GetRequiredService<JobCardScanner.Api.Services.Zoho.ZohoBooksApiClient>());
            var r = await svc.RunAsync(locationCode, dryRun, ct);
            return Ok(new { dryRun, r.Result, r.Detail, r.Reference, r.Lines, r.NetQty, r.ZohoAdjustmentId, skipped = r.Skipped, payload = dryRun ? r.Payload : null });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Adjustment push failed (has sql/2026-11-20_zoho_adjustment_push.sql been run?): {ex.GetBaseException().Message}" });
        }
    }

    [HttpGet("adjustment-status")]
    public async Task<IActionResult> AdjustmentStatus(CancellationToken ct)
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        try
        {
            var rows = await _db.Database.SqlQueryRaw<ZohoInvoicePushService.StrRow>("SELECT Status + N': ' + CAST(COUNT(*) AS NVARCHAR(10)) AS Value FROM dbo.ZohoAdjustmentPush GROUP BY Status").ToListAsync(ct);
            return Ok(new { enabled = ZohoAdjustmentPushService.Enabled(_config), stored = rows.Select(x => x.Value) });
        }
        catch (Exception ex) { return StatusCode(500, new { message = ex.GetBaseException().Message }); }
    }

    [HttpGet("invoice-status")]
    public async Task<IActionResult> InvoiceStatus(CancellationToken ct)
    {
        var denied = CheckKey();
        if (denied is not null) return denied;
        try
        {
            var waiting = (await new ZohoInvoicePushService(_db, _config, HttpContext.RequestServices.GetRequiredService<JobCardScanner.Api.Services.Zoho.ZohoBooksApiClient>()).LoadBillsAsync(null, ct)).Count;
            var sent = await _db.Database.SqlQueryRaw<ZohoInvoicePushService.StrRow>("SELECT Status + N': ' + CAST(COUNT(*) AS NVARCHAR(10)) AS Value FROM dbo.ZohoInvoicePush GROUP BY Status").ToListAsync(ct);
            return Ok(new { enabled = ZohoInvoicePushService.Enabled(_config), waitingBilledBills = waiting, stored = sent.Select(x => x.Value) });
        }
        catch (Exception ex) { return StatusCode(500, new { message = ex.GetBaseException().Message }); }
    }
}
