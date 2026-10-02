import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { colors } from '../theme/colors'
import type { DmsBaplDataRepairBill } from '../types'

/**
 * "Repair Bill" report screen (Android/Expo) - 2026-10-02 ("for mobile also give this repair bill
 * and material transfer both page report"), the mobile counterpart of
 * web/src/pages/staff/RepairBillPage.tsx. Read-only view of DMSBAPLDATA's dbo.DMS_RepairBill (+
 * DMS_RepairBillItem child rows) - see DmsBaplDataService.cs's doc comment for what DMSBAPLDATA is.
 * Dealer scoping and the empty "Party Name" default mirror that web page's own SECTION 190 fix
 * exactly: a normal dealer login is forced to their own dealerBaplDmsCode, CorporateAdmin/
 * SystemAdmin see every dealer (dealerCode omitted), Party Name is an optional refinement search,
 * not a hardcoded "Zomato" filter.
 *
 * NAMED "RepairBillReportScreen" (not "RepairBillScreen") deliberately - this app already has an
 * UNRELATED "Repair Bill" feature on Android (RepairBillCreateScreen.tsx/RepairBillListScreen.tsx,
 * JobCardScannerDb-native Performa/Billed creation workflow). This screen is the read-only
 * DMSBAPLDATA report instead - same distinction web keeps between RepairBillCreatePage.tsx and
 * RepairBillPage.tsx, just made explicit in the mobile file/route name too so the two don't get
 * confused later.
 *
 * DELIBERATELY SIMPLER THAN THE WEB PAGE, flagged rather than silently dropped (same reasoning as
 * PartUploadScreen.tsx's own doc comment):
 *  - No native Excel/PDF export (ReportDownloadButtons/exportReport are web-only; a real .xlsx/.pdf
 *    file needs a React Native library - e.g. an xlsx writer and expo-print/expo-sharing - that I
 *    don't know is installed here). Instead, "Share Report" below builds the SAME flattened,
 *    one-row-per-item CSV data web's Excel/PDF export now produces (see REPORT_COLUMNS' own doc
 *    comment and web RepairBillPage.tsx's 2026-10-02 fix) and hands it to React Native's built-in
 *    Share sheet as CSV text - no extra dependency, works today, but the file that lands on the
 *    phone is shared/emailed text, not a formatted .xlsx or .pdf. Tell me if expo-print (PDF) and/
 *    or a CSV/XLSX writer are already dependencies of this app and I'll upgrade this to produce
 *    real files instead.
 *  - No "Import Chassis/Reg No List" filter (web's ImportExcelButton needs an Excel-parsing
 *    library on the client to read an uploaded .xlsx - same unconfirmed-library reasoning as above).
 *  - No shared Pagination/usePagination component - a FlatList with pull-to-refresh and no page
 *    cap instead (mobile lists scroll naturally; web's pager exists mainly for the HTML table).
 *
 * NOT YET ADDED to DashboardScreen.tsx's Actions list or wired into RootNavigator.tsx - see this
 * change's own delivery note for why (SECTION 172 trimmed that screen to an explicit 6-card list
 * per your own prior instruction, so I didn't add a 7th/8th card without checking first).
 */

const ORG_WIDE_ROLES = ['CorporateAdmin', 'SystemAdmin']

const billAmount = (b: DmsBaplDataRepairBill) => b.items.reduce((sum, i) => sum + (i.totAmnt ?? 0), 0)

type RepairBillExportRow = {
  bill: DmsBaplDataRepairBill
  item: DmsBaplDataRepairBill['items'][number] | null
}

function buildExportRows(bills: DmsBaplDataRepairBill[]): RepairBillExportRow[] {
  const rows: RepairBillExportRow[] = []
  for (const bill of bills) {
    if (bill.items.length === 0) rows.push({ bill, item: null })
    else for (const item of bill.items) rows.push({ bill, item })
  }
  return rows
}

