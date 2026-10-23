import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { PickerField, type PickerOption } from '../components/PickerField'
import { PagerBar, SearchBox, SortChips } from '../components/ListControls'
import { useListView, type Field } from '../lib/listView'
import { colors } from '../theme/colors'
import type { BaplDmsWorkshop, Technician } from '../types'

/**
 * "Technician Employee" screen (2026-09-24 - "that Supervisor login which we create from Dealer
 * Employees that supervisor when login then he have access to create Tecnician that tab name
 * Technician Employee") - mirrors web/src/pages/staff/TechnicianEmployeesPage.tsx. Manages the
 * login-less Technician roster (see backend Models/Technicians.cs) that feeds the Job Card
 * Wizard's "Technician" dropdown and the Job Card Detail screen's "Assign Technician" dropdown.
 * Deliberately NOT a User/login - just a Name and a Location.
 *
 * Access: reading the list (GET /api/technicians) is ServiceAdvisorUp on the backend, but this
 * screen's own entry point on the Dashboard is only shown to Supervisor/DealerAdmin/CorporateAdmin/
 * SystemAdmin (see DashboardScreen.tsx) - unlike most of this app's other ActionCards, which are
 * NOT role-gated, this one deliberately is: it's the one access difference the new Supervisor role
 * exists to create (a plain WorkshopManager does not get it). Add/Edit/Delete are additionally
 * disabled in-screen for anyone who somehow reaches it without one of those roles, since the write
 * actions are SupervisorUp-gated server-side regardless (TechniciansController.Create/Update/
 * Delete).
 *
 * KNOWN GAP (disclosed, not silently dropped - same as web's own doc comment): no Corporate/System
 * Admin cross-dealer view - TechniciansController.List only returns rows for a dealerId a
 * Corporate/System Admin explicitly passes, and this screen never passes one.
 */

const apiErrorMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback

const emptyForm = { id: null as string | null, name: '', locationCode: '', dealerId: '' }

/** A dealer offered to Corporate / System Admin (GET /api/dealers); only those with a DMS dealer code have workshop locations. */
interface DealerOption { id: string; name: string; baplDmsDealerCode?: string | null }

