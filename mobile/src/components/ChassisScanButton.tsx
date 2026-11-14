// mobile\src\components\ChassisScanButton.tsx
// 2026-11-13 (LIVE scanner for the "Chassis no. / RegNo." field of JobCardWizardScreen - "OCR process, not capture a picture"): the camera button opens a
// full-screen VIEWFINDER. The technician only points the phone at the number: about once a second a frame is read ON THE PHONE by Google ML Kit (the model is
// inside the app, so it works with no internet), the likely chassis / registration number is picked out, and when the SAME number has been read in two frames
// in a row the scan stops and the number is shown in an editable box. "Find vehicle" hands it back to the wizard, which puts it in its own field and opens its
// own suggestion dropdown. There is no shutter button and no photo is shown or kept: each frame is a silent, temporary file in the app's cache that is
// deleted right after it has been read, and nothing is uploaded. This component knows nothing about dealers, vehicles or the API; it only returns a string.
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StatusBar, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as FileSystem from 'expo-file-system/legacy'
import { recognizeImage } from '../utils/ocrEngine'
import { createStabilityTracker, extractVehicleIds, kindLabel, type VehicleIdCandidate } from '../utils/vehicleIdOcr'

interface Props {
  /** called with the confirmed (and possibly hand-corrected) number; the wizard shows the matching vehicles for it */
  onResult: (value: string) => void
  disabled?: boolean
}

type Phase = 'scanning' | 'confirm'

/** the same number must be read in this many frames in a row before it is accepted (one misread frame cannot fill the field) */
const FRAMES_REQUIRED = 2
/** pause between two reads; the read itself takes about a second on a mid-range phone */
const PAUSE_BETWEEN_READS_MS = 150
/** after this long without a number the hint "move closer / use the light" appears */
const SLOW_HINT_AFTER_MS = 8000
/** after this long the scan stops by itself (saves battery) and offers to scan again or type the number */
const GIVE_UP_AFTER_MS = 40000

function friendlyOcrError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/linked|rebuilt|Expo managed|undefined is not|null is not an object|Cannot read propert/i.test(msg)) {
    return 'The scanner is not part of this app build yet. Install the latest app build (a development or preview build - Expo Go does not contain it). You can still type the number.'
  }
  return 'The camera image could not be read. Please scan again, or type the number.'
}

