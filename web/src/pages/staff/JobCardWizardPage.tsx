import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi } from '../../api/client'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import type { Customer, Dealer, JobCardPriority, JobCardSource, ServiceType, Vehicle } from '../../types'
import { VEHICLE_MODELS, variantsForModel } from '../../data/vehicleCatalog'

const STEPS = ['Customer', 'Vehicle', 'Service Details', 'Review & Create']

export function JobCardWizardPage() {
  const { profile } = useStaffAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every job card / customer / vehicle belongs to a dealer (workshop). Regular dealer staff
  // (ServiceAdvisor, WorkshopManager, DealerAdmin, ...) already have this on their own profile
  // (see Users.DealerId), so it's implicit for them. Head-office accounts (CorporateAdmin,
  // SystemAdmin) aren't tied to a single dealer, so profile.dealerId is null for them - without
  // this picker they'd silently send dealerId: null and the API would reject it with a 400
  // (System.Guid isn't nullable), because /api/customers, /api/customers/vehicles and
  // /api/jobcards all require a real dealer id.
  const [dealers, setDealers] = useState<Dealer[]>([])
  const [selectedDealerId, setSelectedDealerId] = useState('')
  const needsDealerPicker = !profile?.dealerId
  const effectiveDealerId = profile?.dealerId || selectedDealerId

  useEffect(() => {
    if (!needsDealerPicker) return
    staffApi.get<Dealer[]>('/api/dealers').then(({ data }) => setDealers(data)).catch(() => setDealers([]))
  }, [needsDealerPicker])

  // Step 1: customer
  const [searchQ, setSearchQ] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [newCustomer, setNewCustomer] = useState({ name: '', mobile: '', email: '', city: '', address: '' })

  // Step 2: vehicle
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [newVehicle, setNewVehicle] = useState({ model: '', variant: '', color: '', regNo: '', vin: '', odometer: 0 })
  // Model -> Variant is a dependent dropdown (see data/vehicleCatalog.ts): picking a model
  // narrows the Variant list down to just that model's variants, and changing the model clears
  // whatever variant was previously selected so an invalid model/variant pairing can't be sent.
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const availableVariants = variantsForModel(selectedModelId)

  // Step 3: service details
  const [serviceType, setServiceType] = useState<ServiceType>('PaidService')
  const [source, setSource] = useState<JobCardSource>('WalkIn')
  const [priority, setPriority] = useState<JobCardPriority>('Normal')
  const [odometerAtCheckIn, setOdometerAtCheckIn] = useState(0)
  const [batteryLevel, setBatteryLevel] = useState<number | ''>('')
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState('')
  const [consentNotes, setConsentNotes] = useState('')
  const [complaints, setComplaints] = useState<string[]>([''])

  const searchCustomers = async () => {
    if (searchQ.length < 3) return
    const { data } = await staffApi.get<Customer[]>('/api/customers/search', { params: { q: searchQ } })
    setResults(data)
  }

  const createCustomer = async () => {
    if (!effectiveDealerId) { setError('Select a dealer/workshop before adding a customer.'); return }
    setError(null)
    const { data } = await staffApi.post<Customer>('/api/customers', { ...newCustomer, dealerId: effectiveDealerId })
    setCustomer({ ...data, vehicles: [] })
    setStep(1)
  }

  const createVehicle = async () => {
    if (!customer) return
    if (!effectiveDealerId) { setError('Select a dealer/workshop before adding a vehicle.'); return }
    setError(null)
    const { data } = await staffApi.post<Vehicle>('/api/customers/vehicles', {
      ...newVehicle,
      customerId: customer.id,
      dealerId: effectiveDealerId,
      purchaseDate: null,
    })
    setVehicle(data)
    setOdometerAtCheckIn(data.odometer)
    setStep(2)
  }

  const submit = async () => {
    if (!customer || !vehicle) return
    if (!effectiveDealerId) { setError('Select a dealer/workshop before creating the job card.'); return }
    setSubmitting(true)
    setError(null)
    try {
      const { data } = await staffApi.post('/api/jobcards', {
        dealerId: effectiveDealerId,
        customerId: customer.id,
        vehicleId: vehicle.id,
        serviceType,
        source,
        priority,
        odometerAtCheckIn,
        batteryLevelAtCheckIn: batteryLevel === '' ? null : batteryLevel,
        expectedDeliveryAt: expectedDeliveryAt || null,
        serviceAdvisorId: profile?.id,
        customerConsentNotes: consentNotes || null,
        complaints: complaints.filter((c) => c.trim()).map((description) => ({ description, isCustomerVoice: true })),
      })
      navigate(`/jobcards/${data.id}`)
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create job card.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h2>New Job Card</h2>
      <div className="stepper">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`}>{i + 1}. {s}</div>
        ))}
      </div>

      {step === 0 && (
        <div className="card">
          {needsDealerPicker && (
            <div className="field" style={{ marginBottom: 16 }}>
              <label>Dealer / Workshop</label>
              <select value={selectedDealerId} onChange={(e) => setSelectedDealerId(e.target.value)}>
                <option value="">Select the dealer/workshop this job card is for…</option>
                {dealers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                ))}
              </select>
              <p className="muted" style={{ marginTop: 4 }}>
                Your account isn't tied to a single dealer, so pick which workshop this job card belongs to.
              </p>
            </div>
          )}
          <h3>Find or add customer</h3>
          <div className="field">
            <label>Search by mobile number or name</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="98765xxxxx" />
              <button className="btn" onClick={searchCustomers}>Search</button>
            </div>
          </div>
          {results.length > 0 && (
            <table>
              <thead><tr><th>Name</th><th>Mobile</th><th>City</th><th></th></tr></thead>
              <tbody>
                {results.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td><td>{c.mobile}</td><td>{c.city}</td>
                    <td><button className="btn btn-sm btn-primary" onClick={() => { setCustomer(c); setStep(1) }}>Select</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: 24 }}>Or register a new customer</h3>
          <div className="form-row">
            <div className="field"><label>Name</label><input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} /></div>
            <div className="field"><label>Mobile</label><input value={newCustomer.mobile} onChange={(e) => setNewCustomer({ ...newCustomer, mobile: e.target.value })} /></div>
            <div className="field"><label>Email</label><input value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} /></div>
            <div className="field"><label>City</label><input value={newCustomer.city} onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })} /></div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" disabled={!newCustomer.name || !newCustomer.mobile || !effectiveDealerId} onClick={createCustomer}>Create & Continue</button>
        </div>
      )}

      {step === 1 && customer && (
        <div className="card">
          <h3>Vehicle for {customer.name}</h3>
          {customer.vehicles && customer.vehicles.length > 0 && (
            <table>
              <thead><tr><th>Model</th><th>Reg No</th><th>Odometer</th><th></th></tr></thead>
              <tbody>
                {customer.vehicles.map((v) => (
                  <tr key={v.id}>
                    <td>{v.model} {v.variant}</td><td>{v.regNo}</td><td>{v.odometer} km</td>
                    <td><button className="btn btn-sm btn-primary" onClick={() => { setVehicle(v); setOdometerAtCheckIn(v.odometer); setStep(2) }}>Select</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 style={{ marginTop: 24 }}>Or add a new vehicle</h3>
          <div className="form-row">
            <div className="field">
              <label>Model</label>
              <select
                value={selectedModelId ?? ''}
                onChange={(e) => {
                  const modelId = e.target.value ? Number(e.target.value) : null
                  const modelName = VEHICLE_MODELS.find((m) => m.id === modelId)?.name ?? ''
                  setSelectedModelId(modelId)
                  setNewVehicle({ ...newVehicle, model: modelName, variant: '' })
                }}
              >
                <option value="">Select model…</option>
                {VEHICLE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Variant</label>
              <select
                value={newVehicle.variant}
                disabled={!selectedModelId}
                onChange={(e) => setNewVehicle({ ...newVehicle, variant: e.target.value })}
              >
                <option value="">{selectedModelId ? 'Select variant…' : 'Select a model first'}</option>
                {availableVariants.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Reg No</label><input value={newVehicle.regNo} onChange={(e) => setNewVehicle({ ...newVehicle, regNo: e.target.value })} /></div>
            <div className="field"><label>VIN</label><input value={newVehicle.vin} onChange={(e) => setNewVehicle({ ...newVehicle, vin: e.target.value })} /></div>
            <div className="field"><label>Odometer (km)</label><input type="number" value={newVehicle.odometer} onChange={(e) => setNewVehicle({ ...newVehicle, odometer: Number(e.target.value) })} /></div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" disabled={!newVehicle.model || !effectiveDealerId} onClick={createVehicle}>Create & Continue</button>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h3>Service details</h3>
          <div className="form-row">
            <div className="field">
              <label>Service Type</label>
              <select value={serviceType} onChange={(e) => setServiceType(e.target.value as ServiceType)}>
                {(['FreeService', 'PaidService', 'Warranty', 'AccidentRepair', 'Breakdown', 'Pdi', 'GoodwillService'] as ServiceType[]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Source</label>
              <select value={source} onChange={(e) => setSource(e.target.value as JobCardSource)}>
                {(['WalkIn', 'PickupAndDrop', 'Breakdown', 'Scheduled', 'Online'] as JobCardSource[]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as JobCardPriority)}>
                {(['Normal', 'High', 'Urgent'] as JobCardPriority[]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field"><label>Odometer at check-in (km)</label><input type="number" value={odometerAtCheckIn} onChange={(e) => setOdometerAtCheckIn(Number(e.target.value))} /></div>
            <div className="field"><label>Battery level at check-in (%)</label><input type="number" min={0} max={100} value={batteryLevel} onChange={(e) => setBatteryLevel(e.target.value === '' ? '' : Number(e.target.value))} /></div>
            <div className="field"><label>Expected delivery</label><input type="datetime-local" value={expectedDeliveryAt} onChange={(e) => setExpectedDeliveryAt(e.target.value)} /></div>
          </div>

          <div className="field">
            <label>Customer complaints / concerns</label>
            {complaints.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={c} onChange={(e) => setComplaints(complaints.map((x, idx) => (idx === i ? e.target.value : x)))} placeholder="e.g. Unusual noise from rear motor" />
                <button className="btn btn-sm" onClick={() => setComplaints(complaints.filter((_, idx) => idx !== i))}>Remove</button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => setComplaints([...complaints, ''])}>+ Add complaint</button>
          </div>

          <div className="field">
            <label>Customer consent notes</label>
            <textarea rows={3} value={consentNotes} onChange={(e) => setConsentNotes(e.target.value)} />
          </div>

          <button className="btn btn-primary" onClick={() => setStep(3)}>Continue to Review</button>
        </div>
      )}

      {step === 3 && customer && vehicle && (
        <div className="card">
          <h3>Review</h3>
          <p><strong>Customer:</strong> {customer.name} ({customer.mobile})</p>
          <p><strong>Vehicle:</strong> {vehicle.model} {vehicle.variant} - {vehicle.regNo}</p>
          <p><strong>Service:</strong> {serviceType} via {source}, priority {priority}</p>
          <p><strong>Complaints:</strong> {complaints.filter((c) => c.trim()).join('; ') || 'None recorded'}</p>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" disabled={submitting} onClick={submit}>
            {submitting ? 'Creating...' : 'Create Job Card'}
          </button>
        </div>
      )}
    </div>
  )
}