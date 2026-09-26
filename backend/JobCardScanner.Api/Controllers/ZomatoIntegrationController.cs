using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using JobCardScanner.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

/// <summary>
/// 2026-09-26 ("for this 3 api i want share with Zomato to get and post data ... sharing on live
/// https://3.88.172.79 ... sharing this document with zomato team like i attached"). Mirrors the
/// existing ANV Web integration pattern (see the "AutoGeniusSync - Data API" document you
/// attached, X-API-Key header, no staff login) - I don't have that document's actual backing
/// controller in this session, so the API-key check below (CheckApiKey) is a fresh, self-contained
/// implementation of the same idea, not a copy of your real one. If your real ANV Web controller
/// already has a shared API-key-checking base class/attribute/middleware, tell me and I'll switch
/// this to reuse it instead of its own copy.
///
/// WHY A NEW CONTROLLER, NOT JobCardsController/RepairBillDocsController/MaterialTransferDocsController
/// DIRECTLY: those three are all [Authorize(Policy = Policies.Staff/ServiceAdvisorUp)] - gated by
/// your Azure AD/dealer staff login, which an external system like Zomato cannot use. This
/// controller has NO [Authorize] policy at all (see [AllowAnonymous] below) and instead checks the
/// X-API-Key header itself, exactly like the ANV Web integration.
///
/// SIX endpoints: POST create a job card, GET job card status, GET repair bills for Zomato, POST
/// create repair bills (BATCH), GET material transfers for Zomato, POST create material transfers
/// (BATCH). Both POSTs accept a JSON ARRAY of documents in one call, per your 2026-09-26
/// fourth-round "array/batch create" confirmation - each entry succeeds/fails independently; see
/// each action's own doc comment.
///
/// ============================================================================================
/// 2026-09-26 FOURTH ROUND:
///   - GetJobCardStatus enriched from the real JobCardDetailPage.tsx you pasted (odometer/battery/
///     customer/vehicle/Bapl-descriptive fields/assigned technician/complaints) - see that action's
///     own doc comment.
///   - Repair Bill POST added (reversing the earlier GET-only decision), confirmed via your answer
///     to my clarifying question this round.
///   - Both Material Transfer POST and the new Repair Bill POST are now BATCH endpoints (array in,
///     array of per-entry success/failure results out, one shared save) - confirmed via your
///     "array/batch create" answer. See CreateMaterialTransfers/CreateRepairBills' own doc comments
///     for the batch-safe stock-check redesign this required.
///
/// ============================================================================================
/// 2026-09-26 THIRD ROUND - rebuilt against the REAL backend controllers you pasted in full
/// (JobCardsController.cs, MaterialTransferDocsController.cs, RepairBillDocsController.cs),
/// resolving the two blockers flagged in README SECTION 105 and correcting two guesses that this
/// real code proved wrong:
///
///   1) BaplCouponNo - REMOVED from CreateJobCard/ZomatoCreateJobCardRequest entirely. The real
///      JobCardsController.Create() object initializer (the one you just pasted) does NOT
///      reference BaplCouponNo anywhere, even though JobCardWizardPage.tsx's real submit() DOES
///      send a baplCouponNo field. That's a genuinely unused/dead field on the real create flow -
///      matches your own words "have unused feilds also" - so it's dropped here rather than kept
///      as dead weight that looks like it does something but doesn't.
///   2) baplJobCategory - the same real Create() also never references this (also sent by the
///      wizard, also never wired to the entity) - CONFIRMED unused, not just "type unconfirmed" as
///      I'd flagged it before. Still not added here, now for a stronger reason: even if I knew its
///      type, wiring it in would still do nothing server-side.
///   3) baplServiceTypeId/baplServiceTypeName - these ARE wired into the real Create() (BaplServiceTypeId/
///      BaplServiceTypeName are set from the request), so unlike (1)/(2) this is a real, storable
///      field. NOT added here anyway - serviceCatalog.ts's own doc comment confirms its SERVICE_TYPES
///      catalog is "ORPHANED" (its ids point at an old Service Head list that no longer exists) and
///      the wizard no longer shows a Service Type picker at all, so there is no trustworthy real
///      catalog left to validate Zomato's input against. Flag me the current real Service Type list
///      (if BGauss still wants this field populated for Zomato jobs) and I'll wire it in properly.
///   4) DMS Vehicle Sale enrichment - IDmsBaplDataService.LookupVehicleForWizardAsync (real
///      signature now confirmed from DmsBaplDataService.cs) is now called, best-effort, to fill
///      VehicleModel/RegNo/BaplServiceLocation/BaplServiceLocationCode from BAPL's own Vehicle Sale
///      record for the chassis when Zomato doesn't send them - see CreateJobCard's own doc comment
///      below. A miss (chassis not in that table, or DMS unreachable) never blocks job card
///      creation, same "best-effort, never blocking" convention this app uses everywhere else it
///      touches DMS.
///   5) POST /api/zomato/material-transfers - built using the real CreateMaterialTransferRequest/
///      MaterialTransferDoc/MaterialTransferDocItem shapes and the confirmed
///      IJobCardNumberingService.NextMaterialTransferNumberAsync - see that action's own doc
///      comment for the full field-by-field mapping and the PartUploads stock-decrement logic
///      ported from MaterialTransferDocsController.ApplyStockAndBuildItemsAsync.
///   6) GET /api/zomato/repair-bills and GET /api/zomato/material-transfers - response shapes
///      enriched to match the real, fuller RepairBillDocsController.ToRow/MaterialTransferDocsController.ToRow
///      projections (JobCardId/JobCardNumber/PartyName/Remarks/ItemCount and the richer per-item
///      fields, e.g. HsnCode/RackNo/Bin/SerialNo/Mrp/ValidDays/ItemReceived/ItemType for Material
///      Transfer, DiscountType/DiscountValue/TaxableAmount/Cgst-Sgst-Igst Pct/IsUnderExtendedWarranty
///      for Repair Bill) - directly addressing your "have many missing feilds" note.
///   7) FIXED a real bug this round exposed: this file was missing `using JobCardScanner.Api.Services;`
///      even though its constructor already injected IJobCardNumberingService (declared in that
///      namespace, confirmed from every real controller above) - this would have been a CS0246
///      ("type or namespace not found") the moment you compiled, on top of anything else. Added now.
///
/// STILL OPEN, NOT YET RESOLVED (flagging rather than guessing a second time):
///   - JobTypeId/ServiceHeadId are still REQUIRED here (your explicit "Replicate the real
///     validations server-side" answer). The real JobCardsController.Create() you just pasted
///     shows these are actually now OPTIONAL for staff (the 2026-09-24 change that removed DMS
///     write-back also dropped the requirement - only the wizard's OWN client-side
///     serviceDetailsValid gate still enforces them). I have NOT silently loosened Zomato's
///     validation to match - tell me whether Zomato should also be allowed to omit these two, or
///     whether keeping them mandatory for an external partner (even though staff no longer must
///     supply them) is what you actually want.
///   - "Zomato:SystemUserId" is still a config value I introduced myself, unrelated to the shared
///     "ApiKeys" section - still needs a real User row + its Id in config (see README SECTION 102).
/// </summary>
[ApiController]
[Route("api/zomato")]
[AllowAnonymous]
public class ZomatoIntegrationController : ControllerBase
{
    /// <summary>2026-09-26 ("Replicate the real validations server-side"): the SAME Job
    /// Type -> Service Head catalog the staff wizard uses (web/src/data/serviceCatalog.ts),
    /// transcribed here so this API can validate Zomato's JobTypeId/ServiceHeadId the same way the
    /// wizard's own serviceDetailsValid gate does. FACT, cross-checked directly against
    /// serviceCatalog.ts's real JOB_TYPES/SERVICE_HEADS arrays this round (previously only
    /// confirmed via README SECTION 97's transcription of your words - now confirmed against the
    /// real source file itself, unchanged). If this catalog is ever edited on the web side, update
    /// it here too - there is no shared source of truth between the frontend TS file and this
    /// backend copy.</summary>
    private static readonly (int Id, string Name)[] JobTypes =
    {
        (1, "Accidental"), (2, "Major"), (3, "Minor"), (4, "Running Repair"),
    };
    private static readonly (int Id, string Name, int JobTypeId)[] ServiceHeads =
    {
        (1, "Accidental", 1), (2, "M1", 2), (3, "M2", 2), (4, "D1", 3), (5, "D2", 3), (6, "Running Repair", 4),
    };

