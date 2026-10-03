// web\src\pages\staff\MaterialTransferListPage.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsWorkshop, CombinedMaterialTransferRow } from '../../types'
import { Pagination } from '../../components/Pagination'
import { usePagination } from '../../lib/usePagination'
import { RecordDetailModal } from '../../components/RecordDetailModal'

/**
 * "Material Transfer List" page (2026-09-23, "in repairbill which we added button like this add
 * in material transfer for showing which we transferred material transferre" - you pasted
 * RepairBillCreatePage.tsx's own "☰ Repair Bill List" header button and asked for the same thing
 * here): split out of MaterialTransferCreatePage.tsx, which used to render this same table
 * directly below its own create/edit form on one page (`/material-transfer-bill`) - mirrors
 * RepairBillListPage.tsx's own identical split (see that file's doc comment for the full
 * AskUserQuestion-confirmed reasoning this reuses: separate page/screen per platform, this
 * dealer's own JobCardScanner-saved rows only, not the read-only DMSBAPLDATA-synced ones).
 *
 * Calls GET /api/material-transfer-docs/combined with the new `ownOnly=true` param
 * (MaterialTransferDocsController.Combined's own doc comment, added alongside this page) so the
 * backend doesn't even attempt the DMSBAPLDATA call for a list that would just discard it - Source
 * is still shown as its own column (every row reads "JobCardScanner") only for the same column-
 * parity reason RepairBillListPage.tsx keeps it, even though it's now constant here too.
 *
 * The old "DMS workshop location (for the DMSBAPLDATA rows below)" filter is DROPPED (it only ever
 * narrowed/gated the DMSBAPLDATA half, which this page no longer fetches at all) - replaced by a
 * genuine Service Location filter that now actually narrows THIS dealer's own rows (via the new
 * `locationCode` param, applied server-side to MaterialTransferDoc.Location - the old filter never
 * did this, since `locCode` was only ever passed to the DMSBAPLDATA call). Transfer No/Job No/Date
 * From/To filters added too, matching RepairBillListPage.tsx's own filter set and the equally-new
 * server-side params.
 *
 * A still-Draft row's row-click (or its own ✎ button) NAVIGATES to
 * `/material-transfer-bill?editId={id}` instead of opening the edit form in place (there's no "in
 * place" left - it's a different page now) - mirrors RepairBillListPage.tsx exactly. A Confirmed/
 * Cancelled row still opens the same read-only RecordDetailModal popup as before (nothing left to
 * edit there); unlike Repair Bill's popup, no "Confirm Transfer" action is offered from it, since a
 * Draft row (the only status "Confirm Transfer" would ever apply to) never reaches the popup in the
 * first place - it navigates to the edit form instead, exactly as the old embedded list did.
 *
 * FACT: this page's own Delete button carries NO SystemAdmin/canDelete gate, unlike
 * RepairBillListPage.tsx's own - this matches MaterialTransferCreatePage.tsx's OLD embedded list's
 * Delete button exactly, which never had one either (confirmed by reading that file before this
 * split - `hasRole`/`canDelete` were never imported/used there at all). Left exactly as-is, not
 * silently tightened to match Repair Bill's own stricter rule.
 *
 * 2026-10-03 ("Date From default select start date of month and Date To default today date ...
 * and below search data" + "in pagination 10 default select"): same two defaults as
 * RepairBillListPage.tsx's identical 2026-10-03 change - see that file's top-of-file doc comment
 * for the full reasoning (local-date math, not UTC; scoped setPageSize(10) rather than touching
 * usePagination's own shared default). The Date From/To, Service Location, Transfer No and Job No
 * filters and the Search button were already present and wired into loadCombined()'s params before
 * this change; nothing about that wiring itself changed here, just these two defaults.
 */
function toLocalIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function todayIso(): string {
  return toLocalIso(new Date())
}
function startOfMonthIso(): string {
  const d = new Date()
  return toLocalIso(new Date(d.getFullYear(), d.getMonth(), 1))
}

