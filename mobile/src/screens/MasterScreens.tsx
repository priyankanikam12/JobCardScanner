// mobile\src\screens\MasterScreens.tsx
import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { MasterCrud, type MasterRowBase } from '../components/MasterCrud'
import { NAV_ITEMS } from '../navigation/menuAccess'
import { colors } from '../theme/colors'
import type { WorkflowStage } from '../types'

/**
 * 2026-10-22 (Android counterparts of web's Service Menu Master, Complaint Master, Prefix Master and Admin: Workflow pages). The first three are the same list + add / edit / deactivate pattern over the
 * app's own master tables (see components/MasterCrud.tsx); each says only which fields it has and how the form becomes the request body, copied from the web page's own save().
 */

// ---------------- Service Menu Master: Job Type -> Service Head -> Priority (feeds the Job Card Wizard's cascade) ----------------
interface ServiceMenuRow extends MasterRowBase {
  jobTypeId: number; jobTypeName: string; serviceHeadId: number; serviceHeadName: string; priorityValue: string; priorityLabel: string; sortOrder: number
}
export function ServiceMenuMasterScreen() {
  const { hasRole } = useStaffAuth()
  return (
    <MasterCrud<ServiceMenuRow>
      baseUrl="/api/service-menu-master"
      nounSingular="Service Menu row"
      intro="Job Type → Service Head → Priority - the cascade of the New Job Card wizard. A deactivated row disappears from the wizard at once but stays here and can be reactivated."
      canManage={hasRole('WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin')}
      fields={[
        { key: 'jobTypeId', label: 'Job Type Id', kind: 'number' },
        { key: 'jobTypeName', label: 'Job Type Name', kind: 'text' },
        { key: 'serviceHeadId', label: 'Service Head Id', kind: 'number' },
        { key: 'serviceHeadName', label: 'Service Head Name', kind: 'text' },
        { key: 'priorityValue', label: 'Priority value', kind: 'text' },
        { key: 'priorityLabel', label: 'Priority label', kind: 'text' },
        { key: 'sortOrder', label: 'Sort order', kind: 'number' },
      ]}
      emptyForm={{ jobTypeId: '', jobTypeName: '', serviceHeadId: '', serviceHeadName: '', priorityValue: '', priorityLabel: '', sortOrder: '0' }}
      rowTitle={(r) => `${r.jobTypeName} → ${r.serviceHeadName}`}
      rowSubtitle={(r) => `Priority ${r.priorityLabel} (${r.priorityValue}) · order ${r.sortOrder} · ids ${r.jobTypeId}/${r.serviceHeadId}`}
      rowToForm={(r) => ({ jobTypeId: String(r.jobTypeId), jobTypeName: r.jobTypeName, serviceHeadId: String(r.serviceHeadId), serviceHeadName: r.serviceHeadName, priorityValue: r.priorityValue, priorityLabel: r.priorityLabel, sortOrder: String(r.sortOrder) })}
      buildBody={(f, isEdit) => {
        const body = {
          jobTypeId: Number(f.jobTypeId), jobTypeName: String(f.jobTypeName).trim(), serviceHeadId: Number(f.serviceHeadId), serviceHeadName: String(f.serviceHeadName).trim(),
          priorityValue: String(f.priorityValue).trim(), priorityLabel: String(f.priorityLabel).trim(), sortOrder: Number(f.sortOrder) || 0,
        }
        if (!body.jobTypeName || !body.serviceHeadName || !body.priorityValue || !body.priorityLabel || !f.jobTypeId || !f.serviceHeadId) {
          return { error: 'Job Type Id/Name, Service Head Id/Name and both Priority fields are all required.' }
        }
        return { body: isEdit ? { ...body, isActive: true } : body }
      }}
      reactivateBody={(r) => ({ jobTypeId: r.jobTypeId, jobTypeName: r.jobTypeName, serviceHeadId: r.serviceHeadId, serviceHeadName: r.serviceHeadName, priorityValue: r.priorityValue, priorityLabel: r.priorityLabel, sortOrder: r.sortOrder, isActive: true })}
    />
  )
}

// ---------------- Complaint Master: the shared complaint list of the wizard ----------------
interface ComplaintRow extends MasterRowBase { complaintText: string; sortOrder: number }
export function ComplaintMasterScreen() {
  const { hasRole } = useStaffAuth()
  return (
    <MasterCrud<ComplaintRow>
      baseUrl="/api/complaint-master"
      nounSingular="complaint"
      intro="The shared complaint list of the New Job Card wizard. (Bulk import from a file is on the web page.)"
      canManage={hasRole('WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin')}
      fields={[{ key: 'complaintText', label: 'Complaint text', kind: 'text' }, { key: 'sortOrder', label: 'Sort order', kind: 'number' }]}
      emptyForm={{ complaintText: '', sortOrder: '0' }}
      rowTitle={(r) => r.complaintText}
      rowSubtitle={(r) => `order ${r.sortOrder}`}
      rowToForm={(r) => ({ complaintText: r.complaintText, sortOrder: String(r.sortOrder) })}
      buildBody={(f, isEdit) => {
        const text = String(f.complaintText).trim()
        if (!text) return { error: 'Complaint text is required.' }
        const body = { complaintText: text, sortOrder: Number(f.sortOrder) || 0 }
        return { body: isEdit ? { ...body, isActive: true } : body }
      }}
      reactivateBody={(r) => ({ complaintText: r.complaintText, sortOrder: r.sortOrder, isActive: true })}
    />
  )
}

