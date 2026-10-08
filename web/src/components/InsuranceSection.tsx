import { useEffect, useMemo, useState } from 'react'
import { staffApi } from '../api/client'

/**
 * "Insurance" section of the Repair Bill page (RepairBillCreatePage). Click "+ Add Insurance" and the list of INSURANCE LEDGERS opens - the ledgers of type Insurance created in
 * Ledger Master (this dealer's own, plus the ones shared with every dealer). Pick one, fill the policy details, then "Save as Proforma" / "Save as Invoice" as usual: the
 * insurance details are saved on the bill and printed on its invoice (see lib/repairBillInsuranceHtml.ts) - a bill without insurance prints in the normal format.
 *
 * The component owns only the picker (open / search); every value lives in the page's own state and flows through `value` / `onChange`, so the page's existing save and
 * edit-a-bill code keeps working unchanged. Fields map to the RepairBillDoc columns that already exist: insuranceCompanyName, policyNo, insuranceValidTill, surveyorName,
 * surveyorContactNumber, zeroDepreciation, insuranceDescription.
 */
export interface InsuranceValue {
  companyName: string
  policyNo: string
  validTill: string          // yyyy-MM-dd
  surveyorName: string
  surveyorContact: string
  zeroDepreciation: boolean
  description: string
}

interface InsuranceLedger {
  id: string
  ledgerCode: string
  ledgerName: string
  mobileNumber: string | null
  city: string | null
  state: string | null
  gstno: string | null
}

interface LedgerTypeOption {
  id: number
  customerType: string
}

interface Props {
  /** The Insurance section is switched on (the bill is an insurance bill). */
  enabled: boolean
  onToggle: (enabled: boolean) => void
  value: InsuranceValue
  onChange: (patch: Partial<InsuranceValue>) => void
  /** Locks the section (no job linked yet, or the bill is already Billed / Cancelled). */
  disabled?: boolean
  disabledReason?: string
}

/** Digits only, at most 10. A pasted "+91 98765 43210", "919876543210" or "09876543210" keeps the 10 real digits (the +91 / 0 prefix is dropped). */
const tenDigits = (raw: string): string => {
  let d = raw.replace(/[^0-9]/g, '')
  if (d.length > 10 && d.startsWith('91') && d.length <= 12) d = d.slice(2)
  else if (d.length > 10 && d.startsWith('0') && d.length <= 11) d = d.slice(1)
  return d.slice(0, 10)
}

