using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class JobRun
{
    public long Id { get; set; }

    public DateTimeOffset StartedAt { get; set; }

    public DateTimeOffset? FinishedAt { get; set; }

    public DateTimeOffset ClockAt { get; set; }

    public string Source { get; set; } = null!;

    public string Status { get; set; } = null!;

    public string? Result { get; set; }

    public string? Error { get; set; }
}
