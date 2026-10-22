// mobile\src\screens\MenuAccessScreen.tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { PickerField } from '../components/PickerField'
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

  const load = () => {
    setLoading(true)
    setError(null)
    apiClient
      .get<{ navKey: string; roles: string[] }[]>('/api/menu-access')
      .then((res) => {
        const overrideMap: Record<string, string[]> = {}
        res.data.forEach((r) => { overrideMap[r.navKey] = r.roles })
        setRows(NAV_ITEMS.map((item) => {
          // an override row wins (even an empty one = an admin set it back to "everyone"); otherwise the item's own shipped default roles
          const override = overrideMap[item.key]
          const effective = override !== undefined ? override : item.roles
          return { key: item.key, label: item.label, icon: item.icon, restrictedTo: effective && effective.length > 0 ? new Set(effective as StaffRole[]) : null }
        }))
      })
      .catch((err) => setError(describeError(err, 'Could not load menu access settings.')))
      .finally(() => setLoading(false))
    apiClient
      .get<{ role: string; onlyShowChecked: boolean }[]>('/api/menu-access/role-modes')
      .then((res) => {
        const map: Record<string, boolean> = {}
        res.data.forEach((r) => { map[r.role] = r.onlyShowChecked })
        setRoleModes(map)
      })
      .catch(() => { /* fail-open: every role stays in today's behaviour */ })
  }
  useEffect(load, [])

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
    setOk(`Applied to the table below for ${quickRole}. Review it, then tap Save at the bottom to commit it.`)
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
      setOk('Menu access assigned successfully. Web picks it up on the next click anywhere in the app; the Android Dashboard picks it up the next time it opens.')
    } catch (err) {
      setError(describeError(err, 'Save failed at Role Sidebar Mode (the per-item table was saved OK)'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {loading && <ActivityIndicator color={colors.primary} />}
      {error && <Text style={styles.errorBanner}>⚠️ {error}</Text>}
      {ok && <Text style={styles.okBanner}>✅ {ok}</Text>}

      <View style={styles.card}>
        <Text style={styles.h3}>Quick setup for one role</Text>
        <Text style={styles.muted}>Pick a role, tick only the pages it should see, then Apply. It also switches that role to "Only show checked items", so a new page stays hidden from it until you tick it.</Text>
        <View style={{ marginTop: 8 }}>
          <PickerField label="Role" value={quickRole} onChange={(v) => setQuickRole(v as StaffRole)} options={ALL_ROLES.map((r) => ({ value: r, label: r }))} />
        </View>
        {rows.map((r) => (
          <TouchableOpacity key={r.key} style={styles.checkRow} onPress={() => setQuickChecked((prev) => { const n = new Set(prev); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n })}>
            <Text style={styles.box}>{quickChecked.has(r.key) ? '☑' : '☐'}</Text>
            <Text style={styles.rowText}>{r.icon} {r.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.primaryBtn, { marginTop: 10 }]} onPress={applyQuickSetup}><Text style={styles.primaryBtnText}>Apply to the table below</Text></TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.h3}>Pages and roles</Text>
        <Text style={styles.muted}>"Restrict to specific roles" off = every role sees the page. Tap a page to open its roles.</Text>
        {rows.map((r) => (
          <View key={r.key} style={styles.itemBox}>
            <TouchableOpacity style={styles.itemHead} onPress={() => setOpenKey(openKey === r.key ? null : r.key)}>
              <Text style={styles.rowText}>{r.icon} {r.label}</Text>
              <Text style={styles.muted}>{r.restrictedTo === null ? 'Everyone' : `${r.restrictedTo.size} role${r.restrictedTo.size === 1 ? '' : 's'}`}  {openKey === r.key ? '▲' : '▼'}</Text>
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
      </View>

      <View style={styles.card}>
        <Text style={styles.h3}>Role Sidebar Mode</Text>
        <Text style={styles.muted}>ON = that role sees ONLY the pages ticked for it above (anything else, including pages added later, stays hidden). CorporateAdmin / SystemAdmin always keep Dashboard and this page.</Text>
        {ALL_ROLES.map((role) => (
          <View key={role} style={styles.switchRow}>
            <Text style={styles.rowText}>{role}</Text>
            <Switch value={!!roleModes[role]} onValueChange={() => setRoleModes((prev) => ({ ...prev, [role]: !prev[role] }))} />
          </View>
        ))}
      </View>

      <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
        <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 12 },
  h3: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 4 },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  errorBanner: { backgroundColor: '#fef2f2', color: '#991b1b', padding: 10, borderRadius: 8, marginBottom: 10 },
  okBanner: { backgroundColor: '#ecfdf3', color: '#065f46', padding: 10, borderRadius: 8, marginBottom: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  box: { fontSize: 18, color: colors.primary },
  rowText: { color: colors.text, fontSize: 14 },
  itemBox: { borderBottomWidth: 1, borderBottomColor: '#f1f3f6', paddingVertical: 8 },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: 12, color: colors.text },
  chipTextOn: { color: '#fff', fontWeight: '700' },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
})
