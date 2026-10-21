using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class Ticket
{
    public Guid Id { get; set; }

    public string TicketNo { get; set; } = null!;

    public string Category { get; set; } = null!;

    public Guid CustomerId { get; set; }

    public Guid? VehicleId { get; set; }

    public short CityId { get; set; }

    public Guid? HubId { get; set; }

    public string? Aggregate { get; set; }

    public string Description { get; set; } = null!;

    public string LocationSource { get; set; } = null!;

    public decimal? LocationLat { get; set; }

    public decimal? LocationLng { get; set; }

    public string? LocationText { get; set; }

    public string? OnsiteContactName { get; set; }

    public string? OnsiteContactMobile { get; set; }

    public int? OdometerKm { get; set; }

    public string? OdometerSource { get; set; }

    public string Status { get; set; } = null!;

    public string? EngineerOutcome { get; set; }

    public string? SpecialistQueue { get; set; }

    public int TatRuleId { get; set; }

    public string Track { get; set; } = null!;

    public string CurrentLevel { get; set; } = null!;

    public Guid? CurrentOwnerId { get; set; }

    public DateTimeOffset LevelStartedAt { get; set; }

    public DateTimeOffset? LevelDueAt { get; set; }

    public DateTimeOffset? ResponseDueAt { get; set; }

    public DateTimeOffset? FirstResponseAt { get; set; }

    public DateTimeOffset? PausedAt { get; set; }

    public bool PauseUsed { get; set; }

    public DateTimeOffset? HeldAt { get; set; }

    public string? HoldReason { get; set; }

    public string? CloseReason { get; set; }

    public DateTimeOffset? ResolvedAt { get; set; }

    public DateTimeOffset? ClosedAt { get; set; }

    public short ReopenCount { get; set; }

    public bool IsRepeat { get; set; }

    public bool ClientMarkedRepeat { get; set; }

    public Guid? RepeatOfTicketId { get; set; }

    public bool SystemRepeat { get; set; }

    public Guid CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public virtual ICollection<Attachment> Attachments { get; set; } = new List<Attachment>();

    public virtual City City { get; set; } = null!;

    public virtual ICollection<ClientAction> ClientActions { get; set; } = new List<ClientAction>();

    public virtual User CreatedByNavigation { get; set; } = null!;

    public virtual User? CurrentOwner { get; set; }

    public virtual Customer Customer { get; set; } = null!;

    public virtual ICollection<E4Assignment> E4Assignments { get; set; } = new List<E4Assignment>();

    public virtual ICollection<EmailOutbox> EmailOutboxes { get; set; } = new List<EmailOutbox>();

    public virtual Hub? Hub { get; set; }

    public virtual ICollection<Ticket> InverseRepeatOfTicket { get; set; } = new List<Ticket>();

    public virtual ICollection<LevelReminder> LevelReminders { get; set; } = new List<LevelReminder>();

    public virtual ICollection<Notification> Notifications { get; set; } = new List<Notification>();

    public virtual ICollection<PushOutbox> PushOutboxes { get; set; } = new List<PushOutbox>();

    public virtual Ticket? RepeatOfTicket { get; set; }

    public virtual ICollection<SpareCredit> SpareCredits { get; set; } = new List<SpareCredit>();

    public virtual ICollection<SpareInvoice> SpareInvoices { get; set; } = new List<SpareInvoice>();

    public virtual ICollection<SpareReceiptLine> SpareReceiptLines { get; set; } = new List<SpareReceiptLine>();

    public virtual ICollection<SpareShipment> SpareShipments { get; set; } = new List<SpareShipment>();

    public virtual SpecialistQueue? SpecialistQueueNavigation { get; set; }

    public virtual TatRule TatRule { get; set; } = null!;

    public virtual ICollection<TicketConcern> TicketConcerns { get; set; } = new List<TicketConcern>();

    public virtual ICollection<TicketConfirmation> TicketConfirmations { get; set; } = new List<TicketConfirmation>();

    public virtual ICollection<TicketEvent> TicketEvents { get; set; } = new List<TicketEvent>();

    public virtual ICollection<TicketHold> TicketHolds { get; set; } = new List<TicketHold>();

    public virtual ICollection<TicketLevelHistory> TicketLevelHistories { get; set; } = new List<TicketLevelHistory>();

    public virtual TicketLink? TicketLinkLinkedTicket { get; set; }

    public virtual ICollection<TicketLink> TicketLinkTickets { get; set; } = new List<TicketLink>();

    public virtual ICollection<TicketMessage> TicketMessages { get; set; } = new List<TicketMessage>();

    public virtual ICollection<TicketPause> TicketPauses { get; set; } = new List<TicketPause>();

    public virtual ICollection<TicketPayment> TicketPayments { get; set; } = new List<TicketPayment>();

    public virtual TicketRating? TicketRating { get; set; }

    public virtual ICollection<TicketResolution> TicketResolutions { get; set; } = new List<TicketResolution>();

    public virtual ICollection<TicketRoute> TicketRoutes { get; set; } = new List<TicketRoute>();

    public virtual TicketSpare? TicketSpare { get; set; }

    public virtual ICollection<TicketSpareLine> TicketSpareLines { get; set; } = new List<TicketSpareLine>();

    public virtual ICollection<TicketStage> TicketStages { get; set; } = new List<TicketStage>();

    public virtual TicketWarranty? TicketWarranty { get; set; }

    public virtual Vehicle? Vehicle { get; set; }

    public virtual WarrantyRepair? WarrantyRepair { get; set; }
}
