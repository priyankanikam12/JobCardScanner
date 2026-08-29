using Microsoft.Data.SqlClient;

namespace JobCardScanner.Api.Services;

/// <summary>One active dealer row read from BAPL's C_CustomerMaster (read-only, separate
/// database from JobCardScannerDb).</summary>
public record BaplDealerRow(
    string CustomerCode,
    string CustomerName,
    string City,
    string State,
    string Mobile,
    string ContactPerson,
    string ContactEmail,
    string? AssignedRepCode);

public interface IBaplDealerService
{
    /// <summary>
    /// Every active (Active = 'Y') row in BAPL's C_CustomerMaster. Throws
    /// <see cref="InvalidOperationException"/> with a human-readable message if BaplConnection
    /// isn't configured, or the query fails (network/credentials/schema).
    /// </summary>
    Task<IReadOnlyList<BaplDealerRow>> FetchActiveDealersAsync(CancellationToken ct = default);
}

/// <summary>
/// Reads BGauss's real dealer network from the BAPL ERP data warehouse so Admin -> Users'
/// "Bulk Import Dealers from ERP" panel can create a JobCardScanner <see cref="Models.Dealer"/>
/// (+ a Dealer Admin login) for each one, instead of the two seeded demo dealers being the only
/// ones that ever exist. Plain ADO.NET (Microsoft.Data.SqlClient, already a transitive
/// dependency of the SQL Server EF provider this project already uses) rather than a second EF
/// DbContext, since this is a single read-only query against a schema this app doesn't own or
/// migrate. Query and column names are copied from a working query against this exact BaplFinal
/// database in another BGauss internal app - do not change the table/column names without
/// verifying against that schema first.
/// </summary>
public class BaplDealerService : IBaplDealerService
{
    private readonly IConfiguration _config;

    public BaplDealerService(IConfiguration config)
    {
        _config = config;
    }

    public async Task<IReadOnlyList<BaplDealerRow>> FetchActiveDealersAsync(CancellationToken ct = default)
    {
        var connStr = _config.GetConnectionString("BaplConnection");
        if (string.IsNullOrWhiteSpace(connStr))
        {
            throw new InvalidOperationException(
                "BaplConnection isn't configured in appsettings.json's ConnectionStrings section.");
        }

        const string sql = @"
            SELECT
                c.CustomerCode,
                c.CustomerName,
                ISNULL(ci.CityName, '')     AS City,
                ISNULL(st.StateName, '')    AS State,
                ISNULL(c.Mobile, '')        AS Mobile,
                ISNULL(c.ContactPerson, '') AS ContactPerson,
                ISNULL(c.Email, '')         AS ContactEmail,
                rep.InternalRepresentative  AS AssignedRepCode
            FROM [dbo].[C_CustomerMaster] c
            LEFT JOIN [dbo].[C_StateMaster] st ON st.Id = c.StateId
            LEFT JOIN [dbo].[C_CityMaster]  ci ON ci.Id = c.CityId
            OUTER APPLY (
                -- A customer can in principle have more than one C_CustomerIntRepDetail row
                -- (e.g. reassigned reps over time) - take the most recently modified one.
                SELECT TOP 1 r.InternalRepresentative
                FROM [dbo].[C_CustomerIntRepDetail] r
                WHERE r.CustomerCode = c.CustomerCode
                ORDER BY r.ModifiedOn DESC
            ) rep
            WHERE c.Active = 'Y'
            ORDER BY c.CustomerName";

        var results = new List<BaplDealerRow>();
        try
        {
            await using var conn = new SqlConnection(connStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                results.Add(new BaplDealerRow(
                    rdr["CustomerCode"] as string ?? "",
                    rdr["CustomerName"] as string ?? "",
                    rdr["City"] as string ?? "",
                    rdr["State"] as string ?? "",
                    rdr["Mobile"] as string ?? "",
                    rdr["ContactPerson"] as string ?? "",
                    rdr["ContactEmail"] as string ?? "",
                    rdr["AssignedRepCode"] as string));
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                $"Could not read BAPL's dealer master (C_CustomerMaster): {ex.Message}", ex);
        }

        return results;
    }
}