// Production server. Serves the built Vite bundle from ./dist and proxies
// /api/tutor through to the existing tutorServer.js handler (Gemini 2.5 Pro).
// This replaces the dev-mode Vite middleware that handles the same route
// during `npm run dev`.

import express from 'express'
import compression from 'compression'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleTutorRequest } from '../src/lib/tutorServer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT || 3000)

const app = express()
app.disable('x-powered-by')
app.use(compression())

// Tutor SSE endpoint. Express's default body parsing breaks streaming, so we
// route it before any middleware that touches the request stream.
//
// CORS: the Capacitor APK serves its WebView from https://localhost/ (not
// gemmi.ai), so a fetch to gemmi.ai/api/tutor is cross-origin. We allow
// any origin because the endpoint is unauthenticated anyway — the API key
// lives server-side, and rate limiting / abuse handling is a separate
// concern from CORS.
app.options('/api/tutor', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '86400')
  res.status(204).end()
})
app.post('/api/tutor', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  handleTutorRequest(req, res).catch((err) => {
    console.error('[tutor]', err?.message || err)
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'tutor_failed' })
    } else if (!res.writableEnded) {
      res.end()
    }
  })
})

// Health check for Railway's edge.
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// Static assets, long-cache the hashed ones, short-cache the rest.
app.use(express.static(DIST, {
  setHeaders(res, filePath) {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    } else if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache')
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600')
    }
  },
}))

// SPA fallback: serve index.html for any unknown path so React Router can
// take over. The 404 only applies to /api/* now.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(DIST, 'index.html'))
})

// Last-line-of-defense Express error handler. Without this a thrown error in
// any middleware propagates to Node's default handler and tears the process
// down. Railway's restart policy would bring it back in a few seconds, but
// returning users see a 502 from the Cloudflare Worker during the cold-start
// window. Catching here keeps the process alive and returns a clean 500.
app.use((err, _req, res, _next) => {
  console.error('[express]', err?.stack || err?.message || err)
  if (res.headersSent) {
    try { res.end() } catch { /* connection probably torn down */ }
    return
  }
  res.status(500).json({ error: 'server_error' })
})

// Same idea at the Node level: async work outside of an Express request (a
// stray rejected promise, an event-loop callback) can crash the process.
// We log and keep running. If something truly wedges the loop, Railway's
// health check will spot it and restart.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack || err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on :${PORT}`)
  console.log(`[server] serving ${DIST}`)
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.warn('[server] WARNING: no GEMINI_API_KEY set; /api/tutor will return 500')
  }
})
