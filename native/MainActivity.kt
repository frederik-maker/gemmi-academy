package co.bussler.gemmi

import android.graphics.Color
import android.os.Bundle
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.BridgeActivity

/**
 * Replaces the Java MainActivity that `cap add android` generates.
 *
 * Two responsibilities:
 *
 *  1. Register every Kotlin Capacitor plugin we ship. This MUST happen
 *     before super.onCreate(), per Capacitor docs.
 *
 *  2. Force the WebView into edge-to-edge mode AFTER super.onCreate has
 *     run, so the WebView's CSS env(safe-area-inset-*) returns the real
 *     status-bar / gesture-pill heights. Done after super because
 *     BridgeActivity's onCreate sets its own window flags; doing this
 *     before would get clobbered. Also explicitly:
 *       • set status bar transparent so the page background shows through
 *       • set the appearance flag for DARK icons on a LIGHT bar — the
 *         alternative was white icons on the app's white topbar = system
 *         clock + battery invisible, per user complaint
 *
 *  styles.xml gets these via theme attrs too, but BridgeActivity sometimes
 *  re-applies its own theme during init, blowing those away. The
 *  WindowInsetsControllerCompat call is the authoritative path on
 *  Android 11+.
 */
class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(HelloPlugin::class.java)
    registerPlugin(PiperTtsPlugin::class.java)
    registerPlugin(GemmiTutorPlugin::class.java)
    super.onCreate(savedInstanceState)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    WindowInsetsControllerCompat(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }
  }
}
