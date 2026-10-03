// web\src\pages\staff\PartUploadPage.tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsWorkshop, PartUpload, PartUploadImportResult } from '../../types'
import { ReportDownloadButtons } from '../../components/ReportDownloadButtons'
import { Pagination } from '../../components/Pagination'
import { RecordDetailModal } from '../../components/RecordDetailModal'
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '../../lib/exportReport'
import { usePagination } from '../../lib/usePagination'

/**
 * "Part Upload" sidebar tab (2026-09-21: "new tab add Part Upload using this excel create table
 * and functionality to upload using this excel file for upload" - referring to the attached
 * "Stock Summary Detail Report from 01-04-2026 to 21-09-2026 of MAGNEMITE MOTO LLP-DELHI...xlsx").
 * Same import shape as LabourMasterPage.tsx (upload -> upsert by key, re-import updates rather than
 * duplicates), saved into JobCardScannerDb ("that all from save in JobCardScannerDb ... all flow
 * with JobCardScannerDb"), scoped to the signed-in user's own dealer - see
 * Controllers/PartUploadController.cs and Models/PartUploads.cs for the full reasoning.
 *
 * FACT worth surfacing here, not just in code comments: this spreadsheet is a STOCK report
 * (opening/purchase/sale/closing quantities for a date range) - it has Part No/Description/HSN-SAC
 * Code/Group Name/Item Type/BillPrice and several period quantity columns, but NO GST/CGST/SGST/
 * IGST rate column. Uploading it here does not supply the per-part GST% that Material Transfer/
 * Repair Bill would need to auto-fetch tax on item select - that remains a separate, still-open
 * gap (see MaterialTransferCreatePage.tsx's doc comment).
 *
 * 2026-09-21 correction ("before that 4 feild need to select Date, Location (which access have
 * this dealer that show in dropdown and that locate that date then Upload file* otherwise dont
 * take the file need to select this feild then upload according"): Location and Date are now
 * REQUIRED, picked BEFORE the file input is even enabled - Location is a dropdown scoped to the
 * signed-in user's own accessible workshop locations, same pattern as RepairBillCreatePage.tsx/
 * MaterialTransferCreatePage.tsx's own Location field (GET /api/bapl-dms/workshops?dealerId=...
 * filtered by profile.workLocationCodes). BalQty/BalAmnt reflect stock as of the most recently
 * uploaded report for this dealer+location - re-uploading a newer report for the SAME location
 * updates those figures in place per Part No; a different location's report is kept as its own
 * set of rows (real stock genuinely differs by location).
 *
 * Also added this round: a Location column and an Edit button (PUT /api/part-uploads/{id}) on the
 * results grid, mirroring LabourMasterPage.tsx's own edit-card pattern.
 *
 * 2026-10-03 ("in part upload also add date filter"): new Date From/Date To filter on the results
 * grid (filterDateFrom/filterDateTo below), wired into the new dateFrom/dateTo params
 * PartUploadController.Get()/PartUploadService.GetAsync now accept - filters on each row's Report
 * Date. This grid had NO date filter at all before this (the only Date field on the page was the
 * required upload-form Date above, a separate concept from a results filter). Both default to
 * empty/unset (no filter) rather than a date range, unlike RepairBillListPage.tsx/
 * MaterialTransferListPage.tsx's own "this month" default - not asked for here, and this grid's
 * rows are "current stock as of last upload" rather than a dated transaction log, so a default
 * range could easily hide rows the user expects to see by default. Tell me if you'd rather this
 * default to the same "1st of month to today" range and I'll match it.
 *
 * Also separately reported this round, from a screenshot of this page: the file input showing
 * disabled with "No file chosen" and Date empty while a Location was already picked. That is this
 * page's EXISTING, intentional "before that 4 feild need to select Date, Location ... otherwise
 * dont take the file" rule working as designed (canUpload below requires BOTH Date and Location) -
 * not a bug, since Date was the field still blank in that screenshot. The red "Could not load
 * uploaded part data." error shown alongside it is a different, separate problem: that message
 * only ever appears when the GET /api/part-uploads call itself throws (see `load()` below) -
 * zero rows on their own would show the plain "No uploaded parts yet" empty-state text instead.
 * I could not reproduce or pin down a code-level cause for that from static review of
 * PartUploadController.cs/PartUploadService.GetAsync alone (nothing there obviously throws for a
 * location that has data) - ASSUMPTION GAP, flagged rather than guessed: please check the
 * browser's Network tab for that failed GET /api/part-uploads request (its status code and
 * response body) or the backend's own console/log output at the same moment, and share that - I'll
 * fix the real cause once I can see it rather than patch something I can't confirm is the problem.
 */
