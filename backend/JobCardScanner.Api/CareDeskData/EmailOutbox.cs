using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class EmailOutbox
{
    public long Id { get; set; }

    public long? NotificationId { get; set; }

    public string EventKey { get; set; } = null!;

    public Guid RecipientId { get; set; }

    public string? ToEmail { get; set; }

    public string TemplateCode { get; set; } = null!;

    public Guid? TicketId { get; set; }

    public string Details { get; set; } = null!;

    public string Status { get; set; } = null!;

    public short Attempts { get; set; }

    public DateTimeOffset NextAttemptAt { get; set; }

    public DateTimeOffset? LastAttemptAt { get; set; }

    public string? LastError { get; set; }

    public string? Subject { get; set; }

    public string? ProviderRef { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? SentAt { get; set; }

    public virtual Notification? Notification { get; set; }

    public virtual User Recipient { get; set; } = null!;

    public virtual Ticket? Ticket { get; set; }
}
