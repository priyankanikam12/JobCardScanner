import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { staffApi } from '../../api/client'
import { NAV_ITEMS } from '../../components/StaffLayout'

/**
 * SECTION 165/166 (2026-09-30) "for this 3 master create edit delete access ?" - document-
 * numbering prefixes, plus the non-destructive "preview next number" tool.
 *
 * SECTION 184 (2026-10-02) "in module our sidebar option page name for every page ... Financial
 * Year is not required in that none option also add ... Number Length (Padding), Next Number,
 * Separator that feilds dont add ... auto increase" - confirmed via AskUserQuestion:
 *  - Module is no longer a closed JC/MT/RB list - it's now every sidebar page (NAV_ITEMS below),
 *    same list/labels the sidebar itself uses, so this never drifts out of sync with what pages
 *    actually exist.
 *  - Financial Year is now optional per module - a "No Financial Year" choice (UsesFinancialYear)
 *    drops the FY segment entirely, so e.g. Prefix "RB/hgh" + No Financial Year previews as
 *    "RB/hgh/001" rather than "RB/hgh/26-25/001".
 *  - Padding/Next Number/Separator are still NOT admin-editable fields anywhere on this page, per
 *    your explicit instruction - see DocPrefixMasterController.cs's SEPARATOR constant and
 *    FormatNumber's doc comment for how the running number auto-expands past 999/9999 with no
 *    Padding setting needed.
 *
 * IMPORTANT, carried over from SECTION 163's own README note: this table/page does NOT yet drive
 * your REAL Job Card / Material Transfer / Repair Bill numbers - those still come from the
 * existing JobCardNumberingService, which is not in this session. Preview below only shows what a
 * number WOULD look like using this separate table - it does not reserve or consume anything.
 */
interface PrefixRow {
  id: string
  moduleKey: string
  prefix: string
  usesFinancialYear: boolean
  isActive: boolean
}

// SECTION 172 (2026-09-30) - see ServiceMenuMasterPage.tsx's own SECTION 172 doc comment for the
// full explanation (checkbox moved to the side of the title row; shared typography styles).
const PAGE_TITLE_STYLE: CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: '#111827', margin: 0 }
const PAGE_SUBTITLE_STYLE: CSSProperties = { fontSize: 14, color: '#6b7280', margin: '4px 0 0' }
const SECTION_TITLE_STYLE: CSSProperties = { fontSize: 16, fontWeight: 600, color: '#111827', letterSpacing: '-0.005em', marginTop: 0 }
const TH_STYLE: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', textAlign: 'left' }
const TOGGLE_LABEL_STYLE: CSSProperties = {
  display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 500,
  color: '#374151', background: '#f3f4f6', padding: '6px 12px', borderRadius: 20, whiteSpace: 'nowrap',
}

// SECTION 184: every sidebar page, same list the sidebar itself renders from - replaces the old
// fixed DOC_TYPE_OPTIONS = ['JC', 'MT', 'RB']. Built as {key, label} pairs so the dropdown can show
// the readable sidebar label while posting/filtering on the same stable `key` NAV_ITEMS already
// uses everywhere else (Menu Access, the dashboard's "All Pages" grid, ...).
const MODULE_OPTIONS = NAV_ITEMS.map((item) => ({ key: item.key, label: item.label }))
function moduleLabel(key: string): string {
  return MODULE_OPTIONS.find((m) => m.key === key)?.label ?? key
}

