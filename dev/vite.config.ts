import { defineConfig, loadEnv, type Plugin } from 'vite'
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

// Same dev-server parity, for dev/api/interpret.ts (Feature 2 — see
// CLAUDE.md §8 / DECISIONS.md D053). Duplicated rather than generalized
// into one shared middleware factory: the request-forwarding shape is
// identical, but keeping the two independent means either endpoint's dev
// wiring can change without touching the other.
function interpretApiDevMiddleware(): Plugin {
  return {
    name: 'interpret-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/interpret', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')

          const { default: handler } = await server.ssrLoadModule('/api/interpret.ts')
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

// Dev-server parity for dev/api/demo-config.ts (D073) — a GET, not a POST,
// so the request-forwarding body is simpler than the other two middlewares
// (no request body to buffer/parse).
function demoConfigApiDevMiddleware(): Plugin {
  return {
    name: 'demo-config-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/demo-config', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        try {
          const { default: handler } = await server.ssrLoadModule('/api/demo-config.ts')
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
          await handler({ method: 'GET' }, jsonRes)
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: (err as Error).message }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Vite only auto-loads .env.local into import.meta.env (client bundles,
  // VITE_-prefixed only) — it does NOT populate process.env for the Node
  // process running the dev server. Our /api/narrate middleware runs
  // server-side code that reads process.env.GEMINI_API_KEY /
  // ANTHROPIC_API_KEY directly (same as it would under `vercel dev` or a
  // real Vercel deployment, both of which DO inject env vars into
  // process.env automatically) — load .env.local here explicitly so
  // `npm run dev` alone keeps working without `vercel dev`, per D038/D039's
  // local-dev-parity goal, now that D042 adds a second provider's key.
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'NARRATION_PROVIDER', 'WHATIF_PROVIDER']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key]
  }

  return {
    plugins: [react(), narrateApiDevMiddleware(), interpretApiDevMiddleware(), demoConfigApiDevMiddleware()],
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
  }
})
