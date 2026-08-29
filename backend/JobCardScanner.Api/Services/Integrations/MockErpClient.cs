using JobCardScanner.Api.Data;
using JobCardScanner.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Services.Integrations;

public class MockErpClient : IntegrationClientBase, IErpClient
{
    private readonly JobCardScannerDbContext _db;

    public MockErpClient(JobCardScannerDbContext db, ILogger<MockErpClient> logger) : base(db, logger)
    {
        _db = db;
    }

    public Task<ErpCustomerRecord?> FindCustomerByMobileAsync(string mobile) =>
        ExecuteAsync(IntegrationSystem.Erp, "GET /customers/by-mobile", new { mobile }, async () =>
        {
            await SimulateLatencyAsync();
            var c = await _db.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.Mobile == mobile);
            return c is null ? null : new ErpCustomerRecord(c.ErpCustomerId ?? c.Id.ToString(), c.Name, c.Mobile, c.Email, c.OutstandingAmount);
        });

    public Task<ErpVehicleRecord?> FindVehicleByRegNoAsync(string regNo) =>
        ExecuteAsync(IntegrationSystem.Erp, "GET /vehicles/by-regno", new { regNo }, async () =>
        {
            await SimulateLatencyAsync();
            var v = await _db.Vehicles.AsNoTracking().FirstOrDefaultAsync(x => x.RegNo == regNo);
            return v is null ? null : new ErpVehicleRecord(v.ErpVehicleId ?? v.Id.ToString(), v.Model, v.Variant, v.RegNo, v.Vin, v.PurchaseDate);
        });

    public Task<ErpWarrantyRecord?> GetWarrantyAsync(string vinOrSerialNo) =>
        ExecuteAsync(IntegrationSystem.Erp, "GET /warranty", new { vinOrSerialNo }, async () =>
        {
            await SimulateLatencyAsync();
            var v = await _db.Vehicles.AsNoTracking()
                .Include(x => x.Warranty)
                .FirstOrDefaultAsync(x => x.Vin == vinOrSerialNo || x.SerialNo == vinOrSerialNo);
            if (v?.Warranty is null) return null;
            return new ErpWarrantyRecord(v.Warranty.Status, v.Warranty.ExpiryDate, v.Warranty.CoverageKm, v.Warranty.LabourCovered);
        });

    public Task<bool> PushJobCardAsync(JobCard jobCard) =>
        ExecuteAsync(IntegrationSystem.Erp, "POST /jobcards", new { jobCard.Id, jobCard.JobCardNumber, jobCard.Status }, async () =>
        {
            await SimulateLatencyAsync();
            return true; // mock: acknowledged
        });

    public Task<bool> PushInvoiceAsync(Invoice invoice) =>
        ExecuteAsync(IntegrationSystem.Erp, "POST /invoices", new { invoice.Id, invoice.InvoiceNumber, invoice.TotalAmount }, async () =>
        {
            await SimulateLatencyAsync();
            return true; // mock: acknowledged
        });
}
