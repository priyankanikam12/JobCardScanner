namespace JobCardScanner.Api.Models;

/// <summary>
/// 2026-10-17: what the Job Card page shows for ONE Care Desk ticket - a flat projection built in CareDeskService from the CareDesk database
/// (tickets joined to vehicles and customers). Not a table: nothing to migrate and nothing to add to JobCardScannerDbContext.
/// </summary>
public sealed class CareDeskTicketRow
{
    public string TicketNo { get; set; } = "";
    /// <summary>off_road / warranty / spare_parts.</summary>
    public string Category { get; set; } = "";
    /// <summary>new, acknowledged, awaiting_client_info, investigating, with_tech_cell, with_plant_repair, with_spd, dispatched, resolved_pending_confirmation, closed, auto_closed, info_not_received_closed, cancelled, with_warranty_desk, awaiting_client_action.</summary>
    public string Status { get; set; } = "";
    /// <summary>The escalation level E1..E4 the ticket is at.</summary>
    public string Level { get; set; } = "";
    public string CustomerName { get; set; } = "";
    public string Vin { get; set; } = "";
    public string? RegNo { get; set; }
    public string? Description { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LevelDueAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public bool IsRepeat { get; set; }
}