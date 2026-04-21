import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useStore } from '../store.js'
import { t } from '../i18n.js'
import { subjects, unitsForGrade } from '../data/index.js'
import { loadUnits } from '../data/packs.js'

export default function Home() {
  const lang = useStore((s) => s.lang) || 'en'
  const grade = useStore((s) => s.grade) || 2
  const completed = useStore((s) => s.completedLessons)
  const profile = useStore((s) => s.profile)
  const gradeLabel = { 1: 'gradeBeginner', 2: 'gradeIntermediate', 3: 'gradeAdvanced', 4: 'gradeHighSchool', 5: 'gradeCollege' }[grade]

  const [units, setUnits] = useState({}) // subjectId -> units[]
  useEffect(() => {
    let cancelled = false
    Promise.all(subjects.map((s) => loadUnits(s.id, grade).then((u) => [s.id, u]))).then((entries) => {
      if (!cancelled) setUnits(Object.fromEntries(entries))
    })
    return () => { cancelled = true }
  }, [grade])

  return (
    <div>
      <div className="mt-1 mb-5">
        <div className="text-sm font-bold text-ink-500">
          {greeting(lang)}, {profile.name || '👋'}
        </div>
        <h1 className="text-2xl font-extrabold text-ink-900 mt-0.5">{t('pickSubject', lang)}</h1>
        <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wide text-steppe-700 bg-steppe-50 px-2 py-0.5 rounded-full border border-steppe-200">
          {gradeLabel && t(gradeLabel, lang)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {subjects.map((s, i) => {
          const gradeUnits = units[s.id] || unitsForGrade(s, grade)
          const total = gradeUnits.reduce((a, u) => a + u.lessons.length, 0)
          const done = gradeUnits.reduce((a, u) => a + u.lessons.filter((l) => completed[l.id]).length, 0)
          const pct = total ? Math.round((done / total) * 100) : 0
          if (total === 0) return null // hide subjects with no content at this grade
          return (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <Link
                to={`/learn/subject/${s.id}`}
                className={`block rounded-3xl p-4 text-white relative overflow-hidden bg-gradient-to-br ${s.color}`}
                style={{ boxShadow: '0 6px 0 0 rgba(0,0,0,0.18)' }}
              >
                <div className="absolute -right-2 -bottom-3 text-7xl opacity-30 select-none">{s.emoji}</div>
                <div className="relative">
                  <div className="text-3xl">{s.emoji}</div>
                  <div className="mt-3 text-base font-extrabold leading-tight">{s.title[lang]}</div>
                  <div className="mt-3 text-xs font-bold opacity-80">
                    {done}/{total} {t('unitsDone', lang)}
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-white/30">
                    <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </Link>
            </motion.div>
          )
        })}
      </div>

      <div className="mt-6 rounded-3xl bg-gradient-to-r from-steppe-500 to-steppe-700 p-5 text-white">
        <div className="flex items-center gap-3">
          <div className="text-4xl">{profile.avatar}</div>
          <div>
            <div className="text-sm font-bold opacity-90">{t('todayProgress', lang)}</div>
            <div className="text-xl font-extrabold">{useStore.getState().dailyXp[new Date().toISOString().slice(0,10)] || 0} XP</div>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-white/30">
          <div className="h-full rounded-full bg-sun-300" style={{
            width: `${Math.min(100, Math.round(((useStore.getState().dailyXp[new Date().toISOString().slice(0,10)] || 0) / useStore.getState().dailyGoal) * 100))}%`,
          }} />
        </div>
      </div>
    </div>
  )
}

function greeting(lang) {
  return { kk: 'Сәлем', ru: 'Привет', en: 'Hi' }[lang] || 'Hi'
}
