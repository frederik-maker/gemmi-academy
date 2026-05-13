# Gemmi Academy

A K-12 learning app for Kazakh kids that runs in three languages and ships either as a web app at **https://gemmi.ai** or as an [APK](https://github.com/frederik-maker/gemmi-academy/releases/latest). The curriculum covers five subjects (math, science, history, society, English) from age 5 through college, and there is a multi-tool AI tutor powered by Gemma 4 sitting inside every lesson the student opens.

Built for the [Gemma 4 Good Hackathon](https://kaggle.com/competitions/gemma-4-good-hackathon). The submission is going in against the **Main Track**, the **Future of Education** impact track, and the **LiteRT** special technology track.

## What it does

A student picks their grade band and lands on a Duolingo-style lesson path through whichever subject they want. Each lesson is five questions with hearts, streaks, and XP. Get one wrong, lose a heart. Run out of hearts and you either wait fifteen minutes per heart to refill or spend gems to skip the wait. There are roughly 1,943 hand-curated trilingual questions for G1 through G3 across math, science, history, society and English, plus around 3,000 more pulled from MMLU-Pro for the G4-G5 grade bands.

The more interesting part of the app is the tutor. It's a multi-tool agent that follows the student everywhere they go. From the home screen they can ask anything and the tutor decides which tool to call: it can look up the student's full state (XP, streak, completed lessons, weakest subject), search the curriculum by keyword, recommend the single most useful next lesson, or generate a fresh practice question on whatever topic they ask for. Each of those tools runs against the same in-app state the lessons themselves are using, so the answers are grounded in actual progress rather than invented.

Inside a lesson, a small "Ask Gemmi" pill on each question opens that same chat with the question pinned into the tutor's context. If the student just got it wrong, the correct answer is pinned alongside, and the tutor opens by explaining where the misstep was. The student can talk to it instead of typing (Web Speech for both directions) or point the phone's camera at whatever they're working on, handwritten arithmetic or a textbook page or a chemistry diagram, and the tutor reads the image and answers about what it sees.

Every wrong answer also goes into a small per-student struggles log that the tutor reads on every turn. The effect is that it picks up on patterns: if a kid has missed two quadratics in the last day, the next time they open the chat the tutor can volunteer that without being asked. The shape of the experience ends up much closer to a private tutor than a chatbot, because it remembers, it adapts, and it knows the student's specific gaps.

## On-device first

The primary tutor is **Gemma 4 E2B-it running locally on the user's phone**, loaded through MediaPipe's `LlmInference` API inside a Capacitor Android plugin. The model is the `gemma-4-E2B-it-web.task` build the LiteRT community team publishes on Hugging Face: roughly 2 GB, int4-quantised, MediaPipe-compatible. It is **not bundled into the APK**. The student opens the app, taps "enable offline AI", and the .task downloads to `context.filesDir`. From that moment on the tutor runs entirely on the phone with no network. No keys to manage, no API spend, no data leaving the device. This is the path that matters for the audience the project actually targets: kids in rural Kazakhstan with patchy connectivity and entry-level Android phones.

The downloader in `native/ModelDownloader.kt` is built around the assumption that a 2 GB download over rural cellular will lose connection several times. Each attempt resumes from wherever the .part file got to using HTTP Range requests, retries with exponential backoff (1s → 2s → 4s → ... → 30s, up to eight attempts inside a single call), tolerates `SSLException`, `SocketTimeoutException`, and mid-stream `IOException`, and SHA-256-verifies the bytes before atomically renaming the .part file to the final destination. The Hugging Face resolve URL is served behind Cloudfront with `Accept-Ranges: bytes` so the resumes work cleanly.

Until the on-device model is installed, the tutor falls back to a cloud path: `src/lib/tutorServer.js` forwards multimodal messages to Gemini 2.5 Flash via `@google/genai`. The cloud path also handles the web version of the app, where running a 2 GB local model inside a browser tab is obviously not on the table. Both paths share the same four-tool registry, the same system prompt, and the same chain-of-thought scrubber. As far as the lessons and the tutor UI are concerned, they call `tutorClient.streamReply()` and don't care which path actually served the response. `tutorProviders.js` prefers `nativeProvider` whenever it is available, only falling through to `cloudProvider` if the on-device model isn't loaded.

## Tech

The front end is Vite and React with Tailwind, Zustand with persist middleware for state, KaTeX for math, the Web Speech API for voice, and React Router for navigation. Lessons are JavaScript objects, one file per subject. G1-G3 is hand-written in `src/data/`. G4-G5 comes from MMLU-Pro packs that lazy-load per subject from `public/packs/` the first time the student opens that grade. Every question carries its prompt in three languages, options that are either flat strings or per-language arrays, and an answer index. A `forLangs` field lets a lesson hide itself from particular UI languages, which is why an English-speaking student doesn't see vocab-translation lessons like "What does 'Dog' mean?" Those only show up for Kazakh and Russian UIs where translating into the L1 is the point of the exercise.

Production is a small Express process on Railway. A Cloudflare Worker sits in front and proxies both `gemmi.ai` and `www.gemmi.ai` to the Railway service URL. That arrangement exists because Cloudflare flattens apex CNAMEs and Railway's certificate provisioning expects them visible, so the Worker bridges the two without losing edge SSL.

For Android, Capacitor wraps the Vite build. GitHub Actions builds the APK on every push to main and publishes it to the `apk-latest` release asset. The CI job runs Node 22 and Java 21 (Capacitor 8 requires both) and re-scaffolds the `android/` directory fresh each build rather than committing the generated files.

The mascot is a bowerbird carrying a small gem, drawn separately and processed through a Pillow script that does edge-aware background removal, kills enclosed white pockets (the gaps between the legs and inside the beak that the outer flood-fill cannot reach), finds the bounding box of the opaque pixels, and re-centers the figure on a transparent canvas. The result is the PNG that lives in `public/`, and the same script regenerates every favicon and app-icon variant in sync.

## Hackathon tracks

**Main Track.** The case for the overall prize is that Gemmi is a fully shipped trilingual K-12 app for an underserved audience, not a concept demo. Five subjects, five grade bands, a tutor that is genuinely personalized through real student state and a struggles log, photo input that handles handwritten work, and an on-device path that takes the whole thing offline the moment the local Gemma 4 model is installed. The site is live, the APK is downloadable, the repository is open, and the curriculum is open.

**Future of Education (Impact).** The track brief asks for multi-tool agents that adapt to the individual and empower the educator through seamless integration. Gemmi's tutor is exactly that. Four tools wired into the live student state, an "Ask Gemmi" pill on every lesson question that opens the chat with the question already in context, and a struggles log that turns repeated mistakes into a teaching moment the tutor surfaces on its own.

**LiteRT (Special Technology).** The on-device path is the project. A Capacitor Android plugin downloads the Gemma 4 E2B-it `.task` from the LiteRT community Hugging Face repo, holds it in `context.filesDir`, and loads it through MediaPipe's `LlmInference`. The same four-tool registry that runs against the cloud path runs against the local model on-device via a JS bridge, so once the model is installed the entire agent loop (tool calls, multi-turn responses, struggles-log context) keeps working offline. The downloader was specifically designed to ride out the kind of spotty cellular the target users in rural Kazakhstan deal with.

## Local dev

```
npm install
npm run dev
```

Add `GEMINI_API_KEY` to `.env.local` first so the cloud backup path is wired up. The dev server starts Vite and registers an Express middleware at `/api/tutor` that proxies to Gemini. The same module runs in production from `server/index.js`, so dev and prod behave identically.

To build a fresh APK locally (Android SDK and Java 21 required):

```
npm run android:apk
```

GitHub Actions does this on every push to main.
