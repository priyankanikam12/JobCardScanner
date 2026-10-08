import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'

/**
 * Ledger Master - laid out like DMS's "Customer Ledger" page (2026-10-06, "same UI: first select the existing dealer, then the ledger type, then the
 * existing data like DMS").
 *
 *  1. CorporateAdmin / SystemAdmin first pick a DEALER from a searchable "CUS0364 - A K ENTERPRISES" box; nothing is listed until one is chosen
 *     (a Company list needs no dealer). Every other role has no dealer box - it loads its own list straight away.
 *  2. Then the LEDGER TYPE - taken from the Ledger Type MASTER (GET /api/ledger-master/types: Id / CustomerType, e.g. 1 Dealer, 5 Company, 3 Insurance,
 *     4 Party). Nothing about the types is typed into this page: a new type added to the master appears in the filter and the Add form by itself, and
 *     what a type means (auto-created from Dealers / organisation-level / plain per-dealer) comes from two flags on its master row.
 *  3. The list has DMS's columns (Sl No., Ledger Type, Ledger Name, Dealer Code / Dealer Name for the org-wide roles, Mobile No., Email, City, State,
 *     Created Date, Updated Date), sortable headers, numbered paging, Add, Excel export and Search. Double-click a row to edit it.
 *
 *  - Dealer    : COPIED from the ERP (BaplConnection, customer type 1) by the server. Only a SystemAdmin can edit / delete one (then the sync leaves it alone).
 *                (The server refreshes the copy every 15 minutes; org-wide roles also get a "Sync from ERP" button.)
 *  - Company   : COPIED from the ERP (just CUS0032) - organisation-level, visible to everyone; edit / delete by a SystemAdmin only.
 *  Every row is clickable: a click opens the ledger on its OWN PAGE (/ledger-master?id=...; Add is /ledger-master?new=1 - no route change needed, the browser Back button and a
 *  reload work) - editable (Save / Delete) when you may change it, otherwise view-only. "All" lists every type; the dealer box is an optional filter.
 *  - Party / Insurance : created per dealer. A dealer user adds them to its own dealer; CorporateAdmin / SystemAdmin add them to the dealer selected above
 *                and may share them with all dealers.
 * Rows you may not change simply have no Edit / Deactivate buttons. Gender / Occupation / DOB are not part of this form (earlier decision).
 */

/** One row of the Ledger Type master. isErpSourced: copied from the ERP and read-only here (Dealer, Company). isOrgLevel: no dealer, visible to all (Company). */
interface LedgerTypeOption {
  id: number
  customerType: string
  isErpSourced: boolean
  isOrgLevel: boolean
}
const ORG_WIDE_ROLES = ['CorporateAdmin', 'SystemAdmin']

interface DealerOption {
  id: string
  code: string | null
  name: string
}

/** A dealer fetched from the ERP (the Dealer Code dropdown): its ERP code, name, and the matching dealer of this app (null when not onboarded here). */
interface ErpDealerOption {
  code: string
  name: string
  dealerId: string | null
}

interface LedgerRow {
  id: string
  dealerId: string | null
  dealerName: string | null
  dealerCode: string | null
  ledgerTypeId: number
  ledgerType: string
  ledgerCode: string
  ledgerName: string
  mobileNumber: string | null
  alternateMobileNo: string | null
  eMail: string | null
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  pin: string | null
  gstno: string | null
  pan: string | null
  aadharNumber: string | null
  isShared: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string | null
  erpOverride: boolean   // an ERP ledger a SystemAdmin edited / deleted here - the ERP sync leaves it alone
  createdBy: string | null
  updatedBy: string | null
}

interface LedgerFormState {
  ledgerTypeId: number
  dealerId: string
  ledgerName: string
  mobileNumber: string
  alternateMobileNo: string
  eMail: string
  address: string
  address2: string
  city: string
  state: string
  pin: string
  gstno: string
  pan: string
  aadharNumber: string
  isShared: boolean
}

const EMPTY_FORM: LedgerFormState = {
  ledgerTypeId: 0,
  dealerId: '',
  ledgerName: '',
  mobileNumber: '',
  alternateMobileNo: '',
  eMail: '',
  address: '',
  address2: '',
  city: '',
  state: '',
  pin: '',
  gstno: '',
  pan: '',
  aadharNumber: '',
  isShared: false,
}

// Suggested values for the free-text State field - State is compared (case-insensitively) with the dealer's State to choose CGST+SGST vs IGST,
// so a consistent spelling matters. Still free text: anything can be typed.
const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand',
  'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]

const PAGE_SIZE = 10
const EXPORT_MAX_ROWS = 5000
const PAGER_WINDOW = 5

const PAGE_TITLE_STYLE: CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: '#111827', margin: 0 }

const dealerLabel = (d: DealerOption) => `${d.code ? `${d.code} - ` : ''}${d.name}`

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

