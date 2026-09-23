using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Dtos;

// ---------------- Users / Admin ----------------
public record CreateUserRequest(
    string Name, string Email, string? Mobile, StaffRole Role, Guid? DealerId,
    UserAuthType AuthType = UserAuthType.AzureAd, string? Password = null,
    // ---- Employees page (2026-09-17) - all optional so the existing "Add staff user manually" /
    // Azure AD sync panels on Admin -> Users keep working unchanged, passing none of these. ----
    string? State = null, string? City = null, string? Pincode = null, DateOnly? DateOfJoining = null,
    /// <summary>Raw display label ("Supervisor"/"Mechanic") - see User.Designation's doc comment
    /// for how this maps onto Role. When both Designation and Role are supplied, Designation wins
    /// (the Employees page always sends both, Designation being the source of truth); when only
    /// Role is supplied (the older "Add staff user manually" panel), Designation stays null and
    /// Role is used exactly as given, unchanged from before this feature.</summary>
    string? Designation = null,
    /// <summary>BAPL DMS workshop LocCodes this user is scoped to (the "Work Area" checkboxes) -
    /// see User.WorkLocationCodes's doc comment. Empty/omitted = unrestricted.</summary>
    IReadOnlyList<string>? WorkLocationCodes = null);

public record UpdateUserRequest(
    string? Name, string? Mobile, StaffRole? Role, Guid? DealerId, bool? Active,
    string? State = null, string? City = null, string? Pincode = null, DateOnly? DateOfJoining = null,
    string? Designation = null, IReadOnlyList<string>? WorkLocationCodes = null,
    /// <summary>Set to change this user's password (Local/AuthType.Dealer users only) - omitted
    /// or null leaves the existing password untouched. Not required on every edit, unlike Create.</summary>
    string? Password = null);

// ---------------- Dealer / Workshop local login ----------------
public record DealerLoginRequest(string Email, string Password);
public record DealerForgotPasswordRequest(string Email);
public record DealerResetPasswordRequest(string Email, string Token, string NewPassword);
public record DealerChangePasswordRequest(string CurrentPassword, string NewPassword);
public record DealerAdminResetPasswordRequest(string NewPassword);
public record DealerAdminCreateRequest(string Name, string Email, string? Mobile, StaffRole Role, Guid DealerId, string Password);

// ---------------- Customers / Vehicles (Job Card Wizard steps 1-2) ----------------
public record CustomerLookupResult(Guid? CustomerId, string Name, string Mobile, string? Email, string? City, decimal OutstandingAmount, bool IsNew);

public record CreateCustomerRequest(string Name, string Mobile, string? Email, string? Address, string? City, Guid DealerId, string? State = null);

public record CreateVehicleRequest(
    Guid CustomerId, string Model, string? Variant, string? Color, string? RegNo, string? Vin,
    string? BatteryNo, string? MotorNo, string? SerialNo, DateOnly? PurchaseDate, double Odometer, Guid DealerId,
    // Optional - populated when the vehicle step was auto-filled from a DMS chassis/reg-no
    // lookup (see Controllers/BaplDmsController.cs); null for a manually-entered vehicle.
    string? ControllerNo = null, string? ConverterNo = null, string? ChargerNo = null,
    DateOnly? InsuranceExpiry = null, DateOnly? NextServiceDueDate = null,
    decimal? WarrantyOdoReading = null, decimal? WarrantyDuration = null, string? WarrantyDurationType = null,
    DateOnly? WarrantyExpiryDate = null);

// ---------------- Job Card Opening Wizard (steps 3-6 combined into one finalize call) ----------------
public record ComplaintInput(string Description, string? Category, bool IsCustomerVoice = true);

