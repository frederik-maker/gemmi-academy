// First-run model download UI for the on-device tutor. Linked from the
// tutor chat ("Run Джемми offline →") when running inside the APK and the
// model isn't yet on disk.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Cpu, Download, Check, AlertTriangle, ChevronLeft, Loader2 } from 'lucide-react'
import { useStore } from '../store.js'

const STR = {
  title: { kk: 'Джеммиті офлайн іске қос', ru: 'Запусти Джеммиа офлайн', en: 'Run Gemmi offline' },
  intro: {
    kk: 'Джемми ИИ-моделі құрылғыңа жүктеледі. Алғашқы рет — Wi-Fi арқылы. Кейін интернет керек емес.',
    ru: 'ИИ-модель Джеммиа загрузится на устройство. Первый раз — по Wi-Fi. Потом без интернета.',
    en: 'The on-device AI model downloads once over Wi-Fi. After that, the tutor works fully offline — no network, no API costs.',
  },
  size: { kk: 'Көлемі', ru: 'Размер', en: 'Size' },
  download: { kk: 'Жүктеу', ru: 'Скачать', en: 'Download model' },
  downloading: { kk: 'Жүктелуде…', ru: 'Загрузка…', en: 'Downloading…' },
  ready: { kk: 'Дайын!', ru: 'Готово!', en: 'Ready!' },
  resume: { kk: 'Жалғастыру', ru: 'Продолжить', en: 'Resume' },
  unsupported: {
    kk: 'Сенің құрылғыңда жадтың сыйымдылығы аз. Бұлттық режим қолданылады.',
    ru: 'На устройстве недостаточно памяти — будет использоваться облако.',
    en: 'This device doesn\'t have enough RAM. Sticking to cloud mode.',
  },
  webOnly: {
    kk: 'Бұл функция тек Android қосымшасында жұмыс істейді.',
    ru: 'Эта функция доступна только в Android-приложении.',
    en: 'On-device AI only works in the Android app build, not in the browser preview.',
  },
  ramDetected: { kk: 'Құрылғы жады', ru: 'Оперативка устройства', en: 'Device RAM' },
  variant: { kk: 'Модель нұсқасы', ru: 'Вариант модели', en: 'Model variant' },
}

export default function ModelSetup() {
  const lang = useStore((s) => s.lang) || 'en'
  const navigate = useNavigate()
  const [caps, setCaps] = useState(null)
  const [progress, setProgress] = useState(null) // { downloaded, total }
  const [phase, setPhase] = useState('idle') // idle | downloading | done | error
  const [error, setError] = useState(null)
  const [native, setNative] = useState(undefined) // undefined until checked

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Wait a tick for nativeTutor.setupNativeTutor to register.
      await new Promise((r) => setTimeout(r, 50))
      if (!window.GemmiTutor) {
        if (alive) setNative(false)
        return
      }
      if (alive) setNative(true)
      try {
        const c = await window.GemmiTutor.deviceCaps()
        if (alive) setCaps(c)
      } catch (e) {
        if (alive) setError(e?.message || 'caps_failed')
      }
    })()
    return () => { alive = false }
  }, [])

  const start = async () => {
    if (!window.GemmiTutor) return
    setPhase('downloading')
    try {
      await window.GemmiTutor.download({
        onProgress: ({ downloaded, total }) => setProgress({ downloaded, total }),
      })
      // Flag the model as ready so tutorProviders.nativeProvider.available()
      // starts returning true on the next chat open, routing inference to the
      // local Gemma 4 instead of Gemini.
      try { localStorage.setItem('gemmi-offline-model-ready', 'true') } catch { /* private mode */ }
      setPhase('done')
    } catch (e) {
      setError(e?.message || 'download_failed')
      setPhase('error')
    }
  }

  const variantInfo = caps ? caps.recommendedVariant : null
  const pct = progress?.total ? Math.round((progress.downloaded / progress.total) * 100) : 0
  const sizeMb = progress?.total ? Math.round(progress.total / (1024 * 1024)) : null

  return (
    <div className="pb-24">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="w-10 h-10 grid place-items-center rounded-full bg-white border border-ink-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="text-xs font-bold text-ink-500">Джемми AI</div>
          <h1 className="text-xl font-extrabold text-ink-900">{STR.title[lang]}</h1>
        </div>
      </div>

      <div className="rounded-3xl bg-gradient-to-br from-ink-900 to-steppe-900 text-white p-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/10 grid place-items-center">
            <Cpu className="w-7 h-7 text-sun-300" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-xs font-bold opacity-80 uppercase tracking-wide">Gemma 4 · LiteRT</div>
            <div className="text-lg font-extrabold">on-device tutor</div>
          </div>
        </div>
        <p className="mt-4 text-sm opacity-90 leading-relaxed">{STR.intro[lang]}</p>
      </div>

      {native === false && (
        <div className="mt-5 rounded-2xl border-2 border-ink-100 bg-white p-4 flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-sun-500 flex-shrink-0 mt-0.5" strokeWidth={3} />
          <div className="text-sm font-semibold text-ink-700">{STR.webOnly[lang]}</div>
        </div>
      )}

      {caps && (
        <div className="mt-5 rounded-2xl border-2 border-ink-100 bg-white p-4">
          <Stat label={STR.ramDetected[lang]} value={`${(caps.totalRamMb / 1024).toFixed(1)} GB`} />
          <Stat label={STR.variant[lang]} value={variantInfo === 'none' ? '—' : `Gemma 4 ${variantInfo}`} />
        </div>
      )}

      {caps?.recommendedVariant === 'none' && (
        <div className="mt-5 rounded-2xl bg-sun-50 border-2 border-sun-200 p-4 text-sm font-semibold text-sun-700">
          {STR.unsupported[lang]}
        </div>
      )}

      {native && caps?.recommendedVariant !== 'none' && (
        <div className="mt-5 rounded-3xl border-2 border-ink-100 bg-white p-4">
          {phase === 'downloading' && (
            <div>
              <div className="flex items-center justify-between text-sm font-extrabold mb-2">
                <span className="flex items-center gap-2 text-steppe-600">
                  <Loader2 className="w-4 h-4 animate-spin" /> {STR.downloading[lang]}
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-3 rounded-full bg-ink-100 overflow-hidden">
                <motion.div
                  className="h-full bg-steppe-500"
                  animate={{ width: `${pct}%` }}
                  transition={{ type: 'spring', stiffness: 80 }}
                />
              </div>
              {sizeMb && (
                <div className="mt-2 text-xs font-bold text-ink-500">
                  {Math.round(progress.downloaded / (1024 * 1024))} / {sizeMb} MB
                </div>
              )}
            </div>
          )}

          {phase === 'done' && (
            <div className="flex items-center gap-2 text-leaf-500 font-extrabold">
              <Check className="w-5 h-5" strokeWidth={3} /> {STR.ready[lang]}
            </div>
          )}

          {phase === 'error' && (
            <div className="flex items-start gap-2 text-ruby-600 font-bold text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              {error}
            </div>
          )}

          {(phase === 'idle' || phase === 'error') && (
            <button onClick={start} className="btn-primary w-full">
              <Download className="w-5 h-5" />
              {phase === 'error' ? STR.resume[lang] : STR.download[lang]}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2 first:pt-0 last:pb-0 border-b last:border-0 border-ink-100">
      <span className="text-xs font-bold text-ink-500 uppercase tracking-wide">{label}</span>
      <span className="text-sm font-extrabold text-ink-900">{value}</span>
    </div>
  )
}
