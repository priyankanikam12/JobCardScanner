import type { WorkflowStage } from '../types'

/** Minimal shape both surfaces that show timestamps against a stage already have:
 * staff's JobCardStageHistoryEntry and the customer portal's Timeline entries both carry a
 * resolved stage label (never an id on the portal side, since that endpoint is anonymous and
 * only exposes what's needed to render this). Matching by label keeps one component usable in
 * both places without forcing the portal API to leak stage ids. */
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
 * Vertical "Workflow Timeline" stepper - the same visual job card progress tracker on both the
 * staff Job Card detail page (interactive, alongside the stage-update panel) and the customer
 * tracking portal (read-only "Live Status"), so a customer sees exactly the same stage list and
 * order a workshop staff member does. Every dealer's *active* stage list (already merged
 * global-template + dealer-overrides and filtered/sorted by the backend) is shown in full,
 * including stages not yet reached, so the customer/staff member can see what's still ahead -
 * not just what has already happened.
 */
export function WorkflowTimeline({
  stages,
  currentStageId,
  history = [],
}: {
  stages: WorkflowStage[]
  currentStageId?: string | null
  history?: WorkflowTimelineHistoryEntry[]
}) {
  const currentSeq = stages.find((s) => s.id === currentStageId)?.seq ?? -1

  return (
    <div>
      {stages.map((stage, i) => {
        const state = stage.seq < currentSeq ? 'done' : stage.seq === currentSeq ? 'current' : 'upcoming'
        // Last matching entry wins - a stage can be re-entered (e.g. "Re-Work" loops back into
        // "In Repair"), so the most recent visit is the one worth showing a timestamp for.
        const entry = [...history].reverse().find((h) => h.stageLabel === stage.label)
        const isLast = i === stages.length - 1

        return (
          <div key={stage.id} style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 28 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  flexShrink: 0,
                  background: state === 'done' ? '#16a34a' : state === 'current' ? '#fff' : '#e5e7eb',
                  border: state === 'current' ? '2px solid #16a34a' : 'none',
                  color: state === 'done' ? '#fff' : state === 'current' ? '#16a34a' : '#9ca3af',
                }}
              >
                {state === 'done' ? '✓' : state === 'current' ? '●' : ''}
              </div>
              {!isLast && <div style={{ width: 2, flex: 1, minHeight: 24, background: state === 'done' ? '#16a34a' : '#e5e7eb' }} />}
            </div>
            <div style={{ paddingBottom: isLast ? 0 : 20 }}>
              <div style={{ fontWeight: state === 'upcoming' ? 400 : 600, color: state === 'upcoming' ? '#9ca3af' : state === 'current' ? '#16a34a' : '#111827' }}>
                <span aria-hidden="true" style={{ marginRight: 6 }}>{STAGE_ICON[stage.stageKey] ?? ''}</span>
                {stage.label}
              </div>
              {entry && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {formatTimestamp(entry.enteredAt)}
                  {entry.exitedAt ? ` – ${formatTimestamp(entry.exitedAt)}` : ''}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
