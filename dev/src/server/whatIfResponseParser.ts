/**
 * Shared response parsing for Feature 2's interpreter adapters — structural
 * parsing only (is this valid JSON shaped like one of the three known
 * response types?). Business-rule and grounding validation is a separate
 * concern, deliberately: see dev/src/utils/whatIfValidation.ts.
 *
 * Extracted here, not duplicated per adapter, for the same reason
 * narrationPrompt.ts is shared rather than copied into each generator.
 */

import type { WhatIfInterpretationResult, WhatIfCandidate } from '../utils/whatIfShared'

export class WhatIfParseError extends Error {}

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : trimmed
}

export function parseInterpreterResponse(raw: string): WhatIfInterpretationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    throw new WhatIfParseError('Interpreter response was not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new WhatIfParseError('Interpreter response was not a JSON object')
  }
  const body = parsed as Record<string, unknown>

  if (body.type === 'clarify') {
    if (typeof body.question !== 'string' || !body.question.trim()) {
      throw new WhatIfParseError('"clarify" response is missing a question string')
    }
    return { type: 'clarify', question: body.question }
  }

  if (body.type === 'refuse') {
    if (typeof body.reason !== 'string' || !body.reason.trim()) {
      throw new WhatIfParseError('"refuse" response is missing a reason string')
    }
    return { type: 'refuse', reason: body.reason }
  }

  if (body.type === 'confirm') {
    if (typeof body.summary !== 'string' || !body.summary.trim()) {
      throw new WhatIfParseError('"confirm" response is missing a summary string')
    }
    if (typeof body.candidate !== 'object' || body.candidate === null) {
      throw new WhatIfParseError('"confirm" response is missing a candidate object')
    }
    const candidate = body.candidate as Record<string, unknown>
    // Real, observed model inconsistency (DECISIONS.md's amount-rejection
    // bug entry): for a multi-turn conversation specifically, the model
    // sometimes emits "manualSelections" as a bare array of fund selections
    // instead of the documented {"fund_selections":[...]} wrapper —
    // reproduced live, roughly 4 of 5 real multi-turn calls, never observed
    // in a single-turn call. This is still unambiguously structural (the
    // array's own contents are exactly what fund_selections should hold),
    // so it's normalized here — the parser's own stated job ("is this valid
    // JSON shaped like one of the three known response types?") — rather
    // than left to reach validateCandidate() as an apparently-empty
    // manualSelections, which produced the wrong, misleading "needs at
    // least one named fund" message for a request that named one clearly.
    if (Array.isArray(candidate.manualSelections)) {
      candidate.manualSelections = { fund_selections: candidate.manualSelections }
    }
    return { type: 'confirm', candidate: candidate as unknown as WhatIfCandidate, summary: body.summary }
  }

  throw new WhatIfParseError(`Unknown interpreter response type "${String(body.type)}"`)
}
