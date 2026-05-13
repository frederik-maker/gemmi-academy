import { useStore } from '../store.js'
import { t } from '../i18n.js'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Globe, RotateCcw, Heart, GraduationCap, Gem, Check, Users, Download, Loader2, Info, Cpu, Volume2 } from 'lucide-react'
import { warmAllPacks } from '../lib/offline.js'
import Mascot from '../components/Mascot.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import LangSwitcher from '../components/LangSwitcher.jsx'

export default function Profile() {
  const lang = useStore((s) => s.lang) || 'en'
  const grade = useStore((s) => s.grade) || 2
  const setGrade = useStore((s) => s.setGrade)
  const profile = useStore((s) => s.profile)
  const xp = useStore((s) => s.xp)
  const streak = useStore((s) => s.streak)
  const hearts = useStore((s) => s.hearts)
  const gems = useStore((s) => s.gems)
  const addGems = useStore((s) => s.addGems)
  const refillHearts = useStore((s) => s.refillHearts)
  const setLang = useStore((s) => s.setLang)
  const resetAll = useStore((s) => s.resetAll)
  const navigate = useNavigate()
  const [langOpen, setLangOpen] = useState(false)
  const [gradeOpen, setGradeOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [toast, setToast] = useState(null) // { msg, tone }
  const [warming, setWarming] = useState(false)
  const gradeLabel = { 1: 'gradeBeginner', 2: 'gradeIntermediate', 3: 'gradeAdvanced', 4: 'gradeHighSchool', 5: 'gradeCollege' }[grade]

  const onWarm = async () => {
    if (warming) return
    setWarming(true)
    try {
      const res = await warmAllPacks()
      setToast({
        msg: res.cached != null
          ? lang === 'kk' ? `${res.cached} топтама офлайн дайын` : lang === 'ru' ? `${res.cached} наборов готовы офлайн` : `${res.cached} packs ready offline`
          : lang === 'kk' ? 'Офлайн дайын!' : lang === 'ru' ? 'Готово офлайн!' : 'Offline-ready!',
        tone: 'ok',
      })
    } catch (e) {
      setToast({ msg: e?.message || 'Failed to download', tone: 'warn' })
    } finally {
      setWarming(false)
    }
  }

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(id)
  }, [toast])

  const heartsLabel = lang === 'kk' ? 'Жүректерді толтыру' : lang === 'ru' ? 'Восстановить сердца' : 'Refill hearts'
  const onRefill = () => {
    if (hearts >= 5) {
      setToast({ msg: lang === 'kk' ? 'Жүректерің толық' : lang === 'ru' ? 'Сердца уже полные' : 'Hearts already full', tone: 'info' })
      return
    }
    if (gems < 50) {
      setToast({ msg: lang === 'kk' ? '50 гауһар керек' : lang === 'ru' ? 'Нужно 50 кристаллов' : 'You need 50 gems', tone: 'warn' })
      return
    }
    addGems(-50)
    refillHearts()
    setToast({ msg: lang === 'kk' ? 'Жүректер толтырылды!' : lang === 'ru' ? 'Сердца восстановлены!' : 'Hearts refilled!', tone: 'ok' })
  }

  const level = 1 + Math.floor(xp / 100)
  const inLevel = xp % 100

  return (
    <div className="pt-2">
      <div className="flex items-center gap-4">
        <div className="text-6xl bg-steppe-50 rounded-full w-20 h-20 grid place-items-center border-2 border-steppe-200">
          {profile.avatar}
        </div>
        <div>
          <div className="text-xl font-extrabold text-ink-900">{profile.name || 'Friend'}</div>
          <div className="text-xs font-bold text-ink-500">Level {level} · {xp} XP</div>
        </div>
      </div>

      <div className="mt-3 h-3 bg-ink-100 rounded-full overflow-hidden">
        <div className="h-full bg-steppe-500" style={{ width: `${inLevel}%` }} />
      </div>
      <div className="text-xs font-bold text-ink-400 mt-1">{100 - inLevel} XP to level {level + 1}</div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Mini label={t('streak', lang)} value={streak} />
        <Mini label={t('hearts', lang)} value={hearts} />
        <Mini label="XP" value={xp} />
      </div>

      <div className="mt-6 space-y-2">
        <Row onClick={() => navigate('/learn/teacher')} icon={<Users className="w-5 h-5 text-steppe-600" />} label={lang === 'kk' ? 'Мұғалім панелі' : lang === 'ru' ? 'Панель учителя' : 'Educator dashboard'} />
        <Row onClick={() => setGradeOpen(true)} icon={<GraduationCap className="w-5 h-5 text-steppe-600" />} label={t('changeGrade', lang)}>
          <span className="text-xs font-bold text-ink-500 max-w-[140px] truncate">{gradeLabel && t(gradeLabel, lang)}</span>
        </Row>
        <Row onClick={() => setLangOpen(true)} icon={<Globe className="w-5 h-5" />} label={t('changeLang', lang)}>
          <span className="text-xs font-bold">{lang?.toUpperCase()}</span>
        </Row>
        <Row
          onClick={onWarm}
          icon={warming
            ? <Loader2 className="w-5 h-5 text-steppe-500 animate-spin" />
            : <Download className="w-5 h-5 text-steppe-500" />}
          label={lang === 'kk' ? 'Офлайн жүктеу' : lang === 'ru' ? 'Скачать для офлайн' : 'Download for offline'}
        >
          <span className="text-xs font-extrabold text-ink-500">
            {lang === 'kk' ? '~6 МБ' : lang === 'ru' ? '~6 МБ' : '~6 MB'}
          </span>
        </Row>
        <Row onClick={onRefill} icon={<Heart className="w-5 h-5 text-rose-500" fill="currentColor" />} label={heartsLabel}>
          <span className="text-xs font-extrabold text-ink-500 flex items-center gap-1">
            {hearts}/5 · <Gem className="w-3.5 h-3.5 text-cyan-500" /> 50
          </span>
        </Row>
        <Row
          onClick={() => navigate('/learn/model-setup')}
          icon={<Cpu className="w-5 h-5 text-steppe-600" />}
          label={lang === 'kk' ? 'Офлайн ИИ-ұстазды қос' : lang === 'ru' ? 'Запустить ИИ офлайн' : 'Run Gemmi offline'}
        >
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-steppe-600">Gemma 4 · LiteRT</span>
        </Row>
        <Row
          onClick={() => navigate('/learn/voice-setup')}
          icon={<Volume2 className="w-5 h-5 text-steppe-600" />}
          label={lang === 'kk' ? 'Офлайн дауыстар' : lang === 'ru' ? 'Офлайн-голоса' : 'Offline voices'}
        >
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-steppe-600">Piper · sherpa-onnx</span>
        </Row>
        <Row onClick={() => setConfirmReset(true)} icon={<RotateCcw className="w-5 h-5 text-ruby-500" />} label={t('reset', lang)} danger />
        <Row
          onClick={() => setAboutOpen(true)}
          icon={<Info className="w-5 h-5 text-ink-500" />}
          label={lang === 'kk' ? 'Gemmi туралы' : lang === 'ru' ? 'О Gemmi' : 'About Gemmi'}
        />
      </div>

      <div className="mt-6 text-center text-[11px] font-bold text-ink-300">
        Gemmi Academy · v0.1
      </div>


      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          >
            <div className={`pointer-events-auto rounded-full px-4 py-2 text-sm font-extrabold shadow-soft flex items-center gap-2 ${
              toast.tone === 'ok' ? 'bg-leaf-500 text-white' :
              toast.tone === 'warn' ? 'bg-sun-400 text-sun-700' :
              'bg-ink-900 text-white'
            }`}>
              {toast.tone === 'ok' && <Check className="w-4 h-4" strokeWidth={3} />}
              {toast.msg}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {langOpen && (
          <Modal onClose={() => setLangOpen(false)}>
            <h3 className="text-xl font-extrabold text-ink-900 mb-3">{t('changeLang', lang)}</h3>
            <LangSwitcher value={lang} onChange={(v) => { setLang(v); setLangOpen(false) }} />
          </Modal>
        )}
        {gradeOpen && (
          <Modal onClose={() => setGradeOpen(false)}>
            <h3 className="text-xl font-extrabold text-ink-900 mb-1">{t('changeGrade', lang)}</h3>
            <p className="text-sm font-semibold text-ink-500 mb-4">{t('pickGradeSub', lang)}</p>
            <div className="space-y-2">
              {[
                { value: 1, key: 'gradeBeginner', subKey: 'gradeBeginnerSub', emoji: '🌱' },
                { value: 2, key: 'gradeIntermediate', subKey: 'gradeIntermediateSub', emoji: '🚀' },
                { value: 3, key: 'gradeAdvanced', subKey: 'gradeAdvancedSub', emoji: '🦅' },
                { value: 4, key: 'gradeHighSchool', subKey: 'gradeHighSchoolSub', emoji: '🎓' },
                { value: 5, key: 'gradeCollege', subKey: 'gradeCollegeSub', emoji: '🧠' },
              ].map((g) => (
                <button key={g.value}
                  onClick={() => { setGrade(g.value); setGradeOpen(false) }}
                  className={`w-full text-left rounded-2xl border-2 px-4 py-3 transition-all ${
                    grade === g.value ? 'border-steppe-500 bg-steppe-50' : 'border-ink-200 bg-white'
                  }`}>
                  <div className="flex items-center gap-3">
                    <div className="text-3xl">{g.emoji}</div>
                    <div>
                      <div className={`font-extrabold ${grade === g.value ? 'text-steppe-700' : 'text-ink-900'}`}>{t(g.key, lang)}</div>
                      <div className="text-xs font-semibold text-ink-500 mt-0.5">{t(g.subKey, lang)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </Modal>
        )}
        {confirmReset && (
          <Modal onClose={() => setConfirmReset(false)}>
            <h3 className="text-xl font-extrabold text-ink-900">Reset all progress?</h3>
            <p className="text-ink-500 font-semibold text-sm mt-1">XP, streaks and lesson stars will be erased.</p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setConfirmReset(false)} className="btn-ghost flex-1">{t('stay', lang)}</button>
              <button onClick={() => { resetAll(); navigate('/learn') }} className="btn-danger flex-1">Reset</button>
            </div>
          </Modal>
        )}
        {aboutOpen && (
          <Modal onClose={() => setAboutOpen(false)}>
            <AboutGemmi lang={lang} />
          </Modal>
        )}
      </AnimatePresence>
    </div>
  )
}

function AboutGemmi({ lang }) {
  const COPY = {
    en: {
      title: 'About Gemmi',
      blocks: [
        {
          h: 'The name',
          p: 'Gemmi is named after Gemma 4, Google\'s open on-device model. The version that ships inside the Android app is Gemma 4 E2B-it, int4-quantised by the LiteRT community team and loaded through LiteRT. It downloads on first use (about 2 GB, resumable over spotty cell) rather than bundling into the APK. Once installed, the tutor runs entirely on your phone. No network. No API costs. No data leaves the device.',
        },
        {
          h: 'The mascot',
          p: 'Gemmi is a bowerbird. In the wild, male bowerbirds famously collect bottle caps, beads, and gemstones (anything bright and beautiful) and arrange them carefully to decorate their bowers. It\'s one of the most striking displays of aesthetic curation in the animal kingdom. A fitting emblem for a learning app: the work isn\'t just acquiring knowledge, it\'s curating what you collect. Choosing what to keep, arranging it in your head so it makes sense, putting the brightest pieces on display.',
        },
        {
          h: 'The stack',
          ps: [
            'Curriculum: hand-curated K-2 content plus 3,000+ trilingual MMLU-Pro questions for G3 to G5.',
            'On-device AI: Gemma 4 E2B-it running via LiteRT in a Capacitor Android plugin.',
            'Cloud fallback: Gemini 2.5 Flash, used until the on-device Gemma is installed.',
            'App: React + Vite, offline service worker, voice I/O via Web Speech API.',
          ],
        },
      ],
      close: 'Close',
    },
    ru: {
      title: 'О Gemmi',
      blocks: [
        {
          h: 'Имя',
          p: 'Gemmi названа в честь Gemma 4, открытой on-device модели Google. Внутри Android-приложения работает Gemma 4 E2B-it, квантизованная int4 командой LiteRT-сообщества и подгружаемая через LiteRT. Скачивается при первом запуске (около 2 ГБ, с возобновлением при нестабильной сотовой связи), а не упаковывается в APK. После установки наставник работает полностью на телефоне. Без сети. Без оплаты API. Без выхода данных за пределы устройства.',
        },
        {
          h: 'Маскот',
          p: 'Gemmi, птица-шалашник. В природе самцы шалашников собирают пробки, бусины, драгоценные камешки (всё яркое и красивое) и тщательно раскладывают это, украшая свои «беседки». Это один из самых ярких примеров эстетического кураторства в животном мире. Подходящая эмблема для приложения об учении: важно не просто получать знания, а отбирать. Выбирать, что оставить, расставлять у себя в голове и выставлять самое драгоценное на показ.',
        },
        {
          h: 'Стек',
          ps: [
            'Программа: ручной K-2 плюс 3000+ трёхъязычных вопросов MMLU-Pro для G3 по G5.',
            'On-device ИИ: Gemma 4 E2B-it через LiteRT в Capacitor-плагине.',
            'Облачный резерв: Gemini 2.5 Flash, до установки локальной Gemma.',
            'Приложение: React + Vite, offline service worker, голос через Web Speech API.',
          ],
        },
      ],
      close: 'Закрыть',
    },
    kk: {
      title: 'Gemmi туралы',
      blocks: [
        {
          h: 'Аты',
          p: 'Gemmi атауы Google-дың ашық on-device моделі Gemma 4-тен алынған. Android қосымшасының ішінде LiteRT қауымдастығы int4-ке кванттаған Gemma 4 E2B-it жұмыс істейді, LiteRT арқылы жүктеледі. Алғаш ашқанда телефонға жүктеледі (шамамен 2 ГБ, нашар ұялы байланыс кезінде қайта жалғасады), APK ішіне салынбайды. Орнатылғаннан кейін ұстаз толығымен телефонда жұмыс істейді. Желі жоқ. API ақысы жоқ. Деректер құрылғыдан кетпейді.',
        },
        {
          h: 'Маскот',
          p: 'Gemmi, шалаш құрушы құс (bowerbird). Табиғатта еркек шалашшылар тығындарды, моншақтарды, асыл тастарды (жарқыраған, әсем заттарды) жинап, олардан өздерінің «бесігін» ұқыпты түрде безендіреді. Бұл жануарлар әлеміндегі эстетикалық таңдаудың ең айқын мысалы. Білім жинау бағдарламасы үшін сай эмблема: маңыздысы білімді жинау ғана емес, оны таңдау, ойда орналастыру және ең құнды жерлерін көрсету.',
        },
        {
          h: 'Технология',
          ps: [
            'Бағдарлама: 1-2 сыныптарға қолмен жасалған сабақтар, 3-5 сыныпқа арналған 3000+ үш тілді MMLU-Pro сұрағы.',
            'On-device ИИ: Gemma 4 E2B-it, LiteRT арқылы Capacitor плагінінде.',
            'Бұлттық резерв: Gemini 2.5 Flash, жергілікті Gemma орнатылғанға дейін.',
            'Қосымша: React + Vite, офлайн service worker, дауыс (Web Speech API).',
          ],
        },
      ],
      close: 'Жабу',
    },
  }
  const c = COPY[lang] || COPY.en
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 grid place-items-center rounded-2xl bg-steppe-50 overflow-hidden">
          <Mascot size={56} mood="idle" />
        </div>
        <div>
          <h3 className="text-xl font-extrabold text-ink-900">{c.title}</h3>
          <div className="text-xs font-bold text-ink-500">Gemmi Academy</div>
        </div>
      </div>
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        {c.blocks.map((b, i) => (
          <div key={i}>
            <div className="text-xs font-extrabold uppercase tracking-wide text-steppe-700">{b.h}</div>
            {b.p && <p className="mt-1 text-sm font-semibold text-ink-700 leading-relaxed">{b.p}</p>}
            {b.ps && (
              <ul className="mt-1 text-sm font-semibold text-ink-700 leading-relaxed space-y-1 list-none">
                {b.ps.map((line, j) => <li key={j} className="flex gap-2"><span className="text-steppe-500">·</span><span>{line}</span></li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
      <div className="mt-5 text-[11px] font-bold text-ink-400 text-center">
        Built with care for Kazakhstan · open-source models · zero-tracking
      </div>
    </div>
  )
}

function Mini({ label, value }) {
  return (
    <div className="rounded-2xl border-2 border-ink-100 bg-white p-3 text-center">
      <div className="text-2xl font-extrabold text-ink-900">{value}</div>
      <div className="text-xs font-bold text-ink-500">{label}</div>
    </div>
  )
}

function Row({ icon, label, onClick, danger, children }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-2xl border-2 ${danger ? 'border-ruby-100 hover:border-ruby-300 text-ruby-600' : 'border-ink-100 hover:border-ink-200 text-ink-900'} bg-white px-4 py-3 text-left font-extrabold`}>
      {icon}
      <span className="flex-1">{label}</span>
      {children}
    </button>
  )
}

function Modal({ children, onClose }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-md bg-white rounded-3xl p-6"
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >{children}</motion.div>
    </motion.div>
  )
}
