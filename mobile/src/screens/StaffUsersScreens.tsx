// mobile\src\screens\StaffUsersScreens.tsx
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { PickerField } from '../components/PickerField'
import { PagerBar, SearchBox, SortChips } from '../components/ListControls'
import { useListView, type Field } from '../lib/listView'
import { colors } from '../theme/colors'
import type { BaplDmsWorkshop, StaffRole } from '../types'

/**
 * 2026-10-22 (Android counterparts of web's Dealer Employees and Admin: Users pages) over the same GET/POST/PUT/DELETE /api/users.
 *
 * EmployeesScreen - create / edit / deactivate / delete a dealer's local logins with their Designation and Work Area (the DMS workshop locations the person may work in). A DEALER login manages its own
 * dealer's staff; CorporateAdmin / SystemAdmin pick a Dealer first, whose W1..Wn workshops are then listed to tick (locations ticked for one dealer stay ticked when another is picked). The Role is never
 * typed: the server maps Designation -> Role (the form sends a placeholder role on create, exactly like web). 'Mechanic' is not offered (hidden on web 03.10.2026; a saved one keeps it).
 *
 * AdminUsersScreen - the head-office view of EVERY login: search, change a login's Role, activate / deactivate. Web's Azure AD directory sync and the BAPL dealer bulk-import tools are web only.
 */
interface StaffUser {
  id: string; name: string; email: string; mobile?: string | null; role: StaffRole; dealerId?: string | null; dealerName?: string | null; active: boolean
  state?: string | null; city?: string | null; pincode?: string | null; dateOfJoining?: string | null; designation?: string | null; workLocationCodes: string[]
}
interface WorkDealer { id: string; name: string; code?: string; baplDmsDealerCode?: string | null }

const DESIGNATIONS = ['Supervisor', 'Captain', 'ViceCaptain', 'Technician'] as const
const ALL_ROLES: StaffRole[] = ['ServiceAdvisor', 'Technician', 'PartsUser', 'Cashier', 'Supervisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin']

/** Also reads ASP.NET validation answers ({ errors: { Field: [messages] } } with no "message") and shows the HTTP status when the server sent nothing readable. */
const apiErrorMessage = (err: unknown, fallback: string): string => {
  const res = (err as { response?: { status?: number; data?: { message?: string; title?: string; errors?: Record<string, string[]> } } })?.response
  const d = res?.data
  if (d?.message) return d.message
  if (d?.errors) {
    const all = Object.entries(d.errors).flatMap(([f, m]) => m.map((x) => `${f}: ${x}`))
    if (all.length) return all.join(' ')
  }
  if (d?.title) return d.title
  return res?.status ? `${fallback} (HTTP ${res.status})` : fallback
}

const emptyForm = {
  id: null as string | null, name: '', email: '', password: '', mobile: '', state: '', city: '', pincode: '', dateOfJoining: '',
  designation: '', role: '' as string, dealerId: '', workLocationCodes: [] as string[],
}

