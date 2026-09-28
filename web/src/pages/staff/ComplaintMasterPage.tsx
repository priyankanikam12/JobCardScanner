import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { staffApi } from '../../api/client'

/**
 * SECTION 163 (2026-09-30) + SECTION 166 (2026-09-30) "for this 3 master create edit delete
 * access ?" - the shared global complaint list (no DealerId - one list, every dealer) the Job
 * Card Wizard picks from. Now a full add / edit / deactivate page backed by
 * POST/PUT/DELETE /api/complaint-master (see ComplaintMasterController.cs's class doc comment for
 * role gating). "Delete" deactivates (IsActive=false) rather than hard-deleting - reversible via
 * the Reactivate button.
 */
interface Row {
  id: string
  complaintText: string
  sortOrder: number
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
// (matches Complaint Text, same idea as LabourMasterPage.tsx's own search box). NO dropdown filter
// was added here, unlike ServiceMenuMasterPage.tsx/DocPrefixMasterPage.tsx - this row shape has
// only Complaint Text/Sort Order/Active, and Active/Inactive is already the existing "Show
// deactivated rows too" toggle just below; there's no other categorical field to build a dropdown
// from. Tell me if you want one anyway (e.g. grouped by a Category field this table doesn't have
// yet) and I'll add the column plus the filter together.

export function ComplaintMasterPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('') // SECTION 174

  const [editId, setEditId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    staffApi
      .get<Row[]>('/api/complaint-master/admin-list')
      .then((res) => setRows(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load Complaint Master data.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const startEdit = (r: Row) => {
    setEditId(r.id)
    setText(r.complaintText)
    setSortOrder(String(r.sortOrder))
    setFormError(null)
  }

  const cancelEdit = () => {
    setEditId(null)
    setText('')
    setSortOrder('0')
    setFormError(null)
  }

  const save = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setFormError('Complaint text is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const body = { complaintText: trimmed, sortOrder: Number(sortOrder) || 0 }
    const req = editId ? staffApi.put(`/api/complaint-master/${editId}`, { ...body, isActive: true }) : staffApi.post('/api/complaint-master', body)
    req
      .then(() => {
        cancelEdit()
        load()
      })
      .catch((err) => setFormError(err?.response?.data?.message ?? 'Could not save this complaint.'))
      .finally(() => setSaving(false))
  }

  const toggleActive = (r: Row) => {
    if (r.isActive) {
      staffApi.delete(`/api/complaint-master/${r.id}`).then(load).catch((err) => setError(err?.response?.data?.message ?? 'Could not deactivate this complaint.'))
    } else {
      staffApi
        .put(`/api/complaint-master/${r.id}`, { complaintText: r.complaintText, sortOrder: r.sortOrder, isActive: true })
        .then(load)
        .catch((err) => setError(err?.response?.data?.message ?? 'Could not reactivate this complaint.'))
    }
  }

  const visibleRows = rows
    .filter((r) => showInactive || r.isActive)
    .filter((r) => !search.trim() || r.complaintText.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={PAGE_TITLE_STYLE}>Complaint Master</h2>
          <p style={PAGE_SUBTITLE_STYLE}>The shared global complaint list the Job Card Wizard picks from.</p>
        </div>
        <label style={TOGGLE_LABEL_STYLE}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show deactivated rows too
        </label>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={SECTION_TITLE_STYLE}>{editId ? 'Edit complaint' : 'Add new complaint'}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: 1, minWidth: 240 }}>
            <div className="muted">Complaint Text</div>
            <input style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Battery not charging" />
          </label>
          <label>
            <div className="muted">Sort Order</div>
            <input style={{ width: 70 }} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : editId ? 'Save changes' : 'Add complaint'}
          </button>
          {editId && (
            <button className="btn" disabled={saving} onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
        {formError && <p className="error-text">{formError}</p>}
      </div>

      {/* SECTION 174 - search box, see class-level SECTION 174 comment above for why there's no
         dropdown filter on this particular page. */}
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search Complaint Text…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && (
        <div className="card" style={{ padding: 0 }}>
          {visibleRows.length === 0 ? (
            <p className="muted" style={{ padding: 16 }}>
              {rows.length === 0 ? 'No complaints yet - add one above.' : 'No complaints match your search.'}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={TH_STYLE}>Complaint</th>
                  <th style={TH_STYLE}>Sort Order</th>
                  <th style={TH_STYLE}>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id} style={r.isActive ? undefined : { opacity: 0.5 }}>
                    <td>{r.complaintText}</td>
                    <td>{r.sortOrder}</td>
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
    </div>
  )
}
