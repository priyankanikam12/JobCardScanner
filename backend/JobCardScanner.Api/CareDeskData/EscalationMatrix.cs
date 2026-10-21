using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class EscalationMatrix
{
    public int Id { get; set; }

    public Guid? CustomerId { get; set; }

    public short? CityId { get; set; }

    public string Level { get; set; } = null!;

    public Guid PrimaryUserId { get; set; }

    public Guid? BackupUserId { get; set; }

    public virtual User? BackupUser { get; set; }

    public virtual City? City { get; set; }

    public virtual Customer? Customer { get; set; }

    public virtual User PrimaryUser { get; set; } = null!;
}