export function InsuranceSection({ enabled, onToggle, value, onChange, disabled = false, disabledReason }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [ledgers, setLedgers] = useState<InsuranceLedger[] | null>(null)   // null = not loaded yet
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [pickedCode, setPickedCode] = useState('')

  // The Insurance ledgers (Ledger Master, type "Insurance") - loaded the first time the list is opened.
  useEffect(() => {
    if (!pickerOpen || ledgers !== null) return
    setLoadError(null)
    staffApi
      .get<LedgerTypeOption[]>('/api/ledger-master/types')
      .then(({ data }) => {
        const insuranceType = data.find((t) => t.customerType.trim().toLowerCase() === 'insurance')
        if (!insuranceType) {
          setLedgers([])
          setLoadError('Ledger Master has no "Insurance" ledger type.')
          return undefined
        }
        return staffApi
          .get<{ data: InsuranceLedger[]; totalRecords: number }>('/api/ledger-master', {
            params: { ledgerTypeId: insuranceType.id, pageIndex: 0, pageSize: 500, includeInactive: false },
          })
          .then((res) => setLedgers(res.data.data))
      })
      .catch((err) => {
        setLedgers([])
        setLoadError(err?.response?.data?.message ?? 'Could not load the Insurance ledgers.')
      })
  }, [pickerOpen, ledgers])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || !ledgers) return ledgers ?? []
    return ledgers.filter((l) =>
      [l.ledgerName, l.ledgerCode, l.city, l.mobileNumber, l.gstno].some((v) => (v ?? '').toLowerCase().includes(q)))
  }, [ledgers, search])

  const pick = (l: InsuranceLedger) => {
    onChange({ companyName: l.ledgerName })
    setPickedCode(l.ledgerCode)
    setPickerOpen(false)
    setSearch('')
  }

  const turnOn = () => {
    onToggle(true)
    setPickerOpen(true)          // "when we click Insurance, the list shows"
  }
  const turnOff = () => {
    onToggle(false)
    setPickerOpen(false)
    setPickedCode('')
    setSearch('')
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid #7c3aed', padding: '14px 16px', marginBottom: 18, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: '#6d28d9' }}>
          <span>🛡️</span>
          <span>Insurance</span>
          {enabled && value.companyName && <span className="badge badge-success">{value.companyName}</span>}
        </div>
        {enabled ? (
          <button type="button" className="btn btn-sm" onClick={turnOff} disabled={disabled}>✕ Remove Insurance</button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={turnOn} disabled={disabled} title={disabled ? disabledReason : undefined}>+ Add Insurance</button>
        )}
      </div>

      {!enabled && (
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
          {disabled && disabledReason
            ? disabledReason
            : 'Is this an insurance claim? Click "+ Add Insurance" to pick the insurance company - its details are then printed on the invoice. Leave it off for a normal bill.'}
        </p>
      )}

      {enabled && (
        <>
          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="field" style={{ flex: 2 }}>
              <label>Insurance Company *</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  readOnly
                  value={value.companyName ? `${pickedCode ? `${pickedCode} - ` : ''}${value.companyName}` : ''}
                  placeholder="Select an insurance company from the list"
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn btn-sm" onClick={() => setPickerOpen((o) => !o)} disabled={disabled}>
                  {pickerOpen ? 'Close list' : value.companyName ? 'Change' : 'Select'}
                </button>
              </div>
            </div>
          </div>

          {pickerOpen && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: '#fff', margin: '4px 0 12px', overflow: 'hidden' }}>
              <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search insurance company, code, city, mobile or GST…"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Insurance Company</th>
                      <th>City</th>
                      <th>Mobile</th>
                      <th>GST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgers === null && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 14 }}>Loading…</td></tr>}
                    {shown.map((l) => (
                      <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => pick(l)} title="Click to select">
                        <td>{l.ledgerCode}</td>
                        <td>{l.ledgerName}</td>
                        <td>{l.city ?? '—'}</td>
                        <td>{l.mobileNumber ?? '—'}</td>
                        <td>{l.gstno ?? '—'}</td>
                      </tr>
                    ))}
                    {ledgers !== null && shown.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 14 }}>
                          {loadError ?? (search ? 'No insurance company matches your search.' : 'No Insurance ledgers yet - create one in Ledger Master (type Insurance), then click Select again.')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="field">
              <label>Policy No</label>
              <input value={value.policyNo} onChange={(e) => onChange({ policyNo: e.target.value })} disabled={disabled} />
            </div>
            <div className="field">
              <label>Valid Till</label>
              <input type="date" value={value.validTill} onChange={(e) => onChange({ validTill: e.target.value })} disabled={disabled} />
            </div>
            <div className="field">
              <label>Surveyor Name</label>
              <input value={value.surveyorName} onChange={(e) => onChange({ surveyorName: e.target.value })} disabled={disabled} />
            </div>
            <div className="field">
              <label>Surveyor Contact No</label>
              <input
                value={value.surveyorContact}
                inputMode="numeric"
                placeholder="10-digit mobile no"
                onChange={(e) => onChange({ surveyorContact: tenDigits(e.target.value) })}
                disabled={disabled}
              />
              {value.surveyorContact.length > 0 && value.surveyorContact.length < 10 && (
                <span style={{ fontSize: 12, color: '#b45309' }}>{value.surveyorContact.length}/10 digits</span>
              )}
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Zero Depreciation</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
                <input type="checkbox" checked={value.zeroDepreciation} onChange={(e) => onChange({ zeroDepreciation: e.target.checked })} disabled={disabled} style={{ width: 'auto' }} />
                Zero depreciation policy
              </label>
            </div>
            <div className="field" style={{ flex: 3 }}>
              <label>Insurance Description / Remarks</label>
              <input value={value.description} onChange={(e) => onChange({ description: e.target.value })} disabled={disabled} placeholder="Claim no., remarks…" />
            </div>
          </div>
        </>
      )}
    </div>
  )
}