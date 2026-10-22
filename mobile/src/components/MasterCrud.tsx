// mobile\src\components\MasterCrud.tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { PickerField, type PickerOption } from './PickerField'
import { colors } from '../theme/colors'

/**
 * One reusable list + add/edit/deactivate screen body for the small master tables (Service Menu Master, Complaint Master, Prefix Master) - they all follow the same web pattern: GET <base>/admin-list,
 * POST <base>, PUT <base>/{id} (with isActive), DELETE <base>/{id} = DEACTIVATE (the row stays in the list, greyed out, and one tap reactivates it), and a "Show inactive" toggle. Each screen only says
 * which fields it has and how its form becomes a request body; everything else is shared so the three cannot drift apart.
 */
export type FormValue = string | boolean
export type FormState = Record<string, FormValue>
export interface MasterField { key: string; label: string; kind: 'text' | 'number' | 'bool' | 'select'; options?: PickerOption[]; createOnly?: boolean }
export interface MasterRowBase { id: string; isActive: boolean }

export function MasterCrud<R extends MasterRowBase>({
  baseUrl, intro, fields, emptyForm, rowTitle, rowSubtitle, rowToForm, buildBody, reactivateBody, canManage, nounSingular,
}: {
  baseUrl: string
  intro: string
  fields: MasterField[]
  emptyForm: FormState
  rowTitle: (r: R) => string
  rowSubtitle: (r: R) => string
  rowToForm: (r: R) => FormState
  /** the request body for the form, or { error } when something required is missing; isEdit adds isActive: true on update */
  buildBody: (f: FormState, isEdit: boolean) => { body: object } | { error: string }
  reactivateBody: (r: R) => object
  canManage: boolean
  nounSingular: string
}) {
  const [rows, setRows] = useState<R[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editId, setEditId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    setError(null)
    apiClient.get<R[]>(`${baseUrl}/admin-list`)
      .then((r) => setRows(r.data))
      .catch((err) => { setRows([]); setError(err?.response?.data?.message ?? `Could not load the ${nounSingular} list.`) })
      .finally(() => setLoading(false))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openAdd = () => { setEditId(null); setForm(emptyForm); setFormError(null); setFormOpen(true) }
  const openEdit = (r: R) => { setEditId(r.id); setForm(rowToForm(r)); setFormError(null); setFormOpen(true) }
  const close = () => { setFormOpen(false); setEditId(null); setForm(emptyForm); setFormError(null) }

  const save = () => {
    const built = buildBody(form, !!editId)
    if ('error' in built) { setFormError(built.error); return }
    setSaving(true)
    setFormError(null)
    const req = editId ? apiClient.put(`${baseUrl}/${editId}`, built.body) : apiClient.post(baseUrl, built.body)
    req.then(() => { close(); load() })
      .catch((err) => setFormError(err?.response?.data?.message ?? `Could not save this ${nounSingular}.`))
      .finally(() => setSaving(false))
  }

  const toggleActive = (r: R) => {
    const done = () => load()
    const fail = (err: { response?: { data?: { message?: string } } }) => setError(err?.response?.data?.message ?? `Could not change this ${nounSingular}.`)
    if (r.isActive) {
      Alert.alert('Deactivate', `Deactivate this ${nounSingular}? It disappears from the pickers but stays here and can be reactivated.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Deactivate', style: 'destructive', onPress: () => apiClient.delete(`${baseUrl}/${r.id}`).then(done).catch(fail) },
      ])
    } else {
      apiClient.put(`${baseUrl}/${r.id}`, reactivateBody(r)).then(done).catch(fail)
    }
  }

  const q = search.trim().toLowerCase()
  const shown = rows.filter((r) => (showInactive || r.isActive) && (!q || `${rowTitle(r)} ${rowSubtitle(r)}`.toLowerCase().includes(q)))

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.muted}>{intro}</Text>
      <TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="Search…" placeholderTextColor={colors.textMuted} />
      <View style={styles.toolbar}>
        <View style={styles.switchRow}><Switch value={showInactive} onValueChange={setShowInactive} /><Text style={styles.muted}>Show inactive</Text></View>
        {canManage && <TouchableOpacity style={styles.primaryBtn} onPress={openAdd}><Text style={styles.primaryBtnText}>+ Add</Text></TouchableOpacity>}
      </View>

      {formOpen && canManage && (
        <View style={styles.card}>
          <Text style={styles.h3}>{editId ? `Edit ${nounSingular}` : `Add ${nounSingular}`}</Text>
          {fields.map((f) => {
            if (f.createOnly && editId) return null
            const v = form[f.key]
            if (f.kind === 'bool') {
              return (
                <View key={f.key} style={styles.switchRow}>
                  <Switch value={!!v} onValueChange={(nv) => setForm({ ...form, [f.key]: nv })} />
                  <Text style={styles.rowText}>{f.label}</Text>
                </View>
              )
            }
            if (f.kind === 'select') {
              return <View key={f.key} style={{ marginTop: 8 }}><PickerField label={f.label} value={String(v ?? '')} onChange={(nv) => setForm({ ...form, [f.key]: nv })} options={f.options ?? []} /></View>
            }
            return (
              <View key={f.key} style={{ marginTop: 8 }}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput style={styles.input} value={String(v ?? '')} keyboardType={f.kind === 'number' ? 'numeric' : 'default'} onChangeText={(nv) => setForm({ ...form, [f.key]: nv })} />
              </View>
            )
          })}
          {formError && <Text style={styles.errorText}>{formError}</Text>}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}><Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save'}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={close}><Text style={styles.btnText}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}
      {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />}
      {!loading && shown.length === 0 && !error && <Text style={styles.muted}>Nothing to show.</Text>}
      {shown.map((r) => (
        <View key={r.id} style={[styles.row, !r.isActive && { opacity: 0.55 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{rowTitle(r)}</Text>
            <Text style={styles.muted}>{rowSubtitle(r)}{r.isActive ? '' : ' · inactive'}</Text>
          </View>
          {canManage && (
            <View style={{ gap: 6 }}>
              <TouchableOpacity style={styles.btn} onPress={() => openEdit(r)}><Text style={styles.btnText}>Edit</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, r.isActive && styles.btnDanger]} onPress={() => toggleActive(r)}><Text style={[styles.btnText, r.isActive && { color: '#fff' }]}>{r.isActive ? 'Deactivate' : 'Reactivate'}</Text></TouchableOpacity>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, marginVertical: 10 },
  h3: { fontSize: 15, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginTop: 8, color: colors.text },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  rowText: { color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 8 },
  rowTitle: { fontWeight: '700', color: colors.text },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 8 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', backgroundColor: '#fff' },
  btnDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnText: { fontWeight: '700', color: colors.text, fontSize: 13 },
})
