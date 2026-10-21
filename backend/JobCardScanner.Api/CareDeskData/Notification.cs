using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class Notification
{
    public long Id { get; set; }

    public Guid? TicketId { get; set; }

    public Guid? RecipientId { get; set; }

    public string Channel { get; set; } = null!;

    public string TemplateCode { get; set; } = null!;

    public string? Payload { get; set; }

    public string Status { get; set; } = null!;

    public string? ProviderRef { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? SentAt { get; set; }

    public DateTimeOffset? ReadAt { get; set; }

    public virtual ICollection<EmailOutbox> EmailOutboxes { get; set; } = new List<EmailOutbox>();

    public virtual ICollection<PushOutbox> PushOutboxes { get; set; } = new List<PushOutbox>();

    public virtual User? Recipient { get; set; }

    public virtual Ticket? Ticket { get; set; }
}
