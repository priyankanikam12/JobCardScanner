// web\src\components\StatusBadge.tsx
const COLOR_MAP: Record<string, string> = {
  Open: 'badge',
  InProgress: 'badge-warning',
  PendingCustomerApproval: 'badge-warning',
  PendingQc: 'badge-warning',
  PendingClosure: 'badge-warning',
  PendingInvoice: 'badge-warning',
  Closed: 'badge-success',
  Cancelled: 'badge-muted',
  Draft: 'badge-muted',
  Approved: 'badge-success',
  Rejected: 'badge-danger',
  Generated: 'badge',
  Paid: 'badge-success',
  Requested: 'badge',
  Issued: 'badge-success',
  Returned: 'badge-muted',
  // BAPL DMS's own computed job card statuses (see BaplDmsService.SearchJobCardsAsync/
  // GetJobCardByIdAsync's JobStatus CASE expression).
  Complete: 'badge-success',
  'Material Transfer': 'badge-warning',
  'FFIR Created': 'badge-warning',
  'FFIR Closed': 'badge-muted',
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${COLOR_MAP[status] ?? ''}`}>{status}</span>
}
