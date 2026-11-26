// web\src\components\MultiSelectDropdown.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type MultiOption = { value: string; label: string; hint?: string }

type Props = {
  label: string
  options: MultiOption[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Text shown when nothing is ticked, e.g. "All statuses". */
  allLabel?: string
  disabled?: boolean
  width?: number | string
}

/**
 * 2026-11-26 ("dropdown with multiple selection checkbox"): a dropdown whose options are tick boxes. Nothing ticked = no filter ("All ...").
 * Has Select all / Clear, a search box when the list is long, and closes on an outside click or Escape.
 */
export function MultiSelectDropdown({ label, options, selected, onChange, allLabel = 'All', disabled, width = 200 }: Props) {
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState('')
  const box = useRef<HTMLDivElement>(null)

  // The list is drawn in document.body (position: fixed) so no card, table header or overflow rule on the page can cover or clip it.
  const pop = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 200 })
  const place = () => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 380))
    setPos({ top: r.bottom + 4, left, width: r.width })
  }

  useEffect(() => {
    if (!open) return
    place()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || pop.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const shown = useMemo(() => {
    const t = find.trim().toLowerCase()
    return t ? options.filter((o) => o.label.toLowerCase().includes(t) || (o.hint ?? '').toLowerCase().includes(t)) : options
  }, [options, find])

  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
  const summary = selected.length === 0
    ? allLabel
    : selected.length <= 2
      ? selected.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ')
      : `${selected.length} selected`

  return (
    <div className="field" style={{ marginBottom: 0, width, position: 'relative' }} ref={box}>
      <label>{label}</label>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, textAlign: 'left', fontWeight: 500 }}
        title={selected.length ? selected.join(', ') : allLabel}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && !disabled && createPortal(
        <div
          ref={pop}
          className="card"
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 5000, minWidth: pos.width, width: 'max-content', maxWidth: 360,
            padding: 8, boxShadow: '0 12px 32px rgba(11, 36, 71, 0.28)', background: '#fff', overflow: 'visible',
          }}
        >
          {options.length > 8 && (
            <input autoFocus placeholder="Find..." value={find} onChange={(e) => setFind(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <button type="button" className="btn btn-sm" onClick={() => onChange(Array.from(new Set([...selected, ...shown.map((o) => o.value)])))}>Select all</button>
            <button type="button" className="btn btn-sm" onClick={() => onChange([])}>Clear</button>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {shown.length === 0 && <div className="muted" style={{ padding: 6 }}>No options</div>}
            {shown.map((o) => (
              <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} style={{ width: 'auto', margin: 0 }} />
                <span>{o.label}</span>
                {o.hint && <span className="muted" style={{ fontSize: 12 }}>{o.hint}</span>}
              </label>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
