using System.Diagnostics;
using System.Text.Json;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services.Integrations;

/// <summary>
/// Shared retry + audit-logging wrapper used by every mock integration client (ERP, DMS,
/// Notification, OTP). Mirrors the Node prototype's <c>integrationClient.js</c> pattern: every
/// call is logged to <see cref="IntegrationLogEntry"/> (endpoint, request/response, duration,
/// success) and transient failures are retried a couple of times with a short backoff before
/// giving up. Because every client here is a mock (no real external system), "failure" mostly
/// exists to exercise this retry/logging path and to keep the interface realistic for the day
/// a real ERP/DMS/SMS-gateway integration replaces the mock behind the same interface.
/// </summary>
public abstract class IntegrationClientBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ILogger _logger;
    protected readonly Random Rng = new();

    protected IntegrationClientBase(JobCardScannerDbContext db, ILogger logger)
    {
        _db = db;
        _logger = logger;
    }

    protected async Task<T> ExecuteAsync<T>(
        IntegrationSystem system,
        string endpoint,
        object? request,
        Func<Task<T>> action,
        int maxRetries = 2)
    {
        var attempt = 0;
        var sw = Stopwatch.StartNew();
        Exception? lastError = null;

        while (attempt <= maxRetries)
        {
            attempt++;
            try
            {
                var result = await action();
                sw.Stop();
                await LogAsync(system, endpoint, request, result, 200, true, (int)sw.ElapsedMilliseconds, attempt - 1);
                return result;
            }
            catch (Exception ex)
            {
                lastError = ex;
                _logger.LogWarning(ex, "Integration call {System}/{Endpoint} failed on attempt {Attempt}", system, endpoint, attempt);
                if (attempt <= maxRetries)
                    await Task.Delay(150 * attempt);
            }
        }

        sw.Stop();
        await LogAsync(system, endpoint, request, new { error = lastError?.Message }, 500, false, (int)sw.ElapsedMilliseconds, attempt - 1);
        throw lastError ?? new InvalidOperationException($"Integration call to {system}/{endpoint} failed.");
    }

    private async Task LogAsync(IntegrationSystem system, string endpoint, object? request, object? response, int statusCode, bool success, int durationMs, int retryCount)
    {
        try
        {
            _db.IntegrationLogEntries.Add(new IntegrationLogEntry
            {
                System = system,
                Direction = IntegrationDirection.Outbound,
                Endpoint = endpoint,
                RequestJson = request is null ? null : JsonSerializer.Serialize(request),
                ResponseJson = response is null ? null : JsonSerializer.Serialize(response),
                StatusCode = statusCode,
                Success = success,
                DurationMs = durationMs,
                RetryCount = retryCount,
            });
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // Never let audit logging itself break the caller's flow.
            _logger.LogError(ex, "Failed to write IntegrationLogEntry for {System}/{Endpoint}", system, endpoint);
        }
    }

    /// <summary>Simulated network latency so the mock feels like a real external call.</summary>
    protected Task SimulateLatencyAsync() => Task.Delay(Rng.Next(30, 150));
}
