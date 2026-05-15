import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Heart, Check, Gem, Loader2, Sparkles } from 'lucide-react'
import { findLesson, subjects } from '../data/index.js'
import { loadUnits } from '../data/packs.js'
import { useStore } from '../store.js'
import { t } from '../i18n.js'
import ProgressBar from '../components/ProgressBar.jsx'
import LatexText from '../components/LatexText.jsx'
import TutorChat from '../components/TutorChat.jsx'

// Pre-built auto-ask prompts the LessonPlayer hands to TutorChat when the
// student opens the chat from inside a question. Kept here, not in TutorChat,
// because the prompts are specific to the lesson-question flow.
// We embed the question text + options into the prompt rather than rely on
// studentState.context — the cloud agent gets <student_state> JSON in a
// preface message, but small chats often skip past it. Inlining the
// question keeps the model anchored on what we're actually discussing.
const ASK_PROMPTS = {
  question: {
    kk: (q, opts) => `Мынау сұрақ:\n\n"${q}"${opts ? `\n\nНұсқалар: ${opts}` : ''}\n\nБірге талдайық — не сұрап тұр, қалай ойлау керек?`,
    ru: (q, opts) => `Вот вопрос:\n\n«${q}»${opts ? `\n\nВарианты: ${opts}` : ''}\n\nПомоги разобрать: что спрашивают и как рассуждать?`,
    en: (q, opts) => `Here's the question I'm stuck on:\n\n"${q}"${opts ? `\n\nOptions: ${opts}` : ''}\n\nWalk me through it — what's it actually asking, and how should I think about it?`,
  },
  // Wrong-answer prompt. Earlier wording ("Explain where I went wrong")
  // got purely-empathic replies — Gemmi would say "don't worry, mistakes
  // are how we learn!" and never actually explain why the right answer
  // is right. Be explicit: skip the consolation, give the reasoning.
  wrong: {
    kk: (q, opts, picked, correct) => `Сұрақ:\n\n"${q}"${opts ? `\n\nНұсқалар: ${opts}` : ''}\n\nМен «${picked}» дедім, бірақ дұрысы «${correct}» екен. Жұбатпа — неге дұрыс жауап «${correct}» болатынын 1–2 қысқа сөйлеммен түсіндір. «Қателіктер — үйренудің бір бөлігі» деген жалпы сөзді айтпа.`,
    ru: (q, opts, picked, correct) => `Вопрос:\n\n«${q}»${opts ? `\n\nВарианты: ${opts}` : ''}\n\nЯ выбрал «${picked}», правильный ответ — «${correct}». Не утешай — объясни 1–2 короткими фразами, почему правильный ответ — «${correct}». Без фраз «не переживай» и «ошибки помогают учиться».`,
    en: (q, opts, picked, correct) => `Question:\n\n"${q}"${opts ? `\n\nOptions: ${opts}` : ''}\n\nI picked "${picked}" but the right answer is "${correct}". Skip the "don't worry" and explain in 1–2 short sentences WHY "${correct}" is right. No general "mistakes are part of learning" line — just the reasoning.`,
  },
}

