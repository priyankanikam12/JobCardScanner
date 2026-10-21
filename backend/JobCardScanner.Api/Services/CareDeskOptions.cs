namespace JobCardScanner.Api.Services;

/// <summary>
/// 2026-10-17: the "CareDesk" section of appsettings.json. The database itself is NOT here - its connection string is ConnectionStrings:CareDeskDb (same server as JobCardScannerDb, Database=CareDesk).
///   Enabled      false = the Care Desk endpoints answer "not set up" and never open the CareDesk database.
///   BaseUrl      the address of the Care Desk web app if one is running (shown by GET /api/care-desk/status; the web app has its own VITE_CARE_DESK_URL). May stay empty.
///   MaxTickets   most tickets returned for one vehicle (1..100).
/// </summary>
public sealed class CareDeskOptions
{
    public const string Section = "CareDesk";

    public bool Enabled { get; set; }
    public string BaseUrl { get; set; } = "";
    public int MaxTickets { get; set; } = 20;
}