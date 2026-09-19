interface Props {
  page: number
  pageCount: number
  total: number
  onPageChange: (page: number) => void
  pageSize: number
  onPageSizeChange: (size: number) => void
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

/**
 * Prev/Next pagination footer + a "rows per page" selector, shared across the DMSBAPLDATA list
 * pages (Vehicle Sale, Material Transfer, Repair Bill) - see lib/usePagination.ts for the slicing
 * logic. 2026-09-18 "count add 100 in 1 page all" - defaults to 100/page there; this dropdown makes
 * that adjustable instead of a number you'd have to come back and ask me to change again.
 */
export function Pagination({ page, pageCount, total, onPageChange, pageSize, onPageSizeChange }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderTop: '1px solid #e5e7eb', flexWrap: 'wrap', gap: 8 }}>
      <span className="muted">{total} row{total === 1 ? '' : 's'} total — page {page} of {pageCount}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          Rows per page
          <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} style={{ padding: '3px 6px' }}>
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>‹ Prev</button>
          <button type="button" className="btn btn-sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>Next ›</button>
        </div>
      </div>
    </div>
  )
}
