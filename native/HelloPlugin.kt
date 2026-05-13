package co.bussler.gemmi

import android.Manifest
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Two responsibilities, despite the name:
 *
 *  1. `ping()` — smoke-test the Kotlin↔JS bridge end-to-end. Logged on
 *     boot so we can verify the plugin is alive in adb logcat.
 *
 *  2. `ensureMicPermission()` — prompt the user for the RECORD_AUDIO
 *     runtime permission and resolve the JS promise with the actual
 *     answer (granted: true|false). Putting RECORD_AUDIO in the
 *     AndroidManifest is necessary but not sufficient on Android 6+;
 *     getUserMedia() in the WebView fails with NotAllowedError until
 *     the user has tapped Allow. Capacitor's WebChromeClient doesn't
 *     surface that dialog for SpeechRecognition on its own.
 *
 *     We use Capacitor's @Permission + requestPermissionForAlias +
 *     @PermissionCallback framework so the call.resolve() actually
 *     fires AFTER the user has dismissed the OS dialog (rather than
 *     immediately, which would race with the user's tap).
 *
 *  Camera permission is handled by @capacitor/camera's own plugin.
 */
@CapacitorPlugin(
  name = "Hello",
  permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "mic")],
)
class HelloPlugin : Plugin() {

  @PluginMethod
  fun ping(call: PluginCall) {
    val ret = JSObject()
    ret.put("msg", "hello from kotlin")
    ret.put("buildSdk", android.os.Build.VERSION.SDK_INT)
    ret.put("device", android.os.Build.MODEL ?: "unknown")
    call.resolve(ret)
  }

  @PluginMethod
  fun ensureMicPermission(call: PluginCall) {
    if (getPermissionState("mic") == PermissionState.GRANTED) {
      call.resolve(JSObject().put("granted", true))
      return
    }
    requestPermissionForAlias("mic", call, "micPermsCallback")
  }

  @PermissionCallback
  fun micPermsCallback(call: PluginCall) {
    val granted = getPermissionState("mic") == PermissionState.GRANTED
    call.resolve(JSObject().put("granted", granted))
  }
}
