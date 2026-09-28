import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
// expo-file-system 54+ replaced the old imperative API with File/Directory classes; the legacy
// subpath keeps writeAsStringAsync/cacheDirectory/EncodingType working exactly as before - used
// here since it's the simplest fit for "base64 PDF bytes in, a file on disk out".
import * as FileSystem from 'expo-file-system/legacy'
// PrintMenu below uses this for a real OS print dialog (Print.printAsync), same as the wizard's
// own Share/Download PDF buttons use Print.printToFileAsync - the mobile equivalent of web's
// window.print().
import * as Print from 'expo-print'
// Standalone InvoiceCard below uses this for its one-click "Download Invoice from DMS" (web keeps
// both that card AND the Print menu's own Invoice option - see PrintMenu's doc comment - so this
// mirrors that "quick one-click download without opening the menu" path on Android too).
import * as Sharing from 'expo-sharing'
import { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { Badge } from '../components/Badge'
import { PartSuggestionSection } from '../components/PartSuggestionSection'
import { LabourSuggestionSection } from '../components/LabourSuggestionSection'
import { WorkflowTimelineView, type WorkflowTimelineHistoryEntry } from '../components/WorkflowTimelineView'
import { PickerField, type PickerOption } from '../components/PickerField'
import { buildEstimatePrintHtml, buildJobCardPrintHtml } from '../utils/printJobCard'
import type { BaplDmsJobCardHistory, JobCardDetail, RepairBillDoc, StaffRole, Technician, WorkflowStage } from '../types'
import type { RootStackParamList } from '../navigation/RootNavigator'
import { colors } from '../theme/colors'

type Props = NativeStackScreenProps<RootStackParamList, 'JobCardDetail'>

// Photo URLs come back from the API as a relative path (e.g. "/uploads/jobcard-photos/.../x.jpg") -
// same origin as the API itself, not the app's own bundle - mirrors web's photoSrc helper.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? ''
const photoSrc = (url: string) => (url.startsWith('http') ? url : `${API_BASE_URL}${url}`)

// 2026-10-01 REMOVED (per explicit request - "Remove the cap entirely", same as web's
// JobCardDetailPage.tsx): the ₹2000 Grand Total hard-stop that used to block Part/Labour
// Suggestion from accepting new entries once the Estimates Amount Grand Total reached
// ESTIMATE_TOTAL_LOCK_THRESHOLD has been taken out here, along with the calcEstimateGrandTotal(jc)
// helper that only existed to compute that gate. There is now no maximum - see the
// totalLockReached={false} passed to PartSuggestionSection/LabourSuggestionSection below.
//
// FLAGGED - NOT fully done: PartSuggestionSection.tsx and LabourSuggestionSection.tsx (separate
// component files, not provided in this session) still receive a `totalLockReached` prop and, per
// the exact same pattern web's old PartSuggestionCard/LabourSuggestionCard had, almost certainly
// contain their OWN "Grand Total has reached ₹2000..." gating/messaging logic internally - I can't
// see or edit that logic without those two files. Passing totalLockReached={false} below makes the
// cap functionally inert (it can never trigger), which is the actual behavior change you asked
// for, but the now-dead ₹2000 message/threshold code inside those two files is still there unless
// you paste them so I can remove it the same way I did on web.

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

/** Raw chronological stage-history log ("grid") below the visual WorkflowTimelineView stepper -
 * mirrors web's WorkflowHistoryGrid. Shows every row that's actually happened, in order, including
 * remarks and who made each change - worth having now that most stage changes are auto-triggered
 * and carry a system-generated remark (e.g. "Auto-advanced: part suggested.") the stepper alone
 * doesn't surface. */
function WorkflowHistoryGrid({ jc }: { jc: JobCardDetail }) {
  const rows = [...jc.stageHistory].sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime())
  if (rows.length === 0) return null
  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
  return (
    <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: '#f1f3f6', paddingTop: 10 }}>
      <Text style={[styles.label, { marginBottom: 6 }]}>Stage History</Text>
      {rows.map((h) => (
        <View key={h.id} style={{ marginBottom: 8 }}>
          <Text style={{ fontWeight: '600', color: '#101828', fontSize: 13 }}>{h.stage?.label ?? '—'}</Text>
          <Text style={styles.muted}>
            {fmt(h.enteredAt)}{h.exitedAt ? ` – ${fmt(h.exitedAt)}` : ''}
            {' · '}{h.changedBy?.name ?? (h.notes?.startsWith('Auto-advanced') ? 'System' : '—')}
          </Text>
          {h.notes && <Text style={styles.muted}>{h.notes}</Text>}
        </View>
      ))}
    </View>
  )
}

type Run = (fn: () => Promise<unknown>, successMsg?: string) => void

