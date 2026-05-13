// JS bridge to the on-device LLM plugin (native/GemmiTutorPlugin.kt).
// No-ops on web. When set up natively, exposes window.GemmiTutor with:
//
//   deviceCaps()                       → { totalRamMb, recommendedVariant }
//   modelState()                       → { state: 'missing' | 'ready', sizeBytes? }
//   downloadModel({ url, sha256, sizeBytes, onProgress }) → resolves on done
//   getDownloadState()                 → sync read of latest download progress
//   onDownloadProgress(cb)             → subscribe to live progress
//   generate({ prompt, onDelta })      → streams deltas, resolves with full text
//   cancel()                           → aborts current generate()
//
// We keep a long-lived listener on `model_download_progress` so progress is
// captured even when the ModelSetup page is unmounted (user navigates away,
// comes back). Pages re-mount and read getDownloadState() to seed their UI
// — no more "Download Model" reset to zero when you tab away mid-download.

let setup = false

export async function setupNativeTutor() {
  if (setup) return
  setup = true

  let Capacitor, registerPlugin
  try {
    const mod = await import('@capacitor/core')
    Capacitor = mod.Capacitor
    registerPlugin = mod.registerPlugin
  } catch { return }
  if (!Capacitor.isNativePlatform()) return

  const Plugin = registerPlugin('GemmiTutor')

  // Latest progress event from the plugin, plus a set of subscriber
  // callbacks that React components register on mount. The progress
  // listener is registered ONCE for the lifetime of the WebView so a
  // mid-download navigate-away doesn't lose events.
  let lastProgress = null   // { downloaded, total } | null
  let lastPhase = null      // 'downloading' | 'done' | 'error' | null
  let lastError = null
  const subscribers = new Set()
  const emit = () => {
    for (const fn of subscribers) {
      try { fn({ progress: lastProgress, phase: lastPhase, error: lastError }) } catch { /* ignore */ }
    }
  }
  Plugin.addListener('model_download_progress', (e) => {
    if (e && typeof e.downloaded === 'number' && typeof e.total === 'number') {
      lastProgress = { downloaded: e.downloaded, total: e.total }
      lastPhase = 'downloading'
      lastError = null
      emit()
    }
  }).catch(() => {})

  window.GemmiTutor = {
    async deviceCaps() {
      try { return await Plugin.deviceCaps() }
      catch (e) { return { totalRamMb: 0, recommendedVariant: 'none', error: e?.message } }
    },

    async modelState() {
      try { return await Plugin.modelState() }
      catch (e) { return { state: 'unavailable', error: e?.message } }
    },

    /** Synchronous read of the latest download progress. */
    getDownloadState() {
      return { progress: lastProgress, phase: lastPhase, error: lastError }
    },

    /** Subscribe to progress + phase changes. Returns an unsubscribe fn. */
    onDownloadProgress(cb) {
      subscribers.add(cb)
      // Push current state immediately so the caller doesn't have to wait
      // for the next progress event to populate its UI.
      try { cb({ progress: lastProgress, phase: lastPhase, error: lastError }) } catch {}
      return () => subscribers.delete(cb)
    },

    async downloadModel({ url, sha256, sizeBytes } = {}) {
      lastPhase = 'downloading'
      lastError = null
      emit()
      try {
        const out = await Plugin.downloadModel({ url, sha256, sizeBytes })
        lastPhase = 'done'
        emit()
        return out
      } catch (e) {
        lastPhase = 'error'
        lastError = e?.message || 'download_failed'
        emit()
        throw e
      }
    },

    async generate({ prompt, onDelta } = {}) {
      const listener = await Plugin.addListener('generate_delta', (e) => {
        if (onDelta && e?.text) onDelta(e.text)
      })
      try {
        const out = await Plugin.generate({ prompt })
        return out?.text || ''
      } finally {
        listener.remove()
      }
    },

    async cancel() {
      return Plugin.cancel()
    },
  }
}
