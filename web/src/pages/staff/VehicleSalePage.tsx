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
// they never drift apart. Works for both DMSBAPLDATA-sourced and imported rows since both fill the
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
 * format i want to import in my project" - you uploaded a 53,000+ row report with columns like
 * Model Code/Chasis No/Reg No/Dealer Name/Sale Date/Total Amount) onto this page's own
 * DmsBaplDataVehicleSale shape, so imported rows render in exactly the same table/detail-panel/
 * export as DMSBAPLDATA-sourced ones.
 *
 * FACT: this is a genuinely different report from DMSBAPLDATA's own DMS_VehicleSales table (which
 * you separately confirmed live via your own `select *`, matching what GET /api/dms-bapl-data/
 * vehicle-sales already returns) - different columns, many more rows, no shared key to reconcile
 * them by. INTERPRETATION: the mapping below is a best-effort field-by-field match between the two
 * shapes, not a verified 1:1 correspondence - a few fields are approximated (e.g. `soldTo` from the
 * report's "Name" column, since it has no explicit "Sold To" column the way DMS_VehicleSales does;
 * `saleType` falls back to "Type" when "Bill Type" is blank). Please spot-check a few imported rows
 * against the source report before relying on the numbers here.
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
    id: -(index + 1), // negative + synthesized - imported rows have no DMSBAPLDATA Id
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

/**
 * "Vehicle Sale" sidebar page (2026-09-18: "i want 1 option in sidebar that was Vehicle sale from
 * DMSBAPLDATA select * from DMS_VehicleSales where SoldTo like '%Zomato%' ... add in that after
 * jobcards sidebar menu") - shows DMSBAPLDATA's vehicle sale data by default (see GET
 * /api/dms-bapl-data/vehicle-sales and DmsBaplDataVehicleSaleRow's doc comment in
 * DmsBaplDataService.cs - that schema is now independently confirmed against a live `select *` you
 * ran yourself).
 *
 * 2026-09-18 additions:
 *  - The "Sold To" search box is gone from view per your request ("Sold To zomato hide this") -
 *    the page originally still only ever asked DMSBAPLDATA for Zomato's sales (soldTo stayed
 *    hardcoded), just without a visible, editable field for it.
 *
 * 2026-09-30 CHANGE ("remove condition soldto = zomato all data show"): the Sold To=Zomato filter
 * is REMOVED - this page now asks DMSBAPLDATA for every vehicle sale, not just Zomato's. The
 * "Sold To" column (and its value in the search/export) is unaffected - it still shows whatever
 * DMSBAPLDATA returns per row, it's just no longer used to filter the query itself. A plain
 * Refresh button re-runs the same (now unfiltered) query. NOT CONFIRMED: I don't have
 * DmsBaplDataController.cs/DmsBaplDataService.cs in this session, so whether GET
 * /api/dms-bapl-data/vehicle-sales actually returns everything when soldTo is omitted (vs.
 * erroring, vs. defaulting to something else server-side) is unverified - flag it if Refresh
 * starts failing or still only shows Zomato after this deploys.
 *  - "Import Vehicle Sale Report" reads a real DMS/ERP report export (see mapVsrRow's doc
 *    comment above) entirely in the browser and SWAPS the page over to showing that file's rows
 *    instead of DMSBAPLDATA's - not a bulk filter over the DMSBAPLDATA results like Repair Bill/
 *    Material Transfer's Import Excel buttons still are, since this file is a full alternate
 *    dataset with its own rows, not a short list of ids to filter by. Nothing is written back to
 *    DMSBAPLDATA or anywhere else - purely client-side, purely for viewing/exporting.
 *  - Pagination defaults to 100 rows/page (was 25) with a selector, since an imported report can run
 *    into the tens of thousands of rows.
 *
 * 2026-09-28 CHANGES:
 *  - Pagination now defaults to 10 rows/page (was 100), per explicit request. Forced via a
 *    setPageSize(10) on mount rather than editing usePagination's own default - I don't have
 *    lib/usePagination.ts in this session, and that hook is shared by Repair Bill/Material
 *    Transfer/Service History too, so changing its internal default would silently change their
 *    page sizes as well. This only touches Vehicle Sale. Paste usePagination.ts if you'd rather
 *    the shared default itself changed to 10 for every page that uses it.
 *  - New inline "Edit" control on the Reg No column: lets you correct a row's Reg No by hand and
 *    save it - see the doc comment on saveRegNoOverride below for exactly what this does and does
 *    NOT do. Backed by the new POST /api/vehicle-sale-overrides endpoint
 *    (VehicleSaleOverridesController.cs) and a new VehicleSaleOverride table in JobCardScannerDb -
 *    see sql/2026-09-28_create_vehicle_sale_overrides_table.sql and README SECTION 114.
 *    INTERPRETATION: only Reg No is editable here, since that's the concrete example you gave
 *    ("edit details like reg no.") - tell me which other fields should also become editable and
 *    I'll extend the same mechanism (the table/endpoint are generic enough to grow more override
 *    columns) rather than guessing further fields now. Also built as an inline edit on this same
 *    page/table (not a separate routed page) since I don't have your router file to safely wire a
 *    new route - say so if you specifically want a dedicated edit page/URL instead.
 */
