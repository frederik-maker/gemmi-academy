package co.bussler.gemmi

import android.content.res.AssetManager
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import java.io.File

/**
 * Wraps sherpa-onnx's OfflineTts for a single Piper voice. Loaded once per
 * voice (cached in PiperTtsPlugin.engines).
 *
 * Two load paths:
 *   • `load(voiceDir, ...)` — voice files live in filesDir/voices/{lang}/.
 *     Used for en/ru after the user opts into a runtime download.
 *   • `loadFromAssets(assetManager, "voices/{lang}", ...)` — voice files
 *     ship inside the APK assets dir. Used for kk, which we bundle so
 *     Kazakh TTS works on first launch with no setup friction.
 *
 * sherpa-onnx's OfflineTts has two C-side constructors selected by whether
 * `assetManager` is non-null; the path strings in the VitsModelConfig are
 * resolved relative to that root.
 */
class PiperEngine private constructor(
  private val tts: OfflineTts,
) {

  companion object {
    fun load(
      voiceDir: File,
      numThreads: Int,
      noiseScale: Float,
      noiseScaleW: Float,
      lengthScale: Float,
    ): PiperEngine {
      val lexiconFile = File(voiceDir, "lexicon.txt")
      val dataDir = File(voiceDir, "espeak-ng-data")
      val vits = OfflineTtsVitsModelConfig(
        model = File(voiceDir, "model.onnx").absolutePath,
        tokens = File(voiceDir, "tokens.txt").absolutePath,
        lexicon = if (lexiconFile.exists()) lexiconFile.absolutePath else "",
        dataDir = if (dataDir.exists()) dataDir.absolutePath else "",
        noiseScale = noiseScale,
        noiseScaleW = noiseScaleW,
        lengthScale = lengthScale,
      )
      return PiperEngine(buildTts(vits, numThreads, assetManager = null))
    }

    fun loadFromAssets(
      assetManager: AssetManager,
      assetRoot: String,                // e.g. "voices/kk"
      hasLexicon: Boolean,
      hasDataDir: Boolean,
      numThreads: Int,
      noiseScale: Float,
      noiseScaleW: Float,
      lengthScale: Float,
    ): PiperEngine {
      val vits = OfflineTtsVitsModelConfig(
        model = "$assetRoot/model.onnx",
        tokens = "$assetRoot/tokens.txt",
        lexicon = if (hasLexicon) "$assetRoot/lexicon.txt" else "",
        dataDir = if (hasDataDir) "$assetRoot/espeak-ng-data" else "",
        noiseScale = noiseScale,
        noiseScaleW = noiseScaleW,
        lengthScale = lengthScale,
      )
      return PiperEngine(buildTts(vits, numThreads, assetManager))
    }

    private fun buildTts(
      vits: OfflineTtsVitsModelConfig,
      numThreads: Int,
      assetManager: AssetManager?,
    ): OfflineTts {
      val modelConfig = OfflineTtsModelConfig(
        vits = vits,
        numThreads = numThreads,
        debug = false,
        provider = "cpu",
      )
      val cfg = OfflineTtsConfig(model = modelConfig)
      return OfflineTts(assetManager = assetManager, config = cfg)
    }
  }

  fun sampleRate(): Int = tts.sampleRate()

  /**
   * Synthesize `text`, streaming sample chunks to onChunk as sherpa-onnx
   * generates them. shouldContinue is polled per chunk; return false to
   * stop mid-utterance.
   */
  fun synthesize(
    text: String,
    onChunk: (FloatArray) -> Unit,
    shouldContinue: () -> Boolean,
  ) {
    tts.generateWithCallback(text = text, sid = 0, speed = 1.0f) { samples ->
      onChunk(samples)
      if (shouldContinue()) 1 else 0
    }
  }
}
