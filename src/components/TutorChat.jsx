import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Send, Wrench, Check, Loader2, ChevronRight, Cpu,
  Mic, MicOff, Volume2, VolumeX, Camera, Play,
} from 'lucide-react'
import { useStore } from '../store.js'
import { streamTutor } from '../lib/tutorClient.js'
import { useOnlineStatus } from '../lib/offline.js'
import { useSpeechRecognition, speak, stopSpeaking, ttsSupported } from '../lib/voice.js'
import Mascot from './Mascot.jsx'
import LatexText from './LatexText.jsx'
import GemPattern from './GemPattern.jsx'

// Resize a base64 JPEG (or any Image-loadable string) to a max edge of
// 1024px, returns a fresh base64 JPEG. Used both by the file-input path
// and the @capacitor/camera path so the resulting payload size is the
// same regardless of source.
async function resizeBase64ToJpeg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const maxEdge = 1024
      const scale = Math.min(maxEdge / img.width, maxEdge / img.height, 1)
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
      const dataUrl = c.toDataURL('image/jpeg', 0.85)
      resolve({ data: dataUrl.split(',')[1], mimeType: 'image/jpeg', previewUrl: dataUrl })
    }
    img.onerror = () => reject(new Error('image_decode_failed'))
    img.src = src
  })
}

// Use @capacitor/camera when running natively — input[type=file]
// capture="environment" is unreliable on Android (the WebView falls
// back to the file picker / gallery, which is what the user kept
// landing in). On the web, the file input is still the right path.
async function takePhotoNative() {
  try {
    const mod = await import('@capacitor/camera')
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform?.()) return null
    const photo = await mod.Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: mod.CameraResultType.DataUrl,
      source: mod.CameraSource.Camera,         // <- forces actual camera, not gallery
      correctOrientation: true,
    })
    if (!photo?.dataUrl) return null
    return resizeBase64ToJpeg(photo.dataUrl)
  } catch (_) {
    return null
  }
}

// All strings in three languages — the tutor itself is the polish.
const STR = {
  title: { kk: 'Джемми', ru: 'Джемми', en: 'Gemmi' },
  subtitle: { kk: 'ИИ-ұстаз', ru: 'ИИ-наставник', en: 'AI tutor' },
  placeholder: {
    kk: 'Сұрағыңды жаз…',
    ru: 'Спроси что-нибудь…',
    en: 'Ask anything…',
  },
  thinking: { kk: 'Ойланып жатырмын…', ru: 'Думаю…', en: 'Thinking…' },
  hold: { kk: 'Сөйле', ru: 'Говори', en: 'Speak' },
  listening: { kk: 'Тыңдап жатырмын…', ru: 'Слушаю…', en: 'Listening…' },
  micUnsupported: {
    kk: 'Бұл құрылғыда дауыспен ұсыныс мүмкін емес.',
    ru: 'На этом устройстве голосовой ввод не поддерживается.',
    en: 'Voice input isn\'t available on this device.',
  },
  startQuiz: { kk: 'Тексеру', ru: 'Проверить', en: 'Check' },
  toolNames: {
    get_student_state: { kk: 'прогресті қарап', ru: 'смотрит прогресс', en: 'checking progress' },
    find_lessons: { kk: 'сабақтарды табуда', ru: 'ищет уроки', en: 'finding lessons' },
    recommend_next_lesson: { kk: 'келесі сабақты таңдауда', ru: 'выбирает урок', en: 'picking your next lesson' },
    generate_practice_question: { kk: 'жаттығу құрастыруда', ru: 'готовит задачу', en: 'writing a question' },
  },
  // Per-grade greetings: what Gemmi opens with.
  greeting: {
    1: {
      kk: 'Сәлем, дос! Бүгін не үйренеміз? 🐾',
      ru: 'Привет! Что будем учить? 🐾',
      en: 'Hi, friend! What should we learn today? 🐾',
    },
    2: {
      kk: 'Сәлем! Қандай сұрағың бар?',
      ru: 'Привет! Какой у тебя вопрос?',
      en: 'Hey! What\'s on your mind?',
    },
    3: {
      kk: 'Сәлем! Қандай тақырыпты талдайық?',
      ru: 'Привет! Какую тему разберём?',
      en: 'Hi! Which topic do you want to dig into?',
    },
    4: {
      kk: 'Сәлем. Не жайлы сұрағың бар?',
      ru: 'Привет. О чём поговорим?',
      en: 'Hey. What do you want help with?',
    },
    5: {
      kk: 'Сәлем. Қандай мәселе?',
      ru: 'Здравствуй. С чем нужна помощь?',
      en: 'Hi. What can I help with?',
    },
  },
}

