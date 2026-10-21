using System;
using System.Collections.Generic;

namespace JobCardScanner.Api.CareDeskData;

public partial class User
{
    public Guid Id { get; set; }

    public string Role { get; set; } = null!;

    public string FullName { get; set; } = null!;

    public string? MobileE164 { get; set; }

    public string? Email { get; set; }

    public string? Username { get; set; }

    public string? PasswordHash { get; set; }

    public Guid? CustomerId { get; set; }

    public bool IsActive { get; set; }

    public bool OnLeave { get; set; }

    public Guid? BackupUserId { get; set; }

    public Guid? ReportsToId { get; set; }

    public bool AllowEmailOtp { get; set; }

    public bool AllowPassword { get; set; }

    public bool CanEditMasters { get; set; }

    public DateTimeOffset? LastLoginAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public virtual ICollection<Attachment> Attachments { get; set; } = new List<Attachment>();

    public virtual User? BackupUser { get; set; }

    public virtual ICollection<ClientAction> ClientActions { get; set; } = new List<ClientAction>();

    public virtual ICollection<ConfigChangeLog> ConfigChangeLogs { get; set; } = new List<ConfigChangeLog>();

    public virtual ICollection<ConsentRecord> ConsentRecords { get; set; } = new List<ConsentRecord>();

    public virtual Customer? Customer { get; set; }

    public virtual ICollection<E4Assignment> E4AssignmentAssignedByNavigations { get; set; } = new List<E4Assignment>();

    public virtual ICollection<E4Assignment> E4AssignmentFromOwners { get; set; } = new List<E4Assignment>();

    public virtual ICollection<E4Assignment> E4AssignmentOwners { get; set; } = new List<E4Assignment>();

    public virtual ICollection<EmailOutbox> EmailOutboxes { get; set; } = new List<EmailOutbox>();

    public virtual ICollection<EscalationMatrix> EscalationMatrixBackupUsers { get; set; } = new List<EscalationMatrix>();

    public virtual ICollection<EscalationMatrix> EscalationMatrixPrimaryUsers { get; set; } = new List<EscalationMatrix>();

    public virtual ICollection<ExportLog> ExportLogs { get; set; } = new List<ExportLog>();

    public virtual ICollection<User> InverseBackupUser { get; set; } = new List<User>();

    public virtual ICollection<User> InverseReportsTo { get; set; } = new List<User>();

    public virtual ICollection<LevelReminder> LevelReminders { get; set; } = new List<LevelReminder>();

    public virtual ICollection<LoginAttempt> LoginAttempts { get; set; } = new List<LoginAttempt>();

    public virtual ICollection<MessageRead> MessageReads { get; set; } = new List<MessageRead>();

    public virtual ICollection<Notification> Notifications { get; set; } = new List<Notification>();

    public virtual ICollection<OtpChallenge> OtpChallenges { get; set; } = new List<OtpChallenge>();

    public virtual ICollection<PushOutbox> PushOutboxes { get; set; } = new List<PushOutbox>();

    public virtual ICollection<PushSubscription> PushSubscriptions { get; set; } = new List<PushSubscription>();

    public virtual User? ReportsTo { get; set; }

    public virtual ICollection<SpareCredit> SpareCredits { get; set; } = new List<SpareCredit>();

    public virtual ICollection<SpareInvoice> SpareInvoiceBilledByNavigations { get; set; } = new List<SpareInvoice>();

    public virtual ICollection<SpareInvoice> SpareInvoiceDispatchedByNavigations { get; set; } = new List<SpareInvoice>();

    public virtual ICollection<SpareInvoice> SpareInvoiceReceiptByNavigations { get; set; } = new List<SpareInvoice>();

    public virtual ICollection<SpareReceiptLine> SpareReceiptLines { get; set; } = new List<SpareReceiptLine>();

    public virtual ICollection<SpareShipment> SpareShipmentDispatchedByNavigations { get; set; } = new List<SpareShipment>();

    public virtual ICollection<SpareShipment> SpareShipmentReceiptByNavigations { get; set; } = new List<SpareShipment>();

