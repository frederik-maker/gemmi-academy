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
 *   voiceState({ lang })             → { state: 'missing' | 'ready', sizeBytes?, id? }
 *   downloadVoice({ lang })          → resolves when extracted; progress via 'voice_download_progress' events
 *   speak({ text, lang })            → resolves once the utterance finishes playing
 *   stop()                           → cancels current speak()
 *
 * The voice tarballs (~25–70 MB each) come from k2-fsa's sherpa-onnx
 * tts-models release. They are NOT bundled into the APK — kk_KZ is the only
 * voice most users will actually want. Downloaded once into
 * context.filesDir/voices/{lang}/, extracted, then loaded into a long-lived
 * OfflineTts instance.
 */
@CapacitorPlugin(name = "PiperTts")
class PiperTtsPlugin : Plugin() {

  private val scope = CoroutineScope(Dispatchers.IO)
  private var voiceConfig: JSONObject? = null
  private val engines = HashMap<String, PiperEngine>()
  @Volatile private var currentJob: Job? = null
  @Volatile private var currentCall: PluginCall? = null
  @Volatile private var streamer: AudioStreamer? = null

  private fun cancelCurrent() {
    currentJob?.cancel()
    streamer?.stop()
    streamer = null
    // Resolve the previous speak() call quietly so Capacitor doesn't leak
    // a never-resolved PluginCall ref. The JS-side `speak()` callers always
    // `await piper.speak(...)`; resolving with no payload looks like a
    // normal "finished" return.
    currentCall?.resolve()
    currentCall = null
  }

  override fun load() {
    val raw = context.assets.open("voice.config.json").bufferedReader().use { it.readText() }
    voiceConfig = JSONObject(raw)
  }

  // ---- Per-voice state ------------------------------------------------------
  @PluginMethod
  fun voiceState(call: PluginCall) {
    val lang = call.getString("lang") ?: return call.reject("missing_lang")
    val voice = voiceConfig?.getJSONObject("voices")?.optJSONObject(lang)
      ?: return call.reject("unknown_lang:$lang")
    val dir = File(context.filesDir, "voices/$lang")
    val modelFile = File(dir, "model.onnx")
    val tokensFile = File(dir, "tokens.txt")
    val ready = modelFile.exists() && modelFile.length() > 0 && tokensFile.exists()
    call.resolve(JSObject()
      .put("state", if (ready) "ready" else "missing")
      .put("sizeBytes", voice.optLong("sizeBytes", 0L))
      .put("id", voice.optString("id"))
    )
  }

  // ---- Download + extract on demand ----------------------------------------
  @PluginMethod
  fun downloadVoice(call: PluginCall) {
    val lang = call.getString("lang") ?: return call.reject("missing_lang")
    val voice = voiceConfig?.getJSONObject("voices")?.optJSONObject(lang)
      ?: return call.reject("unknown_lang:$lang")
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
    val voice = voiceConfig?.getJSONObject("voices")?.optJSONObject(lang)
      ?: return call.reject("unknown_lang:$lang")
    val dir = File(context.filesDir, "voices/$lang")
    if (!File(dir, "model.onnx").exists()) return call.reject("voice_not_installed")

    val inference = voiceConfig?.optJSONObject("engine") ?: JSONObject()
    cancelCurrent()
    currentCall = call

    currentJob = scope.launch {
      try {
        val engine = engines.getOrPut(lang) {
          PiperEngine.load(
            voiceDir = dir,
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
