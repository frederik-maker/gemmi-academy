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
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * Capacitor plugin: on-device LLM via MediaPipe LiteRT (Gemma 3 1B).
 *
 * JS-side contract (set on window.GemmiTutor by src/lib/nativeTutor.js):
 *   deviceCaps()                       → { totalRamMb, recommendedVariant }
 *   modelState()                       → { state: 'missing' | 'ready', sizeBytes? }
 *   downloadModel({ url, sha256 })     → resolves when verified; progress via 'model_download_progress' events
 *   generate({ prompt })               → resolves with full text; deltas via 'generate_delta' events
 *   cancel()                           → aborts current generate() and tears down runtime
 *
 * Model file path: context.filesDir/llm/model.task. The plugin doesn't
 * bundle any model into the APK — Gemma 3 1B int4 is ~580 MB, far too big.
 * Setup UI downloads on first use after the user accepts the Gemma license
 * upstream on Hugging Face.
 */
@CapacitorPlugin(name = "GemmiTutor")
class GemmiTutorPlugin : Plugin() {

  private val scope = CoroutineScope(Dispatchers.IO)
  private var modelConfig: JSONObject? = null
  @Volatile private var runtime: GemmaRuntime? = null
  @Volatile private var currentJob: Job? = null
  @Volatile private var currentCall: PluginCall? = null

  override fun load() {
    val raw = context.assets.open("model.config.json").bufferedReader().use { it.readText() }
    modelConfig = JSONObject(raw)
  }

  // ---- Device capability probe ---------------------------------------------
  // Gates the setup UI: if the device has <4 GB RAM we tell the user the
  // model will be too slow, and they should stick to cloud mode. (Gemma 3 1B
  // int4 needs ~1.5 GB of resident memory but Android's app memory budget
  // is much smaller on low-RAM phones.)
  @PluginMethod
  fun deviceCaps(call: PluginCall) {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val info = ActivityManager.MemoryInfo()
    am.getMemoryInfo(info)
    val totalRamMb = (info.totalMem / (1024L * 1024L)).toInt()
    val variants = modelConfig?.optJSONObject("variants")
    val def = modelConfig?.optJSONObject("engine")?.optString("defaultVariant")
    val recommendedVariant = if (def != null && variants?.has(def) == true) {
      val v = variants.getJSONObject(def)
      val needs = v.optInt("minRamMb", 4096)
      if (totalRamMb >= needs) def else "none"
    } else "none"
    call.resolve(JSObject()
      .put("totalRamMb", totalRamMb)
      .put("recommendedVariant", recommendedVariant)
    )
  }

  // ---- Per-model state ------------------------------------------------------
  @PluginMethod
  fun modelState(call: PluginCall) {
    val modelFile = File(context.filesDir, "llm/model.task")
    val variant = modelConfig?.optJSONObject("engine")?.optString("defaultVariant")
    val sizeBytes = if (variant != null) {
      modelConfig?.optJSONObject("variants")?.optJSONObject(variant)?.optLong("sizeBytes", 0L) ?: 0L
    } else 0L
    val ready = modelFile.exists() && modelFile.length() > 0
    call.resolve(JSObject()
      .put("state", if (ready) "ready" else "missing")
      .put("sizeBytes", sizeBytes)
    )
  }

  // ---- Download model on demand --------------------------------------------
  // Accepts an explicit url+sha256+sizeBytes from the caller (lets the JS
  // side prompt the user to provide a HF token URL after license accept,
  // rather than hardcoding the URL in this plugin). Falls back to the
  // default variant from model.config.json when not provided.
  @PluginMethod
  fun downloadModel(call: PluginCall) {
    val variant = modelConfig?.optJSONObject("engine")?.optString("defaultVariant")
    val variantCfg = if (variant != null) modelConfig?.optJSONObject("variants")?.optJSONObject(variant) else null
    val url = call.getString("url") ?: variantCfg?.optString("url")
      ?: return call.reject("missing_url")
    val sha256 = call.getString("sha256") ?: variantCfg?.optString("sha256")
      ?: return call.reject("missing_sha256")
    val sizeBytes = call.getLong("sizeBytes") ?: variantCfg?.optLong("sizeBytes", 0L) ?: 0L

    val dir = File(context.filesDir, "llm")
    dir.mkdirs()
    val target = File(dir, "model.task")
    scope.launch {
      try {
        ModelDownloader.ensure(
          url = url,
          target = target,
          expectedSize = sizeBytes,
          expectedSha256 = sha256,
          onProgress = { downloaded, total ->
            notifyListeners("model_download_progress",
              JSObject().put("downloaded", downloaded).put("total", total))
          },
        )
        call.resolve(JSObject().put("state", "ready"))
      } catch (e: Exception) {
        call.reject(e.message ?: "download_failed", e)
      }
    }
  }

  // ---- Generate -------------------------------------------------------------
  @PluginMethod
  fun generate(call: PluginCall) {
    val prompt = call.getString("prompt") ?: return call.reject("missing_prompt")
    val modelFile = File(context.filesDir, "llm/model.task")
    if (!modelFile.exists()) return call.reject("model_not_installed")

    // Cancel any prior generation cleanly before starting a new one.
    cancelCurrent()
    currentCall = call

    currentJob = scope.launch {
      try {
        val rt = runtime ?: GemmaRuntime(modelFile.absolutePath).also { runtime = it }
        val full = withContext(Dispatchers.Default) {
          rt.generate(prompt) { delta ->
            notifyListeners("generate_delta", JSObject().put("text", delta))
          }
        }
        if (currentCall === call) {
          call.resolve(JSObject().put("text", full))
          currentCall = null
        }
      } catch (e: Exception) {
        if (currentCall === call) {
          call.reject(e.message ?: "generate_failed", e)
          currentCall = null
        }
      }
    }
  }

  @PluginMethod
  fun cancel(call: PluginCall) {
    cancelCurrent()
    call.resolve()
  }

  private fun cancelCurrent() {
    currentJob?.cancel()
    runtime?.close()
    // After close the LlmInference is gone; next generate() reloads.
    runtime = null
    currentCall?.resolve()
    currentCall = null
  }
}
