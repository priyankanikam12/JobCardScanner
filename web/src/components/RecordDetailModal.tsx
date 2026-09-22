// web\src\components\RecordDetailModal.tsx
import type { ReactNode } from 'react'

/**
 * Generic read-only "record detail" popup (2026-09-21: "and all upload data and exist data are
 * clickable on any record we click this all details can openable") - shared by PartUploadPage.tsx,
 * MaterialTransferCreatePage.tsx and RepairBillCreatePage.tsx so clicking any row (an uploaded
 * part, a saved bill/transfer created here, or an existing DMSBAPLDATA-synced one) opens every
 * field that row carries, not just the handful of columns the grid has room for. Same
 * fixed-overlay + `.card` popup style as JobSearchModal.tsx, not a port of any reference app's own
 * detail screen - there is no single reference "view" UI to match here, this is this app's own
 * addition.
 *
 * `fields` is a flat label/value list rendered as a 2-column key-value grid (undefined/null values
 * render as "—" rather than being skipped, so the shape stays predictable). `items`, if given,
 * renders a second table below for a bill/transfer's line items - `itemColumns` are the header
 * labels and each `itemRows` entry is one row's cells in the same order, already formatted by the
 * caller (this component does no formatting/number-crunching of its own, since the two callers'
 * item shapes differ - JobCardScanner's own items vs DMSBAPLDATA's synced items).
 */
type Field = { label: string; value: ReactNode }

type Props = {
  title: string
  subtitle?: string
  fields: Field[]
  itemsTitle?: string
  itemColumns?: string[]
  itemRows?: ReactNode[][]
  onClose: () => void
}

export function RecordDetailModal({ title, subtitle, fields, itemsTitle, itemColumns, itemRows, onClose }: Props) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 900, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0 }}>{title}</h3>
            {subtitle && <p className="muted" style={{ margin: '2px 0 0' }}>{subtitle}</p>}
          </div>
          <button className="btn btn-icon" onClick={onClose} title="Close">✕</button>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '10px 18px', marginTop: 14,
        }}>
          {fields.map((f, i) => (
            <div key={i}>
              <div className="muted" style={{ fontSize: 12 }}>{f.label}</div>
              <div style={{ fontWeight: 500 }}>{f.value ?? '—'}</div>
            </div>
          ))}
        </div>

        {itemColumns && itemRows && (
          <div style={{ marginTop: 18 }}>
            <h4 style={{ margin: '0 0 8px' }}>{itemsTitle ?? 'Items'}</h4>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    {itemColumns.map((c, i) => <th key={i}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {itemRows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => <td key={ci}>{cell ?? '—'}</td>)}
                    </tr>
                  ))}
                  {itemRows.length === 0 && (
                    <tr><td colSpan={itemColumns.length} className="muted" style={{ textAlign: 'center', padding: 12 }}>No line items.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
