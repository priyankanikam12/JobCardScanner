// mobile\src\screens\CareDeskScreen.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { Badge } from '../components/Badge'
import { PickerField } from '../components/PickerField'
import { VehiclePicker, type PickedVehicle } from '../components/VehiclePicker'
import { CARE_DESK_URL, openCareDesk } from '../lib/careDesk'
import {
  careDeskRaise, careDeskTickets, careDeskVehicle,
  type CareDeskRaiseSetup, type CareDeskTicket, type CareDeskVehicle, type CareDeskVehicleContext, type CareDeskVehicleReply, type UploadFile,
} from '../lib/careDeskApi'
import type { BaplDmsVehicleLookup, JobCardListResponse, JobCardSummary } from '../types'
import type { RootStackParamList } from '../navigation/RootNavigator'
import { colors } from '../theme/colors'

type Props = NativeStackScreenProps<RootStackParamList, 'CareDesk'>

/**
 * 2026-10-22 (Android counterpart of web/src/pages/staff/CareDeskPage.tsx): the Care Desk screen is a VEHICLE HUB.
 *   1. Type a chassis no. or registration no. - a live dropdown lists the matches (the same search as the New Job Card wizard).
 *   2. Pick one: the vehicle and its customer (Vehicle Sale), its job cards here, and its Care Desk tickets - live, refreshed every 30 seconds while the screen is open - are shown together.
 *   3. "Raise a ticket" (Off-road). The ticket is created in Care Desk on behalf of the vehicle's company, and says who raised it from JobCardScanner.
 * The vehicle must already be in Care Desk (loaded by BGauss IT); otherwise the screen says so and nothing is created. Care Desk itself still decides everything else (photos, hubs, one running ticket per
 * vehicle, TAT, routing to the engineer). The one-click sign-in into the Care Desk app ("Open Care Desk") is for head-office logins only (its token endpoint is CorporateAdminUp).
 * Not on Android: web's optional embedded Care Desk frame (VITE_CARE_DESK_EMBED) - a phone opens Care Desk in its browser instead.
 */
const IS_STAGING = /staging|uat|test/i.test(CARE_DESK_URL)
const OTHER = 'Other'

const stamp = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—')
const words = (s: string) => s.replace(/_/g, ' ')
const problem = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Please try again.')

export function CareDeskScreen({ route, navigation }: Props) {
  const { profile, hasRole } = useStaffAuth()
  const canOpenCareDesk = hasRole('CorporateAdmin', 'SystemAdmin') 
  const startValue = route.params?.vehicle
  const [picked, setPicked] = useState<PickedVehicle | null>(startValue ? { value: startValue, chassisNo: null, regNo: null, modelName: null } : null)

  if (!CARE_DESK_URL) {
    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.h2}>🎧 Care Desk</Text>
          <Text style={styles.muted}>
            Care Desk is not set up in this app yet. Ask the system administrator to set EXPO_PUBLIC_CARE_DESK_URL (the Care Desk address from BGauss IT) in the app's .env file and rebuild.
          </Text>
        </View>
      </View>
    )
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={styles.titleRow}>
        <Text style={styles.h2}>🎧 Care Desk</Text>
       {canOpenCareDesk && (
          <TouchableOpacity style={styles.primaryBtnSm} onPress={() => void openCareDesk()}>
            <Text style={styles.primaryBtnText}>Open Care Desk ↗</Text>
          </TouchableOpacity>
        )}
      </View>

      {IS_STAGING && (
        <Text style={styles.stagingBanner}>⚠ This is the Care Desk STAGING copy - test data only, not for real tickets.</Text>
      )}

      <View style={styles.card}>
        <Text style={styles.muted}>Search a vehicle by chassis no. or registration no. to see its job cards and its Care Desk tickets together - and to raise a Care Desk ticket for it.</Text>
        <View style={{ marginTop: 8 }}>
          <VehiclePicker dealerId={profile?.dealerId} initial={picked?.value ?? ''} onPick={setPicked} />
        </View>
      </View>

      {picked && <VehicleHub key={picked.value} picked={picked} dealerId={profile?.dealerId} canOpenCareDesk={canOpenCareDesk} onOpenJobCard={(id) => navigation.navigate('JobCardDetail', { id })} />}
    </ScrollView>
  )
}

