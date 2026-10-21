using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class Vehicle
{
    public Guid Id { get; set; }

    public string Vin { get; set; } = null!;

    public string? RegNo { get; set; }

    public string? RegLast4 { get; set; }

    public short ModelId { get; set; }

    public string? MotorNo { get; set; }

    public string? BatteryNo { get; set; }

    public string? ChargerNo { get; set; }

    public Guid CustomerId { get; set; }

    public Guid? HubId { get; set; }

    public short CityId { get; set; }

    public DateOnly SaleDate { get; set; }

    public DateOnly? WarrantyTill { get; set; }

    public string? IotDeviceId { get; set; }

    public bool IsActive { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public virtual City City { get; set; } = null!;

    public virtual Customer Customer { get; set; } = null!;

    public virtual Hub? Hub { get; set; }

    public virtual ICollection<IotFaultEvent> IotFaultEvents { get; set; } = new List<IotFaultEvent>();

    public virtual ICollection<IotSnapshot> IotSnapshots { get; set; } = new List<IotSnapshot>();

    public virtual VehicleModel Model { get; set; } = null!;

    public virtual Ticket? Ticket { get; set; }

    public virtual ICollection<VehicleAssignmentHistory> VehicleAssignmentHistories { get; set; } = new List<VehicleAssignmentHistory>();
}
