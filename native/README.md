# Native plugins

Two Capacitor Kotlin plugins. Both are opt-in: the APK works fully
without either (cloud Gemini + Android built-in TextToSpeech).

| Plugin | File | Backend | Model size | Trigger |
|---|---|---|---|---|
| `Hello` | `HelloPlugin.kt` | — | — | Boot smoke test, see `src/lib/nativeBoot.js`. Prints `hello from kotlin` to the WebView console so we can verify the Kotlin↔JS bridge is alive before piling real work on it. |
| `GemmiTutor` | `GemmiTutorPlugin.kt` + `GemmaRuntime.kt` | LiteRT-LM (Gemma 4 E2B-it) | ~2 GB int4 | Profile → **Run Gemmi offline** → Download. Stateless completion via `generate(prompt, onDelta)`. |

`ModelDownloader.kt` is shared: resumable HTTP downloader with sha256
verification, retry-on-failure, and per-chunk progress events.

There used to also be a `PiperTts` plugin (on-device VITS / Piper TTS
via sherpa-onnx) — removed. Downloaded voices SIGSEGV'd unpredictably in
production with no recovery path. We rely on Android's built-in
TextToSpeech now via `@capacitor-community/text-to-speech`. Works for
en-US and ru-RU out of the box; for kk-KZ Android falls back to ru-RU
(Cyrillic-readable, audibly off but the closest the OS ships).

## How it wires

Capacitor 8's `cap add android` produces a Java-only scaffold with no
Kotlin enabled. `scripts/wire-native.sh` (run in CI between `cap add
android` and `gradlew assembleDebug`) does all the splicing:

1. Patches `android/build.gradle` to add the Kotlin gradle plugin to the
   root buildscript classpath.
2. Drops `gemmi.gradle` into `android/app/` and appends a single
   `apply from: 'gemmi.gradle'` to `android/app/build.gradle`. That file
   applies `kotlin-android`, sets JVM target 17, restricts ABI to
   `arm64-v8a`, and adds the native deps (kotlinx-coroutines, litertlm).
3. Replaces Java `MainActivity` with our Kotlin one that calls
   `registerPlugin(...)` for each plugin.
4. Copies every `native/*.kt` into the package directory.
5. Drops `model.config.json` into Android assets so `GemmiTutorPlugin`
   can read the LiteRT model URL + sha256 at runtime.

The script is idempotent — re-running on an already-wired tree does
nothing destructive.

## JS-side surface

```js
window.GemmiTutor.deviceCaps()              // → { totalRamMb, recommendedVariant }
window.GemmiTutor.modelState()
window.GemmiTutor.downloadModel({ url, sha256, sizeBytes, onProgress })
window.GemmiTutor.generate({ prompt, onDelta })  // streams partial tokens
window.GemmiTutor.cancel()
```

On the web (or before the APK is built), `window.GemmiTutor` is
`undefined` and the rest of the app routes through cloud Gemini.

## Fallback chain

| Speech in | Native | Web fallback |
|---|---|---|
| TTS (any lang) | Android TextToSpeech (en-US, ru-RU; kk-KZ → ru-RU) | Web Speech API |
| Tutor reply | LiteRT-LM (Gemma 4 E2B-it int4) | Cloud Gemma 4 26B-A4B |

`tutorProviders.nativeProvider` claims `available()` only after a
verified Gemma model download landed; otherwise the cloud path runs.
