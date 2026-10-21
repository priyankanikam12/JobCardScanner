using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class Holiday
{
    public int Id { get; set; }

    public DateOnly HolidayDate { get; set; }

    public string Name { get; set; } = null!;

    public short? CityId { get; set; }

    public virtual City? City { get; set; }
}
