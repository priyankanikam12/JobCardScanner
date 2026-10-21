using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class UserLink
{
    public long Id { get; set; }

    public Guid UserId { get; set; }

    public string Purpose { get; set; } = null!;

    public string TokenHash { get; set; } = null!;

    public Guid? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }

    public DateTimeOffset? UsedAt { get; set; }

    public virtual User? CreatedByNavigation { get; set; }

    public virtual User User { get; set; } = null!;
}
