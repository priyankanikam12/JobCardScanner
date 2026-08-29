using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>Dealer-level and corporate roll-up KPIs for the dashboard module.</summary>
[ApiController]
[Route("api/dashboard")]
[Authorize(Policy = Policies.Staff)]
public class DashboardController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;

    public DashboardController(JobCardScannerDbContext db, ICurrentUserService currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    /// <summary>Single-dealer "Dealer Dashboard" - the everyday operations view every dealer-side
    /// role (Service Advisor up to Dealer Admin) lands on. Corporate/System Admin can still call
    /// this for one dealer via ?dealerId=, but their own landing page is GET /corporate below.</summary>
    [HttpGet("kpis")]
    public async Task<IActionResult> Kpis([FromQuery] Guid? dealerId)
    {
        var isCorporate = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        var effectiveDealerId = dealerId ?? (isCorporate ? null : _currentUser.DealerId);

        var jobCards = _db.JobCards.AsNoTracking().AsQueryable();
        if (effectiveDealerId.HasValue) jobCards = jobCards.Where(j => j.DealerId == effectiveDealerId);

        var monthStart = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var todayStart = DateTime.UtcNow.Date;
        var tomorrowStart = todayStart.AddDays(1);

        var totalOpen = await jobCards.CountAsync(j => j.Status != JobCardStatus.Closed && j.Status != JobCardStatus.Cancelled);
        var openToday = await jobCards.CountAsync(j => j.CreatedAt >= todayStart);
        var closedThisMonth = await jobCards.CountAsync(j => j.ClosedAt >= monthStart);
        var pendingApproval = await jobCards.CountAsync(j => j.Status == JobCardStatus.PendingCustomerApproval);
        var overdue = await jobCards.CountAsync(j => j.ExpectedDeliveryAt < DateTime.UtcNow && j.Status != JobCardStatus.Closed && j.Status != JobCardStatus.Cancelled);

        // ---- "Dealer Dashboard" tiles (mirrors the workshop's daily ops board) ----
        var vehiclesReceivedToday = await jobCards.CountAsync(j => j.CreatedAt >= todayStart && j.CreatedAt < tomorrowStart);
        var underService = await jobCards.CountAsync(j => j.CurrentStage!.StageKey == "in_repair");
        var waitingForParts = await jobCards.CountAsync(j => j.CurrentStage!.StageKey == "parts_requested");
        var waitingCustomerApproval = pendingApproval;
        var vehiclesReady = await jobCards.CountAsync(j => j.CurrentStage!.StageKey == "ready_for_delivery");
        var vehiclesDeliveredToday = await jobCards.CountAsync(j => j.ActualDeliveryAt >= todayStart && j.ActualDeliveryAt < tomorrowStart);
        // "Pending" here means waiting on someone/something else (customer, QC, invoicing, closure) -
        // distinct from Open/InProgress, which is actively-in-hand work.
        var pendingJobCards = await jobCards.CountAsync(j =>
            j.Status == JobCardStatus.PendingCustomerApproval || j.Status == JobCardStatus.PendingQc ||
            j.Status == JobCardStatus.PendingClosure || j.Status == JobCardStatus.PendingInvoice);
        var warrantyJobsOpen = await jobCards.CountAsync(j => j.ServiceType == ServiceType.Warranty && j.Status != JobCardStatus.Closed && j.Status != JobCardStatus.Cancelled);

        var invoices = _db.Invoices.AsNoTracking().AsQueryable();
        if (effectiveDealerId.HasValue) invoices = invoices.Where(i => i.DealerId == effectiveDealerId);
        var revenueThisMonth = await invoices.Where(i => i.GeneratedAt >= monthStart).SumAsync(i => (decimal?)i.TotalAmount) ?? 0;
        var revenueToday = await invoices.Where(i => i.GeneratedAt >= todayStart).SumAsync(i => (decimal?)i.TotalAmount) ?? 0;
        var revenuePaidInvoices = await invoices.Where(i => i.Status == InvoiceStatus.Paid).SumAsync(i => (decimal?)i.TotalAmount) ?? 0;

        var byStatus = await jobCards.GroupBy(j => j.Status).Select(g => new { Status = g.Key.ToString(), Count = g.Count() }).ToListAsync();

        var closedWithDuration = await jobCards
            .Where(j => j.Status == JobCardStatus.Closed && j.ClosedAt != null)
            .Select(j => new { j.CreatedAt, ClosedAt = j.ClosedAt!.Value })
            .Take(500)
            .ToListAsync();
        var avgTurnaroundHours = closedWithDuration.Count > 0
            ? closedWithDuration.Average(x => (x.ClosedAt - x.CreatedAt).TotalHours)
            : 0;

        // No customer feedback/rating capture exists in the schema yet (see JobCard/Estimate/
        // Invoice models) - surfaced honestly as "no ratings yet" rather than a fabricated
        // number. Wiring up a real post-closure rating prompt (customer portal) is a follow-up.
        var csat = new { Average = (double?)null, RatingsCount = 0 };

        return Ok(new
        {
            totalOpen,
            openToday,
            closedThisMonth,
            pendingApproval,
            overdue,
            revenueToday,
            revenueThisMonth,
            revenuePaidInvoices,
            avgTurnaroundHours = Math.Round(avgTurnaroundHours, 1),
            byStatus,
            vehiclesReceivedToday,
            underService,
            waitingForParts,
            waitingCustomerApproval,
            vehiclesReady,
            vehiclesDeliveredToday,
            pendingJobCards,
            warrantyJobsOpen,
            csat,
        });
    }

    [HttpGet("dealer-comparison")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> DealerComparison()
    {
        var dealers = await _db.Dealers.AsNoTracking().ToListAsync();
        var results = new List<object>();
        foreach (var dealer in dealers)
        {
            var open = await _db.JobCards.CountAsync(j => j.DealerId == dealer.Id && j.Status != JobCardStatus.Closed && j.Status != JobCardStatus.Cancelled);
            var revenue = await _db.Invoices.Where(i => i.DealerId == dealer.Id).SumAsync(i => (decimal?)i.TotalAmount) ?? 0;
            results.Add(new { dealer.Id, dealer.Name, dealer.Code, OpenJobCards = open, TotalRevenue = revenue });
        }
        return Ok(results);
    }

    /// <summary>Distinct filter option lists for the Corporate Dashboard's filter bar (Region/
    /// State/City/Dealer/Model). Built from whatever's actually in the data rather than a fixed
    /// list, so it never drifts from what dealers/vehicles really exist.</summary>
    [HttpGet("corporate/filters")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> CorporateFilters()
    {
        var dealers = await _db.Dealers.AsNoTracking().OrderBy(d => d.Name).Select(d => new { d.Id, d.Name }).ToListAsync();
        var regions = await _db.Dealers.AsNoTracking().Where(d => d.Region != null && d.Region != "").Select(d => d.Region!).Distinct().OrderBy(r => r).ToListAsync();
        var states = await _db.Dealers.AsNoTracking().Where(d => d.State != null && d.State != "").Select(d => d.State!).Distinct().OrderBy(s => s).ToListAsync();
        var cities = await _db.Dealers.AsNoTracking().Where(d => d.City != null && d.City != "").Select(d => d.City!).Distinct().OrderBy(c => c).ToListAsync();
        var models = await _db.Vehicles.AsNoTracking().Select(v => v.Model).Distinct().OrderBy(m => m).ToListAsync();

        return Ok(new { dealers, regions, states, cities, models });
    }

    /// <summary>The Corporate Dashboard: consolidated visibility across every dealer, filterable
    /// by region/state/city/dealer/model and warranty vs non-warranty work.</summary>
    [HttpGet("corporate")]
    [Authorize(Policy = Policies.CorporateAdminUp)]
    public async Task<IActionResult> Corporate(
        [FromQuery] string? region, [FromQuery] string? state, [FromQuery] string? city,
        [FromQuery] Guid? dealerId, [FromQuery] string? model, [FromQuery] string? warranty)
    {
        var jobCards = _db.JobCards.AsNoTracking().AsQueryable();
        if (dealerId.HasValue) jobCards = jobCards.Where(j => j.DealerId == dealerId);
        if (!string.IsNullOrWhiteSpace(region)) jobCards = jobCards.Where(j => j.Dealer!.Region == region);
        if (!string.IsNullOrWhiteSpace(state)) jobCards = jobCards.Where(j => j.Dealer!.State == state);
        if (!string.IsNullOrWhiteSpace(city)) jobCards = jobCards.Where(j => j.Dealer!.City == city);
        if (!string.IsNullOrWhiteSpace(model)) jobCards = jobCards.Where(j => j.Vehicle!.Model == model);
        if (string.Equals(warranty, "warranty", StringComparison.OrdinalIgnoreCase)) jobCards = jobCards.Where(j => j.ServiceType == ServiceType.Warranty);
        else if (string.Equals(warranty, "nonwarranty", StringComparison.OrdinalIgnoreCase)) jobCards = jobCards.Where(j => j.ServiceType != ServiceType.Warranty);

        var jobCardIds = jobCards.Select(j => j.Id);

        var pendingVehicles = await jobCards.CountAsync(j => j.Status != JobCardStatus.Closed && j.Status != JobCardStatus.Cancelled);

        var revenue = await _db.Invoices.AsNoTracking()
            .Where(i => jobCardIds.Contains(i.JobCardId) && i.Status == InvoiceStatus.Paid)
            .SumAsync(i => (decimal?)i.TotalAmount) ?? 0;

        var warrantyJobCardIds = jobCards.Where(j => j.ServiceType == ServiceType.Warranty).Select(j => j.Id);
        var warrantyCost = await _db.Invoices.AsNoTracking()
            .Where(i => warrantyJobCardIds.Contains(i.JobCardId))
            .SumAsync(i => (decimal?)i.TotalAmount) ?? 0;

        // See the note on Kpis() above - no rating/feedback capture exists yet.
        var csat = new { Average = (double?)null, RatingsCount = 0 };

        var jobCardVolumeByDealer = await jobCards
            .GroupBy(j => j.Dealer!.Name)
            .Select(g => new { DealerName = g.Key, Count = g.Count() })
            .OrderByDescending(g => g.Count)
            .ToListAsync();

        var todayStart = DateTime.UtcNow.Date;
        var trendSince = todayStart.AddDays(-13);
        var rawTrend = await jobCards
            .Where(j => j.CreatedAt >= trendSince)
            .GroupBy(j => j.CreatedAt.Date)
            .Select(g => new { Date = g.Key, Count = g.Count() })
            .ToListAsync();
        var trendByDate = rawTrend.ToDictionary(x => x.Date, x => x.Count);
        var jobCardVolumeTrend = Enumerable.Range(0, 14)
            .Select(offset => trendSince.AddDays(offset))
            .Select(date => new { Date = date.ToString("yyyy-MM-dd"), Count = trendByDate.GetValueOrDefault(date, 0) })
            .ToList();

        var closedForTat = await jobCards
            .Where(j => j.Status == JobCardStatus.Closed && j.ClosedAt != null)
            .Select(j => new { DealerName = j.Dealer!.Name, j.CreatedAt, ClosedAt = j.ClosedAt!.Value })
            .ToListAsync();
        var avgTatByDealer = closedForTat
            .GroupBy(x => x.DealerName)
            .Select(g => new { DealerName = g.Key, AvgHours = Math.Round(g.Average(x => (x.ClosedAt - x.CreatedAt).TotalHours), 1) })
            .OrderByDescending(g => g.AvgHours)
            .ToList();

        var topPartsConsumption = await _db.JobCardParts.AsNoTracking()
            .Where(p => jobCardIds.Contains(p.JobCardId))
            .GroupBy(p => p.Part!.Name)
            .Select(g => new { PartName = g.Key, Qty = g.Sum(p => p.Quantity) })
            .OrderByDescending(g => g.Qty)
            .Take(10)
            .ToListAsync();

        var repeatComplaints = await jobCards
            .GroupBy(j => new { j.VehicleId, RegNo = j.Vehicle!.RegNo })
            .Where(g => g.Count() > 1)
            .Select(g => new { RegNo = g.Key.RegNo, Visits = g.Count() })
            .OrderByDescending(g => g.Visits)
            .Take(20)
            .ToListAsync();

        return Ok(new
        {
            revenue,
            warrantyCost,
            csat,
            pendingVehicles,
            jobCardVolumeByDealer,
            jobCardVolumeTrend,
            avgTatByDealer,
            topPartsConsumption,
            repeatComplaints,
        });
    }
}