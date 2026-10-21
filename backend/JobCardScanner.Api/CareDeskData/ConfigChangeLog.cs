using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class ConfigChangeLog
{
    public long Id { get; set; }

    public string TableName { get; set; } = null!;

    public string RowKey { get; set; } = null!;

    public string? OldValue { get; set; }

    public string? NewValue { get; set; }

    public Guid? ChangedBy { get; set; }

    public DateTimeOffset ChangedAt { get; set; }

    public virtual User? ChangedByNavigation { get; set; }
}
