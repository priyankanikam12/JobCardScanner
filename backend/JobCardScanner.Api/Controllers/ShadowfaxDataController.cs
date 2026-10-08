using JobCardScanner.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// Shadowfax data API (2026-10-08, "for Shadowfax all magnamite" / "only Shadowfax"): GET-only access to the Job Cards, Repair Bills and Material Transfers of EVERY Magnemite dealer - every Dealer whose
/// Name contains "MAGNEMITE" (any case), none excluded (unlike Zoho) - restricted to SHADOWFAX'S OWN records: customer / party name containing "SHADOWFAX" (see CustomerNameKeyword). Routes: /api/shadowfax-data/dealers | jobcards | repair-bills | material-transfers.
/// Auth: X-API-Key header, compared with configuration "ApiKeys:Shadowfax" (503 until that key is configured). All behaviour is in MagnemitePartnerDataControllerBase.
/// </summary>
[ApiController]
[Route("api/shadowfax-data")]
[AllowAnonymous]
public class ShadowfaxDataController : MagnemitePartnerDataControllerBase
{
    public ShadowfaxDataController(JobCardScannerDbContext db, IConfiguration config, ILogger<ShadowfaxDataController> logger)
        : base(db, config, logger) { }

    protected override string ApiKeyConfigName => "ApiKeys:Shadowfax";
    protected override string PartnerName => "Shadowfax";

    // INTERPRETATION: Shadowfax's legal name as recorded in BGauss was not given, so the match is on the brand word - any customer / party name containing SHADOWFAX (e.g. Shadowfax Technologies ...).
    protected override string CustomerNameKeyword => "SHADOWFAX";

    // every Magnemite dealer (the base already required "MAGNEMITE" in the name)
    protected override bool IsDealerInScope(string dealerName, string? baplDealerCode) => true;
}