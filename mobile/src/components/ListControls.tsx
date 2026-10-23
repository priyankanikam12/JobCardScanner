// mobile\src\components\ListControls.tsx
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import type { SortState } from '../lib/listView'
import { colors } from '../theme/colors'

/**
 * 2026-10-23: small building blocks for a searchable, sortable, paged list on a phone (used by Admin: Menu Access; reusable). Everything wraps onto a second line instead of stretching or overflowing.
 */

/** One-line search box with an icon and a clear button. */
export function SearchBox({ value, onChangeText, placeholder, onSubmit }: { value: string; onChangeText: (v: string) => void; placeholder: string; onSubmit?: () => void }) {
  return (
    <View style={styles.searchWrap}>
      <Text style={styles.searchIcon}>🔍</Text>
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={placeholder}
        returnKeyType={onSubmit ? 'search' : 'default'}
        onSubmitEditing={onSubmit}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChangeText('')} accessibilityLabel="Clear search" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.clear}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

/** Pill chip: outlined when off, navy when on. */
export function Chip({ label, active = false, onPress, tone = 'navy' }: { label: string; active?: boolean; onPress?: () => void; tone?: 'navy' | 'primary' }) {
  const onColor = tone === 'primary' ? colors.primary : colors.navy
  return (
    <TouchableOpacity disabled={!onPress} onPress={onPress} style={[styles.chip, active && { backgroundColor: onColor, borderColor: onColor }]} accessibilityState={{ selected: active }}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  )
}

/** Full-width segmented switch (tabs): the active one is a raised white pill. */
export function SegmentedTabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={styles.seg} accessibilityRole="tablist">
      {tabs.map((t) => (
        <TouchableOpacity key={t.key} style={[styles.segBtn, value === t.key && styles.segBtnOn]} onPress={() => onChange(t.key)} accessibilityRole="tab" accessibilityState={{ selected: value === t.key }}>
          <Text style={[styles.segText, value === t.key && styles.segTextOn]} numberOfLines={1}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

/** "Sort:" followed by one chip per sortable field; tap = ascending, tap again = descending (▲ / ▼). */
export function SortChips({ options, sort, onToggle }: { options: { key: string; label: string }[]; sort: SortState | null; onToggle: (key: string) => void }) {
  return (
    <View style={styles.chipRow}>
      <Text style={styles.rowLabel}>Sort</Text>
      {options.map((o) => {
        const active = sort?.key === o.key
        return <Chip key={o.key} label={`${o.label}${active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : ''}`} active={active} onPress={() => onToggle(o.key)} tone="primary" />
      })}
    </View>
  )
}

/** "‹ Prev   Page 2 of 3 · 22 items   Next ›" with a rows-per-page chip row. */
export function PagerBar({ page, pageCount, total, onPage, pageSize, onPageSize, sizes = [10, 25, 50] }: {
  page: number; pageCount: number; total: number; onPage: (p: number) => void; pageSize: number; onPageSize: (n: number) => void; sizes?: number[]
}) {
  return (
    <View style={styles.pager}>
      <View style={styles.pagerRow}>
        <TouchableOpacity style={[styles.pagerBtn, page <= 1 && styles.pagerBtnOff]} disabled={page <= 1} onPress={() => onPage(page - 1)}><Text style={styles.pagerBtnText}>‹ Prev</Text></TouchableOpacity>
        <Text style={styles.pagerText}>Page {page} of {pageCount} · {total} item{total === 1 ? '' : 's'}</Text>
        <TouchableOpacity style={[styles.pagerBtn, page >= pageCount && styles.pagerBtnOff]} disabled={page >= pageCount} onPress={() => onPage(page + 1)}><Text style={styles.pagerBtnText}>Next ›</Text></TouchableOpacity>
      </View>
      <View style={styles.chipRow}>
        <Text style={styles.rowLabel}>Per page</Text>
        {sizes.map((n) => <Chip key={n} label={String(n)} active={pageSize === n} onPress={() => onPageSize(n)} />)}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, height: 42 },
  searchIcon: { fontSize: 14, marginRight: 8, color: colors.textMuted },
  searchInput: { flex: 1, height: 42, color: colors.text, fontSize: 14, padding: 0 },
  clear: { fontSize: 14, color: colors.textMuted, paddingHorizontal: 4 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipTextOn: { color: '#fff' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 },
  rowLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginRight: 2 },
  seg: { flexDirection: 'row', backgroundColor: '#e9edf3', borderRadius: 10, padding: 3, marginBottom: 12 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segBtnOn: { backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  segTextOn: { color: colors.primary },
  pager: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  pagerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pagerBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pagerBtnOff: { opacity: 0.4 },
  pagerBtnText: { fontSize: 13, fontWeight: '700', color: colors.text },
  pagerText: { flex: 1, textAlign: 'center', fontSize: 12, color: colors.textMuted },
})
