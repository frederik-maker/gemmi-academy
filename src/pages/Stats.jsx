import { useEffect, useState } from 'react'
import { useStore } from '../store.js'
import { t } from '../i18n.js'
import { Flame, Zap, BookOpen, Trophy } from 'lucide-react'
import { subjects, unitsForGrade } from '../data/index.js'
import { loadUnits } from '../data/packs.js'

export default function Stats() {
  const lang = useStore((s) => s.lang) || 'en'
  const grade = useStore((s) => s.grade) || 2
  const xp = useStore((s) => s.xp)
  const streak = useStore((s) => s.streak)
  const completed = useStore((s) => s.completedLessons)
  const dailyXp = useStore((s) => s.dailyXp)
  const dailyGoal = useStore((s) => s.dailyGoal)
  const [units, setUnits] = useState({})
  useEffect(() => {
    Promise.all(subjects.map((s) => loadUnits(s.id, grade).then((u) => [s.id, u])))
      .then((e) => setUnits(Object.fromEntries(e)))
  }, [grade])

  const completedCount = Object.keys(completed).length
  const perfectCount = Object.values(completed).filter((c) => c.stars >= 3).length

  // Week of XP
  const days = []
  const dayLabels = lang === 'kk'
    ? ['Дс','Сс','Ср','Бс','Жм','Сн','Жс']
    : lang === 'ru'
    ? ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']
    : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i)
    const key = d.toISOString().slice(0,10)
    days.push({ label: dayLabels[(d.getDay() + 6) % 7], xp: dailyXp[key] || 0, key })
  }
  const maxXp = Math.max(dailyGoal, ...days.map((d) => d.xp))

  return (
    <div className="pt-2">
      <h1 className="text-2xl font-extrabold text-ink-900">{t('stats', lang)}</h1>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatCard icon={<Zap className="w-5 h-5" />} label={t('totalXp', lang)} value={xp} color="bg-sun-100 text-sun-700" />
        <StatCard icon={<Flame className="w-5 h-5" fill="currentColor" />} label={t('dayStreak', lang)} value={streak} color="bg-orange-100 text-orange-700" />
        <StatCard icon={<BookOpen className="w-5 h-5" />} label={t('totalLessons', lang)} value={completedCount} color="bg-leaf-50 text-leaf-500" />
        <StatCard icon={<Trophy className="w-5 h-5" />} label={t('perfect', lang)} value={perfectCount} color="bg-rose-50 text-rose-500" />
      </div>

      <div className="mt-6 rounded-3xl border-2 border-ink-100 bg-white p-4">
        <div className="text-sm font-extrabold text-ink-900">{t('weeklyXp', lang)}</div>
        <div className="mt-4 flex items-stretch gap-2 h-36">
          {days.map((d) => {
            const pct = Math.max(0, Math.min(100, (d.xp / maxXp) * 100))
            const isToday = d.key === new Date().toISOString().slice(0, 10)
            return (
              <div key={d.key} className="flex-1 flex flex-col">
                <div className="flex-1 flex items-end">
                  <div className="w-full bg-ink-100 rounded-lg overflow-hidden relative h-full">
                    {pct > 0 && (
                      <>
                        <div
                          className={`absolute inset-x-0 bottom-0 rounded-lg ${isToday ? 'bg-steppe-500' : 'bg-steppe-300'}`}
                          style={{ height: `${Math.max(pct, 6)}%` }}
                        />
                        <div className="absolute inset-x-0 text-[10px] font-extrabold text-ink-900 text-center"
                             style={{ bottom: `calc(${Math.max(pct, 6)}% + 2px)` }}>
                          {d.xp}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className={`mt-1 text-[10px] font-bold text-center ${isToday ? 'text-steppe-700' : 'text-ink-500'}`}>
                  {d.label}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-6 rounded-3xl border-2 border-ink-100 bg-white p-4">
        <div className="text-sm font-extrabold text-ink-900 mb-3">{t('achievements', lang)}</div>
        <div className="grid grid-cols-2 gap-3">
          <AchievementCard unlocked={completedCount >= 1} emoji="🐾" name={lang === 'kk' ? 'Алғашқы қадам' : lang === 'ru' ? 'Первый шаг' : 'First step'} />
          <AchievementCard unlocked={streak >= 3} emoji="🔥" name={lang === 'kk' ? '3 күн қатары' : lang === 'ru' ? '3 дня подряд' : '3-day streak'} />
          <AchievementCard unlocked={perfectCount >= 3} emoji="⭐" name={lang === 'kk' ? '3 мінсіз' : lang === 'ru' ? '3 идеальных' : '3 perfect'} />
          <AchievementCard unlocked={completedCount >= 10} emoji="📚" name={lang === 'kk' ? '10 сабақ' : lang === 'ru' ? '10 уроков' : '10 lessons'} />
        </div>
      </div>

      <div className="mt-6 rounded-3xl border-2 border-ink-100 bg-white p-4">
        <div className="text-sm font-extrabold text-ink-900 mb-3">Subjects</div>
        <div className="space-y-2">
          {subjects.map((s) => {
            const gradeUnits = units[s.id] || unitsForGrade(s, grade)
            const total = gradeUnits.reduce((a, u) => a + u.lessons.length, 0)
            const done = gradeUnits.reduce((a, u) => a + u.lessons.filter((l) => completed[l.id]).length, 0)
            const pct = total ? Math.round((done/total)*100) : 0
            return (
              <div key={s.id}>
                <div className="flex items-center justify-between text-sm font-bold">
                  <div>{s.emoji} {s.title[lang]}</div>
                  <div className="text-ink-500">{done}/{total}</div>
                </div>
                <div className="h-2 mt-1 bg-ink-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.hex }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }) {
  return (
    <div className="rounded-3xl border-2 border-ink-100 bg-white p-4">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${color}`}>{icon}</div>
      <div className="mt-3 text-2xl font-extrabold text-ink-900">{value}</div>
      <div className="text-xs font-bold text-ink-500 uppercase tracking-wide">{label}</div>
    </div>
  )
}

function AchievementCard({ unlocked, emoji, name }) {
  return (
    <div className={`rounded-2xl border-2 p-3 text-center ${unlocked ? 'border-sun-300 bg-sun-50' : 'border-ink-100 bg-ink-50/40 grayscale opacity-60'}`}>
      <div className="text-3xl">{emoji}</div>
      <div className="text-xs font-extrabold text-ink-900 mt-1">{name}</div>
    </div>
  )
}
