import { useEffect, useState } from 'react'
import { Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { apiClient } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Badge } from '../components/Badge'
import type { JobCardDetail, WorkflowStage } from '../types'
import type { RootStackParamList } from '../navigation/RootNavigator'

type Props = NativeStackScreenProps<RootStackParamList, 'JobCardDetail'>

export function JobCardDetailScreen({ route }: Props) {
  const { id } = route.params
  const { profile } = useAuth()
  const [jc, setJc] = useState<JobCardDetail | null>(null)
  const [stages, setStages] = useState<WorkflowStage[]>([])

  const load = async () => {
    const [jcRes, stagesRes] = await Promise.all([
      apiClient.get<JobCardDetail>(`/api/jobcards/${id}`),
      apiClient.get<WorkflowStage[]>('/api/workflow-stages'),
    ])
    setJc(jcRes.data)
    setStages(stagesRes.data)
  }

  useEffect(() => { load() }, [id])

  if (!jc) return <View style={styles.container}><Text style={styles.muted}>Loading...</Text></View>

  const openLog = jc.worklogs.find((w) => !w.endedAt)

  const startTimer = async () => {
    try {
      await apiClient.post(`/api/jobcards/${jc.id}/worklogs/start`, { technicianId: profile?.id, taskDescription: 'Service work' })
      load()
    } catch {
      Alert.alert('Could not start timer')
    }
  }

  const stopTimer = async () => {
    if (!openLog) return
    await apiClient.post(`/api/jobcards/worklogs/${openLog.id}/end`, {})
    load()
  }

  const advanceStage = async () => {
    const idx = stages.findIndex((s) => s.id === jc.currentStage?.id)
    const next = stages[idx + 1]
    if (!next) return
    await apiClient.post(`/api/jobcards/${jc.id}/stage`, { stageId: next.id })
    load()
  }

  const markQcPass = async (name: string) => {
    await apiClient.post(`/api/jobcards/${jc.id}/qc-items`, { itemName: name, passed: true })
    load()
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{jc.jobCardNumber}</Text>
        <Badge status={jc.status} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Customer & Vehicle</Text>
        <Text>{jc.customer?.name} - {jc.customer?.mobile}</Text>
        <Text style={styles.muted}>{jc.vehicle?.model} {jc.vehicle?.variant} - {jc.vehicle?.regNo}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Stage: {jc.currentStage?.label}</Text>
        <Button title="Advance to Next Stage" onPress={advanceStage} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Complaints</Text>
        {jc.complaints.map((c) => <Text key={c.id}>- {c.description}</Text>)}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Work Timer</Text>
        {openLog ? (
          <Button title="Stop Timer" color="#dc2626" onPress={stopTimer} />
        ) : (
          <Button title="Start Timer" onPress={startTimer} />
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Quality Check</Text>
        {['Brakes', 'Battery Health', 'Lights & Indicators'].map((name) => (
          <View key={name} style={{ marginBottom: 6 }}>
            <Button title={`Mark "${name}" Pass`} onPress={() => markQcPass(name)} />
          </View>
        ))}
        {jc.qcChecklistItems.map((q) => (
          <Text key={q.id} style={styles.muted}>{q.itemName}: {q.passed === true ? 'Pass' : q.passed === false ? 'Fail' : 'Pending'}</Text>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f9', padding: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#101828' },
  card: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e6ec', padding: 14, marginBottom: 10 },
  cardTitle: { fontWeight: '700', marginBottom: 8, color: '#101828' },
  muted: { fontSize: 12, color: '#6b7280', marginTop: 2 },
})
