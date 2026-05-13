package co.bussler.gemmi

import android.app.ActivityManager
import android.content.Context
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Capacitor plugin that exposes the on-device Gemma 4 tutor to the WebView.
 *
 * JS-side contract (set on `window.GemmiTutor` by src/lib/nativeTutor.js):
 *
 *   ready: Promise<{ model: string, version: string }>
 *   generate({ system, messages, tools, signal, onDelta, onToolUse }) → Promise
 *   ensureModel({ variant }) → Promise<{ status, progress? }>
 *   deviceCaps() → Promise<{ totalRamMb, availRamMb, recommendedVariant }>
 *
 * Each capacitor method here either resolves the call synchronously or fires
 * `notifyListeners(event, payload)` for streaming-style data (deltas, progress,
 * tool_use requests).
 */
@CapacitorPlugin(name = "GemmiTutor")
class GemmiTutorPlugin : Plugin() {

  private val scope = CoroutineScope(Dispatchers.Default)
  private val toolBridge = ToolBridge()
  private var runtime: GemmaRuntime? = null
  private var modelConfig: JSONObject? = null
  private var currentJob: Job? = null

  override fun load() {
    // Read native/model.config.json embedded into assets at build time by the
    // install script (copied into android/app/src/main/assets/).
    val raw = context.assets.open("model.config.json").bufferedReader().use { it.readText() }
    modelConfig = JSONObject(raw)
  }

  // ---- Device introspection ------------------------------------------------
  @PluginMethod
  fun deviceCaps(call: PluginCall) {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val info = ActivityManager.MemoryInfo()
    am.getMemoryInfo(info)
    val totalMb = info.totalMem / (1024 * 1024)
    val availMb = info.availMem / (1024 * 1024)

    val variants = modelConfig?.getJSONObject("variants")
    // Only E2B is supported on-device for now. E4B would need ~8 GB RAM
    // headroom which is rare on the target hardware in Kazakhstan.
    val recommended = if (
      variants?.has("E2B") == true &&
      variants.getJSONObject("E2B").getInt("minDeviceRamMb").let { totalMb >= it }
    ) "E2B" else "none"
    call.resolve(JSObject().apply {
      put("totalRamMb", totalMb)
      put("availRamMb", availMb)
      put("recommendedVariant", recommended)
    })
  }

  // ---- Model download ------------------------------------------------------
  @PluginMethod
  fun ensureModel(call: PluginCall) {
    val variant = call.getString("variant") ?: "E2B"
    val v = modelConfig?.getJSONObject("variants")?.getJSONObject(variant)
      ?: return call.reject("unknown_variant:$variant")
    // Use the filename from config (e.g. gemma-4-E2B-it-web.task) so the
    // file extension matches what MediaPipe's LlmInference expects.
    val filename = v.optString("filename", "$variant.task")
    val target = File(context.filesDir, filename)

    scope.launch {
      try {
        ModelDownloader.ensure(
          url = v.getString("url"),
          target = target,
          expectedSize = v.getLong("sizeBytes"),
          expectedSha256 = v.getString("sha256"),
          onProgress = { downloaded, total ->
            notifyListeners(
              "download_progress",
              JSObject().put("downloaded", downloaded).put("total", total).put("variant", variant)
            )
          },
        )
        call.resolve(JSObject().put("status", "ready").put("path", target.absolutePath))
      } catch (e: Exception) {
        call.reject(e.message ?: "download_failed", e)
      }
    }
  }

  // ---- Runtime init --------------------------------------------------------
  @PluginMethod
  fun init(call: PluginCall) {
    val variant = call.getString("variant") ?: "E2B"
    val v = modelConfig?.getJSONObject("variants")?.getJSONObject(variant)
      ?: return call.reject("unknown_variant:$variant")
    val filename = v.optString("filename", "$variant.task")
    val modelFile = File(context.filesDir, filename)
    if (!modelFile.exists()) return call.reject("model_not_downloaded")
    val inference = modelConfig?.getJSONObject("inference") ?: JSONObject()

    scope.launch {
      try {
        runtime = GemmaRuntime(
          context = context,
          modelPath = modelFile.absolutePath,
          maxTokens = inference.optInt("maxTokens", 4096),
          temperature = inference.optDouble("temperature", 0.7).toFloat(),
          topK = inference.optInt("topK", 40),
          stopTokens = (0 until (inference.optJSONArray("stopTokens")?.length() ?: 0))
            .map { inference.getJSONArray("stopTokens").getString(it) },
        )
        runtime!!.load()
        call.resolve(
          JSObject()
            .put("model", modelConfig?.optString("model"))
            .put("version", modelConfig?.optString("version"))
            .put("variant", variant)
        )
      } catch (e: Exception) {
        call.reject(e.message ?: "init_failed", e)
      }
    }
  }

  // ---- Generation ----------------------------------------------------------
  @PluginMethod
  fun generate(call: PluginCall) {
    val rt = runtime ?: return call.reject("runtime_not_initialised")
    val system = call.getString("system") ?: ""
    val messages = call.getArray("messages") ?: JSONArray()
    val tools = call.getArray("tools")

    currentJob?.cancel()
    currentJob = scope.launch {
      try {
        val stopReason = rt.generate(
          system = system,
          messages = messages,
          tools = tools,
          onDelta = { text ->
            notifyListeners("delta", JSObject().put("text", text))
          },
          onToolUse = { name, input ->
            val id = java.util.UUID.randomUUID().toString()
            notifyListeners(
              "tool_use",
              JSObject().put("id", id).put("name", name).put("input", input)
            )
            // suspend until the JS side calls respondToolUse with this id
            toolBridge.await(id)
          },
        )
        call.resolve(JSObject().put("stop_reason", stopReason))
      } catch (e: Exception) {
        call.reject(e.message ?: "generation_failed", e)
      }
    }
  }

  @PluginMethod
  fun respondToolUse(call: PluginCall) {
    val id = call.getString("id") ?: return call.reject("missing_id")
    val result = call.getObject("result") ?: JSObject()
    toolBridge.resolve(id, result.toString())
    call.resolve()
  }

  @PluginMethod
  fun cancel(call: PluginCall) {
    currentJob?.cancel()
    runtime?.cancel()
    call.resolve()
  }
}
