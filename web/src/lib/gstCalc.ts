// web\src\lib\gstCalc.ts
/**
 * Shared GST/MRP/Amount calculation for Material Transfer Bill and Repair Bill, backed by real
 * per-item Rate/GST% read from BAPL's own C_ItemMaster (GET /api/bapl-pricing/items/{itemCode} -
 * see BaplItemPricingController.cs / BaplItemPricingService.cs). Replaces every earlier round's
 * 18%-default guess and the MRP-reverse-calculated-from-picked-stock approach.
 *
 * CONFIRMED RULE (explicit decision, both questions answered):
 *  - Rate = C_ItemMaster.Dlr_Price (base, GST-exclusive) for BOTH Material Transfer and Repair Bill.
 *  - MRP = Rate x (1 + Igst%/100), computed ONCE from the full, undiscounted Rate, and held FIXED
 *    on the line thereafter - a discount never changes MRP.
 *  - Amount = discountedLineTotal x (1 + splitGst%/100) - THIS is the value that moves with
 *    discount. Worked example: Rate 100, Qty 1, GST 18%, discount 10% -> discounted 90 ->
 *    Amount = 90 x 1.18 = 106.20 (confirmed correct over the illustrative "108" in the original
 *    request).
 *  - The GST% used for MRP is always the item's own Igst column (confirmed Sgst + Cgst == Igst in
 *    C_ItemMaster), independent of which split (same-state vs different-state) actually gets
 *    applied to a line's real tax amount - MRP is a fixed "sticker" figure, Amount is the billed one.
 */

/** Mirrors BaplItemPricingRow (backend) - camelCase per this project's default JSON casing. */
export interface BaplItemPricing {
  itemCode: string
  itemName?: string | null
  dlrPrice?: number | null
  salesPrice?: number | null
  sgst?: number | null
  cgst?: number | null
  igst?: number | null
  ugst?: number | null
  hsnCode?: string | null
}

export type TaxMode = 'Same State (CGST+SGST)' | 'Different State (IGST)'

export interface GstLineResult {
  /** Fixed "sticker" price - Rate x (1 + Igst%/100), computed from the undiscounted Rate. Never
   * moves with discount or quantity (per-unit figure). */
  mrp: number
  /** Line total after discount, before tax - (Rate x Qty) x (1 - discountPct/100). */
  taxable: number
  cgstPct: number
  sgstPct: number
  igstPct: number
  cgstAmt: number
  sgstAmt: number
  igstAmt: number
  /** taxable + cgstAmt + sgstAmt + igstAmt - the actual billed line total. */
  amount: number
}

/**
 * Computes MRP (fixed) and Amount (moves with discount) for one grid line.
 * @param rate Per-unit Rate (GST-exclusive) - normally C_ItemMaster.Dlr_Price, editable by staff.
 * @param qty Line quantity.
 * @param item The fetched C_ItemMaster row for this item, or null if none was found (falls back
 *   to 0% GST - MRP then equals Rate, and Amount equals the discounted line total with no tax,
 *   which is intentional: without a real rate source we don't invent a tax percentage).
 * @param discountPct Discount as a percentage (0 for no discount).
 * @param taxMode Same-state (CGST+SGST) or different-state (IGST) - decides which of the item's
 *   own Sgst/Cgst/Igst columns actually gets applied to Amount; MRP always uses Igst% regardless.
 */
export function computeGstLine(rate: number, qty: number, item: BaplItemPricing | null, discountPct: number, taxMode: TaxMode): GstLineResult {
  const totalGstPct = item?.igst ?? 0
  const mrp = rate * (1 + totalGstPct / 100)

  const grossLine = rate * (qty || 0)
  const discountedLine = grossLine * (1 - (discountPct || 0) / 100)

  const cgstPct = taxMode === 'Same State (CGST+SGST)' ? (item?.cgst ?? 0) : 0
  const sgstPct = taxMode === 'Same State (CGST+SGST)' ? (item?.sgst ?? 0) : 0
  const igstPct = taxMode === 'Different State (IGST)' ? (item?.igst ?? 0) : 0

  const cgstAmt = (discountedLine * cgstPct) / 100
  const sgstAmt = (discountedLine * sgstPct) / 100
  const igstAmt = (discountedLine * igstPct) / 100
  const amount = discountedLine + cgstAmt + sgstAmt + igstAmt

  return { mrp, taxable: discountedLine, cgstPct, sgstPct, igstPct, cgstAmt, sgstAmt, igstAmt, amount }
}
