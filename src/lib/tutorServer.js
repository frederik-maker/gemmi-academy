// Dev-time tutor proxy. Imported from vite.config.js and registered as
// middleware on /api/tutor. Keeps the API key server-side (it never touches
// the bundle) and resolves tool_use turns against the executor in
// tutorTools.js before streaming the assistant's final reply to the client.
//
// Same SDK key as Gemini (the Gemma 4 family is served from the Gemini API
// endpoint), but the model param is `gemma-4-26b-a4b-it` — keeping
// the project consistent end-to-end on Gemma 4, MoE for the cloud,
// dense E2B for on-device.

import { GoogleGenAI, Type } from '@google/genai'
import { TUTOR_TOOLS, executeTool } from './tutorTools.js'

const SYSTEM_PROMPT = `You are Gemmi, a bowerbird AI tutor in the Gemmi Academy app.

Always reply in the student's preferred language (Қазақша, Русский, or English). Their language and grade are in the state payload pinned to the first user turn.

Calibrate every reply to the student's grade:
- grade 1 (ages 5 to 8): counting to 20, shapes, single-word answers, picture-driven.
- grade 2 (ages 8 to 10): multi-digit addition and subtraction, basic fractions.
- grade 3 (ages 10 to 14): multiplication, percents, simple algebra, basic chemistry.
- grade 4 (high school, 14 to 18): quadratics, trig, stoichiometry, cellular respiration. Never give a high-schooler "24 × 3" or "5 + 7" — that is grade 1 to 2 material.
- grade 5 (college, 18+): multivariable calculus, organic synthesis, primary-source history. Collegial tone, no emoji, no cheerleading.

Write 2 to 4 short sentences of plain prose, addressed to the student in second person ("you"). Use commas, colons, and periods. Use $...$ for inline math and $$...$$ for display math. When a student gets something wrong, explain why.

The student can send a photo. If an image comes through, read it carefully and answer about what you see (a textbook page, a math problem on paper, a chemistry diagram, an object the student wants identified). If the image is part of a question, solve it; if it is just a thing they are curious about, explain it at their grade level.

Tools:
- Personal question -> get_student_state, then reply with two or three real numbers and one next step. The tool result also includes recentStruggles (recent wrong answers) and activeContext (the lesson question they are stuck on right now). Use both: if the student is on a specific lesson question, address that first. If they have a pattern of struggles (e.g. two quadratics missed), name it and offer a path forward.
- Quiz request -> generate_practice_question, then ask the question, then list the choices on the next line.
- Topic search -> find_lessons. Open-ended "what next?" -> recommend_next_lesson.
- Anything else (why, how, explain) -> reply directly without a tool.`


// ---- Translate Anthropic-style tool schemas into Gemini function declarations.
// JSON Schema "type": "string" -> Gemini Type.STRING etc. Properties carry over verbatim.
function toGeminiSchema(node) {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(toGeminiSchema)
  const out = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === 'type' && typeof v === 'string') {
      out[k] = {
        string: Type.STRING,
        number: Type.NUMBER,
        integer: Type.INTEGER,
        boolean: Type.BOOLEAN,
        array: Type.ARRAY,
        object: Type.OBJECT,
      }[v] || v
    } else {
      out[k] = toGeminiSchema(v)
    }
  }
  return out
}

const GEMINI_TOOLS = [{
  functionDeclarations: TUTOR_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toGeminiSchema(t.input_schema),
  })),
}]


