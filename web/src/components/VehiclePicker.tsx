// web\src\components\VehiclePicker.tsx
import { useEffect, useState } from 'react'
import { staffApi } from '../api/client'
import type { BaplDmsVehicleSuggestion } from '../types'

/**
 * 2026-10-21: the chassis no. / registration no. box with a live dropdown - the SAME search the New Job Card wizard uses (GET /api/jobcards/vehicle-suggestions): type "P6" and every matching chassis is listed,
 * type part of a registration number and those are listed too, each with its sale date. A dealer login searches its own dealer's vehicles first and, when that finds nothing, every dealer (the list says so);
 * head-office logins (no dealer) search everything. Picking a row calls onPick; pressing Enter on a typed value calls onPick with exactly that text.
 */
export interface PickedVehicle { value: string; chassisNo: string | null; regNo: string | null; modelName: string | null }

export function VehiclePicker({ dealerId, initial = '', onPick }: { dealerId?: string | null; initial?: string; onPick: (v: PickedVehicle) => void }) {
  const [q, setQ] = useState(initial)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<BaplDmsVehicleSuggestion[]>([])
  const [global, setGlobal] = useState(false)

  useEffect(() => {
    if (!open || q.trim().length < 2) { setRows([]); setGlobal(false); return }
    const text = q.trim()
    let cancelled = false
    const handle = setTimeout(() => {
      staffApi.get<BaplDmsVehicleSuggestion[]>('/api/jobcards/vehicle-suggestions', { params: { q: text, dealerId: dealerId || undefined } })
        .then(({ data }) => {
          if (cancelled) return
          if (data.length > 0 || !dealerId) { setRows(data); setGlobal(false); return }
          // nothing in this dealer's own stock: look in every dealer, like the wizard does
          return staffApi.get<BaplDmsVehicleSuggestion[]>('/api/jobcards/vehicle-suggestions', { params: { q: text } })
            .then(({ data: all }) => { if (!cancelled) { setRows(all); setGlobal(all.length > 0) } })
        })
        .catch(() => { if (!cancelled) { setRows([]); setGlobal(false) } })
    }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [q, open, dealerId])

  const pick = (s: BaplDmsVehicleSuggestion) => {
    setQ(s.chassisNo)
    setOpen(false)
    setRows([])
    onPick({ value: s.chassisNo, chassisNo: s.chassisNo, regNo: s.regNo ?? null, modelName: s.modelName ?? null })
  }

  return (
    <div className="field" style={{ position: 'relative', marginBottom: 0 }}>
      <label>Chassis no. / Reg No.</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { setOpen(false); onPick({ value: q.trim(), chassisNo: null, regNo: null, modelName: null }) } }}
          placeholder="Type a chassis no. or registration no. (e.g. P6)"
          autoComplete="off"
        />
        <button type="button" className="btn" disabled={!q.trim()} onClick={() => { setOpen(false); onPick({ value: q.trim(), chassisNo: null, regNo: null, modelName: null }) }}>Search</button>
      </div>
      {open && rows.length > 0 && (
        <ul style={{
          position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 90, marginTop: 2, background: 'var(--card-bg, #fff)', border: '1px solid var(--border)', borderRadius: 8,
          maxHeight: 260, overflowY: 'auto', listStyle: 'none', padding: 4, boxShadow: '0 6px 18px rgba(0,0,0,.12)',
        }}>
          {global && (
            <li style={{ padding: '6px 8px', fontSize: 12, color: '#1e3a5f', background: '#eef6ff', borderRadius: 6, marginBottom: 2 }}>
              🔎 No matches for your dealer — showing results from every dealer.
            </li>
          )}
          {rows.map((s) => (
            <li key={s.chassisNo}>
              <button type="button" className="btn btn-sm" style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '6px 8px' }}
                onMouseDown={(e) => { e.preventDefault(); pick(s) }}>
                <strong>{s.chassisNo}</strong>{s.regNo ? ` · ${s.regNo}` : ''}{s.modelName ? ` — ${s.modelName}` : ''}
                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted, #6b7280)' }}>Sale date: {s.saleDate ? new Date(s.saleDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'not sold'}</span>
              </button>
            </li>
          ))}
          {rows.length >= 100 && <li style={{ padding: '6px 8px', fontSize: 12, color: 'var(--muted, #6b7280)' }}>Showing the first {rows.length} matches - keep typing to narrow down.</li>}
        </ul>
      )}
    </div>
  )
}
