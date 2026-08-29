using System.Text.Json;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services;

/// <summary>Writes enterprise-security audit trail entries, attributing actions to the caller
/// resolved by <see cref="ICurrentUserService"/> (staff) and the request's client IP.</summary>
public class AuditLogService : IAuditLogService
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IHttpContextAccessor _http;

    public AuditLogService(JobCardScannerDbContext db, ICurrentUserService currentUser, IHttpContextAccessor http)
    {
        _db = db;
        _currentUser = currentUser;
        _http = http;
    }

    public async Task LogAsync(string action, string entityType, string? entityId = null, object? details = null)
    {
        _db.AuditLogEntries.Add(new AuditLogEntry
        {
            UserId = _currentUser.UserId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            DetailsJson = details is null ? null : JsonSerializer.Serialize(details),
            IpAddress = _http.HttpContext?.Connection.RemoteIpAddress?.ToString(),
        });
        await _db.SaveChangesAsync();
    }
}
