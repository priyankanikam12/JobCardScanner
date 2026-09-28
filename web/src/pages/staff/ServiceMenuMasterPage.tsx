import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { staffApi } from '../../api/client'

/**
 * SECTION 163 (2026-09-30) + SECTION 166 (2026-09-30) "for this 3 master create edit delete
 * access ?" - Job Type -> Service Head -> Priority, the dependency the Job Card Wizard reads for
 * its dropdowns. Now a full add / edit / deactivate page backed by
 * POST/PUT/DELETE /api/service-menu-master (see ServiceMenuMasterController.cs's class doc
 * comment for the exact role gating and the "EDIT SCOPE NOTE" - editing one row's Job Type/Service
 * Head name does NOT rename it on other rows that share the same id).
 *
 * "Delete" here deactivates the row (IsActive=false) rather than a hard SQL delete - it disappears
 * from the Job Card Wizard immediately, but stays visible on this page (greyed out, filterable) so
 * it can be reactivated with one click instead of being gone for good.
 */
interface Row {
  id: string
  jobTypeId: number
  jobTypeName: string
  serviceHeadId: number
  serviceHeadName: string
  priorityValue: string
  priorityLabel: string
  sortOrder: number
  isActive: boolean
}

const emptyForm = {
  id: null as string | null,
  jobTypeId: '',
  jobTypeName: '',
  serviceHeadId: '',
  serviceHeadName: '',
  priorityValue: '',
  priorityLabel: '',
  sortOrder: '0',
}

/**
 * SECTION 172 (2026-09-30) "UI also fix in middle of page shown 'Show deactivated rows too' that
 * was shown side and all pages font change attractive" - two purely cosmetic changes (no data or
 * behavior change): (1) the "Show deactivated rows too" checkbox used to sit alone on its own line
 * above the table, reading as if it floated in the middle of the page - it now sits to the RIGHT
 * ("side"), on the same row as the page title. (2) a shared set of typography styles (title /
 * subtitle / section heading / table header) applied across this page and its two siblings
 * (ComplaintMasterPage.tsx, DocPrefixMasterPage.tsx). ASSUMPTION, flagged: "all pages" is read here
 * as these 3 master pages specifically, since that's what you'd just pasted back to me in this
 * same message - not literally every page in the app. I don't have your global.css in this
 * session, so a true site-wide font change would risk clashing with rules I can't see; tell me if
 * you meant the whole app and I'll take a different, global.css-based approach instead.
 *
 * SECTION 174 (2026-09-30) "...in all master search and dropdown filter add" - added a search box
 * (matches Job Type/Service Head/Priority text, same as LabourMasterPage.tsx's own search box) and
 * a "Job Type" dropdown filter (options built from whatever Job Type names are actually present in
 * `rows` right now, so it never lists a stale/removed Job Type and needs no separate master list).
 * Both are client-side filters over the already-loaded `rows` - this page never had server-side
 * paging/search to begin with (admin-list returns everything), so there's no new endpoint call
 * here, just a new `visibleRows` computation. Combines with the existing "Show deactivated rows
 * too" toggle (all three conditions AND together).
 */
const PAGE_TITLE_STYLE: CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: '#111827', margin: 0 }
const PAGE_SUBTITLE_STYLE: CSSProperties = { fontSize: 14, color: '#6b7280', margin: '4px 0 0' }
const SECTION_TITLE_STYLE: CSSProperties = { fontSize: 16, fontWeight: 600, color: '#111827', letterSpacing: '-0.005em', marginTop: 0 }
const TH_STYLE: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', textAlign: 'left' }
const TOGGLE_LABEL_STYLE: CSSProperties = {
  display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 500,
  color: '#374151', background: '#f3f4f6', padding: '6px 12px', borderRadius: 20, whiteSpace: 'nowrap',
}

