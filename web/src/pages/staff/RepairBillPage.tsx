import { Fragment, useEffect, useMemo, useState } from 'react'
import { staffApi } from '../../api/client'
import type { DmsBaplDataRepairBill } from '../../types'
import { ReportDownloadButtons } from '../../components/ReportDownloadButtons'
import { ImportExcelButton } from '../../components/ImportExcelButton'
import { Pagination } from '../../components/Pagination'
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '../../lib/exportReport'
import { usePagination } from '../../lib/usePagination'

/**
 * "Repair Bill" sidebar page (2026-09-17: "add 2 sidebar option in our jobscanner Material
 * Transfer and Repair bill ... for only this repair bill create this take reference all of this
 * and from DMSBAPLDATA databse fetch all data for in this page") - read-only view of the
 * Zomato-fleet repair bill data synced into DMSBAPLDATA (see GET /api/dms-bapl-data/repair-bills
 * and DmsBaplDataService.cs's doc comment for what that database is). Column layout takes its cue
 * from BAPL DMS's own repair-bill-list.html (Bill No/Date/Party Name/Reg No/ChassisNo/Location/
 * Bill Type/Bill Amount), adapted to the fields DMSBAPLDATA's DMS_RepairBill/DMS_RepairBillItem
 * actually carry - this is a synced copy, not the live DMS database, so a few live-only columns
 * (Job No, Status, Prepared/Modified by) have no equivalent here and are left out rather than
 * guessed.
 */
const billAmount = (b: DmsBaplDataRepairBill) => b.items.reduce((sum, i) => sum + (i.totAmnt ?? 0), 0)

// 2026-09-18 "download report excel pdf download button insert in starting row" - flat, bill-level
// column set for both Excel and PDF export (not a line-item breakdown - a report of bills, matching
// what the collapsed table already shows one row per bill for).
const REPORT_COLUMNS: ReportColumn<DmsBaplDataRepairBill>[] = [
  { header: 'Invoice No', value: (b) => b.invoiceNo ?? '' },
  { header: 'Invoice Date', value: (b) => (b.invoiceDate ? new Date(b.invoiceDate).toLocaleDateString('en-IN') : '') },
  { header: 'Dealer', value: (b) => b.dealerName ?? b.dealerCode ?? '' },
  { header: 'Party Name', value: (b) => b.partyName ?? '' },
  { header: 'Reg No', value: (b) => b.regNo ?? '' },
  { header: 'Chassis No', value: (b) => b.chassisNo ?? '' },
  { header: 'Location', value: (b) => b.location ?? '' },
  { header: 'Bill Type', value: (b) => b.billType ?? '' },
  { header: 'Items', value: (b) => b.items.length },
  { header: 'Bill Amount', value: (b) => billAmount(b) },
]

