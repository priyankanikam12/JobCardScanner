using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services.Integrations;

/// <summary>
/// Swappable multi-channel customer/staff communication client (SMS, WhatsApp, Email, Push).
/// The mock implementation "sends" by writing a <see cref="NotificationRecord"/> row and
/// logging to the console, so the whole notification lifecycle (job card opened, estimate
/// ready, additional-work approval OTP, ready-for-delivery, invoice link, etc.) is fully
/// exercisable and visible in the Admin > Notifications log without a real gateway.
/// </summary>
public interface INotificationClient
{
    Task<bool> SendAsync(NotificationChannel channel, string recipient, string message, string? subject = null, string? templateKey = null, Guid? jobCardId = null, Guid? customerId = null);
}
