// Mirrors backend/JobCardScanner.Api/Models enums/DTOs (see web/src/types/index.ts for the fuller web copy).

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

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: StaffRole
  dealerId?: string | null
  dealerName?: string | null
}

export interface JobCardSummary {
  id: string
  jobCardNumber: string
  status: JobCardStatus
  priority: string
  customerName?: string
  customerMobile?: string
  vehicleModel?: string
  vehicleRegNo?: string
  stageLabel?: string
  technicianName?: string
  createdAt: string
  expectedDeliveryAt?: string | null
}

export interface WorkflowStage {
  id: string
  stageKey: string
  label: string
  seq: number
  isTerminal: boolean
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

export interface JobCardDetail extends JobCardSummary {
  odometerAtCheckIn: number
  trackingToken: string
  customer?: { name: string; mobile: string }
  vehicle?: { model: string; variant?: string; regNo?: string }
  currentStage?: WorkflowStage
  complaints: { id: string; description: string }[]
  worklogs: JobCardWorklog[]
  qcChecklistItems: QcChecklistItem[]
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
