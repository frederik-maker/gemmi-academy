// On-device voice download UI for Piper TTS. Linked from Profile → "Offline
// voices". Each voice is an opt-in download; the kk-KZ one is the only one
// most users will care about (en/ru already work fine via Web Speech on
// Android, but Kazakh has no good system voice and falls through to ru-RU,
// which is audibly wrong).

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronLeft, Download, Check, Loader2, Volume2, AlertTriangle, Mic } from 'lucide-react'
import { useStore } from '../store.js'

const STR = {
  title:    { kk: 'Офлайн дауыстар', ru: 'Офлайн-голоса', en: 'Offline voices' },
  sub:      {
    kk: 'Дауыстар құрылғыңа жүктеледі. Алғаш — Wi-Fi арқылы. Кейін интернетсіз сөйлейді.',
    ru: 'Голоса загружаются на устройство. Первый раз — по Wi-Fi. Потом работают офлайн.',
    en: 'Voices download once over Wi-Fi. After that, Gemmi speaks fully offline — no network, no cloud TTS.',
  },
  webOnly:  {
    kk: 'Бұл функция тек Android қосымшасында жұмыс істейді. Веб-нұсқада браузердің дауысы қолданылады.',
    ru: 'Эта функция работает только в Android-приложении. На вебе используется голос браузера.',
    en: 'Offline voices are an Android-app feature. On the web the browser\'s built-in voice is used.',
  },
  download: { kk: 'Жүктеу', ru: 'Скачать', en: 'Download' },
  downloading: { kk: 'Жүктелуде…', ru: 'Загрузка…', en: 'Downloading…' },
  ready:    { kk: 'Орнатылған', ru: 'Установлен', en: 'Installed' },
  retry:    { kk: 'Қайта көру', ru: 'Повторить', en: 'Retry' },
  langName: {
    kk: { kk: 'Қазақша', ru: 'Қазақша', en: 'Kazakh' },
    ru: { kk: 'Орысша', ru: 'Русский', en: 'Russian' },
    en: { kk: 'Ағылшын', ru: 'Английский', en: 'English' },
  },
  recommended: { kk: 'Ұсынылады', ru: 'Рекомендуем', en: 'Recommended' },
}

const LANGS = ['kk', 'ru', 'en']

