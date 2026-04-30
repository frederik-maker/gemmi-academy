import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Globe, Trophy, Flame, Heart, Star, Smartphone, Check, ChevronRight, Sparkles, Award } from 'lucide-react'
import Mascot from '../components/Mascot.jsx'
import LangSwitcher from '../components/LangSwitcher.jsx'
import { subjects } from '../data/index.js'
import { getManifest } from '../data/packs.js'
import { LANGS, t, ui } from '../i18n.js'

// Direct APK download. The .github/workflows/build-apk.yml action rebuilds the
// APK on every push to main and upserts it as the `apk-latest` GH release
// asset, so this URL is always the current build.
const APK_URL = 'https://github.com/frederik-maker/gemmi-academy/releases/download/apk-latest/gemmi.apk'

const DOWNLOAD_LABEL = { kk: 'APK жүктеу', ru: 'Скачать APK', en: 'Download APK' }
const DEMO_LABEL = { kk: 'Демо көру', ru: 'Демо онлайн', en: 'Demo online' }

export default function Landing() {
  const [lang, setLang] = useState('en')
  const [extra, setExtra] = useState({ units: 0, lessons: 0, questions: 0 })
  const [perSubject, setPerSubject] = useState({}) // subjectId -> { units, lessons, questions }
  useEffect(() => {
    getManifest().then((m) => {
      const u = m.packs.reduce((a, p) => a + p.units, 0)
      const l = m.packs.reduce((a, p) => a + p.lessons, 0)
      const q = m.packs.reduce((a, p) => a + p.questions, 0)
      setExtra({ units: u, lessons: l, questions: q })
      const bySubject = {}
      for (const p of m.packs) {
        const acc = bySubject[p.subject] || { units: 0, lessons: 0, questions: 0 }
        acc.units += p.units; acc.lessons += p.lessons; acc.questions += p.questions
        bySubject[p.subject] = acc
      }
      setPerSubject(bySubject)
    })
  }, [])

  const bundledUnits = subjects.reduce((a, s) => a + s.units.length, 0)
  const bundledLessons = subjects.reduce((a, s) => a + s.units.reduce((b, u) => b + u.lessons.length, 0), 0)
  const bundledQuestions = subjects.reduce(
    (a, s) => a + s.units.reduce((b, u) => b + u.lessons.reduce((c, l) => c + l.questions.length, 0), 0),
    0,
  )
  const totalUnits = bundledUnits + extra.units
  const totalLessons = bundledLessons + extra.lessons
  const totalQuestions = bundledQuestions + extra.questions

  return (
    <div className="min-h-screen bg-white text-ink-900 font-display">
      <TopNav lang={lang} setLang={setLang} />
      <Hero lang={lang} />
      <SubjectsStrip lang={lang} manifestExtra={perSubject} />
      <Features lang={lang} />
      <Trilingual />
      <Numbers totalUnits={totalUnits} totalLessons={totalLessons} totalQuestions={totalQuestions} />
      <Download lang={lang} />
      <Footer />
    </div>
  )
}

