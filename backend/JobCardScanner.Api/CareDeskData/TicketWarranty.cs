using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketWarranty
{
    public Guid TicketId { get; set; }

    public int? PartId { get; set; }

    public string PartSerialNo { get; set; } = null!;

    public string? PartName { get; set; }

    public string? ClaimNo { get; set; }

    public DateOnly? ClaimDate { get; set; }

    public string? FailureDescription { get; set; }

    public string? LrNo { get; set; }

    public DateOnly? LrDate { get; set; }

    public string? Transporter { get; set; }

    public int? PolicyId { get; set; }

    public short? MonthsUsed { get; set; }

    public int? KmUsed { get; set; }

    public bool? IsEligible { get; set; }

    public string? EligibilityNote { get; set; }

    public DateOnly? PartReceivedOn { get; set; }

    public string? Decision { get; set; }

    public string? DecisionReason { get; set; }

    public DateTimeOffset? DecidedAt { get; set; }

    public DateOnly? ReplacementDispatchDate { get; set; }

    public string? ReplacementLrNo { get; set; }

    public string? ReplacementTransporter { get; set; }

    public DateOnly? PartBackOn { get; set; }

    public DateTimeOffset? OnSiteFixAt { get; set; }

    public Guid? OnSiteFixBy { get; set; }

    public virtual User? OnSiteFixByNavigation { get; set; }

    public virtual Part? Part { get; set; }

    public virtual WarrantyPolicy? Policy { get; set; }

    public virtual Ticket Ticket { get; set; } = null!;
}
