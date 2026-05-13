// Pluggable tutor providers.
//
// The chat UI imports `selectProvider()` and an interface that yields
// streaming events. Today there are two implementations, both Gemma 4:
//
//   • `cloudProvider`, POSTs to /api/tutor (Gemma 4 26B-A4B MoE via the
//     Gemini API endpoint, multi-tool agent).
//   • `nativeProvider`, talks to a Capacitor plugin that exposes Gemma 4
//     E2B-it running on-device via Google LiteRT-LM. Activates automatically
//     when window.GemmiTutor is present (set by the native plugin's JS shim).
//
// Same model family on both sides — the cloud just gets the larger MoE
// variant since we have the headroom there.

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

// Inside the Capacitor APK the WebView serves from https://localhost/, so a
// bare `/api/tutor` fetch goes nowhere. Detect native and prefix with the
// real public origin. On the web this stays a relative path so the same
// bundle works regardless of which domain (gemmi.ai, www.gemmi.ai, Railway
// preview) actually hosts it.
const API_BASE = (() => {
  try {
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
      return 'https://www.gemmi.ai'
    }
  } catch { /* fall through */ }
  return ''
})()

export const cloudProvider = {
  id: 'cloud',
  name: 'Cloud tutor',
  needsNetwork: true,
  async available() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
    return true
  },
  async *streamReply({ messages, studentState, signal }) {
    const res = await fetch(`${API_BASE}/api/tutor`, {
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


// ---------- Native (Gemma 3 via LiteRT, runs on-device) ----------------------
//
// Contract the Capacitor plugin must expose on globalThis (set up by
// src/lib/nativeTutor.js):
//
//   window.GemmiTutor = {
//     deviceCaps(): Promise<{ totalRamMb, recommendedVariant }>,
//     modelState(): Promise<{ state: 'missing' | 'ready', sizeBytes? }>,
//     downloadModel({ url, sha256, sizeBytes, onProgress }): Promise<{state}>,
//     generate({ prompt, onDelta }): Promise<string>,
//     cancel(): Promise<void>,
//   }
//
// The native side is a vanilla streaming completion API — no tool use on
// device. MediaPipe Tasks GenAI doesn't expose structured tool-call output
// from Gemma, and faking it via stop-string parsing on a 1B model gets
// flaky fast. Keep tools on the cloud path; on-device is for "answer the
// student's question directly, in their language" — no get_student_state,
// no generate_practice_question.
export const nativeProvider = {
  id: 'native',
  name: 'Gemma (on device)',
  needsNetwork: false,
  async available() {
    if (typeof window === 'undefined') return false
    if (typeof window.GemmiTutor?.generate !== 'function') return false
    // ModelSetup.jsx sets this flag after a verified download completes.
    // Without it we don't claim native is "available" — otherwise the first
    // chat message would block on the download path silently.
    try {
      return localStorage.getItem('gemmi-offline-model-ready') === 'true'
    } catch { return false }
  },
  async *streamReply({ messages, signal }) {
    const tutor = window.GemmiTutor
    if (!tutor) {
      yield { kind: 'error', message: 'On-device tutor not available' }
      return
    }

    // Compose a Gemma-3 chat prompt by hand. We use the model's recommended
    // template: <start_of_turn>user\n...\n<end_of_turn>\n<start_of_turn>model\n
    const sanitized = sanitize(messages)
    const turns = sanitized.map((m) => {
      const role = m.role === 'assistant' ? 'model' : 'user'
      const text = m.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
      return `<start_of_turn>${role}\n${text}<end_of_turn>`
    })
    const prompt = `<start_of_turn>user\n${SYSTEM_PROMPT_LOCAL}<end_of_turn>\n` +
      turns.join('\n') + '\n<start_of_turn>model\n'

    const queue = []
    let resolveNext = null
    let stopped = false
    const push = (ev) => {
      if (resolveNext) { const r = resolveNext; resolveNext = null; r(ev) }
      else queue.push(ev)
    }
    const next = () => new Promise((r) => {
      if (queue.length) r(queue.shift())
      else if (stopped) r({ kind: 'done' })
      else resolveNext = r
    })

    // Allow the chat UI to abort.
    if (signal) signal.addEventListener('abort', () => { try { tutor.cancel() } catch {} })

    const generation = tutor
      .generate({
        prompt,
        onDelta: (text) => push({ kind: 'delta', text }),
      })
      .then(() => { stopped = true; push({ kind: 'done' }) })
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

// Compact system prompt. Gemma 3 1B int4 doesn't reliably follow long
// instruction blocks; we keep it punchy and rely on the cloud path for the
// full agent-style behaviour.
const SYSTEM_PROMPT_LOCAL = `You are Gemmi, a friendly tutor for kids in Gemmi Academy.
Reply in the student's language (Қазақша / Русский / English).
Keep replies short: 1 to 3 sentences. Be encouraging.
Do not use em dashes or en dashes — use commas or parentheses.`


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
