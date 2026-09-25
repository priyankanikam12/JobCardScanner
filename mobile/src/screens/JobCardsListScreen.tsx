// mobile\src\screens\JobCardsListScreen.tsx
import { useEffect, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { apiClient } from '../api/client'
import { Badge } from '../components/Badge'
import type { JobCardListResponse, JobCardSummary } from '../types'
import type { JobCardsListFilter, RootStackParamList } from '../navigation/RootNavigator'
import { colors } from '../theme/colors'

type Props = NativeStackScreenProps<RootStackParamList, 'JobCardsList'>

// Short human label for the active Dashboard deep-link filter, shown as a dismissible chip -
// mirrors web's Dashboard "Job Cards"/Quick Links deep-links landing on an already-filtered list.
const FILTER_LABELS: Record<string, string> = {
  status: 'Status',
  stageKey: 'Stage',
  excludeClosed: 'Open job cards',
  overdue: 'Overdue',
  createdToday: 'Created today',
  deliveredToday: 'Delivered today',
  closedThisMonth: 'Closed this month',
  warrantyOnly: 'Warranty',
  pendingBucket: 'Pending',
}

function describeFilter(filter: JobCardsListFilter | undefined): string | null {
  if (!filter) return null
  const key = (Object.keys(filter) as (keyof JobCardsListFilter)[]).find((k) => filter[k])
  if (!key) return null
  if (key === 'status' || key === 'stageKey') return `${FILTER_LABELS[key]}: ${filter[key]}`
  return FILTER_LABELS[key]
}

export function JobCardsListScreen({ navigation, route }: Props) {
  // Dashboard KPI cards deep-link here with one of these set (e.g. { excludeClosed: true } or
  // { status: 'PendingCustomerApproval' }) - see DashboardScreen.tsx's KPIS array.
  const filter = route.params
  const [jobCards, setJobCards] = useState<JobCardSummary[]>([])
  // Non-null only when a real DMS problem (not "this dealer has no DMS data", which is
  // normal and silent) kept its job cards out of the blended list below - mirrors
  // web/src/pages/staff/JobCardsListPage.tsx.
  const [baplDmsWarning, setBaplDmsWarning] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = () => {
    setRefreshing(true)
    apiClient
      .get<JobCardListResponse>('/api/jobcards', { params: { q: q || undefined, ...filter } })
      .then((r) => { setJobCards(r.data.items); setBaplDmsWarning(r.data.baplDmsWarning ?? null) })
      .finally(() => setRefreshing(false))
  }

  // Re-fetches whenever the filter changes - covers both the initial mount and the filter chip's
  // "clear" (navigation.setParams below) or a fresh Dashboard deep-link landing on an
  // already-mounted instance of this screen (React Navigation updates route.params in place
  // rather than remounting).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [JSON.stringify(filter)])

  // Item 11: search-as-you-type (debounced) instead of requiring the keyboard's search key -
  // matches web's same change. The backend already substring-matches job card #, customer
  // name/mobile and reg no.
  useEffect(() => {
    const handle = setTimeout(load, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const activeFilterLabel = describeFilter(filter)

  return (
    <View style={styles.screen}>
      {/* Toolbar strip below the native navy header - kept light (not navy) so it doesn't double
          up with the navigator's own navy header bar. "+ New" uses the amber accent as the
          primary call-to-action color (Hub Pulse reskin). */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TextInput
            style={[styles.search, { flex: 1, marginBottom: 0 }]}
            placeholder="Search job card #, customer, reg no..."
            placeholderTextColor={colors.textMuted}
            value={q}
            onChangeText={setQ}
            onSubmitEditing={load}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('JobCardWizard')}>
            <Text style={styles.newBtnText}>+ New</Text>
          </TouchableOpacity>
        </View>
        {activeFilterLabel && (
          <TouchableOpacity style={styles.filterChip} onPress={() => navigation.setParams({ status: undefined, stageKey: undefined, excludeClosed: undefined, overdue: undefined, createdToday: undefined, deliveredToday: undefined, closedThisMonth: undefined, warrantyOnly: undefined, pendingBucket: undefined })}>
            <Text style={styles.filterChipText}>Filter: {activeFilterLabel} ✕</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.container}>
      {baplDmsWarning && <Text style={styles.warning}>⚠ {baplDmsWarning}</Text>}
      <FlatList
        data={jobCards}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => {
          const isBapl = item.source === 'BaplDms'
          return (
            <Pressable
              style={styles.row}
              disabled={isBapl}
              onPress={() => !isBapl && navigation.navigate('JobCardDetail', { id: item.id })}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.jcNumber}>{item.jobCardNumber}</Text>
                  {isBapl && <Text style={styles.dmsBadge}>DMS</Text>}
                </View>
                <Text style={styles.muted}>{item.customerName} - {item.vehicleModel} {item.vehicleRegNo}</Text>
                <Text style={styles.muted}>{isBapl ? '-' : item.stageLabel}</Text>
                {!isBapl && (item.photoCount ?? 0) > 0 && <Text style={styles.photoCount}>📷 {item.photoCount}</Text>}
              </View>
              <Badge status={item.status} />
            </Pressable>
          )
        }}
        ListEmptyComponent={<Text style={styles.muted}>No job cards found.</Text>}
      />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.surface, paddingTop: 10, paddingBottom: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  container: { flex: 1, padding: 12 },
  headerRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  search: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.text },
  newBtn: { backgroundColor: colors.amber, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12 },
  newBtnText: { color: '#fff', fontWeight: '700' },
  warning: { fontSize: 12, color: '#92400e', marginBottom: 8 },
  // Filter chip uses the navy "selected" chip state - a filter deep-link from Dashboard is an
  // active, dismissible selection, matching the reference app's 3-state chip semantics.
  filterChip: { alignSelf: 'flex-start', backgroundColor: colors.navy, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 10 },
  filterChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  row: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  jcNumber: { fontSize: 15, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  photoCount: { fontSize: 12, color: colors.primary, marginTop: 2 },
  // DMS badge uses the amber "done/confirmed" chip treatment - this row's data is confirmed
  // synced-from-DMS, matching the reference app's amber "✓ done" pill state.
  dmsBadge: { backgroundColor: colors.amber, color: '#fff', fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: 'hidden' },
})
