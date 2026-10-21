using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketMessage
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public Guid? AuthorId { get; set; }

    public string Visibility { get; set; } = null!;

    public string? Body { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public virtual ICollection<Attachment> Attachments { get; set; } = new List<Attachment>();

    public virtual User? Author { get; set; }

    public virtual ICollection<MessageRead> MessageReads { get; set; } = new List<MessageRead>();

    public virtual Ticket Ticket { get; set; } = null!;
}
