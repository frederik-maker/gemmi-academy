import { useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Star, Flame, Zap } from 'lucide-react'
import { findLesson } from '../data/index.js'
import { useStore } from '../store.js'
import { t } from '../i18n.js'
import Mascot from '../components/Mascot.jsx'
import Confetti from '../components/Confetti.jsx'

// Lesson celebration. Must fit on every phone screen without scrolling —
// previous version stacked Mascot 180px + headline + lesson title + 3 stars
// + 3 tiles + combo banner + Continue button + safe-area paddings, and on
// a 5.5" Android (~700 logical px tall after status bar / nav bar) the
// Continue button slid below the fold.
//
// Layout strategy: every section grows minimally; the mascot is bounded
// by `min` so it scales down on short screens; the action row docks to
// the bottom via flex 1 spacer so even tiny viewports keep Continue
// visible.
export default function LessonComplete() {
  const { lessonId } = useParams()
  const [params] = useSearchParams()
  const stars = Number(params.get('stars') || 1)
  const xp = Number(params.get('xp') || 10)
  const combo = Number(params.get('streak') || 0)
  const navigate = useNavigate()
  const lang = useStore((s) => s.lang) || 'en'
  const ctx = useMemo(() => findLesson(lessonId), [lessonId])
  const streak = useStore((s) => s.streak)

  const headline = stars === 3 ? t('perfect', lang) : stars === 2 ? t('almost', lang) : t('keepGoing', lang)

  return (
    <div
      className="bg-gradient-to-b from-steppe-500 to-steppe-700 text-white overflow-hidden"
      style={{
        // Exactly fill the visible viewport — no min-h-screen so a tall
        // screen doesn't leave dead space at the bottom and a short
        // screen doesn't force scrolling.
        height: '100dvh',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
      }}
    >
      <Confetti />
      <div className="relative max-w-md mx-auto h-full px-5 flex flex-col">
        {/* Mascot — clamps between 96 and 160px so it shrinks gracefully
            on short screens. */}
        <div className="flex justify-center" style={{ height: 'clamp(96px, 22vh, 160px)' }}>
          <Mascot size={160} mood="happy" className="max-h-full w-auto" />
        </div>
        <motion.h1
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="text-2xl sm:text-3xl font-extrabold text-center mt-1">
          {headline}
        </motion.h1>
        <div className="text-center font-semibold opacity-90 text-xs sm:text-sm mt-0.5">
          {ctx?.lesson.title[lang]}
        </div>

        <div className="flex justify-center gap-2.5 mt-3">
          {[0,1,2].map((i) => (
            <motion.div
              key={i}
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.15 + i * 0.12, type: 'spring' }}
            >
              <Star className={`w-11 h-11 sm:w-14 sm:h-14 ${i < stars ? 'text-sun-300 fill-sun-300' : 'text-white/30 fill-white/30'}`} strokeWidth={2} />
            </motion.div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Tile icon={<Zap className="w-4 h-4" strokeWidth={3} />} label="XP" value={`+${xp}`} accent="bg-sun-300 text-sun-700" />
          <Tile icon={<Flame className="w-4 h-4" strokeWidth={3} fill="currentColor" />} label={t('streak', lang)} value={streak} accent="bg-orange-300 text-orange-700" />
          <Tile icon="💎" label={t('gems', lang)} value={`+${3 + stars}`} accent="bg-cyan-300 text-cyan-700" />
        </div>

        {combo >= 3 && (
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-3 mx-auto rounded-full bg-white/20 px-3 py-1.5 text-xs font-extrabold">
            🔥 {combo}× combo
          </motion.div>
        )}

        {/* Flex spacer pushes Continue to the bottom regardless of how
            much vertical room the cards above consumed. */}
        <div className="flex-1" />

        {ctx && (
          <button
            onClick={() => navigate(`/learn/subject/${ctx.subject.id}`)}
            className="btn-success w-full text-base">
            {t('continue', lang)}
          </button>
        )}
      </div>
    </div>
  )
}

function Tile({ icon, label, value, accent }) {
  return (
    <div className="rounded-2xl bg-white/10 border border-white/20 p-2 text-center">
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${accent} font-extrabold`}>{icon}</div>
      <div className="mt-1 text-[10px] font-bold opacity-80 leading-tight">{label}</div>
      <div className="text-lg font-extrabold leading-tight">{value}</div>
    </div>
  )
}
