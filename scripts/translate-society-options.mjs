#!/usr/bin/env node
// One-shot translator. society.js was authored with `options: ['kk1','kk2','kk3','kk4']`
// (raw Kazakh strings only) on 239 questions, so English + Russian users saw
// answers in Kazakh — exactly what the user reported. This script:
//
//   • Parses each `options: [...] (no tri call)` block in src/data/society.js
//   • Asks Gemini Flash to translate the Kazakh strings to Russian + English
//   • Rewrites each block as `options: tri([...kk], [...ru], [...en])`
//
// Run once: `node scripts/translate-society-options.mjs`. Re-running on an
// already-translated file is a no-op (regex doesn't match tri() form).

import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { GoogleGenAI } from '@google/genai'

const FILE = path.resolve('src/data/society.js')
const MODEL = 'gemini-2.5-flash'

const src = await fs.readFile(FILE, 'utf-8')

// Find every `options: [ '...', '...', ... ]` that is NOT inside a tri( call.
// We anchor on the start-of-line indentation + literal `options:` so the
// regex is unambiguous; the JS source style writes each options literal on
// its own line.
const RX = /(\n[ \t]*options:\s*)\[\s*((?:'[^']*'\s*,?\s*)+)\]/g
const matches = [...src.matchAll(RX)]

if (!matches.length) {
  console.log('No bare options arrays found — nothing to translate.')
  process.exit(0)
}
console.log(`Found ${matches.length} bare options arrays. Translating in batches…`)

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) {
  console.error('GEMINI_API_KEY not set. Aborting.')
  process.exit(1)
}
const ai = new GoogleGenAI({ apiKey })

// Build the batch payload. Each entry is one question's options list.
const batches = []
const BATCH_SIZE = 20
for (let i = 0; i < matches.length; i += BATCH_SIZE) batches.push(matches.slice(i, i + BATCH_SIZE))

const out = []
let idx = 0
for (const batch of batches) {
  const items = batch.map((m, k) => {
    const arr = m[2].match(/'([^']*)'/g).map((s) => s.slice(1, -1))
    return { id: idx + k, kk: arr }
  })
  idx += batch.length
  const prompt = `You are translating multiple-choice answer options for a Kazakhstani K-12 social-studies app. Each item has a "kk" array (Kazakh, the source of truth) and you must produce parallel "ru" (Russian) and "en" (English) arrays of the same length. Keep the meaning faithful; use natural classroom-grade vocabulary. Don't paraphrase, don't add explanations.

Return ONLY valid JSON of the form: [{"id": <int>, "ru": [...], "en": [...]}, ...] with the same order and same array lengths as the input. No prose, no markdown fences.

Input:
${JSON.stringify(items, null, 2)}`
  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { temperature: 0.2, responseMimeType: 'application/json' },
  })
  const text = resp.text || resp.response?.text() || ''
  let parsed
  try { parsed = JSON.parse(text) } catch (e) {
    console.error('parse failed for batch', items[0].id, '—', text.slice(0, 200))
    throw e
  }
  for (const r of parsed) out[r.id] = { kk: items[r.id - (idx - batch.length)].kk, ru: r.ru, en: r.en }
  console.log(`  ✓ batch through #${idx}`)
}

// Stitch translations back into the source, scanning matches in reverse so
// later edits don't shift earlier indices.
let result = src
for (let i = matches.length - 1; i >= 0; i--) {
  const m = matches[i]
  const tr = out[i]
  if (!tr) continue
  const fmt = (arr) => '[' + arr.map((s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'").join(', ') + ']'
  const replacement = `${m[1]}tri(${fmt(tr.kk)}, ${fmt(tr.ru)}, ${fmt(tr.en)})`
  result = result.slice(0, m.index) + replacement + result.slice(m.index + m[0].length)
}

// society.js doesn't read q.optionsByLang anywhere; auto-detection in
// LessonPlayer handles the tri()'d form, so we don't need to add the flag.

await fs.writeFile(FILE, result)
console.log(`Rewrote ${FILE} — ${matches.length} options arrays now tri()-wrapped.`)
