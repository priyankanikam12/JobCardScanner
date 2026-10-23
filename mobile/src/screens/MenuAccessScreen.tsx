// mobile\src\screens\MenuAccessScreen.tsx
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { Chip, PagerBar, SearchBox, SegmentedTabs, SortChips } from '../components/ListControls'
import { PickerField } from '../components/PickerField'
import { useListView, type Field } from '../lib/listView'
import { NAV_ITEMS } from '../navigation/menuAccess'
import { colors } from '../theme/colors'
import type { StaffRole } from '../types'

/**
 * "Admin: Menu Access" - the Android counterpart of web/src/pages/admin/MenuAccessPage.tsx (CorporateAdmin / SystemAdmin only). Chooses, per page, which roles can see it - without a code deploy -
 * by writing GET/PUT /api/menu-access, and per role whether it is in "Only show checked items" mode (GET/PUT /api/menu-access/role-modes). The SAME rows drive the web sidebar and the Android
 * Dashboard's "All Pages" list (the key of a row is derived from the web route), so one change here applies to both.
 *
 *   * "Restrict to specific roles" OFF (the default for a page with no override) = every staff role sees it. ON starts with every role ticked, so you untick the ones to exclude.
 *   * "Only show checked items" ON for a role = that role sees ONLY the pages explicitly ticked for it (a brand-new page stays hidden from it until ticked).
 *   * Quick setup: pick a role, tick the pages it should see, Apply - it edits the same state the two panels below use and switches that role into "Only show checked items"; nothing is sent to the
 *     server until Save.
 * Every row of web's NAV_ITEMS is listed (including pages that have no Android screen yet), so the two platforms show the same table.
 *
 * 2026-10-23 ("this menu access ui also fix for web and android"): three tabs instead of one long scroll (Quick setup / Pages & roles / Sidebar mode); the page lists have a search box, sort chips and 10 rows per
 * page (lib/listView.ts, components/ListControls.tsx); Save lives in a bar that stays at the bottom of the screen and says when there are unsaved changes. While a row is edited the list keeps its order -
 * it only re-orders when you change the search, the sort or the filter.
 */
const ALL_ROLES: StaffRole[] = ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'Supervisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin', 'Captain', 'ViceCaptain']

function describeError(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { message?: string } } }
  const detail = e?.response?.data?.message
  const status = e?.response?.status
  if (detail) return `${fallback} (${detail})`
  if (status) return `${fallback} (HTTP ${status})`
  return `${fallback} (no response reached the server - check your connection)`
}

interface RowState { key: string; label: string; icon: string; restrictedTo: Set<StaffRole> | null }
type Tab = 'quick' | 'pages' | 'modes'
type AccessFilter = 'all' | 'restricted' | 'everyone'

/** What "unsaved" means: the access of every page and the mode of every role, in a form that is the same whenever the data is the same. */
function signatureOf(rows: RowState[], modes: Record<string, boolean>): string {
  return JSON.stringify([rows.map((r) => [r.key, r.restrictedTo ? Array.from(r.restrictedTo).sort() : null]), ALL_ROLES.map((role) => !!modes[role])])
}

const QUICK_FIELDS: Field<RowState>[] = [
  { key: 'label', value: (r) => r.label },
  { key: 'key', value: (r) => r.key },
]

