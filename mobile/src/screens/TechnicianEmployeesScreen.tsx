import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { PickerField, type PickerOption } from '../components/PickerField'
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

const emptyForm = { id: null as string | null, name: '', locationCode: '' }

export function TechnicianEmployeesScreen() {
  const { profile, hasRole } = useStaffAuth()
  const canManage = hasRole('Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin')

  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [includeInactive, setIncludeInactive] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    apiClient.get<Technician[]>('/api/technicians', { params: { includeInactive } })
      .then((r) => setTechnicians(r.data))
      .finally(() => setLoading(false))
  }
  useEffect(load, [includeInactive])

  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  useEffect(() => {
    if (!profile?.dealerId) { setWorkshops([]); return }
    apiClient.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then((r) => setWorkshops(r.data))
      .catch(() => setWorkshops([]))
  }, [profile?.dealerId])
  const workshopOptions: PickerOption[] = workshops.map((w) => ({ label: `${w.locName} (${w.locCode})`, value: w.locCode }))

  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const resetForm = () => { setForm(emptyForm); setError(null) }

  const editTechnician = (t: Technician) => { setForm({ id: t.id, name: t.name, locationCode: t.locationCode }); setError(null) }

  const save = async () => {
    setError(null)
    if (!form.name.trim()) { setError('Name is required.'); return }
    if (!form.locationCode) { setError('Location is required.'); return }
    const locationName = workshops.find((w) => w.locCode === form.locationCode)?.locName ?? null
    setBusy(true)
    try {
      if (form.id) {
        await apiClient.put(`/api/technicians/${form.id}`, { name: form.name.trim(), locationCode: form.locationCode, locationName })
      } else {
        await apiClient.post('/api/technicians', { name: form.name.trim(), locationCode: form.locationCode, locationName })
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
        data={technicians}
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
                <View style={{ marginTop: 10 }}>
                  <PickerField
                    label="Location"
                    value={form.locationCode}
                    options={workshopOptions}
                    placeholder={workshops.length ? 'Select workshop…' : 'No workshops found for this dealer yet'}
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
            <View style={styles.toggleRow}>
              <Text style={styles.label}>Show inactive</Text>
              <Switch value={includeInactive} onValueChange={setIncludeInactive} />
            </View>
            {loading && <ActivityIndicator style={{ marginVertical: 10 }} color={colors.primary} />}
          </>
        }
        ListEmptyComponent={!loading ? <Text style={styles.muted}>No technicians yet{canManage ? ' - add one above.' : '.'}</Text> : null}
        renderItem={({ item: t }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{t.name}</Text>
              <Text style={styles.muted}>{t.locationName ? `${t.locationName} (${t.locationCode})` : t.locationCode}</Text>
              <Text style={styles.muted}>{t.active ? 'Active' : 'Inactive'}</Text>
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
})
