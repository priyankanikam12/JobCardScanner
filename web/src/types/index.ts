// web\src\types\index.ts
// Shared TypeScript types mirroring the backend's C# enums/DTOs (see backend/JobCardScanner.Api/Models).

// 2026-10-01 ("Captain / Technician / Vice Captain ... this role also add"): added 'Captain' and
// 'ViceCaptain' below, per explicit request, so MenuAccessPage.tsx's ALL_ROLES (and anywhere else
// in the web app that references StaffRole) type-checks with these two included. NAMING -
// Interpretation/Assumption, not confirmed: your screenshot showed "Vice Captain" with a space (as
// Designation-dropdown display text), but every other role here is a single PascalCase word with
// no space - used 'ViceCaptain' to match. Tell me if the real backend enum value is spelled
// differently and I'll fix it here (a one-line change).
//
// FLAGGED - this alone does not make Captain/Vice Captain real, working login roles. This file is
// a FRONTEND MIRROR of the backend's real StaffRole C# enum (see this file's own header comment) -
// I still don't have that backend enum or Auth/Policies.cs in this session. Until those are
// updated too (and the backend actually issues/accepts these roles at login), a user can't really
// log in as Captain/Vice Captain - this file only stops the frontend from refusing to compile when
// those two strings are used. Please send backend/JobCardScanner.Api/Models (wherever StaffRole is
// defined) and Auth/Policies.cs so I can wire this through end-to-end.
export type StaffRole =
  | 'ServiceAdvisor'
  | 'WorkshopManager'
  | 'Supervisor'
  | 'Technician'
  | 'PartsUser'
  | 'Cashier'
  | 'DealerAdmin'
  | 'CorporateAdmin'
  | 'SystemAdmin'
  | 'Captain'
  | 'ViceCaptain'

export type JobCardStatus =
  | 'Open'
  | 'InProgress'
  | 'PendingCustomerApproval'
  | 'PendingQc'
  | 'PendingClosure'
  | 'PendingInvoice'
  | 'Closed'
  | 'Cancelled'

export type ServiceType = 'FreeService' | 'PaidService' | 'Warranty' | 'AccidentRepair' | 'Breakdown' | 'Pdi' | 'GoodwillService'
export type JobCardSource = 'WalkIn' | 'PickupAndDrop' | 'Breakdown' | 'Scheduled' | 'Online'
export type JobCardPriority = 'Normal' | 'High' | 'Urgent'
export type EstimateStatus = 'Draft' | 'PendingCustomerApproval' | 'Approved' | 'Rejected' | 'Expired'
export type InvoiceStatus = 'Draft' | 'Generated' | 'Paid' | 'Cancelled'
export type PaymentMode = 'Cash' | 'Card' | 'Upi' | 'NetBanking' | 'Wallet' | 'Pending'
export type PhotoStage = 'CheckIn' | 'Inspection' | 'Repair' | 'Qc' | 'Delivery' | 'PartSuggestion'

export interface Dealer {
  id: string
  name: string
  code: string
  city?: string | null
  baplDmsDealerCode?: string | null
}

// ---------------- DMS integration (Job Card Wizard dealer/vehicle auto-fill) ----------------
export interface BaplDealerResolveResult extends Dealer {
  loginCreated?: boolean
  loginEmail?: string | null
  defaultPassword?: string | null
}

export interface BaplDmsDealer {
  dealerCode: string
  dealerName: string
  city: string
  state: string
  mobile: string
  email: string
  contactPerson: string
}

export interface BaplDmsJobCardDetail {
  jobCardHeaderId: number
  jobNo?: number | null
  jobPrefix?: string | null
  jobInDate?: string | null
  jobStatus?: string | null
  inwardType?: string | null
  vehicleKms?: number | null
  supervisor?: string | null
  technician?: string | null
  invoiceNo?: string | null
  dealerCode?: string | null
  customerName?: string | null
  customerMobile?: string | null
  customerAltMobile?: string | null
  modelName?: string | null
  chassisNo?: string | null
  registerNo?: string | null
  motorNo?: string | null
  batteryNo?: string | null
  saleDate?: string | null
  insuranceExpDate?: string | null
  nextServiceDueDate?: string | null
  rsaRenewalDate?: string | null
  remarks?: string | null
  controllerNo?: string | null
  converterNo?: string | null
  chargerNo?: string | null
  complaints?: string | null
}

export interface BaplDmsJobCardHistory {
  jobCardHeaderId: number
  jobNo?: number | null
  jobPrefix?: string | null
  jobInDate?: string | null
  jobStatus?: string | null
  inwardType?: string | null
  vehicleKms?: number | null
  supervisor?: string | null
  technician?: string | null
  invoiceNo?: string | null
  complaints?: string | null
}

export interface BaplDmsVehicleLookup {
  chassisNo: string
  registerNo?: string | null
  modelName?: string | null
  customerName?: string | null
  customerMobile?: string | null
  batteryNumber?: string | null
  motorNo?: string | null
  controllerNo?: string | null
  converterNo?: string | null
  chargerNumber?: string | null
  saleDate?: string | null
  insuranceExpDate?: string | null
  nextServiceDueDate?: string | null
  vehiclePrevKms?: number | null
  odoReading?: number | null
  duration?: number | null
  durationType?: string | null
  expireWarrantyDate?: string | null
  isSold: boolean
  // Added when the lookup was rewritten to source from DMS's ChassisDetails/LedgerMaster
  // vehicle master (see BaplDmsService.LookupVehicleAsync) - customer city, the LedgerMaster.Id
  // this customer is known by in DMS (used for the job card write-back), and the workshop
  // location (LocationMaster.Loccode) this chassis is registered against.
  customerCity?: string | null
  customerLedgerId?: number | null
  locationCode?: string | null
  dealerCode?: string | null
  // Set server-side (BaplDmsController.VehicleLookup) when this chassis already has an open job
  // card - either in JobCardScanner's own JobCards (openJobCardSource "local") or in DMS's own
  // job card history (openJobCardSource "bapl-dms") - so the wizard can warn immediately on
  // selecting the chassis instead of only at final submit. See BaplDmsVehicleRow's doc comment.
  openJobCardNumber?: string | null
  openJobCardSource?: 'local' | 'bapl-dms' | null
  openJobCardStatus?: string | null
  // Best-effort LedgerMaster.Address/Email - see BaplDmsVehicleRow's doc comment in
  // BaplDmsService.cs on why these two specifically are not guaranteed to be populated.
  customerAddress?: string | null
  customerState? : string | null
  customerEmail?: string | null
  // Battery Details panel fields the print preview previously had nowhere to source (see
  // BaplDmsService.LookupVehicleAsync's ChassisBatteryDetails enrichment) - now read straight from
  // DMS's own ChassisBatteryDetails table.
  batteryChemical?: string | null
  batteryCapacity?: string | null
  batteryMake?: string | null
}

/// One active "W" series workshop location from DMS's own LocationMaster.
export interface BaplDmsWorkshop {
  locCode: string
  locName: string
  city: string
  state: string
  dealerCode: string
}

export interface BaplDmsJobType {
  id: number
  name: string
}

