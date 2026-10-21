using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class Hub
{
    public Guid Id { get; set; }

    public Guid CustomerId { get; set; }

    public short CityId { get; set; }

    public string Name { get; set; } = null!;

    public string? Address { get; set; }

    public decimal? Latitude { get; set; }

    public decimal? Longitude { get; set; }

    public string? PinSource { get; set; }

    public Guid? PinSetBy { get; set; }

    public DateTimeOffset? PinSetAt { get; set; }

    public string? ContactName { get; set; }

    public string? ContactMobile { get; set; }

    public bool IsActive { get; set; }

    public virtual City City { get; set; } = null!;

    public virtual Customer Customer { get; set; } = null!;

    public virtual ICollection<Ticket> Tickets { get; set; } = new List<Ticket>();

    public virtual ICollection<Vehicle> Vehicles { get; set; } = new List<Vehicle>();
}
