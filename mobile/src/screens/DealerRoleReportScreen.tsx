// mobile\src\screens\DealerRoleReportScreen.tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { PickerField, type PickerOption } from '../components/PickerField'
import { colors } from '../theme/colors'
import {
  closurePct, fmtDateTime, periodLabel, shareDealerRoleReportExcel, shareDealerRoleReportPdf,
  type DealerRoleReport,
} from '../utils/dealerRoleReportExport'

/**
 * Dealer Role Report (Android) - 2026-10-05, the counterpart of web's DealerRoleReportPage.tsx (see
 * that file's doc comment for the full request and for what Submitted/Open/Closed mean - the numbers
 * come from the same GET /api/dashboard/dealer-role-report, DealerRoleReportController.cs).
 *
 * Pick a dealer (every active dealer, GET /api/dealers) -> summary tiles + one card per role; tap a
 * role card to expand the people under it. "Excel" / "PDF" build the same files web downloads and
 * open the Android share sheet (Save to Files / Drive / WhatsApp / email). The optional "From"/"To"
 * boxes filter on the job card's created date (YYYY-MM-DD); leave both empty for all time.
 *
 * Reached from the Dashboard's "Dealer Role Report" card, shown to CorporateAdmin/SystemAdmin only -
 * the endpoint itself is also gated CorporateAdminUp, so a hidden card is not the only protection.
 * "Active dealer": same defensive rule as web - a dealer is dropped only if its row carries `active`
 * or `isActive` = false; if the Dealer model has no such flag, every dealer is listed.
 */
type DealerRow = { id: string; name?: string; active?: boolean; isActive?: boolean }

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

