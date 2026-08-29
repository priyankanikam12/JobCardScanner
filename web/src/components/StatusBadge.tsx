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
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${COLOR_MAP[status] ?? ''}`}>{status}</span>
}
