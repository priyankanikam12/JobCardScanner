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
export type PhotoStage = 'CheckIn' | 'Inspection' | 'Repair' | 'Qc' | 'Delivery'

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: StaffRole
  dealerId?: string | null
  dealerName?: string | null
}

export interface Dealer {
  id: string
  name: string
  code: string
  city?: string | null
  baplDmsDealerCode?: string | null
}

// ---------------- BAPL DMS integration (Job Card Wizard dealer/vehicle auto-fill - mirrors
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
  customerAddress?: string | null
  customerEmail?: string | null
  // Battery Details fields sourced from BAPL DMS's ChassisBatteryDetails table.
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

/// One row from BAPL DMS's JobSource master (Walk In / RSA / Mega Camp / ...).
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

/// One part-availability row from BAPL DMS's own PartsInventory for a given service location -
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

/// One labour rate-card row from BAPL DMS's own LabourMaster - GET /api/bapl-dms/labour?... .
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
  // A BaplDms row's status is BAPL DMS's own free-text JobStatus, not one of JobCardStatus's fixed
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

export interface DashboardKpis {
  totalOpen: number
  openToday: number
  closedThisMonth: number
  pendingApproval: number
  overdue: number
  avgTurnaroundHours: number
}

export interface PartMaster {
  id: string
  partNumber: string
  name: string
  category?: string | null
  unitPrice: number
  stockQty: number
}
