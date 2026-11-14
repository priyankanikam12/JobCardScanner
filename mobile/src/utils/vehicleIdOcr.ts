// mobile\src\utils\vehicleIdOcr.ts
// 2026-11-13 (OCR scanner for the "Chassis no. / RegNo." search field of JobCardWizardScreen): turns the raw text
// that ML Kit read from a photo of a scooter into the few strings that can really be a chassis (VIN) number or a
// registration number. Pure functions, no React / native imports, so they can be tested on their own
// (see vehicleIdOcr.selftest.ts).
//
// Why this is needed: OCR returns every word it sees (brand names, "MADE IN INDIA", warnings ...) and it mixes up
// look-alike characters. A chassis number never contains the letters I, O or Q (they are skipped on purpose so that
// they cannot be mixed up with 1 and 0), so a read "O" inside one is always really a "0" - that is corrected here.
// A registration number has a fixed shape (state code + district + series + 4 digits), so each position is
// corrected to a letter or a digit the same way. Anything that still matches no known shape is only offered as a
// weak guess (loose = true) that the technician must check and edit.

export type VehicleIdKind = 'chassis' | 'reg'

export interface VehicleIdCandidate {
  /** upper case, no spaces or punctuation */
  value: string
  kind: VehicleIdKind
  /** 0..100, higher = more likely correct */
  score: number
  /** true when look-alike characters (O/0, I/1, B/8 ...) were replaced to reach a valid shape */
  corrected: boolean
  /** true for a weak guess that matched no known shape - always needs a manual check */
  loose: boolean
}

/** the part of ML Kit's result that is used here (the library's own type is wider) */
export interface OcrLike {
  text?: string
  blocks?: { text?: string; lines?: { text?: string }[] }[]
}

const STATE_CODES = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'DN', 'GA', 'GJ', 'HP', 'HR', 'JH', 'JK', 'KA', 'KL',
  'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ', 'NL', 'OD', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TR', 'TS', 'UA',
  'UK', 'UP', 'WB',
])

const VIN_FIX: Record<string, string> = { O: '0', Q: '0', I: '1' }
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B' }
const TO_DIGIT: Record<string, string> = { O: '0', Q: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', B: '8' }

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const countDigits = (s: string) => (s.match(/[0-9]/g) ?? []).length
const countLetters = (s: string) => (s.match(/[A-Z]/g) ?? []).length

type SourceKind = 'line' | 'joined' | 'whole'
interface Source { text: string; kind: SourceKind }

/** every line, every 2 and 3 consecutive lines joined (a plate or a long chassis number can wrap), and the whole text */
function buildSources(ocr: OcrLike): Source[] {
  const lines: string[] = []
  for (const b of ocr.blocks ?? []) for (const l of b.lines ?? []) if (l.text && l.text.trim()) lines.push(l.text)
  if (lines.length === 0 && ocr.text) for (const l of ocr.text.split(/\r?\n/)) if (l.trim()) lines.push(l)
  const squashed = lines.map(squash).filter((s) => s.length > 0)
  const out: Source[] = squashed.map((text) => ({ text, kind: 'line' as const }))
  for (let i = 0; i + 1 < squashed.length; i++) {
    out.push({ text: (squashed[i] ?? '') + (squashed[i + 1] ?? ''), kind: 'joined' })
    if (i + 2 < squashed.length) out.push({ text: (squashed[i] ?? '') + (squashed[i + 1] ?? '') + (squashed[i + 2] ?? ''), kind: 'joined' })
  }
  const whole = squashed.join('')
  if (whole.length > 0 && whole.length <= 600) out.push({ text: whole, kind: 'whole' })
  return out
}

const sourceBonus = (src: Source, windowLength: number) =>
  src.kind === 'line' ? (src.text.length === windowLength ? 10 : 5) : src.kind === 'joined' ? (src.text.length === windowLength ? 6 : 0) : -5

/** a number printed on one line is read from that line; the joined lines / whole text are only tried when no single
 *  line gave a candidate (a wrapped chassis number or a two-row plate) - otherwise windows that straddle two
 *  different numbers on the photo would be offered as fake ones */
function singleLineFirst(sources: Source[], scan: (srcs: Source[]) => VehicleIdCandidate[]): VehicleIdCandidate[] {
  const fromLines = scan(sources.filter((x) => x.kind === 'line'))
  return fromLines.length > 0 ? fromLines : scan(sources.filter((x) => x.kind !== 'line'))
}

function chassisCandidates(allSources: Source[]): VehicleIdCandidate[] {
  return singleLineFirst(allSources, scanChassis)
}

function scanChassis(sources: Source[]): VehicleIdCandidate[] {
  const best = new Map<string, VehicleIdCandidate>()
  for (const src of sources) {
    for (let i = 0; i + 17 <= src.text.length; i++) {
      const raw = src.text.slice(i, i + 17)
      let fixed = ''
      let n = 0
      for (const ch of raw) {
        const r = VIN_FIX[ch]
        if (r) { fixed += r; n++ } else fixed += ch
      }
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(fixed)) continue
      // judged on the characters OCR really read: a pure-letter phrase ("...SCOOTER MADE IN INDIA") must not turn
      // into a chassis number just because O -> 0 and I -> 1 are allowed
      if (countDigits(raw) < 5 || countLetters(raw) < 3 || n > 3) continue
      let score = 60 + sourceBonus(src, 17)
      if (/^[0-9]{5}$/.test(fixed.slice(12))) score += 10
      if (fixed.startsWith('P6')) score += 10
      score -= 6 * Math.min(n, 3)
      const cand: VehicleIdCandidate = { value: fixed, kind: 'chassis', score: Math.max(1, Math.min(100, score)), corrected: n > 0, loose: false }
      const prev = best.get(fixed)
      if (!prev || prev.score < cand.score) best.set(fixed, cand)
    }
  }
  return [...best.values()]
}

