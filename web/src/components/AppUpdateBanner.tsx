// web\src\components\AppUpdateBanner.tsx  (NEW file)
// 2026-11-04 ("after deploy hard reload web application and clear previous cache"): after a new deploy, every open browser tab notices
// the new build by itself and offers a one-click reload that clears the old cached files first - nobody has to press Ctrl+F5.
//
// How it knows: GET /api/app-version (see Program.cs snippet) returns the build stamp of the site's index.html. The first value after the page loads is
// remembered; the check repeats every 5 minutes and every time the tab becomes visible again. A different value = a new build was deployed.
// It shows a banner instead of reloading by force, so a half-filled Job Card wizard / Repair Bill is never wiped without the user's say-so.
// Set AUTO_RELOAD_WHEN_IDLE to true if you prefer an automatic reload when the user has been inactive for 2 minutes.
import { useEffect, useRef, useState } from 'react'

const CHECK_EVERY_MS = 5 * 60 * 1000
const AUTO_RELOAD_WHEN_IDLE = false
const IDLE_MS = 2 * 60 * 1000

async function clearCachesAndReload() {
  try {
    // Cache Storage (service workers / PWA caches) - harmless when the app does not use any.
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    // never block the reload
  }
  // index.html is served with Cache-Control: no-cache, so a normal reload now fetches the new index.html and its new hashed files.
  window.location.reload()
}

export function AppUpdateBanner() {
  const known = useRef<string | null>(null)
  const lastActivity = useRef<number>(Date.now())
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/app-version', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { version?: string }
        if (cancelled || !data.version) return
        if (known.current === null) { known.current = data.version; return }
        if (data.version !== known.current) setUpdateAvailable(true)
      } catch {
        // offline / server restarting during the deploy: try again next time
      }
    }
    void check()
    const timer = window.setInterval(check, CHECK_EVERY_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    const onActivity = () => { lastActivity.current = Date.now() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [])

  useEffect(() => {
    if (!updateAvailable || !AUTO_RELOAD_WHEN_IDLE) return
    const t = window.setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_MS) void clearCachesAndReload()
    }, 15000)
    return () => window.clearInterval(t)
  }, [updateAvailable])

  if (!updateAvailable) return null
  return (
    <div
      role="alert"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12,
        padding: '8px 12px', background: '#0b2545', color: '#fff', fontSize: 14, boxShadow: '0 2px 8px rgba(0,0,0,.3)',
      }}
    >
      <span>A new version of the DMS is available. Save your work, then reload.</span>
      <button className="btn btn-sm btn-primary" onClick={() => { void clearCachesAndReload() }}>Reload now</button>
    </div>
  )
}