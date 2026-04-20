// Lazy-load pack files (per subject + grade) from /public/packs/.
// G1-G3 ship bundled inside the subject modules. G4-G5 come from MMLU-Pro
// chunked JSON files so we don't pay their parse cost on cold start.

import { findSubject, unitsForGrade as bundledUnitsForGrade, registerLazyUnits } from './index.js'

const cache = new Map()       // key: `${subjectId}-${grade}` → units[]
const inflight = new Map()    // dedupe concurrent requests
let manifestPromise = null

export function getManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('/packs/manifest.json')
      .then((r) => (r.ok ? r.json() : { packs: [], totalQuestions: 0 }))
      .catch(() => ({ packs: [], totalQuestions: 0 }))
  }
  return manifestPromise
}

export async function loadUnits(subjectId, grade) {
  const key = `${subjectId}-${grade}`
  if (cache.has(key)) return cache.get(key)

  // Bundled units win (G1-G3).
  const bundled = bundledUnitsForGrade(findSubject(subjectId), grade)
  if (bundled.length && bundled[0].grade === grade) {
    cache.set(key, bundled)
    return bundled
  }

  if (inflight.has(key)) return inflight.get(key)
  const promise = fetch(`/packs/${subjectId}-g${grade}.json`)
    .then(async (r) => {
      if (!r.ok) throw new Error('pack not found')
      const pack = await r.json()
      cache.set(key, pack.units)
      registerLazyUnits(subjectId, pack.units)
      return pack.units
    })
    .catch(() => {
      // Fall back to whatever bundled has, even if grade mismatch.
      cache.set(key, bundled)
      return bundled
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

// Synchronous accessor for already-cached units (used by lesson player).
export function unitsCached(subjectId, grade) {
  return cache.get(`${subjectId}-${grade}`) || null
}

// Find a lesson by ID across bundled + every cached pack.
export function findLessonInCaches(lessonId) {
  // Bundled subjects
  const all = []
  for (const v of cache.values()) all.push(...v)
  for (const u of all) {
    const l = u.lessons?.find((l) => l.id === lessonId)
    if (l) return l
  }
  return null
}

// Pre-warm a pack so the lesson player can find lessons by ID even after refresh.
export async function prewarm(subjectId, grade) {
  return loadUnits(subjectId, grade)
}

export function clearCache() {
  cache.clear()
  manifestPromise = null
}
