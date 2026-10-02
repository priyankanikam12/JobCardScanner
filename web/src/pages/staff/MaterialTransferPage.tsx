// web\src\pages\staff\MaterialTransferPage.tsx
import { Fragment, useEffect, useMemo, useState } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { BaplDmsWorkshop, DmsBaplDataMaterialTransfer } from '../../types'
import { ReportDownloadButtons } from '../../components/ReportDownloadButtons'
import { ImportExcelButton } from '../../components/ImportExcelButton'
import { Pagination } from '../../components/Pagination'
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '../../lib/exportReport'
import { usePagination } from '../../lib/usePagination'

// 2026-10-02 ("for 1 record this full details download in excel pdf only showing currently item
// count shown not shown which item so all need to show in repair bill shown which labour are"): the
// export used to be one row per DOCUMENT, with an "Items" column that only ever showed a count
// (t.items.length) - no item codes/descriptions, and no labour at all. This is now one row per
// Material Transfer ITEM instead (the same fields already shown in the expanded detail table above
// - Item Code/Name, Description, Type, Qty, Rate, MRP, Amount), with every document-level field
// (Doc No/Date/Dealer/Location/Technician/Doc Type) repeated on each of that document's item rows,
// same "line-item report" shape as RepairBillPage.tsx's own 2026-10-02 fix. A Labour column is
// added too (semicolon-joined "name (₹rate)" list, same format the expanded UI already shows under
// each item) - Material Transfer items can each carry their own zero-or-more labour lines, which the
// old document-level export never surfaced at all. A document with ZERO items still produces exactly
// one row (item/labour fields blank) so it isn't silently dropped from the export entirely.
type MaterialTransferExportRow = {
  transfer: DmsBaplDataMaterialTransfer
  item: DmsBaplDataMaterialTransfer['items'][number] | null
}

function buildMaterialTransferExportRows(transfers: DmsBaplDataMaterialTransfer[]): MaterialTransferExportRow[] {
  const rows: MaterialTransferExportRow[] = []
  for (const transfer of transfers) {
    if (transfer.items.length === 0) {
      rows.push({ transfer, item: null })
    } else {
      for (const item of transfer.items) rows.push({ transfer, item })
    }
  }
  return rows
}

const formatLabour = (item: DmsBaplDataMaterialTransfer['items'][number] | null) =>
  item && item.labour.length > 0
    ? item.labour.map((l) => `${l.lbrName ?? l.lbrDescription ?? '—'} (₹${l.lbrRate.toFixed(2)})`).join('; ')
    : ''

const REPORT_COLUMNS: ReportColumn<MaterialTransferExportRow>[] = [
  { header: 'Doc No', value: ({ transfer }) => transfer.docNo ?? '' },
  { header: 'Doc Date', value: ({ transfer }) => (transfer.docDate ? new Date(transfer.docDate).toLocaleDateString('en-IN') : '') },
  { header: 'Dealer', value: ({ transfer }) => transfer.dealerName ?? transfer.dealerCode ?? '' },
  { header: 'Location', value: ({ transfer }) => transfer.location ?? transfer.locCode ?? '' },
  { header: 'Technician', value: ({ transfer }) => transfer.technicianName ?? '' },
  { header: 'Doc Type', value: ({ transfer }) => transfer.docType ?? '' },
  { header: 'Item Code / Name', value: ({ item }) => item?.itemName ?? '' },
  { header: 'Item Description', value: ({ item }) => item?.itemDescription ?? '' },
  { header: 'Item Type', value: ({ item }) => item?.itemType ?? '' },
  { header: 'Qty', value: ({ item }) => item?.qty ?? '' },
  { header: 'Rate', value: ({ item }) => item?.rate ?? '' },
  { header: 'MRP', value: ({ item }) => item?.mrp ?? '' },
  { header: 'Item Amount', value: ({ item }) => (item ? item.qty * item.rate - item.discount + item.sgstAmount + item.cgstAmount + item.igstAmount : '') },
  { header: 'Labour', value: ({ item }) => formatLabour(item) },
]

const ORG_WIDE_ROLES = ['CorporateAdmin', 'SystemAdmin']

interface DealerOption {
  id: string
  name: string
}

