import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { colors } from '../theme/colors'
import type { JobSearchResult } from '../types'

/**
 * "Job Search" picker for Material Transfer Bill/Repair Bill (2026-09-21, "add changes in android
 * also") - mirrors web/src/components/JobSearchModal.tsx: a full-screen modal, debounced
 * search-as-you-type against GET /api/jobcards/search?q=... (this app's OWN JobCards only, not a
 * blended DMS view - JobCardId on both doc types is a local FK, same as web). Picking a row calls
 * onSelect and closes.
 *
 * FACT, discovered while adding onlyWithMaterialTransfer below: JobCardsController.Search does NOT
 * accept a `q` param at all (only dateFrom/dateTo/jobNo/regNo/chassisNo/onlyWithMaterialTransfer) -
 * ASP.NET Core silently ignores an unbound query param rather than erroring, so typing in the
 * search box above has never actually filtered results on Android; every open just returns the
 * same up-to-100 most-recent job cards regardless of what's typed. Left AS-IS here (out of scope
 * for this round's "grid button" ask) but flagged - worth a separate fix (either wiring this box to
 * jobNo/regNo/chassisNo like web's own filters, or adding a real `q` param server-side).
 *
 * 2026-09-23 ("not added grid button on this clcik open material transfered job cards history"):
 * new optional `onlyWithMaterialTransfer`/`title` props, used by RepairBillCreateScreen.tsx's new
 * grid button - when true, adds `onlyWithMaterialTransfer=true` to the same GET call
 * (JobCardsController.Search's own new param) so this picker only lists job cards that already
 * have a Material Transfer saved. Every other caller (this screen's own plain "Search" button, and
 * MaterialTransferCreateScreen.tsx's) omits it and is unaffected.
 *
 * SECTION 168 (2026-09-30) "in mt and rb only open jobcard shown..only 1 is open means inprogreass
 * other already close after that shown" - same fix as web/src/components/JobSearchModal.tsx: the
 * plain picker use (onlyWithMaterialTransfer false/omitted) now also sends `excludeClosed=true` on
 * the same GET call, so Closed/Cancelled job cards no longer show here either. Left OFF for the "MT
 * History" grid-button mode (onlyWithMaterialTransfer=true) for the same reason as web - a completed
 * transfer is still valid history after its job card closes.
 */
export function JobSearchModal({
  visible, onSelect, onClose, onlyWithMaterialTransfer = false, title,
}: {
  visible: boolean
  onSelect: (job: JobSearchResult) => void
  onClose: () => void
  onlyWithMaterialTransfer?: boolean
  title?: string
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<JobSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!visible) return
    const handle = setTimeout(() => {
      setLoading(true)
      apiClient
        .get<JobSearchResult[]>('/api/jobcards/search', {
          params: {
            q: q || undefined,
            onlyWithMaterialTransfer: onlyWithMaterialTransfer || undefined,
            // SECTION 168 - see class doc comment: hide Closed/Cancelled job cards for the plain
            // picker use; the MT History mode (onlyWithMaterialTransfer=true) keeps showing them.
            excludeClosed: onlyWithMaterialTransfer ? undefined : true,
          },
        })
        .then(({ data }) => setResults(data))
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(handle)
  }, [q, visible, onlyWithMaterialTransfer])

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>{title ?? 'Search Job'}</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>Close</Text></TouchableOpacity>
          </View>
          <TextInput
            style={styles.search}
            value={q}
            onChangeText={setQ}
            placeholder="Job card no., party name, reg no. or chassis no…"
            autoFocus
          />
          {loading && <ActivityIndicator style={{ marginVertical: 10 }} color={colors.primary} />}
          <FlatList
            data={results}
            keyExtractor={(j) => j.id}
            style={{ maxHeight: 420 }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              !loading ? (
                <Text style={styles.empty}>
                  {q.trim()
                    ? 'No matching job cards.'
                    : onlyWithMaterialTransfer
                      ? 'No job cards with a Material Transfer found.'
                      : 'Start typing to search.'}
                </Text>
              ) : null
            }
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} onPress={() => onSelect(item)}>
                <Text style={styles.rowTitle}>{item.jobCardNumber}{item.isDmsLinked === false ? ' (not DMS-synced)' : ''}</Text>
                <Text style={styles.rowSub}>{item.partyName ?? '—'} · {item.regNo ?? item.chassisNo ?? '—'}</Text>
                <Text style={styles.rowSub}>{item.location ?? '—'} · {item.jobTypeService ?? '—'}</Text>
              </TouchableOpacity>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '85%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  close: { color: colors.primary, fontWeight: '600' },
  search: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 8 },
  empty: { padding: 16, color: colors.textMuted, textAlign: 'center' },
  row: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  rowTitle: { fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
})
