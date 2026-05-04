// Capacitor native-tutor bridge. Imported once from main.jsx; on a real
// Android device it registers the GemmiTutor plugin and sets
// `window.GemmiTutor` to an object matching the contract that
// `src/lib/tutorProviders.js#nativeProvider` checks for.
//
// On the web (or before the Capacitor plugin is built/installed), this is
// a no-op — `nativeProvider.available()` returns false and the chat falls
// back to the Claude cloud provider.

let registered = false

export async function setupNativeTutor() {
  if (registered) return
  registered = true

  // Capacitor lives in @capacitor/core. We *dynamically* import to avoid
  // pulling it into the bundle when it isn't installed (which is the case
  // during pure web preview, before npm run android:init).
  let Capacitor, registerPlugin
  try {
    const mod = await import('@capacitor/core')
    Capacitor = mod.Capacitor
    registerPlugin = mod.registerPlugin
  } catch {
    return // Capacitor not installed — fine, we just stay in cloud mode.
  }
  if (!Capacitor.isNativePlatform()) return

  const Plugin = registerPlugin('GemmiTutor')

  // Cache device caps + warm-up state.
  let caps = null
  let initPromise = null

  async function ensureInitialised() {
    if (initPromise) return initPromise
    initPromise = (async () => {
      caps = await Plugin.deviceCaps()
      if (caps.recommendedVariant === 'none') {
        throw new Error('device_unsupported')
      }
      await Plugin.ensureModel({ variant: caps.recommendedVariant })
      return await Plugin.init({ variant: caps.recommendedVariant })
    })()
    return initPromise
  }

  window.GemmiTutor = {
    ready: ensureInitialised(),

    async deviceCaps() {
      return caps ?? (caps = await Plugin.deviceCaps())
    },

    async download({ onProgress, variant } = {}) {
      const listener = await Plugin.addListener('download_progress', (e) => {
        if (onProgress) onProgress(e)
      })
      try {
        const c = await Plugin.deviceCaps()
        return await Plugin.ensureModel({ variant: variant || c.recommendedVariant })
      } finally {
        listener.remove()
      }
    },

    async generate({ system, messages, tools, signal, onDelta, onToolUse }) {
      await ensureInitialised()
      const deltaListener = await Plugin.addListener('delta', ({ text }) => {
        if (onDelta) onDelta(text)
      })
      const toolListener = await Plugin.addListener('tool_use', async ({ id, name, input }) => {
        try {
          const result = await onToolUse({ name, input })
          await Plugin.respondToolUse({ id, result })
        } catch (e) {
          await Plugin.respondToolUse({ id, result: { error: e?.message || 'tool_failed' } })
        }
      })
      if (signal) {
        signal.addEventListener('abort', () => { Plugin.cancel().catch(() => {}) }, { once: true })
      }
      try {
        return await Plugin.generate({ system, messages, tools })
      } finally {
        deltaListener.remove()
        toolListener.remove()
      }
    },
  }
}
