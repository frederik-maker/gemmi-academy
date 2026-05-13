package co.bussler.gemmi

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Two methods:
 *
 *   ping()                — smoke-test that the Kotlin↔JS bridge is alive.
 *   ensureMicPermission() — synchronously surface the RECORD_AUDIO runtime
 *                           permission state, requesting it (with OS
 *                           dialog) if not yet granted. Resolves with the
 *                           actual ContextCompat.checkSelfPermission
 *                           result AFTER the dialog dismisses.
 *
 * Why check via ContextCompat rather than Capacitor's getPermissionState():
 * in Capacitor 8 we saw the permission-callback fire with the cached
 * state still set to DENIED even after the user tapped Allow. Going
 * through PackageManager.PERMISSION_GRANTED directly is the source of
 * truth and matches whatever the OS actually decided.
 */
@CapacitorPlugin(
  name = "Hello",
  permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "mic")],
)
class HelloPlugin : Plugin() {

  private fun micGranted(): Boolean {
    return ContextCompat.checkSelfPermission(
      context, Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED
  }

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
    if (micGranted()) {
      call.resolve(JSObject().put("granted", true))
      return
    }
    // requestPermissionForAlias saves the call by alias and replays it
    // into micPermsCallback once the OS dialog dismisses with a result.
    // The user sees the system "Allow Gemmi Academy to record audio?"
    // dialog. Their tap on Allow / Deny triggers the callback below.
    requestPermissionForAlias("mic", call, "micPermsCallback")
  }

  @PermissionCallback
  fun micPermsCallback(call: PluginCall) {
    val granted = micGranted()
    val ret = JSObject().put("granted", granted)
    if (!granted) {
      // Surface the Capacitor-side cached state too for debugging, in
      // case it diverges from ContextCompat's view (it shouldn't).
      ret.put("capacitorState", getPermissionState("mic").toString())
    }
    call.resolve(ret)
  }
}
