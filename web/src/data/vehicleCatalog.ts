// BGauss vehicle model/variant master data for the Job Card Wizard's "add a new vehicle" step.
// Kept as a static, hardcoded catalog (not a backend table) because Vehicle.Model/Variant are
// plain strings on the backend (see CreateVehicleRequest) - this file only drives the dependent
// Model -> Variant dropdown in the UI; whatever the user picks is sent to the API exactly as it
// already was, so no backend/schema change was needed for this.

export interface VehicleModel {
  id: number
  name: string
}

export interface VehicleVariant {
  id: number
  name: string
  modelId: number
}

export const VEHICLE_MODELS: VehicleModel[] = [
  { id: 1, name: 'BG OoWah' },
  { id: 38, name: 'BG C 12' },
  { id: 39, name: 'BG RUV 350' },
  { id: 40, name: 'BG D 15' },
]

export const VEHICLE_VARIANTS: VehicleVariant[] = [
  { id: 2, name: 'B-TO-B (YULU) Spare parts', modelId: 1 },
  { id: 4, name: 'MAX', modelId: 1 },
  { id: 5, name: 'EX', modelId: 1 },
  { id: 14, name: 'EX PLUS', modelId: 1 },
  { id: 15, name: 'MAX PLUS', modelId: 1 },
  { id: 6, name: 'MAX 2.0', modelId: 38 },
  { id: 7, name: 'iEX', modelId: 38 },
  { id: 8, name: 'MAX 3.0', modelId: 38 },
  { id: 16, name: 'iEX GEN 2', modelId: 38 },
  { id: 17, name: 'iMAX 2.0 GEN 2', modelId: 38 },
  { id: 18, name: 'MAX 3.0 GEN 2', modelId: 38 },
  { id: 19, name: 'MAX R', modelId: 38 },
  { id: 9, name: 'iEX', modelId: 39 },
  { id: 10, name: 'MAX', modelId: 39 },
  { id: 11, name: 'D 15 i', modelId: 40 },
  { id: 13, name: 'D 15 PRO', modelId: 40 },
]

export function variantsForModel(modelId: number | null): VehicleVariant[] {
  if (modelId === null) return []
  return VEHICLE_VARIANTS.filter((v) => v.modelId === modelId)
}