// Shared definitions for the AI tutor's tool kit. The schemas live here so the
// client can describe them in the API call AND render nice tool-call previews,
// while the server (vite middleware) executes them against the student state
// payload that the client sends with every request.

import { subjects } from '../data/index.js'

export const TUTOR_TOOLS = [
  {
    name: 'get_student_state',
    description:
      "Look up the current student's full progress: name, age band/grade, language, XP, daily streak, hearts, gems, total lessons completed, recent lesson titles, and which subject they're weakest in. Call this FIRST whenever the student asks something personal (\"how am I doing?\", \"what should I learn?\", \"why am I stuck?\").",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'find_lessons',
    description:
      "Search the curriculum for lessons matching a subject and/or keyword. Use this to recommend what to study next, or to point the student at a specific concept they want help with. Returns up to 6 matching lessons with their IDs, titles, and grade.",
    input_schema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          enum: ['math', 'science', 'history', 'society', 'english', 'any'],
          description: "Which subject to search in. Use 'any' to search across all.",
        },
        keyword: {
          type: 'string',
          description: "Optional keyword to match against lesson and unit titles (case-insensitive). e.g. 'multiplication', 'cells', 'Khanate'.",
        },
        max: { type: 'number', description: 'Max results to return (default 6).' },
      },
      required: ['subject'],
    },
  },
  {
    name: 'recommend_next_lesson',
    description:
      "Pick the single most useful next lesson for this student. Considers their grade, what they've already completed, and which subjects they've been neglecting. Returns one lesson with a 1-sentence rationale.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generate_practice_question',
    description:
      "Produce ONE new practice multiple-choice question, age-appropriate for the student's grade band. Use when they say 'quiz me', 'test me', 'one more'. Shape: { prompt, options (exactly 4), correctIndex, why_correct }. Do NOT reveal the correct answer in `prompt`.\n\nCRITICAL difficulty calibration by grade, DO NOT IGNORE:\n- grade 1: counting, single shapes, picture recognition. e.g. 'How many ⭐⭐⭐?'\n- grade 2: 2-digit arithmetic, halves/quarters, vocabulary in pictures. e.g. '14 − 6 = ?'\n- grade 3: multiplication, percents, basic algebra, animal cell parts. e.g. '12 × 8 = ?' or 'What does a mitochondrion do?'\n- grade 4: high-school math (quadratics, trig), stoichiometry, organic chem intro, dated history with cause/effect. e.g. 'Solve $x^2 - 5x + 6 = 0$' or 'In the reaction $2H_2 + O_2 \\to 2H_2O$, how many moles of water from 4 mol $H_2$?'\n- grade 5: undergrad-level math/science. multivar calc, organic synthesis, advanced topics. e.g. 'Compute $\\int_0^\\pi \\sin^2 x \\, dx$'.\n\nABSOLUTE RULE: a high-school student (grade 4) MUST NOT receive '24 × 3' or 'what's 5 + 7', that's grade 1-2 material. If you can't think of a grade-appropriate question for the topic, pick a different topic. NEVER lowball.",
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'What the question is about. For high-school/adult students this should be a real curriculum topic, not arithmetic.' },
        difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: '"easy" within the grade band (NOT relative to all students). Easy for grade 4 is still high school material.' },
        prompt: { type: 'string', description: 'The question text. Use $...$ LaTeX for math at grade 3+; required for math at grade 4+.' },
        options: { type: 'array', items: { type: 'string' }, description: 'Exactly four answer options, plausibly distinct, no obvious gimmes.' },
        correctIndex: { type: 'number', description: 'Which option (0-3) is correct.' },
        why_correct: { type: 'string', description: 'One sentence explaining why, actually teach, don\'t just state the answer.' },
      },
      required: ['topic', 'difficulty', 'prompt', 'options', 'correctIndex', 'why_correct'],
    },
  },
]

// ---- Server-side executors (called from the Vite middleware) ---------------
// They take the tool input + the student state payload and return JSON-able
// content that we hand back to Gemini as the tool_result.

const subjectIdsByEmoji = (sub) => `${sub.emoji} ${sub.id}`

function flatLessons(subjectFilter, gradeFilter, lang) {
  const list = []
  for (const s of subjects) {
    if (subjectFilter && subjectFilter !== 'any' && s.id !== subjectFilter) continue
    for (const u of s.units) {
      if (gradeFilter != null && u.grade !== gradeFilter) continue
      // Skip units whose forLangs excludes the current UI language —
      // tutor shouldn't recommend vocab-translation English lessons to
      // an English-UI student, etc.
      if (u.forLangs && lang && !u.forLangs.includes(lang)) continue
      for (const l of u.lessons) {
        if (l.forLangs && lang && !l.forLangs.includes(lang)) continue
        list.push({
          subject: s.id,
          subjectEmoji: s.emoji,
          unitTitle: u.title,
          lessonId: l.id,
          lessonTitle: l.title,
          grade: u.grade,
        })
      }
    }
  }
  return list
}

