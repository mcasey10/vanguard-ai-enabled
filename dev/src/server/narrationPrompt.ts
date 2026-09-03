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
 *
 * Tier-2 prompt-quality rules below (formatting, market-context window,
 * natural-language phrasing, segment contrast, IRA framing) were added
 * after review of real generated output — see DECISIONS.md D045.
 */

import type { NarrationInput, NarrationTense } from '../utils/narrationShared'
import { SEGMENT_PROFILES } from '../utils/segmentResearch'

// Whether the transaction being narrated has actually happened yet — orthogonal
// to touchpoint and segment, and previously silently discarded by this module
// (destructured out below and never referenced), which left the model with no
// signal to distinguish a proposed, unexecuted plan (Fund Selection, Scenario
// Analysis) from a completed one (Execution Summary) and it defaulted to
// declarative past tense ("Sold $X...") everywhere, including at touchpoints
// that have not executed anything yet. Order Confirmation is prospective too
// (it hasn't executed either — REQ-EC-004's "pre-execution recap" framing in
// TOUCHPOINT_FRAMING below is the same idea, stated in touchpoint-content
// terms rather than tense terms). See DECISIONS.md D062.
const TENSE_INSTRUCTION: Record<NarrationTense, string> = {
  prospective: 'This transaction has NOT been executed — it is a proposed plan the reader is still reviewing, not a completed action. Narrate it in a proposed/conditional frame ("Selling $X would realize...", "This would sell $X of...", "would result in..."). NEVER use past-tense/completed-action phrasing ("Sold $X", "realized a gain") — the sale has not happened yet.',
  past: 'This transaction has already been executed and settled. Narrate it in the past tense, describing what was sold and its realized consequences as completed fact ("Sold $X of...", "realized a gain of...").',
}

const SEGMENT_TONE: Record<NarrationInput['segment'], string> = {
  A: 'Segment A prefers data over interpretation and figure-forward brevity. Structure by fund count, not by a fixed sentence limit: for a SINGLE fund, write exactly ONE short, strictly figure-led sentence (~25 words) stating what happened and the resulting figures, with no explanation of why. For MULTIPLE funds, write ONE short sentence PER FUND, each following that same single-fund rule — never chain multiple funds together into one long sentence with commas/"alongside"/"plus"/"and". Every sentence should read as its own standalone, scannable statement. Example, one fund (shown in past tense for illustration only — always follow the tense instruction above for the actual verb tense): "Sold $21,780.00 of VTSAX (150 shares, FIFO), realizing a $1,920.00 short-term gain; est. tax $105.78." Example, two funds (two separate sentences, not one): "Sold $21,780.00 of VTSAX (150 shares, FIFO), realizing a $1,920.00 short-term gain; est. tax $105.78. Sold $16,000.00 of VBTLX (MinTax), realizing a $1,683.40 long-term loss; est. tax $0.00." A four-fund transaction gets four short sentences, not one sentence with four clauses.',
  B: 'Write two to three plain-language sentences that explain the reasoning behind the figures, not just the figures themselves — why this sale makes sense (tax efficiency, allocation effect), not merely what the numbers are. Example of the right depth: "Selling this lot realizes a modest short-term gain while trimming an overweight equity position, which nudges the portfolio a bit closer to its target mix. The resulting tax cost is small relative to the amount sold." Noticeably more explanatory than segment A — if your segment-B output would read almost the same as a segment-A output for the same figures, add more of the "why," not more figures.',
  // C and D below were cross-wired relative to their real personas until
  // D074: C had D's "define jargon for a less-familiar audience" content,
  // and D was missing it along with its own real "orientation before
  // action" framing — found in the D069 compliance audit, fixed here using
  // segmentResearch.ts's real, quoted research fields directly (imported
  // above) rather than re-deriving or re-quoting them, so this prompt and
  // Feature 2's what-if SEGMENT_TONE (whatIfPrompt.ts) share one literal
  // source of truth for the underlying research, not just a similar
  // paraphrase that could drift apart again.
  C: `Segment C (${SEGMENT_PROFILES.C.name}) is under real time pressure — goal: "${SEGMENT_PROFILES.C.goal}." Write the SHORTEST possible phrasing: one short, front-loaded sentence stating the headline figure first, with no subordinate clauses, no explanation of reasoning, and no suggestion to pause, compare, or reconsider. Two explicit content rules for this segment, not just a style preference — a shorter sentence that still contains this content is not short enough: (1) NEVER state the short-term and long-term gain/loss breakdown separately, even briefly — state only the single net tax figure for the transaction; (2) NEVER state per-asset-class allocation percentage shifts (stocks/bonds/reserves, before vs. after, or any "-X% stocks" style figure). Both are tax detail and optional extra work in their own right, exactly what this reader's own research says the tool must avoid, regardless of how tersely they are phrased. Example of the target output, using real figures: "Selling $15,000 of VTSAX and $10,000 of VBTLX comes to an estimated net tax of $64.85." What this reader needs the tool to avoid: ${SEGMENT_PROFILES.C.toolMustAvoid}.`,
  D: `Segment D (${SEGMENT_PROFILES.D.name}) needs comprehension before anything else — goal: "${SEGMENT_PROFILES.D.goal}." What this reader's own research says the tool must do: "${SEGMENT_PROFILES.D.toolMust}." Write two to three sentences in a reassuring, plain-language tone, assuming little familiarity with investing/tax terminology — define jargon in plain words the first time it appears (e.g. instead of "cost basis," say "what was originally paid for these shares"). Your FIRST sentence must orient the reader in general terms — what kind of thing they're looking at and why — BEFORE any specific fund name or dollar figure appears anywhere in the response; never open with "Selling $X of [fund]..." or "Sold $X of [fund]..." as the first clause, regardless of tense. Phrase this orienting sentence in your own words each time — vary the wording; do not default to the same opening phrase every time you write one. For illustration only, NOT a template to copy verbatim (reusing one of these across different summaries defeats the point — genuinely differently-worded openings are both fine, a repeated exact phrase is not): a proposed/unexecuted transaction might open like "Here's what a plan to sell part of your investments would mean for your account" or, worded completely differently, "This summarizes a proposed change to your holdings, before anything is finalized." An already-completed transaction might open like "Here's what happened when this sale went through" or, worded completely differently, "This summarizes a transaction that was just completed in your account." Only after that orienting sentence should you name the specific fund(s) and dollar amount(s), and only then acknowledge the outcome (gain, loss, tax cost) plainly before explaining the mechanics behind it, so the reader isn't left wondering how to feel about the numbers. What this reader needs the tool to avoid: ${SEGMENT_PROFILES.D.toolMustAvoid}.`,
}

