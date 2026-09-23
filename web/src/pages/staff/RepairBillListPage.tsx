import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsWorkshop, CombinedRepairBillRow } from '../../types'
import { Pagination } from '../../components/Pagination'
import { usePagination } from '../../lib/usePagination'
import { RecordDetailModal } from '../../components/RecordDetailModal'

/**
 * "Repair Bill List" page (2026-09-23, "Source SR.No Bill No Date Party Name Reg No Chassis No
 * Location Bill Type Job No Bill Amount Status Prepared by Modified by this main in 1 page not on
 * same only which are save in jobcard db that in grid button and which material transfer that
 * jobcard"): split out of RepairBillCreatePage.tsx, which used to render this same table directly
 * below its own create/edit form on one page (`/repair-bill-new`) - confirmed via AskUserQuestion
 * ("Android + Web: both get a separate list screen/page"). This is now its own page/route
 * (`/repair-bill-list`), and per the second confirmed answer ("JobCardScanner rows only") it shows
 * ONLY this dealer's own bills saved in JobCardScanner's own database - the read-only DMSBAPLDATA-
 * synced rows RepairBillCreatePage.tsx's own list used to blend in (tagged by a Source badge) are
 * no longer shown here at all. Calls GET /api/repair-bill-docs/combined with the new `ownOnly=true`
 * param (RepairBillDocsController.Combined's own doc comment) so the backend doesn't even bother
 * querying DMSBAPLDATA for a list that would just discard it - Source is still shown as its own
 * column (every row reads "JobCardScanner") only because you explicitly listed it in your own
 * column spec, even though it's now constant.
 *
 * Column set, action column, filters (Date From/To/Service Location/Bill No/Job No/Chassis No),
 * pagination, and the read-only detail popup (for a Billed/Cancelled row) are a direct port of
 * RepairBillCreatePage.tsx's own list section - see that file's history for the column set's own
 * "according /repair-bill-list do in our repair bill" provenance. The "Filter DMSBAPLDATA rows by
 * Party Name" filter is DROPPED here (it only ever narrowed the DMSBAPLDATA half, which this page
 * no longer fetches at all).
 *
 * The grid Edit button (and row click, for a still-Performa row) now NAVIGATES to
 * `/repair-bill-new?editId={id}` instead of calling startEditBill() in place - see
 * RepairBillCreatePage.tsx's own top-of-file doc comment for how that page reads `editId` off the
 * URL on mount and reopens the same edit flow it always had. A Billed/Cancelled row still opens
 * the read-only RecordDetailModal popup right here, same as before (nothing left to edit there).
 */
