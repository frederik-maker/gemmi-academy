// Smoke-test for the Kotlin → JS bridge. On the Capacitor APK this calls
// the Hello plugin (defined in native/HelloPlugin.kt) and logs the result
// to the WebView console so we can see in `adb logcat -s chromium:I` that
// the native side compiled, linked, and is reachable.
//
// Returns the response object if the round trip works, or `null` on web
// or any failure. Used by main.jsx solely to print a console line — when
// we add the real Piper TTS + LiteRT plugins, they'll piggy-back on the
// same registerPlugin pattern proved out here.

export async function bootSmokeTest() {
  let Capacitor, registerPlugin
  try {
    const mod = await import('@capacitor/core')
    Capacitor = mod.Capacitor
    registerPlugin = mod.registerPlugin
  } catch {
    return null
  }
  if (!Capacitor.isNativePlatform()) return null
  try {
    const Hello = registerPlugin('Hello')
    const out = await Hello.ping()
    // eslint-disable-next-line no-console
    console.log('[gemmi-native]', out)
    return out
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[gemmi-native] bridge unreachable:', e?.message || e)
    return null
  }
}
