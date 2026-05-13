package co.bussler.gemmi

import android.content.res.AssetManager
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
import java.io.FileOutputStream

/**
 * Capacitor plugin: Piper TTS via sherpa-onnx, fully offline.
 *
 * JS-side contract (set on window.PiperTts by src/lib/piperTts.js):
 *   voiceState({ lang })             → { state: 'missing' | 'ready' | 'bundled', sizeBytes?, id? }
 *   downloadVoice({ lang })          → resolves when extracted/staged
 *   speak({ text, lang })            → resolves once the utterance finishes playing
 *   stop()                           → cancels current speak()
 *
 * Voice file sources:
 *   • kk_KZ is bundled into the APK assets (~45 MB) by wire-native.sh.
 *     On first speak() we copy the asset tree to filesDir/voices/kk/
 *     because sherpa-onnx's asset-loader code path is fragile (the
 *     espeak-ng-data directory has hundreds of small files, and the JNI
 *     side crashed unrecoverably on some devices). Loading from a real
 *     filesystem path is the canonical pattern in sherpa-onnx samples.
 *   • en_US, ru_RU are opt-in downloads, fetched into filesDir/voices/
 *     {lang}/ on demand.
 *
 * voiceState distinguishes 'bundled' (asset tree present, will stage on
 * first use) from 'ready' (already on filesystem) for the setup UI.
 */
@CapacitorPlugin(name = "PiperTts")
class PiperTtsPlugin : Plugin() {

  private val scope = CoroutineScope(Dispatchers.IO)
  private var voiceConfig: JSONObject? = null
  private val engines = HashMap<String, PiperEngine>()
  @Volatile private var currentJob: Job? = null
  @Volatile private var currentCall: PluginCall? = null
  @Volatile private var streamer: AudioStreamer? = null

  override fun load() {
    val raw = context.assets.open("voice.config.json").bufferedReader().use { it.readText() }
    voiceConfig = JSONObject(raw)
  }

  private fun cancelCurrent() {
    currentJob?.cancel()
    streamer?.stop()
    streamer = null
    currentCall?.resolve()
    currentCall = null
  }

  /** True iff `voices/{lang}/model.onnx` exists in the APK assets dir. */
  private fun hasBundledVoice(lang: String): Boolean = try {
    val files = context.assets.list("voices/$lang") ?: emptyArray()
    files.contains("model.onnx") && files.contains("tokens.txt")
  } catch (_: Exception) { false }

  /** True iff `voices/{lang}/model.onnx` exists on the user filesystem. */
  private fun hasStagedVoice(lang: String): Boolean {
    val dir = File(context.filesDir, "voices/$lang")
    return File(dir, "model.onnx").exists() && File(dir, "tokens.txt").exists()
  }

  /**
   * Copy `voices/{lang}/` from APK assets to filesDir, recursively.
   * Idempotent — if model.onnx already exists in filesDir, no-op.
   * Runs synchronously on the calling thread (caller is on Dispatchers.IO).
   *
   * We do this once on first speak() rather than at install time because:
   *   • install-time copy would slow the first launch by ~5s
   *   • APK assets are uncompressed (noCompress in gemmi.gradle) so the
   *     read is fast — a 28 MB onnx file copies in <1s
   *   • disk usage is doubled (asset blob + filesDir copy ≈ 90 MB total
   *     for kk), but the asset blob is required for the APK install
   *     anyway and the filesystem copy is what sherpa-onnx actually
   *     opens. There's no clean way to free the asset blob short of
   *     OBB-style expansion files.
   */
  private fun stageBundledVoice(lang: String) {
    if (hasStagedVoice(lang)) return
    val dest = File(context.filesDir, "voices/$lang")
    dest.mkdirs()
    copyAssetTree(context.assets, "voices/$lang", dest)
  }

  private fun copyAssetTree(assets: AssetManager, srcDir: String, destDir: File) {
    val entries = assets.list(srcDir) ?: return
    if (entries.isEmpty()) {
      // It's a file, not a directory. Copy it.
      val parent = destDir.parentFile
      parent?.mkdirs()
      assets.open(srcDir).use { input ->
        FileOutputStream(destDir).use { output -> input.copyTo(output, bufferSize = 64 * 1024) }
      }
      return
    }
    destDir.mkdirs()
    for (entry in entries) {
      val childSrc = "$srcDir/$entry"
      val childDest = File(destDir, entry)
      val sub = assets.list(childSrc) ?: emptyArray()
      if (sub.isEmpty()) {
        assets.open(childSrc).use { input ->
          FileOutputStream(childDest).use { output -> input.copyTo(output, bufferSize = 64 * 1024) }
        }
      } else {
        copyAssetTree(assets, childSrc, childDest)
      }
    }
  }

