import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { staffApi } from '../../api/client'
import type { BaplDmsInvoiceLineItemsResult, BaplDmsJobCardDetail } from '../../types'

/**
 * Read-only view of one DMS job card (GET /api/bapl-dms/job-cards/{id}) - what a DMS row
 * on the /jobcards list links to (JobCardsListPage.tsx), since that row has no JobCardScanner
 * record of its own to open. Nothing here is editable - this is DMS's own data, not
 * JobCardScanner's, so there's no workflow/complaints/photos/etc. to act on, just what DMS
 * already has on file.
 *
 * 2026-09-07 ("this also show like whole data in our jobcard flow"): also loads the same
 * Part Details/Labour Details/Grand Total breakdown and "Download Invoice from DMS" button the
 * native JobCardDetailPage's Estimates Amount/Invoice cards show for a JobCardScanner-native job
 * card - sourced entirely from DMS's own repair bill (GET /api/bapl-dms/job-cards/{id}/line-items
 * and .../invoice-pdf) since this job card has no local record of its own to read instead. A 404
 * from either just means DMS hasn't raised a repair bill for this job yet (normal for one still
 * Open) - not an error, so it's shown as a plain "not billed yet" note, not error-text.
 */
export function BaplJobCardDetailPage() {
  const { jobCardHeaderId } = useParams<{ jobCardHeaderId: string }>()
  const [row, setRow] = useState<BaplDmsJobCardDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lineItems, setLineItems] = useState<BaplDmsInvoiceLineItemsResult | null>(null)
  const [lineItemsError, setLineItemsError] = useState<string | null>(null)
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceNotice, setInvoiceNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!jobCardHeaderId) return
    setLoading(true)
    setError(null)
    staffApi.get<BaplDmsJobCardDetail>(`/api/bapl-dms/job-cards/${jobCardHeaderId}`)
      .then(({ data }) => setRow(data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load this DMS job card.'))
      .finally(() => setLoading(false))

    setLineItems(null)
    setLineItemsError(null)
    staffApi.get<BaplDmsInvoiceLineItemsResult>(`/api/bapl-dms/job-cards/${jobCardHeaderId}/line-items`)
      .then(({ data }) => setLineItems(data))
      .catch((err) => {
        if (err?.response?.status !== 404) setLineItemsError(err?.response?.data?.message ?? 'Could not load the parts/labour breakdown from DMS.')
        // 404 = DMS has no repair bill for this job yet - normal, leave lineItems null quietly.
      })
  }, [jobCardHeaderId])

  const downloadInvoice = async () => {
    if (!jobCardHeaderId) return
    setInvoiceBusy(true)
    setInvoiceNotice(null)
    try {
      const { data } = await staffApi.get(`/api/bapl-dms/job-cards/${jobCardHeaderId}/invoice-pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `invoice-dms-${jobCardHeaderId}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) setInvoiceNotice('No repair bill saved in DMS for this job yet.')
      else setInvoiceNotice('Could not download the invoice from DMS. Please try again.')
    } finally {
      setInvoiceBusy(false)
    }
  }

  const money = (n: number) => `₹${n.toFixed(2)}`
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

      {row && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Estimates Amount (from DMS repair bill)</h3>
          {lineItemsError && <p className="error-text">{lineItemsError}</p>}
          {!lineItemsError && !lineItems && <p className="muted">No repair bill raised in DMS for this job yet.</p>}
          {lineItems && (
            <>
              <h4>Part Details</h4>
              <table>
                <thead><tr><th>Sr no.</th><th>Item Code</th><th>Description</th><th>HSN</th><th>Rate</th><th>Qty</th><th>Amount</th></tr></thead>
                <tbody>
                  {lineItems.items.filter((i) => i.isPart).map((r, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td><td>{r.code}</td><td>{r.description}</td><td>{r.hsn}</td>
                      <td>{money(r.rate)}</td><td>{r.qty}</td><td>{money(r.netAmount)}</td>
                    </tr>
                  ))}
                  {lineItems.items.filter((i) => i.isPart).length === 0 && <tr><td colSpan={7} className="muted">No part lines on this bill.</td></tr>}
                </tbody>
                <tfoot><tr><td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>Parts Total</td><td style={{ fontWeight: 600 }}>{money(lineItems.partTotal)}</td></tr></tfoot>
              </table>

              <h4 style={{ marginTop: 16 }}>Labour Details</h4>
              <table>
                <thead><tr><th>Sr no.</th><th>Labour Code</th><th>Description</th><th>HSN</th><th>Rate</th><th>Qty</th><th>Amount</th></tr></thead>
                <tbody>
                  {lineItems.items.filter((i) => !i.isPart).map((r, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td><td>{r.code}</td><td>{r.description}</td><td>{r.hsn}</td>
                      <td>{money(r.rate)}</td><td>{r.qty}</td><td>{money(r.netAmount)}</td>
                    </tr>
                  ))}
                  {lineItems.items.filter((i) => !i.isPart).length === 0 && <tr><td colSpan={7} className="muted">No labour lines on this bill.</td></tr>}
                </tbody>
                <tfoot><tr><td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>Labour Total</td><td style={{ fontWeight: 600 }}>{money(lineItems.labourTotal)}</td></tr></tfoot>
              </table>

              <div style={{
                marginTop: 16, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12,
                borderTop: '2px solid var(--border)', paddingTop: 10, flexWrap: 'wrap',
              }}>
                <strong style={{ fontSize: 16 }}>Grand Total</strong>
                <strong style={{ fontSize: 18 }}>{money(lineItems.invoiceTotal)}</strong>
              </div>
            </>
          )}
        </div>
      )}

      {row && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Invoice</h3>
          <button className="btn btn-primary btn-sm" disabled={invoiceBusy} onClick={downloadInvoice}>
            {invoiceBusy ? 'Downloading…' : 'Download Invoice from DMS'}
          </button>
          {invoiceNotice && <p className="muted" style={{ marginTop: 8 }}>{invoiceNotice}</p>}
        </div>
      )}
    </div>
  )
}

