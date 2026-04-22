// Helpers around the service worker: warm the pack cache for offline use,
// listen for online/offline transitions, and expose a hook for components.

import { useEffect, useState } from 'react'

export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export async function warmAllPacks() {
  if (!('serviceWorker' in navigator)) return { skipped: true }
  const reg = await navigator.serviceWorker.ready.catch(() => null)
  if (!reg?.active) {
    // SW not registered (dev mode) — fetch directly to populate browser cache.
    const manifest = await fetch('/packs/manifest.json').then((r) => r.json()).catch(() => null)
    if (!manifest?.packs) return { cached: 0, failed: 0, total: 0 }
    let cached = 0, failed = 0
    for (const p of manifest.packs) {
      try {
        const r = await fetch(p.path)
        if (r.ok) cached++; else failed++
      } catch {
        failed++
      }
    }
    return { cached, failed, total: manifest.packs.length }
  }

  const manifest = await fetch('/packs/manifest.json').then((r) => r.json())
  const urls = ['/packs/manifest.json', ...manifest.packs.map((p) => p.path)]
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = (e) => {
      if (e.data?.type === 'warm_cache_done') resolve(e.data)
    }
    reg.active.postMessage({ type: 'warm_cache', urls }, [channel.port2])
    // Safety timeout
    setTimeout(() => resolve({ cached: 0, failed: urls.length, total: urls.length, timeout: true }), 60_000)
  })
}
