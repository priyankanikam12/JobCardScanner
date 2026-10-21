using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class UserScope
{
    public Guid UserId { get; set; }

    public short? CityId { get; set; }

    public Guid? CustomerId { get; set; }

    public virtual City? City { get; set; }

    public virtual Customer? Customer { get; set; }

    public virtual User User { get; set; } = null!;
}
