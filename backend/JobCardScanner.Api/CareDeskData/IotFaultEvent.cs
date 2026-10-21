using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class IotFaultEvent
{
    public long Id { get; set; }

    public Guid VehicleId { get; set; }

    public string Code { get; set; } = null!;

    public DateTimeOffset FirstSeenAt { get; set; }

    public DateTimeOffset LastSeenAt { get; set; }

    public DateTimeOffset? ClearedAt { get; set; }

    public string? Raw { get; set; }

    public virtual Vehicle Vehicle { get; set; } = null!;
}
