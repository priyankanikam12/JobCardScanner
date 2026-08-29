using JobCardScanner.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Data;

/// <summary>
/// Idempotent structural-data seeder (runs once, in Development, from Program.cs): 2 dealers, a
/// handful of customers/vehicles with warranty, a default 15-stage workflow template, a
/// spare-parts catalog, and notification templates.
///
/// Deliberately does NOT seed any fictional staff. Your Azure AD tenant already has 1,400+ real
/// accounts (see AZURE_AD_SETUP.md) - fabricating pretend employees here would just be noise
/// that has to be cleaned out later. The one exception is <see cref="BootstrapAdminEmail"/>
/// below: something has to be able to sign in first, because Admin -> Users (where real staff
/// get added) itself requires being a provisioned admin to reach - a chicken-and-egg problem
/// every app with this pattern has. Change that constant to whichever real @bgauss.com account
/// should be the first one in, then add everyone else through Admin -> Users once you're signed
/// in - see AuthController.Me() / UsersController.Create() for how sign-in-time provisioning and
/// admin-driven provisioning work together.
/// </summary>
public static class DbSeeder
{
    /// <summary>The one real Azure AD account provisioned as SystemAdmin so there's a way in on
    /// a fresh database. Everyone else should be added afterward via Admin -> Users with their
    /// real email - not hardcoded here.</summary>
    public const string BootstrapAdminEmail = "oat@bgauss.com";

    public static async Task SeedAsync(JobCardScannerDbContext db)
    {
        if (await db.Dealers.AnyAsync()) return; // already seeded

        var north = new Dealer { Name = "BGauss EV Motors - Whitefield", Code = "BLR01", Region = "South", State = "Karnataka", City = "Bengaluru", Address = "123 ITPL Main Road, Whitefield", Gstin = "29ABCDE1234F1Z5", Phone = "080-45671234", Email = "whitefield@bgaussauto.com" };
        var south = new Dealer { Name = "BGauss EV Motors - Andheri", Code = "MUM01", Region = "West", State = "Maharashtra", City = "Mumbai", Address = "45 SV Road, Andheri West", Gstin = "27ABCDE5678F1Z9", Phone = "022-45679876", Email = "andheri@bgaussauto.com" };
        db.Dealers.AddRange(north, south);
        await db.SaveChangesAsync();

        // ---------------- Bootstrap admin (Azure AD - "Continue with Microsoft" tab) ----------------
        db.Users.Add(new User
        {
            Name = "System Admin",
            Email = BootstrapAdminEmail,
            Role = StaffRole.SystemAdmin,
            DealerId = null,
            AvatarColor = "#111827",
            AuthType = UserAuthType.AzureAd,
        });
        await db.SaveChangesAsync();

        // ---------------- Default 15-stage workflow template (DealerId = null => applies to all dealers) ----------------
        var stageDefs = new (string Key, string Label, string Icon, bool Terminal)[]
        {
            ("check_in", "Vehicle Check-In", "car-front", false),
            ("job_card_created", "Job Card Created", "file-plus", false),
            ("inspection", "Vehicle Inspection", "search", false),
            ("diagnosis", "Diagnosis", "stethoscope", false),
            ("estimate_prep", "Estimate Preparation", "calculator", false),
            ("customer_approval", "Customer Approval", "check-circle", false),
            ("parts_requested", "Parts Requested", "package", false),
            ("parts_issued", "Parts Issued", "package-check", false),
            ("in_repair", "In Repair / Service", "wrench", false),
            ("repair_completed", "Repair Completed", "circle-check", false),
            ("quality_check", "Quality Check", "shield-check", false),
            ("rework", "Re-Work", "rotate-ccw", false),
            ("ready_for_delivery", "Ready for Delivery", "flag", false),
            ("invoice_generated", "Invoice Generated", "receipt", false),
            ("closed", "Closed / Delivered", "circle-check-big", true),
        };
        var stages = stageDefs.Select((s, i) => new WorkflowStage
        {
            DealerId = null,
            StageKey = s.Key,
            Label = s.Label,
            Seq = i + 1,
            Icon = s.Icon,
            Active = true,
            IsTerminal = s.Terminal,
        }).ToList();
        db.WorkflowStages.AddRange(stages);
        await db.SaveChangesAsync();

        // ---------------- Customers, vehicles, warranty ----------------
        var customerDefs = new (string Name, string Mobile, string City, Dealer Dealer, string Model, string Variant, string Reg, string Vin)[]
        {
            ("Rohan Gupta", "9123456780", "Bengaluru", north, "BGauss B8", "Pro", "KA-01-AB-1234", "VIN00000000001"),
            ("Sanjana Reddy", "9123456781", "Bengaluru", north, "BGauss A2", "Standard", "KA-05-CD-5678", "VIN00000000002"),
            ("Manoj Pillai", "9123456782", "Bengaluru", north, "BGauss B8", "Max", "KA-03-EF-9012", "VIN00000000003"),
            ("Aisha Khan", "9123456783", "Mumbai", south, "BGauss D15", "Pro", "MH-02-GH-3456", "VIN00000000004"),
            ("Karthik Subramaniam", "9123456784", "Mumbai", south, "BGauss A2", "Standard", "MH-04-IJ-7890", "VIN00000000005"),
            ("Neha Agarwal", "9123456785", "Mumbai", south, "BGauss B8", "Pro", "MH-01-KL-2345", "VIN00000000006"),
        };
        foreach (var c in customerDefs)
        {
            var customer = new Customer { Name = c.Name, Mobile = c.Mobile, City = c.City, DealerId = c.Dealer.Id, Email = $"{c.Name.Split(' ')[0].ToLower()}@example.com", Address = $"{c.City}, India" };
            db.Customers.Add(customer);
            await db.SaveChangesAsync();

            var vehicle = new Vehicle
            {
                CustomerId = customer.Id,
                DealerId = c.Dealer.Id,
                Model = c.Model,
                Variant = c.Variant,
                Color = "White",
                RegNo = c.Reg,
                Vin = c.Vin,
                BatteryNo = $"BAT-{c.Vin[^6..]}",
                MotorNo = $"MOT-{c.Vin[^6..]}",
                PurchaseDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(-8)),
                Odometer = 1200 + Random.Shared.Next(0, 3000),
            };
            db.Vehicles.Add(vehicle);
            await db.SaveChangesAsync();

            db.Warranties.Add(new Warranty
            {
                VehicleId = vehicle.Id,
                Status = WarrantyStatus.Active,
                StartDate = vehicle.PurchaseDate,
                ExpiryDate = vehicle.PurchaseDate?.AddYears(3),
                CoverageKm = 30000,
                LabourCovered = true,
                BatteryWarrantyExpiry = vehicle.PurchaseDate?.AddYears(5),
                MotorWarrantyExpiry = vehicle.PurchaseDate?.AddYears(5),
            });
        }
        await db.SaveChangesAsync();

