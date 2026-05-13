// JS bridge to the on-device LLM plugin (native/GemmiTutorPlugin.kt).
// No-ops on web. When set up natively, exposes window.GemmiTutor with:
//
//   deviceCaps()                       → { totalRamMb, recommendedVariant }
//   modelState()                       → { state: 'missing' | 'ready', sizeBytes? }
//   downloadModel({ url, sha256, sizeBytes, onProgress }) → resolves on done
//   generate({ prompt, onDelta })      → streams deltas, resolves with full text
//   cancel()                           → aborts current generate()
//
// tutorProviders.js's `nativeProvider` consumes window.GemmiTutor; if it's
// missing or its `available()` check fails, the cloud Gemini path runs.

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

  window.GemmiTutor = {
    async deviceCaps() {
      try { return await Plugin.deviceCaps() }
      catch (e) { return { totalRamMb: 0, recommendedVariant: 'none', error: e?.message } }
    },

    async modelState() {
      try { return await Plugin.modelState() }
      catch (e) { return { state: 'unavailable', error: e?.message } }
    },

    async downloadModel({ url, sha256, sizeBytes, onProgress } = {}) {
      const listener = await Plugin.addListener('model_download_progress', (e) => {
        if (onProgress) onProgress(e)
      })
      try {
        return await Plugin.downloadModel({ url, sha256, sizeBytes })
      } finally {
        listener.remove()
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
