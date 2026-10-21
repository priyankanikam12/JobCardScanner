using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class PushSubscription
{
    public long Id { get; set; }

    public Guid UserId { get; set; }

    public string Endpoint { get; set; } = null!;

    public string P256dhKey { get; set; } = null!;

    public string AuthKey { get; set; } = null!;

    public string? UserAgent { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? LastOkAt { get; set; }

    public bool IsActive { get; set; }

    public DateTimeOffset? EndedAt { get; set; }

    public string? EndedReason { get; set; }

    public virtual User User { get; set; } = null!;
}
