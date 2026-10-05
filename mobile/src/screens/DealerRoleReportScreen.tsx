// mobile\src\screens\DealerRoleReportScreen.tsx
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { apiClient } from '../api/client'
import { PickerField } from '../components/PickerField'
import { colors } from '../theme/colors'
import type { RootStackParamList } from '../navigation/RootNavigator'
import { isReportDealer } from '../utils/reportDealers'
import {
  STAGE_COLUMNS, fmtDateOnly, fmtDateTime, periodLabel,
  shareDealerRoleReportExcel, shareDealerRoleReportPdf, shareDealerSummaryExcel, shareDealerSummaryPdf,
  type DealerDocList, type DealerStageReport, type DealerStageSummary, type DocCounts, type StageCounts,
} from '../utils/dealerRoleReportExport'

/**
 * Dealer Role Report (Android) - stage-wise, drill-down version (2026-10-05). The counterpart of web's
 * DealerRoleReportPage.tsx (read that file's doc comment, and backend DealerStageReportController.cs,
 * for the full request and for exactly what Created / Open / In Progress / Ready for Delivery /
 * Invoiced / Closed / Other / Not Closed mean - the numbers come from the same two endpoints).
 *
 * THE FLOW - the Dashboard's cards open this screen with route params { status, scope, basis, from, to }:
 *   1. ALL DEALERS: date range + stage tiles counted over it, across the dealers shown here.
 *   2. Tap a tile -> one card per dealer with that stage's count.
 *   3. Tap a dealer card -> that dealer's roles, the people in each role, and its job cards opened
 *      already filtered to the stage you tapped, with every role expanded.
 *      Every number, role and person at step 3 is also tappable and lists its job cards; tap a job
 *      card to open it.
 * The Dealer picker jumps straight to step 3 ("All dealers" goes back to step 1).
 *
 * Dates: "Created from/to" default to the 1st of this month -> today (the browser-free local date, not
 * UTC), typed as YYYY-MM-DD and applied with the Apply button (so a half-typed date never fires a
 * request). "Dates are" switches between the created date and the CLOSED date (the dashboard's
 * "Closed today"/"Invoiced today" tiles arrive on the closed date). All dates are India days.
 * Dealers: only utils/reportDealers.ts's list (edit that one list), or EVERY dealer with "All dealers"
 * (the dashboard's live tiles arrive in that mode so their totals match). Excel / PDF share whatever
 * level you are on. The job-card detail list is capped at 5,000 rows by the backend; counts are exact.
 */
type Props = NativeStackScreenProps<RootStackParamList, 'DealerRoleReport'>

type DealerRow = { id: string; name?: string; active?: boolean; isActive?: boolean }
type StageKey = 'created' | 'notClosed' | 'open' | 'inProgress' | 'readyForDelivery' | 'invoiced' | 'closed'
type DrillStage = StageKey | 'other'
interface DrillFilter {
  title: string
  stage: DrillStage
  role?: string
  /** Set (even to null, for the "Unknown creator" row) to filter to one person. */
  user?: { id: string | null }
}

const STAGES: { key: StageKey; label: string; icon: string; accent: string }[] = [
  { key: 'created', label: 'Created', icon: '📋', accent: colors.primary },
  { key: 'notClosed', label: 'Not Closed', icon: '📂', accent: colors.amber },
  { key: 'open', label: 'Open', icon: '📂', accent: '#d97706' },
  { key: 'inProgress', label: 'In Progress', icon: '🔧', accent: '#7c3aed' },
  { key: 'readyForDelivery', label: 'Ready for Delivery', icon: '🏁', accent: '#db2777' },
  { key: 'invoiced', label: 'Invoiced', icon: '🧾', accent: colors.success },
  { key: 'closed', label: 'Closed', icon: '✅', accent: '#0891b2' },
]
const stageLabel = (k: DrillStage): string => (k === 'other' ? 'Other' : STAGES.find((s) => s.key === k)?.label ?? k)

