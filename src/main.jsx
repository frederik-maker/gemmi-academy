import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import 'katex/dist/katex.min.css'
import { setupNativeTutor } from './lib/nativeTutor.js'

// Best-effort: when running inside the Capacitor APK shell, wire up the
// on-device Gemma plugin. No-ops on web. Failure is silently swallowed —
// the cloud provider remains the fallback.
setupNativeTutor().catch(() => {})

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

// Register the service worker in production builds only so dev-time edits
// don't get sticky-cached. In the Capacitor APK this still runs because the
// bundle is produced with `vite build`.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        reg.update().catch(() => {})
        // When a new SW takes over mid-session, force a reload so the user
        // never sees half-old / half-new bundles.
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
