# Native plugins

Three Capacitor Kotlin plugins, all running on-device with no network at
inference time. Each is opt-in: nothing is bundled into the APK, and the
APK works fully without any of them (Web Speech + cloud Gemini).

| Plugin | File | Backend | Model size | Trigger |
|---|---|---|---|---|
| `Hello` | `HelloPlugin.kt` | — | — | Boot smoke test, see `src/lib/nativeBoot.js`. Prints `hello from kotlin` to the WebView console so we can verify the Kotlin↔JS bridge is alive before piling real work on it. |
| `PiperTts` | `PiperTtsPlugin.kt` + `PiperEngine.kt` + `AudioStreamer.kt` + `VoiceDownloader.kt` | sherpa-onnx 1.13.1 (VITS / Piper) | 25–70 MB per voice | Profile → **Offline voices** → Download. Streams synth via AudioTrack PCM_FLOAT. |
| `GemmiTutor` | `GemmiTutorPlugin.kt` + `GemmaRuntime.kt` | MediaPipe Tasks GenAI 0.10.24 (LiteRT LLM) | ~580 MB int4 | Profile → **Run Gemmi offline** → Download. Stateless completion via `generateResponseAsync(prompt, ProgressListener)`. |

`ModelDownloader.kt` is shared: resumable HTTP downloader with sha256
verification, retry-on-failure, and per-chunk progress events.

## How it wires

Capacitor 8's `cap add android` produces a Java-only scaffold with no
Kotlin enabled. `scripts/wire-native.sh` (run in CI between `cap add
android` and `gradlew assembleDebug`) does all the splicing:

1. Patches `android/build.gradle` to add the Kotlin gradle plugin to the
   root buildscript classpath.
2. Drops `gemmi.gradle` into `android/app/` and appends a single
   `apply from: 'gemmi.gradle'` to `android/app/build.gradle`. That file
   applies `kotlin-android`, sets JVM target 17, restricts ABI to
   `arm64-v8a` (the sherpa-onnx AAR has ~25 MB of `.so` per ABI), and
   adds the three native deps (kotlinx-coroutines, commons-compress,
   tasks-genai).
3. Replaces Java `MainActivity` with our Kotlin one that calls
   `registerPlugin(...)` for each plugin.
4. Copies every `native/*.kt` into the package directory.
5. Drops `voice.config.json` and `model.config.json` into Android assets.
6. Downloads `sherpa-onnx-1.13.1.aar` (~54 MB, not on Maven Central) from
   the k2-fsa GitHub release into `android/app/libs/`, verifies sha256,
   and the `flatDir` repo in `gemmi.gradle` picks it up.

The script is idempotent — re-running on an already-wired tree does
nothing destructive.

## JS-side surface

Each plugin exposes a `window.*` object via `src/lib/{piperTts,nativeTutor,nativeBoot}.js`:

```js
window.PiperTts.voiceState(lang)            // → { state: 'missing' | 'ready', sizeBytes }
window.PiperTts.downloadVoice({ lang, onProgress })
window.PiperTts.speak({ text, lang })       // streams via AudioTrack
window.PiperTts.stop()

window.GemmiTutor.deviceCaps()              // → { totalRamMb, recommendedVariant }
window.GemmiTutor.modelState()
window.GemmiTutor.downloadModel({ url, sha256, sizeBytes, onProgress })
window.GemmiTutor.generate({ prompt, onDelta })  // streams partial tokens
window.GemmiTutor.cancel()
```

On the web (or before the APK is built), every `window.*` is `undefined`
and the rest of the app routes through Web Speech / cloud Gemini.

## Fallback chain

| Speech in | Native | Web fallback |
|---|---|---|
| kk-KZ output | sherpa-onnx Piper voice (16 kHz) | Web Speech → ru-RU (mispronounces Kazakh) |
| ru-RU output | sherpa-onnx Piper voice (22 kHz) | Web Speech ru-RU |
| en-US output | sherpa-onnx Piper voice (22 kHz) | Web Speech en-US |
| Tutor reply | MediaPipe LiteRT (Gemma 3 1B int4) | Cloud Gemini 2.5 Flash |

`voice.js` checks `voiceState(lang)` per-call; if the voice isn't
downloaded, Web Speech runs. Same for `tutorProviders.nativeProvider`:
it claims `available()` only after a verified download landed.
