using System.Text.Json;
using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Dtos;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>2026-09-24 ("this technician dont want to bid username and password for that location
/// wants to create technician and that Supervisor login which we create from Dealer Employees that
/// supervisor when login then he have access to create Tecnician that tab name Technician
/// Employee"): the "Technician Employee" tab - a Supervisor (or DealerAdmin/CorporateAdmin/
/// SystemAdmin) manages a lightweight, login-less roster of technicians for their own dealer/
/// location, used purely to populate two dropdowns elsewhere in the app: the Job Card Wizard's
/// "Technician" field and the Job Card Detail page's "Assign Technician" field (both of which used
/// to be free-text inputs - see JobCardWizardPage.tsx/JobCardDetailPage.tsx's own doc comments on
/// this same date).
///
/// Deliberately NOT built on the existing StaffRole.Technician enum value or the Users table -
/// see Technician.cs's own doc comment for why this is its own table. Class-level gate is
/// ServiceAdvisorUp (wide - reading this list to populate a dropdown is needed by anyone who can
/// touch a job card, same floor as Job Card creation itself); the three write actions
/// (Create/Update/Delete) are individually tightened to Policies.SupervisorUp, matching the
/// explicit request that only a Supervisor (or an admin tier above it) can manage this roster -
/// not a plain WorkshopManager, which is a real, deliberate difference in access between those two
/// roles going forward.</summary>
[ApiController]
[Route("api/technicians")]
[Authorize(Policy = Policies.ServiceAdvisorUp)]
public class TechniciansController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;

    public TechniciansController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    private bool IsCorporateOrSystem => _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;

    /// <summary>GET /api/technicians?dealerId=&locationCode=&includeInactive= - the Job Card
    /// Wizard's Technician dropdown, the Job Card Detail page's Assign Technician dropdown, AND the
    /// Technician Employee management grid all call this same action. locationCode narrows to one
    /// workshop (what the two dropdowns above do, passing the job card's own Service Location);
    /// omit it for the management grid's own "every technician at my dealer" view. includeInactive
    /// (default false) - the two dropdowns never want a retired technician offered as a choice; the
    /// management grid passes true so a Supervisor can still see (and reactivate) one they
    /// previously deactivated.</summary>
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] Guid? dealerId, [FromQuery] string? locationCode, [FromQuery] bool includeInactive = false)
    {
        var effectiveDealerId = IsCorporateOrSystem ? dealerId : _currentUser.DealerId;
        if (effectiveDealerId is null) return Ok(Array.Empty<object>());

        var q = _db.Technicians.AsNoTracking().Where(t => t.DealerId == effectiveDealerId);
        if (!includeInactive) q = q.Where(t => t.Active);
        if (!string.IsNullOrWhiteSpace(locationCode)) q = q.Where(t => t.LocationCode == locationCode);

        var rows = await q.OrderBy(t => t.Name).ToListAsync();
        return Ok(rows);
    }

    /// <summary>GET /api/technicians/supervisors?dealerId=&locationCode= - the Job Card Wizard's
    /// "Supervisor" dropdown (2026-09-24: "already we craeted for perticular location Supervisior
    /// that will link ... like Dealer Employees"). Reads StaffRole.Supervisor Users directly
    /// (Users.WorkLocationCodes) rather than going through UsersController.List, which is
    /// DealerAdminUp-gated and would 403 for the ServiceAdvisor/WorkshopManager staff who actually
    /// fill out the wizard - same "expose a read from a more-permissive controller" pattern as
    /// MaterialTransferDocsController.LabourByPartCode (see that controller's own doc comment) and
    /// this controller's own PartsCatalog/LabourCatalog equivalent on JobCardsController.
    /// locationCode narrows to Supervisors whose Work Area either includes that location or is
    /// unrestricted (empty WorkLocationCodes - see User.WorkLocationCodes's own doc comment);
    /// omit it to return every Supervisor at the dealer.</summary>
    [HttpGet("supervisors")]
    public async Task<IActionResult> Supervisors([FromQuery] Guid? dealerId, [FromQuery] string? locationCode)
    {
        var effectiveDealerId = IsCorporateOrSystem ? dealerId : _currentUser.DealerId;
        if (effectiveDealerId is null) return Ok(Array.Empty<object>());

        var users = await _db.Users.AsNoTracking()
            .Where(u => u.DealerId == effectiveDealerId && u.Role == StaffRole.Supervisor && u.Active)
            .OrderBy(u => u.Name)
            .Select(u => new { u.Id, u.Name, u.WorkLocationCodes })
            .ToListAsync();

        if (string.IsNullOrWhiteSpace(locationCode)) return Ok(users.Select(u => new { u.Id, u.Name }));

        var scoped = users.Where(u =>
        {
            if (string.IsNullOrWhiteSpace(u.WorkLocationCodes)) return true; // unrestricted
            try
            {
                var codes = JsonSerializer.Deserialize<List<string>>(u.WorkLocationCodes) ?? new List<string>();
                return codes.Count == 0 || codes.Contains(locationCode, StringComparer.OrdinalIgnoreCase);
            }
            catch { return true; } // tolerate hand-edited/corrupt data rather than hide a real Supervisor
        });
        return Ok(scoped.Select(u => new { u.Id, u.Name }));
    }

    [HttpPost]
    [Authorize(Policy = Policies.SupervisorUp)]
    public async Task<IActionResult> Create(CreateTechnicianRequest req)
    {
        if (_currentUser.DealerId is null) return BadRequest(new { message = "Your account isn't linked to a dealer - a Technician can't be created without one." });
        if (string.IsNullOrWhiteSpace(req.Name)) return BadRequest(new { message = "Name is required." });
        if (string.IsNullOrWhiteSpace(req.LocationCode)) return BadRequest(new { message = "Location is required." });

        var technician = new Technician
        {
            DealerId = _currentUser.DealerId.Value,
            Name = req.Name.Trim(),
            LocationCode = req.LocationCode.Trim(),
            LocationName = string.IsNullOrWhiteSpace(req.LocationName) ? null : req.LocationName.Trim(),
            CreatedById = _currentUser.UserId,
        };
        _db.Technicians.Add(technician);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Technician.Create", "Technician", technician.Id.ToString(), new { technician.Name, technician.LocationCode });
        return CreatedAtAction(nameof(List), new { }, technician);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.SupervisorUp)]
    public async Task<IActionResult> Update(Guid id, UpdateTechnicianRequest req)
    {
        var technician = await _db.Technicians.FirstOrDefaultAsync(t => t.Id == id);
        if (technician is null) return NotFound();
        if (!IsCorporateOrSystem && technician.DealerId != _currentUser.DealerId) return Forbid();

        if (req.Name is not null) technician.Name = req.Name.Trim();
        if (req.LocationCode is not null) technician.LocationCode = req.LocationCode.Trim();
        if (req.LocationName is not null) technician.LocationName = string.IsNullOrWhiteSpace(req.LocationName) ? null : req.LocationName.Trim();
        if (req.Active.HasValue) technician.Active = req.Active.Value;

        await _db.SaveChangesAsync();
        await _audit.LogAsync("Technician.Update", "Technician", technician.Id.ToString());
        return Ok(technician);
    }

    /// <summary>DELETE /api/technicians/{id} - a hard delete, same convention as
    /// UsersController.Delete. Safe to use even after a technician has been picked on a job card:
    /// JobCard.AssignedTechnicianName/BaplTechnicianName are plain string snapshots, not foreign
    /// keys into this table (see Technician.cs's own doc comment), so deleting this record never
    /// touches an already-saved job card. Prefer PUT .../{id} with Active=false over this for a
    /// technician who might come back - that keeps them out of the two dropdowns without losing
    /// their record.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.SupervisorUp)]
    public async Task<IActionResult> Delete(Guid id)
    {
        var technician = await _db.Technicians.FirstOrDefaultAsync(t => t.Id == id);
        if (technician is null) return NotFound();
        if (!IsCorporateOrSystem && technician.DealerId != _currentUser.DealerId) return Forbid();

        _db.Technicians.Remove(technician);
        await _db.SaveChangesAsync();
        await _audit.LogAsync("Technician.Delete", "Technician", id.ToString(), new { technician.Name });
        return NoContent();
    }
}
