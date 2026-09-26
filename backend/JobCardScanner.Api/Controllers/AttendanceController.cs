using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using JobCardScanner.Api.Services;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-09-25 ("give attendance page for all dealer ... give only this page for android and web").
/// STANDARD/ASSUMED design - see Attendance.cs's class doc comment and README SECTION 98 before
/// relying on this. Mirrors the existing dealer-scoping pattern used throughout JobCardsController
/// (isOrgWideRole = CorporateAdmin/SystemAdmin see every dealer; everyone else is locked to their
/// own _currentUser.DealerId) so this page behaves consistently with the rest of the app rather
/// than introducing a new access-control convention.
///
/// THREE endpoints, matching the "all dealer" framing of your request:
///   GET  /api/attendance/dealers-summary?date=   - one row per dealer with present/absent/etc.
///        counts for that day (the "all dealer" landing view). Org-wide roles see every dealer;
///        a dealer-scoped user sees only their own (single row).
///   GET  /api/attendance?date=&dealerId=          - full staff roster for ONE dealer on that day,
///        each row showing whether/how they're marked (drill-down from dealers-summary).
///   POST /api/attendance/mark                     - upsert one staff member's attendance for a day.
///   GET  /api/attendance/summary?date=&dealerId=  - same counts as dealers-summary but for one
///        dealer (used by the web/mobile page's header tile row after drilling in).
///
/// NOT done here, flagged rather than guessed: no endpoint to EDIT/DELETE a past attendance row
/// beyond re-POSTing Mark() (which just overwrites that day's record - there's no audit trail of
/// prior edits beyond the single _audit.LogAsync call per save), no leave-request/approval workflow,
/// no CSV/Excel export, no monthly summary. Tell me which of these you actually need and I'll add it.
/// </summary>
[ApiController]
[Route("api/attendance")]
[Authorize(Policy = Policies.Staff)]
public class AttendanceController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;

    public AttendanceController(JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    // ---------------- "All dealer" landing view: one row per dealer ----------------
    [HttpGet("dealers-summary")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> DealersSummary([FromQuery] DateTime? date)
    {
        var day = (date ?? DateTime.UtcNow).Date;
        var isOrgWideRole = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;

        var dealersQuery = _db.Dealers.AsNoTracking().AsQueryable();
        if (!isOrgWideRole)
        {
            // Same "no DealerId -> show nothing" safe default JobCardsController.List() uses for
            // this exact situation, rather than accidentally leaking every dealer.
            if (_currentUser.DealerId is null) return Ok(new { date = day, dealers = Array.Empty<object>() });
            dealersQuery = dealersQuery.Where(d => d.Id == _currentUser.DealerId);
        }

        var dealers = await dealersQuery.OrderBy(d => d.Name).Select(d => new { d.Id, d.Name }).ToListAsync();
        if (dealers.Count == 0) return Ok(new { date = day, dealers = Array.Empty<object>() });
        var dealerIds = dealers.Select(d => d.Id).ToList();

        var staffCounts = await _db.Users.AsNoTracking()
            .Where(u => u.Active && u.DealerId.HasValue && dealerIds.Contains(u.DealerId.Value))
            .GroupBy(u => u.DealerId!.Value)
            .Select(g => new { DealerId = g.Key, Total = g.Count() })
            .ToDictionaryAsync(g => g.DealerId, g => g.Total);

        var recordsByDealer = await _db.Attendance.AsNoTracking()
            .Where(a => a.AttendanceDate == day && dealerIds.Contains(a.DealerId))
            .GroupBy(a => a.DealerId)
            .Select(g => new
            {
                DealerId = g.Key,
                Present = g.Count(a => a.Status == AttendanceStatus.Present),
                Absent = g.Count(a => a.Status == AttendanceStatus.Absent),
                HalfDay = g.Count(a => a.Status == AttendanceStatus.HalfDay),
                OnLeave = g.Count(a => a.Status == AttendanceStatus.OnLeave),
                Marked = g.Count(),
            })
            .ToDictionaryAsync(g => g.DealerId);

        var result = dealers.Select(d =>
        {
            staffCounts.TryGetValue(d.Id, out var total);
            recordsByDealer.TryGetValue(d.Id, out var rec);
            var marked = rec?.Marked ?? 0;
            return new
            {
                dealerId = d.Id,
                dealerName = d.Name,
                totalStaff = total,
                present = rec?.Present ?? 0,
                absent = rec?.Absent ?? 0,
                halfDay = rec?.HalfDay ?? 0,
                onLeave = rec?.OnLeave ?? 0,
                notMarked = Math.Max(0, total - marked),
            };
        });

        return Ok(new { date = day, dealers = result });
    }

    // ---------------- One dealer's staff roster + that day's marks (drill-down) ----------------
    [HttpGet]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> List([FromQuery] DateTime? date, [FromQuery] Guid? dealerId)
    {
        var day = (date ?? DateTime.UtcNow).Date;
        var isOrgWideRole = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        var effectiveDealerId = isOrgWideRole ? dealerId : _currentUser.DealerId;
        if (effectiveDealerId is null) return Ok(new { date = day, dealerId = (Guid?)null, items = Array.Empty<object>() });

        var staff = await _db.Users.AsNoTracking()
            .Where(u => u.Active && u.DealerId == effectiveDealerId)
            .OrderBy(u => u.Name)
            .Select(u => new { u.Id, u.Name, u.Role })
            .ToListAsync();
        if (staff.Count == 0) return Ok(new { date = day, dealerId = effectiveDealerId, items = Array.Empty<object>() });

        var staffIds = staff.Select(s => s.Id).ToList();
        var records = await _db.Attendance.AsNoTracking()
            .Where(a => a.AttendanceDate == day && staffIds.Contains(a.EmployeeId))
            .ToDictionaryAsync(a => a.EmployeeId);

        var items = staff.Select(s =>
        {
            records.TryGetValue(s.Id, out var rec);
            return new
            {
                employeeId = s.Id,
                employeeName = s.Name,
                role = s.Role.ToString(),
                status = rec?.Status.ToString(),
                checkInTime = rec?.CheckInTime,
                checkOutTime = rec?.CheckOutTime,
                remarks = rec?.Remarks,
                marked = rec != null,
            };
        });

        return Ok(new { date = day, dealerId = effectiveDealerId, items });
    }

    // ---------------- Mark / update one staff member's attendance for a day (upsert) ----------------
    [HttpPost("mark")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> Mark(MarkAttendanceRequest req)
    {
        var isOrgWideRole = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        var employee = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == req.EmployeeId && u.Active);
        if (employee is null) return BadRequest(new { message = "Staff member not found or inactive." });
        if (!isOrgWideRole && employee.DealerId != _currentUser.DealerId)
            return BadRequest(new { message = "You can only mark attendance for your own dealer's staff." });
        if (employee.DealerId is null)
            return BadRequest(new { message = "This staff member has no dealer assigned, so attendance can't be recorded for them." });

        var day = req.Date.Date;
        var existing = await _db.Attendance.FirstOrDefaultAsync(a => a.EmployeeId == req.EmployeeId && a.AttendanceDate == day);
        if (existing is null)
        {
            existing = new Attendance
            {
                Id = Guid.NewGuid(),
                DealerId = employee.DealerId.Value,
                EmployeeId = employee.Id,
                EmployeeName = employee.Name,
                EmployeeRole = employee.Role.ToString(),
                AttendanceDate = day,
            };
            _db.Attendance.Add(existing);
        }
        existing.Status = req.Status;
        existing.CheckInTime = req.CheckInTime;
        existing.CheckOutTime = req.CheckOutTime;
        existing.Remarks = req.Remarks;
        existing.MarkedByUserId = _currentUser.UserId;
        existing.MarkedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        await _audit.LogAsync("Attendance.Mark", "Attendance", existing.Id.ToString(),
            new { existing.EmployeeId, existing.EmployeeName, existing.AttendanceDate, existing.Status });

        return Ok(new
        {
            existing.Id,
            existing.EmployeeId,
            status = existing.Status.ToString(),
            existing.CheckInTime,
            existing.CheckOutTime,
        });
    }

    // ---------------- Summary counts for one dealer on one day ----------------
    [HttpGet("summary")]
    [Authorize(Policy = Policies.ServiceAdvisorUp)]
    public async Task<IActionResult> Summary([FromQuery] DateTime? date, [FromQuery] Guid? dealerId)
    {
        var day = (date ?? DateTime.UtcNow).Date;
        var isOrgWideRole = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        var effectiveDealerId = isOrgWideRole ? dealerId : _currentUser.DealerId;
        if (effectiveDealerId is null)
            return Ok(new { date = day, totalStaff = 0, present = 0, absent = 0, halfDay = 0, onLeave = 0, notMarked = 0 });

        var totalStaff = await _db.Users.AsNoTracking()
            .CountAsync(u => u.Active && u.DealerId == effectiveDealerId);

        var records = await _db.Attendance.AsNoTracking()
            .Where(a => a.AttendanceDate == day && a.DealerId == effectiveDealerId)
            .ToListAsync();

        var present = records.Count(r => r.Status == AttendanceStatus.Present);
        var absent = records.Count(r => r.Status == AttendanceStatus.Absent);
        var halfDay = records.Count(r => r.Status == AttendanceStatus.HalfDay);
        var onLeave = records.Count(r => r.Status == AttendanceStatus.OnLeave);

        return Ok(new
        {
            date = day,
            totalStaff,
            present,
            absent,
            halfDay,
            onLeave,
            notMarked = Math.Max(0, totalStaff - records.Count),
        });
    }

    // ---------------- Self check-in (2026-09-26, mobile app login) ----------------
    /// <summary>"when i login then this time was login time and add in that shift when i login on
    /// 9 am then 1st shift 9 am to 6pm 1st shift and then 6 pm to 12 2nd shift". Call this right
    /// after a successful mobile sign-in - see mobile/src/services/attendanceCheckin.ts for the
    /// wiring instructions (I don't have your real login screen in this session, so nothing there
    /// was edited directly).
    ///
    /// CONFIRMED LIMITATION, not a guess: your own JobCardScannerDbContext.cs comment says
    /// Technicians are a separate, login-less table - they never sign into the app, so this
    /// endpoint can never fire for them. Only Users (people with real logins) can self-check-in;
    /// Technician attendance still has to go through the supervisor-marked Mark() endpoint above
    /// (the web AttendancePage.tsx from SECTION 98).
    ///
    /// ASSUMPTIONS (flagged, need your confirmation - see README SECTION 101):
    ///   - IST is computed as a fixed UTC+5:30 offset rather than via the OS timezone database.
    ///     India has no DST, so this is safe, and it sidesteps "India Standard Time" (Windows) vs
    ///     "Asia/Kolkata" (IANA) time-zone-ID mismatches across hosts.
    ///   - Shift 1 = 09:00-18:00, Shift 2 = 18:00-24:00, exactly as you described. A login BEFORE
    ///     09:00 (not covered by your description) is counted as Shift 1 rather than rejected -
    ///     tell me if an early arrival should be handled differently.
    ///   - Logging in always sets Status to Present, even overriding a prior manual mark for today
    ///     (e.g. if a supervisor had already set OnLeave) - tell me if a manual mark should instead
    ///     take precedence and block this.
    ///   - Only the FIRST login of the day sets CheckInTime/Shift; a second login later the same
    ///     day updates Status back to Present but does not move CheckInTime or change the shift.
    /// </summary>
    [HttpPost("check-in")]
    [Authorize(Policy = Policies.Staff)]
    public async Task<IActionResult> CheckIn()
    {
        var employeeId = _currentUser.UserId;
        if (employeeId is null) return BadRequest(new { message = "No signed-in user." });

        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == employeeId);
        if (user is null) return BadRequest(new { message = "User not found." });
        if (user.DealerId is null)
            return BadRequest(new { message = "Your account has no dealer assigned, so attendance can't be recorded." });

        var istNow = DateTime.UtcNow.AddHours(5).AddMinutes(30); // see doc comment above - fixed IST offset, no OS timezone lookup
        var day = istNow.Date;
        var timeOfDay = istNow.TimeOfDay;
        var shift = timeOfDay >= TimeSpan.FromHours(18) ? AttendanceShift.Shift2 : AttendanceShift.Shift1;

        var existing = await _db.Attendance.FirstOrDefaultAsync(a => a.EmployeeId == employeeId && a.AttendanceDate == day);
        if (existing is null)
        {
            existing = new Attendance
            {
                Id = Guid.NewGuid(),
                DealerId = user.DealerId.Value,
                EmployeeId = user.Id,
                EmployeeName = user.Name,
                EmployeeRole = user.Role.ToString(),
                AttendanceDate = day,
            };
            _db.Attendance.Add(existing);
        }

        existing.Status = AttendanceStatus.Present;
        if (existing.CheckInTime is null)
        {
            existing.CheckInTime = timeOfDay;
            existing.Shift = shift;
        }
        existing.MarkedByUserId = employeeId;
        existing.MarkedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        await _audit.LogAsync("Attendance.CheckIn", "Attendance", existing.Id.ToString(),
            new { existing.EmployeeId, existing.AttendanceDate, existing.Shift, existing.CheckInTime });

        return Ok(new
        {
            existing.Id,
            status = existing.Status.ToString(),
            checkInTime = existing.CheckInTime,
            shift = existing.Shift?.ToString(),
        });
    }

    // ---------------- Self check-out (2026-09-26, mobile app logout) ----------------
    /// <summary>"before log out chek out need to do that will update". See CheckIn()'s doc
    /// comment for the shared assumptions (IST offset, Technicians can't use this). Deliberately
    /// tolerant of a missing check-in row (creates one) rather than failing outright - see
    /// mobile/src/services/attendanceCheckin.ts's doc comment for why logout must never be
    /// blocked by this call failing.</summary>
    [HttpPost("check-out")]
    [Authorize(Policy = Policies.Staff)]
    public async Task<IActionResult> CheckOut()
    {
        var employeeId = _currentUser.UserId;
        if (employeeId is null) return BadRequest(new { message = "No signed-in user." });

        var istNow = DateTime.UtcNow.AddHours(5).AddMinutes(30);
        var day = istNow.Date;

        var existing = await _db.Attendance.FirstOrDefaultAsync(a => a.EmployeeId == employeeId && a.AttendanceDate == day);
        if (existing is null)
        {
            // No check-in on record for today (e.g. CheckIn() failed silently earlier, or this
            // account started using self check-in mid-day) - still record what we can rather than
            // erroring out.
            var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == employeeId);
            if (user is null) return BadRequest(new { message = "User not found." });
            if (user.DealerId is null)
                return BadRequest(new { message = "Your account has no dealer assigned, so attendance can't be recorded." });

            existing = new Attendance
            {
                Id = Guid.NewGuid(),
                DealerId = user.DealerId.Value,
                EmployeeId = user.Id,
                EmployeeName = user.Name,
                EmployeeRole = user.Role.ToString(),
                AttendanceDate = day,
                Status = AttendanceStatus.Present,
            };
            _db.Attendance.Add(existing);
        }

        existing.CheckOutTime = istNow.TimeOfDay;
        existing.MarkedByUserId = employeeId;
        existing.MarkedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        await _audit.LogAsync("Attendance.CheckOut", "Attendance", existing.Id.ToString(),
            new { existing.EmployeeId, existing.AttendanceDate, existing.CheckOutTime });

        return Ok(new { existing.Id, checkOutTime = existing.CheckOutTime });
    }
}

/// <summary>Request body for POST /api/attendance/mark. Date is date-only (time ignored server-side
/// via .Date). CheckInTime/CheckOutTime are optional - the web/mobile page only sends them when
/// Status is Present or HalfDay.</summary>
public record MarkAttendanceRequest(
    Guid EmployeeId,
    DateTime Date,
    AttendanceStatus Status,
    TimeSpan? CheckInTime,
    TimeSpan? CheckOutTime,
    string? Remarks);
