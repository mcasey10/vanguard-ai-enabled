/**
 * Provider-agnostic prompt content — the actual English instructions sent
 * to whichever model is generating narration. Shared by every adapter in
 * dev/src/server/generators/ so the prompt itself never has to be
 * duplicated or drift between providers; each adapter only maps
 * {system, user} into its own API's request shape.
 *
 * Input/output contract (CLAUDE.md §7 — the CD-4.2 boundary made
 * architectural): this module receives only already-engine-computed
 * NarrationInput figures. It never receives raw account/portfolio data
 * and performs no calculation of its own.
 */

import type { NarrationInput } from '../utils/narrationShared'

const SEGMENT_TONE: Record<NarrationInput['segment'], string> = {
  A: 'Segment A prefers data over interpretation — stay terse and figure-forward. One to two short sentences, lead with the numbers, minimal editorializing.',
  B: 'Write two to three plain-language sentences that explain the reasoning behind the figures, not just the figures themselves.',
  C: 'Write two to three plain-language sentences with slightly more explanatory framing — assume less familiarity with tax/investing terms than segment B.',
  D: 'Write two to three sentences in a reassuring, plain-language tone — this reader wants to understand what is happening and why it is reasonable, not just the figures.',
}

const TOUCHPOINT_FRAMING: Record<NarrationInput['touchpoint'], string> = {
  fund_selection_rationale: 'Explain why these specific funds/lots and amounts were selected for this sale, in terms of tax impact and allocation effect.',
  scenario_tradeoff_summary: 'Summarize the tradeoff this scenario represents relative to its tax cost and its effect on portfolio allocation.',
  order_confirmation_summary: 'Summarize what is about to be submitted for confirmation. Do not introduce any information beyond what is in the figures provided — this is a pre-execution recap, not a new analysis.',
  execution_summary_narrative: 'Summarize, in the past tense, what was just sold and its realized tax consequences.',
}

export function buildNarrationPrompt(input: NarrationInput): { system: string; user: string } {
  const system = [
    'You write short, factual narration for a brokerage sell/rebalance tool.',
    'You may ONLY describe figures given to you in the user message below — never state, estimate, imply, or round a number that is not present verbatim in that data.',
    'Never state an absolute fund price (real or otherwise). A "market_context_return_pct" figure, if present, is a percentage return between two dates only — state it as a percentage return, never alongside or implying a price.',
    'If a fund line has account_type "traditional_IRA", note that the withdrawal is taxed as ordinary income regardless of the gain/loss figure shown — never apply capital-gains framing to it.',
    'Be assistive, not directive (do not tell the reader what they should do) — describe what these figures mean, do not give investment advice.',
    SEGMENT_TONE[input.segment],
    TOUCHPOINT_FRAMING[input.touchpoint],
    'Output prose only — no headers, no bullet points, no markdown.',
  ].join(' ')

  // touchpoint/tense/segment are routing/tone metadata, already folded into
  // `system` above (SEGMENT_TONE, TOUCHPOINT_FRAMING) — the user message
  // carries only the figures themselves, so two calls that differ solely by
  // segment send an identical user message and differ only in tone guidance.
  const { touchpoint: _touchpoint, tense: _tense, segment: _segment, ...figures } = input
  const user = JSON.stringify(figures, null, 2)

  return { system, user }
}
