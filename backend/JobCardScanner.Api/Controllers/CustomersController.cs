using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using JobCardScanner.Api.Services.Integrations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>Customer/vehicle identification (Job Card Wizard step 1-2): search local records
/// first, then fall back to the ERP mock for a "new to this dealer but known to ERP" hit.</summary>
[ApiController]
[Route("api/customers")]
[Authorize(Policy = Policies.ServiceAdvisorUp)]
public class CustomersController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly IErpClient _erp;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;

    public CustomersController(JobCardScannerDbContext db, IErpClient erp, ICurrentUserService currentUser, IAuditLogService audit)
    {
        _db = db;
        _erp = erp;
        _currentUser = currentUser;
        _audit = audit;
    }

    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length < 3) return Ok(Array.Empty<object>());

        // Mobile/name, plus registration no. and chassis no. (Vehicle.Vin) - the latter two so
        // "Find or add customer" can also be searched by the vehicle's identifiers, not just the
        // owner's - the local half of the "search by chassis no., registration no." requirement;
        // BaplDmsController.VehicleLookup covers the case where the vehicle isn't in this database
        // yet at all.
        var customers = await _db.Customers.AsNoTracking()
            .Include(c => c.Vehicles)
            .Where(c => c.Mobile.Contains(q) || c.Name.Contains(q)
                || c.Vehicles.Any(v => (v.RegNo != null && v.RegNo.Contains(q)) || (v.Vin != null && v.Vin.Contains(q))))
            .Take(20)
            .ToListAsync();

        return Ok(customers.Select(c => new
        {
            c.Id,
            c.Name,
            c.Mobile,
            c.Email,
            c.City,
            c.State,
            c.OutstandingAmount,
            Vehicles = c.Vehicles.Select(v => new { v.Id, v.Model, v.Variant, v.RegNo, v.Vin, v.Odometer }),
        }));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var customer = await _db.Customers.AsNoTracking().Include(c => c.Vehicles).ThenInclude(v => v.Warranty)
            .FirstOrDefaultAsync(c => c.Id == id);
        return customer is null ? NotFound() : Ok(customer);
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateCustomerRequest req)
    {
        var customer = new Customer { Name = req.Name, Mobile = req.Mobile, Email = req.Email, Address = req.Address, City = req.City, State = req.State, DealerId = req.DealerId };
        _db.Customers.Add(customer);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = customer.Id }, customer);
    }

    [HttpPost("vehicles")]
    public async Task<IActionResult> CreateVehicle(CreateVehicleRequest req)
    {
        var vehicle = new Vehicle
        {
            CustomerId = req.CustomerId,
            DealerId = req.DealerId,
            Model = req.Model,
            Variant = req.Variant,
            Color = req.Color,
            RegNo = req.RegNo,
            Vin = req.Vin,
            BatteryNo = req.BatteryNo,
            MotorNo = req.MotorNo,
            SerialNo = req.SerialNo,
            ControllerNo = req.ControllerNo,
            ConverterNo = req.ConverterNo,
            ChargerNo = req.ChargerNo,
            PurchaseDate = req.PurchaseDate,
            InsuranceExpiry = req.InsuranceExpiry,
            NextServiceDueDate = req.NextServiceDueDate,
            Odometer = req.Odometer,
        };
        _db.Vehicles.Add(vehicle);

        // Only when the vehicle step was auto-filled from a DMS lookup that actually returned
        // warranty info - a manually-added vehicle has none of this, so nothing extra is created.
        if (req.WarrantyExpiryDate.HasValue || req.WarrantyOdoReading.HasValue)
        {
            vehicle.Warranty = new Warranty
            {
                ExpiryDate = req.WarrantyExpiryDate,
                CoverageKm = (double)(req.WarrantyOdoReading ?? 0),
            };
        }

        await _db.SaveChangesAsync();
        return Ok(vehicle);
    }

    /// <summary>Fallback lookup against the ERP mock when nothing matches locally (e.g. a
    /// customer serviced at another dealer for the first time here).</summary>
    [HttpGet("erp-lookup")]
    public async Task<IActionResult> ErpLookup([FromQuery] string mobile)
    {
        var result = await _erp.FindCustomerByMobileAsync(mobile);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>
    /// POST /api/customers/{id}/admin-reset-password - a dealer/corporate/system admin setting or
    /// resetting a customer's PORTAL password directly (e.g. the customer is at the counter and
    /// wants password login set up, or is locked out and calls in) - mirrors
    /// DealerAuthController.AdminResetPassword's shape and dealer-scoping exactly. This is the
    /// admin/dealer side of the customer password-login feature (see CustomerPortalController for
    /// the customer-facing Login/ForgotPassword/ResetPassword/ChangePassword endpoints) - a plain
    /// reset (set to a known value), not a "view the current password" (which is never possible -
    /// only a PBKDF2 hash is ever stored, same as staff Users).
    /// </summary>
    [HttpPost("{id:guid}/admin-reset-password")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> AdminResetPassword(Guid id, CustomerAdminResetPasswordRequest req)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == id);
        if (customer is null) return NotFound();
        // Same dealer-scoping rule as DealerAuthController.AdminResetPassword - only
        // Corporate/System Admin can act across dealers; anyone else must be resetting a password
        // for a customer under their OWN dealer.
        if (_currentUser.Role is not (StaffRole.CorporateAdmin or StaffRole.SystemAdmin) && customer.DealerId != _currentUser.DealerId)
            return Forbid();

        customer.PasswordHash = PasswordHasher.Hash(req.NewPassword);
        customer.PasswordResetTokenHash = null;
        customer.PasswordResetExpiresAt = null;
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Customer.AdminResetPassword", "Customer", customer.Id.ToString());

        return Ok(new { message = "Customer password set. Share it with them directly - it isn't emailed/texted automatically yet." });
    }
}
