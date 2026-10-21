using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class UserSession
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public string TokenHash { get; set; } = null!;

    public string LoginMethod { get; set; } = null!;

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset LastSeenAt { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }

    public string? RevokeReason { get; set; }

    public string? UserAgent { get; set; }

    public string? Ip { get; set; }

    public virtual User User { get; set; } = null!;
}
