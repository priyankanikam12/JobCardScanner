// web\src\lib\careDeskApi.ts
// 2026-10-21: talks to Care Desk's own API (<VITE_CARE_DESK_URL>/api/integration/jobcard/*) straight from the browser: a vehicle's Care Desk tickets (live) and raising a ticket for it.
// WHO is calling is a 10-minute token the JobCard API mints for the signed-in person (POST /api/care-desk-api/token, any staff role); Care Desk checks it and only answers the web addresses it has
// in JCS_WEB_ORIGINS. The token is kept in memory only (never in the browser's storage) and renewed when it is about to end or Care Desk says 401.
import { staffApi } from '../api/client'
import { CARE_DESK_URL } from './careDesk'

export class CareDeskApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export interface CareDeskHub { id: string; name: string; address: string | null; cityId: number; city: string; contactName: string | null; contactMobile: string | null; lat: number | null; lng: number | null }
export interface CareDeskRaiseSetup { parts: string[]; hubs: CareDeskHub[]; window: { start: string; end: string }; tat: { off_road: { response: number; e1: number } }; pendingRating: { ticketNo: string; summary: string } | null }
export interface CareDeskVehicle { id: string; vin: string; regNo: string | null; model: string; city: string; customer: string; saleDate: string; warrantyTill: string | null }
export interface CareDeskVehicleContext {
  vehicle: { id: string; cityId: number; hubId: string | null }
  running: { ticketNo: string; category: string } | null
  closed: { id: string; ticketNo: string; category: string; parts: string | null; closedOn: string | null }[]
}
export type CareDeskVehicleReply =
  | { registered: false }
  | { registered: true; vehicle: CareDeskVehicle; raise: { allowed: true; context: CareDeskVehicleContext; setup: CareDeskRaiseSetup } | { allowed: false; reason: string } }
export interface CareDeskTicket {
  ticketNo: string; category: string; status: string; level: string | null; createdAt: string; levelDueAt: string | null; closedAt: string | null
  isRepeat: boolean; description: string | null; open: boolean; owner: string | null
}

let cached: { token: string; expiresAt: number } | null = null

async function tokenFor(force: boolean): Promise<string> {
  if (!force && cached && cached.expiresAt - Date.now() > 30_000) return cached.token
  try {
    const { data } = await staffApi.post<{ token: string; expiresInSeconds: number }>('/api/care-desk-api/token')
    cached = { token: data.token, expiresAt: Date.now() + data.expiresInSeconds * 1000 }
    return data.token
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { message?: string } } }
    throw new CareDeskApiError(e.response?.status ?? 0, e.response?.data?.message ?? 'Could not get permission to talk to Care Desk. Sign in again and retry.')
  }
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!CARE_DESK_URL) throw new CareDeskApiError(0, 'Care Desk is not set up on this site (VITE_CARE_DESK_URL).')
  const token = await tokenFor(!retry)
  let res: Response
  try {
    res = await fetch(`${CARE_DESK_URL}/api/integration/jobcard/${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } })
  } catch {
    throw new CareDeskApiError(0, 'Cannot reach Care Desk. Check that it is running and that this web address is in its JCS_WEB_ORIGINS list.')
  }
  if (res.status === 401 && retry) { cached = null; return call<T>(path, init, false) }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new CareDeskApiError(res.status, body?.error ?? `Care Desk answered HTTP ${res.status}.`)
  return body as T
}

/** Is this chassis / registration number in Care Desk, and what the raise form needs. */
export const careDeskVehicle = (value: string) => call<CareDeskVehicleReply>(`vehicle?value=${encodeURIComponent(value)}`)

/** The vehicle's Care Desk tickets, newest first. */
export const careDeskTickets = (value: string) => call<{ registered: boolean; tickets: CareDeskTicket[] }>(`tickets?value=${encodeURIComponent(value)}`)

/** Raises a ticket (the same body as Care Desk's own form): `data` as JSON plus the files by box (vehicle_front_photo, issue_media, ...). */
export function careDeskRaise(data: Record<string, unknown>, files: [string, File][]): Promise<{ ok: true; ticketNo: string }> {
  const form = new FormData()
  form.set('data', JSON.stringify(data))
  for (const [slot, file] of files) form.append(slot, file)
  return call<{ ok: true; ticketNo: string }>('raise', { method: 'POST', body: form })
}