// Curiosity-driven prompts per grade band. The point of opening the tutor
// is to ASK SOMETHING you've been wondering about — not to ask "how am I
// doing?". Each grade gets four ideas calibrated to its vocabulary.
const SUGGESTIONS = {
  1: {
    kk: ['Аспан неге көк?', 'Шөп неге жасыл?', 'Құстар қалай ұшады?', 'Неге ұйықтаймыз?'],
    ru: ['Почему небо синее?', 'Почему трава зелёная?', 'Как птицы летают?', 'Зачем мы спим?'],
    en: ['Why is the sky blue?', 'Why is grass green?', 'How do birds fly?', 'Why do we sleep?'],
  },
  2: {
    kk: ['Кемпірқосақ қалай пайда болады?', 'Жанартау неге жарылады?', 'Ай неге жарық береді?', 'Мұз неге сумен қалқиды?'],
    ru: ['Откуда берётся радуга?', 'Почему извергаются вулканы?', 'Почему светит луна?', 'Почему лёд не тонет?'],
    en: ['How does a rainbow form?', 'Why do volcanoes erupt?', 'Why does the moon glow?', 'Why does ice float?'],
  },
  3: {
    kk: ['Шөп неге жасыл?', 'Гравитация дегеніміз не?', 'Дельфиндер қалай сөйлеседі?', 'Жанартаудың ішінде не бар?'],
    ru: ['Почему трава зелёная?', 'Что такое гравитация?', 'Как общаются дельфины?', 'Что внутри вулкана?'],
    en: ['Why is grass green?', 'What is gravity?', 'How do dolphins talk?', 'What\'s inside a volcano?'],
  },
  4: {
    kk: ['Фотосинтез қалай жұмыс істейді?', 'ДНҚ деген не?', 'Квадрат теңдеудің 2 түбірі неге?', 'Бірінші дүниежүзілік соғыс неден басталды?'],
    ru: ['Как работает фотосинтез?', 'Что такое ДНК?', 'Почему у квадратного уравнения 2 корня?', 'Из-за чего началась Первая мировая?'],
    en: ['How does photosynthesis work?', 'What is DNA?', 'Why does a quadratic have two roots?', 'What caused WWI?'],
  },
  5: {
    kk: ['Энтропияны қарапайым түсіндір', 'Риман гипотезасы дегеніміз не?', 'Орталық банктер пайыздық мөлшерлемені қалай белгілейді?', 'CRISPR қалай жұмыс істейді?'],
    ru: ['Объясни энтропию по-простому', 'Что такое гипотеза Римана?', 'Как центробанки задают ставку?', 'Как работает CRISPR?'],
    en: ['Explain entropy intuitively', 'What\'s the Riemann hypothesis?', 'How do central banks set rates?', 'How does CRISPR work?'],
  },
}