export interface BaplDmsServiceHead {
  id: number
  jobTypeId: number
  name: string
}

export interface BaplDmsServiceType {
  id: number
  serviceHeadId: number
  name: string
}

export interface BaplDmsComplaint {
  id: number
  name: string
  groupName?: number | null
}

/// One row from DMS's JobSource master (Walk In / RSA / Mega Camp / ...) - replaces the
/// wizard's old hardcoded WalkIn/PickupAndDrop/Breakdown/Scheduled/Online "Source" dropdown.
export interface BaplDmsJobSource {
  id: number
  name: string
}

/// Available stock for one item at one workshop location, from DMS's own PartsInventory - see
/// BaplDmsPartStockRow's doc comment in BaplDmsService.cs for the (now confirmed via a live
/// SELECT *) "available" rule this uses.
export interface BaplDmsPartStock {
  itemCode: string
  availableQty: number
  /// Best-effort - see BaplDmsPartStockRow's doc comment in BaplDmsService.cs (guessed from an
  /// unconfirmed [dbo].[ItemMaster] table). May be null even for a real item.
  description?: string | null
  mrp?: number | null
  hsnCode?: string | null
  /// 2026-09-21 ("this part pick in materil transfer with balance quantity"): set only when this
  /// row was merged in from the "Part Upload" tab (see PartUploadPage.tsx) rather than fetched live
  /// from DMS's own PartsInventory - lets PartSearchInput/pickPartForLine tell the two apart so a
  /// Part-Upload-sourced row is never mistaken for a live DMS stock figure. Undefined/omitted for
  /// every live-DMS row (the vast majority), exactly as before this field existed.
  /// 2026-09-22 ("take Item Code from /item-master ... we cant select"): 'itemMaster' marks a row
  /// that came ONLY from the C_ItemMaster catalog preload (no matching live DMS stock or Part
  /// Upload row at the current Location) - see MaterialTransferCreatePage.tsx/
  /// RepairBillCreatePage.tsx's `parts` builder. availableQty is 0 for these (no real figure known,
  /// not necessarily "0 in stock") - PartSearchInput.tsx renders these differently for that reason.
  source?: 'partUpload' | 'itemMaster'
  /// Only set for a source: 'partUpload' row - PartUpload.BillPrice. NO LONGER used as Rate
  /// directly (2026-09-21: "Bal Amount, Bill Price that was dealer rate not the Rate,MRP, Amount,
  /// CGST Amt SGST Amt IGST Amt that all we want to fetch from baplfinal databse") - kept only for
  /// display/reference; see dlrPrice below for what Rate/MRP/GST are actually derived from now,
  /// for a Part-Upload-sourced row exactly the same as a live-DMS one.
  billPrice?: number | null
  /// 2026-09-21 ("Rate = Dlr_Price - GST% ... fetch from baplfinal databse"): merged in client-side
  /// (see MaterialTransferCreatePage.tsx/RepairBillCreatePage.tsx's itemMasterByCode lookup, built
  /// from GET /api/item-master/by-codes) from BAPL's own C_ItemMaster (baplfinal) by ItemCode -
  /// NOT part of the raw GET /api/bapl-dms/parts or /api/part-uploads response. Dlr_Price is
  /// C_ItemMaster's dealer price, GST-INCLUSIVE (same role Mrp played before this round, just a
  /// confirmed real per-item figure instead of BAPLDMSvad ItemMaster's CustPrice). sgstPct/cgstPct/
  /// igstPct are that same item's own stored tax-master percentages (CONFIRMED via a live
  /// `select * from C_ItemMaster` - see BaplItemMasterRow's doc comment in BaplDealerService.cs).
  /// Undefined when this item code has no C_ItemMaster match - callers fall back to the previous
  /// Mrp/default-18%-split behavior in that case (see pickPartForLine).
  dlrPrice?: number | null
  sgstPct?: number | null
  cgstPct?: number | null
  igstPct?: number | null
}

/// One row from BAPL's C_ItemMaster (baplfinal) - see BaplItemMasterRow's doc comment in
/// BaplDealerService.cs for the confirmed schema/sample data. Backs the "Item Master" sidebar page.
export interface BaplItemMaster {
  itemCode: string
  itemName?: string | null
  displayName?: string | null
  hsnCode?: string | null
  dlrPrice?: number | null
  sgst?: number | null
  cgst?: number | null
  igst?: number | null
  itemType?: string | null
  status?: string | null
  /** 2026-09-25: NOT a C_ItemMaster column (that table has no stock field at all) - this dealer's
   * own uploaded Part Upload stock (PartUploads.BalQty) summed across every location, matched by
   * ItemCode = PartNo. Null means nothing has been uploaded for this part yet, not "0 in stock". */
  qty?: number | null
}

/// One search-as-you-type match for the chassis/registration-no. autocomplete - see
/// BaplDmsVehicleSuggestion's doc comment in BaplDmsService.cs. Pick one to run the full
/// vehicle-lookup (BaplDmsVehicleLookup) the way a manual Search always has.
export interface BaplDmsVehicleSuggestion {
  chassisNo: string
  regNo?: string | null
  modelName?: string | null
  dealerId?: string | null
  saleDate?: string | null
}

/// One labour rate-card row from DMS's own LabourMaster, OR from PartWiseLabourMaster (a
/// second, part-linked rate card unioned in as of 2026-09-03) - see BaplDmsLabourRow's doc comment
/// in BaplDmsService.cs for the confirmed schema and the cascade-id/NULL-handling caveats.
export interface BaplDmsLabourRow {
  id: number
  labourCode: string
  labourDescription?: string | null
  hsnCode?: string | null
  sgst?: number | null
  cgst?: number | null
  igst?: number | null
  labourRate?: number | null
  category?: string | null
  jobTypeId?: number | null
  serviceHeadId?: number | null
  serviceTypeId?: number | null
  oemModelName?: string | null
  /// "LabourMaster" or "PartWiseLabourMaster" - tells the two source tables apart in the picker.
  source?: string
  /// Only ever set on a PartWiseLabourMaster row - the specific part this labour rate is tied to.
  partCode?: string | null
  partDescription?: string | null
}

/// One repair bill DMS has for a job card - for the Detail page's "Download Invoice from DMS"
/// panel. Deliberately narrow (see BaplDmsRepairBillRow's doc comment).
export interface BaplDmsRepairBill {
  id: number
  repairBillStatus?: string | null
  totalNetAmount?: number | null
}

/// One Part/Labour line from a DMS repair bill - see BaplDmsInvoiceLineItemDto's doc comment in
/// IInvoicePdfService.cs. Code/Description/Hsn are best-effort placeholders (no confirmed part/
/// labour-name master table exists anywhere in this codebase), never a guessed join.
export interface BaplDmsInvoiceLineItem {
  code: string
  description: string
  hsn: string
  qty: number
  rate: number
  discount: number
  taxable: number
  netAmount: number
  isPart: boolean
}

