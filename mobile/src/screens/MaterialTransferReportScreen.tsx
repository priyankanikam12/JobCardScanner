// mobile\src\screens\MaterialTransferReportScreen.tsx
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from 'react-native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { colors } from '../theme/colors'
import { PickerField } from '../components/PickerField'
import type { BaplDmsWorkshop, DmsBaplDataMaterialTransfer } from '../types'

/**
 * "Material Transfer" report screen (Android/Expo) - 2026-10-02 ("for mobile also give this
 * repair bill and material transfer both page report"), the mobile counterpart of
 * web/src/pages/staff/MaterialTransferPage.tsx. Read-only view of DMSBAPLDATA's
 * dbo.DMS_MaterialTransfer (+ DMS_MaterialTransferItem/DMS_MaterialTransferLabor child rows),
 * scoped to one dealer's own DMS workshop LocCode - same GET /api/bapl-dms/workshops resolution
 * PartUploadScreen.tsx already uses, and the same SECTION 190 org-wide Dealer picker
 * (GET /api/dashboard/corporate/filters) web's MaterialTransferPage.tsx added, here built with
 * PickerField (mobile/src/components/PickerField.tsx) instead of an HTML <select>.
 *
 * NAMED "MaterialTransferReportScreen" (not "MaterialTransferScreen") deliberately - this app
 * already has an UNRELATED "Material Transfer Bill" feature on Android
 * (MaterialTransferCreateScreen.tsx, JobCardScannerDb-native creation workflow). This screen is
 * the read-only DMSBAPLDATA report instead - see RepairBillReportScreen.tsx's own doc comment for
 * the same naming rationale applied there.
 *
 * NOT WIRED IN YET on the backend: same open item as web's MaterialTransferPage.tsx - I still
 * don't have BaplDmsController.cs (the controller behind GET /api/bapl-dms/workshops) in this
 * session, so I can't confirm it accepts an arbitrary `dealerId` from an org-wide caller rather
 * than silently forcing the caller's own. Paste that controller and I'll verify/fix this screen's
 * org-wide picker the same time as web's.
 *
 * DELIBERATELY SIMPLER THAN THE WEB PAGE, flagged rather than silently dropped - same reasoning as
 * RepairBillReportScreen.tsx's own doc comment:
 *  - No native Excel/PDF export - "Share Report" below shares the same flattened, one-row-per-item
 *    (+ Labour column) data as CSV text via React Native's built-in Share sheet instead. Tell me if
 *    a PDF/XLSX library is already a dependency here and I'll upgrade this to produce real files.
 *  - No "Import Doc No List" filter (needs a client-side Excel-parsing library, not confirmed
 *    installed).
 *  - No shared Pagination component - a FlatList with pull-to-refresh instead.
 *
 * NOT YET ADDED to DashboardScreen.tsx's Actions list or wired into RootNavigator.tsx - see this
 * change's own delivery note (SECTION 172 trimmed that screen to an explicit 6-card list per your
 * own prior instruction, so I didn't add a 7th/8th card without checking first).
 */

const ORG_WIDE_ROLES = ['CorporateAdmin', 'SystemAdmin']

interface DealerOption {
  id: string
  name: string
}

type MaterialTransferExportRow = {
  transfer: DmsBaplDataMaterialTransfer
  item: DmsBaplDataMaterialTransfer['items'][number] | null
}

function buildExportRows(transfers: DmsBaplDataMaterialTransfer[]): MaterialTransferExportRow[] {
  const rows: MaterialTransferExportRow[] = []
  for (const transfer of transfers) {
    if (transfer.items.length === 0) rows.push({ transfer, item: null })
    else for (const item of transfer.items) rows.push({ transfer, item })
  }
  return rows
}

const formatLabour = (item: DmsBaplDataMaterialTransfer['items'][number] | null) =>
  item && item.labour.length > 0
    ? item.labour.map((l) => `${l.lbrName ?? l.lbrDescription ?? '—'} (₹${l.lbrRate.toFixed(2)})`).join('; ')
    : ''

const itemAmount = (i: DmsBaplDataMaterialTransfer['items'][number]) =>
  i.qty * i.rate - i.discount + i.sgstAmount + i.cgstAmount + i.igstAmount

