using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.CareDeskData;

namespace JobCardScanner.Api.Data;

public partial class CareDeskDbContext : DbContext
{
    public CareDeskDbContext(DbContextOptions<CareDeskDbContext> options)
        : base(options)
    {
    }

    public virtual DbSet<AppSetting> AppSettings { get; set; }

    public virtual DbSet<Attachment> Attachments { get; set; }

    public virtual DbSet<City> Cities { get; set; }

    public virtual DbSet<ClientAction> ClientActions { get; set; }

    public virtual DbSet<ConfigChangeLog> ConfigChangeLogs { get; set; }

    public virtual DbSet<ConsentRecord> ConsentRecords { get; set; }

    public virtual DbSet<Customer> Customers { get; set; }

    public virtual DbSet<E4Assignment> E4Assignments { get; set; }

    public virtual DbSet<EmailOutbox> EmailOutboxes { get; set; }

    public virtual DbSet<EscalationMatrix> EscalationMatrices { get; set; }

    public virtual DbSet<ExportLog> ExportLogs { get; set; }

    public virtual DbSet<FaultCodeMaster> FaultCodeMasters { get; set; }

    public virtual DbSet<Holiday> Holidays { get; set; }

    public virtual DbSet<Hub> Hubs { get; set; }

    public virtual DbSet<IotFaultEvent> IotFaultEvents { get; set; }

    public virtual DbSet<IotSnapshot> IotSnapshots { get; set; }

    public virtual DbSet<JobRun> JobRuns { get; set; }

    public virtual DbSet<LevelReminder> LevelReminders { get; set; }

    public virtual DbSet<LoginAttempt> LoginAttempts { get; set; }

    public virtual DbSet<MessageRead> MessageReads { get; set; }

    public virtual DbSet<Notification> Notifications { get; set; }

    public virtual DbSet<OtpChallenge> OtpChallenges { get; set; }

    public virtual DbSet<Part> Parts { get; set; }

    public virtual DbSet<PushOutbox> PushOutboxes { get; set; }

    public virtual DbSet<PushSubscription> PushSubscriptions { get; set; }

    public virtual DbSet<SpareCredit> SpareCredits { get; set; }

    public virtual DbSet<SpareInvoice> SpareInvoices { get; set; }

    public virtual DbSet<SpareInvoiceLine> SpareInvoiceLines { get; set; }

    public virtual DbSet<SpareReceiptLine> SpareReceiptLines { get; set; }

    public virtual DbSet<SpareShipment> SpareShipments { get; set; }

    public virtual DbSet<SpareShipmentLine> SpareShipmentLines { get; set; }

    public virtual DbSet<SpecialistQueue> SpecialistQueues { get; set; }

    public virtual DbSet<TatRule> TatRules { get; set; }

    public virtual DbSet<Ticket> Tickets { get; set; }

    public virtual DbSet<TicketConcern> TicketConcerns { get; set; }

    public virtual DbSet<TicketConfirmation> TicketConfirmations { get; set; }

    public virtual DbSet<TicketEvent> TicketEvents { get; set; }

    public virtual DbSet<TicketHold> TicketHolds { get; set; }

    public virtual DbSet<TicketLevelHistory> TicketLevelHistories { get; set; }

    public virtual DbSet<TicketLink> TicketLinks { get; set; }

    public virtual DbSet<TicketMessage> TicketMessages { get; set; }

    public virtual DbSet<TicketPause> TicketPauses { get; set; }

    public virtual DbSet<TicketPayment> TicketPayments { get; set; }

    public virtual DbSet<TicketRating> TicketRatings { get; set; }

    public virtual DbSet<TicketResolution> TicketResolutions { get; set; }

    public virtual DbSet<TicketRoute> TicketRoutes { get; set; }

    public virtual DbSet<TicketSpare> TicketSpares { get; set; }

    public virtual DbSet<TicketSpareLine> TicketSpareLines { get; set; }

    public virtual DbSet<TicketStage> TicketStages { get; set; }

    public virtual DbSet<TicketWarranty> TicketWarranties { get; set; }

    public virtual DbSet<User> Users { get; set; }

    public virtual DbSet<UserLeave> UserLeaves { get; set; }

    public virtual DbSet<UserLink> UserLinks { get; set; }

    public virtual DbSet<UserScope> UserScopes { get; set; }

    public virtual DbSet<UserSession> UserSessions { get; set; }

    public virtual DbSet<Vehicle> Vehicles { get; set; }

    public virtual DbSet<VehicleAssignmentHistory> VehicleAssignmentHistories { get; set; }

    public virtual DbSet<VehicleModel> VehicleModels { get; set; }

    public virtual DbSet<VehicleUploadBatch> VehicleUploadBatches { get; set; }

    public virtual DbSet<WarrantyPolicy> WarrantyPolicies { get; set; }

    public virtual DbSet<WarrantyRepair> WarrantyRepairs { get; set; }

    public virtual DbSet<WeeklyOff> WeeklyOffs { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppSetting>(entity =>
        {
            entity.HasKey(e => e.Key).HasName("PK__app_sett__DFD83CAE3BDD7C93");

            entity.ToTable("app_settings", "caredesk");

            entity.Property(e => e.Key)
                .HasMaxLength(200)
                .HasColumnName("key");
            entity.Property(e => e.Value).HasColumnName("value");
        });

        modelBuilder.Entity<Attachment>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__attachme__3213E83F40A09021");

            entity.ToTable("attachments", "caredesk");

            entity.HasIndex(e => new { e.TicketId, e.Kind }, "IX_attachments_ticket_id_kind");

            entity.Property(e => e.Id)
                .HasDefaultValueSql("(newid())")
                .HasColumnName("id");
            entity.Property(e => e.Kind)
                .HasMaxLength(40)
                .HasColumnName("kind");
            entity.Property(e => e.MessageId).HasColumnName("message_id");
            entity.Property(e => e.MimeType).HasColumnName("mime_type");
            entity.Property(e => e.OcrValue).HasColumnName("ocr_value");
            entity.Property(e => e.SizeBytes).HasColumnName("size_bytes");
            entity.Property(e => e.StorageKey).HasColumnName("storage_key");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.UploadedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("uploaded_at");
            entity.Property(e => e.UploadedBy).HasColumnName("uploaded_by");

            entity.HasOne(d => d.Message).WithMany(p => p.Attachments)
                .HasForeignKey(d => d.MessageId)
                .HasConstraintName("FK__attachmen__messa__30AE302A");

            entity.HasOne(d => d.Ticket).WithMany(p => p.Attachments)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__attachmen__ticke__2FBA0BF1");

            entity.HasOne(d => d.UploadedByNavigation).WithMany(p => p.Attachments)
                .HasForeignKey(d => d.UploadedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__attachmen__uploa__3296789C");
        });

        modelBuilder.Entity<City>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__cities__3213E83F139115F4");

            entity.ToTable("cities", "caredesk");

