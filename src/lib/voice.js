// Web-Speech-API helpers. Works in Chromium-based browsers (which includes
// the Capacitor Android WebView). Wrap everything in feature checks because
// support varies — kk-KZ in particular is missing on some platforms; we fall
// back to ru-KZ → en-US progressively.

import { useEffect, useRef, useState, useCallback } from 'react'

const LANG_MAP = {
  kk: ['kk-KZ', 'ru-KZ', 'ru-RU', 'en-US'],
  ru: ['ru-RU', 'ru-KZ', 'en-US'],
  en: ['en-US', 'en-GB'],
}

function pickSpeechLang(lang) {
  return (LANG_MAP[lang] || LANG_MAP.en)[0]
}

// ---- Speech recognition (microphone → text) --------------------------------
export function useSpeechRecognition(lang) {
  const SR = typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null
  const supported = !!SR
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)
  const recogRef = useRef(null)
  const finalRef = useRef('')
  const onFinalRef = useRef(null)

  const start = useCallback((onFinal) => {
    if (!supported) {
      setError('not_supported')
      return
    }
    setError(null)
    setInterim('')
    finalRef.current = ''
    onFinalRef.current = onFinal

    const r = new SR()
    r.continuous = true
    r.interimResults = true
    r.lang = pickSpeechLang(lang)

    r.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalRef.current += t + ' '
        else live += t
      }
      setInterim(live)
    }
    r.onerror = (e) => setError(e.error || 'speech_error')
    r.onend = () => {
      setListening(false)
      const text = (finalRef.current + interim).trim()
      if (text && onFinalRef.current) onFinalRef.current(text)
    }
    recogRef.current = r
    try {
      r.start()
      setListening(true)
    } catch (e) {
      setError(e?.message || 'start_failed')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [SR, lang, supported])

  const stop = useCallback(() => {
    try { recogRef.current?.stop() } catch {}
  }, [])

  // Clean up on unmount
  useEffect(() => () => { try { recogRef.current?.abort() } catch {} }, [])

  return { supported, listening, interim, error, start, stop }
}


// ---- Speech synthesis (text → audio) ---------------------------------------
let _voicesPromise = null
function ensureVoices() {
  if (_voicesPromise) return _voicesPromise
  _voicesPromise = new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return resolve([])
    const list = window.speechSynthesis.getVoices()
    if (list.length) return resolve(list)
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      resolve(window.speechSynthesis.getVoices())
    }, { once: true })
    // Safety timeout in case the event never fires.
    setTimeout(() => resolve(window.speechSynthesis.getVoices() || []), 1500)
  })
  return _voicesPromise
}

// Try the native Piper TTS plugin (sherpa-onnx) first when it's set up AND
// the voice for this lang has been downloaded. Web Speech is the fallback
// for every other path — including Piper throwing mid-utterance. Native
// Piper is the only way we get a real kk-KZ voice on Android; Chrome's
// Web Speech kk-KZ either doesn't exist or falls through to ru-RU.
async function tryPiperSpeak(text, lang) {
  const piper = typeof window !== 'undefined' ? window.PiperTts : null
  if (!piper) return false
  try {
    const st = await piper.voiceState(lang)
    // 'bundled' = shipped inside the APK (kk_KZ), 'ready' = user downloaded
    // it into filesDir. Both mean the engine can speak now.
    if (st?.state !== 'ready' && st?.state !== 'bundled') return false
    await piper.speak({ text, lang })
    return true
  } catch {
    return false
  }
}

export async function speak(text, lang) {
  // Strip any leftover LaTeX delimiters so the engine doesn't read "$x$".
  const clean = String(text).replace(/\$+/g, '').replace(/```[\s\S]*?```/g, '').trim()
  if (!clean) return

  // Stop whatever is already playing on either engine before starting the
  // next utterance, otherwise a fast double-tap stacks two voices.
  try { window.PiperTts?.stop() } catch {}
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()

  if (await tryPiperSpeak(clean, lang)) return

  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const voices = await ensureVoices()
  const wanted = LANG_MAP[lang] || LANG_MAP.en
  const voice = wanted.flatMap((tag) => voices.filter((v) => v.lang === tag))[0]
    || voices.find((v) => v.lang.startsWith(lang))
    || voices[0]
  const u = new SpeechSynthesisUtterance(clean)
  if (voice) {
    u.voice = voice
    u.lang = voice.lang
  } else {
    u.lang = wanted[0]
  }
  u.rate = 1.0
  u.pitch = 1.05
  window.speechSynthesis.speak(u)
}

export function stopSpeaking() {
  try { window.PiperTts?.stop() } catch {}
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
}

export const ttsSupported = typeof window !== 'undefined'
  && (!!window.speechSynthesis || !!window.PiperTts)
