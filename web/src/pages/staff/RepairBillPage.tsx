// web\src\pages\staff\RepairBillPage.tsx
import { Fragment, useEffect, useMemo, useState } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
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
 * from DMS's own repair-bill-list.html (Bill No/Date/Party Name/Reg No/ChassisNo/Location/
 * Bill Type/Bill Amount), adapted to the fields DMSBAPLDATA's DMS_RepairBill/DMS_RepairBillItem
 * actually carry - this is a synced copy, not the live DMS database, so a few live-only columns
 * (Job No, Status, Prepared/Modified by) have no equivalent here and are left out rather than
 * guessed.
 *
 * SECTION 190 (2026-10-02) "still fetched only zomato data remove this and login dealer data
 * sown and systemadmin show all data": this page used to hardcode `party = 'Zomato'` as both the
 * default AND, in practice, the only real scoping this endpoint ever got - any dealer's staff
 * could see any OTHER dealer's "Zomato" bills (or any party's, by just clearing the box), because
 * nothing here was ever scoped by DEALER at all, only by a free-text Party Name the user typed.
 * Fixed by adding real dealer scoping, the same isOrgWide/ORG_WIDE_ROLES pattern already used on
 * LedgerMasterPage.tsx:
 *   - A normal dealer login (ServiceAdvisor..DealerAdmin) is now scoped to THEIR OWN dealer's
 *     bills automatically - every party, not just Zomato - via the new `dealerCode` param (see
 *     DmsBaplDataService.GetRepairBillsAsync's new dealer-scoped overload), resolved from
 *     profile.dealerBaplDmsCode (the signed-in user's own DMS dealer code - NOT this app's local
 *     Dealer.Code, a different code space - see JobCardsController.Detail's own BaplDealerCode
 *     doc comment distinguishing the two, same distinction used for the Zoho integration earlier
 *     this session).
 *   - CorporateAdmin/SystemAdmin see every dealer's bills (dealerCode omitted = no filter), same
 *     "org-wide roles see everything" convention used everywhere else in this app.
 * The old "Party Name" box (which doubled as the ONLY filter AND defaulted to locking the page to
 * Zomato) is now an OPTIONAL refinement search within whatever dealer scope already applies -
 * blank by default, not "Zomato".
 *
 * NOT WIRED IN YET on the backend: I don't have DmsBaplDataController.cs (the file behind GET
 * /api/dms-bapl-data/repair-bills) in this session, so the new `dealerCode` query param this page
 * now sends is not yet read by anything server-side - see DmsBaplDataService.cs's own doc comment
 * on the new GetRepairBillsAsync overload. Paste that controller and I'll finish the wiring; until
 * then this page will silently keep showing every dealer's bills to everyone (dealerCode ignored),
 * same as before this fix, just without the Zomato-only default.
 */
const billAmount = (b: DmsBaplDataRepairBill) => b.items.reduce((sum, i) => sum + (i.totAmnt ?? 0), 0)

const ORG_WIDE_ROLES = ['CorporateAdmin', 'SystemAdmin']

// 2026-10-02 ("for 1 record this full details download in excel pdf only showing currently item
// count shown not shown which item so all need to show"): the export used to be one row per BILL,
// with an "Items" column that only ever showed a count (b.items.length) - the same number already
// visible in the collapsed table row, so downloading added nothing you couldn't already see without
// expanding each bill. This is now one row per repair bill ITEM instead (the same line-item fields
// already shown in the expanded detail table above - Item Code/Description/Type/Qty/Rate/Issue
// Type/CGST/SGST/IGST/Total), with every bill-level field (Invoice No/Date/Dealer/Party/Reg No/
// Chassis No/Location/Bill Type/Bill Amount) repeated on each of that bill's item rows - the
// standard "line-item report" shape, so a bill with 3 items produces 3 export rows, not 1. A bill
// with ZERO items still produces exactly one row (item fields blank) so it isn't silently dropped
// from the export entirely.
type RepairBillExportRow = {
  bill: DmsBaplDataRepairBill
  item: DmsBaplDataRepairBill['items'][number] | null
}

function buildRepairBillExportRows(bills: DmsBaplDataRepairBill[]): RepairBillExportRow[] {
  const rows: RepairBillExportRow[] = []
  for (const bill of bills) {
    if (bill.items.length === 0) {
      rows.push({ bill, item: null })
    } else {
      for (const item of bill.items) rows.push({ bill, item })
    }
  }
  return rows
}

