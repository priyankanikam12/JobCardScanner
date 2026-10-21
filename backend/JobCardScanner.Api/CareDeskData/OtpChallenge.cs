using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class OtpChallenge
{
    public long Id { get; set; }

    public Guid UserId { get; set; }

    public string Email { get; set; } = null!;

    public string OtpHash { get; set; } = null!;

    public string Channel { get; set; } = null!;

    public DateTimeOffset ExpiresAt { get; set; }

    public short Attempts { get; set; }

    public DateTimeOffset? ConsumedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public virtual User User { get; set; } = null!;
}
