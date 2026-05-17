# Gemmi Academy

Gemmi Academy is a trilingual K-12 AI tutor for Kazakh kids. The tutor is Gemma 4 end-to-end: on-device Gemma 4 E2B-it via LiteRT-LM in the APK, and Gemma 4 26B-A4B (MoE) via the Gemini API in the cloud. Both paths use the same model family and the same four-tool agent loop. Lessons cover five subjects (math, science, history, society, English) from age five through college in Қазақша, Русский, and English. The site is live at **https://gemmi.ai** and also installable as an [APK](https://github.com/frederik-maker/gemmi-academy/releases/latest).

Gemmi was built for the [Gemma 4 Good Hackathon](https://kaggle.com/competitions/gemma-4-good-hackathon) and submitted to the **Main Track**, the **Future of Education** impact track, and the **LiteRT** special technology track.

## On-device first

The primary tutor is **Gemma 4 E2B-it running on-device through LiteRT-LM**, inside a Capacitor Android plugin. The model is the `gemma-4-E2B-it.litertlm` build the LiteRT community team publishes on Hugging Face, at roughly 2 GB, int4-quantised, and publicly downloadable without a Hugging Face token. The APK ships without it. The student opens the app, taps "enable offline AI", the bundle downloads to `context.filesDir`, and from then on the tutor runs entirely on the phone, with no keys, no API spend, and no data leaving the device.

That detail matters because the target audience is kids in rural Kazakhstan on entry-level Android phones with connectivity that drops for minutes at a time. The downloader in `native/ModelDownloader.kt` is written for that: it assumes the 2 GB transfer will fail mid-way several times, resumes from wherever the partial file left off via an HTTP Range header, backs off exponentially across eight retries before giving up, and rehashes the assembled file before declaring it done. The Hugging Face CDN serves `Accept-Ranges: bytes`, so resumes drop right into the byte stream.

Until the on-device model is installed, the tutor uses a cloud path: `src/lib/tutorServer.js` forwards multimodal messages to **Gemma 4 26B-A4B** (the mixture-of-experts variant with only ~4B active params per token, fast and cheap to serve) via `@google/genai`. The MoE Gemma 4 is served from the same Gemini API endpoint as Gemini itself, using the same SDK and the same API key, with `model: 'gemma-4-26b-a4b-it'` on the wire. The cloud path handles the web app since running a 2 GB local model in a browser tab isn't an option, and it covers the moment between APK install and `.litertlm` download on Android. Both paths share the same four-tool registry, the same system prompt, and the same chain-of-thought scrubber, so the lesson UI calls `streamReply()` regardless of which Gemma instance served the response. `tutorProviders.js` prefers `nativeProvider` whenever it is available.

## The tutor

The tutor is a multi-tool agent available from every screen. From the home view the student can ask anything and the model decides which tool to reach for, whether that's pulling up their progress (XP, streak, completed lessons, weakest subject), searching the curriculum by keyword, recommending what to study next, or generating a fresh practice question on whatever topic just came up. The tools read the same in-app state the lessons write to, so the answers are grounded in the student's real history instead of a hallucination of it.

Inside a lesson, an Ask Gemmi pill on every question opens that same chat with the question pinned. When the student just got an answer wrong, the correct one comes pinned alongside and the tutor leads with the diagnosis rather than waiting to be asked. Voice works both directions through the Capacitor speech plugins (native STT on Android, Web Speech on the web), so a kid can talk through the problem instead of typing, and the camera button accepts a photo of a notebook page when describing the situation is harder than just showing it.

Wrong answers feed a per-student struggles log that the tutor reads on every turn. Miss two quadratics in a day and the next chat opens with the tutor offering to revisit factoring instead of waiting to be told.

## Curriculum

Roughly 1,943 hand-curated trilingual questions cover G1 through G3 across math, science, history, society, and English; another ~3,000 pulled from MMLU-Pro fill out the G4-G5 grade bands. The hand-written G1-G3 content lives in `src/data/` as plain JavaScript objects, one file per subject, while G4-G5 lazy-loads from `public/packs/` the first time a student opens that grade, since there's no point parsing thousands of MMLU questions on cold start when most users never reach them. Each question carries its prompt and options in all three languages so the same lesson works no matter which UI language is active. A `forLangs` field hides lessons that only make sense in some languages, so vocab-translation prompts like "What does 'Dog' mean?" appear for Kazakh and Russian students learning L2 English, but skip the English-UI student for whom the question has no answer.

## Stack

The front end is Vite and React with Tailwind, Zustand for state, KaTeX for math, the Web Speech API for voice, and React Router for navigation. Production is a small Express process on Railway, fronted by Cloudflare at `gemmi.ai`.

For Android, Capacitor wraps the Vite build. GitHub Actions builds the APK on every push to main and publishes it to the `apk-latest` release asset. CI runs Node 22 and Java 21 (Capacitor 8 requires both) and re-scaffolds the `android/` directory fresh each build rather than committing the generated files.

The mascot is a bird carrying a blue gem. The bird grounds the "Gemmi" name and the gem picks up the brand colour.

## Local dev

```
npm install
npm run dev
```

Add `GEMINI_API_KEY` to `.env.local` first so the cloud backup path is wired up. The env var keeps its `GEMINI_` name because the Gemma 4 family is served from the Gemini API endpoint, using the same auth with `model: 'gemma-4-26b-a4b-it'` on the wire. Grab a free key at https://aistudio.google.com/apikey. The dev server starts Vite and registers an Express middleware at `/api/tutor`. The same module runs in production from `server/index.js`, so dev and prod behave identically.

To build a fresh APK locally (Android SDK and Java 21 required):

```
npm run android:apk
```

GitHub Actions does this on every push to main.
