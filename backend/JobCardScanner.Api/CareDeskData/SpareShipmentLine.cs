using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class SpareShipmentLine
{
    public long ShipmentId { get; set; }

    public long LineId { get; set; }

    public int Qty { get; set; }

    public virtual TicketSpareLine Line { get; set; } = null!;

    public virtual SpareShipment Shipment { get; set; } = null!;
}
