// Voice I/O: native Capacitor plugins on Android, Web Speech on browsers.
//
// Mic (speech-to-text): @capgo/capacitor-speech-recognition. Uses Android's
// SpeechRecognizer + handles RECORD_AUDIO permission natively. Replaces
// the previous Web Speech path that was unreliable in the Capacitor WebView
// (no auto-prompt for permission, getUserMedia going through WebChromeClient
// that didn't surface the OS dialog).
//
// TTS (text-to-speech): two-layer fallback:
//   1. @capacitor-community/text-to-speech on native — wraps Android's
//      built-in TextToSpeech engine. Handles en-US and ru-RU out of the
//      box on most devices, kk-KZ depends on the device's installed
//      language packs (usually falls through to ru-RU).
//   2. window.speechSynthesis on the web.
//
// We previously had a Piper / sherpa-onnx on-device path with a bundled
// kk-KZ voice + opt-in downloads for en / ru. It SIGSEGV'd unpredictably
// in production, took the whole process down with each crash, and added
// 45 MB to the APK. Removed entirely. Built-in Android TTS gets us
// 90% of the value for 0 MB and zero crashes.

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
  // Holds every native-plugin listener handle from the most recent start()
  // call. Bulk-removed at the top of the next start() and on unmount so
  // listeners from an aborted previous session can't double-fire when a
  // new session begins. (Was a single handle ref; rapid double-taps on
  // the mic button leaked the partialResults/result listeners.)
  const nativeListenersRef = useRef([])
  const timeoutRef = useRef(null)
  // Bumped on every start() — lets the cleanup closure from a stale
  // session detect that a new session has begun and skip its side effects.
  const sessionIdRef = useRef(0)
  // Toggled when state is being torn down. Skips re-entry into stop() from
  // overlapping paths (timeout firing while user taps mic again, etc.).
  const tearingDownRef = useRef(false)

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
    const session = sessionIdRef.current
    timeoutRef.current = setTimeout(() => {
      // A new start() invalidates timeouts armed by older sessions; the
      // newer session is responsible for its own.
      if (session !== sessionIdRef.current) return
      console.log('[voice]', 'timeout', msg, { session })
      stop()
      setError(msg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, ms)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stop = useCallback(async () => {
    tearingDownRef.current = true
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    setListening(false)
    setInterim('')
    try { recogRef.current?.stop() } catch {}
    recogRef.current = null
    const c = await cap()
    if (c.native && c.SpeechRecognition) {
      try { await c.SpeechRecognition.stop() } catch {}
      for (const l of nativeListenersRef.current) { try { l?.remove?.() } catch {} }
      nativeListenersRef.current = []
    }
    tearingDownRef.current = false
  }, [])

  const start = useCallback(async (onFinal) => {
    // Bump session ID so any in-flight cleanup closures from a previous
    // session bail out before mutating state on the new session.
    sessionIdRef.current += 1
    const mySession = sessionIdRef.current
    // Diagnostic — visible in `adb logcat -s Chromium` / WebView console.
    // Tagged so the user can grep "voice:" if mic gets weird.
    console.log('[voice]', 'start', { session: mySession, lang })

    // Synchronous hard reset BEFORE any await. Belt and suspenders: if
    // the previous session ended weirdly (no listeningState:stopped, OS
    // recognizer in a bad state), nothing about its leftover state
    // affects this one.
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    for (const l of nativeListenersRef.current) { try { l?.remove?.() } catch {} }
    nativeListenersRef.current = []
    setError(null)
    setInterim('')
    setListening(false)
    finalRef.current = ''
    onFinalRef.current = onFinal

    const c = await cap()
    // If another start() began while we awaited cap() (impossible from
    // a single UI thread but defensive), bail.
    if (mySession !== sessionIdRef.current) return

    // --- Native path -------------------------------------------------------
    if (c.native && c.SpeechRecognition) {
      try {
        const perm = await c.SpeechRecognition.checkPermissions()
        if (mySession !== sessionIdRef.current) return
        if (perm?.speechRecognition !== 'granted') {
          const ask = await c.SpeechRecognition.requestPermissions()
          if (mySession !== sessionIdRef.current) return
          if (ask?.speechRecognition !== 'granted') {
            setError('mic_permission_denied')
            return
          }
        }
      } catch (e) {
        setError(e?.message || 'mic_permission_failed')
        return
      }

      // Best-effort check whether the device's installed speech-recognition
      // language packs cover the requested locale. Android's SpeechRecognizer
      // silently falls back to the system default when a locale isn't
      // installed, which is why Russian/Kazakh got transcribed as English.
      //
      // The plugin returns codes in inconsistent shapes across Android
      // versions: 'en-US', 'en_US', sometimes a bare 'en'. The plugin
      // result itself can be {languages: [...]}, {supportedLanguages: [...]}
      // or a direct array. Normalize aggressively, and ONLY error out when
      // we're certain the requested language is missing AND we got back
      // a reasonable-looking non-empty list. Otherwise just try the start —
      // worst case the user gets the wrong-language transcription instead
      // of a spurious "not installed" banner.
      const wantLang = pickSpeechLang(lang)
      try {
        const supported = await c.SpeechRecognition.getSupportedLanguages?.()
        const raw = Array.isArray(supported)
          ? supported
          : supported?.languages || supported?.supportedLanguages || []
        const norm = (s) => String(s).toLowerCase().replace('_', '-')
        const list = raw.map(norm)
        const want = norm(wantLang)
        const wantPrefix = want.split('-')[0]
        const looksReasonable = list.length >= 5  // device with <5 langs is malformed; trust it
        const hasLang = list.includes(want)
          || list.some((l) => l === wantPrefix)
          || list.some((l) => l.startsWith(wantPrefix + '-'))
        if (looksReasonable && !hasLang) {
          setError(`mic_lang_not_installed:${wantLang}`)
          return
        }
      } catch { /* getSupportedLanguages not available — try anyway */ }

      // Force-stop any leftover session in the OS-level recognizer. The
      // Android SpeechRecognizer can be in a "stopped but not destroyed"
      // state where calling start() silently does nothing — this stop
      // call kicks it out of that state. The hard reset at the top of
      // start() already cleared our listener handles; we don't need to
      // remove them again here, but the explicit stop on the native side
      // is critical for recovery after a session that timed out.
      try { await c.SpeechRecognition.stop() } catch { /* not running, fine */ }
      if (mySession !== sessionIdRef.current) return

      // Three listener channels — different builds of the underlying
      // plugin emit final transcripts via different events:
      //   • partialResults: interim chunks during speech. The last chunk
      //     before stop is usually the final transcript on Capgo's fork.
      //   • listeningState: {status: 'started'|'stopped'}. Authoritative
      //     boundary signal — start() promise resolution is unreliable.
      //   • result: some plugin versions emit a {matches:[...]} on
      //     end-of-speech. We accept it as an additional source of the
      //     final transcript.
      let cleanedUp = false
      const cleanup = () => {
        if (cleanedUp) return         // idempotent
        cleanedUp = true
        // Stale session — a newer start() has already overwritten state.
        // Don't touch anything; the new session owns it.
        if (mySession !== sessionIdRef.current) return
        if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
        setListening(false)
        setInterim('')
        for (const l of nativeListenersRef.current) { try { l?.remove?.() } catch {} }
        nativeListenersRef.current = []
        const text = finalRef.current.trim()
        if (text && onFinalRef.current) {
          // Defer the callback so React's state flush sees listening=false
          // first; the chat's send() relies on that to skip the "still
          // listening" guard.
          setTimeout(() => onFinalRef.current?.(text), 0)
        }
      }

      try {
        const lA = await c.SpeechRecognition.addListener('partialResults', (r) => {
          if (mySession !== sessionIdRef.current) return    // stale event
          const txt = (r?.matches || [])[0]
          if (txt) {
            finalRef.current = txt
            setInterim(txt)
            armTimeout(6_000, 'no_speech')  // shorter silence window once we've heard *something*
          }
        })
        const lB = await c.SpeechRecognition.addListener('listeningState', (e) => {
          if (mySession !== sessionIdRef.current) return    // stale event
          console.log('[voice]', 'listeningState', e?.status, { session: mySession })
          if (e?.status === 'started') {
            setListening(true)
            armTimeout(8_000, 'no_speech')   // first-word window
          } else if (e?.status === 'stopped') {
            // Brief delay so a `result` event that fires right after
            // `stopped` gets a chance to populate finalRef first.
            setTimeout(cleanup, 80)
          }
        })
        // Some plugin builds emit final matches via `result` rather than
        // a last `partialResults`. Listening for both is harmless either
        // way — if neither emits, the no_speech timeout catches it.
        const lC = await c.SpeechRecognition.addListener('result', (r) => {
          if (mySession !== sessionIdRef.current) return
          const txt = (r?.matches || [])[0]
          if (txt) finalRef.current = txt
        }).catch(() => null)
        nativeListenersRef.current = [lA, lB, lC].filter(Boolean)

        c.SpeechRecognition.start({
          language: pickSpeechLang(lang),
          maxResults: 1,
          prompt: '',
          partialResults: true,
          popup: false,
        }).catch((e) => {
          if (mySession !== sessionIdRef.current) return
          console.log('[voice]', 'start.catch', e?.message, { session: mySession })
          const msg = (e?.message || '').toLowerCase()
          if (msg.includes('already')) {
            // Mid-flight session — force-stop. The bulletproofing at the
            // top of the NEXT start() will recover. Don't enter cleanup
            // here; if listeningState:stopped fires it'll handle it.
            c.SpeechRecognition.stop().catch(() => {})
            return
          }
          if (msg.includes('permission')) setError('mic_permission_denied')
          else if (msg.includes('match') || msg.includes('no result')) setError('no_speech')
          else if (msg.includes('network')) setError('mic_network_required')
          else setError(e?.message || 'speech_error')
          cleanup()
        })
        // Watchdog: if listeningState never reports `started` within 5s,
        // assume the OS recognizer is stuck and surface an error so the
        // user sees they need to tap again (and our cleanup runs).
        // Previously 8s but that's too long — by the time it fires the
        // user has already tapped 3 more times.
        armTimeout(5_000, 'recognition_failed_to_start')
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
    for (const l of nativeListenersRef.current) { try { l?.remove?.() } catch {} }
    nativeListenersRef.current = []
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

// Speak via Android's built-in TextToSpeech on native, or the browser's
// Web Speech API on web. We dropped the on-device Piper TTS path: the
// downloaded voice models (sherpa-onnx) SIGSEGV'd through every layer of
// defense and there's no recovery path from a native crash. Native TTS is
// good enough — Android ships en-US and ru-RU voices on most devices, and
// for Kazakh it falls back to ru-RU which is at least Cyrillic-readable.
export async function speak(text, lang) {
  const clean = String(text).replace(/\$+/g, '').replace(/```[\s\S]*?```/g, '').trim()
  if (!clean) return { engine: 'none', reason: 'empty_text' }

  // Stop whatever's playing first.
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
  try {
    const c = await cap()
    if (c.TextToSpeech) await c.TextToSpeech.stop()
  } catch {}

  const native = await tryNativeTts(clean, lang)
  if (native.ok) return { engine: 'native_tts' }

  const web = await tryWebSpeech(clean, lang)
  if (web.ok) return { engine: 'webspeech' }

  return { engine: 'none', reason: native.reason + ' / ' + web.reason }
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
  cap().then((c) => { try { c.TextToSpeech?.stop() } catch {} }).catch(() => {})
}

export const ttsSupported = true  // we always have at least one engine path