/// Whole shaped repair-bill breakdown for one DMS job card - GET /api/bapl-dms/job-cards/{id}/line-items.
/// 404 (not this shape) means no repair bill raised for this job in DMS yet - normal for one still Open.
export interface BaplDmsInvoiceLineItemsResult {
  items: BaplDmsInvoiceLineItem[]
  partTotal: number
  labourTotal: number
  invoiceTotal: number
  repairBillStatus?: string | null
  invoiceNo?: string | null
}

/// One Part/Labour line item on a DMSBAPLDATA-sourced repair bill (dbo.DMS_RepairBillItem) - see
/// DmsBaplDataRepairBillItemRow's doc comment in DmsBaplDataService.cs. Distinct from
/// BaplDmsInvoiceLineItem above, which is the shaped print-preview breakdown for the LIVE DMS
/// database (BAPLDMSvad) - this is the raw synced row from the separate DMSBAPLDATA database.
export interface DmsBaplDataRepairBillItem {
  id: number
  repairBillId: number
  itemIdno?: number | null
  itemCode?: string | null
  itemDesc?: string | null
  itemType?: string | null
  qty?: number | null
  rate?: number | null
  issueType?: string | null
  sgstPer?: number | null
  sgstAmount?: number | null
  cgstPer?: number | null
  cgstAmount?: number | null
  igstPer?: number | null
  igstAmount?: number | null
  wavRate?: number | null
  totAmnt?: number | null
  mtrlIssue?: string | null
}

/// One repair bill header from DMSBAPLDATA's dbo.DMS_RepairBill - GET /api/dms-bapl-data/repair-bills.
/// See DmsBaplDataRepairBillRow's doc comment in DmsBaplDataService.cs for what DMSBAPLDATA is and
/// how it differs from BAPLDMSvad (the live DMS database BaplDmsRepairBill above comes from).
export interface DmsBaplDataRepairBill {
  id: number
  dealerName?: string | null
  dealerCode?: string | null
  uniqueKey?: number | null
  uniqueId?: number | null
  invoiceNo?: number | null
  invoiceDate?: string | null
  location?: string | null
  partyName?: string | null
  billType?: number | null
  cashType?: string | null
  cashAccount?: string | null
  regNo?: string | null
  chassisNo?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  items: DmsBaplDataRepairBillItem[]
}

/// One labour line on a DMSBAPLDATA-sourced material transfer item (dbo.DMS_MaterialTransferLabor) -
/// see DmsBaplDataMaterialTransferLaborRow's doc comment in DmsBaplDataService.cs.
export interface DmsBaplDataMaterialTransferLabor {
  id: number
  materialTransferItemId: number
  lbrIdno?: number | null
  lbrName?: string | null
  lbrDescription?: string | null
  lbrRate: number
  sgstPer: number
  sgstAmount: number
  cgstPer: number
  cgstAmount: number
  igstPer: number
  igstAmount: number
}

/// One Part/Labour-carrying line item on a DMSBAPLDATA-sourced material transfer
/// (dbo.DMS_MaterialTransferItem) - see DmsBaplDataMaterialTransferItemRow's doc comment in
/// DmsBaplDataService.cs.
export interface DmsBaplDataMaterialTransferItem {
  id: number
  materialTransferId: number
  sourceLineId?: number | null
  itemIdno?: number | null
  itemName?: string | null
  itemDescription?: string | null
  itemType?: string | null
  qty: number
  rate: number
  sgstPer: number
  sgstAmount: number
  cgstPer: number
  cgstAmount: number
  igstPer: number
  igstAmount: number
  discount: number
  mrp: number
  labour: DmsBaplDataMaterialTransferLabor[]
}

/// One material transfer document from DMSBAPLDATA's dbo.DMS_MaterialTransfer, scoped by LocCode -
/// GET /api/dms-bapl-data/material-transfers?locCode=... See DmsBaplDataMaterialTransferRow's doc
/// comment in DmsBaplDataService.cs for what DMSBAPLDATA is.
export interface DmsBaplDataMaterialTransfer {
  id: number
  dealerName?: string | null
  dealerCode?: string | null
  sourceUniqueId?: number | null
  sourceJobId?: number | null
  docNo?: number | null
  docDate?: string | null
  docType?: string | null
  location?: string | null
  locCode?: string | null
  technicianName?: string | null
  uniqueKey?: string | null
  createdAt: string
  updatedAt: string
  items: DmsBaplDataMaterialTransferItem[]
}