function VehicleHub({ picked, dealerId, canOpenCareDesk, onOpenJobCard }: { picked: PickedVehicle; dealerId?: string | null; canOpenCareDesk: boolean; onOpenJobCard: (id: string) => void }) {
  const focused = useIsFocused()
  const [jc, setJc] = useState<BaplDmsVehicleLookup | null>(null)
  const [jcError, setJcError] = useState<string | null>(null)
  const [allJobCards, setAllJobCards] = useState<JobCardSummary[] | null>(null)
  const [cd, setCd] = useState<CareDeskVehicleReply | null>(null)
  const [cdError, setCdError] = useState<string | null>(null)
  const [tickets, setTickets] = useState<CareDeskTicket[] | null>(null)
  const [ticketsAt, setTicketsAt] = useState<Date | null>(null)
  const [raising, setRaising] = useState(false)
  const [raisedNo, setRaisedNo] = useState<string | null>(null)

  // what JobCardScanner knows: the vehicle + its customer (Vehicle Sale), and its job cards
  useEffect(() => {
    let cancelled = false
    apiClient.get<BaplDmsVehicleLookup>('/api/jobcards/vehicle-lookup', { params: { value: picked.value, dealerId: dealerId || undefined } })
      .then(({ data }) => { if (!cancelled) setJc(data) })
      .catch(() => { if (!cancelled) setJcError(`"${picked.value}" was not found in Vehicle Sale${dealerId ? ' for your dealer' : ''}.`) })
    apiClient.get<JobCardListResponse>('/api/jobcards', { params: { q: picked.regNo ?? picked.value } })
      .then(({ data }) => { if (!cancelled) setAllJobCards(data.items) })
      .catch(() => { if (!cancelled) setAllJobCards([]) })
    return () => { cancelled = true }
  }, [picked.value, picked.regNo, dealerId])

  const chassis = (jc?.chassisNo ?? picked.chassisNo ?? picked.value).toUpperCase()
  const reg = (jc?.registerNo ?? picked.regNo ?? '').toUpperCase().replace(/[\s-]/g, '')
  const jobCards = useMemo(() => (allJobCards ?? []).filter((j) =>
    (j.vehicleChassisNo ?? '').toUpperCase() === chassis || (reg !== '' && (j.vehicleRegNo ?? '').toUpperCase().replace(/[\s-]/g, '') === reg)), [allJobCards, chassis, reg])

  // what Care Desk knows: is it registered, the raise form's set-up, and the live tickets
  const loadVehicle = useCallback(async () => {
    try { setCdError(null); setCd(await careDeskVehicle(picked.value)) } catch (e) { setCdError(problem(e)) }
  }, [picked.value])
  const loadTickets = useCallback(async () => {
    try { const r = await careDeskTickets(picked.value); setTickets(r.tickets); setTicketsAt(new Date()) } catch (e) { setCdError(problem(e)) }
  }, [picked.value])
  useEffect(() => { void loadVehicle(); void loadTickets() }, [loadVehicle, loadTickets])
  // live: refresh every 30 seconds, but only while this screen is the one being looked at
  useEffect(() => {
    if (!focused) return
    const id = setInterval(() => { void loadTickets() }, 30_000)
    return () => clearInterval(id)
  }, [loadTickets, focused])

  const registered = cd && cd.registered ? cd : null

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.h3}>Vehicle & customer <Text style={styles.muted}>(JobCardScanner · Vehicle Sale)</Text></Text>
        {jcError && <Text style={styles.muted}>{jcError}</Text>}
        {!jcError && !jc && <ActivityIndicator color={colors.primary} />}
        {jc && (
          <>
            <Text style={styles.bold}>{jc.chassisNo}{jc.registerNo ? ` · ${jc.registerNo}` : ''}{jc.modelName ? ` — ${jc.modelName}` : ''}</Text>
            <Text style={styles.muted}>
              Customer: {jc.customerName || '—'}{jc.customerMobile ? ` (${jc.customerMobile})` : ''}
              {jc.saleDate ? ` · sold ${new Date(jc.saleDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ' · not yet sold'}
              {jc.vehiclePrevKms != null ? ` · last ${jc.vehiclePrevKms} km` : ''}
            </Text>
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.h3}>Job cards of this vehicle</Text>
        {allJobCards === null ? <ActivityIndicator color={colors.primary} /> : jobCards.length === 0 ? <Text style={styles.muted}>No job card found for this vehicle.</Text> : jobCards.map((j) => {
          const isBapl = j.source === 'BaplDms'
          return (
            <TouchableOpacity key={j.id} style={styles.jcRow} disabled={isBapl} onPress={() => onOpenJobCard(j.id)}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.bold, !isBapl && { color: colors.primary }]}>{j.jobCardNumber}</Text>
                <Text style={styles.muted}>{isBapl ? 'DMS' : j.stageLabel ?? '-'} · {j.technicianName ?? '-'} · {j.createdAt ? new Date(j.createdAt).toLocaleDateString() : '-'}</Text>
              </View>
              <Badge status={j.status} />
            </TouchableOpacity>
          )
        })}
      </View>

      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Text style={[styles.h3, { flex: 1 }]}>Care Desk tickets <Text style={styles.muted}>(live{ticketsAt ? ` · updated ${ticketsAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''})</Text></Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
          <TouchableOpacity style={styles.btnSm} onPress={() => { void loadVehicle(); void loadTickets() }}><Text style={styles.btnSmText}>↻ Refresh</Text></TouchableOpacity>
          {canOpenCareDesk && <TouchableOpacity style={styles.btnSm} onPress={() => void openCareDesk(`/field/search?q=${encodeURIComponent(picked.value)}`)}><Text style={styles.btnSmText}>Open in Care Desk ↗</Text></TouchableOpacity>}
        </View>

        {cdError && <Text style={styles.errorText}>{cdError}</Text>}
        {!cdError && cd === null && <ActivityIndicator color={colors.primary} />}

        {cd && !cd.registered && (
          <Text style={styles.warnBox}>
            This vehicle is not in Care Desk yet, so no ticket can be raised or shown. Its company and vehicle have to be loaded in Care Desk first (Admin screen B1, or the data load kit) - ask BGauss IT.
          </Text>
        )}

        {registered && (
          <>
            <Text style={[styles.muted, { marginVertical: 6 }]}>
              {registered.vehicle.customer} · {registered.vehicle.city} · {registered.vehicle.model} · sold {registered.vehicle.saleDate}
              {registered.vehicle.warrantyTill ? ` · warranty till ${registered.vehicle.warrantyTill}` : ''}
            </Text>
            {tickets === null ? <ActivityIndicator color={colors.primary} /> : tickets.length === 0 ? <Text style={styles.muted}>No Care Desk ticket for this vehicle yet.</Text> : tickets.map((t) => {
              const late = t.open && !!t.levelDueAt && new Date(t.levelDueAt).getTime() < Date.now()
              return (
                <View key={t.ticketNo} style={styles.ticket}>
                  <Text style={styles.bold}>{t.ticketNo}{t.isRepeat ? <Text style={styles.muted}> · repeat</Text> : null}</Text>
                  {t.description ? <Text style={styles.muted}>{t.description}</Text> : null}
                  <Text style={styles.muted}>{words(t.category)} · {words(t.status)}{t.open ? '' : ' ✓'} · level {t.level ?? '—'}</Text>
                  <Text style={styles.muted}>Raised {stamp(t.createdAt)} · Owner {t.owner ?? '—'}</Text>
                  <Text style={late ? styles.late : styles.muted}>{t.open ? `Level due ${stamp(t.levelDueAt)}${late ? ' · overdue' : ''}` : `Closed ${stamp(t.closedAt)}`}</Text>
                </View>
              )
            })}

            {raisedNo && <Text style={styles.okBox}>✓ Ticket {raisedNo} raised in Care Desk.</Text>}

            {!registered.raise.allowed ? (
              <Text style={[styles.muted, { marginTop: 12 }]}>Cannot raise a ticket here: {registered.raise.reason}</Text>
            ) : registered.raise.context.running ? (
              <Text style={[styles.muted, { marginTop: 12 }]}>
                A ticket is already running for this vehicle: {registered.raise.context.running.ticketNo} ({words(registered.raise.context.running.category)}). Care Desk allows one at a time.
              </Text>
            ) : raising ? (
              <RaiseOffRoad
                vehicle={registered.vehicle}
                ctx={registered.raise.context}
                setup={registered.raise.setup}
                onCancel={() => setRaising(false)}
                onRaised={(no) => { setRaising(false); setRaisedNo(no); void loadVehicle(); void loadTickets() }}
              />
            ) : (
              <View style={{ marginTop: 12 }}>
                {registered.raise.setup.pendingRating && (
                  <Text style={[styles.muted, { marginBottom: 8 }]}>⚠ The client has a closed ticket waiting for its rating ({registered.raise.setup.pendingRating.ticketNo}). Care Desk may refuse a new ticket until it is rated.</Text>
                )}
                <TouchableOpacity style={styles.primaryBtn} onPress={() => { setRaisedNo(null); setRaising(true) }}>
                  <Text style={styles.primaryBtnText}>+ Raise a ticket (Off-road)</Text>
                </TouchableOpacity>
                <Text style={[styles.muted, { marginTop: 6 }]}>Warranty and Spare-parts tickets: next release.</Text>
              </View>
            )}
          </>
        )}
      </View>
    </>
  )
}

