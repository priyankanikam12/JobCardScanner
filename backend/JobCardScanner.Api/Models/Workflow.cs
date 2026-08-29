using System.ComponentModel.DataAnnotations;

namespace JobCardScanner.Api.Models;

/// <summary>
/// A single stage in the configurable workshop workflow (e.g. "Check-In", "Inspection",
/// "Estimate Approval", "In Repair", "Quality Check", "Ready for Delivery", "Closed").
/// <see cref="DealerId"/> null = a global default-template stage seeded for every dealer;
/// a dealer can add/reorder/deactivate their own stages by inserting rows with their DealerId set.
/// </summary>
public class WorkflowStage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    [Required, MaxLength(60)] public string StageKey { get; set; } = default!;
    [Required, MaxLength(120)] public string Label { get; set; } = default!;
    public int Seq { get; set; }
    [MaxLength(60)] public string? Icon { get; set; }
    [MaxLength(20)] public string? ColorHex { get; set; }
    public bool Active { get; set; } = true;
    /// <summary>True for stages that represent job-card closure (e.g. "Closed", "Cancelled").</summary>
    public bool IsTerminal { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
