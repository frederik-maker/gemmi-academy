// Lesson audit: walk every bundled G1-G3 unit, check structural integrity,
// sample real questions, flag anything that looks broken / age-inappropriate.
// Usage: node scripts/audit-lessons.mjs

import { subjects } from '../src/data/index.js'

const LANGS = ['kk', 'ru', 'en']
const issues = []
const samples = []

let totalUnits = 0, totalLessons = 0, totalQuestions = 0
const perGrade = { 1: { units: 0, lessons: 0, questions: 0 }, 2: { units: 0, lessons: 0, questions: 0 }, 3: { units: 0, lessons: 0, questions: 0 } }
const perCell = {} // `g${grade}-${subjectId}` → counts

function triOk(field, label) {
  if (!field || typeof field !== 'object') return [`${label} missing or not trilingual object`]
  const missing = LANGS.filter((l) => typeof field[l] !== 'string' || !field[l].trim())
  return missing.length ? [`${label} missing langs: ${missing.join(',')}`] : []
}

function auditQuestion(q, ctx) {
  const errs = []
  // Question type
  if (!['mcq', 'truefalse', 'image-mcq', 'typed'].includes(q.type)) {
    errs.push(`unknown type '${q.type}'`)
  }
  // Prompt
  errs.push(...triOk(q.prompt, 'prompt'))
  // Answer
  if (q.type === 'truefalse') {
    if (typeof q.answer !== 'boolean') errs.push(`truefalse answer must be boolean, got ${typeof q.answer}`)
  } else if (q.type === 'mcq' || q.type === 'image-mcq') {
    if (typeof q.answer !== 'number') {
      errs.push(`mcq answer must be number index, got ${typeof q.answer}`)
    } else {
      // Resolve options length
      let optsLen
      if (q.optionsByLang) {
        // options is tri() of arrays
        if (!q.options || typeof q.options !== 'object') {
          errs.push('optionsByLang but options not a tri object')
        } else {
          for (const l of LANGS) {
            if (!Array.isArray(q.options[l])) errs.push(`optionsByLang options.${l} not array`)
          }
          optsLen = q.options.en?.length
        }
      } else {
        if (!Array.isArray(q.options)) errs.push('options not an array')
        else optsLen = q.options.length
      }
      if (typeof optsLen === 'number' && (q.answer < 0 || q.answer >= optsLen)) {
        errs.push(`answer index ${q.answer} out of range for ${optsLen} options`)
      }
    }
  } else if (q.type === 'typed') {
    errs.push(...triOk(q.answer, 'typed-answer'))
  }
  // Tautology check: for non-optionsByLang options (same in all UIs), see if the
  // English prompt contains the correct option as a verbatim substring. Skip
  // legitimate cases where containment is the design of the question:
  //   - Reading comprehension passages: prompt starts with `Read:` or contains the
  //     answer in a quoted passage.
  //   - Fill-in-the-blank with verb hint: prompt ends with `(verb)` showing the
  //     base form of the inflection being tested.
  //   - Vocab translation hint: prompt has e.g. "(when)" giving the meaning.
  //   - forLangs unit: the EN tautology is intentional, kk/ru users learn from it.
  if ((q.type === 'mcq' || q.type === 'image-mcq') && !q.optionsByLang && Array.isArray(q.options) && !ctx.unitForLangs) {
    const enPrompt = q.prompt?.en || ''
    const correctOpt = String(q.options[q.answer] || '').toLowerCase().trim()
    if (correctOpt.length > 2 && /[a-z]/.test(correctOpt) && !/^[0-9.,$%+\-=/*x×÷^()\[\]{}π°<>≠≤≥√]+$/.test(correctOpt)) {
      const looksLikeReading = /^read:|"\s*[^"]{40,}\s*"/i.test(enPrompt)
      const looksLikeHintInParens = /\([a-zа-я ]+\)\s*$/i.test(enPrompt)
      const looksLikeMeansQuestion = /\bmeans?\b|→/.test(enPrompt)
      if (!looksLikeReading && !looksLikeHintInParens && !looksLikeMeansQuestion &&
          enPrompt.toLowerCase().includes(correctOpt)) {
        errs.push(`possible tautology: en prompt contains correct option '${q.options[q.answer]}'`)
      }
    }
  }
  return errs
}

function ageOk(grade, q) {
  // Soft heuristic for age-appropriateness. Flags clearly off-band content,
  // not a hard quality check. The user will eyeball samples themselves.
  const t = (q.prompt?.en || '').toLowerCase()
  if (grade === 1) {
    // Beginner ages 5-8. Should not have multi-digit ops > 2 digits or advanced topics.
    // Look for things like "calculus", "derivative", "stoichiometry", "USSR", "x^2", etc.
    const tooHard = /calculus|derivative|stoichiometry|integral|quadratic|x\^2|algebra|cosine|sine\b|tangent|photosynthesis|mitochondria|cellular respiration|ussr|soviet|nuclear|asharshylyk|famine/.test(t)
    if (tooHard) return [`G1 question may be too advanced: '${(q.prompt?.en || '').slice(0, 80)}'`]
  }
  if (grade === 3) {
    // Advanced 10-14. Should NOT be "What is 2+2" trivial.
    const tooEasy = /^what is [0-9]\s*\+\s*[0-9]\s*\?\s*$/i.test(t)
    if (tooEasy) return [`G3 question may be too easy: '${(q.prompt?.en || '').slice(0, 80)}'`]
  }
  return []
}

for (const sub of subjects) {
  for (const u of sub.units) {
    const grade = u.grade
    if (!grade || grade > 3) continue
    totalUnits++
    perGrade[grade].units++
    const key = `g${grade}-${sub.id}`
    perCell[key] = perCell[key] || { units: 0, lessons: 0, questions: 0 }
    perCell[key].units++

    if (u.forLangs && (!Array.isArray(u.forLangs) || u.forLangs.some((l) => !LANGS.includes(l)))) {
      issues.push(`Unit ${u.id}: invalid forLangs ${JSON.stringify(u.forLangs)}`)
    }
    // Unit titles/blurbs
    for (const e of triOk(u.title, `unit ${u.id} title`)) issues.push(e)
    if (u.blurb) for (const e of triOk(u.blurb, `unit ${u.id} blurb`)) issues.push(e)

    for (const l of u.lessons) {
      totalLessons++
      perGrade[grade].lessons++
      perCell[key].lessons++
      for (const e of triOk(l.title, `lesson ${l.id} title`)) issues.push(e)
      if (!Array.isArray(l.questions) || l.questions.length === 0) {
        issues.push(`lesson ${l.id} has no questions`)
        continue
      }
      l.questions.forEach((q, qi) => {
        totalQuestions++
        perGrade[grade].questions++
        perCell[key].questions++
        const errs = [
          ...auditQuestion(q, { subject: sub.id, grade, unit: u.id, lesson: l.id, idx: qi, unitForLangs: !!u.forLangs }),
          ...ageOk(grade, q),
        ]
        if (errs.length) {
          issues.push(`${l.id} Q${qi}: ${errs.join('; ')}`)
        }
      })
    }
  }
}

// ---------------- pick a diverse sample of 20+ for human eyeball ------------
const PICKS = [
  { subject: 'math',    grade: 1, slot: 0 },
  { subject: 'math',    grade: 1, slot: 1 },
  { subject: 'math',    grade: 2, slot: 0 },
  { subject: 'math',    grade: 2, slot: 1 },
  { subject: 'math',    grade: 3, slot: 0 },
  { subject: 'science', grade: 1, slot: 0 },
  { subject: 'science', grade: 1, slot: 1 },
  { subject: 'science', grade: 2, slot: 0 },
  { subject: 'science', grade: 2, slot: 1 },
  { subject: 'science', grade: 3, slot: 0 },
  { subject: 'history', grade: 1, slot: 0 },
  { subject: 'history', grade: 2, slot: 0 },
  { subject: 'history', grade: 2, slot: 1 },
  { subject: 'history', grade: 3, slot: 0 },
  { subject: 'history', grade: 3, slot: 1 },
  { subject: 'society', grade: 1, slot: 0 },
  { subject: 'society', grade: 2, slot: 0 },
  { subject: 'society', grade: 2, slot: 1 },
  { subject: 'society', grade: 3, slot: 0 },
  { subject: 'society', grade: 3, slot: 1 },
  { subject: 'english', grade: 1, slot: 0 },
  { subject: 'english', grade: 2, slot: 0 },
  { subject: 'english', grade: 3, slot: 0 },
]
for (const p of PICKS) {
  const sub = subjects.find((s) => s.id === p.subject)
  const units = sub.units.filter((u) => u.grade === p.grade)
  if (units.length <= p.slot) continue
  const u = units[p.slot]
  const l = u.lessons[Math.min(1, u.lessons.length - 1)] // middle-ish lesson
  if (!l) continue
  const q = l.questions[Math.floor(l.questions.length / 2)]
  samples.push({ subject: p.subject, grade: p.grade, unit: u.id, lesson: l.id, lessonTitle: l.title.en, question: q })
}

// ---------------- print report ---------------------------------------------
console.log('================= STRUCTURE =================')
console.log(`Total: ${totalUnits} units, ${totalLessons} lessons, ${totalQuestions} questions`)
for (const g of [1, 2, 3]) {
  console.log(`  G${g}: ${perGrade[g].units} units, ${perGrade[g].lessons} lessons, ${perGrade[g].questions} questions`)
}
console.log()
console.log('Lessons per (grade, subject):')
for (const g of [1, 2, 3]) {
  const row = subjects.map((s) => {
    const c = perCell[`g${g}-${s.id}`] || { lessons: 0 }
    return `${s.id}=${c.lessons}`
  }).join('  ')
  console.log(`  G${g}: ${row}`)
}

console.log()
console.log(`================= ISSUES (${issues.length}) =================`)
if (issues.length === 0) console.log('(none)')
else for (const i of issues.slice(0, 30)) console.log('  - ' + i)
if (issues.length > 30) console.log(`  ... and ${issues.length - 30} more`)

console.log()
console.log(`================= SAMPLES (${samples.length}) =================`)
for (const s of samples) {
  console.log(`\n[G${s.grade} ${s.subject}] ${s.lesson} — ${s.lessonTitle}`)
  console.log(`  KK: ${s.question.prompt?.kk}`)
  console.log(`  RU: ${s.question.prompt?.ru}`)
  console.log(`  EN: ${s.question.prompt?.en}`)
  if (s.question.options) {
    const opts = s.question.optionsByLang
      ? s.question.options.en
      : s.question.options
    const ans = s.question.options && s.question.optionsByLang
      ? s.question.options.en[s.question.answer]
      : s.question.options[s.question.answer]
    console.log(`  Options: ${JSON.stringify(opts)}`)
    console.log(`  Correct: ${JSON.stringify(ans)} (index ${s.question.answer})`)
  } else if (s.question.type === 'truefalse') {
    console.log(`  T/F answer: ${s.question.answer}`)
  }
}
