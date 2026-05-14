// Pluggable tutor providers.
//
// The chat UI imports `selectProvider()` and an interface that yields
// streaming events. Today there are two implementations:
//
//   • `cloudProvider`, POSTs to /api/tutor (Gemini 2.5 Flash, multi-tool agent).
//   • `nativeProvider`, talks to a Capacitor plugin that exposes a local
//     Gemma model via Google LiteRT on Android. Activates automatically when
//     window.GemmiTutor is present (set by the native plugin's JS shim).
//
// Adding a third provider (WebLLM, MediaPipe Tasks GenAI, Ollama, etc.) means
// implementing { name, available(), streamReply() } and adding to PROVIDERS.

import { TUTOR_TOOLS, executeTool } from './tutorTools.js'

// ---------- Cloud fallback (Gemini 2.5 Flash) --------------------------------
function sanitize(messages) {
  return messages
    .map((m) => ({
      role: m.role,
      content: (m.content || [])
        .filter((c) => {
          if (!c) return false
          if (c.type === 'text') return typeof c.text === 'string' && c.text.trim().length > 0
          if (c.type === 'image') return typeof c.data === 'string' && c.data.length > 0
          return false
        })
        .map((c) => c.type === 'image'
          ? { type: 'image', data: c.data, mimeType: c.mimeType || 'image/jpeg' }
          : { type: 'text', text: c.text }),
    }))
    .filter((m) => m.content.length > 0)
}

export const cloudProvider = {
  id: 'cloud',
  name: 'Cloud tutor',
  needsNetwork: true,
  async available() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
    return true
  },
  async *streamReply({ messages, studentState, signal }) {
    const res = await fetch('/api/tutor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: sanitize(messages), studentState }),
      signal,
    })
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '')
      yield { kind: 'error', message: `HTTP ${res.status}: ${t}` }
      return
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder('utf-8')
    let buf = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 2)
        if (!block.startsWith('data:')) continue
        const payload = block.slice(5).trim()
        if (!payload) continue
        let parsed
        try { parsed = JSON.parse(payload) } catch { continue }
        yield { kind: parsed.type, ...parsed }
      }
    }
  },
}


// ---------- Native (Gemma via LiteRT, runs on-device) -------------------------
//
// Contract the Capacitor plugin must expose on globalThis:
//
//   window.GemmiTutor = {
//     ready: Promise<{ model: 'gemma-4-2b' | string, version: string }>,
//     generate({ system, messages, tools, onDelta, onToolUse }):
//        Promise<{ stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' }>
//   }
//
// The plugin is expected to:
//   - Run the local agent loop and emit text deltas via `onDelta(text)`.
//   - When the model emits a structured tool_use block, call
//     `onToolUse({ name, input })` which returns the tool result; the plugin
//     should then continue generation with that result injected.
//
// The JS-side executor (`executeTool` from tutorTools.js) resolves tools that
// need access to in-app state (student progress, lesson search), exactly the
// same code path the cloud provider uses server-side. The model runs in the
// process; tools run in JS. Same shape as the cloud version.
export const nativeProvider = {
  id: 'native',
  name: 'Gemma (on device)',
  needsNetwork: false,
  async available() {
    if (typeof window === 'undefined') return false
    if (typeof window.GemmiTutor?.generate !== 'function') return false
    // ModelSetup.jsx sets this flag after a verified download completes.
    // Without it we don't claim native is "available" — otherwise the first
    // chat message would block on Plugin.ensureModel() and trigger a 2 GB
    // download in the background while the kid waits, which is hostile UX.
    try {
      return localStorage.getItem('gemmi-offline-model-ready') === 'true'
    } catch { return false }
  },
  async *streamReply({ messages, studentState, signal }) {
    const tutor = window.GemmiTutor
    if (!tutor) {
      yield { kind: 'error', message: 'On-device tutor not available' }
      return
    }
    await tutor.ready

    const queue = []
    let resolveNext = null
    let stopped = false
    const push = (ev) => {
      if (resolveNext) {
        const r = resolveNext
        resolveNext = null
        r(ev)
      } else {
        queue.push(ev)
      }
    }
    const next = () => new Promise((r) => {
      if (queue.length) r(queue.shift())
      else if (stopped) r({ kind: 'done' })
      else resolveNext = r
    })

    const sanitized = sanitize(messages)
    const generation = tutor
      .generate({
        system: SYSTEM_PROMPT_LOCAL,
        messages: sanitized,
        tools: TUTOR_TOOLS,
        signal,
        onDelta: (text) => push({ kind: 'delta', text }),
        onToolUse: async ({ name, input }) => {
          push({ kind: 'tool_start', name })
          const result = executeTool(name, input || {}, studentState)
          push({ kind: 'tool_result', name, input, output: result })
          return result
        },
      })
      .then(() => {
        stopped = true
        push({ kind: 'done' })
      })
      .catch((err) => {
        push({ kind: 'error', message: err?.message || 'on-device generation failed' })
        stopped = true
        push({ kind: 'done' })
      })

    // eslint-disable-next-line no-unused-vars
    while (true) {
      const ev = await next()
      yield ev
      if (ev.kind === 'done') break
    }
    await generation
  },
}

// Shorter system prompt: small on-device models choke on the multi-paragraph
// instructions we send to the cloud model. The cloud version uses the full
// prompt server-side.
const SYSTEM_PROMPT_LOCAL = `You are Gemmi, a bowerbird AI tutor in Gemmi Academy.
Reply in the student's chosen language (Қазақша / Русский / English).
Keep replies short, 1 to 3 sentences, unless explaining a concept.
Call get_student_state before answering personal questions.
Call generate_practice_question when the student asks to be quizzed.
Do not use em dashes or en dashes. Use periods, commas, colons, or parentheses.`


// ---------- Selection --------------------------------------------------------
export const PROVIDERS = [nativeProvider, cloudProvider]

let _cached = null
export async function selectProvider({ preferred } = {}) {
  if (preferred) {
    const p = PROVIDERS.find((x) => x.id === preferred)
    if (p && (await p.available())) return p
  }
  if (_cached && (await _cached.available())) return _cached
  for (const p of PROVIDERS) {
    if (await p.available()) {
      _cached = p
      return p
    }
  }
  return null
}

export function clearProviderCache() {
  _cached = null
}
