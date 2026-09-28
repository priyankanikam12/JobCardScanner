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
/// relying on this.
///
/// 2026-09-28 ACCESS-CONTROL REWORK ("only that login supervisor or technitian attendance shown
/// his page ... for main dealer his under all location technitian supervisor all users attendance
/// ... if this user miss then this main dealer can adjust this ... dont give access for unders
/// users of dealer"): three-tier visibility, tightened from the original single-tier "any
/// ServiceAdvisorUp+ login can see/mark their whole dealer's roster" design -
///   1. Any logged-in staff member (Policies.Staff, the class-level floor) can see ONLY their own
///      attendance - GET /api/attendance/me below. No roster, no other user's data, regardless of
///      role - this is what satisfies "only that login ... attendance shown his page."
///   2. "Main dealer" = Policies.WorkshopManagerUp (per your confirmed answer) - sees and can
///      adjust every Technician/Supervisor's attendance across ALL locations under their own
///      dealer (dealer-scoped, same as before) via DealersSummary/List/Mark/Summary below, now
///      RE-GATED from Policies.ServiceAdvisorUp up to Policies.WorkshopManagerUp - this is the
///      concrete fix for "dont give access for unders users of dealer": a ServiceAdvisor-level
///      login (ASSUMPTION: this is what you mean by "Supervisor" - not yet confirmed, see README
///      SECTION 118 - one-line change if wrong) no longer passes this policy at all, so it can only
///      ever reach its OWN row via GET /api/attendance/me, never anyone else's.
///   3. CorporateAdmin/SystemAdmin (isOrgWideRole, unchanged) still see across every dealer, not
///      just one - same as before this rework, just now additionally gated behind
///      WorkshopManagerUp too (both roles already pass a "...Up" policy check by construction).
///
/// Mark() upserting the SAME day's row is ALSO how "if this user miss then this main dealer can
/// adjust this" is satisfied - no separate edit endpoint was needed, only the policy re-gating
/// above (only WorkshopManagerUp+ can call it now).
///
/// FOUR endpoints, matching the "all dealer" framing of your original request, plus the new #5:
///   GET  /api/attendance/dealers-summary?date=   - one row per dealer with present/absent/etc.
///        counts for that day (the "all dealer" landing view). Org-wide roles see every dealer;
///        a dealer-scoped user sees only their own (single row). WorkshopManagerUp+ only.
///   GET  /api/attendance?date=&dealerId=          - full staff roster for ONE dealer on that day,
///        each row showing whether/how they're marked, plus their Location (drill-down from
///        dealers-summary). WorkshopManagerUp+ only.
///   POST /api/attendance/mark                     - upsert one staff member's attendance for a
///        day - also how a main dealer adjusts/corrects a missed entry. WorkshopManagerUp+ only.
///   GET  /api/attendance/summary?date=&dealerId=  - same counts as dealers-summary but for one
///        dealer (used by the web/mobile page's header tile row after drilling in).
///        WorkshopManagerUp+ only.
///   GET  /api/attendance/me?date=                 - NEW 2026-09-28: any logged-in staff member's
///        OWN attendance only, hard-scoped server-side to _currentUser.UserId regardless of any
///        parameter - Policies.Staff (the lowest bar).
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
    // 2026-09-28: re-gated from ServiceAdvisorUp to WorkshopManagerUp - see class doc comment.
    [HttpGet("dealers-summary")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
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
    // 2026-09-28: re-gated from ServiceAdvisorUp to WorkshopManagerUp - see class doc comment. Also
    // now returns each row's `location` - see Attendance.Location's doc comment. Deliberately still
    // shows EVERY location under this dealer in one flat list (not grouped/filtered by location) -
    // your request was "main dealer ... all location ... all users", i.e. everything at once; tell
    // me if you'd rather this be filterable by a specific location too.
    [HttpGet]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
    public async Task<IActionResult> List([FromQuery] DateTime? date, [FromQuery] Guid? dealerId)
    {
        var day = (date ?? DateTime.UtcNow).Date;
        var isOrgWideRole = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        var effectiveDealerId = isOrgWideRole ? dealerId : _currentUser.DealerId;
        if (effectiveDealerId is null) return Ok(new { date = day, dealerId = (Guid?)null, items = Array.Empty<object>() });

        var staff = await _db.Users.AsNoTracking()
            .Where(u => u.Active && u.DealerId == effectiveDealerId)
            .OrderBy(u => u.Name)
            .Select(u => new { u.Id, u.Name, u.Role, u.WorkLocationCodes })
            .ToListAsync();
        if (staff.Count == 0) return Ok(new { date = day, dealerId = effectiveDealerId, items = Array.Empty<object>() });

        var staffIds = staff.Select(s => s.Id).ToList();
        var records = await _db.Attendance.AsNoTracking()
            .Where(a => a.AttendanceDate == day && staffIds.Contains(a.EmployeeId))
            .ToDictionaryAsync(a => a.EmployeeId);

        var items = staff.Select(s =>
        {
            records.TryGetValue(s.Id, out var rec);
            // Marked day's snapshot wins (what their location actually WAS that day); if not yet
            // marked, fall back to their current live WorkLocationCodes so the main dealer can
            // still see where to expect them before marking - see Attendance.Location's doc comment.
            // 2026-09-28 FIX (SECTION 134): s.WorkLocationCodes.Any() on a NULL WorkLocationCodes
            // (a plausible real state for any User row created before the 2026-09-17 Work Area
            // feature existed, if the DB column allows NULL and the value converter doesn't
            // coerce it to an empty list) throws a NullReferenceException here - this runs
            // client-side (LINQ-to-Objects, after ToListAsync()), so any one such row is enough to
            // 500 the WHOLE roster response, not just that row. Null-safe now via ?.Any() == true.
            var location = rec?.Location ?? (s.WorkLocationCodes?.Any() == true ? string.Join(", ", s.WorkLocationCodes) : null);
            return new
            {
                employeeId = s.Id,
                employeeName = s.Name,
                role = s.Role.ToString(),
                location,
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
    // 2026-09-28: re-gated from ServiceAdvisorUp to WorkshopManagerUp - see class doc comment. This
    // same upsert (re-POST for a date that already has a row) is what satisfies "if this user miss
    // then this main dealer can adjust this" - no separate edit endpoint needed, just this
    // tightened policy restricting WHO can call it.
    [HttpPost("mark")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
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
        // 2026-09-28: snapshot Location every time this is saved (not just on first creation) - a
        // main dealer's adjustment should reflect the employee's CURRENT WorkLocationCodes at the
        // time of the correction, same reasoning as EmployeeName/EmployeeRole being re-snapshotted
        // isn't done for those (kept as the original mark's values) - but Location is more likely to
        // need correcting itself as part of "adjust this", so it re-reads live each save.
        // 2026-09-28 FIX (SECTION 134): same null-WorkLocationCodes NullReferenceException risk as
        // List() above - guarded the same way so Mark() can't 500 on the same kind of row.
        existing.Location = employee.WorkLocationCodes?.Any() == true ? string.Join(", ", employee.WorkLocationCodes) : null;
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
    // 2026-09-28: re-gated from ServiceAdvisorUp to WorkshopManagerUp - see class doc comment.
    [HttpGet("summary")]
    [Authorize(Policy = Policies.WorkshopManagerUp)]
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
    ///   - SUPERSEDED 2026-09-28 (SECTION 153, "in attendance only 1 shift 10 to 6"): the
    ///     two-window design described just below no longer applies. There is now ONE shift,
    ///     10:00-18:00 IST (8 hrs) - every check-in is recorded as Shift1 regardless of the actual
    ///     login time (see the `shift` assignment a few lines down in CheckIn()). This does NOT
    ///     reject/flag a login outside 10:00-18:00 - it still records the real check-in time
    ///     whenever it happens; only the old time-of-day branching between two windows is gone.
    ///     The CheckOut() midnight-crossing lookup and ComputeHoursWorked's rollover logic are left
    ///     as-is - harmless even though a single 10:00-18:00 shift shouldn't normally cross
    ///     midnight. Original SECTION 101/143 text kept below for history, no longer current:
    ///   - Shift 1 = 09:00-18:00 (9 hrs). Shift 2 = 18:00-03:00 the NEXT calendar day (9 hrs) -
    ///     CHANGED 2026-09-28 (SECTION 143, "1st shift 9 to 6 then 2nd shift after that 9 hr") from
    ///     the original 18:00-24:00 (6 hrs) you'd described earlier - you confirmed Shift 2 should
    ///     match Shift 1's 9-hour length. This only affects the WINDOW used for the hoursWorked
    ///     calculation in Me() below and the CheckOut() midnight-crossing fix next to it - which
    ///     shift a login falls into (the `shift` assignment a few lines down) doesn't need to
    ///     change, since it only looks at whether the time-of-day is before/after 18:00 either way.
    ///     A login BEFORE 09:00 (not covered by your description) is counted as Shift 1 rather than
    ///     rejected - tell me if an early arrival should be handled differently.
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
        // 2026-09-28 (SECTION 153, "in attendance only 1 shift 10 to 6"): single shift now,
        // 10:00-18:00 IST (8 hrs) - replaces the two-window Shift1 (09:00-18:00) / Shift2
        // (18:00-03:00 next day) split used since SECTION 101/143. Every check-in is recorded as
        // Shift1 - the enum member itself is NOT renamed, only so old rows already saved with
        // "Shift1"/"Shift2" in the database keep parsing correctly through the existing
        // HasConversion<string>() mapping (SECTION 146/152); Shift2 is no longer assigned by
        // anything. This does NOT reject or flag a check-in outside 10:00-18:00 - it still records
        // the REAL time the person actually logs in, same as before; only the old time-of-day
        // branching that picked between two windows is removed. FLAGGING, not assuming: if you
        // also want a check-in outside 10:00-18:00 rejected, or marked "late"/"early", that is a
        // different, not-yet-requested rule - tell me and I'll add it.
        var shift = AttendanceShift.Shift1;

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
            // 2026-09-28: snapshot Location only on the actual check-in moment (same "first login
            // of the day" gate as CheckInTime/Shift just above) - see Attendance.Location's doc
            // comment. Read fresh here (not from the AsNoTracking() `user` read above, which is the
            // same row) since WorkLocationCodes could in principle change between logins.
            // 2026-09-28 FIX (SECTION 134): same null-WorkLocationCodes guard as List()/Mark() above
            // - CheckIn() has the identical risk on mobile self check-in.
            existing.Location = user.WorkLocationCodes?.Any() == true ? string.Join(", ", user.WorkLocationCodes) : null;
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
        var today = istNow.Date;

        // 2026-09-28 FIX (SECTION 143), surfaced by the Shift 2 change just above: Shift 2 now runs
        // 18:00-03:00, crossing midnight, so a checkout after midnight can land on a DIFFERENT
        // calendar date than the check-in that opened it (e.g. check in 22:00 Day 1, check out
        // 02:00 Day 2). The original `a.AttendanceDate == day` lookup used `day = istNow.Date` -
        // TODAY's date at the moment of checkout - which would miss that Day-1 row entirely and
        // fall into the "no check-in on record" branch below, creating a second, check-in-less row
        // for Day 2 instead of closing out the real one. Now looks for the most recent STILL-OPEN
        // row (CheckOutTime == null) for this employee first, regardless of exact date, and only
        // falls back to today's own row (original behavior, e.g. re-checking-out the same day) if
        // none is open.
        var existing = await _db.Attendance
            .Where(a => a.EmployeeId == employeeId && a.CheckOutTime == null)
            .OrderByDescending(a => a.AttendanceDate)
            .FirstOrDefaultAsync()
            ?? await _db.Attendance.FirstOrDefaultAsync(a => a.EmployeeId == employeeId && a.AttendanceDate == today);
        if (existing is null)
        {
            // No check-in on record at all (e.g. CheckIn() failed silently earlier, or this
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
                AttendanceDate = today,
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

    // ---------------- Self view: "my own attendance", nothing else (2026-09-28) ----------------
    /// <summary>NEW - "only that login supervisor or technitian attendance shown his page". Any
    /// logged-in staff member (Policies.Staff, the class-level floor - deliberately NOT
    /// WorkshopManagerUp, since this must stay reachable by everyone) can call this, but it is
    /// HARD-SCOPED server-side to _currentUser.UserId - there is no employeeId/dealerId parameter
    /// at all, by design, so there is no way to point this at anyone else's data regardless of what
    /// a caller sends. This is the one and only attendance view a Technician-table-backed user or a
    /// Supervisor-level login gets; the roster/mark/summary endpoints above are WorkshopManagerUp+
    /// only now (see class doc comment) and this endpoint is deliberately the sole substitute for
    /// them at lower roles.
    ///
    /// Returns the last `days` calendar days (default 14, capped at 62 - about 2 months - so this
    /// can't be turned into an unbounded history dump) up to and including `date` (default today),
    /// newest first, so a Supervisor can see a short recent trail of their own check-in/out times,
    /// not just a single day. ASSUMPTION: a 14-day default window - tell me if you want a different
    /// default or an explicit date-range picker on the page instead.
    ///
    /// 2026-09-28 (SECTION 143, "after 9 hrs complete auto checkout and if extra hr that user
    /// working then only maintain this hour ... that shown in page and maintain"): each row now
    /// also carries `hoursWorked` - a DISPLAY-ONLY computed value (per your confirmed answer), not
    /// a stored column. CheckOutTime in the database is still only ever set by the real
    /// CheckOut()/Mark() calls above - nothing here writes it automatically. For today's row with
    /// no checkout yet, hoursWorked is the LIVE elapsed time since CheckInTime (recomputed fresh on
    /// every call to this endpoint) and is NOT capped at 9/8 hours - it just keeps growing the
    /// longer they stay checked in, exactly as you confirmed ("keep tracking it, no cap"). For a
    /// past day with no checkout ever recorded, hoursWorked is null (there's no way to know when
    /// they actually left, so showing a frozen or made-up number would be worse than showing
    /// nothing) - see ComputeHoursWorked below.</summary>
    [HttpGet("me")]
    [Authorize(Policy = Policies.Staff)]
    public async Task<IActionResult> Me([FromQuery] DateTime? date, [FromQuery] int? days)
    {
        var employeeId = _currentUser.UserId;
        if (employeeId is null) return BadRequest(new { message = "No signed-in user." });

        var toDay = (date ?? DateTime.UtcNow).Date;
        var windowDays = days is > 0 and <= 62 ? days.Value : 14;
        var fromDay = toDay.AddDays(-(windowDays - 1));

        var records = await _db.Attendance.AsNoTracking()
            .Where(a => a.EmployeeId == employeeId && a.AttendanceDate >= fromDay && a.AttendanceDate <= toDay)
            .OrderByDescending(a => a.AttendanceDate)
            .ToListAsync();

        var istNow = DateTime.UtcNow.AddHours(5).AddMinutes(30);
        var items = records.Select(a => new
        {
            date = a.AttendanceDate,
            status = a.Status.ToString(),
            a.Location,
            checkInTime = a.CheckInTime,
            checkOutTime = a.CheckOutTime,
            shift = a.Shift.HasValue ? a.Shift.Value.ToString() : null,
            remarks = a.Remarks,
            hoursWorked = ComputeHoursWorked(a, istNow),
        });

        return Ok(new { fromDate = fromDay, toDate = toDay, items });
    }

    /// <summary>2026-09-28 (SECTION 143) - shared "how many hours has this check-in run" calculation
    /// used by Me()'s hoursWorked field. Combines AttendanceDate (the day the shift STARTED, i.e.
    /// the day of check-in) with the TimeSpan-of-day CheckInTime/CheckOutTime to get real
    /// DateTimes, so Shift 2's 18:00-03:00 window (crossing midnight - see CheckIn()'s doc comment)
    /// is handled correctly: if CheckOutTime is numerically SMALLER than CheckInTime, it's rolled
    /// onto the next calendar day rather than producing a negative/nonsensical duration. No upper
    /// cap is applied anywhere here - a shift that runs long just returns a bigger number.</summary>
    private static double? ComputeHoursWorked(Attendance a, DateTime istNow)
    {
        if (!a.CheckInTime.HasValue) return null;
        var checkInDateTime = a.AttendanceDate + a.CheckInTime.Value;

        DateTime endDateTime;
        if (a.CheckOutTime.HasValue)
        {
            endDateTime = a.CheckOutTime.Value < a.CheckInTime.Value
                ? a.AttendanceDate.AddDays(1) + a.CheckOutTime.Value
                : a.AttendanceDate + a.CheckOutTime.Value;
        }
        else
        {
            // Still checked in, no checkout recorded - only give a "live" running total for TODAY's
            // own row; a past day with a missing checkout is genuinely unknown, not zero.
            if (a.AttendanceDate != istNow.Date) return null;
            endDateTime = istNow;
        }

        var hours = (endDateTime - checkInDateTime).TotalHours;
        return hours < 0 ? null : Math.Round(hours, 2); // defensive - should not happen given the above
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
