using ClosedXML.Excel;

namespace JobCardScanner.Api.Services;

/// <summary>Used by the Reports module (job cards, invoices, parts-usage, technician productivity, etc.)
/// to export whatever table a controller assembled to a downloadable .xlsx.</summary>
public class ExcelExportService : IExcelExportService
{
    public byte[] Export(string sheetName, IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<object?>> rows)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add(string.IsNullOrWhiteSpace(sheetName) ? "Report" : sheetName);

        for (var i = 0; i < headers.Count; i++)
        {
            var cell = sheet.Cell(1, i + 1);
            cell.Value = headers[i];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#E5E7EB");
        }

        for (var r = 0; r < rows.Count; r++)
        {
            var row = rows[r];
            for (var c = 0; c < row.Count; c++)
            {
                var value = row[c];
                var cell = sheet.Cell(r + 2, c + 1);
                switch (value)
                {
                    case null: cell.Value = string.Empty; break;
                    case DateTime dt: cell.Value = dt; break;
                    case DateOnly d: cell.Value = d.ToDateTime(TimeOnly.MinValue); break;
                    case int or long or double or float or decimal: cell.Value = Convert.ToDouble(value); break;
                    case bool bo: cell.Value = bo; break;
                    default: cell.Value = value.ToString(); break;
                }
            }
        }

        sheet.Columns().AdjustToContents();
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }
}
