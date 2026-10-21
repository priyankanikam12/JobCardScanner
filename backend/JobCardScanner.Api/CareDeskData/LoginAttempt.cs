using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class LoginAttempt
{
    public long Id { get; set; }

    public string LoginId { get; set; } = null!;

    public Guid? UserId { get; set; }

    public string Kind { get; set; } = null!;

    public bool Success { get; set; }

    public string? Ip { get; set; }

    public DateTimeOffset At { get; set; }

    public virtual User? User { get; set; }
}
