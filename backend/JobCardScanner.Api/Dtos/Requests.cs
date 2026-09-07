using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Dtos;

// ---------------- Users / Admin ----------------
public record CreateUserRequest(string Name, string Email, string? Mobile, StaffRole Role, Guid? DealerId, UserAuthType AuthType = UserAuthType.AzureAd, string? Password = null);
public record UpdateUserRequest(string? Name, string? Mobile, StaffRole? Role, Guid? DealerId, bool? Active);

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
    // Optional - populated when the vehicle step was auto-filled from a BAPL DMS chassis/reg-no
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
    // BAPL DMS-style fields (see JobCard.cs's doc comment) - free text display labels, kept for
    // backward compatibility with job cards created before the cascade below existed.
    string? BaplJobType = null,
    string? BaplServiceLocation = null,
    string? BaplSupervisorName = null,
    string? BaplTechnicianName = null,
    string? BaplManualJobNo = null,
    // BAPL DMS JobType -> ServiceHead -> ServiceType cascade (see BaplDmsService.GetJobTypesAsync/
    // GetServiceHeadsAsync/GetServiceTypesAsync) plus the Service Location BAPL DMS Loccode - when
    // all three ids and a location code are present AND the dealer has a known BaplDmsDealerCode,
    // JobCardsController.Create attempts a best-effort write-back into BAPL DMS's own database (see
    // BaplDmsService.CreateJobCardAsync). CustomerLedgerId is the BAPL DMS LedgerMaster.Id this
    // customer/vehicle was auto-fetched against (from the chassis/reg-no lookup) - null for a
    // manually-entered customer BAPL DMS has never seen.
    int? BaplJobTypeId = null,
    int? BaplServiceHeadId = null,
    string? BaplServiceHeadName = null,
    int? BaplServiceTypeId = null,
    string? BaplServiceTypeName = null,
    string? BaplServiceLocationCode = null,
    int? BaplCustomerLedgerId = null,
    // BAPL DMS's JobSource master (Walk In/RSA/Mega Camp/...) - see JobCard.cs's doc comment on
    // BaplJobSourceId for why the plain Source enum above still gets set too.
    int? BaplJobSourceId = null,
    string? BaplJobSourceName = null,
    // 2026-09-07: Coupon No. and Job Category, added to the Job Card Wizard's Vehicle step (before
    // Odometer) to match BAPL DMS's own Job Card form. Both are optional overrides of what
    // BaplDmsService.CreateJobCardAsync would otherwise derive automatically (Coupon No. from the
    // chassis number's last 13 characters, Job Category defaulting to "B2C") - see that method's
    // doc comment. Not persisted on JobCard itself (BAPL DMS is the system of record for both), only
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

// ---------------- Part Suggestion ("Part Suggestion" panel - suggested from BAPL DMS's own
// PartsInventory, status tracked locally only) ----------------
public record AddPartSuggestionRequest(
    string ItemCode, int? AvailableQtyAtSuggestion, string Status,
    // Optional - see JobCardPartSuggestion's doc comment. Quantity defaults to 1 (same convention
    // as AddLabourSuggestionRequest.Quantity) when not supplied.
    int Quantity = 1, string? Description = null, string? HsnCode = null, decimal? Mrp = null);
public record UpdatePartSuggestionStatusRequest(string Status);

// ---------------- Labour Suggestion ("Labour Suggestion" panel - suggested from BAPL DMS's own
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
