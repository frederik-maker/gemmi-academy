import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY

  return {
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
