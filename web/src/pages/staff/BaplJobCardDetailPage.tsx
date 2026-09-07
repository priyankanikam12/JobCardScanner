import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import type { BaplDmsJobCardDetail } from '../../types'

/**
 * Read-only view of one DMS job card (GET /api/bapl-dms/job-cards/{id}) - what a DMS row
 * on the /jobcards list links to (JobCardsListPage.tsx), since that row has no JobCardScanner
 * record of its own to open. Nothing here is editable - this is DMS's own data, not
 * JobCardScanner's, so there's no workflow/complaints/photos/etc. to act on, just what DMS
 * already has on file.
 */
export function BaplJobCardDetailPage() {
  const { jobCardHeaderId } = useParams<{ jobCardHeaderId: string }>()
  const [row, setRow] = useState<BaplDmsJobCardDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!jobCardHeaderId) return
    setLoading(true)
    setError(null)
    staffApi.get<BaplDmsJobCardDetail>(`/api/bapl-dms/job-cards/${jobCardHeaderId}`)
      .then(({ data }) => setRow(data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load this DMS job card.'))
      .finally(() => setLoading(false))
  }, [jobCardHeaderId])

  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '-')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ background: '#1c64f2', color: '#fff', fontSize: 13, fontWeight: 600, padding: '2px 10px', borderRadius: 999 }}>
            DMS
          </span>
          {row ? `${row.jobPrefix ?? ''}${row.jobNo ?? ''}` : 'Job Card'}
        </h2>
        <Link className="btn" to="/jobcards">← Back to Job Cards</Link>
      </div>

      {loading && <p className="muted" style={{ marginTop: 16 }}>Loading…</p>}
      {error && <p className="error-text" style={{ marginTop: 16 }}>{error}</p>}

      {row && (
        <div className="form-row" style={{ marginTop: 16 }}>
          <div className="card">
            <h3>Customer & Vehicle</h3>
            <p><strong>{row.customerName ?? '-'}</strong><br />{row.customerMobile ?? '-'}{row.customerAltMobile ? ` / ${row.customerAltMobile}` : ''}</p>
            <p>{row.modelName ?? '-'}<br />Reg: {row.registerNo ?? '-'} | Chassis: {row.chassisNo ?? '-'}</p>
            <p className="muted">
              Motor: {row.motorNo ?? '-'} · Battery: {row.batteryNo ?? '-'} · Controller: {row.controllerNo ?? '-'} · Charger: {row.chargerNo ?? '-'}
            </p>
          </div>

          <div className="card">
            <h3>Job Details</h3>
            <p>Status: <strong>{row.jobStatus ?? 'Unknown'}</strong> · Inward type: {row.inwardType ?? '-'}</p>
            <p>Job-in date: {fmt(row.jobInDate)} · Vehicle km: {row.vehicleKms ?? '-'}</p>
            <p>Supervisor: {row.supervisor ?? '-'} · Technician: {row.technician ?? '-'}</p>
            <p>Dealer code: {row.dealerCode ?? '-'} · Invoice no.: {row.invoiceNo ?? '-'}</p>
          </div>

          <div className="card">
            <h3>Complaints</h3>
            <p>{row.complaints || 'None recorded'}</p>
          </div>

          <div className="card">
            <h3>Dates on file</h3>
            <p>Sale date: {fmt(row.saleDate)}</p>
            <p>Insurance expiry: {fmt(row.insuranceExpDate)}</p>
            <p>Next service due: {fmt(row.nextServiceDueDate)}</p>
            <p>RSA renewal: {fmt(row.rsaRenewalDate)}</p>
          </div>

          {row.remarks && (
            <div className="card">
              <h3>Remarks</h3>
              <p>{row.remarks}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

