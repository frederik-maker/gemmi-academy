# Building Gemmi Academy as an Android APK (sideload, no Play Store)

Capacitor is already wired up and is the right tool here — it produces a
self-contained APK with the built web assets baked in, no hosting required.
Bubblewrap (TWA) and PWA Builder both require a Play Store listing for the
Digital Asset Links handshake, so they're not options for sideload-only.

## Capacitor — standalone APK (project is already wired)

Everything is scaffolded — `capacitor.config.ts` is in the repo and `@capacitor/{core,cli,android}` is already in `package.json`.

### One-time tool install (macOS)
```bash
brew install --cask temurin                 # JDK 17
brew install --cask android-commandlinetools
# add to your shell rc:
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
# or just install Android Studio: https://developer.android.com/studio
```

### Build the APK
```bash
cd /Users/frederikbussler/kazakh-learn
npm run build                       # Vite → dist/
npx cap add android                 # one-time: creates ./android Gradle project
npx cap sync android                # copies dist/ into the Android project

cd android
./gradlew assembleDebug             # → android/app/build/outputs/apk/debug/app-debug.apk
# or for Play Store:
./gradlew bundleRelease             # → android/app/build/outputs/bundle/release/app-release.aab
```

Distributing the APK without Play Store:

- Upload the `.apk` to any HTTPS host (your domain, GitHub Releases, etc.)
- Users tap the link on Android, allow "install from unknown sources" once,
  install. Updates require re-downloading the APK — no auto-update.
