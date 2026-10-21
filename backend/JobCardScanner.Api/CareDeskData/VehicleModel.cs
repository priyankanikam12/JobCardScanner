using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class VehicleModel
{
    public short Id { get; set; }

    public string Name { get; set; } = null!;

    public bool IsActive { get; set; }

    public virtual ICollection<Vehicle> Vehicles { get; set; } = new List<Vehicle>();

    public virtual ICollection<WarrantyPolicy> WarrantyPolicies { get; set; } = new List<WarrantyPolicy>();
}
