/**
 * Provider-agnostic narration generator contract (CLAUDE.md §1's standing
 * principle: real model call, never templating — this interface is what
 * makes the provider swappable without touching the fallback logic, the
 * caching layer, or any touchpoint call site — see DECISIONS.md D042).
 *
 * SERVER-ONLY. Never import from client code — dev/api/narrate.ts and the
 * Vite dev-server middleware are the only callers.
 */

import type { NarrationInput } from '../utils/narrationShared'
import { anthropicGenerator } from './generators/anthropicGenerator'
import { geminiGenerator } from './generators/geminiGenerator'

export class NarrationApiError extends Error {}

/** One method: structured figures in, generated prose out, or throw NarrationApiError. */
export interface NarrationGenerator {
  readonly name: string
  generate(input: NarrationInput): Promise<string>
}

const GENERATORS: Record<string, NarrationGenerator> = {
  gemini: geminiGenerator,
  anthropic: anthropicGenerator,
}

const DEFAULT_PROVIDER = 'gemini'

/**
 * Picks the active generator via NARRATION_PROVIDER (env var), defaulting
 * to Gemini (DECISIONS.md D042). Anthropic remains a fully working,
 * available adapter — set NARRATION_PROVIDER=anthropic to switch, no code
 * change required.
 */
export function getActiveGenerator(): NarrationGenerator {
  const requested = process.env.NARRATION_PROVIDER?.trim().toLowerCase() || DEFAULT_PROVIDER
  const generator = GENERATORS[requested]
  if (!generator) {
    throw new NarrationApiError(`Unknown NARRATION_PROVIDER "${requested}" — expected one of: ${Object.keys(GENERATORS).join(', ')}`)
  }
  return generator
}