const REPORT_COLUMNS: ReportColumn<RepairBillExportRow>[] = [
  { header: 'Invoice No', value: ({ bill }) => bill.invoiceNo ?? '' },
  { header: 'Invoice Date', value: ({ bill }) => (bill.invoiceDate ? new Date(bill.invoiceDate).toLocaleDateString('en-IN') : '') },
  { header: 'Dealer', value: ({ bill }) => bill.dealerName ?? bill.dealerCode ?? '' },
  { header: 'Party Name', value: ({ bill }) => bill.partyName ?? '' },
  { header: 'Reg No', value: ({ bill }) => bill.regNo ?? '' },
  { header: 'Chassis No', value: ({ bill }) => bill.chassisNo ?? '' },
  { header: 'Location', value: ({ bill }) => bill.location ?? '' },
  { header: 'Bill Type', value: ({ bill }) => bill.billType ?? '' },
  { header: 'Item Code', value: ({ item }) => item?.itemCode ?? '' },
  { header: 'Item Description', value: ({ item }) => item?.itemDesc ?? '' },
  { header: 'Item Type', value: ({ item }) => item?.itemType ?? '' },
  { header: 'Qty', value: ({ item }) => item?.qty ?? '' },
  { header: 'Rate', value: ({ item }) => item?.rate ?? '' },
  { header: 'Issue Type', value: ({ item }) => item?.issueType ?? '' },
  { header: 'CGST', value: ({ item }) => item?.cgstAmount ?? '' },
  { header: 'SGST', value: ({ item }) => item?.sgstAmount ?? '' },
  { header: 'IGST', value: ({ item }) => item?.igstAmount ?? '' },
  { header: 'Item Total', value: ({ item }) => item?.totAmnt ?? '' },
  { header: 'Bill Amount', value: ({ bill }) => billAmount(bill) },
]

export function RepairBillPage() {
  const { profile } = useStaffAuth()
  const isOrgWide = !!profile && ORG_WIDE_ROLES.includes(profile.role)

  // SECTION 190: Party Name is now an OPTIONAL refinement within the dealer scope below - blank
  // by default (no more hardcoded "Zomato"), and no longer the only thing this page filters by.
  const [party, setParty] = useState('')
  const [bills, setBills] = useState<DmsBaplDataRepairBill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // 2026-09-18 "import excel option add in each [page]" - client-side bulk-filter (NOT a write -
  // see ImportExcelButton's doc comment). Matches an imported value against EITHER Chassis No or
  // Reg No, since either list is a plausible thing to have on hand for a repair bill lookup.
  const [importNos, setImportNos] = useState<Set<string> | null>(null)

  const search = () => {
    // SECTION 190: a non-org-wide user with no dealerBaplDmsCode on file has no scope to show -
    // same "show nothing rather than silently show everything" safety default used elsewhere in
    // this app (e.g. JobCardsController.List's own 2026-09-xx dealer-scoping fix) rather than
    // falling through to an unscoped fetch.
    if (!isOrgWide && !profile?.dealerBaplDmsCode) {
      setBills([])
      setError(profile ? 'Your account has no DMS dealer code on file - contact your admin.' : null)
      return
    }
    setLoading(true)
    setError(null)
    setImportNos(null) // a fresh search drops any stale import-filter from a previous one
    staffApi
      .get<DmsBaplDataRepairBill[]>('/api/dms-bapl-data/repair-bills', {
        params: {
          party: party || undefined,
          // SECTION 190: real scoping lives here now, not in the Party Name box - org-wide roles
          // send no dealerCode (see every dealer), everyone else is forced to their own.
          dealerCode: isOrgWide ? undefined : profile?.dealerBaplDmsCode ?? undefined,
        },
      })
      .then((r) => setBills(r.data))
      .catch((err) => {
        setBills([])
        setError(err?.response?.data?.message ?? 'Could not reach DMSBAPLDATA - check the connection and try again.')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { search() }, [profile?.dealerBaplDmsCode, isOrgWide]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredBills = useMemo(
    () => (importNos
      ? bills.filter((b) => importNos.has((b.chassisNo ?? '').trim().toUpperCase()) || importNos.has((b.regNo ?? '').trim().toUpperCase()))
      : bills),
    [bills, importNos]
  )
  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(filteredBills)

  // 2026-10-02: exported once per download click, not on every render - see REPORT_COLUMNS' own
  // doc comment for why this is a flattened one-row-per-item list now, not one row per bill.
  const exportRows = useMemo(() => buildRepairBillExportRows(filteredBills), [filteredBills])

  return (
    <div>
      <h2>Repair Bill</h2>
      <p className="muted">
        {isOrgWide
          ? 'Synced repair bill data from DMSBAPLDATA, across every dealer. Read-only - this app never writes to DMSBAPLDATA.'
          : 'Synced repair bill data from DMSBAPLDATA for your own dealer. Read-only - this app never writes to DMSBAPLDATA.'}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <ReportDownloadButtons
          disabled={exportRows.length === 0}
          onExcel={() => exportReportToExcel('Repair_Bill_Report', REPORT_COLUMNS, exportRows)}
          onPdf={() => exportReportToPdf('Repair Bill Report', 'Repair_Bill_Report', REPORT_COLUMNS, exportRows)}
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
            <label>Party Name (optional)</label>
            <input
              value={party}
              onChange={(e) => setParty(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="Leave blank to show every party"
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
