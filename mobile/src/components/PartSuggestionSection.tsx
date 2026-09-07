import { useEffect, useState } from 'react'
import * as ImagePicker from 'expo-image-picker'
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { Badge } from './Badge'
import type { BaplDmsPartStock, JobCardDetail, JobCardPhoto } from '../types'

// Photo/video URLs come back from the API as a relative path (e.g.
// "/uploads/jobcard-photos/.../x.jpg") - same origin as the API itself, not the app's own bundle.
// Mirrors JobCardDetailScreen.tsx's own local photoSrc helper (not exported from there, so
// duplicated here rather than importing across an unrelated screen file).
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? ''
const photoSrc = (url: string) => (url.startsWith('http') ? url : `${API_BASE_URL}${url}`)

/**
 * "Part Suggestion" panel - mirrors web/src/pages/staff/JobCardDetailPage.tsx's PartSuggestionCard
 * (Item 16 rework): a type-ahead search bound to item code/description, a Qty field, and a
 * Remove button per suggestion, instead of the old Paid/U-W-toggle-only version. Parts come live
 * from DMS's own PartsInventory for this job card's service location (GET
 * /api/bapl-dms/parts?locationCode=...); Description/HsnCode/Mrp are snapshotted onto the
 * suggestion at add time (POST .../part-suggestions), not re-fetched afterwards.
 */