function TopNav({ lang, setLang }) {
  return (
    <div className="sticky top-0 z-30 backdrop-blur bg-white/85 border-b border-ink-100">
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <img src="/gemmi-32.png" alt="" className="w-8 h-8 object-contain" />
          <span className="text-lg font-extrabold tracking-tight text-ink-900">
            Gemmi<span className="text-steppe-500 ml-1">Academy</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1 text-xs font-bold text-ink-500">
            {LANGS.map((l) => (
              <button key={l.code} onClick={() => setLang(l.code)}
                className={`px-2 py-1 rounded-md ${lang === l.code ? 'bg-ink-100 text-ink-900' : 'hover:bg-ink-50'}`}>
                {l.flag} {l.code.toUpperCase()}
              </button>
            ))}
          </div>
          <Link to="/learn" className="btn-primary text-xs px-4 py-2">
            {DEMO_LABEL[lang]} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}

function Hero({ lang }) {
  const heroTitle = {
    kk: 'Ана тіліңде үйрен.',
    ru: 'Учись на своём языке.',
    en: 'Learn in your language.',
  }
  const sub = {
    kk: 'Бес пән, үш тіл, 5 жастан ересекке дейін. Қателескен сұрағыңды есте сақтайтын ИИ-ұстаз.',
    ru: 'Пять предметов, три языка, с 5 лет до взрослых. ИИ-наставник, который помнит, где ты ошибся.',
    en: "Five subjects, three languages, ages 5 to adult. An AI tutor that remembers what you got wrong.",
  }
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-steppe-50 via-white to-white pointer-events-none" />
      <div className="relative max-w-6xl mx-auto px-5 pt-12 pb-12 sm:pt-20 sm:pb-16 grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-sun-50 border border-sun-200 px-3 py-1 text-xs font-extrabold text-sun-700">
            <Sparkles className="w-3.5 h-3.5" /> Қазақша · Русский · English
          </div>
          <h1 className="mt-4 text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight">
            {heroTitle[lang]}
          </h1>
          <p className="mt-4 text-lg text-ink-500 font-semibold max-w-lg">{sub[lang]}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href={APK_URL} className="btn-cartoon bg-ink-900 text-white px-6 py-3.5 hover:bg-ink-800">
              <Smartphone className="w-5 h-5" /> <span className="ml-1">{DOWNLOAD_LABEL[lang]}</span>
            </a>
            <Link to="/learn" className="btn-success px-6 py-3.5">
              {DEMO_LABEL[lang]} →
            </Link>
          </div>
          <div className="mt-7 flex items-center gap-5 text-sm font-bold text-ink-500">
            <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-leaf-500" /> Free to play</span>
            <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-leaf-500" /> Works offline</span>
            <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-leaf-500" /> Ages 5 → adult</span>
          </div>
        </div>
        <div className="relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="mx-auto w-[320px] phone-frame relative">
            <PhoneScreenshot lang={lang} />
          </motion.div>
          <FloatingBadge style={{ top: 16, right: 4 }} accent="bg-sun-100 text-sun-700" icon={<Flame className="w-4 h-4" fill="currentColor" />} label="14-day streak" />
          <FloatingBadge style={{ bottom: 24, left: -8 }} accent="bg-leaf-50 text-leaf-500" icon={<Award className="w-4 h-4" />} label="+15 XP earned" />
        </div>
      </div>
    </section>
  )
}

