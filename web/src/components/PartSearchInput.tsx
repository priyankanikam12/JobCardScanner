import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BaplDmsPartStock } from '../types'

/**
 * "Part Name (Stock @ Location)" type-ahead combobox (2026-09-21) - same search-as-you-type
 * pattern already used by JobCardDetailPage.tsx's PartSuggestionCard (type a code or a word of
 * the description, pick a match, see available stock), reused here as its own component so the
 * Repair Bill / Material Transfer Bill item grids (one row per line) can each have their own
 * instance. `parts` is the already-fetched GET /api/bapl-dms/parts?locationCode=... list for
 * whichever workshop location the create form currently has selected (fetched once by the parent
 * page, not per row) - this component only searches/filters what it's given.
 *
 * No GST % is shown here (unlike the reference DMS app's "(Stock @ Location)(GST %)" combo label):
 * DMS's own PartsInventory carries no tax-rate column, and the tax-rate lookup the reference uses
 * (HsnwiseTaxCodes/AggregateTaxCodes) was never confirmed against a live query in this project -
 * see Controllers/RepairBillDocsController.cs's doc comment. GST % stays a manual per-line input.
 *
 * 2026-09-22 ("take Item Code from /item-master and with Search Job below Item Code we cant
 * select"): `parts` is no longer just the current Location's live DMS stock - the two create pages
 * now seed it primarily from BAPL's own C_ItemMaster (GET /api/item-master, dealer/location-
 * agnostic - see ItemMasterController.cs), so an Item Code can be found and picked whether or not
 * a Location/Job has been chosen yet, and whether or not that item happens to have a live stock row
 * at the current location. Live DMS stock/Part Upload rows are still merged in on top (for
 * availableQty and the "Uploaded" badge) by both create pages, not by this component. Because of
 * this, the input is NO LONGER disabled while no Location is selected (it never needed a Location -
 * only Labour search, a genuinely dealer-scoped lookup, still does - see LabourSearchInput.tsx).
 *
 * 2026-09-21 correction ("Item Code in ovveride in under dropdown shown on front"): the results
 * list used to be an `position: absolute` child of this input's own wrapper. That wrapper sits
 * inside the item grid's own horizontally-scrollable `<div style={{ overflowX: 'auto' }}>` - and
 * per the CSS spec, setting only overflow-x (not overflow-y) on an element silently turns the
 * OTHER axis's computed 'visible' into 'auto' too (a UA can't mix 'visible' with a non-'visible'
 * value on the same box), so that wrapper was ALSO clipping vertical overflow even though nothing
 * asked it to - the dropdown was being cut off/hidden behind the table's own scroll edge ("shown
 * under"), not behind another element by z-index. No z-index number fixes that, since the box is
 * being clipped, not merely stacked below something. The real fix is to stop the dropdown from
 * being a descendant of that clipping box at all: it's now rendered through a React portal
 * straight onto `document.body`, positioned with `getBoundingClientRect()` off the input itself
 * (`position: fixed`, so it tracks correctly regardless of which ancestor scrolls), and repositions
 * on scroll/resize while open.
 */
type Props = {
  parts: BaplDmsPartStock[]
  value: string
  onChangeText: (text: string) => void
  onPick: (part: BaplDmsPartStock) => void
  placeholder?: string
  width?: number
  /** 2026-09-23 ("without Job Search we cant add ... Part Details List that also show block
   * sytematic"): Material Transfer Bill's own Part Details List grid is now blocked (every input,
   * this one included) until a Job is linked - matching the header fields' own disable gate added
   * the previous round. Optional/defaults to false so RepairBillCreatePage.tsx's own two calls to
   * this component (which don't gate on a Job the same way) are unaffected. */
  disabled?: boolean
}

// 2026-09-23 ("which have 0 qty for Item Code that dont allow to add"): a "confirmed" zero balance
// - deliberately excludes source: 'itemMaster' rows, whose availableQty is a 0 PLACEHOLDER (no
// live stock/Part Upload row loaded for this Item Code at the current Location yet, not a
// confirmed-empty balance - see BaplDmsPartStock's own doc comment). Blocking those too would undo
// the earlier "take Item Code from /item-master ... we cant select" fix, which deliberately made
// every catalog item pickable even with no stock data loaded yet. Exported so
// MaterialTransferCreatePage.tsx's own pickPartForLine can apply the exact same rule as a second,
// authoritative check (this dropdown is the first line of defense, not the only one).
export const isConfirmedOutOfStock = (p: BaplDmsPartStock) => p.source !== 'itemMaster' && p.availableQty <= 0

