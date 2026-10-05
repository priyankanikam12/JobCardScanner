using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-05 ("for systemadmin role can see all active dealer from dashboard Dealers cards click
/// open 1 page ... select this dealer all roles open and in that each role how many jobcard
/// submitted how much open how much closed ... report and download excel and pdf"): the data behind
/// the new Dealer Role Report page (web: /dealer-role-report, Android: DealerRoleReport screen).
///
/// GET /api/dashboard/dealer-role-report?dealerId=&amp;dateFrom=&amp;dateTo= - for ONE dealer, every
/// role that has staff under it, and per role (and per person inside each role) how many job cards
/// were SUBMITTED (= created by that person), how many of those are still OPEN, how many CLOSED,
/// and how many CANCELLED. Also returns the flat job-card list behind those counts, so the Excel/PDF
/// export can carry "all count and details".
///
/// Gated CorporateAdminUp - the same policy as the other Corporate Dashboard endpoints
/// (DashboardController.Corporate/CorporateFilters), because the card that opens this page lives on
/// the Corporate Dashboard, which both CorporateAdmin and SystemAdmin land on. Say so if it must be
/// SystemAdmin ONLY and I'll switch it to Policies.SystemAdminOnly.
///
/// DEFINITIONS (please confirm - these are interpretations, not something you spelled out):
///   - "submitted by a role" = JobCard.CreatedById belongs to a User of that role. (A job card's
///     ServiceAdvisorId / AssignedTechnician are different people and are NOT what is counted.)
///   - OPEN = Status is neither Closed nor Cancelled - the same definition DashboardController's
///     "Open Job Cards" tile and JobCardsController.List's excludeClosed already use. CLOSED =
///     Status Closed. CANCELLED is shown separately so Submitted = Open + Closed + Cancelled.
///   - dateFrom/dateTo (optional) filter on the job card's CreatedAt; leave both off for all time.
///   - Staff of the dealer who have created nothing still appear (with zeros), inactive staff
///     included and flagged, so history isn't lost when someone is deactivated.
///   - A job card whose CreatedById is empty, or belongs to someone who is not a user of this
///     dealer, is not dropped: it is counted under an "Unknown" role so the totals still add up.
/// </summary>
[ApiController]
[Route("api/dashboard/dealer-role-report")]
[Authorize(Policy = Policies.CorporateAdminUp)]
public class DealerRoleReportController : ControllerBase
{
    /// <summary>Cap on the flat job-card list returned for the export (counts are always exact;
    /// only this detail list is capped). JobCardsTruncated tells the UI/export when it was hit.</summary>
    private const int MaxJobCardRows = 5000;

    private readonly JobCardScannerDbContext _db;

    public DealerRoleReportController(JobCardScannerDbContext db) => _db = db;

    private sealed class Counter
    {
        public int Submitted, Open, Closed, Cancelled;
        public void Add(JobCardStatus s)
        {
            Submitted++;
            if (s == JobCardStatus.Closed) Closed++;
            else if (s == JobCardStatus.Cancelled) Cancelled++;
            else Open++;
        }
    }

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] Guid dealerId, [FromQuery] DateOnly? dateFrom, [FromQuery] DateOnly? dateTo)
    {
        var dealer = await _db.Dealers.AsNoTracking()
            .Where(d => d.Id == dealerId)
            .Select(d => new { d.Id, d.Name, d.Code })
            .FirstOrDefaultAsync();
        if (dealer is null) return NotFound(new { message = "Dealer not found." });

        var users = await _db.Users.AsNoTracking()
            .Where(u => u.DealerId == dealerId)
            .Select(u => new { u.Id, u.Name, u.Role, u.Designation, u.Active })
            .ToListAsync();
        var userById = users.ToDictionary(u => u.Id);

        var jobsQuery = _db.JobCards.AsNoTracking().Where(j => j.DealerId == dealerId);
        if (dateFrom is not null)
        {
            var from = dateFrom.Value.ToDateTime(TimeOnly.MinValue);
            jobsQuery = jobsQuery.Where(j => j.CreatedAt >= from);
        }
        if (dateTo is not null)
        {
            var to = dateTo.Value.ToDateTime(TimeOnly.MaxValue);
            jobsQuery = jobsQuery.Where(j => j.CreatedAt <= to);
        }

        // (Guid?) cast: JobCard.CreatedById is assigned from ICurrentUserService.UserId (Guid?) in
        // JobCardsController.Create, and this projection compiles whether the column is Guid or Guid?.
        var jobs = await jobsQuery
            .OrderByDescending(j => j.CreatedAt)
            .Select(j => new
            {
                j.Id,
                j.JobCardNumber,
                j.CreatedAt,
                j.ClosedAt,
                j.Status,
                CreatedById = (Guid?)j.CreatedById,
                RegNo = j.Vehicle != null ? j.Vehicle.RegNo : null,
                CustomerName = j.Customer != null ? j.Customer.Name : null,
            })
            .ToListAsync();

        // ---- count per creator ----
        var perUser = new Dictionary<Guid, Counter>();
        var unknown = new Counter();
        foreach (var j in jobs)
        {
            if (j.CreatedById is Guid uid && userById.ContainsKey(uid))
            {
                if (!perUser.TryGetValue(uid, out var c)) perUser[uid] = c = new Counter();
                c.Add(j.Status);
            }
            else
            {
                unknown.Add(j.Status);
            }
        }

        // ---- roll up per role (every role that has at least one user, zeros included) ----
        var roles = users
            .GroupBy(u => u.Role.ToString())
            .Select(g =>
            {
                var people = g
                    .Select(u =>
                    {
                        perUser.TryGetValue(u.Id, out var c);
                        c ??= new Counter();
                        return new PersonRow(u.Id, u.Name, u.Designation, u.Active, c.Submitted, c.Open, c.Closed, c.Cancelled);
                    })
                    .OrderByDescending(p => p.Submitted).ThenBy(p => p.Name)
                    .ToList();
                return new RoleRow(
                    g.Key, people.Count,
                    people.Sum(p => p.Submitted), people.Sum(p => p.Open), people.Sum(p => p.Closed), people.Sum(p => p.Cancelled),
                    people);
            })
            .OrderByDescending(r => r.Submitted).ThenBy(r => r.Role)
            .ToList();

        if (unknown.Submitted > 0)
        {
            roles.Add(new RoleRow(
                "Unknown (creator not recorded / not in this dealer)", 0,
                unknown.Submitted, unknown.Open, unknown.Closed, unknown.Cancelled,
                new List<PersonRow> { new PersonRow(null, "—", null, true, unknown.Submitted, unknown.Open, unknown.Closed, unknown.Cancelled) }));
        }

        var totals = new
        {
            submitted = jobs.Count,
            open = roles.Sum(r => r.Open),
            closed = roles.Sum(r => r.Closed),
            cancelled = roles.Sum(r => r.Cancelled),
            users = users.Count,
            activeUsers = users.Count(u => u.Active),
        };

        var jobCards = jobs.Take(MaxJobCardRows).Select(j =>
        {
            string createdBy = "—", role = "Unknown";
            if (j.CreatedById is Guid uid && userById.TryGetValue(uid, out var u))
            {
                createdBy = u.Name;
                role = u.Role.ToString();
            }
            return new JobCardRow(j.Id, j.JobCardNumber, j.CreatedAt, j.Status.ToString(), j.ClosedAt, j.CreatedById, createdBy, role, j.RegNo, j.CustomerName);
        }).ToList();

        return Ok(new
        {
            dealer,
            generatedAt = DateTime.UtcNow,
            dateFrom,
            dateTo,
            totals,
            roles,
            jobCards,
            jobCardsTruncated = jobs.Count > MaxJobCardRows,
        });
    }

    // PascalCase record members serialize as camelCase JSON (same global naming policy every other
    // controller in this app relies on), matching the TypeScript types in
    // web/src/lib/dealerRoleReportExport.ts and mobile/src/utils/dealerRoleReportExport.ts.
    private sealed record PersonRow(Guid? UserId, string Name, string? Designation, bool Active, int Submitted, int Open, int Closed, int Cancelled);
    private sealed record RoleRow(string Role, int Users, int Submitted, int Open, int Closed, int Cancelled, List<PersonRow> People);
    // Id + CreatedById let the web page link each row to its job card and filter by person (2026-10-05).
    private sealed record JobCardRow(Guid Id, string JobCardNumber, DateTime CreatedAt, string Status, DateTime? ClosedAt, Guid? CreatedById, string CreatedBy, string Role, string? RegNo, string? CustomerName);
}