using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-10-05 ("Job Cards Submitted change Job Cards Created, then want Open, In Progress, Ready
/// for delivery, Invoiced ... on dashboard default today Open jobcard, Closed Job card, Ready For
/// Delivery, Invoiced that was redirect on 1 page ... Filters shown Date select and below All KPI
/// cards using daterange count update and on that card click then dealer ... and click on dealer
/// cards that under all user and jobcard"): the data behind the stage-wise Dealer Role Report.
///
/// This is a SEPARATE controller from DealerRoleReportController (the older submitted/open/closed/
/// cancelled report, which the Android screen still uses and which is left untouched) - same
/// CorporateAdminUp gate, new route /api/dashboard/dealer-stage-report:
///   GET .../summary?dateFrom=&amp;dateTo=&amp;dealerIds=a,b,c  - one row per dealer + grand totals
///        (the dashboard cards and the page's "all dealers" view and dealer cards).
///   GET .../?dealerId=&amp;dateFrom=&amp;dateTo=                 - one dealer: role -> person counts
///        plus the flat job-card list behind them (the role/user/job-card drill-down).
/// `dealerIds` is optional: the web app passes the ids of the dealers it chose to show (see
/// web/src/lib/reportDealers.ts), so no dealer names are hard-coded here; omit it for every dealer.
///
/// DEFINITIONS - INTERPRETATIONS, not something you spelled out, so please check them. Each job card
/// falls into exactly ONE bucket (so Open + In Progress + Ready + Invoiced + Other = Created), decided
/// in JobCardStageBuckets.Classify below (change it there, it is the only place):
///   - Invoiced           = current workflow stage is "invoice_generated" (the stage that also closes the job card).
///   - Ready for Delivery = current stage is "ready_for_delivery" (the same stage key the dashboard's "Vehicles Ready" tile counts).
///   - In Progress        = Status InProgress (set when a technician starts the work-log timer).
///   - Open               = Status Open (created, work not started yet).
///   - Other              = everything else: Cancelled, Pending* statuses, or Closed without ever reaching the invoice stage.
///   - Created            = every job card created in the period (the total).
///   - Not Closed         = Status neither Closed nor Cancelled - exactly the dashboard's "Open Job Cards Count" rule
///                          (so it can include In Progress, Ready for Delivery and Pending*). Overlaps the buckets; not part of the split.
///   - Closed             = Status Closed. NOT a separate bucket: it overlaps Invoiced (an invoiced job card is
///                          closed) and can also include ones closed another way, so Closed is reported
///                          alongside the buckets and is not part of the sum above.
/// "Period" = the job card's CreatedAt date by default (same as the older report); pass dateBasis=closed to use
/// the ClosedAt date instead. Dates are India days (IST), not UTC days. "Created by" = JobCard.CreatedById
/// (not the advisor/technician assigned). Job cards with no known creator are kept under an "Unknown" role
/// so totals still add up.
/// </summary>
[ApiController]
[Route("api/dashboard/dealer-stage-report")]
[Authorize(Policy = Policies.CorporateAdminUp)]
public class DealerStageReportController : ControllerBase
{
    /// <summary>Cap on the flat job-card list (counts are always exact; only this detail list is capped).</summary>
    private const int MaxJobCardRows = 5000;

    private readonly JobCardScannerDbContext _db;

    public DealerStageReportController(JobCardScannerDbContext db) => _db = db;

    /// <summary>The single place that decides which stage bucket a job card belongs to.</summary>
    internal static class JobCardStageBuckets
    {
        public const string Open = "Open";
        public const string InProgress = "InProgress";
        public const string ReadyForDelivery = "ReadyForDelivery";
        public const string Invoiced = "Invoiced";
        public const string Other = "Other";

        public static string Classify(JobCardStatus status, string? stageKey)
        {
            if (status == JobCardStatus.Cancelled) return Other;
            if (stageKey == "invoice_generated") return Invoiced;
            if (status == JobCardStatus.Closed) return Other;          // closed another way, never invoiced here
            if (stageKey == "ready_for_delivery") return ReadyForDelivery;
            if (status == JobCardStatus.InProgress) return InProgress;
            if (status == JobCardStatus.Open) return Open;
            return Other;
        }
    }

    private sealed class Counter
    {
        public int Created, Open, InProgress, ReadyForDelivery, Invoiced, Closed, Other, NotClosed;

        public void Add(JobCardStatus status, string bucket)
        {
            Created++;
            if (status == JobCardStatus.Closed) Closed++;
            // NotClosed = every job card that is neither Closed nor Cancelled - the SAME rule the
            // dashboard's "Open Job Cards Count" tile uses, so that tile's number and this report agree.
            if (status != JobCardStatus.Closed && status != JobCardStatus.Cancelled) NotClosed++;
            switch (bucket)
            {
                case JobCardStageBuckets.Open: Open++; break;
                case JobCardStageBuckets.InProgress: InProgress++; break;
                case JobCardStageBuckets.ReadyForDelivery: ReadyForDelivery++; break;
                case JobCardStageBuckets.Invoiced: Invoiced++; break;
                default: Other++; break;
            }
        }
    }

    /// <summary>India has no daylight saving: IST is a fixed UTC+05:30.</summary>
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);

    /// <summary>
    /// Applies the date window. 2026-10-05: (1) `byClosed` filters on the job card's ClosedAt instead of
    /// CreatedAt - used by the dashboard's "Closed today" / "Invoiced today" cards, which mean "closed
    /// today", not "created today" (a job card created last week and invoiced this morning must count).
    /// (2) The dates are now read as INDIA days: CreatedAt/ClosedAt are stored in UTC, and a day that
    /// starts at 00:00 IST starts at 18:30 UTC the evening before, so the old plain-UTC window
    /// dropped anything created or closed between 00:00 and 05:30 IST into the wrong day.
    /// A null ClosedAt never matches a closed-date window.
    /// </summary>
    private static IQueryable<JobCard> ApplyDates(IQueryable<JobCard> q, DateOnly? dateFrom, DateOnly? dateTo, bool byClosed)
    {
        if (dateFrom is not null)
        {
            var from = dateFrom.Value.ToDateTime(TimeOnly.MinValue) - IstOffset;
            q = byClosed ? q.Where(j => j.ClosedAt >= from) : q.Where(j => j.CreatedAt >= from);
        }
        if (dateTo is not null)
        {
            var to = dateTo.Value.ToDateTime(TimeOnly.MaxValue) - IstOffset;
            q = byClosed ? q.Where(j => j.ClosedAt <= to) : q.Where(j => j.CreatedAt <= to);
        }
        return q;
    }

    private static bool IsClosedBasis(string? dateBasis) => string.Equals(dateBasis, "closed", StringComparison.OrdinalIgnoreCase);

    // ------------------------------------------------------------------ summary (all dealers)

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] DateOnly? dateFrom, [FromQuery] DateOnly? dateTo, [FromQuery] string? dealerIds, [FromQuery] string? dateBasis)
    {
        var wanted = (dealerIds ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => Guid.TryParse(s, out var g) ? g : (Guid?)null)
            .Where(g => g.HasValue).Select(g => g!.Value)
            .ToList();

        var dealersQuery = _db.Dealers.AsNoTracking().AsQueryable();
        if (wanted.Count > 0) dealersQuery = dealersQuery.Where(d => wanted.Contains(d.Id));
        var dealers = await dealersQuery.OrderBy(d => d.Name).Select(d => new { d.Id, d.Name, d.Code }).ToListAsync();
        var dealerIdList = dealers.Select(d => d.Id).ToList();

        var byClosed = IsClosedBasis(dateBasis);
        var jobs = await ApplyDates(_db.JobCards.AsNoTracking().Where(j => dealerIdList.Contains(j.DealerId)), dateFrom, dateTo, byClosed)
            .Select(j => new { j.DealerId, j.Status, StageKey = j.CurrentStage != null ? j.CurrentStage.StageKey : null })
            .ToListAsync();

        var perDealer = dealers.ToDictionary(d => d.Id, _ => new Counter());
        var total = new Counter();
        foreach (var j in jobs)
        {
            var bucket = JobCardStageBuckets.Classify(j.Status, j.StageKey);
            perDealer[j.DealerId].Add(j.Status, bucket);
            total.Add(j.Status, bucket);
        }

        return Ok(new
        {
            generatedAt = DateTime.UtcNow,
            dateFrom,
            dateTo,
            dateBasis = byClosed ? "closed" : "created",
            totals = ToCounts(total),
            dealers = dealers.Select(d =>
            {
                var c = perDealer[d.Id];
                return new DealerStageRow(d.Id, d.Name, d.Code, c.Created, c.Open, c.InProgress, c.ReadyForDelivery, c.Invoiced, c.Closed, c.Other, c.NotClosed);
            }).ToList(),
        });
    }

    // ------------------------------------------------------------------ one dealer: roles -> people -> job cards

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] Guid dealerId, [FromQuery] DateOnly? dateFrom, [FromQuery] DateOnly? dateTo, [FromQuery] string? dateBasis)
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

        var byClosed = IsClosedBasis(dateBasis);
        var jobs = await ApplyDates(_db.JobCards.AsNoTracking().Where(j => j.DealerId == dealerId), dateFrom, dateTo, byClosed)
            .OrderByDescending(j => j.CreatedAt)
            .Select(j => new
            {
                j.Id,
                j.JobCardNumber,
                j.CreatedAt,
                j.ClosedAt,
                j.Status,
                StageKey = j.CurrentStage != null ? j.CurrentStage.StageKey : null,
                StageLabel = j.CurrentStage != null ? j.CurrentStage.Label : null,
                CreatedById = (Guid?)j.CreatedById,
                RegNo = j.Vehicle != null ? j.Vehicle.RegNo : null,
                CustomerName = j.Customer != null ? j.Customer.Name : null,
            })
            .ToListAsync();

        var perUser = new Dictionary<Guid, Counter>();
        var unknown = new Counter();
        foreach (var j in jobs)
        {
            var bucket = JobCardStageBuckets.Classify(j.Status, j.StageKey);
            if (j.CreatedById is Guid uid && userById.ContainsKey(uid))
            {
                if (!perUser.TryGetValue(uid, out var c)) perUser[uid] = c = new Counter();
                c.Add(j.Status, bucket);
            }
            else
            {
                unknown.Add(j.Status, bucket);
            }
        }

        var roles = users
            .GroupBy(u => u.Role.ToString())
            .Select(g =>
            {
                var people = g
                    .Select(u =>
                    {
                        perUser.TryGetValue(u.Id, out var c);
                        c ??= new Counter();
                        return new PersonRow(u.Id, u.Name, u.Designation, u.Active,
                            c.Created, c.Open, c.InProgress, c.ReadyForDelivery, c.Invoiced, c.Closed, c.Other, c.NotClosed);
                    })
                    .OrderByDescending(p => p.Created).ThenBy(p => p.Name)
                    .ToList();
                return MakeRole(g.Key, people.Count, people);
            })
            .OrderByDescending(r => r.Created).ThenBy(r => r.Role)
            .ToList();

        if (unknown.Created > 0)
        {
            roles.Add(MakeRole("Unknown (creator not recorded / not in this dealer)", 0, new List<PersonRow>
            {
                new PersonRow(null, "—", null, true,
                    unknown.Created, unknown.Open, unknown.InProgress, unknown.ReadyForDelivery, unknown.Invoiced, unknown.Closed, unknown.Other, unknown.NotClosed),
            }));
        }

        var totals = new
        {
            created = jobs.Count,
            open = roles.Sum(r => r.Open),
            inProgress = roles.Sum(r => r.InProgress),
            readyForDelivery = roles.Sum(r => r.ReadyForDelivery),
            invoiced = roles.Sum(r => r.Invoiced),
            closed = roles.Sum(r => r.Closed),
            other = roles.Sum(r => r.Other),
            notClosed = roles.Sum(r => r.NotClosed),
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
            return new JobRow(j.Id, j.JobCardNumber, j.CreatedAt, j.Status.ToString(), j.StageLabel,
                JobCardStageBuckets.Classify(j.Status, j.StageKey), j.ClosedAt, j.CreatedById, createdBy, role, j.RegNo, j.CustomerName);
        }).ToList();

        return Ok(new
        {
            dealer,
            generatedAt = DateTime.UtcNow,
            dateFrom,
            dateTo,
            dateBasis = byClosed ? "closed" : "created",
            totals,
            roles,
            jobCards,
            jobCardsTruncated = jobs.Count > MaxJobCardRows,
        });
    }

    // ------------------------------------------------------------------ helpers / DTOs

    private static object ToCounts(Counter c) => new
    {
        created = c.Created,
        open = c.Open,
        inProgress = c.InProgress,
        readyForDelivery = c.ReadyForDelivery,
        invoiced = c.Invoiced,
        closed = c.Closed,
        other = c.Other,
        notClosed = c.NotClosed,
    };

    private static RoleRow MakeRole(string role, int users, List<PersonRow> people) => new(
        role, users,
        people.Sum(p => p.Created), people.Sum(p => p.Open), people.Sum(p => p.InProgress),
        people.Sum(p => p.ReadyForDelivery), people.Sum(p => p.Invoiced), people.Sum(p => p.Closed), people.Sum(p => p.Other), people.Sum(p => p.NotClosed),
        people);

    // PascalCase record members serialize as camelCase JSON (same global naming policy every other
    // controller relies on) - matching web/src/lib/dealerRoleReportExport.ts exactly.
    private sealed record DealerStageRow(Guid DealerId, string DealerName, string? DealerCode, int Created, int Open, int InProgress, int ReadyForDelivery, int Invoiced, int Closed, int Other, int NotClosed);
    private sealed record PersonRow(Guid? UserId, string Name, string? Designation, bool Active, int Created, int Open, int InProgress, int ReadyForDelivery, int Invoiced, int Closed, int Other, int NotClosed);
    private sealed record RoleRow(string Role, int Users, int Created, int Open, int InProgress, int ReadyForDelivery, int Invoiced, int Closed, int Other, int NotClosed, List<PersonRow> People);
    private sealed record JobRow(Guid Id, string JobCardNumber, DateTime CreatedAt, string Status, string? Stage, string Bucket, DateTime? ClosedAt, Guid? CreatedById, string CreatedBy, string Role, string? RegNo, string? CustomerName);
}