import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { staffApi } from '../../api/client'
import type { DmsBaplDataVehicleSale } from '../../types'
import { ReportDownloadButtons } from '../../components/ReportDownloadButtons'
import { Pagination } from '../../components/Pagination'
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '../../lib/exportReport'
import { usePagination } from '../../lib/usePagination'

// 2026-09-18 "download report excel pdf download button insert in starting row" - the flat column
// set both the Excel and PDF export use, a superset of what the on-screen table shows (a report
// download is expected to carry more than the compact list view). Shared between both formats so
// they never drift apart. Works for both server-sourced and imported rows since both fill the
// same DmsBaplDataVehicleSale shape.
const REPORT_COLUMNS: ReportColumn<DmsBaplDataVehicleSale>[] = [
  { header: 'Invoice No', value: (s) => s.invoiceNo ?? '' },
  { header: 'Invoice Date', value: (s) => (s.invoiceDate ? new Date(s.invoiceDate).toLocaleDateString('en-IN') : '') },
  { header: 'Dealer', value: (s) => s.dealerName ?? s.dealerCode ?? '' },
  { header: 'Chassis No', value: (s) => s.chassisNo ?? '' },
  { header: 'Reg No', value: (s) => s.regNo ?? '' },
  { header: 'Item Model', value: (s) => s.itemModel ?? '' },
  { header: 'Color', value: (s) => s.colorCode ?? '' },
  { header: 'Sold To', value: (s) => s.soldTo ?? '' },
  { header: 'Sale Type', value: (s) => s.saleType ?? '' },
  { header: 'Location', value: (s) => s.location ?? s.locCode ?? '' },
  { header: 'City', value: (s) => s.locationCity ?? s.city ?? '' },
  { header: 'State', value: (s) => s.state ?? '' },
  { header: 'Executive', value: (s) => s.executiveName ?? '' },
  { header: 'Net Amount', value: (s) => s.netAmount ?? '' },
  { header: 'FAME II', value: (s) => s.fameIi ?? '' },
  { header: 'CGST %', value: (s) => s.cgstper ?? '' },
  { header: 'SGST %', value: (s) => s.sgstper ?? '' },
  { header: 'IGST %', value: (s) => s.igstper ?? '' },
  { header: 'Customer Mobile', value: (s) => s.cusMob ?? '' },
  { header: 'Reference No', value: (s) => s.referenceNo ?? '' },
  { header: 'Booking Date', value: (s) => (s.bookingDate ? new Date(s.bookingDate).toLocaleDateString('en-IN') : '') },
]

const normalizeHeader = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[.\s]/g, '')

/** Looks a value up in one parsed Excel row by trying each of several possible header spellings in
 * turn (case/spacing/punctuation-insensitive) - real-world exports vary ("Chasis No" vs "Chassis
 * No", "Reg No" vs "Reg. No"), so this is more forgiving than requiring an exact header match. */
function makeRowGetter(headerRow: unknown[]) {
  const indexByHeader = new Map<string, number>()
  headerRow.forEach((h, i) => {
    const n = normalizeHeader(h)
    if (n && !indexByHeader.has(n)) indexByHeader.set(n, i)
  })
  return (dataRow: unknown[], ...candidates: string[]): string | null => {
    for (const c of candidates) {
      const idx = indexByHeader.get(normalizeHeader(c))
      if (idx === undefined) continue
      const v = dataRow[idx]
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
    }
    return null
  }
}

/**
 * Maps one row of a real DMS / ERP "Vehicle Sale Report" export (2026-09-18: "this excel
 * format i want to import in my project" - a 53,000+ row report with columns like Model Code/
 * Chasis No/Reg No/Dealer Name/Sale Date/Total Amount) onto this page's own DmsBaplDataVehicleSale
 * shape, so imported rows render in exactly the same table/detail-panel/export as server rows.
 *
 * INTERPRETATION: a best-effort field-by-field match, not a verified 1:1 correspondence - a few
 * fields are approximated (e.g. `soldTo` from the report's "Name" column; `saleType` falls back to
 * "Type" when "Bill Type" is blank). Spot-check a few imported rows against the source report.
 */