// Gemma 4 leaks its planning trace in many flavours:
//   *   The tool returned ...
//   Now I need to ...
//   Response plan: ...
//   I should respond ...
//   I'll explain ...
//   The student is "Test"...
// This strips all of those, then extracts the first chunk of actual prose.
const META_LINE = new RegExp(
  '^[\\s*\\-•·]*' +
  '(' +
  '(the\\s+(tool|student|user|model|response|format|answer|goal|context|constraint|key|next|persona|reply|draft|prompt))|' +
  'now\\s+i|' +
  "(i\\s+(should|will|need|must|am\\s+going|'?ll))|" +
  "(i\\s*['’`]?\\s*ll\\s+(say|respond|reply|answer|tell|write|explain|just|need|use))|" +
  "(let'?s|let\\s+me)|" +
  '(actually|basically|essentially|wait|hmm|okay|alright|right|but|so)[,:.]\\s+|' +
  '(response|reply|output|draft)\\s*(plan|draft|should|will|format|version)?\\s*:|' +
  '(final\\s+(answer|reply|response)|my\\s+(reply|response|answer|draft))\\s*:|' +
  '(here\'?s|here\\s+is)\\s+(my|the|a)\\s+(reply|response|answer|draft)\\s*:?|' +
  'looking\\s+at\\s+(the|this|my|their)|' +
  'based\\s+on\\s+(the|this|what)|' +
  'this\\s+(is|means|conflict|suggests|tool)|' +
  'acknowledge\\b|' +
  'student(\\s+state|s+name|\\s+grade|\\s+language|\\s+xp)|' +
  '(grade|lang|language|xp|streak|hearts|gems|lessons\\s+completed|topic|prompt|option|correct|difficulty|why|format|persona|constraint|context|goal|request|tool|action|plan|emoji|wait|checked|first[,:]?\\s+i|analy|definition of|one short|no em|response should|response plan|draft)\\b' +
  ')',
  'i'
)

