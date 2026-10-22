import { useEffect, useState } from 'react'
import * as ImagePicker from 'expo-image-picker'
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { apiClient } from '../api/client'
import { apiMessage, discountLabel, discountOf, suggestionLineMoney, type DiscountKind } from '../lib/suggestionMoney'
import type { JobCardDetail, JobCardPhoto, JobCardsPartsCatalogRow } from '../types'

// Photo/video URLs come back from the API as a relative path (e.g.
// "/uploads/jobcard-photos/.../x.jpg") - same origin as the API itself, not the app's own bundle.
// Mirrors JobCardDetailScreen.tsx's own local photoSrc helper (not exported from there, so
// duplicated here rather than importing across an unrelated screen file).
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? ''
const photoSrc = (url: string) => (url.startsWith('http') ? url : `${API_BASE_URL}${url}`)

/**
 * "Part Suggestion" panel - mirrors web/src/pages/staff/JobCardDetailPage.tsx's PartSuggestionCard.
 *
 * 2026-10-22 (Android brought level with web) - what this card gained:
 *   * the parts are searched ON THE SERVER as you type (GET /api/jobcards/parts-catalog?q=) instead of downloading the whole Item Master (thousands of rows) when the card opens;
 *   * every match shows its GST % and where the Part Upload balance is held ("Stock: CUS0270W1 17 + CUS0270W3 10 = 27"; "Available 0" when none);
 *   * Issue Type FOC (free of cost - the line's Amount is 0), switchable on a saved line too;
 *   * Discount (None / % / ₹) when a part is added or later with the line's Discount button (PUT /api/jobcards/part-suggestions/{id}/discount); an FOC part takes none;
 *   * MRP / Qty / Discount / Amount per line.
 * Unchanged: Description / HSN / MRP are snapshotted onto the suggestion at add time; the part picture strip; the Technician Work Log timer must be running to add a part.
 */
