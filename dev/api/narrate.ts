/**
 * POST /api/narrate — Vercel serverless function.
 *
 * Minimal handler: validate the request body is shaped like a NarrationInput
 * (structured, already-engine-computed figures only — never raw account
 * data), call the active narration generator (provider-agnostic — see
 * dev/src/server/narrationGenerator.ts), return prose text. Performs no
 * calculation of its own. See CLAUDE.md §7.
 */

import { getActiveGenerator, NarrationApiError } from '../src/server/narrationGenerator'
import type { NarrationInput } from '../src/utils/narrationShared'

interface VercelLikeRequest {
  method?: string
  body?: unknown
}

interface VercelLikeResponse {
  status(code: number): VercelLikeResponse
  json(body: unknown): void
}

const VALID_TOUCHPOINTS = [
  'fund_selection_rationale',
  'scenario_tradeoff_summary',
  'order_confirmation_summary',
  'execution_summary_narrative',
]
const VALID_TENSES = ['prospective', 'past']
const VALID_SEGMENTS = ['A', 'B', 'C', 'D']

// Rejects anything shaped like raw account/portfolio data (e.g. a Portfolio
// or Account object) as a defense-in-depth check on top of the TypeScript
// contract — a NarrationInput has no account_id, portfolio_id, or holdings.
// `provider` (D071) is an optional sibling field, not part of NarrationInput
// itself — the Demo Settings dialog's runtime selection, stripped out below
// before the rest of the body is passed to the generator.
function isValidNarrationInput(body: unknown): body is NarrationInput & { provider?: string } {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  if ('account_id' in b || 'portfolio_id' in b || 'holdings' in b) return false
  if (!VALID_TOUCHPOINTS.includes(b.touchpoint as string)) return false
  if (!VALID_TENSES.includes(b.tense as string)) return false
  if (!VALID_SEGMENTS.includes(b.segment as string)) return false
  if (!Array.isArray(b.funds) || b.funds.length === 0) return false
  if ('provider' in b && typeof b.provider !== 'string') return false
  return true
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!isValidNarrationInput(req.body)) {
    res.status(400).json({ error: 'Invalid narration input' })
    return
  }

  const { provider, ...input } = req.body

  // Resolved separately from the generate() call below: an unrecognized
  // provider string throws here (same as before this change, still a 502 —
  // see the outer catch), and there's no real provider name to report for
  // that specific case, since nothing was ever resolved to call.
  let generator
  try {
    generator = getActiveGenerator(provider)
  } catch (err) {
    const message = err instanceof NarrationApiError ? err.message : 'Narration generation failed'
    res.status(502).json({ error: message })
    return
  }

  try {
    const text = await generator.generate(input)
    res.status(200).json({ text, providerName: generator.name })
  } catch (err) {
    const message = err instanceof NarrationApiError ? err.message : 'Narration generation failed'
    // providerStatus is the real HTTP status the provider's own API
    // returned (e.g. 429) when one came back at all — never surfaced to the
    // end user as text (D066's rule is unchanged), only used by the
    // provider-failure indicator to tell a genuine quota/rate-limit failure
    // apart from a bad key, a network failure, or a malformed request, none
    // of which ever produce a real status here.
    const providerStatus = err instanceof NarrationApiError ? err.status : undefined
    res.status(502).json({ error: message, providerStatus, providerName: generator.name })
  }
}
