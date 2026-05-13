// Voice I/O: native Capacitor plugins on Android, Web Speech on browsers.
//
// Mic (speech-to-text): @capgo/capacitor-speech-recognition. Uses Android's
// SpeechRecognizer + handles RECORD_AUDIO permission natively. Replaces
// the previous Web Speech path that was unreliable in the Capacitor WebView
// (no auto-prompt for permission, getUserMedia going through WebChromeClient
// that didn't surface the OS dialog).
//
// TTS (text-to-speech): three-layer fallback:
//   1. Piper via window.PiperTts when the voice for `lang` is bundled
//      (kk-KZ ships in the APK) or has been opt-in downloaded (en, ru).
//   2. @capacitor-community/text-to-speech on native — wraps Android's
//      built-in TextToSpeech engine. Handles en-US and ru-RU out of the
//      box on most devices, kk-KZ depends on the device's installed
//      language packs.
//   3. window.speechSynthesis on the web.

import { useEffect, useRef, useState, useCallback } from 'react'

const LANG_MAP = {
  kk: ['kk-KZ', 'ru-KZ', 'ru-RU', 'en-US'],
  ru: ['ru-RU', 'ru-KZ', 'en-US'],
  en: ['en-US', 'en-GB'],
}

function pickSpeechLang(lang) {
  return (LANG_MAP[lang] || LANG_MAP.en)[0]
}

// Cache the dynamic imports so we don't pay the round-trip on every call.
let _capPromise = null
async function cap() {
  if (_capPromise) return _capPromise
  _capPromise = (async () => {
    try {
      const core = await import('@capacitor/core')
      if (!core.Capacitor?.isNativePlatform?.()) return { native: false }
      const sr = await import('@capgo/capacitor-speech-recognition').catch(() => null)
      const tts = await import('@capacitor-community/text-to-speech').catch(() => null)
      return {
        native: true,
        SpeechRecognition: sr?.SpeechRecognition || null,
        TextToSpeech: tts?.TextToSpeech || null,
      }
    } catch {
      return { native: false }
    }
  })()
  return _capPromise
}

// ---- Speech recognition (mic → text) ---------------------------------------
//
// Native path uses the Capgo plugin, web falls back to Web Speech. The hook
// surface stays the same — { supported, listening, interim, error, start, stop }
// — so callers (TutorChat) don't care which engine they're on.
export function useSpeechRecognition(lang) {
  const SR = typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null
  const [supported, setSupported] = useState(!!SR)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)
  const onFinalRef = useRef(null)
  const recogRef = useRef(null)
  const finalRef = useRef('')
  const nativeListenerRef = useRef(null)
  const timeoutRef = useRef(null)

  // Probe native availability once.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const c = await cap()
      if (!alive) return
      if (c.native && c.SpeechRecognition) {
        try {
          const out = await c.SpeechRecognition.available()
          setSupported(!!out?.available)
        } catch { setSupported(false) }
      }
    })()
    return () => { alive = false }
  }, [])

  const armTimeout = useCallback((ms, msg) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      stop()
      setError(msg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, ms)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stop = useCallback(async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setListening(false)
    try { recogRef.current?.stop() } catch {}
    recogRef.current = null
    const c = await cap()
    if (c.native && c.SpeechRecognition) {
      try { await c.SpeechRecognition.stop() } catch {}
      try { nativeListenerRef.current?.remove?.() } catch {}
      nativeListenerRef.current = null
    }
  }, [])

  const start = useCallback(async (onFinal) => {
    setError(null)
    setInterim('')
    finalRef.current = ''
    onFinalRef.current = onFinal

    const c = await cap()
    // --- Native path -------------------------------------------------------
    if (c.native && c.SpeechRecognition) {
      try {
        const perm = await c.SpeechRecognition.checkPermissions()
        if (perm?.speechRecognition !== 'granted') {
          const ask = await c.SpeechRecognition.requestPermissions()
          if (ask?.speechRecognition !== 'granted') {
            setError('mic_permission_denied')
            return
          }
        }
      } catch (e) {
        setError(e?.message || 'mic_permission_failed')
        return
      }

      // partialResults event fires for every interim chunk; we also collect
      // the final result via the same listener (the plugin signals end via
      // listeningState change).
      try {
        nativeListenerRef.current = await c.SpeechRecognition.addListener(
          'partialResults',
          (r) => {
            const txt = (r?.matches || [])[0]
            if (txt) {
              finalRef.current = txt
              setInterim(txt)
            }
          },
        )
        setListening(true)
        // Hard timeout — if we get no audio in 12s, bail.
        armTimeout(12_000, 'no_speech')
        await c.SpeechRecognition.start({
          language: pickSpeechLang(lang),
          maxResults: 1,
          prompt: '',
          partialResults: true,
          popup: false,
        })
        // start() resolves when listening completes (final). Flush.
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        setListening(false)
        try { nativeListenerRef.current?.remove?.() } catch {}
        nativeListenerRef.current = null
        const text = finalRef.current.trim()
        if (text && onFinalRef.current) onFinalRef.current(text)
      } catch (e) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        setListening(false)
        try { nativeListenerRef.current?.remove?.() } catch {}
        nativeListenerRef.current = null
        const msg = (e?.message || '').toLowerCase()
        if (msg.includes('permission')) setError('mic_permission_denied')
        else if (msg.includes('match') || msg.includes('no result')) setError('no_speech')
        else setError(e?.message || 'speech_error')
      }
      return
    }

    // --- Web fallback ------------------------------------------------------
    if (!SR) {
      setError('not_supported')
      return
    }
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
    r.onstart = () => { setListening(true); armTimeout(12_000, 'no_speech') }
    r.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalRef.current += t + ' '
        else live += t
      }
      setInterim(live)
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
      armTimeout(5_000, 'recognition_failed_to_start')
    } catch (e) {
      setError(e?.message || 'start_failed')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [SR, lang, armTimeout])

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    try { recogRef.current?.abort() } catch {}
    try { nativeListenerRef.current?.remove?.() } catch {}
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
    setTimeout(() => resolve(window.speechSynthesis.getVoices() || []), 1500)
  })
  return _voicesPromise
}