export function JobCardDetailScreen({ route }: Props) {
  const { id } = route.params
  const { profile, hasRole } = useStaffAuth()
  const [jc, setJc] = useState<JobCardDetail | null>(null)
  const [stages, setStages] = useState<WorkflowStage[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // Estimates Amount "Done"/"Edit" toggle, mirroring web's JobCardDetailPage - lifted up here
  // (rather than local to EstimatesCard) because "Done" also hides PartSuggestionSection/
  // LabourSuggestionSection's add-new-suggestion forms, not just EstimatesCard's own UI.
  const [estimatesLocked, setEstimatesLocked] = useState(false)

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
    <View style={styles.screen}>
      {/* Toolbar strip below the native navy header (Hub Pulse reskin) - kept light, matching
          JobCardsList's toolbar, so it doesn't double up with the navigator's own navy header. */}
      <View style={styles.header}>
        <Text style={styles.title}>{jc.jobCardNumber}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Badge status={jc.status} />
          <PrintMenu jc={jc} hasRole={hasRole} />
        </View>
      </View>
      <ScrollView style={styles.container}>
      {msg && <Text style={styles.muted}>{msg}</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Customer & Vehicle</Text>
        <Text style={styles.bold}>{jc.customer?.name}</Text>
        <Text>{jc.customer?.mobile}</Text>
        <Text style={{ marginTop: 6 }}>{jc.vehicle?.model} {jc.vehicle?.variant}</Text>
        <Text style={styles.muted}>Reg: {jc.vehicle?.regNo} | Odometer: {jc.odometerAtCheckIn} km</Text>
        {/* <Text style={styles.muted}>Tracking link: /track/{jc.trackingToken}</Text> */}
        {jc.customer && hasRole('WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && (
          <CustomerPasswordResetButton customerId={jc.customer.id} customerName={jc.customer.name} />
        )}
        {baplLine.length > 0 && (
          <Text style={[styles.muted, { marginTop: 8 }]}>
            <Text style={styles.dmsBadge}> DMS </Text> {baplLine}
          </Text>
        )}
        {jc.baplSyncStatus === 'Synced' && jc.baplJobCardHeaderId && (
          <Text style={[styles.muted, { marginTop: 4 }]}>
            ✅ Synced to DMS as {jc.baplJobNo != null ? `job card #${jc.baplJobNo}` : 'a job card (DMS sync pending)'}.
          </Text>
        )}
        {jc.baplSyncStatus === 'Failed' && (
          <Text style={[styles.errorText, { marginTop: 4 }]}>⚠ Not yet synced to DMS{jc.baplSyncError ? `: ${jc.baplSyncError}` : '.'}</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Workflow Timeline</Text>
        <WorkflowTimelineView
          stages={buildTimelineStages(stages)}
          currentStageId={resolveTimelineCurrentStageId(stages, jc.currentStage)}
          history={buildTimelineHistory(jc)}
        />
        <WorkflowHistoryGrid jc={jc} />
      </View>

      {hasRole('ServiceAdvisor', 'WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && (
        <UpdateWorkflowStageCard jc={jc} stages={stages} busy={busy} run={run} canAssignTechnician={hasRole('WorkshopManager', 'Supervisor', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin')} />
      )}

      <ComplaintsCard jc={jc} run={run} />
      <PhotosCard jc={jc} run={run} />
      <WorklogCard jc={jc} run={run} profileId={profile?.id} />

      {/* 2026-10-01: the ₹2000 Grand Total auto-lock that used to gate these two sections has been
         removed per explicit request (same as web) - totalLockReached is now hardcoded false, not
         computed from a threshold any more. See this file's top-of-file doc comment (where
         ESTIMATE_TOTAL_LOCK_THRESHOLD used to be defined) for what's still needed from you to fully
         clean the now-dead ₹2000 message text out of these two section components themselves. Also
         now closes on jc.status === 'Closed' (estimatesLocked alone resets to false on a fresh
         screen load and never knew about job-card closure before), matching the same fix applied
         to EstimatesCard's Done/Edit toggle below. */}
      <PartSuggestionSection jc={jc} onChanged={load} estimatesLocked={estimatesLocked || jc.status === 'Closed'} totalLockReached={false} />
      <LabourSuggestionSection jc={jc} onChanged={load} estimatesLocked={estimatesLocked || jc.status === 'Closed'} totalLockReached={false} />
      <EstimatesCard jc={jc} estimatesLocked={estimatesLocked} setEstimatesLocked={setEstimatesLocked} />
      {/* 2026-09-28 CHANGE ("remove DMS Service History" from both web and android): the DMS
         Service History card (DMS's own service/job-card history for this vehicle's chassis, GET
         /api/bapl-dms/service-history) is no longer rendered here - consistent with the same
         session's broader "dont fetch jobcards and dont save jobcards from/to dms" instruction (see
         backend JobCardsController's matching removals). BaplServiceHistoryCard is left defined
         below (not deleted), same "kept, not deleted" convention InvoiceCard/ClosureCard already
         use just below, in case this needs to come back. */}
      {/* 2026-09-24 CHANGE ("Invoice ... OTP Based Closure ... remove that 2 card in details page"):
         the standalone Invoice card and OTP-Based Closure card are both hidden here - Invoice is
         already reachable via the header's Print ▾ menu (see PrintMenu's own "Invoice" option
         above, same role gate), and OTP-Based Closure isn't part of this round's kept workflow.
         InvoiceCard/ClosureCard are left defined below, just unused, same "kept, not deleted"
         convention as BaplServiceHistoryCard above. */}
      </ScrollView>
    </View>
  )
}

/** "Set/reset customer portal password" (WorkshopManager+) - mirrors web's
 * CustomerPasswordResetButton exactly: POST /api/customers/{id}/admin-reset-password SETS the
 * password to whatever's typed here (never reveals/checks the existing one), runs alongside the
 * customer's existing OTP-based portal login rather than replacing it. */
function CustomerPasswordResetButton({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [open, setOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      await apiClient.post(`/api/customers/${customerId}/admin-reset-password`, { newPassword })
      setMsg(`Password set for ${customerName}. Share it with them directly.`)
      setNewPassword('')
    } catch (err: unknown) {
      setMsg((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not set the password.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <TouchableOpacity style={[styles.smallBtn, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setOpen(true)}>
        <Text style={styles.smallBtnText}>Set/reset customer portal password</Text>
      </TouchableOpacity>
    )
  }

  return (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.label}>New password for {customerName}</Text>
      <View style={styles.searchRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="At least 8 characters"
          secureTextEntry
        />
        <TouchableOpacity style={[styles.smallBtn, (newPassword.length < 8 || saving) && styles.btnDisabled]} disabled={newPassword.length < 8 || saving} onPress={save}>
          <Text style={styles.smallBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => { setOpen(false); setMsg(null) }}>
          <Text style={styles.smallBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
      {msg && <Text style={[styles.muted, { marginTop: 6 }]}>{msg}</Text>}
    </View>
  )
}

/** "Download Invoice from DMS" (Cashier/DealerAdmin/CorporateAdmin/SystemAdmin) - mirrors web's
 * standalone InvoiceCard, restored below DMS Service History alongside the header's Print
 * menu (which also has its own Invoice option - see PrintMenu's doc comment on why both exist).
 * Fetches the same PDF PrintMenu's printInvoice does, then hands it to the OS share sheet
 * (Sharing.shareAsync) rather than the OS print dialog - "download/save this" instead of "print
 * this now", matching this card's own "Download" framing on web. */
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
      const fileName = `invoice-${jc.baplJobNo ?? jc.id}.pdf`
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf', dialogTitle: fileName })
      } else {
        setError('Sharing is not available on this device.')
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) setNotice('No repair bill saved in DMS for this job yet.')
      else setError('Could not download the invoice from DMS. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Invoice</Text>
      <TouchableOpacity style={[styles.btnPrimarySm, busy && styles.btnDisabled]} disabled={busy} onPress={download}>
        <Text style={styles.btnPrimaryText}>{busy ? 'Downloading…' : 'Download Invoice from DMS'}</Text>
      </TouchableOpacity>
      {notice && <Text style={[styles.muted, { marginTop: 8 }]}>{notice}</Text>}
      {error && <Text style={[styles.errorText, { marginTop: 8 }]}>{error}</Text>}
    </View>
  )
}

/** Read-only reference panel showing DMS's own service/job-card history for this vehicle's
 * chassis (GET /api/bapl-dms/service-history) - mirrors web's BaplServiceHistoryCard. Silently
 * shows nothing if the vehicle has no VIN/chassis on file, or DMS has never seen this
 * chassis; only a real DMS problem (502) surfaces as an error.
 *
 * 2026-09-28: no longer rendered from JobCardDetailScreen above (see that screen's "remove DMS
 * Service History" doc comment) - left defined here, unused, same "kept, not deleted" convention
 * as InvoiceCard/ClosureCard below. */
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
        if (err?.response?.status === 502) setError(err?.response?.data?.message ?? 'Could not reach DMS.')
        setRows([])
      })
  }, [chassisNo, dealerCode])

  if (!chassisNo) return null

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>DMS Service History</Text>
      {error && <Text style={styles.muted}>{error}</Text>}
      {rows === null && !error && <Text style={styles.muted}>Loading…</Text>}
      {rows !== null && rows.length === 0 && !error && <Text style={styles.muted}>No prior DMS job cards found for this chassis.</Text>}
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
  // Item 8: Stage field removed from this card entirely (still sent to the API as a fixed
  // default, since JobCardPhoto.Stage is a required column - it's just no longer something the
  // user picks or sees here). Caption moved from "pre-upload only" to editable per-photo below.
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [locationNote, setLocationNote] = useState<string | null>(null)
  const [captionEdits, setCaptionEdits] = useState<Record<string, string>>({})
  const [savingCaptionId, setSavingCaptionId] = useState<string | null>(null)

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
      form.append('Stage', 'CheckIn')
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

  const saveCaption = async (photoId: string) => {
    const value = captionEdits[photoId] ?? ''
    setSavingCaptionId(photoId)
    try {
      await run(() => apiClient.put(`/api/jobcards/photos/${photoId}`, { caption: value || null }))
    } finally {
      setSavingCaptionId(null)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Photos</Text>
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
            <View key={p.id} style={{ width: 160 }}>
              <TouchableOpacity onPress={() => Linking.openURL(photoSrc(p.url))}>
                <Image source={{ uri: photoSrc(p.url) }} style={{ width: '100%', height: 110, borderRadius: 6, borderWidth: 1, borderColor: '#ddd' }} />
              </TouchableOpacity>
              {/* Item 8: Caption now lives here, editable per photo, instead of only being set
                 once before upload. */}
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 6 }}>
                <TextInput
                  style={[styles.input, { flex: 1, fontSize: 12, paddingVertical: 4 }]}
                  value={captionEdits[p.id] ?? p.caption ?? ''}
                  editable={savingCaptionId !== p.id}
                  onChangeText={(v) => setCaptionEdits((prev) => ({ ...prev, [p.id]: v }))}
                  placeholder="Add a caption…"
                />
                <TouchableOpacity
                  style={[styles.smallBtn, (savingCaptionId === p.id || (captionEdits[p.id] ?? p.caption ?? '') === (p.caption ?? '')) && styles.btnDisabled]}
                  disabled={savingCaptionId === p.id || (captionEdits[p.id] ?? p.caption ?? '') === (p.caption ?? '')}
                  onPress={() => saveCaption(p.id)}
                >
                  <Text style={styles.smallBtnText}>{savingCaptionId === p.id ? '…' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
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

/** Interactive counterpart to the read-only WorkflowTimelineView above - mirrors web's
 * UpdateWorkflowStageCard. No manual stage picker any more (per explicit request: "dont want
 * manual whole... stage automatically update") - the job card's stage now advances itself as real
 * work happens (see backend WorkflowStageAutomation): adding a part/labour suggestion, drafting an
 * estimate, or starting a technician worklog each auto-advance to the matching stage the first
 * time they happen. Only "Repair Completed" and "Ready for Delivery" have no such unambiguous
 * trigger elsewhere in the app, so those stay one explicit button each below. Assign Technician and
 * Remarks stay manual fields. */
function UpdateWorkflowStageCard({
  jc, stages, busy, run, canAssignTechnician,
}: {
  jc: JobCardDetail
  stages: WorkflowStage[]
  busy: boolean
  run: Run
  canAssignTechnician: boolean
}) {
  // 2026-09-24 CHANGE ("that bind in jobcard ... Assign Technician name update"): was a free-text
  // name (no confirmed technician catalog existed); now a dropdown bound to the new login-less
  // Technician Employee roster (see backend Models/Technicians.cs), scoped to this job card's own
  // Service Location - same GET /api/technicians?locationCode=... the Job Card Wizard's own
  // Technician field uses. Still sent as the plain assignedTechnicianName string on PUT
  // /api/jobcards/{id} (unchanged field/shape on the backend) - the dropdown only changes how the
  // value is picked, not what's stored. Mirrors web/src/pages/staff/JobCardDetailPage.tsx's
  // UpdateWorkflowStageCard exactly.
  const [technicianName, setTechnicianName] = useState(jc.assignedTechnicianName ?? '')
  // 2026-09-05: was missing entirely - web's UpdateWorkflowStageCard saves Assign Technician AND
  // Expected Completion together in one PUT (saveDetails), but this screen only ever sent
  // assignedTechnicianName, so Expected Completion could never be changed from the job card once
  // it was first set at creation. Mirrors the wizard screen's own date/time picker pattern below.
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState<Date | null>(jc.expectedDeliveryAt ? new Date(jc.expectedDeliveryAt) : null)
  const [notes, setNotes] = useState('')
  const [technicianOptions, setTechnicianOptions] = useState<Technician[]>([])

  useEffect(() => {
    setTechnicianName(jc.assignedTechnicianName ?? '')
    setExpectedDeliveryAt(jc.expectedDeliveryAt ? new Date(jc.expectedDeliveryAt) : null)
  }, [jc.id, jc.assignedTechnicianName, jc.expectedDeliveryAt])

  useEffect(() => {
    // No dealerId param for a regular dealer-scoped login (TechniciansController.List already
    // scopes to _currentUser.DealerId) - only relevant for a Corporate/System Admin viewing a job
    // card outside their own dealer, hence jc.dealer?.id here. Mirrors web's same effect.
    apiClient.get<Technician[]>('/api/technicians', { params: { dealerId: jc.dealer?.id, locationCode: jc.baplServiceLocationCode || undefined } })
      .then(({ data }) => setTechnicianOptions(data))
      .catch(() => setTechnicianOptions([]))
  }, [jc.dealer?.id, jc.baplServiceLocationCode])

  const technicianPickOptions: PickerOption[] = [
    ...technicianOptions.map((t) => ({ label: t.name, value: t.name })),
    // A pre-existing name (saved as free text before this dropdown existed, or a Technician later
    // deactivated/removed) that no longer matches any option - keep it selectable so opening this
    // picker never silently blanks/overwrites it on Save.
    ...(technicianName && !technicianOptions.some((t) => t.name === technicianName)
      ? [{ label: `${technicianName} (not in this location's list)`, value: technicianName }]
      : []),
  ]

  const saveDetails = () => apiClient.put(`/api/jobcards/${jc.id}`, {
    assignedTechnicianName: technicianName || null,
    expectedDeliveryAt: expectedDeliveryAt ? expectedDeliveryAt.toISOString() : null,
  })

  const openExpectedDeliveryPicker = () => {
    DateTimePickerAndroid.open({
      value: expectedDeliveryAt ?? new Date(),
      mode: 'date',
      onChange: (_e: DateTimePickerEvent, date?: Date) => {
        if (!date) return
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          is24Hour: true,
          onChange: (_e2: DateTimePickerEvent, time?: Date) => {
            if (!time) return
            const combined = new Date(date)
            combined.setHours(time.getHours(), time.getMinutes())
            setExpectedDeliveryAt(combined)
          },
        })
      },
    })
  }

  const currentSeq = jc.currentStage?.seq ?? -1
  const repairCompletedStage = stages.find((s) => s.stageKey === 'repair_completed')
  const readyForDeliveryStage = stages.find((s) => s.stageKey === 'ready_for_delivery')
  // 2026-09-28 (SECTION 145, then REVERTED same day - SECTION 147): a "Generate Invoice & Close Job
  // Card" button briefly lived here, mirroring web's own same (now-reverted) fix. WITHDRAWN per
  // your correction: "we cant close jobcards without repair ... save as proforma then save as
  // invoice then this jobcard close" - closing is tied to your existing Repair Bill flow (Proforma
  // -> Invoice save) elsewhere in the app, not a button on this screen. See README SECTION 147.
  //
  // 2026-09-29 (SECTION 156, web only until now) / 2026-10-01 (added here to match web): web's
  // UpdateWorkflowStageCard later reinstated a manual "Mark Invoice Generated" button, ADDITIVE to
  // (not replacing) the automatic trigger RepairBillDocsController.UpdateStatus already has (a
  // linked Repair Bill saved as Invoice still auto-advances + auto-closes on its own, unchanged) -
  // see that file's SECTION 156 doc comment for the full flag on this (clicking it closes the job
  // card immediately, with or without a Repair Bill on file). This screen never got that same
  // button added - adding it now, in the same explicitly-requested order ("after Repair Completed
  // shift Invoice Generated, after this Ready for Delivery") as web's 2026-10-01 reorder.
  const invoiceGeneratedStage = stages.find((s) => s.stageKey === 'invoice_generated')
  const markStage = (stage?: WorkflowStage) => {
    if (!stage) return Promise.resolve()
    return apiClient.post(`/api/jobcards/${jc.id}/stage`, { stageId: stage.id, notes: notes || null })
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Update Workflow Stage</Text>
      {/* <Text style={styles.muted}>
        The stage above now advances automatically as work happens. Use the two buttons below only
        for the steps with no automatic trigger.
      </Text> */}
      {/* 2026-09-24 CHANGE ("before start required Assign Technician name update"): every stage
         change - the two manual buttons below AND every automatic trigger elsewhere on this screen
         (worklog start, part/labour suggestion) - is now refused with a 400 until a Technician is
         assigned here first (see backend JobCardsController.RequireAssignedTechnician). The
         refusal's own message already surfaces through this screen's msg banner (see run()'s catch
         block above), but this note says so up front instead of only after a first failed attempt.
         Mirrors web's same banner exactly. */}
      {!jc.assignedTechnicianName && (
        <Text style={[styles.errorText, { marginTop: -2, marginBottom: 6 }]}>
          ⚠ No Technician assigned yet - every stage update (including the automatic ones above)
          will be refused until one is set below.
        </Text>
      )}
      {canAssignTechnician && (
        <View style={{ marginTop: 10, marginBottom: 10 }}>
          <PickerField
            label="Assign Technician"
            value={technicianName}
            options={technicianPickOptions}
            placeholder={technicianOptions.length ? 'Select technician…' : 'No Technician set up for this location yet'}
            onChange={setTechnicianName}
            disabled={busy}
          />
          <Text style={[styles.label, { marginTop: 8 }]}>Expected Completion</Text>
          <TouchableOpacity style={styles.field} disabled={busy} onPress={openExpectedDeliveryPicker}>
            <Text style={styles.fieldText}>{expectedDeliveryAt ? expectedDeliveryAt.toLocaleString() : 'Not set'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.smallBtn, { alignSelf: 'flex-start' }, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={() => run(saveDetails, 'Technician & completion date updated.')}
          >
            <Text style={styles.smallBtnText}>Save</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={{ marginBottom: 10 }}>
        <Text style={styles.label}>Remarks (attached to the buttons below)</Text>
        <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholder="Stage remarks…" />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {/* 2026-09-28 (SECTION 153, "when repaill bill generate invoice then Repair Completed but
           dont shown in ui"): was `repairCompletedStage && (...)` - shown always, just greyed out
           (disabled) once currentSeq passed this stage's seq (which happens both from a manual tap
           here AND from RepairBillDocsController.UpdateStatus's own auto-advance to
           invoice_generated when a Repair Bill is saved as Invoice - invoice_generated's seq is
           past repair_completed's, per the 8-step WorkflowStages list). Now the button is HIDDEN
           entirely once past this stage, not just disabled - covers both cases with the same
           `currentSeq < repairCompletedStage.seq` guard, since a disabled-but-visible button served
           no purpose either way. "Ready for Delivery" below is deliberately UNCHANGED - your
           request was only to hide Repair Completed; Ready for Delivery stays a manual step you
           still do yourself after the invoice flow, per your own words ("then manual done ...
           Mark Ready for Delivery"). */}
        {repairCompletedStage && currentSeq < repairCompletedStage.seq && (
          <TouchableOpacity
            style={[styles.btnPrimarySm, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={() => run(() => markStage(repairCompletedStage), 'Marked Repair Completed.')}
          >
            <Text style={styles.btnPrimaryText}>Mark Repair Completed</Text>
          </TouchableOpacity>
        )}
        {/* 2026-10-01 ("in Workflow Timeline after Repair Completed shift Invoice Generated after
           this Ready for Delivery"): new button, added here to match web's same-named button and
           the same requested order - see this component's own doc comment above (just before
           markStage) for the full history/flag. Same disabled-once-past pattern as the other two
           buttons. NOTE - FLAGGED, not yet done: the read-only WorkflowTimelineView stepper above
           is a separate component from this button row and still orders stages by their backend
           Seq (not available in this session) - see web's matching 2026-10-01 note for what's
           needed to also reorder that stepper. */}
        {invoiceGeneratedStage && (
          <TouchableOpacity
            style={[styles.btnPrimarySm, (busy || currentSeq >= invoiceGeneratedStage.seq) && styles.btnDisabled]}
            disabled={busy || currentSeq >= invoiceGeneratedStage.seq}
            onPress={() => run(() => markStage(invoiceGeneratedStage), 'Marked Invoice Generated. Job card closed.')}
          >
            <Text style={styles.btnPrimaryText}>Mark Invoice Generated</Text>
          </TouchableOpacity>
        )}
        {readyForDeliveryStage && (
          <TouchableOpacity
            style={[styles.btnPrimarySm, (busy || currentSeq >= readyForDeliveryStage.seq) && styles.btnDisabled]}
            disabled={busy || currentSeq >= readyForDeliveryStage.seq}
            onPress={() => run(() => markStage(readyForDeliveryStage), 'Marked Ready for Delivery.')}
          >
            <Text style={styles.btnPrimaryText}>Mark Ready for Delivery</Text>
          </TouchableOpacity>
        )}
      </View>
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
        {/* 2026-09-03: blue now, matching web's "Log Inspection Note" button. */}
        <TouchableOpacity
          style={styles.btnPrimarySm}
          onPress={() => { run(() => apiClient.post(`/api/jobcards/${jc.id}/inspections`, { component: 'General', condition: 'NeedsAttention', notes: text })); setText('') }}
        >
          <Text style={styles.btnPrimaryText}>Log Note</Text>
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

// 2026-09-07: timer is manual again per explicit request, mirroring web's WorklogCard exactly -
// see that file's doc comment for the full reasoning (starting the timer is what causes Work In
// Progress via StartWorklog's own side effect; the closed-job-card auto-stop effect below stays as
// a safety net only). All timestamps shown explicitly in IST (Asia/Kolkata), not device locale.
const IST_TIME_ZONE = 'Asia/Kolkata'
const formatIST = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-IN', { timeZone: IST_TIME_ZONE, ...opts })
const formatISTTime = (iso: string) => formatIST(iso, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
const formatISTDateTime = (iso: string) => formatIST(iso, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })

/** "now i start timer but still another time show current time 11.51 not shown in timer" -
 * formats a millisecond duration as H:MM:SS (or M:SS under an hour) for WorklogCard's live
 * elapsed-time display below - mirrors web's formatElapsedMs exactly. */
function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// The same "open worklog?" check gates Part/Labour suggestion adding in PartSuggestionSection.tsx
// and LabourSuggestionSection.tsx (separate files - each inlines `jc.worklogs.some((w) =>
// !w.endedAt)` directly rather than importing a helper across files, matching this codebase's
// existing pattern of small per-file duplication over cross-file coupling for one-line checks).

function WorklogCard({ jc, run, profileId }: { jc: JobCardDetail; run: Run; profileId?: string }) {
  const openLog = jc.worklogs.find((w) => !w.endedAt)

  // "now i start timer but still another time show current time 11.51 not shown in timer" - the
  // "Timer running since ..." line below only ever rendered once, from whatever jc.worklogs looked
  // like the moment the screen last fetched it, so it silently froze at the start time forever and
  // never reflected that real time kept passing while the timer ran. This ticks nowMs once a
  // second (only while a worklog is actually open, so it's a no-op the rest of the time) purely so
  // the elapsed-time text below stays live instead of static - mirrors web's WorklogCard exactly.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!openLog) return
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [openLog?.id])

  // Safety net only - starting is manual now, but if a job card gets closed while a timer is
  // still running (closed from web, or the technician forgot to stop it), end it automatically.
  useEffect(() => {
    if (jc.status === 'Closed' && openLog) {
      run(() => apiClient.post(`/api/jobcards/worklogs/${openLog.id}/end`, {}))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jc.status, openLog?.id])

  const startTimer = () => run(() => apiClient.post(`/api/jobcards/${jc.id}/worklogs/start`, { technicianId: profileId, taskDescription: 'Service work' }))
  const stopTimer = () => { if (openLog) run(() => apiClient.post(`/api/jobcards/worklogs/${openLog.id}/end`, {})) }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Technician Work Log</Text>
      {openLog ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <Text style={styles.muted}>
            ⏱ Timer running since {formatISTTime(openLog.startedAt)} IST - running for{' '}
            {formatElapsedMs(nowMs - new Date(openLog.startedAt).getTime())}.
          </Text>
          <TouchableOpacity style={styles.dangerBtnSm} onPress={stopTimer}>
            <Text style={styles.dangerBtnText}>■ Stop Timer</Text>
          </TouchableOpacity>
        </View>
      ) : jc.status === 'Closed' ? (
        <Text style={styles.muted}>Timer stopped - this job card is closed.</Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <Text style={styles.muted}>Timer isn't running. Start it before adding Part/Labour suggestions.</Text>
          <TouchableOpacity style={styles.btnPrimarySm} onPress={startTimer}>
            <Text style={styles.btnPrimaryText}>▶ Start Timer</Text>
          </TouchableOpacity>
        </View>
      )}
      {jc.worklogs.map((w) => (
        <View key={w.id} style={styles.historyRow}>
          <Text style={styles.rowTitle}>{formatISTDateTime(w.startedAt)} IST</Text>
          <Text style={styles.muted}>{w.endedAt ? `Ended ${formatISTDateTime(w.endedAt)} IST` : 'Still running'} · {w.durationMinutes ?? '-'} min</Text>
        </View>
      ))}
    </View>
  )
}

/** Part Details + Labour Details + Grand Total - mirrors web's EstimatesCard exactly, including
 * the full column set (Sr no./Item or Labour Code/Description/HSN/MRP or Rate/Qty/Amount), not
 * just a collapsed "code - description" line. RN has no <table>, so each row is a two-line card
 * instead of a grid: the code/description/HSN on one line, Qty x MRP(or Rate) = Amount on the
 * next - same fields as web, just stacked to fit a phone width.
 *
 * 2026-09-07: added the same "Done"/"Edit" toggle as web - see JobCardDetailPage.tsx's EstimatesCard
 * doc comment for the full feature. "Done" (blue button) locks the estimate - PartSuggestionSection/
 * LabourSuggestionSection's add-new-suggestion forms hide (their already-added lists stay visible)
 * and an email input + Send button appear right here to mail the estimate as a PDF attachment
 * (POST /api/jobcards/{id}/estimates/email). "Edit" flips back. Plain client-side UI state, not
 * persisted - resets to unlocked on a fresh screen load, same as web.
 *
 * 2026-10-01 ("after close Jobcard this done button remove" - same request applied here as on
 * web): once jc.status === 'Closed', the Done/Edit toggle row below is no longer rendered at all -
 * a closed job card's estimate has nothing left to lock/unlock, so just the Grand Total shows.
 *
 * 2026-10-01 follow-up ("this jobcard closed still shown done button and Edit and send mail
 * fuctionality hide this after close" - same request applied here as on web): the email-estimate
 * box (address field + Send Estimate button) is now ALSO hidden once closed, replacing the earlier
 * unconfirmed Assumption that it should stay offered after closure. Now shown only while
 * `estimatesLocked && !closed`.
 *
 * NOTE on "closed": jc.status only becomes 'Closed' when a workflow stage flagged IsTerminal is
 * reached (backend JobCardsController.ChangeStage). Today only "Invoice Generated" carries
 * IsTerminal=true - so if a job card looks finished but this card's Edit/Done + email box are
 * still showing, check that job card's actual status badge first; its Status field may not have
 * reached 'Closed' yet. */
function EstimatesCard({
  jc, estimatesLocked, setEstimatesLocked,
}: {
  jc: JobCardDetail
  estimatesLocked: boolean
  setEstimatesLocked: (v: boolean) => void
}) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [emailMsg, setEmailMsg] = useState<string | null>(null)

  const sendEmail = async () => {
    if (!email.trim()) { setEmailMsg('Enter an email address first.'); return }
    setSending(true)
    setEmailMsg(null)
    try {
      const { data } = await apiClient.post<{ message: string }>(`/api/jobcards/${jc.id}/estimates/email`, { email: email.trim() })
      setEmailMsg(data.message)
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string } } })?.response?.data
      setEmailMsg(data?.message ?? 'Could not send the email.')
    } finally {
      setSending(false)
    }
  }

  const money = (n: number) => `₹${n.toFixed(2)}`
  const partRows = jc.partSuggestions.map((p, i) => {
    const mrp = p.mrp ?? 0
    const qty = p.quantity ?? 1
    return { sr: i + 1, code: p.itemCode, description: p.description ?? '-', hsn: p.hsnCode ?? '-', rate: mrp, qty, amount: mrp * qty }
  })
  const labourRows = jc.labourSuggestions.map((l, i) => {
    const rate = l.rateAtSuggestion ?? 0
    const qty = l.quantity ?? 1
    return { sr: i + 1, code: l.labourCode, description: l.labourDescription ?? '-', hsn: l.hsnCode ?? '-', rate, qty, amount: rate * qty }
  })
  const partsTotal = partRows.reduce((sum, r) => sum + r.amount, 0)
  const labourTotal = labourRows.reduce((sum, r) => sum + r.amount, 0)
  const grandTotal = partsTotal + labourTotal
  // 2026-10-01: a closed job card has nothing left to lock/unlock, so the Done/Edit toggle is
  // hidden entirely below - see this component's doc comment.
  const closed = jc.status === 'Closed'

  const Row = ({ r, rateLabel }: { r: { sr: number; code: string; description: string; hsn: string; rate: number; qty: number; amount: number }; rateLabel: string }) => (
    <View style={styles.estimateRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.bold}>{r.sr}. {r.code} - {r.description}</Text>
        <Text style={styles.muted}>HSN {r.hsn} · {r.qty} x {rateLabel} {money(r.rate)}</Text>
      </View>
      <Text style={styles.bold}>{money(r.amount)}</Text>
    </View>
  )

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Estimates Amount</Text>
      <Text style={styles.subheading}>Part Details</Text>
      {partRows.length === 0 && <Text style={styles.muted}>No parts suggested yet.</Text>}
      {partRows.map((r) => <Row key={r.sr} r={r} rateLabel="MRP" />)}
      {partRows.length > 0 && (
        <View style={styles.estimateTotalRow}><Text style={styles.bold}>Parts Total</Text><Text style={styles.bold}>{money(partsTotal)}</Text></View>
      )}

      <Text style={[styles.subheading, { marginTop: 14 }]}>Labour Details</Text>
      {labourRows.length === 0 && <Text style={styles.muted}>No labour suggested yet.</Text>}
      {labourRows.map((r) => <Row key={r.sr} r={r} rateLabel="Rate" />)}
      {labourRows.length > 0 && (
        <View style={styles.estimateTotalRow}><Text style={styles.bold}>Labour Total</Text><Text style={styles.bold}>{money(labourTotal)}</Text></View>
      )}

      <View style={styles.grandTotalRow}>
        <Text style={{ fontSize: 16, fontWeight: '700' }}>Grand Total</Text>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{money(grandTotal)}</Text>
      </View>
      {!closed && (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
          {estimatesLocked ? (
            <TouchableOpacity style={styles.btn} onPress={() => { setEstimatesLocked(false); setEmailMsg(null) }}>
              <Text style={styles.btnText}>Edit</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.btnPrimarySm} onPress={() => setEstimatesLocked(true)}>
              <Text style={styles.btnPrimaryText}>Done</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {estimatesLocked && !closed && (
        <View style={{ marginTop: 10, gap: 8 }}>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Customer email address…"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TouchableOpacity style={[styles.btnPrimarySm, sending && styles.btnDisabled]} disabled={sending} onPress={sendEmail}>
            <Text style={styles.btnPrimaryText}>{sending ? 'Sending…' : 'Send Estimate'}</Text>
          </TouchableOpacity>
          {emailMsg && <Text style={styles.muted}>{emailMsg}</Text>}
        </View>
      )}
    </View>
  )
}

/** buildRepairBillInvoicePrintHtml (2026-09-28, SECTION 150) - mirrors web's
 * JobCardDetailPage.tsx function of the same name exactly (plain data-driven HTML/CSS, no
 * browser-only APIs, so it works as-is inside expo-print's Print.printAsync({ html })). See that
 * file's copy for the full reasoning; duplicated here rather than added to the shared
 * utils/printJobCard.ts since I don't have that shared file's source in this session (see
 * PrintMenu's doc comment below). */
function buildRepairBillInvoicePrintHtml(bill: RepairBillDoc, dealerName?: string, dealerCode?: string): string {
  const rows = bill.items.map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${it.itemType}</td>
      <td>${it.itemCode}</td>
      <td>${it.itemDescription}</td>
      <td>${it.hsnCode ?? '-'}</td>
      <td class="right">${it.qty}</td>
      <td class="right">₹${Number(it.rate).toFixed(2)}</td>
      <td>${!it.discountType || it.discountType === 'None' ? '-' : `${it.discountValue}${it.discountType === 'Percentage' ? '%' : ''}`}</td>
      <td class="right">₹${Number(it.taxableAmount).toFixed(2)}</td>
      <td class="right">₹${Number(it.cgstAmount).toFixed(2)}</td>
      <td class="right">₹${Number(it.sgstAmount).toFixed(2)}</td>
      <td class="right">₹${Number(it.igstAmount).toFixed(2)}</td>
      <td class="right">₹${Number(it.totalAmount).toFixed(2)}</td>
    </tr>`).join('')
  const balance = Number(bill.totalAmount) - Number(bill.amountReceived)

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Invoice ${bill.billNumber}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .muted { color: #555; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 11px; }
  th, td { border: 1px solid #ccc; padding: 5px 6px; text-align: left; }
  th { background: #f3f4f6; }
  .right { text-align: right; }
  .header-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .totals { margin-top: 14px; width: 320px; margin-left: auto; font-size: 13px; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
  .totals .grand { font-weight: 700; border-top: 1px solid #333; margin-top: 4px; padding-top: 6px; }
</style></head>
<body>
  <div class="header-row">
    <div>
      <h1>${dealerName ?? 'Repair Bill Invoice'}</h1>
      <div class="muted">${dealerCode ?? ''}</div>
    </div>
    <div class="muted" style="text-align:right">
      Bill No: <strong>${bill.billNumber}</strong><br/>
      Date: ${bill.billDate ? new Date(bill.billDate).toLocaleDateString('en-IN') : '-'}<br/>
      Status: ${bill.status}
    </div>
  </div>
  <div class="muted">
    Party: <strong>${bill.partyName}</strong> &nbsp; Reg No: ${bill.regNo ?? '-'} &nbsp; Chassis No: ${bill.chassisNo ?? '-'} &nbsp; Location: ${bill.location ?? '-'}
    ${bill.jobCardNumber ? `<br/>Job No: ${bill.jobCardNumber}` : ''}
  </div>
  <table>
    <thead><tr><th>Sr</th><th>Type</th><th>Code</th><th>Description</th><th>HSN</th><th class="right">Qty</th><th class="right">Rate</th><th>Discount</th><th class="right">Taxable</th><th class="right">CGST</th><th class="right">SGST</th><th class="right">IGST</th><th class="right">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div><span>Taxable Amount</span><span>₹${Number(bill.taxableAmount).toFixed(2)}</span></div>
    <div><span>CGST</span><span>₹${Number(bill.cgstAmount).toFixed(2)}</span></div>
    <div><span>SGST</span><span>₹${Number(bill.sgstAmount).toFixed(2)}</span></div>
    <div><span>IGST</span><span>₹${Number(bill.igstAmount).toFixed(2)}</span></div>
    <div class="grand"><span>Total Amount</span><span>₹${Number(bill.totalAmount).toFixed(2)}</span></div>
    <div><span>Amount Received</span><span>₹${Number(bill.amountReceived).toFixed(2)}</span></div>
    <div><span>Balance</span><span>₹${balance.toFixed(2)}</span></div>
  </div>
  ${bill.remarks ? `<div class="muted" style="margin-top:14px">Remarks: ${bill.remarks}</div>` : ''}
</body></html>`
}

/** "Print ▾" menu (2026-09-04) - mirrors web/src/pages/staff/JobCardDetailPage.tsx's PrintMenu,
 * next to the status badge: 3 options -
 *   1. Estimate    - customer/dealer/vehicle identity + the Estimates Amount tables only (Part
 *                    Details, Labour Details, Grand Total) - see buildEstimatePrintHtml.
 *   2. JobCard print - the same DMS "Job Card + Gate Pass" paper layout the wizard's own
 *                    pre-creation Print button uses, filled from this job card's real saved data.
 *   3. Invoice     - CHANGED 2026-09-28 (SECTION 150, "in print click download invoioce download
 *                    then it will not download why?"). FACT: this used to fetch
 *                    GET /api/jobcards/{id}/invoice-pdf, which renders DMS's own repair bill
 *                    (RepairBillHeader/RepairBillDetail, read live from DMS) - but this app now
 *                    saves Repair Bills natively into its OWN RepairBillDocs table
 *                    (RepairBillDocsController, RepairBillCreateScreen.tsx), which this app never
 *                    writes back into DMS. So that endpoint 404'd for every job billed through the
 *                    new flow, and nothing ever downloaded. Per your confirmed answers (native
 *                    source, print-preview format), this now fetches
 *                    GET /api/repair-bill-docs?jobCardId={id}, finds the row with
 *                    status === 'Billed' (i.e. saved as Invoice, not just Proforma), and renders it
 *                    via the new buildRepairBillInvoicePrintHtml above - no DMS call, no PDF file
 *                    write, straight into Print.printAsync({ html }) exactly like Estimate/JobCard
 *                    print already do. If no Billed repair bill exists yet for this job card, a
 *                    clear message is shown instead of a silent/broken download.
 * A phone has no browser print popup, so each option calls Print.printAsync (`html` straight in
 * for all three now) which opens the OS's own native print dialog (its own "Save as PDF"/pick-a-
 * printer options cover what web's window.print() and Ctrl+P give a desktop user).
 *
 * Deliberately built as a tap-to-open Modal (like PickerField), NOT a focus/blur-driven dropdown -
 * only an explicit press on the "Print ▾" button ever opens it, and only an explicit press on an
 * item or the backdrop ever closes it. A web-style hover/focus-driven menu doesn't have a clean
 * touch equivalent and risks a menu popping open on its own from an unrelated focus event (see the
 * chassis-suggestions dropdown fix in JobCardWizardScreen.tsx for the same class of bug on
 * Android) - this sidesteps that entirely.
 */
function PrintMenu({ jc, hasRole }: { jc: JobCardDetail; hasRole: (...roles: StaffRole[]) => boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'estimate' | 'jobcard' | 'invoice' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const printEstimate = async () => {
    setOpen(false)
    setBusy('estimate')
    setError(null)
    try {
      const partRows = jc.partSuggestions.map((p, i) => {
        const mrp = p.mrp ?? 0
        const qty = p.quantity ?? 1
        return { sr: i + 1, code: p.itemCode, description: p.description ?? '-', hsn: p.hsnCode ?? '-', mrp, qty, amount: mrp * qty }
      })
      const labourRows = jc.labourSuggestions.map((l, i) => {
        const rate = l.rateAtSuggestion ?? 0
        const qty = l.quantity ?? 1
        return { sr: i + 1, code: l.labourCode, description: l.labourDescription ?? '-', hsn: l.hsnCode ?? '-', rate, qty, amount: rate * qty }
      })
      const partsTotal = partRows.reduce((sum, r) => sum + r.amount, 0)
      const labourTotal = labourRows.reduce((sum, r) => sum + r.amount, 0)
      const html = buildEstimatePrintHtml({
        dealerName: jc.dealer?.name,
        dealerCode: jc.dealer?.code,
        jobCardNumber: jc.jobCardNumber,
        printDate: jc.createdAt ? new Date(jc.createdAt).toLocaleDateString('en-GB') : '-',
        customerName: jc.customer?.name,
        customerMobile: jc.customer?.mobile,
        address: jc.customer?.address,
        city: jc.customer?.city,
        vehicleModel: jc.vehicle?.model,
        vehicleVariant: jc.vehicle?.variant,
        registerNo: jc.vehicle?.regNo,
        chassisNo: jc.vehicle?.vin,
        odometer: jc.odometerAtCheckIn,
        partRows,
        labourRows,
        partsTotal,
        labourTotal,
        grandTotal: partsTotal + labourTotal,
      })
      await Print.printAsync({ html })
    } catch {
      setError('Could not print the estimate. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const printJobCard = async () => {
    setOpen(false)
    setBusy('jobcard')
    setError(null)
    try {
      const html = buildJobCardPrintHtml({
        dealerName: jc.dealer?.name,
        dealerCode: jc.dealer?.code,
        jobinDate: jc.createdAt ?? new Date().toISOString(),
        jobtype: jc.baplJobType,
        jobsource: jc.baplJobSourceName,
        serviceHead: jc.baplServiceHeadName,
        serviceType: jc.baplServiceTypeName,
        estdelDate: jc.expectedDeliveryAt,
        vehiclekms: jc.odometerAtCheckIn,
        manualjobNo: jc.baplManualJobNo,
        supervisor: jc.baplSupervisorName,
        technician: jc.baplTechnicianName,
        customerName: jc.customer?.name,
        customerMobile: jc.customer?.mobile,
        address: jc.customer?.address,
        city: jc.customer?.city,
        chassisNo: jc.vehicle?.vin,
        batteryNo: jc.vehicle?.batteryNo,
        chargerNo: jc.vehicle?.chargerNo,
        controllerNo: jc.vehicle?.controllerNo,
        registerNo: jc.vehicle?.regNo,
        modelName: jc.vehicle?.model,
        colour: jc.vehicle?.color,
        insuranceExpiry: jc.vehicle?.insuranceExpiry,
        complaints: jc.complaints.map((c) => c.description),
        jobCardNumber: jc.baplJobNo != null ? String(jc.baplJobNo) : jc.jobCardNumber,
      })
      await Print.printAsync({ html })
    } catch {
      setError('Could not print the job card. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const printInvoice = async () => {
    setOpen(false)
    setBusy('invoice')
    setError(null)
    try {
      const { data } = await apiClient.get<RepairBillDoc[]>('/api/repair-bill-docs', { params: { jobCardId: jc.id } })
      const billed = data.find((b) => b.status === 'Billed')
      if (!billed) {
        setError('No Repair Bill has been saved as Invoice for this job card yet.')
        return
      }
      const html = buildRepairBillInvoicePrintHtml(billed, jc.dealer?.name, jc.dealer?.code)
      await Print.printAsync({ html })
    } catch {
      setError('Could not load the invoice for this job card. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <View>
      <TouchableOpacity style={[styles.printToggleBtn, !!busy && styles.btnDisabled]} disabled={!!busy} onPress={() => setOpen(true)}>
        <Text style={styles.printToggleBtnText}>🖨️ {busy ? 'Opening…' : 'Print'} ▾</Text>
      </TouchableOpacity>
      {error && <Text style={[styles.errorText, { textAlign: 'right' }]}>{error}</Text>}
      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.printBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.printSheet} onPress={(e) => e.stopPropagation()}>
            <TouchableOpacity style={styles.printMenuItem} onPress={printEstimate}>
              <Text style={styles.printMenuItemText}>Estimate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.printMenuItem} onPress={printJobCard}>
              <Text style={styles.printMenuItemText}>JobCard print</Text>
            </TouchableOpacity>
            {hasRole('Cashier', 'DealerAdmin', 'CorporateAdmin', 'SystemAdmin') && (
              <TouchableOpacity style={[styles.printMenuItem, { borderBottomWidth: 0 }]} onPress={printInvoice}>
                <Text style={styles.printMenuItemText}>Invoice</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>
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
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: 12 },
  loadingContainer: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  // Light toolbar strip (Hub Pulse reskin) - was previously an inline row scrolling with the page
  // content; now a fixed band below the native navy header, matching JobCardsList's toolbar.
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, paddingTop: 12, paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  card: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e6ec', padding: 14, marginBottom: 10 },
  cardTitle: { fontWeight: '700', marginBottom: 8, color: '#101828' },
  subheading: { fontWeight: '600', marginBottom: 6, color: '#101828' },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  errorText: { fontSize: 12, color: '#dc2626', marginTop: 4 },
  bold: { fontWeight: '700', color: '#101828' },
  link: { color: '#2563eb', fontSize: 11, marginTop: 2 },
  label: { fontSize: 12, color: '#6b7280', marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 8 },
  // Tap-to-open date/time field (Expected Completion) - matches PickerField's own "field" look.
  field: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10, minHeight: 42, justifyContent: 'center' },
  fieldText: { color: '#101828', fontSize: 14 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  btn: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#fff' },
  btnText: { color: '#374151', fontWeight: '600' },
  btnPrimarySm: { backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', alignSelf: 'flex-start' },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  // Stop Timer (WorklogCard) / Edit (EstimatesCard, matching web's red Stop / plain Edit look).
  dangerBtnSm: { backgroundColor: '#dc2626', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center' },
  dangerBtnText: { color: '#fff', fontWeight: '700' },
  smallBtn: { backgroundColor: '#f4f6f9', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 6, paddingHorizontal: 8, justifyContent: 'center' },
  smallBtnText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  // Amber "done/confirmed" chip treatment (Hub Pulse reskin) - this data is confirmed
  // synced-from-DMS, same semantic as the list screen's DMS badge.
  dmsBadge: { backgroundColor: colors.amber, color: '#fff', fontSize: 11, fontWeight: '700', borderRadius: 999, overflow: 'hidden' },
  historyRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f1f3f6' },
  rowTitle: { fontWeight: '600', color: '#101828' },
  estimateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  estimateTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, marginTop: 2 },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 10, borderTopWidth: 2, borderTopColor: '#e2e6ec' },
  // PrintMenu (2026-09-04) - the header's "Print ▾" toggle plus its tap-to-open action sheet.
  printToggleBtn: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff' },
  printToggleBtnText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  printBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  printSheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 6, paddingBottom: 24 },
  printMenuItem: { paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  printMenuItemText: { fontSize: 15, color: '#101828', fontWeight: '600' },
})