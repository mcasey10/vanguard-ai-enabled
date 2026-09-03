/**
 * Feature 2 client orchestration — the interpret/clarify/confirm loop from
 * the calling side (CLAUDE.md §8). No persistence: conversation state is
 * ordinary component/store state for the life of the assistant-panel
 * session, never written to localStorage or anywhere server-side — decided
 * explicitly, not defaulted silently, because nothing of value exists in an
 * unconfirmed exchange; a confirmed result already inherits the app's
 * existing persisted state the same way a Manual-mode edit does (see
 * DECISIONS.md D053).
 */

import type {
  WhatIfCandidate, WhatIfInterpretationInput, WhatIfInterpretationResult, PortfolioReferenceContext,
} from './whatIfShared'
import { validateCandidate, validateSummary } from './whatIfValidation'
import { buildOptimizationParamsFromCandidate } from './whatIfCandidateToParams'
import { runOptimization, type OptimizationResult } from '../engine/index'
import { recordProviderFailure, recordProviderSuccess } from './providerFailureTracker'
import type { Portfolio } from '../types'

export class WhatIfError extends Error {}

/** Minimal shape interpretWhatIfTurnWith needs — satisfied by WhatIfInterpreter, and by any test double. */
export interface WhatIfInterpreterLike {
  interpret(input: WhatIfInterpretationInput): Promise<WhatIfInterpretationResult>
}

/**
 * A "confirm" result is never trusted at face value — re-validate it against
 * the same reference data the interpreter was given, and downgrade to
 * "refuse" or "clarify" if it doesn't hold up. This is what makes the
 * boundary architectural rather than just a prompt instruction the model
 * might ignore (same reasoning as CD-4.2's enforcement for narration).
 * validateSummary() (D075) checks the free-text plain-language summary too —
 * the one part of a confirm result validateCandidate() can't see, since it
 * only ever receives the structured candidate.
 */
function downgradeIfInvalid(result: WhatIfInterpretationResult, reference: PortfolioReferenceContext): WhatIfInterpretationResult {
  if (result.type !== 'confirm') return result
  const candidateCheck = validateCandidate(result.candidate, reference)
  if (!candidateCheck.valid) {
    return candidateCheck.kind === 'refuse'
      ? { type: 'refuse', reason: candidateCheck.reason }
      : { type: 'clarify', question: candidateCheck.reason }
  }
  const summaryCheck = validateSummary(result.summary, result.candidate)
  if (!summaryCheck.valid) {
    return summaryCheck.kind === 'refuse'
      ? { type: 'refuse', reason: summaryCheck.reason }
      : { type: 'clarify', question: summaryCheck.reason }
  }
  return result
}

/**
 * Browser entry point — calls the Vercel function / its dev-server
 * equivalent. `provider` (D071) is the Demo Settings dialog's runtime
 * selection, sent as a sibling field on the request body — omit it to use
 * whichever provider WHATIF_PROVIDER resolves to server-side, unchanged
 * behavior from before this parameter existed.
 */
export async function interpretWhatIfTurn(input: WhatIfInterpretationInput, provider?: string): Promise<WhatIfInterpretationResult> {
  const res = await fetch('/api/interpret', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(provider ? { ...input, provider } : input),
  })
  if (!res.ok) {
    // providerStatus/providerName — same internal-use-only fields
    // dev/api/narrate.ts's identical addition carries, added here by
    // dev/api/interpret.ts for the same provider-failure indicator, never
    // shown to the user as raw text.
    const body = await res.json().catch(() => ({})) as { error?: string; providerStatus?: number; providerName?: string }
    if (body.providerName) recordProviderFailure(body.providerName, body.providerStatus)
    throw new WhatIfError(body.error ?? `interpret API returned ${res.status}`)
  }
  const result = await res.json() as WhatIfInterpretationResult & { providerName?: string }
  if (result.providerName) recordProviderSuccess(result.providerName)
  return downgradeIfInvalid(result, input.reference)
}

/**
 * Same orchestration, for server-side code and tests that inject an
 * interpreter directly instead of going through fetch — this is the entry
 * point the test suite uses, per the project's established rule that tests
 * mock at the interface boundary, never a live provider (CLAUDE.md §7,
 * D038 rule 4, applied here per D053's kickoff instruction).
 */
export async function interpretWhatIfTurnWith(
  interpreter: WhatIfInterpreterLike,
  input: WhatIfInterpretationInput
): Promise<WhatIfInterpretationResult> {
  const result = await interpreter.interpret(input)
  return downgradeIfInvalid(result, input.reference)
}

/**
 * The confirm step — only ever called after the user has explicitly
 * confirmed the plain-language summary a "confirm" result carries (CLAUDE.md
 * §8: no numeric preview exists before this). Re-validates one more time
 * (defense in depth — a candidate could reach here from stale client state)
 * then calls the real engine directly. Never recomputes or guesses a figure
 * itself.
 */
export function confirmWhatIfCandidate(
  candidate: WhatIfCandidate,
  reference: PortfolioReferenceContext,
  portfolio: Portfolio,
  activeAccountId: string,
  activeTaxRates: { st_rate: number; lt_rate: number }
): OptimizationResult {
  const check = validateCandidate(candidate, reference)
  if (!check.valid) {
    throw new WhatIfError(`Refusing to execute an invalid candidate: ${check.reason}`)
  }
  const params = buildOptimizationParamsFromCandidate(candidate, portfolio, activeAccountId, activeTaxRates)
  return runOptimization(params)
}