- For private testing pre-release, [Firebase App Distribution](https://firebase.google.com/docs/app-distribution)
  or [Diawi](https://www.diawi.com/) make this much smoother (testers get a
  one-tap install link, you see install counts).

Open the project in Android Studio (recommended for first build, gives you
nicer error messages):
```bash
npx cap open android
```

### Icon & splash
Drop a 1024×1024 PNG at `resources/icon.png` and `resources/splash.png`, then:
```bash
npm install -D @capacitor/assets
npx capacitor-assets generate --android
```
That regenerates every required icon size + adaptive icon layers from your two source files.

---

## Deploying the tutor backend (until the on-device model lands)

The AI tutor route lives at `vite.config.js` middleware for dev only. For a real APK you need a deployed endpoint. Two options:

### Vercel (1-file serverless function)
Create `/api/tutor.ts` in a tiny adjacent Vercel project:
```ts
import Anthropic from '@anthropic-ai/sdk'
import { handleTutorRequest } from '../src/lib/tutorServer.js'   // import the existing logic
export const config = { runtime: 'edge' }
export default async function handler(req: Request) {
  // adapt the Node req/res shim to Edge Request/Response;
  // see https://vercel.com/docs/functions/runtimes/edge-runtime
}
```
Set `ANTHROPIC_API_KEY` in the Vercel project's env vars.

### Cloudflare Workers
Similar — same handler logic, just import `Anthropic` and stream `Response` back.

After deploying, update the client to call `https://your-api.example/tutor` instead of `/api/tutor` (or set up a rewrite in `capacitor.config.ts` server URL).

---

## Hooking up your on-device Gemma 4 model (LiteRT-LM)

The JS side is already wired for a swappable agent runtime in
`src/lib/tutorProviders.js`. There are two providers registered:

```
PROVIDERS = [nativeProvider, claudeProvider]    // native is tried first
```

`nativeProvider` activates automatically the moment `window.GemmiTutor`
exists. So all you need to ship is a Capacitor plugin (or a global script
injected by `WebAppInterface`) that sets `window.GemmiTutor` to an object
matching this contract:

```ts
window.GemmiTutor = {
  // Resolved when the Gemma weights are loaded and the runtime is ready.
  ready: Promise<{ model: string, version: string }>,

  // One generation call. The plugin owns the loop: it should run the
  // model, stream text deltas via onDelta(), and when the model emits a
  // tool_use block, call onToolUse() and feed the returned JSON back into
  // the prompt before continuing.
  generate(opts: {
    system: string,
    messages: { role: 'user' | 'assistant', content: { type: 'text', text: string }[] }[],
    tools: { name, description, input_schema }[],
    signal: AbortSignal,
    onDelta(text: string): void,
    onToolUse(call: { name: string, input: object }): Promise<unknown>,
  }): Promise<{ stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' }>,
}
```

### Kotlin plugin skeleton

Use **LiteRT-LM** (not raw LiteRT) — it's Google's GenAI orchestration layer
that wraps LiteRT and adds KV-cache management, prompt templating, and
native function calling. Half of the tool-loop bridging I'd otherwise have
to spell out is handled for you.

`android/app/src/main/java/co/bussler/gemmi/GemmiTutorPlugin.kt`:

```kotlin
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.ai.edge.litert.lm.LlmInference      // LiteRT-LM
import com.google.ai.edge.litert.lm.LlmInferenceSession

@CapacitorPlugin(name = "GemmiTutor")
class GemmiTutorPlugin : Plugin() {
  private var llm: LlmInference? = null

  @PluginMethod
  fun init(call: PluginCall) {
    // Resolve the .litertlm path — see "Distributing the 2.5 GB model"
    // below for first-launch download flow.
    val modelPath = File(context.filesDir, "gemma-4-E4B-it.litertlm").absolutePath
    val opts = LlmInference.LlmInferenceOptions.builder()
      .setModelPath(modelPath)
      .setMaxTokens(4096)
      .build()
    llm = LlmInference.createFromOptions(context, opts)
    call.resolve(JSObject().put("model", "gemma-4-E4B-it").put("version", "1.0"))
  }

  @PluginMethod
  fun generate(call: PluginCall) {
    val session = LlmInferenceSession.createFromOptions(llm!!,
      LlmInferenceSession.LlmInferenceSessionOptions.builder()
        .setTopK(40)
        .setTemperature(0.7f)
        .build())
    // 1. Concat system + messages into a chat-formatted prompt.
    // 2. session.addQueryChunk(prompt)
    // 3. session.generateResponseAsync { partial, done ->
    //      notifyListeners("delta", JSObject().put("text", partial))
    //    }
    // 4. For tool_use, parse the model's structured tool block out of the
    //    stream, emit "tool_use" event to JS, await result via a Channel,
    //    feed the result back as the next query chunk.
    // 5. Resolve when done==true.
    call.resolve(JSObject().put("stop_reason", "end_turn"))
  }
}
```

### Distributing the 2.5 GB model file (sideload-friendly)

You can't embed a 2.5 GB asset in a sideloaded APK comfortably — most
Android file pickers and "install from unknown sources" flows choke at
~1 GB and the install UX gets ugly. **Download-on-first-launch from your
own host** is the right pattern:

```kotlin
@PluginMethod
fun ensureModel(call: PluginCall) {
  val target = File(context.filesDir, "gemma-4-E4B-it.litertlm")
  if (target.exists() && target.length() == EXPECTED_BYTES) {
    call.resolve(JSObject().put("status", "ready"))
    return
  }
  // Download from https://your-host.example/models/gemma-4-E4B-it.litertlm
  // with Range support so partial downloads can resume. Emit "download_progress"
  // events with { downloaded, total } so the JS side can render a progress bar.
}
```

Host the `.litertlm` on Cloudflare R2 (no egress fees), GitHub Releases (free,
but no Range support which kills resume), or your own server. Verify with a
SHA-256 check after download so corrupted partials don't get loaded.

Then in your JS shim (`src/lib/registerNativeTutor.js`, called from `main.jsx`):

```js
import { registerPlugin } from '@capacitor/core'
const Plugin = registerPlugin('GemmiTutor')

if (Capacitor.isNativePlatform()) {
  const ready = Plugin.init().then(({ model, version }) => ({ model, version }))
  window.GemmiTutor = {
    ready,
    async generate({ system, messages, tools, onDelta, onToolUse }) {
      const listener = await Plugin.addListener('delta', ({ text }) => onDelta(text))
      const toolListener = await Plugin.addListener('tool_use', async (call) => {
        const result = await onToolUse(call)
        await Plugin.respondToolUse({ id: call.id, result })
      })
      try {
        return await Plugin.generate({ system, messages, tools })
      } finally {
        listener.remove()
        toolListener.remove()
      }
    },
  }
}
```

Once both sides are deployed:

1. Cold start → `selectProvider()` checks `nativeProvider.available()` → finds `window.GemmiTutor` → uses it.
2. The chat header shows **"⚙ Gemma (on device)"** instead of "☁ Claude (cloud)".
3. No network calls leave the device for the tutor flow.
4. Tool calls (`get_student_state`, `find_lessons`, `recommend_next_lesson`, `generate_practice_question`) still run in JS exactly as they do with Claude — same code path, same shape.

### Gemma 4 variant sizing (real numbers from Google's launch)

| Variant | Effective params | Disk (Q4) | Peak RAM at inference | Device floor |
|---|---|---|---|---|
| **E2B** | ~2.3B | ~1.3 GB | 2–3 GB | 6 GB-RAM phone (mid-range) |
| **E4B** | ~4.5B | ~2.5 GB | 4–5 GB | 8 GB-RAM phone (flagship) |
| 26B A4B (MoE) | 4B active / 26B total | — | ~18 GB | desktop / server only |
| 31B dense | 31B | — | ~20 GB | desktop / server only |

Only E2B and E4B are realistic for the APK. The shared-KV-cache trick keeps
the KV footprint modest, but you still need the device-RAM-detection gate.

- **Detect device RAM at first launch** via Capacitor's Device plugin
  (`ActivityManager.MemoryInfo.totalMem`). If `< 6 GB` total → only offer
  E2B. If `< 8 GB` total → offer E4B with a warning that it'll be slow on
  this phone. Otherwise ship E4B as default.
- **Cap context at ~4K tokens.** Gemma 4's shared-KV trick helps but the
  cache still scales with context — a tutor turn doesn't need 32K.
- **Lazy-load the interpreter:** Capacitor's `load()` runs at app start;
  defer the actual model load to the first `generate()` call so the app
  doesn't sit on 4 GB of resident RAM the moment the user opens it.
- **Cache the downloaded `.litertlm` in `filesDir`** so it persists across
  app updates. Bump a version constant if you ever ship a re-fine-tuned
  model so the client knows to re-download.

## What's already correct in this repo
- ✅ `manifest.webmanifest` with `display: standalone`, theme/background colours, scope
- ✅ `<meta name="theme-color">` + Apple touch icon
- ✅ Routes use `BrowserRouter` (works in WebView)
- ✅ MMLU packs lazy-loaded, then cached by the service worker for offline use
- ✅ All state persists to `localStorage` (Capacitor's WebView keeps this across launches)
- ✅ **Service worker (`public/sw.js`)** — precaches the shell, stale-while-revalidate for assets, never caches `/api/*`
- ✅ **"Download for offline"** button in Profile messages the SW to warm the runtime cache with every MMLU pack in one go
- ✅ **Offline banner** appears automatically when `navigator.onLine === false`
- ✅ **Pluggable tutor providers** — Claude cloud is the default; on-device Gemma takes over automatically when `window.GemmiTutor` is present

## What's still TODO for the APK ship
- ❌ Tutor backend not deployed — needed until the on-device Gemma lands (Vercel/Cloudflare snippet earlier in this doc)
- ❌ App icons not yet rasterised to all Android densities (`npm install -D @capacitor/assets && npx capacitor-assets generate --android`)
- ❌ Host the `.litertlm` model file somewhere with Range request support (Cloudflare R2 ideal, your own nginx fine)
- ⏳ LiteRT-LM plugin: waiting on your fine-tuned Gemma 4 weights
