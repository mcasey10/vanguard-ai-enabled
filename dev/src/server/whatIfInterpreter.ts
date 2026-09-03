/**
 * Provider-agnostic what-if interpreter contract — the sibling of
 * narrationGenerator.ts, not an extension of it (DECISIONS.md D053: the
 * two features need incompatible response shapes, so this is a separate
 * interface that reuses only the *pattern* narrationGenerator.ts proved —
 * env-var-driven provider selection, testing at the interface/HTTP
 * boundary — not its type or its adapters).
 *
 * SERVER-ONLY. Never import from client code — dev/api/interpret.ts and the
 * Vite dev-server middleware are the only callers.
 */

import type { WhatIfInterpretationInput, WhatIfInterpretationResult } from '../utils/whatIfShared'
import { geminiInterpreter } from './generators/geminiInterpreter'
import { anthropicInterpreter } from './generators/anthropicInterpreter'
import { groqInterpreter } from './generators/groqInterpreter'

// Same reasoning as NarrationApiError's identical field (narrationGenerator.ts) —
// the real HTTP status, when a real response came back, captured for the
// provider-failure indicator's internal use, never for direct user display.
export class WhatIfInterpreterApiError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

/** One method: an utterance (plus history and grounding data) in, a clarify/refuse/confirm result out, or throw WhatIfInterpreterApiError. */
export interface WhatIfInterpreter {
  readonly name: string
  interpret(input: WhatIfInterpretationInput): Promise<WhatIfInterpretationResult>
}

const INTERPRETERS: Record<string, WhatIfInterpreter> = {
  gemini: geminiInterpreter,
  anthropic: anthropicInterpreter,
  groq: groqInterpreter,
}

const DEFAULT_PROVIDER = 'gemini'

/**
 * Picks the active interpreter. A per-request `override` (the Demo Settings
 * dialog's runtime selection, D071) wins when present; otherwise falls back
 * to WHATIF_PROVIDER (env var), defaulting to Gemini — same default and same
 * env-var-per-concern pattern as NARRATION_PROVIDER, kept separate so the two
 * features can be pointed at different providers independently. The env var
 * stays the default for headless testing and any request without an
 * override. Anthropic and Groq (D065) are both fully working, available
 * adapters, available not preferred.
 */
export function getActiveInterpreter(override?: string): WhatIfInterpreter {
  const requested = override?.trim().toLowerCase() || process.env.WHATIF_PROVIDER?.trim().toLowerCase() || DEFAULT_PROVIDER
  const interpreter = INTERPRETERS[requested]
  if (!interpreter) {
    throw new WhatIfInterpreterApiError(`Unknown provider "${requested}" — expected one of: ${Object.keys(INTERPRETERS).join(', ')}`)
  }
  return interpreter
}
