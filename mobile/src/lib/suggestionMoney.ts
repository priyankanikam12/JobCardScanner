// mobile\src\lib\suggestionMoney.ts
import type { JobCardDetail } from '../types'

/**
 * 2026-10-22 (Android counterpart of the helpers at the top of web/src/pages/staff/JobCardDetailPage.tsx, 07.10.2026 "Discount on Part / Labour suggestions"):
 * a suggestion line carries a Discount Type (None / % / ₹) and a Discount Value, like the Repair Bill and Material Transfer lines. Stored on the suggestion row and set through
 * PUT /api/jobcards/{part|labour}-suggestions/{id}/discount. ONE money rule shared by the suggestion cards, the Estimates Amount card and the Estimate print, so all three always show the same numbers.
 */
export type DiscountKind = 'None' | 'Percentage' | 'Amount'
export interface Discount { type: DiscountKind; value: number }

/** discountType / discountValue of a suggestion row (read through a loose cast so a row from an older API simply counts as "None"). */
export const discountOf = (row: unknown): Discount => {
  const r = row as { discountType?: string | null; discountValue?: number | null }
  const type: DiscountKind = r.discountType === 'Percentage' || r.discountType === 'Amount' ? r.discountType : 'None'
  return { type, value: Number(r.discountValue) || 0 }
}

/** One line's money: the discount comes off the line's gross (rate x qty) - a % of it or a flat rupee amount, never more than the gross; an FOC (free of cost) line is 0 whatever its discount. */
export function suggestionLineMoney(rate: number | null | undefined, qty: number | null | undefined, isFoc: boolean, discount: Discount) {
  const gross = (Number(rate) || 0) * (Number(qty) || 0)
  if (isFoc) return { gross, discount: 0, amount: 0 }
  const raw = discount.type === 'Percentage' ? (gross * discount.value) / 100 : discount.type === 'Amount' ? discount.value : 0
  const off = Math.min(Math.max(raw, 0), gross)
  return { gross, discount: off, amount: gross - off }
}

export const discountLabel = (d: Discount) => (d.type === 'Percentage' ? `${d.value}%` : d.type === 'Amount' ? `₹${d.value}` : '—')

/** The Part / Labour rows of the estimate with the discount worked in - shared by the "Estimate" print and the Estimates Amount card. */
export function buildEstimateRows(jc: JobCardDetail) {
  const partRows = jc.partSuggestions.map((p, i) => {
    const mrp = p.mrp ?? 0
    const qty = p.quantity ?? 1
    const isFoc = p.status === 'FOC'
    const d = discountOf(p)
    const m = suggestionLineMoney(mrp, qty, isFoc, d)
    return { sr: i + 1, code: p.itemCode, description: p.description ?? '-', hsn: p.hsnCode ?? '-', mrp, rate: mrp, qty, isFoc, discountText: isFoc ? 'FOC' : discountLabel(d), discount: m.discount, amount: m.amount }
  })
  const labourRows = jc.labourSuggestions.map((l, i) => {
    const rate = l.rateAtSuggestion ?? 0
    const qty = l.quantity ?? 1
    const isFoc = l.issueType === 'FOC'
    const d = discountOf(l)
    const m = suggestionLineMoney(rate, qty, isFoc, d)
    return { sr: i + 1, code: l.labourCode, description: l.labourDescription ?? '-', hsn: l.hsnCode ?? '-', rate, qty, isFoc, discountText: isFoc ? 'FOC' : discountLabel(d), discount: m.discount, amount: m.amount }
  })
  const partsTotal = partRows.reduce((sum, r) => sum + r.amount, 0)
  const labourTotal = labourRows.reduce((sum, r) => sum + r.amount, 0)
  return { partRows, labourRows, partsTotal, labourTotal, grandTotal: partsTotal + labourTotal }
}

/** The message the API sent with an error (message + detail), or the fallback. */
export function apiMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string; detail?: string } } })?.response?.data
  return data ? [data.message, data.detail].filter(Boolean).join(' — ') || fallback : fallback
}
