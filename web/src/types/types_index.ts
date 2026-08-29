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
  status: JobCardStatus
  serviceType: ServiceType
  priority: JobCardPriority
  customerName?: string
  customerMobile?: string
  vehicleModel?: string
  vehicleRegNo?: string
  stageLabel?: string
  serviceAdvisorName?: string
  technicianName?: string
  createdAt: string
  expectedDeliveryAt?: string | null
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

export interface PartMaster {
  id: string
  partNumber: string
  name: string
  category?: string | null
  unitPrice: number
  stockQty: number
}

export interface JobCardDetail extends Omit<JobCardSummary, 'customerName' | 'vehicleModel'> {
  odometerAtCheckIn: number
  batteryLevelAtCheckIn?: number | null
  trackingToken: string
  customer?: Customer
  vehicle?: Vehicle
  dealer?: { id: string; name: string; code: string } | null
  currentStage?: WorkflowStage
  serviceAdvisor?: { id: string; name: string } | null
  assignedTechnician?: { id: string; name: string } | null
  complaints: JobCardComplaint[]
  inspections: JobCardInspection[]
  photos: JobCardPhoto[]
  stageHistory: JobCardStageHistoryEntry[]
  worklogs: JobCardWorklog[]
  qcChecklistItems: QcChecklistItem[]
  estimates: Estimate[]
  parts: JobCardPart[]
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