export function DealerRoleReportScreen() {
  const [dealers, setDealers] = useState<PickerOption[]>([])
  const [dealersError, setDealersError] = useState<string | null>(null)
  const [dealerId, setDealerId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [report, setReport] = useState<DealerRoleReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  useEffect(() => {
    apiClient
      .get<DealerRow[]>('/api/dealers')
      .then(({ data }) => {
        const rows = Array.isArray(data) ? data : []
        setDealers(
          rows
            .filter((d) => d.active !== false && d.isActive !== false)
            .map((d) => ({ label: d.name ?? d.id, value: d.id }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        )
      })
      .catch(() => setDealersError('Could not load the dealer list.'))
  }, [])

  // Takes the dates as arguments (defaulting to the current state) so "Clear dates" can reload with
  // empty values immediately - reading state right after setState would still see the old dates.
  const load = (fromVal: string = dateFrom, toVal: string = dateTo) => {
    if (!dealerId) return
    // A half-typed date would only send a bad request - ignore it until it is a full YYYY-MM-DD.
    const from = isIsoDate(fromVal) ? fromVal : undefined
    const to = isIsoDate(toVal) ? toVal : undefined
    setLoading(true)
    setError(null)
    setExpanded(new Set())
    apiClient
      .get<DealerRoleReport>('/api/dashboard/dealer-role-report', { params: { dealerId, dateFrom: from, dateTo: to } })
      .then(({ data }) => setReport(data))
      .catch((err: { response?: { data?: { message?: string } } }) => {
        setReport(null)
        setError(err?.response?.data?.message ?? 'Could not load the report for this dealer.')
      })
      .finally(() => setLoading(false))
  }

  // Reload whenever the dealer changes; date edits apply on the Apply button, not on every keystroke.
  useEffect(() => {
    if (!dealerId) { setReport(null); return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealerId])

  const toggle = (role: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })

  const runExport = async (kind: 'excel' | 'pdf') => {
    if (!report) return
    setExporting(kind)
    try {
      if (kind === 'excel') await shareDealerRoleReportExcel(report)
      else await shareDealerRoleReportPdf(report)
    } catch (err) {
      Alert.alert('Could not create the file', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setExporting(null)
    }
  }

  const t = report?.totals

  return (
    <ScrollView style={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Dealer Role Report</Text>
      <Text style={styles.muted}>Pick a dealer to see, role by role, how many job cards were submitted, are open and are closed.</Text>

      <PickerField
        label="Dealer"
        value={dealerId}
        options={dealers}
        placeholder={dealers.length ? 'Select a dealer…' : 'No active dealers found'}
        onChange={setDealerId}
      />
      {dealersError && <Text style={styles.error}>{dealersError}</Text>}

      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Created from</Text>
          <TextInput style={styles.input} value={dateFrom} onChangeText={setDateFrom} placeholder="YYYY-MM-DD" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Created to</Text>
          <TextInput style={styles.input} value={dateTo} onChangeText={setDateTo} placeholder="YYYY-MM-DD" />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <TouchableOpacity style={[styles.smallBtn, !dealerId && styles.disabled]} disabled={!dealerId} onPress={() => load()}>
          <Text style={styles.smallBtnText}>Apply dates</Text>
        </TouchableOpacity>
        {(dateFrom !== '' || dateTo !== '') && (
          <TouchableOpacity style={styles.smallBtn} onPress={() => { setDateFrom(''); setDateTo(''); load('', '') }}>
            <Text style={styles.smallBtnText}>Clear dates</Text>
          </TouchableOpacity>
        )}
      </View>

      {!dealerId && <Text style={styles.muted}>Select a dealer above to open its report.</Text>}
      {loading && <ActivityIndicator style={{ marginVertical: 12 }} color={colors.primary} />}
      {error && <Text style={styles.error}>{error}</Text>}

      {report && t && !loading && (
        <>
          <Text style={styles.dealerName}>{report.dealer.name}{report.dealer.code ? ` (${report.dealer.code})` : ''}</Text>
          <Text style={styles.muted}>Period: {periodLabel(report)} · Generated {fmtDateTime(report.generatedAt)} IST</Text>

          <View style={styles.tiles}>
            <Tile label="Submitted" value={t.submitted} accent={colors.primary} />
            <Tile label="Open" value={t.open} accent={colors.amber} />
            <Tile label="Closed" value={t.closed} accent={colors.success} />
            <Tile label="Cancelled" value={t.cancelled} accent="#94a3b8" />
            <Tile label="Closure rate" value={`${closurePct(t.closed, t.submitted)}%`} accent="#7c3aed" />
            <Tile label="Staff (active/all)" value={`${t.activeUsers}/${t.users}`} accent="#0891b2" />
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
            <TouchableOpacity style={[styles.excelBtn, exporting !== null && styles.disabled]} disabled={exporting !== null} onPress={() => runExport('excel')}>
              <Text style={styles.exportText}>{exporting === 'excel' ? 'Preparing…' : '⬇ Excel'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.pdfBtn, exporting !== null && styles.disabled]} disabled={exporting !== null} onPress={() => runExport('pdf')}>
              <Text style={styles.exportText}>{exporting === 'pdf' ? 'Preparing…' : '⬇ PDF'}</Text>
            </TouchableOpacity>
          </View>

          {report.roles.length === 0 && <Text style={styles.muted}>No staff or job cards found for this dealer.</Text>}
          {report.roles.map((r) => {
            const isOpen = expanded.has(r.role)
            return (
              <TouchableOpacity key={r.role} style={styles.roleCard} onPress={() => toggle(r.role)} activeOpacity={0.8}>
                <View style={styles.roleHead}>
                  <Text style={styles.roleName}>{isOpen ? '▾' : '▸'} {r.role}</Text>
                  <Text style={styles.roleStaff}>{r.users} staff</Text>
                </View>
                <View style={styles.statRow}>
                  <Stat label="Submitted" value={r.submitted} bold />
                  <Stat label="Open" value={r.open} color={colors.amber} />
                  <Stat label="Closed" value={r.closed} color={colors.success} />
                  <Stat label="Cancelled" value={r.cancelled} />
                  <Stat label="Closure" value={`${closurePct(r.closed, r.submitted)}%`} />
                </View>
                {isOpen && r.people.map((p) => (
                  <View key={`${r.role}-${p.userId ?? p.name}`} style={styles.person}>
                    <Text style={styles.personName}>
                      {p.name}{p.designation ? ` · ${p.designation}` : ''}{!p.active ? ' · inactive' : ''}
                    </Text>
                    <Text style={styles.personStats}>
                      Submitted {p.submitted} · Open {p.open} · Closed {p.closed} · Cancelled {p.cancelled}
                    </Text>
                  </View>
                ))}
              </TouchableOpacity>
            )
          })}

          <Text style={[styles.muted, { marginTop: 6, marginBottom: 24 }]}>
            Submitted = job cards created by a user of that role · Open = not Closed and not Cancelled.
            {report.jobCardsTruncated ? ` The downloaded job-card list shows the latest ${report.jobCards.length}; all counts are exact.` : ''}
          </Text>
        </>
      )}
    </ScrollView>
  )
}

function Tile({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <View style={[styles.tile, { borderLeftColor: accent }]}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  )
}

function Stat({ label, value, color, bold }: { label: string; value: string | number; color?: string; bold?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null, bold ? { fontWeight: '800' } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 14 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 8 },
  error: { fontSize: 12, color: colors.danger, marginVertical: 6 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  formRow: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 },
  smallBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
  disabled: { opacity: 0.5 },

  dealerName: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  tile: { width: '31.5%', backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, padding: 10 },
  tileValue: { fontSize: 18, fontWeight: '700', color: colors.text },
  tileLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  excelBtn: { flex: 1, backgroundColor: '#16a34a', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  pdfBtn: { flex: 1, backgroundColor: '#dc2626', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  exportText: { color: '#fff', fontWeight: '700' },

  roleCard: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  roleHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roleName: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  roleStaff: { fontSize: 12, color: colors.textMuted },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 16, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  person: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  personName: { fontSize: 13, fontWeight: '600', color: colors.text },
  personStats: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
})