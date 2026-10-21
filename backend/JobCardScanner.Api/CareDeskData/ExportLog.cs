using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class ExportLog
{
    public long Id { get; set; }

    public Guid UserId { get; set; }

    public DateTimeOffset At { get; set; }

    public string Source { get; set; } = null!;

    public string Filter { get; set; } = null!;

    public int Rows { get; set; }

    public string FileName { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