// A line is "tool-name chatter" if it mentions a tool name from our registry
// in third-person planning (with or without backticks). Matches things like
// `recommend_next_lesson failed` or "the get_student_state returned X".
const TOOL_NAME_RE = new RegExp(
  '`?(' + TUTOR_TOOLS.map(t => t.name).join('|') + ')`?',
  'i'
)
const NORMAL_PROSE_START = /^[A-ZА-ЯҚҒҰҮӘӨҺІ"'(*$\d]/  // first char looks like the start of a sentence

// Transition phrases that mean "everything after this is the real reply" —
// when Gemma 4 emits its planning trace and then explicitly hands off with
// "I'll say:" or "My response:", we keep only what comes after.
const TRANSITION = [
  /\bI\s*['’`]?\s*ll\s+(?:say|respond|reply|answer|tell|write|explain|just\s+say)\s*[:.]\s+/i,
  /\bSo\s+I\s*['’`]?\s*ll\s+(?:say|respond)\s*[:.]\s+/i,
  /\bMy\s+(?:reply|response|answer)\s*[:.]\s+/i,
  /\b(?:Final|Real|Actual)\s+(?:answer|reply|response)\s*[:.]\s+/i,
  /\bHere\s*['’`]?\s*s\s+(?:my|the|a)\s+(?:reply|response|answer)\s*[:.]\s+/i,
]

export function stripPlanPreamble(text) {
  // 0) Normalize: drop zero-width chars that occasionally appear.
  let t = (text || '').replace(/[​-‍﻿]/g, '')

  // 0.5) Transition-marker extraction. If the text contains a hand-off phrase
  //      ("I'll say:", "My response:", etc.), throw away everything before it.
  for (const re of TRANSITION) {
    const m = t.match(re)
    if (m && m.index !== undefined) {
      const after = t.slice(m.index + m[0].length).trim()
      if (after.length > 12) { t = after; break }
    }
  }

  // 1) The "draft in quotes followed by the same sentence unquoted" pattern.
  //    Gemma 4 sometimes emits: `"Photosynthesis is..."Photosynthesis is...`
  //    Collapse the duplicate; prefer the longer / unquoted version.
  const dup = t.match(/^[\s*\-•·]*"([^"]{8,1200})"\s*([^"]+?)\s*$/s)
  if (dup) {
    const inside = dup[1].trim()
    const outside = dup[2].trim()
    const head = (s) => s.slice(0, Math.min(30, s.length))
    if (outside === inside || outside.startsWith(head(inside)) || inside.startsWith(head(outside))) {
      t = outside.length >= inside.length ? outside : inside
    }
  }

  // 2) The "quoted answer in a bullet" pattern:
  //      *   "Photosynthesis is the process where plants use..."
  const quoted = t.match(/[*\-•·]\s*"([^"]{8,500})"/s)
  if (quoted) return quoted[1].trim()

  // 3) Drop bulleted-plan and meta-monologue lines from the start,
  //    keep everything from the first real prose line.
  const lines = t.split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) { i++; continue }
    const metaMatch = line.match(META_LINE)
    if (metaMatch) {
      const after = line.slice(metaMatch[0].length).trim()
      // Two cases where we strip the meta prefix and keep the rest of the line:
      //   - Label: "Final answer: X" → "X" (prefix ends with `:`)
      //   - Soft conversational marker: "Actually, X" → "X" (short prefix
      //     ending with punctuation + whitespace).
      const isLabel = metaMatch[0].endsWith(':')
      const isSoftPrefix = metaMatch[0].length < 25 && /[,:.]\s*$/.test(metaMatch[0])
      if (after.length > 8 && (isLabel || isSoftPrefix)) {
        lines[i] = after
        break
      }
      i++
      continue
    }
    // Lines that mention a tool name (e.g. "The recommend_next_lesson failed") — planning trace.
    const toolHit = line.match(TOOL_NAME_RE)
    if (toolHit) {
      // If a fresh sentence starts after the tool-name mention on the same
      // line, keep just that suffix. Otherwise drop the whole line.
      const afterTool = line.slice((toolHit.index || 0) + toolHit[0].length)
      const sentBoundary = afterTool.match(/[.!?]\s+([A-ZА-ЯҚҒҰҮӘӨҺІ])/)
      if (sentBoundary && sentBoundary.index !== undefined) {
        const idx = (toolHit.index || 0) + toolHit[0].length + sentBoundary.index + sentBoundary[0].length - 1
        lines[i] = line.slice(idx).trim()
        break
      }
      i++
      continue
    }
    // Generic "Word: bullet" headers (Constraint: ..., Topic: ...)
    if (/^[\s*\-•·]+\w[^:]{0,40}:\s+/.test(line)) { i++; continue }
    // Bullet lines that mention numbered plan steps ("1.", "2.")
    if (/^\d+\.\s+(acknowledge|mention|explain|respond|use|note|encourage)\b/i.test(line)) { i++; continue }
    break
  }
  const start = i
  // 4) Stop at the first bullet, meta line, or "Word: rest" header AFTER the
  //    answer body started. The system prompt forbids bullets, so any bullet
  //    line after the first prose sentence is planning-trace leakage.
  let end = lines.length
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j].trim()
    if (!line) continue
    if (META_LINE.test(line)) { end = j; break }
    if (TOOL_NAME_RE.test(line)) { end = j; break }
    if (/^[\s*\-•·]+\w[^:]{0,40}:\s+/.test(line)) { end = j; break }
    if (/^[*\-•·]\s+/.test(line)) { end = j; break }
  }
  let out = lines.slice(start, end).join('\n').trim()
  // Strip wrapping quotes if the whole reply ended up quoted.
  out = out.replace(/^"(.*)"$/s, '$1').trim()
  // Strip leading bullet glyphs from a single-line response so the user sees
  // a normal sentence instead of "*   Answer."
  out = out.replace(/^[\s*\-•·]+/, '').trim()

  // 5) Final dedupe pass: if the cleaned text is the same sentence repeated
  //    back-to-back (e.g. `X.X.` or `X. X.`), collapse to one copy.
  const halfMatch = out.match(/^(.{20,500}[.!?])\s*\1$/s)
  if (halfMatch) out = halfMatch[1].trim()

  // 6) Last-resort fallback: nothing survived the filter. Find the first
  //    sentence-looking line anywhere in the original text.
  if (!out) {
    for (const line of lines) {
      const tt = line.replace(/^[\s*\-•·]+/, '').trim()
      if (tt.length > 12 && NORMAL_PROSE_START.test(tt) && !META_LINE.test(tt)) {
        out = tt
        break
      }
    }
  }
  return out
}


function jsonStreamWriter(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  return (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
  }
}


