using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class TicketRoute
{
    public long Id { get; set; }

    public Guid TicketId { get; set; }

    public string Queue { get; set; } = null!;

    public string? PartNo { get; set; }

    public string? SoToNo { get; set; }

    public DateOnly? DispatchEta { get; set; }

    public string? Note { get; set; }

    public Guid RoutedBy { get; set; }

    public DateTimeOffset RoutedAt { get; set; }

    public DateTimeOffset? ResponseDueAt { get; set; }

    public DateTimeOffset? RespondedAt { get; set; }

    public Guid? RespondedBy { get; set; }

    public DateTimeOffset? LateAlertedAt { get; set; }

    public DateTimeOffset? EndedAt { get; set; }

    public string Stage { get; set; } = null!;

    public string? EndReason { get; set; }

    public DateOnly? CommittedBy { get; set; }

    public DateTimeOffset? OverdueAlertedAt { get; set; }

    public string? Question { get; set; }

    public DateTimeOffset? QuestionAt { get; set; }

    public string? Answer { get; set; }

    public DateTimeOffset? AnsweredAt { get; set; }

    public Guid? AnsweredBy { get; set; }

    public string? Result { get; set; }

    public DateTimeOffset? ResultAt { get; set; }

    public Guid? ResultBy { get; set; }

    public virtual User? AnsweredByNavigation { get; set; }

    public virtual SpecialistQueue QueueNavigation { get; set; } = null!;

    public virtual User? RespondedByNavigation { get; set; }

    public virtual User? ResultByNavigation { get; set; }

    public virtual User RoutedByNavigation { get; set; } = null!;

    public virtual Ticket Ticket { get; set; } = null!;
}
