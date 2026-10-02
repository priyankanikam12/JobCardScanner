using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services;

/// <summary>
/// SECTION 186 (2026-10-02, "when i i login 1st time in morning 9 to 6 after 1st login 9 hr
/// calculate and log out after 9 hr that implememnt properly") - confirmed via AskUserQuestion:
/// a Shift 1 staff member still checked in (CheckOutTime still null) at 18:00 IST gets
/// CheckOutTime auto-written as 18:00 by this background job, rather than letting hoursWorked
/// (AttendanceController.Me's live display field) grow unboundedly for the rest of the night.
///
/// This does NOT touch the auto-CHECK-IN half of your request - that already exists and works
/// today (AttendanceController.CheckIn, called by web/src/services/attendanceCheckin.ts and
/// mobile/src/services/attendanceCheckin.ts's checkInAfterLogin()). What's still missing there is
/// wiring checkInAfterLogin()/checkOutBeforeLogout() into your REAL login/logout code - I still
/// don't have web/src/auth/StaffAuthContext.tsx or mobile/src/auth/AuthContext.tsx in this
/// session, so that half remains a manual step until those are pasted.
///
/// WHY A PLAIN BackgroundService, not Hangfire/Quartz: nothing in Program.cs registers either of
/// those, so this assumes none is set up - a simple poll loop needs no new package and no new
/// infrastructure.
///
/// IDEMPOTENT BY CONSTRUCTION: the query only matches rows where CheckOutTime IS STILL NULL, so
/// ticking every 2 minutes (including many times after 18:00 on the same day) is safe - the first
/// tick after 18:00 IST closes every still-open Shift 1 row for today; every tick after that
/// matches zero rows until tomorrow's check-ins start. No separate "already ran today" flag table
/// needed, and a missed tick (e.g. app restart at 18:05) is self-healing on the very next tick.
///
/// SCOPE, confirmed: only Shift 1 (AttendanceShift.Shift1) rows for TODAY (IST). Shift 2 rows are
/// deliberately left untouched - per CheckIn()'s own doc comment, SECTION 153 made every check-in
/// Shift1 regardless of login time, so Shift 2 isn't actually being assigned to anyone today, but
/// the WHERE clause stays scoped correctly in case Shift 2 assignment is ever restored.
///
/// ASSUMPTION FLAGGED: the 18:00 IST cutoff matches the one time value both versions of
/// CheckIn()'s own shift-window comment agree on (SECTION 143's original "09:00-18:00" and
/// SECTION 153's later "10:00-18:00" both end at 18:00; only the START time is inconsistent
/// between those two comments, and your own messages describe "9 to 6"/"9 hr" again here). This
/// job only ever WRITES CheckOutTime, never CheckInTime, so that start-time inconsistency has no
/// effect on what this job does - it closes out whatever real CheckInTime is already on the row,
/// however early or late it was. If the shift's displayed START time in CheckIn()'s own comments
/// also needs correcting back to 09:00, say so separately; I did not change CheckIn() itself here.
/// </summary>
public class AttendanceAutoCheckoutService : BackgroundService
{
    private static readonly TimeSpan ShiftOneEndIst = new(18, 0, 0);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(2);

    private readonly IServiceProvider _services;
    private readonly ILogger<AttendanceAutoCheckoutService> _logger;

    public AttendanceAutoCheckoutService(IServiceProvider services, ILogger<AttendanceAutoCheckoutService> logger)
    {
        _services = services;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(PollInterval);
        do
        {
            try
            {
                await CloseOpenShiftOneRowsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                // Never let one failed tick kill the whole background service - same per-block
                // isolation convention Program.cs's own startup self-heal blocks already use.
                _logger.LogWarning(ex, "[AttendanceAutoCheckout] tick failed: {Message}", ex.Message);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task CloseOpenShiftOneRowsAsync(CancellationToken ct)
    {
        // Fixed UTC+5:30 offset - same convention AttendanceController.CheckIn/CheckOut/Me already
        // use throughout this file, rather than an OS timezone lookup. India has no DST, so this
        // is safe and sidesteps "India Standard Time" (Windows) vs "Asia/Kolkata" (IANA) mismatches
        // across hosts.
        var istNow = DateTime.UtcNow.AddHours(5).AddMinutes(30);
        if (istNow.TimeOfDay < ShiftOneEndIst) return; // not 18:00 IST yet today - nothing to do

        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<JobCardScannerDbContext>();
        var audit = scope.ServiceProvider.GetRequiredService<IAuditLogService>();

        var today = istNow.Date;
        var openRows = await db.Attendance
            .Where(a => a.AttendanceDate == today
                && a.Shift == AttendanceShift.Shift1
                && a.CheckInTime != null
                && a.CheckOutTime == null)
            .ToListAsync(ct);

        if (openRows.Count == 0) return;

        foreach (var row in openRows)
        {
            row.CheckOutTime = ShiftOneEndIst;
            row.MarkedAtUtc = DateTime.UtcNow;
            // MarkedByUserId deliberately left as whatever it already was (the employee's own id,
            // set by their original CheckIn()) rather than invented as a "system" sentinel - there
            // is no confirmed concept of a system/automated actor id in this schema.
        }
        await db.SaveChangesAsync(ct);

        foreach (var row in openRows)
        {
            await audit.LogAsync("Attendance.AutoCheckout", "Attendance", row.Id.ToString(),
                new { row.EmployeeId, row.AttendanceDate, row.CheckOutTime });
        }

        _logger.LogInformation(
            "[AttendanceAutoCheckout] Auto-closed {Count} Shift 1 attendance row(s) at 18:00 IST for {Date:yyyy-MM-dd}.",
            openRows.Count, today);
    }
}