// "01-09-2026 07:59:23 PM" - the DMS Created / Updated DateTime format
const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  const h = d.getHours() % 12 || 12
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(h)}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getHours() >= 12 ? 'PM' : 'AM'}`
}

/** "MAGNEMITE MOTO LLP-AHMEDABAD" -> "MM"; "+" for a new ledger. */
const initials = (name?: string | null) => {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return words.length ? (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase() : '+'
}

// CSV cell quoting - wraps in quotes and escapes embedded quotes only when actually needed.
function csvCell(value: string | null | undefined): string {
  const v = value ?? ''
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

type SortKey = 'ledgerType' | 'ledgerCode' | 'ledgerName' | 'dealerCode' | 'dealerName' | 'mobileNumber' | 'eMail' | 'city' | 'state' | 'createdAt' | 'updatedAt'

/** Searchable dealer box ("CUS0364 - A K ENTERPRISES"), like DMS's Dealer Code select, with an "All Dealers" choice at the top. */
function DealerSelect({ dealers, value, onChange }: { dealers: DealerOption[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const selected = dealers.find((d) => d.id === value)
  const q = text.trim().toLowerCase()
  const shown = q ? dealers.filter((d) => dealerLabel(d).toLowerCase().includes(q)) : dealers
  return (
    <div className="ledger-combo">
      <input
        value={open ? text : selected ? dealerLabel(selected) : ''}
        placeholder="All Dealers"
        onFocus={() => { setOpen(true); setText('') }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => setOpen(false)}
        autoComplete="off"
      />
      <span className="ledger-combo-caret" aria-hidden="true">▾</span>
      {open && (
        <ul className="ledger-combo-list">
          {!q && <li className={value === '' ? 'active' : undefined} onMouseDown={(e) => { e.preventDefault(); onChange(''); setOpen(false) }}>All Dealers</li>}
          {shown.length === 0 && <li className="ledger-combo-empty">No dealer found</li>}
          {shown.map((d) => (
            <li
              key={d.id}
              className={d.id === value ? 'active' : undefined}
              onMouseDown={(e) => { e.preventDefault(); onChange(d.id); setOpen(false) }}
            >
              {dealerLabel(d)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Scoped stylesheet (same approach as AttendancePage). The table header copies DMS's slate-blue bar; below LEDGER_BREAKPOINT the table collapses into a
// stacked card per row.
const LEDGER_BREAKPOINT = 760
const LEDGER_STYLES = `
  .ledger-filters { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-end; }
  .ledger-field { display: flex; flex-direction: column; gap: 4px; }
  .ledger-field > label { font-size: 13px; font-weight: 600; color: #374151; }
  .ledger-field select { min-width: 220px; }
  .ledger-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-left: auto; }
  .ledger-search { min-width: 200px; max-width: 320px; }
  .ledger-combo { position: relative; min-width: 260px; }
  .ledger-combo input { width: 100%; box-sizing: border-box; padding-right: 26px; }
  .ledger-combo-caret { position: absolute; right: 9px; top: 50%; transform: translateY(-50%); color: #6b7280; pointer-events: none; font-size: 12px; }
  .ledger-combo-list { position: absolute; z-index: 20; left: 0; right: 0; top: 100%; margin: 2px 0 0; padding: 4px; list-style: none; max-height: 240px; overflow-y: auto; background: #fff; border: 1px solid #d1d5db; border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.12); }
  .ledger-combo-list li { padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .ledger-combo-list li:hover, .ledger-combo-list li.active { background: #eef2ff; }
  .ledger-combo-list li.ledger-combo-empty { color: #6b7280; cursor: default; }
  .ledger-table-wrap { overflow-x: auto; margin-top: 14px; }
  .ledger-table { width: 100%; border-collapse: collapse; font-size: 13px; border: 1px solid #e5e7eb; }
  .ledger-table th { text-align: left; padding: 9px 10px; background: #6b7aa3; color: #fff; font-weight: 600; border: 1px solid #8793b4; white-space: nowrap; user-select: none; }
  .ledger-table th.sortable { cursor: pointer; }
  .ledger-table th .ico { opacity: .75; font-size: 11px; margin-left: 4px; }
  .ledger-table td { padding: 8px 10px; border: 1px solid #e5e7eb; vertical-align: top; }
  .ledger-table tbody tr:hover { background: #f8fafc; }
  .ledger-table tbody tr.clickable { cursor: pointer; }
  .ledger-empty { text-align: center; color: #6b7280; padding: 18px; }
  .ledger-tag { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: #e0f2fe; color: #0369a1; margin-left: 6px; }
  .ledger-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
  .ledger-form-grid label { display: block; font-size: 12px; color: #6b7280; margin-bottom: 4px; }
  .ledger-form-grid input, .ledger-form-grid select { width: 100%; box-sizing: border-box; }
  .ledger-hint { font-size: 12px; color: #6b7280; margin: 6px 0 0; }
  .ledger-pager { display: flex; gap: 6px; justify-content: flex-end; align-items: center; margin-top: 12px; flex-wrap: wrap; }
  .ledger-pager button { min-width: 36px; height: 34px; border: 1px solid #e5e7eb; background: #fff; border-radius: 6px; cursor: pointer; color: #374151; }
  .ledger-pager button.current { background: #2c3e7a; border-color: #2c3e7a; color: #fff; }
  .ledger-pager button:disabled { opacity: .45; cursor: not-allowed; }
  .ledger-pager .count { font-size: 12px; color: #6b7280; margin-right: 8px; }
  .ledger-export-btn { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 34px; border-radius: 6px; border: none; background: #10b981; color: #fff; cursor: pointer; font-size: 15px; }
  .ledger-export-btn:disabled { opacity: .5; cursor: not-allowed; }

  /* ================= Ledger page (Add / view / edit) ================= */
  .lf-page { width: 100%; padding-bottom: 8px; }
  .lf-hero { position: relative; overflow: hidden; border-radius: 18px; padding: 20px 28px 26px; color: #fff; background: linear-gradient(120deg, #0b2545 0%, #13408f 62%, #2563eb 125%); box-shadow: 0 10px 30px rgba(11,37,69,.22); }
  .lf-hero::after { content: ''; position: absolute; right: -70px; top: -80px; width: 260px; height: 260px; border-radius: 50%; background: rgba(255,255,255,.07); }
  .lf-back { position: relative; z-index: 1; background: rgba(255,255,255,.14); color: #fff; border: 1px solid rgba(255,255,255,.28); border-radius: 999px; padding: 6px 15px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .lf-back:hover { background: rgba(255,255,255,.25); }
  .lf-hero-main { position: relative; z-index: 1; display: flex; align-items: center; gap: 18px; margin-top: 18px; }
  .lf-avatar { width: 66px; height: 66px; flex: none; border-radius: 18px; display: flex; align-items: center; justify-content: center; font-size: 25px; font-weight: 800; letter-spacing: .02em; background: linear-gradient(145deg, #60a5fa, #2563eb); box-shadow: 0 6px 16px rgba(0,0,0,.28); }
  .lf-title { margin: 0; font-size: 27px; font-weight: 800; letter-spacing: -.01em; line-height: 1.2; color: #fff; overflow-wrap: anywhere; }
  .lf-sub { margin: 5px 0 0; font-size: 13px; color: rgba(255,255,255,.78); }
  .lf-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 11px; }
  .lf-pill { font-size: 11.5px; font-weight: 700; padding: 4px 12px; border-radius: 999px; letter-spacing: .04em; background: rgba(255,255,255,.16); color: #fff; border: 1px solid rgba(255,255,255,.24); }
  .lf-pill.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .02em; }
  .lf-pill.erp { background: #e0f2fe; color: #075985; border-color: transparent; }
  .lf-pill.edited { background: #fef3c7; color: #92400e; border-color: transparent; }
  .lf-pill.off { background: #fee2e2; color: #991b1b; border-color: transparent; }
  .lf-pill.view { background: #f1f5f9; color: #334155; border-color: transparent; }

  .lf-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 22px 26px 26px; margin-top: 18px; box-shadow: 0 1px 2px rgba(16,24,40,.04); }
  .lf-card-head { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid #eef2f7; }
  .lf-ico { width: 36px; height: 36px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; background: #eff6ff; font-size: 18px; }
  .lf-card-head h3 { margin: 0; font-size: 16px; font-weight: 800; color: #0f172a; }
  .lf-card-head p { margin: 2px 0 0; font-size: 12px; color: #64748b; }

  .lf-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 20px 22px; align-items: start; }
  .lf-grid > label { display: flex; flex-direction: column; gap: 7px; min-width: 0; margin: 0; font-size: 11.5px !important; font-weight: 700 !important; color: #475569 !important; text-transform: uppercase !important; letter-spacing: .05em !important; }
  .lf-grid input, .lf-grid select, .lf-grid textarea { width: 100%; box-sizing: border-box; height: 42px; padding: 0 12px; border: 1px solid #d1d5db; border-radius: 10px; background: #fff; color: #0f172a; font-size: 14px !important; font-weight: 500 !important; text-transform: none !important; letter-spacing: 0 !important; transition: border-color .15s, box-shadow .15s; }
  .lf-grid textarea { height: auto; min-height: 96px; padding: 10px 12px; resize: vertical; font-family: inherit; line-height: 1.45; }
  .lf-grid input:focus, .lf-grid select:focus, .lf-grid textarea:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.16); }
  .lf-grid input:disabled, .lf-grid select:disabled, .lf-grid textarea:disabled { background: #f1f5f9; color: #475569; cursor: not-allowed; }
  .lf-grid input::placeholder { color: #94a3b8; }
  .lf-grid .s2 { grid-column: span 2; }
  .lf-grid .s3 { grid-column: span 3; }
  .lf-grid .s4 { grid-column: span 4; }
  .lf-req { color: #ef4444; }
  .lf-grid > label.lf-check { flex-direction: row; align-items: center; gap: 10px; height: 42px; margin-top: 25px; padding: 0 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; cursor: pointer; text-transform: none !important; font-size: 13.5px !important; font-weight: 600 !important; letter-spacing: 0 !important; color: #334155 !important; }
  .lf-grid > label.lf-check input { width: auto; height: auto; box-shadow: none; }

  .lf-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  .lf-meta > div { min-width: 0; background: #f8fafc; border: 1px solid #eef2f7; border-radius: 12px; padding: 12px 16px; }
  .lf-meta .k { display: block; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .06em; }
  .lf-meta .v { display: block; margin-top: 5px; font-size: 14px; font-weight: 600; color: #1e293b; overflow-wrap: anywhere; }

  .lf-callout { display: flex; gap: 10px; align-items: flex-start; margin-top: 18px; padding: 12px 16px; border-radius: 12px; font-size: 13px; line-height: 1.45; background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; }
  .lf-callout.gray { background: #f8fafc; border-color: #e2e8f0; color: #475569; }
  .lf-callout.warn { background: #fffbeb; border-color: #fde68a; color: #92400e; }
  .lf-callout.err { background: #fef2f2; border-color: #fecaca; color: #b91c1c; }

  .lf-actions { position: sticky; bottom: 12px; z-index: 5; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 20px; padding: 14px 18px; background: rgba(255,255,255,.96); backdrop-filter: blur(6px); border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 8px 28px rgba(15,23,42,.13); }
  .lf-actions .lf-delete { margin-right: auto; }
  .ledger-btn { border: 1px solid transparent; border-radius: 10px; padding: 10px 24px; cursor: pointer; font-weight: 700; font-size: 14px; transition: background .15s, box-shadow .15s; }
  .ledger-btn:disabled { opacity: .55; cursor: not-allowed; }
  .ledger-btn-blue { background: #2563eb; color: #fff; box-shadow: 0 4px 12px rgba(37,99,235,.28); }
  .ledger-btn-blue:hover:not(:disabled) { background: #1d4ed8; }
  .ledger-btn-red { background: #dc2626; color: #fff; box-shadow: 0 4px 12px rgba(220,38,38,.22); }
  .ledger-btn-red:hover:not(:disabled) { background: #b91c1c; }
  .ledger-btn-gray { background: #fff; color: #334155; border-color: #cbd5e1; }
  .ledger-btn-gray:hover:not(:disabled) { background: #f1f5f9; }

  @media (max-width: 1200px) {
    .lf-grid .s2 { grid-column: span 4; }   /* three per row */
    .lf-grid .s3, .lf-grid .s4 { grid-column: span 6; }   /* two per row */
    .lf-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: ${LEDGER_BREAKPOINT}px) {
    .lf-hero { padding: 16px 18px 20px; }
    .lf-title { font-size: 21px; }
    .lf-avatar { width: 52px; height: 52px; font-size: 20px; border-radius: 14px; }
    .lf-card { padding: 18px; }
    .lf-grid .s2, .lf-grid .s3, .lf-grid .s4 { grid-column: 1 / -1; }
    .lf-meta { grid-template-columns: 1fr; }
    .ledger-table thead { display: none; }
    .ledger-table, .ledger-table tbody, .ledger-table tr, .ledger-table td { display: block; width: 100%; box-sizing: border-box; }
    .ledger-table tr { border-bottom: 1px solid #e5e7eb; padding: 10px 12px; }
    .ledger-table td { border: none; padding: 3px 0; }
    .ledger-table td[data-label]::before { content: attr(data-label); display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #9ca3af; }
    .ledger-toolbar { margin-left: 0; width: 100%; }
    .ledger-search { flex: 1; max-width: none; }
    .ledger-combo, .ledger-field select { min-width: 0; width: 100%; }
    .ledger-field { flex: 1 1 100%; }
  }
`

export function LedgerMasterPage() {
  const { profile } = useStaffAuth()
  const isOrgWide = !!profile && ORG_WIDE_ROLES.includes(profile.role)

  const [rows, setRows] = useState<LedgerRow[]>([])
  const [totalRecords, setTotalRecords] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dealers, setDealers] = useState<DealerOption[]>([])
  const [erpDealers, setErpDealers] = useState<ErpDealerOption[]>([])   // the dealers fetched from the ERP - the Dealer Code dropdown (org-wide roles)
  const [dealerFilter, setDealerFilter] = useState('')                    // the picked ERP dealer's code, '' = all dealers
  const [types, setTypes] = useState<LedgerTypeOption[]>([])
  const [typeFilter, setTypeFilter] = useState<number | ''>('')
  const [search, setSearch] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // The Add / view / edit page lives in the URL, so it is a page of its own: ?new=1 (Add Ledger) or ?id=<ledger id> (open a ledger). List state (filters, page, search) is kept.
  const [searchParams, setSearchParams] = useSearchParams()
  const idParam = searchParams.get('id')
  const isNew = searchParams.get('new') === '1'
  const showForm = isNew || !!idParam
  const [editId, setEditId] = useState<string | null>(null)
  const [editIsActive, setEditIsActive] = useState(true)
  const [editCode, setEditCode] = useState<string | null>(null)
  const [editRow, setEditRow] = useState<LedgerRow | null>(null)   // the row the form is showing (to know whether it may be changed)
  const [form, setForm] = useState<LedgerFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [mobileWarning, setMobileWarning] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)       // the Dealer / Ledger Type lists could not be loaded
  const [syncWarning, setSyncWarning] = useState<string | null>(null)     // the server's last ERP-copy problem, if any
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  // The Dealer list ("CUS0364 - A K ENTERPRISES"): CorporateAdmin / SystemAdmin get every dealer to pick from; every other role gets just its own dealer,
  // shown locked in the same Dealer Code field. It also feeds the Dealer field of the Add form.
  useEffect(() => {
    staffApi
      .get<DealerOption[]>('/api/ledger-master/dealers')
      .then((res) => setDealers(res.data))
      .catch((err) => setSetupError(err?.response?.data?.message ?? 'Could not load the dealer list.'))
  }, [])

  // The Dealer Code dropdown: the dealers fetched from the ERP (org-wide roles). Reloaded after "Sync from ERP".
  const loadErpDealers = () => {
    if (!isOrgWide) return
    staffApi
      .get<ErpDealerOption[]>('/api/ledger-master/erp-dealers')
      .then((res) => setErpDealers(res.data))
      .catch((err) => setSetupError(err?.response?.data?.message ?? 'Could not load the dealers from the ERP.'))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadErpDealers, [isOrgWide])

  // The Ledger Type master drives the Ledger Type filter and the Add form.
  useEffect(() => {
    staffApi
      .get<LedgerTypeOption[]>('/api/ledger-master/types')
      .then((res) => setTypes(res.data))
      .catch((err) => setSetupError(err?.response?.data?.message
        ?? 'Could not load the Ledger Types.'))
  }, [])

  const typeById = (id: number | '' | null | undefined) => (id === '' || id == null ? undefined : types.find((t) => t.id === id))

  // For CorporateAdmin / SystemAdmin (who have the Dealer Code column) an ERP ledger's code - CUS0032 - is shown under Dealer Code, so the Ledger Code is skipped for Dealer /
  // Company rows: blank in the cell, and the whole column is hidden while the Ledger Type filter is Dealer or Company. Everyone else has no Dealer Code column, so keeps it.
  const filterType = typeById(typeFilter)
  const skipLedgerCode = (r: LedgerRow) => isOrgWide && !!typeById(r.ledgerTypeId)?.isErpSourced
  const showLedgerCodeColumn = !(isOrgWide && filterType?.isErpSourced)

  const listParams = (index: number, size: number) => ({
    searchTerm: search || undefined,
    pageIndex: index,
    pageSize: size,
    ledgerTypeId: typeFilter || undefined,
    includeInactive: true,
    dealerCode: isOrgWide && dealerFilter ? dealerFilter : undefined,
  })

  const load = () => {
    if (!profile) return
    setLoading(true)
    setError(null)
    staffApi
      .get<{ data: LedgerRow[]; totalRecords: number; syncWarning?: string | null }>('/api/ledger-master', { params: listParams(pageIndex, PAGE_SIZE) })
      .then((res) => {
        setRows(res.data.data)
        setTotalRecords(res.data.totalRecords)
        setSyncWarning(res.data.syncWarning ?? null)
      })
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load Ledger Master data.'))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [profile?.role, typeFilter, pageIndex, dealerFilter])

  // The search box resets to the first page on every change, debounced.
  useEffect(() => {
    const handle = setTimeout(() => {
      setPageIndex(0)
      load()
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  /** Who can change a row (the server enforces the same): Company and Dealer ledgers (copied from the ERP) only a SystemAdmin; every other ledger an org-wide role, or - for a
   *  dealer login - only its own dealer's. A row you may not change still opens, view-only. */
  const canChangeRow = (r: LedgerRow) => {
    const t = typeById(r.ledgerTypeId)
    if (t?.isErpSourced) return profile?.role === 'SystemAdmin'
    if (isOrgWide) return true
    if (t?.isOrgLevel) return false
    return !!profile?.dealerId && r.dealerId === profile.dealerId
  }

  /** 2026-10-07: every role may create and edit, but only CorporateAdmin / SystemAdmin may delete or reactivate - and a ledger copied from the ERP (Dealer, Company) only a SystemAdmin.
   *  Anyone else simply never sees the Delete / Reactivate button (the server refuses it too). */
  const canDeleteRow = (r: LedgerRow) => {
    if (typeById(r.ledgerTypeId)?.isErpSourced) return profile?.role === 'SystemAdmin'
    return isOrgWide
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  // Sorting is applied to the page on screen, like DMS's column headers.
  const shownRows = (() => {
    if (!sortKey) return rows
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = (a[sortKey] ?? '') as string
      const bv = (b[sortKey] ?? '') as string
      return av.toString().toLowerCase().localeCompare(bv.toString().toLowerCase()) * dir
    })
  })()

  /** A blank Add form: the first type this user can add (Party, when the master has it), and the dealer picked in the filter. */
  const applyAddDefaults = () => {
    setEditId(null)
    setEditCode(null)
    setEditRow(null)
    setEditIsActive(true)
    const addable = types.filter((t) => !t.isErpSourced && (isOrgWide || !t.isOrgLevel))
    const defaultType = addable.find((t) => t.customerType.toLowerCase() === 'party') ?? addable[0]
    setForm({ ...EMPTY_FORM, ledgerTypeId: defaultType?.id ?? 0, dealerId: isOrgWide ? (erpDealers.find((d) => d.code === dealerFilter)?.dealerId ?? '') : '' })
    setFormError(null)
    setMobileWarning(null)
  }

  const loadRowIntoForm = (r: LedgerRow) => {
    setEditId(r.id)
    setEditRow(r)
    setEditCode(r.ledgerCode)
    setEditIsActive(r.isActive)
    setForm({
      ledgerTypeId: r.ledgerTypeId,
      dealerId: r.dealerId ?? '',
      ledgerName: r.ledgerName,
      mobileNumber: r.mobileNumber ?? '',
      alternateMobileNo: r.alternateMobileNo ?? '',
      eMail: r.eMail ?? '',
      address: r.address ?? '',
      address2: r.address2 ?? '',
      city: r.city ?? '',
      state: r.state ?? '',
      pin: r.pin ?? '',
      gstno: r.gstno ?? '',
      pan: r.pan ?? '',
      aadharNumber: r.aadharNumber ?? '',
      isShared: r.isShared,
    })
    setFormError(null)
    setMobileWarning(null)
  }

  const openAdd = () => {
    applyAddDefaults()
    setSearchParams({ new: '1' })
    window.scrollTo({ top: 0 })
  }

  const openEdit = (r: LedgerRow) => {
    loadRowIntoForm(r)
    setSearchParams({ id: r.id })
    window.scrollTo({ top: 0 })
  }

  /** Back to the list (filters / page / search are still as they were). */
  const closeForm = () => {
    setEditId(null)
    setEditCode(null)
    setEditRow(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setMobileWarning(null)
    setSearchParams({})
  }

  // Opening or reloading /ledger-master?id=... directly: fetch that ledger.
  useEffect(() => {
    if (!idParam || editRow?.id === idParam) return
    staffApi
      .get<LedgerRow>(`/api/ledger-master/${idParam}`)
      .then((res) => loadRowIntoForm(res.data))
      .catch(() => {
        setError('That ledger could not be opened.')
        setSearchParams({})
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam])

  // /ledger-master?new=1 reached by URL or the browser's Back / Forward: make sure the page is a blank Add form (once the Ledger Types are known).
  useEffect(() => {
    if (!isNew || types.length === 0) return
    if (editId || form.ledgerTypeId === 0) applyAddDefaults()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, types.length, editId])

  const checkMobile = (mobile: string) => {
    setMobileWarning(null)
    if (!mobile || mobile.length < 10) return
    staffApi
      .get<boolean>('/api/ledger-master/check-mobile', { params: { mobile, excludeId: editId ?? undefined } })
      .then((res) => {
        if (res.data) setMobileWarning('A ledger with this mobile number already exists.')
      })
      .catch(() => {
        /* best-effort only - never block saving just because this check failed */
      })
  }

  const formType = typeById(form.ledgerTypeId)
  const isCompanyType = !!formType?.isOrgLevel
  // "plain" per-dealer type (Party, Insurance, anything added later with both flags off): the only kind that has a Dealer field / share tick-box
  const isPartyOrInsurance = !!formType && !formType.isErpSourced && !formType.isOrgLevel
  // New ledgers: every plain type, plus the org-level one (Company) for org-wide roles. (A Dealer-type ledger is never added by hand.)
  const typeOptions: LedgerTypeOption[] = editId
    ? (formType ? [formType] : [])
    : types.filter((t) => !t.isErpSourced && (isOrgWide || !t.isOrgLevel))

  // a row opened from the list: editable only when this login may change it, otherwise the same form is shown view-only
  const formEditable = !editId || (editRow ? canChangeRow(editRow) : false)
  const readOnlyForm = !!editId && !formEditable

  const save = () => {
    const name = form.ledgerName.trim()
    if (!editId && !form.ledgerTypeId) {
      setFormError('Ledger Type is required.')
      return
    }
    if (!name) {
      setFormError('Ledger Name is required.')
      return
    }
    if (!editId && isOrgWide && isPartyOrInsurance && !form.dealerId) {
      setFormError('Dealer is required.')
      return
    }
    setSaving(true)
    setFormError(null)

    const common = {
      ledgerName: name,
      mobileNumber: form.mobileNumber.trim() || null,
      alternateMobileNo: form.alternateMobileNo.trim() || null,
      eMail: form.eMail.trim() || null,
      address: form.address.trim() || null,
      address2: form.address2.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      pin: form.pin.trim() || null,
      gstno: form.gstno.trim() || null,
      pan: form.pan.trim() || null,
      aadharNumber: form.aadharNumber.trim() || null,
      isShared: isOrgWide && isPartyOrInsurance ? form.isShared : undefined,
    }

    const req = editId
      ? staffApi.put(`/api/ledger-master/${editId}`, { ...common, isActive: editIsActive })
      : staffApi.post('/api/ledger-master', {
          ...common,
          ledgerTypeId: form.ledgerTypeId,
          dealerId: isOrgWide && isPartyOrInsurance ? form.dealerId || null : undefined,
        })

    req
      .then(() => {
        closeForm()
        load()
      })
      .catch((err) => setFormError(err?.response?.data?.message ?? `Could not save this ledger (${err?.response?.status ? `HTTP ${err.response.status}` : 'no response from the server'}).`))
      .finally(() => setSaving(false))
  }

  const toggleActive = (r: LedgerRow, andClose = false) => {
    if (!canDeleteRow(r)) return
    if (r.isActive && !window.confirm(`Delete ledger "${r.ledgerName}"? It is hidden from the pickers and can be reactivated from this list later.`)) return
    const action = r.isActive
      ? staffApi.delete(`/api/ledger-master/${r.id}`)
      : staffApi.put(`/api/ledger-master/${r.id}`, {
          ledgerName: r.ledgerName,
          mobileNumber: r.mobileNumber,
          alternateMobileNo: r.alternateMobileNo,
          eMail: r.eMail,
          address: r.address,
          address2: r.address2,
          city: r.city,
          state: r.state,
          pin: r.pin,
          gstno: r.gstno,
          pan: r.pan,
          aadharNumber: r.aadharNumber,
          isActive: true,
        })
    action
      .then(() => { if (andClose) closeForm(); load() })
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not update this ledger.'))
  }

  // Org-wide roles: copy the Dealer / Company ledgers from the ERP right now (the server also does it every 15 minutes).
  const syncErp = () => {
    setSyncing(true)
    setSyncMsg(null)
    setError(null)
    staffApi
      .post<{ created: number; updated: number; deactivated: number; source?: string | null }>('/api/ledger-master/sync-erp')
      .then((res) => {
        setSyncMsg(`ERP sync done${res.data.source ? ` (from ${res.data.source})` : ''}: ${res.data.created} added, ${res.data.updated} updated, ${res.data.deactivated} deactivated.`)
        loadErpDealers()
        load()
      })
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not sync from the ERP.'))
      .finally(() => setSyncing(false))
  }

  const exportCsv = () => {
    setExporting(true)
    staffApi
      .get<{ data: LedgerRow[]; totalRecords: number }>('/api/ledger-master', { params: listParams(0, EXPORT_MAX_ROWS) })
      .then((res) => {
        const headers = ['Ledger Code', 'Ledger Type', 'Ledger Name', 'Dealer Code', 'Dealer Name', 'Mobile No', 'Alternate Mobile No', 'Email', 'Address', 'Address 2', 'City', 'State', 'Pin', 'GSTIN', 'PAN', 'Aadhaar No', 'Shared', 'Status', 'Created Date', 'Updated Date']
        const lines = [headers.join(',')]
        for (const r of res.data.data) {
          lines.push([
            csvCell(skipLedgerCode(r) ? '' : r.ledgerCode), csvCell(r.ledgerType), csvCell(r.ledgerName), csvCell(r.dealerCode), csvCell(r.dealerName),
            csvCell(r.mobileNumber), csvCell(r.alternateMobileNo), csvCell(r.eMail), csvCell(r.address), csvCell(r.address2),
            csvCell(r.city), csvCell(r.state), csvCell(r.pin), csvCell(r.gstno), csvCell(r.pan), csvCell(r.aadharNumber),
            csvCell(r.isShared ? 'Yes' : 'No'), csvCell(r.isActive ? 'Active' : 'Deactivated'),
            csvCell(fmtDate(r.createdAt)), csvCell(fmtDate(r.updatedAt)),
          ].join(','))
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = 'LedgerList.csv'
        link.click()
        URL.revokeObjectURL(url)
      })
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not export ledgers.'))
      .finally(() => setExporting(false))
  }

  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE))
  const windowStart = Math.max(0, Math.min(pageIndex - Math.floor(PAGER_WINDOW / 2), totalPages - PAGER_WINDOW))
  const pageNumbers = Array.from({ length: Math.min(PAGER_WINDOW, totalPages) }, (_, i) => windowStart + i)

  const sortableTh = (key: SortKey, label: string) => (
    <th className="sortable" onClick={() => toggleSort(key)}>
      {label}<span className="ico">{sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </th>
  )

  const columnCount = (showLedgerCodeColumn ? 10 : 9) + (isOrgWide ? 2 : 0) + 1

  // ------------------------------------------------------------------------------------------------------------------------------
  // The Add Ledger / view / edit PAGE - a screen of its own (URL ?new=1 or ?id=...), laid out like DMS's Customer Ledger form:
  // one card, a four-column grid, audit fields at the bottom, buttons bottom-right. (Gender / Occupation / DOB / D2D are not part of this form.)
  // ------------------------------------------------------------------------------------------------------------------------------
  if (showForm) {
    if (idParam && !editRow) {
      return (
        <div className="lf-page">
          <style>{LEDGER_STYLES}</style>
          <button className="ledger-btn ledger-btn-gray" onClick={closeForm}>← Back to Ledger Master</button>
          <p className="muted" style={{ marginTop: 16 }}>{error ?? 'Loading…'}</p>
        </div>
      )
    }

    const showAdminDealer = isOrgWide && isPartyOrInsurance
    return (
      <div className="lf-page">
        <style>{LEDGER_STYLES}</style>
        <datalist id="ledger-states">
          {INDIAN_STATES.map((st) => <option key={st} value={st} />)}
        </datalist>

        {/* ---------- banner ---------- */}
        <div className="lf-hero">
          <button className="lf-back" onClick={closeForm}>← Ledger Master</button>
          <div className="lf-hero-main">
            <div className="lf-avatar">{editId ? initials(editRow?.ledgerName) : '+'}</div>
            <div style={{ minWidth: 0 }}>
              <h1 className="lf-title">{editId ? (editRow?.ledgerName ?? 'Ledger') : 'Add Ledger'}</h1>
              <p className="lf-sub">
                {editId
                  ? `${formType?.customerType ?? 'Ledger'}${editRow?.dealerName && formType && !formType.isErpSourced ? ` · ${editRow.dealerName}` : ''}`
                  : 'Create a Party or Insurance ledger'}
              </p>
              <div className="lf-pills">
                {formType && <span className="lf-pill">{formType.customerType}</span>}
                {editId && editCode && <span className="lf-pill mono">{editCode}</span>}
                {editId && formType?.isErpSourced && <span className="lf-pill erp">FROM ERP</span>}
                {editRow?.erpOverride && <span className="lf-pill edited">EDITED HERE</span>}
                {editRow && !editRow.isActive && <span className="lf-pill off">DEACTIVATED</span>}
                {readOnlyForm && <span className="lf-pill view">VIEW ONLY</span>}
              </div>
            </div>
          </div>
        </div>

        <fieldset disabled={readOnlyForm} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {/* ---------- basic information ---------- */}
          <section className="lf-card">
            <div className="lf-card-head">
              <div className="lf-ico">🧾</div>
              <div><h3>Basic information</h3><p>Type, code and name of the ledger</p></div>
            </div>
            <div className="lf-grid">
              <label className="s2">
                Ledger Type
                <select
                  value={form.ledgerTypeId}
                  disabled={!!editId}
                  onChange={(e) => setForm((f) => ({ ...f, ledgerTypeId: Number(e.target.value) }))}
                >
                  {typeOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.customerType}</option>
                  ))}
                </select>
              </label>
              <label className="s2">
                Ledger Code
                <input value={editCode ?? ''} placeholder="Generated when saved" disabled readOnly />
              </label>
              <label className={showAdminDealer ? 's3' : 's4'}>
                <span>Ledger Name <span className="lf-req">*</span></span>
                <input value={form.ledgerName} onChange={(e) => setForm((f) => ({ ...f, ledgerName: e.target.value }))} />
              </label>
              {showAdminDealer && (
                <>
                  <label className="s3">
                    <span>Dealer <span className="lf-req">*</span></span>
                    <select
                      value={form.dealerId}
                      disabled={!!editId}
                      onChange={(e) => setForm((f) => ({ ...f, dealerId: e.target.value }))}
                    >
                      <option value="">Select a dealer…</option>
                      {dealers.map((d) => (
                        <option key={d.id} value={d.id}>{dealerLabel(d)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="s2 lf-check">
                    <input type="checkbox" checked={form.isShared} onChange={(e) => setForm((f) => ({ ...f, isShared: e.target.checked }))} />
                    Visible to all dealers
                  </label>
                </>
              )}
            </div>
          </section>

          {/* ---------- contact & tax ---------- */}
          <section className="lf-card">
            <div className="lf-card-head">
              <div className="lf-ico">📞</div>
              <div><h3>Contact &amp; tax</h3><p>How to reach them, and their tax IDs</p></div>
            </div>
            <div className="lf-grid">
              <label className="s2">
                PAN
                <input value={form.pan} maxLength={10} placeholder="ABCDE1234F" onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))} />
              </label>
              {formType?.customerType.toLowerCase() === 'party' && (
                <label className="s2">
                  Aadhaar No
                  <input
                    value={form.aadharNumber}
                    maxLength={12}
                    inputMode="numeric"
                    onChange={(e) => setForm((f) => ({ ...f, aadharNumber: e.target.value.replace(/[^0-9]/g, '').slice(0, 12) }))}
                  />
                </label>
              )}
              <label className="s2">
                GST
                <input value={form.gstno} maxLength={15} placeholder="27ABCDE1234F1Z5" onChange={(e) => setForm((f) => ({ ...f, gstno: e.target.value.toUpperCase() }))} />
              </label>
              <label className="s2">
                Mobile No
                <input
                  value={form.mobileNumber}
                  maxLength={10}
                  inputMode="numeric"
                  onChange={(e) => setForm((f) => ({ ...f, mobileNumber: e.target.value.replace(/[^0-9]/g, '').slice(0, 10) }))}
                  onBlur={(e) => checkMobile(e.target.value)}
                />
              </label>
              <label className="s2">
                Alt Mobile No
                <input
                  value={form.alternateMobileNo}
                  maxLength={10}
                  inputMode="numeric"
                  onChange={(e) => setForm((f) => ({ ...f, alternateMobileNo: e.target.value.replace(/[^0-9]/g, '').slice(0, 10) }))}
                />
              </label>
              <label className={formType?.customerType.toLowerCase() === 'party' ? 's2' : 's4'}>
                Email
                <input type="email" value={form.eMail} onChange={(e) => setForm((f) => ({ ...f, eMail: e.target.value }))} />
              </label>
            </div>
          </section>

          {/* ---------- address ---------- */}
          <section className="lf-card">
            <div className="lf-card-head">
              <div className="lf-ico">📍</div>
              <div><h3>Address</h3><p>Where the ledger is located</p></div>
            </div>
            <div className="lf-grid">
              <label className="s3">
                Address
                <textarea value={form.address} maxLength={400} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </label>
              <label className="s3">
                Address 2
                <textarea value={form.address2} maxLength={400} onChange={(e) => setForm((f) => ({ ...f, address2: e.target.value }))} />
              </label>
              <label className="s2">
                City
                <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </label>
              <label className="s2">
                State
                <input list="ledger-states" value={form.state} placeholder="Pick or type" onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
              </label>
              <label className="s2">
                PIN Code
                <input
                  value={form.pin}
                  maxLength={6}
                  inputMode="numeric"
                  onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) }))}
                />
              </label>
            </div>
          </section>
        </fieldset>

        {/* ---------- record details ---------- */}
        {editId && (
          <section className="lf-card">
            <div className="lf-card-head">
              <div className="lf-ico">🕒</div>
              <div><h3>Record details</h3><p>Who created and last changed this ledger</p></div>
            </div>
            <div className="lf-meta">
              <div><span className="k">Created by</span><span className="v">{editRow?.createdBy ?? (formType?.isErpSourced ? 'ERP' : '—')}</span></div>
              <div><span className="k">Created</span><span className="v">{fmtDateTime(editRow?.createdAt) || '—'}</span></div>
              <div><span className="k">Updated by</span><span className="v">{editRow?.updatedBy ?? '—'}</span></div>
              <div><span className="k">Updated</span><span className="v">{fmtDateTime(editRow?.updatedAt) || '—'}</span></div>
            </div>
          </section>
        )}

        {/* ---------- notes ---------- */}
        {editId && formType?.isErpSourced && (
          <div className={`lf-callout${formEditable ? '' : ' gray'}`}>
            <span>ℹ️</span>
            <span>
              {formEditable
                ? 'This ledger is copied from the ERP. Changes you save here are kept - the ERP sync will no longer overwrite this ledger.'
                : 'This ledger is copied from the ERP - only a SystemAdmin can change it.'}
            </span>
          </div>
        )}
        {isCompanyType && !formType?.isErpSourced && (
          <div className="lf-callout gray"><span>ℹ️</span><span>A {formType?.customerType} ledger belongs to the organisation and is visible to every dealer.</span></div>
        )}
        {mobileWarning && <div className="lf-callout warn"><span>⚠️</span><span>{mobileWarning}</span></div>}
        {formError && <div className="lf-callout err"><span>⛔</span><span>{formError}</span></div>}

        {/* ---------- actions ---------- */}
        <div className="lf-actions">
          {editId && formEditable && editRow && canDeleteRow(editRow) && (
            <button className="ledger-btn ledger-btn-red lf-delete" disabled={saving} onClick={() => toggleActive(editRow, true)}>
              {editRow.isActive ? 'Delete' : 'Reactivate'}
            </button>
          )}
          {!readOnlyForm && (
            <button className="ledger-btn ledger-btn-blue" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : editId ? 'Update' : 'Save'}
            </button>
          )}
          <button className="ledger-btn ledger-btn-gray" disabled={saving} onClick={closeForm}>{readOnlyForm ? 'Close' : 'Cancel'}</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <style>{LEDGER_STYLES}</style>

      <h2 style={PAGE_TITLE_STYLE}>Ledger Master</h2>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="ledger-filters">
          <div className="ledger-field">
            <label>Dealer Code</label>
            {isOrgWide ? (
              <DealerSelect
                dealers={erpDealers.map((d) => ({ id: d.code, code: d.code, name: d.name }))}
                value={dealerFilter}
                onChange={(code) => { setDealerFilter(code); setPageIndex(0) }}
              />
            ) : (
              // not an org-wide role: the field is still there, showing this login's own dealer (locked - the list is always scoped to it)
              <div className="ledger-combo">
                <input
                  value={(() => { const own = dealers.find((d) => d.id === profile?.dealerId) ?? dealers[0]; return own ? dealerLabel(own) : '' })()}
                  disabled
                  readOnly
                  placeholder="Your dealer"
                />
              </div>
            )}
          </div>
          <div className="ledger-field">
            <label>Ledger Type</label>
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value === '' ? '' : Number(e.target.value)); setPageIndex(0) }}>
              <option value="">All</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.customerType}</option>
              ))}
            </select>
          </div>
          <div className="ledger-toolbar">
            <button className="btn btn-primary" onClick={openAdd}>Add</button>
            {isOrgWide && <button className="btn" disabled={syncing} onClick={syncErp} title="Copy the Dealer and Company ledgers from the ERP now">{syncing ? 'Syncing…' : '⟳ Sync from ERP'}</button>}
            <button className="ledger-export-btn" title="Export to Excel (CSV)" disabled={exporting} onClick={exportCsv}>
              {exporting ? '…' : '⭳'}
            </button>
            <input
              className="ledger-search"
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {setupError && <p className="error-text" style={{ marginTop: 12 }}>{setupError}</p>}
        {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
        {syncWarning && <p className="muted" style={{ marginTop: 12, color: '#b45309' }}>⚠ The Dealer / Company data could not be refreshed from the ERP: {syncWarning}</p>}
        {syncMsg && <p className="muted" style={{ marginTop: 12 }}>{syncMsg}</p>}

        <div className="ledger-table-wrap">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Sl No.</th>
                {sortableTh('ledgerType', 'Ledger Type')}
                {showLedgerCodeColumn && sortableTh('ledgerCode', 'Ledger Code')}
                {sortableTh('ledgerName', 'Ledger Name')}
                {isOrgWide && sortableTh('dealerCode', 'Dealer Code')}
                {isOrgWide && sortableTh('dealerName', 'Dealer Name')}
                {sortableTh('mobileNumber', 'Mobile No.')}
                {sortableTh('eMail', 'Email')}
                {sortableTh('city', 'City')}
                {sortableTh('state', 'State')}
                {sortableTh('createdAt', 'Created Date')}
                {sortableTh('updatedAt', 'Updated Date')}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((r, i) => {
                const editable = canChangeRow(r)
                return (
                  <tr
                    key={r.id}
                    className="clickable"
                    style={r.isActive ? undefined : { opacity: 0.5 }}
                    title={editable ? 'Click to edit' : 'Click to view'}
                    onClick={() => openEdit(r)}
                  >
                    <td data-label="Sl No.">{pageIndex * PAGE_SIZE + i + 1}</td>
                    <td data-label="Ledger Type">{r.ledgerType}</td>
                    {showLedgerCodeColumn && <td data-label="Ledger Code">{skipLedgerCode(r) ? '' : r.ledgerCode}</td>}
                    <td data-label="Ledger Name">
                      {r.ledgerName}
                      {r.isShared && !typeById(r.ledgerTypeId)?.isErpSourced && !typeById(r.ledgerTypeId)?.isOrgLevel && <span className="ledger-tag" title="Visible to every dealer">ALL DEALERS</span>}
                      {r.erpOverride && <span className="ledger-tag" style={{ background: '#fef3c7', color: '#92400e' }} title="Edited here - the ERP sync no longer overwrites it">EDITED HERE</span>}
                      {!r.isActive && <span className="ledger-tag" style={{ background: '#fee2e2', color: '#b91c1c' }}>DEACTIVATED</span>}
                    </td>
                    {isOrgWide && <td data-label="Dealer Code">{r.dealerCode ?? ''}</td>}
                    {isOrgWide && <td data-label="Dealer Name">{r.dealerName ?? (typeById(r.ledgerTypeId)?.isOrgLevel ? 'All dealers' : '')}</td>}
                    <td data-label="Mobile No.">{r.mobileNumber ?? ''}</td>
                    <td data-label="Email">{r.eMail ?? ''}</td>
                    <td data-label="City">{r.city ?? ''}</td>
                    <td data-label="State">{r.state ?? ''}</td>
                    <td data-label="Created Date">{fmtDate(r.createdAt)}</td>
                    <td data-label="Updated Date">{fmtDate(r.updatedAt)}</td>
                    <td data-label="" style={{ whiteSpace: 'nowrap' }}>
                      {editable && <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(r) }}>Edit</button>}{' '}
                      {editable && canDeleteRow(r) && (
                        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); toggleActive(r) }}>{r.isActive ? 'Delete' : 'Reactivate'}</button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {shownRows.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="ledger-empty">
                    {loading ? 'Loading…' : 'No Data Available'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalRecords > 0 && (
          <div className="ledger-pager">
            <span className="count">{totalRecords} total</span>
            <button disabled={pageIndex === 0} onClick={() => setPageIndex(0)} title="First">««</button>
            <button disabled={pageIndex === 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))} title="Previous">«</button>
            {pageNumbers.map((n) => (
              <button key={n} className={n === pageIndex ? 'current' : undefined} onClick={() => setPageIndex(n)}>{n + 1}</button>
            ))}
            <button disabled={pageIndex + 1 >= totalPages} onClick={() => setPageIndex((p) => p + 1)} title="Next">»</button>
            <button disabled={pageIndex + 1 >= totalPages} onClick={() => setPageIndex(totalPages - 1)} title="Last">»»</button>
          </div>
        )}
      </div>
    </div>
  )
}
