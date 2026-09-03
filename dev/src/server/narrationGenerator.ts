/**
 * Provider-agnostic narration generator contract (CLAUDE.md §1's standing
 * principle: real model call, never templating — this interface is what
 * makes the provider swappable without touching the fallback logic, the
 * caching layer, or any touchpoint call site — see DECISIONS.md D042).
 *
 * SERVER-ONLY. Never import from client code — dev/api/narrate.ts and the
 * Vite dev-server middleware are the only callers.
 */

import type { NarrationInput } from '../utils/narrationShared.js'
import { anthropicGenerator } from './generators/anthropicGenerator.js'
import { geminiGenerator } from './generators/geminiGenerator.js'
import { groqGenerator } from './generators/groqGenerator.js'

// `status`, when present, is the real HTTP status the provider's own API
// response carried — captured here so callers (the API route handler) can
// distinguish a genuine quota/rate-limit failure (429 — confirmed real and
// observed live from both Gemini and Groq in this project, see DECISIONS.md
// D065/D066) from every other failure shape (bad key, network failure,
// malformed request), none of which carry a real `status` at all: no fetch
// response ever came back for those. Never surfaced to the end user
// directly (CLAUDE.md §8/D066's rule still applies to user-facing text) —
// this is for the provider-failure indicator's own internal logic.
export class NarrationApiError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

/** One method: structured figures in, generated prose out, or throw NarrationApiError. */
export interface NarrationGenerator {
  readonly name: string
  generate(input: NarrationInput): Promise<string>
}

const GENERATORS: Record<string, NarrationGenerator> = {
  gemini: geminiGenerator,
  anthropic: anthropicGenerator,
  groq: groqGenerator,
}

const DEFAULT_PROVIDER = 'gemini'

/**
 * Picks the active generator. A per-request `override` (the Demo Settings
 * dialog's runtime selection, D071) wins when present; otherwise falls back
 * to NARRATION_PROVIDER (env var), defaulting to Gemini (DECISIONS.md D042).
 * The env var stays the default for headless testing and any request that
 * doesn't send an override — it was never replaced, only made overridable.
 * Anthropic and Groq (D065) are both fully working, available adapters —
 * available, not preferred — the default stays Gemini until proven
 * equivalent, per D065's explicit scope.
 */
export function getActiveGenerator(override?: string): NarrationGenerator {
  const requested = override?.trim().toLowerCase() || process.env.NARRATION_PROVIDER?.trim().toLowerCase() || DEFAULT_PROVIDER
  const generator = GENERATORS[requested]
  if (!generator) {
    throw new NarrationApiError(`Unknown provider "${requested}" — expected one of: ${Object.keys(GENERATORS).join(', ')}`)
  }
  return generator
}
