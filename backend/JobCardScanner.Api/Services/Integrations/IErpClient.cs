using JobCardScanner.Api.Models;

namespace JobCardScanner.Api.Services.Integrations;

public record ErpCustomerRecord(string ErpCustomerId, string Name, string Mobile, string? Email, decimal OutstandingAmount);
public record ErpVehicleRecord(string ErpVehicleId, string Model, string? Variant, string? RegNo, string? Vin, DateOnly? PurchaseDate);
public record ErpWarrantyRecord(WarrantyStatus Status, DateOnly? ExpiryDate, double CoverageKm, bool LabourCovered);

/// <summary>
/// Swappable client for the dealer's ERP/DMS backend (customer master, vehicle master,
/// warranty lookup, and push of finalized job cards/invoices). The mock implementation
/// synthesizes plausible responses from data already in our own database so the rest of
/// the app can be built and demoed against a stable contract; swapping in a real ERP only
/// means providing a new class that implements this interface.
/// </summary>
public interface IErpClient
{
    Task<ErpCustomerRecord?> FindCustomerByMobileAsync(string mobile);
    Task<ErpVehicleRecord?> FindVehicleByRegNoAsync(string regNo);
    Task<ErpWarrantyRecord?> GetWarrantyAsync(string vinOrSerialNo);
    Task<bool> PushJobCardAsync(JobCard jobCard);
    Task<bool> PushInvoiceAsync(Invoice invoice);
}