function PhoneScreenshot({ lang }) {
  return (
    <div className="bg-gradient-to-b from-steppe-50 to-white aspect-[9/19.5] flex flex-col">
      <div className="px-4 py-3 flex justify-between text-[10px] font-bold text-ink-700">
        <span>9:41</span>
        <span>📶 100%</span>
      </div>
      <div className="px-4 flex items-center justify-between">
        <span className="pill bg-ink-100 text-ink-700 text-[10px]">🇰🇿 KK</span>
        <div className="flex gap-1.5">
          <span className="pill bg-orange-100 text-orange-700 text-[10px]"><Flame className="w-3 h-3" fill="currentColor" /> 14</span>
          <span className="pill bg-sky-100 text-sky-700 text-[10px]">💎 60</span>
          <span className="pill bg-rose-100 text-rose-700 text-[10px]"><Heart className="w-3 h-3" fill="currentColor" /> 5</span>
        </div>
      </div>
      <div className="px-4 mt-3 text-xs font-extrabold text-ink-500">{ui.unit.en} 2</div>
      <div className="px-4 text-base font-extrabold">{subjects[0].units[1].title[lang]}</div>
      <div className="mt-5 flex-1 flex flex-col items-center gap-5">
        {[
          { icon: '➕', done: true, color: '#1186f5', offset: 0 },
          { icon: '➖', done: true, color: '#1186f5', offset: 40 },
          { icon: '🧠', done: false, current: true, color: '#1186f5', offset: 0 },
        ].map((n, i) => (
          <div
            key={i}
            className="relative rounded-full w-16 h-16 grid place-items-center text-2xl font-extrabold text-white"
            style={{
              transform: `translateX(${n.offset}px)`,
              background: n.done ? '#fbbf24' : n.current ? n.color : '#d6dceb',
              boxShadow: `0 6px 0 0 ${n.done ? '#b45309' : n.current ? '#0e6ce0' : '#aebbd9'}`,
            }}>
            {n.icon}
            {n.current && <div className="absolute -top-7 text-[10px] font-extrabold bg-white border border-ink-200 px-2 py-0.5 rounded-full whitespace-nowrap text-ink-800">START</div>}
          </div>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-ink-100 flex justify-around text-[10px] font-extrabold text-ink-500">
        <span className="text-steppe-600">⌂ {ui.learn[lang]}</span>
        <span>📊 {ui.stats[lang]}</span>
        <span>👤 {ui.profile[lang]}</span>
      </div>
    </div>
  )
}

function FloatingBadge({ icon, label, accent, style }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="absolute hidden sm:flex items-center gap-2 rounded-2xl bg-white border border-ink-100 shadow-soft px-3 py-2 text-xs font-extrabold"
      style={style}
    >
      <span className={`grid place-items-center w-6 h-6 rounded-full ${accent}`}>{icon}</span>
      {label}
    </motion.div>
  )
}

function PlayBadge() {
  // Google-Play-style triangle: blue → red gradient on the front face,
  // green & yellow side fills. Approximates the official mark closely enough
  // to read as "Get it on Google Play" without using Google's trademarked asset.
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <defs>
        <linearGradient id="gp-front" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF3D44" />
          <stop offset="1" stopColor="#FFB400" />
        </linearGradient>
        <linearGradient id="gp-blue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00C9F9" />
          <stop offset="1" stopColor="#1A73E8" />
        </linearGradient>
      </defs>
      <path d="M3.5 2.4 13.5 12 3.5 21.6c-.4-.3-.6-.8-.6-1.3V3.7c0-.5.2-1 .6-1.3z" fill="url(#gp-blue)" />
      <path d="M16.4 8.9 6 2.8c-.5-.3-1.1-.4-1.6-.3L13.5 12l2.9-3.1z" fill="#00C853" />
      <path d="M16.4 15.1 13.5 12 4.4 21.5c.5.1 1.1 0 1.6-.3l10.4-6.1z" fill="#FFD600" />
      <path d="M20.4 10.7 16.4 8.9 13.5 12l2.9 3.1 4-1.8c1.4-.8 1.4-2.8 0-3.6z" fill="url(#gp-front)" />
    </svg>
  )
}

function SubjectsStrip({ lang, manifestExtra }) {
  // `manifestExtra` is keyed by subject id and contains aggregated units/lessons/questions from MMLU packs.
  return (
    <section className="border-y border-ink-100 bg-ink-50/40">
      <div className="max-w-6xl mx-auto px-5 py-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {subjects.map((s) => {
          const bundledLessons = s.units.reduce((a, u) => a + u.lessons.length, 0)
          const bundledQs = s.units.reduce((a, u) => a + u.lessons.reduce((b, l) => b + l.questions.length, 0), 0)
          const extra = manifestExtra[s.id] || { units: 0, lessons: 0, questions: 0 }
          const totalUnits = s.units.length + extra.units
          const totalLessons = bundledLessons + extra.lessons
          const totalQs = bundledQs + extra.questions
          return (
            <div key={s.id} className={`rounded-3xl p-5 text-white bg-gradient-to-br ${s.color}`}>
              <div className="text-4xl">{s.emoji}</div>
              <div className="mt-3 font-extrabold text-lg">{s.title[lang]}</div>
              <div className="mt-1 text-xs font-bold opacity-90">{totalUnits} {ui.unit[lang]} · {totalLessons} {ui.lesson[lang]}</div>
              <div className="mt-3 text-3xl font-extrabold">{totalQs}</div>
              <div className="text-xs font-bold opacity-90 uppercase tracking-wide">questions</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function DemoQuestion({ lang }) {
  const demoQ = useMemo(() => {
    // Cleaner sample: a single, well-formed arithmetic question.
    return {
      prompt: { kk: '7 × 8 = ?', ru: '7 × 8 = ?', en: '7 × 8 = ?' },
      options: ['54', '56', '64', '72'],
      answer: 1,
    }
  }, [])
  const [picked, setPicked] = useState(null)
  const [checked, setChecked] = useState(false)
  const correct = picked === demoQ.answer
  const opts = demoQ.options

  return (
    <section className="max-w-6xl mx-auto px-5 py-16">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Try a lesson, right here.</h2>
        <p className="mt-3 text-ink-500 font-semibold">No signup, no install. Tap an answer.</p>
      </div>
      <div className="max-w-md mx-auto rounded-3xl border-2 border-ink-100 shadow-soft p-6 bg-white">
        <div className="text-xs font-extrabold uppercase tracking-wide text-ink-400">Math · Multiplication</div>
        <h3 className="mt-2 text-2xl font-extrabold">{demoQ.prompt[lang]}</h3>
        <div className="grid grid-cols-2 gap-3 mt-5">
          {opts.map((o, i) => {
            const isPicked = picked === i
            const isAns = i === demoQ.answer
            const showCorrect = checked && isAns
            const showWrong = checked && isPicked && !isAns
            return (
              <button key={i}
                onClick={() => !checked && setPicked(i)}
                className={`answer-card text-lg ${isPicked && !checked ? 'selected' : ''} ${showCorrect ? 'correct' : ''} ${showWrong ? 'wrong' : ''}`}
              >
                {o}
              </button>
            )
          })}
        </div>
        {!checked ? (
          <button onClick={() => picked !== null && setChecked(true)}
            disabled={picked === null}
            className="btn-success w-full mt-5 disabled:opacity-40 disabled:bg-ink-200">
            {ui.check[lang]}
          </button>
        ) : (
          <div className={`mt-5 rounded-2xl px-4 py-3 font-extrabold ${correct ? 'bg-emerald-50 text-leaf-500' : 'bg-rose-50 text-ruby-500'}`}>
            {correct ? `🎉 ${ui.great[lang]}` : `${ui.oops[lang]} · ${ui.answer[lang]}: ${opts[demoQ.answer]}`}
            <div className="mt-3">
              <button onClick={() => { setChecked(false); setPicked(null) }} className="text-sm underline">Try again</button>
              <Link to="/learn" className="ml-4 text-sm underline">Open full app →</Link>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function Features({ lang }) {
  const fs = [
    {
      icon: <Globe className="w-6 h-6" />,
      title: 'Three languages, side by side',
      body: 'Every prompt, hint and answer is written in Қазақша, Русский and English. Switch on the fly — no progress lost.',
      tint: 'bg-steppe-50 text-steppe-700',
    },
    {
      icon: <Trophy className="w-6 h-6" />,
      title: 'XP, streaks, hearts, gems',
      body: 'A real game loop tuned for 6–14 year-olds. Daily goals, a streak that builds across days, and a heart system that teaches patience.',
      tint: 'bg-sun-50 text-sun-700',
    },
    {
      icon: <Smartphone className="w-6 h-6" />,
      title: 'Android-ready PWA',
      body: 'Installs like a native app on Android. Tap "Add to Home Screen" and Gemmi runs full-screen, offline, and auto-updates.',
      tint: 'bg-leaf-50 text-leaf-500',
    },
    {
      icon: <Star className="w-6 h-6" />,
      title: 'Curriculum built for Kazakhstan',
      body: 'The Golden Man, the three Juzes, snow leopards, the steppe. Alongside global math, science and English fundamentals.',
      tint: 'bg-rose-50 text-ruby-500',
    },
  ]
  return (
    <section className="max-w-6xl mx-auto px-5 py-16">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Designed like a game. Built like a school.</h2>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {fs.map((f, i) => (
          <motion.div key={i}
            initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ delay: i * 0.06 }}
            className="rounded-3xl border-2 border-ink-100 p-6 bg-white">
            <div className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl ${f.tint}`}>{f.icon}</div>
            <h3 className="mt-4 text-xl font-extrabold">{f.title}</h3>
            <p className="mt-2 text-ink-500 font-semibold leading-relaxed">{f.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function Trilingual() {
  return (
    <section className="bg-ink-900 text-white">
      <div className="max-w-6xl mx-auto px-5 py-16">
        <div className="text-center max-w-2xl mx-auto">
          <div className="inline-flex rounded-full bg-white/10 border border-white/20 px-3 py-1 text-xs font-extrabold">Aynyñ same question</div>
          <h2 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight">One question, three languages.</h2>
          <p className="mt-3 opacity-80 font-semibold">Switch language and the lesson follows. No translation loss, no second-class language.</p>
        </div>
        <div className="mt-10 grid lg:grid-cols-3 gap-3">
          {[
            { lang: 'Қазақша', flag: '🇰🇿', text: 'Қазақстан хандығы қашан құрылды?' },
            { lang: 'Русский', flag: '🇷🇺', text: 'Когда образовалось Казахское ханство?' },
            { lang: 'English', flag: '🇬🇧', text: 'When was the Kazakh Khanate founded?' },
          ].map((c, i) => (
            <motion.div key={i}
              initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.07 }}
              className="rounded-3xl bg-white/5 border border-white/10 p-6">
              <div className="flex items-center gap-2 text-sm font-extrabold opacity-90">
                <span className="text-2xl">{c.flag}</span> {c.lang}
              </div>
              <div className="mt-4 text-2xl font-extrabold leading-tight">{c.text}</div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-extrabold">
                {['1235','1465','1731','1991'].map((y) => (
                  <span key={y} className={`rounded-xl border px-3 py-2 ${y === '1465' ? 'border-leaf-400 bg-leaf-400/10 text-leaf-400' : 'border-white/15'}`}>
                    {y}{y === '1465' ? ' ✓' : ''}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Numbers({ totalUnits, totalLessons, totalQuestions }) {
  const tiles = [
    { v: subjects.length, label: 'subjects' },
    { v: 3, label: 'languages' },
    { v: totalUnits, label: 'units' },
    { v: totalLessons, label: 'lessons' },
    { v: totalQuestions, label: 'questions' },
    { v: '100%', label: 'offline' },
  ]
  return (
    <section className="max-w-6xl mx-auto px-5 py-16">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {tiles.map((t, i) => (
          <div key={i} className="rounded-2xl border-2 border-ink-100 p-5 text-center bg-white">
            <div className="text-4xl font-extrabold tracking-tight">{t.v}</div>
            <div className="mt-1 text-xs font-extrabold uppercase tracking-wide text-ink-500">{t.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Download({ lang }) {
  return (
    <section className="max-w-6xl mx-auto px-5 pb-16">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-steppe-500 to-steppe-700 text-white px-6 py-10 sm:px-12 sm:py-14">
        <div className="absolute -right-10 -bottom-10 opacity-20">
          <Mascot size={300} mood="happy" />
        </div>
        <div className="relative max-w-xl">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Get Gemmi on your phone.</h2>
          <p className="mt-3 opacity-90 font-semibold">Install free on Android. iOS via PWA. Always offline-ready.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href={APK_URL} className="btn-cartoon bg-ink-900 text-white px-5 py-3 hover:bg-black">
              <Smartphone className="w-5 h-5" /> {DOWNLOAD_LABEL[lang]}
            </a>
            <Link to="/learn" className="btn-cartoon bg-white text-ink-900 px-5 py-3">
              {DEMO_LABEL[lang]} <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="mt-5 text-xs font-bold opacity-80">Free. No ads. From age 5 to adult. Works offline.</div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-ink-100">
      <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm font-bold text-ink-500">
          <img src="/gemmi-32.png" alt="" className="w-6 h-6 object-contain" />
          Gemmi Academy · Қазақша · Русский · English
        </div>
        <div className="flex gap-4 text-xs font-bold text-ink-500">
          <a href={APK_URL} className="hover:text-ink-900">Download APK</a>
          <Link to="/learn" className="hover:text-ink-900">Web app</Link>
        </div>
      </div>
    </footer>
  )
}
