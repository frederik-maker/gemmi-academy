package co.bussler.gemmi

import android.content.Context
import com.google.ai.edge.litert.lm.LlmInference
import com.google.ai.edge.litert.lm.LlmInferenceSession
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Thin wrapper around LiteRT-LM's LlmInference / LlmInferenceSession.
 *
 * Owns the loaded model and runs one generation at a time. The tool-use loop
 * is implemented by detecting the model's structured function-call blocks in
 * the stream, suspending to ask the JS side via onToolUse(), and feeding the
 * result back into the session as the next query chunk.
 *
 * NOTE: The exact API surface of LiteRT-LM may shift between SDK releases —
 * if the imports below don't resolve, check `com.google.ai.edge:litert-lm`
 * version in build.gradle and adjust class names accordingly.
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
      .build()
    llm = LlmInference.createFromOptions(context, opts)
  }

  fun cancel() {
    cancelled = true
    session?.close()
    session = null
  }

  /**
   * One full agent turn:
   *   1. Render the chat history (system + messages) into Gemma 4's chat
   *      template, including tool schemas so the model can emit tool calls.
   *   2. Stream tokens via onDelta.
   *   3. When a structured tool_use block appears in the stream, call
   *      onToolUse(name, input) which returns a JSON string of the result;
   *      append that as the next query chunk and keep generating.
   *   4. Stop when the model emits a stop token.
   */
  suspend fun generate(
    system: String,
    messages: JSONArray,
    tools: JSONArray?,
    onDelta: (String) -> Unit,
    onToolUse: suspend (name: String, input: JSONObject) -> String,
  ): String {
    val sess = LlmInferenceSession.createFromOptions(
      llm!!,
      LlmInferenceSession.LlmInferenceSessionOptions.builder()
        .setTopK(topK)
        .setTemperature(temperature)
        .build()
    )
    session = sess
    cancelled = false

    val prompt = ChatTemplate.render(system = system, messages = messages, tools = tools)
    sess.addQueryChunk(prompt)

    while (!cancelled) {
      val parser = StreamingResponseParser(onDelta = onDelta, stopTokens = stopTokens)

      // Drive the session: each callback delivers a partial chunk. When the
      // model signals `done`, we return control here and inspect what was
      // accumulated. Stop reason is end_turn unless we detect a tool_use.
      generateOnce(sess) { partial, done ->
        parser.feed(partial)
        if (done) parser.flush()
      }

      val toolCall = parser.pendingToolCall()
      if (toolCall != null) {
        val resultJson = onToolUse(toolCall.name, toolCall.input)
        // Wrap the JSON result in the chat template's tool-result delimiter
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
