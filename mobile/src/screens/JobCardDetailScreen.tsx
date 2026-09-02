import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert, Image, Linking, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
// expo-file-system 54+ replaced the old imperative API with File/Directory classes; the legacy
// subpath keeps writeAsStringAsync/cacheDirectory/EncodingType working exactly as before - used
// here since it's the simplest fit for "base64 PDF bytes in, a file on disk out".
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { Badge } from '../components/Badge'
import { PickerField, type PickerOption } from '../components/PickerField'
import { PartSuggestionSection } from '../components/PartSuggestionSection'
import { LabourSuggestionSection } from '../components/LabourSuggestionSection'
import { WorkflowTimelineView, type WorkflowTimelineHistoryEntry } from '../components/WorkflowTimelineView'
import type { BaplDmsJobCardHistory, JobCardDetail, PhotoStage, WorkflowStage } from '../types'
import type { RootStackParamList } from '../navigation/RootNavigator'

type Props = NativeStackScreenProps<RootStackParamList, 'JobCardDetail'>

// Photo URLs come back from the API as a relative path (e.g. "/uploads/jobcard-photos/.../x.jpg") -
// same origin as the API itself, not the app's own bundle - mirrors web's photoSrc helper.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? ''
const photoSrc = (url: string) => (url.startsWith('http') ? url : `${API_BASE_URL}${url}`)

/** Mirrors web/src/pages/staff/JobCardDetailPage.tsx's HIDDEN_WORKFLOW_STAGE_KEYS /
 * MERGED_CHECKIN_LABEL - see that file's doc comment for why these three stage keys are hidden
 * from the timeline and stage-update picker, and "check_in"/"job_card_created" are shown merged. */
const HIDDEN_WORKFLOW_STAGE_KEYS = new Set(['job_card_created', 'quality_check', 'rework'])
const MERGED_CHECKIN_LABEL = 'Vehicle Check-In / Job Card Created'

function buildTimelineStages(stages: WorkflowStage[]): WorkflowStage[] {
  return stages
    .filter((s) => !HIDDEN_WORKFLOW_STAGE_KEYS.has(s.stageKey))
    .map((s) => (s.stageKey === 'check_in' ? { ...s, label: MERGED_CHECKIN_LABEL } : s))
}

function buildTimelineHistory(jc: JobCardDetail): WorkflowTimelineHistoryEntry[] {
  const out: WorkflowTimelineHistoryEntry[] = []
  let merged: WorkflowTimelineHistoryEntry | null = null
  for (const h of jc.stageHistory) {
    const key = h.stage?.stageKey
    if (key === 'quality_check' || key === 'rework') continue
    if (key === 'check_in' || key === 'job_card_created') {
      if (!merged) {
        merged = { stageLabel: MERGED_CHECKIN_LABEL, enteredAt: h.enteredAt, exitedAt: h.exitedAt }
        out.push(merged)
      } else {
        if (new Date(h.enteredAt).getTime() < new Date(merged.enteredAt).getTime()) merged.enteredAt = h.enteredAt
        if (h.exitedAt && (!merged.exitedAt || new Date(h.exitedAt).getTime() > new Date(merged.exitedAt).getTime())) merged.exitedAt = h.exitedAt
      }
      continue
    }
    out.push({ stageLabel: h.stage?.label, enteredAt: h.enteredAt, exitedAt: h.exitedAt })
  }
  return out
}

function resolveTimelineCurrentStageId(stages: WorkflowStage[], currentStage?: WorkflowStage): string | undefined {
  if (!currentStage) return undefined
  if (!HIDDEN_WORKFLOW_STAGE_KEYS.has(currentStage.stageKey)) return currentStage.id
  const visible = stages.filter((s) => !HIDDEN_WORKFLOW_STAGE_KEYS.has(s.stageKey) && s.seq <= currentStage.seq)
  return visible.sort((a, b) => b.seq - a.seq)[0]?.id
}

type Run = (fn: () => Promise<unknown>, successMsg?: string) => void