export function MenuAccessScreen() {
  const [rows, setRows] = useState<RowState[]>([])
  const [roleModes, setRoleModes] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [quickRole, setQuickRole] = useState<StaffRole>('DealerAdmin')
  const [quickChecked, setQuickChecked] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<Tab>('quick')
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all')
  const [baseline, setBaseline] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    // both lists are requested together and shown together (the second one fails OPEN: if it cannot be read, every role simply stays in today's behaviour)
    Promise.allSettled([
      apiClient.get<{ navKey: string; roles: string[] }[]>('/api/menu-access'),
      apiClient.get<{ role: string; onlyShowChecked: boolean }[]>('/api/menu-access/role-modes'),
    ]).then(([itemsResult, modesResult]) => {
      let nextRows: RowState[] = []
      if (itemsResult.status === 'fulfilled') {
        const overrideMap: Record<string, string[]> = {}
        itemsResult.value.data.forEach((r) => { overrideMap[r.navKey] = r.roles })
        nextRows = NAV_ITEMS.map((item) => {
          // an override row wins (even an empty one = an admin set it back to "everyone"); otherwise the item's own shipped default roles
          const override = overrideMap[item.key]
          const effective = override !== undefined ? override : item.roles
          return { key: item.key, label: item.label, icon: item.icon, restrictedTo: effective && effective.length > 0 ? new Set(effective as StaffRole[]) : null }
        })
      } else {
        setError(describeError(itemsResult.reason, 'Could not load menu access settings.'))
      }
      const nextModes: Record<string, boolean> = {}
      if (modesResult.status === 'fulfilled') modesResult.value.data.forEach((r) => { nextModes[r.role] = r.onlyShowChecked })
      setRows(nextRows)
      setRoleModes(nextModes)
      setBaseline(signatureOf(nextRows, nextModes))
      setLoading(false)
    })
  }
  useEffect(load, [])

  const signature = useMemo(() => signatureOf(rows, roleModes), [rows, roleModes])
  const dirty = !loading && baseline !== null && signature !== baseline

  const toggleRestricted = (key: string) => setRows((prev) => prev.map((r) => {
    if (r.key !== key) return r
    if (r.restrictedTo !== null) return { ...r, restrictedTo: null } // OFF -> everyone
    return { ...r, restrictedTo: new Set(ALL_ROLES) } // ON: start with every role ticked so the admin unticks the ones to exclude
  }))
  const toggleRole = (key: string, role: StaffRole) => setRows((prev) => prev.map((r) => {
    if (r.key !== key || r.restrictedTo === null) return r
    const next = new Set(r.restrictedTo)
    if (next.has(role)) next.delete(role); else next.add(role)
    return { ...r, restrictedTo: next }
  }))

  // Re-seed the quick-setup checklist from the role's CURRENT effective access when the target role changes (or the data finishes loading) - mirrors the visibility rule of the sidebar exactly.
  useEffect(() => {
    if (loading) return
    const next = new Set<string>()
    rows.forEach((r) => {
      const visible = roleModes[quickRole] ? r.restrictedTo !== null && r.restrictedTo.has(quickRole) : r.restrictedTo === null || r.restrictedTo.has(quickRole)
      if (visible) next.add(r.key)
    })
    setQuickChecked(next)
    setOk(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickRole, loading])

  const applyQuickSetup = () => {
    setRows((prev) => prev.map((r) => {
      // start from the item's CURRENT set, or - if it is still "everyone" - every role, so applying this for one role never changes what any OTHER role can see
      const base = r.restrictedTo !== null ? new Set(r.restrictedTo) : new Set(ALL_ROLES)
      if (quickChecked.has(r.key)) base.add(quickRole); else base.delete(quickRole)
      return { ...r, restrictedTo: base }
    }))
    setRoleModes((prev) => ({ ...prev, [quickRole]: true }))
    setOk(`Applied to the Pages & roles list for ${quickRole}. Review it, then tap Save at the bottom to commit it.`)
    setError(null)
  }

  const save = async () => {
    setSaving(true)
    setOk(null)
    setError(null)
    try {
      await apiClient.put('/api/menu-access', rows.map((r) => ({ navKey: r.key, roles: r.restrictedTo ? Array.from(r.restrictedTo) : [] })))
    } catch (err) {
      setError(describeError(err, 'Save failed at the per-item table'))
      setSaving(false)
      return
    }
    try {
      await apiClient.put('/api/menu-access/role-modes', ALL_ROLES.map((role) => ({ role, onlyShowChecked: !!roleModes[role] })))
      // 2026-10-23: the confirmation is a pop-up alert (one OK button) instead of a green banner that stays on the screen
      setBaseline(signature)
      setSaving(false)
      Alert.alert('Menu access assigned successfully.', undefined, [{ text: 'OK' }])
    } catch (err) {
      setError(describeError(err, 'Save failed at Role Sidebar Mode (the per-item table was saved OK)'))
    } finally {
      setSaving(false)
    }
  }

  // ---- lists: search on every field (including the allowed role names), sort, 10 per page ----
  const pageFields: Field<RowState>[] = [
    { key: 'page', value: (r) => r.label },
    { key: 'access', value: (r) => (r.restrictedTo === null ? 'Everyone' : 'Restricted') },
    { key: 'roles', value: (r) => (r.restrictedTo === null ? ALL_ROLES.length + 1 : r.restrictedTo.size), search: false },
    { key: 'roleNames', value: (r) => (r.restrictedTo === null ? 'all roles' : Array.from(r.restrictedTo).join(' ')) },
  ]
  const pagesView = useListView(rows, pageFields, {
    getKey: (r) => r.key,
    version: accessFilter,
    prefilter: (r) => accessFilter === 'all' || (accessFilter === 'restricted') === (r.restrictedTo !== null),
  })
  const quickView = useListView(rows, QUICK_FIELDS, { getKey: (r) => r.key })

  return (
    <View style={styles.screen}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <SegmentedTabs
          tabs={[{ key: 'quick', label: 'Quick setup' }, { key: 'pages', label: 'Pages & roles' }, { key: 'modes', label: 'Sidebar mode' }]}
          value={tab}
          onChange={setTab}
        />
        {loading && <ActivityIndicator color={colors.primary} />}
        {error && <Text style={styles.errorBanner}>⚠️ {error}</Text>}
        {ok && <Text style={styles.okBanner}>✅ {ok}</Text>}

        {!loading && tab === 'quick' && (
          <View style={styles.card}>
            <Text style={styles.h3}>Quick setup for one role</Text>
            <Text style={styles.muted}>Pick a role, tick only the pages it should see, then Apply. It also switches that role to "Only show checked items", so a new page stays hidden from it until you tick it.</Text>
            <View style={{ marginTop: 8 }}>
              <PickerField label="Role" value={quickRole} onChange={(v) => setQuickRole(v as StaffRole)} options={ALL_ROLES.map((r) => ({ value: r, label: r }))} />
            </View>
            <View style={styles.rowWrap}>
              <Chip label={`${quickChecked.size} of ${rows.length} ticked`} tone="primary" active />
              <TouchableOpacity style={styles.smallBtn} onPress={() => setQuickChecked(new Set(rows.map((r) => r.key)))}><Text style={styles.smallBtnText}>Select all</Text></TouchableOpacity>
              <TouchableOpacity style={styles.smallBtn} onPress={() => setQuickChecked(new Set())}><Text style={styles.smallBtnText}>Clear all</Text></TouchableOpacity>
            </View>
            <View style={{ marginTop: 10 }}>
              <SearchBox value={quickView.query} onChangeText={quickView.setQuery} placeholder="Search a page…" />
            </View>
            {quickView.pageRows.map((r) => (
              <TouchableOpacity key={r.key} style={styles.checkRow} onPress={() => setQuickChecked((prev) => { const n = new Set(prev); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n })}>
                <Text style={styles.box}>{quickChecked.has(r.key) ? '☑' : '☐'}</Text>
                <Text style={styles.rowText}>{r.icon} {r.label}</Text>
              </TouchableOpacity>
            ))}
            {quickView.pageRows.length === 0 && <Text style={[styles.muted, { marginTop: 10 }]}>No page matches "{quickView.query}".</Text>}
            <PagerBar page={quickView.page} pageCount={quickView.pageCount} total={quickView.total} onPage={quickView.setPage} pageSize={quickView.pageSize} onPageSize={quickView.setPageSize} />
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 14 }]} onPress={applyQuickSetup}><Text style={styles.primaryBtnText}>Apply to the Pages & roles list</Text></TouchableOpacity>
          </View>
        )}

        {!loading && tab === 'pages' && (
          <View style={styles.card}>
            <Text style={styles.h3}>Pages and roles</Text>
            <Text style={styles.muted}>"Restrict to specific roles" off = every role sees the page. Tap a page to open its roles.</Text>
            <View style={{ marginTop: 10 }}>
              <SearchBox value={pagesView.query} onChangeText={pagesView.setQuery} placeholder="Search a page or a role, e.g. repair or DealerAdmin" />
            </View>
            <View style={styles.chipRowInline}>
              <Text style={styles.rowLabel}>Show</Text>
              {([['all', 'All'], ['restricted', 'Restricted'], ['everyone', 'Everyone']] as const).map(([k, label]) => (
                <Chip key={k} label={label} active={accessFilter === k} onPress={() => setAccessFilter(k)} />
              ))}
            </View>
            <SortChips options={[{ key: 'page', label: 'Page' }, { key: 'access', label: 'Access' }, { key: 'roles', label: 'Roles' }]} sort={pagesView.sort} onToggle={pagesView.toggleSort} />
            <Text style={[styles.muted, { marginTop: 8 }]}>{pagesView.total === pagesView.allTotal ? `${pagesView.allTotal} pages` : `${pagesView.total} of ${pagesView.allTotal} pages`}</Text>

            {pagesView.pageRows.map((r) => (
              <View key={r.key} style={styles.itemBox}>
                <TouchableOpacity style={styles.itemHead} onPress={() => setOpenKey(openKey === r.key ? null : r.key)}>
                  <Text style={[styles.rowText, { flex: 1 }]}>{r.icon} {r.label}</Text>
                  <Text style={[styles.badge, r.restrictedTo === null ? styles.badgeMuted : styles.badgeOn]}>{r.restrictedTo === null ? 'Everyone' : `${r.restrictedTo.size} role${r.restrictedTo.size === 1 ? '' : 's'}`}</Text>
                  <Text style={styles.muted}> {openKey === r.key ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {openKey === r.key && (
                  <View style={{ marginTop: 6 }}>
                    <View style={styles.switchRow}>
                      <Text style={styles.rowText}>Restrict to specific roles</Text>
                      <Switch value={r.restrictedTo !== null} onValueChange={() => toggleRestricted(r.key)} />
                    </View>
                    {r.restrictedTo !== null && (
                      <View style={styles.chips}>
                        {ALL_ROLES.map((role) => {
                          const on = r.restrictedTo!.has(role)
                          return (
                            <TouchableOpacity key={role} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleRole(r.key, role)}>
                              <Text style={[styles.chipText, on && styles.chipTextOn]}>{on ? '✓ ' : ''}{role}</Text>
                            </TouchableOpacity>
                          )
                        })}
                      </View>
                    )}
                  </View>
                )}
              </View>
            ))}
            {pagesView.pageRows.length === 0 && <Text style={[styles.muted, { marginTop: 10 }]}>No page matches{pagesView.query ? ` "${pagesView.query}"` : ''}{accessFilter !== 'all' ? ` among the ${accessFilter} pages` : ''}.</Text>}
            <PagerBar page={pagesView.page} pageCount={pagesView.pageCount} total={pagesView.total} onPage={pagesView.setPage} pageSize={pagesView.pageSize} onPageSize={pagesView.setPageSize} />
          </View>
        )}

        {!loading && tab === 'modes' && (
          <View style={styles.card}>
            <Text style={styles.h3}>Role Sidebar Mode</Text>
            <Text style={styles.muted}>ON = that role sees ONLY the pages ticked for it (anything else, including pages added later, stays hidden). CorporateAdmin / SystemAdmin always keep Dashboard and the Menu Access page.</Text>
            {ALL_ROLES.map((role) => (
              <View key={role} style={[styles.modeRow, roleModes[role] && styles.modeRowOn]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeName}>{role}</Text>
                  <Text style={styles.muted}>{roleModes[role] ? 'only the ticked pages' : 'everyone by default'}</Text>
                </View>
                <Switch value={!!roleModes[role]} onValueChange={() => setRoleModes((prev) => ({ ...prev, [role]: !prev[role] }))} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.saveBar}>
        {dirty ? <Text style={styles.dirty}>● Unsaved changes</Text> : <Text style={styles.clean}>All changes saved</Text>}
        <TouchableOpacity style={[styles.saveBtn, (saving || loading) && { opacity: 0.6 }]} disabled={saving || loading} onPress={save}>
          <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 12 },
  h3: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 4 },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginRight: 2 },
  errorBanner: { backgroundColor: '#fef2f2', color: '#991b1b', padding: 10, borderRadius: 8, marginBottom: 10 },
  okBanner: { backgroundColor: '#ecfdf3', color: '#065f46', padding: 10, borderRadius: 8, marginBottom: 10 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
  chipRowInline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10 },
  smallBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  smallBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  box: { fontSize: 18, color: colors.primary },
  rowText: { color: colors.text, fontSize: 14 },
  itemBox: { borderBottomWidth: 1, borderBottomColor: '#f1f3f6', paddingVertical: 10 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { fontSize: 11, fontWeight: '700', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, overflow: 'hidden' },
  badgeMuted: { backgroundColor: '#f3f4f6', color: colors.textMuted },
  badgeOn: { backgroundColor: colors.primarySoft, color: colors.primaryDark },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: 12, color: colors.text },
  chipTextOn: { color: '#fff', fontWeight: '700' },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  modeRowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  modeName: { fontSize: 14, fontWeight: '700', color: colors.text },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  saveBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  saveBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 28, alignItems: 'center' },
  dirty: { color: colors.amberDark, fontWeight: '700', fontSize: 13 },
  clean: { color: colors.textMuted, fontSize: 13 },
})
