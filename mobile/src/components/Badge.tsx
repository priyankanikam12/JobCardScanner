import { StyleSheet, Text, View } from 'react-native'

const COLORS: Record<string, { bg: string; fg: string }> = {
  Open: { bg: '#eef2ff', fg: '#2563eb' },
  InProgress: { bg: '#fffbeb', fg: '#d97706' },
  PendingCustomerApproval: { bg: '#fffbeb', fg: '#d97706' },
  PendingQc: { bg: '#fffbeb', fg: '#d97706' },
  PendingClosure: { bg: '#fffbeb', fg: '#d97706' },
  PendingInvoice: { bg: '#fffbeb', fg: '#d97706' },
  Closed: { bg: '#ecfdf5', fg: '#059669' },
  Cancelled: { bg: '#f3f4f6', fg: '#6b7280' },
}

export function Badge({ status }: { status: string }) {
  const c = COLORS[status] ?? { bg: '#f3f4f6', fg: '#6b7280' }
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]}>{status}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '600' },
})