export function VehicleSalePage() {
  const [sales, setSales] = useState<DmsBaplDataVehicleSale[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  // 2026-09-25 ("add search option"): a client-side filter over whatever's currently loaded
  // (DMSBAPLDATA's results, or an imported report - same "everything downstream reads from
  // effectiveSales" convention this page already uses below). Not a new server call/param - it
  // just narrows what's already on screen (see SECTION 181 above: the underlying DMSBAPLDATA
  // query itself is unfiltered now, not Sold To=Zomato any more). Matches across the same fields
  // the on-screen table + report export show, case-insensitive substring.
  const [query, setQuery] = useState('')

  const [importedRows, setImportedRows] = useState<DmsBaplDataVehicleSale[] | null>(null)
  const [importedFileName, setImportedFileName] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 2026-09-28: Reg No inline-edit state - see saveRegNoOverride's doc comment below.
  const [editingChassisNo, setEditingChassisNo] = useState<string | null>(null)
  const [editRegNoValue, setEditRegNoValue] = useState('')
  const [savingOverrideChassisNo, setSavingOverrideChassisNo] = useState<string | null>(null)
  const [overrideError, setOverrideError] = useState<string | null>(null)

  const search = () => {
    setLoading(true)
    setError(null)
    setImportedRows(null) // a fresh DMSBAPLDATA refresh drops any imported report currently shown
    setImportedFileName(null)
    staffApi
      .get<DmsBaplDataVehicleSale[]>('/api/dms-bapl-data/vehicle-sales')
      .then((r) => setSales(r.data))
      .catch((err) => {
        setSales([])
        setError(err?.response?.data?.message ?? 'Could not reach DMSBAPLDATA - check the connection and try again.')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { search() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleImportFile = (file: File) => {
    setImportError(null)
    setImporting(true)
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = e.target?.result
      if (!data) { setImporting(false); return }
      // A real report export like the one you tested with runs 50,000+ rows - parsing that is a
      // genuinely slow (several-second), CPU-bound loop, so it's deferred one tick past the
      // `setImporting(true)` above (setTimeout 0) purely so the browser gets a chance to paint the
      // "Parsing…" state before the page locks up doing it - without this, the button click would
      // otherwise freeze the tab with no visible feedback for however long the parse takes.
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

  // Everything downstream (table, pagination, export) reads from whichever source is active -
  // the imported report when one's loaded, DMSBAPLDATA's own results otherwise.
  const effectiveSales = importedRows ?? sales

  // 2026-09-25 ("add search option"): narrows effectiveSales by a free-text query across the
  // fields visible in the table plus a few more someone's likely to search by (Invoice No,
  // Chassis No, Reg No, Dealer, Model, Sold To, Sale Type, City, State, Executive, Customer
  // Mobile). Excel/PDF export downloads whatever's currently filtered/visible, same as the
  // on-screen table - not a hidden "export everything regardless of search" surprise.
  const filteredSales = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return effectiveSales
    return effectiveSales.filter((s) =>
      [s.invoiceNo, s.chassisNo, s.regNo, s.dealerName, s.dealerCode, s.itemModel, s.oemmodel,
        s.colorCode, s.soldTo, s.saleType, s.locationCity, s.city, s.state, s.executiveName, s.cusMob]
        .some((v) => v != null && String(v).toLowerCase().includes(q)))
  }, [effectiveSales, query])

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(filteredSales)

  // 2026-09-28 ("in vehicle sale pagination default 10"): forces this page's initial page size to
  // 10 rows, once, right after the shared usePagination hook sets up its own default (100, per the
  // 2026-09-18 doc note above). See this component's own doc comment for why this is done here
  // rather than inside usePagination itself.
  useEffect(() => { setPageSize(10) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN') : '—')
  const fmtAmt = (n?: number | null) => (n == null ? '—' : `₹${n.toFixed(2)}`)

  // 2026-09-28 ("edit button for new page where we can edit details like reg no. we can edit and
  // that was save in our jobcard db that will data reflect on ui"): saves a hand-corrected Reg No
  // for one chassis into JobCardScannerDb (POST /api/vehicle-sale-overrides), NOT into
  // DMSBAPLDATA/BaplConnection - this app stays read-only against both of those, same as every
  // other page here. The saved override is keyed by ChassisNo (the one stable identifier shared
  // across DMS_SaleBill/DMS_ServiceHistory/imported reports) and, per DmsBaplDataService.
  // GetVehicleSalesAsync's own 2026-09-28 update, is re-applied as the FINAL/highest-priority layer
  // on every future load of this page - it wins over both DMS_SaleBill's own reg_number and
  // anything SECTION 113's DMS_ServiceHistory fallback finds. Updated locally right after a
  // successful save too, so the table reflects it immediately without waiting for a refresh.
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
      <p className="muted">
        {importedRows
          ? <>Showing {total} rows imported from <strong>{importedFileName}</strong> - not from DMSBAPLDATA.</>
          : <>Synced vehicle sale data from DMSBAPLDATA. Read-only - this app never writes to DMSBAPLDATA.</>}
        {' '}Click a row for the full details. Use the ✎ next to Reg No to correct it by hand.
      </p>

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>Search</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Invoice No, Chassis No, Reg No, Dealer, Model, Sold To…"
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <ReportDownloadButtons
          disabled={filteredSales.length === 0}
          onExcel={() => exportReportToExcel('Vehicle_Sale_Report', REPORT_COLUMNS, filteredSales)}
          onPdf={() => exportReportToPdf('Vehicle Sale Report', 'Vehicle_Sale_Report', REPORT_COLUMNS, filteredSales)}
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
        <button type="button" className="btn btn-sm" onClick={search} disabled={loading} title="Re-fetch from DMSBAPLDATA">
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
        {importedRows && (
          <span className="muted">
            <a href="#" onClick={(e) => { e.preventDefault(); setImportedRows(null); setImportedFileName(null) }}>Clear import - show DMSBAPLDATA results</a>
          </span>
        )}
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
                            // 2026-09-28 FIX - your real compiler error (TS2345: "Argument of type
                            // 'string | null | undefined' is not assignable to parameter of type
                            // 'SetStateAction<string | null>'"): DmsBaplDataVehicleSale.chassisNo is
                            // typed as `string | null | undefined`, one notch wider than
                            // editingChassisNo's own `useState<string | null>` above - the `?? null`
                            // here collapses `undefined` down to `null` so it fits that type. This
                            // is inside the `!!s.chassisNo &&` guard just above, so this line only
                            // ever runs when chassisNo is already truthy anyway - purely a type-level
                            // fix, no behavior change.
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
            {filteredSales.length === 0 && !loading && !error && (
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