// Material Transfer / Repair Bill DOCUMENT counts (the dashboard's Material Transfer and Repair Bill cards). A
// document has no roles / people / job cards, so tapping a dealer card for one of these opens THAT DEALER'S
// DOCUMENTS (a list, each expandable to its lines) instead of the role report.
type DocKey = 'materialTransfers' | 'repairBills'
type SummaryKey = StageKey | DocKey
const DOC_STAGES: { key: DocKey; label: string; accent: string }[] = [
  { key: 'materialTransfers', label: 'Material Transfers', accent: '#0ea5e9' },
  { key: 'repairBills', label: 'Repair Bills', accent: '#64748b' },
]
const isSummaryKey = (v: string | undefined): v is SummaryKey => !!v && (STAGES.some((s) => s.key === v) || DOC_STAGES.some((d) => d.key === v))
const isDocKey = (k: SummaryKey): k is DocKey => k === 'materialTransfers' || k === 'repairBills'
const summaryLabel = (k: SummaryKey): string => (isDocKey(k) ? DOC_STAGES.find((d) => d.key === k)?.label ?? k : stageLabel(k))
const summaryCount = (c: StageCounts & Partial<DocCounts>, k: SummaryKey): number => (isDocKey(k) ? c[k] ?? 0 : c[k])

/** Does a job card (from the report's own list) belong to this stage? Mirrors the backend buckets. */
function matchesStage(j: { status: string; bucket: string }, stage: DrillStage): boolean {
  switch (stage) {
    case 'created': return true
    case 'closed': return j.status === 'Closed'
    case 'notClosed': return j.status !== 'Closed' && j.status !== 'Cancelled'
    case 'open': return j.bucket === 'Open'
    case 'inProgress': return j.bucket === 'InProgress'
    case 'readyForDelivery': return j.bucket === 'ReadyForDelivery'
    case 'invoiced': return j.bucket === 'Invoiced'
    case 'other': return j.bucket === 'Other'
  }
}

const PAGE_STEP = 50
const pad = (n: number) => String(n).padStart(2, '0')
const toLocalIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayIso = () => toLocalIso(new Date())
const startOfMonthIso = () => { const d = new Date(); return toLocalIso(new Date(d.getFullYear(), d.getMonth(), 1)) }
const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

