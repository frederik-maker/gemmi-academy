// JS bridge to the on-device PiperTts plugin (native/PiperTtsPlugin.kt).
// On web, or before the plugin compiles into the APK, this no-ops and
// voice.js falls back to the Web Speech API.
//
// Surface (set on window.PiperTts when running natively):
//   voiceState(lang)               → { state: 'missing' | 'ready', sizeBytes? }
//   downloadVoice({ lang, onProgress }) → resolves when extracted + ready
//   speak({ text, lang })          → resolves when the utterance finishes
//   stop()                         → cancels the current utterance

let setup = false

export async function setupPiperTts() {
  if (setup) return
  setup = true

  let Capacitor, registerPlugin
  try {
    const mod = await import('@capacitor/core')
    Capacitor = mod.Capacitor
    registerPlugin = mod.registerPlugin
  } catch { return }
  if (!Capacitor.isNativePlatform()) return

  const Plugin = registerPlugin('PiperTts')

  window.PiperTts = {
    async voiceState(lang) {
      try { return await Plugin.voiceState({ lang }) }
      catch (e) { return { state: 'unavailable', error: e?.message } }
    },

    async downloadVoice({ lang, onProgress } = {}) {
      const listener = await Plugin.addListener('voice_download_progress', (e) => {
        if (e.lang === lang && onProgress) onProgress(e)
      })
      try {
        return await Plugin.downloadVoice({ lang })
      } finally {
        listener.remove()
      }
    },

    async speak({ text, lang }) {
      return Plugin.speak({ text, lang })
    },

    async stop() {
      return Plugin.stop()
    },
  }
}