export function ServiceMenuMasterPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('') // SECTION 174
  const [jobTypeFilter, setJobTypeFilter] = useState('') // SECTION 174 - '' = All Job Types

  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    staffApi
      .get<Row[]>('/api/service-menu-master/admin-list')
      .then((res) => setRows(res.data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load Service Menu Master data.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const startEdit = (r: Row) => {
    setForm({
      id: r.id,
      jobTypeId: String(r.jobTypeId),
      jobTypeName: r.jobTypeName,
      serviceHeadId: String(r.serviceHeadId),
      serviceHeadName: r.serviceHeadName,
      priorityValue: r.priorityValue,
      priorityLabel: r.priorityLabel,
      sortOrder: String(r.sortOrder),
    })
    setFormError(null)
  }

  const cancelEdit = () => {
    setForm(emptyForm)
    setFormError(null)
  }

  const save = () => {
    const body = {
      jobTypeId: Number(form.jobTypeId),
      jobTypeName: form.jobTypeName.trim(),
      serviceHeadId: Number(form.serviceHeadId),
      serviceHeadName: form.serviceHeadName.trim(),
      priorityValue: form.priorityValue.trim(),
      priorityLabel: form.priorityLabel.trim(),
      sortOrder: Number(form.sortOrder) || 0,
    }
    if (!body.jobTypeName || !body.serviceHeadName || !body.priorityValue || !body.priorityLabel || !form.jobTypeId || !form.serviceHeadId) {
      setFormError('Job Type Id/Name, Service Head Id/Name and both Priority fields are all required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const req = form.id
      ? staffApi.put(`/api/service-menu-master/${form.id}`, { ...body, isActive: true })
      : staffApi.post('/api/service-menu-master', body)
    req
      .then(() => {
        cancelEdit()
        load()
      })
      .catch((err) => setFormError(err?.response?.data?.message ?? 'Could not save this row.'))
      .finally(() => setSaving(false))
  }

  const toggleActive = (r: Row) => {
    if (r.isActive) {
      staffApi.delete(`/api/service-menu-master/${r.id}`).then(load).catch((err) => setError(err?.response?.data?.message ?? 'Could not deactivate this row.'))
    } else {
      staffApi
        .put(`/api/service-menu-master/${r.id}`, {
          jobTypeId: r.jobTypeId,
          jobTypeName: r.jobTypeName,
          serviceHeadId: r.serviceHeadId,
          serviceHeadName: r.serviceHeadName,
          priorityValue: r.priorityValue,
          priorityLabel: r.priorityLabel,
          sortOrder: r.sortOrder,
          isActive: true,
        })
        .then(load)
        .catch((err) => setError(err?.response?.data?.message ?? 'Could not reactivate this row.'))
    }
  }

  // SECTION 174 - distinct Job Type names present in the loaded data, for the dropdown filter's
  // option list. Sorted so the dropdown is stable/scannable, not insertion-order.
  const jobTypeOptions = Array.from(new Set(rows.map((r) => r.jobTypeName))).sort((a, b) => a.localeCompare(b))

  const visibleRows = rows
    .filter((r) => showInactive || r.isActive)
    .filter((r) => !jobTypeFilter || r.jobTypeName === jobTypeFilter)
    .filter((r) => {
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return (
        r.jobTypeName.toLowerCase().includes(q) ||
        r.serviceHeadName.toLowerCase().includes(q) ||
        r.priorityLabel.toLowerCase().includes(q)
      )
    })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={PAGE_TITLE_STYLE}>Service Menu Master</h2>
          <p style={PAGE_SUBTITLE_STYLE}>
            Job Type → Service Head → Priority - the dependency the Job Card Wizard reads for its dropdowns.
          </p>
        </div>
        <label style={TOGGLE_LABEL_STYLE}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show deactivated rows too
        </label>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={SECTION_TITLE_STYLE}>{form.id ? 'Edit row' : 'Add new row'}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            <div className="muted">Job Type Id</div>
            <input style={{ width: 90 }} value={form.jobTypeId} onChange={(e) => setForm({ ...form, jobTypeId: e.target.value })} />
          </label>
          <label>
            <div className="muted">Job Type Name</div>
            <input value={form.jobTypeName} onChange={(e) => setForm({ ...form, jobTypeName: e.target.value })} placeholder="e.g. Running Repair" />
          </label>
          <label>
            <div className="muted">Service Head Id</div>
            <input style={{ width: 90 }} value={form.serviceHeadId} onChange={(e) => setForm({ ...form, serviceHeadId: e.target.value })} />
          </label>
          <label>
            <div className="muted">Service Head Name</div>
            <input value={form.serviceHeadName} onChange={(e) => setForm({ ...form, serviceHeadName: e.target.value })} placeholder="e.g. General Service" />
          </label>
          <label>
            <div className="muted">Priority Value</div>
            <input style={{ width: 90 }} value={form.priorityValue} onChange={(e) => setForm({ ...form, priorityValue: e.target.value })} placeholder="1" />
          </label>
          <label>
            <div className="muted">Priority Label</div>
            <input value={form.priorityLabel} onChange={(e) => setForm({ ...form, priorityLabel: e.target.value })} placeholder="Normal" />
          </label>
          <label>
            <div className="muted">Sort Order</div>
            <input style={{ width: 70 }} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          </label>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add row'}
          </button>
          {form.id && (
            <button className="btn" disabled={saving} onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
        {formError && <p className="error-text">{formError}</p>}
      </div>

      {/* SECTION 174 - search + dropdown filter, see class doc comment above. */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search Job Type / Service Head / Priority…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <select value={jobTypeFilter} onChange={(e) => setJobTypeFilter(e.target.value)}>
          <option value="">All Job Types</option>
          {jobTypeOptions.map((jt) => (
            <option key={jt} value={jt}>{jt}</option>
          ))}
        </select>
        {(search || jobTypeFilter) && (
          <button type="button" className="btn btn-sm" onClick={() => { setSearch(''); setJobTypeFilter('') }}>
            Clear filters
          </button>
        )}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && (
        <div className="card" style={{ padding: 0 }}>
          {visibleRows.length === 0 ? (
            <p className="muted" style={{ padding: 16 }}>
              {rows.length === 0 ? 'No rows yet - add one above.' : 'No rows match your search/filter.'}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={TH_STYLE}>Job Type</th>
                  <th style={TH_STYLE}>Service Head</th>
                  <th style={TH_STYLE}>Priority</th>
                  <th style={TH_STYLE}>Sort Order</th>
                  <th style={TH_STYLE}>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id} style={r.isActive ? undefined : { opacity: 0.5 }}>
                    <td>{r.jobTypeName} <span className="muted">(#{r.jobTypeId})</span></td>
                    <td>{r.serviceHeadName} <span className="muted">(#{r.serviceHeadId})</span></td>
                    <td>{r.priorityLabel} <span className="muted">({r.priorityValue})</span></td>
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