export default function TutorChat({ open, onClose, context, autoAsk }) {
  const lang = useStore((s) => s.lang) || 'en'
  const grade = useStore((s) => s.grade) || 3
  const state = useStore((s) => s)
  const online = useOnlineStatus()
  const navigate = (id) => {
    onClose()
    setTimeout(() => { window.location.href = `/learn/lesson/${id}` }, 100)
  }

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingTools, setStreamingTools] = useState([])
  const [error, setError] = useState(null)
  const [activeProvider, setActiveProvider] = useState(null)
  const [ttsOn, setTtsOn] = useState(false)
  // pendingImage shape: { data: <base64>, mimeType: 'image/jpeg', previewUrl: 'data:...' }
  const [pendingImage, setPendingImage] = useState(null)
  const scrollerRef = useRef(null)
  const abortRef = useRef(null)
  const fileInputRef = useRef(null)

  const voice = useSpeechRecognition(lang)

  useEffect(() => {
    if (open) setTimeout(() => scrollerRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }), 50)
  }, [open, messages.length, streamingText])

  useEffect(() => () => { abortRef.current?.abort(); stopSpeaking() }, [])
  useEffect(() => { if (!open) stopSpeaking() }, [open])

  // Auto-ask: when a caller opens the chat with a prebuilt question (e.g.
  // LessonPlayer opens after a wrong answer), fire it on open so the student
  // sees the tutor already explaining instead of an empty chat. We fire on
  // every open transition; LessonPlayer clears autoAsk via onClose so the
  // generic "Ask Gemmi" button from Learn doesn't accidentally re-fire stale
  // prompts.
  useEffect(() => {
    if (open && autoAsk && !streaming) {
      send(autoAsk)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoAsk])

  const studentState = useMemo(() => ({
    profile: state.profile,
    grade: state.grade,
    lang: state.lang,
    xp: state.xp,
    streak: state.streak,
    hearts: state.hearts,
    gems: state.gems,
    completedLessons: state.completedLessons,
    recentStruggles: state.recentStruggles,
    context,
  }), [state.profile, state.grade, state.lang, state.xp, state.streak, state.hearts, state.gems, state.completedLessons, state.recentStruggles, context])

  // Web fallback only — on native we go through @capacitor/camera which
  // forces the actual rear camera instead of the gallery picker.
  const onPickFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !file.type?.startsWith('image/')) return
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = (ev) => resolve(ev.target.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const img = await resizeBase64ToJpeg(dataUrl)
      setPendingImage(img)
    } catch {
      setError({ kk: 'Сурет ашылмады', ru: 'Не удалось открыть фото', en: 'Could not open photo' }[lang])
    }
  }

  // Camera button handler: native camera first, file-picker fallback.
  const onCameraTap = async () => {
    const native = await takePhotoNative()
    if (native) {
      setPendingImage(native)
      return
    }
    // Web (or native plugin not available) → fall back to the hidden
    // file input. The input's capture="environment" attribute hints to
    // mobile Chrome that it should open the camera, though it's not
    // honored everywhere.
    fileInputRef.current?.click()
  }

  const send = async (text, opts = {}) => {
    const image = opts.image !== undefined ? opts.image : pendingImage
    const parts = []
    if (image) {
      parts.push({
        type: 'image',
        data: image.data,
        mimeType: image.mimeType,
        previewUrl: image.previewUrl,
      })
    }
    if (text && text.trim()) {
      parts.push({ type: 'text', text: text.trim() })
    }
    if (!parts.length) return
    const userMessage = { role: 'user', content: parts }
    const next = [...messages, userMessage]
    setMessages(next)
    setInput('')
    setPendingImage(null)
    setStreaming(true)
    setStreamingText('')
    setStreamingTools([])
    setError(null)
    stopSpeaking()

    const controller = new AbortController()
    abortRef.current = controller

    const assistantTools = []
    let assistantText = ''
    try {
      for await (const ev of streamTutor({ messages: next, studentState, signal: controller.signal })) {
        if (ev.kind === 'provider') {
          setActiveProvider({ id: ev.id, name: ev.name, needsNetwork: ev.needsNetwork })
        } else if (ev.kind === 'delta') {
          assistantText += ev.text
          setStreamingText(assistantText)
        } else if (ev.kind === 'tool_start') {
          assistantTools.push({ name: ev.name, status: 'running' })
          setStreamingTools([...assistantTools])
        } else if (ev.kind === 'tool_result') {
          const t = assistantTools.find((x) => x.name === ev.name && x.status === 'running')
          if (t) {
            t.status = 'done'
            t.input = ev.input
            t.output = ev.output
            setStreamingTools([...assistantTools])
          }
        } else if (ev.kind === 'error') {
          setError(ev.message || 'tutor error')
        } else if (ev.kind === 'done') {
          break
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'connection error')
    }

    if (assistantText.trim() || assistantTools.length) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: assistantText.trim()
            ? [{ type: 'text', text: assistantText }]
            : [{ type: 'text', text: '(no reply)' }],
          tools: assistantTools,
        },
      ])
      if (ttsOn && assistantText.trim()) speak(assistantText, lang)
    } else if (!error) {
      setMessages((m) => m.slice(0, -1))
    }
    setStreamingText('')
    setStreamingTools([])
    setStreaming(false)
  }

  const toggleMic = () => {
    if (voice.listening) {
      voice.stop()
    } else if (voice.supported) {
      voice.start((finalText) => {
        if (finalText) send(finalText)
      })
    }
  }

  // Surface voice errors in the same banner as fetch errors so the user
  // sees "permission denied" or "no speech" instead of a stuck spinner.
  useEffect(() => {
    if (!voice.error) return
    const msg = {
      mic_permission_denied: { kk: 'Микрофонға рұқсат жоқ', ru: 'Нет доступа к микрофону', en: 'Microphone permission denied' }[lang],
      no_speech: { kk: 'Сөз естілмеді — қайта көр', ru: 'Не услышал — попробуй ещё', en: "Didn't catch that — try again" }[lang],
      recognition_failed_to_start: { kk: 'Сөйлеу тану қосылмады', ru: 'Распознавание речи не запустилось', en: "Speech recognition couldn't start" }[lang],
      not_supported: { kk: 'Бұл құрылғы дауыс жазуды қолдамайды', ru: 'Голосовой ввод не поддерживается', en: 'Voice input not supported on this device' }[lang],
    }[voice.error] || voice.error
    setError(msg)
  }, [voice.error, lang])

  const toggleTts = () => {
    if (ttsOn) {
      stopSpeaking()
      setTtsOn(false)
    } else {
      setTtsOn(true)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] bg-black/60 flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full sm:max-w-md h-[92vh] sm:h-[700px] bg-white sm:rounded-3xl rounded-t-3xl flex flex-col overflow-hidden relative"
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Friendly hero header with the mascot peeking */}
            <div className="relative overflow-hidden text-white"
                 style={{ background: 'linear-gradient(135deg, #1186f5 0%, #54c2ff 60%, #2ca6ff 100%)' }}>
              <GemPattern opacity={0.22} />
              <div className="relative px-5 pt-4 pb-3 flex items-center gap-3">
                <div className="relative -ml-1 -my-2">
                  <Mascot size={84} mood={streaming ? 'idle' : 'wave'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xl font-extrabold leading-tight">
                    {STR.title[lang]}
                  </div>
                  <div className="text-[11px] font-extrabold uppercase tracking-wider opacity-90 mt-0.5">
                    {STR.subtitle[lang]}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {ttsSupported && (
                    <button onClick={toggleTts}
                      aria-label="Toggle speech"
                      className={`w-9 h-9 rounded-full grid place-items-center ${ttsOn ? 'bg-sun-300 text-ink-900' : 'bg-white/15 text-white hover:bg-white/25'}`}>
                      {ttsOn ? <Volume2 className="w-5 h-5" strokeWidth={2.5} /> : <VolumeX className="w-5 h-5" strokeWidth={2.5} />}
                    </button>
                  )}
                  <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center">
                    <X className="w-5 h-5" strokeWidth={3} />
                  </button>
                </div>
              </div>
            </div>

            {/* Conversation area */}
            <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3 relative bg-gradient-to-b from-steppe-50/40 to-white">
              <GemPattern opacity={0.05} />
              {!online && !window.GemmiTutor && (
                <div className="rounded-2xl bg-ink-900 text-white px-4 py-3 text-xs font-bold flex items-center gap-2 relative">
                  <Cpu className="w-4 h-4 text-sun-300" />
                  {{
                    kk: 'Желі жоқ. On-device Gemma әлі келмеген.',
                    ru: 'Нет сети. Локальная Gemma пока не установлена.',
                    en: 'You\'re offline. The on-device Gemma model isn\'t installed yet.',
                  }[lang]}
                </div>
              )}

              {/* On Android, until the user has run through ModelSetup, surface
                  a nudge so they know they're on cloud and can move to the
                  on-device Gemma for free. Hidden on web (no GemmiTutor). */}
              {typeof window !== 'undefined' && window.GemmiTutor &&
                localStorage.getItem('gemmi-offline-model-ready') !== 'true' && (
                <button
                  onClick={() => { onClose(); setTimeout(() => navigate('/learn/model-setup'), 50) }}
                  className="w-full text-left rounded-2xl bg-gradient-to-br from-steppe-50 to-white border-2 border-steppe-200 px-3 py-2.5 flex items-center gap-2.5 hover:border-steppe-400 transition-colors relative"
                >
                  <span className="grid place-items-center w-8 h-8 rounded-xl bg-steppe-100 text-steppe-700 flex-shrink-0">
                    <Cpu className="w-4 h-4" strokeWidth={2.5} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-extrabold uppercase tracking-wide text-steppe-700">
                      {{ kk: 'Бұлтта жұмыс істеудеміз', ru: 'Сейчас на облаке', en: 'Running on cloud' }[lang]}
                    </span>
                    <span className="block text-xs font-bold text-ink-700 leading-tight">
                      {{
                        kk: 'Офлайн Gemma 4-ті қос — желі керек емес.',
                        ru: 'Включи офлайн-Gemma 4 — без интернета.',
                        en: 'Install offline Gemma 4 to skip the network.',
                      }[lang]}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-steppe-500 flex-shrink-0" strokeWidth={3} />
                </button>
              )}

              {messages.length === 0 && !streaming && (
                <EmptyState lang={lang} grade={grade} onSuggest={send} />
              )}

              {messages.map((m, i) => (
                <MessageBubble key={i} message={m} lang={lang} onOpenLesson={navigate} />
              ))}

              {streaming && (
                <div className="space-y-2 relative">
                  {streamingTools.map((t, i) => <ToolCallChip key={i} tool={t} lang={lang} />)}
                  {streamingText && (
                    <AssistantBubble>
                      <LatexText>{streamingText}</LatexText>
                      <span className="inline-block w-1.5 h-3.5 bg-steppe-500 ml-1 animate-pulse align-middle" />
                    </AssistantBubble>
                  )}
                  {!streamingText && streamingTools.length === 0 && (
                    <AssistantBubble>
                      <span className="flex items-center gap-2 text-ink-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> {STR.thinking[lang]}
                      </span>
                    </AssistantBubble>
                  )}
                </div>
              )}

              {error && (
                <div className="rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm font-semibold">
                  {error}
                </div>
              )}
            </div>

            {/* Listening overlay */}
            <AnimatePresence>
              {voice.listening && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
                  className="absolute bottom-24 inset-x-4 z-10"
                >
                  <div className="rounded-3xl bg-ink-900 text-white px-5 py-4 shadow-soft flex items-center gap-3">
                    <span className="relative grid place-items-center w-10 h-10 rounded-full bg-rose-500">
                      <span className="absolute inset-0 rounded-full bg-rose-500 animate-ping opacity-60" />
                      <Mic className="w-5 h-5 relative" strokeWidth={3} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-extrabold uppercase tracking-wide opacity-80">
                        {STR.listening[lang]}
                      </div>
                      <div className="text-sm font-bold truncate">{voice.interim || '…'}</div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Attached photo preview — shown above the input bar */}
            {pendingImage && (
              <div className="border-t border-ink-100 bg-white px-3 pt-2">
                <div className="inline-flex items-center gap-2 bg-steppe-50 border-2 border-steppe-200 rounded-2xl p-1.5 pr-3">
                  <img src={pendingImage.previewUrl} alt="" className="w-12 h-12 object-cover rounded-xl" />
                  <span className="text-xs font-extrabold text-steppe-700">
                    {{ kk: 'Сурет тіркелді', ru: 'Фото прикреплено', en: 'Photo attached' }[lang]}
                  </span>
                  <button type="button" onClick={() => setPendingImage(null)}
                    className="w-6 h-6 rounded-full bg-white text-ink-500 hover:text-ink-900 grid place-items-center"
                    aria-label="Remove photo">
                    <X className="w-3.5 h-3.5" strokeWidth={3} />
                  </button>
                </div>
              </div>
            )}

            {/* Input bar — px-4 gives the camera & send buttons clearance
                from the phone edges; pb-3 + safe-area-inset keeps the row
                off the gesture pill on edge-to-edge Androids. */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (streaming) return
                if (input.trim() || pendingImage) send(input.trim())
              }}
              className={`${pendingImage ? '' : 'border-t border-ink-100'} px-4 pt-3 bg-white flex gap-2 items-center`}
              style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onPickFile}
              />
              <button type="button" onClick={onCameraTap}
                disabled={streaming}
                aria-label={{ kk: 'Сурет түсіру', ru: 'Сделать фото', en: 'Take a photo' }[lang]}
                className="w-11 h-11 rounded-full bg-steppe-50 text-steppe-600 hover:bg-steppe-100 disabled:bg-ink-50 disabled:text-ink-300 grid place-items-center flex-shrink-0"
              >
                <Camera className="w-5 h-5" strokeWidth={2.5} />
              </button>
              <button type="button" onClick={toggleMic}
                disabled={!voice.supported}
                aria-label={voice.listening ? 'Stop' : STR.hold[lang]}
                className={`w-11 h-11 rounded-full grid place-items-center transition-all flex-shrink-0 ${
                  voice.listening
                    ? 'bg-rose-500 text-white shadow-[0_0_0_4px_rgba(239,68,68,0.18)]'
                    : voice.supported
                      ? 'bg-steppe-50 text-steppe-600 hover:bg-steppe-100'
                      : 'bg-ink-50 text-ink-300'
                }`}
              >
                {voice.listening ? <MicOff className="w-5 h-5" strokeWidth={2.5} /> : <Mic className="w-5 h-5" strokeWidth={2.5} />}
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={STR.placeholder[lang]}
                disabled={streaming}
                className="flex-1 min-w-0 bg-ink-50 rounded-full px-4 py-2.5 text-sm font-semibold text-ink-900 outline-none border-2 border-transparent focus:border-steppe-300 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={(!input.trim() && !pendingImage) || streaming}
                className="w-11 h-11 rounded-full bg-steppe-500 text-white grid place-items-center disabled:bg-ink-200 flex-shrink-0"
                aria-label="Send"
              >
                {streaming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" strokeWidth={3} />}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}


// ---- Empty state — header avatar is the single Gemmi on screen ------------
function EmptyState({ lang, grade, onSuggest }) {
  const greeting = STR.greeting[grade]?.[lang] || STR.greeting[3][lang]
  const suggestions = SUGGESTIONS[grade]?.[lang] || SUGGESTIONS[3][lang]
  return (
    <div className="flex flex-col items-center pt-10 pb-2">
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="max-w-[300px] text-center"
      >
        <div className="text-xl font-extrabold text-ink-900 leading-snug">{greeting}</div>
        <div className="mt-2 text-xs font-bold text-ink-500 uppercase tracking-wider">
          {{ kk: 'Кез келген сұрақ', ru: 'Любой вопрос', en: 'Ask anything' }[lang]}
        </div>
      </motion.div>
      <div className="mt-7 flex flex-wrap gap-2 justify-center px-2">
        {suggestions.map((q, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.06 }}
            onClick={() => onSuggest(q)}
            className="rounded-full bg-white border-2 border-ink-200 px-3.5 py-2 text-sm font-extrabold text-ink-700 hover:border-steppe-400 hover:text-steppe-700 shadow-sm"
          >
            {q}
          </motion.button>
        ))}
      </div>
    </div>
  )
}