/** Pins the header row to the top of a `maxHeight` + `overflowY: auto` table wrapper - see the
 * grid's own comment below for why. `var(--surface)` (not transparent) so scrolled-under body
 * rows don't show through the sticky header. */
const stickyTh: CSSProperties = { position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }

export function PartUploadPage() {
  const { profile } = useStaffAuth()

  // ---------------- Location dropdown - scoped to the signed-in user's own accessible workshops ----------------
  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  useEffect(() => {
    if (!profile?.dealerId) return
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then(({ data }) => {
        const scoped = profile?.workLocationCodes?.length ? data.filter((w) => profile.workLocationCodes.includes(w.locCode)) : data
        setWorkshops(scoped)
        if (scoped.length > 0) setUploadLocation((prev) => prev || scoped[0].locCode)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.dealerId, profile?.workLocationCodes])

  const [rows, setRows] = useState<PartUpload[]>([])
  const [search, setSearch] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  // 2026-10-03 ("in part upload also add date filter"): see this file's top-of-file doc comment -
  // net new, this grid had no date filter before.
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---------------- Upload form: Date + Location are required before the file input unlocks ----------------
  const [uploadLocation, setUploadLocation] = useState('')
  const [uploadDate, setUploadDate] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<PartUploadImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canUpload = !!uploadLocation && !!uploadDate

  const load = () => {
    setLoading(true)
    setError(null)
    staffApi
      .get<PartUpload[]>('/api/part-uploads', {
        params: {
          search: search || undefined,
          locationCode: filterLocation || undefined,
          dateFrom: filterDateFrom || undefined,
          dateTo: filterDateTo || undefined,
        },
      })
      .then((res) => setRows(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load uploaded part data.'))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [filterLocation])

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(rows)

  const handleImport = (file: File) => {
    if (!canUpload) {
      setImportError('Select Date and Location before uploading.')
      return
    }
    setImportError(null)
    setImportResult(null)
    setImporting(true)
    const form = new FormData()
    form.append('File', file)
    form.append('LocationCode', uploadLocation)
    form.append('ReportDate', uploadDate)
    staffApi
      .post<PartUploadImportResult>('/api/part-uploads/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((res) => {
        setImportResult(res.data)
        load()
      })
      .catch((err) => setImportError(err?.response?.data?.message ?? 'Import failed - check the file and try again.'))
      .finally(() => setImporting(false))
  }

  const deleteRow = (row: PartUpload) => {
    if (!window.confirm(`Delete uploaded part "${row.partNo}"? This cannot be undone.`)) return
    staffApi.delete(`/api/part-uploads/${row.id}`).then(load).catch((err) => alert(err?.response?.data?.message ?? 'Delete failed.'))
  }

  // ---------------- Detail view (2026-09-21 "all upload data ... clickable on any record we
  // click this all details can openable") - shows every field the row has, including the ones
  // this grid has no room for (Open Bal/Purchase/Receipt/PPurChln/Total/Sale/BrIss/MtrlIss/StAdj/
  // PartsChln/PurReturn/SaleReturn/SaleChln/Qty Reqd/Min Order/Source File/Uploaded By/Uploaded
  // At/Updated At/Report Date). Read-only - Edit stays a separate action. ----------------
  const [viewing, setViewing] = useState<PartUpload | null>(null)

  // ---------------- Edit card ----------------
  const [editing, setEditing] = useState<PartUpload | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const saveEdit = () => {
    if (!editing) return
    setSavingEdit(true)
    staffApi
      .put<PartUpload>(`/api/part-uploads/${editing.id}`, {
        description: editing.description,
        balQty: editing.balQty,
        balAmnt: editing.balAmnt,
        billPrice: editing.billPrice,
        qtyReqd: editing.qtyReqd,
        minOrder: editing.minOrder,
        hsnSacCode: editing.hsnSacCode,
        groupName: editing.groupName,
        itemType: editing.itemType,
      })
      .then(() => { setEditing(null); load() })
      .catch((err) => alert(err?.response?.data?.message ?? 'Save failed.'))
      .finally(() => setSavingEdit(false))
  }

  const fmtNum = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }))
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN') : '—')
  const locName = (code: string) => workshops.find((w) => w.locCode === code)?.locName ?? code

  const columns: ReportColumn<PartUpload>[] = [
    { header: 'Part No', value: (r) => r.partNo },
    { header: 'Description', value: (r) => r.description ?? '' },
    { header: 'HSN/SAC Code', value: (r) => r.hsnSacCode ?? '' },
    { header: 'Group', value: (r) => r.groupName ?? '' },
    { header: 'Item Type', value: (r) => r.itemType ?? '' },
    { header: 'Bal Qty', value: (r) => r.balQty ?? '' },
    { header: 'MT Transfer Qty', value: (r) => r.mtTransferQty ?? '' },
    { header: 'Bal Amount', value: (r) => r.balAmnt ?? '' },
    { header: 'Bill Price', value: (r) => r.billPrice ?? '' },
    { header: 'Location', value: (r) => locName(r.locationCode) },
    { header: 'Report Date', value: (r) => fmtDate(r.reportDate) },
    { header: 'Uploaded At', value: (r) => fmtDate(r.uploadedAt) },
  ]

  return (
    <div>
      {/* 2026-10-03 ("This 2 button shift here") - Download Excel/Download PDF moved up next to
          the page heading (top-right), out of the filter row below, per the user's annotated
          screenshot. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Stock Report</h2>
        <ReportDownloadButtons
          disabled={rows.length === 0}
          onExcel={() => exportReportToExcel('Part_Upload', columns, rows)}
          onPdf={() => exportReportToPdf('Part Upload', 'Part_Upload', columns, rows)}
        />
      </div>
      {/* <p className="muted">
        Upload a Stock Summary Detail Report (.xlsx) to build a searchable parts stock table here -
        saved into JobCardScanner's own database, scoped to your dealer. Re-uploading a newer report
        for the same Location updates each part's stock figures in place by Part No rather than
        adding duplicates.
      </p> */}

      <div className="card">
        <h3>Upload Excel</h3>
        <div className="form-row">
          <div className="field">
            <label>Date *</label>
            <input type="date" value={uploadDate} onChange={(e) => setUploadDate(e.target.value)} disabled={importing} />
          </div>
          <div className="field">
            <label>Location *</label>
            {workshops.length > 0 ? (
              <select value={uploadLocation} onChange={(e) => setUploadLocation(e.target.value)} disabled={importing}>
                <option value="">— select —</option>
                {workshops.map((w) => (
                  <option key={w.locCode} value={w.locCode}>{w.locName} ({w.locCode})</option>
                ))}
              </select>
            ) : (
              <input value={uploadLocation} onChange={(e) => setUploadLocation(e.target.value)} placeholder="Workshop location code" disabled={importing} />
            )}
          </div>
          <div className="field">
            <label>Upload Excel *</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImport(file)
                e.target.value = ''
              }}
              disabled={importing || !canUpload}
              title={!canUpload ? 'Select Date and Location first' : undefined}
            />
          </div>
        </div>
        {!canUpload && <p className="muted" style={{ marginTop: 4 }}>Select Date and Location above to enable the file upload.</p>}
        {importing && <p className="muted">Importing…</p>}
        {importError && <p className="error-text">{importError}</p>}
        {importResult && (
          <p className="jcs-info-text" style={{ margin: 0, padding: '10px 12px', borderRadius: 8, background: '#ecfdf3', color: '#065f46', fontSize: 13 }}>
            Imported {importResult.totalDataRows} row{importResult.totalDataRows === 1 ? '' : 's'}:{' '}
            {importResult.inserted} new, {importResult.updated} updated, {importResult.unchanged} unchanged (no duplicates added)
            {importResult.skippedBlank > 0 ? `, ${importResult.skippedBlank} blank row(s) skipped` : ''}.
            {importResult.warnings.length > 0 && (
              <> {importResult.warnings.map((w, i) => <span key={i}> {w}</span>)}</>
            )}
          </p>
        )}
      </div>

      {/* ---------------- Edit card ---------------- */}
      {editing && (
        <div className="card">
          <h3>Edit Part - {editing.partNo}</h3>
          <div className="form-row">
            <div className="field"><label>Description</label><input value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
            <div className="field"><label>HSN/SAC Code</label><input value={editing.hsnSacCode ?? ''} onChange={(e) => setEditing({ ...editing, hsnSacCode: e.target.value })} /></div>
            <div className="field"><label>Group</label><input value={editing.groupName ?? ''} onChange={(e) => setEditing({ ...editing, groupName: e.target.value })} /></div>
            <div className="field"><label>Item Type</label><input value={editing.itemType ?? ''} onChange={(e) => setEditing({ ...editing, itemType: e.target.value })} /></div>
            <div className="field"><label>Bal Qty</label><input type="number" step="0.01" value={editing.balQty ?? ''} onChange={(e) => setEditing({ ...editing, balQty: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>Bal Amount</label><input type="number" step="0.01" value={editing.balAmnt ?? ''} onChange={(e) => setEditing({ ...editing, balAmnt: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>Bill Price</label><input type="number" step="0.01" value={editing.billPrice ?? ''} onChange={(e) => setEditing({ ...editing, billPrice: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>Qty Reqd</label><input type="number" step="0.01" value={editing.qtyReqd ?? ''} onChange={(e) => setEditing({ ...editing, qtyReqd: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label>Min Order</label><input type="number" step="0.01" value={editing.minOrder ?? ''} onChange={(e) => setEditing({ ...editing, minOrder: e.target.value === '' ? null : Number(e.target.value) })} /></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save'}</button>{' '}
          <button className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {workshops.length > 0 && (
          <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">All locations</option>
            {workshops.map((w) => (
              <option key={w.locCode} value={w.locCode}>{w.locName} ({w.locCode})</option>
            ))}
          </select>
        )}
        {/* 2026-10-03 ("in part upload also add date filter") - filters on Report Date, applied
            only when Search is clicked/Enter is pressed (same pattern as the free-text search box
            right below), not on every keystroke/change - avoids a request per date-picker click. */}
        <input
          type="date"
          value={filterDateFrom}
          onChange={(e) => setFilterDateFrom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          title="Report Date from"
          style={{ maxWidth: 160 }}
        />
        <input
          type="date"
          value={filterDateTo}
          onChange={(e) => setFilterDateTo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          title="Report Date to"
          style={{ maxWidth: 160 }}
        />
        <input
          type="text"
          placeholder="Search Part No / Description / HSN…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          style={{ maxWidth: 260 }}
        />
        <button type="button" className="btn btn-sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : '↻ Search'}</button>
      </div>
      {error && <p className="error-text">{error}</p>}

      {/* 2026-09-21 ("header wants to show fixed only data needs to scrolle"): a fixed max-height
          + overflowY on this wrapper turns the grid into its own scroll region, and `stickyTh`
          (position: sticky, top: 0) keeps the header row pinned to the top of THAT region while
          the body scrolls under it - a plain `overflowX: auto` alone (the old wrapper) never
          scrolled vertically at all, so the header had nothing to stick against. */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 520 }}>
          <table>
            <thead>
              <tr>
                <th style={stickyTh}>Part No</th>
                <th style={stickyTh}>Description</th>
                <th style={stickyTh}>HSN/SAC Code</th>
                <th style={stickyTh}>Group</th>
                <th style={stickyTh}>Item Type</th>
                <th className="text-end" style={stickyTh}>Bal Qty</th>
                <th className="text-end" style={stickyTh} title="Quantity of this part already issued out via Material Transfer">MT Transfer Qty</th>
                <th className="text-end" style={stickyTh}>Bal Amount</th>
                <th className="text-end" style={stickyTh}>Bill Price</th>
                <th style={stickyTh}>Location</th>
                <th style={stickyTh}></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} onClick={() => setViewing(r)} style={{ cursor: 'pointer' }} title="Click to view full details">
                  <td>{r.partNo}</td>
                  <td>{r.description ?? '—'}</td>
                  <td>{r.hsnSacCode ?? '—'}</td>
                  <td>{r.groupName ?? '—'}</td>
                  <td>{r.itemType ?? '—'}</td>
                  <td className="text-end">{fmtNum(r.balQty)}</td>
                  <td className="text-end">{fmtNum(r.mtTransferQty)}</td>
                  <td className="text-end">₹{fmtNum(r.balAmnt)}</td>
                  <td className="text-end">₹{fmtNum(r.billPrice)}</td>
                  <td>{locName(r.locationCode)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm" onClick={() => setEditing(r)}>Edit</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => deleteRow(r)}>Delete</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && !error && (
                <tr><td colSpan={11} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                  No uploaded parts yet - upload a Stock Summary Detail Report above to get started.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>

      {viewing && (
        <RecordDetailModal
          title={`Part ${viewing.partNo}`}
          subtitle={viewing.description ?? undefined}
          onClose={() => setViewing(null)}
          fields={[
            { label: 'Part No', value: viewing.partNo },
            { label: 'Description', value: viewing.description },
            { label: 'Location', value: locName(viewing.locationCode) },
            { label: 'Report Date', value: fmtDate(viewing.reportDate) },
            { label: 'HSN/SAC Code', value: viewing.hsnSacCode },
            { label: 'Group', value: viewing.groupName },
            { label: 'Item Type', value: viewing.itemType },
            { label: 'Bal Qty', value: fmtNum(viewing.balQty) },
            { label: 'MT Transfer Qty', value: fmtNum(viewing.mtTransferQty) },
            { label: 'Bal Amount', value: `₹${fmtNum(viewing.balAmnt)}` },
            { label: 'Bill Price', value: `₹${fmtNum(viewing.billPrice)}` },
            { label: 'Qty Reqd', value: fmtNum(viewing.qtyReqd) },
            { label: 'Min Order', value: fmtNum(viewing.minOrder) },
            { label: 'Open Bal', value: fmtNum(viewing.openBal) },
            { label: 'Purchase', value: fmtNum(viewing.purchase) },
            { label: 'Receipt', value: fmtNum(viewing.receipt) },
            { label: 'PPurChln', value: fmtNum(viewing.pPurChln) },
            { label: 'Total', value: fmtNum(viewing.total) },
            { label: 'Sale', value: fmtNum(viewing.sale) },
            { label: 'BrIss', value: fmtNum(viewing.brIss) },
            { label: 'MtrlIss', value: fmtNum(viewing.mtrlIss) },
            { label: 'StAdj', value: fmtNum(viewing.stAdj) },
            { label: 'PartsChln', value: fmtNum(viewing.partsChln) },
            { label: 'PurReturn', value: fmtNum(viewing.purReturn) },
            { label: 'SaleReturn', value: fmtNum(viewing.saleReturn) },
            { label: 'SaleChln', value: fmtNum(viewing.saleChln) },
            { label: 'Source File', value: viewing.sourceFileName },
            { label: 'Uploaded By', value: viewing.uploadedBy },
            { label: 'Uploaded At', value: fmtDate(viewing.uploadedAt) },
            { label: 'Updated At', value: fmtDate(viewing.updatedAt) },
          ]}
        />
      )}
    </div>
  )
}
