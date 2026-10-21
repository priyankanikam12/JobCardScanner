using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class Attachment
{
    public Guid Id { get; set; }

    public Guid TicketId { get; set; }

    public long? MessageId { get; set; }

    public string Kind { get; set; } = null!;

    public string StorageKey { get; set; } = null!;

    public string MimeType { get; set; } = null!;

    public long? SizeBytes { get; set; }

    public string? OcrValue { get; set; }

    public Guid UploadedBy { get; set; }

    public DateTimeOffset UploadedAt { get; set; }

    public virtual TicketMessage? Message { get; set; }

    public virtual ICollection<SpareReceiptLine> SpareReceiptLines { get; set; } = new List<SpareReceiptLine>();

    public virtual Ticket Ticket { get; set; } = null!;

    public virtual ICollection<TicketPayment> TicketPayments { get; set; } = new List<TicketPayment>();

    public virtual User UploadedByNavigation { get; set; } = null!;
}