export function DealerRoleReportScreen({ navigation, route }: Props) {
  const p = route.params

  // Every active dealer; `dealers` below is the subset shown (the Magnemite list, or ALL in all-dealers mode).
  const [allDealers, setAllDealers] = useState<{ id: string; name: string }[]>([])
  const [dealersLoaded, setDealersLoaded] = useState(false)
  const [dealersError, setDealersError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(p?.scope === 'all')
  const [dealerId, setDealerId] = useState('') // '' = all dealers
  const [status, setStatus] = useState<SummaryKey>(isSummaryKey(p?.status) ? p.status : 'created')

  // Applied dates drive the requests; the *Text drafts are what is typed in the boxes.
  const initialFrom = p?.from ?? startOfMonthIso()
  const initialTo = p?.to ?? todayIso()
  const [dateFrom, setDateFrom] = useState(initialFrom)
  const [dateTo, setDateTo] = useState(initialTo)
  const [fromText, setFromText] = useState(initialFrom)
  const [toText, setToText] = useState(initialTo)
  const [dateBasis, setDateBasis] = useState<'created' | 'closed'>(p?.basis === 'closed' ? 'closed' : 'created')

  const [summary, setSummary] = useState<DealerStageSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [report, setReport] = useState<DealerStageReport | null>(null)
  const [docs, setDocs] = useState<DealerDocList | null>(null)
  const [docsLoading, setDocsLoading] = useState(false)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [docOpen, setDocOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [drill, setDrill] = useState<DrillFilter | null>(null)
  const [shown, setShown] = useState(PAGE_STEP)
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  const scrollRef = useRef<ScrollView>(null)
  const drillY = useRef(0)
  /** Stage to auto-open (all roles expanded + its job cards) once the dealer's report has loaded. */
  const autoDrillRef = useRef<StageKey | null>(null)

  const dealers = showAll ? allDealers : allDealers.filter((d) => isReportDealer(d.name))

  // ---- dealers ----
  useEffect(() => {
    apiClient
      .get<DealerRow[]>('/api/dealers')
      .then(({ data }) => {
        const rows = Array.isArray(data) ? data : []
        setAllDealers(
          rows
            .filter((d) => d.active !== false && d.isActive !== false)
            .map((d) => ({ id: d.id, name: d.name ?? d.id }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      })
      .catch(() => setDealersError('Could not load the dealer list.'))
      .finally(() => setDealersLoaded(true))
  }, [])

  // ---- all-dealers summary ----
  useEffect(() => {
    if (!dealersLoaded || dealers.length === 0) { setSummary(null); return }
    setSummaryLoading(true)
    setSummaryError(null)
    apiClient
      .get<DealerStageSummary>('/api/dashboard/dealer-stage-report/summary', {
        // all-dealers mode sends NO dealerIds so the backend counts every dealer - the same set the dashboard counts.
        params: {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          dateBasis: dateBasis === 'closed' ? 'closed' : undefined,
          dealerIds: showAll ? undefined : dealers.map((d) => d.id).join(','),
        },
      })
      .then(({ data }) => setSummary(data))
      .catch((err: { response?: { data?: { message?: string } } }) => {
        setSummary(null)
        setSummaryError(err?.response?.data?.message ?? 'Could not load the dealer summary.')
      })
      .finally(() => setSummaryLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealersLoaded, allDealers, showAll, dateFrom, dateTo, dateBasis])

  // ---- one dealer's documents (Material Transfer / Repair Bill) ----
  useEffect(() => {
    if (!dealerId || !isDocKey(status)) { setDocs(null); return }
    setDocsLoading(true)
    setDocsError(null)
    setDocOpen(null)
    apiClient
      .get<DealerDocList>(`/api/dashboard/dealer-stage-report/${status === 'repairBills' ? 'repair-bills' : 'material-transfers'}`, {
        params: { dealerId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
      })
      .then(({ data }) => setDocs(data))
      .catch((err: { response?: { data?: { message?: string } } }) => {
        setDocs(null)
        setDocsError(err?.response?.data?.message ?? 'Could not load the documents for this dealer.')
      })
      .finally(() => setDocsLoading(false))
  }, [dealerId, status, dateFrom, dateTo])

  // ---- one dealer's report ----
  useEffect(() => {
    if (!dealerId) { setReport(null); return }
    setLoading(true)
    setError(null)
    setExpanded(new Set())
    setDrill(null)
    apiClient
      .get<DealerStageReport>('/api/dashboard/dealer-stage-report', {
        params: { dealerId, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, dateBasis: dateBasis === 'closed' ? 'closed' : undefined },
      })
      .then(({ data }) => {
        setReport(data)
        const auto = autoDrillRef.current
        autoDrillRef.current = null
        if (auto) {
          // Arrived from a dealer card: show everyone under the dealer and the job cards for that stage.
          setExpanded(new Set(data.roles.map((r) => r.role)))
          openDrill({ title: `${stageLabel(auto)} job cards`, stage: auto })
        }
      })
      .catch((err: { response?: { data?: { message?: string } } }) => {
        setReport(null)
        setError(err?.response?.data?.message ?? 'Could not load the report for this dealer.')
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealerId, dateFrom, dateTo, dateBasis])

  const toggle = (role: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })

  /** Opens the job-card panel for a filter and scrolls it into view. */
  const openDrill = (f: DrillFilter) => {
    setDrill(f)
    setShown(PAGE_STEP)
    setTimeout(() => scrollRef.current?.scrollTo({ y: drillY.current, animated: true }), 250)
  }

  const openDealerFromCard = (id: string) => {
    // A document stage opens the dealer's documents; a job-card stage opens the role report already drilled to it.
    autoDrillRef.current = isDocKey(status) ? null : status
    setDealerId(id)
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  }

  const applyDates = () => {
    const f = fromText.trim()
    const t = toText.trim()
    if ((f && !isIsoDate(f)) || (t && !isIsoDate(t))) { Alert.alert('Check the dates', 'Use the format YYYY-MM-DD (for example 2026-10-05), or leave a box empty.'); return }
    setDateFrom(f)
    setDateTo(t)
  }
  const setRange = (f: string, t: string) => { setFromText(f); setToText(t); setDateFrom(f); setDateTo(t) }

  const t = report?.totals
  const allExpanded = !!report && report.roles.length > 0 && report.roles.every((r) => expanded.has(r.role))
  const toggleStaff = () => { if (report) setExpanded(allExpanded ? new Set() : new Set(report.roles.map((r) => r.role))) }

  const drillJobs = report && drill
    ? report.jobCards.filter((j) =>
        matchesStage(j, drill.stage) &&
        (drill.role === undefined || j.role === drill.role) &&
        (drill.user === undefined || j.createdById === drill.user.id))
    : []

  // Excel/PDF cover the dealer-wise summary and one dealer's role report; the documents list has no export.
  const hasData = dealerId ? !isDocKey(status) && !!report && !loading : !!summary && !summaryLoading
  const runExport = async (kind: 'excel' | 'pdf') => {
    setExporting(kind)
    try {
      if (dealerId) {
        if (!report) return
        if (kind === 'excel') await shareDealerRoleReportExcel(report); else await shareDealerRoleReportPdf(report)
      } else {
        if (!summary) return
        if (kind === 'excel') await shareDealerSummaryExcel(summary); else await shareDealerSummaryPdf(summary)
      }
    } catch (err) {
      Alert.alert('Could not create the file', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setExporting(null)
    }
  }

  const countOf = (c: StageCounts, k: StageKey) => c[k]
  const isDefaultDates = dateFrom === startOfMonthIso() && dateTo === todayIso()
  const fromLabel = dateBasis === 'closed' ? 'Closed from' : 'Created from'
  const toLabel = dateBasis === 'closed' ? 'Closed to' : 'Created to'

  return (
    <ScrollView ref={scrollRef} style={styles.screen} keyboardShouldPersistTaps="handled">
      {dealerId ? (
        <TouchableOpacity onPress={() => { autoDrillRef.current = null; setDealerId('') }}>
          <Text style={styles.link}>← All dealers</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.title}>Dealer Role Report</Text>
      <Text style={styles.muted}>
        {dealerId
          ? 'Every role under this dealer, the people in each role and their job cards. Tap any number, tile or person to open those job cards.'
          : 'Job cards across the dealers below for the dates you choose. Tap a tile to see it dealer by dealer, then a dealer for its roles, people and job cards.'}
      </Text>

      <PickerField
        label="Dealer"
        value={dealerId}
        options={[{ label: `All dealers (${dealers.length})`, value: '' }, ...dealers.map((d) => ({ label: d.name, value: d.id }))]}
        placeholder={`All dealers (${dealers.length})`}
        onChange={(v) => { autoDrillRef.current = null; setDealerId(v) }}
      />
      {dealersError && <Text style={styles.error}>{dealersError}</Text>}
      {dealersLoaded && !dealersError && dealers.length === 0 && <Text style={styles.muted}>No matching dealers found - check the list in utils/reportDealers.ts.</Text>}

      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{fromLabel}</Text>
          <TextInput style={styles.input} value={fromText} onChangeText={setFromText} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{toLabel}</Text>
          <TextInput style={styles.input} value={toText} onChangeText={setToText} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        </View>
      </View>
      <View style={styles.btnRow}>
        <TouchableOpacity style={[styles.smallBtn, styles.primaryBtn]} onPress={applyDates}><Text style={[styles.smallBtnText, { color: '#fff' }]}>Apply dates</Text></TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => { const d = todayIso(); setRange(d, d) }}><Text style={styles.smallBtnText}>Today</Text></TouchableOpacity>
        {!isDefaultDates && (
          <TouchableOpacity style={styles.smallBtn} onPress={() => setRange(startOfMonthIso(), todayIso())}><Text style={styles.smallBtnText}>This month</Text></TouchableOpacity>
        )}
        {(dateFrom !== '' || dateTo !== '') && (
          <TouchableOpacity style={styles.smallBtn} onPress={() => setRange('', '')}><Text style={styles.smallBtnText}>All time</Text></TouchableOpacity>
        )}
      </View>
      <View style={styles.btnRow}>
        <TouchableOpacity style={[styles.chip, dateBasis === 'created' && styles.chipOn]} onPress={() => setDateBasis('created')}>
          <Text style={[styles.chipText, dateBasis === 'created' && styles.chipTextOn]}>Created date</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.chip, dateBasis === 'closed' && styles.chipOn]} onPress={() => setDateBasis('closed')}>
          <Text style={[styles.chipText, dateBasis === 'closed' && styles.chipTextOn]}>Closed date</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => { setDealerId(''); setShowAll((v) => !v) }}>
          <Text style={styles.smallBtnText}>{showAll ? 'Magnemite dealers only' : 'All dealers'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.btnRow}>
        <TouchableOpacity style={[styles.excelBtn, (!hasData || exporting !== null) && styles.disabled]} disabled={!hasData || exporting !== null} onPress={() => runExport('excel')}>
          <Text style={styles.exportText}>{exporting === 'excel' ? 'Preparing…' : '⬇ Excel'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.pdfBtn, (!hasData || exporting !== null) && styles.disabled]} disabled={!hasData || exporting !== null} onPress={() => runExport('pdf')}>
          <Text style={styles.exportText}>{exporting === 'pdf' ? 'Preparing…' : '⬇ PDF'}</Text>
        </TouchableOpacity>
      </View>

      {/* =============================== LEVEL 1: all dealers =============================== */}
      {!dealerId && (
        <>
          {summaryLoading && <ActivityIndicator style={{ marginVertical: 12 }} color={colors.primary} />}
          {summaryError && <Text style={styles.error}>{summaryError}</Text>}
          {summary && !summaryLoading && (
            <>
              <Text style={styles.muted}>
                {dealers.length} dealers{showAll ? ' (all)' : ''} · Period: {periodLabel(summary)} · Generated {fmtDateTime(summary.generatedAt)} IST
              </Text>
              <View style={styles.tiles}>
                {[...STAGES, ...DOC_STAGES].map((s) => (
                  <Tile key={s.key} label={s.label} value={summaryCount(summary.totals, s.key)} accent={s.accent} selected={status === s.key} onPress={() => setStatus(s.key)} />
                ))}
              </View>

              <Text style={styles.sectionTitle}>{summaryLabel(status)} - by dealer</Text>
              <Text style={styles.muted}>
                {isDocKey(status)
                  ? 'Documents dated in the period. Tap a dealer to see its documents.'
                  : 'Tap a dealer to see its roles, people and job cards.'}
              </Text>
              {[...summary.dealers]
                .sort((a, b) => summaryCount(b, status) - summaryCount(a, status) || a.dealerName.localeCompare(b.dealerName))
                .map((d) => (
                  <TouchableOpacity key={d.dealerId} style={styles.dealerCard} onPress={() => openDealerFromCard(d.dealerId)} activeOpacity={0.8}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dealerCardName}>{d.dealerName.replace(/^MAGNEMITE MOTO LLP-/i, '')}</Text>
                      <Text style={styles.muted}>
                        Created {d.created} · Open {d.open} · In Progress {d.inProgress} · Ready {d.readyForDelivery} · Invoiced {d.invoiced} · Closed {d.closed}
                        {'\n'}Material Transfers {d.materialTransfers} · Repair Bills {d.repairBills}
                      </Text>
                    </View>
                    <Text style={styles.dealerCardCount}>{summaryCount(d, status)}</Text>
                  </TouchableOpacity>
                ))}
              {summary.dealers.length === 0 && <Text style={styles.muted}>No dealers to show.</Text>}
              <Text style={[styles.muted, { marginBottom: 24 }]}>
                Created = job cards created in the period · Open + In Progress + Ready for Delivery + Invoiced + Other = Created · Closed and Not Closed overlap those.
              </Text>
            </>
          )}
        </>
      )}

      {/* =============================== LEVEL 2: one dealer =============================== */}
      {dealerId && (
        <View style={styles.btnRow}>
          <TouchableOpacity style={[styles.chip, !isDocKey(status) && styles.chipOn]} onPress={() => { if (isDocKey(status)) setStatus('created') }}>
            <Text style={[styles.chipText, !isDocKey(status) && styles.chipTextOn]}>Job cards & roles</Text>
          </TouchableOpacity>
          {DOC_STAGES.map((d) => (
            <TouchableOpacity key={d.key} style={[styles.chip, status === d.key && styles.chipOn]} onPress={() => setStatus(d.key)}>
              <Text style={[styles.chipText, status === d.key && styles.chipTextOn]}>{d.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {dealerId && isDocKey(status) && (
        <>
          {docsLoading && <ActivityIndicator style={{ marginVertical: 12 }} color={colors.primary} />}
          {docsError && <Text style={styles.error}>{docsError}</Text>}
          {docs && !docsLoading && (
            <>
              <Text style={styles.dealerName}>{docs.dealer.name}{docs.dealer.code ? ` (${docs.dealer.code})` : ''}</Text>
              <Text style={styles.muted}>
                Period: {periodLabel(docs)} · {docs.total} {summaryLabel(status)}{docs.truncated ? ` - showing the latest ${docs.rows.length}` : ''} · Generated {fmtDateTime(docs.generatedAt)} IST
              </Text>
              {docs.rows.map((d) => {
                const open = docOpen === d.id
                return (
                  <TouchableOpacity key={d.id} style={styles.docCard} onPress={() => setDocOpen(open ? null : d.id)} activeOpacity={0.8}>
                    <View style={styles.docHead}>
                      <Text style={styles.docNo}>{open ? '▾' : '▸'} {d.number}</Text>
                      <Text style={styles.docAmount}>₹{d.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                    </View>
                    <Text style={styles.muted}>{fmtDateOnly(d.date)} · {d.status} · {d.type ?? '-'} · {d.location ?? '-'}</Text>
                    <Text style={styles.muted}>
                      {d.party ?? '-'}{status === 'repairBills' ? ` · ${d.regNo ?? '-'} · ${d.chassisNo ?? '-'}` : ''} · Job {d.jobNo ?? '-'} · {d.itemCount} item(s)
                      {status === 'repairBills' && d.preparedBy ? ` · by ${d.preparedBy}` : ''}
                    </Text>
                    {open && d.items.map((it, k) => (
                      <Text key={k} style={styles.docLine}>
                        • {it.code ?? '-'} - {it.description ?? '-'} · {it.itemType ?? '-'} · qty {it.qty} · ₹{it.rate.toLocaleString('en-IN', { maximumFractionDigits: 2 })} = ₹{it.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </Text>
                    ))}
                    {open && d.items.length === 0 && <Text style={styles.docLine}>No lines.</Text>}
                  </TouchableOpacity>
                )
              })}
              {docs.rows.length === 0 && <Text style={styles.muted}>No {summaryLabel(status).toLowerCase()} in this period.</Text>}
              <Text style={[styles.muted, { marginBottom: 24 }]}>Dated by the document's own date. Every status is counted; deleted Repair Bills are left out.</Text>
            </>
          )}
        </>
      )}

      {dealerId && !isDocKey(status) && loading && <ActivityIndicator style={{ marginVertical: 12 }} color={colors.primary} />}
      {dealerId && !isDocKey(status) && error && <Text style={styles.error}>{error}</Text>}

      {dealerId && !isDocKey(status) && report && t && !loading && (
        <>
          <Text style={styles.dealerName}>{report.dealer.name}{report.dealer.code ? ` (${report.dealer.code})` : ''}</Text>
          <Text style={styles.muted}>Period: {periodLabel(report)} · Generated {fmtDateTime(report.generatedAt)} IST</Text>

          <View style={styles.tiles}>
            {STAGES.map((s) => (
              <Tile key={s.key} label={s.label} value={countOf(t, s.key)} accent={s.accent} onPress={() => openDrill({ title: `${s.label} job cards`, stage: s.key })} />
            ))}
            <Tile label={allExpanded ? 'Staff ▲ hide' : 'Staff ▼ show'} value={`${t.activeUsers}/${t.users}`} accent="#0891b2" onPress={toggleStaff} />
          </View>

          {report.roles.length === 0 && <Text style={styles.muted}>No staff or job cards found for this dealer.</Text>}
          {report.roles.map((r) => {
            const isOpen = expanded.has(r.role)
            return (
              <View key={r.role} style={styles.roleCard}>
                <TouchableOpacity style={styles.roleHead} onPress={() => toggle(r.role)} activeOpacity={0.7}>
                  <Text style={styles.roleName}>{isOpen ? '▾' : '▸'} {r.role}</Text>
                  <Text style={styles.roleStaff}>{r.users} staff</Text>
                </TouchableOpacity>
                <View style={styles.statGrid}>
                  {STAGE_COLUMNS.map((c) => (
                    <Cnt
                      key={c.key}
                      label={c.label}
                      value={r[c.key]}
                      active={status === c.key}
                      onPress={() => openDrill({ title: `${c.label} job cards · ${r.role}`, stage: c.key, role: r.role })}
                    />
                  ))}
                </View>
                {isOpen && r.people.map((pp) => (
                  <View key={`${r.role}-${pp.userId ?? pp.name}`} style={styles.person}>
                    <TouchableOpacity onPress={() => openDrill({ title: `Job cards created · ${pp.name}`, stage: 'created', role: r.role, user: { id: pp.userId } })}>
                      <Text style={styles.personName}>
                        {pp.name}{pp.designation ? ` · ${pp.designation}` : ''}{!pp.active ? ' · inactive' : ''}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.statGrid}>
                      {STAGE_COLUMNS.map((c) => (
                        <Cnt
                          key={c.key}
                          small
                          label={c.label}
                          value={pp[c.key]}
                          active={status === c.key}
                          onPress={() => openDrill({ title: `${c.label} job cards · ${pp.name}`, stage: c.key, role: r.role, user: { id: pp.userId } })}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )
          })}
          <Text style={[styles.muted, { marginTop: 4 }]}>
            Created = job cards created by a user of that role · Open + In Progress + Ready for Delivery + Invoiced + Other = Created · Closed and Not Closed overlap those.
            {report.jobCardsTruncated ? ` Only the latest ${report.jobCards.length} job cards are listed; all counts are exact.` : ''}
          </Text>

          {drill && (
            <View style={styles.drill} onLayout={(e: LayoutChangeEvent) => { drillY.current = e.nativeEvent.layout.y }}>
              <View style={styles.drillHead}>
                <Text style={styles.drillTitle}>{drill.title} ({drillJobs.length})</Text>
                <TouchableOpacity style={styles.smallBtn} onPress={() => setDrill(null)}><Text style={styles.smallBtnText}>Close ✕</Text></TouchableOpacity>
              </View>
              {drillJobs.slice(0, shown).map((j) => (
                <TouchableOpacity key={j.id} style={styles.jobRow} onPress={() => navigation.navigate('JobCardDetail', { id: j.id })} activeOpacity={0.7}>
                  <Text style={styles.jobNo}>{j.jobCardNumber} · {j.stage ?? j.status}</Text>
                  <Text style={styles.muted}>{fmtDateTime(j.createdAt)} · {j.status} · by {j.createdBy} ({j.role})</Text>
                  <Text style={styles.muted}>{j.regNo ?? '-'} · {j.customerName ?? '-'}</Text>
                </TouchableOpacity>
              ))}
              {drillJobs.length === 0 && <Text style={styles.muted}>No job cards in this selection.</Text>}
              {drillJobs.length > shown && (
                <TouchableOpacity style={styles.smallBtn} onPress={() => setShown((n) => n + PAGE_STEP * 2)}>
                  <Text style={styles.smallBtnText}>Show more ({drillJobs.length - shown} remaining)</Text>
                </TouchableOpacity>
              )}
              {report.jobCardsTruncated && (
                <Text style={styles.muted}>Only the latest {report.jobCards.length} job cards were loaded, so this list may be shorter than the count shown above.</Text>
              )}
            </View>
          )}
          <View style={{ height: 24 }} />
        </>
      )}
    </ScrollView>
  )
}

function Tile({ label, value, accent, selected, onPress }: { label: string; value: string | number; accent: string; selected?: boolean; onPress?: () => void }) {
  return (
    <TouchableOpacity style={[styles.tile, { borderLeftColor: accent }, selected && styles.tileSelected]} onPress={onPress} disabled={!onPress} activeOpacity={0.7}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </TouchableOpacity>
  )
}

/** One count; tappable (and underlined) only when it is above zero - there is nothing to open for 0. */
function Cnt({ label, value, active, small, onPress }: { label: string; value: number; active?: boolean; small?: boolean; onPress: () => void }) {
  const body = (
    <View style={[styles.cnt, small && styles.cntSmall, active && styles.cntActive]}>
      <Text style={[styles.cntValue, small && styles.cntValueSmall, value > 0 && styles.cntLink]}>{value}</Text>
      <Text style={styles.cntLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
  return value > 0 ? <TouchableOpacity onPress={onPress} activeOpacity={0.6}>{body}</TouchableOpacity> : body
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 14 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  link: { fontSize: 14, color: colors.primary, fontWeight: '600', marginBottom: 6 },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 8 },
  error: { fontSize: 12, color: colors.danger, marginVertical: 6 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  formRow: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 },
  btnRow: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  smallBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  primaryBtn: { backgroundColor: colors.primary, borderColor: colors.primary },
  smallBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.text, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  excelBtn: { flex: 1, backgroundColor: '#16a34a', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  pdfBtn: { flex: 1, backgroundColor: '#dc2626', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  exportText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 6 },
  dealerName: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  tile: { width: '31.5%', backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, padding: 10 },
  tileSelected: { borderColor: colors.primary, borderWidth: 2, borderLeftWidth: 4 },
  tileValue: { fontSize: 18, fontWeight: '700', color: colors.text },
  tileLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  dealerCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  dealerCardName: { fontSize: 15, fontWeight: '700', color: colors.text },
  dealerCardCount: { fontSize: 24, fontWeight: '800', color: colors.primary },

  roleCard: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  roleHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roleName: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  roleStaff: { fontSize: 12, color: colors.textMuted },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  cnt: { width: 78, alignItems: 'center', paddingVertical: 4, borderRadius: 6 },
  cntSmall: { width: 70, paddingVertical: 2 },
  cntActive: { backgroundColor: '#eef4ff' },
  cntValue: { fontSize: 16, fontWeight: '700', color: colors.text },
  cntValueSmall: { fontSize: 14 },
  cntLink: { color: colors.primary, textDecorationLine: 'underline' },
  cntLabel: { fontSize: 9, color: colors.textMuted, marginTop: 1 },
  person: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  personName: { fontSize: 13, fontWeight: '600', color: colors.primary },

  drill: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 8 },
  drillHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 },
  drillTitle: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  jobRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  jobNo: { fontSize: 13, fontWeight: '700', color: colors.primary },

  docCard: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  docHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  docNo: { fontSize: 14, fontWeight: '700', color: colors.text, flexShrink: 1 },
  docAmount: { fontSize: 14, fontWeight: '700', color: colors.primary },
  docLine: { fontSize: 12, color: colors.text, marginTop: 4 },
})