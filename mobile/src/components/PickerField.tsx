import { useState } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { colors } from '../theme/colors'

/**
 * A labeled tap-to-open picker, used everywhere the web app has a plain HTML <select> - React
 * Native has no built-in dropdown, and rather than pull in a picker library this renders like the
 * app's existing text inputs and opens a full-screen list modal on tap. Used across the New Job
 * Card wizard (Job Type/Service Head/Service Type/Service Location/Job Source/Complaint/Model/
 * Variant/Priority) and the Job Card Detail screen (Update Workflow Stage).
 */
export interface PickerOption {
  label: string
  value: string
}

// 2026-10-02 ("scroll add in that after 10", applied to Android too after the same fix went into
// web's complaint overflow dropdown - JobCardWizardPage.tsx): the FlatList below already scrolls
// past its maxHeight (it's a virtualized list, not a clipped View), so with 100 Complaint Master
// rows the rest were always reachable by scrolling - there was just no visual cue telling the user
// that, which is what read as "only top 10 shown, no scroll". This threshold adds a sticky "N
// options - scroll for more" row at the top of the sheet once there are enough options that the
// list is likely to scroll off-screen, applied to every PickerField call site (Job Type/Service
// Head/Complaint/Model/etc.), not complaints specifically - the same gap existed everywhere this
// component renders a long list.
const SCROLL_HINT_THRESHOLD = 10

export function PickerField({
  label, value, options, onChange, placeholder = 'Select…', disabled = false, required = false,
}: {
  label: string
  value: string
  options: PickerOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  // 2026-09-03: some call sites still pass the "*" baked into `label` itself (e.g.
  // "Job Type *") rather than using the `required` prop - handled either way so the asterisk
  // renders in red instead of the same gray as the rest of the label, matching web's Req() helper.
  const starMatch = /^(.*?)\s\*$/.exec(label)
  const baseLabel = starMatch ? starMatch[1] : label
  const isRequired = required || !!starMatch
  const showScrollHint = options.length > SCROLL_HINT_THRESHOLD

  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{baseLabel}{isRequired ? <Text style={styles.requiredStar}> *</Text> : null}</Text>
      <TouchableOpacity
        style={[styles.field, disabled && styles.fieldDisabled]}
        disabled={disabled}
        onPress={() => setOpen(true)}
      >
        <Text style={[styles.fieldText, !selected && styles.placeholder]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{baseLabel}</Text>
              <TouchableOpacity onPress={() => setOpen(false)}><Text style={styles.close}>Close</Text></TouchableOpacity>
            </View>
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              style={{ maxHeight: 420 }}
              ListEmptyComponent={<Text style={styles.empty}>No options.</Text>}
              ListHeaderComponent={
                showScrollHint ? (
                  <View style={styles.scrollHint}>
                    <Text style={styles.scrollHintText}>{options.length} options — scroll for more ↓</Text>
                  </View>
                ) : null
              }
              stickyHeaderIndices={showScrollHint ? [0] : undefined}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.option, item.value === value && styles.optionSelected]}
                  onPress={() => { onChange(item.value); setOpen(false) }}
                >
                  <Text style={[styles.optionText, item.value === value && styles.optionTextSelected]}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: 12, color: '#6b7280', marginBottom: 4 },
  requiredStar: { color: '#dc2626' },
  field: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 8, padding: 10, minHeight: 42, justifyContent: 'center' },
  fieldDisabled: { backgroundColor: '#f4f6f9' },
  fieldText: { color: '#101828', fontSize: 14 },
  placeholder: { color: '#9ca3af' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 12, paddingBottom: 24, maxHeight: '75%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: '#101828' },
  close: { color: '#2563eb', fontWeight: '600' },
  scrollHint: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  scrollHintText: { fontSize: 12, color: '#6b7280' },
  option: { paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f1f3f6' },
  // Selected option uses the navy "chip-selected" treatment (Hub Pulse reskin) instead of the old
  // soft-blue tint, matching the chip states used elsewhere (filter chips, DMS badges).
  optionSelected: { backgroundColor: colors.navy },
  optionText: { fontSize: 14, color: '#374151' },
  optionTextSelected: { color: '#fff', fontWeight: '700' },
  empty: { padding: 16, color: '#6b7280' },
})