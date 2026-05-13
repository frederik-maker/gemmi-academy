import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Short git SHA, baked into the bundle as __BUILD__. Lets us surface
// "you're running build abcd123" inside the UI so we can tell at a
// glance whether a user installed the latest APK or is sitting on a
// service-worker-cached old bundle.
function gitSha() {
  try { return execSync('git rev-parse --short HEAD').toString().trim() }
  catch { return 'dev' }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY

  return {
    define: {
      __BUILD__: JSON.stringify(gitSha()),
    },
    plugins: [
      react(),
      {
        name: 'gemmi-tutor-api',
        configureServer(server) {
          server.middlewares.use('/api/tutor', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.end()
              return
            }
            const { handleTutorRequest } = await server.ssrLoadModule('/src/lib/tutorServer.js')
            try {
              await handleTutorRequest(req, res)
            } catch (e) {
              if (!res.writableEnded) {
                res.statusCode = 500
                res.end(JSON.stringify({ error: e?.message || 'tutor_failed' }))
              }
            }
          })
        },
      },
    ],
    server: {
      host: true,
      port: 5180,
      strictPort: true,
    },
  }
})
