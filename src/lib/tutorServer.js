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

// Short prompt by design. Gemma 4 26B-A4B (MoE, 4B active) echoes long
// rule lists back at the user ("However, the prompt says: Write 2 to 4
// short sentences..."). Stripping the prompt to a paragraph of essentials
// gives the model less to regurgitate. Grade-level vocabulary calibration
// and the photo path are now implicit; the tool descriptions in the
// function schemas already carry their own usage hints, so the model
// doesn't need redundant rules here.
// Positive-only persona. Earlier prompts with negative rules ("never list
// your plan", "don't quote instructions") seeded the meta-thought we were
// trying to suppress — Gemma 4 would emit "According to the instructions,
// I should ..." in response. Strip the prompt to a single sentence
// describing WHO Gemmi is + the format constraint, and let the scrubber
// handle any residual chain-of-thought.
const SYSTEM_PROMPT = `You are Gemmi, a kind K-12 tutor talking with a child. Speak to the child in their language in 1–3 short sentences. Use $...$ for inline math and $$...$$ for display math.`

// Appended to the system instruction per request. Keeping the per-
// conversation bits OUT of the user turn array stops Gemma 4 from
// treating them as a message it should respond to.
function perStudentContext(s) {
  const langName = ({ kk: 'Kazakh', ru: 'Russian', en: 'English' }[s?.lang]) || 'English'
  const grade = Number.isFinite(s?.grade) ? s.grade : 2
  return `\n\nThe student writes in ${langName} and is at grade level ${grade}. Always reply in ${langName}.`
}