// Same column set/order as web MaterialTransferPage.tsx's REPORT_COLUMNS - one row per item,
// document-level fields repeated on each row, plus a Labour column.
const EXPORT_COLUMNS: { header: string; value: (r: MaterialTransferExportRow) => string | number }[] = [
  { header: 'Doc No', value: ({ transfer }) => transfer.docNo ?? '' },
  { header: 'Doc Date', value: ({ transfer }) => (transfer.docDate ? new Date(transfer.docDate).toLocaleDateString('en-IN') : '') },
  { header: 'Dealer', value: ({ transfer }) => transfer.dealerName ?? transfer.dealerCode ?? '' },
  { header: 'Location', value: ({ transfer }) => transfer.location ?? transfer.locCode ?? '' },
  { header: 'Technician', value: ({ transfer }) => transfer.technicianName ?? '' },
  { header: 'Doc Type', value: ({ transfer }) => transfer.docType ?? '' },
  { header: 'Item Code / Name', value: ({ item }) => item?.itemName ?? '' },
  { header: 'Item Description', value: ({ item }) => item?.itemDescription ?? '' },
  { header: 'Item Type', value: ({ item }) => item?.itemType ?? '' },
  { header: 'Qty', value: ({ item }) => item?.qty ?? '' },
  { header: 'Rate', value: ({ item }) => item?.rate ?? '' },
  { header: 'MRP', value: ({ item }) => item?.mrp ?? '' },
  { header: 'Item Amount', value: ({ item }) => (item ? itemAmount(item) : '') },
  { header: 'Labour', value: ({ item }) => formatLabour(item) },
]

function csvEscape(v: string | number): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function describeError(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { message?: string } } }
  const detail = e?.response?.data?.message
  const status = e?.response?.status
  if (detail) return `${fallback} (${detail})`
  if (status) return `${fallback} (HTTP ${status})`
  return `${fallback} (no response reached the server - check your connection)`
}

