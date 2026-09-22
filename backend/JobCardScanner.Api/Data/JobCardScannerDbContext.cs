using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Data;

public class JobCardScannerDbContext : DbContext
{
    public JobCardScannerDbContext(DbContextOptions<JobCardScannerDbContext> options) : base(options) { }

    public DbSet<Dealer> Dealers => Set<Dealer>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Vehicle> Vehicles => Set<Vehicle>();
    public DbSet<Warranty> Warranties => Set<Warranty>();

    public DbSet<WorkflowStage> WorkflowStages => Set<WorkflowStage>();

    public DbSet<JobCard> JobCards => Set<JobCard>();
    public DbSet<JobCardComplaint> JobCardComplaints => Set<JobCardComplaint>();
    public DbSet<JobCardInspection> JobCardInspections => Set<JobCardInspection>();
    public DbSet<JobCardPhoto> JobCardPhotos => Set<JobCardPhoto>();
    public DbSet<JobCardStageHistory> JobCardStageHistories => Set<JobCardStageHistory>();
    public DbSet<JobCardWorklog> JobCardWorklogs => Set<JobCardWorklog>();
    public DbSet<QcChecklistItem> QcChecklistItems => Set<QcChecklistItem>();

    public DbSet<Estimate> Estimates => Set<Estimate>();
    public DbSet<EstimateLine> EstimateLines => Set<EstimateLine>();

    public DbSet<PartMaster> PartMasters => Set<PartMaster>();
    public DbSet<JobCardPart> JobCardParts => Set<JobCardPart>();
    public DbSet<JobCardPartSuggestion> JobCardPartSuggestions => Set<JobCardPartSuggestion>();
    public DbSet<JobCardLabourSuggestion> JobCardLabourSuggestions => Set<JobCardLabourSuggestion>();

    public DbSet<Invoice> Invoices => Set<Invoice>();

    // 2026-09-19 "Create Repair Bill and Material Transfer Bill ... save in JobCardScannerDb" -
    // see Models/RepairBillDocs.cs / MaterialTransferDocs.cs doc comments for how these differ
    // from both BAPL DMS's own (never-written-to) tables and the read-only DMSBAPLDATA-synced
    // report pages of the same name.
    public DbSet<RepairBillDoc> RepairBillDocs => Set<RepairBillDoc>();
    public DbSet<RepairBillDocItem> RepairBillDocItems => Set<RepairBillDocItem>();
    public DbSet<MaterialTransferDoc> MaterialTransferDocs => Set<MaterialTransferDoc>();
    public DbSet<MaterialTransferDocItem> MaterialTransferDocItems => Set<MaterialTransferDocItem>();

    // 2026-09-21 "Part Upload" tab - see Models/PartUploads.cs's doc comment. JobCardScannerDb-
    // native, same as RepairBillDocs/MaterialTransferDocs above.
    public DbSet<PartUpload> PartUploads => Set<PartUpload>();

    // 2026-09-22 "create warenty table in jobcardscanner db" - see
    // Models/ExtendedBatteryWarrantySchemes.cs's own doc comment.
    public DbSet<ExtendedBatteryWarrantyScheme> ExtendedBatteryWarrantySchemes => Set<ExtendedBatteryWarrantyScheme>();

    // 2026-09-22 "this all table add in jobcard db" - see Models/OemModels.cs's own doc comment.
    public DbSet<OemModel> OemModels => Set<OemModel>();
    public DbSet<OemModelWarranty> OemModelWarranties => Set<OemModelWarranty>();

    public DbSet<NotificationTemplate> NotificationTemplates => Set<NotificationTemplate>();
    public DbSet<NotificationRecord> NotificationRecords => Set<NotificationRecord>();
    public DbSet<OtpRequest> OtpRequests => Set<OtpRequest>();

    public DbSet<AuditLogEntry> AuditLogEntries => Set<AuditLogEntry>();
    public DbSet<IntegrationLogEntry> IntegrationLogEntries => Set<IntegrationLogEntry>();
    public DbSet<Counter> Counters => Set<Counter>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        // ---------------------------------------------------------------
        // Global default: every FK is non-cascading unless explicitly
        // overridden below. SQL Server rejects multiple cascade paths
        // (e.g. JobCard reaches Dealer via Dealer, via Customer, and via
        // Vehicle) so cascade is opted-in only for true parent/child
        // "owned list" relationships, never for lookup/reference FKs.
        // ---------------------------------------------------------------
        foreach (var fk in b.Model.GetEntityTypes().SelectMany(e => e.GetForeignKeys()))
        {
            fk.DeleteBehavior = DeleteBehavior.Restrict;
        }