function regCandidates(allSources: Source[]): VehicleIdCandidate[] {
  return singleLineFirst(allSources, scanReg)
}

function scanReg(sources: Source[]): VehicleIdCandidate[] {
  const best = new Map<string, VehicleIdCandidate>()
  const add = (value: string, score: number, corrected: boolean) => {
    const cand: VehicleIdCandidate = { value, kind: 'reg', score: Math.max(1, Math.min(100, score)), corrected, loose: false }
    const prev = best.get(value)
    if (!prev || prev.score < cand.score) best.set(value, cand)
  }
  for (const src of sources) {
    // Bharat series: 22BH1234AA
    for (const m of src.text.matchAll(/([0-9]{2})BH([0-9]{4})([A-Z]{1,2})/g)) {
      const v = m[0]
      add(v, 62 + sourceBonus(src, v.length), false)
    }
    // standard: state (2 letters) + district (1-2 digits) + series (0-3 letters) + number (4 digits)
    for (let len = 7; len <= 11; len++) {
      for (let i = 0; i + len <= src.text.length; i++) {
        const w = src.text.slice(i, i + len)
        if (countDigits(w) < 4) continue
        if (/[0-9]/.test(src.text.charAt(i + len))) continue   // the number goes on: this window is cut short
        for (const distLen of [1, 2]) {
          const seriesLen = len - 2 - distLen - 4
          if (seriesLen < 0 || seriesLen > 3) continue
          const parts = [w.slice(0, 2), w.slice(2, 2 + distLen), w.slice(2 + distLen, 2 + distLen + seriesLen), w.slice(2 + distLen + seriesLen)]
          let n = 0
          const letters = (s: string) => [...s].map((c) => { if (/[A-Z]/.test(c)) return c; const r = TO_LETTER[c]; if (r) n++; return r ?? '?' }).join('')
          const digits = (s: string) => [...s].map((c) => { if (/[0-9]/.test(c)) return c; const r = TO_DIGIT[c]; if (r) n++; return r ?? '?' }).join('')
          const state = letters(parts[0] ?? '')
          const dist = digits(parts[1] ?? '')
          const series = letters(parts[2] ?? '')
          const num = digits(parts[3] ?? '')
          const value = state + dist + series + num
          if (value.includes('?') || !STATE_CODES.has(state)) continue
          if (!/^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/.test(value)) continue
          let score = 55 + sourceBonus(src, len)
          if (distLen === 2) score += 8
          if (seriesLen >= 1 && seriesLen <= 2) score += 8
          score -= 7 * Math.min(n, 4)
          add(value, score, n > 0)
        }
      }
    }
  }
  return [...best.values()]
}