export function executeTool(name, input, studentState, manifestPacks = []) {
  if (name === 'get_student_state') {
    const completedIds = Object.keys(studentState?.completedLessons || {})
    const subjectBreakdown = {}
    for (const sub of subjects) {
      const ofMine = []
      for (const u of sub.units) {
        if (u.grade !== studentState?.grade) continue
        for (const l of u.lessons) {
          ofMine.push({ id: l.id, done: !!studentState?.completedLessons?.[l.id] })
        }
      }
      const done = ofMine.filter((x) => x.done).length
      subjectBreakdown[sub.id] = { lessons: ofMine.length, done, pctDone: ofMine.length ? Math.round((done / ofMine.length) * 100) : 0 }
    }
    // Trim struggles to a compact form the model can scan. Keep the 8 most
    // recent, drop options arrays, shorten the question to ~140 chars.
    const struggles = (studentState?.recentStruggles || []).slice(0, 8).map((x) => ({
      subject: x.subject,
      lessonTitle: x.lessonTitle,
      question: typeof x.question === 'string' && x.question.length > 140
        ? x.question.slice(0, 140) + '…'
        : x.question,
      wrongAnswer: x.wrongAnswer,
      correctAnswer: x.correctAnswer,
      minutesAgo: x.ts ? Math.round((Date.now() - x.ts) / 60000) : null,
    }))
    return {
      name: studentState?.profile?.name || 'student',
      grade: studentState?.grade,
      gradeLabel: { 1: 'Beginner (ages 5-8)', 2: 'Intermediate (ages 8-10)', 3: 'Advanced (ages 10-14)', 4: 'High school (ages 14-18)', 5: 'College / adult (18+)' }[studentState?.grade],
      language: studentState?.lang,
      xp: studentState?.xp || 0,
      streak: studentState?.streak || 0,
      hearts: studentState?.hearts || 0,
      gems: studentState?.gems || 0,
      totalLessonsCompleted: completedIds.length,
      recentLessons: completedIds.slice(-5),
      perSubject: subjectBreakdown,
      recentStruggles: struggles,
      // The lesson/question the student was looking at when they opened the
      // chat (if any) — set by LessonPlayer through TutorChat's `context` prop.
      activeContext: studentState?.context || null,
    }
  }

  if (name === 'find_lessons') {
    const grade = studentState?.grade ?? 2
    const lang = studentState?.lang
    const all = flatLessons(input.subject, grade, lang)
    let filtered = all
    if (input.keyword) {
      const kw = input.keyword.toLowerCase()
      filtered = all.filter((l) =>
        Object.values(l.lessonTitle).some((t) => t.toLowerCase().includes(kw)) ||
        Object.values(l.unitTitle).some((t) => t.toLowerCase().includes(kw))
      )
    }
    return filtered.slice(0, input.max ?? 6)
  }

  if (name === 'recommend_next_lesson') {
    const grade = studentState?.grade ?? 2
    const lang = studentState?.lang
    const completed = studentState?.completedLessons || {}
    const langOk = (entity) => !entity?.forLangs || !lang || entity.forLangs.includes(lang)
    // Find subject with the lowest completion ratio at this grade.
    let weakestSub = null
    let weakestRatio = 2
    for (const s of subjects) {
      const u = s.units.filter((u) => u.grade === grade && langOk(u))
      if (!u.length) continue
      const lessons = u.flatMap((x) => x.lessons.filter(langOk))
      const total = lessons.length
      const done = lessons.filter((l) => completed[l.id]).length
      const ratio = total ? done / total : 1
      if (ratio < weakestRatio) {
        weakestRatio = ratio
        weakestSub = s
      }
    }
    if (!weakestSub) return { error: 'no_content' }
    const nextLesson = weakestSub.units
      .filter((u) => u.grade === grade && langOk(u))
      .flatMap((u) => u.lessons.filter(langOk).map((l) => ({ unit: u, lesson: l })))
      .find(({ lesson }) => !completed[lesson.id])
    if (!nextLesson) return { error: 'all_done' }
    return {
      subject: weakestSub.id,
      subjectEmoji: weakestSub.emoji,
      unitTitle: nextLesson.unit.title,
      lessonId: nextLesson.lesson.id,
      lessonTitle: nextLesson.lesson.title,
      rationale: `Lowest completion in this grade (${Math.round(weakestRatio * 100)}% done).`,
    }
  }

  if (name === 'generate_practice_question') {
    // Gemini produced the question itself; we just echo it back. The client
    // renders it as an interactive card.
    return { ok: true, ...input }
  }

  return { error: `unknown_tool:${name}` }
}
