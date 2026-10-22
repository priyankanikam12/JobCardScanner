// mobile\src\lib\careDeskApi.ts
// 2026-10-22 (Android counterpart of web/src/lib/careDeskApi.ts): talks to Care Desk's own API (<EXPO_PUBLIC_CARE_DESK_URL>/api/integration/jobcard/*) straight from the app: a vehicle's Care Desk
// tickets (live) and raising a ticket for it. WHO is calling is a 10-minute token the JobCard API mints for the signed-in person (POST /api/care-desk-api/token, any staff role); Care Desk checks it.
// The token is kept in memory only and renewed when it is about to end or Care Desk says 401. A phone app sends no browser Origin, so Care Desk's JCS_WEB_ORIGINS list (a browser rule) does not apply.
import { apiClient } from '../api/client'
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

/** A photo / video picked on the phone (expo-image-picker) - the shape React Native's FormData uploads as a file. */
export interface UploadFile { uri: string; name: string; type: string }

let cached: { token: string; expiresAt: number } | null = null

async function tokenFor(force: boolean): Promise<string> {
  if (!force && cached && cached.expiresAt - Date.now() > 30_000) return cached.token
  try {
    const { data } = await apiClient.post<{ token: string; expiresInSeconds: number }>('/api/care-desk-api/token')
    cached = { token: data.token, expiresAt: Date.now() + data.expiresInSeconds * 1000 }
    return data.token
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { message?: string } } }
    throw new CareDeskApiError(e.response?.status ?? 0, e.response?.data?.message ?? 'Could not get permission to talk to Care Desk. Sign in again and retry.')
  }
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!CARE_DESK_URL) throw new CareDeskApiError(0, 'Care Desk is not set up in this app (EXPO_PUBLIC_CARE_DESK_URL).')
  const token = await tokenFor(!retry)
  let res: Response
  try {
    res = await fetch(`${CARE_DESK_URL}/api/integration/jobcard/${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } })
  } catch {
    throw new CareDeskApiError(0, 'Cannot reach Care Desk. Check your connection and that Care Desk is running.')
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
export function careDeskRaise(data: Record<string, unknown>, files: [string, UploadFile][]): Promise<{ ok: true; ticketNo: string }> {
  const form = new FormData()
  form.append('data', JSON.stringify(data))
  // React Native uploads { uri, name, type } as a file part
  for (const [slot, file] of files) form.append(slot, file as unknown as Blob)
  return call<{ ok: true; ticketNo: string }>('raise', { method: 'POST', body: form })
}
