package co.bussler.gemmi

import android.content.Context
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Thin wrapper around MediaPipe's LlmInference / LlmInferenceSession.
 *
 * Owns the loaded .task model and runs one generation at a time. The tool-use
 * loop watches the streaming output for the structured function-call markers
 * Gemma 4 emits, suspends to ask the JS side via onToolUse(), and feeds the
 * tool result back into the same session as the next query chunk.
 *
 * Heap budget: the E2B int4-quantised .task is ~2 GB on disk and roughly
 * 2.5 GB at runtime. model.config.json gates download behind minDeviceRamMb
 * so we never load on phones that would OOM.
 */
class GemmaRuntime(
  private val context: Context,
  private val modelPath: String,
  private val maxTokens: Int,
  private val temperature: Float,
  private val topK: Int,
  private val stopTokens: List<String>,
) {

  private var llm: LlmInference? = null
  private var session: LlmInferenceSession? = null
  @Volatile private var cancelled = false

  fun load() {
    val opts = LlmInference.LlmInferenceOptions.builder()
      .setModelPath(modelPath)
      .setMaxTokens(maxTokens)
      .setMaxTopK(topK)
      .build()
    llm = LlmInference.createFromOptions(context, opts)
  }

  fun close() {
    cancelled = true
    session?.close()
    session = null
    llm?.close()
    llm = null
  }

  fun cancel() {
    cancelled = true
    session?.close()
    session = null
  }

  /**
   * One full agent turn.
   *
   *   1. Render system + history (and tool schemas if present) into Gemma 4's
   *      chat template via ChatTemplate.render.
   *   2. addQueryChunk(prompt), then drive generateResponseAsync. Forward each
   *      streamed token through StreamingResponseParser which strips the
   *      chat-template envelope and watches for tool-use markers.
   *   3. When a structured function-call appears, suspend, call onToolUse,
   *      and feed the result back via addQueryChunk wrapped in the tool-result
   *      delimiter. Continue generating.
   *   4. Stop when the model emits <end_of_turn> / <eos> or when the caller
   *      cancels.
   */
  suspend fun generate(
    system: String,
    messages: JSONArray,
    tools: JSONArray?,
    onDelta: (String) -> Unit,
    onToolUse: suspend (name: String, input: JSONObject) -> String,
  ): String {
    val ll = llm ?: error("runtime_not_loaded")
    val sess = LlmInferenceSession.createFromOptions(
      ll,
      LlmInferenceSession.LlmInferenceSessionOptions.builder()
        .setTopK(topK)
        .setTemperature(temperature)
        .build()
    )
    session = sess
    cancelled = false

    val initialPrompt = ChatTemplate.render(system = system, messages = messages, tools = tools)
    sess.addQueryChunk(initialPrompt)

    while (!cancelled) {
      val parser = StreamingResponseParser(onDelta = onDelta, stopTokens = stopTokens)

      generateOnce(sess) { partial, done ->
        parser.feed(partial)
        if (done) parser.flush()
      }

      val toolCall = parser.pendingToolCall()
      if (toolCall != null) {
        val resultJson = onToolUse(toolCall.name, toolCall.input)
        sess.addQueryChunk(ChatTemplate.renderToolResult(toolCall.name, resultJson))
        continue
      }

      return if (parser.hitStopToken()) "end_turn" else "max_tokens"
    }
    return "cancelled"
  }

  private suspend fun generateOnce(
    sess: LlmInferenceSession,
    onPartial: (String, Boolean) -> Unit,
  ) = suspendCancellableCoroutine<Unit> { cont ->
    try {
      sess.generateResponseAsync { partial, done ->
        onPartial(partial, done)
        if (done) cont.resume(Unit)
      }
    } catch (e: Exception) {
      cont.resumeWithException(e)
    }
  }
}