// Same column set/order as web RepairBillPage.tsx's REPORT_COLUMNS, see that file's own doc
// comment - one row per repair bill ITEM, bill-level fields repeated on each row.
const EXPORT_COLUMNS: { header: string; value: (r: RepairBillExportRow) => string | number }[] = [
  { header: 'Invoice No', value: ({ bill }) => bill.invoiceNo ?? '' },
  { header: 'Invoice Date', value: ({ bill }) => (bill.invoiceDate ? new Date(bill.invoiceDate).toLocaleDateString('en-IN') : '') },
  { header: 'Dealer', value: ({ bill }) => bill.dealerName ?? bill.dealerCode ?? '' },
  { header: 'Party Name', value: ({ bill }) => bill.partyName ?? '' },
  { header: 'Reg No', value: ({ bill }) => bill.regNo ?? '' },
  { header: 'Chassis No', value: ({ bill }) => bill.chassisNo ?? '' },
  { header: 'Location', value: ({ bill }) => bill.location ?? '' },
  { header: 'Bill Type', value: ({ bill }) => bill.billType ?? '' },
  { header: 'Item Code', value: ({ item }) => item?.itemCode ?? '' },
  { header: 'Item Description', value: ({ item }) => item?.itemDesc ?? '' },
  { header: 'Item Type', value: ({ item }) => item?.itemType ?? '' },
  { header: 'Qty', value: ({ item }) => item?.qty ?? '' },
  { header: 'Rate', value: ({ item }) => item?.rate ?? '' },
  { header: 'Issue Type', value: ({ item }) => item?.issueType ?? '' },
  { header: 'CGST', value: ({ item }) => item?.cgstAmount ?? '' },
  { header: 'SGST', value: ({ item }) => item?.sgstAmount ?? '' },
  { header: 'IGST', value: ({ item }) => item?.igstAmount ?? '' },
  { header: 'Item Total', value: ({ item }) => item?.totAmnt ?? '' },
  { header: 'Bill Amount', value: ({ bill }) => billAmount(bill) },
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

export function RepairBillReportScreen() {
  const { profile } = useStaffAuth()
  const isOrgWide = !!profile && ORG_WIDE_ROLES.includes(profile.role)

  const [party, setParty] = useState('')
  const [bills, setBills] = useState<DmsBaplDataRepairBill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const search = () => {
    // Same "show nothing rather than silently show everything" safety default as web - a
    // non-org-wide user with no dealerBaplDmsCode on file has no scope to show.
    if (!isOrgWide && !profile?.dealerBaplDmsCode) {
      setBills([])
      setError(profile ? 'Your account has no DMS dealer code on file - contact your admin.' : null)
      return
    }
    setLoading(true)
    setError(null)
    apiClient
      .get<DmsBaplDataRepairBill[]>('/api/dms-bapl-data/repair-bills', {
        params: {
          party: party || undefined,
          dealerCode: isOrgWide ? undefined : profile?.dealerBaplDmsCode ?? undefined,
        },
      })
      .then((r: any) => setBills(r.data))
      .catch((err: unknown) => {
        setBills([])
        setError(describeError(err, 'Could not reach DMSBAPLDATA - check the connection and try again.'))
      })
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { search() }, [profile?.dealerBaplDmsCode, isOrgWide])

  const exportRows = useMemo(() => buildExportRows(bills), [bills])

  const shareReport = async () => {
    if (exportRows.length === 0) return
    const header = EXPORT_COLUMNS.map((c) => csvEscape(c.header)).join(',')
    const lines = exportRows.map((r) => EXPORT_COLUMNS.map((c) => csvEscape(c.value(r))).join(','))
    const csv = [header, ...lines].join('\n')
    try {
      await Share.share({ message: csv, title: 'Repair_Bill_Report.csv' })
    } catch {
      // User cancelled the share sheet, or the OS share call failed - nothing actionable to show.
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.searchCard}>
        <Text style={styles.subtitle}>
          {isOrgWide
            ? 'Synced repair bill data from DMSBAPLDATA, across every dealer.'
            : 'Synced repair bill data from DMSBAPLDATA for your own dealer.'}
        </Text>
        <Text style={styles.label}>Party Name (optional)</Text>
        <TextInput
          style={styles.input}
          value={party}
          onChangeText={setParty}
          onSubmitEditing={search}
          placeholder="Leave blank to show every party"
          returnKeyType="search"
        />
        <View style={styles.buttonRow}>
          <Pressable style={styles.button} onPress={search} disabled={loading}>
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

      {loading && bills.length === 0 && <ActivityIndicator style={{ marginTop: 16 }} color={colors.primary} />}
      <FlatList
        data={bills}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={{ padding: 16, paddingTop: 0 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={search} />}
        ListEmptyComponent={!loading ? <Text style={styles.muted}>No repair bills found{party ? ` for "${party}"` : ''}.</Text> : null}
        renderItem={({ item: b }) => {
          const expanded = expandedId === b.id
          return (
            <View style={styles.billCard}>
              <Pressable onPress={() => setExpandedId(expanded ? null : b.id)}>
                <View style={styles.billHeaderRow}>
                  <Text style={styles.billInvoice}>{b.invoiceNo ?? '—'}</Text>
                  <Text style={styles.billAmount}>₹{billAmount(b).toFixed(2)}</Text>
                </View>
                <Text style={styles.muted}>{b.invoiceDate ? new Date(b.invoiceDate).toLocaleDateString('en-IN') : '—'} · {b.dealerName ?? b.dealerCode ?? '—'}</Text>
                <Text style={styles.muted}>{b.partyName ?? '—'} · {b.regNo ?? b.chassisNo ?? '—'}</Text>
                <Text style={styles.muted}>{b.location ?? '—'} · {b.items.length} item{b.items.length === 1 ? '' : 's'} {expanded ? '▾' : '▸'}</Text>
              </Pressable>
              {expanded && (
                <View style={styles.itemsBlock}>
                  {b.items.map((it) => (
                    <View key={it.id} style={styles.itemRow}>
                      <Text style={styles.itemName}>{it.itemCode ?? '—'} — {it.itemDesc ?? '—'}</Text>
                      <Text style={styles.muted}>
                        Qty {it.qty ?? '—'} · Rate ₹{it.rate?.toFixed(2) ?? '—'} · {it.issueType ?? '—'}
                      </Text>
                      <Text style={styles.muted}>
                        CGST ₹{it.cgstAmount?.toFixed(2) ?? '0.00'} · SGST ₹{it.sgstAmount?.toFixed(2) ?? '0.00'} · IGST ₹{it.igstAmount?.toFixed(2) ?? '0.00'} · Total ₹{it.totAmnt?.toFixed(2) ?? '—'}
                      </Text>
                    </View>
                  ))}
                  {b.items.length === 0 && <Text style={styles.muted}>No line items on this bill.</Text>}
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
  subtitle: { fontSize: 12, color: colors.textMuted, marginBottom: 10 },
  label: { fontSize: 12, fontWeight: '600', color: colors.text, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.text },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  button: { flex: 1, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  buttonSecondary: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  buttonSecondaryText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  errorText: { color: '#b00020', marginTop: 8, fontSize: 13 },
  muted: { fontSize: 12, color: colors.textMuted },
  billCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  billHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  billInvoice: { fontSize: 15, fontWeight: '700', color: colors.text },
  billAmount: { fontSize: 15, fontWeight: '700', color: colors.primary },
  itemsBlock: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
  itemRow: { gap: 2 },
  itemName: { fontSize: 13, fontWeight: '600', color: colors.text },
})
