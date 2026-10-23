// mobile\src\lib\listView.ts
import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * 2026-10-23 (Android counterpart of web's components/TableControls.tsx; "this menu access ui also fix for web and android"): search on all fields, sort on a chosen field and pages of 10 for a list that
 * is held in memory. Every list here is EDITED in place (ticking a role, switching a page between "everyone" and "restricted"), so which rows show and in which order is worked out only when the search
 * text, the sort, `version`, the page size or the number of rows changes - NOT when a row's own values change - and the rows shown are always the current ones, looked up by key. Without that, editing a row
 * that is sorted / filtered by the very value you are editing would make it jump to another place or page under your finger.
 */
export type CellValue = string | number | boolean | null | undefined
export interface Field<T> {
  key: string
  value: (row: T) => CellValue
  /** false = the search box ignores this field (for example a number used only to sort). Default true. */
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

/** Rows whose combined field text contains every word of the query (case-insensitive). An empty query keeps every row. */
export function filterRows<T>(rows: T[], fields: Field<T>[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return rows
  return rows.filter((row) => {
    const text = fields.filter((f) => f.search !== false).map((f) => String(f.value(row) ?? '')).join(' ').toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

/** Stable sort on one field; rows with an empty value stay at the end in both directions. */
export function sortRows<T>(rows: T[], fields: Field<T>[], sort: SortState | null): T[] {
  const field = sort ? fields.find((f) => f.key === sort.key) : undefined
  if (!sort || !field) return rows
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((x, y) => {
    const a = field.value(x)
    const b = field.value(y)
    if (isEmpty(a) && isEmpty(b)) return 0
    if (isEmpty(a)) return 1
    if (isEmpty(b)) return -1
    return compareValues(a, b) * dir
  })
}

export function useListView<T>(
  rows: T[],
  fields: Field<T>[],
  options: { getKey: (row: T) => string; pageSize?: number; version?: unknown; prefilter?: (row: T) => boolean; initialSort?: SortState },
) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState | null>(options.initialSort ?? null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(options.pageSize ?? 10)
  const rowsRef = useRef(rows); rowsRef.current = rows
  const fieldsRef = useRef(fields); fieldsRef.current = fields
  const optionsRef = useRef(options); optionsRef.current = options

  const orderKeys = useMemo(() => {
    const pre = optionsRef.current.prefilter
    const source = pre ? rowsRef.current.filter(pre) : rowsRef.current
    return sortRows(filterRows(source, fieldsRef.current, query), fieldsRef.current, sort).map(optionsRef.current.getKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort, rows.length, options.version])

  const items = useMemo(() => {
    const byKey = new Map(rows.map((r) => [optionsRef.current.getKey(r), r] as const))
    return orderKeys.map((k) => byKey.get(k)).filter((r): r is T => r !== undefined)
  }, [rows, orderKeys])

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  useEffect(() => { setPage(1) }, [query, sort, pageSize, options.version])
  useEffect(() => { setPage((p) => (p > pageCount ? pageCount : p)) }, [pageCount])

  const toggleSort = (key: string) => setSort((s) => (s && s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const pageRows = items.slice((page - 1) * pageSize, page * pageSize)
  return { query, setQuery, sort, toggleSort, page, setPage, pageSize, setPageSize, pageCount, pageRows, total: items.length, allTotal: rows.length }
}
