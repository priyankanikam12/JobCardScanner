import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { apiClient } from '../api/client'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { PickerField } from '../components/PickerField'
import type { BaplDmsPartStock, BaplDmsWorkshop, BaplItemMaster, PartMaster } from '../types'

interface PartsSearchResponse {
  localParts: PartMaster[]
  dmsParts: BaplDmsPartStock[]
  dmsWarning: string | null
}

export function PartsScreen() {
  const { profile } = useStaffAuth()
  const [q, setQ] = useState('')
  const [locationCode, setLocationCode] = useState('')
  // Dealer's own DMS workshop location(s) - fetched once so the DMS Parts Inventory list
  // below can pick one automatically instead of requiring the user to know/type a location code.
  // Mirrors web's PartsPage.tsx same change.
  const [workshops, setWorkshops] = useState<BaplDmsWorkshop[]>([])
  const [localParts, setLocalParts] = useState<PartMaster[]>([])
  const [dmsParts, setDmsParts] = useState<BaplDmsPartStock[]>([])
  const [dmsWarning, setDmsWarning] = useState<string | null>(null)
  // 2026-09-21 ("add changes in android also" - mirrors web's PartsPage.tsx "still ... not
  // fetched data from baplfinal" fix): enriches the DMS Parts Inventory list below with BAPL's own
  // C_ItemMaster (baplfinal) - Dealer Price and per-item GST% - the SAME source Material Transfer
  // Bill/Repair Bill now read from. Purely additive display data; no backend change needed (same
  // GET /api/item-master/by-codes endpoint web already uses).
  const [itemMasterByCode, setItemMasterByCode] = useState<Record<string, BaplItemMaster>>({})

  const search = (loc: string) =>
    apiClient.get<PartsSearchResponse>('/api/parts', { params: { q: q || undefined, locationCode: loc || undefined } })
      .then((r) => {
        setLocalParts(r.data.localParts)
        setDmsParts(r.data.dmsParts)
        setDmsWarning(r.data.dmsWarning)
      })

  useEffect(() => { search(locationCode) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const codes = Array.from(new Set(dmsParts.map((p) => p.itemCode.trim().toUpperCase()).filter(Boolean)))
    if (codes.length === 0) { setItemMasterByCode({}); return }
    apiClient.get<BaplItemMaster[]>('/api/item-master/by-codes', { params: { codes: codes.join(',') } })
      .then(({ data }) => {
        const byCode: Record<string, BaplItemMaster> = {}
        data.forEach((im) => { byCode[im.itemCode.trim().toUpperCase()] = im })
        setItemMasterByCode(byCode)
      })
      .catch(() => setItemMasterByCode({}))
  }, [dmsParts])

  // Item 11: search-as-you-type (debounced) instead of requiring the keyboard's search key.
  useEffect(() => {
    const handle = setTimeout(() => search(locationCode), 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, locationCode])

  useEffect(() => {
    if (!profile?.dealerId) return
    apiClient.get<BaplDmsWorkshop[]>('/api/bapl-dms/workshops', { params: { dealerId: profile.dealerId } })
      .then(({ data }) => {
        // 2026-09-18 Work Area scoping (mirrors web/src/pages/staff/PartsPage.tsx): only offer
        // this user's own assigned location(s) when they have any set; empty = unrestricted.
        const scoped = profile?.workLocationCodes?.length
          ? data.filter((w) => profile.workLocationCodes.includes(w.locCode))
          : data
        setWorkshops(scoped)
        // Auto-select this dealer's first workshop location so DMS Parts Inventory shows with no
        // manual search needed.
        if (scoped.length > 0) setLocationCode((prev) => prev || scoped[0].locCode)
      })
      .catch(() => setWorkshops([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.dealerId, profile?.workLocationCodes])

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <TextInput style={styles.search} placeholder="Search parts" value={q} onChangeText={setQ} returnKeyType="search" />

      {workshops.length > 0 ? (
        <View style={{ marginBottom: 12 }}>
          <PickerField
            label="DMS workshop location"
            value={locationCode}
            options={workshops.map((w) => ({ label: `${w.locCode} — ${w.locName}`, value: w.locCode }))}
            onChange={setLocationCode}
          />
        </View>
      ) : (
        <TextInput
          style={styles.search}
          placeholder="DMS workshop location code (e.g. CUS0435W1)"
          value={locationCode}
          onChangeText={setLocationCode}
          autoCapitalize="characters"
        />
      )}

      <Text style={styles.sectionTitle}>JobCardScanner catalog</Text>
      {localParts.length === 0 && <Text style={styles.muted}>No matches in JobCardScanner's own catalog.</Text>}
      {localParts.map((item) => (
        <View key={item.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.muted}>{item.partNumber} - {item.category}</Text>
          </View>
          <Text style={styles.price}>Rs.{item.unitPrice}</Text>
          <Text style={item.stockQty <= 5 ? styles.lowStock : styles.muted}>{item.stockQty} in stock</Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>DMS Parts Inventory</Text>
      {!locationCode && <Text style={styles.muted}>Select or enter a DMS workshop location above to see its live stock.</Text>}
      {dmsWarning && <Text style={[styles.muted, { color: '#dc2626' }]}>{dmsWarning}</Text>}
      {!!locationCode && dmsParts.length === 0 && !dmsWarning && (
        <Text style={styles.muted}>No stock found at "{locationCode}"{q ? ` matching "${q}"` : ''}.</Text>
      )}
      {dmsParts.map((item) => {
        const im = itemMasterByCode[item.itemCode.trim().toUpperCase()]
        return (
          <View key={item.itemCode} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.itemCode}</Text>
              {item.description && <Text style={styles.muted}>{item.description}</Text>}
              <Text style={styles.muted}>
                Dealer Price {im?.dlrPrice != null ? `₹${im.dlrPrice.toFixed(2)}` : '—'} · SGST {im?.sgst != null ? `${im.sgst}%` : '—'} · CGST {im?.cgst != null ? `${im.cgst}%` : '—'} · IGST {im?.igst != null ? `${im.igst}%` : '—'}
              </Text>
            </View>
            <Text style={styles.price}>{item.availableQty} avail.</Text>
          </View>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f9', padding: 12 },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10, marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#101828', marginBottom: 8, marginTop: 4 },
  row: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e6ec', padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontWeight: '700', color: '#101828' },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 2, marginBottom: 8 },
  price: { fontWeight: '600' },
  lowStock: { color: '#dc2626', fontSize: 12, fontWeight: '600' },
})
