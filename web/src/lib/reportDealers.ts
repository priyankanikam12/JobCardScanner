// web\src\lib\reportDealers.ts
// 2026-10-05 ("only this 4 shown in dropdown other hide"): the ONE place that decides which dealers
// the Dealer Role Report (dropdown + dealer cards) and the SystemAdmin dashboard cards include.
// Everything else is hidden there - it is purely a display filter, nothing is removed from the system.
//
// TO CHANGE THE LIST: edit REPORT_DEALER_KEYWORDS below - one word per dealer, matched anywhere in
// the dealer's name (case-insensitive). A dealer is shown only if its name contains "MAGNEMITE" AND
// one of these words.
//
// 2026-10-05: Bangalore, Chennai, Delhi, Dombivli and Hyderabad (Chennai added on request - an earlier
// version had only the other four). Ahmedabad and every non-Magnemite dealer stay hidden here; they
// still appear when the report is opened in its "All dealers" mode.
export const REPORT_DEALER_KEYWORDS = ['BANGALORE', 'CHENNAI', 'DELHI', 'DOMBIVLI', 'HYDERABAD']

export function isReportDealer(name: string | null | undefined): boolean {
  const n = (name ?? '').toUpperCase()
  return n.includes('MAGNEMITE') && REPORT_DEALER_KEYWORDS.some((k) => n.includes(k))
}