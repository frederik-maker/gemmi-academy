package co.bussler.gemmi

import android.content.Context
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import java.util.concurrent.CountDownLatch

/**
 * Thin wrapper around MediaPipe's LlmInference for a single Gemma .task model.
 * Loaded once per app session (cached in GemmiTutorPlugin.runtime) so we
 * don't pay the multi-second model-init cost on every chat message.
 *
 * The .task bundle is downloaded once into filesDir/llm/model.task (via
 * ModelDownloader, same code path as Piper voice tarballs) and loaded
 * from disk. No assets bundling — Gemma 3 1B int4 is ~580 MB.
 *
 * Streaming: MediaPipe's setResultListener fires (partial, isDone) tuples
 * as the model produces tokens. The listener is set ONCE on the builder,
 * not per call, so we route through a volatile lambda that generate()
 * swaps in for the duration of one prompt.
 */
class GemmaRuntime(
  context: Context,
  modelPath: String,
  maxTokens: Int,
  topK: Int,
  @Suppress("UNUSED_PARAMETER") temperature: Float,
) {

  // The lambda generate() temporarily swaps in. The builder-time listener
  // forwards every (partial, done) pair through here so each in-flight
  // generate() call sees its own deltas without leaking between calls.
  @Volatile private var onPartial: ((String, Boolean) -> Unit)? = null

  private val llm: LlmInference

  init {
    val opts = LlmInference.LlmInferenceOptions.builder()
      .setModelPath(modelPath)
      .setMaxTokens(maxTokens)
      .setMaxTopK(topK)
      .setResultListener { partial, isDone ->
        onPartial?.invoke(partial ?: "", isDone)
      }
      .build()
    llm = LlmInference.createFromOptions(context, opts)
  }

  /**
   * Run `prompt` through the model, calling onDelta with each partial token
   * chunk as it arrives. Returns the assembled full text when the model
   * signals isDone. Blocks the calling thread — invoke from a coroutine on
   * Dispatchers.Default.
   */
  fun generate(prompt: String, onDelta: (String) -> Unit): String {
    val sb = StringBuilder()
    val latch = CountDownLatch(1)
    onPartial = { partial, isDone ->
      if (partial.isNotEmpty()) {
        sb.append(partial)
        onDelta(partial)
      }
      if (isDone) latch.countDown()
    }
    try {
      llm.generateResponseAsync(prompt)
      latch.await()
      return sb.toString()
    } finally {
      onPartial = null
    }
  }

  /**
   * MediaPipe's LlmInference doesn't expose a mid-generation cancel API.
   * Closing aborts the in-flight async call; callers should reload via
   * the constructor before generating again. GemmiTutorPlugin handles this:
   * cancel() sets runtime = null, the next generate() reconstructs it.
   */
  fun close() {
    try { llm.close() } catch (_: Exception) { /* idempotent */ }
  }
}