// ---- Chat bubbles ----------------------------------------------------------
function AssistantBubble({ children }) {
  return (
    <div className="flex items-end gap-2">
      <div className="w-8 h-8 rounded-full bg-steppe-100 grid place-items-center flex-shrink-0 overflow-hidden">
        <Mascot size={36} mood="idle" />
      </div>
      <div className="relative max-w-[82%] bg-white border-2 border-ink-100 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed text-ink-900 shadow-sm">
        {children}
      </div>
    </div>
  )
}

function UserBubble({ children }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[82%] bg-gradient-to-br from-steppe-500 to-steppe-700 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed font-semibold shadow-sm">
        {children}
      </div>
    </div>
  )
}

function MessageBubble({ message, lang, onOpenLesson }) {
  const isUser = message.role === 'user'
  const text = (message.content || []).filter((c) => c?.type === 'text').map((c) => c.text).join('')
  const images = (message.content || []).filter((c) => c?.type === 'image')
  if (isUser) {
    return (
      <UserBubble>
        {images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {images.map((img, i) => (
              <img key={i}
                src={img.previewUrl || `data:${img.mimeType || 'image/jpeg'};base64,${img.data}`}
                alt=""
                className="max-w-[220px] max-h-[220px] rounded-xl"
              />
            ))}
          </div>
        )}
        {text && <span className="whitespace-pre-wrap"><LatexText>{text}</LatexText></span>}
      </UserBubble>
    )
  }
  return (
    <div className="space-y-2">
      {message.tools?.length > 0 && (
        <div className="ml-10 space-y-1.5">
          {message.tools.map((t, i) => <ToolCallChip key={i} tool={t} lang={lang} compact />)}
        </div>
      )}
      <AssistantBubble>
        <div className="whitespace-pre-wrap"><LatexText>{text}</LatexText></div>
        {text && <SpeakButton text={text} lang={lang} />}
        {message.tools?.filter((t) => t.name === 'generate_practice_question' && t.output?.ok).map((t, i) => (
          <PracticeCard key={`p${i}`} q={t.output} lang={lang} />
        ))}
        {message.tools?.filter((t) => (t.name === 'find_lessons' || t.name === 'recommend_next_lesson') && t.output).map((t, i) => (
          <LessonRecs key={`l${i}`} payload={t.output} lang={lang} onOpenLesson={onOpenLesson} />
        ))}
      </AssistantBubble>
    </div>
  )
}

