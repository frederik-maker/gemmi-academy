import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Globe, Trophy, Flame, Heart, Star, Smartphone, Check, ChevronRight, Sparkles, Award, HelpCircle, X, Github, Brain, GraduationCap, Users } from 'lucide-react'
import Mascot from '../components/Mascot.jsx'
import LangSwitcher from '../components/LangSwitcher.jsx'
import GemPattern from '../components/GemPattern.jsx'

// Realistic iPhone 15-style frame: rounded edges, dynamic island, side
// buttons, volume rocker, mute switch. We use a ~9 / 18 aspect ratio
// rather than the literal device 9 / 19.5 — at the hero's 300px width
// the strict device ratio makes the phone look elongated next to the
// headline column. 9 / 18 = ~600px tall, which reads more "phone" than
// "stretched rectangle."
function IPhoneFrame({ children }) {
  return (
    <div className="relative w-full" style={{ aspectRatio: '9 / 18' }}>
      {/* Outer chassis */}
      <div className="absolute inset-0 rounded-[44px] bg-ink-900 shadow-[0_30px_80px_-20px_rgba(11,21,48,0.45),inset_0_0_0_2px_rgba(255,255,255,0.06)]" />
      {/* Inner bezel */}
      <div className="absolute inset-[3px] rounded-[42px] bg-black" />
      {/* Side buttons */}
      <div className="absolute -left-[2px] top-[88px] w-[3px] h-[28px] rounded-l-sm bg-ink-700" />
      <div className="absolute -left-[2px] top-[140px] w-[3px] h-[44px] rounded-l-sm bg-ink-700" />
      <div className="absolute -left-[2px] top-[200px] w-[3px] h-[44px] rounded-l-sm bg-ink-700" />
      <div className="absolute -right-[2px] top-[170px] w-[3px] h-[68px] rounded-r-sm bg-ink-700" />
      {/* Screen */}
      <div className="absolute inset-[10px] rounded-[34px] overflow-hidden bg-white">
        {children}
        {/* Dynamic island — smaller than a literal iPhone 15 Pro to give
            the status-bar items (signal dots, 5G, %) more breathing room
            at the hero's 300px width. */}
        <div className="absolute top-[7px] left-1/2 -translate-x-1/2 w-[72px] h-[22px] rounded-full bg-black z-10" />
      </div>
    </div>
  )
}
import { subjects } from '../data/index.js'
import { getManifest } from '../data/packs.js'
import { LANGS, t, ui } from '../i18n.js'

// Direct APK download. The .github/workflows/build-apk.yml action rebuilds the
// APK on every push to main and upserts it as the `apk-latest` GH release
// asset, so this URL is always the current build.
const APK_URL = 'https://github.com/frederik-maker/gemmi-academy/releases/download/apk-latest/gemmi.apk'

const DOWNLOAD_LABEL = { kk: 'APK жүктеу', ru: 'Скачать APK', en: 'Download APK' }
const DEMO_LABEL = { kk: 'Демо көру', ru: 'Демо онлайн', en: 'Demo online' }
const GITHUB_URL = 'https://github.com/frederik-maker/gemmi-academy'

// Best-effort first-visit language pick. Order of precedence:
//   1. URL param (?lang=kk|ru|en) — wins, useful for share links.
//   2. Browser's primary language if it starts with kk or ru.
//   3. Visitor is on a Kazakhstan timezone — default to Kazakh.
//   4. Otherwise English.
// The header's lang switcher still wins once the user clicks it.
const KZ_TIMEZONES = new Set([
  'Asia/Almaty', 'Asia/Aqtau', 'Asia/Aqtobe',
  'Asia/Atyrau', 'Asia/Oral', 'Asia/Qostanay', 'Asia/Qyzylorda',
])
function detectInitialLang() {
  if (typeof window === 'undefined') return 'en'
  const fromUrl = new URLSearchParams(window.location.search).get('lang')
  if (fromUrl === 'kk' || fromUrl === 'ru' || fromUrl === 'en') return fromUrl
  const navLang = (navigator.language || '').toLowerCase()
  if (navLang.startsWith('kk')) return 'kk'
  if (navLang.startsWith('ru')) return 'ru'
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (KZ_TIMEZONES.has(tz)) return 'kk'
  } catch { /* ignore */ }
  return 'en'
}

