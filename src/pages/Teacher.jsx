import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, Flame, Zap, BookOpen, Trophy, Sparkles, AlertTriangle, TrendingUp, ArrowRight } from 'lucide-react'
import { useStore } from '../store.js'
import { subjects, unitsForGrade } from '../data/index.js'
import { loadUnits } from '../data/packs.js'
import TutorChat from '../components/TutorChat.jsx'

// Educator co-pilot dashboard. Shows the (current device's) student profile
// with all the signals a teacher cares about, plus a "Ask Gemmi AI" panel
// that opens the same multi-tool agent the kid uses — only the system prompt
// presents the perspective of an educator looking at this learner.
export default function Teacher() {
  const lang = useStore((s) => s.lang) || 'en'
  const profile = useStore((s) => s.profile)
  const grade = useStore((s) => s.grade) || 2
  const xp = useStore((s) => s.xp)
  const streak = useStore((s) => s.streak)
  const completed = useStore((s) => s.completedLessons)
  const lessonAttempts = useStore((s) => s.lessonAttempts)
  const dailyXp = useStore((s) => s.dailyXp)
  const [packUnits, setPackUnits] = useState({})
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    Promise.all(subjects.map((s) => loadUnits(s.id, grade).then((u) => [s.id, u])))
      .then((e) => setPackUnits(Object.fromEntries(e)))
  }, [grade])

  // Per-subject breakdown
  const breakdown = useMemo(() => {
    return subjects.map((s) => {
      const units = packUnits[s.id] || unitsForGrade(s, grade)
      const totalL = units.reduce((a, u) => a + u.lessons.length, 0)
      const doneL = units.reduce((a, u) => a + u.lessons.filter((l) => completed[l.id]).length, 0)
      const struggling = units
        .flatMap((u) => u.lessons.map((l) => ({ lesson: l, unit: u })))
        .filter(({ lesson }) => (lessonAttempts[lesson.id] || 0) >= 2 && (completed[lesson.id]?.stars || 0) < 3)
        .slice(0, 3)
      return { subject: s, totalL, doneL, struggling }
    }).filter((r) => r.totalL > 0)
  }, [packUnits, grade, completed, lessonAttempts])

  // Weekly XP series
  const days = useMemo(() => {
    const today = new Date()
    const out = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      out.push({ label: ['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()], xp: dailyXp[key] || 0, key })
    }
    return out
  }, [dailyXp])
  const maxXp = Math.max(20, ...days.map((d) => d.xp))

  const completedCount = Object.keys(completed).length
  const perfectCount = Object.values(completed).filter((c) => c.stars >= 3).length

  // Headline insight
  const insight = useMemo(() => {
    if (completedCount === 0) {
      return {
        tone: 'info',
        title: { kk: 'Жаңа оқушы', ru: 'Новый ученик', en: 'Brand-new learner' },
        body: { kk: 'Әлі сабақ аяқтаған жоқ. Бастауды ұсын.', ru: 'Ещё не закончил уроки. Подсказать, с чего начать.', en: 'No lessons completed yet — point them at lesson one.' },
      }
    }
    const struggling = breakdown.flatMap((b) => b.struggling)
    if (struggling.length) {
      return {
        tone: 'warn',
        title: { kk: 'Қиналып жатқан тақырыптар бар', ru: 'Есть темы, где буксует', en: 'Some topics need review' },
        body: {
          kk: `${struggling.length} тақырып бойынша 3 жұлдызға жетпеген.`,
          ru: `${struggling.length} тем не закрыто на 3 звезды.`,
          en: `${struggling.length} lesson${struggling.length === 1 ? '' : 's'} not yet at 3 stars after multiple tries.`,
        },
      }
    }
    if (streak >= 3) {
      return {
        tone: 'good',
        title: { kk: 'Тұрақты ілгерілеу', ru: 'Стабильный прогресс', en: 'Solid streak' },
        body: {
          kk: `${streak} күн қатары. Жаңа тақырып ұсынуға болады.`,
          ru: `${streak} дней подряд. Можно дать тему посложнее.`,
          en: `${streak}-day streak — ready for something tougher.`,
        },
      }
    }
    return {
      tone: 'info',
      title: { kk: 'Қалыпты қарқын', ru: 'Ровный темп', en: 'Steady pace' },
      body: { kk: 'Әртүрлі пәндерді ауыстырып ұсыну керек.', ru: 'Стоит чередовать предметы.', en: 'Mix subjects to keep them engaged.' },
    }
  }, [completedCount, breakdown, streak])

  const T = {
    title: { kk: 'Мұғалім панелі', ru: 'Панель учителя', en: 'Educator dashboard' },
    sub: { kk: 'оқушы туралы талдау', ru: 'обзор ученика', en: 'student insight' },
    askGemmi: { kk: 'Джеммиден сұра', ru: 'Спросить Джемми', en: 'Ask Gemmi' },
    askHint: { kk: 'Бұл оқушыға қалай көмектесейін?', ru: 'Как помочь ученику?', en: 'How can I help this learner?' },
    weekly: { kk: 'Апта бойынша XP', ru: 'XP за неделю', en: 'Weekly XP' },
    subjects: { kk: 'Пәндер бойынша', ru: 'По предметам', en: 'By subject' },
    struggling: { kk: 'Қиналып жатқан тақырыптар', ru: 'Где буксует', en: 'Topics needing review' },
    open: { kk: 'Ашу', ru: 'Открыть', en: 'Open' },
  }

  return (
    <div className="pb-24">
      <div className="flex items-center gap-2 mb-4">
        <Link to="/learn/profile" className="w-10 h-10 grid place-items-center rounded-full bg-white border border-ink-200">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="text-xs font-bold text-ink-500">{T.sub[lang]}</div>
          <h1 className="text-xl font-extrabold text-ink-900">{T.title[lang]}</h1>
        </div>
      </div>

      {/* Student card */}
      <div className="rounded-3xl bg-gradient-to-r from-ink-900 to-ink-700 text-white p-5 flex items-center gap-4">
        <div className="text-5xl bg-white/10 rounded-full w-16 h-16 grid place-items-center">{profile.avatar}</div>
        <div>
          <div className="text-lg font-extrabold">{profile.name || 'Student'}</div>
          <div className="text-xs font-bold opacity-80">
            {{1:'Beginner · ages 5-8',2:'Intermediate · 8-10',3:'Advanced · 10-14',4:'High school · 14-18',5:'College / Adult · 18+'}[grade]}
          </div>
        </div>
      </div>

      {/* Insight */}
      <div className={`mt-4 rounded-2xl border-2 p-4 flex items-start gap-3 ${
        insight.tone === 'good' ? 'border-leaf-400 bg-emerald-50' :
        insight.tone === 'warn' ? 'border-sun-400 bg-sun-50' :
        'border-steppe-300 bg-steppe-50'
      }`}>
        <div className={`grid place-items-center w-9 h-9 rounded-full flex-shrink-0 ${
          insight.tone === 'good' ? 'bg-leaf-400 text-white' :
          insight.tone === 'warn' ? 'bg-sun-400 text-sun-900' :
          'bg-steppe-500 text-white'
        }`}>
          {insight.tone === 'good' ? <TrendingUp className="w-5 h-5" strokeWidth={3} /> :
            insight.tone === 'warn' ? <AlertTriangle className="w-5 h-5" strokeWidth={3} /> :
            <Sparkles className="w-5 h-5" strokeWidth={3} />}
        </div>
        <div>
          <div className="font-extrabold text-ink-900">{insight.title[lang]}</div>
          <div className="text-sm font-semibold text-ink-600 mt-0.5">{insight.body[lang]}</div>
        </div>
      </div>

      {/* AI panel */}
      <button onClick={() => setChatOpen(true)}
        className="mt-4 w-full rounded-3xl p-5 text-white text-left flex items-center gap-4 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1186f5, #144c8f)', boxShadow: '0 8px 0 0 #0e6ce0' }}>
        <div className="w-12 h-12 rounded-full bg-white/15 grid place-items-center flex-shrink-0">
          <Sparkles className="w-7 h-7 text-sun-300" strokeWidth={2.5} />
        </div>
        <div className="flex-1">
          <div className="font-extrabold">{T.askGemmi[lang]}</div>
          <div className="text-xs font-bold opacity-80 mt-0.5">{T.askHint[lang]}</div>
        </div>
        <ArrowRight className="w-5 h-5 opacity-80" strokeWidth={3} />
      </button>

      {/* Stats row */}
      <div className="mt-5 grid grid-cols-4 gap-2">
        <Stat icon={<Zap className="w-4 h-4" />} label="XP" value={xp} />
        <Stat icon={<Flame className="w-4 h-4" fill="currentColor" />} label={{kk:'Күн',ru:'Дни',en:'Days'}[lang]} value={streak} />
        <Stat icon={<BookOpen className="w-4 h-4" />} label={{kk:'Сабақ',ru:'Уроки',en:'Lessons'}[lang]} value={completedCount} />
        <Stat icon={<Trophy className="w-4 h-4" />} label={{kk:'⭐⭐⭐',ru:'⭐⭐⭐',en:'⭐⭐⭐'}[lang]} value={perfectCount} />
      </div>

      {/* Weekly chart */}
      <div className="mt-5 rounded-2xl border-2 border-ink-100 bg-white p-4">
        <div className="text-sm font-extrabold text-ink-900">{T.weekly[lang]}</div>
        <div className="mt-3 flex items-end gap-2 h-28">
          {days.map((d) => (
            <div key={d.key} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full bg-ink-100 rounded-md relative" style={{ height: '100%' }}>
                <div className="absolute inset-x-0 bottom-0 bg-steppe-500 rounded-md" style={{ height: `${(d.xp / maxXp) * 100}%` }} />
                {d.xp > 0 && <div className="absolute inset-x-0 -top-4 text-[10px] font-extrabold text-ink-700 text-center">{d.xp}</div>}
              </div>
              <div className="text-[10px] font-bold text-ink-500">{d.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* By subject */}
      <div className="mt-5 rounded-2xl border-2 border-ink-100 bg-white p-4">
        <div className="text-sm font-extrabold text-ink-900 mb-3">{T.subjects[lang]}</div>
        <div className="space-y-2">
          {breakdown.map((b) => {
            const pct = b.totalL ? Math.round((b.doneL / b.totalL) * 100) : 0
            return (
              <Link key={b.subject.id} to={`/learn/subject/${b.subject.id}`} className="block">
                <div className="flex items-center justify-between text-sm font-bold">
                  <div>{b.subject.emoji} {b.subject.title[lang]}</div>
                  <div className="text-ink-500">{b.doneL}/{b.totalL} · {pct}%</div>
                </div>
                <div className="h-2 mt-1 bg-ink-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: b.subject.hex }} />
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Struggling lessons */}
      {breakdown.some((b) => b.struggling.length) && (
        <div className="mt-5 rounded-2xl border-2 border-sun-200 bg-sun-50 p-4">
          <div className="text-sm font-extrabold text-sun-700 mb-2 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> {T.struggling[lang]}
          </div>
          <div className="space-y-1.5">
            {breakdown.flatMap((b) =>
              b.struggling.map((s, i) => (
                <Link key={`${b.subject.id}-${i}`} to={`/learn/lesson/${s.lesson.id}`}
                  className="flex items-center gap-2 rounded-xl bg-white border border-sun-200 px-3 py-2 hover:border-sun-400">
                  <span className="text-lg">{b.subject.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-extrabold text-ink-900 truncate">{s.lesson.title[lang]}</div>
                    <div className="text-[11px] font-bold text-ink-500 truncate">{s.unit.title[lang]} · {lessonAttempts[s.lesson.id]} tries</div>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-ink-400 rotate-180" />
                </Link>
              ))
            )}
          </div>
        </div>
      )}

      <TutorChat open={chatOpen} onClose={() => setChatOpen(false)} context={{ role: 'teacher', studentName: profile.name }} />
    </div>
  )
}

function Stat({ icon, label, value }) {
  return (
    <div className="rounded-2xl border-2 border-ink-100 bg-white p-2.5 text-center">
      <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-ink-50 text-ink-700 mb-1">{icon}</div>
      <div className="text-lg font-extrabold text-ink-900 leading-none">{value}</div>
      <div className="text-[10px] font-bold text-ink-500 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  )
}
