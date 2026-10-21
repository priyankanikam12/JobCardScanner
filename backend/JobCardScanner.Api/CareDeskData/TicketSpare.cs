using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketSpare
{
    public Guid TicketId { get; set; }

    public string SoId { get; set; } = null!;

    public string? PaymentMode { get; set; }

    public string? UtrNo { get; set; }

    public decimal? AmountInr { get; set; }

    public DateOnly? PaymentDate { get; set; }

    public string DeliveryAddress { get; set; } = null!;

    public bool VehicleOffRoad { get; set; }

    public DateTimeOffset? OrderCheckedAt { get; set; }

    public Guid? OrderCheckedBy { get; set; }

    public decimal? OrderValueInr { get; set; }

    public decimal? CreditOpenInr { get; set; }

    public DateTimeOffset? CreditPaidAt { get; set; }

    public Guid? CreditPaidBy { get; set; }

    public string? CreditPaidNote { get; set; }

    public virtual User? CreditPaidByNavigation { get; set; }

    public virtual User? OrderCheckedByNavigation { get; set; }

    public virtual Ticket Ticket { get; set; } = null!;
}
