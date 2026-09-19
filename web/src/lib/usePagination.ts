import { useEffect, useState } from 'react'

/**
 * Client-side pagination for the DMSBAPLDATA-backed list pages (Vehicle Sale, Material Transfer,
 * Repair Bill) - 2026-09-18 "add pagignation in each page ... count add 100 in 1 page all". These
 * pages already load their full filtered result set into memory in one GET (none of the three
 * endpoints has server-side page/pageSize params), so this just slices what's already loaded rather
 * than adding new backend paging - a smaller, safer change on pages that are otherwise read-only.
 *
 * Defaults to 100 rows/page per your request; `setPageSize` backs a visible dropdown (see
 * Pagination.tsx) so it's adjustable per page rather than a silent, fixed number.
 */
export function usePagination<T>(rows: T[], initialPageSize = 100) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))

  // Snap back into range whenever the row set or page size changes - a fresh search (or an
  // import-filter being applied/cleared, or picking a smaller page size) can easily leave `page`
  // past the new last page.
  useEffect(() => {
    setPage((p) => (p > pageCount ? 1 : p))
  }, [rows, pageCount])

  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)
  return { page, setPage, pageSize, setPageSize, pageCount, pageRows, total: rows.length }
}
