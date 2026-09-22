import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BaplDmsLabourRow } from '../types'

/**
 * "Labour Code (Rate)" type-ahead combobox (2026-09-21: "when labor type select then Labour Code
 * suggestion shown and when part selete then part") - a near-duplicate of PartSearchInput.tsx, for
 * the same reason that component exists rather than a shared generic one: the two backing lists
 * (BaplDmsPartStock vs BaplDmsLabourRow) have different shapes/fields, and duplicating this small,
 * self-contained combobox is simpler and safer than a generic version that has to abstract both.
 *
 * FACT this closes: RepairBillCreatePage.tsx's item grid has always had a Part/Labour "Type"
 * dropdown per line, but until now BOTH types shared the exact same PartSearchInput/`parts` list -
 * picking "Labour" never actually searched DMS's own Labour Master (LabourMaster/
 * PartWiseLabourMaster, via GET /api/bapl-dms/labour) the way the reference app's own Labour
 * Suggestion panel already does elsewhere in this codebase (JobCardDetailPage.tsx). This component
 * is that missing search, reused here.
 */
type Props = {
  labours: BaplDmsLabourRow[]
  locationSelected: boolean
  value: string
  onChangeText: (text: string) => void
  onPick: (labour: BaplDmsLabourRow) => void
  placeholder?: string
  width?: number
}

export function LabourSearchInput({ labours, locationSelected, value, onChangeText, onPick, placeholder, width }: Props) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const q = value.trim().toLowerCase()
  // 2026-09-22 ("in labour only labour code need to shown in dropdown and its shown duplicate that
  // also fix"): the backing `labours` list can carry more than one row for the exact same
  // labourCode/labourDescription/labourRate/source combination (e.g. the same LabourMaster row
  // surfaced once per Location or per OEM Model it applies to, upstream in GET /api/bapl-dms/labour)
  // - those are true duplicates, shown here with nothing to actually distinguish them, so they're
  // collapsed to one entry each via this key. Rows sharing a labourCode but a genuinely different
  // labourRate are NOT collapsed - that's a real difference (a different applicable rate for the
  // same code) and picking the wrong one would silently bill at the wrong rate, so the rate stays
  // visible in the list precisely so a dealer can tell those apart even with the description gone.
  const seen = new Set<string>()
  const matches = q.length === 0 ? [] : labours
    .filter((l) => l.labourCode.toLowerCase().includes(q) || (l.labourDescription ?? '').toLowerCase().includes(q))
    .filter((l) => {
      const dedupeKey = `${l.labourCode.toLowerCase()}|${l.labourRate ?? ''}|${l.source ?? ''}`
      if (seen.has(dedupeKey)) return false
      seen.add(dedupeKey)
      return true
    })
    .slice(0, 20)

  const reposition = () => {
    const r = inputRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 280) })
  }

  useEffect(() => {
    if (!open) return
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const showDropdown = open && locationSelected && q.length > 0 && pos !== null

  return (
    <div style={{ position: 'relative', width: width ?? '100%' }}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder ?? (locationSelected ? 'Search labour code or description…' : 'Select a Location first')}
        disabled={!locationSelected}
        onChange={(e) => { onChangeText(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        style={{ width: '100%' }}
      />
      {showDropdown && createPortal(
        matches.length > 0 ? (
          <ul style={{
            position: 'fixed', zIndex: 1000, top: pos.top, left: pos.left, minWidth: pos.width,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            maxHeight: 220, overflowY: 'auto', listStyle: 'none', padding: 4, boxShadow: 'var(--shadow-lg)', margin: 0,
          }}>
            {matches.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '6px 8px' }}
                  onMouseDown={(e) => { e.preventDefault(); onPick(l); setOpen(false) }}
                  title={l.labourDescription || undefined}
                >
                  <strong>{l.labourCode}</strong>{' '}
                  <span className="muted">({l.labourRate != null ? `₹${l.labourRate}` : 'no rate'})</span>
                  {l.source === 'PartWiseLabourMaster' && (
                    <span className="badge badge-muted" title="Part-linked labour rate (PartWiseLabourMaster)." style={{ marginLeft: 6, fontSize: 10 }}>Part-wise</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{
            position: 'fixed', zIndex: 1000, top: pos.top, left: pos.left, minWidth: pos.width,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '8px 10px', boxShadow: 'var(--shadow-lg)',
          }}>
            <span className="muted" style={{ fontSize: 13 }}>No labour code matches "{value.trim()}".</span>
          </div>
        ),
        document.body
      )}
    </div>
  )
}