export default function LessonPlayer() {
  const { lessonId } = useParams()
  const navigate = useNavigate()
  const lang = useStore((s) => s.lang) || 'en'
  const grade = useStore((s) => s.grade) || 2
  const [ctx, setCtx] = useState(() => findLesson(lessonId))
  const [bootstrapping, setBootstrapping] = useState(!ctx)

  useEffect(() => {
    if (ctx) return
    // Lesson not yet in cache — prewarm packs for current grade, retry.
    let cancelled = false
    setBootstrapping(true)
    Promise.all(subjects.map((s) => loadUnits(s.id, grade))).then(() => {
      if (cancelled) return
      const next = findLesson(lessonId)
      setCtx(next)
      setBootstrapping(false)
    })
    return () => { cancelled = true }
  }, [lessonId, grade, ctx])

  const hearts = useStore((s) => s.hearts)
  const gems = useStore((s) => s.gems)
  const loseHeart = useStore((s) => s.loseHeart)
  const refillHearts = useStore((s) => s.refillHearts)
  const addGems = useStore((s) => s.addGems)
  const addXp = useStore((s) => s.addXp)
  const bumpStreak = useStore((s) => s.bumpStreak)
  const completeLesson = useStore((s) => s.completeLesson)
  const unlockAchievement = useStore((s) => s.unlockAchievement)
  const recordStruggle = useStore((s) => s.recordStruggle)

  // Persist in-lesson state across remounts so the student doesn't lose
  // their place if they open the tutor chat, background the app, navigate
  // to settings, etc. Keyed by lessonId; wiped when finishLesson() runs.
  const LS_KEY = `gemmi-lesson-state-${lessonId}`
  const restored = (() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { return null }
  })()
  const [i, setI] = useState(restored?.i ?? 0)
  const [selected, setSelected] = useState(null)
  // 'intro' shows the "I'm ready" splash — skip it on restore since the
  // student already passed through. 'answering' is the question itself.
  const [phase, setPhase] = useState(restored ? 'answering' : 'intro')
  const [wrongCount, setWrongCount] = useState(restored?.wrongCount ?? 0)
  const [correctStreak, setCorrectStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(restored?.bestStreak ?? 0)

  // Snapshot to localStorage on every advance.
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ i, wrongCount, bestStreak }))
    } catch { /* private mode */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, wrongCount, bestStreak, LS_KEY])
  const [exitOpen, setExitOpen] = useState(false)
  const [tutorOpen, setTutorOpen] = useState(false)
  const [tutorAutoAsk, setTutorAutoAsk] = useState(null)

  useEffect(() => {
    if (hearts <= 0) setPhase('no-hearts')
  }, [hearts])

  if (bootstrapping) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="flex flex-col items-center gap-3 text-ink-500">
          <Loader2 className="w-8 h-8 animate-spin text-steppe-500" />
          <div className="text-sm font-extrabold">{t('loadingPack', lang)}</div>
        </div>
      </div>
    )
  }
  if (!ctx) {
    return <div className="mt-10 text-center">404 — lesson not found</div>
  }
  const { subject, unit, lesson } = ctx
  const q = lesson.questions[i]
  const total = lesson.questions.length

  // Resolve options + prompt per language. Three legal shapes for q.options:
  //   • plain array of strings — language-neutral (numbers, math, etc.)
  //   • tri()-wrapped object { kk, ru, en } — multilingual answer text
  //   • old optionsByLang / optionsByLangMap flag forms — same as tri'd
  // We auto-detect the tri'd object even without a flag because society.js
  // (and now the rest of the corpus) just emits `options: tri([...], [...])`
  // without setting q.optionsByLang.
  const promptText = q.prompt[lang] ?? q.prompt.en
  let options = q.options
  const looksTri = options
    && !Array.isArray(options)
    && typeof options === 'object'
    && (Array.isArray(options.kk) || Array.isArray(options.en) || Array.isArray(options.ru))
  if (looksTri) options = options[lang] ?? options.en ?? options.kk
  if (q.optionsByLang) options = q.options[lang] ?? q.options.en
  if (q.optionsByLangMap && q.optionsByLangMap[lang]) options = q.optionsByLangMap[lang]

  const isTrueFalse = q.type === 'truefalse'
  const answer = q.answer

  // Human-readable answer text used by the tutor pre-prompt and the
  // confusion log. Resolved once per question so the closure passed into
  // recordStruggle / openTutorForWrongAnswer always reads the current state.
  const labelFor = (val) => {
    if (val === null || val === undefined) return null
    if (isTrueFalse) return val ? t('trueLabel', lang) : t('falseLabel', lang)
    return (options || [])[val]
  }
  const correctAnswerText = labelFor(isTrueFalse ? !!answer : answer)
  const lessonTitleText = lesson.title?.[lang] || lesson.title?.en || lesson.id

  const tutorContext = useMemo(() => ({
    type: 'lesson_question',
    subject: subject.id,
    subjectEmoji: subject.emoji,
    lessonId: lesson.id,
    lessonTitle: lessonTitleText,
    unitTitle: unit.title?.[lang] || unit.title?.en,
    question: promptText,
    options: isTrueFalse ? null : options,
    correctAnswer: correctAnswerText,
  }), [subject.id, subject.emoji, lesson.id, lessonTitleText, unit, lang, promptText, isTrueFalse, options, correctAnswerText])

  // options array holds the answer strings directly; labelFor() expects an
  // INDEX into that array (and returns the string at that index) so passing
  // `o` would lookup options["Gravity"] → undefined. Use the value as-is.
  const optionsLine = isTrueFalse ? null : (options || []).map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('; ')
  const openTutorForQuestion = () => {
    setTutorAutoAsk(ASK_PROMPTS.question[lang](promptText, optionsLine))
    setTutorOpen(true)
  }
  const openTutorForWrongAnswer = (studentAnswerText) => {
    setTutorAutoAsk(ASK_PROMPTS.wrong[lang](promptText, optionsLine, String(studentAnswerText ?? ''), String(correctAnswerText ?? '')))
    setTutorOpen(true)
  }

  const handleCheck = () => {
    if (selected === null) return
    const correct = isTrueFalse ? selected === !!answer : selected === answer
    if (correct) {
      setCorrectStreak((s) => {
        const nv = s + 1
        setBestStreak((b) => Math.max(b, nv))
        return nv
      })
      setPhase('feedback-correct')
    } else {
      setCorrectStreak(0)
      setWrongCount((c) => c + 1)
      loseHeart()
      recordStruggle({
        subject: subject.id,
        lessonId: lesson.id,
        lessonTitle: lessonTitleText,
        question: promptText,
        wrongAnswer: labelFor(selected),
        correctAnswer: correctAnswerText,
      })
      setPhase('feedback-wrong')
    }
  }

  const advance = () => {
    setSelected(null)
    setPhase('answering')
    if (i + 1 >= total) {
      finishLesson()
    } else {
      setI(i + 1)
    }
  }

  const finishLesson = () => {
    const wrong = wrongCount
    const stars = wrong === 0 ? 3 : wrong <= 1 ? 2 : 1
    const baseXp = 10
    const perfectBonus = stars === 3 ? 5 : 0
    const xp = baseXp + perfectBonus
    addXp(xp)
    addGems(3 + stars)
    bumpStreak()
    completeLesson(lesson.id, { stars, xp })
    if (bestStreak >= 5) unlockAchievement('combo-5')
    if (stars === 3) unlockAchievement('perfect-lesson')
    // Clear the in-lesson snapshot so a repeat attempt starts fresh.
    try { localStorage.removeItem(LS_KEY) } catch { /* private mode */ }
    navigate(`/learn/complete/${lesson.id}?stars=${stars}&xp=${xp}&streak=${bestStreak}`)
  }

  // ── render ──
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-md mx-auto px-4 pb-32 min-h-screen flex flex-col">
        {/* Header inset: applied directly to the header div instead of a
            wrapper. Hardcoded 56px floor means we always clear a typical
            Android status bar even when env() returns 0; the env() bump
            adds extra room when the inset is actually reported. The 0px
            fallback inside env() keeps the whole declaration valid on
            browsers that don't understand env(safe-area-inset-*). */}
        <div
          className="flex items-center gap-3"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)' }}
        >
          <button onClick={() => setExitOpen(true)} className="text-ink-400 hover:text-ink-700">
            <X className="w-7 h-7" strokeWidth={3} />
          </button>
          <div className="flex-1">
            <ProgressBar value={i + (phase.startsWith('feedback') ? 1 : 0)} total={total} color={subject.hex} />
          </div>
          <div className="pill bg-rose-100 text-rose-600">
            <Heart className="w-4 h-4" fill="currentColor" strokeWidth={3} /> {hearts}
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 text-xs font-bold text-ink-400">
            {unit.title[lang]} · {t('lesson', lang)} {i + 1}/{total}
          </div>
          {phase !== 'intro' && (
            <button
              type="button"
              onClick={openTutorForQuestion}
              aria-label={{ kk: 'Джеммиден сұра', ru: 'Спросить Джемми', en: 'Ask Gemmi' }[lang]}
              className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wide text-steppe-600 hover:text-steppe-800 px-2 py-1 rounded-full bg-steppe-50 border border-steppe-200"
            >
              <Sparkles className="w-3.5 h-3.5" strokeWidth={3} />
              {{ kk: 'Сұра', ru: 'Спросить', en: 'Ask' }[lang]}
            </button>
          )}
        </div>

        {/* Intro card (Duolingo-style "what you'll practice" page) */}
        {phase === 'intro' && (
          <IntroCard
            lang={lang}
            unit={unit}
            lesson={lesson}
            subject={subject}
            total={total}
            onStart={() => setPhase('answering')}
          />
        )}

        {/* Question content */}
        {phase !== 'intro' && (
          <div className="mt-6 flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }}
              >
                <div className="text-xs uppercase tracking-wide font-extrabold text-ink-400">
                  {isTrueFalse ? t('selectAnswer', lang) : t('selectAnswer', lang)}
                </div>
                <h2 className={`mt-2 font-extrabold text-ink-900 leading-tight ${promptText.length > 160 ? 'text-lg' : 'text-2xl'}`}>
                  <LatexText>{promptText}</LatexText>
                </h2>
                {q.media && (
                  <div className="mt-6 grid place-items-center text-6xl py-4">{q.media}</div>
                )}

                <div className={`mt-6 grid gap-3 ${isTrueFalse ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {isTrueFalse ? (
                    [{ label: t('trueLabel', lang), val: true }, { label: t('falseLabel', lang), val: false }].map((o) => {
                      const sel = selected === o.val
                      const correct = phase.startsWith('feedback') && o.val === !!answer
                      const wrong = phase === 'feedback-wrong' && sel && o.val !== !!answer
                      return (
                        <button key={String(o.val)}
                          disabled={phase !== 'answering'}
                          onClick={() => setSelected(o.val)}
                          className={`answer-card text-lg ${sel && phase === 'answering' ? 'selected' : ''} ${correct ? 'correct' : ''} ${wrong ? 'wrong' : ''}`}
                        >{o.label}</button>
                      )
                    })
                  ) : (
                    (options || []).map((opt, idx) => {
                      const sel = selected === idx
                      const correct = phase.startsWith('feedback') && idx === answer
                      const wrong = phase === 'feedback-wrong' && sel && idx !== answer
                      return (
                        <button
                          key={idx}
                          disabled={phase !== 'answering'}
                          onClick={() => setSelected(idx)}
                          className={`answer-card ${sel && phase === 'answering' ? 'selected' : ''} ${correct ? 'correct' : ''} ${wrong ? 'wrong' : ''}`}
                        >
                          <span className="text-left block w-full"><LatexText>{opt}</LatexText></span>
                        </button>
                      )
                    })
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer feedback bar — hidden during intro */}
      {phase !== 'intro' && (
        <FeedbackBar
          phase={phase}
          lang={lang}
          onCheck={handleCheck}
          onNext={advance}
          onAskGemmi={() => openTutorForWrongAnswer(labelFor(selected))}
          correctText={correctStreak > 1 ? `${t('great', lang)} · ${correctStreak}× combo` : t('great', lang)}
          wrongAnswerText={correctAnswerText}
          canCheck={selected !== null}
        />
      )}

      {/* Embedded tutor — opens with the current question pinned as context */}
      <TutorChat
        open={tutorOpen}
        onClose={() => { setTutorOpen(false); setTutorAutoAsk(null) }}
        context={tutorContext}
        autoAsk={tutorAutoAsk}
      />

      {/* Exit confirm */}
      <AnimatePresence>
        {exitOpen && (
          <Modal onClose={() => setExitOpen(false)}>
            <h3 className="text-xl font-extrabold text-ink-900">{t('exitConfirmTitle', lang)}</h3>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setExitOpen(false)} className="btn-ghost flex-1">{t('stay', lang)}</button>
              <button onClick={() => navigate('/learn')} className="btn-danger flex-1">{t('exit', lang)}</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* No hearts modal */}
      <AnimatePresence>
        {phase === 'no-hearts' && (
          <Modal onClose={() => navigate('/learn')}>
            <div className="text-5xl text-center">💔</div>
            <h3 className="mt-3 text-xl font-extrabold text-ink-900 text-center">{t('noHeartsTitle', lang)}</h3>
            <p className="mt-2 text-ink-500 font-semibold text-center">{t('noHeartsBody', lang)}</p>
            <div className="mt-5 flex flex-col gap-3">
              <button
                disabled={gems < 50}
                onClick={() => { if (gems >= 50) { addGems(-50); refillHearts(); setPhase('answering') } }}
                className="btn-primary disabled:opacity-50"
              >
                <Gem className="w-5 h-5" /> {t('refillForGems', lang)}
              </button>
              <button onClick={() => navigate('/learn')} className="btn-ghost">{t('goBack', lang)}</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  )
}

function FeedbackBar({ phase, lang, onCheck, onNext, onAskGemmi, correctText, wrongAnswerText, canCheck }) {
  const correct = phase === 'feedback-correct'
  const wrong = phase === 'feedback-wrong'
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-20 ${correct ? 'bg-emerald-50' : wrong ? 'bg-rose-50' : 'bg-white'} border-t-2 ${correct ? 'border-leaf-400' : wrong ? 'border-ruby-500' : 'border-ink-100'}`}
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
    >
      <div className="max-w-md mx-auto px-4 py-3">
        {phase === 'answering' && (
          <button disabled={!canCheck} onClick={onCheck} className="btn-success w-full">
            {t('check', lang)}
          </button>
        )}
        {correct && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-leaf-500 font-extrabold">
              <div className="w-9 h-9 rounded-full bg-leaf-500 text-white grid place-items-center">
                <Check className="w-6 h-6" strokeWidth={3} />
              </div>
              {correctText}
            </div>
            <button onClick={onNext} className="btn-success">{t('next', lang)}</button>
          </div>
        )}
        {wrong && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col min-w-0">
                <div className="font-extrabold text-ruby-500">{t('oops', lang)}</div>
                <div className="text-xs font-bold text-ink-700 truncate">{t('reviewAnswer', lang)} {String(wrongAnswerText)}</div>
              </div>
              <button onClick={onNext} className="btn-danger">{t('next', lang)}</button>
            </div>
            <button
              onClick={onAskGemmi}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-white border-2 border-steppe-300 text-steppe-700 font-extrabold py-2.5 hover:bg-steppe-50"
            >
              <Sparkles className="w-4 h-4" strokeWidth={3} />
              {{ kk: 'Джеммиден неге деп сұра', ru: 'Спросить Джемми, почему', en: 'Ask Gemmi why' }[lang]}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function IntroCard({ lang, unit, lesson, subject, total, onStart }) {
  // Use the unit's `tip` if we have a real per-topic concept; otherwise fall
  // back to the unit's blurb (bundled K-3 content has hand-written blurbs).
  // We drop generic "From the MMLU-Pro dataset" filler entirely.
  const tip = unit.tip?.[lang]
  const blurb = unit.blurb?.[lang]
  const isMetaBlurb = blurb && /MMLU/i.test(blurb)
  const teachingText = tip || (isMetaBlurb ? null : blurb)
  const keyIdea = {
    kk: 'Негізгі идея',
    ru: 'Ключевая идея',
    en: 'Key idea',
  }[lang]
  const ready = {
    kk: 'Дайынмын',
    ru: 'Готов',
    en: 'I’m ready',
  }[lang]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mt-6 flex-1 flex flex-col"
    >
      <div
        className="rounded-3xl p-6 text-white relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${subject.hex}, ${darkenColor(subject.hex, 0.25)})` }}
      >
        <div className="text-xs font-extrabold uppercase tracking-wide opacity-80">
          {subject.title[lang]} · {unit.title[lang]}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="text-5xl">{unit.icon || lesson.icon || subject.emoji}</div>
          <div>
            <div className="text-2xl font-extrabold leading-tight">{lesson.title[lang]}</div>
            <div className="text-xs font-bold opacity-80 mt-0.5">
              {total} {t('questionOf', lang)}
            </div>
          </div>
        </div>
      </div>

      {teachingText && (
        <div className="mt-5 rounded-3xl border-2 border-ink-100 bg-white p-5">
          <div className="text-xs font-extrabold uppercase tracking-wide text-ink-400 flex items-center gap-1.5">
            <span className="text-base">💡</span> {keyIdea}
          </div>
          <div className="mt-2 text-base font-semibold text-ink-700 leading-relaxed">{teachingText}</div>
        </div>
      )}

      <div className="flex-1" />
      <button onClick={onStart} className="btn-success w-full mt-4">{ready} <Check className="w-5 h-5" /></button>
    </motion.div>
  )
}

function darkenColor(hex, amount = 0.25) {
  if (!hex || !hex.startsWith('#')) return '#0b1530'
  const h = hex.slice(1)
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  const blend = (c) => Math.max(0, Math.round(c * (1 - amount)))
  return `#${[blend(r), blend(g), blend(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function Modal({ children, onClose }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-md bg-white rounded-3xl p-6"
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
