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
    /// <summary>2026-09-24 ("that Supervisor login which we create from Dealer Employees that
    /// supervisor when login then he have access to create Tecnician"): a new, distinct role for
    /// the Employees page's "Supervisor" designation - previously "Supervisor" mapped onto
    /// StaffRole.WorkshopManager (see UsersController.RoleForDesignation's old doc comment); it now
    /// maps here instead, so a Supervisor login is no longer the same account as a WorkshopManager
    /// one. Granted the same permission floor WorkshopManager had (see Program.cs's ServiceAdvisorUp/
    /// WorkshopManagerUp policies, both now include Supervisor), PLUS exclusive access to the new
    /// Technician Employee tab (TechniciansController, Policies.SupervisorUp) that WorkshopManager
    /// does NOT get - see that controller's own doc comment for why. FACT: this does not retroactively
    /// change any already-saved employee row - an existing Designation="Supervisor" employee keeps
    /// their stored Role=WorkshopManager until that employee is next edited/re-saved on the
    /// Employees page (see UsersController.Update's designation-drives-role logic), at which point
    /// they'll switch to this new role and pick up its slightly different (Technician-tab-gaining)
    /// permission set.</summary>
    Supervisor,

    
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
    /// <summary>DMS's own Dealercode (DealerMaster.Dealercode in the separate BAPLDMSvad
    /// database - see Services/BaplDmsService.cs), captured when this dealer is resolved via the
    /// Job Card Wizard's "search BAPL Dealer/Workshop" picker. Deliberately a SEPARATE field from
    /// <see cref="Code"/> (which for BaplImport-sourced dealers holds BAPL ERP's CustomerCode from
    /// a different database/schema - see BaplDealerService.cs) - the two code spaces aren't
    /// guaranteed to match, so this app never assumes one implies the other. Null until a
    /// BAPL-DMS-sourced lookup has resolved this dealer at least once; used to scope chassis/reg-no
    /// vehicle auto-fill lookups (BaplDmsController.VehicleLookup) to this dealer's own inventory.</summary>
    [MaxLength(30)] public string? BaplDmsDealerCode { get; set; }
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

    // ---------------- Employee profile + work-area scoping (2026-09-17 "Employees" page) ----------------
    // Free-text State/City/Pincode - deliberately NOT a cascading State->City->Pincode master
    // (no verified India pincode/city dataset exists anywhere in this codebase or its connected
    // databases, and fabricating one risks silently wrong data) - see EmployeesPage.tsx's doc
    // comment for the honest version of this: State is a fixed dropdown (standard Indian
    // states/UTs), City is a free-text/typeahead box, Pincode is a plain validated 6-digit field,
    // none of the three are auto-derived from each other.
    [MaxLength(100)] public string? State { get; set; }
    [MaxLength(100)] public string? City { get; set; }
    [MaxLength(10)] public string? Pincode { get; set; }
    public DateOnly? DateOfJoining { get; set; }
    /// <summary>Free-text job title as shown in the Employees grid ("Supervisor"/"Mechanic"/etc,
    /// exactly as picked in the Designation dropdown) - kept SEPARATE from <see cref="Role"/>
    /// (which drives every [Authorize(Policy=...)] check in this app and has no "Supervisor"/
    /// "Mechanic" values of its own). EmployeesPage.tsx maps Designation -> Role automatically on
    /// save (Supervisor -> WorkshopManager, Mechanic -> ServiceAdvisor - see that page's doc
    /// comment for exactly why ServiceAdvisor and not the seemingly-closer-sounding Technician
    /// role) so a created employee can actually sign in and use the app, while this field
    /// preserves the literal job-title wording for display.</summary>
    [MaxLength(50)] public string? Designation { get; set; }
    /// <summary>JSON array of DMS workshop LocCodes (e.g. ["CUS0288W5","CUS0071W1"]) this
    /// user is allowed to work in - the Employees page's "Work Area" checkbox list. Stored as a
    /// JSON string rather than a join table because the "locations" master itself lives in a
    /// separate database (DMS's own LocationMaster via BaplDmsService, not anything in
    /// JobCardScannerDb) - there is no local table to foreign-key against. Empty/null means
    /// UNRESTRICTED (every existing user before this feature shipped, and any admin who hasn't
    /// assigned specific locations yet) - see JobCardsController/DmsBaplDataController's location-
    /// scoping checks, which only apply a filter when this is non-empty. Stamped into the sign-in
    /// token as the "app_work_locations" claim (DealerJwtTokenService/AppClaimsTransformation) -
    /// changing it takes effect on that user's NEXT sign-in, same staleness as a Role change.</summary>
    [MaxLength(2000)] public string? WorkLocationCodes { get; set; }
}