    private readonly JobCardScannerDbContext _db;
    private readonly IJobCardNumberingService _numbering;
    private readonly IDmsBaplDataService _dmsBaplData;
    private readonly IConfiguration _config;
    private readonly ILogger<ZomatoIntegrationController> _logger;

    public ZomatoIntegrationController(
        JobCardScannerDbContext db, IJobCardNumberingService numbering, IDmsBaplDataService dmsBaplData,
        IConfiguration config, ILogger<ZomatoIntegrationController> logger)
    {
        _db = db;
        _numbering = numbering;
        _dmsBaplData = dmsBaplData;
        _config = config;
        _logger = logger;
    }

    /// <summary>Checks the X-API-Key header against configuration key "ApiKeys:Zomato". Returns
    /// null when valid, or the 401/503 response to return when it isn't - so every action just does
    /// `var authFail = CheckApiKey(); if (authFail is not null) return authFail;` as its first
    /// line, same shape as JobCardsController's RequireAssignedTechnician gate.
    ///
    /// Real config (from your pasted appsettings.json): ONE shared "ApiKeys" section keyed by
    /// partner name - "Shadowfax"/"Internal"/"Zomato"/"ANVWeb"/"Cogzim" all live under it together.
    /// Reading `_config["ApiKeys:Zomato"]` matches that.</summary>
    private IActionResult? CheckApiKey()
    {
        var configuredKey = _config["ApiKeys:Zomato"];
        if (string.IsNullOrWhiteSpace(configuredKey))
        {
            _logger.LogWarning("Zomato API called but ApiKeys:Zomato is not configured - refusing every request until it is set.");
            return StatusCode(503, new { message = "This integration is not yet configured." });
        }
        if (!Request.Headers.TryGetValue("X-API-Key", out var providedKey) || providedKey != configuredKey)
            return Unauthorized(new { message = "Missing or invalid X-API-Key." });
        return null;
    }

    /// <summary>Resolves "Zomato:SystemUserId" from configuration - the Users.Id every Zomato-created
    /// row (JobCard.CreatedById, MaterialTransferDoc.CreatedById) is attributed to, since there's no
    /// signed-in staff user behind an API call. Returns null (with the 503 response to return) when
    /// it isn't configured yet - same "not yet configured" convention as CheckApiKey above.</summary>
    private (Guid? SystemUserId, IActionResult? Error) GetSystemUserId()
    {
        var raw = _config["Zomato:SystemUserId"];
        if (string.IsNullOrWhiteSpace(raw) || !Guid.TryParse(raw, out var id))
            return (null, StatusCode(503, new { message = "This integration is not yet configured (Zomato:SystemUserId)." }));
        return (id, null);
    }

    /// <summary>
    /// POST /api/zomato/jobcards - Zomato drops off a fleet vehicle for service; this opens a
    /// JobCardScanner job card for it. UNLIKE the staff-facing Job Card Wizard (JobCardsController.
    /// Create), which already has a signed-in ServiceAdvisor picking an existing Customer/Vehicle
    /// from this app's own records, Zomato's system only knows about ITS OWN vehicle/fleet data -
    /// so this endpoint resolves-or-creates the Customer and Vehicle rows itself, from whatever
    /// Zomato sends, rather than requiring Zomato to already know JobCardScanner's internal GUIDs.
    ///
    /// ASSUMPTIONS (flagged, see README SECTION 102 for the full original list):
    ///   - Dealer is resolved by DealerCode (Dealers.Code, already a unique column).
    ///   - Customer is looked up by (DealerId, Mobile); if none exists, one is created from
    ///     CustomerName/CustomerMobile/CustomerEmail as sent.
    ///   - Vehicle is looked up by (DealerId, ChassisNo i.e. Vin); if none exists, one is created
    ///     from VehicleModel/RegNo/ChassisNo/OdometerAtCheckIn as sent - now with a best-effort DMS
    ///     fallback, see below.
    ///   - The same "one open job card per chassis per dealer" rule as the staff wizard is enforced
    ///     here too.
    ///   - ServiceType defaults to PaidService, Priority to Normal, Source is left unset (see the
    ///     inline comment on the JobCard initializer below - still an open item, real JobCardSource
    ///     enum member names have never been confirmed in this session).
    ///
    /// NEW THIS ROUND - best-effort DMS Vehicle Sale enrichment ("worklocation chassis no and reg
    /// no use from vehicle sale which we data fetch" - the same real BaplConnection.DMS_SaleBill
    /// lookup JobCardWizardPage.tsx itself uses via IDmsBaplDataService.LookupVehicleForWizardAsync,
    /// real signature now confirmed): looked up by (ChassisNo, DealerCode) BEFORE the Vehicle
    /// row is resolved-or-created. When a match is found:
    ///   - VehicleModel falls back to the DMS row's ItemModel (or Oemmodel if ItemModel is blank)
    ///     when Zomato didn't send one.
    ///   - RegNo falls back to the DMS row's RegNo when Zomato didn't send one.
    ///   - BaplServiceLocation/BaplServiceLocationCode are set from the DMS row's Location/LocCode -
    ///     these are real, wired fields on JobCard (confirmed from the real Create() you pasted),
    ///     previously left blank here because there was no way to resolve them without this lookup.
    /// A miss (chassis not in DMS_SaleBill - e.g. a used/pre-owned vehicle DMS never invoiced, or a
    /// transient DMS problem) is NOT an error and never blocks job card creation - the same
    /// best-effort convention every other DMS read in this app already follows (GetOpenJobCardForChassisAsync
    /// in the staff wizard's own Create(), for example). BaplCustomerLedgerId is NOT populated from
    /// this lookup - the wizard sources that from a DIFFERENT field (baplVehicleHit?.customerLedgerId)
    /// this session has not seen wired up anywhere, and in any case the real Create() doesn't even
    /// reference BaplCustomerLedgerId on the entity (same "confirmed unused" story as BaplCouponNo/
    /// baplJobCategory - see this controller's class-level doc comment).
    /// </summary>
    [HttpPost("jobcards")]
    public async Task<IActionResult> CreateJobCard(ZomatoCreateJobCardRequest req)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        if (string.IsNullOrWhiteSpace(req.DealerCode)) return BadRequest(new { message = "dealerCode is required." });
        if (string.IsNullOrWhiteSpace(req.ChassisNo)) return BadRequest(new { message = "chassisNo is required." });
        if (string.IsNullOrWhiteSpace(req.CustomerName)) return BadRequest(new { message = "customerName is required." });
        if (string.IsNullOrWhiteSpace(req.CustomerMobile)) return BadRequest(new { message = "customerMobile is required." });

