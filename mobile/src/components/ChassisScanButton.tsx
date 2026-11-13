// mobile\src\components\ChassisScanButton.tsx
// 2026-11-13 (OCR scanner for the "Chassis no. / RegNo." search field of JobCardWizardScreen): a camera button that
// sits beside the existing field. Tap -> camera -> the photo is read ON THE PHONE by Google ML Kit text recognition
// (the model is inside the app, so reading works with no internet) -> the likely chassis / registration number is
// shown in an editable box -> "Search" hands the value back to the wizard, which runs ITS OWN existing search
// (lookupByChassisOrReg, the same function the Search button and the suggestion list use). This component knows
// nothing about dealers, vehicles or the API; it only returns a string.
import { useState } from 'react'
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { extractVehicleIds, kindLabel, type OcrLike, type VehicleIdCandidate } from '../utils/vehicleIdOcr'

interface Props {
  /** called with the confirmed (and possibly hand-corrected) number; the wizard then searches for it */
  onResult: (value: string) => void
  disabled?: boolean
}

type Phase = 'reading' | 'result'

/** after the photo, Android's own crop screen lets the technician cut the photo down to just the number, which
 *  removes the brand text around it and improves the reading. Set to false to skip that step. */
const CROP_AFTER_PHOTO = true

function friendlyOcrError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/linked|rebuilt|Expo managed|undefined is not|null is not an object|Cannot read propert/i.test(msg)) {
    return 'The scanner is not part of this app build yet. Install the latest app build (a development or preview build - Expo Go does not contain it). You can still type the number.'
  }
  return 'The photo could not be read. Please retake it, or type the number.'
}

export function ChassisScanButton({ onResult, disabled }: Props) {
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>('reading')
  const [busy, setBusy] = useState(false)
  const [imageUri, setImageUri] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<VehicleIdCandidate[]>([])
  const [value, setValue] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const close = () => {
    setVisible(false)
    setImageUri(null)
    setCandidates([])
    setValue('')
    setMessage(null)
  }

  const scan = async () => {
    if (busy) return
    setBusy(true)
    const hadResult = imageUri !== null
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync()
      if (status !== 'granted') { Alert.alert('Camera permission is needed to scan the number.'); return }
      // the window is closed while the camera is open, and shown again with the new photo
      setVisible(false)
      const shot = await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: CROP_AFTER_PHOTO })
      const uri = shot.canceled ? undefined : shot.assets?.[0]?.uri
      if (!uri) { if (hadResult) setVisible(true); return }

      setImageUri(uri)
      setCandidates([])
      setValue('')
      setMessage(null)
      setPhase('reading')
      setVisible(true)
      try {
        // loaded only now, so a build without the native scanner shows a clear message instead of failing at startup
        const mod = await import('@react-native-ml-kit/text-recognition')
        const ocr: OcrLike = await mod.default.recognize(uri)
        const found = extractVehicleIds(ocr)
        setCandidates(found)
        if (found.length > 0 && found[0]) setValue(found[0].value)
        else setMessage('No chassis or registration number could be read from this photo. Retake it closer, in good light, with the number filling the frame - or type it below.')
      } catch (err) {
        setMessage(friendlyOcrError(err))
      }
      setPhase('result')
    } finally {
      setBusy(false)
    }
  }

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
        style={[styles.iconBtn, (disabled || busy) && styles.disabled]}
        disabled={disabled || busy}
        onPress={scan}
        accessibilityRole="button"
        accessibilityLabel="Scan the chassis or registration number with the camera"
      >
        {busy && !visible ? <ActivityIndicator size="small" /> : <Text style={styles.iconText}>📷</Text>}
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.card}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.title}>Scan chassis / registration no.</Text>
              {imageUri ? <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="contain" /> : null}

              {phase === 'reading' ? (
                <View style={styles.readingRow}>
                  <ActivityIndicator />
                  <Text style={styles.muted}>Reading the number...</Text>
                </View>
              ) : (
                <>
                  {best ? (
                    <Text style={styles.muted}>
                      Detected: {kindLabel(best.kind)}.{' '}
                      {best.loose ? 'Not sure about this reading - check every character.'
                        : best.corrected ? 'Look-alike characters (O/0, I/1, B/8) were corrected - please check.'
                        : 'Please check it against the vehicle.'}
                    </Text>
                  ) : null}
                  {message ? <Text style={styles.warn}>{message}</Text> : null}

                  {candidates.length > 1 ? (
                    <View style={styles.chips}>
                      {candidates.slice(0, 4).map((c) => (
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
                  <Text style={styles.hint}>Tip: hold the phone 15-20 cm from the number, avoid glare and shadow, and fill the frame with it.</Text>
                </>
              )}
            </ScrollView>

            <View style={styles.btnRow}>
              <TouchableOpacity style={styles.btn} onPress={close}><Text style={styles.btnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, phase === 'reading' && styles.disabled]} disabled={phase === 'reading' || busy} onPress={scan}>
                <Text style={styles.btnText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, (phase === 'reading' || value.trim().length < 2) && styles.disabled]}
                disabled={phase === 'reading' || value.trim().length < 2}
                onPress={confirm}
              >
                <Text style={styles.btnPrimaryText}>Search</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  )
}

// colours and corner radius copied from JobCardWizardScreen's own btn / btnPrimary / input styles
const styles = StyleSheet.create({
  iconBtn: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  iconText: { fontSize: 20 },
  disabled: { opacity: 0.5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, maxHeight: '90%' },
  title: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 8 },
  photo: { width: '100%', height: 150, backgroundColor: '#f3f4f6', borderRadius: 8, marginBottom: 8 },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 4, marginBottom: 4 },
  warn: { fontSize: 13, color: '#b45309', marginVertical: 6 },
  hint: { fontSize: 11, color: '#6b7280', marginTop: 6 },
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