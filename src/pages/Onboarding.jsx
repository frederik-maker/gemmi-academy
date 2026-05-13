import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useStore } from '../store.js'
import { t } from '../i18n.js'
import LangSwitcher from '../components/LangSwitcher.jsx'
import Mascot from '../components/Mascot.jsx'

const AVATARS = ['🐆','🦅','🐺','🦊','🦄','🐯','🐻','🐰']
const GOALS = [
  { key: 'goalCasual', xp: 10 },
  { key: 'goalRegular', xp: 20 },
  { key: 'goalSerious', xp: 30 },
  { key: 'goalIntense', xp: 50 },
]
const GRADES = [
  { value: 1, key: 'gradeBeginner', subKey: 'gradeBeginnerSub', emoji: '🌱' },
  { value: 2, key: 'gradeIntermediate', subKey: 'gradeIntermediateSub', emoji: '🚀' },
  { value: 3, key: 'gradeAdvanced', subKey: 'gradeAdvancedSub', emoji: '🦅' },
  { value: 4, key: 'gradeHighSchool', subKey: 'gradeHighSchoolSub', emoji: '🎓' },
  { value: 5, key: 'gradeCollege', subKey: 'gradeCollegeSub', emoji: '🧠' },
]

export default function Onboarding() {
  const finish = useStore((s) => s.finishOnboarding)
  const [step, setStep] = useState(0)
  const [lang, setLang] = useState('en')
  const [grade, setGrade] = useState(2)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState('🐆')
  const [goal, setGoal] = useState(20)
  const TOTAL_STEPS = 5

  const next = () => setStep((s) => s + 1)
  const finalize = () => finish({ name, avatar, lang, grade, dailyGoal: goal })

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-steppe-50 to-white"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 32px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
      }}
    >
      <div className="max-w-md mx-auto px-5 pb-8 min-h-screen flex flex-col">
        <ProgressDots count={TOTAL_STEPS} active={step} />
        <div className="mt-6 flex-1">
          {step === 0 && <Step key="0" title={t('pickLang', lang)} subtitle={t('pickLangSub', lang)}>
            <LangSwitcher value={lang} onChange={setLang} />
          </Step>}
          {step === 1 && <Step key="1" title={t('pickGrade', lang)} subtitle={t('pickGradeSub', lang)}>
            <div className="space-y-3">
              {GRADES.map((g) => {
                const active = grade === g.value
                return (
                  <button key={g.value} onClick={() => setGrade(g.value)}
                    className={`w-full text-left rounded-2xl border-2 px-5 py-4 transition-all ${
                      active ? 'border-steppe-500 bg-steppe-50' : 'border-ink-200 bg-white'
                    }`}>
                    <div className="flex items-center gap-3">
                      <div className="text-3xl">{g.emoji}</div>
                      <div>
                        <div className={`font-extrabold ${active ? 'text-steppe-700' : 'text-ink-900'}`}>{t(g.key, lang)}</div>
                        <div className="text-xs font-semibold text-ink-500 mt-0.5">{t(g.subKey, lang)}</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </Step>}
          {step === 2 && <Step key="2" title={t('whatsYourName', lang)} subtitle="">
            <input
              autoFocus value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Aida"
              className="w-full text-2xl font-extrabold text-ink-900 px-5 py-4 rounded-2xl border-2 border-ink-200 focus:border-steppe-500 outline-none bg-white"
            />
            <div className="mt-4 flex justify-center">
              <Mascot size={160} mood="wave" />
            </div>
          </Step>}
          {step === 3 && <Step key="3" title={t('pickAvatar', lang)} subtitle="">
            <div className="grid grid-cols-4 gap-3">
              {AVATARS.map((a) => (
                <button key={a} onClick={() => setAvatar(a)}
                  className={`aspect-square text-4xl rounded-2xl border-2 transition-all ${
                    avatar === a ? 'border-steppe-500 bg-steppe-50' : 'border-ink-200 bg-white'
                  }`}>{a}</button>
              ))}
            </div>
          </Step>}
          {step === 4 && <Step key="4" title={t('dailyGoal', lang)} subtitle="">
            <div className="space-y-3">
              {GOALS.map((g) => (
                <button key={g.xp} onClick={() => setGoal(g.xp)}
                  className={`w-full text-left rounded-2xl border-2 px-5 py-4 font-extrabold transition-all ${
                    goal === g.xp ? 'border-steppe-500 bg-steppe-50 text-steppe-700' : 'border-ink-200 bg-white text-ink-900'
                  }`}>
                  {t(g.key, lang)}
                </button>
              ))}
            </div>
          </Step>}
        </div>

        <div className="sticky bottom-4">
          {step < TOTAL_STEPS - 1 ? (
            <button
              disabled={step === 2 && name.trim().length < 1}
              onClick={next}
              className="btn-primary w-full disabled:opacity-50">
              {t('continue', lang)} <ArrowRight className="w-5 h-5" />
            </button>
          ) : (
            <button onClick={finalize} className="btn-success w-full">
              {t('start', lang)} <ArrowRight className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProgressDots({ count, active }) {
  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}
          className={`h-2 rounded-full transition-all ${i <= active ? 'bg-steppe-500 w-8' : 'bg-ink-200 w-2'}`}
        />
      ))}
    </div>
  )
}

function Step({ title, subtitle, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
    >
      <h2 className="text-2xl font-extrabold text-ink-900">{title}</h2>
      {subtitle && <p className="mt-1.5 text-ink-500 font-semibold">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </motion.div>
  )
}