        // 2026-09-26 ("Replicate the real validations server-side"): mirrors the wizard's own
        // serviceDetailsValid gate (JobCardWizardPage.tsx) - Job Type + a matching Service Head +
        // at least one complaint are REQUIRED here, validated against the same catalog (see
        // JobTypes/ServiceHeads above). NOTE (new this round): the real JobCardsController.Create()
        // no longer requires these for staff (2026-09-24 change) - see this controller's own
        // class-level doc comment ("STILL OPEN") for why this hasn't been relaxed for Zomato without
        // asking first.
        var jobType = JobTypes.FirstOrDefault(t => t.Id == req.JobTypeId);
        if (jobType == default) return BadRequest(new { message = $"jobTypeId {req.JobTypeId} is not a valid Job Type. Valid ids: {string.Join(", ", JobTypes.Select(t => $"{t.Id}={t.Name}"))}." });
        var serviceHead = ServiceHeads.FirstOrDefault(h => h.Id == req.ServiceHeadId);
        if (serviceHead == default || serviceHead.JobTypeId != jobType.Id)
            return BadRequest(new { message = $"serviceHeadId {req.ServiceHeadId} is not a valid Service Head for Job Type '{jobType.Name}'. Valid ids for this Job Type: {string.Join(", ", ServiceHeads.Where(h => h.JobTypeId == jobType.Id).Select(h => $"{h.Id}={h.Name}"))}." });
        var complaintList = (req.Complaints ?? new List<string>()).Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c.Trim()).ToList();
        if (!string.IsNullOrWhiteSpace(req.ComplaintDescription)) complaintList.Add(req.ComplaintDescription.Trim()); // back-compat with the single-complaint shape this endpoint originally shipped with
        if (complaintList.Count == 0) return BadRequest(new { message = "At least one complaint is required (complaints: [\"...\"])." });

        var (systemUserId, systemUserError) = GetSystemUserId();
        if (systemUserError is not null) return systemUserError;

        var dealer = await _db.Dealers.AsNoTracking().FirstOrDefaultAsync(d => d.Code == req.DealerCode);
        if (dealer is null) return BadRequest(new { message = $"No dealer found for dealerCode '{req.DealerCode}'." });

        // Best-effort DMS Vehicle Sale lookup - see this action's own doc comment above. Never
        // blocks creation on a miss or a DMS outage.
        DmsBaplDataVehicleSaleRow? dmsVehicleSale = null;
        try
        {
            dmsVehicleSale = await _dmsBaplData.LookupVehicleForWizardAsync(req.ChassisNo, req.DealerCode, HttpContext.RequestAborted);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Zomato CreateJobCard: could not look up chassis {ChassisNo} in BAPL DMS Vehicle Sale data - proceeding without this enrichment", req.ChassisNo);
        }

        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.DealerId == dealer.Id && c.Mobile == req.CustomerMobile);
        if (customer is null)
        {
            customer = new Customer
            {
                DealerId = dealer.Id,
                Name = req.CustomerName.Trim(),
                Mobile = req.CustomerMobile.Trim(),
                Email = req.CustomerEmail,
            };
            _db.Customers.Add(customer);
            await _db.SaveChangesAsync();
        }

        var vehicle = await _db.Vehicles.FirstOrDefaultAsync(v => v.DealerId == dealer.Id && v.Vin == req.ChassisNo);
        if (vehicle is null)
        {
            var modelFallback = dmsVehicleSale?.ItemModel ?? dmsVehicleSale?.Oemmodel;
            vehicle = new Vehicle
            {
                DealerId = dealer.Id,
                CustomerId = customer.Id,
                Model = !string.IsNullOrWhiteSpace(req.VehicleModel) ? req.VehicleModel
                    : !string.IsNullOrWhiteSpace(modelFallback) ? modelFallback
                    : "Unknown",
                RegNo = !string.IsNullOrWhiteSpace(req.RegNo) ? req.RegNo : dmsVehicleSale?.RegNo,
                Vin = req.ChassisNo,
                Odometer = req.OdometerAtCheckIn,
            };
            _db.Vehicles.Add(vehicle);
            await _db.SaveChangesAsync();
        }

        var openJobCardForChassis = await _db.JobCards.AsNoTracking()
            .Where(j => j.DealerId == dealer.Id && j.Status != JobCardStatus.Closed)
            .Where(j => j.VehicleId == vehicle.Id || j.Vehicle!.Vin == req.ChassisNo)
            .Select(j => j.JobCardNumber)
            .FirstOrDefaultAsync();
        if (openJobCardForChassis is not null)
            return BadRequest(new { message = $"This chassis already has an open job card ({openJobCardForChassis})." });

        var firstStage = await _db.WorkflowStages.AsNoTracking()
            .Where(s => (s.DealerId == null || s.DealerId == dealer.Id) && s.Active)
            .OrderBy(s => s.Seq).FirstOrDefaultAsync();

        var jobCard = new JobCard
        {
            JobCardNumber = await _numbering.NextJobCardNumberAsync(dealer.Id),
            DealerId = dealer.Id,
            CustomerId = customer.Id,
            VehicleId = vehicle.Id,
            ServiceType = ServiceType.PaidService, // ASSUMPTION - see doc comment above
            // Source: DELIBERATELY NOT SET - still unconfirmed, see this controller's class-level
            // doc comment. Leaving this unset means EF/C# uses the enum's default underlying value
            // (0), whatever your first-declared JobCardSource member is, rather than a made-up one.
            Priority = JobCardPriority.Normal,       // ASSUMPTION
            OdometerAtCheckIn = req.OdometerAtCheckIn,
            BatteryLevelAtCheckIn = req.BatteryLevelAtCheckIn,
            ExpectedDeliveryAt = req.ExpectedDeliveryAt,
            CustomerConsentNotes = req.CustomerConsentNotes,
            BaplJobType = jobType.Name,
            BaplJobTypeId = jobType.Id,
            BaplServiceHeadId = serviceHead.Id,
            BaplServiceHeadName = serviceHead.Name,
            BaplManualJobNo = req.BaplManualJobNo,
            // NEW this round - real, wired fields (confirmed from the real Create() you pasted),
            // filled from the best-effort DMS Vehicle Sale lookup above when it found a match. Left
            // null on a miss, same as before this lookup existed.
            BaplServiceLocation = dmsVehicleSale?.Location,
            BaplServiceLocationCode = dmsVehicleSale?.LocCode,
            // BaplCouponNo/baplJobCategory: REMOVED/NOT ADDED - CONFIRMED unused by the real
            // Create() method even though the wizard's frontend sends both. See this controller's
            // class-level doc comment, items (1)/(2).
            // BaplServiceTypeId/BaplServiceTypeName: NOT ADDED - real, wired fields, but the only
            // catalog to validate against (serviceCatalog.ts's SERVICE_TYPES) is confirmed orphaned/
            // stale. See this controller's class-level doc comment, item (3).
            Status = JobCardStatus.Open,
            CurrentStageId = firstStage?.Id,
            CreatedById = systemUserId!.Value,
        };
        foreach (var complaintText in complaintList)
            jobCard.Complaints.Add(new JobCardComplaint { Description = complaintText, IsCustomerVoice = true });

        _db.JobCards.Add(jobCard);
        await _db.SaveChangesAsync();
        if (firstStage is not null)
            _db.JobCardStageHistories.Add(new JobCardStageHistory { JobCardId = jobCard.Id, StageId = firstStage.Id, ChangedById = systemUserId.Value });
        vehicle.Odometer = Math.Max(vehicle.Odometer, req.OdometerAtCheckIn);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Zomato API created job card {JobCardNumber} for chassis {ChassisNo} at dealer {DealerCode}", jobCard.JobCardNumber, req.ChassisNo, req.DealerCode);

        return Ok(new ZomatoJobCardResponse(jobCard.JobCardNumber, jobCard.Status.ToString(), jobCard.TrackingToken, jobCard.CreatedAt));
    }

    /// <summary>GET /api/zomato/jobcards/status?jobCardNumber= - status lookup by the JobCardNumber
    /// returned from the create call above. No dealer/party scoping - a job card number is already
    /// unique and effectively unguessable in bulk, same trust level the existing customer-facing
    /// /track/:token page already gives out with no login at all.
    ///
    /// FIXED 2026-09-26 FIFTH ROUND - real routing bug, found from your own real JobCards data dump
    /// (job card numbers like "JC/288/26-27/0011"): this was originally a ROUTE-SEGMENT parameter -
    /// GET /api/zomato/jobcards/{jobCardNumber} - which only ever works for a value with NO "/" in
    /// it. A real BGauss job card number always HAS slashes (JC/{dealerCode}/{FY}/{seq}, confirmed
    /// from your own data), so ASP.NET Core's router would try to match "JC", "288", "26-27" and
    /// "0011" as four separate path segments against a template that only declares one - the route
    /// simply wouldn't match at all, and every real lookup would 404 before ever reaching this
    /// action. URL-encoding the slashes (%2F) does not reliably fix this either - Kestrel decodes
    /// %2F before routing by default, landing back in the same problem. Moved jobCardNumber to a
    /// QUERY STRING parameter instead (new path: jobcards/status?jobCardNumber=...) - query values
    /// are never split into route segments, so a value containing "/" works exactly as sent. This
    /// is a breaking change to this one endpoint's URL shape; nothing else about it (response
    /// shape, auth) changed. Given this was never actually exercised against a real slash-bearing
    /// job card number before now, I'd also double-check Create Job Card's own route
    /// (jobcards, no path parameter - unaffected) and the 404 error message format elsewhere in
    /// this controller for the same class of mistake; I didn't find another instance, but flagging
    /// the reasoning in case a similar pattern gets copied elsewhere later.
    ///
    /// ENRICHED 2026-09-26 FOURTH ROUND ("which are we update in JobCardDetailPage.tsx that
    /// details not added in api that also add"): cross-checked against the real
    /// JobCardDetailPage.tsx you pasted (its `jc.*` field references) - previously this only
    /// returned the 4-5 status/date fields above. Now also returns the job's own
    /// odometerAtCheckIn/batteryLevelAtCheckIn, customer name/mobile, vehicle model/regNo/
    /// chassisNo, the Bapl* descriptive fields (jobType/serviceHeadName/serviceLocation/
    /// serviceLocationCode/manualJobNo), assignedTechnicianName, and the complaint list - all
    /// real, confirmed fields the detail page itself displays. Deliberately NOT included:
    /// partSuggestions/labourSuggestions/worklogs/inspections/qcChecklistItems/photos/stageHistory
    /// - these are internal workshop/billing detail (parts fitted, labour logged, QC checklist
    /// answers, uploaded photos) with no obvious use for an external partner just tracking a
    /// job's overall status, and returning them would mean exposing your dealer's part/labour
    /// pricing to Zomato through a side door - tell me if Zomato specifically needs one of these
    /// and I'll add it deliberately rather than everything at once.</summary>
    [HttpGet("jobcards/status")]
    public async Task<IActionResult> GetJobCardStatus([FromQuery] string jobCardNumber)
    {
        if (string.IsNullOrWhiteSpace(jobCardNumber)) return BadRequest(new { message = "jobCardNumber is required." });

        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var jc = await _db.JobCards.AsNoTracking()
            .Include(j => j.CurrentStage)
            .Include(j => j.Customer)
            .Include(j => j.Vehicle)
            .Include(j => j.Complaints)
            .Where(j => j.JobCardNumber == jobCardNumber)
            .Select(j => new
            {
                j.JobCardNumber,
                Status = j.Status.ToString(),
                StageLabel = j.CurrentStage != null ? j.CurrentStage.Label : null,
                j.CreatedAt,
                j.ExpectedDeliveryAt,
                j.ActualDeliveryAt,
                j.ClosedAt,
                j.OdometerAtCheckIn,
                j.BatteryLevelAtCheckIn,
                CustomerName = j.Customer != null ? j.Customer.Name : null,
                CustomerMobile = j.Customer != null ? j.Customer.Mobile : null,
                VehicleModel = j.Vehicle != null ? j.Vehicle.Model : null,
                RegNo = j.Vehicle != null ? j.Vehicle.RegNo : null,
                ChassisNo = j.Vehicle != null ? j.Vehicle.Vin : null,
                j.BaplJobType,
                j.BaplServiceHeadName,
                j.BaplServiceLocation,
                j.BaplServiceLocationCode,
                j.BaplManualJobNo,
                j.AssignedTechnicianName,
                Complaints = j.Complaints.Select(c => c.Description),
            })
            .FirstOrDefaultAsync();

        return jc is null ? NotFound(new { message = $"No job card '{jobCardNumber}'." }) : Ok(jc);
    }

    /// <summary>GET /api/zomato/repair-bills?from=&amp;to= - this app's own JobCardScannerDb-native
    /// repair bills where a staff member typed PartyName as exactly "Zomato" (case-sensitive match,
    /// same as RepairBillDocsController's own default `party = "Zomato"` filter on its staff-facing
    /// Combined endpoint). Does NOT include the DMSBAPLDATA-synced rows that endpoint also blends
    /// in for staff. No dealer scoping - Zomato's fleet spans dealers.
    ///
    /// ENRICHED 2026-09-26 THIRD ROUND ("still have many missing feilds"): now matches the real,
    /// fuller RepairBillDocsController.ToRow projection - JobCardId/JobCardNumber/PartyName/Remarks/
    /// InsuranceCompanyName/InsuranceDescription/SurveyorName/SurveyorContactNumber/PolicyNo/
    /// InsuranceValidTill/ZeroDepreciation/TotalDiscount/AmountReceived/ItemCount added at the bill
    /// level, and ItemType/HsnCode/IssueType/DiscountType/DiscountValue/Cgst-Sgst-Igst Pct/
    /// ExtendedBatteryWarrantySchemeId/IsUnderExtendedWarranty added per item - previously this
    /// endpoint returned a much thinner subset of the real fields.</summary>
    [HttpGet("repair-bills")]
    public async Task<IActionResult> RepairBills([FromQuery] DateOnly? from, [FromQuery] DateOnly? to)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var query = _db.RepairBillDocs.AsNoTracking().Where(r => !r.IsDeleted && r.PartyName == "Zomato");
        if (from is not null) query = query.Where(r => r.BillDate >= from);
        if (to is not null) query = query.Where(r => r.BillDate <= to);

        var bills = await query.Include(r => r.Items).Include(r => r.JobCard).OrderByDescending(r => r.BillDate).Take(500).ToListAsync();

        return Ok(bills.Select(ToZomatoRepairBillRow));
    }

    /// <summary>GET /api/zomato/material-transfers?from=&amp;to= - same reasoning as RepairBills
    /// above, matched against MaterialTransferDoc's own PartyName field.
    ///
    /// ENRICHED 2026-09-26 THIRD ROUND - same reasoning as RepairBills above: now matches the real,
    /// fuller MaterialTransferDocsController.ToRow projection - JobCardId/JobCardNumber/PartyName/
    /// TechnicianId/Remarks/ItemCount added at the document level, and HsnCode/IssueType/RackNo/Bin/
    /// SerialNo/Mrp/ValidDays/ItemReceived/ItemType added per item.</summary>
    [HttpGet("material-transfers")]
    public async Task<IActionResult> MaterialTransfers([FromQuery] DateOnly? from, [FromQuery] DateOnly? to)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;

        var query = _db.MaterialTransferDocs.AsNoTracking().Where(m => m.PartyName == "Zomato");
        if (from is not null) query = query.Where(m => m.TransferDate >= from);
        if (to is not null) query = query.Where(m => m.TransferDate <= to);

        var docs = await query.Include(m => m.Items).Include(m => m.JobCard).OrderByDescending(m => m.TransferDate).Take(500).ToListAsync();

        return Ok(docs.Select(ToZomatoMaterialTransferRow));
    }

    /// <summary>
    /// POST /api/zomato/material-transfers - BATCH create, per your 2026-09-26 fourth-round
    /// confirmation ("array/batch create" - Zomato sends a list of documents in one call). Built
    /// against the real CreateMaterialTransferRequest/MaterialTransferDoc/MaterialTransferDocItem
    /// shapes and the confirmed IJobCardNumberingService.NextMaterialTransferNumberAsync(dealerId)
    /// from the real MaterialTransferDocsController.cs you pasted.
    ///
    /// Accepts a JSON ARRAY of ZomatoCreateMaterialTransferRequest (the same single-document shape
    /// built last round, just wrapped in a list now). Each entry is validated and its stock need
    /// checked INDEPENDENTLY - one bad entry (unknown job card, insufficient stock) does NOT fail
    /// the whole batch. The response is an array of per-entry results in the same order as the
    /// request, each tagged success/failure with an index and the echoed jobCardNumber so Zomato
    /// can tell exactly which of its documents went through. All successful entries are saved
    /// together in one SaveChangesAsync call at the end.
    ///
    /// FIELD MAPPING / DESIGN CHOICES - unchanged from the single-document version built last
    /// round (jobCardNumber resolves to JobCardId server-side; partyName always forced to
    /// "Zomato"; location falls back to the job card's own BaplServiceLocationCode; technicianId
    /// always null; transferType defaults to Issue; item itemType defaults to Part; createdById
    /// reuses "Zomato:SystemUserId").
    ///
    /// STOCK-CHECK REDESIGN FOR BATCHING (INTERPRETATION - a correctness fix this batch shape
    /// specifically needs, not present in the real single-document controller because it doesn't
    /// need it): the real MaterialTransferDocsController.ApplyStockAndBuildItemsAsync validates and
    /// mutates PartUploads.BalQty in the SAME pass, per item - safe there because a failure 400s
    /// the whole request before SaveChangesAsync ever runs, so nothing partial is ever persisted.
    /// A batch sharing ONE DbContext and ONE SaveChangesAsync across many documents can't rely on
    /// that: if document #2 failed validation after already decrementing (in-memory) two of its
    /// three lines against a PartUploads row also used by document #1, that partial decrement would
    /// still get persisted when #1's (successful) save goes through, even though #2 itself was
    /// discarded. ApplyStockAndBuildItemsAsync below instead validates a document's ENTIRE stock
    /// need (summed per Item Code, across that one document) before mutating anything for it -
    /// nothing is decremented until the whole document is confirmed valid. Two documents in the
    /// same batch drawing on the same part still correctly see each other's cumulative usage
    /// (same tracked PartUploads row, same DbContext) - only a REJECTED document's partial usage is
    /// prevented from leaking through.
    /// </summary>
    [HttpPost("material-transfers")]
    public async Task<IActionResult> CreateMaterialTransfers(List<ZomatoCreateMaterialTransferRequest> requests)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;
        if (requests is null || requests.Count == 0) return BadRequest(new { message = "Send at least one material transfer document (a JSON array)." });

        var (systemUserId, systemUserError) = GetSystemUserId();
        if (systemUserError is not null) return systemUserError;

        var results = new List<object>();
        var successCount = 0;
        for (var i = 0; i < requests.Count; i++)
        {
            var req = requests[i];
            if (string.IsNullOrWhiteSpace(req.JobCardNumber))
            {
                results.Add(new { index = i, jobCardNumber = req.JobCardNumber, success = false, error = "jobCardNumber is required." });
                continue;
            }
            if (req.Items is null || req.Items.Count == 0)
            {
                results.Add(new { index = i, jobCardNumber = req.JobCardNumber, success = false, error = "Add at least one item line." });
                continue;
            }

            var jobCard = await _db.JobCards.FirstOrDefaultAsync(j => j.JobCardNumber == req.JobCardNumber);
            if (jobCard is null)
            {
                results.Add(new { index = i, jobCardNumber = req.JobCardNumber, success = false, error = $"No job card '{req.JobCardNumber}'." });
                continue;
            }

            var doc = new MaterialTransferDoc
            {
                DealerId = jobCard.DealerId,
                TransferNumber = await _numbering.NextMaterialTransferNumberAsync(jobCard.DealerId),
                JobCardId = jobCard.Id,
                Location = !string.IsNullOrWhiteSpace(req.Location) ? req.Location : jobCard.BaplServiceLocationCode,
                TransferType = req.TransferType ?? MaterialTransferDocType.Issue,
                IssueType = req.IssueType,
                PartyName = "Zomato", // ALWAYS forced - see this action's doc comment above
                TechnicianId = null,
                Remarks = req.Remarks,
                TransferDate = req.TransferDate ?? DateOnly.FromDateTime(DateTime.UtcNow),
                CreatedById = systemUserId!.Value,
                Status = MaterialTransferDocStatus.Draft,
            };

            var stockError = await ApplyStockAndBuildItemsAsync(doc, req.Items, jobCard.DealerId);
            if (stockError is not null)
            {
                results.Add(new { index = i, jobCardNumber = req.JobCardNumber, success = false, error = stockError });
                continue;
            }

            _db.MaterialTransferDocs.Add(doc);
            successCount++;
            results.Add(new { index = i, jobCardNumber = req.JobCardNumber, success = true, error = (string?)null, transfer = ToZomatoMaterialTransferRow(doc, req.JobCardNumber) });
        }

        await _db.SaveChangesAsync();
        _logger.LogInformation("Zomato API batch-created {SuccessCount}/{TotalCount} material transfers", successCount, requests.Count);

        return Ok(results);
    }

    /// <summary>Ported from MaterialTransferDocsController.ApplyStockAndBuildItemsAsync (real,
    /// pasted source) - same MaterialTransferDocItem construction and TotalAmount rollup, but with
    /// its PartUploads.BalQty check REDESIGNED for safe batching - see CreateMaterialTransfers'
    /// own doc comment above ("STOCK-CHECK REDESIGN FOR BATCHING") for exactly why and how this
    /// differs from the real controller's single-pass validate-and-mutate loop.</summary>
    private async Task<string?> ApplyStockAndBuildItemsAsync(MaterialTransferDoc doc, List<ZomatoMaterialTransferItemRequest> items, Guid dealerId)
    {
        if (!string.IsNullOrWhiteSpace(doc.Location))
        {
            var partUploadCache = new Dictionary<string, PartUpload>(StringComparer.OrdinalIgnoreCase);
            foreach (var it in items)
            {
                if ((it.ItemType ?? MaterialTransferDocItemType.Part) != MaterialTransferDocItemType.Part) continue;
                if (string.IsNullOrWhiteSpace(it.ItemCode) || partUploadCache.ContainsKey(it.ItemCode)) continue;
                var pu = await _db.PartUploads.FirstOrDefaultAsync(
                    p => p.DealerId == dealerId && p.LocationCode == doc.Location && p.PartNo == it.ItemCode, HttpContext.RequestAborted);
                if (pu is not null) partUploadCache[it.ItemCode] = pu;
            }

            // Validate this document's WHOLE stock need (summed per Item Code) before mutating
            // anything - see this method's own doc comment.
            var requestedByCode = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            foreach (var it in items)
            {
                if ((it.ItemType ?? MaterialTransferDocItemType.Part) != MaterialTransferDocItemType.Part) continue;
                if (!partUploadCache.ContainsKey(it.ItemCode)) continue;
                requestedByCode[it.ItemCode] = requestedByCode.GetValueOrDefault(it.ItemCode) + (decimal)it.Qty;
            }
            foreach (var (code, requestedQty) in requestedByCode)
            {
                var available = partUploadCache[code].BalQty ?? 0;
                if (requestedQty > available)
                    return $"Insufficient Part Upload stock for '{code}' at this location: available {available}, requested {requestedQty}.";
            }
            // Only now safe to mutate - every code above has enough stock for this document's own total need.
            foreach (var (code, requestedQty) in requestedByCode)
                partUploadCache[code].BalQty = (partUploadCache[code].BalQty ?? 0) - requestedQty;
        }

        foreach (var it in items)
        {
            var amount = (decimal)it.Qty * it.Rate;
            doc.Items.Add(new MaterialTransferDocItem
            {
                ItemCode = it.ItemCode,
                ItemDescription = it.ItemDescription,
                HsnCode = it.HsnCode,
                IssueType = it.IssueType,
                Qty = it.Qty,
                Rate = it.Rate,
                Amount = amount,
                RackNo = it.RackNo,
                Bin = it.Bin,
                SerialNo = it.SerialNo,
                Mrp = it.Mrp,
                ValidDays = it.ValidDays,
                ItemReceived = it.ItemReceived,
                ItemType = it.ItemType ?? MaterialTransferDocItemType.Part,
                TechnicianId = null,
            });
        }
        doc.TotalAmount = doc.Items.Sum(i => i.Amount);

        return null;
    }

    /// <summary>
    /// POST /api/zomato/repair-bills - BATCH create, NEW 2026-09-26 fourth round, per your
    /// confirmation to add this (reversing the earlier GET-only decision from README SECTION 105).
    /// Same batch shape/semantics as CreateMaterialTransfers above (array in, array of per-entry
    /// success/failure results out, one shared SaveChangesAsync). Built against the real
    /// CreateRepairBillRequest/RepairBillDoc/RepairBillDocItem shapes and the confirmed
    /// IJobCardNumberingService.NextRepairBillNumberAsync(dealerId) from the real
    /// RepairBillDocsController.cs you pasted - same per-line discount-then-GST calculation
    /// (BuildAndAttachItemsAsync below, ported from that controller's own private helper of the
    /// same name), same PartUploads.BalQty stock check (using the same batch-safe redesign as
    /// Material Transfer above), same bill-level Taxable/Cgst/Sgst/Igst/TotalAmount rollup.
    ///
    /// FIELD MAPPING / DESIGN CHOICES:
    ///   - jobCardNumber (required) resolves to the real JobCardId server-side; CustomerId/
    ///     VehicleId/RegNo/ChassisNo are all pulled from that same job card and its linked Vehicle,
    ///     not accepted as separate input - Zomato only ever knows its own job card, never
    ///     JobCardScanner's internal Customer/Vehicle GUIDs.
    ///   - partyName is ALWAYS forced to "Zomato" (same reasoning as Material Transfer above).
    ///   - location defaults to the linked job card's own BaplServiceLocationCode when not sent.
    ///   - billType/issueType/remarks/insurance-related fields/zeroDepreciation/totalDiscount/
    ///     amountReceived/billDate are all optional pass-through fields, present for parity with
    ///     the real DTO even though Zomato's own fleet billing is unlikely to use the
    ///     insurance-claim fields.
    ///   - Starting Status is always Performa (RepairBillDocStatus.Performa) - same as every
    ///     staff-created bill; moving to Billed still only happens through your own staff workflow
    ///     (there is no Zomato-facing status-change endpoint).
    ///
    /// DELIBERATELY NOT PORTED - Extended Battery Warranty Scheme matching (the real
    /// BuildAndAttachItemsAsync's IExtendedBatteryWarrantyEligibilityService lookup): that's
    /// audit/display-only metadata (ExtendedBatteryWarrantySchemeId/IsUnderExtendedWarranty) that
    /// never changes a line's actual Rate/discount/tax/TotalAmount - omitting it keeps this first
    /// version simpler without affecting any amount Zomato is billed. Both fields are left null on
    /// every Zomato-created bill line. Tell me if Zomato specifically needs this metadata populated
    /// and I'll wire in the same vehicle-purchase-date lookup the real controller uses.
    /// </summary>
    [HttpPost("repair-bills")]
    public async Task<IActionResult> CreateRepairBills(List<ZomatoCreateRepairBillRequest> requests)
    {
        var authFail = CheckApiKey();
        if (authFail is not null) return authFail;
        if (requests is null || requests.Count == 0) return BadRequest(new { message = "Send at least one repair bill document (a JSON array)." });

        var (systemUserId, systemUserError) = GetSystemUserId();
        if (systemUserError is not null) return systemUserError;

        var results = new List<object>();
        var successCount = 0;
        for (var i = 0; i < requests.Count; i++)
        {
            var req = requests[i];
            if (string.IsNullOrWhiteSpace(req.JobCardNumber))
            {
                results.Add(new { index = i, jobCardNumber = req.JobCardNumber, success = false, error = "jobCardNumber is required." });
                continue;
            }
            if (req.Items is null || req.Items.Count == 0)
            {
                results.Add(new { index = i, jobCardNumber = req.JobCardNumber, success = false, error = "Add at least one item or labour line." });
                continue;
            }

            var jobCard = await _db.JobCards.Include(j => j.Vehicle).FirstOrDefaultAsync(j => j.JobCardNumber == req.JobCardNumber);
            if (jobCard is null)
            {
                results.Add(new { index = i, jobCardNumber = req.JobCardNumber, success = false, error = $"No job card '{req.JobCardNumber}'." });
                continue;
            }

            var bill = new RepairBillDoc
            {
                DealerId = jobCard.DealerId,
                BillNumber = await _numbering.NextRepairBillNumberAsync(jobCard.DealerId),
                JobCardId = jobCard.Id,
                CustomerId = jobCard.CustomerId,
                VehicleId = jobCard.VehicleId,
                PartyName = "Zomato", // ALWAYS forced - see this action's doc comment above
                RegNo = jobCard.Vehicle?.RegNo,
                ChassisNo = jobCard.Vehicle?.Vin,
                Location = !string.IsNullOrWhiteSpace(req.Location) ? req.Location : jobCard.BaplServiceLocationCode,
                BillType = req.BillType,
                IssueType = req.IssueType,
                Remarks = req.Remarks,
                InsuranceCompanyName = req.InsuranceCompanyName,
                InsuranceDescription = req.InsuranceDescription,
                SurveyorName = req.SurveyorName,
                SurveyorContactNumber = req.SurveyorContactNumber,
                PolicyNo = req.PolicyNo,
                InsuranceValidTill = req.InsuranceValidTill,
                ZeroDepreciation = req.ZeroDepreciation,
                TotalDiscount = req.TotalDiscount,
                AmountReceived = req.AmountReceived,
                BillDate = req.BillDate ?? DateOnly.FromDateTime(DateTime.UtcNow),
                CreatedById = systemUserId!.Value,
                Status = RepairBillDocStatus.Performa,
            };

            var stockError = await BuildAndAttachItemsAsync(bill, req.Items, jobCard.DealerId);
            if (stockError is not null)
            {
                results.Add(new { index = i, jobCardNumber = req.JobCardNumber, success = false, error = stockError });
                continue;
            }

            _db.RepairBillDocs.Add(bill);
            successCount++;
            results.Add(new { index = i, jobCardNumber = req.JobCardNumber, success = true, error = (string?)null, bill = ToZomatoRepairBillRowWithNumber(bill, req.JobCardNumber) });
        }

        await _db.SaveChangesAsync();
        _logger.LogInformation("Zomato API batch-created {SuccessCount}/{TotalCount} repair bills", successCount, requests.Count);

        return Ok(results);
    }

    /// <summary>Ported from RepairBillDocsController.BuildAndAttachItemsAsync (real, pasted
    /// source) - same per-line discount-then-GST calculation (IssueType "U/W"/"FSC" zeroes tax,
    /// exactly as the real controller does), same RepairBillDocItem construction and bill-level
    /// Taxable/Cgst/Sgst/Igst/TotalAmount rollup. Its PartUploads.BalQty check uses the SAME
    /// batch-safe redesign as MaterialTransferDocsController's counterpart above (validate this
    /// bill's whole Part-line stock need before mutating anything - see
    /// ApplyStockAndBuildItemsAsync's own doc comment for the full reasoning). Extended Battery
    /// Warranty Scheme matching is NOT ported - see CreateRepairBills' own doc comment.</summary>
    private async Task<string?> BuildAndAttachItemsAsync(RepairBillDoc bill, List<ZomatoRepairBillItemRequest> items, Guid dealerId)
    {
        static bool IsZeroTax(string? issueType) =>
            string.Equals(issueType, "U/W", StringComparison.OrdinalIgnoreCase)
            || string.Equals(issueType, "FSC", StringComparison.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(bill.Location))
        {
            var partUploadCache = new Dictionary<string, PartUpload>(StringComparer.OrdinalIgnoreCase);
            foreach (var it in items)
            {
                if (it.ItemType != RepairBillDocItemType.Part || string.IsNullOrWhiteSpace(it.ItemCode) || partUploadCache.ContainsKey(it.ItemCode)) continue;
                var pu = await _db.PartUploads.FirstOrDefaultAsync(
                    p => p.DealerId == dealerId && p.LocationCode == bill.Location && p.PartNo == it.ItemCode, HttpContext.RequestAborted);
                if (pu is not null) partUploadCache[it.ItemCode] = pu;
            }

            var requestedByCode = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            foreach (var it in items)
            {
                if (it.ItemType != RepairBillDocItemType.Part || !partUploadCache.ContainsKey(it.ItemCode)) continue;
                requestedByCode[it.ItemCode] = requestedByCode.GetValueOrDefault(it.ItemCode) + (decimal)it.Qty;
            }
            foreach (var (code, requestedQty) in requestedByCode)
            {
                var available = partUploadCache[code].BalQty ?? 0;
                if (requestedQty > available)
                    return $"Insufficient Part Upload stock for '{code}' at this location: available {available}, requested {requestedQty}.";
            }
            foreach (var (code, requestedQty) in requestedByCode)
                partUploadCache[code].BalQty = (partUploadCache[code].BalQty ?? 0) - requestedQty;
        }

        foreach (var it in items)
        {
            var zeroTax = IsZeroTax(it.IssueType ?? bill.IssueType);

            decimal gross = (decimal)it.Qty * it.Rate;
            decimal discountAmt = string.Equals(it.DiscountType, "Percentage", StringComparison.OrdinalIgnoreCase)
                ? gross * it.DiscountValue / 100m
                : it.DiscountValue;
            if (discountAmt > gross) discountAmt = gross;

            decimal taxable = zeroTax ? 0 : gross - discountAmt;
            decimal cgstPct = zeroTax ? 0 : it.CgstPct;
            decimal sgstPct = zeroTax ? 0 : it.SgstPct;
            decimal igstPct = zeroTax ? 0 : it.IgstPct;
            decimal cgstAmt = taxable * cgstPct / 100m;
            decimal sgstAmt = taxable * sgstPct / 100m;
            decimal igstAmt = taxable * igstPct / 100m;

            bill.Items.Add(new RepairBillDocItem
            {
                ItemType = it.ItemType,
                ItemCode = it.ItemCode,
                ItemDescription = it.ItemDescription,
                HsnCode = it.HsnCode,
                IssueType = it.IssueType,
                Qty = it.Qty,
                Rate = it.Rate,
                DiscountType = it.DiscountType,
                DiscountValue = it.DiscountValue,
                CgstPct = cgstPct,
                SgstPct = sgstPct,
                IgstPct = igstPct,
                TaxableAmount = taxable,
                CgstAmount = cgstAmt,
                SgstAmount = sgstAmt,
                IgstAmount = igstAmt,
                TotalAmount = taxable + cgstAmt + sgstAmt + igstAmt,
                ExtendedBatteryWarrantySchemeId = null, // NOT ported this round - see this action's doc comment
                IsUnderExtendedWarranty = null,
            });
        }

        bill.TaxableAmount = bill.Items.Sum(i => i.TaxableAmount);
        bill.CgstAmount = bill.Items.Sum(i => i.CgstAmount);
        bill.SgstAmount = bill.Items.Sum(i => i.SgstAmount);
        bill.IgstAmount = bill.Items.Sum(i => i.IgstAmount);
        bill.TotalAmount = bill.Items.Sum(i => i.TotalAmount);

        return null;
    }

    private static object ToZomatoRepairBillRow(RepairBillDoc b) => ToZomatoRepairBillRowWithNumber(b, b.JobCard?.JobCardNumber);

    /// <summary>Same projection as ToZomatoRepairBillRow, but takes the JobCardNumber explicitly -
    /// used right after CreateRepairBills builds a new RepairBillDoc in the same request, where
    /// `bill.JobCard` navigation isn't guaranteed to be populated by EF's change-tracker fixup
    /// (no lazy-loading proxies configured, as far as this session has seen) even though
    /// bill.JobCardId already matches an already-tracked JobCard - passing the number we already
    /// have in hand avoids depending on that.</summary>
    private static object ToZomatoRepairBillRowWithNumber(RepairBillDoc b, string? jobCardNumber) => new
    {
        b.JobCardId,
        JobCardNumber = jobCardNumber,
        b.BillNumber,
        BillDate = b.BillDate,
        b.PartyName,
        b.RegNo,
        b.ChassisNo,
        b.Location,
        b.BillType,
        b.IssueType,
        Status = b.Status.ToString(),
        b.Remarks,
        b.InsuranceCompanyName,
        b.InsuranceDescription,
        b.SurveyorName,
        b.SurveyorContactNumber,
        b.PolicyNo,
        b.InsuranceValidTill,
        b.ZeroDepreciation,
        b.TotalDiscount,
        b.AmountReceived,
        b.TaxableAmount,
        b.CgstAmount,
        b.SgstAmount,
        b.IgstAmount,
        b.TotalAmount,
        ItemCount = b.Items.Count,
        Items = b.Items.Select(i => new
        {
            ItemType = i.ItemType.ToString(),
            i.ItemCode,
            i.ItemDescription,
            i.HsnCode,
            i.IssueType,
            i.Qty,
            i.Rate,
            i.DiscountType,
            i.DiscountValue,
            i.CgstPct,
            i.SgstPct,
            i.IgstPct,
            i.TaxableAmount,
            i.CgstAmount,
            i.SgstAmount,
            i.IgstAmount,
            i.TotalAmount,
            i.ExtendedBatteryWarrantySchemeId,
            i.IsUnderExtendedWarranty,
        }),
    };

    private static object ToZomatoMaterialTransferRow(MaterialTransferDoc m) => ToZomatoMaterialTransferRow(m, m.JobCard?.JobCardNumber);

    private static object ToZomatoMaterialTransferRow(MaterialTransferDoc m, string? jobCardNumber) => new
    {
        m.JobCardId,
        JobCardNumber = jobCardNumber,
        m.TransferNumber,
        TransferDate = m.TransferDate,
        m.Location,
        TransferType = m.TransferType.ToString(),
        m.IssueType,
        m.PartyName,
        m.TechnicianId,
        m.Remarks,
        Status = m.Status.ToString(),
        m.TotalAmount,
        ItemCount = m.Items.Count,
        Items = m.Items.Select(i => new
        {
            i.ItemCode,
            i.ItemDescription,
            i.HsnCode,
            i.IssueType,
            i.Qty,
            i.Rate,
            i.Amount,
            i.RackNo,
            i.Bin,
            i.SerialNo,
            i.Mrp,
            i.ValidDays,
            i.ItemReceived,
            ItemType = i.ItemType.ToString(),
        }),
    };
}

