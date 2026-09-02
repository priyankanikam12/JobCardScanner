import { StyleSheet, Text, View } from 'react-native'
import type { WorkflowStage } from '../types'

/** Mirrors web/src/components/WorkflowTimeline.tsx's history entry shape. */
export interface WorkflowTimelineHistoryEntry {
  stageLabel?: string | null
  enteredAt: string
  exitedAt?: string | null
}

const STAGE_ICON: Record<string, string> = {
  check_in: '🚗',
  job_card_created: '📝',
  inspection: '🔍',
  diagnosis: '🩺',
  estimate_prep: '💰',
  customer_approval: '✅',
  parts_requested: '📦',
  parts_issued: '📦',
  part_suggestion: '📦',
  labour_suggestion: '🧰',
  in_repair: '🔧',
  repair_completed: '🛠️',
  quality_check: '🛡️',
  rework: '♻️',
  ready_for_delivery: '🏁',
  invoice_generated: '🧾',
  closed: '🎉',
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Vertical "Workflow Timeline" stepper for the Job Card Detail screen - a simplified, native
 * re-implementation of web/src/components/WorkflowTimeline.tsx's same visual progress tracker
 * (icons, done/current/upcoming states, per-stage timestamps), since there's no shared component
 * between the two apps.
 */
export function WorkflowTimelineView({
  stages, currentStageId, history = [],
}: {
  stages: WorkflowStage[]
  currentStageId?: string | null
  history?: WorkflowTimelineHistoryEntry[]
}) {
  const currentSeq = stages.find((s) => s.id === currentStageId)?.seq ?? -1

  return (
    <View>
      {stages.map((stage, i) => {
        const state = stage.seq < currentSeq ? 'done' : stage.seq === currentSeq ? 'current' : 'upcoming'
        const entry = [...history].reverse().find((h) => h.stageLabel === stage.label)
        const isLast = i === stages.length - 1

        return (
          <View key={stage.id} style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ alignItems: 'center', width: 30 }}>
              <View style={[
                styles.dot,
                state === 'done' && styles.dotDone,
                state === 'current' && styles.dotCurrent,
                state === 'upcoming' && styles.dotUpcoming,
              ]}>
                <Text style={styles.dotIcon}>{STAGE_ICON[stage.stageKey] ?? '•'}</Text>
              </View>
              {!isLast && <View style={[styles.connector, state === 'done' && styles.connectorDone]} />}
            </View>
            <View style={{ flex: 1, paddingBottom: 16 }}>
              <Text style={[styles.stageLabel, state === 'current' && styles.stageLabelCurrent]}>{stage.label}</Text>
              {entry ? (
                <Text style={styles.muted}>
                  {formatTimestamp(entry.enteredAt)}{entry.exitedAt ? ` → ${formatTimestamp(entry.exitedAt)}` : state === 'current' ? ' (in progress)' : ''}
                </Text>
              ) : state === 'upcoming' ? (
                <Text style={styles.muted}>Not reached yet</Text>
              ) : null}
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  dotDone: { backgroundColor: '#ecfdf5', borderColor: '#059669' },
  dotCurrent: { backgroundColor: '#eef2ff', borderColor: '#2563eb' },
  dotUpcoming: { backgroundColor: '#f4f6f9', borderColor: '#d1d5db' },
  dotIcon: { fontSize: 12 },
  connector: { width: 2, flex: 1, backgroundColor: '#e5e7eb', marginTop: 2 },
  connectorDone: { backgroundColor: '#a7f3d0' },
  stageLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  stageLabelCurrent: { color: '#101828', fontWeight: '700' },
  muted: { fontSize: 11, color: '#6b7280', marginTop: 2 },
})
