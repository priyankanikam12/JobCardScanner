import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import type { WorkflowStage } from '../../types'

export function AdminWorkflowPage() {
  const [stages, setStages] = useState<WorkflowStage[]>([])
  const [form, setForm] = useState({ stageKey: '', label: '', seq: 1, icon: '', active: true, isTerminal: false })

  const load = () => staffApi.get<WorkflowStage[]>('/api/workflow-stages').then((r) => setStages(r.data))
  useEffect(() => { load() }, [])

  const save = async () => {
    await staffApi.post('/api/workflow-stages', form)
    setForm({ stageKey: '', label: '', seq: stages.length + 1, icon: '', active: true, isTerminal: false })
    load()
  }

  return (
    <div>
      <h2>Admin: Workflow Configuration</h2>
      <p className="muted">Stages with no dealer override come from the global default template. Adding a stage here creates (or overrides) one for your dealer.</p>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Seq</th><th>Key</th><th>Label</th><th>Terminal</th></tr></thead>
          <tbody>{stages.map((s) => <tr key={s.id}><td>{s.seq}</td><td>{s.stageKey}</td><td>{s.label}</td><td>{s.isTerminal ? 'Yes' : ''}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="card">
        <h3>Add / override a stage for your dealer</h3>
        <div className="form-row">
          <div className="field"><label>Stage key</label><input value={form.stageKey} onChange={(e) => setForm({ ...form, stageKey: e.target.value })} placeholder="e.g. custom_wash" /></div>
          <div className="field"><label>Label</label><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Pre-Delivery Wash" /></div>
          <div className="field"><label>Sequence</label><input type="number" value={form.seq} onChange={(e) => setForm({ ...form, seq: Number(e.target.value) })} /></div>
          <div className="field">
            <label>Terminal stage?</label>
            <select value={form.isTerminal ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, isTerminal: e.target.value === 'yes' })}>
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </div>
        </div>
        <button className="btn btn-primary" disabled={!form.stageKey || !form.label} onClick={save}>Save Stage</button>
      </div>
    </div>
  )
}