        // ----- Dealer -----
        b.Entity<Dealer>(e =>
        {
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(20);
        });

        // ----- User -----
        b.Entity<User>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.HasIndex(x => x.AzureAdObjectId);
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(30);
            e.HasOne(x => x.Dealer).WithMany(d => d.Users).HasForeignKey(x => x.DealerId);
        });

        // ----- Customer / Vehicle / Warranty -----
        b.Entity<Customer>(e =>
        {
            e.HasIndex(x => x.Mobile);
            e.HasOne(x => x.Dealer).WithMany(d => d.Customers).HasForeignKey(x => x.DealerId);
        });

        b.Entity<Vehicle>(e =>
        {
            e.HasIndex(x => x.RegNo);
            e.HasIndex(x => x.Vin);
            e.HasOne(x => x.Customer).WithMany(c => c.Vehicles).HasForeignKey(x => x.CustomerId)
                .OnDelete(DeleteBehavior.Cascade); // deleting a customer removes their vehicles
        });

        b.Entity<Warranty>(e =>
        {
            e.HasOne(x => x.Vehicle).WithOne(v => v.Warranty)
                .HasForeignKey<Warranty>(x => x.VehicleId)
                .OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        });

        // ----- WorkflowStage -----
        b.Entity<WorkflowStage>(e =>
        {
            e.HasIndex(x => new { x.DealerId, x.StageKey }).IsUnique();
        });

        // ----- JobCard + children (cascade delete from JobCard) -----
        b.Entity<JobCard>(e =>
        {
            e.HasIndex(x => x.JobCardNumber).IsUnique();
            e.HasIndex(x => x.TrackingToken).IsUnique();
            e.HasIndex(x => x.Status);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.ServiceType).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.Priority).HasConversion<string>().HasMaxLength(20);

            e.HasOne(x => x.Vehicle).WithMany(v => v.JobCards).HasForeignKey(x => x.VehicleId);
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            e.HasOne(x => x.Dealer).WithMany().HasForeignKey(x => x.DealerId);
            e.HasOne(x => x.CurrentStage).WithMany().HasForeignKey(x => x.CurrentStageId);
            e.HasOne(x => x.ServiceAdvisor).WithMany().HasForeignKey(x => x.ServiceAdvisorId);
            e.HasOne(x => x.AssignedTechnician).WithMany().HasForeignKey(x => x.AssignedTechnicianId);
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById);
        });

        b.Entity<JobCardComplaint>(e =>
            e.HasOne(x => x.JobCard).WithMany(j => j.Complaints).HasForeignKey(x => x.JobCardId).OnDelete(DeleteBehavior.Cascade));

        b.Entity<JobCardInspection>(e =>
        {
            e.HasOne(x => x.JobCard).WithMany(j => j.Inspections).HasForeignKey(x => x.JobCardId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Technician).WithMany().HasForeignKey(x => x.TechnicianId);
        });

        b.Entity<JobCardPhoto>(e =>
        {
            e.HasOne(x => x.JobCard).WithMany(j => j.Photos).HasForeignKey(x => x.JobCardId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.UploadedBy).WithMany().HasForeignKey(x => x.UploadedById);
            e.Property(x => x.Stage).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<JobCardStageHistory>(e =>
        {
            e.HasOne(x => x.JobCard).WithMany(j => j.StageHistory).HasForeignKey(x => x.JobCardId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Stage).WithMany().HasForeignKey(x => x.StageId);
            e.HasOne(x => x.ChangedBy).WithMany().HasForeignKey(x => x.ChangedById);
        });

        b.Entity<JobCardWorklog>(e =>
        {
            e.HasOne(x => x.JobCard).WithMany(j => j.Worklogs).HasForeignKey(x => x.JobCardId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Technician).WithMany().HasForeignKey(x => x.TechnicianId);
        });

        b.Entity<QcChecklistItem>(e =>
        {
            e.HasOne(x => x.JobCard).WithMany(j => j.QcChecklistItems).HasForeignKey(x => x.JobCardId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.CheckedBy).WithMany().HasForeignKey(x => x.CheckedById);
        });

        // ----- Estimate / EstimateLine -----
        b.Entity<Estimate>(e =>
        {
            e.HasIndex(x => x.EstimateNumber).IsUnique();
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(30);
            e.HasOne(x => x.JobCard).WithMany(j => j.Estimates).HasForeignKey(x => x.JobCardId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById);
        });

        b.Entity<EstimateLine>(e =>
        {
            e.HasOne(x => x.Estimate).WithMany(es => es.Lines).HasForeignKey(x => x.EstimateId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Part).WithMany().HasForeignKey(x => x.PartId);
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(20);
        });

        // ----- Parts -----
        b.Entity<PartMaster>(e =>
        {
            e.HasIndex(x => x.PartNumber);
            e.HasOne(x => x.Dealer).WithMany().HasForeignKey(x => x.DealerId);
        });

        b.Entity<JobCardPart>(e =>
        {
            e.HasOne(x => x.JobCard).WithMany(j => j.Parts).HasForeignKey(x => x.JobCardId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Part).WithMany().HasForeignKey(x => x.PartId);
            e.HasOne(x => x.RequestedBy).WithMany().HasForeignKey(x => x.RequestedById);
            e.HasOne(x => x.IssuedBy).WithMany().HasForeignKey(x => x.IssuedById);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<JobCardPartSuggestion>(e =>
        {
            e.HasOne(x => x.JobCard).WithMany(j => j.PartSuggestions).HasForeignKey(x => x.JobCardId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.SuggestedBy).WithMany().HasForeignKey(x => x.SuggestedById);
        });

        b.Entity<JobCardLabourSuggestion>(e =>
        {
            e.HasOne(x => x.JobCard).WithMany(j => j.LabourSuggestions).HasForeignKey(x => x.JobCardId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.SuggestedBy).WithMany().HasForeignKey(x => x.SuggestedById);
        });

        // ----- Invoice -----
        b.Entity<Invoice>(e =>
        {
            e.HasIndex(x => x.InvoiceNumber).IsUnique();
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.PaymentMode).HasConversion<string>().HasMaxLength(20);
            // WithOne(j => j.Invoice) + a unique index on JobCardId (was WithMany(), no uniqueness
            // constraint at all) makes "one invoice per job card" an actual DB-enforced rule
            // instead of only the application-level AnyAsync() check in InvoicesController.Generate
            // - and gives JobCard.Invoice a way to be Include()'d for the job card detail response.
            e.HasOne(x => x.JobCard).WithOne(j => j.Invoice).HasForeignKey<Invoice>(x => x.JobCardId);
            e.HasIndex(x => x.JobCardId).IsUnique();
            e.HasOne(x => x.Dealer).WithMany().HasForeignKey(x => x.DealerId);
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            e.HasOne(x => x.GeneratedBy).WithMany().HasForeignKey(x => x.GeneratedById);
        });

        // ----- RepairBillDoc / MaterialTransferDoc (2026-09-19, JobCardScannerDb-native, see
        // Models/RepairBillDocs.cs / MaterialTransferDocs.cs) -----
        b.Entity<RepairBillDoc>(e =>
        {
            e.HasIndex(x => x.BillNumber).IsUnique();
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasOne(x => x.Dealer).WithMany().HasForeignKey(x => x.DealerId);
            e.HasOne(x => x.JobCard).WithMany().HasForeignKey(x => x.JobCardId);
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            e.HasOne(x => x.Vehicle).WithMany().HasForeignKey(x => x.VehicleId);
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById);
            e.HasOne(x => x.UpdatedBy).WithMany().HasForeignKey(x => x.UpdatedById);
        });
        b.Entity<RepairBillDocItem>(e =>
        {
            e.HasOne(x => x.RepairBillDoc).WithMany(r => r.Items).HasForeignKey(x => x.RepairBillDocId).OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.ItemType).HasConversion<string>().HasMaxLength(20);
            // 2026-09-22 - Restrict (the global default) is deliberately kept here, not overridden:
            // a scheme referenced by an existing bill line can't be hard-deleted out from under it -
            // see ExtendedBatteryWarrantySchemesController.Delete.
            e.HasOne(x => x.ExtendedBatteryWarrantyScheme).WithMany().HasForeignKey(x => x.ExtendedBatteryWarrantySchemeId);
        });
        b.Entity<MaterialTransferDoc>(e =>
        {
            e.HasIndex(x => x.TransferNumber).IsUnique();
            e.Property(x => x.TransferType).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasOne(x => x.Dealer).WithMany().HasForeignKey(x => x.DealerId);
            e.HasOne(x => x.JobCard).WithMany().HasForeignKey(x => x.JobCardId);
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById);
            e.HasOne(x => x.Technician).WithMany().HasForeignKey(x => x.TechnicianId);
        });
        b.Entity<MaterialTransferDocItem>(e =>
        {
            e.HasOne(x => x.MaterialTransferDoc).WithMany(m => m.Items).HasForeignKey(x => x.MaterialTransferDocId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Part).WithMany().HasForeignKey(x => x.PartId);
        });

        // ----- PartUpload (2026-09-21, see Models/PartUploads.cs) -----
        b.Entity<PartUpload>(e =>
        {
            e.HasIndex(x => new { x.DealerId, x.LocationCode, x.PartNo }).IsUnique();
            e.HasOne(x => x.Dealer).WithMany().HasForeignKey(x => x.DealerId);
        });

        // ----- ExtendedBatteryWarrantyScheme (2026-09-22, see Models/ExtendedBatteryWarrantySchemes.cs) -----
        b.Entity<ExtendedBatteryWarrantyScheme>(e =>
        {
            e.HasIndex(x => new { x.DealerId, x.VehicleModel });
            e.HasOne(x => x.Dealer).WithMany().HasForeignKey(x => x.DealerId);
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById);
            e.HasOne(x => x.UpdatedBy).WithMany().HasForeignKey(x => x.UpdatedById);
            // Restrict (global default) is deliberately kept - a model referenced by a scheme
            // can't be hard-deleted out from under it, see OemModelsController.Delete's own check.
            e.HasOne(x => x.OemModel).WithMany().HasForeignKey(x => x.OemModelId);
        });

        // ----- OemModel / OemModelWarranty (2026-09-22, see Models/OemModels.cs) -----
        b.Entity<OemModel>(e =>
        {
            e.HasIndex(x => x.ModelName).IsUnique();
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById);
            e.HasOne(x => x.UpdatedBy).WithMany().HasForeignKey(x => x.UpdatedById);
        });
        b.Entity<OemModelWarranty>(e =>
        {
            // Cascade here (unlike the global Restrict default) mirrors Customer -> Vehicles: a
            // warranty-term row is owned by exactly one model, so deleting the model removes its
            // own warranty history with it - see OemModelsController.Delete's own comment.
            e.HasOne(x => x.OemModel).WithMany(m => m.Warranties).HasForeignKey(x => x.OemModelId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById);
            e.HasOne(x => x.UpdatedBy).WithMany().HasForeignKey(x => x.UpdatedById);
            e.HasIndex(x => new { x.OemModelId, x.EffectiveDate });
        });

        // ----- Notifications / OTP -----
        b.Entity<NotificationTemplate>(e => e.HasIndex(x => x.Key).IsUnique());

        b.Entity<NotificationRecord>(e =>
        {
            e.HasOne(x => x.JobCard).WithMany().HasForeignKey(x => x.JobCardId);
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            e.Property(x => x.Channel).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<OtpRequest>(e =>
        {
            e.HasIndex(x => new { x.Mobile, x.Purpose });
            e.HasOne(x => x.JobCard).WithMany().HasForeignKey(x => x.JobCardId);
            e.HasOne(x => x.Estimate).WithMany().HasForeignKey(x => x.EstimateId);
            e.Property(x => x.Purpose).HasConversion<string>().HasMaxLength(30);
        });

        // ----- System logs -----
        b.Entity<AuditLogEntry>(e =>
        {
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId);
            e.HasIndex(x => new { x.EntityType, x.EntityId });
        });

        b.Entity<IntegrationLogEntry>(e =>
        {
            e.Property(x => x.System).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Direction).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<Counter>(e =>
        {
            e.HasIndex(x => new { x.DealerId, x.CounterType }).IsUnique();
            e.HasOne(x => x.Dealer).WithMany().HasForeignKey(x => x.DealerId);
        });
    }
}
