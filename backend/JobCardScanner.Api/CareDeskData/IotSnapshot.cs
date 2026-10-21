using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class IotSnapshot
{
    public long Id { get; set; }

    public Guid VehicleId { get; set; }

    public string Provider { get; set; } = null!;

    public DateTimeOffset CapturedAt { get; set; }

    public DateTimeOffset ReceivedAt { get; set; }

    public decimal? OdometerKm { get; set; }

    public decimal? SocPct { get; set; }

    public decimal? Latitude { get; set; }

    public decimal? Longitude { get; set; }

    public string? Raw { get; set; }

    public virtual Vehicle Vehicle { get; set; } = null!;
}
