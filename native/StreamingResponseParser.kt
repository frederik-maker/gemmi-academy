package co.bussler.gemmi

import org.json.JSONObject

/**
 * Watches the streamed model output for either (a) plain text the user should
 * see, or (b) a fenced ```tool_call ... ``` block we need to bridge to JS.
 *
 * Text chunks are forwarded to `onDelta` as they arrive. Tool-call blocks are
 * buffered until the closing fence, then exposed via `pendingToolCall()`.
 */
class StreamingResponseParser(
  private val onDelta: (String) -> Unit,
  private val stopTokens: List<String>,
) {
  private val buffer = StringBuilder()
  private var inToolBlock = false
  private var toolBuffer = StringBuilder()
  private var pendingTool: ToolCall? = null
  private var sawStop = false

  data class ToolCall(val name: String, val input: JSONObject)

  fun feed(chunk: String) {
    if (sawStop) return
    buffer.append(chunk)

    while (buffer.isNotEmpty()) {
      // Stop tokens take precedence — once we see one, the turn ends.
      for (stop in stopTokens) {
        val idx = buffer.indexOf(stop)
        if (idx == 0) {
          buffer.delete(0, stop.length)
          sawStop = true
          return
        }
      }
      if (!inToolBlock) {
        // Look for the start of a tool call.
        val start = buffer.indexOf(TOOL_OPEN)
        if (start == -1) {
          // Emit everything we have — no tool call in sight.
          val safeLen = buffer.length - (TOOL_OPEN.length - 1)
            .coerceAtMost(buffer.length)
          if (safeLen > 0) {
            val toEmit = buffer.substring(0, safeLen)
            if (toEmit.isNotEmpty()) onDelta(toEmit)
            buffer.delete(0, safeLen)
          }
          return
        } else {
          if (start > 0) {
            onDelta(buffer.substring(0, start))
          }
          buffer.delete(0, start + TOOL_OPEN.length)
          inToolBlock = true
          toolBuffer.setLength(0)
        }
      } else {
        val end = buffer.indexOf(TOOL_CLOSE)
        if (end == -1) {
          toolBuffer.append(buffer)
          buffer.setLength(0)
          return
        } else {
          toolBuffer.append(buffer.substring(0, end))
          buffer.delete(0, end + TOOL_CLOSE.length)
          inToolBlock = false
          parseToolBuffer()
          return
        }
      }
    }
  }

  fun flush() {
    if (!inToolBlock && buffer.isNotEmpty() && !sawStop) {
      onDelta(buffer.toString())
      buffer.setLength(0)
    }
  }

  fun pendingToolCall(): ToolCall? = pendingTool.also { pendingTool = null }
  fun hitStopToken(): Boolean = sawStop

  private fun parseToolBuffer() {
    try {
      val obj = JSONObject(toolBuffer.toString().trim())
      pendingTool = ToolCall(
        name = obj.getString("name"),
        input = obj.optJSONObject("input") ?: JSONObject(),
      )
    } catch (e: Exception) {
      // Malformed tool call — drop it and emit as text so the user at least
      // sees something instead of a silent failure.
      onDelta(toolBuffer.toString())
    }
  }

  companion object {
    private const val TOOL_OPEN = "```tool_call"
    private const val TOOL_CLOSE = "```"
  }
}
