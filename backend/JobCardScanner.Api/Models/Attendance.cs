namespace JobCardScanner.Api.Models;

/// <summary>
/// 2026-09-25 ("give attendance page for all dealer"): brand-new entity backing the Attendance
/// page. IMPORTANT - READ THIS: no existing Attendance table, controller, or business rule was
/// found anywhere in this project's history at the time this was built. You told me to "build a
/// standard version" after I confirmed nothing matching your "morning scenario" reference exists
/// in this session, so everything below is a STANDARD/ASSUMED design, not something copied from
/// your real schema or requirements. Review every field before you trust this in production -
/// see README SECTION 98 for the full list of assumptions and what still needs your confirmation.
///
/// One row = one staff member's attendance for one calendar day at one dealer. Upserted by
/// AttendanceController.Mark() (unique on EmployeeId + AttendanceDate - see the SQL script's
/// UQ_Attendance_Employee_Date constraint).
///
/// ASSUMPTION: "staff" = rows in the existing Users table (u.Active == true), scoped by
/// Users.DealerId - the same table/shape JobCardsController.Technicians() already reads from
/// (`_db.Users.Where(u => u.Role == StaffRole.Technician && u.Active)`). I did NOT create a
/// separate Employee/Roster table, since Users already looks like the real staff roster and
/// duplicating it would just create a second, driftable source of truth. EmployeeName/EmployeeRole
/// below are a DENORMALIZED SNAPSHOT taken at mark-time (so a later name/role change doesn't
/// rewrite attendance history, and the list screen doesn't need an extra join) - the live values
/// on Users are still the source of truth for the roster itself.
/// </summary>
public class Attendance
{
    public Guid Id { get; set; }

    /// <summary>Denormalized from the employee's Users.DealerId at mark-time, so dealer-level
    /// filtering/summary queries don't need a join back to Users.</summary>
    public Guid DealerId { get; set; }

    /// <summary>FK to Users.Id (the same table JobCardsController.Technicians() reads).</summary>
    public Guid EmployeeId { get; set; }

    public string EmployeeName { get; set; } = "";

    /// <summary>Snapshot of Users.Role.ToString() at mark-time - see class doc comment.</summary>
    public string EmployeeRole { get; set; } = "";

    /// <summary>Calendar date only (time component always midnight) - deliberately DateTime, not
    /// DateOnly, since I don't know your EF Core / SQL provider version and didn't want to risk a
    /// feature that might not map cleanly. Change to DateOnly if your codebase already uses it
    /// elsewhere.</summary>
    public DateTime AttendanceDate { get; set; }

    public AttendanceStatus Status { get; set; }

    /// <summary>Only meaningful when Status is Present or HalfDay - the UI hides these inputs for
    /// Absent/OnLeave, but nothing here enforces that server-side; add a check in Mark() if you
    /// want it enforced.</summary>
    public TimeSpan? CheckInTime { get; set; }
    public TimeSpan? CheckOutTime { get; set; }

    public string? Remarks { get; set; }

    /// <summary>FK to Users.Id - whoever marked/last-edited this row (_currentUser.UserId).
    /// Nullable Guid? - confirmed from your real JobCardScannerDbContext.cs/ICurrentUserService
    /// that _currentUser.UserId itself is Guid?, and this codebase's existing actor FKs
    /// (JobCard.CreatedById, JobCardStageHistory.ChangedById, etc.) follow that same nullable
    /// convention rather than forcing a non-null value. My first draft had this as non-nullable
    /// Guid, which is what threw your CS0266 error - fixed here.</summary>
    public Guid? MarkedByUserId { get; set; }
    public DateTime MarkedAtUtc { get; set; }

    /// <summary>2026-09-26 ("when i login then this time was login time and add in that shift...")
    /// - only ever set by AttendanceController.CheckIn() (the mobile self-login flow), from the
    /// FIRST login of the day. Null for rows created/edited only through the manual Mark()
    /// endpoint (SECTION 98's supervisor-facing web page) - that endpoint doesn't ask for or set a
    /// shift. See README SECTION 101 for the full shift-boundary assumptions.</summary>
    public AttendanceShift? Shift { get; set; }

    /// <summary>2026-09-28 ("location also location fetch from which location attendance are
    /// doing"): a DENORMALIZED SNAPSHOT (same reasoning as EmployeeName/EmployeeRole above) of the
    /// employee's Users.WorkLocationCodes at the moment attendance was recorded (CheckIn() for a
    /// self-login, or Mark() for a main-dealer-entered row) - joined with ", " if more than one
    /// code is assigned. Reuses this app's EXISTING location concept (User.WorkLocationCodes /
    /// JobCard.BaplServiceLocationCode, already used to scope Job Card creation - see
    /// JobCardsController.Create()) rather than inventing a new one, per your confirmed answer.
    ///
    /// INTERPRETATION, flagged: WorkLocationCodes stores CODES, not human-readable location names -
    /// I don't have a Locations/branches lookup table in this session to turn e.g. "DEL-01" into a
    /// display name, so this column (and the roster/self-view UI) shows the raw code(s) as-is. Tell
    /// me if you have a lookup for this and I'll join it in for a friendlier display.
    ///
    /// Null when the employee has no WorkLocationCodes assigned (unrestricted - see
    /// JobCardsController.Create()'s own "empty WorkLocationCodes = unrestricted" convention) - not
    /// an error, just "no specific location on record for this person."</summary>
    public string? Location { get; set; }
}

/// <summary>ASSUMPTION - a standard 4-state day status. If your dealer network actually tracks
/// attendance differently (e.g. hourly shifts, multiple check-in/out pairs per day, a separate
/// "Late" state), tell me and I'll change this - it's a plain enum so it's a one-file edit either
/// way.</summary>
public enum AttendanceStatus
{
    Present = 1,
    Absent = 2,
    HalfDay = 3,
    OnLeave = 4,
}

/// <summary>2026-09-26 ("1st shift 9 am to 6pm 1st shift and then 6 pm to 12 2nd shift") - originally
/// the two windows you described. See AttendanceController.CheckIn() for how a login moment maps
/// to one of these, including the one edge case you didn't specify (a login before 9am).
///
/// SUPERSEDED 2026-09-28 (SECTION 153, "in attendance only 1 shift 10 to 6"): simplified to ONE
/// shift, 10:00-18:00 IST (8 hrs). Shift2 is kept (not deleted) only so any attendance rows
/// already saved with it in the database keep parsing correctly through the existing
/// HasConversion&lt;string&gt;() mapping (SECTION 146/152) - nothing writes Shift2 anymore; every
/// new check-in from CheckIn() is recorded as Shift1.</summary>
public enum AttendanceShift
{
    Shift1 = 1, // 2026-09-28: now the ONLY shift CheckIn() assigns - 10:00-18:00 IST
    Shift2 = 2, // legacy only, no longer assigned - was 18:00-00:00 IST
}
