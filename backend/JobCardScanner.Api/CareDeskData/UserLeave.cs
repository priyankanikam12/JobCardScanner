using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class UserLeave
{
    public long Id { get; set; }

    public Guid UserId { get; set; }

    public DateOnly StartsOn { get; set; }

    public DateOnly EndsOn { get; set; }

    public Guid? BackupUserId { get; set; }

    public Guid SetBy { get; set; }

    public DateTimeOffset SetAt { get; set; }

    public DateTimeOffset? CancelledAt { get; set; }

    public Guid? CancelledBy { get; set; }

    public DateTimeOffset? StartAlertedAt { get; set; }

    public virtual User? BackupUser { get; set; }

    public virtual User? CancelledByNavigation { get; set; }

    public virtual User SetByNavigation { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