function mapVsrRow(dataRow: unknown[], get: ReturnType<typeof makeRowGetter>, index: number): DmsBaplDataVehicleSale {
  const g = (...candidates: string[]) => get(dataRow, ...candidates)
  const num = (...candidates: string[]) => {
    const raw = g(...candidates)
    if (raw == null) return null
    const n = parseFloat(raw.replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return {
    id: -(index + 1), // negative + synthesized - imported rows have no database Id
    isImported: true,
    dealerName: g('Dealer Name'),
    dealerCode: g('Dealer Code'),
    invoiceNo: g('Invoice No'),
    regNo: g('Reg No', 'Regn No', 'Registration No'),
    invoiceDate: g('Sale Date', 'Dispatch Date'),
    location: g('Location'),
    locCode: g('Loc. Code', 'LocCode'),
    locationCity: g('Dealer City'),
    custDob: null,
    gender: null,
    soldTo: g('Name'), // best-effort - see this function's doc comment
    accountType: null,
    partyEmail: g('Email'),
    cusMob: g('Mobile No'),
    address1: g('Address1'),
    address2: g('Address2'),
    city: g('Customer City'),
    state: g('Customer State', 'Dealer State'),
    executiveName: g('Executive Name'),
    pin: g('Pin'),
    chassisNo: g('Chasis No', 'Chassis No'),
    motorNo: g('Motor Number'),
    remarks: null,
    itemModel: g('Model Description', 'OEM Model Name'),
    oemmodel: g('OEM Model Name'),
    colorCode: g('Color Code'),
    vehicleType: null,
    vehicleGroup: g('Vehicle Group'),
    hsnsaccode: null,
    saleType: g('Bill Type', 'Type'),
    financedBy: g('Finance By'),
    finAmount: null,
    itemRate: null,
    insuAmount: null,
    regnAmount: null,
    acsryAmount: null,
    preGstdiscAmount: null,
    discTypeName: null,
    postGstdisc: null,
    fameIi: num('Subsidy Amount'),
    stateFameIi: null,
    sgstper: null,
    sgstamount: null,
    cgstper: null,
    cgstamount: null,
    igstper: null,
    igstamount: null,
    netAmount: num('Total Amount', 'Total'),
    referenceNo: g('Booking ID'),
    bookingDate: g('Bill Date'),
    totalCount: g('Total'),
    battery: g('Battery No'),
    batteryChemical: null,
    batteryCapacity: g('Battery Capacity'),
    batteryMake: null,
    chargerNo: null,
    chargerNo2: null,
    converter: null,
    vcu: null,
    controllerNo: null,
    fameIirequired: g('FameII Required'),
    segmentName: null,
    institutionalName: null,
    schemeName: null,
    createdAt: null,
    updatedAt: null,
  }
}

/** Largest number of matching rows the Excel / PDF download asks the server for. */
const EXPORT_LIMIT = 5000

/**
 * "Vehicle Sale" sidebar page.
 *
 * 2026-10-06 ("when SystemAdmin and CorporateAdmin open this page it needs to show all vehicle sale
 * data but it does not load"): the list is now SERVER-PAGED. It used to call
 * GET /api/dms-bapl-data/vehicle-sales once, receive EVERY sale bill (tens of thousands of rows -
 * what CorporateAdmin / SystemAdmin get, since they have no dealer filter) and filter / page them in
 * the browser, which timed out / froze. It now asks GET /api/vehicle-sales
 * (VehicleSalesController.cs) for one page at a time, with the search done by the server:
 *  - CorporateAdmin / SystemAdmin get every dealer's sales; every other role only its own dealer's;
 *  - Reg No (placeholder -> DMS_ServiceHistory -> manual override) is resolved by the server for
 *    just the page on screen;
 *  - Excel / PDF download the first 5,000 rows matching the current search.
 * "Import Vehicle Sale Report" still reads a report file entirely in the browser and swaps the page
 * over to those rows (searched and paged in the browser, since that file is its own dataset).
 *
 * Earlier history (kept short): Sold To=Zomato filter removed 2026-09-30; default page size 10
 * since 2026-09-28; inline Reg No correction (POST /api/vehicle-sale-overrides, saved in
 * JobCardScannerDb, wins over DMS_SaleBill / DMS_ServiceHistory) since 2026-09-28.
 */
export function VehicleSalePage() {
  const [sales, setSales] = useState<DmsBaplDataVehicleSale[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')

  const [importedRows, setImportedRows] = useState<DmsBaplDataVehicleSale[] | null>(null)
  const [importedFileName, setImportedFileName] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reg No inline-edit state - see saveRegNoOverride below.
  const [editingChassisNo, setEditingChassisNo] = useState<string | null>(null)
  const [editRegNoValue, setEditRegNoValue] = useState('')
  const [savingOverrideChassisNo, setSavingOverrideChassisNo] = useState<string | null>(null)
  const [overrideError, setOverrideError] = useState<string | null>(null)

  // ---------------- Server-paged list ----------------
  const [serverPage, setServerPage] = useState(1)
  const [serverPageSize, setServerPageSize] = useState(10)
  const [serverTotal, setServerTotal] = useState(0)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  // Typing in the search box searches the SERVER, after a short pause, from page 1.
  useEffect(() => {
    const handle = setTimeout(() => { setDebouncedQuery(query.trim()); setServerPage(1) }, 400)
    return () => clearTimeout(handle)
  }, [query])

  // "Refresh" - also drops an imported report, like before.
  const search = () => {
    setImportedRows(null)
    setImportedFileName(null)
    setReloadTick((t) => t + 1)
  }

  useEffect(() => {
    if (importedRows) return // an imported report is on screen - it is paged in the browser instead
    let cancelled = false
    setLoading(true)
    setError(null)
    staffApi
      .get<{ total: number; rows: DmsBaplDataVehicleSale[] }>('/api/vehicle-sales', {
        params: { search: debouncedQuery || undefined, page: serverPage, pageSize: serverPageSize },
      })
      .then((r) => {
        if (cancelled) return
        setSales(r.data.rows)
        setServerTotal(r.data.total)
      })
      .catch((err) => {
        if (cancelled) return
        setSales([])
        setServerTotal(0)
        setError(err?.response?.data?.message ?? 'Could not load the vehicle sales - check the connection and try again.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [importedRows, debouncedQuery, serverPage, serverPageSize, reloadTick])

  const handleImportFile = (file: File) => {
    setImportError(null)
    setImporting(true)
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = e.target?.result
      if (!data) { setImporting(false); return }
      // A real report export runs 50,000+ rows - parsing is a slow, CPU-bound loop, so it is deferred
      // one tick (setTimeout 0) purely so the browser can paint the "Parsing…" state first.
      setTimeout(() => {
        try {
          const workbook = XLSX.read(data, { type: 'array' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          if (!sheet) { setImportError('That file has no sheets.'); return }
          const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
          if (rows.length < 2) { setImportError('That file has no data rows below the header.'); return }
          const headerRow = rows[0] as unknown[]
          const get = makeRowGetter(headerRow)
          const mapped = rows.slice(1)
            .filter((r): r is unknown[] => Array.isArray(r) && r.some((c) => c !== undefined && c !== null && String(c).trim() !== ''))
            .map((r, i) => mapVsrRow(r, get, i))
          setImportedRows(mapped)
          setImportedFileName(file.name)
        } catch {
          setImportError('Could not read that file - make sure it is a .xlsx, .xls or .csv export.')
        } finally {
          setImporting(false)
        }
      }, 0)
    }
    reader.onerror = () => { setImportError('Could not read that file.'); setImporting(false) }
    reader.readAsArrayBuffer(file)
  }

  // ---------------- Imported report: searched and paged in the browser ----------------
  const importedFiltered = useMemo(() => {
    if (!importedRows) return []
    const q = query.trim().toLowerCase()
    if (!q) return importedRows
    return importedRows.filter((s) =>
      [s.invoiceNo, s.chassisNo, s.regNo, s.dealerName, s.dealerCode, s.itemModel, s.oemmodel,
        s.colorCode, s.soldTo, s.saleType, s.locationCity, s.city, s.state, s.executiveName, s.cusMob]
        .some((v) => v != null && String(v).toLowerCase().includes(q)))
  }, [importedRows, query])
  const clientPaging = usePagination(importedFiltered)
  // Default page size 10 for the imported report too (forced here, not inside the shared usePagination hook).
  useEffect(() => { clientPaging.setPageSize(10) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // One set of names for the table / Pagination below, whichever source is active.
  const usingImport = importedRows !== null
  const page = usingImport ? clientPaging.page : serverPage
  const setPage = usingImport ? clientPaging.setPage : setServerPage
  const pageSize = usingImport ? clientPaging.pageSize : serverPageSize
  const setPageSize = usingImport ? clientPaging.setPageSize : (n: number) => { setServerPageSize(n); setServerPage(1) }
  const total = usingImport ? clientPaging.total : serverTotal
  const pageCount = usingImport ? clientPaging.pageCount : Math.max(1, Math.ceil(serverTotal / serverPageSize))
  const pageRows = usingImport ? clientPaging.pageRows : sales

  // Excel / PDF: an imported report exports what is filtered; the normal list exports up to the first
  // EXPORT_LIMIT rows matching the search (a PDF of every sale bill is not practical).
  const rowsForExport = async (): Promise<DmsBaplDataVehicleSale[]> => {
    if (usingImport) return importedFiltered
    try {
      const r = await staffApi.get<{ rows: DmsBaplDataVehicleSale[] }>('/api/vehicle-sales', {
        params: { search: debouncedQuery || undefined, page: 1, pageSize: EXPORT_LIMIT },
      })
      return r.data.rows
    } catch {
      setError('Could not prepare the download - try again.')
      return []
    }
  }

  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN') : '—')
  const fmtAmt = (n?: number | null) => (n == null ? '—' : `₹${n.toFixed(2)}`)

  // Saves a hand-corrected Reg No for one chassis into JobCardScannerDb (POST /api/vehicle-sale-overrides),
  // NOT into DMSBAPLDATA/BaplConnection. Keyed by ChassisNo; the server re-applies it as the final,
  // highest-priority Reg No layer on every future load. Updated locally right after a successful save so the
  // table reflects it immediately.
  const saveRegNoOverride = async (row: DmsBaplDataVehicleSale) => {
    const chassisNo = row.chassisNo?.trim()
    const regNo = editRegNoValue.trim()
    if (!chassisNo) { setOverrideError('This row has no chassis no. on record - a Reg No override needs one to save against.'); return }
    if (!regNo) { setOverrideError('Reg No cannot be blank.'); return }
    setOverrideError(null)
    setSavingOverrideChassisNo(chassisNo)
    try {
      await staffApi.post('/api/vehicle-sale-overrides', { chassisNo, regNo })
      // Reflect it immediately in whichever source array this row actually came from.
      setSales((prev) => prev.map((s) => (s.chassisNo === chassisNo ? { ...s, regNo } : s)))
      setImportedRows((prev) => (prev ? prev.map((s) => (s.chassisNo === chassisNo ? { ...s, regNo } : s)) : prev))
      setEditingChassisNo(null)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setOverrideError(msg ?? 'Could not save the Reg No - try again.')
    } finally {
      setSavingOverrideChassisNo(null)
    }
  }

  return (
    <div>
      <h2>Vehicle Sale</h2>

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>Search</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Invoice No, Chassis No, Reg No, Model, Customer, Mobile…"
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <ReportDownloadButtons
          disabled={total === 0}
          onExcel={async () => {
            const rows = await rowsForExport()
            if (rows.length) exportReportToExcel('Vehicle_Sale_Report', REPORT_COLUMNS, rows)
          }}
          onPdf={async () => {
            const rows = await rowsForExport()
            if (rows.length) exportReportToPdf('Vehicle Sale Report', 'Vehicle_Sale_Report', REPORT_COLUMNS, rows)
          }}
        />
        <button type="button" className="btn btn-sm btn-import" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          {importing ? 'Parsing…' : '⬆ Import Vehicle Sale Report'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleImportFile(file)
            e.target.value = ''
          }}
        />
        {importing && <span className="muted">Parsing file - large reports (50,000+ rows) can take several seconds…</span>}
        <button type="button" className="btn btn-sm" onClick={search} disabled={loading} title="Reload the vehicle sales">
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
        {importedRows && (
          <span className="muted">
            Showing {total} rows imported from <strong>{importedFileName}</strong> ·{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setImportedRows(null); setImportedFileName(null) }}>Clear import - show the live list</a>
          </span>
        )}
        {!importedRows && total > 0 && <span className="muted">{total.toLocaleString('en-IN')} vehicle sales{debouncedQuery ? ' match your search' : ''}</span>}
      </div>
      {importError && <p className="muted" style={{ color: '#b91c1c' }}>{importError}</p>}
      {error && !importedRows && <p className="muted" style={{ color: '#b91c1c' }}>{error}</p>}
      {overrideError && <p className="muted" style={{ color: '#b91c1c' }}>{overrideError}</p>}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Invoice No</th>
              <th>Invoice Date</th>
              <th>Dealer</th>
              <th>Chassis No</th>
              <th>Reg No</th>
              <th>Model / Color</th>
              <th>Sold To</th>
              <th>Sale Type</th>
              <th className="text-end">Net Amount</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((s) => (
              <Fragment key={s.id}>
                <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                  <td>{expandedId === s.id ? '▾' : '▸'}</td>
                  <td>{s.invoiceNo ?? '—'}</td>
                  <td>{fmtDate(s.invoiceDate)}</td>
                  <td>{s.dealerName ?? s.dealerCode ?? '—'}</td>
                  <td>{s.chassisNo ?? '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {editingChassisNo === s.chassisNo ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          autoFocus
                          value={editRegNoValue}
                          onChange={(ev) => setEditRegNoValue(ev.target.value)}
                          onKeyDown={(ev) => { if (ev.key === 'Enter') saveRegNoOverride(s); if (ev.key === 'Escape') setEditingChassisNo(null) }}
                          style={{ width: 110 }}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={savingOverrideChassisNo === s.chassisNo}
                          onClick={() => saveRegNoOverride(s)}
                        >
                          {savingOverrideChassisNo === s.chassisNo ? '…' : 'Save'}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setEditingChassisNo(null)}>✕</button>
                      </div>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {s.regNo ?? '—'}
                        {!!s.chassisNo && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            title="Correct this Reg No"
                            style={{ border: 'none', background: 'transparent', padding: '0 4px' }}
                            // `?? null`: chassisNo is typed `string | null | undefined`, one notch wider than editingChassisNo's
                            // `string | null` (TS2345 fix from 2026-09-28) - purely a type-level narrowing.
                            onClick={() => { setEditingChassisNo(s.chassisNo ?? null); setEditRegNoValue(s.regNo ?? ''); setOverrideError(null) }}
                          >
                            ✎
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td>{s.itemModel ?? '—'}{s.colorCode ? ` / ${s.colorCode}` : ''}</td>
                  <td>{s.soldTo ?? '—'}</td>
                  <td>{s.saleType ?? '—'}</td>
                  <td className="text-end">{fmtAmt(s.netAmount)}</td>
                </tr>
                {expandedId === s.id && (
                  <tr key={`${s.id}-detail`}>
                    <td colSpan={10} style={{ padding: 16, background: '#f9fafb' }}>
                      <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                        <div><label>Location</label><div>{s.location ?? '—'} {s.locCode ? `(${s.locCode})` : ''}</div></div>
                        <div><label>City / State</label><div>{[s.locationCity ?? s.city, s.state].filter(Boolean).join(', ') || '—'}</div></div>
                        <div><label>Executive</label><div>{s.executiveName ?? '—'}</div></div>
                        <div><label>Account Type</label><div>{s.accountType ?? '—'}</div></div>
                        <div><label>Financed By</label><div>{s.financedBy ?? '—'}</div></div>
                        <div><label>Vehicle Type / Group</label><div>{[s.vehicleType, s.vehicleGroup].filter(Boolean).join(' / ') || '—'}</div></div>
                        <div><label>Motor No</label><div>{s.motorNo ?? '—'}</div></div>
                        <div><label>Battery</label><div>{[s.battery, s.batteryMake, s.batteryCapacity].filter(Boolean).join(' / ') || '—'}</div></div>
                        <div><label>Charger No(s)</label><div>{[s.chargerNo, s.chargerNo2].filter(Boolean).join(', ') || '—'}</div></div>
                        <div><label>Controller / VCU</label><div>{[s.controllerNo, s.vcu].filter(Boolean).join(' / ') || '—'}</div></div>
                        <div><label>CGST</label><div>{s.cgstper != null ? `${s.cgstper}% (${fmtAmt(s.cgstamount)})` : '—'}</div></div>
                        <div><label>SGST</label><div>{s.sgstper != null ? `${s.sgstper}% (${fmtAmt(s.sgstamount)})` : '—'}</div></div>
                        <div><label>IGST</label><div>{s.igstper != null ? `${s.igstper}% (${fmtAmt(s.igstamount)})` : '—'}</div></div>
                        <div><label>FAME II</label><div>{fmtAmt(s.fameIi)}{s.stateFameIi != null ? ` + State ${fmtAmt(s.stateFameIi)}` : ''}</div></div>
                        <div><label>Institutional / Scheme</label><div>{[s.institutionalName, s.schemeName].filter(Boolean).join(' / ') || '—'}</div></div>
                        <div><label>Segment</label><div>{s.segmentName ?? '—'}</div></div>
                        <div><label>Booking Date</label><div>{fmtDate(s.bookingDate)}</div></div>
                        <div><label>Reference No</label><div>{s.referenceNo ?? '—'}</div></div>
                        <div><label>Customer Mobile</label><div>{s.cusMob ?? '—'}</div></div>
                        <div><label>Customer Email</label><div>{s.partyEmail ?? '—'}</div></div>
                        <div><label>Address</label><div>{[s.address1, s.address2, s.pin].filter(Boolean).join(', ') || '—'}</div></div>
                        <div><label>Remarks</label><div>{s.remarks ?? '—'}</div></div>
                        {s.isImported && <div><label>Source</label><div>Imported from {importedFileName}</div></div>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {pageRows.length === 0 && !loading && !error && (
              <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                {query.trim()
                  ? <>No vehicle sales match "{query.trim()}".</>
                  : <>No vehicle sales found.</>}
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>
    </div>
  )
}
