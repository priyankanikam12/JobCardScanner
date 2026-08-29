using System.Security.Cryptography;
using System.Text;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services.Integrations;

/// <summary>
/// OTP generation/verification for the additional-work approval and job-card closure flows,
/// and for customer tracking-portal login. Codes are never stored in plaintext - only a
/// SHA-256 hash - and are dispatched through <see cref="INotificationClient"/> (SMS mock).
/// </summary>
public class OtpService : IntegrationClientBase, IOtpService
{
    private const int CodeLength = 6;
    private const int ExpiryMinutes = 10;
    private const int MaxAttempts = 5;

    private readonly JobCardScannerDbContext _db;
    private readonly INotificationClient _notifications;
    private readonly IEmailClient _email;
    private readonly IHostEnvironment _env;
    private readonly ILogger<OtpService> _logger;

    public OtpService(JobCardScannerDbContext db, INotificationClient notifications, IEmailClient email, IHostEnvironment env, ILogger<OtpService> logger) : base(db, logger)
    {
        _db = db;
        _notifications = notifications;
        _email = email;
        _env = env;
        _logger = logger;
    }

    public async Task<OtpIssueResult> IssueOtpAsync(OtpPurpose purpose, string mobile, Guid? jobCardId = null, Guid? estimateId = null, string? email = null)
    {
        var code = RandomNumberGenerator.GetInt32(0, (int)Math.Pow(10, CodeLength)).ToString($"D{CodeLength}");
        var request = new OtpRequest
        {
            Purpose = purpose,
            Mobile = mobile,
            JobCardId = jobCardId,
            EstimateId = estimateId,
            OtpHash = Hash(code),
            ExpiresAt = DateTime.UtcNow.AddMinutes(ExpiryMinutes),
        };
        _db.OtpRequests.Add(request);
        await _db.SaveChangesAsync();

        var purposeLabel = purpose switch
        {
            OtpPurpose.CustomerPortalLogin => "log in to your JobCardScanner tracking portal",
            OtpPurpose.EstimateApproval => "approve the additional work estimate",
            OtpPurpose.JobCardClosure => "confirm job card closure",
            _ => "verify your request",
        };
        await _notifications.SendAsync(NotificationChannel.Sms, mobile,
            $"Your JobCardScanner OTP to {purposeLabel} is {code}. Valid for {ExpiryMinutes} minutes. Do not share this code.",
            templateKey: $"otp.{purpose}", jobCardId: jobCardId);

        // Additive channel, not a replacement for SMS above - see IEmailClient.SendAsync, which
        // never throws, so a Graph/Mail.Send misconfiguration can only mean this OTP didn't also
        // land in an inbox, never that SMS delivery (or the OtpRequest itself) was affected.
        if (!string.IsNullOrWhiteSpace(email))
        {
            var sent = await _email.SendAsync(email,
                $"Your JobCardScanner OTP: {code}",
                $"<p>Your JobCardScanner OTP to {purposeLabel} is <strong style=\"font-size:18px;letter-spacing:2px;\">{code}</strong>.</p>" +
                $"<p>Valid for {ExpiryMinutes} minutes. Do not share this code with anyone.</p>");
            if (!sent) _logger.LogInformation("Email OTP not sent to {Email} for {Purpose} (see prior warning, if any) - SMS was still sent.", email, purpose);
        }

        return new OtpIssueResult(request.Id, _env.IsDevelopment() ? code : null);
    }

    public async Task<bool> VerifyOtpAsync(Guid otpRequestId, string code)
    {
        var request = await _db.OtpRequests.FirstOrDefaultAsync(x => x.Id == otpRequestId);
        if (request is null) return false;
        if (request.VerifiedAt is not null) return true; // idempotent re-check
        if (request.Attempts >= MaxAttempts || request.ExpiresAt < DateTime.UtcNow) return false;

        request.Attempts++;
        var matches = request.OtpHash == Hash(code);
        if (matches) request.VerifiedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return matches;
    }

    private static string Hash(string code)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(code));
        return Convert.ToHexString(bytes);
    }
}