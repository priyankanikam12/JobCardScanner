using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class WarrantyRepair
{
    public Guid TicketId { get; set; }

    public decimal? QuoteAmount { get; set; }

    public string? QuoteNote { get; set; }

    public string? ClientDecision { get; set; }

    public string? DecisionNote { get; set; }

    public DateTimeOffset? DecidedAt { get; set; }

    public DateOnly? RepairedOn { get; set; }

    public string? RepairNote { get; set; }

    public DateOnly? ReturnDispatchDate { get; set; }

    public string? ReturnLrNo { get; set; }

    public string? ReturnTransporter { get; set; }

    public string? PartOutcome { get; set; }

    public DateOnly? PartOutcomeDate { get; set; }

    public string? PartOutcomeLr { get; set; }

    public string? PartOutcomeNote { get; set; }

    public Guid? PartOutcomeBy { get; set; }

    public DateTimeOffset? PartOutcomeAt { get; set; }

    public virtual User? PartOutcomeByNavigation { get; set; }

    public virtual Ticket Ticket { get; set; } = null!;
}