/** weak guesses: long mixed letter+digit words that matched no known shape - the technician edits them */
function looseCandidates(ocr: OcrLike): VehicleIdCandidate[] {
  const text = ocr.text ?? (ocr.blocks ?? []).flatMap((b) => (b.lines ?? []).map((l) => l.text ?? '')).join('\n')
  const out = new Map<string, VehicleIdCandidate>()
  for (const token of text.split(/[\s,;:|/\\]+/)) {
    const v = squash(token)
    if (v.length < 8 || v.length > 20 || countDigits(v) < 2 || countLetters(v) < 2) continue
    const score = Math.max(5, 30 - 5 * Math.abs(v.length - 17))
    out.set(v, { value: v, kind: v.length >= 12 ? 'chassis' : 'reg', score, corrected: false, loose: true })
  }
  return [...out.values()]
}

/** the likely chassis / registration numbers in an OCR result, best first (empty when nothing usable was read) */
export function extractVehicleIds(ocr: OcrLike): VehicleIdCandidate[] {
  const sources = buildSources(ocr)
  const chassis = chassisCandidates(sources)
  // a registration-shaped window inside a good chassis number is just part of it, not a second vehicle id
  const strongChassis = chassis.filter((c) => c.score >= 60).map((c) => c.value)
  const regs = regCandidates(sources).filter((r) => !strongChassis.some((v) => v.includes(r.value)))
  const strict = [...chassis, ...regs]
  const pool = strict.length > 0 ? strict : looseCandidates(ocr)
  // best first; a weaker reading of the same characters (a shifted or truncated window, another look-alike
  // interpretation) is dropped, so each number on the photo is offered once
  const kept: VehicleIdCandidate[] = []
  for (const c of pool.sort((a, b) => b.score - a.score || b.value.length - a.value.length)) {
    const limit = c.kind === 'chassis' ? 10 : 5
    if (kept.some((k) => k.value === c.value || (k.kind === c.kind && !c.loose && !k.loose && longestCommonRun(k.value, c.value) >= limit))) continue
    kept.push(c)
  }
  return kept.slice(0, 6)
}

function longestCommonRun(a: string, b: string): number {
  let best = 0
  for (let i = 0; i < a.length; i++) {
    for (let len = best + 1; i + len <= a.length; len++) {
      if (b.includes(a.slice(i, i + len))) best = len
      else break
    }
  }
  return best
}

export const kindLabel = (k: VehicleIdKind) => (k === 'chassis' ? 'Chassis no.' : 'Registration no.')

/** Live scanning (viewfinder): one frame can be misread, so a number is accepted only when the SAME strict (not loose) value is read in `required`
 *  frames in a row. A frame with no strict reading, or a different one, starts the count again. */
export interface StabilityTracker {
  push(found: VehicleIdCandidate[]): VehicleIdCandidate | null
  reset(): void
}

export function createStabilityTracker(required = 2): StabilityTracker {
  let lastValue: string | null = null
  let hits = 0
  return {
    push(found) {
      const strict = found.find((c) => !c.loose)
      if (!strict) { lastValue = null; hits = 0; return null }
      if (strict.value === lastValue) hits += 1
      else { lastValue = strict.value; hits = 1 }
      return hits >= required ? strict : null
    },
    reset() { lastValue = null; hits = 0 },
  }
}