export function PartSuggestionSection({ jc, onChanged, estimatesLocked, totalLockReached }: { jc: JobCardDetail; onChanged: () => void; estimatesLocked: boolean; totalLockReached: boolean }) {
  const [availableParts, setAvailableParts] = useState<JobCardsPartsCatalogRow[]>([])
  const [search, setSearch] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [itemCode, setItemCode] = useState('')
  const [selectedPart, setSelectedPart] = useState<JobCardsPartsCatalogRow | null>(null)
  const [qty, setQty] = useState('1')
  const [status, setStatus] = useState<'Paid' | 'U/W' | 'FOC'>('Paid')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [discountType, setDiscountType] = useState<DiscountKind>('None')
  const [discountValue, setDiscountValue] = useState('0')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<{ id: string; type: DiscountKind; value: string } | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = search.trim()
      if (trimmed.length === 0) { setAvailableParts([]); setSearchError(null); return }
      // No locationCode: the quantity is the combined Part Upload balance across the locations this login may access.
      apiClient
        .get<JobCardsPartsCatalogRow[]>('/api/jobcards/parts-catalog', { params: { q: trimmed } })
        .then(({ data }) => { setAvailableParts(data); setSearchError(null) })
        .catch((err) => { setAvailableParts([]); setSearchError(apiMessage(err, 'Search failed')) })
    }, 300)
    return () => clearTimeout(handle)
  }, [search])

  const q = search.trim()
  const matches = availableParts.slice(0, 20)

  const pickPart = (p: JobCardsPartsCatalogRow) => {
    setItemCode(p.itemCode)
    setSelectedPart(p)
    setSearch(`${p.itemCode}${p.description ? ' - ' + p.description : ''}`)
    setShowSuggestions(false)
  }

  const removeSuggestion = async (id: string) => {
    try {
      await apiClient.delete(`/api/jobcards/part-suggestions/${id}`)
      onChanged()
    } catch (err) {
      Alert.alert(apiMessage(err, 'Could not remove part suggestion'))
    }
  }

  const changeStatus = async (id: string, next: 'Paid' | 'U/W' | 'FOC') => {
    try {
      await apiClient.put(`/api/jobcards/part-suggestions/${id}`, { status: next })
      onChanged()
    } catch (err) {
      Alert.alert(apiMessage(err, 'Could not change the issue type'))
    }
  }

  const saveDiscountEdit = async () => {
    if (!editing) return
    const value = Number(editing.value) || 0
    try {
      await apiClient.put(`/api/jobcards/part-suggestions/${editing.id}/discount`, {
        discountType: editing.type === 'None' ? null : editing.type,
        discountValue: editing.type === 'None' ? 0 : editing.type === 'Percentage' ? Math.min(value, 100) : value,
      })
      setEditing(null)
      onChanged()
    } catch (err) {
      Alert.alert(apiMessage(err, 'Could not save the discount'))
    }
  }

  const addSuggestion = async () => {
    if (!itemCode) return
    // gated on an open Technician Work Log timer (2026-09-07)
    if (!jc.worklogs.some((w) => !w.endedAt)) {
      Alert.alert('Start the Technician Work Log timer before adding a part suggestion.')
      return
    }
    setSaving(true)
    try {
      const { data: created } = await apiClient.post<{ id: string }>(`/api/jobcards/${jc.id}/part-suggestions`, {
        itemCode,
        availableQtyAtSuggestion: selectedPart?.availableQty ?? null,
        status,
        quantity: Number(qty) || 1,
        description: selectedPart?.description ?? null,
        hsnCode: selectedPart?.hsnCode ?? null,
        mrp: selectedPart?.mrp ?? null,
      })
      // the discount is saved right after the part is added (an FOC part is free of cost, so it never takes one)
      const value = Number(discountValue) || 0
      if (status !== 'FOC' && discountType !== 'None' && value > 0) {
        try {
          await apiClient.put(`/api/jobcards/part-suggestions/${created.id}/discount`, { discountType, discountValue: discountType === 'Percentage' ? Math.min(value, 100) : value })
        } catch {
          Alert.alert('The part was added, but its discount could not be saved - use the Discount button on its row to set it.')
        }
      }
      setItemCode('')
      setSelectedPart(null)
      setSearch('')
      setQty('1')
      setStatus('Paid')
      setDiscountType('None')
      setDiscountValue('0')
      onChanged()
    } catch (err) {
      Alert.alert(apiMessage(err, 'Could not add part suggestion'))
    } finally {
      setSaving(false)
    }
  }

  const pills = <T extends string>(options: { value: T; label: string }[], value: T, onPick: (v: T) => void, disabled = false) => (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <TouchableOpacity key={o.value} disabled={disabled} style={[styles.pill, value === o.value && styles.pillSelected, disabled && { opacity: 0.45 }]} onPress={() => onPick(o.value)}>
          <Text style={[styles.pillText, value === o.value && styles.pillTextSelected]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
  const STATUS_OPTIONS = (['Paid', 'U/W', 'FOC'] as const).map((s) => ({ value: s, label: s }))
  const DISCOUNT_OPTIONS: { value: DiscountKind; label: string }[] = [{ value: 'None', label: 'None' }, { value: 'Percentage', label: '%' }, { value: 'Amount', label: '₹' }]

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Part Suggestion</Text>

      {jc.partSuggestions.length === 0 && <Text style={styles.muted}>No parts suggested yet.</Text>}
      {jc.partSuggestions.map((p, i) => {
        const d = discountOf(p)
        const money = suggestionLineMoney(p.mrp, p.quantity, p.status === 'FOC', d)
        return (
          <View key={p.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{i + 1}. {p.itemCode} {p.description ? `- ${p.description}` : ''}</Text>
              <Text style={styles.muted}>MRP {p.mrp != null ? `₹${p.mrp}` : '-'} · Qty {p.quantity} · Discount {p.status === 'FOC' ? 'FOC' : discountLabel(d)} · Amount ₹{money.amount.toFixed(2)}</Text>
              <View style={{ marginTop: 6 }}>{pills(STATUS_OPTIONS, p.status, (v) => changeStatus(p.id, v))}</View>
              {editing?.id === p.id && (
                <View style={styles.editBox}>
                  <Text style={styles.label}>Discount</Text>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {pills(DISCOUNT_OPTIONS, editing.type, (v) => setEditing({ ...editing, type: v }))}
                    <TextInput style={[styles.input, { width: 90 }, editing.type === 'None' && { opacity: 0.45 }]} editable={editing.type !== 'None'} value={editing.value} keyboardType="decimal-pad" onChangeText={(v) => setEditing({ ...editing, value: v })} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity style={[styles.addBtn, { flex: 1 }]} onPress={saveDiscountEdit}><Text style={styles.addBtnText}>Save</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(null)}><Text style={styles.cancelBtnText}>Cancel</Text></TouchableOpacity>
                  </View>
                </View>
              )}
              <PartPictureRow
                jcId={jc.id}
                suggestionId={p.id}
                photos={jc.photos.filter((ph) => ph.partSuggestionId === p.id)}
                onChanged={onChanged}
              />
            </View>
            <View style={{ gap: 6 }}>
              <TouchableOpacity
                style={[styles.smallBtn, p.status === 'FOC' && { opacity: 0.4 }]}
                disabled={p.status === 'FOC'}
                onPress={() => setEditing({ id: p.id, type: d.type, value: String(d.value) })}
              >
                <Text style={styles.smallBtnText}>Discount</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.removeBtn} onPress={() => removeSuggestion(p.id)}>
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        )
      })}

      {estimatesLocked || totalLockReached ? (
        <Text style={styles.muted}>
          {jc.status === 'Closed'
            ? 'Job card is closed - no more parts can be suggested.'
            : 'Estimate is marked Done - tap Edit on the Estimates Amount card below to add more parts.'}
        </Text>
      ) : (
      <>
      <Text style={styles.subheading}>Suggest a part (from Item Master / Part Upload)</Text>

      <TextInput
        style={styles.input}
        value={search}
        placeholder="Start typing an item code or description…"
        onChangeText={(v) => { setSearch(v); setItemCode(''); setSelectedPart(null); setShowSuggestions(true) }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        autoCorrect={false}
      />
      {showSuggestions && q.length > 0 && matches.length > 0 && (
        // nestedScrollEnabled is required on Android for a ScrollView inside another ScrollView (this whole card sits inside one) to scroll at all.
        <ScrollView style={styles.pickerBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {matches.map((p) => (
            <TouchableOpacity key={p.itemCode} style={styles.pickerRow} onPress={() => pickPart(p)}>
              <Text style={styles.pickerRowText}>
                <Text style={{ fontWeight: '700' }}>{p.itemCode}</Text>{p.description ? ` — ${p.description}` : ''} (avail. {p.availableQty ?? '—'} · GST {partGstText(p)})
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {showSuggestions && q.length > 0 && matches.length === 0 && (
        <View style={styles.pickerBox}>
          <View style={styles.pickerRow}>
            <Text style={[styles.pickerRowText, searchError ? { color: '#dc2626' } : styles.muted]}>
              {searchError ?? `Part number "${search.trim()}" does not exist in Item Master.`}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.formRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>QTY</Text>
          <TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="Qty" />
        </View>
        <View style={{ flex: 2 }}>
          <Text style={styles.label}>Issue Type (Status)</Text>
          {pills(STATUS_OPTIONS, status, setStatus)}
        </View>
      </View>
      <Text style={styles.label}>Discount</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        {pills(DISCOUNT_OPTIONS, discountType, setDiscountType, status === 'FOC')}
        <TextInput
          style={[styles.input, { width: 90 }, (status === 'FOC' || discountType === 'None') && { opacity: 0.45 }]}
          editable={!(status === 'FOC' || discountType === 'None')}
          value={discountValue} keyboardType="decimal-pad" onChangeText={setDiscountValue}
        />
      </View>
      {selectedPart && (
        <Text style={styles.muted}>
          MRP {selectedPart.mrp != null ? `₹${selectedPart.mrp}` : '-'} · GST {partGstText(selectedPart)} · HSN {selectedPart.hsnCode ?? '-'} · {partStockLines(selectedPart)}
          {' · '}Amount ₹{suggestionLineMoney(selectedPart.mrp, Number(qty) || 1, status === 'FOC', { type: discountType, value: Number(discountValue) || 0 }).amount.toFixed(2)}
          {status === 'FOC' ? ' (FOC - free of cost)' : discountType !== 'None' && Number(discountValue) > 0 ? ' after discount' : ''}
        </Text>
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

/** GST % of a parts-catalog row: SGST + CGST when present, otherwise IGST ('—' for an upload-only part, which carries no GST rate). */
function partGstText(p: JobCardsPartsCatalogRow): string {
  const split = (p.sgst ?? 0) + (p.cgst ?? 0)
  const total = split > 0 ? split : (p.igst ?? 0)
  return total > 0 ? `${total}%` : '—'
}

/** Where the balance is held: "Stock: CUS0270W1 17 + CUS0270W3 10 = 27" (one location: "Stock: CUS0270W1 17"; none: "Available 0"). */
function partStockLines(p: JobCardsPartsCatalogRow): string {
  const parts = (p.stockByLocation ?? []).map((s) => `${s.locationCode || '—'} ${s.qty}`)
  if (parts.length === 0) return `Available ${p.availableQty ?? 0}`
  return parts.length === 1 ? `Stock: ${parts[0]}` : `Stock: ${parts.join(' + ')} = ${p.availableQty ?? 0}`
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
  editBox: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10, marginTop: 8 },
  cancelBtn: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', backgroundColor: '#fff' },
  cancelBtnText: { color: '#374151', fontWeight: '700' },
  pictureRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  pictureThumb: { width: 32, height: 32, borderRadius: 4, borderWidth: 1, borderColor: '#e2e6ec' },
  videoBadge: { width: 32, height: 32, borderRadius: 4, backgroundColor: '#101828', alignItems: 'center', justifyContent: 'center' },
  videoBadgeText: { color: '#fff', fontSize: 12 },
})