    public virtual ICollection<SpecialistQueue> SpecialistQueues { get; set; } = new List<SpecialistQueue>();

    public virtual ICollection<TicketConfirmation> TicketConfirmations { get; set; } = new List<TicketConfirmation>();

    public virtual ICollection<Ticket> TicketCreatedByNavigations { get; set; } = new List<Ticket>();

    public virtual ICollection<Ticket> TicketCurrentOwners { get; set; } = new List<Ticket>();

    public virtual ICollection<TicketEvent> TicketEvents { get; set; } = new List<TicketEvent>();

    public virtual ICollection<TicketHold> TicketHoldHeldByNavigations { get; set; } = new List<TicketHold>();

    public virtual ICollection<TicketHold> TicketHoldReleasedByNavigations { get; set; } = new List<TicketHold>();

    public virtual ICollection<TicketLevelHistory> TicketLevelHistories { get; set; } = new List<TicketLevelHistory>();

    public virtual ICollection<TicketLink> TicketLinks { get; set; } = new List<TicketLink>();

    public virtual ICollection<TicketMessage> TicketMessages { get; set; } = new List<TicketMessage>();

    public virtual ICollection<TicketPause> TicketPauseAnsweredByNavigations { get; set; } = new List<TicketPause>();

    public virtual ICollection<TicketPause> TicketPauseRequestedByNavigations { get; set; } = new List<TicketPause>();

    public virtual ICollection<TicketPayment> TicketPaymentCheckedByNavigations { get; set; } = new List<TicketPayment>();

    public virtual ICollection<TicketPayment> TicketPaymentEnteredByNavigations { get; set; } = new List<TicketPayment>();

    public virtual ICollection<TicketRating> TicketRatings { get; set; } = new List<TicketRating>();

    public virtual ICollection<TicketResolution> TicketResolutions { get; set; } = new List<TicketResolution>();

    public virtual ICollection<TicketRoute> TicketRouteAnsweredByNavigations { get; set; } = new List<TicketRoute>();

    public virtual ICollection<TicketRoute> TicketRouteRespondedByNavigations { get; set; } = new List<TicketRoute>();

    public virtual ICollection<TicketRoute> TicketRouteResultByNavigations { get; set; } = new List<TicketRoute>();

    public virtual ICollection<TicketRoute> TicketRouteRoutedByNavigations { get; set; } = new List<TicketRoute>();

    public virtual ICollection<TicketSpare> TicketSpareCreditPaidByNavigations { get; set; } = new List<TicketSpare>();

    public virtual ICollection<TicketSpare> TicketSpareOrderCheckedByNavigations { get; set; } = new List<TicketSpare>();

    public virtual ICollection<TicketStage> TicketStageDoneByNavigations { get; set; } = new List<TicketStage>();

    public virtual ICollection<TicketStage> TicketStageUndoneByNavigations { get; set; } = new List<TicketStage>();

    public virtual ICollection<TicketWarranty> TicketWarranties { get; set; } = new List<TicketWarranty>();

    public virtual ICollection<UserLeave> UserLeaveBackupUsers { get; set; } = new List<UserLeave>();

    public virtual ICollection<UserLeave> UserLeaveCancelledByNavigations { get; set; } = new List<UserLeave>();

    public virtual ICollection<UserLeave> UserLeaveSetByNavigations { get; set; } = new List<UserLeave>();

    public virtual ICollection<UserLeave> UserLeaveUsers { get; set; } = new List<UserLeave>();

    public virtual ICollection<UserLink> UserLinkCreatedByNavigations { get; set; } = new List<UserLink>();

    public virtual ICollection<UserLink> UserLinkUsers { get; set; } = new List<UserLink>();

    public virtual ICollection<UserSession> UserSessions { get; set; } = new List<UserSession>();

    public virtual ICollection<VehicleAssignmentHistory> VehicleAssignmentHistories { get; set; } = new List<VehicleAssignmentHistory>();

    public virtual ICollection<VehicleUploadBatch> VehicleUploadBatches { get; set; } = new List<VehicleUploadBatch>();

    public virtual ICollection<WarrantyRepair> WarrantyRepairs { get; set; } = new List<WarrantyRepair>();
}
