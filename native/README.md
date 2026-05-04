# Native tutor scaffold

This directory holds the Capacitor Android plugin that runs the on-device
Gemma 4 model via LiteRT-LM. The JS-side counterpart lives at
`src/lib/nativeTutor.js` and the user-facing UI is `src/pages/ModelSetup.jsx`.

## When your fine-tune is ready, do this:

1. Edit **`model.config.json`** — replace the two `url` and `sha256` fields
   for the variants you're shipping (E2B and/or E4B).
2. Make sure the Capacitor Android project exists:
   ```
   npm run android:init           # one-time, runs `cap add android`
   ```
3. Run the installer:
   ```
   ./scripts/install-native-tutor.sh
   ```
   This copies every `.kt` file into the Capacitor Android source tree,
   adds the LiteRT-LM Gradle dependencies, registers the plugin in
   MainActivity, and copies `model.config.json` into Android assets.
4. Build the APK:
   ```
   npm run android:apk
   ```
5. Install on a real device (the emulator's WebView won't have a GPU
   delegate, so inference will be much slower than on metal):
   ```
   adb install android/app/build/outputs/apk/debug/app-debug.apk
   ```

The first time the user opens the tutor chat, `ModelSetup.jsx` will run,
show a progress bar while the `.litertlm` downloads from your host, verify
the SHA-256, and then unlock the tutor. From that point onward the tutor
runs fully offline — no network, no API key.

## File map

| File | Purpose |
|---|---|
| `GemmiTutorPlugin.kt` | Capacitor plugin entry point — `init`, `generate`, `ensureModel`, `deviceCaps`, `respondToolUse`, `cancel` |
| `GemmaRuntime.kt` | LiteRT-LM session wrapper — owns the loaded model, runs the inner generation loop |
| `ChatTemplate.kt` | Renders system + messages + tool schemas into Gemma 4's chat template format |
| `StreamingResponseParser.kt` | Splits the streamed output into plain text deltas and tool-call blocks |
| `ModelDownloader.kt` | Resumable HTTPS download with SHA-256 verification, used by `ensureModel` |
| `ToolBridge.kt` | `CompletableDeferred`-based suspension primitive for the tool-result round trip |
| `model.config.json` | The ONLY file you edit when shipping a new fine-tune |
| `build.gradle.snippet` | LiteRT-LM + coroutines Gradle deps the install script will splice into `android/app/build.gradle` |
| `MainActivity.patch` | The two-line edit the install script applies to register the plugin |

## Things to check when LiteRT-LM ships a new SDK version

- Class name: `LlmInference` / `LlmInferenceSession` — Google has renamed
  these between Mediapipe Tasks GenAI and LiteRT-LM. If imports don't
  resolve, check the artifact's javadoc.
- Tool-call output format — the scaffold assumes the model emits a fenced
  ` ```tool_call ` block with `{name, input}`. If your fine-tune uses a
  different convention (XML tags, function-calling-style JSON, etc.),
  the only file to update is **`StreamingResponseParser.kt`**.
- Chat template — `ChatTemplate.kt` ships the Gemma 4 instruction-tuned
  template (`<start_of_turn>` / `<end_of_turn>` markers). If you fine-tune
  with a custom template, edit that file only.

## What the JS side already does

Once `window.GemmiTutor` is registered by `src/lib/nativeTutor.js`,
`src/lib/tutorProviders.js` automatically prefers the native provider
over the Claude one — no code change needed. The chat header swaps to
"⚙ Gemma (on device)" and the same tool-call timeline UI works.
