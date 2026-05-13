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
 * from disk — no asset bundling because Gemma 3 1B int4 is ~580 MB.
 *
 * Streaming: tasks-genai's generateResponseAsync overload accepts a
 * ProgressListener<String> directly (SAM-converted from a `(partial, done)`
 * lambda). The Builder does NOT have setResultListener despite some
 * sample code on the internet suggesting otherwise — the listener lives
 * at the call site.
 */
class GemmaRuntime(
  context: Context,
  modelPath: String,
  maxTokens: Int,
  topK: Int,
  @Suppress("UNUSED_PARAMETER") temperature: Float,
) {

  private val llm: LlmInference

  init {
    val opts = LlmInference.LlmInferenceOptions.builder()
      .setModelPath(modelPath)
      .setMaxTokens(maxTokens)
      .setMaxTopK(topK)
      .build()
    llm = LlmInference.createFromOptions(context, opts)
  }

  /**
   * Run `prompt` through the model, calling onDelta with each partial chunk
   * as it arrives. Returns the assembled full text when the model signals
   * isDone. Blocks the calling thread — invoke from a coroutine on an IO
   * or Default dispatcher.
   */
  fun generate(prompt: String, onDelta: (String) -> Unit): String {
    val sb = StringBuilder()
    val latch = CountDownLatch(1)
    // ProgressListener<String> = void run(String partial, boolean done).
    // tasks-genai's generateResponseAsync returns a ListenableFuture; we
    // don't await it directly because the listener tells us when done,
    // and the future would just give us the same final string.
    llm.generateResponseAsync(prompt) { partial, isDone ->
      if (!partial.isNullOrEmpty()) {
        sb.append(partial)
        onDelta(partial)
      }
      if (isDone) latch.countDown()
    }
    latch.await()
    return sb.toString()
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
