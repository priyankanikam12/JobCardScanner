namespace JobCardScanner.Api.Services;

public interface IExcelExportService
{
    /// <summary>Generic XLSX export: one sheet, a header row, and a grid of cell values.</summary>
    byte[] Export(string sheetName, IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<object?>> rows);
}
