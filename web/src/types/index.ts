// Shared TypeScript types mirroring the backend's C# enums/DTOs (see backend/JobCardScanner.Api/Models).

export type StaffRole =
  | 'ServiceAdvisor'
  | 'WorkshopManager'
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
export type EstimateStatus = 'Draft' | 'PendingCustomerApproval' | 'Approved' | 'Rejected' | 'Expired'
export type InvoiceStatus = 'Draft' | 'Generated' | 'Paid' | 'Cancelled'
export type PaymentMode = 'Cash' | 'Card' | 'Upi' | 'NetBanking' | 'Wallet' | 'Pending'
export type PhotoStage = 'CheckIn' | 'Inspection' | 'Repair' | 'Qc' | 'Delivery'

export interface Dealer {
  id: string
  name: string
  code: string
  city?: string | null
  baplDmsDealerCode?: string | null
}

// ---------------- BAPL DMS integration (Job Card Wizard dealer/vehicle auto-fill) ----------------
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
  // Added when the lookup was rewritten to source from BAPL DMS's ChassisDetails/LedgerMaster
  // vehicle master (see BaplDmsService.LookupVehicleAsync) - customer city, the LedgerMaster.Id
  // this customer is known by in BAPL DMS (used for the job card write-back), and the workshop
  // location (LocationMaster.Loccode) this chassis is registered against.
  customerCity?: string | null
  customerLedgerId?: number | null
  locationCode?: string | null
  dealerCode?: string | null
  // Best-effort LedgerMaster.Address/Email - see BaplDmsVehicleRow's doc comment in
  // BaplDmsService.cs on why these two specifically are not guaranteed to be populated.
  customerAddress?: string | null
  customerEmail?: string | null
  // Battery Details panel fields the print preview previously had nowhere to source (see
  // BaplDmsService.LookupVehicleAsync's ChassisBatteryDetails enrichment) - now read straight from
  // BAPL DMS's own ChassisBatteryDetails table.
  batteryChemical?: string | null
  batteryCapacity?: string | null
  batteryMake?: string | null
}

/// One active "W" series workshop location from BAPL DMS's own LocationMaster.
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

/// One row from BAPL DMS's JobSource master (Walk In / RSA / Mega Camp / ...) - replaces the
/// wizard's old hardcoded WalkIn/PickupAndDrop/Breakdown/Scheduled/Online "Source" dropdown.
export interface BaplDmsJobSource {
  id: number
  name: string
}

/// Available stock for one item at one workshop location, from BAPL DMS's own PartsInventory - see
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
}

/// One search-as-you-type match for the chassis/registration-no. autocomplete - see
/// BaplDmsVehicleSuggestion's doc comment in BaplDmsService.cs. Pick one to run the full
/// vehicle-lookup (BaplDmsVehicleLookup) the way a manual Search always has.
export interface BaplDmsVehicleSuggestion {
  chassisNo: string
  regNo?: string | null
  modelName?: string | null
  dealerId?: string | null
}

/// One labour rate-card row from BAPL DMS's own LabourMaster - see BaplDmsLabourRow's doc comment
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
}

/// One repair bill BAPL DMS has for a job card - for the Detail page's "Download Invoice from DMS"
/// panel. Deliberately narrow (see BaplDmsRepairBillRow's doc comment).
export interface BaplDmsRepairBill {
  id: number
  repairBillStatus?: string | null
  totalNetAmount?: number | null
}

export interface CurrentUser {
  id: string
  name: string
  email: string
  mobile?: string | null
  role: StaffRole
  dealerId?: string | null
  dealerName?: string | null
  avatarColor?: string | null
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
  // A BaplDms row's status is BAPL DMS's own free-text JobStatus (e.g. "Open", "Material
  // Transfer") - not one of JobCardStatus's fixed values - so this widens to `string` for BaplDms
  // rows (see JobCardsListPage's rendering, which only feeds JobCardScanner rows to StatusBadge).
  status: JobCardStatus | string
  serviceType?: ServiceType | null
  priority?: JobCardPriority | null
  customerName?: string
  customerMobile?: string
  vehicleModel?: string
  vehicleRegNo?: string
  stageLabel?: string | null
  serviceAdvisorName?: string
  technicianName?: string
  createdAt?: string | null
  expectedDeliveryAt?: string | null
  /** Number of photos on this job card - null for a BaplDms row (photos are a JobCardScanner-only
   * concept). */
  photoCount?: number | null
  /** JobCardScanner's own record, or a read-only row blended in from BAPL DMS's own job card
   * history (see GET /api/jobcards - JobCardsController.List). BaplDms rows have no JobCardScanner
   * id to navigate to, so the list page shows them without a detail link. */
  source: 'JobCardScanner' | 'BaplDms'
}

export interface JobCardListResponse {
  items: JobCardSummary[]
  /** Set only when a real BAPL DMS problem (not just "this dealer has no BAPL DMS data") kept its
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
  createdAt?: string
}

export interface JobCardStageHistoryEntry {
  id: string
  stage?: WorkflowStage
  enteredAt: string
  exitedAt?: string | null
  notes?: string | null
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
/// suggested from BAPL DMS's own PartsInventory, with a Paid/U-W status tracked only in
/// JobCardScannerDb for history.
export interface JobCardPartSuggestion {
  id: string
  itemCode: string
  availableQtyAtSuggestion?: number | null
  status: 'Paid' | 'U/W'
  /// How many units of this part are used on this job card - distinct from
  /// availableQtyAtSuggestion (BAPL DMS's stock level at suggestion time). Defaults to 1.
  quantity: number
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
  // into BAPL DMS's own database.
  baplJobType?: string | null
  baplServiceLocation?: string | null
  baplSupervisorName?: string | null
  baplTechnicianName?: string | null
  baplManualJobNo?: string | null
  // Write-back result (see BaplDmsService.CreateJobCardAsync) - baplSyncWarning is only ever
  // present on the POST /api/jobcards response right after creation, not on later GETs.
  // *Id fields, not just the display-only *Name strings above - needed so the Labour Suggestion
  // panel can scope its BAPL DMS LabourMaster search by this job card's own already-selected
  // Job Type/Service Head/Service Type cascade (same ids the wizard used to pick them).
  baplJobTypeId?: number | null
  baplServiceHeadId?: number | null
  baplServiceHeadName?: string | null
  baplServiceTypeId?: number | null
  baplServiceTypeName?: string | null
  baplJobSourceName?: string | null
  baplServiceLocationCode?: string | null
  baplJobCardHeaderId?: number | null
  /// BAPL DMS's own JobNo (e.g. 22) - what BAPL DMS's own Job Card List shows as "JobNo / JobDate",
  /// as opposed to baplJobCardHeaderId (e.g. 70, only the internal JobCardHeader.Id).
  baplJobNo?: number | null
  baplSyncStatus?: string | null
  baplSyncError?: string | null
  baplSyncWarning?: string | null
  customer?: Customer
  vehicle?: Vehicle
  dealer?: { id: string; name: string; code: string } | null
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