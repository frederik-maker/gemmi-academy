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
//
// Three reliability fixes layered on top of the bare Web Speech API,
// because the user reported the mic UI getting stuck forever:
//
//   • Explicit permission request before .start() (some Android WebViews
//     never trigger the prompt automatically and just silently fail).
//   • r.onstart is the source of truth for "really listening", not the
//     return of .start() — the API can hand back without errors and
//     never actually open the mic. We only flip the listening flag when
//     onstart fires.
//   • Hard timeout: 12s of silence (no onresult AND no onstart) aborts
//     and surfaces an error to the UI so the spinner doesn't hang.
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
  const timeoutRef = useRef(null)

  const armTimeout = useCallback((ms, msg) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      try { recogRef.current?.abort() } catch {}
      setListening(false)
      setError(msg)
    }, ms)
  }, [])

  const start = useCallback(async (onFinal) => {
    if (!supported) {
      setError('not_supported')
      return
    }
    setError(null)
    setInterim('')
    finalRef.current = ''
    onFinalRef.current = onFinal

    // Pre-flight: explicitly ask for the mic. On Capacitor + Android
    // 13+ the WebView won't auto-prompt for the SpeechRecognition API,
    // and recognition just hangs forever showing "listening" without
    // actually getting audio. Calling getUserMedia first triggers the
    // OS-level dialog; we close the resulting stream immediately and
    // hand off to SpeechRecognition.
    try {
      const stream = await navigator.mediaDevices?.getUserMedia?.({ audio: true })
      stream?.getTracks().forEach((t) => t.stop())
    } catch (e) {
      setError(e?.name === 'NotAllowedError' ? 'mic_permission_denied' : (e?.message || 'mic_failed'))
      return
    }

    const r = new SR()
    r.continuous = true
    r.interimResults = true
    r.lang = pickSpeechLang(lang)

    r.onstart = () => {
      setListening(true)
      // No-speech-detected timeout: if no result in 12s, bail.
      armTimeout(12_000, 'no_speech')
    }
    r.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalRef.current += t + ' '
        else live += t
      }
      setInterim(live)
      // Reset timeout while we're getting partials.
      armTimeout(12_000, 'no_speech')
    }
    r.onerror = (e) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      setError(e.error || 'speech_error')
      setListening(false)
    }
    r.onend = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      setListening(false)
      const text = (finalRef.current + interim).trim()
      if (text && onFinalRef.current) onFinalRef.current(text)
    }
    recogRef.current = r
    try {
      r.start()
      // Safety: if onstart never fires within 5s, the recognition
      // silently failed — surface that rather than spin forever.
      armTimeout(5_000, 'recognition_failed_to_start')
    } catch (e) {
      setError(e?.message || 'start_failed')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [SR, lang, supported, armTimeout])

  const stop = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    try { recogRef.current?.stop() } catch {}
  }, [])

  // Clean up on unmount
  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    try { recogRef.current?.abort() } catch {}
  }, [])

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
