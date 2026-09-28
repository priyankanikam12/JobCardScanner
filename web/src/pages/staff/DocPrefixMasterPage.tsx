import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { staffApi } from '../../api/client'

/**
 * SECTION 165 (2026-09-30) + SECTION 166 (2026-09-30) "for this 3 master create edit delete
 * access ?" - JC / MT / RB document-numbering prefixes, plus the non-destructive "preview next
 * number" tool. Now a full add / edit / deactivate page backed by
 * POST/PUT/DELETE /api/doc-prefix-master (see DocPrefixMasterController.cs's class doc comment -
 * gated to CorporateAdmin/SystemAdmin only, narrower than the other two masters). DocType is only
 * set when a row is first created - it's not editable afterwards (see that controller's doc
 * comment for why).
 *
 * IMPORTANT, carried over from SECTION 163's own README note: this table/page does NOT yet drive
 * your REAL Job Card / Material Transfer / Repair Bill numbers - those still come from the
 * existing JobCardNumberingService, which is not in this session. Preview below only shows what a
 * number WOULD look like using this new, separate table - it does not reserve or consume anything.
 */
interface PrefixRow {
  id: string
  docType: string
  prefix: string
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

// SECTION 174 (2026-09-30) "...in all master search and dropdown filter add" - added a search box
// (matches Doc Type/Prefix text) and a "Doc Type" dropdown filter, reusing the same fixed JC/MT/RB
// option list the "Preview next number" panel below already uses, rather than inventing a second
// list from whatever happens to be in `rows` right now - Doc Type is a closed, fixed vocabulary
// here (see DocPrefixMasterController.cs), not an open-ended field like Job Type on
// ServiceMenuMasterPage.tsx.
const DOC_TYPE_OPTIONS = ['JC', 'MT', 'RB']

export function DocPrefixMasterPage() {
  const [rows, setRows] = useState<PrefixRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('') // SECTION 174
  const [docTypeFilter, setDocTypeFilter] = useState('') // SECTION 174 - '' = All Doc Types

  const [editId, setEditId] = useState<string | null>(null)
  const [newDocType, setNewDocType] = useState('')
  const [prefix, setPrefix] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [docType, setDocType] = useState('JC')
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

  const runPreview = () => {
    setPreviewing(true)
    setPreviewError(null)
    setPreview(null)
    staffApi
      .get<{ nextNumber: string }>('/api/doc-prefix-master/preview', { params: { docType, financialYear } })
      .then((res) => setPreview(res.data.nextNumber))
      .catch((err) => setPreviewError(err?.response?.data?.message ?? 'Could not compute a preview.'))
      .finally(() => setPreviewing(false))
  }

  const startEdit = (r: PrefixRow) => {
    setEditId(r.id)
    setNewDocType(r.docType)
    setPrefix(r.prefix)
    setFormError(null)
  }

  const cancelEdit = () => {
    setEditId(null)
    setNewDocType('')
    setPrefix('')
    setFormError(null)
  }

  const save = () => {
    const trimmedPrefix = prefix.trim()
    if (!trimmedPrefix) {
      setFormError('Prefix is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const req = editId
      ? staffApi.put(`/api/doc-prefix-master/${editId}`, { prefix: trimmedPrefix, isActive: true })
      : staffApi.post('/api/doc-prefix-master', { docType: newDocType.trim(), prefix: trimmedPrefix })
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
        .put(`/api/doc-prefix-master/${r.id}`, { prefix: r.prefix, isActive: true })
        .then(load)
        .catch((err) => setError(err?.response?.data?.message ?? 'Could not reactivate this row.'))
    }
  }

  const visibleRows = rows
    .filter((r) => showInactive || r.isActive)
    .filter((r) => !docTypeFilter || r.docType === docTypeFilter)
    .filter((r) => {
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return r.docType.toLowerCase().includes(q) || r.prefix.toLowerCase().includes(q)
    })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
        <div>
          <h2 style={PAGE_TITLE_STYLE}>Prefix Master</h2>
          <p style={PAGE_SUBTITLE_STYLE}>JC / MT / RB document-numbering prefixes.</p>
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
        <h3 style={SECTION_TITLE_STYLE}>{editId ? 'Edit prefix' : 'Add new doc type'}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            <div className="muted">Doc Type</div>
            <input
              style={{ width: 90 }}
              value={editId ? newDocType : newDocType}
              onChange={(e) => setNewDocType(e.target.value)}
              disabled={!!editId}
              placeholder="JC"
            />
          </label>
          <label>
            <div className="muted">Prefix</div>
            <input style={{ width: 120 }} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="JC" />
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
        {editId && <p className="muted">Doc Type cannot be changed once created - deactivate this row and add a new one instead.</p>}
        {formError && <p className="error-text">{formError}</p>}
      </div>

      {/* SECTION 174 - search + dropdown filter, see class-level SECTION 174 comment above. */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search Doc Type / Prefix…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)}>
          <option value="">All Doc Types</option>
          {DOC_TYPE_OPTIONS.map((dt) => (
            <option key={dt} value={dt}>{dt}</option>
          ))}
        </select>
        {(search || docTypeFilter) && (
          <button type="button" className="btn btn-sm" onClick={() => { setSearch(''); setDocTypeFilter('') }}>
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
                  <th style={TH_STYLE}>Doc Type</th>
                  <th style={TH_STYLE}>Prefix</th>
                  <th style={TH_STYLE}>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id} style={r.isActive ? undefined : { opacity: 0.5 }}>
                    <td>{r.docType}</td>
                    <td>{r.prefix}</td>
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
            <div className="muted">Doc Type</div>
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="JC">JC</option>
              <option value="MT">MT</option>
              <option value="RB">RB</option>
            </select>
          </label>
          <label>
            <div className="muted">Financial Year</div>
            <input value={financialYear} onChange={(e) => setFinancialYear(e.target.value)} placeholder="26-25" />
          </label>
          <button className="btn btn-primary" disabled={previewing} onClick={runPreview}>
            {previewing ? 'Checking…' : 'Preview'}
          </button>
        </div>
        {preview && <p style={{ marginTop: 12, fontSize: 18, fontWeight: 700 }}>{preview}</p>}
        {previewError && <p className="error-text">{previewError}</p>}
      </div>
    </div>
  )
}
