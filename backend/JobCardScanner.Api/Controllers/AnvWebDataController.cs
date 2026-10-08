using JobCardScanner.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// ANVWeb (Ride EV) data API (2026-10-08, "ANVWeb is a Ride EV for MAGNEMITE MOTO LLP-Delhi, Chennai, Dombivli"): GET-only access to the Job Cards, Repair Bills and Material Transfers of
/// those three Magnemite locations only - and only ANV WEB'S OWN records: customer / party name containing "ANV WEB" ("ANV Web Ventures Private Limited"). Routes: /api/anvweb-data/dealers | jobcards | repair-bills | material-transfers.
/// Auth: X-API-Key header, compared with configuration "ApiKeys:ANVWeb" (503 until that key is configured). All behaviour is in MagnemitePartnerDataControllerBase.
///
/// DEALER SCOPE (INTERPRETATION - check with GET /api/anvweb-data/dealers): a dealer is in scope when its Name contains MAGNEMITE and one of the city keywords below - the dealers are named
/// like "MAGNEMITE MOTO LLP-DELHI". "DOMBIV" is deliberately a stem so DOMBIVLI / DOMBIVALI / DOMBIVILI all match. If a location is missing, or another dealer gets picked up by mistake,
/// change this list (or switch to BaplDmsDealerCode matching here) - nothing else needs to change.
/// </summary>
[ApiController]
[Route("api/anvweb-data")]
[AllowAnonymous]
public class AnvWebDataController : MagnemitePartnerDataControllerBase
{
    private static readonly string[] CityKeywords = { "DELHI", "CHENNAI", "DOMBIV" };

    public AnvWebDataController(JobCardScannerDbContext db, IConfiguration config, ILogger<AnvWebDataController> logger)
        : base(db, config, logger) { }

    protected override string ApiKeyConfigName => "ApiKeys:ANVWeb";
    protected override string PartnerName => "ANVWeb";

    // "ANV Web Ventures Private Limited" - matched on the stable part so spacing / suffix variations (Pvt Ltd) still match.
    protected override string CustomerNameKeyword => "ANV WEB";

    protected override bool IsDealerInScope(string dealerName, string? baplDealerCode) =>
        CityKeywords.Any(k => dealerName.Contains(k, StringComparison.OrdinalIgnoreCase));
}