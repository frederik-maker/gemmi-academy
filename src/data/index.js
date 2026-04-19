import { math } from './math.js'
import { science } from './science.js'
import { history } from './history.js'
import { society } from './society.js'
import { english } from './english.js'

export const subjects = [math, science, history, society, english]

// Helpers
export const findSubject = (id) => subjects.find((s) => s.id === id)
export const findUnit = (subjectId, unitId) => findSubject(subjectId)?.units.find((u) => u.id === unitId)
// Mutable side-cache of units loaded from /packs/ JSON, keyed by subjectId.
// Populated by packs.loadUnits — kept here so findLesson can see lessons that
// came from lazy-loaded packs.
const lazyUnits = new Map() // subjectId -> Array<{ id, grade, lessons, title, blurb }>

export const registerLazyUnits = (subjectId, units) => {
  const existing = lazyUnits.get(subjectId) || []
  const merged = [...existing]
  for (const u of units) {
    if (!merged.some((m) => m.id === u.id)) merged.push(u)
  }
  lazyUnits.set(subjectId, merged)
}

export const findLesson = (lessonId) => {
  for (const s of subjects) {
    for (const u of s.units) {
      const l = u.lessons.find((l) => l.id === lessonId)
      if (l) return { subject: s, unit: u, lesson: l }
    }
    const lazy = lazyUnits.get(s.id) || []
    for (const u of lazy) {
      const l = u.lessons.find((l) => l.id === lessonId)
      if (l) return { subject: s, unit: u, lesson: l }
    }
  }
  return null
}

export const allLessonsFor = (subjectId) => {
  const s = findSubject(subjectId)
  if (!s) return []
  return s.units.flatMap((u) => u.lessons.map((l) => ({ ...l, unitId: u.id })))
}

// Units filtered by grade band — strict (no silent fall-back).
// If a subject has no bundled units at this grade, the caller will lazy-fetch
// the MMLU pack via packs.loadUnits. If neither exists, the subject is hidden
// from the Home grid (so adults don't see kindergarten English by accident).
export const unitsForGrade = (subject, grade) => {
  if (!subject) return []
  return subject.units.filter((u) => u.grade === grade)
}

// Lessons and units can opt out of specific UI languages with
// `forLangs: ['kk', 'ru']`. Pure vocab-translation English lessons aren't
// useful when the UI itself is English, so they're hidden for EN users.
// Default (no field) = visible in every language.
const visibleIn = (entity, lang) =>
  !entity?.forLangs || entity.forLangs.includes(lang)

export const filterLessonsForLang = (lessons, lang) =>
  (lessons || []).filter((l) => visibleIn(l, lang))

export const filterUnitsForLang = (units, lang) =>
  (units || [])
    .filter((u) => visibleIn(u, lang))
    .map((u) => ({ ...u, lessons: filterLessonsForLang(u.lessons, lang) }))
    .filter((u) => u.lessons.length > 0)

export const lessonsForGrade = (subjectId, grade) => {
  const s = findSubject(subjectId)
  if (!s) return []
  return unitsForGrade(s, grade).flatMap((u) => u.lessons.map((l) => ({ ...l, unitId: u.id })))
}

export const flatLessons = subjects.flatMap((s) =>
  s.units.flatMap((u) =>
    u.lessons.map((l) => ({ subjectId: s.id, unitId: u.id, lessonId: l.id }))
  )
)