export function RepairBillPage() {
  const [party, setParty] = useState('Zomato')
  const [bills, setBills] = useState<DmsBaplDataRepairBill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // 2026-09-18 "import excel option add in each [page]" - client-side bulk-filter (NOT a write -
  // see ImportExcelButton's doc comment). Matches an imported value against EITHER Chassis No or
  // Reg No, since either list is a plausible thing to have on hand for a repair bill lookup.
  const [importNos, setImportNos] = useState<Set<string> | null>(null)

  const search = () => {
    setLoading(true)
    setError(null)
    setImportNos(null) // a fresh search drops any stale import-filter from a previous one
    staffApi
      .get<DmsBaplDataRepairBill[]>('/api/dms-bapl-data/repair-bills', { params: { party: party || undefined } })
      .then((r) => setBills(r.data))
      .catch((err) => {
        setBills([])
        setError(err?.response?.data?.message ?? 'Could not reach DMSBAPLDATA - check the connection and try again.')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { search() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredBills = useMemo(
    () => (importNos
      ? bills.filter((b) => importNos.has((b.chassisNo ?? '').trim().toUpperCase()) || importNos.has((b.regNo ?? '').trim().toUpperCase()))
      : bills),
    [bills, importNos]
  )
  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(filteredBills)

  return (
    <div>
      <h2>Repair Bill</h2>
      <p className="muted">
        Synced repair bill data from DMSBAPLDATA, scoped by Party Name. Read-only - this app never
        writes to DMSBAPLDATA.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <ReportDownloadButtons
          disabled={filteredBills.length === 0}
          onExcel={() => exportReportToExcel('Repair_Bill_Report', REPORT_COLUMNS, filteredBills)}
          onPdf={() => exportReportToPdf('Repair Bill Report', 'Repair_Bill_Report', REPORT_COLUMNS, filteredBills)}
        />
        <ImportExcelButton
          label="Import Chassis/Reg No List"
          headerCandidates={['Chassis No', 'Chasis No', 'ChassisNo', 'Reg No', 'RegNo', 'Registration No']}
          onValues={(values) => setImportNos(new Set(values.map((v) => v.trim().toUpperCase())))}
        />
        {importNos && (
          <span className="muted">
            Filtered to {filteredBills.length} of {bills.length} by imported list.{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setImportNos(null) }}>Clear</a>
          </span>
        )}
      </div>

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>Party Name</label>
            <input
              value={party}
              onChange={(e) => setParty(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="e.g. Zomato"
            />
          </div>
        </div>
        <button className="btn" onClick={search} disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
        {error && <p className="muted" style={{ color: '#b91c1c' }}>{error}</p>}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Invoice No</th>
              <th>Invoice Date</th>
              <th>Dealer</th>
              <th>Party Name</th>
              <th>Reg No</th>
              <th>Chassis No</th>
              <th>Location</th>
              <th>Bill Type</th>
              <th className="text-end">Items</th>
              <th className="text-end">Bill Amount</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((b) => (
              <Fragment key={b.id}>
                <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}>
                  <td>{expandedId === b.id ? '▾' : '▸'}</td>
                  <td>{b.invoiceNo ?? '—'}</td>
                  <td>{b.invoiceDate ? new Date(b.invoiceDate).toLocaleDateString('en-IN') : '—'}</td>
                  <td>{b.dealerName ?? b.dealerCode ?? '—'}</td>
                  <td>{b.partyName ?? '—'}</td>
                  <td>{b.regNo ?? '—'}</td>
                  <td>{b.chassisNo ?? '—'}</td>
                  <td>{b.location ?? '—'}</td>
                  <td>{b.billType ?? '—'}</td>
                  <td className="text-end">{b.items.length}</td>
                  <td className="text-end">₹{billAmount(b).toFixed(2)}</td>
                </tr>
                {expandedId === b.id && (
                  <tr key={`${b.id}-items`}>
                    <td colSpan={11} style={{ padding: 0, background: '#f9fafb' }}>
                      <table style={{ width: '100%' }}>
                        <thead>
                          <tr>
                            <th>Item Code</th>
                            <th>Description</th>
                            <th>Type</th>
                            <th className="text-end">Qty</th>
                            <th className="text-end">Rate</th>
                            <th>Issue Type</th>
                            <th className="text-end">CGST</th>
                            <th className="text-end">SGST</th>
                            <th className="text-end">IGST</th>
                            <th className="text-end">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.items.map((it) => (
                            <tr key={it.id}>
                              <td>{it.itemCode ?? '—'}</td>
                              <td>{it.itemDesc ?? '—'}</td>
                              <td>{it.itemType ?? '—'}</td>
                              <td className="text-end">{it.qty ?? '—'}</td>
                              <td className="text-end">{it.rate?.toFixed(2) ?? '—'}</td>
                              <td>{it.issueType ?? '—'}</td>
                              <td className="text-end">{it.cgstAmount?.toFixed(2) ?? '—'}</td>
                              <td className="text-end">{it.sgstAmount?.toFixed(2) ?? '—'}</td>
                              <td className="text-end">{it.igstAmount?.toFixed(2) ?? '—'}</td>
                              <td className="text-end">{it.totAmnt?.toFixed(2) ?? '—'}</td>
                            </tr>
                          ))}
                          {b.items.length === 0 && (
                            <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 12 }}>No line items on this bill.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filteredBills.length === 0 && !loading && !error && (
              <tr><td colSpan={11} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                No repair bills found{party ? ` for "${party}"` : ''}{importNos ? ' matching your imported list' : ''}.
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>
    </div>
  )
}