/// <summary>Request body for POST /api/zomato/jobcards - see that action's doc comment for the
/// full resolve-or-create logic and every assumption behind each field.
///
/// 2026-09-26 THIRD ROUND: BaplCouponNo REMOVED (confirmed unused by the real Create() method -
/// see this controller's class-level doc comment). Every other field below is unchanged from the
/// previous round.
///
/// STILL NOT INCLUDED, deliberately - each has its own specific reason, not an oversight:
///   - baplJobCategory (B2C/B2B on the wizard): CONFIRMED this round to also be unused by the real
///     Create() method (not just "type unconfirmed" as flagged before) - wiring it in would do
///     nothing server-side regardless of what type I guessed for it.
///   - baplServiceTypeId/baplServiceTypeName: real, wired fields, but NOT added - the only real
///     catalog to validate against (serviceCatalog.ts's SERVICE_TYPES) is confirmed orphaned/stale;
///     see this controller's class-level doc comment, item (3).
///   - baplServiceLocation/baplServiceLocationCode: PARTIALLY resolved this round via the new
///     best-effort DMS Vehicle Sale lookup in CreateJobCard (see that action's doc comment) -
///     Zomato itself still cannot send these directly; they're only ever derived from the chassis
///     lookup, never accepted as raw input (trusting an unvalidated free-text location code from
///     Zomato was the original concern, and still applies).
///   - baplCustomerLedgerId: still not populated - the wizard sources this from a different lookup
///     (baplVehicleHit?.customerLedgerId) not exposed by LookupVehicleForWizardAsync, and in any
///     case the real Create() doesn't reference BaplCustomerLedgerId on the entity at all (same
///     "confirmed unused" story as BaplCouponNo/baplJobCategory).
///   - baplSupervisorName/baplTechnicianName, serviceAdvisorId: these identify a staff member -
///     meaningless for a job card Zomato itself is creating with no signed-in staff user behind it.
///   - baplJobSourceId/baplJobSourceName: the staff wizard itself no longer collects this (its own
///     Source picker was removed - see README SECTION 97/98 history), so there's nothing to mirror.
/// </summary>
public record ZomatoCreateJobCardRequest(
    string DealerCode,
    string ChassisNo,
    string? RegNo,
    string? VehicleModel,
    string CustomerName,
    string CustomerMobile,
    string? CustomerEmail,
    double OdometerAtCheckIn,
    int JobTypeId,
    int ServiceHeadId,
    List<string>? Complaints,
    string? ComplaintDescription,
    DateTime? ExpectedDeliveryAt,
    int? BatteryLevelAtCheckIn,
    string? CustomerConsentNotes,
    string? BaplManualJobNo);