// ---------------- Prefix Master: JC / MT / RB document numbering prefixes (CorporateAdmin / SystemAdmin) ----------------
interface PrefixRow extends MasterRowBase { moduleKey: string; prefix: string; usesFinancialYear: boolean }
const moduleLabel = (key: string) => NAV_ITEMS.find((m) => m.key === key)?.label ?? key
export function PrefixMasterScreen() {
  const { hasRole } = useStaffAuth()
  return (
    <MasterCrud<PrefixRow>
      baseUrl="/api/doc-prefix-master"
      nounSingular="prefix"
      intro="Document numbering prefixes per module (JC / MT / RB ...). Changing a prefix only affects documents numbered from then on."
      canManage={hasRole('CorporateAdmin', 'SystemAdmin')}
      fields={[
        { key: 'moduleKey', label: 'Module', kind: 'select', createOnly: true, options: NAV_ITEMS.map((m) => ({ value: m.key, label: m.label })) },
        { key: 'prefix', label: 'Prefix', kind: 'text' },
        { key: 'usesFinancialYear', label: 'Uses financial year in the number', kind: 'bool' },
      ]}
      emptyForm={{ moduleKey: '', prefix: '', usesFinancialYear: true }}
      rowTitle={(r) => `${moduleLabel(r.moduleKey)} - ${r.prefix}`}
      rowSubtitle={(r) => `${r.moduleKey} · ${r.usesFinancialYear ? 'with financial year' : 'no financial year'}`}
      rowToForm={(r) => ({ moduleKey: r.moduleKey, prefix: r.prefix, usesFinancialYear: r.usesFinancialYear })}
      buildBody={(f, isEdit) => {
        const prefix = String(f.prefix).trim()
        if (!prefix) return { error: 'Prefix is required.' }
        if (!isEdit && !f.moduleKey) return { error: 'Module is required.' }
        return { body: isEdit ? { prefix, usesFinancialYear: !!f.usesFinancialYear, isActive: true } : { moduleKey: f.moduleKey, prefix, usesFinancialYear: !!f.usesFinancialYear } }
      }}
      reactivateBody={(r) => ({ prefix: r.prefix, usesFinancialYear: r.usesFinancialYear, isActive: true })}
    />
  )
}

// ---------------- Admin: Workflow ----------------
export function AdminWorkflowScreen() {
  const [stages, setStages] = useState<WorkflowStage[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ stageKey: '', label: '', seq: '1', icon: '', active: true, isTerminal: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => apiClient.get<WorkflowStage[]>('/api/workflow-stages').then((r) => setStages(r.data)).finally(() => setLoading(false))
  useEffect(() => { void load() }, [])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await apiClient.post('/api/workflow-stages', { ...form, seq: Number(form.seq) || 1 })
      setForm({ stageKey: '', label: '', seq: String(stages.length + 1), icon: '', active: true, isTerminal: false })
      await load()
    } catch (err) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not save this stage.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.muted}>Stages with no dealer override come from the global default template. Adding a stage here creates (or overrides) one for your dealer.</Text>
      {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />}
      {stages.map((s) => (
        <View key={s.id} style={styles.row}>
          <Text style={styles.seq}>{s.seq}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{s.label}</Text>
            <Text style={styles.muted}>{s.stageKey}{s.isTerminal ? ' · terminal' : ''}</Text>
          </View>
        </View>
      ))}
      <View style={styles.card}>
        <Text style={styles.h3}>Add / override a stage for your dealer</Text>
        <Text style={styles.label}>Stage key</Text>
        <TextInput style={styles.input} value={form.stageKey} onChangeText={(v) => setForm({ ...form, stageKey: v })} placeholder="e.g. custom_wash" autoCapitalize="none" />
        <Text style={styles.label}>Label</Text>
        <TextInput style={styles.input} value={form.label} onChangeText={(v) => setForm({ ...form, label: v })} placeholder="Pre-Delivery Wash" />
        <Text style={styles.label}>Sequence</Text>
        <TextInput style={styles.input} value={form.seq} onChangeText={(v) => setForm({ ...form, seq: v })} keyboardType="numeric" />
        <View style={styles.switchRow}><Switch value={form.isTerminal} onValueChange={(v) => setForm({ ...form, isTerminal: v })} /><Text style={styles.rowTitle}>Terminal stage</Text></View>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <TouchableOpacity style={[styles.primaryBtn, (!form.stageKey || !form.label || saving) && { opacity: 0.5 }]} disabled={!form.stageKey || !form.label || saving} onPress={save}>
          <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save Stage'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 14 },
  h3: { fontSize: 15, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  label: { fontSize: 12, color: colors.textMuted, marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 8 },
  seq: { fontWeight: '700', color: colors.primary, width: 24, textAlign: 'center' },
  rowTitle: { fontWeight: '700', color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 8 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
})
