using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
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

    public CustomersController(JobCardScannerDbContext db, IErpClient erp)
    {
        _db = db;
        _erp = erp;
    }

    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length < 3) return Ok(Array.Empty<object>());

        var customers = await _db.Customers.AsNoTracking()
            .Include(c => c.Vehicles)
            .Where(c => c.Mobile.Contains(q) || c.Name.Contains(q) || c.Vehicles.Any(v => v.RegNo != null && v.RegNo.Contains(q)))
            .Take(20)
            .ToListAsync();

        return Ok(customers.Select(c => new
        {
            c.Id,
            c.Name,
            c.Mobile,
            c.Email,
            c.City,
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
        var customer = new Customer { Name = req.Name, Mobile = req.Mobile, Email = req.Email, Address = req.Address, City = req.City, DealerId = req.DealerId };
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
            PurchaseDate = req.PurchaseDate,
            Odometer = req.Odometer,
        };
        _db.Vehicles.Add(vehicle);
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
}
