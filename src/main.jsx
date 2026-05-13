import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
// Self-hosted Nunito — previously loaded from fonts.googleapis.com which
// blocked render whenever the WebView sat on "WiFi connected, no internet"
// (DNS hangs 30s before failing). Bundling the woff2 inside the APK means
// the app paints regardless of network state. Latin + Cyrillic subsets so
// kk-cyrillic and ru-cyrillic both look right.
import '@fontsource/nunito/400.css'
import '@fontsource/nunito/600.css'
import '@fontsource/nunito/700.css'
import '@fontsource/nunito/800.css'
import '@fontsource/nunito/900.css'
import '@fontsource/nunito/cyrillic-400.css'
import '@fontsource/nunito/cyrillic-700.css'
import '@fontsource/nunito/cyrillic-800.css'
import 'katex/dist/katex.min.css'
import { bootSmokeTest } from './lib/nativeBoot.js'
import { setupPiperTts } from './lib/piperTts.js'
import { setupNativeTutor } from './lib/nativeTutor.js'

// On the Capacitor APK: ping the Kotlin Hello plugin once and log the
// round-trip result. No-op on web. Proves the native bridge is alive
// before any real (heavy) on-device plugin tries to use the same wiring.
bootSmokeTest()
// Register window.PiperTts and window.GemmiTutor on native so the rest of
// the app can route to the on-device sherpa-onnx and LiteRT backends when
// they're set up. Both are no-ops on web; both fail soft on native so the
// cloud + Web-Speech paths remain authoritative.
setupPiperTts().catch(() => {})
setupNativeTutor().catch(() => {})

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

// Service worker handling.
//
// On the Capacitor APK we explicitly DON'T register a service worker.
// Reason: the WebView's "origin" is https://localhost and storage persists
// across app updates. A SW registered by an older APK keeps serving its
// cached /assets/* bundles to every future install of the app, so users
// see code from two builds ago even though the new APK shipped fine
// (this is exactly the symptom that had the user reporting "progress
// bar still juts in" and "no speak button" after three rebuilds — they
// were literally running the prior APK's bundled JS).
//
// On every entry to the app, we also actively unregister any pre-existing
// SW and nuke all caches when running natively. That cleans up the SW
// installed by past APK versions on the same device.
const isNative = (() => {
  try { return !!window.Capacitor?.isNativePlatform?.() } catch { return false }
})()
if ('serviceWorker' in navigator && isNative) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .catch(() => {})
  if (typeof caches !== 'undefined') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {})
  }
} else if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        reg.update().catch(() => {})
        let refreshing = false
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return
          refreshing = true
          window.location.reload()
        })
      })
      .catch(() => {})
  })
}