public class Customer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required, MaxLength(200)] public string Name { get; set; } = default!;
    [Required, MaxLength(30)] public string Mobile { get; set; } = default!;
    [MaxLength(200)] public string? Email { get; set; }
    [MaxLength(300)] public string? Address { get; set; }
    [MaxLength(100)] public string? City { get; set; }
    /// <summary>Added for the Job Card Wizard's Review step (bold Name/State/City) - a NEW column
    /// on an entity that previously had none. Since this app creates its schema with
    /// Database.EnsureCreatedAsync() (see Program.cs), which does nothing on a database that
    /// already exists, this column will NOT appear on a production database automatically - see
    /// deploy/add-customer-state-column.sql for the manual ALTER TABLE to run there.</summary>
    [MaxLength(100)] public string? State { get; set; }
    public Guid DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal OutstandingAmount { get; set; }
    [MaxLength(60)] public string? ErpCustomerId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // ---------------- Password login (alongside the existing OTP portal - see
    // CustomerPortalController.Login) - added so a customer can sign in directly with a
    // mobile/email + password instead of only via OTP, while OTP keeps working unchanged for
    // customers who never set one. Same PBKDF2 hashing (Auth/PasswordHasher.cs) and reset-token
    // shape as User's own local login fields above - kept as separate columns here rather than a
    // shared table since Customer and User are unrelated entities with no login-type overlap.
    // NEW columns - see deploy/add-customer-password-columns.sql for the manual production
    // migration this needs (self-healing as of 2026-09-03, see Program.cs - no SSMS step actually
    // required, the script is kept only as documentation). ----------------
    /// <summary>PBKDF2 hash (see Auth/PasswordHasher.cs), format "iterations.saltB64.hashB64".
    /// Null until the customer (or an admin/dealer on their behalf) sets a password for the first
    /// time - a null value here just means "this customer hasn't set up password login yet", not
    /// an error; they can still use the OTP flow.</summary>
    [MaxLength(300)] public string? PasswordHash { get; set; }
    /// <summary>SHA-256 hash of the current forgot-password reset token, if one was issued and
    /// hasn't been used/expired yet - same shape as User.PasswordResetTokenHash.</summary>
    [MaxLength(100)] public string? PasswordResetTokenHash { get; set; }
    public DateTime? PasswordResetExpiresAt { get; set; }

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
    /// <summary>Controller/converter/charger serial numbers - added alongside BatteryNo/MotorNo
    /// above specifically so a DMS chassis/reg-no lookup (BaplDmsService.LookupVehicleAsync)
    /// can auto-fill everything it returns for this vehicle, not just the two fields this model
    /// already tracked. Optional/nullable since a manually-added vehicle (not sourced from BAPL
    /// DMS) has no reason to fill these in.</summary>
    [MaxLength(50)] public string? ControllerNo { get; set; }
    [MaxLength(50)] public string? ConverterNo { get; set; }
    [MaxLength(50)] public string? ChargerNo { get; set; }
    public DateOnly? PurchaseDate { get; set; }
    public DateOnly? LastServiceDate { get; set; }
    /// <summary>From DMS's VehicleSaleBillDetail.InsExpDate / ModelwiseServiceSchedule-derived
    /// due date (see BaplDmsService) - purely informational fields carried over on auto-fill, not
    /// computed or enforced by this app.</summary>
    public DateOnly? InsuranceExpiry { get; set; }
    public DateOnly? NextServiceDueDate { get; set; }
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
