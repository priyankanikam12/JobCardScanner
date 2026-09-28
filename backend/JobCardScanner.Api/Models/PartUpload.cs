// using System.ComponentModel.DataAnnotations;
// using System.ComponentModel.DataAnnotations.Schema;

// namespace JobCardScanner.Api.Models;

// // =====================================================================================
// // 2026-09-21 "Part Upload" tab ("new tab add Part Upload using this excel create table and
// // functionality to upload using this excel file for upload" - referring to the attached
// // "Stock Summary Detail Report from 01-04-2026 to 21-09-2026 of MAGNEMITE MOTO LLP-DELHI...xlsx").
// //
// // FACT (confirmed by opening that file - it has one sheet, "StockSummaryDetail", 579 data rows):
// // header row 1 is exactly: Part_No | Description | OpenBal | Purchase | Receipt | PPurChln |
// // Total | Sale | BrIss | MtrlIss | StAdj | PartsChln | PurReturn | SaleReturn | SaleChln |
// // BalQty | BalAmnt | QtyReqd | MinOrder | BillPrice | HSNSAC_Code | Group Name | Item Type.
// // There is NO tax-rate/GST/CGST/SGST/IGST column in this file - it is a point-in-time STOCK
// // report (opening/purchase/sale/closing quantities for one date range), not a tax-rate master.
// // Importing it does NOT solve the separate "auto-fetch GST% after item select" request from the
// // same message - that still needs its own confirmed source (see MaterialTransferCreatePage.tsx's
// // doc comment on this gap) and is intentionally NOT invented here.
// //
// // "that all from save in JobCardScannerDb ... all flow with JobCardScannerDb" (your follow-up,
// // same message): this table lives in JobCardScannerDb, like every other *Docs table added this
// // project - NOT written into DMS/DMSBAPLDATA's live PartsInventory/ItemMaster (uploading an
// // arbitrary spreadsheet straight into the production DMS's real inventory tables would risk
// // corrupting live stock data with no undo - a materially different, much higher-stakes feature
// // than "create a table here and let me upload into it", which is what was asked).
// //
// // Upsert key is (DealerId, LocationCode, PartNo) - matches LabourMasterImportService's
// // "duplicate data dont add update same data" convention: re-uploading a newer report for the
// // same dealer+location updates the existing row's stock figures in place rather than
// // accumulating duplicate rows per part. BalQty/BalAmnt (and the other stock columns) reflect the
// // stock AS OF the most recently uploaded report for that dealer+location, not a running history -
// // only the latest upload's numbers are kept per part, same "last write wins" shape as Labour
// // Master's own import.
// //
// // 2026-09-21 correction ("before that 4 feild need to select Date, Location ... otherwise dont
// // take the file need to select this feild then upload"): Location and Date are now REQUIRED,
// // picked on the upload form BEFORE the file is accepted (see PartUploadController.Import) - the
// // spreadsheet itself has no Location/Date column of its own (see the FACT note above), so both
// // are supplied by the uploader, exactly like Labour Master's own required Effective Date. Location
// // is scoped to the signed-in user's own accessible workshop locations (same GET /api/bapl-dms/
// // workshops?dealerId=... list every other page's Location dropdown already uses), not free text -
// // this is what lets a re-upload for the SAME location correctly update in place while a different
// // location's report for the same Part No is kept as its own row (real stock genuinely differs by
// // location, same as DMS's own PartsInventory).
// // =====================================================================================

// public class PartUpload
// {
//     public Guid Id { get; set; } = Guid.NewGuid();

//     /// <summary>Scopes one dealer's uploaded stock data from another's - required, set from the
//     /// signed-in user's own DealerId at import time (never taken from the spreadsheet, which has
//     /// no dealer/location column of its own - the filename names one dealer, e.g. "MAGNEMITE MOTO
//     /// LLP-DELHI", but free-text filenames aren't a reliable, queryable key).</summary>
//     public Guid DealerId { get; set; }
//     public Dealer? Dealer { get; set; }

//     /// <summary>Workshop location code (e.g. "CUS0288W1") the uploader picked before uploading -
//     /// see the class doc comment's 2026-09-21 correction. Required; part of the upsert key.</summary>
//     [Required, MaxLength(30)] public string LocationCode { get; set; } = default!;

//     /// <summary>The report's "as of" date, picked on the upload form (the spreadsheet's own
//     /// filename carries a date range, e.g. "01-04-2026 to 21-09-2026", but a filename isn't a
//     /// reliable structured field) - shown alongside each row so a stale upload is obvious.</summary>
//     public DateOnly ReportDate { get; set; }

//     [Required, MaxLength(60)] public string PartNo { get; set; } = default!;
//     [MaxLength(300)] public string? Description { get; set; }

//     [Column(TypeName = "decimal(14,2)")] public decimal? OpenBal { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? Purchase { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? Receipt { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? PPurChln { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? Total { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? Sale { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? BrIss { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? MtrlIss { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? StAdj { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? PartsChln { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? PurReturn { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? SaleReturn { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? SaleChln { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? BalQty { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? BalAmnt { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? QtyReqd { get; set; }
//     [Column(TypeName = "decimal(14,2)")] public decimal? MinOrder { get; set; }
//     /// <summary>The sheet's own "BillPrice" column - the per-unit price used on that dealer's
//     /// bills as of the report date. Not the same confirmed field as ItemMaster.CustPrice (aliased
//     /// Mrp in BaplDmsPartStockRow) - kept separate rather than assumed equal.</summary>
//     [Column(TypeName = "decimal(14,2)")] public decimal? BillPrice { get; set; }

//     [MaxLength(20)] public string? HsnSacCode { get; set; }
//     [MaxLength(80)] public string? GroupName { get; set; }
//     [MaxLength(40)] public string? ItemType { get; set; }

//     [MaxLength(255)] public string? SourceFileName { get; set; }
//     [MaxLength(120)] public string? UploadedBy { get; set; }
//     public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
//     public DateTime? UpdatedAt { get; set; }

//     // =====================================================================================
//     // 2026-09-22 ("in parts-upload page after Bal Qty column add MT Transfer Qty column for
//     // maintaining how much qty was transfered"): NOT a stored column - computed on every GET by
//     // PartUploadService.GetAsync as SUM(MaterialTransferDocItem.Qty) for this dealer, matched by
//     // (ItemCode == PartNo, MaterialTransferDoc.Location == LocationCode) - the exact same match
//     // MaterialTransferDocsController.Create already uses to decrement BalQty when a transfer is
//     // saved (see MaterialTransferDocsController.Create's own partUploadCache lookup), so this
//     // number is guaranteed to reconcile with what actually moved BalQty.
//     //
//     // INTERPRETATION (flagging, not asserting as fact): the sum includes items from Cancelled
//     // Material Transfer docs, not just Draft/Confirmed ones. This is deliberate, not an oversight -
//     // MaterialTransferDocsController.Delete restores the matching PartUploads.BalQty on a hard
//     // delete, but UpdateStatus's Draft->Cancelled transition does NOT touch BalQty (see that
//     // controller's own doc comment: "Scoped to Delete only ... not the UpdateStatus 'Cancelled'
//     // transition"). So a Cancelled doc's quantity is still sitting in the reduced BalQty today -
//     // excluding Cancelled rows here would make MtTransferQty understate what's actually been
//     // deducted from BalQty. If a future change makes Cancel also restore BalQty, this sum should
//     // be narrowed to exclude Cancelled at the same time so the two stay consistent.
//     // =====================================================================================
//     [NotMapped]
//     public decimal MtTransferQty { get; set; }
// }
