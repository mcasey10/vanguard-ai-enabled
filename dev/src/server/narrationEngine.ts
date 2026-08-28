/**
 * Server-only narration engine — the Anthropic API call itself.
 *
 * SERVER-ONLY: reads process.env.ANTHROPIC_API_KEY. Never import this file
 * from client code (dev/src/**, excluding this directory) — only
 * dev/api/narrate.ts and the Vite dev-server middleware in vite.config.ts
 * should import it. Client code uses dev/src/utils/narration.ts, which
 * calls this over HTTP via /api/narrate.
 *
 * Input/output contract (CLAUDE.md §7 — the CD-4.2 boundary made
 * architectural): this module receives only already-engine-computed
 * NarrationInput figures and returns only prose text. It never receives
 * raw account/portfolio data and performs no calculation of its own.
 */

import type { NarrationInput } from '../utils/narrationShared'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5'

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

export class NarrationApiError extends Error {}

/** Calls the Anthropic Messages API. Throws NarrationApiError on any failure — callers fall back to the deterministic summary (CLAUDE.md §7). */
export async function generateNarration(input: NarrationInput): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new NarrationApiError('ANTHROPIC_API_KEY is not set')
  }

  const { system, user } = buildNarrationPrompt(input)

  let res: Response
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
  } catch (err) {
    throw new NarrationApiError(`Anthropic API request failed: ${(err as Error).message}`)
  }

  if (!res.ok) {
    throw new NarrationApiError(`Anthropic API returned ${res.status}`)
  }

  const body = await res.json() as { content?: Array<{ type: string; text?: string }> }
  const text = body.content?.find(b => b.type === 'text')?.text
  if (!text) {
    throw new NarrationApiError('Anthropic API returned no text content')
  }
  return text.trim()
}
