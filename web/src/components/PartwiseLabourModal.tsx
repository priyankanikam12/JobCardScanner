import { useEffect, useState } from 'react'
import { staffApi } from '../api/client'
import type { LabourMasterPartwise } from '../types'

/**
 * "Labour" picker for Material Transfer (2026-09-22: "which Rate Type * is Partwise from this we
 * upload FOR Part Code add Labour Code also that was wants to integrate in material transfer
 * which in video"). Modelled directly on the "Labour List" popup confirmed by watching the
 * mt-labour_add.mp4 recording of the real BGauss DMS (mydmsconnect.com/MtrlTranN.aspx):
 *   - A "Labour" button sits next to a Material Transfer line's own Item Code/Issue Type fields.
 *     Clicking it opens this popup, titled "Part wise Labour Detail (@Item Name <PartCode> -
 *     <PartName>)" in the reference - scoped to that ONE part, not a general labour search.
 *   - The popup's own picker queries Labour Master Partwise by that EXACT Part Code (confirmed:
 *     the reference's own screenshot showed one Part Code mapped to several Labour Codes, one per
 *     service milestone - e.g. "1st Free Service"/"4th Free Service" - and the popup let you add
 *     more than one before proceeding). Matched exactly (not fuzzy/Model-filtered) - the
 *     AskUserQuestion answer for this feature was "Part Code only (Recommended - matches the
 *     video exactly)", since Labour Master Partwise's own Model field is free text with no link to
 *     any master data, same as the linked Job's own free-text Vehicle Model - an exact-Part-Code-
 *     only match can't silently hide a valid row over a wording mismatch the way a Model filter
 *     could.
 *   - Each picked Labour Code stages into a small list (Sr.No/Labour Code/Description/Rate/GST%)
 *     before a "Proceed" commits them - mirrors the reference's own Add-then-Proceed flow rather
 *     than adding straight into the parent grid on first pick, so more than one Labour Code can be
 *     queued for the same part in one pass.
 *
 * NOT replicated, disclosed rather than silently dropped: the reference's own popup also has a
 * "Labour Technician" dropdown per row (defaulting to the document's own header Technician).
 * MaterialTransferCreatePage.tsx's own doc comment already discloses that a ServiceAdvisor-level
 * login (this page's own role floor) has no accessible technician-catalog endpoint to pick from
 * (GET /api/users needs DealerAdminUp) - the header's own Technician field is left unset from this
 * quick-entry form for the exact same reason, so this popup doesn't invent a picker the page
 * itself doesn't have either. The backend column (MaterialTransferDocItem.TechnicianId) exists and
 * is always sent as null until that gap has its own real fix.
 *
 * Rate/GST are taken directly off the picked LabourMasterPartwise row - GST-EXCLUSIVE, same
 * convention RepairBillCreatePage.tsx's own pickLabourForDraft already uses for a Labour Master
 * row ("a labour rate card's own GST-exclusive rate, unlike a Part's tax-inclusive MRP/Dealer
 * Price") - never reverse-calculated the way a Part's Rate is from its tax-inclusive Dealer Price.
 */
export type PartwiseLabourPick = LabourMasterPartwise

type Props = {
  partCode: string
  partName: string
  onClose: () => void
  onProceed: (picks: PartwiseLabourPick[]) => void
}