export function JobCardDetailScreen({ route }: Props) {
  const { id } = route.params
  const { profile, hasRole } = useStaffAuth()
  const [jc, setJc] = useState<JobCardDetail | null>(null)
  const [stages, setStages] = useState<WorkflowStage[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = async () => {
    const [jcRes, stagesRes] = await Promise.all([
      apiClient.get<JobCardDetail>(`/api/jobcards/${id}`),
      apiClient.get<WorkflowStage[]>('/api/workflow-stages'),
    ])
    setJc(jcRes.data)
    setStages(stagesRes.data)
  }

  useEffect(() => { load() }, [id])

  if (!jc) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    )
  }

  const run: Run = async (fn, successMsg) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      await load()
      if (successMsg) setMsg(successMsg)
    } catch (err: unknown) {
      setMsg((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  const baplLine = [
    jc.baplJobType && `Job Type: ${jc.baplJobType}`,
    jc.baplServiceHeadName && `Service Head: ${jc.baplServiceHeadName}`,
    jc.baplServiceTypeName && `Service Type: ${jc.baplServiceTypeName}`,
    jc.baplJobSourceName && `Source: ${jc.baplJobSourceName}`,
    jc.baplServiceLocation && `Location: ${jc.baplServiceLocation}`,
    jc.baplSupervisorName && `Supervisor: ${jc.baplSupervisorName}`,
    jc.baplTechnicianName && `Technician: ${jc.baplTechnicianName}`,
    jc.baplManualJobNo && `Manual Job No.: ${jc.baplManualJobNo}`,
  ].filter(Boolean).join(' · ')

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{jc.jobCardNumber}</Text>
        <Badge status={jc.status} />
      </View>
      {msg && <Text style={styles.muted}>{msg}</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Customer & Vehicle</Text>
        <Text style={styles.bold}>{jc.customer?.name}</Text>
        <Text>{jc.customer?.mobile}</Text>
        <Text style={{ marginTop: 6 }}>{jc.vehicle?.model} {jc.vehicle?.variant}</Text>
        <Text style={styles.muted}>Reg: {jc.vehicle?.regNo} | Odometer: {jc.odometerAtCheckIn} km</Text>
        <Text style={styles.muted}>Tracking link: /track/{jc.trackingToken}</Text>
        {baplLine.length > 0 && (
          <Text style={[styles.muted, { marginTop: 8 }]}>
            <Text style={styles.dmsBadge}> DMS </Text> {baplLine}
          </Text>
        )}
        {jc.baplSyncStatus === 'Synced' && jc.baplJobCardHeaderId && (
          <Text style={[styles.muted, { marginTop: 4 }]}>
            ✅ Synced to BAPL DMS as {jc.baplJobNo != null ? `job card #${jc.baplJobNo}` : 'a job card (BAPL DMS sync pending)'}.
          </Text>
        )}
        {jc.baplSyncStatus === 'Failed' && (
          <Text style={[styles.errorText, { marginTop: 4 }]}>⚠ Not yet synced to BAPL DMS{jc.baplSyncError ? `: ${jc.baplSyncError}` : '.'}</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Workflow Timeline</Text>
        <WorkflowTimelineView
          stages={buildTimelineStages(stages)}
          currentStageId={resolveTimelineCurrentStageId(stages, jc.currentStage)}
          history={buildTimelineHistory(jc)}
        />
      </View>

      {hasRole('ServiceAdvisor', 'WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && (
        <UpdateWorkflowStageCard jc={jc} stages={stages} busy={busy} run={run} canAssignTechnician={hasRole('WorkshopManager', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin')} />
      )}

      <ComplaintsCard jc={jc} run={run} />
      <PhotosCard jc={jc} run={run} />
      <WorklogCard jc={jc} run={run} profileId={profile?.id} />

      <PartSuggestionSection jc={jc} onChanged={load} />
      <LabourSuggestionSection jc={jc} onChanged={load} />
      <EstimatesCard jc={jc} />
      {hasRole('Cashier', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && <InvoiceCard jc={jc} />}
      <BaplServiceHistoryCard chassisNo={jc.vehicle?.vin} dealerCode={jc.dealer?.code} />
      <ClosureCard jc={jc} run={run} />
    </ScrollView>
  )
}

/** Read-only reference panel showing BAPL DMS's own service/job-card history for this vehicle's
 * chassis (GET /api/bapl-dms/service-history) - mirrors web's BaplServiceHistoryCard. Silently
 * shows nothing if the vehicle has no VIN/chassis on file, or BAPL DMS has never seen this
 * chassis; only a real BAPL DMS problem (502) surfaces as an error. */
function BaplServiceHistoryCard({ chassisNo, dealerCode }: { chassisNo?: string | null; dealerCode?: string | null }) {
  const [rows, setRows] = useState<BaplDmsJobCardHistory[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRows(null)
    setError(null)
    if (!chassisNo) return
    apiClient.get<BaplDmsJobCardHistory[]>('/api/bapl-dms/service-history', { params: { chassisNo, dealerCode: dealerCode || undefined } })
      .then(({ data }) => setRows(data))
      .catch((err: any) => {
        if (err?.response?.status === 502) setError(err?.response?.data?.message ?? 'Could not reach BAPL DMS.')
        setRows([])
      })
  }, [chassisNo, dealerCode])

  if (!chassisNo) return null

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>BAPL DMS Service History</Text>
      {error && <Text style={styles.muted}>{error}</Text>}
      {rows === null && !error && <Text style={styles.muted}>Loading…</Text>}
      {rows !== null && rows.length === 0 && !error && <Text style={styles.muted}>No prior BAPL DMS job cards found for this chassis.</Text>}
      {rows !== null && rows.map((r) => (
        <View key={r.jobCardHeaderId} style={styles.historyRow}>
          <Text style={styles.rowTitle}>{r.jobPrefix}{r.jobNo} · {r.jobInDate ? new Date(r.jobInDate).toLocaleDateString() : '-'}</Text>
          <Text style={styles.muted}>Status: {r.jobStatus ?? '-'} · Inward: {r.inwardType ?? '-'} · Km: {r.vehicleKms ?? '-'}</Text>
          <Text style={styles.muted}>Complaints: {r.complaints ?? '-'}</Text>
          <Text style={styles.muted}>{r.supervisor ?? '-'} / {r.technician ?? '-'} · Invoice: {r.invoiceNo ?? '-'}</Text>
        </View>
      ))}
    </View>
  )
}

/** Photo capture + upload (Job Card Detail screen only, per parity with the web app's same
 * decision) - geotags each photo with the device's GPS location (best-effort) before uploading
 * via POST /api/jobcards/{id}/photos/upload. */
function PhotosCard({ jc, run }: { jc: JobCardDetail; run: Run }) {
  const [stage, setStage] = useState<PhotoStage>('CheckIn')
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [locationNote, setLocationNote] = useState<string | null>(null)

  const stageOptions: PickerOption[] = (['CheckIn', 'Inspection', 'Repair', 'Qc', 'Delivery'] as PhotoStage[]).map((s) => ({ label: s, value: s }))

  const getLocation = async (): Promise<{ latitude: number; longitude: number } | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return null
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
    } catch {
      return null
    }
  }

  const uploadResult = async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    setUploading(true)
    setLocationNote('Getting location…')
    try {
      const pos = await getLocation()
      setLocationNote(pos ? 'Location captured' : 'Location unavailable - uploading without it')
      const form = new FormData()
      // @ts-expect-error - RN's FormData accepts {uri,name,type} file parts
      form.append('File', { uri: asset.uri, name: asset.fileName || `photo-${Date.now()}.jpg`, type: asset.mimeType || 'image/jpeg' })
      form.append('Stage', stage)
      if (caption) form.append('Caption', caption)
      if (pos) {
        form.append('Latitude', String(pos.latitude))
        form.append('Longitude', String(pos.longitude))
      }
      await run(() => apiClient.post(`/api/jobcards/${jc.id}/photos/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } }), 'Photo uploaded.')
      setCaption('')
    } finally {
      setUploading(false)
      setTimeout(() => setLocationNote(null), 1500)
    }
  }

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Camera permission is needed to take a photo.'); return }
    await uploadResult(await ImagePicker.launchCameraAsync({ quality: 0.8 }))
  }

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Photo library permission is needed to add a photo.'); return }
    await uploadResult(await ImagePicker.launchImageLibraryAsync({ quality: 0.8 }))
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Photos</Text>
      <PickerField label="Stage" value={stage} options={stageOptions} disabled={uploading} onChange={(v) => setStage(v as PhotoStage)} />
      <View style={{ marginBottom: 10 }}>
        <Text style={styles.label}>Caption (optional)</Text>
        <TextInput style={styles.input} value={caption} editable={!uploading} onChangeText={setCaption} placeholder="e.g. Left mirror scratch" />
      </View>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <TouchableOpacity style={styles.btn} disabled={uploading} onPress={takePhoto}>
          <Text style={styles.btnText}>{uploading ? 'Uploading…' : '📷 Take Photo'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} disabled={uploading} onPress={pickPhoto}>
          <Text style={styles.btnText}>🖼️ Choose Photo</Text>
        </TouchableOpacity>
      </View>
      {locationNote && <Text style={styles.muted}>{locationNote}</Text>}

      {jc.photos.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          {jc.photos.map((p) => (
            <View key={p.id} style={{ width: 150 }}>
              <TouchableOpacity onPress={() => Linking.openURL(photoSrc(p.url))}>
                <Image source={{ uri: photoSrc(p.url) }} style={{ width: '100%', height: 110, borderRadius: 6, borderWidth: 1, borderColor: '#ddd' }} />
              </TouchableOpacity>
              <Text style={styles.muted}>{p.stage}{p.caption ? ` · ${p.caption}` : ''}</Text>
              {p.latitude != null && p.longitude != null && (
                <TouchableOpacity onPress={() => Linking.openURL(`https://maps.google.com/?q=${p.latitude},${p.longitude}`)}>
                  <Text style={styles.link}>📍 {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

/** Interactive counterpart to the read-only WorkflowTimelineView above - moves the job card to a
 * new stage (POST /stage, ServiceAdvisor+) and, for WorkshopManager+, also assigns a technician
 * and expected-completion date (PUT /api/jobcards/{id}) - mirrors web's UpdateWorkflowStageCard. */
function UpdateWorkflowStageCard({
  jc, stages, busy, run, canAssignTechnician,
}: {
  jc: JobCardDetail
  stages: WorkflowStage[]
  busy: boolean
  run: Run
  canAssignTechnician: boolean
}) {
  const nextStageAfterCurrent = (): string => {
    const visible = stages.filter((s) => !HIDDEN_WORKFLOW_STAGE_KEYS.has(s.stageKey)).sort((a, b) => a.seq - b.seq)
    if (visible.length === 0) return ''
    const currentSeq = jc.currentStage && !HIDDEN_WORKFLOW_STAGE_KEYS.has(jc.currentStage.stageKey) ? jc.currentStage.seq : -1
    return (visible.find((s) => s.seq > currentSeq) ?? visible[visible.length - 1]).id
  }
  const [stageId, setStageId] = useState(nextStageAfterCurrent)
  const [technicianName, setTechnicianName] = useState(jc.assignedTechnicianName ?? '')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    setStageId(nextStageAfterCurrent())
    setTechnicianName(jc.assignedTechnicianName ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jc.id, jc.currentStage?.id, jc.assignedTechnicianName, stages])

  const stageOptions: PickerOption[] = stages.filter((s) => !HIDDEN_WORKFLOW_STAGE_KEYS.has(s.stageKey)).map((s) => ({ label: s.label, value: s.id }))

  const submit = async () => {
    const tasks: Promise<unknown>[] = []
    if (stageId && stageId !== jc.currentStage?.id) {
      tasks.push(apiClient.post(`/api/jobcards/${jc.id}/stage`, { stageId, notes: notes || null }))
    }
    if (canAssignTechnician) {
      tasks.push(apiClient.put(`/api/jobcards/${jc.id}`, { assignedTechnicianName: technicianName || null }))
    }
    if (tasks.length > 0) await Promise.all(tasks)
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Update Workflow Stage</Text>
      <PickerField label="Stage" value={stageId} options={stageOptions} disabled={busy} placeholder="Select new stage…" onChange={setStageId} />
      {canAssignTechnician && (
        <View style={{ marginBottom: 10 }}>
          <Text style={styles.label}>Assign Technician</Text>
          <TextInput style={styles.input} value={technicianName} editable={!busy} onChangeText={setTechnicianName} placeholder="Technician name" />
        </View>
      )}
      <View style={{ marginBottom: 10 }}>
        <Text style={styles.label}>Remarks</Text>
        <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholder="Stage remarks…" />
      </View>
      <TouchableOpacity style={[styles.btnPrimarySm, busy && styles.btnDisabled]} disabled={busy} onPress={() => run(submit, 'Workflow stage updated.')}>
        <Text style={styles.btnPrimaryText}>Update Stage</Text>
      </TouchableOpacity>
    </View>
  )
}

function ComplaintsCard({ jc, run }: { jc: JobCardDetail; run: Run }) {
  const [text, setText] = useState('')
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Complaints & Inspection</Text>
      {jc.complaints.length === 0 && <Text style={styles.muted}>No complaints recorded.</Text>}
      {jc.complaints.map((c) => <Text key={c.id}>- {c.description}</Text>)}
      <View style={[styles.searchRow, { marginTop: 10 }]}>
        <TextInput style={[styles.input, { flex: 1 }]} value={text} onChangeText={setText} placeholder="Add inspection note" />
        <TouchableOpacity
          style={styles.btn}
          onPress={() => { run(() => apiClient.post(`/api/jobcards/${jc.id}/inspections`, { component: 'General', condition: 'NeedsAttention', notes: text })); setText('') }}
        >
          <Text style={styles.btnText}>Log Note</Text>
        </TouchableOpacity>
      </View>
      {jc.inspections.length > 0 && (
        <View style={{ marginTop: 10 }}>
          {jc.inspections.map((i) => (
            <View key={i.id} style={styles.historyRow}>
              <Text style={styles.rowTitle}>{i.component} · {i.condition}</Text>
              {i.notes && <Text style={styles.muted}>{i.notes}</Text>}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

/** Automatic timer - starts the moment this job card is open (no running log yet, job card isn't
 * Closed) and stops the moment the job card is Closed - mirrors web's WorklogCard exactly. */
function WorklogCard({ jc, run, profileId }: { jc: JobCardDetail; run: Run; profileId?: string }) {
  const openLog = jc.worklogs.find((w) => !w.endedAt)

  useEffect(() => {
    if (jc.status !== 'Closed' && !openLog) {
      run(() => apiClient.post(`/api/jobcards/${jc.id}/worklogs/start`, { technicianId: profileId, taskDescription: 'Service work' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jc.id, jc.status, openLog?.id])

  useEffect(() => {
    if (jc.status === 'Closed' && openLog) {
      run(() => apiClient.post(`/api/jobcards/worklogs/${openLog.id}/end`, {}))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jc.status, openLog?.id])

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Technician Work Log</Text>
      {openLog ? (
        <Text style={styles.muted}>⏱ Timer running since {new Date(openLog.startedAt).toLocaleTimeString()} (stops automatically when this job card is closed).</Text>
      ) : jc.status === 'Closed' ? (
        <Text style={styles.muted}>Timer stopped - this job card is closed.</Text>
      ) : (
        <Text style={styles.muted}>Starting timer…</Text>
      )}
      {jc.worklogs.map((w) => (
        <View key={w.id} style={styles.historyRow}>
          <Text style={styles.rowTitle}>{new Date(w.startedAt).toLocaleString()}</Text>
          <Text style={styles.muted}>{w.endedAt ? `Ended ${new Date(w.endedAt).toLocaleString()}` : 'Still running'} · {w.durationMinutes ?? '-'} min</Text>
        </View>
      ))}
    </View>
  )
}

/** Part Details + Labour Details + Grand Total - mirrors web's EstimatesCard exactly
 * (Amount = MRP x Qty for parts, Rate x Qty for labour). */
function EstimatesCard({ jc }: { jc: JobCardDetail }) {
  const money = (n: number) => `₹${n.toFixed(2)}`
  const partRows = jc.partSuggestions.map((p, i) => {
    const mrp = p.mrp ?? 0
    const qty = p.quantity ?? 1
    return { sr: i + 1, code: p.itemCode, description: p.description ?? '-', amount: mrp * qty }
  })
  const labourRows = jc.labourSuggestions.map((l, i) => {
    const rate = l.rateAtSuggestion ?? 0
    const qty = l.quantity ?? 1
    return { sr: i + 1, code: l.labourCode, description: l.labourDescription ?? '-', amount: rate * qty }
  })
  const partsTotal = partRows.reduce((sum, r) => sum + r.amount, 0)
  const labourTotal = labourRows.reduce((sum, r) => sum + r.amount, 0)
  const grandTotal = partsTotal + labourTotal

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Estimates Amount</Text>
      <Text style={styles.subheading}>Part Details</Text>
      {partRows.length === 0 && <Text style={styles.muted}>No parts suggested yet.</Text>}
      {partRows.map((r) => (
        <View key={r.sr} style={styles.estimateRow}>
          <Text style={{ flex: 1 }}>{r.sr}. {r.code} - {r.description}</Text>
          <Text style={styles.bold}>{money(r.amount)}</Text>
        </View>
      ))}
      {partRows.length > 0 && (
        <View style={styles.estimateTotalRow}><Text style={styles.bold}>Parts Total</Text><Text style={styles.bold}>{money(partsTotal)}</Text></View>
      )}

      <Text style={[styles.subheading, { marginTop: 14 }]}>Labour Details</Text>
      {labourRows.length === 0 && <Text style={styles.muted}>No labour suggested yet.</Text>}
      {labourRows.map((r) => (
        <View key={r.sr} style={styles.estimateRow}>
          <Text style={{ flex: 1 }}>{r.sr}. {r.code} - {r.description}</Text>
          <Text style={styles.bold}>{money(r.amount)}</Text>
        </View>
      ))}
      {labourRows.length > 0 && (
        <View style={styles.estimateTotalRow}><Text style={styles.bold}>Labour Total</Text><Text style={styles.bold}>{money(labourTotal)}</Text></View>
      )}

      <View style={styles.grandTotalRow}>
        <Text style={{ fontSize: 16, fontWeight: '700' }}>Grand Total</Text>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{money(grandTotal)}</Text>
      </View>
    </View>
  )
}

/** "Download Invoice from DMS" - BAPL DMS's own repair bill is the source of truth for a job
 * card's invoice, same as web's InvoiceCard. Downloads the PDF bytes, writes them to a local file
 * (expo-file-system) and hands that off to the native share sheet (expo-sharing) - the mobile
 * equivalent of web's browser download. */
function InvoiceCard({ jc }: { jc: JobCardDetail }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const res = await apiClient.get(`/api/jobcards/${jc.id}/invoice-pdf`, { responseType: 'arraybuffer' })
      const bytes = new Uint8Array(res.data as ArrayBuffer)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      const base64 = btoa(binary)
      const fileUri = `${FileSystem.cacheDirectory}invoice-${jc.baplJobNo ?? jc.id}.pdf`
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf', dialogTitle: 'Invoice' })
      } else {
        Alert.alert('Sharing is not available on this device.')
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) setNotice('No repair bill saved in BAPL DMS for this job yet.')
      else setError('Could not download the invoice from BAPL DMS. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Invoice</Text>
      <TouchableOpacity style={[styles.btnPrimarySm, busy && styles.btnDisabled]} disabled={busy} onPress={download}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Download Invoice from DMS</Text>}
      </TouchableOpacity>
      {notice && <Text style={styles.muted}>{notice}</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  )
}

function ClosureCard({ jc, run }: { jc: JobCardDetail; run: Run }) {
  const [otpRequestId, setOtpRequestId] = useState<string | null>(null)
  const [devOtpCode, setDevOtpCode] = useState<string | null>(null)
  const [code, setCode] = useState('')

  if (jc.status === 'Closed') {
    return <View style={styles.card}><Text style={styles.cardTitle}>Job Card Closed</Text></View>
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>OTP-Based Closure</Text>
      {!otpRequestId ? (
        <TouchableOpacity
          style={styles.btnPrimarySm}
          onPress={async () => {
            const { data } = await apiClient.post(`/api/jobcards/${jc.id}/closure/otp`)
            setOtpRequestId(data.otpRequestId)
            setDevOtpCode(data.devOtpCode ?? null)
          }}
        >
          <Text style={styles.btnPrimaryText}>Send Closure OTP to Customer</Text>
        </TouchableOpacity>
      ) : (
        <View>
          {devOtpCode && <Text style={styles.muted}>Dev mode (no SMS provider configured) — OTP code: {devOtpCode}</Text>}
          <View style={styles.searchRow}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="6-digit OTP" value={code} onChangeText={setCode} keyboardType="number-pad" />
            <TouchableOpacity style={styles.btnPrimarySm} onPress={() => run(() => apiClient.post(`/api/jobcards/${jc.id}/closure/verify`, { otpRequestId, code }))}>
              <Text style={styles.btnPrimaryText}>Verify & Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f9', padding: 12 },
  loadingContainer: { flex: 1, backgroundColor: '#f4f6f9', alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#101828' },
  card: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e6ec', padding: 14, marginBottom: 10 },
  cardTitle: { fontWeight: '700', marginBottom: 8, color: '#101828' },
  subheading: { fontWeight: '600', marginBottom: 6, color: '#101828' },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  errorText: { fontSize: 12, color: '#dc2626', marginTop: 4 },
  bold: { fontWeight: '700', color: '#101828' },
  link: { color: '#2563eb', fontSize: 11, marginTop: 2 },
  label: { fontSize: 12, color: '#6b7280', marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 8 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  btn: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#fff' },
  btnText: { color: '#374151', fontWeight: '600' },
  btnPrimarySm: { backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', alignSelf: 'flex-start' },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  dmsBadge: { backgroundColor: '#1c64f2', color: '#fff', fontSize: 11, fontWeight: '700', borderRadius: 999, overflow: 'hidden' },
  historyRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f1f3f6' },
  rowTitle: { fontWeight: '600', color: '#101828' },
  estimateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  estimateTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, marginTop: 2 },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 10, borderTopWidth: 2, borderTopColor: '#e2e6ec' },
})
