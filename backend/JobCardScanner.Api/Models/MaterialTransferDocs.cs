using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace JobCardScanner.Api.Models;

/// <summary>
/// 2026-09-19 "now i want Create Repair Bill and Material Transfer Bill ... i want to now this
/// both pages data i want save in JobCardScannerDb", field set re-checked 2026-09-21 against the
/// pasted reference source ("backend logic which i gave u ... dont chnage ... logic") - a Material
/// Transfer document created directly inside JobCardScanner (own, writable database), NOT
/// BAPLDMSvad's own (flat, one-row-per-line) MaterialTransfer table and NOT the "Material Transfer
/// Report" page's DmsBaplDataMaterialTransferRow (a read-only DMSBAPLDATA sync).
///
/// The reference's MaterialTransfer table carries NO CGST/SGST/IGST columns at all - tax is only
/// ever computed live, for DISPLAY, in MaterialTransferRepo.GetMeterialByJobId (an HSN-code +
/// dealer/customer-state tax-master lookup against BAPLDMSvad's own HsnwiseTaxCodes/
/// AggregateTaxCodes, which JobCardScannerDb has no equivalent of) - so this table not storing tax
/// either is a faithful match, not an omission. RackNo/Bin/SerialNo/Mrp/ValidDays/ItemReceived
/// below are real reference MaterialTransfer columns that the first version of this file dropped -
/// added back on MaterialTransferDocItem, since each "item" row here corresponds 1:1 to one of the
/// reference's flat MaterialTransfer rows (this app groups them under one document header per
/// transfer instead of leaving every line as its own top-level row - a structural adaptation to
/// this app's own "document with line items" convention (see EstimateLine, JobCardPart), not a
/// change to any stored value or computation).
///
/// One reference rule IS ported: MaterialTransferService.DeleteMaterialsByJobId blocks a non-
/// SuperAdmin delete when "this job card has already been billed" (RepairBillHeader.RepairbillStatus
/// == "Billed" for the same JobId) - MaterialTransferDocsController.Delete enforces the identical
/// check (a RepairBillDoc for the same JobCardId with Status == Billed) unless the caller is
/// SystemAdmin. The reference's stock-ledger reversal on delete (PartsInventory "SD" transaction)
/// is NOT ported - it debits/credits BAPL DMS's own live PartsInventory table in BAPLDMSvad, which
/// this app cannot write to and has no equivalent live-stock table for; see the delivery notes.
///
/// 2026-09-21 ("part-upload balance qty use for that stock ... we delete thi material tranfer
/// then as it is add this bal qty in part-upload page"): a SEPARATE, app-own stock adjustment was
/// added against JobCardScannerDb's own PartUploads.BalQty (not BAPLDMSvad's PartsInventory,
/// still unported per above) - MaterialTransferDocsController.Create decrements the matching
/// PartUploads row (same dealer, same Location, same PartNo) by each line's Qty, and Delete adds
/// it back. Only lines whose Item Code has a matching PartUploads row are touched; a line picked
/// from live DMS stock is not.
/// </summary>
public enum MaterialTransferDocType { Issue, Return }
public enum MaterialTransferDocStatus { Draft, Confirmed, Cancelled }

/// <summary>2026-09-22 ("which Rate Type * is Partwise from this we upload FOR Part Code add
/// Labour Code also that was wants to integrate in material transfer" - confirmed against the
/// mt-labour_add.mp4 recording of the real BGauss DMS at mydmsconnect.com/MtrlTranN.aspx): every
/// Material Transfer line was implicitly a Part until now - this is the first itemType concept
/// this table has ever had. Defaults to Part so every existing row/request that never set it keeps
/// behaving exactly as before (back-compatible, not a breaking change to the Create payload
/// shape).</summary>
public enum MaterialTransferDocItemType { Part, Labour }

