// mobile/src/types/index.ts
// Mirrors backend/JobCardScanner.Api/Models enums/DTOs (see web/src/types/index.ts for the fuller
// web copy - kept in sync with it by hand since there's no shared package between the two apps).

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
export type PhotoStage = 'CheckIn' | 'Inspection' | 'Repair' | 'Qc' | 'Delivery' | 'PartSuggestion'

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: StaffRole
  dealerId?: string | null
  dealerName?: string | null
  /** DMS's own dealer code (e.g. "CUS0435") - used to scope chassis/reg-no vehicle search to
   * this user's own dealer. See AuthController.Me's DealerBaplDmsCode doc comment. */
  dealerBaplDmsCode?: string | null
  /** 2026-09-18: this user's assigned "Work Area" DMS workshop LocCode(s) (e.g. ["CUS0288W1"]),
   * set on the Employees/create-user page - see User.WorkLocationCodes's doc comment on the
   * backend. Empty array means unrestricted (e.g. Corporate/System Admin). Used to filter the
   * Job Card wizard's "Select workshop" dropdown down to only this user's own location(s),
   * matching the same enforcement JobCardsController.Create already applies server-side. */
  workLocationCodes: string[]
  /** 2026-09-21 (Material Transfer Bill/Repair Bill create screens): this dealer's own State,
   * from GET /api/auth/me - already returned by the backend, just not previously read by mobile.
   * Compared against a picked job's Customer.State to auto-detect Same State (CGST+SGST) vs
   * Different State (IGST), same as web/src/types/index.ts's CurrentUser.dealerState. */
  dealerState?: string | null
}

export interface Dealer {
  id: string
  name: string
  code: string
  city?: string | null
  baplDmsDealerCode?: string | null
}

// ==================== Technician Employee (2026-09-24) - mirrors web/src/types/index.ts ====================
// A login-less roster of technicians, scoped by dealer + workshop location - see backend
// Models/Technicians.cs's own doc comment for why this is not a User.
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

/// One row of GET /api/technicians/supervisors - see TechniciansController.Supervisors' doc
/// comment on the backend for why this reads Users directly instead of GET /api/users.
export interface SupervisorOption {
  id: string
  name: string
}

// ==================== Local Parts/Labour Catalog (2026-09-24) - mirrors web/src/types/index.ts ====================
// GET /api/jobcards/parts-catalog / /api/jobcards/labour-catalog - replaces DMS-live
// /api/bapl-dms/parts / /api/bapl-dms/labour as Part Suggestion/Labour Suggestion's picker source.
export interface JobCardsPartsCatalogRow {
  itemCode: string
  description?: string | null
  hsnCode?: string | null
  mrp?: number | null
  sgst?: number | null
  cgst?: number | null
  igst?: number | null
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
  partCode?: string | null
  partDescription?: string | null
}

// ---------------- DMS integration (Job Card Wizard dealer/vehicle auto-fill - mirrors
// web/src/types/index.ts's same-named interfaces field for field). ----------------
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
  customerCity?: string | null
  customerLedgerId?: number | null
  locationCode?: string | null
  dealerCode?: string | null
  // Set server-side (BaplDmsController.VehicleLookup) when this chassis already has an open job
  // card - either in JobCardScanner's own JobCards (openJobCardSource "local") or in DMS's own
  // job card history (openJobCardSource "bapl-dms") - matches web's same field. See
  // BaplDmsVehicleRow's doc comment on the backend.
  openJobCardNumber?: string | null
  openJobCardSource?: 'local' | 'bapl-dms' | null
  openJobCardStatus?: string | null
  customerAddress?: string | null
  // 2026-10-01 ("DMS_SaleBillCustomer have State already have not not fetched why fix this
  // properly"): added to match web/src/types/index.ts's own BaplDmsVehicleLookup (which already
  // had this field - the TypeScript build error "Property 'customerState' does not exist" proved
  // mobile's copy of this interface was simply never kept in sync with web's for this one field).
  // Confirmed real upstream data for it via your own `select * from DMS_SaleBillCustomer where
  // Id='81863'` dump (State='KARNATAKA'). Placed in the same position web's copy has it (right
  // after customerAddress, before customerEmail) purely to keep the two files diffable by eye.
  customerState?: string | null
  customerEmail?: string | null
  // Battery Details fields sourced from DMS's ChassisBatteryDetails table.
  batteryChemical?: string | null
  batteryCapacity?: string | null
  batteryMake?: string | null
}