export function MaterialTransferListPage() {
  const { profile } = useStaffAuth()
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

  // 2026-10-03: default Date From/To to this month's 1st / today - see this file's top-of-file
  // doc comment for why local-date math is used instead of toISOString().
  const [listDateFrom, setListDateFrom] = useState(startOfMonthIso())
  const [listDateTo, setListDateTo] = useState(todayIso())
  const [listLocation, setListLocation] = useState('')
  const [listTransferNo, setListTransferNo] = useState('')
  const [listJobNo, setListJobNo] = useState('')
  const [rows, setRows] = useState<CombinedMaterialTransferRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadCombined = () => {
    setLoading(true)
    staffApi
      .get<{ rows: CombinedMaterialTransferRow[]; dmsBaplDataError: string | null }>('/api/material-transfer-docs/combined', {
        params: {
          ownOnly: true,
          transferNo: listTransferNo || undefined,
          jobNo: listJobNo || undefined,
          locationCode: listLocation || undefined,
          dateFrom: listDateFrom || undefined,
          dateTo: listDateTo || undefined,
        },
      })
      // ownOnly=true already means every row back is source: 'JobCardScanner' - the .filter is a
      // defensive belt-and-braces in case that ever isn't true (e.g. a future backend change),
      // rather than trusting the query param silently - same reasoning as RepairBillListPage.tsx.
      .then((r) => { setRows(r.data.rows.filter((row) => row.source === 'JobCardScanner')); setLoadError(null) })
      .catch(() => { setRows([]); setLoadError('Could not load the material transfer list.') })
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadCombined() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteTransfer = (id: string) => {
    if (!window.confirm('Delete this material transfer? This cannot be undone.')) return
    staffApi.delete(`/api/material-transfer-docs/${id}`)
      .then(() => loadCombined())
      .catch((err) => alert(err?.response?.data?.message ?? 'Could not delete the material transfer.'))
  }

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(rows)
  // 2026-10-03 ("pagination 10 default select"): see this file's top-of-file doc comment - a
  // scoped, one-time default for THIS page only, not a change to usePagination's own internal
  // default (which RepairBillPage.tsx/MaterialTransferPage.tsx/VehicleSalePage.tsx also rely on).
  useEffect(() => { setPageSize(10) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 2026-09-23 - read-only detail popup for a Confirmed/Cancelled row, ported from the old embedded
  // list (MaterialTransferCreatePage.tsx's own viewingTransfer) - always source: 'JobCardScanner'
  // here (the DMSBAPLDATA item-column shape that page's own transferItemColumns/transferItemRows
  // branched on is dropped, since that source never reaches this page).
  const [viewingTransfer, setViewingTransfer] = useState<CombinedMaterialTransferRow | null>(null)
  const fmtCell = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v))
  const transferItemColumns = ['Item Code', 'Description', 'HSN', 'Issue Type', 'Qty', 'Rate', 'Amount', 'Rack', 'Bin', 'Serial No', 'MRP', 'Valid Days', 'Received']
  const transferItemRows = (viewingTransfer?.items ?? []).map((it) => [
    fmtCell(it.itemCode), fmtCell(it.itemDescription), fmtCell(it.hsnCode), fmtCell(it.issueType), fmtCell(it.qty), fmtCell(it.rate),
    fmtCell(it.amount), fmtCell(it.rackNo), fmtCell(it.bin), fmtCell(it.serialNo), fmtCell(it.mrp), fmtCell(it.validDays), fmtCell(it.itemReceived),
  ])

  return (
    <div>
      <h2>Material Transfer List</h2>
      <p className="muted">
        Every material transfer saved in JobCardScanner's own database - click a still-Draft
        transfer (or its ✎ button) to open and edit it, or a Confirmed/Cancelled one to view its
        full details.
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
            <label>Transfer No.</label>
            <input value={listTransferNo} onChange={(e) => setListTransferNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCombined()} placeholder="Enter Transfer No." />
          </div>
          <div className="field">
            <label>Job No.</label>
            <input value={listJobNo} onChange={(e) => setListJobNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadCombined()} placeholder="Enter Job No." />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={loadCombined} disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
          <button className="btn btn-sm" onClick={() => navigate('/material-transfer-bill')}>+ New Material Transfer</button>
        </div>
        {loadError && <p className="muted" style={{ color: '#b91c1c' }}>{loadError}</p>}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Transfer No</th>
              <th>Date</th>
              <th>Location</th>
              <th>Type</th>
              <th>Party</th>
              <th>Job No</th>
              <th>Status</th>
              <th className="text-end">Items</th>
              <th className="text-end">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr
                key={r.id}
                onClick={() => (r.status === 'Draft' ? navigate(`/material-transfer-bill?editId=${r.id}`) : setViewingTransfer(r))}
                style={{ cursor: 'pointer' }}
                title={r.status === 'Draft' ? 'Click to open and edit this Draft transfer' : 'Click to view full details'}
              >
                <td><span className="badge badge-success">{r.source}</span></td>
                <td>{r.transferNumber}</td>
                <td>{r.sortDate ? new Date(r.sortDate).toLocaleDateString('en-IN') : '—'}</td>
                <td>{r.location ?? '—'}</td>
                <td>{r.transferType ?? '—'}</td>
                <td>{r.partyName ?? '—'}</td>
                <td>{r.jobNo ?? '—'}</td>
                <td>{r.status ?? '—'}</td>
                <td className="text-end">{r.itemCount}</td>
                <td className="text-end">₹{r.totalAmount.toFixed(2)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {r.status === 'Draft' && (
                      <button className="btn btn-icon" onClick={() => navigate(`/material-transfer-bill?editId=${r.id}`)} title="Edit this Draft transfer">✎</button>
                    )}
                    <button className="btn btn-icon btn-danger" onClick={() => deleteTransfer(r.id)} title="Delete">✕</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={11} className="muted" style={{ textAlign: 'center', padding: 16 }}>No material transfers yet.</td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>

      {viewingTransfer && (
        <RecordDetailModal
          title={`Transfer ${viewingTransfer.transferNumber}`}
          subtitle={`${viewingTransfer.source}${viewingTransfer.location ? ` · ${viewingTransfer.location}` : ''}`}
          onClose={() => setViewingTransfer(null)}
          fields={[
            { label: 'Source', value: viewingTransfer.source },
            { label: 'Transfer No', value: viewingTransfer.transferNumber },
            { label: 'Date', value: viewingTransfer.sortDate ? new Date(viewingTransfer.sortDate).toLocaleDateString('en-IN') : null },
            { label: 'Location', value: viewingTransfer.location },
            { label: 'Type', value: viewingTransfer.transferType },
            { label: 'Party', value: viewingTransfer.partyName },
            { label: 'Job No', value: viewingTransfer.jobNo },
            { label: 'Status', value: viewingTransfer.status },
            { label: 'Item Count', value: viewingTransfer.itemCount },
            { label: 'Total Amount', value: `₹${viewingTransfer.totalAmount.toFixed(2)}` },
          ]}
          itemsTitle="Items"
          itemColumns={transferItemColumns}
          itemRows={transferItemRows}
        />
      )}
    </div>
  )
}
