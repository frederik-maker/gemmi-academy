// Smoke-test for the Kotlin → JS bridge + native chrome (status bar)
// configuration. On the Capacitor APK this:
//   • Calls Hello.ping() and logs to console (proves Kotlin bridge alive).
//   • Tells the StatusBar plugin to overlay the WebView edge-to-edge AND
//     use DARK foreground icons. Capacitor's default leaves the WebView
//     padded below the status bar AND uses light icons — combined with
//     our white topbar that means the system clock/battery render
//     white-on-white = invisible. setOverlaysWebView(true) makes the
//     WebView extend behind the bar (so the page can draw under it) and
//     also makes Android's WindowInsets dispatch reach the WebView so
//     env(safe-area-inset-top) returns the real status bar height
//     instead of 0.
//
// All calls are wrapped in try/catch — on web everything no-ops cleanly.

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

  // Status bar: dark icons over a transparent bar, WebView edge-to-edge.
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setOverlaysWebView({ overlay: true })
    await StatusBar.setStyle({ style: Style.Light })          // Light = dark icons on light bg
    await StatusBar.setBackgroundColor({ color: '#00000000' }) // transparent
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[gemmi-native] status bar setup failed:', e?.message || e)
  }

  // Hello plugin smoke test — confirms Kotlin bridge is alive.
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
