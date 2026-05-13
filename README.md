# Gemmi Academy

A K-12 learning app for Kazakh kids that runs in three languages and ships either as a web app at **https://gemmi.ai** or as an [APK](https://github.com/frederik-maker/gemmi-academy/releases/latest). The curriculum covers five subjects (math, science, history, society, English) from age 5 through college, and there is a multi-tool AI tutor backed by Gemini sitting inside every lesson the student opens.

Built for the [Gemma 4 Good Hackathon](https://kaggle.com/competitions/gemma-4-good-hackathon). The submission is going in against the **Main Track**, the **Future of Education** impact track, and the **LiteRT** special technology track.

## What it does

A student picks their grade band and lands on a Duolingo-style lesson path through whichever subject they want. Each lesson is five questions with hearts, streaks, and XP. Get one wrong, lose a heart. Run out of hearts and you either wait fifteen minutes per heart to refill or spend gems to skip the wait. There are roughly 1,943 hand-curated trilingual questions for G1 through G3 across math, science, history, society and English, plus around 3,000 more pulled from MMLU-Pro for the G4-G5 grade bands.

The more interesting part of the app is the tutor. It's a multi-tool agent that follows the student everywhere they go. From the home screen they can ask anything and the tutor decides which tool to call: it can look up the student's full state (XP, streak, completed lessons, weakest subject), search the curriculum by keyword, recommend the single most useful next lesson, or generate a fresh practice question on whatever topic they ask for. Each of those tools runs against the same in-app state the lessons themselves are using, so the answers are grounded in actual progress rather than invented.

Inside a lesson, a small "Ask Gemmi" pill on each question opens that same chat with the question pinned into the tutor's context. If the student just got it wrong, the correct answer is pinned alongside, and the tutor opens by explaining where the misstep was. The student can talk to it instead of typing (Web Speech for both directions) or point the phone's camera at whatever they're working on, handwritten arithmetic or a textbook page or a chemistry diagram, and the tutor reads the image and answers about what it sees.

Every wrong answer also goes into a small per-student struggles log that the tutor reads on every turn. The effect is that it picks up on patterns: if a kid has missed two quadratics in the last day, the next time they open the chat the tutor can volunteer that without being asked. The shape of the experience ends up much closer to a private tutor than a chatbot, because it remembers, it adapts, and it knows the student's specific gaps.

## Tech

The front end is Vite and React with Tailwind, Zustand with persist middleware for state, KaTeX for math, the Web Speech API for voice, and React Router for navigation. Lessons are JavaScript objects, one file per subject. G1-G3 is hand-written in `src/data/`. G4-G5 comes from MMLU-Pro packs that lazy-load per subject from `public/packs/` the first time the student opens that grade. Every question carries its prompt in three languages, options that are either flat strings or per-language arrays, and an answer index. A `forLangs` field lets a lesson hide itself from particular UI languages, which is why an English-speaking student doesn't see vocab-translation lessons like "What does 'Dog' mean?" Those only show up for Kazakh and Russian UIs where translating into the L1 is the point of the exercise.

The tutor has two paths and prefers the on-device one whenever it is available. The native path runs Gemma 4 E2B-it locally inside the Capacitor Android shell through MediaPipe's `LlmInference` API. The model is the `gemma-4-E2B-it-web.task` build that the LiteRT community team publishes on Hugging Face, about 2 GB int4-quantised, and it is downloaded into `context.filesDir` the first time a student taps "enable offline AI" rather than being bundled into the APK. The downloader resumes on every reconnect using HTTP range requests, with internal exponential backoff and SHA-256 verification before promoting the .part file, so it can survive the kind of spotty rural cellular that the target audience actually has. The cloud fallback in `src/lib/tutorServer.js` is a small SSE proxy that forwards multimodal messages to Gemini 2.5 Flash via `@google/genai` and exists so the web app and pre-download Android both have a working tutor. The same four-tool registry runs on both paths.

Production is a small Express process on Railway. A Cloudflare Worker sits in front and proxies both `gemmi.ai` and `www.gemmi.ai` to the Railway service URL. That arrangement exists because Cloudflare flattens apex CNAMEs and Railway's certificate provisioning expects them visible, so the Worker bridges the two without losing edge SSL.

For Android, Capacitor wraps the Vite build. GitHub Actions builds the APK on every push to main and publishes it to the `apk-latest` release asset. The CI job runs Node 22 and Java 21 (Capacitor 8 requires both) and re-scaffolds the `android/` directory fresh each build rather than committing the generated files.

The mascot is a bowerbird carrying a small gem, drawn separately and processed through a Pillow script that does edge-aware background removal, finds the bounding box of the opaque pixels, and re-centers the figure on a transparent canvas. The result is the PNG that lives in `public/`.

## Hackathon tracks

**Main Track.** The case for the overall prize is that Gemmi is a fully shipped trilingual K-12 app for an underserved audience, not a concept demo. Five subjects, five grade bands, a tutor that is genuinely personalized through real student state and a struggles log, photo input that handles handwritten work, and an on-device path that takes the whole thing offline once the local Gemma 4 model is installed. The site is live, the APK is downloadable, the repository is open, and the curriculum is open.

**Future of Education** (Impact, $10k). The track brief asks for multi-tool agents that adapt to the individual and empower the educator through seamless integration. Gemmi's tutor is exactly that. Four tools wired into the live student state, an "Ask Gemmi" pill on every lesson question that opens the chat with the question already in context, and a struggles log that turns repeated mistakes into a teaching moment the tutor surfaces on its own.

**LiteRT** (Special Technology, $10k). The on-device path runs the Gemma 4 E2B-it model that the LiteRT community team published in the MediaPipe `.task` format on Hugging Face. The Capacitor Kotlin plugin in `native/` downloads it (resumable, sha256-verified, retry-on-drop, designed for the spotty cellular the target users have), loads it through MediaPipe's `LlmInference`, and exposes the same JS-side tool registry that the cloud path uses. Once the model lives in `context.filesDir` the cloud path drops out and the entire tutor runs without a network.

## Local dev

```
npm install
npm run dev
```

Add `GEMINI_API_KEY` to `.env.local` first. The dev server starts Vite and registers an Express middleware at `/api/tutor` that proxies to Gemini. The same module runs in production from `server/index.js`, so dev and prod behave identically.

To build a fresh APK locally (Android SDK and Java 21 required):

```
npm run android:apk
```

GitHub Actions does this on every push to main.
