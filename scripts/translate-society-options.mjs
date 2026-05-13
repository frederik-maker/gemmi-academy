#!/usr/bin/env node
// One-shot translator. society.js was authored with `options: ['kk1','kk2','kk3','kk4']`
// (raw Kazakh strings only) on 239 questions, so English + Russian users saw
// answers in Kazakh — exactly what the user reported. This script:
//
//   • Parses each `options: [...]` block in src/data/society.js
//   • Asks Claude Opus 4.7 to translate the Kazakh strings to Russian + English
//   • Rewrites each block as `options: tri([...kk], [...ru], [...en])`
//
// Why Opus 4.7 and not a smaller model: kk → ru/en translation for K-12
// social studies needs careful handling of cultural terms, idiomatic
// phrasing, and the implicit "right answer" semantics across multiple
// choice. Flash-class models botched a few of the trickier cases.
//
// Run once: `node scripts/translate-society-options.mjs`. Idempotent — the
// regex only matches bare arrays, so re-running on the already-translated
// file does nothing.

import fs from 'node:fs/promises'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

// Load .env.local without pulling in dotenv (avoids a peer-dep dance for a
// one-shot script). We only need ANTHROPIC_API_KEY.
try {
  const env = await fs.readFile(path.resolve('.env.local'), 'utf-8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
} catch { /* no .env.local — must be set in shell */ }

const FILE = path.resolve('src/data/society.js')
const MODEL = 'claude-opus-4-7'
const BATCH_SIZE = 15  // smaller batches for Opus — each call is slower but better

const src = await fs.readFile(FILE, 'utf-8')

// Anchor on indentation + literal `options:` followed by `[` (no `tri(` form).
// society.js writes each options literal on its own line.
const RX = /(\n[ \t]*options:\s*)\[\s*((?:'[^']*'\s*,?\s*)+)\]/g
const matches = [...src.matchAll(RX)]

if (!matches.length) {
  console.log('No bare options arrays found — nothing to translate.')
  process.exit(0)
}
console.log(`Found ${matches.length} bare options arrays. Translating in batches of ${BATCH_SIZE} via ${MODEL}…`)

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set. Aborting.')
  process.exit(1)
}
const client = new Anthropic()

const batches = []
for (let i = 0; i < matches.length; i += BATCH_SIZE) batches.push(matches.slice(i, i + BATCH_SIZE))

const out = []
let idx = 0
for (const batch of batches) {
  const items = batch.map((m, k) => {
    const arr = m[2].match(/'([^']*)'/g).map((s) => s.slice(1, -1))
    return { id: idx + k, kk: arr }
  })
  const batchStart = idx
  idx += batch.length

  // Pass surrounding context too — the question prompt and answer index —
  // so the model can pick translations that match the question's intent.
  const enrichedItems = items.map((it) => {
    const ctxStart = Math.max(0, batch[it.id - batchStart].index - 200)
    const ctxEnd = Math.min(src.length, batch[it.id - batchStart].index + batch[it.id - batchStart][0].length + 100)
    return { ...it, _context: src.slice(ctxStart, ctxEnd).trim() }
  })

  const prompt = `You are translating multiple-choice answer options for a Kazakhstani K-12 social-studies app (grades 1–3). Each item has:
  • "kk": the Kazakh answer options (source of truth, do not change)
  • "_context": the source code around the question so you can see the prompt and which index is the correct answer

For each item, produce parallel "ru" (Russian) and "en" (English) arrays of the SAME LENGTH as kk. Match meaning faithfully, use natural classroom vocabulary, keep answer plausibility in line with the original (don't make wrong options obviously wrong in translation). For proper nouns / place names that are Kazakh-specific (Astana, Almaty, Қазақстан → Kazakhstan), use the standard English/Russian form.

Return ONLY a JSON array of the form:
  [{"id": 0, "ru": [...], "en": [...]}, ...]

Same order as input, same array lengths. No prose, no markdown fences, no commentary.

Input:
${JSON.stringify(enrichedItems, null, 2)}`

  let attempt = 0
  while (true) {
    attempt++
    try {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = resp.content.find((c) => c.type === 'text')?.text || ''
      // Strip any code-fence Opus might wrap (it's good but not perfect).
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
      const parsed = JSON.parse(cleaned)
      for (const r of parsed) {
        const orig = items.find((it) => it.id === r.id)
        if (!orig) continue
        if (!Array.isArray(r.ru) || r.ru.length !== orig.kk.length) {
          throw new Error(`length mismatch id=${r.id} (kk=${orig.kk.length} ru=${r.ru?.length})`)
        }
        if (!Array.isArray(r.en) || r.en.length !== orig.kk.length) {
          throw new Error(`length mismatch id=${r.id} (kk=${orig.kk.length} en=${r.en?.length})`)
        }
        out[r.id] = { kk: orig.kk, ru: r.ru, en: r.en }
      }
      console.log(`  ✓ batch through #${idx}`)
      break
    } catch (e) {
      if (attempt >= 3) throw e
      console.warn(`  ! batch #${idx} attempt ${attempt} failed: ${e.message?.slice(0, 100)} — retrying`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
}

// Stitch translations back in reverse so indices don't shift.
let result = src
for (let i = matches.length - 1; i >= 0; i--) {
  const m = matches[i]
  const tr = out[i]
  if (!tr) {
    console.warn(`missing translation at index ${i}, skipping`)
    continue
  }
  const fmt = (arr) => '[' + arr.map((s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'").join(', ') + ']'
  const replacement = `${m[1]}tri(${fmt(tr.kk)}, ${fmt(tr.ru)}, ${fmt(tr.en)})`
  result = result.slice(0, m.index) + replacement + result.slice(m.index + m[0].length)
}

await fs.writeFile(FILE, result)
console.log(`Rewrote ${FILE} — ${matches.length} options arrays now tri()-wrapped via ${MODEL}.`)
