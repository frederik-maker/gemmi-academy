package co.bussler.gemmi

import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.ConcurrentHashMap

/**
 * Suspends the model loop until the JS side resolves a tool call via
 * GemmiTutorPlugin.respondToolUse({ id, result }).
 *
 * Pattern:
 *   - GemmaRuntime: result = onToolUse(name, input)
 *   - GemmiTutorPlugin.onToolUse: notifyListeners("tool_use", {id, name, input}); toolBridge.await(id)
 *   - JS: receives 'tool_use' event, runs executeTool() locally, calls respondToolUse({id, result})
 *   - GemmiTutorPlugin.respondToolUse: toolBridge.resolve(id, resultJson)
 *   - Kotlin coroutine resumes, fed the JSON string back to the model
 */
class ToolBridge {
  private val pending = ConcurrentHashMap<String, CompletableDeferred<String>>()

  suspend fun await(id: String): String {
    val def = CompletableDeferred<String>()
    pending[id] = def
    return try {
      def.await()
    } finally {
      pending.remove(id)
    }
  }

  fun resolve(id: String, resultJson: String) {
    pending[id]?.complete(resultJson)
  }
}