public class MaterialTransferDoc
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Minted via IJobCardNumberingService.NextMaterialTransferNumberAsync, e.g.
    /// "MT-DL01-2026-000001" - same per-dealer Counter-table convention as Estimate/Invoice
    /// numbers, not BAPL DMS's own document numbering.</summary>
    [Required, MaxLength(40)] public string TransferNumber { get; set; } = default!;

    public Guid DealerId { get; set; }
    public Dealer? Dealer { get; set; }

    /// <summary>Optional link to the JobCardScanner job card parts were transferred against -
    /// null for a standalone transfer (e.g. a fleet party or a stock-adjustment transfer with no
    /// job card of its own in this app).</summary>
    public Guid? JobCardId { get; set; }
    public JobCard? JobCard { get; set; }

    /// <summary>Free-text workshop location label (e.g. dealer's own city/workshop name) - this
    /// app has no DMS LocCode of its own to store here, unlike the DMSBAPLDATA-sourced report.</summary>
    [MaxLength(150)] public string? Location { get; set; }
    public MaterialTransferDocType TransferType { get; set; } = MaterialTransferDocType.Issue;
    /// <summary>Free-text issue type/reason, e.g. "Job Card Issue", "Stock Adjustment" - kept as
    /// text for the same reason as RepairBillDoc.IssueType.</summary>
    [MaxLength(60)] public string? IssueType { get; set; }
    /// <summary>To/From party - free text (e.g. source location) for a return. Reference:
    /// MaterialTransfer has no PartyName column at all - TechnicianId below is the reference's
    /// actual Technician field.</summary>
    [MaxLength(200)] public string? PartyName { get; set; }

    /// <summary>Reference: MaterialTransfer.Technician (an int employee id into BAPL DMS's own
    /// staff table, which this app has no access to). Mapped onto this app's own User instead of
    /// copying a foreign int that means nothing in JobCardScannerDb - "according to our project"
    /// per your instruction, same reasoning JobCardWorklog.TechnicianId already uses.</summary>
    public Guid? TechnicianId { get; set; }
    public User? Technician { get; set; }

    public MaterialTransferDocStatus Status { get; set; } = MaterialTransferDocStatus.Draft;

    [Column(TypeName = "decimal(12,2)")] public decimal TotalAmount { get; set; }
    [MaxLength(1000)] public string? Remarks { get; set; }

    /// <summary>Reference: MaterialTransfer rows are hard-deleted (ExecuteDeleteAsync) by
    /// MaterialTransferRepo.DeleteMaterialsByJobId/DeleteMaterials, not soft-deleted like
    /// RepairBillHeader.IsDelete - this table's own Delete follows the same hard-delete rule (see
    /// MaterialTransferDocsController.Delete), this column exists only for the standing
    /// "don't change other pages" disclosure trail, not because the reference sets one.</summary>
    public Guid? CreatedById { get; set; }
    public User? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateOnly TransferDate { get; set; } = DateOnly.FromDateTime(DateTime.UtcNow);

    public ICollection<MaterialTransferDocItem> Items { get; set; } = new List<MaterialTransferDocItem>();
}

