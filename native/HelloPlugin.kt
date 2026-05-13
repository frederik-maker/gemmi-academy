package co.bussler.gemmi

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Smoke-test plugin: proves the Kotlin → JS bridge compiles, links, and is
 * reachable from the WebView before we put real (heavy) sherpa-onnx and
 * MediaPipe code behind the same wiring.
 *
 * From JS:
 *   import { registerPlugin } from '@capacitor/core'
 *   const Hello = registerPlugin('Hello')
 *   const { msg } = await Hello.ping()       // → "hello from kotlin"
 */
@CapacitorPlugin(name = "Hello")
class HelloPlugin : Plugin() {

  @PluginMethod
  fun ping(call: PluginCall) {
    val ret = JSObject()
    ret.put("msg", "hello from kotlin")
    ret.put("buildSdk", android.os.Build.VERSION.SDK_INT)
    ret.put("device", android.os.Build.MODEL ?: "unknown")
    call.resolve(ret)
  }
}