/// One search-as-you-type match for the chassis/registration-no. autocomplete.
export interface BaplDmsVehicleSuggestion {
  chassisNo: string
  regNo?: string | null
  modelName?: string | null
  dealerId?: string | null
  saleDate?: string | null
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

/// One row from DMS's JobSource master (Walk In / RSA / Mega Camp / ...).
export interface BaplDmsJobSource {
  id: number
  name: string
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

// ---- Part Suggestion / Labour Suggestion ----

/// One part-availability row from DMS's own PartsInventory for a given service location -
/// GET /api/bapl-dms/parts?locationCode=... . Extended 2026-09-21 to match
/// web/src/types/index.ts's same interface field-for-field (Material Transfer Bill/Repair Bill/
/// Item Master, "add changes in android also").
export interface BaplDmsPartStock {
  itemCode: string
  availableQty: number
  description?: string | null
  mrp?: number | null
  hsnCode?: string | null
  /// Set only when this row was merged in from the "Part Upload" tab (web-only feature; mobile has
  /// no Part Upload screen) rather than fetched live from DMS's own PartsInventory - kept here only
  /// so this type matches web's exactly; mobile never actually sets this field itself.
  source?: 'partUpload'
  billPrice?: number | null
  /// 2026-09-21 ("Rate = Dlr_Price - GST% ... fetch from baplfinal databse"): merged in client-side
  /// from BAPL's own C_ItemMaster (baplfinal) by ItemCode, via GET /api/item-master/by-codes - see
  /// MaterialTransferCreateScreen.tsx/RepairBillCreateScreen.tsx's itemMasterByCode lookup. Same
  /// role as web's identical fields - see BaplItemMaster below for the confirmed schema.
  dlrPrice?: number | null
  sgstPct?: number | null
  cgstPct?: number | null
  igstPct?: number | null
}

/// One row from BAPL's C_ItemMaster (baplfinal) - see BaplItemMasterRow's doc comment in
/// BaplDealerService.cs (backend) for the confirmed schema/sample data. Backs the "Item Master"
/// screen and the Dealer Price/GST% enrichment on Parts Catalog/Material Transfer/Repair Bill.
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

/// One row of GET /api/jobcards/search - the "Job Search" picker on the Material Transfer Bill/
/// Repair Bill create screens. Mirrors web/src/types/index.ts's JobSearchResult exactly.
export interface JobSearchResult {
  id: string
  jobCardNumber: string
  jobDate: string
  location?: string | null
  locationCode?: string | null
  jobTypeService?: string | null
  partyName?: string | null
  /** Customer.State for the job's linked customer - drives Same State/Different State
   * auto-detection once a job is picked. Null if no customer is linked or it has no State. */
  partyState?: string | null
  regNo?: string | null
  chassisNo?: string | null
  vehicleType?: string | null
  jobSource?: string | null
  isDmsLinked?: boolean
}

// ---------------- Repair Bill / Material Transfer Bill (2026-09-21, "add changes in android
// also") - JobCardScannerDb-native, mirrors web/src/pages/staff/RepairBillCreatePage.tsx /
// MaterialTransferCreatePage.tsx and their backing types in web/src/types/index.ts. Posts to the
// SAME backend endpoints web already uses (RepairBillDocsController/MaterialTransferDocsController)
// - no backend change was needed for this Android round, only these mobile screens/types. ----------------
export type RepairBillDocItemType = 'Part' | 'Labour'
export type RepairBillDocStatus = 'Performa' | 'Billed' | 'Cancelled'

/** 2026-09-23 ("give me for android and web adding this button") - mirrors web/src/types/
 * index.ts's own RepairBillDocItem/RepairBillDoc (full GET /api/repair-bill-docs/{id} response
 * shape), added so RepairBillCreateScreen.tsx can reopen an existing Performa bill for editing
 * the same way web's RepairBillCreatePage.tsx already does (see that screen's own doc comment). */
export interface RepairBillDocItem {
  id: string
  itemType: RepairBillDocItemType
  itemCode: string
  itemDescription: string
  hsnCode?: string | null
  issueType?: string | null
  qty: number
  rate: number
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
  jobCardId?: string | null
  jobCardNumber?: string | null
  partyName: string
  regNo?: string | null
  chassisNo?: string | null
  location?: string | null
  billType?: string | null
  issueType?: string | null
  status: RepairBillDocStatus
  remarks?: string | null
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
 * DMSBAPLDATA-synced one (see `source`); DMSBAPLDATA rows have `status: null`. `items` is left
 * loosely typed (matches web) since a JobCardScanner row's items and a DMSBAPLDATA row's items are
 * different shapes. */
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
  jobNo?: string | null
  preparedBy?: string | null
  modifiedBy?: string | null
}

export type MaterialTransferDocType = 'Issue' | 'Return'
export type MaterialTransferDocStatus = 'Draft' | 'Confirmed' | 'Cancelled'

/** One row of GET /api/material-transfer-docs/combined - see CombinedRepairBillRow's doc comment. */
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
}

// 2026-09-22 ("then from /labour-master ... add Labour Code also that was wants to integrate in
// material transfer ... give proper code like vide functionality in mobile and for web both") -
// mirrors web/src/types/index.ts's own MaterialTransferDocItemType/LabourMasterPartwise/
// MaterialTransferItemForJob additions of the same date, so this feature can share the same
// backend endpoints/shape on both platforms (see MaterialTransferCreatePage.tsx's own doc comment
// on the web side for the full video-confirmed reference workflow this ports).
export type MaterialTransferDocItemType = 'Part' | 'Labour'

/** Mirrors LabourMasterPartwiseRow in backend/Services/LabourMasterImportService.cs - see
 * web/src/types/index.ts's own copy of this interface for field provenance. */
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

/** One row of GET /api/material-transfer-docs/for-job/{jobCardId} - every Material Transfer item
 * (Part OR Labour, see itemType) already saved against a job, that RepairBillCreateScreen.tsx's
 * own sync effect turns into read-only lines here, the same way web's RepairBillCreatePage.tsx
 * already does. MaterialTransferDocItem stores no tax columns (see that model's own doc comment
 * on the backend) - CGST/SGST/IGST are always recovered fresh, by code, not carried on this row. */
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
  itemType: MaterialTransferDocItemType
}

