using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services.Integrations;

public class MockNotificationClient : IntegrationClientBase, INotificationClient
{
    private readonly JobCardScannerDbContext _db;
    private readonly ILogger<MockNotificationClient> _logger;

    public MockNotificationClient(JobCardScannerDbContext db, ILogger<MockNotificationClient> logger) : base(db, logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<bool> SendAsync(NotificationChannel channel, string recipient, string message, string? subject = null, string? templateKey = null, Guid? jobCardId = null, Guid? customerId = null)
    {
        var record = new NotificationRecord
        {
            Channel = channel,
            TemplateKey = templateKey,
            RecipientAddress = recipient,
            Content = message,
            JobCardId = jobCardId,
            CustomerId = customerId,
            Status = NotificationStatus.Pending,
        };
        _db.NotificationRecords.Add(record);
        await _db.SaveChangesAsync();

        var sent = await ExecuteAsync(IntegrationSystem.Notification, $"POST /send/{channel}".ToLowerInvariant(), new { recipient, subject, message }, async () =>
        {
            await SimulateLatencyAsync();
            _logger.LogInformation("[MOCK {Channel}] to {Recipient}: {Subject}{Message}", channel, recipient, subject is null ? "" : subject + " - ", message);
            return true;
        });

        record.Status = sent ? NotificationStatus.Sent : NotificationStatus.Failed;
        record.SentAt = sent ? DateTime.UtcNow : null;
        await _db.SaveChangesAsync();
        return sent;
    }
}
