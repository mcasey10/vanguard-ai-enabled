/**
 * GET /api/demo-config — Vercel serverless function (D073).
 *
 * Reports which real provider each AI feature's env var actually resolves
 * to right now, using the exact same resolution functions every real
 * narrate/interpret request already uses (getActiveGenerator()/
 * getActiveInterpreter(), called with no override) — never a duplicated or
 * guessed mapping of env var name to provider.
 *
 * This endpoint is read-only display support for the Demo Settings dialog
 * (D071/D073): it lets the dialog correctly highlight the real default
 * provider when the user hasn't made an explicit choice yet. It is NOT part
 * of the actual narrate/interpret call path — those already resolve their
 * own default server-side whenever a request omits `provider` (D071), with
 * or without this endpoint existing. Calling getActiveGenerator()/
 * getActiveInterpreter() here makes no network call and performs no
 * calculation — both functions just pick an adapter object synchronously.
 */

import { getActiveGenerator } from '../src/server/narrationGenerator.js'
import { getActiveInterpreter } from '../src/server/whatIfInterpreter.js'

interface VercelLikeRequest {
  method?: string
}

interface VercelLikeResponse {
  status(code: number): VercelLikeResponse
  json(body: unknown): void
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // A misconfigured env var (an unknown provider name) throws from
  // getActiveGenerator()/getActiveInterpreter() — that's a real
  // configuration problem, but it shouldn't prevent the Demo Settings
  // dialog from opening. Report null for whichever side failed to resolve;
  // the client's own last-resort fallback (Gemini) takes over from there.
  let narrationProvider: string | null
  try {
    narrationProvider = getActiveGenerator().name
  } catch {
    narrationProvider = null
  }

  let whatifProvider: string | null
  try {
    whatifProvider = getActiveInterpreter().name
  } catch {
    whatifProvider = null
  }

  res.status(200).json({ narrationProvider, whatifProvider })
}