export function RepairBillListPage() {
  const { profile, hasRole } = useStaffAuth()
  const canDelete = hasRole('SystemAdmin')
  const navigate = useNavigate()

  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  useEffect(() => {
    if (!profile?.dealerId) return
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then(({ data }) => {
        const scoped = profile?.workLocationCodes?.length ? data.filter((w) => profile.workLocationCodes.includes(w.locCode)) : data
        setWorkshops(scoped)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.dealerId, profile?.workLocationCodes])

  const [listDateFrom, setListDateFrom] = useState('')
  const [listDateTo, setListDateTo] = useState('')
  const [listLocation, setListLocation] = useState('')
  const [listBillNo, setListBillNo] = useState('')
  const [listJobNo, setListJobNo] = useState('')
  const [listChassisNo, setListChassisNo] = useState('')
  const [rows, setRows] = useState<CombinedRepairBillRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadCombined = () => {
    setLoading(true)
    staffApi
      .get<{ rows: CombinedRepairBillRow[]; dmsBaplDataError: string | null }>('/api/repair-bill-docs/combined', {
        params: {
          ownOnly: true,
          billNo: listBillNo || undefined,
          jobNo: listJobNo || undefined,
          chassisNo: listChassisNo || undefined,
          locationCode: listLocation || undefined,
          dateFrom: listDateFrom || undefined,
          dateTo: listDateTo || undefined,
        },
      })
      // ownOnly=true already means every row back is source: 'JobCardScanner' - the .filter is a
      // defensive belt-and-braces in case that ever isn't true (e.g. a future backend change),
      // rather than trusting the query param silently.
      .then((r) => { setRows(r.data.rows.filter((row) => row.source === 'JobCardScanner')); setLoadError(null) })
      .catch(() => { setRows([]); setLoadError('Could not load the repair bill list.') })
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadCombined() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteBill = (id: string) => {
    if (!window.confirm('Delete this repair bill? This cannot be undone.')) return
    staffApi.delete(`/api/repair-bill-docs/${id}`)
      .then(() => loadCombined())
      .catch((err) => alert(err?.response?.data?.message ?? 'Could not delete the repair bill.'))
  }

  // Same PUT .../status Billed transition as RepairBillCreatePage.tsx's own saveAsInvoice/
  // finalizeEditingBillAsInvoice - see either's doc comment for why the body must be a JSON string.
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const saveAsInvoice = (bill: CombinedRepairBillRow) => {
    if (!window.confirm(`Save Bill ${bill.billNumber} as Invoice? This finalizes it - line items can no longer be changed afterwards.`)) return
    setConvertingId(bill.id)
    staffApi
      .put(`/api/repair-bill-docs/${bill.id}/status`, JSON.stringify('Billed'), { headers: { 'Content-Type': 'application/json' } })
      .then(() => {
        setViewingBill((v) => (v && v.id === bill.id ? { ...v, status: 'Billed' } : v))
        loadCombined()
      })
      .catch((err) => alert(err?.response?.data?.message ?? 'Could not save this bill as an Invoice.'))
      .finally(() => setConvertingId(null))
  }

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(rows)

  const [viewingBill, setViewingBill] = useState<CombinedRepairBillRow | null>(null)
  const fmtBillCell = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v))
  const billItemColumns = ['Item Type', 'Item Code', 'Description', 'HSN', 'Issue Type', 'Qty', 'Rate', 'Discount', 'CGST %', 'SGST %', 'IGST %', 'Taxable Amt', 'Total Amt']
  const billItemRows = (viewingBill?.items ?? []).map((it) => [
    fmtBillCell(it.itemType), fmtBillCell(it.itemCode), fmtBillCell(it.itemDescription), fmtBillCell(it.hsnCode), fmtBillCell(it.issueType), fmtBillCell(it.qty), fmtBillCell(it.rate),
    fmtBillCell(it.discountValue), fmtBillCell(it.cgstPct), fmtBillCell(it.sgstPct), fmtBillCell(it.igstPct), fmtBillCell(it.taxableAmount), fmtBillCell(it.totalAmount),
  ])

  return (
    <div>
      <h2>Repair Bill List</h2>
      <p className="muted">
        Every repair bill saved in JobCardScanner's own database - click a still-Performa bill (or
        its ✎ button) to open and edit it, or a Billed/Cancelled one to view its full details.
      </p>

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>Date From</label>
            <input type="date" value={listDateFrom} onChange={(e) => setListDateFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>Date To</label>
            <input type="date" value={listDateTo} onChange={(e) => setListDateTo(e.target.value)} />
          </div>
          <div className="field">
            <label>Service Location</label>
            {workshops.length > 0 ? (
              <select value={listLocation} onChange={(e) => setListLocation(e.target.value)}>
                <option value="">All locations</option>
                {workshops.map((w) => (
                  <option key={w.locCode} value={w.locCode}>{w.locCode} — {w.locName}</option>
                ))}
              </select>
            ) : (
              <input value={listLocation} onChange={(e) => setListLocation(e.target.value)} placeholder="Workshop location" />
            )}
          </div>
          <div className="field">
            <label>Bill No.</label>
            <input value={listBillNo} onChange={(e) => setListBillNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCombined()} placeholder="Enter Bill No." />
          </div>
          <div className="field">
            <label>Job No.</label>
            <input value={listJobNo} onChange={(e) => setListJobNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCombined()} placeholder="Enter Job No." />
          </div>
          <div className="field">
            <label>Chassis No.</label>
            <input value={listChassisNo} onChange={(e) => setListChassisNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCombined()} placeholder="Enter Chassis No." />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={loadCombined} disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
          <button className="btn btn-sm" onClick={() => navigate('/repair-bill-new')}>+ New Repair Bill</button>
        </div>
        {loadError && <p className="muted" style={{ color: '#b91c1c' }}>{loadError}</p>}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>SR.No</th>
              <th>Bill No</th>
              <th>Date</th>
              <th>Party Name</th>
              <th>Reg No</th>
              <th>Chassis No</th>
              <th>Location</th>
              <th>Bill Type</th>
              <th>Job No</th>
              <th className="text-end">Bill Amount</th>
              <th>Status</th>
              <th>Prepared by</th>
              <th>Modified by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr
                key={r.id}
                onClick={() => (r.status === 'Performa' ? navigate(`/repair-bill-new?editId=${r.id}`) : setViewingBill(r))}
                style={{ cursor: 'pointer' }}
                title={r.status === 'Performa' ? 'Click to open and edit this Proforma bill' : 'Click to view full details'}
              >
                <td><span className="badge badge-success">{r.source}</span></td>
                <td>{((page - 1) * pageSize) + i + 1}</td>
                <td>{r.billNumber}</td>
                <td>{r.sortDate ? new Date(r.sortDate).toLocaleDateString('en-IN') : '—'}</td>
                <td>{r.partyName ?? '—'}</td>
                <td>{r.regNo ?? '—'}</td>
                <td>{r.chassisNo ?? '—'}</td>
                <td>{r.location ?? '—'}</td>
                <td>{r.billType ?? '—'}</td>
                <td>{r.jobNo ?? '—'}</td>
                <td className="text-end">₹{r.totalAmount.toFixed(2)}</td>
                <td>{r.status ?? '—'}</td>
                <td>{r.preparedBy ?? '—'}</td>
                <td>{r.modifiedBy ?? '—'}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {r.status === 'Performa' && (
                      <button className="btn btn-icon" onClick={() => navigate(`/repair-bill-new?editId=${r.id}`)} title="Edit this Proforma bill">✎</button>
                    )}
                    {canDelete && (
                      <button className="btn btn-icon btn-danger" onClick={() => deleteBill(r.id)} title="Delete (SystemAdmin only)">✕</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={15} className="muted" style={{ textAlign: 'center', padding: 16 }}>No repair bills yet.</td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>

      {viewingBill && (
        <RecordDetailModal
          title={`Bill ${viewingBill.billNumber}`}
          subtitle={`${viewingBill.source}${viewingBill.location ? ` · ${viewingBill.location}` : ''}`}
          onClose={() => setViewingBill(null)}
          fields={[
            { label: 'Source', value: viewingBill.source },
            { label: 'Bill No', value: viewingBill.billNumber },
            { label: 'Date', value: viewingBill.sortDate ? new Date(viewingBill.sortDate).toLocaleDateString('en-IN') : null },
            { label: 'Party Name', value: viewingBill.partyName },
            { label: 'Reg No', value: viewingBill.regNo },
            { label: 'Chassis No', value: viewingBill.chassisNo },
            { label: 'Location', value: viewingBill.location },
            { label: 'Bill Type', value: viewingBill.billType },
            { label: 'Job No', value: viewingBill.jobNo },
            { label: 'Status', value: viewingBill.status },
            { label: 'Item Count', value: viewingBill.itemCount },
            { label: 'Total Amount', value: `₹${viewingBill.totalAmount.toFixed(2)}` },
            { label: 'Prepared By', value: viewingBill.preparedBy },
            { label: 'Modified By', value: viewingBill.modifiedBy },
          ]}
          itemsTitle="Items"
          itemColumns={billItemColumns}
          itemRows={billItemRows}
          actions={
            viewingBill.status === 'Performa' ? (
              <button
                className="btn btn-primary btn-sm"
                disabled={convertingId === viewingBill.id}
                onClick={() => saveAsInvoice(viewingBill)}
              >
                {convertingId === viewingBill.id ? 'Saving…' : 'Save as Invoice'}
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
