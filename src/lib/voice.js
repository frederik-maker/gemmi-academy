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

      // Check whether the device's installed speech-recognition language
      // packs cover what the user picked. Android's SpeechRecognizer
      // silently falls back to the system default (usually en-US) when
      // the requested locale isn't installed — that's why "Russian
      // input transcribed as English" happened. Pre-empt that with a
      // clear error pointing the user at Settings.
      const wantLang = pickSpeechLang(lang)
      try {
        const supported = await c.SpeechRecognition.getSupportedLanguages?.()
        const list = (supported?.languages || []).map((s) => String(s).toLowerCase())
        const want = wantLang.toLowerCase()
        const wantPrefix = want.split('-')[0]
        const ok = list.length === 0
          || list.includes(want)
          || list.some((l) => l.startsWith(wantPrefix + '-'))
        if (!ok) {
          setError(`mic_lang_not_installed:${wantLang}`)
          return
        }
      } catch { /* getSupportedLanguages not available — try anyway */ }

      // If a previous session is still running (start never resolved cleanly,
      // or the user tapped twice fast), force-stop it before starting.
      try { await c.SpeechRecognition.stop() } catch { /* not running, fine */ }
      try { nativeListenerRef.current?.remove?.() } catch {}
      nativeListenerRef.current = null

      // Two listeners:
      //   • partialResults fires for every intermediate chunk while user
      //     is speaking. Last chunk before listeningState=stopped IS the
      //     final transcript.
      //   • listeningState fires {status: 'started'|'stopped'} when the
      //     recognizer starts and finishes. We rely on this for the
      //     authoritative "stopped" signal — start() resolution timing
      //     varies across plugin versions and isn't reliable.
      const cleanup = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        setListening(false)
        try { nativeListenerRef.current?.remove?.() } catch {}
        try { stateListenerRef?.remove?.() } catch {}
        nativeListenerRef.current = null
        const text = finalRef.current.trim()
        if (text && onFinalRef.current) {
          // Defer the callback so React's state flush sees listening=false
          // first; the chat's send() relies on that to skip the "still
          // listening" guard.
          setTimeout(() => onFinalRef.current?.(text), 0)
        }
      }

      let stateListenerRef = null
      try {
        nativeListenerRef.current = await c.SpeechRecognition.addListener(
          'partialResults',
          (r) => {
            const txt = (r?.matches || [])[0]
            if (txt) {
              finalRef.current = txt
              setInterim(txt)
              armTimeout(8_000, 'no_speech')  // reset silence countdown
            }
          },
        )
        stateListenerRef = await c.SpeechRecognition.addListener(
          'listeningState',
          (e) => {
            if (e?.status === 'started') {
              setListening(true)
              armTimeout(12_000, 'no_speech')
            } else if (e?.status === 'stopped') {
              cleanup()
            }
          },
        )

        // Fire-and-forget — don't await. The plugin emits listeningState
        // events to tell us when it's done. Awaiting blocks JS for the
        // entire mic session (which is why second-tap got "already
        // running"); now stop() can be called from anywhere.
        c.SpeechRecognition.start({
          language: pickSpeechLang(lang),
          maxResults: 1,
          prompt: '',
          partialResults: true,
          popup: false,
        }).catch((e) => {
          const msg = (e?.message || '').toLowerCase()
          if (msg.includes('already')) {
            // Another session was already running — force stop, retry once.
            c.SpeechRecognition.stop().catch(() => {})
            cleanup()
            return
          }
          if (msg.includes('permission')) setError('mic_permission_denied')
          else if (msg.includes('match') || msg.includes('no result')) setError('no_speech')
          else if (msg.includes('network')) setError('mic_network_required')
          else setError(e?.message || 'speech_error')
          cleanup()
        })
        // Hard safety net: if listeningState never fires within 4s, the
        // plugin didn't actually start. Surface that instead of hanging.
        armTimeout(4_000, 'recognition_failed_to_start')
      } catch (e) {
        cleanup()
        setError(e?.message || 'speech_error')
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