// Landing-page-specific copy. The shared ui.* dictionary in i18n.js only
// covers in-app strings; the marketing copy below lives here.
// Inline Android robot icon. The iconic shape is a half-moon dome with two
// antennae and two eye dots — Lucide doesn't ship it (trademark dance), so
// we draw it ourselves in their stroke style.
function AndroidIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Antennae */}
      <line x1="8" y1="2.5" x2="9.5" y2="5.5" />
      <line x1="16" y1="2.5" x2="14.5" y2="5.5" />
      {/* Half-moon head: dome on top, flat bottom edge */}
      <path d="M3 16 A9 9 0 0 1 21 16 Z" />
      {/* Eyes */}
      <circle cx="9.5" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Language picker — single-button popover so it works on every screen size.
// Click the button (showing the current language flag + code), tap any
// option to switch. Closes on outside click and on Esc.
function LangPicker({ lang, setLang }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const current = LANGS.find((l) => l.code === lang) || LANGS[0]
  const label = (l) => (l.code === 'kk' ? 'KZ' : l.code.toUpperCase())
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-bold text-ink-700 hover:bg-ink-50 border border-ink-200"
      >
        <span className="text-base leading-none">{current.flag}</span>
        <span className="hidden sm:inline">{label(current)}</span>
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} strokeWidth={3} />
      </button>
      {open && (
        <ul role="listbox" className="absolute right-0 top-full mt-2 z-50 w-32 rounded-2xl bg-white border-2 border-ink-100 shadow-soft py-1 overflow-hidden">
          {LANGS.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                role="option"
                aria-selected={l.code === lang}
                onClick={() => { setLang(l.code); setOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-left hover:bg-steppe-50 ${l.code === lang ? 'bg-steppe-50 text-steppe-700' : 'text-ink-700'}`}
              >
                <span className="text-base">{l.flag}</span>
                <span>{label(l)}</span>
                <span className="ml-auto text-[10px] font-extrabold uppercase text-ink-400">{l.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Popover that explains the Android sideload steps. Most users in the target
// audience haven't installed an APK before, so the path through "downloads
// blocked" → settings → toggle is worth spelling out.
function InstallHelp({ lang }) {
  const [open, setOpen] = useState(false)
  const HELP = {
    title: { kk: 'Қалай орнатамын', ru: 'Как установить', en: 'How to install' },
    steps: {
      kk: [
        '«APK жүктеу» батырмасын бас.',
        'Браузер ескертсе, «Бәрібір жүктеу» дегенді таңда.',
        'Хабарландырудан немесе «Жүктелгендер» қалтасынан .apk файлын аш.',
        'Android осы көзден орнатуға рұқсат сұраса, рұқсат бер.',
        '«Орнату» дегенді бас.',
      ],
      ru: [
        'Нажми «Скачать APK».',
        'Если браузер предупредит, выбери «Всё равно скачать».',
        'Открой .apk из уведомления или папки «Загрузки».',
        'Android попросит разрешить установку из этого источника. Включи.',
        'Нажми «Установить».',
      ],
      en: [
        'Tap Download APK.',
        'If the browser warns, choose "Download anyway".',
        'Open the .apk from your notification or Downloads folder.',
        'Android may ask you to allow installs from this source. Toggle it on.',
        'Tap Install.',
      ],
    },
    note: {
      kk: 'Бұл рұқсатты тек бір рет беру керек.',
      ru: 'Это нужно сделать только один раз.',
      en: 'You only need to allow the permission the first time.',
    },
  }
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={HELP.title[lang]}
        aria-expanded={open}
        className="w-11 h-11 rounded-full bg-white border-2 border-ink-200 grid place-items-center text-ink-500 hover:text-ink-900 hover:border-ink-400 transition-colors"
      >
        <HelpCircle className="w-5 h-5" strokeWidth={2.5} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-labelledby="install-help-title"
          className="absolute z-40 mt-2 left-0 sm:left-auto sm:right-0 w-80 max-w-[calc(100vw-2rem)] rounded-2xl bg-white border-2 border-ink-100 shadow-soft p-4 text-left"
        >
          <div className="flex items-start justify-between mb-2">
            <h4 id="install-help-title" className="font-extrabold text-ink-900">{HELP.title[lang]}</h4>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-ink-400 hover:text-ink-900"
            >
              <X className="w-4 h-4" strokeWidth={3} />
            </button>
          </div>
          <ol className="text-sm font-semibold text-ink-700 space-y-1.5 list-decimal list-inside">
            {HELP.steps[lang].map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <p className="mt-3 text-xs font-bold text-ink-500">{HELP.note[lang]}</p>
        </div>
      )}
    </div>
  )
}

const STR = {
  freeToPlay: { kk: 'Тегін', ru: 'Бесплатно', en: 'Free' },
  worksOffline: { kk: 'Желісіз де жұмыс істейді', ru: 'Работает без интернета', en: 'Works offline' },
  agesRange: { kk: '5 жастан ересекке дейін', ru: 'От 5 лет до взрослого', en: 'Ages 5 to adult' },
  streakBadge: { kk: '14 күндік қатар', ru: 'Серия 14 дней', en: '14-day streak' },
  xpEarnedBadge: { kk: '+15 XP жинадың', ru: '+15 XP получено', en: '+15 XP earned' },
  startBadge: { kk: 'БАСТА', ru: 'СТАРТ', en: 'START' },
  questions: { kk: 'сұрақ', ru: 'вопросов', en: 'questions' },
  featuresTitle: {
    kk: 'Ойын сияқты жасалған. Мектеп сияқты құрылған.',
    ru: 'Сделано как игра. Построено как школа.',
    en: 'Designed like a game. Built like a school.',
  },
  feat1Title: {
    kk: 'Үш тіл қатар',
    ru: 'Три языка рядом',
    en: 'Three languages, side by side',
  },
  feat1Body: {
    kk: 'Әр сұрақ, әр жауап, әр кеңес Қазақша, Русский және English тілдерінде жазылған. Кез келген сәтте ауысуға болады, прогресс жоғалмайды.',
    ru: 'Каждый вопрос, ответ и подсказка написаны на Қазақша, Русский и English. Меняй язык в любой момент, прогресс не теряется.',
    en: 'Every prompt, hint and answer is written in Қазақша, Русский and English. Switch any time without losing progress.',
  },
  feat2Title: {
    kk: 'XP, қатар, жүрек, гауһар',
    ru: 'XP, серии, сердца, кристаллы',
    en: 'XP, streaks, hearts, gems',
  },
  feat2Body: {
    kk: '6 to 14 жас аралығына арналған ойын механикасы. Күнделікті мақсат, күн қатары, жүрек жүйесі шыдамдылықты үйретеді.',
    ru: 'Игровой контур, рассчитанный на возраст 6 to 14. Дневная цель, серия дней подряд, сердца, которые учат терпению.',
    en: 'A real game loop tuned for 6 to 14 year olds. Daily goals, a streak that builds across days, hearts that teach patience.',
  },
  feat3Title: {
    kk: 'Көріп, естіп, есте сақтайтын ИИ',
    ru: 'ИИ, который видит, слышит и помнит',
    en: 'AI tutor that sees, hears, and remembers',
  },
  feat3Body: {
    kk: 'Gemma 4 телефонның өзінде жұмыс істейді. Қолжазба математикаға камераны бағытта, дауыспен сұра, әрі қарай талқыла. Өткен аптада нені шатастырғаныңды есте сақтайды.',
    ru: 'Gemma 4 работает прямо на телефоне. Наведи камеру на рукописную математику, говори голосом, задавай уточняющие вопросы. Наставник помнит, где ты ошибся на прошлой неделе.',
    en: 'Gemma 4 runs on the phone itself. Point the camera at handwritten math, talk to it, ask follow-ups. It remembers what you got wrong last week.',
  },
  feat4Title: {
    kk: 'Қазақстанға арналған бағдарлама',
    ru: 'Программа для Казахстана',
    en: 'Curriculum built for Kazakhstan',
  },
  feat4Body: {
    kk: 'Алтын адам, үш жүз, ілбіс, дала. Жаһандық математика, ғылым, ағылшын тілінің негіздерімен қатар.',
    ru: 'Золотой человек, три жуза, снежный барс, степь. Рядом с глобальной математикой, наукой и английским.',
    en: 'The Golden Man, the three Juzes, snow leopards, the steppe. Alongside global math, science and English fundamentals.',
  },
  triBadge: {
    kk: 'Бір сұрақ, үш тіл',
    ru: 'Один вопрос, три языка',
    en: 'Same question, three languages',
  },
  triTitle: {
    kk: 'Бір сұрақ, үш тіл.',
    ru: 'Один вопрос, три языка.',
    en: 'One question, three languages.',
  },
  triBody: {
    kk: 'Тілді ауыстырсаң, сабақ та сонымен ауысады. Аударма жоғалмайды, екінші сұрыпты тіл болмайды.',
    ru: 'Сменишь язык, и урок переключится вместе с ним. Без потерь в переводе, без второсортного языка.',
    en: 'Switch language and the lesson follows. No translation loss, no second-class language.',
  },
  numSubjects: { kk: 'пән', ru: 'предметов', en: 'subjects' },
  numLanguages: { kk: 'тіл', ru: 'языка', en: 'languages' },
  numUnits: { kk: 'бөлім', ru: 'разделов', en: 'units' },
  numLessons: { kk: 'сабақ', ru: 'уроков', en: 'lessons' },
  numQuestions: { kk: 'сұрақ', ru: 'вопросов', en: 'questions' },
  numOffline: { kk: 'желісіз', ru: 'offline', en: 'offline' },
  dlTitle: {
    kk: 'Джеммиді телефоныңа орнат.',
    ru: 'Установи Джемми на свой телефон.',
    en: 'Get Gemmi on your phone.',
  },
  dlBody: {
    kk: 'Android үшін тегін орнатылады. iOS-та PWA арқылы. Әрқашан желісіз жұмыс істеуге дайын.',
    ru: 'Бесплатно для Android. На iOS через PWA. Готов к работе без интернета.',
    en: 'Install free on Android. iOS via PWA. Always offline-ready.',
  },
  dlTagline: {
    kk: 'Тегін. Жарнамасыз. 5 жастан ересекке дейін. Желісіз жұмыс істейді.',
    ru: 'Бесплатно. Без рекламы. С 5 лет до взрослых. Работает офлайн.',
    en: 'Free. No ads. From age 5 to adult. Works offline.',
  },
  footerWeb: { kk: 'Веб-нұсқа', ru: 'Веб-версия', en: 'Web app' },

  // Educators section
  eduPill: { kk: 'Ата-ана мен мұғалімдерге', ru: 'Родителям и учителям', en: 'For parents & teachers' },
  eduTitle: {
    kk: 'Үлкендер де қосыла алады.',
    ru: 'Взрослые тоже могут участвовать.',
    en: 'Built so adults can help.',
  },
  eduBody: {
    kk: 'Gemmi отбасылық телефонда да, сынып планшетінде де бірдей жұмыс істейді. Әр баланың қателер журналы оларды нелер қинайтынын көрсетеді, ұстаздан баланың прогресі туралы тікелей сұрауға болады, ал on-device режим API ақысын да, деректер жоғалуын да жояды.',
    ru: 'Gemmi одинаково работает и на общем семейном телефоне, и на школьном планшете. Журнал ошибок показывает, где каждый ребёнок буксует, у наставника можно напрямую спросить о прогрессе ребёнка, а on-device режим убирает и расходы на API, и риски с данными.',
    en: 'Gemmi works the same on a shared family phone or a classroom tablet. The struggles log shows what each kid keeps getting wrong, you can ask the tutor directly about a student\'s progress, and the on-device path means no API costs and no data leaving the device.',
  },
  eduPoint1Title: { kk: 'Шынайы көріну', ru: 'Реальная видимость', en: 'Real visibility' },
  eduPoint1Body: {
    kk: 'Әр оқушының қателер журналы қандай ұғымдар әлі бекімегенін көрсетеді.',
    ru: 'Журнал ошибок каждого ученика показывает, какие темы ещё не закрепились.',
    en: 'A per-student struggles log shows exactly which concepts haven\'t stuck yet.',
  },
  eduPoint2Title: { kk: 'Шексіз тегін', ru: 'Бесплатно навсегда', en: 'Free at any scale' },
  eduPoint2Body: {
    kk: 'On-device Gemma 4: API ақысы жоқ, кіру шегі жоқ, барлық сыныпта тегін жұмыс істейді.',
    ru: 'On-device Gemma 4: ни счёта за API, ни лимитов. Работает у всего класса бесплатно.',
    en: 'On-device Gemma 4 means no API bill, no per-seat cap, no usage limits for a whole classroom.',
  },
  eduPoint3Title: { kk: 'Деректер құрылғыда', ru: 'Данные у тебя', en: 'Data stays local' },
  eduPoint3Body: {
    kk: 'Балалардың сұрақтары да, прогресі де серверге жіберілмейді.',
    ru: 'Вопросы детей и их прогресс не уходят на сервер.',
    en: 'Kids\' questions and progress never leave the device.',
  },

  // Open-source banner
  osTitle: { kk: 'Барлығы ашық.', ru: 'Всё открыто.', en: 'Everything is open.' },
  osBody: {
    kk: 'Сабақтар, ұстаздың логикасы, on-device LiteRT қосылымы, бүкіл оқу бағдарламасы — бәрі GitHub-та. Форкта, типографиялық қателерді түзет, өз өңіріңе сабақ қос.',
    ru: 'Уроки, логика наставника, сборка on-device LiteRT, вся учебная программа — всё на GitHub. Форкай, исправляй опечатки, добавляй уроки для своего региона.',
    en: 'The lessons, the tutor logic, the on-device LiteRT plumbing, the whole curriculum, all on GitHub. Fork it, fix typos, add lessons for your region.',
  },
  osCta: { kk: 'GitHub-та көру', ru: 'Открыть на GitHub', en: 'View on GitHub' },
}

export default function Landing() {
  const [lang, setLang] = useState(detectInitialLang)
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
      <Educators lang={lang} />
      <Trilingual lang={lang} />
      <Numbers lang={lang} totalUnits={totalUnits} totalLessons={totalLessons} totalQuestions={totalQuestions} />
      <Download lang={lang} />
      <OpenSource lang={lang} />
      <Footer lang={lang} />
    </div>
  )
}

function TopNav({ lang, setLang }) {
  return (
    <div className="sticky top-0 z-30 backdrop-blur bg-white/85 border-b border-ink-100" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          {/* Use the 64px PNG with a cache-buster so retina nav stays crisp
              and the new transparent mascot isn't masked by the SW cache. */}
          <img src="/gemmi-64.png?v=3" alt="" className="w-8 h-8 object-contain" />
          <span className="text-lg font-extrabold tracking-tight text-ink-900">
            Gemmi<span className="text-steppe-500 ml-1">Academy</span>
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <LangPicker lang={lang} setLang={setLang} />
          {/* Hide the navbar demo CTA on mobile — the hero has the same
              button right below and the navbar one was line-wrapping. */}
          <Link to="/learn" className="hidden sm:inline-flex btn-success text-xs px-4 py-2 whitespace-nowrap">
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
    kk: 'Жаңа ұрпақты Gemma 4-ке негізделген жекелендірілген мультимодальды ИИ-ұстазбен оқытамыз, Duolingo стиліндегі балабақшадан колледжге дейінгі сабақтар, бес пәнде үш тілде.',
    ru: 'Учим новое поколение с персонализированным мультимодальным ИИ-наставником на Gemma 4 и Duolingo-стилем уроков от детсада до колледжа, по пяти предметам на трёх языках.',
    en: 'Educating the next generation with a personalized, multimodal AI tutor powered by Gemma 4, alongside a Duolingo-styled curriculum from kindergarten through college in five subjects and three languages.',
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
          <div className="mt-7 flex flex-wrap gap-3 items-center">
            <a href={APK_URL} className="btn-cartoon bg-ink-900 text-white px-6 py-3.5 hover:bg-ink-800">
              <AndroidIcon className="w-5 h-5" /> <span className="ml-1">{DOWNLOAD_LABEL[lang]}</span>
            </a>
            <Link to="/learn" className="btn-success px-6 py-3.5">
              {DEMO_LABEL[lang]} →
            </Link>
            <InstallHelp lang={lang} />
          </div>
          <div className="mt-7 flex items-center gap-5 text-sm font-bold text-ink-500">
            <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-leaf-500" /> {STR.freeToPlay[lang]}</span>
            <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-leaf-500" /> {STR.worksOffline[lang]}</span>
            <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-leaf-500" /> {STR.agesRange[lang]}</span>
          </div>
        </div>
        <div className="relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="mx-auto w-[300px] relative">
            <IPhoneFrame>
              <PhoneScreenshot lang={lang} />
            </IPhoneFrame>
          </motion.div>
          <FloatingBadge style={{ top: 26, right: -10 }} accent="bg-sun-100 text-sun-700" icon={<Flame className="w-4 h-4" fill="currentColor" />} label={STR.streakBadge[lang]} />
          <FloatingBadge style={{ bottom: 34, left: -18 }} accent="bg-leaf-50 text-leaf-500" icon={<Award className="w-4 h-4" />} label={STR.xpEarnedBadge[lang]} />
        </div>
      </div>
    </section>
  )
}

// Hero phone preview: shows the AI tutor actually doing the thing instead
// of a Duolingo-style learning-path mockup. The whole pitch of the project
// is the agent + on-device LLM, so the hero should demonstrate the agent.
//
// We picked "why is the sky blue" because:
//   (a) every kid asks it at some point — instant relatability
//   (b) the answer benefits from real explanation rather than a fact
//       lookup, so showing it surfaces what the tutor is for
//   (c) translates cleanly across all three target UI languages
//   (d) the visual emoji + short paragraph is more eye-catching than
//       a math derivation in the hero
const CHAT_HERO = {
  question: {
    kk: 'Аспан неге көк? 🌤️',
    ru: 'Почему небо синее? 🌤️',
    en: 'Why is the sky blue? 🌤️',
  },
  replyOpening: {
    kk: 'Күн сәулесі — ',
    ru: 'Солнечный свет — это ',
    en: 'Sunlight looks white, but it\'s really ',
  },
  replyHighlight: {
    kk: 'кемпірқосақтың барлық түсі',
    ru: 'все цвета радуги',
    en: 'every colour of the rainbow',
  },
  replyMiddle: {
    kk: ' араласқан ақ жарық. Ауадағы молекулалар көк түсті көп шашыратады, сондықтан күндіз бүкіл аспан көк болып көрінеді. ',
    ru: ', смешанных в один белый луч. Молекулы воздуха разбрасывают синий свет сильнее всего, и поэтому днём небо выглядит синим. ',
    en: ' mixed together. Air molecules scatter the blue part much more than the rest, so the whole daytime sky looks blue. ',
  },
  replyHook: {
    kk: 'Күн батқанда қызыл болатынын білесің бе?',
    ru: 'А знаешь, почему на закате оно становится красным?',
    en: 'Want to know why it goes red at sunset?',
  },
  practice: {
    kk: '✨ Күн батуы туралы',
    ru: '✨ Про закат',
    en: '✨ Tell me about sunsets',
  },
  askPlaceholder: { kk: 'Кез келген сұрақ…', ru: 'Спроси что-нибудь…', en: 'Ask anything…' },
  titleLabel: { kk: 'AI-ҰСТАЗ', ru: 'AI-НАСТАВНИК', en: 'AI TUTOR' },
}

function PhoneScreenshot({ lang }) {
  return (
    <div className="w-full h-full bg-white flex flex-col text-ink-900">
      {/* Chat header is the topmost element on the screen — the blue
          gradient runs edge-to-edge from the dynamic island down. The
          iOS status bar (9:41 / 5G / 100%) sits OVER the gradient in
          white, the way a real native app handles it when the screen
          colour bleeds under the status bar. */}
      <div className="relative overflow-hidden text-white"
           style={{ background: 'linear-gradient(135deg, #1186f5 0%, #54c2ff 60%, #2ca6ff 100%)' }}>
        {/* Status bar overlay — pushed tight against the rounded
            corners so the time/signal sit OUTSIDE the dynamic island
            in the centre. White on blue, like a real iOS chat app. */}
        <div className="px-3 pt-2 pb-1 flex justify-between text-[10px] font-extrabold opacity-95">
          <span>9:41</span>
          <span className="flex items-center gap-0.5">
            <span className="text-[8px]">●●●</span>
            <span>5G</span>
            <span>100%</span>
          </span>
        </div>
        <div className="px-3 pt-1.5 pb-2 flex items-center gap-2">
          <div className="-ml-1 -my-1 flex-shrink-0">
            <Mascot size={44} mood="wave" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-extrabold leading-tight">Gemmi</div>
            <div className="text-[9px] font-extrabold uppercase tracking-wider opacity-90 mt-0.5">{CHAT_HERO.titleLabel[lang]}</div>
          </div>
          <span className="w-6 h-6 rounded-full bg-white/15 grid place-items-center text-xs">✕</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 px-3 py-3 space-y-2.5 overflow-hidden bg-gradient-to-b from-steppe-50/40 to-white">
        {/* User bubble */}
        <div className="flex justify-end">
          <div className="max-w-[82%] bg-gradient-to-br from-steppe-500 to-steppe-700 text-white rounded-2xl rounded-br-md px-3 py-2 text-[11px] leading-relaxed font-semibold shadow-sm">
            {CHAT_HERO.question[lang]}
          </div>
        </div>
        {/* Assistant bubble */}
        <div className="flex items-end gap-1.5">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-steppe-100 overflow-hidden grid place-items-center">
            <Mascot size={32} mood="idle" />
          </div>
          <div className="max-w-[82%] bg-white border-2 border-ink-100 rounded-2xl rounded-bl-md px-3 py-2 text-[11px] leading-relaxed text-ink-900 shadow-sm">
            {CHAT_HERO.replyOpening[lang]}
            <span className="font-extrabold text-steppe-600">{CHAT_HERO.replyHighlight[lang]}</span>
            {CHAT_HERO.replyMiddle[lang]}
            <span className="font-extrabold text-ink-900">{CHAT_HERO.replyHook[lang]}</span>
          </div>
        </div>
        {/* Practice chip the tutor offered */}
        <div className="ml-8 inline-flex items-center gap-1 rounded-full bg-steppe-50 border-2 border-steppe-200 px-2.5 py-1 text-[10px] font-extrabold text-steppe-700">
          {CHAT_HERO.practice[lang]}
        </div>
      </div>

      {/* Input bar */}
      <div className="px-2.5 py-2 border-t border-ink-100 bg-white flex items-center gap-1.5">
        <div className="w-7 h-7 rounded-full bg-steppe-50 text-steppe-600 grid place-items-center text-xs">📷</div>
        <div className="w-7 h-7 rounded-full bg-steppe-50 text-steppe-600 grid place-items-center text-xs">🎤</div>
        <div className="flex-1 bg-ink-50 rounded-full px-3 py-1.5 text-[10px] font-semibold text-ink-400">
          {CHAT_HERO.askPlaceholder[lang]}
        </div>
        <div className="w-7 h-7 rounded-full bg-steppe-500 text-white grid place-items-center text-xs">▶</div>
      </div>
      {/* iOS home indicator */}
      <div className="flex justify-center pb-1.5">
        <div className="w-[100px] h-[3px] rounded-full bg-ink-900/60" />
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
              <div className="text-xs font-bold opacity-90 uppercase tracking-wide">{STR.questions[lang]}</div>
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
    { icon: <Globe className="w-6 h-6" />,    title: STR.feat1Title[lang], body: STR.feat1Body[lang], tint: 'bg-steppe-50 text-steppe-700' },
    { icon: <Trophy className="w-6 h-6" />,   title: STR.feat2Title[lang], body: STR.feat2Body[lang], tint: 'bg-sun-50 text-sun-700' },
    { icon: <Smartphone className="w-6 h-6" />, title: STR.feat3Title[lang], body: STR.feat3Body[lang], tint: 'bg-leaf-50 text-leaf-500' },
    { icon: <Star className="w-6 h-6" />,     title: STR.feat4Title[lang], body: STR.feat4Body[lang], tint: 'bg-rose-50 text-ruby-500' },
  ]
  return (
    <section className="max-w-6xl mx-auto px-5 py-16">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{STR.featuresTitle[lang]}</h2>
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

function Educators({ lang }) {
  const points = [
    { icon: <Brain className="w-5 h-5" />, title: STR.eduPoint1Title[lang], body: STR.eduPoint1Body[lang] },
    { icon: <Users className="w-5 h-5" />, title: STR.eduPoint2Title[lang], body: STR.eduPoint2Body[lang] },
    { icon: <GraduationCap className="w-5 h-5" />, title: STR.eduPoint3Title[lang], body: STR.eduPoint3Body[lang] },
  ]
  return (
    <section className="max-w-6xl mx-auto px-5 py-16">
      <div className="rounded-3xl bg-gradient-to-br from-ink-900 via-ink-900 to-steppe-900 text-white px-6 py-10 sm:px-12 sm:py-14 relative overflow-hidden">
        <GemPattern opacity={0.08} />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 px-3 py-1 text-xs font-extrabold">
            <GraduationCap className="w-3.5 h-3.5" /> {STR.eduPill[lang]}
          </div>
          <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight">{STR.eduTitle[lang]}</h2>
          <p className="mt-3 text-base opacity-90 font-semibold leading-relaxed max-w-2xl">{STR.eduBody[lang]}</p>
        </div>
        <div className="relative mt-8 grid sm:grid-cols-3 gap-4">
          {points.map((p, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.07 }}
              className="rounded-2xl bg-white/5 border border-white/10 p-4"
            >
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-sun-300/20 text-sun-300">{p.icon}</div>
              <div className="mt-3 font-extrabold">{p.title}</div>
              <div className="mt-1 text-sm opacity-80 font-semibold leading-relaxed">{p.body}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function OpenSource({ lang }) {
  return (
    <section className="max-w-6xl mx-auto px-5 pb-16">
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        className="block rounded-3xl border-2 border-ink-100 bg-white hover:border-ink-300 transition-colors p-6 sm:p-8"
      >
        <div className="flex items-start sm:items-center gap-4 flex-col sm:flex-row">
          <div className="w-12 h-12 rounded-2xl bg-ink-900 text-white grid place-items-center flex-shrink-0">
            <Github className="w-6 h-6" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl sm:text-2xl font-extrabold tracking-tight">{STR.osTitle[lang]}</h3>
            <p className="mt-1 text-sm font-semibold text-ink-500 leading-relaxed">{STR.osBody[lang]}</p>
          </div>
          <span className="inline-flex items-center gap-1 text-sm font-extrabold text-ink-900 whitespace-nowrap flex-shrink-0">
            {STR.osCta[lang]} <ArrowRight className="w-4 h-4" />
          </span>
        </div>
      </a>
    </section>
  )
}

function Trilingual({ lang }) {
  return (
    <section className="bg-ink-900 text-white">
      <div className="max-w-6xl mx-auto px-5 py-16">
        <div className="text-center max-w-2xl mx-auto">
          <div className="inline-flex rounded-full bg-white/10 border border-white/20 px-3 py-1 text-xs font-extrabold">{STR.triBadge[lang]}</div>
          <h2 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight">{STR.triTitle[lang]}</h2>
          <p className="mt-3 opacity-80 font-semibold">{STR.triBody[lang]}</p>
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

function Numbers({ lang, totalUnits, totalLessons, totalQuestions }) {
  const tiles = [
    { v: subjects.length,  label: STR.numSubjects[lang] },
    { v: 3,                label: STR.numLanguages[lang] },
    { v: totalUnits,       label: STR.numUnits[lang] },
    { v: totalLessons,     label: STR.numLessons[lang] },
    { v: totalQuestions,   label: STR.numQuestions[lang] },
    { v: '100%',           label: STR.numOffline[lang] },
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
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{STR.dlTitle[lang]}</h2>
          <p className="mt-3 opacity-90 font-semibold">{STR.dlBody[lang]}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href={APK_URL} className="btn-cartoon bg-ink-900 text-white px-5 py-3 hover:bg-black">
              <AndroidIcon className="w-5 h-5" /> {DOWNLOAD_LABEL[lang]}
            </a>
            <Link to="/learn" className="btn-cartoon bg-white text-ink-900 px-5 py-3">
              {DEMO_LABEL[lang]} <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="mt-5 text-xs font-bold opacity-80">{STR.dlTagline[lang]}</div>
        </div>
      </div>
    </section>
  )
}

function Footer({ lang }) {
  return (
    <footer className="border-t border-ink-100">
      <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm font-bold text-ink-500">
          <img src="/gemmi-64.png?v=3" alt="" className="w-6 h-6 object-contain" />
          Gemmi Academy · Қазақша · Русский · English
        </div>
        <div className="flex gap-4 text-xs font-bold text-ink-500">
          <a href={APK_URL} className="hover:text-ink-900">{DOWNLOAD_LABEL[lang]}</a>
          <Link to="/learn" className="hover:text-ink-900">{STR.footerWeb[lang]}</Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-ink-900 inline-flex items-center gap-1">
            <Github className="w-3.5 h-3.5" /> GitHub
          </a>
        </div>
      </div>
    </footer>
  )
}
