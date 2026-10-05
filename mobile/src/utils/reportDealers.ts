// mobile\src\utils\reportDealers.ts
// Android copy of web/src/lib/reportDealers.ts - the ONE place that decides which dealers the Dealer
// Role Report (dealer picker + dealer cards) shows. Purely a display filter. KEEP THE TWO IN SYNC.
//
// TO CHANGE THE LIST: edit REPORT_DEALER_KEYWORDS - one word per dealer, matched anywhere in the
// dealer's name (case-insensitive). A dealer is shown only if its name contains "MAGNEMITE" AND one
// of these words. The report's "All dealers" mode ignores this list and shows every dealer.
export const REPORT_DEALER_KEYWORDS = ['BANGALORE', 'CHENNAI', 'DELHI', 'DOMBIVLI', 'HYDERABAD']

export function isReportDealer(name: string | null | undefined): boolean {
  const n = (name ?? '').toUpperCase()
  return n.includes('MAGNEMITE') && REPORT_DEALER_KEYWORDS.some((k) => n.includes(k))
}