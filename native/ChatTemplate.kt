package co.bussler.gemmi

import org.json.JSONArray
import org.json.JSONObject

/**
 * Renders the system prompt + chat history + tool schemas into the prompt
 * string that Gemma 4's chat-tuned variant expects.
 *
 * If you fine-tune with a different chat template (e.g. you adopt the
 * upstream Gemma format vs. a custom one), update this file — it's the only
 * place that knows about template formatting.
 *
 * Default below follows the Gemma 4 instruction-tuned template:
 *   <start_of_turn>user
 *   {content}<end_of_turn>
 *   <start_of_turn>model
 *   {content}<end_of_turn>
 *
 * Tools are inlined into the system turn as a JSON schema list; the model is
 * trained to emit tool calls as a fenced ```tool_call ... ``` JSON block.
 */
object ChatTemplate {

  fun render(system: String, messages: JSONArray, tools: JSONArray?): String {
    val sb = StringBuilder()
    val sys = buildString {
      append(system.trim())
      if (tools != null && tools.length() > 0) {
        append("\n\nYou have access to these tools. Call one by emitting a fenced JSON block:\n```tool_call\n{\"name\": \"...\", \"input\": {...}}\n```\n\n")
        append("Tools:\n")
        for (i in 0 until tools.length()) {
          val t = tools.getJSONObject(i)
          append("- ${t.getString("name")}: ${t.getString("description")}\n")
          append("  input_schema: ${t.getJSONObject("input_schema")}\n")
        }
      }
    }
    sb.append("<start_of_turn>user\n").append(sys).append("<end_of_turn>\n")

    for (i in 0 until messages.length()) {
      val m = messages.getJSONObject(i)
      val role = if (m.getString("role") == "assistant") "model" else "user"
      val content = renderContent(m.getJSONArray("content"))
      sb.append("<start_of_turn>").append(role).append("\n")
        .append(content)
        .append("<end_of_turn>\n")
    }
    sb.append("<start_of_turn>model\n")
    return sb.toString()
  }

  fun renderToolResult(toolName: String, resultJson: String): String {
    return "<start_of_turn>user\n```tool_result name=\"$toolName\"\n$resultJson\n```<end_of_turn>\n<start_of_turn>model\n"
  }

  private fun renderContent(content: JSONArray): String {
    val sb = StringBuilder()
    for (i in 0 until content.length()) {
      val c = content.getJSONObject(i)
      if (c.getString("type") == "text") sb.append(c.getString("text"))
    }
    return sb.toString()
  }
}