// Small play icon inline with each assistant message. Tapping plays the
// message through speak(), which prefers Piper (sherpa-onnx, offline)
// when the requested-lang voice has been downloaded or is bundled
// (kk-KZ is bundled in the APK), and falls back to Web Speech otherwise.
function SpeakButton({ text, lang }) {
  const [playing, setPlaying] = useState(false)
  const onClick = async () => {
    if (playing) { stopSpeaking(); setPlaying(false); return }
    setPlaying(true)
    try { await speak(text, lang) }
    catch { /* ignore — fallback chain inside speak handles errors */ }
    finally { setPlaying(false) }
  }
  // Always render. ttsSupported is computed at module-load and on native
  // the Piper window globals aren't ready yet at that moment — guarding
  // on it hid the button on every APK install. speak() itself handles
  // the "no engine available" fallback chain (Piper → Web Speech → no-op).
  return (
    <button onClick={onClick}
      className="mt-2 inline-flex items-center gap-1.5 text-xs font-extrabold text-steppe-600 hover:text-steppe-700 bg-steppe-50 hover:bg-steppe-100 border border-steppe-200 rounded-full px-2.5 py-1"
      aria-label="Speak"
    >
      {playing
        ? <><Volume2 className="w-3.5 h-3.5" strokeWidth={2.5} />{{ kk: 'Тоқтату', ru: 'Остановить', en: 'Stop' }[lang]}</>
        : <><Play className="w-3 h-3" strokeWidth={3} fill="currentColor" />{{ kk: 'Дыбыспен', ru: 'Озвучить', en: 'Speak' }[lang]}</>}
    </button>
  )
}


