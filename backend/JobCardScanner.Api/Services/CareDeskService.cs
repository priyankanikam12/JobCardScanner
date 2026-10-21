using JobCardScanner.Api.CareDeskData;
using JobCardScanner.Api.Data;        // CareDeskDbContext (the scaffolded context lives in the Data folder / namespace)
using JobCardScanner.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace JobCardScanner.Api.Services;

public interface ICareDeskService
{
    /// <summary>True when CareDesk:Enabled is on AND ConnectionStrings:CareDeskDb is set.</summary>
    bool IsConfigured { get; }

    /// <summary>Care Desk tickets of one vehicle (chassis no. or registration no.), newest first.</summary>
    Task<IReadOnlyList<CareDeskTicketRow>> GetTicketsAsync(string vehicleKey, CancellationToken ct);

    /// <summary>Can the CareDesk database be reached - and how many rows are in the main tables (a quick "is it connected and what is in it" check).</summary>
    Task<CareDeskCounts> CountsAsync(CancellationToken ct);
}

public sealed record CareDeskCounts(bool Connected, int Tickets, int Vehicles, int Customers, int Users);

/// <summary>
/// 2026-10-17: reads BGauss Care Desk's own SQL Server database (CareDeskDbContext, schema "caredesk"). Plain LINQ over the generated model - no raw SQL. Only reads: nothing here saves.
/// What this does NOT contain: Care Desk's rules (escalation, working-hour deadlines, warranty checks ... 232 PostgreSQL functions in db/02_functions.sql). Creating or moving a ticket is not implemented here;
/// until those rules are rebuilt in C#, write access to these tables would bypass them.
/// </summary>
public sealed class CareDeskService : ICareDeskService
{
    private readonly CareDeskDbContext _db;
    private readonly CareDeskOptions _opt;

    public CareDeskService(CareDeskDbContext db, IOptions<CareDeskOptions> options)
    {
        _db = db;
        _opt = options.Value;
    }

    public bool IsConfigured => _opt.Enabled && !string.IsNullOrWhiteSpace(_db.Database.GetConnectionString());

    public async Task<IReadOnlyList<CareDeskTicketRow>> GetTicketsAsync(string vehicleKey, CancellationToken ct)
    {
        // same normal form Care Desk keeps: upper case, no spaces (comparison is case-insensitive anyway: the columns use the server's case-insensitive collation)
        var key = (vehicleKey ?? "").Trim().ToUpperInvariant().Replace(" ", "");
        if (key.Length == 0 || key.Length > 40) return Array.Empty<CareDeskTicketRow>();
        var max = Math.Clamp(_opt.MaxTickets, 1, 100);

        var rows = await (
            from t in _db.Tickets.AsNoTracking()
            join v in _db.Vehicles.AsNoTracking() on t.VehicleId equals (Guid?)v.Id
            join c in _db.Customers.AsNoTracking() on t.CustomerId equals c.Id
            where v.Vin == key || v.RegNo == key
            orderby t.CreatedAt descending
            select new CareDeskTicketRow
            {
                TicketNo = t.TicketNo,
                Category = t.Category,
                Status = t.Status,
                Level = t.CurrentLevel,
                CustomerName = c.Name,
                Vin = v.Vin,
                RegNo = v.RegNo,
                Description = t.Description.Length > 300 ? t.Description.Substring(0, 300) : t.Description,
                CreatedAt = t.CreatedAt,
                LevelDueAt = t.LevelDueAt,
                ClosedAt = t.ClosedAt,
                IsRepeat = t.IsRepeat,
            }).Take(max).ToListAsync(ct);
        return rows;
    }

    public async Task<CareDeskCounts> CountsAsync(CancellationToken ct)
    {
        if (!await _db.Database.CanConnectAsync(ct)) return new CareDeskCounts(false, 0, 0, 0, 0);
        return new CareDeskCounts(
            true,
            await _db.Tickets.CountAsync(ct),
            await _db.Vehicles.CountAsync(ct),
            await _db.Customers.CountAsync(ct),
            await _db.Users.CountAsync(ct));
    }
}