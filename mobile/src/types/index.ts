// Mirrors backend/JobCardScanner.Api/Models enums/DTOs (see web/src/types/index.ts for the fuller
// web copy - kept in sync with it by hand since there's no shared package between the two apps).

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
}

export interface Dealer {
  id: string
  name: string
  code: string
  city?: string | null
  baplDmsDealerCode?: string | null
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
/// GET /api/bapl-dms/parts?locationCode=... .
export interface BaplDmsPartStock {
  itemCode: string
  availableQty: number
  description?: string | null
  mrp?: number | null
  hsnCode?: string | null
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