public record CreateJobCardRequest(
    Guid DealerId,
    Guid CustomerId,
    Guid VehicleId,
    ServiceType ServiceType,
    JobCardSource Source,
    JobCardPriority Priority,
    double OdometerAtCheckIn,
    int? BatteryLevelAtCheckIn,
    DateTime? ExpectedDeliveryAt,
    Guid? ServiceAdvisorId,
    string? CustomerConsentNotes,
    List<ComplaintInput> Complaints,
    // DMS-style fields (see JobCard.cs's doc comment) - free text display labels, kept for
    // backward compatibility with job cards created before the cascade below existed.
    string? BaplJobType = null,
    string? BaplServiceLocation = null,
    string? BaplSupervisorName = null,
    string? BaplTechnicianName = null,
    string? BaplManualJobNo = null,
    // DMS JobType -> ServiceHead -> ServiceType cascade (see BaplDmsService.GetJobTypesAsync/
    // GetServiceHeadsAsync/GetServiceTypesAsync) plus the Service Location DMS Loccode - when
    // all three ids and a location code are present AND the dealer has a known BaplDmsDealerCode,
    // JobCardsController.Create attempts a best-effort write-back into DMS's own database (see
    // BaplDmsService.CreateJobCardAsync). CustomerLedgerId is the DMS LedgerMaster.Id this
    // customer/vehicle was auto-fetched against (from the chassis/reg-no lookup) - null for a
    // manually-entered customer DMS has never seen.
    int? BaplJobTypeId = null,
    int? BaplServiceHeadId = null,
    string? BaplServiceHeadName = null,
    int? BaplServiceTypeId = null,
    string? BaplServiceTypeName = null,
    string? BaplServiceLocationCode = null,
    int? BaplCustomerLedgerId = null,
    // DMS's JobSource master (Walk In/RSA/Mega Camp/...) - see JobCard.cs's doc comment on
    // BaplJobSourceId for why the plain Source enum above still gets set too.
    int? BaplJobSourceId = null,
    string? BaplJobSourceName = null,
    // 2026-09-07: Coupon No. and Job Category, added to the Job Card Wizard's Vehicle step (before
    // Odometer) to match DMS's own Job Card form. Both are optional overrides of what
    // BaplDmsService.CreateJobCardAsync would otherwise derive automatically (Coupon No. from the
    // chassis number's last 13 characters, Job Category defaulting to "B2C") - see that method's
    // doc comment. Not persisted on JobCard itself (DMS is the system of record for both), only
    // forwarded into the DMS write-back.
    string? BaplCouponNo = null,
    string? BaplJobCategory = null);

public record UpdateJobCardRequest(Guid? AssignedTechnicianId, JobCardPriority? Priority, DateTime? ExpectedDeliveryAt, string? AssignedTechnicianName = null);

public record ChangeStageRequest(Guid StageId, string? Notes);

public record AddInspectionRequest(string Component, string Condition, string? Notes, Guid? TechnicianId);

public record AddPhotoRequest(PhotoStage Stage, string Url, string? Caption);

