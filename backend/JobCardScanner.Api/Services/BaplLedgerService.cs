using Microsoft.Data.SqlClient;

namespace JobCardScanner.Api.Services;

/// <summary>
/// One customer read from the BAPL ERP's C_CustomerMaster (baplfinal, via BaplConnection - the SAME database and the SAME table BaplDealerService.FetchActiveDealersAsync
/// already reads, with the same City / State name joins), for the Ledger Master's ERP-sourced ledger types (Dealer, Company).
/// Read-only; City / State arrive as names (C_CityMaster.CityName / C_StateMaster.StateName), already resolved.
/// </summary>
public record ErpLedgerCustomerRow(
    string CustomerCode,
    string CustomerName,
    string? Address1,
    string? Address2,
    string? Address3,
    string? City,
    string? State,
    string? ZipCode,
    string? Mobile,
    string? Email,
    string? Active,
    DateTime? CreatedOn,
    DateTime? ModifiedOn);

public interface IBaplLedgerService
{
    /// <summary>Where the customers are read from, for the "Sync from ERP" message ("BaplConnection (baplfinal)").</summary>
    string SourceDescription { get; }

    /// <summary>
    /// Every C_CustomerMaster customer that has a C_CustomerTypeGroupDetail row of the given ERP customer type (C_CustomerTypeMaster.Id: 1 = Dealer, 5 = B2B, which is the
    /// Ledger Master's "Company"). A customer with several group rows (e.g. CUS0030 in groups 1 and 2) is returned once. Inactive customers are included
    /// (Active = 'N') so the caller can deactivate the matching ledger.
    /// <paramref name="onlyCustomerCodes"/>: when given, only those customer codes are returned (Company = just CUS0032, BGAUSS AUTO PRIVATE LIMITED); null / empty = every customer
    /// of the type. Throws <see cref="InvalidOperationException"/> with a human-readable message if BaplConnection isn't configured or the query fails (network / credentials / schema).
    /// </summary>
    Task<IReadOnlyList<ErpLedgerCustomerRow>> GetCustomersByTypeAsync(int erpCustomerTypeId, IReadOnlyCollection<string>? onlyCustomerCodes = null, CancellationToken ct = default);
}

/// <summary>
/// Reads the ERP customers behind the Ledger Master's Dealer and Company ledgers from BAPL's ERP data warehouse. Plain ADO.NET (Microsoft.Data.SqlClient) like
/// BaplDealerService - a single read-only query against a schema this app doesn't own or migrate. Tables and columns (C_CustomerMaster, C_CustomerTypeGroupDetail,
/// C_StateMaster, C_CityMaster) are the ones BaplDealerService's working query and your pasted `select *` dumps already confirm - do not rename them without
/// checking that schema first.
/// </summary>
public class BaplLedgerService : IBaplLedgerService
{
    private readonly IConfiguration _config;
    private readonly ILogger<BaplLedgerService> _logger;

    public BaplLedgerService(IConfiguration config, ILogger<BaplLedgerService> logger)
    {
        _config = config;
        _logger = logger;
    }

    public string SourceDescription => "BaplConnection (baplfinal)";

    public async Task<IReadOnlyList<ErpLedgerCustomerRow>> GetCustomersByTypeAsync(int erpCustomerTypeId, IReadOnlyCollection<string>? onlyCustomerCodes = null, CancellationToken ct = default)
    {
        var connStr = _config.GetConnectionString("BaplConnection");
        if (string.IsNullOrWhiteSpace(connStr))
            throw new InvalidOperationException("BaplConnection isn't configured in appsettings.json's ConnectionStrings section.");

        // EXISTS (not a JOIN) so a customer with two group rows of the same type still comes back once. City / State names come from the same LEFT JOINs
        // BaplDealerService.FetchActiveDealersAsync uses (C_StateMaster.Id = StateId, C_CityMaster.Id = CityId).
        var codes = (onlyCustomerCodes ?? Array.Empty<string>()).Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Take(500).ToList();
        var codeFilter = codes.Count == 0 ? "" : "\n              AND cm.CustomerCode IN (" + string.Join(",", codes.Select((_, i) => $"@c{i}")) + ")";

        var sql = $@"
            SELECT
                cm.CustomerCode, cm.CustomerName, cm.Address1, cm.Address2, cm.Address3,
                ISNULL(ci.CityName, '')  AS City,
                ISNULL(st.StateName, '') AS State,
                cm.ZipCode, cm.Mobile, cm.Email, cm.Active, cm.CreatedOn, cm.ModifiedOn
            FROM [dbo].[C_CustomerMaster] cm
            LEFT JOIN [dbo].[C_StateMaster] st ON st.Id = cm.StateId
            LEFT JOIN [dbo].[C_CityMaster]  ci ON ci.Id = cm.CityId
            WHERE cm.CustomerCode IS NOT NULL
              AND EXISTS (SELECT 1 FROM [dbo].[C_CustomerTypeGroupDetail] gd
                          WHERE gd.CustomerCode = cm.CustomerCode AND gd.CustomerType = @typeId){codeFilter}
            ORDER BY cm.CustomerName";

        var results = new List<ErpLedgerCustomerRow>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            await using var conn = new SqlConnection(connStr);
            await conn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
            cmd.Parameters.AddWithValue("@typeId", erpCustomerTypeId);
            for (var i = 0; i < codes.Count; i++) cmd.Parameters.AddWithValue($"@c{i}", codes[i]);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var code = Text(rdr["CustomerCode"])?.Trim();
                if (string.IsNullOrEmpty(code) || !seen.Add(code)) continue;
                results.Add(new ErpLedgerCustomerRow(
                    code,
                    Text(rdr["CustomerName"])?.Trim() ?? code,
                    Text(rdr["Address1"]), Text(rdr["Address2"]), Text(rdr["Address3"]),
                    Text(rdr["City"]), Text(rdr["State"]),
                    Text(rdr["ZipCode"]), Text(rdr["Mobile"]), Text(rdr["Email"]), Text(rdr["Active"]),
                    rdr["CreatedOn"] as DateTime?, rdr["ModifiedOn"] as DateTime?));
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read ERP customers of customer type {ErpType} from BaplConnection.", erpCustomerTypeId);
            throw new InvalidOperationException($"Could not read BAPL's customers of ERP customer type {erpCustomerTypeId} (C_CustomerMaster / C_CustomerTypeGroupDetail): {ex.Message}", ex);
        }

        return results;
    }

    // ZipCode / Mobile may be stored as numbers or text - ToString() reads either.
    private static string? Text(object value) => value is DBNull or null ? null : value.ToString();
}