// Localized hint pushed as a fake user turn when the previous response
// was chain-of-thought. Phrased as if the student is asking a follow-up
// in their own language. An English meta-instruction was making the
// Russian-locale model spiral into more English meta-narration.
function retryHint(s) {
  switch (s?.lang) {
    case 'ru':
      return 'Скажи просто, одной короткой фразой.'
    case 'kk':
      return 'Қарапайым тілмен, бір қысқа сөйлеммен айт.'
    default:
      return 'Just answer in one short sentence.'
  }
}


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
//   User's name is ... User's language is ... The question is ...   (multimodal leak)
// This strips all of those, then extracts the first chunk of actual prose.
const META_LINE = new RegExp(
  '^[\\s*\\-•·]*' +
  '(' +
  '(the\\s+(tool|student|user|model|response|format|answer|goal|context|constraint|key|next|persona|reply|draft|prompt|image|photo|picture|question|task|child|kid|instructions?|rules?|system))|' +
  "(user'?s?\\s+(name|language|grade|lang|xp|streak|hearts|gems|level|state|question|message|input|image|photo|picture))|" +
  "(student'?s?\\s+(name|language|grade|lang|xp|streak|hearts|gems|level|state))|" +
  '(image|photo|picture)\\s+(shows|contains|depicts|is|seems|appears)|' +
  'now\\s+i|' +
  "(i\\s+(should|will|need|must|am\\s+going|see|notice|can(?:not)?|can'?t|could|may|might|am|'?ll|don'?t|do\\s+not|won'?t|will\\s+not|cannot|won\\b))|" +
  "(i\\s*['’`]?\\s*ll\\s+(say|respond|reply|answer|tell|write|explain|just|need|use))|" +
  "(let'?s|let\\s+me)|" +
  '(actually|basically|essentially|wait|hmm|okay|alright|right|but|so|however|nonetheless|nevertheless)[,:.]\\s+|' +
  '(response|reply|output|draft)\\s*(plan|draft|should|will|format|version)?\\s*:|' +
  '(final\\s+(answer|reply|response)|my\\s+(reply|response|answer|draft))\\s*:|' +
  '(here\'?s|here\\s+is)\\s+(my|the|a)\\s+(reply|response|answer|draft)\\s*:?|' +
  'looking\\s+at\\s+(the|this|my|their|that)|' +
  'based\\s+on\\s+(the|this|what|my)|' +
  'according\\s+to\\s+(the|my|these)|' +
  'this\\s+(is|means|conflict|suggests|tool)|' +
  '(in\\s+(english|russian|kazakh|kazak|spanish|french|german|chinese)\\b)|' +
  '(english|russian|kazakh|kazak|spanish|french|german|chinese)\\s*:' +
  '|' +
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

// Catches "<Anyword>'s grade is N", "<Anyword>'s language is X", "<Anyword>'s
// name is Y" leaks — Gemma 4 sometimes echoes the student's actual name
// instead of the literal string "user", which the META_LINE regex
// wouldn't catch ("freddy's grade is 2" → was passing through). We don't
// know the student's name preemptively, so this is name-shape based.
// Matches `<owner>'s <field> is <value>.` anywhere in the string.
// Examples: "freddy's grade is 2.", "the student's language is English",
// "Aigerim's name is Aigerim." — all pure state leaks. Restricted to a
// known field list so it can't accidentally eat real prose like
// "Newton's first law is universal."
const NAME_FIELD_LEAK = /(?:the\s+|a\s+|an\s+)?[\p{L}A-Za-z][\p{L}A-Za-z'`-]{0,30}['’](?:s)?\s+(grade|language|lang|name|level|xp|streak|hearts|gems|state)\s+(?:is|level\s+is|are)\s+[^.!?\n]+[.!?\n]?/giu

// Strong-signal phrases — if any of these survive into "cleaned" text we
// assume the response is chain-of-thought even if it superficially looks
// like prose. Triggers a retry. These all describe behaviour ABOUT the
// reply (what I'll do, what the user did, format I'll use) rather than
// being a reply TO the student.
const LEAK_SIGNAL = /\b(?:once\s+i\s+have|since\s+(?:the\s+(?:user|student|child)|it'?s|this\s+is|that'?s)|i\s+(?:will\s+answer|should\s+(?:check|call|ask|respond|use|just|note|mention|encourage|format)|need\s+to\s+(?:call|use|respond|answer|note)|don'?t\s+need|do\s+not\s+need|am\s+going\s+to|am\s+supposed|see\s+(?:that|the)|notice\s+(?:that|the)|can\s+see)|the\s+(?:student|user|child)\s+(?:is\s+asking|asked|wants|picked|chose|selected)|they\s+(?:want|are\s+likely|are\s+testing|are\s+confused|felt|provided|asked)|maybe\s+(?:the\s+)?(?:user|student)\s+is|wait,?\s+looking\s+(?:at|back)|previous\s+(?:response|reply|answer|attempt|question|interaction|turn|message|input|exchange|output)\s+(?:was|is|had)|(?:my|the)\s+previous\s+(?:response|reply|answer|attempt|question|interaction|turn|message|input|exchange|output)|the\s+question\s+is|the\s+answer\s+is\s+just|the\s+language\s+is\s+\w+\s*\.?$|^\s*the\s+language\s+is\b|(?:format|response|reply)\s+(?:should|will|must)|(?:my|the)\s+(?:reply|response|answer|draft)\s+(?:should|will|needs|is)|in\s+(?:english|russian|kazakh|kazak|spanish|french|german|chinese)\s*[:,]|i'?ll\s+just|let\s+me\s+(?:think|consider|answer|respond)|the\s+(?:user|student)'?s\s+language\s+is|(?:user|student)'?s\s+(?:prompt|question|message|input|instruction)\s+is|the\s+(?:user|student)'?s\s+(?:prompt|message|input|instruction)|meta-instruction|thought\s+block|persona|gemmi\s+persona|according\s+to\s+(?:the\s+)?(?:instructions?|prompt|rules?|system|guidelines)|the\s+(?:instructions?|prompt|rules?|system|guidelines|directive|persona)\s+say(?:s|ing)?|however,?\s+the\s+(?:user|student|prompt|instructions?))\b/i

// Bare-label preambles Gemma 4 emits when the question is non-English:
//   "Task: Answer directly in 1-3 short sentences."
//   "Plan: 1. Acknowledge ..."
//   "Goal: Help the student understand ..."
// These are pure self-narration of the system prompt. Strip the entire
// labelled paragraph (anything up to the next blank line).
// Bare labels at the start of a line, with up to ~25 chars of filler
// before the colon. Catches "Response:", "Response in Kazakh:", "Final
// answer in Russian:", etc. Strips only the LABEL part (the prefix up
// to and including the colon + a space) — the post-colon content stays,
// so a label that introduces the real answer ("Final answer: Это 4.")
// becomes just the answer. If the post-colon content is itself a plan,
// later passes (numbered-plan strip, META_LINE walker) handle it.
const BARE_LABEL_LINE = /^(?:final\s+)?(?:task|plan|goal|format|instructions?|constraints?|notes?|reasoning|strategy|approach|persona|question|answer|reply|response|target|context|background|tone|style|language|level|grade|subject|topic|draft|output)(?:\s+(?:in|for|to|of)\s+\w[\w\s-]{0,25})?\s*:\s*/i

// Leading "Answer <quoted text>." pattern — Gemma 4 sometimes drops the
// colon, prefixing a quoted answer with a bare label. Strip the label
// and the wrapping quotes.
const BARE_LABEL_QUOTED = /^(?:final\s+)?(?:answer|reply|response|output)\s+["“'`]([^"”'`\n]{2,500})["”'`]\s*[.!?]?\s*$/i

// "Use $...$ for inline math", "Use LaTeX ...", "Use display math ..."
// Pure formatting narration — never something the student needs to see.
const FORMAT_NARRATION = /^use\s+(?:\$|latex|inline\s+math|display\s+math|markdown|format|the\s+(?:format|inline|display))[^\n]*\n?/i

// Leading "Answer:" / "Reply:" / "Response:" label that some non-English
// turns emit before the real prose. Strip the label but keep the rest.
const LEADING_ANSWER_LABEL = /^\s*(?:answer|reply|response)\s*:\s*/i

export function stripPlanPreamble(text) {
  // 0) Normalize: drop zero-width chars that occasionally appear.
  let t = (text || '').replace(/[​-‍﻿]/g, '')

  // 0.1) Strip leading meta-narration lines BEFORE checking for a
  //      numbered-plan block. Gemma 4 frequently emits chain-of-thought
  //      ("The user is asking...", "I should...", "This is simple...")
  //      ABOVE the "Plan:" header + numbered list. If we don't peel
  //      those off first, the numbered-plan detector below won't fire
  //      (it requires "1." on the FIRST non-blank line).
  //
  //      Each line is one of:
  //        - pure meta line ("I should answer it.") → drop
  //        - label-prefix line ("Final answer in Russian: Это 4.") → keep
  //          the post-label content as the new head line
  //        - real prose line → stop stripping
  {
    const headLines = t.split('\n')
    let h = 0
    while (h < headLines.length) {
      const line = headLines[h].trim()
      if (!line) { h++; continue }

      // Label-prefix line: strip the label, keep the rest as a new head
      // line and STOP — the content after the label is the real start.
      const labelMatch = line.match(BARE_LABEL_LINE)
      if (labelMatch) {
        const after = line.slice(labelMatch[0].length).trim()
        if (after.length > 0) {
          headLines[h] = after
          break
        }
        h++
        continue
      }

      // META-prefix line: strip the meta prefix if it ends with a label-
      // style ":" or a short soft-marker like "Actually, ", keep the
      // tail; otherwise drop the line entirely as pure narration.
      const metaMatch = line.match(META_LINE)
      if (metaMatch) {
        const after = line.slice(metaMatch[0].length).trim()
        const isLabel = metaMatch[0].endsWith(':')
        const isSoft = metaMatch[0].length < 30 && /[,:.]\s*$/.test(metaMatch[0])
        if (after.length > 6 && (isLabel || isSoft)) {
          headLines[h] = after
          break
        }
        h++
        continue
      }

      if (FORMAT_NARRATION.test(line)) { h++; continue }
      // Tool-name chatter ("the recommend_next_lesson returned...")
      if (TOOL_NAME_RE.test(line) && /\b(returned|failed|completed|gave|provided|shows)\b/i.test(line)) { h++; continue }
      break
    }
    if (h > 0) t = headLines.slice(h).join('\n').trim()
  }

  // 0.2) Numbered-plan block at the (new) head. Gemma 4 sometimes opens with:
  //      "1. Answer in Russian.\n2. Keep it short.\n3. Use LaTeX ..."
  //      followed by the real reply (or nothing). If the first two non-
  //      blank lines both look like "<N>. <text>", strip the contiguous
  //      numbered block — those lines are *always* self-narration.
  //      Edge case: the LAST plan item often has the real reply mashed
  //      onto the same line ("3. Keep it short.Don't worry, mistakes...").
  //      Detect the "<period><uppercase|$|quote>" hand-off within the
  //      last plan line and keep everything after it.
  {
    const all = t.split('\n')
    const idxs = []
    for (let i = 0; i < all.length; i++) if (all[i].trim()) idxs.push(i)
    if (idxs.length >= 2 &&
        /^\s*1\.\s+\S/.test(all[idxs[0]]) &&
        /^\s*2\.\s+\S/.test(all[idxs[1]])) {
      let k = 0
      let lastBlockIdx = idxs[0]
      while (k < idxs.length && /^\s*\d+\.\s+\S/.test(all[idxs[k]])) {
        lastBlockIdx = idxs[k]
        k++
      }
      const lastLine = all[lastBlockIdx]
      // Try to split mashed plan-item + answer on the last plan line.
      // Pattern: "<N>. <plan text up to first .!?> <hand-off>"
      // Hand-off = "[.!?][A-Z|Cyrillic|$|"|emoji-leader]" with no space.
      const mashed = lastLine.match(
        /^\s*\d+\.\s+[^.!?\n]+[.!?]\s*([A-ZА-ЯҚҒҰҮӘӨҺІ\$"À-ɏ][^\n]*)$/
      )
      const rest = all.slice(lastBlockIdx + 1).join('\n').trim()
      t = mashed
        ? (mashed[1] + (rest ? '\n' + rest : '')).trim()
        : rest
    }
  }

  // 0.3) Strip bare-label preamble paragraphs ("Task: ...", "Plan: ...")
  //      and pure formatting narration ("Use $...$ for inline math").
  //      Apply repeatedly until no more matches at the head.
  for (let guard = 0; guard < 6; guard++) {
    const before = t.length
    t = t.replace(BARE_LABEL_LINE, '').replace(FORMAT_NARRATION, '').trimStart()
    if (t.length === before) break
  }

  // 0.4) Strip every "<Name>'s grade is …", "<Name>'s language is …"
  //      sentence anywhere in the lead-in. These are pure state leaks
  //      and never carry information the student should see.
  t = t.replace(NAME_FIELD_LEAK, '').trimStart()

  // 0.5) Transition-marker extraction. If the text contains a hand-off phrase
  //      ("I'll say:", "My response:", etc.), throw away everything before it.
  for (const re of TRANSITION) {
    const m = t.match(re)
    if (m && m.index !== undefined) {
      const after = t.slice(m.index + m[0].length).trim()
      if (after.length > 12) { t = after; break }
    }
  }

  // 1) "<draft>" ( parenthesized English translation ) [optional final answer]
  //    Gemma 4 sometimes drafts in the target language, adds an English
  //    translation in parens for "review", and optionally emits the
  //    final reply. Two variants:
  //      - "X" (translation) Y → keep Y (final answer wins)
  //      - "X" (translation)   → keep X (no separate final; X is it)
  const draftWithTail = t.match(/^[\s*\-•·]*"([^"]{6,1200})"\s*\([^)]{4,500}\)\s*([^"][\s\S]*?)\s*$/s)
  if (draftWithTail && draftWithTail[2].trim().length > 8) {
    t = draftWithTail[2].trim()
  } else {
    const draftNoTail = t.match(/^[\s*\-•·]*"([^"]{6,1200})"\s*\([^)]{4,500}\)\s*$/s)
    if (draftNoTail) t = draftNoTail[1].trim()
  }

  // 1.5) The "draft in quotes followed by the same sentence unquoted" pattern.
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
  // Strip a leading "Answer:" / "Reply:" / "Response:" label if one survived.
  out = out.replace(LEADING_ANSWER_LABEL, '').trim()
  // Handle the no-colon variant: `Answer "X".` → `X`
  const bareLabelQuoted = out.match(BARE_LABEL_QUOTED)
  if (bareLabelQuoted) out = bareLabelQuoted[1].trim()

  // 5) Final dedupe pass: if the cleaned text is the same sentence repeated
  //    back-to-back (e.g. `X.X.` or `X. X.`), collapse to one copy.
  //    Min length 10 (was 20) to catch short math replies like
  //    "$2 + 2 = 4$ болады!$2 + 2 = 4$ болады!" — 19 chars per half.
  const halfMatch = out.match(/^(.{10,500}[.!?])\s*\1$/s)
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
  //
  // No pre-conversation user turn at all. Two earlier attempts both
  // failed:
  //   (1) Full studentState JSON as a fake user turn → Gemma 4 echoed
  //       it verbatim ("freddy's grade is 2. freddy's language is
  //       english.")
  //   (2) Slim "(Reply in English. I'm at grade level 2.)" as a fake
  //       user turn → Gemma 4 treated it as a user *message* and
  //       answered it (echoing system-prompt text in response).
  // The fix is to keep ALL per-conversation context inside the system
  // instruction. The systemInstruction string is set per-request below
  // with the runtime language + grade substituted in.
  const contents = []
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
    //
    // Cap retries from the leak-detection path to 2 — if we still get
    // chain-of-thought after that, deliver what we have rather than
    // looping forever on a flaky turn.
    let cleanRetries = 0
    for (let turn = 0; turn < 6; turn++) {
      const stream = await client.models.generateContentStream({
        model: 'gemma-4-26b-a4b-it',
        contents,
        config: {
          // Per-request system instruction with the runtime lang + grade
          // appended. This is the safe place to put per-conversation
          // context — Gemma 4 treats systemInstruction differently from
          // user turns and is much less prone to echoing it back.
          systemInstruction: SYSTEM_PROMPT + perStudentContext(studentState),
          tools: GEMINI_TOOLS,
          maxOutputTokens: 1500,
          // 0.3 (was 0.7) — lower temperature halves the chain-of-thought
          // leak rate on Gemma 4 26B-A4B in practice. The reply is still
          // varied enough to feel natural without becoming a planning
          // narration.
          temperature: 0.3,
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
        const looksLikeLeak = cleaned && LEAK_SIGNAL.test(cleaned)
        if (cleaned && !looksLikeLeak) {
          write({ type: 'delta', text: cleaned })
        } else if (cleanRetries < 2) {
          // Either the scrubber stripped everything OR strong-signal
          // chain-of-thought phrases survived ("Once I have the state,
          // I will answer..."). Retry from a clean slate — do NOT push
          // the leaking model turn back into `contents`. Re-running with
          // the prior leak in context produced second-order leaks like
          // "The previous answer was '...'" — Gemma 4 explains itself
          // when it sees its own narration. Capped at 2 retries.
          //
          // The retry message is localized — an English "speak in my
          // language" hint causes Russian-speaking Gemma 4 to lapse into
          // English meta-narration about how it should reply, defeating
          // the purpose. The localized message reads like the child
          // asking a follow-up, appended onto the existing user turn so
          // it counts as part of the original question rather than a
          // separate message.
          cleanRetries++
          // Append the hint to the LAST user turn rather than adding a
          // new one. Two consecutive user turns confuse Gemma 4 — it
          // treats the second as a meta-instruction and replies to it.
          const lastUser = [...contents].reverse().find(c => c.role === 'user')
          if (lastUser) {
            lastUser.parts.push({ text: ' ' + retryHint(studentState) })
          } else {
            contents.push({ role: 'user', parts: [{ text: retryHint(studentState) }] })
          }
          continue
        } else if (cleaned) {
          // Out of retries — deliver whatever survived the scrubber so
          // the student sees something rather than a stuck stream.
          write({ type: 'delta', text: cleaned })
        }
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