const TOUCHPOINT_FRAMING: Record<NarrationInput['touchpoint'], string> = {
  fund_selection_rationale: 'Explain why these specific funds/lots and amounts were selected for this sale, in terms of tax impact and allocation effect.',
  scenario_tradeoff_summary: 'Summarize the tradeoff this scenario represents relative to its tax cost and its effect on portfolio allocation.',
  order_confirmation_summary: 'Summarize what is about to be submitted for confirmation. Do not introduce any information beyond what is in the figures provided — this is a pre-execution recap, not a new analysis.',
  execution_summary_narrative: 'Summarize what was sold and its realized tax consequences.',
}

export function buildNarrationPrompt(input: NarrationInput): { system: string; user: string } {
  const system = [
    'You write short, factual narration for a brokerage sell/rebalance tool, addressed directly to the account holder — write as if explaining the transaction to them in conversation, never as if reciting a data structure.',
    'You may ONLY describe figures given to you in the user message below — never state, estimate, imply, or round a number that is not present verbatim in that data.',
    TENSE_INSTRUCTION[input.tense],
    'Never use a field\'s internal name in your output — describe what a figure means in plain words instead. Do not say "impact percentage," "est tax gross," "market context return percentage," "st gain loss," or any other snake_case or field-shaped phrase; say "tax impact," "shift in portfolio allocation," "trailing 12-month return," "short-term gain," etc.',
    'Omit any figure that is exactly zero and would add no information for the reader (e.g. do not mention "$0 in losses harvested" when none occurred, or a $0/0% impact figure with nothing to say about it). The one exception: a $0 estimated tax figure IS worth stating when it is zero *because* of the account type (Traditional IRA ordinary-income treatment or Roth IRA tax-free treatment) — see the IRA rule below.',
    'Format every dollar figure with a leading "$" and comma thousands separators and two decimal places (e.g. "$21,780.00" — never "21780" or "21780.0"). Format share counts explicitly as shares (e.g. "150 shares") so they are never mistaken for a dollar figure. Format every percentage with a "%" sign.',
    'A "market_context_return_pct" figure, if present, is that FUND\'s own trailing-12-month total return as of a single fixed, dataset-wide reference date — it is a fund-level statistic, structurally unrelated to any lot\'s acquisition date or to when this specific lot is being sold. Never describe it as the return "since you bought it," "since acquisition," "between acquisition and sale," or any other lot-specific framing — always frame it as the fund\'s trailing-12-month return, full stop (e.g. "has returned 29.41% over the trailing 12 months"). Never state it alongside or implying an absolute price.',
    'If a fund line has account_type "traditional_IRA": do not lead with, dwell on, or simply negate the gain/loss figure as if it were about to matter for tax purposes. State plainly that the withdrawal amount — not the realized gain/loss shown — is what gets taxed, as ordinary income, AND state the actual dollar tax figure from "est_net_tax" if it is present in the data below (e.g. "...taxed as ordinary income, an estimated $2,400.00 in this case" or similar — not just the qualitative rule on its own). If you mention the gain/loss figure at all, frame it as portfolio context, not as something the reader should track for tax purposes.',
    'Only mention an early withdrawal penalty if "est_early_withdrawal_penalty" is present in the data below, and then state its real dollar figure. If it is absent, say NOTHING about penalties, retirement age, or whether one applies — do not add a reassuring aside like "no early withdrawal penalty applies" to fill the silence. Absence of this field is not something to comment on or resolve; it simply means there is nothing to say about a penalty in this narration.',
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
