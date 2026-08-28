import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-server parity for dev/api/narrate.ts (Vercel serverless function) so
// `npm run dev` alone works without `vercel dev` — see CLAUDE.md §7 / D038.
// Falls back the same way production does when ANTHROPIC_API_KEY is unset.
function narrateApiDevMiddleware(): Plugin {
  return {
    name: 'narrate-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/narrate', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')

          const { default: handler } = await server.ssrLoadModule('/api/narrate.ts')
          const jsonRes = {
            status(code: number) {
              res.statusCode = code
              return jsonRes
            },
            json(payload: unknown) {
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify(payload))
            },
          }
          await handler({ method: 'POST', body }, jsonRes)
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: (err as Error).message }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), narrateApiDevMiddleware()],
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    strictPort: false,
  },
  test: {
    environment: 'node',
    globals: true,
    // Scope Vitest to its own *.test.ts files under src/ — tests/ is
    // Playwright's directory (tests/flows.spec.ts), a different test
    // runner with an incompatible test.describe(). Vitest's default
    // include pattern matches *.spec.ts too, which picks that file up
    // and fails to parse it; this narrows discovery to avoid the collision.
    include: ['src/**/*.test.ts'],
  },
})
