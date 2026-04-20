import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Loader2, Lock, ArrowRight } from 'lucide-react'
import { findSubject, filterUnitsForLang } from '../data/index.js'
import { loadUnits } from '../data/packs.js'
import { useStore } from '../store.js'
import { t } from '../i18n.js'
import LessonNode from '../components/LessonNode.jsx'
import Mascot from '../components/Mascot.jsx'

const offsetPattern = [0, 60, 100, 60, 0, -60, -100, -60]

export default function SubjectMap() {
  const { subjectId } = useParams()
  const subject = findSubject(subjectId)
  const navigate = useNavigate()
  const lang = useStore((s) => s.lang) || 'en'
  const grade = useStore((s) => s.grade) || 2
  const completed = useStore((s) => s.completedLessons)
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [skipTarget, setSkipTarget] = useState(null) // lesson id pending skip-ahead confirmation

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadUnits(subjectId, grade).then((u) => {
      if (!cancelled) {
        // Filter units/lessons that opt out of the current UI language.
        // E.g. "Dog means Dog" vocab-translation lessons are hidden when
        // the UI itself is English.
        setUnits(filterUnitsForLang(u || [], lang))
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [subjectId, grade, lang])

  if (!subject) return <div className="mt-6">404</div>

  let lessonIdx = 0
  const flat = units.flatMap((u) => u.lessons)
  // Locked-by-default progression inside each unit; tapping a locked lesson
  // pops a confirmation modal so you can skip ahead (Duolingo style).

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => navigate('/learn')}
          className="w-10 h-10 grid place-items-center rounded-full bg-white border border-ink-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="text-xs font-bold text-ink-500">{t('yourLessonPath', lang)}</div>
          <h1 className="text-xl font-extrabold text-ink-900">{subject.title[lang]} {subject.emoji}</h1>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 text-ink-500">
          <Loader2 className="w-8 h-8 animate-spin text-steppe-500" />
          <div className="mt-3 text-sm font-extrabold">{t('loadingPack', lang)}</div>
        </div>
      )}
      <div className="space-y-8 pb-10">
        {!loading && units.map((unit, uIdx) => {
          const doneInUnit = unit.lessons.filter((l) => completed[l.id]).length
          const unitDone = doneInUnit === unit.lessons.length
          // Find first incomplete lesson within THIS unit so each unit has its own START.
          const firstIncompleteIdx = unit.lessons.findIndex((l) => !completed[l.id])
          return (
            <section key={unit.id}>
              <div className="rounded-2xl text-white px-4 py-3 mb-4"
                   style={{ background: subject.hex, boxShadow: '0 5px 0 0 rgba(0,0,0,0.15)' }}>
                <div className="text-xs font-bold opacity-80 flex items-center gap-2">
                  <span>{t('unit', lang)} {uIdx + 1}{unitDone ? ' · ✓' : ''}</span>
                  <span className="ml-auto opacity-90">{doneInUnit}/{unit.lessons.length}</span>
                </div>
                <div className="text-base font-extrabold flex items-center gap-2">
                  <span className="text-xl">{unit.icon || subject.emoji}</span>
                  {unit.title[lang]}
                </div>
                {unit.blurb?.[lang] && !/MMLU/i.test(unit.blurb[lang]) && (
                  <div className="text-xs opacity-80 font-semibold">{unit.blurb[lang]}</div>
                )}
              </div>
              <div className="space-y-7">
                {unit.lessons.map((lesson, lIdx) => {
                  const isDone = !!completed[lesson.id]
                  // Within a unit, lessons unlock sequentially. Tapping a
                  // locked node opens the skip-ahead confirmation.
                  const isLocked =
                    !isDone && firstIncompleteIdx !== -1 && lIdx > firstIncompleteIdx
                  const isCurrent = lIdx === firstIncompleteIdx
                  const handleClick = () => {
                    if (isLocked) {
                      setSkipTarget({ lesson, unit })
                    } else {
                      navigate(`/learn/lesson/${lesson.id}`)
                    }
                  }
                  const node = (
                    <div className="flex justify-center">
                      <LessonNode
                        icon={lesson.icon || unit.icon || subject.emoji}
                        color={subject.hex}
                        label={lesson.title[lang]}
                        locked={isLocked}
                        completed={isDone}
                        current={isCurrent}
                        stars={completed[lesson.id]?.stars || 0}
                        offset={offsetPattern[lessonIdx % offsetPattern.length]}
                        onClick={handleClick}
                      />
                    </div>
                  )
                  lessonIdx++
                  return (
                    <motion.div
                      key={lesson.id}
                      initial={{ opacity: 0, y: 12 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: lIdx * 0.04 }}
                      className="relative z-0"
                    >
                      {isCurrent && (
                        <div className="absolute left-1/2 -translate-x-1/2 -top-9 z-10"
                             style={{ transform: `translate(calc(-50% + ${offsetPattern[(lessonIdx - 1) % offsetPattern.length]}px), 0)` }}>
                          <div className="bg-white border-2 border-ink-200 rounded-2xl px-3 py-1 text-xs font-extrabold text-ink-900 shadow-cartoonHover">
                            {t('start_', lang).toUpperCase()}
                          </div>
                          <div className="w-3 h-3 bg-white border-r-2 border-b-2 border-ink-200 rotate-45 mx-auto -mt-1.5" />
                        </div>
                      )}
                      {node}
                    </motion.div>
                  )
                })}
              </div>
            </section>
          )
        })}
        <div className="mt-12 text-center text-ink-400 text-sm font-bold">
          🐾 {subject.title[lang]} • {flat.length} {t('lesson', lang)}
        </div>
        <div className="flex justify-center -mt-2">
          <Mascot size={120} mood="happy" />
        </div>
      </div>

      <AnimatePresence>
        {skipTarget && (
          <motion.div
            className="fixed inset-0 z-[100] bg-black/60 flex items-end sm:items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setSkipTarget(null)}
          >
            <motion.div
              className="w-full max-w-md bg-white rounded-3xl p-6"
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid place-items-center w-14 h-14 rounded-full bg-sun-100 text-sun-700 mx-auto">
                <Lock className="w-7 h-7" strokeWidth={3} />
              </div>
              <h3 className="mt-4 text-xl font-extrabold text-ink-900 text-center">
                {lang === 'kk' ? 'Алға өтесің бе?' : lang === 'ru' ? 'Перепрыгнуть вперёд?' : 'Skip ahead?'}
              </h3>
              <p className="mt-2 text-sm font-semibold text-ink-500 text-center">
                {lang === 'kk'
                  ? 'Алдыңғы сабақтарды өткізіп, бірден осы сабаққа кір. Қажет болса, артқа қайтуға болады.'
                  : lang === 'ru'
                  ? 'Пропустить предыдущие уроки и начать сразу с этого. Можно вернуться позже.'
                  : 'Jump straight into this lesson and skip the ones before it. You can always come back.'}
              </p>
              <div className="mt-2 rounded-2xl bg-ink-50 px-4 py-3 text-center">
                <div className="text-xs font-bold text-ink-500">{skipTarget.unit.title[lang]}</div>
                <div className="text-base font-extrabold text-ink-900">{skipTarget.lesson.title[lang]}</div>
              </div>
              <div className="mt-5 flex gap-3">
                <button onClick={() => setSkipTarget(null)} className="btn-ghost flex-1">
                  {t('stay', lang)}
                </button>
                <button
                  onClick={() => {
                    const id = skipTarget.lesson.id
                    setSkipTarget(null)
                    navigate(`/learn/lesson/${id}`)
                  }}
                  className="btn-primary flex-1"
                >
                  {lang === 'kk' ? 'Алға өту' : lang === 'ru' ? 'Перейти' : 'Skip ahead'} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