/// A part suggested for this job card (POST .../part-suggestions) - itemCode + a Paid/U-W status
/// tracked only in JobCardScannerDb, toggle-able afterwards (PUT .../part-suggestions/{id}).
export interface JobCardPartSuggestion {
  id: string
  itemCode: string
  availableQtyAtSuggestion?: number | null
  status: 'Paid' | 'U/W'
  quantity: number
  description?: string | null
  hsnCode?: string | null
  mrp?: number | null
  createdAt?: string
}

/// One labour rate-card row from DMS's own LabourMaster, OR from PartWiseLabourMaster (a
/// second, part-linked rate card unioned in as of 2026-09-03) - GET /api/bapl-dms/labour?... .
/// IMPORTANT: labourCode is NOT unique per row - always key/select UI lists by `id`.
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

/// A labour line suggested for this job card (POST .../labour-suggestions).
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
  issueType?: string | null
  createdAt?: string
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
}

export interface WorkflowStage {
  id: string
  stageKey: string
  label: string
  seq: number
  isTerminal: boolean
}

export interface JobCardSummary {
  id: string
  jobCardNumber: string
  // A BaplDms row's status is DMS's own free-text JobStatus, not one of JobCardStatus's fixed
  // values - widened to `string` for BaplDms rows (only JobCardScanner rows get the fixed Badge).
  status: JobCardStatus | string
  priority?: string
  customerName?: string
  customerMobile?: string
  vehicleModel?: string
  vehicleRegNo?: string
  stageLabel?: string | null
  technicianName?: string
  createdAt: string
  expectedDeliveryAt?: string | null
  photoCount?: number | null
  source: 'JobCardScanner' | 'BaplDms'
}

export interface JobCardListResponse {
  items: JobCardSummary[]
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
}

export interface JobCardDetail extends Omit<JobCardSummary, 'customerName' | 'vehicleModel' | 'source'> {
  odometerAtCheckIn: number
  trackingToken: string
  baplJobType?: string | null
  baplServiceLocation?: string | null
  baplSupervisorName?: string | null
  baplTechnicianName?: string | null
  baplManualJobNo?: string | null
  baplJobTypeId?: number | null
  baplServiceHeadId?: number | null
  baplServiceHeadName?: string | null
  baplServiceTypeId?: number | null
  baplServiceTypeName?: string | null
  baplJobSourceName?: string | null
  baplServiceLocationCode?: string | null
  baplJobCardHeaderId?: number | null
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
  assignedTechnicianName?: string | null
  complaints: JobCardComplaint[]
  inspections: JobCardInspection[]
  photos: JobCardPhoto[]
  stageHistory: JobCardStageHistoryEntry[]
  worklogs: JobCardWorklog[]
  qcChecklistItems: QcChecklistItem[]
  partSuggestions: JobCardPartSuggestion[]
  labourSuggestions: JobCardLabourSuggestion[]
}

export interface CsatSummary {
  average: number | null
  ratingsCount: number
}

// 2026-09-07: brought up to parity with web's DashboardKpis (web/src/types/index.ts) - this was
// missing every field DashboardScreen.tsx's tiles/status-breakdown/revenue row now read
// (revenuePaidInvoices, byStatus, csat, and all nine Dealer Dashboard tile fields below), even
// though /api/dashboard/kpis has always returned them - the mobile type just hadn't been updated
// to match since DashboardController.Kpis grew those fields for web.
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

export interface PartMaster {
  id: string
  partNumber: string
  name: string
  category?: string | null
  unitPrice: number
  stockQty: number
}
