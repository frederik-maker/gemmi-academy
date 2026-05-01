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
app.post('/api/tutor', (req, res) => {
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on :${PORT}`)
  console.log(`[server] serving ${DIST}`)
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.warn('[server] WARNING: no GEMINI_API_KEY set; /api/tutor will return 500')
  }
})
