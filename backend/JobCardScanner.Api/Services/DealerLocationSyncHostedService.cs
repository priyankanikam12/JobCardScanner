namespace JobCardScanner.Api.Services;

/// <summary>
/// 2026-11-25: runs the ERP -> JobCardScannerDb dealer location sync (DealerLocationSyncService) on a timer, so a W-series location added in the ERP shows up under its dealer
/// without anybody doing anything. First run 90 seconds after the API starts, then every DealerLocationSync:IntervalMinutes (default 60, minimum 5).
/// Switch off with "DealerLocationSync": { "Enabled": false }. A failed run (ERP unreachable, table not created yet) is logged and tried again next time - it never stops the API.
/// POST /api/dealer-locations/sync (Corporate / System Admin) runs the same sync on demand.
/// </summary>
public class DealerLocationSyncHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IConfiguration _config;
    private readonly ILogger<DealerLocationSyncHostedService> _logger;

    public DealerLocationSyncHostedService(IServiceScopeFactory scopes, IConfiguration config, ILogger<DealerLocationSyncHostedService> logger)
    {
        _scopes = scopes;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_config.GetValue("DealerLocationSync:Enabled", true))
        {
            _logger.LogInformation("Dealer location sync is switched off (DealerLocationSync:Enabled = false).");
            return;
        }
        var interval = TimeSpan.FromMinutes(Math.Max(5, _config.GetValue("DealerLocationSync:IntervalMinutes", 60)));

        try { await Task.Delay(TimeSpan.FromSeconds(90), stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var sync = scope.ServiceProvider.GetRequiredService<IDealerLocationSyncService>();
                await sync.SyncAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Dealer location sync failed - will try again in {Minutes} minutes.", interval.TotalMinutes);
            }

            try { await Task.Delay(interval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}