public record ZomatoJobCardResponse(string JobCardNumber, string Status, string TrackingToken, DateTime CreatedAt);

/// <summary>Request body for POST /api/zomato/material-transfers - see that action's doc comment
/// for the full field mapping and design choices (jobCardNumber resolution, partyName always
/// forced to "Zomato", location fallback, etc).</summary>
public record ZomatoCreateMaterialTransferRequest(
    string JobCardNumber,
    string? Location,
    MaterialTransferDocType? TransferType,
    string? IssueType,
    string? Remarks,
    DateOnly? TransferDate,
    List<ZomatoMaterialTransferItemRequest> Items);

/// <summary>One item line for POST /api/zomato/material-transfers - field names/types mirror
/// MaterialTransferDocItem exactly (real, confirmed shape from MaterialTransferDocsController.cs),
/// except TechnicianId (dropped - always null for an API-originated line, see the controller's own
/// doc comment) and PartId (dropped - that's an internal JobCardScanner Part-catalog Guid Zomato
/// has no way to know; ItemCode is the real-world identifier it can send instead, same as every
/// other field here). RackNo/Bin/SerialNo/Mrp/ValidDays/ItemReceived are all OPTIONAL, low-risk
/// metadata Zomato is unlikely to have for its own fleet parts - ItemReceived's real type was not
/// directly confirmed in the pasted source (only ever passed through as `it.ItemReceived`, never
/// assigned a literal), so bool? here is an ASSUMPTION, not a fact; flag me a CS0029 on this field
/// specifically and I'll correct its type in one pass.</summary>
public record ZomatoMaterialTransferItemRequest(
    string ItemCode,
    string? ItemDescription,
    string? HsnCode,
    string? IssueType,
    double Qty,
    decimal Rate,
    string? RackNo,
    string? Bin,
    string? SerialNo,
    decimal? Mrp,
    int? ValidDays,
    string? ItemReceived,
    MaterialTransferDocItemType? ItemType);