/// One vehicle sale row from DMSBAPLDATA's dbo.DMS_VehicleSales, filtered by SoldTo - GET
/// /api/dms-bapl-data/vehicle-sales?soldTo=... See DmsBaplDataVehicleSaleRow's doc comment in
/// DmsBaplDataService.cs for the column-confirmation history (2026-09-18: this shape is now
/// independently confirmed - you ran `select * from DMS_VehicleSales` directly and its columns
/// matched this interface exactly).
///
/// `regNo` and `isImported` are the two exceptions: DMS_VehicleSales itself has no Reg No column
/// (confirmed by that same live query), so `regNo` is ONLY ever populated for rows that came from
/// VehicleSalePage.tsx's "Import Vehicle Sale Report" feature (a real DMS/ERP report export
/// that DOES carry Reg No) - see that page's own doc comment for the full rationale. `isImported`
/// marks exactly those rows so the page can tell imported data apart from DMSBAPLDATA-sourced data.
export interface DmsBaplDataVehicleSale {
  id: number
  dealerName?: string | null
  dealerCode?: string | null
  invoiceNo?: string | null
  regNo?: string | null
  isImported?: boolean
  invoiceDate?: string | null
  location?: string | null
  locCode?: string | null
  locationCity?: string | null
  custDob?: string | null
  gender?: string | null
  soldTo?: string | null
  accountType?: string | null
  partyEmail?: string | null
  cusMob?: string | null
  address1?: string | null
  address2?: string | null
  city?: string | null
  state?: string | null
  executiveName?: string | null
  pin?: string | null
  chassisNo?: string | null
  motorNo?: string | null
  remarks?: string | null
  itemModel?: string | null
  oemmodel?: string | null
  colorCode?: string | null
  vehicleType?: string | null
  vehicleGroup?: string | null
  hsnsaccode?: string | null
  saleType?: string | null
  financedBy?: string | null
  finAmount?: number | null
  itemRate?: number | null
  insuAmount?: number | null
  regnAmount?: number | null
  acsryAmount?: number | null
  preGstdiscAmount?: number | null
  discTypeName?: string | null
  postGstdisc?: number | null
  fameIi?: number | null
  stateFameIi?: number | null
  sgstper?: number | null
  sgstamount?: number | null
  cgstper?: number | null
  cgstamount?: number | null
  igstper?: number | null
  igstamount?: number | null
  netAmount?: number | null
  referenceNo?: string | null
  bookingDate?: string | null
  totalCount?: string | null
  battery?: string | null
  batteryChemical?: string | null
  batteryCapacity?: string | null
  batteryMake?: string | null
  chargerNo?: string | null
  chargerNo2?: string | null
  converter?: string | null
  vcu?: string | null
  controllerNo?: string | null
  fameIirequired?: string | null
  segmentName?: string | null
  institutionalName?: string | null
  schemeName?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

/// One job row from DMSBAPLDATA's dbo.DMS_ServiceHistory, matched by Chassis No OR Reg No - GET
/// /api/dms-bapl-data/service-history?search=... See DmsBaplDataServiceHistoryRow's doc comment in
/// DmsBaplDataService.cs: confirmed against your pasted AutoGeniusSync.Models.DmsServiceHistory EF
/// model and a live `select top 1 *`. Flat job-level totals only - no Item/Labour/Battery line-item
/// breakdown exists in this table (see that same doc comment for why the legacy report PDF's
/// per-part/labour detail can't be shown here).
export interface DmsBaplDataServiceHistory {
  id: number
  dealerCode?: string | null
  jobNo?: string | null
  jobDate?: string | null
  compName?: string | null
  location?: string | null
  inTime?: string | null
  closeTime?: string | null
  jobCategory?: string | null
  ffrpercentage?: string | null
  docNo?: string | null
  docType?: string | null
  docDate?: string | null
  model?: string | null
  brandName?: string | null
  regNo?: string | null
  vehicleType?: string | null
  engineNo?: string | null
  chassisNo?: string | null
  kms?: string | null
  batterySerialNo1?: string | null
  batterySerialNo2?: string | null
  batterySerialNo3?: string | null
  batterySerialNo4?: string | null
  batterySerialNo5?: string | null
  batterySerialNo6?: string | null
  individualAhbattery1?: string | null
  individualAhbattery2?: string | null
  individualAhbattery3?: string | null
  individualAhbattery4?: string | null
  individualAhbattery5?: string | null
  individualAhbattery6?: string | null
  partyName?: string | null
  mobileNumber?: string | null
  supervisor?: string | null
  technician?: string | null
  serviceHead?: string | null
  jobType?: string | null
  saleDate?: string | null
  couponNo?: string | null
  expectedDeliveryDate?: string | null
  proformaDate?: string | null
  invoiceDate?: string | null
  estimatedJobExpenses?: number | null
  labourHours?: number | null
  parts?: number | null
  accessory?: number | null
  oil?: number | null
  labour?: number | null
  outsideWork?: number | null
  totalWotax?: number | null
  gstamount?: number | null
  igstamount?: number | null
  netTotal?: number | null
  createdAt?: string | null
  updatedAt?: string | null
  repairType?: string | null
  completionDate?: string | null
  jobStatus?: string | null
  rowHash?: string | null
  uniqueKey?: string | null
}

/// One suggestion row for the Service History page's typeahead - GET
/// /api/dms-bapl-data/service-history/suggestions?q=... See DmsBaplDataServiceHistorySuggestion's
/// doc comment in DmsBaplDataService.cs: deliberately sourced from DMS_ServiceHistory itself, NOT
/// the Job Card wizard's BaplDmsVehicleSuggestion (a different table - DMS's ChassisDetails).
export interface DmsBaplDataServiceHistorySuggestion {
  chassisNo: string
  regNo?: string | null
  model?: string | null
  lastJobDate?: string | null
}

export interface CurrentUser {
  id: string
  name: string
  email: string
  mobile?: string | null
  role: StaffRole
  dealerId?: string | null
  dealerName?: string | null
  /** DMS's own dealer code (e.g. "CUS0435") - used to scope chassis/reg-no vehicle search to
   * this user's own dealer. See AuthController.Me's DealerBaplDmsCode doc comment. */
  dealerBaplDmsCode?: string | null
  /** This dealer's own State (Dealer.State) - see AuthController.Me's DealerState doc comment.
   * Compared against a party/customer's own State to auto-detect intra-state (CGST+SGST) vs
   * inter-state (IGST) on the Repair Bill / Material Transfer create pages, same compare the
   * reference's repair-bill.ts addLabour()/calculatePart() do. Null if this dealer has no State
   * recorded - callers fall back to a manual pick. */
  dealerState?: string | null
  avatarColor?: string | null
  /** DMS workshop LocCodes (the W1..Wn series) this user is scoped to - see
   * User.WorkLocationCodes's doc comment (backend/Models/MasterData.cs). Empty = unrestricted
   * (every user before the Employees/Work Area feature shipped, and any admin with no locations
   * assigned). Used to filter the Service Location / workshop pickers down to only what this user
   * is actually allowed to use - server-side enforcement (JobCardsController, DmsBaplDataController)
   * is the real gate; this is just so the UI doesn't offer a choice it will only reject. */
  workLocationCodes: string[]
  /** 2026-10-01 ("still not shown his designation is captain"): User.Designation (free-text job
   * title, e.g. "Captain", "Mechanic" - separate from Role, see EmployeesPage.tsx's DESIGNATIONS
   * doc comment), added here so StaffLayout.tsx's topbar badge can show Captain/ViceCaptain users'
   * actual Designation instead of their real (different) backend Role - see that file's
   * badgeLabel() doc comment for the full reasoning.
   *
   * FACT: adding this field here is only HALF the fix. GET /api/auth/me (AuthController.Me, per
   * this interface's own existing dealerBaplDmsCode/dealerState comments just above) has to
   * actually select User.Designation into its response too, or this will just always come back
   * undefined at runtime - exactly what was happening before this field even existed. I don't
   * have AuthController.cs in this session to make that half of the change - still needed. */
  designation?: string | null
}

// ==================== Technician Employee (2026-09-24) ====================
// Mirrors backend Models/Technicians.cs / TechniciansController.cs - a login-less roster of
// technicians, scoped by dealer + workshop location, managed on the "Technician Employee" tab
// (Supervisor role and above only) and consumed as a dropdown on the Job Card Wizard's
// "Technician" field and the Job Card Detail page's "Assign Technician" field. Deliberately NOT a
// User - see Technician.cs's own doc comment.
export interface Technician {
  id: string
  dealerId: string
  name: string
  locationCode: string
  locationName?: string | null
  active: boolean
  createdAt: string
}

export interface CreateTechnicianRequest {
  name: string
  locationCode: string
  locationName?: string | null
}

export interface UpdateTechnicianRequest {
  name?: string | null
  locationCode?: string | null
  locationName?: string | null
  active?: boolean | null
}

/// One row of GET /api/technicians/supervisors - deliberately just {id, name}, not the full
/// CurrentUser/User shape (see TechniciansController.Supervisors' doc comment for why this reads
/// Users directly instead of going through GET /api/users).
export interface SupervisorOption {
  id: string
  name: string
}

// ==================== Local Parts/Labour Catalog (2026-09-24) ====================
// "Part Suggestion and Labour Suggestion that link with our labour-master, item-master and
// part-upload" - GET /api/jobcards/parts-catalog and /api/jobcards/labour-catalog
// (JobCardsController.PartsCatalog/LabourCatalog) - replaces the old DMS-sourced
// /api/bapl-dms/parts and /api/bapl-dms/labour reads for these two pickers specifically. Sourced
// from this app's OWN Item Master (BAPL C_ItemMaster catalog, read-only mirror) + Part Upload
// (dealer-uploaded stock) + Labour Master (imported rate card) - see JobCardsController.cs's own
// doc comment for the exact merge.
export interface JobCardsPartsCatalogRow {
  itemCode: string
  description?: string | null
  hsnCode?: string | null
  mrp?: number | null
  sgst?: number | null
  cgst?: number | null
  igst?: number | null
  /** This item's Part Upload BalQty - at the given locationCode when one was passed, or summed
   * across every location this dealer has uploaded stock for otherwise (2026-09-25 fallback, see
   * JobCardsController.PartsCatalog's doc comment). Null when no Part Upload row matches at all
   * (not necessarily "0 in stock"). */
  availableQty?: number | null
}

export interface JobCardsLabourCatalogRow {
  id: number
  labourCode: string
  labourDescription?: string | null
  hsnCode?: string | null
  labourRate?: number | null
  sgst?: number | null
  cgst?: number | null
  igst?: number | null
  /** Only set for a row sourced from Partwise Labour Master. */
  partCode?: string | null
  partDescription?: string | null
}

export interface Customer {
  id: string
  name: string
  mobile: string
  email?: string | null
  city?: string | null
  state?: string | null
  address?: string | null
  outstandingAmount: number
  vehicles?: Vehicle[]
}

export interface Vehicle {
  id: string
  customerId?: string
  model: string
  variant?: string | null
  color?: string | null
  regNo?: string | null
  vin?: string | null
  batteryNo?: string | null
  motorNo?: string | null
  controllerNo?: string | null
  converterNo?: string | null
  chargerNo?: string | null
  insuranceExpiry?: string | null
  nextServiceDueDate?: string | null
  odometer: number
  warranty?: Warranty | null
}

export interface Warranty {
  status: 'Active' | 'Expired' | 'Void'
  expiryDate?: string | null
  coverageKm: number
  labourCovered: boolean
}

export interface WorkflowStage {
  id: string
  stageKey: string
  label: string
  seq: number
  icon?: string | null
  active: boolean
  isTerminal: boolean
}

export interface JobCardSummary {
  id: string
  jobCardNumber: string
  // A BaplDms row's status is DMS's own free-text JobStatus (e.g. "Open", "Material
  // Transfer") - not one of JobCardStatus's fixed values - so this widens to `string` for BaplDms
  // rows (see JobCardsListPage's rendering, which only feeds JobCardScanner rows to StatusBadge).
  status: JobCardStatus | string
  serviceType?: ServiceType | null
  priority?: JobCardPriority | null
  customerName?: string
  customerMobile?: string
  vehicleModel?: string
  vehicleRegNo?: string
  vehicleChassisNo?: string | null
  stageLabel?: string | null
  serviceAdvisorName?: string
  technicianName?: string
  createdAt?: string | null
  expectedDeliveryAt?: string | null
  /** Number of photos on this job card - null for a BaplDms row (photos are a JobCardScanner-only
   * concept). */
  photoCount?: number | null
  /** JobCardScanner's own record, or a read-only row blended in from DMS's own job card
   * history (see GET /api/jobcards - JobCardsController.List). BaplDms rows have no JobCardScanner
   * id to navigate to, so the list page shows them without a detail link. */
  source: 'JobCardScanner' | 'BaplDms'
}

export interface JobCardListResponse {
  items: JobCardSummary[]
  /** Set only when a real DMS problem (not just "this dealer has no DMS data") kept its
   * job cards out of this response - JobCardScanner's own rows are still returned either way. */
  baplDmsWarning?: string | null
}

export interface JobCardComplaint {
  id: string
  description: string
  category?: string | null
  isCustomerVoice: boolean
}

export interface JobCardInspection {
  id: string
  component: string
  condition: string
  notes?: string | null
}

export interface JobCardPhoto {
  id: string
  stage: PhotoStage
  url: string
  caption?: string | null
  latitude?: number | null
  longitude?: number | null
  // 2026-09-03: set only for photos/videos uploaded from the Part Suggestion grid's Picture
  // column - links this photo back to that specific JobCardPartSuggestion row.
  partSuggestionId?: string | null
  createdAt?: string
}

export interface JobCardStageHistoryEntry {
  id: string
  stage?: WorkflowStage
  enteredAt: string
  exitedAt?: string | null
  notes?: string | null
  changedBy?: { id: string; name: string } | null
}

export interface JobCardWorklog {
  id: string
  technicianId: string
  taskDescription?: string | null
  startedAt: string
  endedAt?: string | null
  durationMinutes?: number | null
}

export interface QcChecklistItem {
  id: string
  itemName: string
  passed?: boolean | null
  notes?: string | null
}

export interface EstimateLine {
  id?: string
  type: 'Labour' | 'Part'
  description: string
  partId?: string | null
  quantity: number
  unitPrice: number
  amount?: number
}

export interface Estimate {
  id: string
  estimateNumber: string
  status: EstimateStatus
  totalAmount: number
  reason?: string | null
  lines: EstimateLine[]
}

export interface JobCardPart {
  id: string
  partId: string
  part?: PartMaster
  quantity: number
  unitPrice: number
  amount: number
  status: 'Requested' | 'Issued' | 'Returned' | 'Cancelled'
}

/// "Part Suggestion" row (renamed from "Parts Used" - see JobCard.PartSuggestions) - a part
/// suggested from DMS's own PartsInventory, with a Paid/U-W status tracked only in
/// JobCardScannerDb for history.
export interface JobCardPartSuggestion {
  id: string
  itemCode: string
  availableQtyAtSuggestion?: number | null
  status: 'Paid' | 'U/W' | 'FOC'
  /// How many units of this part are used on this job card - distinct from
  /// availableQtyAtSuggestion (DMS's stock level at suggestion time). Defaults to 1.
  quantity: number
  discountType?: string | null
  discountValue?: number | null
  /// Snapshot of the item's description/HSN/MRP at suggestion time - see BaplDmsPartStock's doc
  /// comment on why these may be null even for a real item.
  description?: string | null
  hsnCode?: string | null
  mrp?: number | null
  createdAt?: string
}

/// "Labour Suggestion" row (see JobCard.LabourSuggestions) - a labour line suggested from BAPL
/// DMS's own LabourMaster, with Description/HSN/GST/Rate snapshotted at suggestion time (not
/// live-linked) and a free-text Issue Type instead of a fixed status dropdown.
export interface JobCardLabourSuggestion {
  id: string
  labourCode: string
  labourDescription?: string | null
  hsnCode?: string | null
  sgst?: number | null
  cgst?: number | null
  igst?: number | null
  rateAtSuggestion?: number | null
  quantity: number
  discountType?: string | null
  discountValue?: number | null
  issueType?: string | null
  createdAt?: string
}

export interface PartMaster {
  id: string
  partNumber: string
  name: string
  category?: string | null
  unitPrice: number
  stockQty: number
}

export interface JobCardDetail extends Omit<JobCardSummary, 'customerName' | 'vehicleModel' | 'source'> {
  odometerAtCheckIn: number
  batteryLevelAtCheckIn?: number | null
  trackingToken: string
  // BAPL-DMS-style intake fields captured on the wizard's Service Details step (see
  // backend/JobCardScanner.Api/Models/JobCard.cs's doc comment) - free text, not yet written back
  // into DMS's own database.
  baplJobType?: string | null
  baplServiceLocation?: string | null
  baplSupervisorName?: string | null
  baplTechnicianName?: string | null
  baplManualJobNo?: string | null
  // Write-back result (see BaplDmsService.CreateJobCardAsync) - baplSyncWarning is only ever
  // present on the POST /api/jobcards response right after creation, not on later GETs.
  // *Id fields, not just the display-only *Name strings above - needed so the Labour Suggestion
  // panel can scope its DMS LabourMaster search by this job card's own already-selected
  // Job Type/Service Head/Service Type cascade (same ids the wizard used to pick them).
  baplJobTypeId?: number | null
  baplServiceHeadId?: number | null
  baplServiceHeadName?: string | null
  baplServiceTypeId?: number | null
  baplServiceTypeName?: string | null
  baplJobSourceName?: string | null
  baplServiceLocationCode?: string | null
  baplJobCardHeaderId?: number | null
  /// DMS's own JobNo (e.g. 22) - what DMS's own Job Card List shows as "JobNo / JobDate",
  /// as opposed to baplJobCardHeaderId (e.g. 70, only the internal JobCardHeader.Id).
  baplJobNo?: number | null
  baplSyncStatus?: string | null
  baplSyncError?: string | null
  baplSyncWarning?: string | null
  customer?: Customer
  vehicle?: Vehicle
  dealer?: { id: string; name: string; code: string } | null
  /// This job card's dealer, resolved to DMS's own dealer code (distinct from dealer.code
  /// above, which is JobCardScanner's own local code) - used to scope the Labour Suggestion
  /// panel's PartWiseLabourMaster search to the right dealer.
  baplDealerCode?: string | null
  currentStage?: WorkflowStage
  serviceAdvisor?: { id: string; name: string } | null
  assignedTechnician?: { id: string; name: string } | null
  /// Free-text "Assign Technician" name (see JobCard.AssignedTechnicianName) - shown/edited instead
  /// of a User dropdown, since there's no confirmed technician catalog to pick from.
  assignedTechnicianName?: string | null
  complaints: JobCardComplaint[]
  inspections: JobCardInspection[]
  photos: JobCardPhoto[]
  stageHistory: JobCardStageHistoryEntry[]
  worklogs: JobCardWorklog[]
  qcChecklistItems: QcChecklistItem[]
  estimates: Estimate[]
  parts: JobCardPart[]
  partSuggestions: JobCardPartSuggestion[]
  labourSuggestions: JobCardLabourSuggestion[]
  invoice?: Invoice | null
}

export interface Invoice {
  id: string
  invoiceNumber: string
  labourAmount: number
  partsAmount: number
  discountAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  totalAmount: number
  status: InvoiceStatus
  paymentMode: PaymentMode
}

export interface CsatSummary {
  average: number | null
  ratingsCount: number
}

export interface DashboardKpis {
  totalOpen: number
  openToday: number
  closedThisMonth: number
  pendingApproval: number
  overdue: number
  revenueToday: number
  revenueThisMonth: number
  revenuePaidInvoices: number
  avgTurnaroundHours: number
  byStatus: { status: string; count: number }[]
  // Dealer Dashboard tiles
  vehiclesReceivedToday: number
  underService: number
  waitingForParts: number
  waitingCustomerApproval: number
  vehiclesReady: number
  vehiclesDeliveredToday: number
  pendingJobCards: number
  warrantyJobsOpen: number
  csat: CsatSummary
}

export interface CorporateDashboardFilters {
  dealers: { id: string; name: string }[]
  regions: string[]
  states: string[]
  cities: string[]
  models: string[]
}

// ==================== Labour Master (2026-09-19) ====================
// Mirrors LabourMasterWithoutPartwiseRow / LabourMasterPartwiseRow in
// backend/Services/LabourMasterImportService.cs - camelCase field names per this project's usual
// System.Text.Json default, same convention as every other DMSBAPLDATA-backed type above.

export interface LabourMasterWithoutPartwise {
  id: number
  labourCode: string
  jobDescription: string | null
  model: string | null
  labourRate: number | null
  igst: number | null
  cgst: number | null
  sgst: number | null
  tier: number | null
  category: string | null
  effectiveDate: string | null
  isActive: boolean
  createdBy: string | null
  createdDate: string
  updatedBy: string | null
  updatedDate: string | null
}

export interface LabourMasterPartwise {
  id: number
  partCode: string | null
  partName: string | null
  labourCode: string
  jobDescription: string | null
  model: string | null
  labourRate: number | null
  igst: number | null
  cgst: number | null
  sgst: number | null
  tier: number | null
  category: string | null
  effectiveDate: string | null
  isActive: boolean
  createdBy: string | null
  createdDate: string
  updatedBy: string | null
  updatedDate: string | null
}

export interface LabourMasterImportResult {
  totalDataRows: number
  inserted: number
  updated: number
  unchanged: number
  skippedBlank: number
  warnings: string[]
}

// ==================== Extended Battery Warranty Scheme (2026-09-22) ====================
// "needs to create warenty table in jobcardscanner db for this functionality and add this in our
// function" - mirrors ExtendedBatteryWarrantySchemesController.ToRow / CreateExtendedBatteryWarrantySchemeRequest
// (backend/Controllers/ExtendedBatteryWarrantySchemesController.cs, backend/Dtos/Requests.cs). See
// backend/Models/ExtendedBatteryWarrantySchemes.cs's own doc comment for why VehicleModel is free
// text (no OEM Model master existed in JobCardScannerDb when this was first built) and DurationType
// is a fixed-choice string rather than a numeric id.
//
// 2026-09-22 UPDATE: oemModelId/oemModelName added - see OemModel below (Types.OemModel) and that
// same backend doc comment's update. Added ALONGSIDE vehicleModel, not replacing it, per an
// explicit choice confirmed via AskUserQuestion - vehicleModel is still required and still what
// eligibility matching reads; oemModelId just lets the admin form pick from a real catalog instead
// of typing free text, and keeps the two in sync when it does.
export interface ExtendedBatteryWarrantyScheme {
  id: string
  schemeName: string
  vehicleModel: string
  rateType: string | null
  duration: number
  durationType: 'Days' | 'Months' | 'Years'
  kms: number
  dealerPrice: number
  customerPrice: number
  discountAmount: number
  gstPercent: number
  purchaseValidityDays: number | null
  batteryPartCode: string | null
  partCode: string | null
  fromDate: string
  toDate: string | null
  isActive: boolean
  oemModelId: string | null
  oemModelName: string | null
  createdAt: string
  updatedAt: string | null
}

export interface CreateExtendedBatteryWarrantySchemeRequest {
  schemeName: string
  vehicleModel: string
  rateType: string | null
  duration: number
  durationType: 'Days' | 'Months' | 'Years'
  kms: number
  dealerPrice: number
  customerPrice: number
  discountAmount: number
  gstPercent: number
  purchaseValidityDays: number | null
  batteryPartCode: string | null
  partCode: string | null
  fromDate: string
  toDate: string | null
  isActive: boolean
  oemModelId?: string | null
}

// ==================== OEM Model Master / OEM Model Warranty (2026-09-22) ====================
// "this wants to integrate for my battery-warranty-schemes for link models for warrenty and this
// all table add in jobcard db that all functionality need to craete in jc" - mirrors
// OemModelsController.ToRow/CreateOemModelRequest and OemModelWarrantiesController.ToRow/
// CreateOemModelWarrantyRequest (backend/Controllers/OemModel*.cs, backend/Dtos/Requests.cs). See
// backend/Models/OemModels.cs's own doc comment for the full reasoning ported from the DMS
// reference's OemmodelMaster/OemmodelWarranty tables, including why this is a GLOBAL (not
// dealer-scoped) master.
export interface OemModel {
  id: string
  modelName: string
  modelShortName: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string | null
}

export interface CreateOemModelRequest {
  modelName: string
  modelShortName: string | null
  isActive: boolean
}

/** DurationType intentionally has no "Days" option here (unlike ExtendedBatteryWarrantyScheme) -
 * see OemModelWarranty's own backend doc comment for why. */
export interface OemModelWarranty {
  id: string
  oemModelId: string
  oemModelName: string | null
  effectiveDate: string
  odoReading: number | null
  durationType: 'Months' | 'Years' | null
  duration: number | null
  isB2b: boolean | null
  createdAt: string
  updatedAt: string | null
}

export interface CreateOemModelWarrantyRequest {
  oemModelId: string
  effectiveDate: string
  odoReading: number | null
  durationType: 'Months' | 'Years' | null
  duration: number | null
  isB2b: boolean | null
}

/** Result of GET /api/extended-battery-warranty-schemes/eligible - see that endpoint's own doc
 * comment (backend) for the eligibility formula, which is INTERPRETATION, not confirmed policy. */
export interface ExtendedBatteryWarrantyEligibilityResult {
  schemeId: string
  schemeName: string
  isEligible: boolean
  ineligibilityReason: string | null
  dealerPrice: number
  customerPrice: number
  gstPercent: number
  coverageEndDate: string
  coverageUptoKms: number
  batteryPartCode: string | null
  partCode: string | null
}

// 2026-09-21 "Part Upload" tab - see backend Models/PartUploads.cs's doc comment for the
// confirmed source spreadsheet columns (Stock Summary Detail Report) and why there is no
// GST/tax-rate field here (the source file has none).
export interface PartUpload {
  id: string
  /** Workshop LocCode picked on the upload form - required, part of the upsert key (see
   * PartUploads.cs's 2026-09-21 correction). */
  locationCode: string
  /** The report's "as of" date, picked on the upload form. */
  reportDate: string
  partNo: string
  description: string | null
  openBal: number | null
  purchase: number | null
  receipt: number | null
  pPurChln: number | null
  total: number | null
  sale: number | null
  brIss: number | null
  mtrlIss: number | null
  stAdj: number | null
  partsChln: number | null
  purReturn: number | null
  saleReturn: number | null
  saleChln: number | null
  balQty: number | null
  /** 2026-09-22: computed on every GET, not stored - total Qty transferred out via Material
   * Transfer for this Part No + Location (see PartUpload.MtTransferQty's own doc comment on the
   * backend for the exact match key and the Cancelled-docs inclusion note). */
  mtTransferQty: number | null
  balAmnt: number | null
  qtyReqd: number | null
  minOrder: number | null
  billPrice: number | null
  hsnSacCode: string | null
  groupName: string | null
  itemType: string | null
  sourceFileName: string | null
  uploadedBy: string | null
  uploadedAt: string
  updatedAt: string | null
}

export interface PartUploadImportResult {
  totalDataRows: number
  inserted: number
  updated: number
  unchanged: number
  skippedBlank: number
  warnings: string[]
}

export interface CorporateDashboardData {
  revenue: number
  warrantyCost: number
  csat: CsatSummary
  pendingVehicles: number
  jobCardVolumeByDealer: { dealerName: string; count: number }[]
  jobCardVolumeTrend: { date: string; count: number }[]
  avgTatByDealer: { dealerName: string; avgHours: number }[]
  topPartsConsumption: { partName: string; qty: number }[]
  repeatComplaints: { regNo?: string | null; visits: number }[]
}

/// One row of GET /api/jobcards/search - the "Job Search" picker on the Repair Bill / Material
/// Transfer Bill create pages (2026-09-21). See JobCardsController.Search's doc comment: searches
/// this app's own JobCards only (not a blended DMS view), since JobCardId on both doc types is a
/// local FK. LocationCode (a DMS LocCode) is what drives the Part Name search-select afterwards -
/// same value GET /api/bapl-dms/parts?locationCode=... expects.
export interface JobSearchResult {
  id: string
  jobCardNumber: string
  jobDate: string
  location?: string | null
  locationCode?: string | null
  jobTypeService?: string | null
  partyName?: string | null
  /** Customer.State for the job's linked customer - see JobCardsController.Search's PartyState
   * doc comment. Used to auto-detect intra-state vs inter-state GST on the Repair Bill / Material
   * Transfer create pages once a job is picked. Null if no customer is linked or it has no State. */
  partyState?: string | null
  regNo?: string | null
  chassisNo?: string | null
  vehicleType?: string | null
  jobSource?: string | null
  /** 2026-09-21: this picker now also returns job cards that never synced to DMS (see
   * JobCardsController.Search's doc comment) - true when this one did. */
  isDmsLinked?: boolean
  /** 2026-09-22 - Vehicle.Odometer / JobCard.AssignedTechnicianName, added for Repair Bill's
   * "Selected Job Details" panel (see JobCardsController.Search's own doc comment on why these
   * two were added here). Both null when not on file, same as every other optional field above. */
  odometer?: number | null
  technician?: string | null
}

// ---------------- Repair Bill / Material Transfer Bill (2026-09-19) - JobCardScannerDb-native,
// see backend Models/RepairBillDocs.cs / MaterialTransferDocs.cs and
// Controllers/RepairBillDocsController.cs / MaterialTransferDocsController.cs. Distinct from
// DmsBaplDataRepairBill / DmsBaplDataMaterialTransfer above, which are the read-only
// DMSBAPLDATA-synced rows behind the existing "Repair Bill Report"/"Material Transfer Report"
// pages. ----------------
export type RepairBillDocItemType = 'Part' | 'Labour'
export type RepairBillDocStatus = 'Performa' | 'Billed' | 'Cancelled'

export interface RepairBillDocItem {
  id: string
  itemType: RepairBillDocItemType
  itemCode: string
  itemDescription: string
  hsnCode?: string | null
  /** Reference: RepairBillDetail.IssutypeId - per LINE, not per bill (see RepairBillDocItem.
   * IssueType's backend doc comment). "U/W"/"FSC" zero this line's tax; "Paid" or null is taxed
   * normally. */
  issueType?: string | null
  qty: number
  rate: number
  /** Reference: RepairBillDetail.DiscountType - free text, "Percentage" or "Amount". */
  discountType?: string | null
  discountValue: number
  cgstPct: number
  sgstPct: number
  igstPct: number
  taxableAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  totalAmount: number
}

export interface RepairBillDoc {
  source: 'JobCardScanner'
  id: string
  billNumber: string
  billDate: string
  /** 2026-09-23 - only present on a single GET /api/repair-bill-docs/{id} response (added so the
   * web page can reopen an existing Performa bill for editing by re-linking the same Job - see
   * RepairBillDocsController.Get's own doc comment). Null for a bill raised with no Job linked. */
  jobCardId?: string | null
  jobCardNumber?: string | null
  partyName: string
  regNo?: string | null
  chassisNo?: string | null
  location?: string | null
  billType?: string | null
  issueType?: string | null
  status: RepairBillDocStatus
  /** 2026-09-23 - now returned (was save-only before, silently dropped on read) so an edit form
   * reopening this bill doesn't wipe it out on save - see RepairBillDocsController.ToRow's own
   * doc comment. */
  remarks?: string | null
  // ---- Insurance claim fields - reference RepairBillHeader.InsuranceId(->name)/InsDecription/
  // SurveyorName/ContactNumber/PolicyNo/InsValidTill/ZeroDepo. ----
  insuranceCompanyName?: string | null
  insuranceDescription?: string | null
  surveyorName?: string | null
  surveyorContactNumber?: string | null
  policyNo?: string | null
  insuranceValidTill?: string | null
  zeroDepreciation: boolean
  totalDiscount: number
  amountReceived: number
  taxableAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  totalAmount: number
  itemCount: number
  items: RepairBillDocItem[]
}

/** One row of GET /api/repair-bill-docs/combined - either this app's own bill or a read-only
 * DMSBAPLDATA-synced one (see `source`); DMSBAPLDATA rows have `status: null`.
 * 2026-09-21 ("all upload data and exist data are clickable ... this all details can openable"):
 * `items` now carries each row's own line items straight from /combined (a JobCardScanner bill's
 * RepairBillDocItem shape, or a DMSBAPLDATA DMS_RepairBillItem shape for a "dms-" row) - the two
 * shapes differ, so this is intentionally untyped (`Record<string, unknown>`) rather than forced
 * into one interface; the detail modal that renders these reads fields defensively by source. */
export interface CombinedRepairBillRow {
  source: 'JobCardScanner' | 'DMSBAPLDATA'
  id: string
  billNumber: string
  sortDate: string
  partyName?: string | null
  regNo?: string | null
  chassisNo?: string | null
  location?: string | null
  billType?: string | null
  status: RepairBillDocStatus | string | null
  totalAmount: number
  itemCount: number
  items?: Record<string, unknown>[]
  /** 2026-09-21 ("according /repair-bill-list do in our repair bill" - the reference DMS app's
   * own list columns): only ever set for a `source: 'JobCardScanner'` row - see
   * RepairBillDocsController.ToCombinedRow's doc comment for why a DMSBAPLDATA row has none. */
  jobNo?: string | null
  preparedBy?: string | null
  modifiedBy?: string | null
}

export type MaterialTransferDocType = 'Issue' | 'Return'
export type MaterialTransferDocStatus = 'Draft' | 'Confirmed' | 'Cancelled'
/** 2026-09-22 - see MaterialTransferDocItem.ItemType's backend doc comment. Part is every line
 * that existed before this round; Labour is a Labour Master Partwise code added via the new
 * "Labour" picker against a Part line already on the same document. */
export type MaterialTransferDocItemType = 'Part' | 'Labour'

export interface MaterialTransferDocItem {
  id: string
  itemCode: string
  itemDescription: string
  itemType: MaterialTransferDocItemType
  /** Auto-filled from the picked part (BaplDmsPartStock.hsnCode) - see MaterialTransferDocItem's
   * backend doc comment (added 2026-09-21, third correction). */
  hsnCode?: string | null
  /** Reference: MaterialTransfer.IssueType - a required per-row "Paid"/"U/W" value in the
   * reference (see MaterialTransferDocItem's backend doc comment), kept optional here. */
  issueType?: string | null
  qty: number
  rate: number
  amount: number
  /** Reference: MaterialTransfer.RackNo/Bin/SerialNo/Mrp/ValidDays/ItemReceived. */
  rackNo?: string | null
  bin?: string | null
  serialNo?: string | null
  mrp?: number | null
  validDays?: number | null
  itemReceived?: string | null
}

export interface MaterialTransferDoc {
  source: 'JobCardScanner'
  id: string
  transferNumber: string
  transferDate: string
  /** 2026-09-23 - only present on a single GET /api/material-transfer-docs/{id} response (added
   * so the web page can reopen an existing Draft transfer for editing by re-linking the same Job -
   * see MaterialTransferDocsController.Get's own doc comment). Null for a transfer raised with no
   * Job linked. */
  jobCardId?: string | null
  jobCardNumber?: string | null
  location?: string | null
  transferType: MaterialTransferDocType
  issueType?: string | null
  partyName?: string | null
  /** Reference: MaterialTransfer.Technician, mapped onto this app's own User FK. */
  technicianId?: string | null
  /** 2026-09-23 - now returned (was save-only before, silently dropped on read) so an edit form
   * reopening this transfer doesn't wipe it out on save - see
   * MaterialTransferDocsController.ToRow's own doc comment. */
  remarks?: string | null
  status: MaterialTransferDocStatus
  totalAmount: number
  itemCount: number
  items: MaterialTransferDocItem[]
}

/** One row of GET /api/material-transfer-docs/for-job/{jobCardId} - 2026-09-22
 * ("now i saved from material transfer bill now this will shown in repair bill with which i
 * material transfer"): every Material Transfer item already saved against this Job Card, flattened
 * across all its (non-Cancelled) transfer docs. RepairBillCreatePage.tsx auto-loads these as its
 * Part grid rows instead of offering a manual Part search - see that page's doc comment. Rate/Mrp
 * here are already SECTION 64's C_ItemMaster-derived figures from when the part was transferred. */
export interface MaterialTransferItemForJob {
  materialTransferDocId: string
  transferNumber: string
  transferDate: string
  id: string
  itemCode: string
  itemDescription: string
  hsnCode?: string | null
  issueType?: string | null
  qty: number
  rate: number
  amount: number
  mrp?: number | null
  /** 2026-09-22 - see MaterialTransferDocItemType's own doc comment. RepairBillCreatePage.tsx's
   * materialTransferItems sync effect now routes this into a Labour or Part row in `items`
   * accordingly, instead of assuming every row here is a Part. */
  itemType: MaterialTransferDocItemType
}

/** One row of GET /api/material-transfer-docs/combined - see CombinedRepairBillRow's doc comment
 * (including its 2026-09-21 `items` note). */
export interface CombinedMaterialTransferRow {
  source: 'JobCardScanner' | 'DMSBAPLDATA'
  id: string
  transferNumber: string
  sortDate: string
  location?: string | null
  transferType?: string | null
  partyName?: string | null
  status: MaterialTransferDocStatus | string | null
  totalAmount: number
  itemCount: number
  items?: Record<string, unknown>[]
  /** 2026-09-23 ("history maintain in which job card which item material transfered") - only ever
   * set for a `source: 'JobCardScanner'` row - see
   * MaterialTransferDocsController.ToCombinedRow's own doc comment. */
  jobNo?: string | null
}