  // ---- Per-voice state ------------------------------------------------------
  @PluginMethod
  fun voiceState(call: PluginCall) {
    val lang = call.getString("lang") ?: return call.reject("missing_lang")
    val voice = voiceConfig?.getJSONObject("voices")?.optJSONObject(lang)
      ?: return call.reject("unknown_lang:$lang")
    val state = when {
      hasStagedVoice(lang) -> if (hasBundledVoice(lang)) "bundled" else "ready"
      hasBundledVoice(lang) -> "bundled"
      else -> "missing"
    }
    call.resolve(JSObject()
      .put("state", state)
      .put("sizeBytes", voice.optLong("sizeBytes", 0L))
      .put("id", voice.optString("id")))
  }

  // ---- Download + extract on demand ----------------------------------------
  // Skip for bundled voices — they're already installed via APK assets,
  // we just stage them on first use.
  @PluginMethod
  fun downloadVoice(call: PluginCall) {
    val lang = call.getString("lang") ?: return call.reject("missing_lang")
    val voice = voiceConfig?.getJSONObject("voices")?.optJSONObject(lang)
      ?: return call.reject("unknown_lang:$lang")
    if (hasBundledVoice(lang)) {
      // Stage now so first speak() is fast.
      scope.launch {
        try { stageBundledVoice(lang) } catch (_: Exception) {}
        call.resolve(JSObject().put("state", "bundled"))
      }
      return
    }
    val dir = File(context.filesDir, "voices/$lang")
    dir.mkdirs()
    val tarball = File(dir, "voice.tar.bz2")
    scope.launch {
      try {
        ModelDownloader.ensure(
          url = voice.getString("url"),
          target = tarball,
          expectedSize = voice.getLong("sizeBytes"),
          expectedSha256 = voice.getString("sha256"),
          onProgress = { downloaded, total ->
            notifyListeners("voice_download_progress",
              JSObject().put("downloaded", downloaded).put("total", total).put("lang", lang))
          },
        )
        VoiceDownloader.extract(tarball, dir)
        tarball.delete()
        call.resolve(JSObject().put("state", "ready"))
      } catch (e: Exception) {
        call.reject(e.message ?: "download_failed", e)
      }
    }
  }

  // ---- Synthesize + play ----------------------------------------------------
  @PluginMethod
  fun speak(call: PluginCall) {
    val text = call.getString("text") ?: return call.reject("missing_text")
    val lang = call.getString("lang") ?: return call.reject("missing_lang")
    voiceConfig?.getJSONObject("voices")?.optJSONObject(lang)
      ?: return call.reject("unknown_lang:$lang")

    if (!hasStagedVoice(lang) && !hasBundledVoice(lang)) {
      return call.reject("voice_not_installed")
    }

    val inference = voiceConfig?.optJSONObject("engine") ?: JSONObject()
    cancelCurrent()
    currentCall = call

    currentJob = scope.launch {
      try {
        // Stage from assets if needed. After this, voice files live in
        // filesDir and we always load via the file-system path.
        if (!hasStagedVoice(lang) && hasBundledVoice(lang)) {
          stageBundledVoice(lang)
        }
        val voiceDir = File(context.filesDir, "voices/$lang")
        val engine = engines.getOrPut(lang) {
          PiperEngine.load(
            voiceDir = voiceDir,
            numThreads = inference.optInt("numThreads", 2),
            noiseScale = inference.optDouble("noiseScale", 0.667).toFloat(),
            noiseScaleW = inference.optDouble("noiseScaleW", 0.8).toFloat(),
            lengthScale = inference.optDouble("lengthScale", 1.0).toFloat(),
          )
        }
        val player = AudioStreamer(engine.sampleRate())
        streamer = player
        withContext(Dispatchers.Default) {
          player.start()
          engine.synthesize(
            text = text,
            onChunk = { samples -> player.write(samples) },
            shouldContinue = { streamer === player },
          )
          player.endOfStream()
        }
        if (currentCall === call) {
          call.resolve()
          currentCall = null
        }
      } catch (e: Exception) {
        if (currentCall === call) {
          call.reject(e.message ?: "synth_failed", e)
          currentCall = null
        }
      }
    }
  }

  @PluginMethod
  fun stop(call: PluginCall) {
    cancelCurrent()
    call.resolve()
  }
}
