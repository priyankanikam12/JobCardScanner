namespace JobCardScanner.Api.Services;

public interface IAuditLogService
{
    Task LogAsync(string action, string entityType, string? entityId = null, object? details = null);
}