export function PartwiseLabourModal({ partCode, partName, onClose, onProceed }: Props) {
  const [options, setOptions] = useState<LabourMasterPartwise[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 2026-09-23 ("proper labour serach opended tab Add button fix"): the plain <select> Labour Code
  // picker below is now a type-ahead search input, matching this app's own established combobox
  // pattern (PartSearchInput.tsx) rather than a long, hard-to-scan dropdown list. `search` is the
  // free-typed text shown in the box; `selectedCode` only gets set once an actual row from the
  // dropdown is clicked - +Add stays disabled until then, same gate the old <select> had (an empty
  // value couldn't be added either). No portal here (unlike PartSearchInput) - this modal's own
  // card isn't inside an `overflow-x: auto` clipping ancestor, so a plain absolutely-positioned
  // dropdown within the field itself is enough (see PartSearchInput.tsx's doc comment for why THAT
  // component needs one).
  const [search, setSearch] = useState('')
  const [selectedCode, setSelectedCode] = useState('')
  const [open, setOpen] = useState(false)
  const [staged, setStaged] = useState<PartwiseLabourPick[]>([])

  useEffect(() => {
    setLoading(true)
    setError(null)
    staffApi
      .get<LabourMasterPartwise[]>(`/api/material-transfer-docs/labour-by-part-code/${encodeURIComponent(partCode)}`)
      .then(({ data }) => setOptions(data))
      .catch((err) => setError(err?.response?.data?.message ?? 'Could not load Labour Master Partwise rates for this part.'))
      .finally(() => setLoading(false))
  }, [partCode])

  const available = options.filter((o) => !staged.some((s) => s.labourCode === o.labourCode))
  const q = search.trim().toLowerCase()
  const matches = q.length === 0
    ? available
    : available.filter((o) => o.labourCode.toLowerCase().includes(q) || (o.jobDescription ?? '').toLowerCase().includes(q))

  const pickOption = (row: LabourMasterPartwise) => {
    setSelectedCode(row.labourCode)
    setSearch(`${row.labourCode} — ${row.jobDescription ?? 'no description'}`)
    setOpen(false)
  }

  const addStaged = () => {
    const row = options.find((o) => o.labourCode === selectedCode)
    if (!row || staged.some((s) => s.labourCode === row.labourCode)) return
    setStaged((prev) => [...prev, row])
    setSelectedCode('')
    setSearch('')
  }
  const removeStaged = (labourCode: string) => setStaged((prev) => prev.filter((s) => s.labourCode !== labourCode))
  const fmtPct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 760, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Labour List</h3>
          <button className="btn btn-icon" type="button" onClick={onClose} title="Close">✕</button>
        </div>
        <p className="muted" style={{ margin: '4px 0 12px' }}>
          Part wise Labour Detail (@Item Name {partCode} - {partName})
        </p>

        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error-text">{error}</p>}

        {!loading && !error && (
          <>
            <div className="form-row">
              <div className="field" style={{ flex: '1 1 320px', position: 'relative' }}>
                <label>Labour Code</label>
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setSelectedCode(''); setOpen(true) }}
                  onFocus={() => setOpen(true)}
                  onBlur={() => setTimeout(() => setOpen(false), 150)}
                  placeholder={options.length === 0 ? 'No Partwise labour rates found for this part' : 'Search labour code or description…'}
                  disabled={options.length === 0}
                  autoComplete="off"
                />
                {open && options.length > 0 && (
                  matches.length > 0 ? (
                    <ul style={{
                      position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 2,
                      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                      maxHeight: 220, overflowY: 'auto', listStyle: 'none', padding: 4, boxShadow: 'var(--shadow-lg)',
                    }}>
                      {matches.map((o) => (
                        <li key={o.id}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '6px 8px' }}
                            onMouseDown={(e) => { e.preventDefault(); pickOption(o) }}
                          >
                            <strong>{o.labourCode}</strong> — {o.jobDescription ?? 'no description'}
                            {o.labourRate != null && <span className="muted"> (₹{o.labourRate.toFixed(2)})</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{
                      position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 2,
                      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                      padding: '8px 10px', boxShadow: 'var(--shadow-lg)',
                    }}>
                      <span className="muted" style={{ fontSize: 13 }}>No match for "{search.trim()}".</span>
                    </div>
                  )
                )}
              </div>
              <div className="field" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-primary btn-sm" type="button" onClick={addStaged} disabled={!selectedCode}>+ Add</button>
              </div>
            </div>

            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>Sr.No</th>
                    <th>Labour Code</th>
                    <th>Description</th>
                    <th className="text-end">Rate</th>
                    <th>IGST</th>
                    <th>CGST</th>
                    <th>SGST</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {staged.map((s, i) => (
                    <tr key={s.labourCode}>
                      <td>{i + 1}</td>
                      <td>{s.labourCode}</td>
                      <td>{s.jobDescription ?? '—'}</td>
                      <td className="text-end">{s.labourRate != null ? `₹${s.labourRate.toFixed(2)}` : '—'}</td>
                      <td>{fmtPct(s.igst)}</td>
                      <td>{fmtPct(s.cgst)}</td>
                      <td>{fmtPct(s.sgst)}</td>
                      <td><button className="btn btn-icon btn-danger" type="button" onClick={() => removeStaged(s.labourCode)} title="Remove">✕</button></td>
                    </tr>
                  ))}
                  {staged.length === 0 && (
                    <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 12 }}>No Labour codes added yet - pick one above and click + Add.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button className="btn btn-sm" type="button" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" type="button" disabled={staged.length === 0} onClick={() => onProceed(staged)}>Proceed →</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
