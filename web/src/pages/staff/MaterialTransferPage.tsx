import { Fragment, useEffect, useMemo, useState } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsWorkshop, DmsBaplDataMaterialTransfer } from '../../types'
import { ReportDownloadButtons } from '../../components/ReportDownloadButtons'
import { ImportExcelButton } from '../../components/ImportExcelButton'
import { Pagination } from '../../components/Pagination'
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '../../lib/exportReport'
import { usePagination } from '../../lib/usePagination'

// 2026-09-18 "download report excel pdf download button insert in starting row" - flat,
// document-level column set for both Excel and PDF export (not a line-item breakdown - a report of
// transfer documents, matching what the collapsed table already shows one row per document for).
const REPORT_COLUMNS: ReportColumn<DmsBaplDataMaterialTransfer>[] = [
  { header: 'Doc No', value: (t) => t.docNo ?? '' },
  { header: 'Doc Date', value: (t) => (t.docDate ? new Date(t.docDate).toLocaleDateString('en-IN') : '') },
  { header: 'Dealer', value: (t) => t.dealerName ?? t.dealerCode ?? '' },
  { header: 'Location', value: (t) => t.location ?? t.locCode ?? '' },
  { header: 'Technician', value: (t) => t.technicianName ?? '' },
  { header: 'Doc Type', value: (t) => t.docType ?? '' },
  { header: 'Items', value: (t) => t.items.length },
]

/**
 * "Material Transfer" sidebar page (2026-09-17: "material transfer using location wise which
 * dealer login that location wise which already we done w1..wn series for") - read-only view of
 * DMSBAPLDATA's dbo.DMS_MaterialTransfer (+ DMS_MaterialTransferItem/DMS_MaterialTransferLabor
 * child rows), scoped to ONE dealer's own DMS workshop LocCode - the SAME per-dealer W1..Wn
 * workshop-location resolution already built for PartsPage's "DMS Parts Inventory" panel
 * (GET /api/bapl-dms/workshops?dealerId=...), reused here as-is rather than reinvented. See
 * DmsBaplDataMaterialTransferRow's doc comment in DmsBaplDataService.cs for what DMSBAPLDATA is.
 */
