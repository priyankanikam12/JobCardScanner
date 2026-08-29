using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

public enum StaffRole
{
    ServiceAdvisor,
    WorkshopManager,
    Technician,
    PartsUser,
    Cashier,
    DealerAdmin,
    CorporateAdmin,
    SystemAdmin,
}

/// <summary>How a <see cref="User"/> proves their identity. AzureAd = signs in via the
/// "Continue with Microsoft" button (Entra ID / MSAL) - typically corporate/system admins who
/// have a real @bgauss.com tenant account. Local = signs in on the "Dealer / Workshop Login"
/// tab with an email + password issued by an admin - typically dealer-level workshop staff
/// (Service Advisor, Technician, Parts, Cashier, Workshop/Dealer Admin) who don't have (and
/// don't need) an Azure AD account in the tenant. Both paths land on the same claims shape
/// (app_role / app_user_id / app_dealer_id) so every existing [Authorize(Policy=...)] in this
/// API accepts either one transparently - see AuthSchemes.DealerJwt in Program.cs.</summary>
public enum UserAuthType
{
    AzureAd,
    Local,
}

/// <summary>How a Dealer row came to exist - lets "which dealers came from BAPL?" be a plain
/// filter instead of a Code-pattern guess. <see cref="BaplImport"/> is set once, when
/// AdminDealerImportController first creates the row; it is never reset by later backfill runs
/// (see the AssignedRepCode sync in that controller), so it always reflects true origin even
/// after the row has been edited by an admin since.</summary>
public enum DealerSource { Manual, BaplImport }

public class Dealer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required, MaxLength(200)] public string Name { get; set; } = default!;
    [Required, MaxLength(30)] public string Code { get; set; } = default!;
    public DealerSource Source { get; set; } = DealerSource.Manual;
    [MaxLength(100)] public string? Region { get; set; }
    [MaxLength(100)] public string? State { get; set; }
    [MaxLength(100)] public string? City { get; set; }
    [MaxLength(300)] public string? Address { get; set; }
    [MaxLength(30)] public string? Gstin { get; set; }
    [MaxLength(30)] public string? Phone { get; set; }
    [MaxLength(200)] public string? Email { get; set; }
    /// <summary>BAPL ERP employee code (e.g. "EMP0031") of the internal representative assigned to
    /// this dealer, from C_CustomerIntRepDetail - captured on import/backfilled on later import
    /// runs (see AdminDealerImportController). Stored as the raw ERP code, not a resolved name:
    /// JobCardScanner doesn't have BAPL's employee master, so there's nothing to resolve it against
    /// yet.</summary>
    [MaxLength(30)] public string? AssignedRepCode { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<User> Users { get; set; } = new List<User>();
    public ICollection<Customer> Customers { get; set; } = new List<Customer>();
}

/// <summary>
/// A workshop staff member. Authentication is handled entirely by Azure AD (Entra ID) - this
/// table holds the application-level profile (role, dealer assignment) that Azure AD does not
/// know about. Users are provisioned here (by a Dealer/Corporate/System Admin, matched by
/// email/UPN) and their <see cref="AzureAdObjectId"/> is stamped in on first successful sign-in.
/// See <see cref="Services.ICurrentUserService"/> for how a request's Azure AD identity is
/// resolved to a row in this table.
/// </summary>
public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required, MaxLength(200)] public string Name { get; set; } = default!;
    [Required, MaxLength(200)] public string Email { get; set; } = default!;
    [MaxLength(30)] public string? Mobile { get; set; }
    public StaffRole Role { get; set; }
    public Guid? DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    public bool Active { get; set; } = true;
    [MaxLength(20)] public string? AvatarColor { get; set; }

    /// <summary>Azure AD "oid" claim - null until the user's first successful sign-in.</summary>
    [MaxLength(100)] public string? AzureAdObjectId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }

    // ---------------- Local ("Dealer") sign-in - see UserAuthType ----------------
    public UserAuthType AuthType { get; set; } = UserAuthType.AzureAd;
    /// <summary>PBKDF2 hash (see Auth/PasswordHasher.cs), format "iterations.saltB64.hashB64". Null for AuthType.AzureAd.</summary>
    [MaxLength(300)] public string? PasswordHash { get; set; }
    /// <summary>SHA-256 hash of the current forgot-password reset token, if one was issued and hasn't been used/expired yet.</summary>
    [MaxLength(100)] public string? PasswordResetTokenHash { get; set; }
    public DateTime? PasswordResetExpiresAt { get; set; }
    public bool MustChangePassword { get; set; } = false;
}

public class Customer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required, MaxLength(200)] public string Name { get; set; } = default!;
    [Required, MaxLength(30)] public string Mobile { get; set; } = default!;
    [MaxLength(200)] public string? Email { get; set; }
    [MaxLength(300)] public string? Address { get; set; }
    [MaxLength(100)] public string? City { get; set; }
    public Guid DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal OutstandingAmount { get; set; }
    [MaxLength(60)] public string? ErpCustomerId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Vehicle> Vehicles { get; set; } = new List<Vehicle>();
}

public class Vehicle
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public Guid DealerId { get; set; }
    [Required, MaxLength(100)] public string Model { get; set; } = default!;
    [MaxLength(60)] public string? Variant { get; set; }
    [MaxLength(40)] public string? Color { get; set; }
    [MaxLength(30)] public string? RegNo { get; set; }
    [MaxLength(50)] public string? Vin { get; set; }
    [MaxLength(50)] public string? BatteryNo { get; set; }
    [MaxLength(50)] public string? MotorNo { get; set; }
    [MaxLength(50)] public string? SerialNo { get; set; }
    public DateOnly? PurchaseDate { get; set; }
    public DateOnly? LastServiceDate { get; set; }
    public double Odometer { get; set; }
    [MaxLength(60)] public string? ErpVehicleId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Warranty? Warranty { get; set; }
    public ICollection<JobCard> JobCards { get; set; } = new List<JobCard>();
}

public enum WarrantyStatus { Active, Expired, Void }

public class Warranty
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }
    public WarrantyStatus Status { get; set; } = WarrantyStatus.Active;
    public DateOnly? StartDate { get; set; }
    public DateOnly? ExpiryDate { get; set; }
    public double CoverageKm { get; set; }
    /// <summary>JSON-encoded array of covered part numbers.</summary>
    public string? PartsCoveredJson { get; set; }
    public bool LabourCovered { get; set; } = true;
    public DateOnly? BatteryWarrantyExpiry { get; set; }
    public DateOnly? MotorWarrantyExpiry { get; set; }
}