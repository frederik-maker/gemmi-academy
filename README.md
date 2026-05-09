# Gemmi Academy

Live: **https://gemmi.ai** · APK: [github.com/frederik-maker/gemmi-academy/releases/latest](https://github.com/frederik-maker/gemmi-academy/releases/latest)

K-12 in three languages on a phone. Five subjects (math, science, history, society, English) across five grade bands from age 5 to college. 1,943 hand-curated trilingual questions for G1-G3 plus around 3,000 MMLU-Pro questions for G4-G5, in Қазақша, Русский, and English. The AI tutor can see your handwriting and remembers what you got wrong.

Built for the [Gemma 4 Good Hackathon](https://kaggle.com/competitions/gemma-4-good-hackathon). Target tracks: **Future of Education**, **Digital Equity & Inclusivity**, **LiteRT**, **Unsloth**.

## What it does

A student picks their grade and gets a Duolingo-style lesson path. Five questions per lesson, hearts and a streak. Get one wrong, lose a heart. Run out and wait 15 minutes per heart to refill, or spend 50 gems.

The tutor follows the student around. From the home screen they can ask anything. From inside a lesson question, an "Ask Gemmi" pill opens the chat with the current question pinned in context. After a wrong answer, the correct answer is pinned too. The tutor has four tools: look up the student's progress, find lessons matching a keyword, recommend a next lesson based on weakest subject, generate a fresh practice question. It also accepts photos. Point the camera at handwritten arithmetic or a textbook page and Gemma reads it.

Every wrong answer goes into a struggles log with the question text and the right answer. That log is in the tutor's system context, so it can say "you got two quadratics wrong this week, want to revisit factoring?" without being prompted.

## Tech

Vite + React, Tailwind, Zustand with persist for state, KaTeX for math, Web Speech API for voice, React Router.

Lessons are JavaScript objects, one file per subject. G1-G3 hand-written in `src/data/`. G4-G5 from MMLU-Pro packs lazy-loaded per subject. Every question is trilingual. A `forLangs` field lets a lesson opt out of certain UI languages, so "Dog means Ит" works in Kazakh UI but disappears in English UI (where the tautology "Dog means Dog" would be useless).

The tutor server (`src/lib/tutorServer.js`) is an SSE proxy that forwards multimodal messages to Gemini 2.5 Flash via `@google/genai`, resolves tool calls in-process, and streams deltas back. A partially-scaffolded native path in `native/` runs Gemma 4 E4B on-device via LiteRT-LM, taking over once a student installs the model. Same tool registry both ways.

Production is a small Express process on Railway. A Cloudflare Worker sits in front handling both apex and www, because Cloudflare flattens apex CNAMEs and Railway's cert provisioning expects them visible. The Worker forwards to the Railway service URL and CF Universal SSL covers both names.

For Android, Capacitor wraps the Vite build. GitHub Actions builds the APK on every push to main and publishes it to the `apk-latest` release asset. Node 22, Java 21, fresh `android/` scaffold each build.

The mascot is a bowerbird with a gem. Drawn separately, processed through a Pillow script that does edge-aware background removal, bounding-box auto-crop, and re-centers the figure on a transparent canvas.

## Hackathon tracks

**Future of Education** (Impact). The brief calls for "multi-tool agents that adapt to the individual and empower the educator through seamless integration." Gemmi has four tools that personalize to grade, language, completed lessons, and recent struggles. The struggles log is the integration piece: the tutor knows what the student is stuck on without being told.

**Digital Equity & Inclusivity** (Impact). Trilingual end-to-end. Kazakh is not a second-class language. Every prompt, every tool result, every error message exists in three languages with no translation loss. The `forLangs` filter means the curriculum adapts to who the student is, not the other way around.

**LiteRT** (Special Technology). The on-device path lives in `native/` as a Capacitor Android plugin (Kotlin) with a Node-side bridge. It runs a fine-tuned Gemma 4 E4B via LiteRT-LM. Same tool registry as the cloud path. The model runs locally, tools run in JS via the bridge.

**Unsloth** (Special Technology). The on-device Gemma 4 E4B is fine-tuned with Unsloth on a trilingual K-12 instruction dataset.

## Local dev

```
npm install
npm run dev
```

Add `GEMINI_API_KEY` to `.env.local` first. The dev server starts Vite and registers an Express middleware at `/api/tutor` that proxies to Gemini. The same module runs in production from `server/index.js`, so dev and prod behave identically.

To build a fresh APK locally (requires Android SDK and Java 21):

```
npm run android:apk
```

GitHub Actions does this on every push to main.