export function MaterialTransferPage() {
  const { profile } = useStaffAuth()
  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  const [locCode, setLocCode] = useState('')
  const [transfers, setTransfers] = useState<DmsBaplDataMaterialTransfer[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // 2026-09-18 "import excel option add in each [page]" - client-side bulk-filter (NOT a write -
  // see ImportExcelButton's doc comment). Material Transfer's header rows have no chassis field, so
  // this matches an imported value against Doc No instead - the natural per-document identifier.
  const [importDocNos, setImportDocNos] = useState<Set<string> | null>(null)

  // Same resolution as PartsPage: this dealer's own W1..Wn workshop location(s) from DMS's
  // LocationMaster, auto-selecting the first one so the page has something to show immediately.
  useEffect(() => {
    if (!profile?.dealerId) return
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then(({ data }) => {
        // 2026-09-18 Work Area scoping (same rationale as JobCardWizardPage): only offer this
        // user's own assigned location(s) when they have any set; empty = unrestricted.
        const scoped = profile?.workLocationCodes?.length
          ? data.filter((w) => profile.workLocationCodes.includes(w.locCode))
          : data
        setWorkshops(scoped)
        if (scoped.length > 0) setLocCode((prev) => prev || scoped[0].locCode)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.dealerId, profile?.workLocationCodes])

  const search = () => {
    if (!locCode) { setTransfers([]); return }
    setLoading(true)
    setError(null)
    setImportDocNos(null) // a fresh search drops any stale import-filter from a previous one
    staffApi
      .get<DmsBaplDataMaterialTransfer[]>('/api/dms-bapl-data/material-transfers', { params: { locCode } })
      .then((r) => setTransfers(r.data))
      .catch((err) => {
        setTransfers([])
        setError(err?.response?.data?.message ?? 'Could not reach DMSBAPLDATA - check the connection and try again.')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { search() }, [locCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const itemAmount = (i: DmsBaplDataMaterialTransfer['items'][number]) =>
    i.qty * i.rate - i.discount + i.sgstAmount + i.cgstAmount + i.igstAmount

  const filteredTransfers = useMemo(
    () => (importDocNos ? transfers.filter((t) => t.docNo != null && importDocNos.has(String(t.docNo))) : transfers),
    [transfers, importDocNos]
  )
  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(filteredTransfers)

  return (
    <div>
      <h2>Material Transfer</h2>
      {/* <p className="muted">
        Synced material transfer documents from DMSBAPLDATA, scoped to your own workshop location.
        Read-only - this app never writes to DMSBAPLDATA.
      </p> */}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <ReportDownloadButtons
          disabled={filteredTransfers.length === 0}
          onExcel={() => exportReportToExcel('Material_Transfer_Report', REPORT_COLUMNS, filteredTransfers)}
          onPdf={() => exportReportToPdf('Material Transfer Report', 'Material_Transfer_Report', REPORT_COLUMNS, filteredTransfers)}
        />
        <ImportExcelButton
          label="Import Doc No List"
          headerCandidates={['Doc No', 'DocNo', 'Document No']}
          onValues={(values) => setImportDocNos(new Set(values.map((v) => v.trim())))}
        />
        {importDocNos && (
          <span className="muted">
            Filtered to {filteredTransfers.length} of {transfers.length} by imported Doc No list.{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setImportDocNos(null) }}>Clear</a>
          </span>
        )}
      </div>

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>DMS workshop location</label>
            {workshops.length > 0 ? (
              <select value={locCode} onChange={(e) => setLocCode(e.target.value)}>
                {workshops.map((w) => (
                  <option key={w.locCode} value={w.locCode}>{w.locCode} — {w.locName}</option>
                ))}
              </select>
            ) : (
              <input value={locCode} onChange={(e) => setLocCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="e.g. CUS0288W5" />
            )}
          </div>
        </div>
        <button className="btn" onClick={search} disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
        {!locCode && <p className="muted">Select or enter a DMS workshop location above to see its material transfers.</p>}
        {error && <p className="muted" style={{ color: '#b91c1c' }}>{error}</p>}
      </div>

      {locCode && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Doc No</th>
                <th>Doc Date</th>
                <th>Dealer</th>
                <th>Location</th>
                <th>Technician</th>
                <th className="text-end">Items</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((t) => (
                <Fragment key={t.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                    <td>{expandedId === t.id ? '▾' : '▸'}</td>
                    <td>{t.docNo ?? '—'}</td>
                    <td>{t.docDate ? new Date(t.docDate).toLocaleDateString('en-IN') : '—'}</td>
                    <td>{t.dealerName ?? t.dealerCode ?? '—'}</td>
                    <td>{t.location ?? t.locCode ?? '—'}</td>
                    <td>{t.technicianName ?? '—'}</td>
                    <td className="text-end">{t.items.length}</td>
                  </tr>
                  {expandedId === t.id && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0, background: '#f9fafb' }}>
                        <table style={{ width: '100%' }}>
                          <thead>
                            <tr>
                              <th>Item Code / Name</th>
                              <th>Description</th>
                              <th>Type</th>
                              <th className="text-end">Qty</th>
                              <th className="text-end">Rate</th>
                              <th className="text-end">MRP</th>
                              <th className="text-end">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {t.items.map((it) => (
                              <Fragment key={it.id}>
                                <tr>
                                  <td>{it.itemName ?? '—'}</td>
                                  <td>{it.itemDescription ?? '—'}</td>
                                  <td>{it.itemType ?? '—'}</td>
                                  <td className="text-end">{it.qty}</td>
                                  <td className="text-end">{it.rate.toFixed(2)}</td>
                                  <td className="text-end">{it.mrp.toFixed(2)}</td>
                                  <td className="text-end">{itemAmount(it).toFixed(2)}</td>
                                </tr>
                                {it.labour.length > 0 && (
                                  <tr>
                                    <td></td>
                                    <td colSpan={6} className="muted">
                                      Labour: {it.labour.map((l) => `${l.lbrName ?? l.lbrDescription ?? '—'} (₹${l.lbrRate.toFixed(2)})`).join(', ')}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            ))}
                            {t.items.length === 0 && (
                              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 12 }}>No line items on this document.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {filteredTransfers.length === 0 && !loading && !error && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                  No material transfers found at "{locCode}"{importDocNos ? ' matching your imported Doc No list' : ''}.
                </td></tr>
              )}
            </tbody>
          </table>
          <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
        </div>
      )}
    </div>
  )
}