        // ---------------- Spare parts catalog ----------------
        var parts = new (string No, string Name, string Cat, decimal Price, int Stock)[]
        {
            ("PRT-BRK-001", "Front Brake Pad Set", "Brakes", 850, 40),
            ("PRT-BRK-002", "Rear Brake Shoe", "Brakes", 620, 35),
            ("PRT-TYR-001", "Tubeless Tyre 90/90-12", "Tyres", 2100, 20),
            ("PRT-BAT-001", "12V Auxiliary Battery", "Battery", 1450, 15),
            ("PRT-MTR-001", "Motor Controller Unit", "Motor", 5600, 8),
            ("PRT-LGT-001", "LED Headlamp Assembly", "Electricals", 1200, 18),
            ("PRT-SUS-001", "Front Suspension Fork", "Suspension", 3200, 10),
            ("PRT-CHG-001", "On-Board Charger", "Charging", 4800, 6),
            ("PRT-BDY-001", "Side Body Panel", "Body", 1750, 12),
            ("PRT-CBL-001", "Main Wiring Harness", "Electricals", 980, 22),
        };
        db.PartMasters.AddRange(parts.Select(p => new PartMaster { PartNumber = p.No, Name = p.Name, Category = p.Cat, UnitPrice = p.Price, StockQty = p.Stock, DealerId = null }));

        // ---------------- Notification templates ----------------
        db.NotificationTemplates.AddRange(
            new NotificationTemplate { Key = "JobCardOpened", Channel = NotificationChannel.Sms, Body = "Hi {{customerName}}, your job card {{jobCardNumber}} has been created for {{vehicleModel}}. Track it here: {{trackingUrl}}" },
            new NotificationTemplate { Key = "EstimateReady", Channel = NotificationChannel.Sms, Body = "Additional work of Rs.{{amount}} identified for job card {{jobCardNumber}}. Please approve: {{trackingUrl}}" },
            new NotificationTemplate { Key = "ReadyForDelivery", Channel = NotificationChannel.Sms, Body = "Great news! Your vehicle (job card {{jobCardNumber}}) is ready for pickup." },
            new NotificationTemplate { Key = "InvoiceGenerated", Channel = NotificationChannel.Sms, Body = "Invoice {{invoiceNumber}} of Rs.{{amount}} generated for job card {{jobCardNumber}}. Download: {{invoiceUrl}}" }
        );

        await db.SaveChangesAsync();
    }
}