async function tryPiperSpeak(text, lang) {
  const piper = typeof window !== 'undefined' ? window.PiperTts : null
  if (!piper) return { ok: false, reason: 'no_piper' }
  try {
    const st = await piper.voiceState(lang)
    if (st?.state !== 'ready' && st?.state !== 'bundled') {
      return { ok: false, reason: `voice_${st?.state || 'missing'}` }
    }
    await piper.speak({ text, lang })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e?.message || 'piper_speak_failed' }
  }
}

async function tryNativeTts(text, lang) {
  const c = await cap()
  if (!c.native || !c.TextToSpeech) return { ok: false, reason: 'no_native_tts' }
  try {
    await c.TextToSpeech.speak({
      text,
      lang: pickSpeechLang(lang),
      rate: 1.0,
      pitch: 1.05,
      volume: 1.0,
      category: 'ambient',
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e?.message || 'native_tts_failed' }
  }
}

async function tryWebSpeech(text, lang) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return { ok: false, reason: 'no_speech_synthesis' }
  }
  const voices = await ensureVoices()
  const wanted = LANG_MAP[lang] || LANG_MAP.en
  const voice = wanted.flatMap((tag) => voices.filter((v) => v.lang === tag))[0]
    || voices.find((v) => v.lang.startsWith(lang))
    || voices[0]
  const u = new SpeechSynthesisUtterance(text)
  if (voice) { u.voice = voice; u.lang = voice.lang } else { u.lang = wanted[0] }
  u.rate = 1.0
  u.pitch = 1.05
  return new Promise((resolve) => {
    u.onend = () => resolve({ ok: true })
    u.onerror = (e) => resolve({ ok: false, reason: e?.error || 'webspeech_error' })
    try {
      window.speechSynthesis.speak(u)
    } catch (e) {
      resolve({ ok: false, reason: e?.message || 'speak_failed' })
    }
  })
}

export async function speak(text, lang) {
  const clean = String(text).replace(/\$+/g, '').replace(/```[\s\S]*?```/g, '').trim()
  if (!clean) return { engine: 'none', reason: 'empty_text' }

  // Stop whatever's playing on any engine first.
  try { window.PiperTts?.stop() } catch {}
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
  try {
    const c = await cap()
    if (c.TextToSpeech) await c.TextToSpeech.stop()
  } catch {}

  const piper = await tryPiperSpeak(clean, lang)
  if (piper.ok) return { engine: 'piper' }

  const native = await tryNativeTts(clean, lang)
  if (native.ok) return { engine: 'native_tts' }

  const web = await tryWebSpeech(clean, lang)
  if (web.ok) return { engine: 'webspeech' }

  return { engine: 'none', reason: piper.reason + ' / ' + native.reason + ' / ' + web.reason }
}

export function stopSpeaking() {
  try { window.PiperTts?.stop() } catch {}
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
  cap().then((c) => { try { c.TextToSpeech?.stop() } catch {} }).catch(() => {})
}

export const ttsSupported = true  // we always have at least one engine path