/**
 * "Material Transfer" sidebar page (2026-09-17: "material transfer using location wise which
 * dealer login that location wise which already we done w1..wn series for") - read-only view of
 * DMSBAPLDATA's dbo.DMS_MaterialTransfer (+ DMS_MaterialTransferItem/DMS_MaterialTransferLabor
 * child rows), scoped to ONE dealer's own DMS workshop LocCode - the SAME per-dealer W1..Wn
 * workshop-location resolution already built for PartsPage's "DMS Parts Inventory" panel
 * (GET /api/bapl-dms/workshops?dealerId=...), reused here as-is rather than reinvented. See
 * DmsBaplDataMaterialTransferRow's doc comment in DmsBaplDataService.cs for what DMSBAPLDATA is.
 *
 * SECTION 190 (2026-10-02) "still fetched only zomato data remove this and login dealer data
 * sown and systemadmin show all data": this page itself never had a Zomato-only default (that was
 * RepairBillPage.tsx's bug - see that file's own SECTION 190 doc comment) - its real gap was the
 * OPPOSITE problem: it only ever worked for a user with a `profile.dealerId` on file. A
 * CorporateAdmin/SystemAdmin (org-wide roles, no dealer of their own) hit the `if (!profile?.dealerId)
 * return` guard below and saw nothing at all - not "all data," literally no workshop list to even
 * pick from. Fixed by adding the same isOrgWide/DealerOption dealer-picker pattern already used on
 * LedgerMasterPage.tsx/RepairBillPage.tsx: an org-wide user now picks ANY dealer from a dropdown
 * (GET /api/dashboard/corporate/filters, same endpoint those pages already reuse) and this page's
 * existing per-dealer workshop resolution runs against THAT dealer instead of their own (which they
 * don't have). A normal dealer login is completely unchanged - still auto-scoped to their own
 * profile.dealerId, no picker shown.
 *
 * This does NOT add a true "every dealer's transfers in one unscoped list" view -
 * DmsBaplDataService.GetMaterialTransfersAsync deliberately refuses an empty/unscoped locCode
 * ("an unscoped scan across every dealer's material transfers isn't what the page ever wants" -
 * its own doc comment), and I didn't want to silently reverse that existing, deliberate guard
 * without asking first. An org-wide user here still sees one dealer (of their choosing) at a time,
 * exactly like everyone else does - "show all data" is satisfied as "not locked out of every other
 * dealer," not as "every dealer merged into one table." Tell me if you specifically want the
 * unscoped-merge version instead - that's a real backend change to GetMaterialTransfersAsync, not
 * just this page.
 *
 * NOT WIRED IN YET on the backend: I don't have the controller behind GET /api/bapl-dms/workshops
 * in this session, so I can't confirm it actually accepts an arbitrary `dealerId` from an org-wide
 * caller rather than silently forcing the caller's own (which, for CorporateAdmin/SystemAdmin, is
 * null) - paste that controller (likely BaplDmsController.cs) and I'll verify/fix that half of
 * this.
 */
export function MaterialTransferPage() {
  const { profile } = useStaffAuth()
  const isOrgWide = !!profile && ORG_WIDE_ROLES.includes(profile.role)

  // SECTION 190: only populated/shown for org-wide roles - everyone else keeps using their own
  // profile.dealerId exactly as before.
  const [dealers, setDealers] = useState<DealerOption[]>([])
  const [selectedDealerId, setSelectedDealerId] = useState('')

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

  // SECTION 190: org-wide roles get a Dealer dropdown instead of being locked out - same
  // GET /api/dashboard/corporate/filters reuse as LedgerMasterPage.tsx/RepairBillPage.tsx.
  useEffect(() => {
    if (!isOrgWide) return
    staffApi.get<{ dealers: DealerOption[] }>('/api/dashboard/corporate/filters')
      .then(({ data }) => {
        setDealers(data.dealers)
        setSelectedDealerId((prev) => prev || data.dealers[0]?.id || '')
      })
      .catch(() => setDealers([]))
  }, [isOrgWide])

  // The dealer this page should resolve workshops for: the org-wide user's current dropdown pick,
  // or (unchanged from before this fix) a normal dealer login's own profile.dealerId.
  const effectiveDealerId = isOrgWide ? selectedDealerId : profile?.dealerId

  // Same resolution as PartsPage: this dealer's own W1..Wn workshop location(s) from DMS's
  // LocationMaster, auto-selecting the first one so the page has something to show immediately.
  useEffect(() => {
    if (!effectiveDealerId) return
    setLocCode('') // SECTION 190: clear the old dealer's selection so a stale locCode never leaks into a newly-picked dealer's query below
    staffApi.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: effectiveDealerId } })
      .then(({ data }) => {
        // 2026-09-18 Work Area scoping (same rationale as JobCardWizardPage): only offer this
        // user's own assigned location(s) when they have any set; empty = unrestricted. SECTION
        // 190: only applied for a normal dealer login - an org-wide user picking ANOTHER dealer
        // isn't scoped by their OWN workLocationCodes (those belong to a dealer they may not even
        // be looking at), so this only filters when !isOrgWide.
        const scoped = !isOrgWide && profile?.workLocationCodes?.length
          ? data.filter((w) => profile.workLocationCodes.includes(w.locCode))
          : data
        setWorkshops(scoped)
        if (scoped.length > 0) setLocCode((prev) => prev || scoped[0].locCode)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveDealerId, isOrgWide])

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
  const exportRows = useMemo(() => buildMaterialTransferExportRows(filteredTransfers), [filteredTransfers])

  return (
    <div>
      <h2>Material Transfer</h2>
      {/* <p className="muted">
        Synced material transfer documents from DMSBAPLDATA, scoped to your own workshop location.
        Read-only - this app never writes to DMSBAPLDATA.
      </p> */}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <ReportDownloadButtons
          disabled={exportRows.length === 0}
          onExcel={() => exportReportToExcel('Material_Transfer_Report', REPORT_COLUMNS, exportRows)}
          onPdf={() => exportReportToPdf('Material Transfer Report', 'Material_Transfer_Report', REPORT_COLUMNS, exportRows)}
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
          {isOrgWide && (
            <div className="field">
              <label>Dealer</label>
              <select value={selectedDealerId} onChange={(e) => setSelectedDealerId(e.target.value)}>
                {dealers.length === 0 && <option value="">Loading dealers…</option>}
                {dealers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
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