/// <summary>Request body for one entry of the POST /api/zomato/repair-bills batch array - see
/// CreateRepairBills' own doc comment for the full field mapping and design choices (jobCardNumber
/// resolution, customerId/vehicleId/regNo/chassisNo pulled from that job card rather than accepted
/// directly, partyName always forced to "Zomato", Extended Battery Warranty metadata NOT ported).
/// BillType/IssueType are modelled as plain strings (ASSUMPTION, not directly confirmed as enums
/// vs strings in the pasted source - RepairBillDocsController.ToRow returns `b.BillType` without a
/// `.ToString()` call, unlike `b.Status.ToString()` right next to it, which is why string rather
/// than an enum is the more likely real type here; flag me a CS0029 on either field specifically
/// and I'll correct it).</summary>
public record ZomatoCreateRepairBillRequest(
    string JobCardNumber,
    string? Location,
    string? BillType,
    string? IssueType,
    string? Remarks,
    string? InsuranceCompanyName,
    string? InsuranceDescription,
    string? SurveyorName,
    string? SurveyorContactNumber,
    string? PolicyNo,
    DateOnly? InsuranceValidTill,
    bool ZeroDepreciation,
    decimal TotalDiscount,
    decimal AmountReceived,
    DateOnly? BillDate,
    List<ZomatoRepairBillItemRequest> Items);

/// <summary>One item/labour line for a POST /api/zomato/repair-bills entry - field names/types
/// mirror RepairBillDocItem exactly (real, confirmed shape from RepairBillDocsController.cs).
/// itemType is REQUIRED (Part vs Labour genuinely changes behavior here - only Part lines are
/// checked/deducted against PartUploads.BalQty), unlike Material Transfer's item type above which
/// defaults to Part when omitted. discountType is expected to be the literal string "Percentage"
/// for a percentage discount (matching the real controller's own
/// `string.Equals(it.DiscountType, "Percentage", ...)` check) - anything else (including null) is
/// treated as a flat amount discount, same as the real controller.</summary>
public record ZomatoRepairBillItemRequest(
    RepairBillDocItemType ItemType,
    string? ItemCode,
    string? ItemDescription,
    string? HsnCode,
    string? IssueType,
    double Qty,
    decimal Rate,
    string? DiscountType,
    decimal DiscountValue,
    decimal CgstPct,
    decimal SgstPct,
    decimal IgstPct);
