import { useEffect, useMemo, useRef, useState } from 'react'
import { Pagination } from './Pagination'
import { usePagination } from '../lib/usePagination'
import './table-controls.css'

/**
 * 2026-10-23 (Admin: Users, "pagination add 10 data records in 1 page, sorting order each column, then search filter for all row"): one shared set of table helpers so every table on a page
 * behaves the same way - a search box that filters on ALL columns (several words = all of them must match), a click on a column header to sort (click again to reverse; empty cells always
 * last), and pages of 10 rows. Everything runs on the rows already loaded in the browser (the same approach as lib/usePagination.ts), nothing here calls the API.
 */
export type CellValue = string | number | boolean | null | undefined
export interface Column<T> {
  key: string
  label: string
  value: (row: T) => CellValue
  /** false = the filter box ignores this column (for example a number used only to sort). Default true. */
  search?: boolean
}
export type SortDir = 'asc' | 'desc'
export interface SortState { key: string; dir: SortDir }

const isEmpty = (v: CellValue) => v === null || v === undefined || v === ''

export function compareValues(a: CellValue, b: CellValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** Rows whose combined column text contains every word of the query (case-insensitive). An empty query keeps every row. */
export function filterRows<T>(rows: T[], columns: Column<T>[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return rows
  return rows.filter((row) => {
    const text = columns.filter((c) => c.search !== false).map((c) => String(c.value(row) ?? '')).join(' ').toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

/** Stable sort on one column; rows with an empty value stay at the end in both directions. */
export function sortRows<T>(rows: T[], columns: Column<T>[], sort: SortState | null): T[] {
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined
  if (!sort || !col) return rows
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((x, y) => {
    const a = col.value(x)
    const b = col.value(y)
    if (isEmpty(a) && isEmpty(b)) return 0
    if (isEmpty(a)) return 1
    if (isEmpty(b)) return -1
    return compareValues(a, b) * dir
  })
}

interface ViewOptions<T> {
  pageSize?: number
  /** Use a search text that lives outside (for example the box that also feeds a server search) instead of the view's own. */
  query?: string
  /** Change this value when something a column reads from changes without the rows changing (for example a per-row dropdown), so the sort / filter run again. */
  version?: unknown
  initialSort?: SortState
  /** Applied before the search (for example an "All / Restricted / Everyone" switch). Change `version` when its meaning changes. */
  prefilter?: (row: T) => boolean
  /**
   * 2026-10-23 (Menu Access): for a table whose cells are EDITED in place. With this set, which rows show and in which order is worked out only when the search text, the sort, `version` or the number of
   * rows changes - NOT when a row's own values change - so ticking a box in a row that is sorted / filtered by that very value does not make the row jump to another place or page. The rows shown are
   * always the current ones (looked up by key).
   */
  frozen?: { getKey: (row: T) => string }
}

export function useTableView<T>(rows: T[], columns: Column<T>[], options: ViewOptions<T> = {}) {
  const [ownQuery, setOwnQuery] = useState('')
  const query = options.query !== undefined ? options.query : ownQuery
  const [sort, setSort] = useState<SortState | null>(options.initialSort ?? null)
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const optionsRef = useRef(options)
  optionsRef.current = options
  const frozenOn = options.frozen !== undefined

  const compute = (source: T[]) => {
    const pre = optionsRef.current.prefilter
    return sortRows(filterRows(pre ? source.filter(pre) : source, columnsRef.current, query), columnsRef.current, sort)
  }
  // frozen mode: the ORDER (a list of keys) is recomputed only on search / sort / version / row count
  const frozenKeys = useMemo(
    () => (frozenOn ? compute(rowsRef.current).map((r) => optionsRef.current.frozen!.getKey(r)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frozenOn, query, sort, rows.length, options.version],
  )
  const processed = useMemo(() => {
    if (!frozenKeys) return compute(rows)
    const byKey = new Map(rows.map((r) => [optionsRef.current.frozen!.getKey(r), r] as const))
    return frozenKeys.map((k) => byKey.get(k)).filter((r): r is T => r !== undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, sort, options.version, frozenKeys])
  const pager = usePagination(processed, options.pageSize ?? 10)
  const { setPage } = pager
  useEffect(() => { setPage(1) }, [query, sort, setPage])

  const toggleSort = (key: string) =>
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  // pager.total is the number of rows AFTER the filter; allTotal is the number loaded
  return { ...pager, query, setQuery: setOwnQuery, sort, toggleSort, allTotal: rows.length }
}

/** A column header that sorts on click and shows the direction (▲ ascending, ▼ descending, ⇅ not sorted by this column). */
export function SortTh({ label, sortKey, sort, onSort }: { label: string; sortKey: string; sort: SortState | null; onSort: (key: string) => void }) {
  const active = sort?.key === sortKey
  return (
    <th
      className={`tc-sortable${active ? ' tc-active' : ''}`}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title="Click to sort"
    >
      {label}<span className="tc-sort">{active ? (sort!.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </th>
  )
}

/** Search box with an icon and a clear button; it grows to fill the row and keeps its button(s) on the same line (use it inside <div className="tc-toolbar">). */
export function TableSearch({ value, onChange, placeholder, onEnter, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder: string; onEnter?: () => void; ariaLabel?: string }) {
  return (
    <div className="tc-search tc-grow">
      <span className="tc-ico" aria-hidden="true">🔍</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter() }}
      />
      {value && <button type="button" className="tc-clear" aria-label="Clear search" onClick={() => onChange('')}>✕</button>}
    </div>
  )
}

/** The pager under a table (10 / 25 / 50 / 100 per page) for a view made by useTableView. */
export function TablePager({ view, sizes = [10, 25, 50, 100] }: {
  view: { page: number; pageCount: number; total: number; setPage: (p: number) => void; pageSize: number; setPageSize: (n: number) => void }
  sizes?: number[]
}) {
  return (
    <div className="tc-pager">
      <Pagination page={view.page} pageCount={view.pageCount} total={view.total} onPageChange={view.setPage} pageSize={view.pageSize} onPageSizeChange={view.setPageSize} pageSizeOptions={sizes} />
    </div>
  )
}

/** Active / Deactivated (or Yes / No) as a coloured badge. */
export function StatusBadge({ active, yes = 'Active', no = 'Deactivated' }: { active: boolean; yes?: string; no?: string }) {
  return <span className={`badge ${active ? 'badge-success' : 'badge-muted'}`}>{active ? yes : no}</span>
}
