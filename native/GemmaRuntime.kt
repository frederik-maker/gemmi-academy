package co.bussler.gemmi

import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.runBlocking

/**
 * Wraps Google's LiteRT-LM Engine + Conversation for a single Gemma 4 E2B
 * model. Loaded once per app session (cached in GemmiTutorPlugin.runtime)
 * because Engine.initialize() takes ~10s the first time — model paging in
 * from disk + KV-cache warmup.
 *
 * Why LiteRT-LM not MediaPipe Tasks GenAI: Gemma 4 ships as .litertlm
 * (a bundle understood only by LiteRT-LM, not by tasks-genai's older
 * .task loader). LiteRT-LM also exposes a proper Kotlin Flow for
 * streaming, which maps cleanly onto our existing partial-result
 * propagation pattern.
 *
 * Conversation lifetime: we create one Conversation per generate() call
 * because the JS-side composes the chat history into a single prompt
 * (gemma chat template, see tutorProviders.nativeProvider). A long-lived
 * stateful Conversation would duplicate that prompt-building work and
 * waste context.
 */
class GemmaRuntime(modelPath: String) {

  private val engine: Engine

  init {
    val cfg = EngineConfig(
      modelPath = modelPath,
      backend = Backend.CPU(),
    )
    engine = Engine(cfg)
    engine.initialize()  // ~10s; callers must invoke off the UI thread
  }

  /**
   * Synchronously synthesize a response to `prompt`, invoking onDelta for
   * each streamed chunk. Blocks the calling thread — invoke from a
   * coroutine on Dispatchers.IO.
   *
   * LiteRT-LM emits Flow<String>; we collect blockingly and rethrow any
   * collected exception so the plugin's generate() can reject the JS
   * promise on failure.
   */
  fun generate(prompt: String, onDelta: (String) -> Unit): String {
    val sb = StringBuilder()
    var thrown: Throwable? = null
    engine.createConversation().use { conv ->
      runBlocking {
        conv.sendMessageAsync(prompt)
          .onEach { token ->
            val s = token.toString()
            if (s.isNotEmpty()) {
              sb.append(s)
              onDelta(s)
            }
          }
          .catch { thrown = it }
          .onCompletion { /* close happens via .use */ }
          .collect { /* values handled in onEach */ }
      }
    }
    thrown?.let { throw it }
    return sb.toString()
  }

  /** Tear down the underlying native runtime. Idempotent. */
  fun close() {
    try { engine.close() } catch (_: Exception) { /* already closed */ }
  }
}
