// web\src\pages\staff\ItemMasterPage.tsx
import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import type { BaplItemMaster } from '../../types'
import { Pagination } from '../../components/Pagination'
import { usePagination } from '../../lib/usePagination'

/**
 * "Item Master" sidebar page (2026-09-21: "add in sidebar option in Item master page fetch data
 * from C _ItemMaster table from baplfinal databse") - read-only browse/search over BAPL's own
 * C_ItemMaster catalog (GET /api/item-master, see BaplItemMasterRow's doc comment in
 * BaplDealerService.cs for the confirmed schema). This is the SAME table Material Transfer/Repair
 * Bill now source their per-item Dealer Price and GST% from - this page is just the human-readable
 * view of that same data, not a separate dataset. Read-only: this app never writes to baplfinal.
 *
 * No default filter the way Vehicle Sale/Repair Bill default to "Zomato" - C_ItemMaster has no
 * natural default party, so this loads the first 1000 items (server-capped, see
 * SearchItemMasterAsync) alphabetically on open, same "load something useful immediately" pattern
 * as those pages, and narrows further as you type.
 */
export function ItemMasterPage() {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<BaplItemMaster[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = () => {
    setLoading(true)
    setError(null)
    staffApi
      .get<BaplItemMaster[]>('/api/item-master', { params: { q: q || undefined } })
      .then((r) => setItems(r.data))
      .catch((err) => {
        setItems([])
        setError(err?.response?.data?.message ?? 'Could not reach BAPL\'s item master (baplfinal) - check the connection and try again.')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { search() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handle = setTimeout(search, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const { page, setPage, pageSize, setPageSize, pageCount, pageRows, total } = usePagination(items)

  const fmtAmt = (n?: number | null) => (n == null ? '—' : `₹${n.toFixed(2)}`)
  const fmtPct = (n?: number | null) => (n == null ? '—' : `${n}%`)

  return (
    <div>
      <h2>Item Master</h2>
      {/* <p className="muted">
        BAPL's item catalog (C_ItemMaster, baplfinal) - Dealer Price and per-item GST% (SGST/CGST/
        IGST), same source Material Transfer Bill and Repair Bill now use to auto-calculate Rate,
        MRP and tax when you pick a part. Read-only - this app never writes to baplfinal.
      </p> */}

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>Search catalog</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Item code, name or display name" />
          </div>
        </div>
        <button className="btn" onClick={search} disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
        {error && <p className="muted" style={{ color: '#b91c1c' }}>{error}</p>}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Item Name</th>
              <th>HSN Code</th>
              <th className="text-end">Dealer Price</th>
              <th className="text-end">SGST %</th>
              <th className="text-end">CGST %</th>
              <th className="text-end">IGST %</th>
              <th className="text-end">Qty</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((it) => (
              <tr key={it.itemCode}>
                <td>{it.itemCode}</td>
                <td>{it.itemName ?? it.displayName ?? '—'}</td>
                <td>{it.hsnCode ?? '—'}</td>
                <td className="text-end">{fmtAmt(it.dlrPrice)}</td>
                <td className="text-end">{fmtPct(it.sgst)}</td>
                <td className="text-end">{fmtPct(it.cgst)}</td>
                <td className="text-end">{fmtPct(it.igst)}</td>
                <td className="text-end" title="This dealer's uploaded Part Upload stock, summed across every location - not a C_ItemMaster column. Blank means nothing uploaded yet, not 0 in stock.">{it.qty ?? '—'}</td>
                <td>{it.itemType ?? '—'}</td>
                <td>{it.status === 'Y' ? <span className="badge badge-success">Active</span> : it.status === 'N' ? <span className="badge badge-muted">Inactive</span> : (it.status ?? '—')}</td>
              </tr>
            ))}
            {items.length === 0 && !loading && !error && (
              <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                No items found{q ? ` matching "${q}"` : ''}.
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageCount={pageCount} total={total} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={setPageSize} />
      </div>
    </div>
  )
}