export function ChassisScanButton({ onResult, disabled }: Props) {
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>('scanning')
  const [session, setSession] = useState(0)          // changes on every (re)start so the camera view is mounted fresh and onCameraReady fires again
  const [ready, setReady] = useState(false)
  const [torch, setTorch] = useState(false)
  const [liveGuess, setLiveGuess] = useState<string | null>(null)
  const [slowHint, setSlowHint] = useState(false)
  const [candidates, setCandidates] = useState<VehicleIdCandidate[]>([])
  const [value, setValue] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const clearReading = () => {
    setCandidates([])
    setValue('')
    setMessage(null)
    setLiveGuess(null)
    setSlowHint(false)
    setReady(false)
  }

  const open = async () => {
    let granted = permission?.granted ?? false
    if (!granted) granted = (await requestPermission()).granted
    if (!granted) { Alert.alert('Camera permission is needed to scan the number.'); return }
    clearReading()
    setTorch(false)
    setPhase('scanning')
    setSession((n) => n + 1)
    setVisible(true)
  }

  const close = () => {
    setVisible(false)   // the effects below stop the scan loop when the window closes
    clearReading()
    setTorch(false)
  }

  const scanAgain = () => {
    clearReading()
    setPhase('scanning')
    setSession((n) => n + 1)
  }

  // ---- the live loop: read a frame, look for a number, delete the frame, repeat until the same number is read twice in a row ----
  useEffect(() => {
    if (!visible || phase !== 'scanning' || !ready) return
    let cancelled = false
    const tracker = createStabilityTracker(FRAMES_REQUIRED)
    const startedAt = Date.now()
    const run = async () => {
      while (!cancelled) {
        let uri: string | undefined
        try {
          // silent (shutterSound false), no flash animation (animateShutter on the view), no EXIF; quality 0.5 keeps the read fast. skipProcessing stays OFF on purpose:
          // with it the picture can come back rotated on some phones, and text recognition needs the text upright.
          const shot = await cameraRef.current?.takePictureAsync({ quality: 0.5, shutterSound: false, exif: false })
          uri = shot?.uri
          if (!uri || cancelled) break
          const found = extractVehicleIds(await recognizeImage(uri))
          if (cancelled) break
          setLiveGuess(found[0]?.value ?? null)
          const stable = tracker.push(found)
          if (stable) {
            setCandidates(found)
            setValue(stable.value)
            setMessage(null)
            setPhase('confirm')
            break
          }
        } catch (err) {
          if (cancelled) break
          setCandidates([])
          setValue('')
          setMessage(friendlyOcrError(err))
          setPhase('confirm')
          break
        } finally {
          // the frame is only needed for the read - never keep it
          if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
        }
        if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
          setCandidates([])
          setValue('')
          setMessage('No chassis or registration number could be read. Scan again - closer, in good light, with the light on - or type it below.')
          setPhase('confirm')
          break
        }
        await new Promise<void>((resolve) => setTimeout(resolve, PAUSE_BETWEEN_READS_MS))
      }
    }
    void run()
    return () => { cancelled = true }
  }, [visible, phase, ready, session])

  useEffect(() => {
    if (!visible || phase !== 'scanning') return
    const timer = setTimeout(() => setSlowHint(true), SLOW_HINT_AFTER_MS)
    return () => clearTimeout(timer)
  }, [visible, phase, session])

  const best = candidates[0]
  const confirm = () => {
    const v = value.trim().toUpperCase().replace(/\s+/g, '')
    if (v.length < 2) return
    close()
    onResult(v)
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.iconBtn, disabled && styles.disabled]}
        disabled={disabled}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel="Scan the chassis or registration number with the camera"
      >
        <Text style={styles.iconText}>📷</Text>
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
        <View style={styles.screen}>
          {phase === 'scanning' ? (
            <>
              <CameraView
                key={session}
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                enableTorch={torch}
                animateShutter={false}
                onCameraReady={() => setReady(true)}
                onMountError={() => { setMessage('The camera could not be started. You can type the number below.'); setPhase('confirm') }}
              />
              <View style={styles.overlay} pointerEvents="box-none">
                <View style={styles.topBar}>
                  <TouchableOpacity style={styles.topBtn} onPress={close}><Text style={styles.topBtnText}>✕  Close</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.topBtn} onPress={() => setTorch((t) => !t)}><Text style={styles.topBtnText}>{torch ? '🔦 Light on' : '🔦 Light off'}</Text></TouchableOpacity>
                </View>
                <View style={styles.guideWrap} pointerEvents="none">
                  <View style={styles.guide} />
                  <Text style={styles.guideText}>Point the camera at the chassis number or registration number</Text>
                </View>
                <View style={styles.bottomBar}>
                  <View style={styles.readingRow}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.readingText}>{ready ? (liveGuess ? `Reading… ${liveGuess}` : 'Reading…') : 'Starting the camera…'}</Text>
                  </View>
                  {slowHint ? <Text style={styles.hint}>Move closer, keep the phone steady, avoid glare, or switch the light on.</Text> : null}
                  <TouchableOpacity onPress={() => { setCandidates([]); setValue(''); setMessage(null); setPhase('confirm') }}>
                    <Text style={styles.typeLink}>Type the number instead</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          ) : (
            <KeyboardAvoidingView style={styles.confirmWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={styles.card}>
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={styles.title}>Chassis / registration no.</Text>
                  {best ? (
                    <Text style={styles.muted}>
                      Read: {kindLabel(best.kind)}.{' '}
                      {best.corrected ? 'Look-alike characters (O/0, I/1, B/8) were corrected - please check.' : 'Please check it against the vehicle.'}
                    </Text>
                  ) : null}
                  {message ? <Text style={styles.warn}>{message}</Text> : null}
                  {candidates.filter((c) => !c.loose).length > 1 ? (
                    <View style={styles.chips}>
                      {candidates.filter((c) => !c.loose).slice(0, 4).map((c) => (
                        <TouchableOpacity key={c.value} style={[styles.chip, value === c.value && styles.chipOn]} onPress={() => setValue(c.value)}>
                          <Text style={[styles.chipText, value === c.value && styles.chipTextOn]}>{c.value}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                  <Text style={styles.label}>Chassis no. / RegNo. (you can edit it)</Text>
                  <TextInput
                    style={styles.input}
                    value={value}
                    onChangeText={setValue}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={20}
                    placeholder="Type or correct the number"
                    onSubmitEditing={confirm}
                  />
                </ScrollView>
                <View style={styles.btnRow}>
                  <TouchableOpacity style={styles.btn} onPress={close}><Text style={styles.btnText}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.btn} onPress={scanAgain}><Text style={styles.btnText}>Scan again</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.btnPrimary, value.trim().length < 2 && styles.disabled]} disabled={value.trim().length < 2} onPress={confirm}>
                    <Text style={styles.btnPrimaryText}>Find vehicle</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}
        </View>
      </Modal>
    </>
  )
}

// colours and corner radius copied from JobCardWizardScreen's own btn / btnPrimary / input styles
const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 44
const styles = StyleSheet.create({
  iconBtn: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  iconText: { fontSize: 20 },
  disabled: { opacity: 0.5 },
  screen: { flex: 1, backgroundColor: '#000' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: topInset + 8, paddingHorizontal: 14 },
  topBtn: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  topBtnText: { color: '#fff', fontWeight: '600' },
  guideWrap: { alignItems: 'center' },
  guide: { width: '88%', height: 120, borderWidth: 2, borderColor: '#fff', borderRadius: 12, backgroundColor: 'transparent' },
  guideText: { color: '#fff', marginTop: 10, paddingHorizontal: 24, textAlign: 'center', fontSize: 14, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4 },
  bottomBar: { backgroundColor: 'rgba(0,0,0,0.6)', padding: 16, paddingBottom: 28, alignItems: 'center', gap: 8 },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  readingText: { color: '#fff', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
  hint: { color: '#fde68a', fontSize: 13, textAlign: 'center' },
  typeLink: { color: '#bfdbfe', fontWeight: '600', marginTop: 4 },
  confirmWrap: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: 'rgba(0,0,0,0.85)' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, maxHeight: '90%' },
  title: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 8 },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 4, marginBottom: 4 },
  warn: { fontSize: 13, color: '#b45309', marginVertical: 6 },
  label: { fontSize: 12, color: '#374151', fontWeight: '600', marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10, fontSize: 16, letterSpacing: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#fff' },
  chipOn: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  chipText: { fontSize: 12, color: '#374151' },
  chipTextOn: { color: '#1d4ed8', fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#374151', fontWeight: '600' },
  btnPrimary: { backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', flex: 1 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
})