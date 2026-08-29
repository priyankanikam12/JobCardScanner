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

public record CreateCustomerRequest(string Name, string Mobile, string? Email, string? Address, string? City, Guid DealerId);

public record CreateVehicleRequest(
    Guid CustomerId, string Model, string? Variant, string? Color, string? RegNo, string? Vin,
    string? BatteryNo, string? MotorNo, string? SerialNo, DateOnly? PurchaseDate, double Odometer, Guid DealerId);

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
    List<ComplaintInput> Complaints);

public record UpdateJobCardRequest(Guid? AssignedTechnicianId, JobCardPriority? Priority, DateTime? ExpectedDeliveryAt);

public record ChangeStageRequest(Guid StageId, string? Notes);

public record AddInspectionRequest(string Component, string Condition, string? Notes, Guid? TechnicianId);

public record AddPhotoRequest(PhotoStage Stage, string Url, string? Caption);

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

// ---------------- Invoicing ----------------
public record GenerateInvoiceRequest(decimal DiscountAmount, decimal CgstAmount, decimal SgstAmount, decimal IgstAmount);
public record RecordPaymentRequest(PaymentMode PaymentMode, string? PaymentReference);

// ---------------- Workflow config ----------------
public record UpsertWorkflowStageRequest(string StageKey, string Label, int Seq, string? Icon, bool Active, bool IsTerminal);

// ---------------- Customer portal ----------------
public record CustomerOtpRequestDto(string Mobile);
public record CustomerOtpVerifyRequest(Guid OtpRequestId, string Code, string Mobile);