public class MaterialTransferDocItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MaterialTransferDocId { get; set; }
    public MaterialTransferDoc? MaterialTransferDoc { get; set; }

    /// <summary>Optional link into this app's own PartMaster - left null for a line typed in
    /// free-hand (e.g. a part not yet in PartMaster), same optionality as JobCardPart.PartId.</summary>
    public Guid? PartId { get; set; }
    public PartMaster? Part { get; set; }

    [Required, MaxLength(60)] public string ItemCode { get; set; } = default!;
    [Required, MaxLength(300)] public string ItemDescription { get; set; } = default!;

    /// <summary>2026-09-22 - see MaterialTransferDocItemType's own doc comment. Part = a real
    /// item line (the only kind that ever existed before this round, and the only kind the
    /// PartUploads.BalQty decrement in MaterialTransferDocsController.Create/Delete applies to).
    /// Labour = a Labour Master Partwise code added via the new "Labour" picker against a Part
    /// line already on this document (MaterialTransferCreatePage.tsx's PartwiseLabourModal) -
    /// never touches PartUploads stock, has no PartId/RackNo/Bin/SerialNo/Mrp/ValidDays/
    /// ItemReceived of its own (left null/default on a Labour row, matching how
    /// RepairBillDocItem's own Labour rows leave Mrp empty).</summary>
    public MaterialTransferDocItemType ItemType { get; set; } = MaterialTransferDocItemType.Part;

    /// <summary>2026-09-22: per-line Technician, matching the reference's own "Labour Technician"
    /// dropdown in its Labour List popup (seen in mt-labour_add.mp4, defaulting to the document's
    /// own header Technician but independently changeable per Labour line). NOT wired to a picker
    /// in the UI yet, deliberately - MaterialTransferDoc.TechnicianId's own doc comment already
    /// discloses that this page's role level (ServiceAdvisorUp) has no accessible technician
    /// catalog endpoint to pick from (GET /api/users needs DealerAdminUp), so the header-level
    /// Technician field is left unset from this quick-entry form today too. Added here now
    /// (nullable, always null until that gap is fixed) so the column/FK exists and nothing needs
    /// another schema change once a ServiceAdvisorUp-scoped technician list does exist.</summary>
    public Guid? TechnicianId { get; set; }
    public User? Technician { get; set; }

    /// <summary>ADDED 2026-09-21 (third correction): the reference grid has its own "HSN Code"
    /// column, confirmed from the MT.mp4 recording you attached (a row you added there showed
    /// "85446090" auto-filled the moment a part was picked) - this app's own PartSearchInput
    /// already carries BaplDmsPartStock.hsnCode for that same purpose (RepairBillDocItem already
    /// stores it; this field brings MaterialTransferDocItem to parity), auto-filled client-side in
    /// MaterialTransferCreatePage.tsx's pickPartForLine, not typed by hand.</summary>
    [MaxLength(20)] public string? HsnCode { get; set; }

    /// <summary>CORRECTED 2026-09-21: reference `MaterialTransfer.IssueType` is a required
    /// per-row int (not a header-level free-text "reason", which this app's own
    /// MaterialTransferDoc.IssueType actually is - that field has no reference equivalent and is
    /// kept separately). Re-read material-transfer-detail.ts directly: its own dropdown
    /// (`issueTypes = IssueTypes.filter(x => x.id === 1 || x.id === 2)`) resolves to exactly two
    /// values, confirmed against the reference app's own screenshot to be "Paid" and "U/W" - kept
    /// as free text (matching the reference's own untyped-at-this-layer string once resolved from
    /// its id) rather than an enum, since the full canonical IssueTypes id/name list (a shared
    /// `constant.ts` you did not paste) was never confirmed beyond these two values.</summary>
    [MaxLength(30)] public string? IssueType { get; set; }

    public double Qty { get; set; } = 1;
    [Column(TypeName = "decimal(12,2)")] public decimal Rate { get; set; }
    [Column(TypeName = "decimal(12,2)")] public decimal Amount { get; set; }

    // ---- Reference: MaterialTransfer.RackNo/Bin/SerialNo/Mrp/ValidDays/ItemReceived - real
    // columns on the reference's flat table, dropped from the first version of this file, added
    // back here so nothing the reference actually stores is lost. ----
    /// <summary>Reference: MaterialTransfer.RackNo (free-text bin-rack label).</summary>
    [MaxLength(30)] public string? RackNo { get; set; }
    /// <summary>Reference: MaterialTransfer.Bin.</summary>
    [MaxLength(30)] public string? Bin { get; set; }
    /// <summary>Reference: MaterialTransfer.SerialNo.</summary>
    [MaxLength(100)] public string? SerialNo { get; set; }
    /// <summary>Reference: MaterialTransfer.Mrp - MRP is display/reference data only, separate
    /// from Rate (the actual issue rate this line is transferred at).</summary>
    [Column(TypeName = "decimal(12,2)")] public decimal? Mrp { get; set; }
    /// <summary>Reference: MaterialTransfer.ValidDays (e.g. warranty/return validity window in days).</summary>
    public int? ValidDays { get; set; }
    /// <summary>Reference: MaterialTransfer.ItemReceived - free-text/flag noting whether the
    /// returned item was physically received back (kept as text, matching the reference's own
    /// untyped column rather than assuming it's boolean).</summary>
    [MaxLength(30)] public string? ItemReceived { get; set; }
}
