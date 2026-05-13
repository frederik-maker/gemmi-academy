package co.bussler.gemmi

import androidx.core.view.WindowCompat
import com.getcapacitor.BridgeActivity

/**
 * Replaces the Java MainActivity that `cap add android` generates.
 *
 * Two reasons for the override:
 *  • Register each Kotlin Capacitor plugin we ship.
 *  • Disable "decor fits system windows" so the WebView extends edge-to-edge.
 *    Without this, Android reserves space for the status bar above the
 *    WebView and env(safe-area-inset-top) always reports 0 — which is why
 *    the LessonPlayer's X + progress bar were drawing right under the
 *    status clock. With the decorFits flag off, the WebView occupies the
 *    whole window and CSS env() returns the real status-bar height.
 */
class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    registerPlugin(HelloPlugin::class.java)
    registerPlugin(PiperTtsPlugin::class.java)
    registerPlugin(GemmiTutorPlugin::class.java)
    super.onCreate(savedInstanceState)
  }
}