export default function VoiceSetup() {
  const lang = useStore((s) => s.lang) || 'en'
  const navigate = useNavigate()
  const [native, setNative] = useState(undefined)
  const [states, setStates] = useState({}) // { kk: { state, sizeBytes, id }, ... }
  const [phases, setPhases] = useState({}) // { kk: 'idle' | 'downloading' | 'done' | 'error' }
  const [progress, setProgress] = useState({}) // { kk: { downloaded, total } }
  const [errors, setErrors] = useState({})

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Give setupPiperTts a moment to attach window.PiperTts.
      await new Promise((r) => setTimeout(r, 50))
      const piper = window.PiperTts
      if (!piper) { if (alive) setNative(false); return }
      if (alive) setNative(true)
      const out = {}
      for (const l of LANGS) {
        try { out[l] = await piper.voiceState(l) }
        catch (e) { out[l] = { state: 'unavailable', error: e?.message } }
      }
      if (alive) setStates(out)
    })()
    return () => { alive = false }
  }, [])

  const startDownload = async (l) => {
    setPhases((p) => ({ ...p, [l]: 'downloading' }))
    setErrors((e) => ({ ...e, [l]: null }))
    setProgress((p) => ({ ...p, [l]: { downloaded: 0, total: states[l]?.sizeBytes || 0 } }))
    try {
      await window.PiperTts.downloadVoice({
        lang: l,
        onProgress: ({ downloaded, total }) => setProgress((p) => ({ ...p, [l]: { downloaded, total } })),
      })
      setPhases((p) => ({ ...p, [l]: 'done' }))
      setStates((s) => ({ ...s, [l]: { ...s[l], state: 'ready' } }))
    } catch (e) {
      setErrors((er) => ({ ...er, [l]: e?.message || 'download_failed' }))
      setPhases((p) => ({ ...p, [l]: 'error' }))
    }
  }

  return (
    <div className="pb-24">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="w-10 h-10 grid place-items-center rounded-full bg-white border border-ink-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="text-xs font-bold text-ink-500">Piper TTS · sherpa-onnx</div>
          <h1 className="text-xl font-extrabold text-ink-900">{STR.title[lang]}</h1>
        </div>
      </div>

      <div className="rounded-3xl bg-gradient-to-br from-steppe-700 to-ink-900 text-white p-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/10 grid place-items-center">
            <Mic className="w-7 h-7 text-sun-300" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-xs font-bold opacity-80 uppercase tracking-wide">on-device tts</div>
            <div className="text-lg font-extrabold">human-quality voices, offline</div>
          </div>
        </div>
        <p className="mt-4 text-sm opacity-90 leading-relaxed">{STR.sub[lang]}</p>
      </div>

      {native === false && (
        <div className="mt-5 rounded-2xl border-2 border-ink-100 bg-white p-4 flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-sun-500 flex-shrink-0 mt-0.5" strokeWidth={3} />
          <div className="text-sm font-semibold text-ink-700">{STR.webOnly[lang]}</div>
        </div>
      )}

      {native && (
        <div className="mt-5 space-y-3">
          {LANGS.map((l) => {
            const st = states[l]
            const phase = phases[l] || (st?.state === 'ready' ? 'done' : 'idle')
            const sizeMb = st?.sizeBytes ? Math.round(st.sizeBytes / (1024 * 1024)) : null
            const prog = progress[l]
            const pct = prog?.total ? Math.round((prog.downloaded / prog.total) * 100) : 0
            const recommended = l === 'kk'
            return (
              <div key={l} className="rounded-2xl border-2 border-ink-100 bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-steppe-50 grid place-items-center">
                    <Volume2 className="w-5 h-5 text-steppe-600" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-sm font-extrabold text-ink-900">{STR.langName[l][lang]}</div>
                      {recommended && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wide text-leaf-700 bg-leaf-50 border border-leaf-200 rounded-full px-2 py-0.5">
                          {STR.recommended[lang]}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-bold text-ink-400 truncate mt-0.5">{st?.id || '…'}</div>
                    {sizeMb && (
                      <div className="text-xs font-semibold text-ink-500 mt-0.5">{sizeMb} MB</div>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {phase === 'done' && (
                      <div className="flex items-center gap-1 text-leaf-600 text-xs font-extrabold">
                        <Check className="w-4 h-4" strokeWidth={3} />
                        {STR.ready[lang]}
                      </div>
                    )}
                    {phase === 'downloading' && (
                      <Loader2 className="w-5 h-5 text-steppe-500 animate-spin" />
                    )}
                    {(phase === 'idle' || phase === 'error') && (
                      <button
                        onClick={() => startDownload(l)}
                        className="rounded-full bg-steppe-500 hover:bg-steppe-600 text-white text-xs font-extrabold px-3 py-1.5 flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" strokeWidth={3} />
                        {phase === 'error' ? STR.retry[lang] : STR.download[lang]}
                      </button>
                    )}
                  </div>
                </div>

                {phase === 'downloading' && (
                  <div className="mt-3">
                    <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                      <motion.div className="h-full bg-steppe-500"
                        animate={{ width: `${pct}%` }}
                        transition={{ type: 'spring', stiffness: 80 }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] font-bold text-ink-400 flex justify-between">
                      <span>{STR.downloading[lang]}</span>
                      <span>{pct}%</span>
                    </div>
                  </div>
                )}

                {phase === 'error' && (
                  <div className="mt-2 text-xs font-bold text-ruby-600 flex items-start gap-1">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span className="break-all">{errors[l]}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