export function PartSuggestionSection({ jc, onChanged, estimatesLocked, totalLockReached }: { jc: JobCardDetail; onChanged: () => void; estimatesLocked: boolean; totalLockReached: boolean }) {
  const [availableParts, setAvailableParts] = useState<BaplDmsPartStock[]>([])
  const [search, setSearch] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [qty, setQty] = useState('1')
  const [status, setStatus] = useState<'Paid' | 'U/W'>('Paid')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!jc.baplServiceLocationCode) { setAvailableParts([]); return }
    apiClient
      .get<BaplDmsPartStock[]>('/api/bapl-dms/parts', { params: { locationCode: jc.baplServiceLocationCode } })
      .then(({ data }) => setAvailableParts(data))
      .catch(() => setAvailableParts([]))
  }, [jc.baplServiceLocationCode])

  const selectedPart = availableParts.find((p) => p.itemCode === itemCode)
  const q = search.trim().toLowerCase()
  const matches = q.length === 0 ? [] : availableParts
    .filter((p) => p.itemCode.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
    .slice(0, 20)

  const pickPart = (p: BaplDmsPartStock) => {
    setItemCode(p.itemCode)
    setSearch(`${p.itemCode}${p.description ? ' - ' + p.description : ''}`)
  }

  const removeSuggestion = async (id: string) => {
    try {
      await apiClient.delete(`/api/jobcards/part-suggestions/${id}`)
      onChanged()
    } catch {
      Alert.alert('Could not remove part suggestion')
    }
  }

  const addSuggestion = async () => {
    if (!itemCode) return
    // 2026-09-07: gated on an open Technician Work Log timer - see WorklogCard/hasOpenWorklog in
    // JobCardDetailScreen.tsx's doc comment ("Part Suggestion, Labour Suggestion not can update
    // give alret in this process start the timer").
    if (!jc.worklogs.some((w) => !w.endedAt)) {
      Alert.alert('Start the Technician Work Log timer before adding a part suggestion.')
      return
    }
    setSaving(true)
    try {
      await apiClient.post(`/api/jobcards/${jc.id}/part-suggestions`, {
        itemCode,
        availableQtyAtSuggestion: selectedPart?.availableQty ?? null,
        status,
        quantity: Number(qty) || 1,
        description: selectedPart?.description ?? null,
        hsnCode: selectedPart?.hsnCode ?? null,
        mrp: selectedPart?.mrp ?? null,
      })
      setItemCode('')
      setSearch('')
      setQty('1')
      setStatus('Paid')
      onChanged()
    } catch {
      Alert.alert('Could not add part suggestion')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Part Suggestion</Text>

      {jc.partSuggestions.length === 0 && <Text style={styles.muted}>No parts suggested yet.</Text>}
      {jc.partSuggestions.map((p, i) => (
        <View key={p.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{i + 1}. {p.itemCode} {p.description ? `- ${p.description}` : ''}</Text>
            <Text style={styles.muted}>MRP {p.mrp != null ? `₹${p.mrp}` : '-'} · Qty {p.quantity}</Text>
            <PartPictureRow
              jcId={jc.id}
              suggestionId={p.id}
              photos={jc.photos.filter((ph) => ph.partSuggestionId === p.id)}
              onChanged={onChanged}
            />
          </View>
          <Badge status={p.status === 'Paid' ? 'Closed' : 'InProgress'} />
          {/* 2026-09-03: red now, matching web's Part Suggestion Remove button - its own style
             (removeBtn), not the shared smallBtn the "+ Picture" button below uses, so that one
             doesn't turn red too. */}
          <TouchableOpacity style={styles.removeBtn} onPress={() => removeSuggestion(p.id)}>
            <Text style={styles.removeBtnText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}

      {estimatesLocked || totalLockReached ? (
        <Text style={styles.muted}>
          {estimatesLocked
            ? 'Estimate is marked Done - tap Edit on the Estimates Amount card below to add more parts.'
            : 'Grand Total has reached ₹2000 - no more parts can be suggested on this estimate.'}
        </Text>
      ) : (
      <>
      <Text style={styles.subheading}>Suggest a part (from DMS PartsInventory)</Text>
      {!jc.baplServiceLocationCode && (
        <Text style={styles.muted}>No DMS service location on this job card - part list unavailable.</Text>
      )}

      <TextInput
        style={styles.input}
        value={search}
        placeholder="Start typing an item code or description…"
        onChangeText={(v) => { setSearch(v); setItemCode('') }}
      />
      {q.length > 0 && matches.length > 0 && (
        // Item: dropdown scroll wasn't working on Android - a plain View with maxHeight clips
        // overflow instead of scrolling it. nestedScrollEnabled is required on Android for a
        // ScrollView inside another ScrollView (this whole card sits inside one) to scroll at all.
        <ScrollView style={styles.pickerBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {matches.map((p) => (
            <TouchableOpacity key={p.itemCode} style={styles.pickerRow} onPress={() => pickPart(p)}>
              <Text style={styles.pickerRowText}>
                <Text style={{ fontWeight: '700' }}>{p.itemCode}</Text>{p.description ? ` — ${p.description}` : ''} (avail. {p.availableQty})
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {/* Item 4: was silently blank when nothing matched - now says explicitly why. */}
      {q.length > 0 && matches.length === 0 && (
        <View style={styles.pickerBox}>
          <View style={styles.pickerRow}>
            <Text style={[styles.pickerRowText, styles.muted]}>
              {jc.baplServiceLocationCode
                ? `Part number "${search.trim()}" does not exist for dealer location ${jc.baplServiceLocationCode}.`
                : 'No DMS service location on this job card - part list unavailable.'}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>QTY</Text>
          <TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="Qty" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Issue Type (Status)</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['Paid', 'U/W'] as const).map((s) => (
              <TouchableOpacity key={s} style={[styles.pill, status === s && styles.pillSelected]} onPress={() => setStatus(s)}>
                <Text style={[styles.pillText, status === s && styles.pillTextSelected]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
      {selectedPart && (
        <Text style={styles.muted}>MRP {selectedPart.mrp != null ? `₹${selectedPart.mrp}` : '-'} · HSN {selectedPart.hsnCode ?? '-'} · Available {selectedPart.availableQty}</Text>
      )}

      <TouchableOpacity
        style={[styles.addBtn, (!itemCode || saving) && styles.addBtnDisabled]}
        disabled={!itemCode || saving}
        onPress={addSuggestion}
      >
        <Text style={styles.addBtnText}>{saving ? 'Adding…' : 'Add Suggestion'}</Text>
      </TouchableOpacity>
      </>
      )}
    </View>
  )
}

const isVideoPhoto = (ph: JobCardPhoto) => /\.(mp4|mov|webm|3gp|avi)$/i.test(ph.url)

/** Part Suggestion row's "Picture" strip (2026-09-03 - "which partcode we added after added we
 * upload phtoos and video"), mirroring web's PartPictureCell. Shown per already-added suggestion:
 * small thumbnails for whatever's already uploaded against it (a "▶" badge stands in for video,
 * same as web, rather than an inline player), plus a "+ Picture" button offering the same
 * Take Photo/Video vs Choose from Library choice as the job card's general Photos card. Uploads
 * straight to POST /api/jobcards/{id}/photos/upload with PartSuggestionId set to this row's id and
 * Stage fixed to 'PartSuggestion' - no caption/GPS capture here, this is just "attach evidence to
 * this part". */
function PartPictureRow({
  jcId, suggestionId, photos, onChanged,
}: {
  jcId: string
  suggestionId: string
  photos: JobCardPhoto[]
  onChanged: () => void
}) {
  const [uploading, setUploading] = useState(false)

  const uploadResult = async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    setUploading(true)
    try {
      const form = new FormData()
      const isVideo = asset.type === 'video'
      // @ts-expect-error - RN's FormData accepts {uri,name,type} file parts
      form.append('File', {
        uri: asset.uri,
        name: asset.fileName || `${isVideo ? 'video' : 'photo'}-${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`,
        type: asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
      })
      form.append('Stage', 'PartSuggestion')
      form.append('PartSuggestionId', suggestionId)
      await apiClient.post(`/api/jobcards/${jcId}/photos/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      onChanged()
    } catch {
      Alert.alert('Could not upload the file for this part.')
    } finally {
      setUploading(false)
    }
  }

  const takePhotoOrVideo = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Camera permission is needed to capture a photo or video.'); return }
    await uploadResult(await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.8 }))
  }

  const pickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Photo library permission is needed to add a photo or video.'); return }
    await uploadResult(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8 }))
  }

  const choose = () => {
    Alert.alert('Add Picture / Video', undefined, [
      { text: 'Take Photo/Video', onPress: takePhotoOrVideo },
      { text: 'Choose from Library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  return (
    <View style={styles.pictureRow}>
      {photos.map((ph) => (
        isVideoPhoto(ph) ? (
          <View key={ph.id} style={styles.videoBadge}><Text style={styles.videoBadgeText}>▶</Text></View>
        ) : (
          <Image key={ph.id} source={{ uri: photoSrc(ph.url) }} style={styles.pictureThumb} />
        )
      ))}
      <TouchableOpacity style={styles.smallBtn} onPress={choose} disabled={uploading}>
        <Text style={styles.smallBtnText}>{uploading ? 'Uploading…' : '+ Picture'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e6ec', padding: 14, marginBottom: 10 },
  cardTitle: { fontWeight: '700', marginBottom: 8, color: '#101828' },
  subheading: { fontWeight: '600', marginTop: 10, marginBottom: 6, color: '#101828' },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  rowTitle: { fontWeight: '600', color: '#101828' },
  smallBtn: { backgroundColor: '#f4f6f9', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  smallBtnText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  removeBtn: { backgroundColor: '#dc2626', borderWidth: 1, borderColor: '#dc2626', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  removeBtnText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  pickerBox: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, maxHeight: 200, marginTop: 6, marginBottom: 8, overflow: 'hidden' },
  pickerRow: { paddingHorizontal: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  pickerRowText: { color: '#374151' },
  formRow: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  label: { fontSize: 12, color: '#6b7280', marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 8 },
  pill: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  pillSelected: { backgroundColor: '#101828', borderColor: '#101828' },
  pillText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  pillTextSelected: { color: '#fff' },
  addBtn: { backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  addBtnDisabled: { backgroundColor: '#93c5fd' },
  addBtnText: { color: '#fff', fontWeight: '700' },
  pictureRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  pictureThumb: { width: 32, height: 32, borderRadius: 4, borderWidth: 1, borderColor: '#e2e6ec' },
  videoBadge: { width: 32, height: 32, borderRadius: 4, backgroundColor: '#101828', alignItems: 'center', justifyContent: 'center' },
  videoBadgeText: { color: '#fff', fontSize: 12 },
})