export function MaterialTransferReportScreen() {
  const { profile } = useStaffAuth()
  const isOrgWide = !!profile && ORG_WIDE_ROLES.includes(profile.role)

  const [dealers, setDealers] = useState<DealerOption[]>([])
  const [selectedDealerId, setSelectedDealerId] = useState('')

  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  const [locCode, setLocCode] = useState('')
  const [transfers, setTransfers] = useState<DmsBaplDataMaterialTransfer[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    if (!isOrgWide) return
    apiClient
      .get<{ dealers: DealerOption[] }>('/api/dashboard/corporate/filters')
      .then(({ data }: any) => {
        setDealers(data.dealers)
        setSelectedDealerId((prev) => prev || data.dealers[0]?.id || '')
      })
      .catch(() => setDealers([]))
  }, [isOrgWide])

  const effectiveDealerId = isOrgWide ? selectedDealerId : profile?.dealerId

  useEffect(() => {
    if (!effectiveDealerId) return
    setLocCode('')
    apiClient
      .get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: effectiveDealerId } })
      .then(({ data }: any) => {
        const scoped = !isOrgWide && profile?.workLocationCodes?.length
          ? data.filter((w: BaplDmsWorkshop) => profile.workLocationCodes.includes(w.locCode))
          : data
        setWorkshops(scoped)
        if (scoped.length > 0) setLocCode((prev) => prev || scoped[0].locCode)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveDealerId, isOrgWide])

  const search = () => {
    if (!locCode) { setTransfers([]); return }
    setLoading(true)
    setError(null)
    apiClient
      .get<DmsBaplDataMaterialTransfer[]>('/api/dms-bapl-data/material-transfers', { params: { locCode } })
      .then((r: any) => setTransfers(r.data))
      .catch((err: unknown) => {
        setTransfers([])
        setError(describeError(err, 'Could not reach DMSBAPLDATA - check the connection and try again.'))
      })
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { search() }, [locCode])

  const exportRows = useMemo(() => buildExportRows(transfers), [transfers])

  const shareReport = async () => {
    if (exportRows.length === 0) return
    const header = EXPORT_COLUMNS.map((c) => csvEscape(c.header)).join(',')
    const lines = exportRows.map((r) => EXPORT_COLUMNS.map((c) => csvEscape(c.value(r))).join(','))
    const csv = [header, ...lines].join('\n')
    try {
      await Share.share({ message: csv, title: 'Material_Transfer_Report.csv' })
    } catch {
      // User cancelled the share sheet, or the OS share call failed - nothing actionable to show.
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.searchCard}>
        {isOrgWide && (
          <PickerField
            label="Dealer"
            value={selectedDealerId}
            options={dealers.map((d) => ({ label: d.name, value: d.id }))}
            onChange={setSelectedDealerId}
            placeholder={dealers.length === 0 ? 'Loading dealers…' : 'Select dealer'}
          />
        )}
        <View style={{ marginTop: isOrgWide ? 10 : 0 }}>
          {workshops.length > 0 ? (
            <PickerField
              label="DMS workshop location"
              value={locCode}
              options={workshops.map((w) => ({ label: `${w.locCode} — ${w.locName}`, value: w.locCode }))}
              onChange={setLocCode}
            />
          ) : (
            <Text style={styles.muted}>No workshop locations found{isOrgWide && !selectedDealerId ? ' - select a dealer above' : ''}.</Text>
          )}
        </View>
        <View style={styles.buttonRow}>
          <Pressable style={styles.button} onPress={search} disabled={loading || !locCode}>
            <Text style={styles.buttonText}>{loading ? 'Loading…' : '↻ Search'}</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.buttonSecondary, exportRows.length === 0 && styles.buttonDisabled]}
            onPress={shareReport}
            disabled={exportRows.length === 0}
          >
            <Text style={styles.buttonSecondaryText}>Share Report</Text>
          </Pressable>
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      {loading && transfers.length === 0 && <ActivityIndicator style={{ marginTop: 16 }} color={colors.primary} />}
      <FlatList
        data={transfers}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ padding: 16, paddingTop: 0 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={search} />}
        ListEmptyComponent={!loading && locCode ? <Text style={styles.muted}>No material transfers found at "{locCode}".</Text> : null}
        renderItem={({ item: t }) => {
          const expanded = expandedId === t.id
          return (
            <View style={styles.transferCard}>
              <Pressable onPress={() => setExpandedId(expanded ? null : t.id)}>
                <View style={styles.transferHeaderRow}>
                  <Text style={styles.transferDoc}>{t.docNo ?? '—'}</Text>
                  <Text style={styles.muted}>{t.docDate ? new Date(t.docDate).toLocaleDateString('en-IN') : '—'}</Text>
                </View>
                <Text style={styles.muted}>{t.dealerName ?? t.dealerCode ?? '—'} · {t.location ?? t.locCode ?? '—'}</Text>
                <Text style={styles.muted}>{t.technicianName ?? '—'} · {t.items.length} item{t.items.length === 1 ? '' : 's'} {expanded ? '▾' : '▸'}</Text>
              </Pressable>
              {expanded && (
                <View style={styles.itemsBlock}>
                  {t.items.map((it) => (
                    <View key={it.id} style={styles.itemRow}>
                      <Text style={styles.itemName}>{it.itemName ?? '—'} — {it.itemDescription ?? '—'}</Text>
                      <Text style={styles.muted}>
                        Qty {it.qty} · Rate ₹{it.rate.toFixed(2)} · MRP ₹{it.mrp.toFixed(2)} · Amount ₹{itemAmount(it).toFixed(2)}
                      </Text>
                      {it.labour.length > 0 && (
                        <Text style={styles.muted}>Labour: {formatLabour(it)}</Text>
                      )}
                    </View>
                  ))}
                  {t.items.length === 0 && <Text style={styles.muted}>No line items on this document.</Text>}
                </View>
              )}
            </View>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  searchCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border, margin: 16, marginBottom: 8 },
  muted: { fontSize: 12, color: colors.textMuted },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  button: { flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  buttonSecondary: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  buttonSecondaryText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  errorText: { color: '#b00020', marginTop: 8, fontSize: 13 },
  transferCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  transferHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  transferDoc: { fontSize: 15, fontWeight: '700', color: colors.text },
  itemsBlock: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
  itemRow: { gap: 2 },
  itemName: { fontSize: 13, fontWeight: '600', color: colors.text },
})
