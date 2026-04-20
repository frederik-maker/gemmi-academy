import { useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Star, Flame, Zap } from 'lucide-react'
import { findLesson } from '../data/index.js'
import { useStore } from '../store.js'
import { t } from '../i18n.js'
import Mascot from '../components/Mascot.jsx'
import Confetti from '../components/Confetti.jsx'

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
    <div className="min-h-screen bg-gradient-to-b from-steppe-500 to-steppe-700 text-white overflow-hidden">
      <Confetti />
      <div className="relative max-w-md mx-auto px-5 pt-8 pb-8 min-h-screen flex flex-col">
        <div className="flex justify-center">
          <Mascot size={180} mood="happy" />
        </div>
        <motion.h1
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-extrabold text-center mt-2">
          {headline}
        </motion.h1>
        <div className="text-center font-semibold opacity-90 text-sm mt-1">
          {ctx?.lesson.title[lang]}
        </div>

        <div className="flex justify-center gap-3 mt-6">
          {[0,1,2].map((i) => (
            <motion.div
              key={i}
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2 + i * 0.15, type: 'spring' }}
            >
              <Star className={`w-14 h-14 ${i < stars ? 'text-sun-300 fill-sun-300' : 'text-white/30 fill-white/30'}`} strokeWidth={2} />
            </motion.div>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-3 gap-3">
          <Tile icon={<Zap className="w-5 h-5" strokeWidth={3} />} label="XP" value={`+${xp}`} accent="bg-sun-300 text-sun-700" />
          <Tile icon={<Flame className="w-5 h-5" strokeWidth={3} fill="currentColor" />} label={t('streak', lang)} value={streak} accent="bg-orange-300 text-orange-700" />
          <Tile icon="💎" label={t('gems', lang)} value={`+${3 + stars}`} accent="bg-cyan-300 text-cyan-700" />
        </div>

        {combo >= 3 && (
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-5 mx-auto rounded-full bg-white/20 px-4 py-2 text-sm font-extrabold">
            🔥 {combo}× combo · keep it up!
          </motion.div>
        )}

        <div className="mt-auto pt-8 space-y-3">
          {ctx && (
            <button
              onClick={() => navigate(`/learn/subject/${ctx.subject.id}`)}
              className="btn-success w-full text-base">
              {t('continue', lang)}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Tile({ icon, label, value, accent }) {
  return (
    <div className="rounded-2xl bg-white/10 border border-white/20 p-3 text-center">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-full ${accent} font-extrabold`}>{icon}</div>
      <div className="mt-2 text-xs font-bold opacity-80">{label}</div>
      <div className="text-xl font-extrabold">{value}</div>
    </div>
  )
}
