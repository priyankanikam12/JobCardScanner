// mobile\src\utils\ocrEngine.ts
// 2026-11-13: the ONLY file that talks to the native OCR library. Everything else (ChassisScanButton, vehicleIdOcr) works
// with the plain result type below, so the engine can be replaced by changing this one file (see fallback\ for the ready
// alternative) without touching the screen or the reading logic.
//
// Engine in use: Google ML Kit text recognition through @react-native-ml-kit/text-recognition (the Latin model is bundled
// in the app, so reading a photo works with no internet). The library is loaded only when a photo is read, so a build
// without the native module shows a clear message instead of failing at app start.
import type { OcrLike } from './vehicleIdOcr'

export async function recognizeImage(uri: string): Promise<OcrLike> {
  const mod = await import('@react-native-ml-kit/text-recognition')
  return mod.default.recognize(uri)
}