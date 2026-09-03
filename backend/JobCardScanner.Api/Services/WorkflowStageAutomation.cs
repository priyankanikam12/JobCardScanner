using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services;

/// <summary>
/// Auto-advances a job card's workflow stage from real actions elsewhere in the app, instead of
/// requiring a Service Advisor to manually pick a stage from a dropdown every time - per explicit
/// request: "Update Workflow Stage... dont want manual whole, only Assign Technician / Expected
/// Completion / Remarks stay manual, stage automatically update". The "Update Workflow Stage" panel
/// on the Job Card Detail page (web) no longer has a stage picker at all - see
/// JobCardDetailPage.tsx's UpdateWorkflowStageCard.
///
/// Call sites, one per stage that has an unambiguous system event to trigger on (the 8-step
/// pipeline - see the self-healing block in Program.cs for the full stage list):
///   - "in_repair"        - JobCardsController.StartWorklog (first technician worklog started)
///   - "part_suggestion"  - JobCardsController.AddPartSuggestion (first part suggested)
///   - "labour_suggestion"- JobCardsController.AddLabourSuggestion (first labour suggested)
///   - "estimate_created" - JobCardsController.AddPartSuggestion AND AddLabourSuggestion, each
///                          right after their own part_suggestion/labour_suggestion advance above
///                          (2026-09-03 - EITHER one means the Estimates Amount tab now has real
///                          content, i.e. an estimate genuinely exists; a job card commonly only
///                          ever gets one of the two, so this can't be gated on both). REPLACES the
///                          old trigger point, EstimatesController.Create (the "Send Estimate to
///                          Customer" OTP flow) - that flow's own UI was already removed from
///                          EstimatesCard (see its doc comment) in favor of reading Part/Labour
///                          Suggestions directly, which left "Estimate Created" with no way to ever
///                          actually fire even though Estimates Amount kept filling in - reported as
///                          "Estimate Created stage doesn't update after adding suggestions".
/// "check_in" is already set at job-card creation (Create's own stage-history seed) and
/// "invoice_generated" already happens from InvoiceCard's Generate Invoice action via the existing
/// ChangeStage endpoint - neither needed a new automatic trigger.
/// "repair_completed" and "ready_for_delivery" have no equivalent unambiguous system event
/// anywhere else in the app (nothing else currently means "the repair itself is physically done" or
/// "the vehicle is ready to hand back") - those two stay a single explicit action each (see
/// JobCardDetailPage.tsx's "Mark Repair Completed" / "Mark Ready for Delivery" buttons on the
/// Workflow Timeline card, which call ChangeStage directly with no dropdown involved).
/// </summary>
public static class WorkflowStageAutomation
{
    /// <summary>
    /// Advances <paramref name="jc"/>'s CurrentStage to <paramref name="stageKey"/> IF a matching,
    /// Active stage exists for this job card's dealer (dealer-specific override winning over the
    /// global template - same merge rule as WorkflowStagesController.List) AND that stage's Seq is
    /// strictly ahead of the job card's current stage. Never moves a job card BACKWARDS - e.g.
    /// re-adding a part suggestion after the job card has already reached Repair Completed does
    /// nothing, so this is always safe to call unconditionally from every add/create action above,
    /// not just the first one. Does NOT call SaveChangesAsync - the caller's own SaveChangesAsync
    /// (already happening right after the triggering action) persists this in the same round trip.
    /// </summary>
    public static async Task AdvanceIfAheadAsync(JobCardScannerDbContext db, JobCard jc, string stageKey, Guid? changedById, string notes)
    {
        var candidates = await db.WorkflowStages.AsNoTracking()
            .Where(s => s.StageKey == stageKey && (s.DealerId == null || s.DealerId == jc.DealerId) && s.Active)
            .ToListAsync();
        var target = candidates.OrderByDescending(s => s.DealerId.HasValue).FirstOrDefault();
        if (target is null) return; // Stage not seeded/active yet for this dealer - nothing to advance to.

        var currentSeq = jc.CurrentStageId is null
            ? -1
            : await db.WorkflowStages.AsNoTracking().Where(s => s.Id == jc.CurrentStageId).Select(s => (int?)s.Seq).FirstOrDefaultAsync() ?? -1;
        if (target.Seq <= currentSeq) return; // Already at or past this stage - never move backwards.

        var openHistory = await db.JobCardStageHistories
            .Where(h => h.JobCardId == jc.Id && h.ExitedAt == null)
            .OrderByDescending(h => h.EnteredAt)
            .FirstOrDefaultAsync();
        if (openHistory is not null) openHistory.ExitedAt = DateTime.UtcNow;

        db.JobCardStageHistories.Add(new JobCardStageHistory { JobCardId = jc.Id, StageId = target.Id, ChangedById = changedById, Notes = notes });
        jc.CurrentStageId = target.Id;
        jc.UpdatedAt = DateTime.UtcNow;

        // Mirrors JobCardsController.ChangeStage's own terminal-stage handling, in case a future
        // dealer-specific override ever marks one of these auto-triggered stages terminal.
        if (target.IsTerminal && jc.Status != JobCardStatus.Closed)
        {
            jc.Status = JobCardStatus.Closed;
            jc.ClosedAt = DateTime.UtcNow;
            jc.ActualDeliveryAt ??= DateTime.UtcNow;
        }
    }
}
