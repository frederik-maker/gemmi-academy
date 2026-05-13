# Gemmi Academy

Gemmi Academy is a trilingual K-12 AI tutor for Kazakh kids. The tutor is Gemma 4 end-to-end: on-device Gemma 4 E2B-it via LiteRT-LM in the APK, Gemma 4 26B-A4B (MoE) via the Gemini API in the cloud. Same model family on both sides, same four-tool agent loop. Lessons cover five subjects (math, science, history, society, English) from age five through college in Қазақша, Русский, and English. Live at **https://gemmi.ai**, also installable as an [APK](https://github.com/frederik-maker/gemmi-academy/releases/latest).

Built for the [Gemma 4 Good Hackathon](https://kaggle.com/competitions/gemma-4-good-hackathon). Submitted to the **Main Track**, the **Future of Education** impact track, and the **LiteRT** special technology track.

## On-device first

The primary tutor is **Gemma 4 E2B-it running on-device through LiteRT**, inside a Capacitor Android plugin. The model is the `gemma-4-E2B-it-web.task` build the LiteRT community team publishes on Hugging Face: roughly 2 GB, int4-quantised. It is not bundled into the APK. The student opens the app, taps "enable offline AI", and the .task downloads to `context.filesDir`. After that the tutor runs entirely on the phone. No keys, no API spend, no data leaves the device.

That matters because the target audience is kids in rural Kazakhstan on entry-level Android phones with connectivity that drops out for minutes at a time. The downloader in `native/ModelDownloader.kt` assumes the 2 GB transfer will lose connection several times. Each attempt resumes from the `.part` file's current length via HTTP Range, retries with exponential backoff (1s up to 30s, eight attempts per call), tolerates `SSLException` / `SocketTimeoutException` / mid-stream `IOException`, and SHA-256-verifies the bytes before atomically renaming the `.part` to the final destination. The Hugging Face resolve URL serves through Cloudfront with `Accept-Ranges: bytes`, so the resumes work cleanly.

Until the on-device model is installed, the tutor uses a cloud path: `src/lib/tutorServer.js` forwards multimodal messages to **Gemma 4 26B-A4B** (the mixture-of-experts variant with only ~4B active params per token, fast and cheap to serve) via `@google/genai`. The MoE Gemma 4 is served from the same Gemini API endpoint as Gemini itself — same SDK, same key, just `model: 'gemma-4-26b-a4b-it'`. The cloud path handles the web app since running a 2 GB local model in a browser tab isn't an option, and it covers the moment between APK install and `.litertlm` download on Android. Both paths share the same four-tool registry, the same system prompt, and the same chain-of-thought scrubber, so the lesson UI calls `streamReply()` regardless of which Gemma instance served the response. `tutorProviders.js` prefers `nativeProvider` whenever it is available.

## The tutor

The tutor is a multi-tool agent available from every screen. From the home screen the student can ask any question and the tutor picks a tool: look up their full state (XP, streak, completed lessons, weakest subject), search the curriculum by keyword, recommend a next lesson, or generate a practice question on any topic. Tools run against the same in-app state the lessons use, so the answers are grounded in real progress.

Inside a lesson, a small "Ask Gemmi" pill on each question opens that same chat with the question pinned. If the student just got it wrong, the correct answer is pinned alongside and the tutor opens by explaining the mistake. The student can talk instead of type (Web Speech in both directions) or point the camera at a notebook page or handwritten math, and the tutor reads the image.

Every wrong answer goes into a per-student struggles log that the tutor reads on every turn. Miss two quadratics in a day and the next chat opens with the tutor offering to revisit factoring.

## Curriculum

Roughly 1,943 hand-curated trilingual questions across G1 through G3 in math, science, history, society, and English, plus around 3,000 more pulled from MMLU-Pro for the G4-G5 grade bands. Lessons are JavaScript objects, one file per subject. G1-G3 is hand-written in `src/data/`. G4-G5 comes from MMLU-Pro packs that lazy-load per subject from `public/packs/` the first time the student opens that grade. Every question carries its prompt in three languages, options that are either flat strings or per-language arrays, and an answer index. A `forLangs` field marks a lesson as visible only in certain UI languages, which is why an English-speaking student doesn't see vocab-translation lessons like "What does 'Dog' mean?". Those only show up for Kazakh and Russian UIs where translating into the L1 is the point of the exercise.

## Stack

The front end is Vite and React with Tailwind, Zustand with persist middleware for state, KaTeX for math, the Web Speech API for voice, and React Router for navigation. Production is a small Express process on Railway. A Cloudflare Worker proxies both `gemmi.ai` and `www.gemmi.ai` to the Railway service URL because Cloudflare flattens apex CNAMEs and Railway's certificate provisioning expects them visible.

For Android, Capacitor wraps the Vite build. GitHub Actions builds the APK on every push to main and publishes it to the `apk-latest` release asset. CI runs Node 22 and Java 21 (Capacitor 8 requires both) and re-scaffolds the `android/` directory fresh each build rather than committing the generated files.

The mascot is a bowerbird carrying a gem. Bowerbirds collect bright objects and arrange them in their bowers. So do learners.

## Hackathon tracks

**Main Track.** Gemmi is a shipped trilingual K-12 app for an underserved audience, not a concept demo. Five subjects, five grade bands, a tutor that uses the student's actual state and struggles log instead of inventing one, photo input for handwritten work, and an on-device path that takes everything offline the moment the local Gemma 4 model is installed. The site is live, the APK is downloadable, the repo is open, the curriculum is open.

**Future of Education (Impact).** The brief asks for multi-tool agents that adapt to the individual and empower the educator through seamless integration. Four tools wired into the live student state, an "Ask Gemmi" pill on every lesson question that opens the chat with that question pinned, and a struggles log so the tutor knows what the student keeps getting wrong without being told.

**LiteRT (Special Technology).** The on-device path is the project. A Capacitor Android plugin downloads the Gemma 4 E2B-it `.task` from the LiteRT community Hugging Face repo, holds it in `context.filesDir`, loads it through LiteRT, and runs the same four-tool agent loop the cloud path runs. Once the model is installed the entire tutor (tool calls, multi-turn responses, struggles-log context) keeps working offline. The downloader is built for the spotty rural cellular the target users have.

## Local dev

```
npm install
npm run dev
```

Add `GEMINI_API_KEY` to `.env.local` first so the cloud backup path is wired up. The env var keeps its `GEMINI_` name because the Gemma 4 family is served from the Gemini API endpoint — same auth, just `model: 'gemma-4-26b-a4b-it'` on the wire. Grab a free key at https://aistudio.google.com/apikey. The dev server starts Vite and registers an Express middleware at `/api/tutor`. The same module runs in production from `server/index.js`, so dev and prod behave identically.

To build a fresh APK locally (Android SDK and Java 21 required):

```
npm run android:apk
```

GitHub Actions does this on every push to main.
