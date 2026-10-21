using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class VehicleUploadBatch
{
    public long Id { get; set; }

    public string FileName { get; set; } = null!;

    public Guid UploadedBy { get; set; }

    public int RowsTotal { get; set; }

    public int RowsOk { get; set; }

    public int RowsError { get; set; }

    public string? ErrorReport { get; set; }

    public DateTimeOffset UploadedAt { get; set; }

    public virtual User UploadedByNavigation { get; set; } = null!;
}