            entity.HasIndex(e => e.Name, "UQ__cities__72E12F1B3C66333D").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Country)
                .HasDefaultValue("India")
                .HasColumnName("country");
            entity.Property(e => e.IsActive)
                .HasDefaultValue(true)
                .HasColumnName("is_active");
            entity.Property(e => e.Name)
                .HasMaxLength(200)
                .HasColumnName("name");
            entity.Property(e => e.State).HasColumnName("state");
        });

        modelBuilder.Entity<ClientAction>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__client_a__3213E83FEFEFD82F");

            entity.ToTable("client_actions", "caredesk");

            entity.HasIndex(e => new { e.TicketId, e.ReceivedAt }, "client_actions_ticket");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.Action).HasColumnName("action");
            entity.Property(e => e.CapturedAt)
                .HasPrecision(3)
                .HasColumnName("captured_at");
            entity.Property(e => e.DoneAt)
                .HasPrecision(3)
                .HasColumnName("done_at");
            entity.Property(e => e.ReceivedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("received_at");
            entity.Property(e => e.Response).HasColumnName("response");
            entity.Property(e => e.Status).HasColumnName("status");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");

            entity.HasOne(d => d.Ticket).WithMany(p => p.ClientActions)
                .HasForeignKey(d => d.TicketId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK__client_ac__ticke__14D10B8B");

            entity.HasOne(d => d.User).WithMany(p => p.ClientActions)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("FK__client_ac__user___13DCE752");
        });

        modelBuilder.Entity<ConfigChangeLog>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__config_c__3213E83FE4D772B6");

            entity.ToTable("config_change_log", "caredesk");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.ChangedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("changed_at");
            entity.Property(e => e.ChangedBy).HasColumnName("changed_by");
            entity.Property(e => e.NewValue).HasColumnName("new_value");
            entity.Property(e => e.OldValue).HasColumnName("old_value");
            entity.Property(e => e.RowKey).HasColumnName("row_key");
            entity.Property(e => e.TableName).HasColumnName("table_name");

            entity.HasOne(d => d.ChangedByNavigation).WithMany(p => p.ConfigChangeLogs)
                .HasForeignKey(d => d.ChangedBy)
                .HasConstraintName("FK__config_ch__chang__05F8DC4F");
        });

        modelBuilder.Entity<ConsentRecord>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__consent___3213E83F677F9EFA");

            entity.ToTable("consent_records", "caredesk");

            entity.HasIndex(e => new { e.UserId, e.NoticeVersion }, "UQ__consent___4C59AE6EBA295C69").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AcceptedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("accepted_at");
            entity.Property(e => e.NoticeVersion)
                .HasMaxLength(40)
                .HasColumnName("notice_version");
            entity.Property(e => e.UserId).HasColumnName("user_id");

            entity.HasOne(d => d.User).WithMany(p => p.ConsentRecords)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__consent_r__user___2E90DD8E");
        });

        modelBuilder.Entity<Customer>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__customer__3213E83FB9FAA431");

            entity.ToTable("customers", "caredesk");

            entity.HasIndex(e => e.CustomerCode, "UQ__customer__6A9E4CB7BB07A4D6").IsUnique();

            entity.Property(e => e.Id)
                .HasDefaultValueSql("(newid())")
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.CustomerCode)
                .HasMaxLength(60)
                .HasColumnName("customer_code");
            entity.Property(e => e.Gstin).HasColumnName("gstin");
            entity.Property(e => e.IsActive)
                .HasDefaultValue(true)
                .HasColumnName("is_active");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.Type)
                .HasMaxLength(40)
                .HasColumnName("type");
        });

        modelBuilder.Entity<E4Assignment>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__e4_assig__3213E83FB90C2554");

            entity.ToTable("e4_assignments", "caredesk");

            entity.HasIndex(e => e.DueAt, "e4_assignments_due").HasFilter("([superseded_at] IS NULL AND [checked_at] IS NULL)");

            entity.HasIndex(e => new { e.TicketId, e.AssignedAt }, "e4_assignments_ticket").IsDescending(false, true);

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AssignedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("assigned_at");
            entity.Property(e => e.AssignedBy).HasColumnName("assigned_by");
            entity.Property(e => e.CheckedAt)
                .HasPrecision(3)
                .HasColumnName("checked_at");
            entity.Property(e => e.DeadlineOn).HasColumnName("deadline_on");
            entity.Property(e => e.DueAt)
                .HasPrecision(3)
                .HasColumnName("due_at");
            entity.Property(e => e.FromOwnerId).HasColumnName("from_owner_id");
            entity.Property(e => e.Met).HasColumnName("met");
            entity.Property(e => e.MissedAlertedAt)
                .HasPrecision(3)
                .HasColumnName("missed_alerted_at");
            entity.Property(e => e.Note).HasColumnName("note");
            entity.Property(e => e.OwnerId).HasColumnName("owner_id");
            entity.Property(e => e.SupersededAt)
                .HasPrecision(3)
                .HasColumnName("superseded_at");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");

            entity.HasOne(d => d.AssignedByNavigation).WithMany(p => p.E4AssignmentAssignedByNavigations)
                .HasForeignKey(d => d.AssignedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__e4_assign__assig__27E3DFFF");

            entity.HasOne(d => d.FromOwner).WithMany(p => p.E4AssignmentFromOwners)
                .HasForeignKey(d => d.FromOwnerId)
                .HasConstraintName("FK__e4_assign__from___29CC2871");

            entity.HasOne(d => d.Owner).WithMany(p => p.E4AssignmentOwners)
                .HasForeignKey(d => d.OwnerId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__e4_assign__owner__2AC04CAA");

            entity.HasOne(d => d.Ticket).WithMany(p => p.E4Assignments)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__e4_assign__ticke__26EFBBC6");
        });

        modelBuilder.Entity<EmailOutbox>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__email_ou__3213E83FA8FF0757");

            entity.ToTable("email_outbox", "caredesk");

            entity.HasIndex(e => new { e.EventKey, e.RecipientId }, "UQ__email_ou__BB33E1BB6BF9F797").IsUnique();

            entity.HasIndex(e => e.CreatedAt, "email_outbox_created").IsDescending();

            entity.HasIndex(e => e.NextAttemptAt, "email_outbox_due").HasFilter("([status]='queued')");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Attempts).HasColumnName("attempts");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.Details)
                .HasDefaultValue("{}")
                .HasColumnName("details");
            entity.Property(e => e.EventKey)
                .HasMaxLength(200)
                .HasColumnName("event_key");
            entity.Property(e => e.LastAttemptAt)
                .HasPrecision(3)
                .HasColumnName("last_attempt_at");
            entity.Property(e => e.LastError).HasColumnName("last_error");
            entity.Property(e => e.NextAttemptAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("next_attempt_at");
            entity.Property(e => e.NotificationId).HasColumnName("notification_id");
            entity.Property(e => e.ProviderRef).HasColumnName("provider_ref");
            entity.Property(e => e.RecipientId).HasColumnName("recipient_id");
            entity.Property(e => e.SentAt)
                .HasPrecision(3)
                .HasColumnName("sent_at");
            entity.Property(e => e.Status)
                .HasDefaultValue("queued")
                .HasColumnName("status");
            entity.Property(e => e.Subject).HasColumnName("subject");
            entity.Property(e => e.TemplateCode).HasColumnName("template_code");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.ToEmail)
                .HasMaxLength(320)
                .UseCollation("Latin1_General_100_CI_AS")
                .HasColumnName("to_email");

            entity.HasOne(d => d.Notification).WithMany(p => p.EmailOutboxes)
                .HasForeignKey(d => d.NotificationId)
                .HasConstraintName("FK__email_out__notif__7740A8A4");

            entity.HasOne(d => d.Recipient).WithMany(p => p.EmailOutboxes)
                .HasForeignKey(d => d.RecipientId)
                .HasConstraintName("FK__email_out__recip__7834CCDD");

            entity.HasOne(d => d.Ticket).WithMany(p => p.EmailOutboxes)
                .HasForeignKey(d => d.TicketId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK__email_out__ticke__7928F116");
        });

        modelBuilder.Entity<EscalationMatrix>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__escalati__3213E83F1595F1D8");

            entity.ToTable("escalation_matrix", "caredesk");

            entity.HasIndex(e => new { e.CustomerId, e.CityId, e.Level }, "UQ__escalati__5794B88AC9884B78").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.BackupUserId).HasColumnName("backup_user_id");
            entity.Property(e => e.CityId).HasColumnName("city_id");
            entity.Property(e => e.CustomerId).HasColumnName("customer_id");
            entity.Property(e => e.Level)
                .HasMaxLength(40)
                .HasColumnName("level");
            entity.Property(e => e.PrimaryUserId).HasColumnName("primary_user_id");

            entity.HasOne(d => d.BackupUser).WithMany(p => p.EscalationMatrixBackupUsers)
                .HasForeignKey(d => d.BackupUserId)
                .HasConstraintName("FK__escalatio__backu__6C390A4C");

            entity.HasOne(d => d.City).WithMany(p => p.EscalationMatrices)
                .HasForeignKey(d => d.CityId)
                .HasConstraintName("FK__escalatio__city___695C9DA1");

            entity.HasOne(d => d.Customer).WithMany(p => p.EscalationMatrices)
                .HasForeignKey(d => d.CustomerId)
                .HasConstraintName("FK__escalatio__custo__68687968");

            entity.HasOne(d => d.PrimaryUser).WithMany(p => p.EscalationMatrixPrimaryUsers)
                .HasForeignKey(d => d.PrimaryUserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__escalatio__prima__6B44E613");
        });

        modelBuilder.Entity<ExportLog>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__export_l__3213E83FFABF0017");

            entity.ToTable("export_log", "caredesk");

            entity.HasIndex(e => e.At, "export_log_at").IsDescending();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.At)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("at");
            entity.Property(e => e.FileName).HasColumnName("file_name");
            entity.Property(e => e.Filter)
                .HasDefaultValue("{}")
                .HasColumnName("filter");
            entity.Property(e => e.Rows).HasColumnName("rows");
            entity.Property(e => e.Source).HasColumnName("source");
            entity.Property(e => e.UserId).HasColumnName("user_id");

            entity.HasOne(d => d.User).WithMany(p => p.ExportLogs)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__export_lo__user___1F4E99FE");
        });

        modelBuilder.Entity<FaultCodeMaster>(entity =>
        {
            entity.HasKey(e => e.Code).HasName("PK__fault_co__357D4CF82587C862");

            entity.ToTable("fault_code_master", "caredesk");

            entity.Property(e => e.Code)
                .HasMaxLength(50)
                .HasColumnName("code");
            entity.Property(e => e.Aggregate).HasColumnName("aggregate");
            entity.Property(e => e.Description).HasColumnName("description");
            entity.Property(e => e.Severity).HasColumnName("severity");
            entity.Property(e => e.SuggestedAction).HasColumnName("suggested_action");
        });

        modelBuilder.Entity<Holiday>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__holidays__3213E83FF9E0F69E");

            entity.ToTable("holidays", "caredesk");

            entity.HasIndex(e => new { e.HolidayDate, e.CityId }, "UQ__holidays__A097300C000AB0F8").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CityId).HasColumnName("city_id");
            entity.Property(e => e.HolidayDate).HasColumnName("holiday_date");
            entity.Property(e => e.Name).HasColumnName("name");

            entity.HasOne(d => d.City).WithMany(p => p.Holidays)
                .HasForeignKey(d => d.CityId)
                .HasConstraintName("FK__holidays__city_i__7E57BA87");
        });

        modelBuilder.Entity<Hub>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__hubs__3213E83F20C9C298");

            entity.ToTable("hubs", "caredesk");

            entity.HasIndex(e => new { e.CustomerId, e.CityId, e.Name }, "UQ__hubs__462663B1C9AF89C6").IsUnique();

            entity.Property(e => e.Id)
                .HasDefaultValueSql("(newid())")
                .HasColumnName("id");
            entity.Property(e => e.Address).HasColumnName("address");
            entity.Property(e => e.CityId).HasColumnName("city_id");
            entity.Property(e => e.ContactMobile).HasColumnName("contact_mobile");
            entity.Property(e => e.ContactName).HasColumnName("contact_name");
            entity.Property(e => e.CustomerId).HasColumnName("customer_id");
            entity.Property(e => e.IsActive)
                .HasDefaultValue(true)
                .HasColumnName("is_active");
            entity.Property(e => e.Latitude)
                .HasColumnType("decimal(9, 6)")
                .HasColumnName("latitude");
            entity.Property(e => e.Longitude)
                .HasColumnType("decimal(9, 6)")
                .HasColumnName("longitude");
            entity.Property(e => e.Name)
                .HasMaxLength(200)
                .HasColumnName("name");
            entity.Property(e => e.PinSetAt)
                .HasPrecision(3)
                .HasColumnName("pin_set_at");
            entity.Property(e => e.PinSetBy).HasColumnName("pin_set_by");
            entity.Property(e => e.PinSource).HasColumnName("pin_source");

            entity.HasOne(d => d.City).WithMany(p => p.Hubs)
                .HasForeignKey(d => d.CityId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__hubs__city_id__062DE679");

            entity.HasOne(d => d.Customer).WithMany(p => p.Hubs)
                .HasForeignKey(d => d.CustomerId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__hubs__customer_i__0539C240");
        });

        modelBuilder.Entity<IotFaultEvent>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__iot_faul__3213E83F4AED8607");

            entity.ToTable("iot_fault_events", "caredesk");

            entity.HasIndex(e => e.VehicleId, "IX_iot_fault_events_vehicle_id").HasFilter("([cleared_at] IS NULL)");

            entity.HasIndex(e => new { e.VehicleId, e.Code, e.FirstSeenAt }, "UQ__iot_faul__0EB5F62F43FE7AFC").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.ClearedAt)
                .HasPrecision(3)
                .HasColumnName("cleared_at");
            entity.Property(e => e.Code)
                .HasMaxLength(50)
                .HasColumnName("code");
            entity.Property(e => e.FirstSeenAt)
                .HasPrecision(3)
                .HasColumnName("first_seen_at");
            entity.Property(e => e.LastSeenAt)
                .HasPrecision(3)
                .HasColumnName("last_seen_at");
            entity.Property(e => e.Raw).HasColumnName("raw");
            entity.Property(e => e.VehicleId).HasColumnName("vehicle_id");

            entity.HasOne(d => d.Vehicle).WithMany(p => p.IotFaultEvents)
                .HasForeignKey(d => d.VehicleId)
                .HasConstraintName("FK__iot_fault__vehic__642DD430");
        });

        modelBuilder.Entity<IotSnapshot>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__iot_snap__3213E83FB4A748B9");

            entity.ToTable("iot_snapshots", "caredesk");

            entity.HasIndex(e => new { e.VehicleId, e.CapturedAt }, "IX_iot_snapshots_vehicle_id_captured_at").IsDescending(false, true);

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CapturedAt)
                .HasPrecision(3)
                .HasColumnName("captured_at");
            entity.Property(e => e.Latitude)
                .HasColumnType("decimal(9, 6)")
                .HasColumnName("latitude");
            entity.Property(e => e.Longitude)
                .HasColumnType("decimal(9, 6)")
                .HasColumnName("longitude");
            entity.Property(e => e.OdometerKm)
                .HasColumnType("decimal(10, 1)")
                .HasColumnName("odometer_km");
            entity.Property(e => e.Provider)
                .HasDefaultValue("intellicar")
                .HasColumnName("provider");
            entity.Property(e => e.Raw).HasColumnName("raw");
            entity.Property(e => e.ReceivedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("received_at");
            entity.Property(e => e.SocPct)
                .HasColumnType("decimal(5, 2)")
                .HasColumnName("soc_pct");
            entity.Property(e => e.VehicleId).HasColumnName("vehicle_id");

            entity.HasOne(d => d.Vehicle).WithMany(p => p.IotSnapshots)
                .HasForeignKey(d => d.VehicleId)
                .HasConstraintName("FK__iot_snaps__vehic__5AA469F6");
        });

        modelBuilder.Entity<JobRun>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__job_runs__3213E83F243605D5");

            entity.ToTable("job_runs", "caredesk");

            entity.HasIndex(e => e.StartedAt, "job_runs_started").IsDescending();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.ClockAt)
                .HasPrecision(3)
                .HasColumnName("clock_at");
            entity.Property(e => e.Error).HasColumnName("error");
            entity.Property(e => e.FinishedAt)
                .HasPrecision(3)
                .HasColumnName("finished_at");
            entity.Property(e => e.Result).HasColumnName("result");
            entity.Property(e => e.Source).HasColumnName("source");
            entity.Property(e => e.StartedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("started_at");
            entity.Property(e => e.Status).HasColumnName("status");
        });

        modelBuilder.Entity<LevelReminder>(entity =>
        {
            entity.HasKey(e => new { e.TicketId, e.Level, e.WindowStart, e.Pct }).HasName("PK__level_re__11A122677EB38426");

            entity.ToTable("level_reminders", "caredesk");

            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.Level)
                .HasMaxLength(40)
                .HasColumnName("level");
            entity.Property(e => e.WindowStart)
                .HasPrecision(3)
                .HasColumnName("window_start");
            entity.Property(e => e.Pct).HasColumnName("pct");
            entity.Property(e => e.At)
                .HasPrecision(3)
                .HasColumnName("at");
            entity.Property(e => e.OwnerId).HasColumnName("owner_id");
            entity.Property(e => e.Sent).HasColumnName("sent");

            entity.HasOne(d => d.Owner).WithMany(p => p.LevelReminders)
                .HasForeignKey(d => d.OwnerId)
                .HasConstraintName("FK__level_rem__owner__11007AA7");

            entity.HasOne(d => d.Ticket).WithMany(p => p.LevelReminders)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__level_rem__ticke__0F183235");
        });

        modelBuilder.Entity<LoginAttempt>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__login_at__3213E83F3D0CF8AA");

            entity.ToTable("login_attempts", "caredesk");

            entity.HasIndex(e => new { e.LoginId, e.Kind, e.At }, "IX_login_attempts_login_id_kind_at").IsDescending(false, false, true);

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.At)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("at");
            entity.Property(e => e.Ip)
                .HasMaxLength(45)
                .HasColumnName("ip");
            entity.Property(e => e.Kind)
                .HasMaxLength(40)
                .HasColumnName("kind");
            entity.Property(e => e.LoginId)
                .HasMaxLength(320)
                .UseCollation("Latin1_General_100_CI_AS")
                .HasColumnName("login_id");
            entity.Property(e => e.Success).HasColumnName("success");
            entity.Property(e => e.UserId).HasColumnName("user_id");

            entity.HasOne(d => d.User).WithMany(p => p.LoginAttempts)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("FK__login_att__user___3D7E1B63");
        });

        modelBuilder.Entity<MessageRead>(entity =>
        {
            entity.HasKey(e => new { e.MessageId, e.UserId }).HasName("PK__message___E0248D9675E1A3FC");

            entity.ToTable("message_reads", "caredesk");

            entity.Property(e => e.MessageId).HasColumnName("message_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.ReadAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("read_at");

            entity.HasOne(d => d.Message).WithMany(p => p.MessageReads)
                .HasForeignKey(d => d.MessageId)
                .HasConstraintName("FK__message_r__messa__2A01329B");

            entity.HasOne(d => d.User).WithMany(p => p.MessageReads)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__message_r__user___2AF556D4");
        });

        modelBuilder.Entity<Notification>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__notifica__3213E83F6D79293A");

            entity.ToTable("notifications", "caredesk");

            entity.HasIndex(e => new { e.Status, e.CreatedAt }, "IX_notifications_status_created_at");

            entity.HasIndex(e => new { e.RecipientId, e.CreatedAt }, "notifications_alerts").HasFilter("([channel]='push')");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Channel)
                .HasMaxLength(40)
                .HasColumnName("channel");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.Payload).HasColumnName("payload");
            entity.Property(e => e.ProviderRef).HasColumnName("provider_ref");
            entity.Property(e => e.ReadAt)
                .HasPrecision(3)
                .HasColumnName("read_at");
            entity.Property(e => e.RecipientId).HasColumnName("recipient_id");
            entity.Property(e => e.SentAt)
                .HasPrecision(3)
                .HasColumnName("sent_at");
            entity.Property(e => e.Status)
                .HasMaxLength(40)
                .HasDefaultValue("queued")
                .HasColumnName("status");
            entity.Property(e => e.TemplateCode).HasColumnName("template_code");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");

            entity.HasOne(d => d.Recipient).WithMany(p => p.Notifications)
                .HasForeignKey(d => d.RecipientId)
                .HasConstraintName("FK__notificat__recip__6EAB62A3");

            entity.HasOne(d => d.Ticket).WithMany(p => p.Notifications)
                .HasForeignKey(d => d.TicketId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK__notificat__ticke__6DB73E6A");
        });

        modelBuilder.Entity<OtpChallenge>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__otp_chal__3213E83F5D69C3CE");

            entity.ToTable("otp_challenges", "caredesk");

            entity.HasIndex(e => new { e.Email, e.CreatedAt }, "IX_otp_challenges_email_created_at").IsDescending(false, true);

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Attempts).HasColumnName("attempts");
            entity.Property(e => e.Channel)
                .HasMaxLength(40)
                .HasDefaultValue("email")
                .HasColumnName("channel");
            entity.Property(e => e.ConsumedAt)
                .HasPrecision(3)
                .HasColumnName("consumed_at");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.Email)
                .HasMaxLength(320)
                .UseCollation("Latin1_General_100_CI_AS")
                .HasColumnName("email");
            entity.Property(e => e.ExpiresAt)
                .HasPrecision(3)
                .HasColumnName("expires_at");
            entity.Property(e => e.OtpHash).HasColumnName("otp_hash");
            entity.Property(e => e.UserId).HasColumnName("user_id");

            entity.HasOne(d => d.User).WithMany(p => p.OtpChallenges)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__otp_chall__user___335592AB");
        });

        modelBuilder.Entity<Part>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__parts__3213E83F5D1A7811");

            entity.ToTable("parts", "caredesk");

            entity.HasIndex(e => e.PartCode, "UX_parts_part_code")
                .IsUnique()
                .HasFilter("([part_code] IS NOT NULL)");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Aggregate).HasColumnName("aggregate");
            entity.Property(e => e.IsWarrantable)
                .HasDefaultValue(true)
                .HasColumnName("is_warrantable");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.PartCode)
                .HasMaxLength(60)
                .HasColumnName("part_code");
        });

        modelBuilder.Entity<PushOutbox>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__push_out__3213E83FA6B0CA2D");

            entity.ToTable("push_outbox", "caredesk");

            entity.HasIndex(e => new { e.EventKey, e.RecipientId }, "UQ__push_out__BB33E1BB2C212FF2").IsUnique();

            entity.HasIndex(e => e.CreatedAt, "push_outbox_created").IsDescending();

            entity.HasIndex(e => e.NextAttemptAt, "push_outbox_due").HasFilter("([status]='queued')");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Attempts).HasColumnName("attempts");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.Details)
                .HasDefaultValue("{}")
                .HasColumnName("details");
            entity.Property(e => e.Devices).HasColumnName("devices");
            entity.Property(e => e.EventKey)
                .HasMaxLength(200)
                .HasColumnName("event_key");
            entity.Property(e => e.HoldUntil)
                .HasPrecision(3)
                .HasColumnName("hold_until");
            entity.Property(e => e.LastAttemptAt)
                .HasPrecision(3)
                .HasColumnName("last_attempt_at");
            entity.Property(e => e.LastError).HasColumnName("last_error");
            entity.Property(e => e.NextAttemptAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("next_attempt_at");
            entity.Property(e => e.NotificationId).HasColumnName("notification_id");
            entity.Property(e => e.RecipientId).HasColumnName("recipient_id");
            entity.Property(e => e.SentAt)
                .HasPrecision(3)
                .HasColumnName("sent_at");
            entity.Property(e => e.Status)
                .HasDefaultValue("queued")
                .HasColumnName("status");
            entity.Property(e => e.TemplateCode).HasColumnName("template_code");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.Title).HasColumnName("title");

            entity.HasOne(d => d.Notification).WithMany(p => p.PushOutboxes)
                .HasForeignKey(d => d.NotificationId)
                .HasConstraintName("FK__push_outb__notif__03A67F89");

            entity.HasOne(d => d.Recipient).WithMany(p => p.PushOutboxes)
                .HasForeignKey(d => d.RecipientId)
                .HasConstraintName("FK__push_outb__recip__049AA3C2");

            entity.HasOne(d => d.Ticket).WithMany(p => p.PushOutboxes)
                .HasForeignKey(d => d.TicketId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK__push_outb__ticke__058EC7FB");
        });

        modelBuilder.Entity<PushSubscription>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__push_sub__3213E83F3BB0CC36");

            entity.ToTable("push_subscriptions", "caredesk");

            entity.HasIndex(e => e.Endpoint, "UQ__push_sub__00C5A3550686F721").IsUnique();

            entity.HasIndex(e => e.UserId, "push_subscriptions_user").HasFilter("([is_active]=(1))");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AuthKey).HasColumnName("auth_key");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.EndedAt)
                .HasPrecision(3)
                .HasColumnName("ended_at");
            entity.Property(e => e.EndedReason).HasColumnName("ended_reason");
            entity.Property(e => e.Endpoint)
                .HasMaxLength(850)
                .HasColumnName("endpoint");
            entity.Property(e => e.IsActive)
                .HasDefaultValue(true)
                .HasColumnName("is_active");
            entity.Property(e => e.LastOkAt)
                .HasPrecision(3)
                .HasColumnName("last_ok_at");
            entity.Property(e => e.P256dhKey).HasColumnName("p256dh_key");
            entity.Property(e => e.UserAgent).HasColumnName("user_agent");
            entity.Property(e => e.UserId).HasColumnName("user_id");

            entity.HasOne(d => d.User).WithMany(p => p.PushSubscriptions)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("FK__push_subs__user___68F2894D");
        });

        modelBuilder.Entity<SpareCredit>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__spare_cr__3213E83FD2850FC9");

            entity.ToTable("spare_credits", "caredesk");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AmountInr)
                .HasColumnType("decimal(12, 2)")
                .HasColumnName("amount_inr");
            entity.Property(e => e.GrantedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("granted_at");
            entity.Property(e => e.GrantedBy).HasColumnName("granted_by");
            entity.Property(e => e.Reason).HasColumnName("reason");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");

            entity.HasOne(d => d.GrantedByNavigation).WithMany(p => p.SpareCredits)
                .HasForeignKey(d => d.GrantedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__spare_cre__grant__542C7691");

            entity.HasOne(d => d.Ticket).WithMany(p => p.SpareCredits)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__spare_cre__ticke__52442E1F");
        });

        modelBuilder.Entity<SpareInvoice>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__spare_in__3213E83FC1458598");

            entity.ToTable("spare_invoices", "caredesk");

            entity.HasIndex(e => new { e.TicketId, e.InvoiceNo }, "UQ__spare_in__FACE3374B13E2B38").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AutoReceived).HasColumnName("auto_received");
            entity.Property(e => e.BilledAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("billed_at");
            entity.Property(e => e.BilledBy).HasColumnName("billed_by");
            entity.Property(e => e.CancelledAt)
                .HasPrecision(3)
                .HasColumnName("cancelled_at");
            entity.Property(e => e.DispatchDate).HasColumnName("dispatch_date");
            entity.Property(e => e.DispatchedAt)
                .HasPrecision(3)
                .HasColumnName("dispatched_at");
            entity.Property(e => e.DispatchedBy).HasColumnName("dispatched_by");
            entity.Property(e => e.ExpectedDelivery).HasColumnName("expected_delivery");
            entity.Property(e => e.InvoiceDate).HasColumnName("invoice_date");
            entity.Property(e => e.InvoiceNo)
                .HasMaxLength(100)
                .HasColumnName("invoice_no");
            entity.Property(e => e.Kind).HasColumnName("kind");
            entity.Property(e => e.LrNo).HasColumnName("lr_no");
            entity.Property(e => e.Receipt).HasColumnName("receipt");
            entity.Property(e => e.ReceiptAt)
                .HasPrecision(3)
                .HasColumnName("receipt_at");
            entity.Property(e => e.ReceiptBy).HasColumnName("receipt_by");
            entity.Property(e => e.ReceiptComment).HasColumnName("receipt_comment");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.Transporter).HasColumnName("transporter");
            entity.Property(e => e.ValueInr)
                .HasColumnType("decimal(12, 2)")
                .HasColumnName("value_inr");

            entity.HasOne(d => d.BilledByNavigation).WithMany(p => p.SpareInvoiceBilledByNavigations)
                .HasForeignKey(d => d.BilledBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__spare_inv__bille__5F9E293D");

            entity.HasOne(d => d.DispatchedByNavigation).WithMany(p => p.SpareInvoiceDispatchedByNavigations)
                .HasForeignKey(d => d.DispatchedBy)
                .HasConstraintName("FK__spare_inv__dispa__618671AF");

            entity.HasOne(d => d.ReceiptByNavigation).WithMany(p => p.SpareInvoiceReceiptByNavigations)
                .HasForeignKey(d => d.ReceiptBy)
                .HasConstraintName("FK__spare_inv__recei__636EBA21");

            entity.HasOne(d => d.Ticket).WithMany(p => p.SpareInvoices)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__spare_inv__ticke__5DB5E0CB");
        });

        modelBuilder.Entity<SpareInvoiceLine>(entity =>
        {
            entity.HasKey(e => new { e.InvoiceId, e.LineId }).HasName("PK__spare_in__CAD718BFB9D7071F");

            entity.ToTable("spare_invoice_lines", "caredesk");

            entity.Property(e => e.InvoiceId).HasColumnName("invoice_id");
            entity.Property(e => e.LineId).HasColumnName("line_id");
            entity.Property(e => e.Qty).HasColumnName("qty");

            entity.HasOne(d => d.Invoice).WithMany(p => p.SpareInvoiceLines)
                .HasForeignKey(d => d.InvoiceId)
                .HasConstraintName("FK__spare_inv__invoi__68336F3E");

            entity.HasOne(d => d.Line).WithMany(p => p.SpareInvoiceLines)
                .HasForeignKey(d => d.LineId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__spare_inv__line___69279377");
        });

        modelBuilder.Entity<SpareReceiptLine>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__spare_re__3213E83F2A22CD11");

            entity.ToTable("spare_receipt_lines", "caredesk");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.InvoiceId).HasColumnName("invoice_id");
            entity.Property(e => e.Issue).HasColumnName("issue");
            entity.Property(e => e.LineId).HasColumnName("line_id");
            entity.Property(e => e.PhotoId).HasColumnName("photo_id");
            entity.Property(e => e.QtyReceived).HasColumnName("qty_received");
            entity.Property(e => e.QtySent).HasColumnName("qty_sent");
            entity.Property(e => e.ReportedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("reported_at");
            entity.Property(e => e.ReportedBy).HasColumnName("reported_by");
            entity.Property(e => e.ShipmentId).HasColumnName("shipment_id");
            entity.Property(e => e.StageId).HasColumnName("stage_id");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.WithdrawnAt)
                .HasPrecision(3)
                .HasColumnName("withdrawn_at");

            entity.HasOne(d => d.Invoice).WithMany(p => p.SpareReceiptLines)
                .HasForeignKey(d => d.InvoiceId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__spare_rec__invoi__3CDEFCE5");

            entity.HasOne(d => d.Line).WithMany(p => p.SpareReceiptLines)
                .HasForeignKey(d => d.LineId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__spare_rec__line___3FBB6990");

            entity.HasOne(d => d.Photo).WithMany(p => p.SpareReceiptLines)
                .HasForeignKey(d => d.PhotoId)
                .HasConstraintName("FK__spare_rec__photo__4297D63B");

            entity.HasOne(d => d.ReportedByNavigation).WithMany(p => p.SpareReceiptLines)
                .HasForeignKey(d => d.ReportedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__spare_rec__repor__438BFA74");

            entity.HasOne(d => d.Shipment).WithMany(p => p.SpareReceiptLines)
                .HasForeignKey(d => d.ShipmentId)
                .HasConstraintName("FK__spare_rec__shipm__3DD3211E");

            entity.HasOne(d => d.Stage).WithMany(p => p.SpareReceiptLines)
                .HasForeignKey(d => d.StageId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__spare_rec__stage__3EC74557");

            entity.HasOne(d => d.Ticket).WithMany(p => p.SpareReceiptLines)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__spare_rec__ticke__3BEAD8AC");
        });

        modelBuilder.Entity<SpareShipment>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__spare_sh__3213E83F26F1AF91");

            entity.ToTable("spare_shipments", "caredesk");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AutoReceived).HasColumnName("auto_received");
            entity.Property(e => e.CancelledAt)
                .HasPrecision(3)
                .HasColumnName("cancelled_at");
            entity.Property(e => e.DispatchDate).HasColumnName("dispatch_date");
            entity.Property(e => e.DispatchedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("dispatched_at");
            entity.Property(e => e.DispatchedBy).HasColumnName("dispatched_by");
            entity.Property(e => e.ExpectedDelivery).HasColumnName("expected_delivery");
            entity.Property(e => e.InvoiceId).HasColumnName("invoice_id");
            entity.Property(e => e.LrNo).HasColumnName("lr_no");
            entity.Property(e => e.Receipt).HasColumnName("receipt");
            entity.Property(e => e.ReceiptAt)
                .HasPrecision(3)
                .HasColumnName("receipt_at");
            entity.Property(e => e.ReceiptBy).HasColumnName("receipt_by");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.Transporter).HasColumnName("transporter");

            entity.HasOne(d => d.DispatchedByNavigation).WithMany(p => p.SpareShipmentDispatchedByNavigations)
                .HasForeignKey(d => d.DispatchedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__spare_shi__dispa__6EE06CCD");

            entity.HasOne(d => d.Invoice).WithMany(p => p.SpareShipments)
                .HasForeignKey(d => d.InvoiceId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__spare_shi__invoi__6DEC4894");

            entity.HasOne(d => d.ReceiptByNavigation).WithMany(p => p.SpareShipmentReceiptByNavigations)
                .HasForeignKey(d => d.ReceiptBy)
                .HasConstraintName("FK__spare_shi__recei__71BCD978");

            entity.HasOne(d => d.Ticket).WithMany(p => p.SpareShipments)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__spare_shi__ticke__6CF8245B");
        });

        modelBuilder.Entity<SpareShipmentLine>(entity =>
        {
            entity.HasKey(e => new { e.ShipmentId, e.LineId }).HasName("PK__spare_sh__7E1C8BAF66CDC92B");

            entity.ToTable("spare_shipment_lines", "caredesk");

            entity.Property(e => e.ShipmentId).HasColumnName("shipment_id");
            entity.Property(e => e.LineId).HasColumnName("line_id");
            entity.Property(e => e.Qty).HasColumnName("qty");

            entity.HasOne(d => d.Line).WithMany(p => p.SpareShipmentLines)
                .HasForeignKey(d => d.LineId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__spare_shi__line___76818E95");

            entity.HasOne(d => d.Shipment).WithMany(p => p.SpareShipmentLines)
                .HasForeignKey(d => d.ShipmentId)
                .HasConstraintName("FK__spare_shi__shipm__758D6A5C");
        });

        modelBuilder.Entity<SpecialistQueue>(entity =>
        {
            entity.HasKey(e => e.Code).HasName("PK__speciali__357D4CF892FFE062");

            entity.ToTable("specialist_queues", "caredesk");

            entity.Property(e => e.Code)
                .HasMaxLength(50)
                .HasColumnName("code");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.OwnerUserId).HasColumnName("owner_user_id");
            entity.Property(e => e.ResponseHours)
                .HasColumnType("decimal(6, 2)")
                .HasColumnName("response_hours");

            entity.HasOne(d => d.OwnerUser).WithMany(p => p.SpecialistQueues)
                .HasForeignKey(d => d.OwnerUserId)
                .HasConstraintName("FK__specialis__owner__77AABCF8");
        });

        modelBuilder.Entity<TatRule>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__tat_rule__3213E83F7C5DABFF");

            entity.ToTable("tat_rules", "caredesk");

            entity.HasIndex(e => new { e.Category, e.Aggregate, e.Track, e.EffectiveFrom }, "UQ__tat_rule__761F115F49E8CCAA").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Aggregate)
                .HasMaxLength(100)
                .HasColumnName("aggregate");
            entity.Property(e => e.Category)
                .HasMaxLength(40)
                .HasColumnName("category");
            entity.Property(e => e.E1Hours)
                .HasColumnType("decimal(6, 2)")
                .HasColumnName("e1_hours");
            entity.Property(e => e.E2Hours)
                .HasColumnType("decimal(6, 2)")
                .HasColumnName("e2_hours");
            entity.Property(e => e.E3Hours)
                .HasColumnType("decimal(6, 2)")
                .HasColumnName("e3_hours");
            entity.Property(e => e.EffectiveFrom)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("effective_from");
            entity.Property(e => e.IsActive)
                .HasDefaultValue(true)
                .HasColumnName("is_active");
            entity.Property(e => e.ResponseHours)
                .HasDefaultValue(24m)
                .HasColumnType("decimal(6, 2)")
                .HasColumnName("response_hours");
            entity.Property(e => e.Track)
                .HasMaxLength(40)
                .HasDefaultValue("standard")
                .HasColumnName("track");
        });

        modelBuilder.Entity<Ticket>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__tickets__3213E83F7F62BE79");

            entity.ToTable("tickets", "caredesk");

            entity.HasIndex(e => e.TicketNo, "UQ__tickets__D596C1969773519A").IsUnique();

            entity.HasIndex(e => e.VehicleId, "one_running_ticket_per_vehicle")
                .IsUnique()
                .HasFilter("([vehicle_id] IS NOT NULL AND [status]<>'closed' AND [status]<>'auto_closed' AND [status]<>'info_not_received_closed' AND [status]<>'cancelled')");

            entity.HasIndex(e => new { e.CustomerId, e.Status }, "tickets_cust");

            entity.HasIndex(e => e.LevelDueAt, "tickets_due").HasFilter("([closed_at] IS NULL)");

            entity.HasIndex(e => new { e.CurrentOwnerId, e.Status, e.LevelDueAt }, "tickets_queue");

            entity.Property(e => e.Id)
                .HasDefaultValueSql("(newid())")
                .HasColumnName("id");
            entity.Property(e => e.Aggregate).HasColumnName("aggregate");
            entity.Property(e => e.Category)
                .HasMaxLength(40)
                .HasColumnName("category");
            entity.Property(e => e.CityId).HasColumnName("city_id");
            entity.Property(e => e.ClientMarkedRepeat).HasColumnName("client_marked_repeat");
            entity.Property(e => e.CloseReason).HasColumnName("close_reason");
            entity.Property(e => e.ClosedAt)
                .HasPrecision(3)
                .HasColumnName("closed_at");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.CreatedBy).HasColumnName("created_by");
            entity.Property(e => e.CurrentLevel)
                .HasMaxLength(40)
                .HasDefaultValue("E1")
                .HasColumnName("current_level");
            entity.Property(e => e.CurrentOwnerId).HasColumnName("current_owner_id");
            entity.Property(e => e.CustomerId).HasColumnName("customer_id");
            entity.Property(e => e.Description).HasColumnName("description");
            entity.Property(e => e.EngineerOutcome)
                .HasMaxLength(40)
                .HasColumnName("engineer_outcome");
            entity.Property(e => e.FirstResponseAt)
                .HasPrecision(3)
                .HasColumnName("first_response_at");
            entity.Property(e => e.HeldAt)
                .HasPrecision(3)
                .HasColumnName("held_at");
            entity.Property(e => e.HoldReason).HasColumnName("hold_reason");
            entity.Property(e => e.HubId).HasColumnName("hub_id");
            entity.Property(e => e.IsRepeat).HasColumnName("is_repeat");
            entity.Property(e => e.LevelDueAt)
                .HasPrecision(3)
                .HasColumnName("level_due_at");
            entity.Property(e => e.LevelStartedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("level_started_at");
            entity.Property(e => e.LocationLat)
                .HasColumnType("decimal(9, 6)")
                .HasColumnName("location_lat");
            entity.Property(e => e.LocationLng)
                .HasColumnType("decimal(9, 6)")
                .HasColumnName("location_lng");
            entity.Property(e => e.LocationSource)
                .HasDefaultValue("hub")
                .HasColumnName("location_source");
            entity.Property(e => e.LocationText).HasColumnName("location_text");
            entity.Property(e => e.OdometerKm).HasColumnName("odometer_km");
            entity.Property(e => e.OdometerSource)
                .HasMaxLength(40)
                .HasColumnName("odometer_source");
            entity.Property(e => e.OnsiteContactMobile).HasColumnName("onsite_contact_mobile");
            entity.Property(e => e.OnsiteContactName).HasColumnName("onsite_contact_name");
            entity.Property(e => e.PauseUsed).HasColumnName("pause_used");
            entity.Property(e => e.PausedAt)
                .HasPrecision(3)
                .HasColumnName("paused_at");
            entity.Property(e => e.ReopenCount).HasColumnName("reopen_count");
            entity.Property(e => e.RepeatOfTicketId).HasColumnName("repeat_of_ticket_id");
            entity.Property(e => e.ResolvedAt)
                .HasPrecision(3)
                .HasColumnName("resolved_at");
            entity.Property(e => e.ResponseDueAt)
                .HasPrecision(3)
                .HasColumnName("response_due_at");
            entity.Property(e => e.SpecialistQueue)
                .HasMaxLength(50)
                .HasColumnName("specialist_queue");
            entity.Property(e => e.Status)
                .HasMaxLength(40)
                .HasDefaultValue("new")
                .HasColumnName("status");
            entity.Property(e => e.SystemRepeat).HasColumnName("system_repeat");
            entity.Property(e => e.TatRuleId).HasColumnName("tat_rule_id");
            entity.Property(e => e.TicketNo)
                .HasMaxLength(30)
                .HasColumnName("ticket_no");
            entity.Property(e => e.Track)
                .HasMaxLength(40)
                .HasDefaultValue("standard")
                .HasColumnName("track");
            entity.Property(e => e.UpdatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("updated_at");
            entity.Property(e => e.VehicleId).HasColumnName("vehicle_id");

            entity.HasOne(d => d.City).WithMany(p => p.Tickets)
                .HasForeignKey(d => d.CityId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__tickets__city_id__0F824689");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.TicketCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__tickets__created__2759D01A");

            entity.HasOne(d => d.CurrentOwner).WithMany(p => p.TicketCurrentOwners)
                .HasForeignKey(d => d.CurrentOwnerId)
                .HasConstraintName("FK__tickets__current__1DD065E0");

            entity.HasOne(d => d.Customer).WithMany(p => p.Tickets)
                .HasForeignKey(d => d.CustomerId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__tickets__custome__0D99FE17");

            entity.HasOne(d => d.Hub).WithMany(p => p.Tickets)
                .HasForeignKey(d => d.HubId)
                .HasConstraintName("FK__tickets__hub_id__10766AC2");

            entity.HasOne(d => d.RepeatOfTicket).WithMany(p => p.InverseRepeatOfTicket)
                .HasForeignKey(d => d.RepeatOfTicketId)
                .HasConstraintName("FK__tickets__repeat___257187A8");

            entity.HasOne(d => d.SpecialistQueueNavigation).WithMany(p => p.Tickets)
                .HasForeignKey(d => d.SpecialistQueue)
                .HasConstraintName("FK__tickets__special__18178C8A");

            entity.HasOne(d => d.TatRule).WithMany(p => p.Tickets)
                .HasForeignKey(d => d.TatRuleId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__tickets__tat_rul__190BB0C3");

            entity.HasOne(d => d.Vehicle).WithOne(p => p.Ticket)
                .HasForeignKey<Ticket>(d => d.VehicleId)
                .HasConstraintName("FK__tickets__vehicle__0E8E2250");
        });

        modelBuilder.Entity<TicketConcern>(entity =>
        {
            entity.HasKey(e => new { e.TicketId, e.Aggregate }).HasName("PK__ticket_c__68C485C7680CDEE2");

            entity.ToTable("ticket_concerns", "caredesk");

            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.Aggregate)
                .HasMaxLength(100)
                .HasColumnName("aggregate");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketConcerns)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_co__ticke__30E33A54");
        });

        modelBuilder.Entity<TicketConfirmation>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_c__3213E83F3F49A227");

            entity.ToTable("ticket_confirmations", "caredesk");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.At)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("at");
            entity.Property(e => e.ByUserId).HasColumnName("by_user_id");
            entity.Property(e => e.Comment).HasColumnName("comment");
            entity.Property(e => e.Outcome)
                .HasMaxLength(40)
                .HasColumnName("outcome");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");

            entity.HasOne(d => d.ByUser).WithMany(p => p.TicketConfirmations)
                .HasForeignKey(d => d.ByUserId)
                .HasConstraintName("FK__ticket_co__by_us__4B622666");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketConfirmations)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_co__ticke__4979DDF4");
        });

        modelBuilder.Entity<TicketEvent>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_e__3213E83FEA738DDC");

            entity.ToTable("ticket_events", "caredesk");

            entity.HasIndex(e => new { e.TicketId, e.At }, "IX_ticket_events_ticket_id_at");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.ActorId).HasColumnName("actor_id");
            entity.Property(e => e.At)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("at");
            entity.Property(e => e.EventType).HasColumnName("event_type");
            entity.Property(e => e.FromValue).HasColumnName("from_value");
            entity.Property(e => e.Payload).HasColumnName("payload");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.ToValue).HasColumnName("to_value");

            entity.HasOne(d => d.Actor).WithMany(p => p.TicketEvents)
                .HasForeignKey(d => d.ActorId)
                .HasConstraintName("FK__ticket_ev__actor__55DFB4D9");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketEvents)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_ev__ticke__54EB90A0");
        });

        modelBuilder.Entity<TicketHold>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_h__3213E83F52DB5872");

            entity.ToTable("ticket_holds", "caredesk");

            entity.HasIndex(e => new { e.TicketId, e.HeldAt }, "IX_ticket_holds_ticket_id_held_at");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.HeldAt)
                .HasPrecision(3)
                .HasColumnName("held_at");
            entity.Property(e => e.HeldBy).HasColumnName("held_by");
            entity.Property(e => e.Reason).HasColumnName("reason");
            entity.Property(e => e.ReleasedAt)
                .HasPrecision(3)
                .HasColumnName("released_at");
            entity.Property(e => e.ReleasedBy).HasColumnName("released_by");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.WorkingHours)
                .HasColumnType("decimal(8, 2)")
                .HasColumnName("working_hours");

            entity.HasOne(d => d.HeldByNavigation).WithMany(p => p.TicketHoldHeldByNavigations)
                .HasForeignKey(d => d.HeldBy)
                .HasConstraintName("FK__ticket_ho__held___09946309");

            entity.HasOne(d => d.ReleasedByNavigation).WithMany(p => p.TicketHoldReleasedByNavigations)
                .HasForeignKey(d => d.ReleasedBy)
                .HasConstraintName("FK__ticket_ho__relea__0A888742");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketHolds)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_ho__ticke__07AC1A97");
        });

        modelBuilder.Entity<TicketLevelHistory>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_l__3213E83F55D322A9");

            entity.ToTable("ticket_level_history", "caredesk");

            entity.HasIndex(e => new { e.TicketId, e.StartedAt }, "IX_ticket_level_history_ticket_id_started_at");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.DueAt)
                .HasPrecision(3)
                .HasColumnName("due_at");
            entity.Property(e => e.EndReason).HasColumnName("end_reason");
            entity.Property(e => e.EndedAt)
                .HasPrecision(3)
                .HasColumnName("ended_at");
            entity.Property(e => e.FirstResponseAt)
                .HasPrecision(3)
                .HasColumnName("first_response_at");
            entity.Property(e => e.Level)
                .HasMaxLength(40)
                .HasColumnName("level");
            entity.Property(e => e.OwnerId).HasColumnName("owner_id");
            entity.Property(e => e.ResponseDueAt)
                .HasPrecision(3)
                .HasColumnName("response_due_at");
            entity.Property(e => e.StartedAt)
                .HasPrecision(3)
                .HasColumnName("started_at");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");

            entity.HasOne(d => d.Owner).WithMany(p => p.TicketLevelHistories)
                .HasForeignKey(d => d.OwnerId)
                .HasConstraintName("FK__ticket_le__owner__7C3A67EB");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketLevelHistories)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_le__ticke__7A521F79");
        });

        modelBuilder.Entity<TicketLink>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_l__3213E83F81087A6B");

            entity.ToTable("ticket_links", "caredesk");

            entity.HasIndex(e => new { e.TicketId, e.Reason }, "UQ__ticket_l__9CA22D5FE9A8BAB4").IsUnique();

            entity.HasIndex(e => e.LinkedTicketId, "UQ__ticket_l__CC0CBE769C8F6B1A").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.CreatedBy).HasColumnName("created_by");
            entity.Property(e => e.LinkedTicketId).HasColumnName("linked_ticket_id");
            entity.Property(e => e.Reason)
                .HasMaxLength(200)
                .HasColumnName("reason");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.TicketLinks)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__ticket_li__creat__45DE573A");

            entity.HasOne(d => d.LinkedTicket).WithOne(p => p.TicketLinkLinkedTicket)
                .HasForeignKey<TicketLink>(d => d.LinkedTicketId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__ticket_li__linke__43F60EC8");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketLinkTickets)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_li__ticke__4301EA8F");
        });

        modelBuilder.Entity<TicketMessage>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_m__3213E83FD1DCEA3E");

            entity.ToTable("ticket_messages", "caredesk");

            entity.HasIndex(e => new { e.TicketId, e.CreatedAt }, "IX_ticket_messages_ticket_id_created_at");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AuthorId).HasColumnName("author_id");
            entity.Property(e => e.Body).HasColumnName("body");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.Visibility)
                .HasMaxLength(40)
                .HasDefaultValue("customer")
                .HasColumnName("visibility");

            entity.HasOne(d => d.Author).WithMany(p => p.TicketMessages)
                .HasForeignKey(d => d.AuthorId)
                .HasConstraintName("FK__ticket_me__autho__24485945");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketMessages)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_me__ticke__2354350C");
        });

        modelBuilder.Entity<TicketPause>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_p__3213E83F49255ED7");

            entity.ToTable("ticket_pauses", "caredesk");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Answer).HasColumnName("answer");
            entity.Property(e => e.AnsweredAt)
                .HasPrecision(3)
                .HasColumnName("answered_at");
            entity.Property(e => e.AnsweredBy).HasColumnName("answered_by");
            entity.Property(e => e.PausedAt)
                .HasPrecision(3)
                .HasColumnName("paused_at");
            entity.Property(e => e.Reason)
                .HasDefaultValue("awaiting_client_info")
                .HasColumnName("reason");
            entity.Property(e => e.RemindedAt)
                .HasPrecision(3)
                .HasColumnName("reminded_at");
            entity.Property(e => e.RequestedBy).HasColumnName("requested_by");
            entity.Property(e => e.RequestedItems).HasColumnName("requested_items");
            entity.Property(e => e.ResumedAt)
                .HasPrecision(3)
                .HasColumnName("resumed_at");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");

            entity.HasOne(d => d.AnsweredByNavigation).WithMany(p => p.TicketPauseAnsweredByNavigations)
                .HasForeignKey(d => d.AnsweredBy)
                .HasConstraintName("FK__ticket_pa__answe__04CFADEC");

            entity.HasOne(d => d.RequestedByNavigation).WithMany(p => p.TicketPauseRequestedByNavigations)
                .HasForeignKey(d => d.RequestedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__ticket_pa__reque__02E7657A");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketPauses)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_pa__ticke__000AF8CF");
        });

        modelBuilder.Entity<TicketPayment>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_p__3213E83F27F6A081");

            entity.ToTable("ticket_payments", "caredesk");

            entity.HasIndex(e => new { e.TicketId, e.EnteredAt }, "IX_ticket_payments_ticket_id_entered_at");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.AmountInr)
                .HasColumnType("decimal(12, 2)")
                .HasColumnName("amount_inr");
            entity.Property(e => e.CheckNote).HasColumnName("check_note");
            entity.Property(e => e.CheckedAt)
                .HasPrecision(3)
                .HasColumnName("checked_at");
            entity.Property(e => e.CheckedBy).HasColumnName("checked_by");
            entity.Property(e => e.EnteredAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("entered_at");
            entity.Property(e => e.EnteredBy).HasColumnName("entered_by");
            entity.Property(e => e.Mode).HasColumnName("mode");
            entity.Property(e => e.PaidOn).HasColumnName("paid_on");
            entity.Property(e => e.ProofId).HasColumnName("proof_id");
            entity.Property(e => e.Purpose).HasColumnName("purpose");
            entity.Property(e => e.Status)
                .HasDefaultValue("entered")
                .HasColumnName("status");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.UtrNo).HasColumnName("utr_no");

            entity.HasOne(d => d.CheckedByNavigation).WithMany(p => p.TicketPaymentCheckedByNavigations)
                .HasForeignKey(d => d.CheckedBy)
                .HasConstraintName("FK__ticket_pa__check__3E082B48");

            entity.HasOne(d => d.EnteredByNavigation).WithMany(p => p.TicketPaymentEnteredByNavigations)
                .HasForeignKey(d => d.EnteredBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__ticket_pa__enter__3A379A64");

            entity.HasOne(d => d.Proof).WithMany(p => p.TicketPayments)
                .HasForeignKey(d => d.ProofId)
                .HasConstraintName("FK__ticket_pa__proof__3943762B");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketPayments)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_pa__ticke__36670980");
        });

        modelBuilder.Entity<TicketRating>(entity =>
        {
            entity.HasKey(e => e.TicketId).HasName("PK__ticket_r__D596F96BA42F309E");

            entity.ToTable("ticket_ratings", "caredesk");

            entity.Property(e => e.TicketId)
                .ValueGeneratedNever()
                .HasColumnName("ticket_id");
            entity.Property(e => e.ByUserId).HasColumnName("by_user_id");
            entity.Property(e => e.RatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("rated_at");
            entity.Property(e => e.Stars).HasColumnName("stars");

            entity.HasOne(d => d.ByUser).WithMany(p => p.TicketRatings)
                .HasForeignKey(d => d.ByUserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__ticket_ra__by_us__511AFFBC");

            entity.HasOne(d => d.Ticket).WithOne(p => p.TicketRating)
                .HasForeignKey<TicketRating>(d => d.TicketId)
                .HasConstraintName("FK__ticket_ra__ticke__4F32B74A");
        });

        modelBuilder.Entity<TicketResolution>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_r__3213E83F460A19AA");

            entity.ToTable("ticket_resolutions", "caredesk");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.JobCardNo).HasColumnName("job_card_no");
            entity.Property(e => e.NewSerialNo).HasColumnName("new_serial_no");
            entity.Property(e => e.Notes).HasColumnName("notes");
            entity.Property(e => e.PartReplaced).HasColumnName("part_replaced");
            entity.Property(e => e.Repaired).HasColumnName("repaired");
            entity.Property(e => e.ReplacedPartCode).HasColumnName("replaced_part_code");
            entity.Property(e => e.ResolvedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("resolved_at");
            entity.Property(e => e.ResolvedBy).HasColumnName("resolved_by");
            entity.Property(e => e.SwUpdated).HasColumnName("sw_updated");
            entity.Property(e => e.SwVersion).HasColumnName("sw_version");
            entity.Property(e => e.TechnicianEducated).HasColumnName("technician_educated");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");

            entity.HasOne(d => d.ResolvedByNavigation).WithMany(p => p.TicketResolutions)
                .HasForeignKey(d => d.ResolvedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__ticket_re__resol__45A94D10");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketResolutions)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_re__ticke__40E497F3");
        });

        modelBuilder.Entity<TicketRoute>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_r__3213E83FE92180F3");

            entity.ToTable("ticket_routes", "caredesk");

            entity.HasIndex(e => new { e.TicketId, e.RoutedAt }, "IX_ticket_routes_ticket_id_routed_at");

            entity.HasIndex(e => e.ResponseDueAt, "ticket_routes_waiting").HasFilter("([responded_at] IS NULL AND [ended_at] IS NULL)");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Answer).HasColumnName("answer");
            entity.Property(e => e.AnsweredAt)
                .HasPrecision(3)
                .HasColumnName("answered_at");
            entity.Property(e => e.AnsweredBy).HasColumnName("answered_by");
            entity.Property(e => e.CommittedBy).HasColumnName("committed_by");
            entity.Property(e => e.DispatchEta).HasColumnName("dispatch_eta");
            entity.Property(e => e.EndReason).HasColumnName("end_reason");
            entity.Property(e => e.EndedAt)
                .HasPrecision(3)
                .HasColumnName("ended_at");
            entity.Property(e => e.LateAlertedAt)
                .HasPrecision(3)
                .HasColumnName("late_alerted_at");
            entity.Property(e => e.Note).HasColumnName("note");
            entity.Property(e => e.OverdueAlertedAt)
                .HasPrecision(3)
                .HasColumnName("overdue_alerted_at");
            entity.Property(e => e.PartNo).HasColumnName("part_no");
            entity.Property(e => e.Question).HasColumnName("question");
            entity.Property(e => e.QuestionAt)
                .HasPrecision(3)
                .HasColumnName("question_at");
            entity.Property(e => e.Queue)
                .HasMaxLength(50)
                .HasColumnName("queue");
            entity.Property(e => e.RespondedAt)
                .HasPrecision(3)
                .HasColumnName("responded_at");
            entity.Property(e => e.RespondedBy).HasColumnName("responded_by");
            entity.Property(e => e.ResponseDueAt)
                .HasPrecision(3)
                .HasColumnName("response_due_at");
            entity.Property(e => e.Result).HasColumnName("result");
            entity.Property(e => e.ResultAt)
                .HasPrecision(3)
                .HasColumnName("result_at");
            entity.Property(e => e.ResultBy).HasColumnName("result_by");
            entity.Property(e => e.RoutedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("routed_at");
            entity.Property(e => e.RoutedBy).HasColumnName("routed_by");
            entity.Property(e => e.SoToNo).HasColumnName("so_to_no");
            entity.Property(e => e.Stage)
                .HasDefaultValue("routed")
                .HasColumnName("stage");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");

            entity.HasOne(d => d.AnsweredByNavigation).WithMany(p => p.TicketRouteAnsweredByNavigations)
                .HasForeignKey(d => d.AnsweredBy)
                .HasConstraintName("FK__ticket_ro__answe__1E8F7FEF");

            entity.HasOne(d => d.QueueNavigation).WithMany(p => p.TicketRoutes)
                .HasForeignKey(d => d.Queue)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__ticket_ro__queue__17E28260");

            entity.HasOne(d => d.RespondedByNavigation).WithMany(p => p.TicketRouteRespondedByNavigations)
                .HasForeignKey(d => d.RespondedBy)
                .HasConstraintName("FK__ticket_ro__respo__1ABEEF0B");

            entity.HasOne(d => d.ResultByNavigation).WithMany(p => p.TicketRouteResultByNavigations)
                .HasForeignKey(d => d.ResultBy)
                .HasConstraintName("FK__ticket_ro__resul__2077C861");

            entity.HasOne(d => d.RoutedByNavigation).WithMany(p => p.TicketRouteRoutedByNavigations)
                .HasForeignKey(d => d.RoutedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__ticket_ro__route__18D6A699");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketRoutes)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_ro__ticke__16EE5E27");
        });

        modelBuilder.Entity<TicketSpare>(entity =>
        {
            entity.HasKey(e => e.TicketId).HasName("PK__ticket_s__D596F96BF363D46C");

            entity.ToTable("ticket_spares", "caredesk");

            entity.Property(e => e.TicketId)
                .ValueGeneratedNever()
                .HasColumnName("ticket_id");
            entity.Property(e => e.AmountInr)
                .HasColumnType("decimal(12, 2)")
                .HasColumnName("amount_inr");
            entity.Property(e => e.CreditOpenInr)
                .HasColumnType("decimal(12, 2)")
                .HasColumnName("credit_open_inr");
            entity.Property(e => e.CreditPaidAt)
                .HasPrecision(3)
                .HasColumnName("credit_paid_at");
            entity.Property(e => e.CreditPaidBy).HasColumnName("credit_paid_by");
            entity.Property(e => e.CreditPaidNote).HasColumnName("credit_paid_note");
            entity.Property(e => e.DeliveryAddress).HasColumnName("delivery_address");
            entity.Property(e => e.OrderCheckedAt)
                .HasPrecision(3)
                .HasColumnName("order_checked_at");
            entity.Property(e => e.OrderCheckedBy).HasColumnName("order_checked_by");
            entity.Property(e => e.OrderValueInr)
                .HasColumnType("decimal(12, 2)")
                .HasColumnName("order_value_inr");
            entity.Property(e => e.PaymentDate).HasColumnName("payment_date");
            entity.Property(e => e.PaymentMode).HasColumnName("payment_mode");
            entity.Property(e => e.SoId).HasColumnName("so_id");
            entity.Property(e => e.UtrNo).HasColumnName("utr_no");
            entity.Property(e => e.VehicleOffRoad).HasColumnName("vehicle_off_road");

            entity.HasOne(d => d.CreditPaidByNavigation).WithMany(p => p.TicketSpareCreditPaidByNavigations)
                .HasForeignKey(d => d.CreditPaidBy)
                .HasConstraintName("FK__ticket_sp__credi__4F67C174");

            entity.HasOne(d => d.OrderCheckedByNavigation).WithMany(p => p.TicketSpareOrderCheckedByNavigations)
                .HasForeignKey(d => d.OrderCheckedBy)
                .HasConstraintName("FK__ticket_sp__order__4C8B54C9");

            entity.HasOne(d => d.Ticket).WithOne(p => p.TicketSpare)
                .HasForeignKey<TicketSpare>(d => d.TicketId)
                .HasConstraintName("FK__ticket_sp__ticke__49AEE81E");
        });

        modelBuilder.Entity<TicketSpareLine>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_s__3213E83F32F2A39B");

            entity.ToTable("ticket_spare_lines", "caredesk");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Description).HasColumnName("description");
            entity.Property(e => e.PartCode).HasColumnName("part_code");
            entity.Property(e => e.PartId).HasColumnName("part_id");
            entity.Property(e => e.Qty).HasColumnName("qty");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");

            entity.HasOne(d => d.Part).WithMany(p => p.TicketSpareLines)
                .HasForeignKey(d => d.PartId)
                .HasConstraintName("FK__ticket_sp__part___58F12BAE");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketSpareLines)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_sp__ticke__57FD0775");
        });

        modelBuilder.Entity<TicketStage>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__ticket_s__3213E83F1BBFAF2E");

            entity.ToTable("ticket_stages", "caredesk");

            entity.HasIndex(e => new { e.TicketId, e.StartedAt }, "IX_ticket_stages_ticket_id_started_at");

            entity.HasIndex(e => new { e.Actor, e.DueAt }, "ticket_stages_open").HasFilter("([done_at] IS NULL AND [undone_at] IS NULL)");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Actor)
                .HasMaxLength(40)
                .HasColumnName("actor");
            entity.Property(e => e.BalanceAlertedAt)
                .HasPrecision(3)
                .HasColumnName("balance_alerted_at");
            entity.Property(e => e.BalanceRemindedAt)
                .HasPrecision(3)
                .HasColumnName("balance_reminded_at");
            entity.Property(e => e.Data).HasColumnName("data");
            entity.Property(e => e.DoneAt)
                .HasPrecision(3)
                .HasColumnName("done_at");
            entity.Property(e => e.DoneBy).HasColumnName("done_by");
            entity.Property(e => e.DueAt)
                .HasPrecision(3)
                .HasColumnName("due_at");
            entity.Property(e => e.Flow).HasColumnName("flow");
            entity.Property(e => e.InvoiceId).HasColumnName("invoice_id");
            entity.Property(e => e.LateAlertedAt)
                .HasPrecision(3)
                .HasColumnName("late_alerted_at");
            entity.Property(e => e.Stage).HasColumnName("stage");
            entity.Property(e => e.StartedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("started_at");
            entity.Property(e => e.TicketId).HasColumnName("ticket_id");
            entity.Property(e => e.Transit).HasColumnName("transit");
            entity.Property(e => e.UndoReason).HasColumnName("undo_reason");
            entity.Property(e => e.UndoneAt)
                .HasPrecision(3)
                .HasColumnName("undone_at");
            entity.Property(e => e.UndoneBy).HasColumnName("undone_by");

            entity.HasOne(d => d.DoneByNavigation).WithMany(p => p.TicketStageDoneByNavigations)
                .HasForeignKey(d => d.DoneBy)
                .HasConstraintName("FK__ticket_st__done___1229A90A");

            entity.HasOne(d => d.Ticket).WithMany(p => p.TicketStages)
                .HasForeignKey(d => d.TicketId)
                .HasConstraintName("FK__ticket_st__ticke__0D64F3ED");

            entity.HasOne(d => d.UndoneByNavigation).WithMany(p => p.TicketStageUndoneByNavigations)
                .HasForeignKey(d => d.UndoneBy)
                .HasConstraintName("FK__ticket_st__undon__1411F17C");
        });

        modelBuilder.Entity<TicketWarranty>(entity =>
        {
            entity.HasKey(e => e.TicketId).HasName("PK__ticket_w__D596F96BB6BEFCE5");

            entity.ToTable("ticket_warranty", "caredesk");

            entity.Property(e => e.TicketId)
                .ValueGeneratedNever()
                .HasColumnName("ticket_id");
            entity.Property(e => e.ClaimDate).HasColumnName("claim_date");
            entity.Property(e => e.ClaimNo).HasColumnName("claim_no");
            entity.Property(e => e.DecidedAt)
                .HasPrecision(3)
                .HasColumnName("decided_at");
            entity.Property(e => e.Decision).HasColumnName("decision");
            entity.Property(e => e.DecisionReason).HasColumnName("decision_reason");
            entity.Property(e => e.EligibilityNote).HasColumnName("eligibility_note");
            entity.Property(e => e.FailureDescription).HasColumnName("failure_description");
            entity.Property(e => e.IsEligible).HasColumnName("is_eligible");
            entity.Property(e => e.KmUsed).HasColumnName("km_used");
            entity.Property(e => e.LrDate).HasColumnName("lr_date");
            entity.Property(e => e.LrNo).HasColumnName("lr_no");
            entity.Property(e => e.MonthsUsed).HasColumnName("months_used");
            entity.Property(e => e.OnSiteFixAt)
                .HasPrecision(3)
                .HasColumnName("on_site_fix_at");
            entity.Property(e => e.OnSiteFixBy).HasColumnName("on_site_fix_by");
            entity.Property(e => e.PartBackOn).HasColumnName("part_back_on");
            entity.Property(e => e.PartId).HasColumnName("part_id");
            entity.Property(e => e.PartName).HasColumnName("part_name");
            entity.Property(e => e.PartReceivedOn).HasColumnName("part_received_on");
            entity.Property(e => e.PartSerialNo).HasColumnName("part_serial_no");
            entity.Property(e => e.PolicyId).HasColumnName("policy_id");
            entity.Property(e => e.ReplacementDispatchDate).HasColumnName("replacement_dispatch_date");
            entity.Property(e => e.ReplacementLrNo).HasColumnName("replacement_lr_no");
            entity.Property(e => e.ReplacementTransporter).HasColumnName("replacement_transporter");
            entity.Property(e => e.Transporter).HasColumnName("transporter");

            entity.HasOne(d => d.OnSiteFixByNavigation).WithMany(p => p.TicketWarranties)
                .HasForeignKey(d => d.OnSiteFixBy)
                .HasConstraintName("FK__ticket_wa__on_si__379037E3");

            entity.HasOne(d => d.Part).WithMany(p => p.TicketWarranties)
                .HasForeignKey(d => d.PartId)
                .HasConstraintName("FK__ticket_wa__part___34B3CB38");

            entity.HasOne(d => d.Policy).WithMany(p => p.TicketWarranties)
                .HasForeignKey(d => d.PolicyId)
                .HasConstraintName("FK__ticket_wa__polic__35A7EF71");

            entity.HasOne(d => d.Ticket).WithOne(p => p.TicketWarranty)
                .HasForeignKey<TicketWarranty>(d => d.TicketId)
                .HasConstraintName("FK__ticket_wa__ticke__33BFA6FF");
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__users__3213E83FBC09C1AE");

            entity.ToTable("users", "caredesk");

            entity.HasIndex(e => e.Email, "UX_users_email")
                .IsUnique()
                .HasFilter("([email] IS NOT NULL)");

            entity.HasIndex(e => e.Username, "UX_users_username")
                .IsUnique()
                .HasFilter("([username] IS NOT NULL)");

            entity.Property(e => e.Id)
                .HasDefaultValueSql("(newid())")
                .HasColumnName("id");
            entity.Property(e => e.AllowEmailOtp)
                .HasDefaultValue(true)
                .HasColumnName("allow_email_otp");
            entity.Property(e => e.AllowPassword)
                .HasDefaultValue(true)
                .HasColumnName("allow_password");
            entity.Property(e => e.BackupUserId).HasColumnName("backup_user_id");
            entity.Property(e => e.CanEditMasters).HasColumnName("can_edit_masters");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.CustomerId).HasColumnName("customer_id");
            entity.Property(e => e.Email)
                .HasMaxLength(320)
                .UseCollation("Latin1_General_100_CI_AS")
                .HasColumnName("email");
            entity.Property(e => e.FullName).HasColumnName("full_name");
            entity.Property(e => e.IsActive)
                .HasDefaultValue(true)
                .HasColumnName("is_active");
            entity.Property(e => e.LastLoginAt)
                .HasPrecision(3)
                .HasColumnName("last_login_at");
            entity.Property(e => e.MobileE164).HasColumnName("mobile_e164");
            entity.Property(e => e.OnLeave).HasColumnName("on_leave");
            entity.Property(e => e.PasswordHash).HasColumnName("password_hash");
            entity.Property(e => e.ReportsToId).HasColumnName("reports_to_id");
            entity.Property(e => e.Role)
                .HasMaxLength(40)
                .HasColumnName("role");
            entity.Property(e => e.Username)
                .HasMaxLength(320)
                .UseCollation("Latin1_General_100_CI_AS")
                .HasColumnName("username");

            entity.HasOne(d => d.BackupUser).WithMany(p => p.InverseBackupUser)
                .HasForeignKey(d => d.BackupUserId)
                .HasConstraintName("FK__users__backup_us__1293BD5E");

            entity.HasOne(d => d.Customer).WithMany(p => p.Users)
                .HasForeignKey(d => d.CustomerId)
                .HasConstraintName("FK__users__customer___0FB750B3");

            entity.HasOne(d => d.ReportsTo).WithMany(p => p.InverseReportsTo)
                .HasForeignKey(d => d.ReportsToId)
                .HasConstraintName("FK__users__reports_t__1387E197");
        });

        modelBuilder.Entity<UserLeave>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__user_lea__3213E83F99652693");

            entity.ToTable("user_leaves", "caredesk");

            entity.HasIndex(e => e.UserId, "user_leaves_open").HasFilter("([cancelled_at] IS NULL)");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.BackupUserId).HasColumnName("backup_user_id");
            entity.Property(e => e.CancelledAt)
                .HasPrecision(3)
                .HasColumnName("cancelled_at");
            entity.Property(e => e.CancelledBy).HasColumnName("cancelled_by");
            entity.Property(e => e.EndsOn).HasColumnName("ends_on");
            entity.Property(e => e.SetAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("set_at");
            entity.Property(e => e.SetBy).HasColumnName("set_by");
            entity.Property(e => e.StartAlertedAt)
                .HasPrecision(3)
                .HasColumnName("start_alerted_at");
            entity.Property(e => e.StartsOn).HasColumnName("starts_on");
            entity.Property(e => e.UserId).HasColumnName("user_id");
        });

        modelBuilder.Entity<UserLink>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__user_lin__3213E83F25E3A534");

            entity.ToTable("user_links", "caredesk");

            entity.HasIndex(e => new { e.UserId, e.CreatedAt }, "IX_user_links_user_id_created_at").IsDescending(false, true);

            entity.HasIndex(e => e.TokenHash, "UQ__user_lin__9F6BDB13BA047B35").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.CreatedBy).HasColumnName("created_by");
            entity.Property(e => e.ExpiresAt)
                .HasPrecision(3)
                .HasColumnName("expires_at");
            entity.Property(e => e.Purpose).HasColumnName("purpose");
            entity.Property(e => e.TokenHash)
                .HasMaxLength(64)
                .HasColumnName("token_hash");
            entity.Property(e => e.UsedAt)
                .HasPrecision(3)
                .HasColumnName("used_at");
            entity.Property(e => e.UserId).HasColumnName("user_id");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.UserLinkCreatedByNavigations)
                .HasForeignKey(d => d.CreatedBy)
                .HasConstraintName("FK__user_link__creat__39AD8A7F");

            entity.HasOne(d => d.User).WithMany(p => p.UserLinkUsers)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__user_link__user___36D11DD4");
        });

        modelBuilder.Entity<UserScope>(entity =>
        {
            entity
                .HasNoKey()
                .ToTable("user_scopes", "caredesk");

            entity.HasIndex(e => new { e.UserId, e.CityId, e.CustomerId }, "UQ__user_sco__AD421BDF2296B976").IsUnique();

            entity.Property(e => e.CityId).HasColumnName("city_id");
            entity.Property(e => e.CustomerId).HasColumnName("customer_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");

            entity.HasOne(d => d.City).WithMany()
                .HasForeignKey(d => d.CityId)
                .HasConstraintName("FK__user_scop__city___297722B6");

            entity.HasOne(d => d.Customer).WithMany()
                .HasForeignKey(d => d.CustomerId)
                .HasConstraintName("FK__user_scop__custo__2A6B46EF");

            entity.HasOne(d => d.User).WithMany()
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("FK__user_scop__user___2882FE7D");
        });

        modelBuilder.Entity<UserSession>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__user_ses__3213E83F5A0A8F13");

            entity.ToTable("user_sessions", "caredesk");

            entity.HasIndex(e => e.UserId, "IX_user_sessions_user_id").HasFilter("([revoked_at] IS NULL)");

            entity.HasIndex(e => e.TokenHash, "UQ__user_ses__9F6BDB130CD2C277").IsUnique();

            entity.Property(e => e.Id)
                .HasDefaultValueSql("(newid())")
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.ExpiresAt)
                .HasPrecision(3)
                .HasColumnName("expires_at");
            entity.Property(e => e.Ip)
                .HasMaxLength(45)
                .HasColumnName("ip");
            entity.Property(e => e.LastSeenAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("last_seen_at");
            entity.Property(e => e.LoginMethod).HasColumnName("login_method");
            entity.Property(e => e.RevokeReason).HasColumnName("revoke_reason");
            entity.Property(e => e.RevokedAt)
                .HasPrecision(3)
                .HasColumnName("revoked_at");
            entity.Property(e => e.TokenHash)
                .HasMaxLength(64)
                .HasColumnName("token_hash");
            entity.Property(e => e.UserAgent).HasColumnName("user_agent");
            entity.Property(e => e.UserId).HasColumnName("user_id");

            entity.HasOne(d => d.User).WithMany(p => p.UserSessions)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__user_sess__user___2F2FFC0C");
        });

        modelBuilder.Entity<Vehicle>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__vehicles__3213E83F29024CD1");

            entity.ToTable("vehicles", "caredesk");

            entity.HasIndex(e => e.Vin, "UQ__vehicles__DDB00C668E23E950").IsUnique();

            entity.HasIndex(e => e.RegNo, "UX_vehicles_reg_no")
                .IsUnique()
                .HasFilter("([reg_no] IS NOT NULL)");

            entity.HasIndex(e => new { e.CustomerId, e.RegLast4 }, "vehicles_cust_last4");

            entity.Property(e => e.Id)
                .HasDefaultValueSql("(newid())")
                .HasColumnName("id");
            entity.Property(e => e.BatteryNo).HasColumnName("battery_no");
            entity.Property(e => e.ChargerNo).HasColumnName("charger_no");
            entity.Property(e => e.CityId).HasColumnName("city_id");
            entity.Property(e => e.CreatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("created_at");
            entity.Property(e => e.CustomerId).HasColumnName("customer_id");
            entity.Property(e => e.HubId).HasColumnName("hub_id");
            entity.Property(e => e.IotDeviceId).HasColumnName("iot_device_id");
            entity.Property(e => e.IsActive)
                .HasDefaultValue(true)
                .HasColumnName("is_active");
            entity.Property(e => e.ModelId).HasColumnName("model_id");
            entity.Property(e => e.MotorNo).HasColumnName("motor_no");
            entity.Property(e => e.RegLast4)
                .HasMaxLength(4)
                .HasComputedColumnSql("(right(replace(translate(coalesce([reg_no],N''),N'ABCDEFGHIJKLMNOPQRSTUVWXYZ-/. ',N'||||||||||||||||||||||||||||||'),N'|',N''),(4)))", true)
                .HasColumnName("reg_last4");
            entity.Property(e => e.RegNo)
                .HasMaxLength(30)
                .HasColumnName("reg_no");
            entity.Property(e => e.SaleDate).HasColumnName("sale_date");
            entity.Property(e => e.UpdatedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("updated_at");
            entity.Property(e => e.Vin)
                .HasMaxLength(40)
                .HasColumnName("vin");
            entity.Property(e => e.WarrantyTill).HasColumnName("warranty_till");

            entity.HasOne(d => d.City).WithMany(p => p.Vehicles)
                .HasForeignKey(d => d.CityId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__vehicles__city_i__4AD81681");

            entity.HasOne(d => d.Customer).WithMany(p => p.Vehicles)
                .HasForeignKey(d => d.CustomerId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__vehicles__custom__48EFCE0F");

            entity.HasOne(d => d.Hub).WithMany(p => p.Vehicles)
                .HasForeignKey(d => d.HubId)
                .HasConstraintName("FK__vehicles__hub_id__49E3F248");

            entity.HasOne(d => d.Model).WithMany(p => p.Vehicles)
                .HasForeignKey(d => d.ModelId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__vehicles__model___47FBA9D6");
        });

        modelBuilder.Entity<VehicleAssignmentHistory>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__vehicle___3213E83FD67C383A");

            entity.ToTable("vehicle_assignment_history", "caredesk");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.ChangedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("changed_at");
            entity.Property(e => e.ChangedBy).HasColumnName("changed_by");
            entity.Property(e => e.FromCustomer).HasColumnName("from_customer");
            entity.Property(e => e.Reason).HasColumnName("reason");
            entity.Property(e => e.ToCustomer).HasColumnName("to_customer");
            entity.Property(e => e.VehicleId).HasColumnName("vehicle_id");

            entity.HasOne(d => d.ChangedByNavigation).WithMany(p => p.VehicleAssignmentHistories)
                .HasForeignKey(d => d.ChangedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__vehicle_a__chang__536D5C82");

            entity.HasOne(d => d.FromCustomerNavigation).WithMany(p => p.VehicleAssignmentHistoryFromCustomerNavigations)
                .HasForeignKey(d => d.FromCustomer)
                .HasConstraintName("FK__vehicle_a__from___51851410");

            entity.HasOne(d => d.ToCustomerNavigation).WithMany(p => p.VehicleAssignmentHistoryToCustomerNavigations)
                .HasForeignKey(d => d.ToCustomer)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__vehicle_a__to_cu__52793849");

            entity.HasOne(d => d.Vehicle).WithMany(p => p.VehicleAssignmentHistories)
                .HasForeignKey(d => d.VehicleId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__vehicle_a__vehic__5090EFD7");
        });

        modelBuilder.Entity<VehicleModel>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__vehicle___3213E83F8D732AE5");

            entity.ToTable("vehicle_models", "caredesk");

            entity.HasIndex(e => e.Name, "UQ__vehicle___72E12F1BD32AE70F").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.IsActive)
                .HasDefaultValue(true)
                .HasColumnName("is_active");
            entity.Property(e => e.Name)
                .HasMaxLength(200)
                .HasColumnName("name");
        });

        modelBuilder.Entity<VehicleUploadBatch>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__vehicle___3213E83FB8F3E5E0");

            entity.ToTable("vehicle_upload_batches", "caredesk");

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.ErrorReport).HasColumnName("error_report");
            entity.Property(e => e.FileName).HasColumnName("file_name");
            entity.Property(e => e.RowsError).HasColumnName("rows_error");
            entity.Property(e => e.RowsOk).HasColumnName("rows_ok");
            entity.Property(e => e.RowsTotal).HasColumnName("rows_total");
            entity.Property(e => e.UploadedAt)
                .HasPrecision(3)
                .HasDefaultValueSql("(sysdatetimeoffset())")
                .HasColumnName("uploaded_at");
            entity.Property(e => e.UploadedBy).HasColumnName("uploaded_by");

            entity.HasOne(d => d.UploadedByNavigation).WithMany(p => p.VehicleUploadBatches)
                .HasForeignKey(d => d.UploadedBy)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("FK__vehicle_u__uploa__573DED66");
        });

        modelBuilder.Entity<WarrantyPolicy>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PK__warranty__3213E83F5446C461");

            entity.ToTable("warranty_policies", "caredesk");

            entity.HasIndex(e => new { e.Aggregate, e.CustomerId, e.ModelId, e.EffectiveFrom }, "warranty_policies_one_start").IsUnique();

            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Aggregate)
                .HasMaxLength(100)
                .HasColumnName("aggregate");
            entity.Property(e => e.CustomerId).HasColumnName("customer_id");
            entity.Property(e => e.DocVersion).HasColumnName("doc_version");
            entity.Property(e => e.EffectiveFrom).HasColumnName("effective_from");
            entity.Property(e => e.EffectiveTo).HasColumnName("effective_to");
            entity.Property(e => e.IsCovered)
                .HasDefaultValue(true)
                .HasColumnName("is_covered");
            entity.Property(e => e.KmLimit).HasColumnName("km_limit");
            entity.Property(e => e.ModelId).HasColumnName("model_id");
            entity.Property(e => e.Months).HasColumnName("months");
            entity.Property(e => e.SourceDoc).HasColumnName("source_doc");

            entity.HasOne(d => d.Customer).WithMany(p => p.WarrantyPolicies)
                .HasForeignKey(d => d.CustomerId)
                .HasConstraintName("FK__warranty___custo__5EDF0F2E");

            entity.HasOne(d => d.Model).WithMany(p => p.WarrantyPolicies)
                .HasForeignKey(d => d.ModelId)
                .HasConstraintName("FK__warranty___model__5FD33367");
        });

        modelBuilder.Entity<WarrantyRepair>(entity =>
        {
            entity.HasKey(e => e.TicketId).HasName("PK__warranty__D596F96B619BD65D");

            entity.ToTable("warranty_repairs", "caredesk");

            entity.Property(e => e.TicketId)
                .ValueGeneratedNever()
                .HasColumnName("ticket_id");
            entity.Property(e => e.ClientDecision).HasColumnName("client_decision");
            entity.Property(e => e.DecidedAt)
                .HasPrecision(3)
                .HasColumnName("decided_at");
            entity.Property(e => e.DecisionNote).HasColumnName("decision_note");
            entity.Property(e => e.PartOutcome).HasColumnName("part_outcome");
            entity.Property(e => e.PartOutcomeAt)
                .HasPrecision(3)
                .HasColumnName("part_outcome_at");
            entity.Property(e => e.PartOutcomeBy).HasColumnName("part_outcome_by");
            entity.Property(e => e.PartOutcomeDate).HasColumnName("part_outcome_date");
            entity.Property(e => e.PartOutcomeLr).HasColumnName("part_outcome_lr");
            entity.Property(e => e.PartOutcomeNote).HasColumnName("part_outcome_note");
            entity.Property(e => e.QuoteAmount)
                .HasColumnType("decimal(12, 2)")
                .HasColumnName("quote_amount");
            entity.Property(e => e.QuoteNote).HasColumnName("quote_note");
            entity.Property(e => e.RepairNote).HasColumnName("repair_note");
            entity.Property(e => e.RepairedOn).HasColumnName("repaired_on");
            entity.Property(e => e.ReturnDispatchDate).HasColumnName("return_dispatch_date");
            entity.Property(e => e.ReturnLrNo).HasColumnName("return_lr_no");
            entity.Property(e => e.ReturnTransporter).HasColumnName("return_transporter");

            entity.HasOne(d => d.PartOutcomeByNavigation).WithMany(p => p.WarrantyRepairs)
                .HasForeignKey(d => d.PartOutcomeBy)
                .HasConstraintName("FK__warranty___part___3E3D3572");

            entity.HasOne(d => d.Ticket).WithOne(p => p.WarrantyRepair)
                .HasForeignKey<WarrantyRepair>(d => d.TicketId)
                .HasConstraintName("FK__warranty___ticke__3A6CA48E");
        });

        modelBuilder.Entity<WeeklyOff>(entity =>
        {
            entity.HasKey(e => e.Dow).HasName("PK__weekly_o__D8760175B5799212");

            entity.ToTable("weekly_offs", "caredesk");

            entity.Property(e => e.Dow)
                .ValueGeneratedNever()
                .HasColumnName("dow");
        });
        modelBuilder.HasSequence("ticket_seq", "caredesk");

        OnModelCreatingPartial(modelBuilder);
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
}
