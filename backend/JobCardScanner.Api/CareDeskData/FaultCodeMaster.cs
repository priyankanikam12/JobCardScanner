using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class FaultCodeMaster
{
    public string Code { get; set; } = null!;

    public string Description { get; set; } = null!;

    public string? Aggregate { get; set; }

    public string Severity { get; set; } = null!;

    public string? SuggestedAction { get; set; }
}
