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

// ---- Part Suggestion / Labour Suggestion (mirrors web/src/types/index.ts - see that file's doc
// comments for the full backstory: both are sourced live from BAPL DMS's own tables, not this
// app's local catalog, and nothing is written back into BAPL DMS - suggesting one just records a
// row in JobCardScannerDb). ----

/// One part-availability row from BAPL DMS's own PartsInventory for a given service location -
/// GET /api/bapl-dms/parts?locationCode=... . itemCode is unique per row (already grouped/summed
/// server-side), unlike BaplDmsLabourRow below.
export interface BaplDmsPartStock {
  itemCode: string
  availableQty: number
}

/// A part suggested for this job card (POST .../part-suggestions) - itemCode + a Paid/U-W status
/// tracked only in JobCardScannerDb, toggle-able afterwards (PUT .../part-suggestions/{id}).
export interface JobCardPartSuggestion {
  id: string
  itemCode: string
  availableQtyAtSuggestion?: number | null
  status: 'Paid' | 'U/W'
  createdAt?: string
}

/// One labour rate-card row from BAPL DMS's own LabourMaster - GET /api/bapl-dms/labour?... .
/// IMPORTANT: labourCode is NOT unique per row (the same code repeats across different
/// CityTier/oemmodelname combos) - always key/select UI lists by `id`, never by `labourCode`
/// (see mobile/src/screens/JobCardDetailScreen.tsx's LabourSuggestionSection for why).
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

/// A labour line suggested for this job card (POST .../labour-suggestions) - Description/HSN/
/// GST/Rate are snapshotted from the LabourMaster row at suggestion time, not re-editable; Qty
/// and Issue Type (Paid/U-W) can be edited afterwards (PUT .../labour-suggestions/{id}).
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

export interface JobCardDetail extends JobCardSummary {
  odometerAtCheckIn: number
  trackingToken: string
  customer?: { name: string; mobile: string }
  vehicle?: { model: string; variant?: string; regNo?: string }
  currentStage?: WorkflowStage
  complaints: { id: string; description: string }[]
  worklogs: JobCardWorklog[]
  qcChecklistItems: QcChecklistItem[]
  // BAPL DMS scoping fields the suggestion pickers below need - see JobCardDetail's doc comment
  // in web/src/types/index.ts for the full explanation of each.
  baplServiceLocationCode?: string | null
  baplJobTypeId?: number | null
  baplServiceHeadId?: number | null
  baplServiceTypeId?: number | null
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
