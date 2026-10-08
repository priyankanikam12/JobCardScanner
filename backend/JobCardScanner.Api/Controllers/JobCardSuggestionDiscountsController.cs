using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// Discount on a Job Card's Part Suggestion / Labour Suggestion lines (2026-10-07) - the same Discount Type / Discount Value idea Repair Bill and Material
/// Transfer already have. Kept in its own small controller (same "api/jobcards" route prefix) so JobCardsController is untouched; the Add / Update / Delete
/// endpoints there carry on exactly as before and the page sets the discount through these two calls:
///   PUT /api/jobcards/part-suggestions/{id}/discount     { discountType: "Percentage" | "Amount" | null, discountValue }
///   PUT /api/jobcards/labour-suggestions/{id}/discount   { discountType, discountValue }
/// The discount is stored on the suggestion row (columns added by sql/2026-10-07_jobcard_suggestion_discount.sql) and comes back with the job card
/// (Detail() returns the suggestion rows as they are), so no other endpoint changes. How it is USED - Estimates Amount = MRP (or Rate) x Qty less the discount,
/// an FOC line being 0 - is worked out on the Job Card page, the same way Repair Bill's lineEstimate does it.
/// Rules: a % discount is 0 - 100, a flat amount is not negative (the page also caps it at the line's gross); a closed job card can't be changed; a login that is
/// tied to a dealer can only touch its own dealer's job cards (CorporateAdmin / SystemAdmin: any).
/// </summary>
[ApiController]
[Route("api/jobcards")]
[Authorize(Policy = Policies.ServiceAdvisorUp)]
public class JobCardSuggestionDiscountsController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    private readonly ICurrentUserService _currentUser;
    private readonly IAuditLogService _audit;
    private readonly ILogger<JobCardSuggestionDiscountsController> _logger;

    public JobCardSuggestionDiscountsController(
        JobCardScannerDbContext db, ICurrentUserService currentUser, IAuditLogService audit, ILogger<JobCardSuggestionDiscountsController> logger)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _logger = logger;
    }

    /// <summary>DiscountType: "Percentage", "Amount", or null / "None" for no discount.</summary>
    public record SuggestionDiscountRequest(string? DiscountType, decimal DiscountValue);

    [HttpPut("part-suggestions/{suggestionId:guid}/discount")]
    public async Task<IActionResult> SetPartDiscount(Guid suggestionId, [FromBody] SuggestionDiscountRequest req, CancellationToken ct)
    {
        var suggestion = await _db.JobCardPartSuggestions.FirstOrDefaultAsync(x => x.Id == suggestionId, ct);
        if (suggestion is null) return NotFound(new { message = "That part suggestion no longer exists." });

        var gate = await CheckJobCardAsync(suggestion.JobCardId, ct);
        if (gate is not null) return gate;
        if (!TryNormalize(req, out var type, out var value, out var error)) return BadRequest(new { message = error });

        suggestion.DiscountType = type;
        suggestion.DiscountValue = value;
        return await SaveAsync("JobCardPartSuggestion.Discount", suggestion.Id, suggestion.ItemCode, type, value, ct,
            () => Ok(new { suggestion.Id, suggestion.DiscountType, suggestion.DiscountValue }));
    }

    [HttpPut("labour-suggestions/{suggestionId:guid}/discount")]
    public async Task<IActionResult> SetLabourDiscount(Guid suggestionId, [FromBody] SuggestionDiscountRequest req, CancellationToken ct)
    {
        var suggestion = await _db.JobCardLabourSuggestions.FirstOrDefaultAsync(x => x.Id == suggestionId, ct);
        if (suggestion is null) return NotFound(new { message = "That labour suggestion no longer exists." });

        var gate = await CheckJobCardAsync(suggestion.JobCardId, ct);
        if (gate is not null) return gate;
        if (!TryNormalize(req, out var type, out var value, out var error)) return BadRequest(new { message = error });

        suggestion.DiscountType = type;
        suggestion.DiscountValue = value;
        return await SaveAsync("JobCardLabourSuggestion.Discount", suggestion.Id, suggestion.LabourCode, type, value, ct,
            () => Ok(new { suggestion.Id, suggestion.DiscountType, suggestion.DiscountValue }));
    }

    /// <summary>The suggestion's job card must exist, not be closed / cancelled, and (for a dealer-tied login) belong to that login's own dealer.</summary>
    private async Task<IActionResult?> CheckJobCardAsync(Guid jobCardId, CancellationToken ct)
    {
        var jc = await _db.JobCards.AsNoTracking().Where(j => j.Id == jobCardId).Select(j => new { j.DealerId, j.Status }).FirstOrDefaultAsync(ct);
        if (jc is null) return NotFound(new { message = "That job card no longer exists." });

        var isOrgWide = _currentUser.Role is StaffRole.CorporateAdmin or StaffRole.SystemAdmin;
        if (!isOrgWide && jc.DealerId != _currentUser.DealerId)
            return NotFound(new { message = "That job card no longer exists." });   // 404, not 403 - don't reveal another dealer's job card

        if (jc.Status == JobCardStatus.Closed || jc.Status == JobCardStatus.Cancelled)
            return BadRequest(new { message = "This job card is closed - its estimate can no longer be changed." });
        return null;
    }

    private static bool TryNormalize(SuggestionDiscountRequest req, out string? type, out decimal value, out string error)
    {
        error = "";
        type = null;
        value = 0;

        var t = req.DiscountType?.Trim();
        if (string.IsNullOrEmpty(t) || t.Equals("None", StringComparison.OrdinalIgnoreCase))
            return true;                                   // no discount: type null, value 0

        if (t.Equals("Percentage", StringComparison.OrdinalIgnoreCase)) type = "Percentage";
        else if (t.Equals("Amount", StringComparison.OrdinalIgnoreCase)) type = "Amount";
        else { error = "Discount type must be Percentage or Amount."; return false; }

        if (req.DiscountValue < 0) { error = "Discount can't be negative."; return false; }
        if (type == "Percentage" && req.DiscountValue > 100) { error = "A percentage discount can't be more than 100."; return false; }

        value = Math.Round(req.DiscountValue, 2);
        return true;
    }

    private async Task<IActionResult> SaveAsync(string action, Guid id, string code, string? type, decimal value, CancellationToken ct, Func<IActionResult> ok)
    {
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // most likely the 2026-10-07 columns aren't there yet - say so instead of a bare HTTP 500
            _logger.LogError(ex, "Could not save the discount for suggestion {Id}", id);
            return StatusCode(500, new { message = $"Could not save the discount (has sql/2026-10-07_jobcard_suggestion_discount.sql been run?): {ex.GetBaseException().Message}" });
        }

        try { await _audit.LogAsync(action, "JobCardSuggestion", id.ToString(), new { code, type, value }); }
        catch (Exception ex) { _logger.LogWarning(ex, "Audit entry for {Action} could not be written.", action); }
        return ok();
    }
}