export function PartSearchInput({ parts, value, onChangeText, onPick, placeholder, width, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const q = value.trim().toLowerCase()
  const matches = q.length === 0 ? [] : parts
    .filter((p) => p.itemCode.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
    // 2026-09-23 ("in dropdown show order which have qty this order show in dropdown"): items with
    // a confirmed real balance float to the top (highest quantity first) instead of the previous
    // unordered (catalog-preload-then-overlay) order - out-of-stock/unknown-stock rows (both read
    // 0 here) sink to the bottom, in their original relative order (Array.prototype.sort has been a
    // guaranteed-stable sort since ES2019, so this doesn't need its own tie-break).
    .sort((a, b) => b.availableQty - a.availableQty)
    .slice(0, 20)

  const reposition = () => {
    const r = inputRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 280) })
  }

  useEffect(() => {
    if (!open) return
    reposition()
    // Any ancestor can be the one scrolling (the item grid's own overflow-x wrapper, or the page
    // itself) - listen in the capture phase so a scroll on ANY ancestor, not just window, repositions.
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const showDropdown = !disabled && open && q.length > 0 && pos !== null

  return (
    <div style={{ position: 'relative', width: width ?? '100%' }}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder ?? 'Search item code or description…'}
        onChange={(e) => { onChangeText(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        disabled={disabled}
        style={{ width: '100%' }}
      />
      {showDropdown && createPortal(
        matches.length > 0 ? (
          <ul style={{
            position: 'fixed', zIndex: 1000, top: pos.top, left: pos.left, minWidth: pos.width,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            maxHeight: 220, overflowY: 'auto', listStyle: 'none', padding: 4, boxShadow: 'var(--shadow-lg)', margin: 0,
          }}>
            {matches.map((p) => {
              // 2026-09-23 ("which have 0 qty for Item Code that dont allow to add"): a row with a
              // CONFIRMED zero balance (see isConfirmedOutOfStock above) is shown - so it's still
              // findable/visible in search - but greyed out and unclickable, rather than silently
              // removed from the list entirely.
              const outOfStock = isConfirmedOutOfStock(p)
              return (
              <li key={p.itemCode}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={outOfStock}
                  title={outOfStock ? `${p.itemCode} has 0 balance at this location - cannot add.` : undefined}
                  style={{
                    width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '6px 8px',
                    opacity: outOfStock ? 0.55 : 1, cursor: outOfStock ? 'not-allowed' : 'pointer',
                  }}
                  onMouseDown={(e) => { e.preventDefault(); if (outOfStock) return; onPick(p); setOpen(false) }}
                >
                  <strong>{p.itemCode}</strong>{p.description ? ` — ${p.description}` : ''}{' '}
                  {p.source === 'itemMaster' ? (
                    <span className="muted">(no stock loaded at this location)</span>
                  ) : outOfStock ? (
                    <span className="muted">(out of stock)</span>
                  ) : (
                    <span className="muted">(stock: {p.availableQty})</span>
                  )}
                  {p.source === 'partUpload' && (
                    <span className="badge badge-muted" title="From your uploaded Part Upload stock report, not live DMS stock." style={{ marginLeft: 6, fontSize: 10 }}>Uploaded</span>
                  )}
                  {p.source === 'itemMaster' && (
                    <span className="badge badge-muted" title="From BAPL's Item Master catalog (C_ItemMaster) - no live stock/Part Upload row for this item at the current location." style={{ marginLeft: 6, fontSize: 10 }}>Catalog</span>
                  )}
                </button>
              </li>
              )
            })}
          </ul>
        ) : (
          <div style={{
            position: 'fixed', zIndex: 1000, top: pos.top, left: pos.left, minWidth: pos.width,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '8px 10px', boxShadow: 'var(--shadow-lg)',
          }}>
            <span className="muted" style={{ fontSize: 13 }}>No item matches "{value.trim()}" in the catalog or at this location.</span>
          </div>
        ),
        document.body
      )}
    </div>
  )
}