/// <summary>
/// multipart/form-data body for POST /api/jobcards/{id}/photos/upload (Job Card Detail page's real
/// photo capture, as opposed to AddPhotoRequest above which only ever accepted an already-hosted
/// Url and has no actual upload behind it anywhere in this codebase). A plain class with settable
/// properties, not a record - [FromForm] model binding needs property setters, not a constructor.
/// Latitude/Longitude come from the browser's Geolocation API at capture time and are optional -
/// the upload still succeeds if the user's device/browser denies location access.
/// </summary>
public class UploadPhotoForm
{
    public IFormFile? File { get; set; }
    public PhotoStage Stage { get; set; }
    public string? Caption { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    /// <summary>Set only by the Part Suggestion grid's Picture column upload (2026-09-03) - links
    /// the uploaded photo/video to that specific suggestion row. Null for every other uploader
    /// (the general Photos card never sends this).</summary>
    public Guid? PartSuggestionId { get; set; }
}

/// <summary>PUT /api/jobcards/photos/{photoId} - edits a photo's caption after it's already been
/// uploaded (see JobCardsController.UpdatePhotoCaption). Added because the Photos card no longer
/// takes a caption up front only - a caption can now be added/changed under an already-uploaded
/// photo too, not just typed in before choosing the file.</summary>
public record UpdatePhotoCaptionRequest(string? Caption);

public record StartWorklogRequest(Guid TechnicianId, string? TaskDescription);
public record EndWorklogRequest(string? Notes);

public record UpsertQcItemRequest(string ItemName, bool? Passed, string? Notes);

// ---------------- Estimates / Additional-work approval ----------------
public record EstimateLineInput(EstimateLineType Type, string Description, Guid? PartId, double Quantity, decimal UnitPrice);
public record CreateEstimateRequest(string? Reason, List<EstimateLineInput> Lines);
// DevOtpCode is only ever non-null when the API is running in Development (see OtpService) -
// there's no real SMS provider configured yet, so this is how a tester actually completes an OTP
// flow locally instead of digging through server logs / the NotificationRecords table.
public record OtpIssueResponse(Guid OtpRequestId, string Mobile, string Message, string? DevOtpCode = null);
public record OtpVerifyRequest(Guid OtpRequestId, string Code);

// ---------------- Parts ----------------
public record RequestPartRequest(Guid PartId, double Quantity);
public record IssuePartRequest { }

// ---------------- Part Suggestion ("Part Suggestion" panel - suggested from DMS's own
// PartsInventory, status tracked locally only) ----------------
public record AddPartSuggestionRequest(
    string ItemCode, int? AvailableQtyAtSuggestion, string Status,
    // Optional - see JobCardPartSuggestion's doc comment. Quantity defaults to 1 (same convention
    // as AddLabourSuggestionRequest.Quantity) when not supplied.
    int Quantity = 1, string? Description = null, string? HsnCode = null, decimal? Mrp = null);
public record UpdatePartSuggestionStatusRequest(string Status);

// ---------------- Labour Suggestion ("Labour Suggestion" panel - suggested from DMS's own
// LabourMaster, Description/HSN/GST/Rate snapshotted locally at suggestion time) ----------------
public record AddLabourSuggestionRequest(
    string LabourCode,
    string? LabourDescription,
    string? HsnCode,
    decimal? Sgst,
    decimal? Cgst,
    decimal? Igst,
    decimal? RateAtSuggestion,
    int Quantity,
    string? IssueType);
public record UpdateLabourSuggestionRequest(int Quantity, string? IssueType);

// ---------------- Invoicing ----------------
public record GenerateInvoiceRequest(decimal DiscountAmount, decimal CgstAmount, decimal SgstAmount, decimal IgstAmount);
public record RecordPaymentRequest(PaymentMode PaymentMode, string? PaymentReference);

/// <summary>Estimates Amount card's "Done" -> email flow (see JobCardsController.EmailEstimate) -
/// just the address the estimate PDF should go to; everything else is built server-side from the
/// job card's own current Part/Labour Suggestion rows at send time.</summary>
public record EmailEstimateRequest(string Email);

// ---------------- Workflow config ----------------
public record UpsertWorkflowStageRequest(string StageKey, string Label, int Seq, string? Icon, bool Active, bool IsTerminal);

// ---------------- Customer portal ----------------
public record CustomerOtpRequestDto(string Mobile);
public record CustomerOtpVerifyRequest(Guid OtpRequestId, string Code, string Mobile);

// ---------------- Customer password login (alongside OTP - see CustomerPortalController) ----------------
/// <summary>MobileOrEmail matches Customer.Mobile OR Customer.Email - a customer signs in with
/// whichever one they know, same "email or code" flexibility DealerLoginRequest already allows
/// for staff.</summary>
public record CustomerLoginRequest(string MobileOrEmail, string Password);
public record CustomerForgotPasswordRequest(string MobileOrEmail);
public record CustomerResetPasswordRequest(string MobileOrEmail, string Token, string NewPassword);
public record CustomerChangePasswordRequest(string CurrentPassword, string NewPassword);
/// <summary>A dealer/admin setting a customer's password directly - e.g. the customer is present
/// in person and wants password login set up, or is locked out and calls the workshop. Mirrors
/// DealerAdminResetPasswordRequest's shape exactly.</summary>
public record CustomerAdminResetPasswordRequest(string NewPassword);

// ---------------- Labour Master (2026-09-19) ----------------
/// <summary>multipart/form-data body for POST /api/labour-master/{without-partwise|partwise}/import
/// - the page's whole import form is just these two fields (Rate Type isn't part of the body since
/// it's which of the two endpoints/URLs you post to). Plain class with setters, not a record, same
/// reason as UploadPhotoForm above - [FromForm] binding needs property setters.</summary>
public class LabourMasterImportForm
{
    public IFormFile? File { get; set; }
    public DateTime EffectiveDate { get; set; }
}

/// <summary>PUT /api/labour-master/without-partwise/{id} body - see LabourMasterWithoutPartwiseUpdate
/// in Services/LabourMasterImportService.cs for why LabourCode itself isn't editable here.</summary>
public record LabourMasterWithoutPartwiseUpdateRequest(
    string? JobDescription, string? Model, decimal? LabourRate, decimal? Igst, decimal? Cgst,
    decimal? Sgst, int? Tier, string? Category, DateTime? EffectiveDate, bool IsActive);

// ---------------- Part Upload (2026-09-21) ----------------
/// <summary>multipart/form-data body for POST /api/part-uploads/import, same [FromForm]-needs-
/// setters reasoning as LabourMasterImportForm above. Dealer is taken from the signed-in user
/// (ICurrentUserService), not a form field - see Services/PartUploadService.cs. LocationCode and
/// ReportDate are REQUIRED (2026-09-21 correction: "before that 4 feild need to select Date,
/// Location ... otherwise dont take the file need to select this feild then upload") - the
/// controller returns 400 if either is missing/blank, same as LabourMasterImportForm's own
/// required EffectiveDate.</summary>
public class PartUploadImportForm
{
    public IFormFile? File { get; set; }
    public string? LocationCode { get; set; }
    public DateOnly? ReportDate { get; set; }
}

/// <summary>PUT /api/part-uploads/{id} body (the grid's own Edit button) - mirrors
/// Services/PartUploadService.cs's PartUploadUpdate record exactly; kept as a separate Dtos type
/// (rather than reusing that record directly as the request body) only to match this file's own
/// convention of Dtos being the wire contract and Services types being internal.</summary>
public record PartUploadUpdateRequest(
    string? Description, decimal? BalQty, decimal? BalAmnt, decimal? BillPrice,
    decimal? QtyReqd, decimal? MinOrder, string? HsnSacCode, string? GroupName, string? ItemType);

public record LabourMasterPartwiseUpdateRequest(
    string? PartName, string? JobDescription, string? Model, decimal? LabourRate, decimal? Igst,
    decimal? Cgst, decimal? Sgst, int? Tier, string? Category, DateTime? EffectiveDate, bool IsActive);

// ---------------- Repair Bill / Material Transfer Bill (2026-09-19, corrected 2026-09-21 per
// "backend logic which u gave u ... dont chnage Repair Bill and Material tranfer logic") - see
// Controllers/RepairBillDocsController.cs / MaterialTransferDocsController.cs and
// Models/RepairBillDocs.cs / MaterialTransferDocs.cs for what these save and why they're
// JobCardScannerDb-native, distinct from both BAPL DMS's own tables and the read-only
// DMSBAPLDATA-synced report pages of a similar name. ----------------
// CgstPct/SgstPct/IgstPct: three INDEPENDENT caller-supplied rates, matching the reference
// RepairBillRepo which never infers same-state/different-state itself - it only persists
// whatever the caller (originally Angular, reading LabourMaster/PartWiseLabour's own stored
// rates) already resolved. Replaces the first version's single combined GstPct + server-side
// state-comparison guess, which was NOT something the reference does.
// DiscountType/DiscountValue: reference RepairBillDetail.DiscountType/DiscountValue - applied to
// reduce the taxable base before GST (same order as the reference's own save flow).
// IssueType: per-line, see RepairBillDocItem.IssueType's doc comment on why this moved off the
// bill header (reference RepairBillDetail.IssutypeId is a detail-row column, confirmed by
// re-reading that entity - RepairBillHeader has none).
public record CreateRepairBillItemRequest(
    RepairBillDocItemType ItemType, string ItemCode, string ItemDescription, string? HsnCode,
    double Qty, decimal Rate, decimal CgstPct = 0, decimal SgstPct = 0, decimal IgstPct = 0,
    string? DiscountType = null, decimal DiscountValue = 0, string? IssueType = null);

// InsuranceCompanyName/InsuranceDescription/SurveyorName/SurveyorContactNumber/PolicyNo/
// InsuranceValidTill/ZeroDepreciation/TotalDiscount/AmountReceived: reference
// RepairBillHeader.InsuranceId(->name)/InsDecription/SurveyorName/ContactNumber/PolicyNo/
// InsValidTill/ZeroDepo/TotalDiscount/AmountReceived - present on the reference, missing from the
// first version of this request, added back here.
public record CreateRepairBillRequest(
    Guid? JobCardId, Guid? CustomerId, Guid? VehicleId, string PartyName, string? RegNo,
    string? ChassisNo, string? Location, string? BillType, string? IssueType, string? Remarks,
    DateOnly? BillDate, List<CreateRepairBillItemRequest> Items,
    string? InsuranceCompanyName = null, string? InsuranceDescription = null, string? SurveyorName = null,
    string? SurveyorContactNumber = null, string? PolicyNo = null, DateOnly? InsuranceValidTill = null,
    bool ZeroDepreciation = false, decimal TotalDiscount = 0, decimal AmountReceived = 0);

// RackNo/Bin/SerialNo/Mrp/ValidDays/ItemReceived: reference MaterialTransfer's real per-line
// columns, missing from the first version, added back - see MaterialTransferDocItem's doc comment.
// IssueType: per-line "Paid"/"U/W", see MaterialTransferDocItem.IssueType's doc comment.
// ItemType: defaults to Part when omitted, matching MaterialTransferDocItem.ItemType's own
// default - every caller before 2026-09-22 (this field's own addition) keeps working unchanged.
public record CreateMaterialTransferItemRequest(
    Guid? PartId, string ItemCode, string ItemDescription, double Qty, decimal Rate,
    string? RackNo = null, string? Bin = null, string? SerialNo = null, decimal? Mrp = null,
    int? ValidDays = null, string? ItemReceived = null, string? IssueType = null, string? HsnCode = null,
    MaterialTransferDocItemType ItemType = MaterialTransferDocItemType.Part, Guid? TechnicianId = null);

// TechnicianId: reference MaterialTransfer.Technician, mapped onto this app's own User FK instead
// of a meaningless raw DMS employee int - see MaterialTransferDoc.TechnicianId's doc comment.
public record CreateMaterialTransferRequest(
    Guid? JobCardId, string? Location, MaterialTransferDocType TransferType, string? IssueType,
    string? PartyName, Guid? TechnicianId, string? Remarks, DateOnly? TransferDate,
    List<CreateMaterialTransferItemRequest> Items);

/// <summary>Shared row shape for GET /api/repair-bill-docs/combined - one row per bill regardless
/// of whether it came from this app's own RepairBillDocs table or the read-only DMSBAPLDATA sync
/// (Source distinguishes them; Id is prefixed "dms-" for the latter since DMSBAPLDATA's own ids
/// are plain ints that could otherwise collide with a JobCardScannerDb Guid's string form only by
/// coincidence, but keeping them visibly distinct is safer than relying on that). SortDate is a
/// concrete, always-comparable field specifically so the controller can order the combined list
/// with a plain OrderByDescending instead of a dynamic/object comparison across two differently-
/// shaped sources.
///
/// 2026-09-21 ("all upload data and exist data are clickable on any record we click this all
/// details can openable"): Items carries each row's own line items (a JobCardScanner bill's own
/// RepairBillDocItem rows, or a DMSBAPLDATA DMS_RepairBillItem rows for a "dms-" row) so the
/// frontend can open a full detail view straight from data already fetched by /combined, without a
/// second round trip - untyped `object` on purpose, since the two sources have different, already-
/// defined item shapes (RepairBillDocItem vs DmsBaplDataRepairBillItemRow) and this DTO only needs
/// to carry them through to JSON, not manipulate them. Optional/defaulted so this is additive - no
/// existing caller of this record (the flat, non-combined endpoints don't use it) breaks.</summary>
/// 2026-09-21 sixth round ("according /repair-bill-list do in our repair bill" - the reference
/// DMS app's own Repair Bill List page/columns you pasted, repair-bill-list.ts/html): JobNo/
/// PreparedBy/ModifiedBy added to match that reference's own column set (Job No, Prepared by,
/// Modified by) - only ever populated for a "JobCardScanner" row (this app's own bill, which can
/// have a linked JobCard and a CreatedBy/UpdatedBy user); a "DMSBAPLDATA" row has no such data in
/// DmsBaplDataRepairBillRow (no JobNo/CreatedBy/UpdatedBy columns confirmed there), so those three
/// stay null for it rather than being guessed.
public record CombinedRepairBillRow(
    string Source, string Id, string BillNumber, DateTime SortDate, string? PartyName, string? RegNo,
    string? ChassisNo, string? Location, string? BillType, string? Status, decimal TotalAmount, int ItemCount,
    IReadOnlyList<object>? Items = null, string? JobNo = null, string? PreparedBy = null, string? ModifiedBy = null);

/// <summary>Shared row shape for GET /api/material-transfer-docs/combined - see
/// CombinedRepairBillRow's doc comment for the same Source/Id/SortDate/Items reasoning.
/// 2026-09-23 ("history maintain in which job card which item material transfered") - JobNo added,
/// same treatment as CombinedRepairBillRow.JobNo above: only ever set for a
/// `source: 'JobCardScanner'` row (see MaterialTransferDocsController.ToCombinedRow), null for a
/// DMSBAPLDATA row (that side's own MaterialTransfer table has no Job Card link this app can
/// read).</summary>
public record CombinedMaterialTransferRow(
    string Source, string Id, string TransferNumber, DateTime SortDate, string? Location,
    string? TransferType, string? PartyName, string? Status, decimal TotalAmount, int ItemCount,
    IReadOnlyList<object>? Items = null, string? JobNo = null);

// 2026-09-22 "create warenty table in jobcardscanner db" - see
// Models/ExtendedBatteryWarrantySchemes.cs's own doc comment for every field's meaning and the
// two deliberate adaptations from the BAPL DMS reference (free-text VehicleModel instead of an
// OemModelId FK, free-text DurationType instead of a guessed numeric id).
// 2026-09-22 OemModelId added (nullable) - see ExtendedBatteryWarrantyScheme's own updated doc
// comment: the admin UI's model picker sends this alongside VehicleModel so the two stay in sync,
// but VehicleModel is still required/still what eligibility matching reads.
public record CreateExtendedBatteryWarrantySchemeRequest(
    string SchemeName, string VehicleModel, string? RateType, int Duration, string DurationType,
    decimal Kms, decimal DealerPrice, decimal CustomerPrice, decimal DiscountAmount, decimal GstPercent,
    int? PurchaseValidityDays, string? BatteryPartCode, string? PartCode, DateOnly FromDate,
    DateOnly? ToDate, bool IsActive = true, Guid? OemModelId = null);

// ---------------------------------------------------------------------------------------------
// OEM Model Master + OEM Model Warranty (2026-09-22) - see Models/OemModels.cs's own doc comment
// for the full reasoning ported from the BAPL DMS reference's OemmodelMaster/OemmodelWarranty.
// ---------------------------------------------------------------------------------------------
public record CreateOemModelRequest(string ModelName, string? ModelShortName, bool IsActive = true);

/// <summary>OdoReading/Duration are decimal? (not required) matching the reference's own optional
/// fields on this table - a warranty term can specify just a date cap, just a mileage cap, or
/// both. DurationType, if given, must be "Months" or "Years" (see OemModelWarranty's own doc
/// comment for why "Days" isn't offered here unlike ExtendedBatteryWarrantyScheme).</summary>
public record CreateOemModelWarrantyRequest(
    Guid OemModelId, DateOnly EffectiveDate, decimal? OdoReading, string? DurationType,
    decimal? Duration, bool? IsB2b);

/// <summary>Result of GET /api/extended-battery-warranty-schemes/eligible - see
/// ExtendedBatteryWarrantySchemesController's own doc comment for the eligibility formula and what
/// in it is INTERPRETATION rather than confirmed BGauss policy. BatteryPartCode/PartCode are
/// carried through from the scheme (not just eligibility/pricing fields) so a caller - specifically
/// RepairBillDocsController.Create's non-destructive per-line tagging, see that method's own
/// comment - can match a Repair Bill Part line's ItemCode against a candidate scheme without a
/// second round-trip query.</summary>
public record ExtendedBatteryWarrantyEligibilityResult(
    Guid SchemeId, string SchemeName, bool IsEligible, string? IneligibilityReason,
    decimal DealerPrice, decimal CustomerPrice, decimal GstPercent, DateOnly CoverageEndDate, decimal CoverageUptoKms,
    string? BatteryPartCode = null, string? PartCode = null);
