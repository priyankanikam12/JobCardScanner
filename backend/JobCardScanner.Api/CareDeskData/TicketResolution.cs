using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketResolution
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public bool Repaired { get; set; }

    public bool PartReplaced { get; set; }

    public bool SwUpdated { get; set; }

    public bool TechnicianEducated { get; set; }

    public string? ReplacedPartCode { get; set; }

    public string? NewSerialNo { get; set; }

    public string? SwVersion { get; set; }

    public string? JobCardNo { get; set; }

    public string? Notes { get; set; }

    public Guid ResolvedBy { get; set; }

    public DateTimeOffset ResolvedAt { get; set; }

    public virtual User ResolvedByNavigation { get; set; } = null!;

    public virtual Ticket Ticket { get; set; } = null!;
}
