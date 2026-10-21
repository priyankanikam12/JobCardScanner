using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class ConsentRecord
{
    public long Id { get; set; }

    public Guid UserId { get; set; }

    public string NoticeVersion { get; set; } = null!;

    public DateTimeOffset AcceptedAt { get; set; }

    public virtual User User { get; set; } = null!;
}