function ToolCallChip({ tool, lang, compact }) {
  const label = STR.toolNames[tool.name]?.[lang] || tool.name
  const isDone = tool.status === 'done'
  return (
    <div className={`inline-flex items-center gap-1.5 text-xs font-extrabold ${
      compact
        ? 'text-ink-500'
        : 'bg-white border border-ink-100 rounded-full px-3 py-1.5 text-ink-600 shadow-sm ml-10'
    }`}>
      {isDone
        ? <Check className="w-3.5 h-3.5 text-leaf-500" strokeWidth={3} />
        : <Loader2 className="w-3.5 h-3.5 animate-spin text-steppe-500" />}
      <Wrench className="w-3 h-3 opacity-50" />
      <span className="lowercase">{label}</span>
    </div>
  )
}


function PracticeCard({ q, lang }) {
  const [picked, setPicked] = useState(null)
  const [checked, setChecked] = useState(false)
  const correct = picked === q.correctIndex
  return (
    <div className="mt-3 rounded-2xl bg-gradient-to-br from-steppe-50 to-white p-3 border-2 border-steppe-100">
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-steppe-700 flex items-center gap-1">
        ✨ {{ kk: 'Жаттығу', ru: 'Практика', en: 'Practice' }[lang]}
      </div>
      <div className="mt-1 text-sm font-extrabold text-ink-900"><LatexText>{q.prompt}</LatexText></div>
      <div className="mt-3 space-y-1.5">
        {q.options?.map((o, i) => {
          const sel = picked === i
          const right = checked && i === q.correctIndex
          const wrong = checked && sel && i !== q.correctIndex
          return (
            <button key={i}
              disabled={checked}
              onClick={() => setPicked(i)}
              className={`w-full text-left rounded-xl border-2 px-3 py-2 text-sm font-bold transition-all ${
                right ? 'border-leaf-400 bg-emerald-50 text-leaf-600' :
                wrong ? 'border-ruby-500 bg-rose-50 text-ruby-600' :
                sel ? 'border-steppe-500 bg-white text-steppe-700' :
                'border-ink-200 bg-white text-ink-900'
              }`}
            >
              <LatexText>{o}</LatexText>
            </button>
          )
        })}
      </div>
      {!checked ? (
        <button disabled={picked === null} onClick={() => setChecked(true)}
          className="mt-3 w-full rounded-xl bg-leaf-400 hover:bg-leaf-500 text-white font-extrabold py-2 disabled:bg-ink-200 disabled:text-ink-400">
          {STR.startQuiz[lang]}
        </button>
      ) : (
        <div className={`mt-3 rounded-xl px-3 py-2 text-xs font-extrabold ${correct ? 'bg-emerald-50 text-leaf-600' : 'bg-rose-50 text-ruby-600'}`}>
          {correct ? '✓ ' : '✗ '}<LatexText>{q.why_correct}</LatexText>
        </div>
      )}
    </div>
  )
}


function LessonRecs({ payload, lang, onOpenLesson }) {
  const list = Array.isArray(payload) ? payload : [payload]
  return (
    <div className="mt-2 space-y-1.5">
      {list.filter((x) => x?.lessonId).map((x, i) => (
        <button key={i} onClick={() => onOpenLesson(x.lessonId)}
          className="w-full flex items-center gap-2 rounded-xl border-2 border-ink-200 bg-white hover:border-steppe-300 px-3 py-2 text-left">
          <span className="text-xl">{x.subjectEmoji || '📘'}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-extrabold text-ink-900 truncate">{x.lessonTitle?.[lang] || x.lessonTitle?.en}</div>
            <div className="text-[11px] font-bold text-ink-500 truncate">{x.unitTitle?.[lang] || x.unitTitle?.en}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-400" />
        </button>
      ))}
    </div>
  )
}