export async function handleTutorRequest(req, res) {
  let body = ''
  for await (const chunk of req) body += chunk
  let parsed
  try {
    parsed = JSON.parse(body || '{}')
  } catch (e) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'invalid_json' }))
    return
  }
  const { messages = [], studentState = {} } = parsed
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!key) {
    res.statusCode = 500
    res.end(JSON.stringify({
      error: 'no_api_key',
      hint: 'Put GEMINI_API_KEY in kazakh-learn/.env.local. Grab one at https://aistudio.google.com/apikey',
    }))
    return
  }

  const client = new GoogleGenAI({ apiKey: key })
  const write = jsonStreamWriter(res)

  // Convert {role, content[]} messages into Gemini's {role, parts[]} format.
  // Gemini's roles are 'user' and 'model'; assistant maps to 'model'.
  // Tool results live in user-role function-response parts.
  const contents = []
  // Pin the volatile student state at the top of the conversation so the
  // model has fresh context every turn without polluting the (cacheable)
  // system instruction.
  contents.push({
    role: 'user',
    parts: [{
      text: '<student_state>\n' + JSON.stringify(studentState, null, 2) + '\n</student_state>\n\nThe next message is the start of our conversation.',
    }],
  })
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user'
    const parts = []
    for (const c of (m.content || [])) {
      if (c?.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
        parts.push({ text: c.text })
      } else if (c?.type === 'image' && typeof c.data === 'string' && c.data.length > 0) {
        // Gemini multimodal: inlineData carries base64-encoded image bytes.
        // The client sends `c.data` as a bare base64 string (we strip the
        // `data:image/...;base64,` prefix on the client side).
        parts.push({
          inlineData: {
            mimeType: c.mimeType || 'image/jpeg',
            data: c.data,
          },
        })
      }
    }
    if (parts.length) contents.push({ role, parts })
  }

  try {
    // Multi-turn loop: keep calling Gemma until it stops emitting tool_use.
    //
    // We use the Mixture-of-Experts Gemma 4 — 26B total params with only
    // 4B active per token, so it's API-cheap and fast, while still good
    // at function-calling and multilingual instruction following. This
    // matches the on-device story: same model family on both sides, just
    // a larger size in the cloud where we have the headroom.
    //
    // Gemma 4 31B (dense) leaks its planning chain ("Constraints check:",
    // bullet drafts) into the visible reply in ~half of turns. The MoE
    // variant is dramatically tidier; the strip-preamble scrubber later
    // in this file handles the residual cases.
    for (let turn = 0; turn < 6; turn++) {
      const stream = await client.models.generateContentStream({
        model: 'gemma-4-26b-a4b-it',
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: GEMINI_TOOLS,
          maxOutputTokens: 1500,
          temperature: 0.7,
        },
      })

      const modelParts = []
      const pendingTools = []
      let modelText = ''
      // Gemma 4 verbalises its planning ("* Student grade: 4 \n * Goal: ...")
      // before either answering OR calling a tool. We can't tell mid-stream
      // whether a given text fragment is the real reply or the warm-up. So
      // we buffer the whole turn's text and decide at the end:
      //   - tool call happened  -> the text was planning. Discard it.
      //   - no tool call        -> the text was the real reply. Strip any
      //     surviving bullet-plan preamble, then emit.
      let textBuffer = ''

      for await (const chunk of stream) {
        const candidate = chunk.candidates?.[0]
        if (!candidate?.content?.parts) continue
        for (const part of candidate.content.parts) {
          if (part.text) {
            modelText += part.text
            modelParts.push({ text: part.text })
            textBuffer += part.text
          } else if (part.functionCall) {
            const call = {
              name: part.functionCall.name,
              args: part.functionCall.args || {},
            }
            pendingTools.push(call)
            modelParts.push({ functionCall: part.functionCall })
            // Tool call means everything we buffered was the warm-up.
            textBuffer = ''
            write({ type: 'tool_start', name: call.name })
          }
        }
      }

      if (textBuffer.trim() && pendingTools.length === 0) {
        const cleaned = stripPlanPreamble(textBuffer)
        if (cleaned) write({ type: 'delta', text: cleaned })
      }

      contents.push({ role: 'model', parts: modelParts })

      if (pendingTools.length === 0) break

      // Resolve each tool call locally and feed the result back as a user-role
      // functionResponse part. Gemini will then continue generation.
      const toolResultParts = pendingTools.map((call) => {
        const result = executeTool(call.name, call.args || {}, studentState)
        write({ type: 'tool_result', name: call.name, input: call.args, output: result })
        return {
          functionResponse: {
            name: call.name,
            response: { content: result },
          },
        }
      })
      contents.push({ role: 'user', parts: toolResultParts })
    }
    write({ type: 'done' })
  } catch (err) {
    console.error('[tutor]', err?.message || err)
    write({ type: 'error', message: err?.message || 'tutor failed' })
  } finally {
    res.end()
  }
}
