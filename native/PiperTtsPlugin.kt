package co.bussler.gemmi

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
 * Capacitor plugin: Piper TTS via sherpa-onnx, fully offline.
 *
 * JS-side contract (set on window.PiperTts by src/lib/piperTts.js):
 *   voiceState({ lang })             → { state: 'missing' | 'ready' | 'bundled', sizeBytes?, id? }
 *   downloadVoice({ lang })          → resolves when extracted; progress via 'voice_download_progress' events
 *   speak({ text, lang })            → resolves once the utterance finishes playing
 *   stop()                           → cancels current speak()
 *
 * Voice file sources:
 *   • kk_KZ is bundled into the APK assets (~30 MB) — installed by
 *     wire-native.sh as part of the build. Kazakh TTS works on first
 *     launch with zero downloads. Loaded via AssetManager.
 *   • en_US, ru_RU are opt-in downloads (the Web Speech versions are
 *     already decent), fetched into filesDir/voices/{lang}/ on demand.
 *
 * voiceState distinguishes 'bundled' from 'ready' so the setup UI can
 * hide the download button on kk and show "Built in" instead.
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
  private fun hasBundledVoice(lang: String): Boolean {
    return try {
      val files = context.assets.list("voices/$lang") ?: emptyArray()
      files.contains("model.onnx") && files.contains("tokens.txt")
    } catch (_: Exception) { false }
  }

  /** True iff `voices/{lang}/lexicon.txt` exists in assets. */
  private fun bundledHasLexicon(lang: String): Boolean = try {
    context.assets.list("voices/$lang")?.contains("lexicon.txt") == true
  } catch (_: Exception) { false }

  /** True iff `voices/{lang}/espeak-ng-data/` exists in assets. */
  private fun bundledHasDataDir(lang: String): Boolean = try {
    context.assets.list("voices/$lang")?.contains("espeak-ng-data") == true
  } catch (_: Exception) { false }

  // ---- Per-voice state ------------------------------------------------------
  @PluginMethod
  fun voiceState(call: PluginCall) {
    val lang = call.getString("lang") ?: return call.reject("missing_lang")
    val voice = voiceConfig?.getJSONObject("voices")?.optJSONObject(lang)
      ?: return call.reject("unknown_lang:$lang")

    if (hasBundledVoice(lang)) {
      call.resolve(JSObject()
        .put("state", "bundled")
        .put("sizeBytes", voice.optLong("sizeBytes", 0L))
        .put("id", voice.optString("id")))
      return
    }
    val dir = File(context.filesDir, "voices/$lang")
    val modelFile = File(dir, "model.onnx")
    val tokensFile = File(dir, "tokens.txt")
    val ready = modelFile.exists() && modelFile.length() > 0 && tokensFile.exists()
    call.resolve(JSObject()
      .put("state", if (ready) "ready" else "missing")
      .put("sizeBytes", voice.optLong("sizeBytes", 0L))
      .put("id", voice.optString("id")))
  }

  // ---- Download + extract on demand ----------------------------------------
  // Skip for bundled voices — they're already installed via APK assets.
  @PluginMethod
  fun downloadVoice(call: PluginCall) {
    val lang = call.getString("lang") ?: return call.reject("missing_lang")
    val voice = voiceConfig?.getJSONObject("voices")?.optJSONObject(lang)
      ?: return call.reject("unknown_lang:$lang")
    if (hasBundledVoice(lang)) {
      return call.resolve(JSObject().put("state", "bundled"))
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

    val bundled = hasBundledVoice(lang)
    val filesDir = File(context.filesDir, "voices/$lang")
    if (!bundled && !File(filesDir, "model.onnx").exists()) {
      return call.reject("voice_not_installed")
    }

    val inference = voiceConfig?.optJSONObject("engine") ?: JSONObject()
    cancelCurrent()
    currentCall = call

    currentJob = scope.launch {
      try {
        val engine = engines.getOrPut(lang) {
          if (bundled) {
            PiperEngine.loadFromAssets(
              assetManager = context.assets,
              assetRoot = "voices/$lang",
              hasLexicon = bundledHasLexicon(lang),
              hasDataDir = bundledHasDataDir(lang),
              numThreads = inference.optInt("numThreads", 2),
              noiseScale = inference.optDouble("noiseScale", 0.667).toFloat(),
              noiseScaleW = inference.optDouble("noiseScaleW", 0.8).toFloat(),
              lengthScale = inference.optDouble("lengthScale", 1.0).toFloat(),
            )
          } else {
            PiperEngine.load(
              voiceDir = filesDir,
              numThreads = inference.optInt("numThreads", 2),
              noiseScale = inference.optDouble("noiseScale", 0.667).toFloat(),
              noiseScaleW = inference.optDouble("noiseScaleW", 0.8).toFloat(),
              lengthScale = inference.optDouble("lengthScale", 1.0).toFloat(),
            )
          }
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