function RaiseOffRoad({ vehicle, ctx, setup, onCancel, onRaised }: {
  vehicle: CareDeskVehicle; ctx: CareDeskVehicleContext; setup: CareDeskRaiseSetup; onCancel: () => void; onRaised: (ticketNo: string) => void
}) {
  const hubs = setup.hubs.filter((h) => h.cityId === ctx.vehicle.cityId)
  const [concerns, setConcerns] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [odometer, setOdometer] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactMobile, setContactMobile] = useState('')
  const [locKind, setLocKind] = useState<'hub' | 'pin'>(hubs.length > 0 ? 'hub' : 'pin')
  const [hubId, setHubId] = useState(ctx.vehicle.hubId && hubs.some((h) => h.id === ctx.vehicle.hubId) ? ctx.vehicle.hubId : hubs[0]?.id ?? '')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [landmark, setLandmark] = useState('')
  const [repeat, setRepeat] = useState<'' | 'yes' | 'no'>('')
  const [repeatOf, setRepeatOf] = useState('')
  const [front, setFront] = useState<UploadFile | null>(null)
  const [more, setMore] = useState<UploadFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (c: string) => setConcerns((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))

  const toFile = (asset: ImagePicker.ImagePickerAsset, fallback: string): UploadFile => ({
    uri: asset.uri,
    name: asset.fileName || `${fallback}-${Date.now()}${asset.type === 'video' ? '.mp4' : '.jpg'}`,
    type: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
  })

  const useMyLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') { setError('Location permission was not given - type the latitude and longitude.'); return }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      setLat(p.coords.latitude.toFixed(6))
      setLng(p.coords.longitude.toFixed(6))
      setError(null)
    } catch {
      setError('Location is not available - type the latitude and longitude.')
    }
  }

  const takeFront = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Camera permission is needed to take the vehicle photo.'); return }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.8 })
    if (!r.canceled && r.assets?.[0]) setFront(toFile(r.assets[0], 'front'))
  }
  const pickFront = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Photo library permission is needed to choose a photo.'); return }
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 })
    if (!r.canceled && r.assets?.[0]) setFront(toFile(r.assets[0], 'front'))
  }
  const pickMore = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Photo library permission is needed to choose photos.'); return }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 5, quality: 0.8 })
    if (!r.canceled) setMore(r.assets.slice(0, 5).map((a, i) => toFile(a, `issue${i + 1}`)))
  }

  const missing = (): string | null => {
    if (concerns.length === 0) return 'Select at least one affected part (or Other / not sure).'
    if (!description.trim()) return 'Describe the problem.'
    if (!contactName.trim()) return 'Type the on-site contact name.'
    if (locKind === 'hub' && !hubId) return 'Choose the hub where the vehicle is.'
    if (locKind === 'pin' && (!Number.isFinite(Number(lat)) || lat === '' || !Number.isFinite(Number(lng)) || lng === '')) return 'Type the latitude and longitude, or use "My location".'
    if (!front) return 'The vehicle front-side photo (number plate visible) is mandatory.'
    if (!repeat) return 'Answer: is this a repeat issue?'
    if (repeat === 'yes' && !repeatOf) return 'Choose the earlier ticket (or "Earlier problem was not logged here").'
    return null
  }

  const submit = async () => {
    const why = missing()
    if (why) { setError(why); return }
    setBusy(true)
    setError(null)
    try {
      const data: Record<string, unknown> = {
        category: 'off_road', vehicleId: vehicle.id, concerns, description: description.trim(), odometerKm: odometer.trim() || undefined,
        contactName: contactName.trim(), contactMobile: contactMobile.trim() || undefined,
        location: locKind === 'hub' ? { kind: 'hub', hubId } : { kind: 'pin', lat: Number(lat), lng: Number(lng), landmark: landmark.trim() || undefined },
        repeat, ...(repeat === 'yes' ? { repeatOf } : {}),
      }
      const files: [string, UploadFile][] = [['vehicle_front_photo', front as UploadFile], ...more.slice(0, 5).map((f): [string, UploadFile] => ['issue_media', f])]
      const r = await careDeskRaise(data, files)
      onRaised(r.ticketNo)
    } catch (e) {
      setError(problem(e))
      setBusy(false)
    }
  }

  return (
    <View style={styles.raiseBox}>
      <Text style={styles.h4}>Raise an Off-road ticket · {vehicle.regNo ?? vehicle.vin}</Text>
      <Text style={styles.muted}>
        Raised in Care Desk for {vehicle.customer}, who are told as usual; it records that you raised it from JobCardScanner. First response within {setup.tat.off_road.response} working hours ({setup.window.start}–{setup.window.end}).
      </Text>

      <Text style={styles.label}>Affected part(s) <Text style={styles.req}>*</Text></Text>
      <View style={styles.chips}>
        {[...setup.parts, OTHER].map((c) => (
          <TouchableOpacity key={c} style={[styles.chip, concerns.includes(c) && styles.chipOn]} onPress={() => toggle(c)}>
            <Text style={[styles.chipText, concerns.includes(c) && styles.chipTextOn]}>{c === OTHER ? 'Other / not sure' : c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Describe the problem <Text style={styles.req}>*</Text></Text>
      <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} multiline maxLength={900} value={description} onChangeText={setDescription} />

      <View style={styles.twoCol}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Odometer (km)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={odometer} onChangeText={setOdometer} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Contact mobile</Text>
          <TextInput style={styles.input} keyboardType="phone-pad" maxLength={20} value={contactMobile} onChangeText={setContactMobile} placeholder="10-digit mobile" placeholderTextColor={colors.textMuted} />
        </View>
      </View>
      <Text style={styles.label}>On-site contact <Text style={styles.req}>*</Text></Text>
      <TextInput style={styles.input} maxLength={80} value={contactName} onChangeText={setContactName} />

      <Text style={styles.label}>Where is the vehicle? <Text style={styles.req}>*</Text></Text>
      <View style={styles.radioRow}>
        <TouchableOpacity disabled={hubs.length === 0} onPress={() => setLocKind('hub')}><Text style={[styles.radio, hubs.length === 0 && { opacity: 0.4 }]}>{locKind === 'hub' ? '◉' : '○'} At a hub of {vehicle.customer}</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setLocKind('pin')}><Text style={styles.radio}>{locKind === 'pin' ? '◉' : '○'} Drop a pin</Text></TouchableOpacity>
      </View>
      {locKind === 'hub' ? (
        <PickerField
          label="Hub"
          value={hubId}
          onChange={setHubId}
          placeholder={hubs.length === 0 ? `No hub in ${vehicle.city}` : 'Choose the hub…'}
          options={hubs.map((h) => ({ value: h.id, label: `${h.name}${h.address ? ` — ${h.address}` : ''}` }))}
        />
      ) : (
        <>
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Latitude</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={lat} onChangeText={setLat} /></View>
            <View style={{ flex: 1 }}><Text style={styles.label}>Longitude</Text><TextInput style={styles.input} keyboardType="decimal-pad" value={lng} onChangeText={setLng} /></View>
          </View>
          <Text style={styles.label}>Landmark</Text>
          <TextInput style={styles.input} maxLength={200} value={landmark} onChangeText={setLandmark} />
          <TouchableOpacity style={[styles.btnSm, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => void useMyLocation()}><Text style={styles.btnSmText}>📍 My location</Text></TouchableOpacity>
        </>
      )}

      <Text style={styles.label}>Is this a repeat issue? <Text style={styles.req}>*</Text></Text>
      <View style={styles.radioRow}>
        <TouchableOpacity onPress={() => setRepeat('no')}><Text style={styles.radio}>{repeat === 'no' ? '◉' : '○'} No</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setRepeat('yes')}><Text style={styles.radio}>{repeat === 'yes' ? '◉' : '○'} Yes</Text></TouchableOpacity>
      </View>
      {repeat === 'yes' && (
        <PickerField
          label="Earlier ticket"
          value={repeatOf}
          onChange={setRepeatOf}
          placeholder="Choose the earlier ticket…"
          options={[
            ...ctx.closed.map((c) => ({ value: c.id, label: `${c.ticketNo} — ${words(c.category)}${c.parts ? ` (${c.parts})` : ''}${c.closedOn ? ` · closed ${c.closedOn}` : ''}` })),
            { value: 'not_logged', label: 'Earlier problem was not logged here' },
          ]}
        />
      )}

      <Text style={styles.label}>Vehicle front-side photo (number plate visible) <Text style={styles.req}>*</Text></Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TouchableOpacity style={styles.btnSm} onPress={() => void takeFront()}><Text style={styles.btnSmText}>📷 Take photo</Text></TouchableOpacity>
        <TouchableOpacity style={styles.btnSm} onPress={() => void pickFront()}><Text style={styles.btnSmText}>Choose</Text></TouchableOpacity>
        <Text style={[styles.muted, { flex: 1 }]} numberOfLines={1}>{front ? `✓ ${front.name}` : 'No photo yet'}</Text>
      </View>

      <Text style={styles.label}>More photos / a short video (up to 5)</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TouchableOpacity style={styles.btnSm} onPress={() => void pickMore()}><Text style={styles.btnSmText}>Choose files</Text></TouchableOpacity>
        <Text style={[styles.muted, { flex: 1 }]}>{more.length > 0 ? `${more.length} selected` : 'None'}</Text>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <TouchableOpacity style={[styles.btnSm, busy && { opacity: 0.5 }]} disabled={busy} onPress={onCancel}><Text style={styles.btnSmText}>Cancel</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => void submit()}>
          <Text style={styles.primaryBtnText}>{busy ? 'Raising…' : 'Raise ticket'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
  h2: { fontSize: 18, fontWeight: '700', color: colors.text },
  h3: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 6 },
  h4: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 4 },
  bold: { fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 6 },
  stagingBanner: { marginBottom: 10, padding: 10, borderRadius: 8, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', color: '#92400e', fontWeight: '600' },
  warnBox: { marginTop: 6, padding: 10, borderRadius: 8, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', color: '#92400e' },
  okBox: { marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0', color: '#065f46', fontWeight: '600' },
  jcRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  ticket: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  late: { fontSize: 12, color: colors.danger, fontWeight: '700', marginTop: 2 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center' },
  primaryBtnSm: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  btnSm: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#fff' },
  btnSmText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  raiseBox: { marginTop: 14, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: '#f9fafb' },
  label: { fontSize: 12, color: colors.textMuted, marginTop: 10, marginBottom: 4 },
  req: { color: colors.danger },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 9, color: colors.text },
  twoCol: { flexDirection: 'row', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text },
  chipTextOn: { color: '#fff', fontWeight: '700' },
  radioRow: { flexDirection: 'row', gap: 18, flexWrap: 'wrap', marginBottom: 6 },
  radio: { fontSize: 14, color: colors.text },
})
