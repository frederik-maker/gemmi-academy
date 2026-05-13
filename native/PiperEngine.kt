package co.bussler.gemmi

import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import java.io.File

/**
 * Wraps sherpa-onnx's OfflineTts for a single Piper voice. Loaded once per
 * voice (cached in PiperTtsPlugin.engines) so subsequent synthesize() calls
 * don't pay the model load cost again.
 *
 * Streams audio through onChunk as soon as samples are available, courtesy
 * of sherpa-onnx's generateWithCallback API. The callback returns 1 to
 * continue, 0 to stop early.
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
      val model = File(voiceDir, "model.onnx").absolutePath
      val tokens = File(voiceDir, "tokens.txt").absolutePath
      val lexiconFile = File(voiceDir, "lexicon.txt")
      val dataDir = File(voiceDir, "espeak-ng-data")
      val vits = OfflineTtsVitsModelConfig(
        model = model,
        tokens = tokens,
        lexicon = if (lexiconFile.exists()) lexiconFile.absolutePath else "",
        dataDir = if (dataDir.exists()) dataDir.absolutePath else "",
        noiseScale = noiseScale,
        noiseScaleW = noiseScaleW,
        lengthScale = lengthScale,
      )
      val modelConfig = OfflineTtsModelConfig(
        vits = vits,
        numThreads = numThreads,
        debug = false,
        provider = "cpu",
      )
      val cfg = OfflineTtsConfig(model = modelConfig)
      return PiperEngine(OfflineTts(assetManager = null, config = cfg))
    }
  }

  fun sampleRate(): Int = tts.sampleRate()

  /**
   * Synthesize `text` and stream PCM-float samples to onChunk as they arrive.
   * The shouldContinue lambda is polled per-chunk; return false to abort
   * mid-utterance (e.g. user navigated away).
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
