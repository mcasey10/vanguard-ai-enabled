/**
 * POST /api/interpret — Vercel serverless function.
 *
 * Minimal handler: validate the request body is shaped like a
 * WhatIfInterpretationInput (an utterance, conversation history, and the
 * narrow reference-context grounding data — never a raw Portfolio/Account),
 * call the active interpreter (provider-agnostic — see
 * dev/src/server/whatIfInterpreter.ts), return its clarify/refuse/confirm
 * result. Performs no calculation and no business-rule validation of its
 * own — dev/src/utils/whatIfValidation.ts re-checks any "confirm" result
 * before it's trusted (see dev/src/utils/whatIf.ts). See CLAUDE.md §8.
 */

import { getActiveInterpreter, WhatIfInterpreterApiError } from '../src/server/whatIfInterpreter'
import type { WhatIfInterpretationInput } from '../src/utils/whatIfShared'

interface VercelLikeRequest {
  method?: string
  body?: unknown
}

interface VercelLikeResponse {
  status(code: number): VercelLikeResponse
  json(body: unknown): void
}

const VALID_SEGMENTS = ['A', 'B', 'C', 'D']

// Rejects anything shaped like a raw Portfolio/Account (e.g. carrying
// cost-basis figures or every account, not just the active one) as a
// defense-in-depth check on top of the TypeScript contract. `provider`
// (D071) is an optional sibling field, not part of WhatIfInterpretationInput
// itself — the Demo Settings dialog's runtime selection, stripped out below
// before the rest of the body is passed to the interpreter.
function isValidInterpretationInput(body: unknown): body is WhatIfInterpretationInput & { provider?: string } {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  if (typeof b.utterance !== 'string' || !b.utterance.trim()) return false
  if (!Array.isArray(b.history)) return false
  if (!VALID_SEGMENTS.includes(b.segment as string)) return false
  if (typeof b.reference !== 'object' || b.reference === null) return false
  const ref = b.reference as Record<string, unknown>
  if (typeof ref.account_id !== 'string' || typeof ref.account_type !== 'string') return false
  if (!Array.isArray(ref.funds)) return false
  if ('cost_basis_per_share' in ref || 'total_cost_basis' in ref) return false
  if ('provider' in b && typeof b.provider !== 'string') return false
  return true
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!isValidInterpretationInput(req.body)) {
    res.status(400).json({ error: 'Invalid interpretation input' })
    return
  }

  const { provider, ...input } = req.body

  // Resolved separately from the interpret() call below: an unrecognized
  // provider string throws here (same as before this change, still a 502 —
  // see the outer catch), and there's no real provider name to report for
  // that specific case, since nothing was ever resolved to call.
  let interpreter
  try {
    interpreter = getActiveInterpreter(provider)
  } catch (err) {
    const message = err instanceof WhatIfInterpreterApiError ? err.message : 'Interpretation failed'
    res.status(502).json({ error: message })
    return
  }

  try {
    const result = await interpreter.interpret(input)
    res.status(200).json({ ...result, providerName: interpreter.name })
  } catch (err) {
    const message = err instanceof WhatIfInterpreterApiError ? err.message : 'Interpretation failed'
    // providerStatus/providerName — same reasoning as dev/api/narrate.ts's
    // identical addition: internal-use-only signal for the provider-failure
    // indicator (D0xx), never surfaced to the end user as raw text (D066's
    // rule, unchanged).
    const providerStatus = err instanceof WhatIfInterpreterApiError ? err.status : undefined
    res.status(502).json({ error: message, providerStatus, providerName: interpreter.name })
  }
}