export function EmployeesScreen() {
  const { profile } = useStaffAuth()
  const isCorporateOrSystem = profile?.role === 'CorporateAdmin' || profile?.role === 'SystemAdmin'
  const [users, setUsers] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [locationFilter, setLocationFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    apiClient.get<StaffUser[]>('/api/users')
      .then((r) => setUsers(r.data))
      .catch((err) => { setUsers([]); setError(apiErrorMessage(err, 'Could not load the employees.')) })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  // ---- Work Area: the dealer whose workshops are listed ----
  const [dealers, setDealers] = useState<WorkDealer[]>([])
  const [workDealerId, setWorkDealerId] = useState('')
  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  const [workshopError, setWorkshopError] = useState<string | null>(null)
  const [knownWorkshops, setKnownWorkshops] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!isCorporateOrSystem) return
    apiClient.get<WorkDealer[]>('/api/dealers').then((r) => setDealers((Array.isArray(r.data) ? r.data : []).filter((d) => !!d.baplDmsDealerCode))).catch(() => setDealers([]))
  }, [isCorporateOrSystem])
  const locationDealerId = isCorporateOrSystem ? workDealerId : profile?.dealerId ?? ''
  useEffect(() => {
    if (!locationDealerId) { setWorkshops([]); setWorkshopError(null); return }
    setWorkshopError(null)
    apiClient.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: locationDealerId } })
      .then((r) => { setWorkshops(r.data); setKnownWorkshops((prev) => ({ ...prev, ...Object.fromEntries(r.data.map((w) => [w.locCode, w.locName])) })) })
      .catch((err) => { setWorkshops([]); setWorkshopError(apiErrorMessage(err, 'Could not load the workshop locations.')) })
  }, [locationDealerId])

  const openAdd = () => { setForm(emptyForm); setWorkDealerId(''); setFormError(null); setFormOpen(true) }
  const openEdit = (u: StaffUser) => {
    setForm({
      id: u.id, name: u.name, email: u.email, password: '', mobile: u.mobile ?? '', state: u.state ?? '', city: u.city ?? '', pincode: u.pincode ?? '',
      dateOfJoining: u.dateOfJoining ? u.dateOfJoining.slice(0, 10) : '', designation: u.designation ?? '', role: u.role, dealerId: u.dealerId ?? '', workLocationCodes: u.workLocationCodes,
    })
    if (isCorporateOrSystem) setWorkDealerId(u.dealerId ?? '')
    setFormError(null)
    setFormOpen(true)
  }
  const closeForm = () => { setFormOpen(false); setForm(emptyForm); setFormError(null) }

  const save = async () => {
    setFormError(null)
    if (!form.name || !form.email) { setFormError('Employee Name and Email/Login Id are required.'); return }
    if (!form.id && !form.password) { setFormError('Password is required to create a new employee login.'); return }
    if (!isCorporateOrSystem && !profile?.dealerId) { setFormError('Your account has no dealer assigned - contact a System Admin.'); return }
    if (!form.designation) { setFormError('Select a Designation.'); return }
    if (form.mobile && form.mobile.length !== 10) { setFormError('Mobile No. must be exactly 10 digits.'); return }
    const dealerIdToSend = isCorporateOrSystem ? (form.dealerId || null) : profile!.dealerId
    setBusy(true)
    try {
      if (form.id) {
        await apiClient.put(`/api/users/${form.id}`, {
          name: form.name, mobile: form.mobile || null, dealerId: dealerIdToSend, state: form.state || null, city: form.city || null, pincode: form.pincode || null,
          dateOfJoining: form.dateOfJoining || null, designation: form.designation, workLocationCodes: form.workLocationCodes, ...(form.password ? { password: form.password } : {}),
        })
      } else {
        await apiClient.post('/api/users', {
          name: form.name, email: form.email, mobile: form.mobile || null,
          role: 'ServiceAdvisor', // placeholder - the backend maps Designation -> the real Role
          dealerId: dealerIdToSend, authType: 'Local', password: form.password, state: form.state || null, city: form.city || null, pincode: form.pincode || null,
          dateOfJoining: form.dateOfJoining || null, designation: form.designation, workLocationCodes: form.workLocationCodes,
        })
      }
      closeForm()
      load()
    } catch (err) {
      setFormError(apiErrorMessage(err, 'Could not save this employee.'))
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = (u: StaffUser) => apiClient.put(`/api/users/${u.id}`, { active: !u.active }).then(load).catch((err) => Alert.alert('Employees', apiErrorMessage(err, 'Could not change this employee.')))
  const remove = (u: StaffUser) => Alert.alert('Delete employee', `Permanently delete ${u.name} (${u.email})? This cannot be undone - use Deactivate instead if you just want to disable their login.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => apiClient.delete(`/api/users/${u.id}`).then(load).catch((err) => Alert.alert('Employees', apiErrorMessage(err, 'Could not delete this user.'))) },
  ])
  const toggleLoc = (code: string) => setForm((f) => ({ ...f, workLocationCodes: f.workLocationCodes.includes(code) ? f.workLocationCodes.filter((c) => c !== code) : [...f.workLocationCodes, code] }))

  // 2026-10-23 ("in dropdown location with dealer name"): the Work Area location filter reads "Dealer name - Location name - code". The dealer comes from the dealer code in the location code
  // (CUS0288W4 -> CUS0288, matched against the dealers a Corporate / System Admin loads), else from the dealerName of an employee scoped to a dealer who has that location.
  const dealerNameForCode = (code: string): string => {
    const prefix = code.replace(/W\d+$/i, '').toUpperCase()
    return dealers.find((d) => (d.baplDmsDealerCode ?? '').toUpperCase() === prefix)?.name ?? users.find((u) => u.dealerName && u.workLocationCodes.includes(code))?.dealerName ?? ''
  }
  const locationLabel = (c: string) => [dealerNameForCode(c), knownWorkshops[c], c].filter(Boolean).join(' - ')
  const allLocationCodes = useMemo(
    () => Array.from(new Set(users.flatMap((u) => u.workLocationCodes))).sort((a, b) => locationLabel(a).localeCompare(locationLabel(b))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, dealers, knownWorkshops],
  )
// 2026-10-23 ("all pages add in sorting and pagination and ui attractive"): search on every field, sort chips and 10 rows per page (lib/listView.ts + components/ListControls.tsx).
  const employeeFields: Field<StaffUser>[] = [
    { key: 'name', value: (u) => u.name },
    { key: 'email', value: (u) => u.email },
    { key: 'designation', value: (u) => u.designation ?? u.role },
    { key: 'dealer', value: (u) => u.dealerName ?? '' },
    { key: 'status', value: (u) => (u.active ? 'Active' : 'Inactive') },
    { key: 'workArea', value: (u) => (u.workLocationCodes.length === 0 ? 'all' : u.workLocationCodes.map((c) => knownWorkshops[c] ?? c).join(' ')) },
  ]
  const employeesView = useListView(users, employeeFields, {
    getKey: (u) => u.id,
    prefilter: (u) => (showInactive || u.active) && (!locationFilter || u.workLocationCodes.includes(locationFilter)),
    version: `${showInactive}|${locationFilter}`,
  })
  const shown = employeesView.pageRows
  const field = (label: string, key: 'name' | 'email' | 'password' | 'mobile' | 'state' | 'city' | 'pincode' | 'dateOfJoining', extra: { secure?: boolean; keyboard?: 'default' | 'number-pad' | 'email-address'; max?: number; placeholder?: string; disabled?: boolean } = {}) => (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, extra.disabled && { backgroundColor: '#f4f6f9' }]} value={form[key]} secureTextEntry={extra.secure} keyboardType={extra.keyboard ?? 'default'} maxLength={extra.max}
        editable={!extra.disabled} autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" placeholder={extra.placeholder} placeholderTextColor={colors.textMuted}
        onChangeText={(v) => setForm({ ...form, [key]: key === 'mobile' ? v.replace(/\D/g, '').slice(0, 10) : v })}
      />
    </View>
  )

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
      data={formOpen ? [] : shown}
      keyExtractor={(u) => u.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          <SearchBox value={employeesView.query} onChangeText={employeesView.setQuery} placeholder="Search name, email, designation or dealer…" />
          <View style={{ marginTop: 8 }}>
            <PickerField label="Work Area location" value={locationFilter} onChange={setLocationFilter} options={[{ value: '', label: 'All locations' }, ...allLocationCodes.map((c) => ({ value: c, label: locationLabel(c) }))]} />
          </View>
          <View style={styles.toolbar}>
            <View style={styles.switchRow}><Switch value={showInactive} onValueChange={setShowInactive} /><Text style={styles.muted}>Show inactive</Text></View>
            {!formOpen && <TouchableOpacity style={styles.primaryBtn} onPress={openAdd}><Text style={styles.primaryBtnText}>+ Add Employee</Text></TouchableOpacity>}
          </View>
          {!formOpen && <SortChips options={[{ key: 'name', label: 'Name' }, { key: 'designation', label: 'Designation' }, { key: 'dealer', label: 'Dealer' }, { key: 'status', label: 'Status' }]} sort={employeesView.sort} onToggle={employeesView.toggleSort} />}
          {!formOpen && <Text style={[styles.muted, { marginTop: 8 }]}>{employeesView.total === employeesView.allTotal ? `${employeesView.allTotal} employees` : `${employeesView.total} of ${employeesView.allTotal} employees`}</Text>}
          {error && <Text style={styles.errorText}>{error}</Text>}
          {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 10 }} />}

          {formOpen && (
            <View style={styles.card}>
              <Text style={styles.h3}>{form.id ? 'Edit Employee' : 'Add Employee'}</Text>
              {field('Employee Name *', 'name')}
              {field('Email / Login Id *', 'email', { keyboard: 'email-address', disabled: !!form.id })}
              {field(form.id ? 'New password (leave blank to keep)' : 'Password *', 'password', { secure: true })}
              {field('Mobile (10 digits)', 'mobile', { keyboard: 'number-pad', max: 10 })}
              <View style={{ marginTop: 8 }}><PickerField label="Designation" required value={form.designation} onChange={(v) => setForm({ ...form, designation: v })} options={[...(form.designation && !(DESIGNATIONS as readonly string[]).includes(form.designation) ? [{ value: form.designation, label: form.designation }] : []), ...DESIGNATIONS.map((d) => ({ value: d, label: d }))]} /></View>
              {form.id && form.role ? <Text style={styles.muted}>Role (set by the server from the Designation): {form.role}</Text> : null}
              {field('State', 'state')}
              {field('City', 'city')}
              {field('Pincode', 'pincode', { keyboard: 'number-pad', max: 6 })}
              {field('Date of joining (YYYY-MM-DD)', 'dateOfJoining', { placeholder: '2026-10-22' })}

              <Text style={[styles.h3, { marginTop: 14 }]}>Work Area ({form.workLocationCodes.length} selected)</Text>
              {isCorporateOrSystem && (
                <View style={{ marginTop: 6 }}><PickerField label="Dealer (whose workshops to list)" value={workDealerId} onChange={(v) => { setWorkDealerId(v); setForm((f) => ({ ...f, dealerId: f.dealerId || v })) }} options={dealers.map((d) => ({ value: d.id, label: `${d.code ? `${d.code} - ` : ''}${d.name}` }))} /></View>
              )}
              {workshopError && <Text style={styles.errorText}>{workshopError}</Text>}
              {locationDealerId && workshops.length === 0 && !workshopError && <Text style={styles.muted}>No workshop locations on file for this dealer.</Text>}
              {!locationDealerId && <Text style={styles.muted}>{isCorporateOrSystem ? 'Pick a dealer to list its workshop locations.' : 'No dealer on your account.'}</Text>}
              {workshops.map((w) => (
                <TouchableOpacity key={w.locCode} style={styles.checkRow} onPress={() => toggleLoc(w.locCode)}>
                  <Text style={styles.box}>{form.workLocationCodes.includes(w.locCode) ? '☑' : '☐'}</Text>
                  <Text style={styles.rowText}>{w.locName} ({w.locCode})</Text>
                </TouchableOpacity>
              ))}
              {form.workLocationCodes.filter((c) => !workshops.some((w) => w.locCode === c)).map((c) => (
                <TouchableOpacity key={c} style={styles.checkRow} onPress={() => toggleLoc(c)}>
                  <Text style={styles.box}>☑</Text><Text style={styles.rowText}>{knownWorkshops[c] ? `${knownWorkshops[c]} (${c})` : c}</Text>
                </TouchableOpacity>
              ))}

              {formError && <Text style={styles.errorText}>{formError}</Text>}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }, busy && { opacity: 0.6 }]} disabled={busy} onPress={save}><Text style={styles.primaryBtnText}>{busy ? 'Saving…' : form.id ? 'Save changes' : 'Create employee'}</Text></TouchableOpacity>
                <TouchableOpacity style={styles.btn} onPress={closeForm}><Text style={styles.btnText}>Cancel</Text></TouchableOpacity>
              </View>
            </View>
          )}
        </>
      }
      ListEmptyComponent={!loading && !error && !formOpen ? <Text style={styles.muted}>No employees found.</Text> : null}
      ListFooterComponent={!formOpen && employeesView.total > 0 ? <PagerBar page={employeesView.page} pageCount={employeesView.pageCount} total={employeesView.total} onPage={employeesView.setPage} pageSize={employeesView.pageSize} onPageSize={employeesView.setPageSize} /> : null}
      renderItem={({ item: u }) => (
        <View style={[styles.row, !u.active && { opacity: 0.55 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{u.name}</Text>
            <Text style={styles.muted}>{u.email}{u.mobile ? ` · ${u.mobile}` : ''}</Text>
            <Text style={styles.muted}>{u.designation ?? u.role}{u.dealerName ? ` · ${u.dealerName}` : ''}{u.active ? '' : ' · inactive'}</Text>
            <Text style={styles.muted}>Work Area: {u.workLocationCodes.length === 0 ? 'all' : u.workLocationCodes.map((c) => knownWorkshops[c] ?? c).join(', ')}</Text>
          </View>
          <View style={{ gap: 6 }}>
            <TouchableOpacity style={styles.btn} onPress={() => openEdit(u)}><Text style={styles.btnText}>Edit</Text></TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => toggleActive(u)}><Text style={styles.btnText}>{u.active ? 'Deactivate' : 'Activate'}</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={() => remove(u)}><Text style={[styles.btnText, { color: '#fff' }]}>Delete</Text></TouchableOpacity>
          </View>
        </View>
      )}
    />
  )
}

export function AdminUsersScreen() {
  const [users, setUsers] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState('')
  const [editing, setEditing] = useState<{ id: string; role: string } | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    apiClient.get<StaffUser[]>('/api/users')
      .then((r) => setUsers(r.data))
      .catch((err) => { setUsers([]); setError(apiErrorMessage(err, 'Could not load the users.')) })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const saveRole = async (u: StaffUser) => {
    if (!editing) return
    try { await apiClient.put(`/api/users/${u.id}`, { role: editing.role }); setEditing(null); load() } catch (err) { Alert.alert('Admin: Users', apiErrorMessage(err, 'Could not change the role.')) }
  }
  const toggleActive = (u: StaffUser) => apiClient.put(`/api/users/${u.id}`, { active: !u.active }).then(load).catch((err) => Alert.alert('Admin: Users', apiErrorMessage(err, 'Could not change this user.')))

// 2026-10-23 ("all pages add in sorting and pagination and ui attractive"): search on every field, sort chips and 10 rows per page (lib/listView.ts + components/ListControls.tsx).
  const adminFields: Field<StaffUser>[] = [
    { key: 'name', value: (u) => u.name },
    { key: 'email', value: (u) => u.email },
    { key: 'role', value: (u) => u.role },
    { key: 'dealer', value: (u) => u.dealerName ?? 'All dealers' },
    { key: 'status', value: (u) => (u.active ? 'Active' : 'Inactive') },
  ]
  const adminView = useListView(users, adminFields, { getKey: (u) => u.id, prefilter: (u) => !roleFilter || u.role === roleFilter, version: roleFilter })
  const shown = adminView.pageRows

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
      data={shown}
      keyExtractor={(u) => u.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          <SearchBox value={adminView.query} onChangeText={adminView.setQuery} placeholder="Search name, email, role or dealer…" />
          <View style={{ marginTop: 8 }}><PickerField label="Role" value={roleFilter} onChange={setRoleFilter} options={[{ value: '', label: 'All roles' }, ...ALL_ROLES.map((r) => ({ value: r, label: r }))]} /></View>
          <SortChips options={[{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'dealer', label: 'Dealer' }, { key: 'status', label: 'Status' }]} sort={adminView.sort} onToggle={adminView.toggleSort} />
          <Text style={[styles.muted, { marginTop: 8 }]}>{adminView.total} of {adminView.allTotal} logins. Azure AD directory sync and the BAPL dealer import are on the web page.</Text>
          {error && <Text style={styles.errorText}>{error}</Text>}
          {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 10 }} />}
        </>
      }
      ListEmptyComponent={!loading && !error ? <Text style={styles.muted}>No users found.</Text> : null}
      ListFooterComponent={adminView.total > 0 ? <PagerBar page={adminView.page} pageCount={adminView.pageCount} total={adminView.total} onPage={adminView.setPage} pageSize={adminView.pageSize} onPageSize={adminView.setPageSize} /> : null}
      renderItem={({ item: u }) => (
        <View style={[styles.row, !u.active && { opacity: 0.55 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{u.name}</Text>
            <Text style={styles.muted}>{u.email}</Text>
            <Text style={styles.muted}>{u.role}{u.designation ? ` (${u.designation})` : ''} · {u.dealerName ?? 'All dealers'}{u.active ? '' : ' · inactive'}</Text>
            {editing?.id === u.id && (
              <View style={{ marginTop: 8 }}>
                <PickerField label="New role" value={editing.role} onChange={(v) => setEditing({ id: u.id, role: v })} options={ALL_ROLES.map((r) => ({ value: r, label: r }))} />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity style={styles.primaryBtn} onPress={() => void saveRole(u)}><Text style={styles.primaryBtnText}>Save role</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.btn} onPress={() => setEditing(null)}><Text style={styles.btnText}>Cancel</Text></TouchableOpacity>
                </View>
              </View>
            )}
          </View>
          <View style={{ gap: 6 }}>
            <TouchableOpacity style={styles.btn} onPress={() => setEditing({ id: u.id, role: u.role })}><Text style={styles.btnText}>Change role</Text></TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => toggleActive(u)}><Text style={styles.btnText}>{u.active ? 'Deactivate' : 'Activate'}</Text></TouchableOpacity>
          </View>
        </View>
      )}
    />
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, marginVertical: 10 },
  h3: { fontSize: 15, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.text },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  box: { fontSize: 18, color: colors.primary },
  rowText: { color: colors.text, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 8 },
  rowTitle: { fontWeight: '700', color: colors.text },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 8 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', backgroundColor: '#fff' },
  btnDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnText: { fontWeight: '700', color: colors.text, fontSize: 13 },
})