export function DocPrefixMasterPage() {
  const [rows, setRows] = useState<PrefixRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('') // SECTION 174
  const [moduleFilter, setModuleFilter] = useState('') // SECTION 174 - '' = All Modules

  const [editId, setEditId] = useState<string | null>(null)
  const [newModuleKey, setNewModuleKey] = useState('')
  const [prefix, setPrefix] = useState('')
  // SECTION 184: "Financial Year is not required ... none option" - a 2-choice Yes/No control,
  // defaulting to Yes (matches every row created before this change, which all used Prefix/FY/####).
  const [usesFinancialYear, setUsesFinancialYear] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [previewModuleKey, setPreviewModuleKey] = useState('')
  const [financialYear, setFinancialYear] = useState('26-25')
  const [preview, setPreview] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const load = () => {
    setLoading(true)
    staffApi
      .get<PrefixRow[]>('/api/doc-prefix-master/admin-list')
      .then((res) => setRows(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load Prefix Master data.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  // The module currently picked in the Preview panel, if any row exists for it - used to decide
  // whether to even show the Financial Year box (SECTION 184: hidden/ignored entirely for a
  // "No Financial Year" module, rather than asking for a value that would just be discarded).
  const previewRow = rows.find((r) => r.moduleKey === previewModuleKey)

  const runPreview = () => {
    setPreviewing(true)
    setPreviewError(null)
    setPreview(null)
    staffApi
      .get<{ nextNumber: string }>('/api/doc-prefix-master/preview', {
        params: previewRow?.usesFinancialYear === false
          ? { moduleKey: previewModuleKey }
          : { moduleKey: previewModuleKey, financialYear },
      })
      .then((res) => setPreview(res.data.nextNumber))
      .catch((err) => setPreviewError(err?.response?.data?.message ?? 'Could not compute a preview.'))
      .finally(() => setPreviewing(false))
  }

  const startEdit = (r: PrefixRow) => {
    setEditId(r.id)
    setNewModuleKey(r.moduleKey)
    setPrefix(r.prefix)
    setUsesFinancialYear(r.usesFinancialYear)
    setFormError(null)
  }

  const cancelEdit = () => {
    setEditId(null)
    setNewModuleKey('')
    setPrefix('')
    setUsesFinancialYear(true)
    setFormError(null)
  }

  const save = () => {
    const trimmedPrefix = prefix.trim()
    if (!trimmedPrefix) {
      setFormError('Prefix is required.')
      return
    }
    if (!editId && !newModuleKey) {
      setFormError('Module is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const req = editId
      ? staffApi.put(`/api/doc-prefix-master/${editId}`, { prefix: trimmedPrefix, usesFinancialYear, isActive: true })
      : staffApi.post('/api/doc-prefix-master', { moduleKey: newModuleKey, prefix: trimmedPrefix, usesFinancialYear })
    req
      .then(() => {
        cancelEdit()
        load()
      })
      .catch((err) => setFormError(err?.response?.data?.message ?? 'Could not save this row.'))
      .finally(() => setSaving(false))
  }

  const toggleActive = (r: PrefixRow) => {
    if (r.isActive) {
      staffApi.delete(`/api/doc-prefix-master/${r.id}`).then(load).catch((err) => setError(err?.response?.data?.message ?? 'Could not deactivate this row.'))
    } else {
      staffApi
        .put(`/api/doc-prefix-master/${r.id}`, { prefix: r.prefix, usesFinancialYear: r.usesFinancialYear, isActive: true })
        .then(load)
        .catch((err) => setError(err?.response?.data?.message ?? 'Could not reactivate this row.'))
    }
  }

  const visibleRows = rows
    .filter((r) => showInactive || r.isActive)
    .filter((r) => !moduleFilter || r.moduleKey === moduleFilter)
    .filter((r) => {
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return moduleLabel(r.moduleKey).toLowerCase().includes(q) || r.moduleKey.toLowerCase().includes(q) || r.prefix.toLowerCase().includes(q)
    })

  // Modules that don't already have a prefix row - only these are offered on "Add new module" so
  // you can't accidentally try to create a second row for the same page (the backend's unique
  // index on ModuleKey would reject it anyway, but this avoids the round-trip).
  const usedModuleKeys = new Set(rows.map((r) => r.moduleKey))
  const availableModuleOptions = MODULE_OPTIONS.filter((m) => !usedModuleKeys.has(m.key))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
        <div>
          <h2 style={PAGE_TITLE_STYLE}>Prefix Master</h2>
          <p style={PAGE_SUBTITLE_STYLE}>Document-numbering prefixes, by sidebar page.</p>
        </div>
        <label style={TOGGLE_LABEL_STYLE}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show deactivated rows too
        </label>
      </div>
      <p className="muted" style={{ color: '#92400e', marginBottom: 16 }}>
        Note: this is not yet wired to your real Job Card / Material Transfer / Repair Bill numbers - see this
        page's own doc comment for why.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={SECTION_TITLE_STYLE}>{editId ? 'Edit prefix' : 'Add new module'}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            <div className="muted">Module</div>
            {editId ? (
              <input style={{ width: 220 }} value={moduleLabel(newModuleKey)} disabled />
            ) : (
              <select style={{ width: 220 }} value={newModuleKey} onChange={(e) => setNewModuleKey(e.target.value)}>
                <option value="">Select a page…</option>
                {availableModuleOptions.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            )}
          </label>
          <label>
            <div className="muted">Prefix</div>
            <input style={{ width: 140 }} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. JC, or RB/hgh" />
          </label>
          <label>
            <div className="muted">Financial Year</div>
            <select value={usesFinancialYear ? 'yes' : 'none'} onChange={(e) => setUsesFinancialYear(e.target.value === 'yes')}>
              <option value="yes">Uses Financial Year</option>
              <option value="none">None</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : editId ? 'Save changes' : 'Add row'}
          </button>
          {editId && (
            <button className="btn" disabled={saving} onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
        {editId && <p className="muted">Module cannot be changed once created - deactivate this row and add a new one instead.</p>}
        {!editId && availableModuleOptions.length === 0 && (
          <p className="muted">Every sidebar page already has a Prefix Master row - deactivate one below to free it up, or edit it in place.</p>
        )}
        {formError && <p className="error-text">{formError}</p>}
      </div>

      {/* SECTION 174 - search + dropdown filter, see class-level SECTION 174 comment above. */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search Module / Prefix…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
          <option value="">All Modules</option>
          {MODULE_OPTIONS.filter((m) => usedModuleKeys.has(m.key)).map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        {(search || moduleFilter) && (
          <button type="button" className="btn btn-sm" onClick={() => { setSearch(''); setModuleFilter('') }}>
            Clear filters
          </button>
        )}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && (
        <div className="card" style={{ padding: 0, marginBottom: 16 }}>
          {visibleRows.length === 0 ? (
            <p className="muted" style={{ padding: 16 }}>
              {rows.length === 0 ? 'No rows yet - add one above.' : 'No rows match your search/filter.'}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={TH_STYLE}>Module</th>
                  <th style={TH_STYLE}>Prefix</th>
                  <th style={TH_STYLE}>Financial Year</th>
                  <th style={TH_STYLE}>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id} style={r.isActive ? undefined : { opacity: 0.5 }}>
                    <td>{moduleLabel(r.moduleKey)}</td>
                    <td>{r.prefix}</td>
                    <td>{r.usesFinancialYear ? 'Yes' : 'None'}</td>
                    <td>{r.isActive ? 'Active' : 'Deactivated'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn" onClick={() => startEdit(r)}>Edit</button>{' '}
                      <button className="btn" onClick={() => toggleActive(r)}>{r.isActive ? 'Deactivate' : 'Reactivate'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="card">
        <h3 style={SECTION_TITLE_STYLE}>Preview next number</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label>
            <div className="muted">Module</div>
            <select value={previewModuleKey} onChange={(e) => setPreviewModuleKey(e.target.value)}>
              <option value="">Select a module…</option>
              {MODULE_OPTIONS.filter((m) => usedModuleKeys.has(m.key)).map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </label>
          {/* SECTION 184: hidden entirely for a "No Financial Year" module instead of showing a
             box whose value would just be ignored - matches how Preview() itself now treats it. */}
          {previewRow?.usesFinancialYear !== false && (
            <label>
              <div className="muted">Financial Year</div>
              <input value={financialYear} onChange={(e) => setFinancialYear(e.target.value)} placeholder="26-25" />
            </label>
          )}
          <button className="btn btn-primary" disabled={previewing || !previewModuleKey} onClick={runPreview}>
            {previewing ? 'Checking…' : 'Preview'}
          </button>
        </div>
        {preview && <p style={{ marginTop: 12, fontSize: 18, fontWeight: 700 }}>{preview}</p>}
        {previewError && <p className="error-text">{previewError}</p>}
      </div>
    </div>
  )
}