export function TechnicianEmployeesScreen() {
  const { profile, hasRole } = useStaffAuth()
  const canManage = hasRole('Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin')
  // 2026-10-23 ("in login of systemadmin and corporate admin all Technician Employee not showing"): a Corporate / System Admin has no dealer of its own and the API answered with an EMPTY list unless a dealerId
  // was passed (the KNOWN GAP in this file's header). Now this screen asks for every dealer's technicians (allDealers=true), shows the dealer on each row, has a Dealer filter, and the Add form has a Dealer
  // picker (POST /api/technicians?dealerId=...). A dealer-level login is unchanged.
  const isOrgWide = hasRole('CorporateAdmin', 'SystemAdmin')
  const [dealers, setDealers] = useState<DealerOption[]>([])
  const [dealerFilter, setDealerFilter] = useState('')
  useEffect(() => {
    if (!isOrgWide) return
    apiClient.get<DealerOption[]>('/api/dealers')
      .then((r) => setDealers((Array.isArray(r.data) ? r.data : []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setDealers([]))
  }, [isOrgWide])
  const dealerNameById = new Map(dealers.map((d) => [d.id, d.name]))

  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [includeInactive, setIncludeInactive] = useState(false)
  const [loading, setLoading] = useState(false)

  // 2026-10-03 (web TechnicianEmployeesPage - "add filter for search technician and dropdown of location"): a name search box and a Location dropdown above the list. The location is sent to the
  // server (GET /api/technicians?locationCode=..., the same param the Assign Technician dropdown uses), the name search is applied in the phone.
  const [locationFilter, setLocationFilter] = useState('')
  const load = () => {
    setLoading(true)
    apiClient.get<Technician[]>('/api/technicians', { params: { includeInactive, locationCode: locationFilter || undefined, ...(isOrgWide ? { allDealers: true, dealerId: dealerFilter || undefined } : {}) } })
      .then((r) => setTechnicians(r.data))
      .finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [includeInactive, locationFilter, dealerFilter])
// 2026-10-23 ("all pages add in sorting and pagination and ui attractive"): search on every field, sort chips and 10 rows per page (lib/listView.ts + components/ListControls.tsx).
  const technicianFields: Field<Technician>[] = [
    { key: 'name', value: (t) => t.name },
    { key: 'location', value: (t) => (t.locationName ? `${t.locationName} (${t.locationCode})` : t.locationCode) },
    { key: 'dealer', value: (t) => dealerNameById.get(t.dealerId) ?? '' },
    { key: 'status', value: (t) => (t.active ? 'Active' : 'Inactive') },
  ]
  const view = useListView(technicians, technicianFields, { getKey: (t) => t.id })
  const shown = view.pageRows

  // Locations: the FORM lists the workshops of the dealer it is for (a dealer login: its own; Corporate / System Admin: the dealer picked in the form); the Location FILTER lists those of the dealer being filtered.
  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  const [filterWorkshops, setFilterWorkshops] = useState<BaplDmsWorkshop[]>([])
  const [form, setForm] = useState(emptyForm)
  const formDealerId = isOrgWide ? form.dealerId : (profile?.dealerId ?? '')
  const filterDealerId = isOrgWide ? dealerFilter : (profile?.dealerId ?? '')
  useEffect(() => {
    if (!formDealerId) { setWorkshops([]); return }
    apiClient.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: formDealerId } })
      .then((r) => setWorkshops(r.data))
      .catch(() => setWorkshops([]))
  }, [formDealerId])
  useEffect(() => {
    if (!filterDealerId) { setFilterWorkshops([]); return }
    apiClient.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: filterDealerId } })
      .then((r) => setFilterWorkshops(r.data))
      .catch(() => setFilterWorkshops([]))
  }, [filterDealerId])
  const filterWorkshopOptions: PickerOption[] = filterWorkshops.map((w) => ({ label: `${w.locName} (${w.locCode})`, value: w.locCode }))
  const workshopOptions: PickerOption[] = workshops.map((w) => ({ label: `${w.locName} (${w.locCode})`, value: w.locCode }))

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const resetForm = () => { setForm(emptyForm); setError(null) }

  const editTechnician = (t: Technician) => { setForm({ id: t.id, name: t.name, locationCode: t.locationCode, dealerId: t.dealerId }); setError(null) }

  const save = async () => {
    setError(null)
    if (!form.name.trim()) { setError('Name is required.'); return }
    if (isOrgWide && !form.id && !form.dealerId) { setError('Dealer is required.'); return }
    if (!form.locationCode) { setError('Location is required.'); return }
    const locationName = workshops.find((w) => w.locCode === form.locationCode)?.locName ?? null
    setBusy(true)
    try {
      if (form.id) {
        await apiClient.put(`/api/technicians/${form.id}`, { name: form.name.trim(), locationCode: form.locationCode, locationName })
      } else {
        await apiClient.post('/api/technicians', { name: form.name.trim(), locationCode: form.locationCode, locationName }, isOrgWide ? { params: { dealerId: form.dealerId } } : undefined)
      }
      resetForm()
      load()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not save this technician.'))
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (t: Technician) => {
    await apiClient.put(`/api/technicians/${t.id}`, { active: !t.active })
    load()
  }

  const remove = (t: Technician) => {
    Alert.alert(
      'Delete Technician',
      `Permanently delete ${t.name}? This cannot be undone - use Deactivate instead if you just want to hide them from the dropdowns.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              await apiClient.delete(`/api/technicians/${t.id}`)
              load()
            } catch (err: unknown) {
              Alert.alert('Could not delete', apiErrorMessage(err, 'Could not delete this technician.'))
            }
          },
        },
      ],
    )
  }

  return (
    <View style={styles.screen}>
      <FlatList
        style={styles.list}
        data={shown}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={
          <>
            {/* <Text style={styles.intro}>
              These technicians appear in the Job Card Wizard's "Technician" dropdown and the Job
              Card Detail screen's "Assign Technician" dropdown, scoped to the Location picked
              below. No login/password - this is a name-only roster, not a staff account.
            </Text> */}
            {canManage && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{form.id ? 'Edit Technician' : 'Add Technician'}</Text>
                <Text style={styles.label}>Name</Text>
                <TextInput style={styles.input} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Technician name" />
                {isOrgWide && (
                  <View style={{ marginTop: 10 }}>
                    <PickerField
                      label="Dealer"
                      value={form.dealerId}
                      options={dealers.filter((d) => !!d.baplDmsDealerCode || d.id === form.dealerId).map((d) => ({ label: `${d.name}${d.baplDmsDealerCode ? ` (${d.baplDmsDealerCode})` : ''}`, value: d.id }))}
                      placeholder="Select dealer…"
                      onChange={(v) => setForm({ ...form, dealerId: v, locationCode: '' })}
                    />
                  </View>
                )}
                <View style={{ marginTop: 10 }}>
                  <PickerField
                    label="Location"
                    value={form.locationCode}
                    options={workshopOptions}
                    placeholder={isOrgWide && !form.dealerId ? 'Pick a dealer first' : workshops.length ? 'Select workshop…' : 'No workshops found for this dealer yet'}
                    onChange={(v) => setForm({ ...form, locationCode: v })}
                  />
                </View>
                {error && <Text style={styles.error}>{error}</Text>}
                <View style={styles.formActions}>
                  <TouchableOpacity style={[styles.addBtn, busy && styles.btnDisabled]} disabled={busy} onPress={save}>
                    <Text style={styles.addBtnText}>{busy ? 'Saving…' : form.id ? 'Save Changes' : 'Save'}</Text>
                  </TouchableOpacity>
                  {form.id && (
                    <TouchableOpacity style={styles.smallBtn} onPress={resetForm}>
                      <Text style={styles.smallBtnText}>Cancel Edit</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
            <View style={{ marginBottom: 8 }}><SearchBox value={view.query} onChangeText={view.setQuery} placeholder="Search technician by name or location…" /></View>
            {isOrgWide && (
              <View style={{ marginBottom: 8 }}>
                <PickerField label="Dealer" value={dealerFilter} options={[{ label: 'All dealers', value: '' }, ...dealers.map((d) => ({ label: d.name, value: d.id }))]} placeholder="All dealers" onChange={(v) => { setDealerFilter(v); setLocationFilter('') }} />
              </View>
            )}
            <View style={{ marginBottom: 8 }}>
              <PickerField label="Location" value={locationFilter} options={[{ label: isOrgWide && !dealerFilter ? 'Pick a dealer first' : 'All locations', value: '' }, ...filterWorkshopOptions]} placeholder={isOrgWide && !dealerFilter ? 'Pick a dealer first' : 'All locations'} onChange={setLocationFilter} />
            </View>
            <View style={styles.toggleRow}>
              <Text style={styles.label}>Show inactive</Text>
              <Switch value={includeInactive} onValueChange={setIncludeInactive} />
            </View>
            <SortChips options={[{ key: 'name', label: 'Name' }, { key: 'location', label: 'Location' }, { key: 'status', label: 'Status' }]} sort={view.sort} onToggle={view.toggleSort} />
            <Text style={[styles.muted, { marginTop: 8, marginBottom: 6 }]}>{view.total === view.allTotal ? `${view.allTotal} technicians` : `${view.total} of ${view.allTotal} technicians`}</Text>
            {loading && <ActivityIndicator style={{ marginVertical: 10 }} color={colors.primary} />}
          </>
        }
        ListEmptyComponent={!loading ? <Text style={styles.muted}>{technicians.length === 0 ? `No technicians yet${canManage ? ' - add one above.' : '.'}` : 'No technicians match this search.'}</Text> : null}
        ListFooterComponent={view.total > 0 ? <PagerBar page={view.page} pageCount={view.pageCount} total={view.total} onPage={view.setPage} pageSize={view.pageSize} onPageSize={view.setPageSize} /> : null}
        renderItem={({ item: t }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{t.name}</Text>
              {isOrgWide && <Text style={styles.muted}>{dealerNameById.get(t.dealerId) ?? 'Dealer'}</Text>}
              <Text style={styles.muted}>{t.locationName ? `${t.locationName} (${t.locationCode})` : t.locationCode}</Text>
              <Text style={[styles.badge, t.active ? styles.badgeOn : styles.badgeOff]}>{t.active ? 'Active' : 'Inactive'}</Text>
            </View>
            {canManage && (
              <View style={{ gap: 6 }}>
                <TouchableOpacity style={styles.smallBtn} onPress={() => editTechnician(t)}><Text style={styles.smallBtnText}>Edit</Text></TouchableOpacity>
                <TouchableOpacity style={styles.smallBtn} onPress={() => toggleActive(t)}><Text style={styles.smallBtnText}>{t.active ? 'Deactivate' : 'Activate'}</Text></TouchableOpacity>
                <TouchableOpacity style={styles.removeBtn} onPress={() => remove(t)}><Text style={styles.removeBtnText}>Delete</Text></TouchableOpacity>
              </View>
            )}
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 12 },
  list: { flex: 1 },
  intro: { fontSize: 12, color: colors.textMuted, marginBottom: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  cardTitle: { fontWeight: '700', fontSize: 15, color: colors.text, marginBottom: 10 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 },
  error: { color: colors.danger, fontSize: 12, marginTop: 8 },
  formActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  addBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  addBtnText: { color: '#fff', fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
  smallBtn: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, alignItems: 'center' },
  smallBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
  removeBtn: { backgroundColor: colors.danger, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, alignItems: 'center' },
  removeBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  row: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  badge: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 2, paddingHorizontal: 9, borderRadius: 999, fontSize: 11, fontWeight: '700', overflow: 'hidden' },
  badgeOn: { backgroundColor: colors.successSoft, color: colors.success },
  badgeOff: { backgroundColor: '#f3f4f6', color: colors.textMuted },
})
