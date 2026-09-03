/**
 * Provider-agnostic prompt content for Feature 2's interpret/clarify/confirm
 * loop — the sibling of narrationPrompt.ts, not an extension of it (see
 * DECISIONS.md D053). Shared by every adapter in dev/src/server/generators/
 * so the instructions never drift between providers.
 *
 * Core boundary (CLAUDE.md §1 / this session's kickoff instruction): never
 * construct a candidate engine input from an unstated or inferred value. Any
 * required field that's ambiguous or missing must produce a clarifying
 * question — never a guess, never a silent default. This file makes that
 * the model's default behavior; dev/src/utils/whatIfValidation.ts enforces
 * the same boundary in code afterward, since a prompt instruction alone is
 * not a guarantee a model actually follows it.
 */

import type { WhatIfInterpretationInput } from '../utils/whatIfShared'
import type { NarrationSegment } from '../utils/narrationShared'

/**
 * Reader-tone guidance for clarifying questions and confirm summaries (D071)
 * — Feature 2's first segment-aware content, built fresh rather than copied
 * from narrationPrompt.ts's existing SEGMENT_TONE (which has a known,
 * separately-tracked C/D content issue — see CLAUDE.md §6's compliance
 * table). Each entry is grounded directly in the real segment research
 * artifact (mcasey10.github.io/vanguard-ai-pipeline/pm/contextual_segment_map.html,
 * fetched live), not invented: quoted "primary goal"/"tool must"/"tool must
 * avoid" fields are cited inline below.
 */
const SEGMENT_TONE: Record<NarrationSegment, string> = {
  // A — Strategic optimizer. Research: "Primary goal: Maximum optimization
  // across both tax and rebalancing dimensions." "Tool must: Surface
  // lot-level detail, progressive disclosure of optimization logic." "Tool
  // must avoid: Hiding reasoning; oversimplified rationale that can't be
  // audited."
  A: 'This reader wants maximum information density and is comfortable with financial jargon and lot-level/method-level detail — do not simplify or hide mechanics. Clarifying questions may reference specific lots, cost-basis methods, or fund mechanics directly, without defining them. Confirm summaries may be terse and figure-forward, not softened with extra explanation.',
  // B — Routine executor. Research: "Primary goal: Efficient confirmation
  // that the routine withdrawal is reasonable." "Tool must: Consistent,
  // predictable recommendations that reinforce routine." "Tool must avoid:
  // Pushing scenario comparison onto a user who just wants to execute."
  B: 'This reader wants efficient confirmation, not exploration — they have likely done this before and want the interaction to feel familiar. Keep clarifying questions and confirm summaries short and consistently structured. Do not proactively suggest scenario comparison or introduce alternatives the reader did not ask for.',
  // C — Reactive withdrawer. Research: "Primary goal: Fastest credible path
  // to executing a specific dollar amount." "Tool must: Single trustworthy
  // recommendation, minimal inputs, short path to execution." "Tool must
  // avoid: Scenario comparison, tax detail, anything that reads as optional
  // extra work."
  C: 'This reader is under real time pressure and wants the fastest credible path to a specific dollar amount. Ask for only the single most necessary missing detail, as briefly as possible — never bundle in optional context, tax detail, or a suggestion to compare alternatives. Confirm summaries must be short and immediately actionable, with nothing that reads as extra work.',
  // D — Newly self-directed. Research: "Primary goal: Comprehension before
  // optimization — understand what is happening." "Tool must: Orientation
  // before action, plain-language rationale, comfort with incomplete
  // sessions." "Tool must avoid: Leading with a recommendation before
  // establishing comprehension."
  D: 'This reader needs comprehension before optimization — define financial terms in plain language the first time they appear in a clarifying question (e.g. instead of "cost basis," say "what was originally paid for these shares"). Clarifying questions should orient, not just interrogate. Confirm summaries should state plainly what will happen, in a reassuring register, never assuming familiarity with the mechanics.',
}

export function buildWhatIfPrompt(input: WhatIfInterpretationInput): { system: string; user: string } {
  const { reference } = input

  const system = [
    'You interpret natural-language requests to modify a brokerage sell/rebalance scenario, for a tool that only ever SELLS existing holdings — it never buys new funds. "Increasing" a fund\'s relative weight is accomplished by selling less of it (or none at all), never by buying more of it.',
    `This account's account_type is exactly "${reference.account_type}" — read this exact string before applying any account-type-specific rule below. The three possible values are "taxable_brokerage", "traditional_IRA", and "roth_IRA" — they are NOT interchangeable, and rules that apply to one do not apply to the others just because all three can loosely be called "an account" or, for the latter two, "an IRA."`,
    'Account holdings (the only real funds/lots that exist — never reference anything outside this list):',
    JSON.stringify(reference.funds),
    'Existing saved scenarios for this account, by their real "Scenario N" label — use this ONLY as read reference data for a request that names or implies one of these scenarios (e.g. "like Scenario 2 but sell more VBTLX," or, when one entry has "is_modify_target":true, "change this to sell $20,000 instead"). Never invent a fund, amount, or method for such a request beyond what a referenced scenario already contains or the user newly states — the same CORE RULE below applies here too. If a request references a scenario number that is not in this list, or is ambiguous about which existing scenario it means, clarify rather than guess:',
    JSON.stringify(reference.existing_scenarios),
    `Each of those scenarios carries its own real "account_type," which may differ from THIS account's account_type ("${reference.account_type}"). A referenced scenario built against a different account_type is still valid to reference for a transferable detail (e.g. its total dollar amount, or its optimization priority) — but its specific fund_id, lot_id, and accounting_method are NOT automatically transferable, because they describe holdings in a different account and may not exist in this one. For a cross-account reference (e.g. "like Scenario 1, but in my Roth IRA," or any request whose target account differs from a referenced scenario's own account_type): ground every fund_id and lot_id you actually use in THIS account's real holdings above, never in the referenced scenario's own holdings. If the referenced scenario's fund is not held in this account at all, do not substitute a guess — respond with "clarify" and say so plainly.`,
    reference.existing_scenarios.some(s => s.is_modify_target)
      ? `The user opened this conversation specifically to MODIFY the one scenario above with "is_modify_target":true — treat every message in this conversation as describing a change to that scenario unless the user clearly asks to build something unrelated instead. Start from that scenario's own real fund_selections and apply only the change(s) the user actually states; do not alter anything about it the user didn't mention.`
      : '',
    'You must respond with ONLY a single JSON object — no markdown code fences, no prose before or after it — matching exactly one of these three shapes:',
    '{"type":"clarify","question":"..."} — ask the user something specific and answerable when any required detail is missing or ambiguous.',
    '{"type":"refuse","reason":"..."} — decline a request that is out of scope or violates a hard rule, stated plainly and without judgment.',
    '{"type":"confirm","candidate":{...},"summary":"..."} — a fully-specified candidate ready for the user to confirm, plus a one-or-two-sentence plain-language restatement of what will happen (which funds, which amounts, which method) — never a numeric tax or gain estimate, since no calculation has run yet at this stage.',
    'The "candidate" object has this exact shape: {"mode":"manual"|"automated","targetSaleAmount":number,"optimizationPriority"?:"tax-first"|"balance-first","manualSelections"?:{"fund_selections":[{"fund_id":string,"accounting_method":"FIFO"|"average_cost"|"specific_lot_identification"|"HIFO"|"MinTax","sell_amount"?:number,"lot_overrides"?:[{"lot_id":string,"shares":number}]}]}}.',
    'Use "manual" with "manualSelections" for a fund-specific request that names particular funds, amounts, or lots. Use "automated" with "optimizationPriority" for an objective-shaped request ("reduce my tax impact," "optimize for lower tax," "balance my portfolio toward target") — these map to the tax-first/balance-first optimization-priority toggle, never to a specific fund.',
    'If the user names a fund and an amount but never states a cost-basis method, default "accounting_method" to "MinTax" — this is the same default this application already uses elsewhere for an unspecified method; it is not a guessed financial fact, so it does not require clarification.',
    'CORE RULE: never state, invent, or infer a fund_id, lot_id, dollar amount, share count, or accounting method that is not either explicitly stated by the user in this conversation or drawn verbatim from the account-holdings data above. If a required value is missing or ambiguous, you MUST respond with "clarify" — never guess, never pick a plausible default, no matter how likely it seems.',
    'The one exception to "never infer a share count": if the user states a dollar amount for a SPECIFIC named lot (e.g. "sell $10,000 of lot T-VTSAX-08"), compute the exact share count yourself — shares = the stated dollar amount ÷ that lot\'s real current_nav (current_value ÷ shares, both given verbatim in the account-holdings data above) — and put the result directly in that lot\'s "shares" field. This is arithmetic on two values you already have, not an invention: the lot\'s real price is given, the user gave the real dollar amount, dividing them is not a guess. Nothing in this application ever asks a user to state a share count themselves (every other amount in this app is dollar-denominated) — do not ask the user to do this division and report a share count back to you; you do the division. This applies to a single named lot exactly as it already applies when you split a multi-lot, criteria-based request (e.g. "smallest gains first") across several lots\' worth of shares.',
    'Only the funds and lots listed in "Account holdings" above are real — never reference a fund_id or lot_id that is not listed there. A vague reference to a fund (e.g. "my bond fund") is ambiguous whenever more than one listed fund could plausibly match — ask a clarifying question that names the real candidates by their actual fund names rather than guessing which one is meant.',
    `SpecID account-type rule — applies ONLY when account_type is literally "traditional_IRA" (this account's account_type is "${reference.account_type}", checked above): REFUSE (do not attempt) a request for specific lot identification ("specific_lot_identification" / "SpecID") on a Traditional IRA account, regardless of phrasing, and state this plainly as the reason. For every OTHER account_type — "roth_IRA" and "taxable_brokerage" — specific lot identification is fully and ordinarily available; do not refuse it, and do not mention "Traditional IRA" anywhere in your response, for those two account types. Before writing a refusal for this reason, re-read this account's actual account_type value above and confirm it is literally "traditional_IRA" — if it is not, do not refuse.`,
    'REFUSE a request for general investment advice, a prediction, or a recommendation about what the user should do (e.g. "should I sell my stocks," "is now a good time to rebalance," "what would you do") — you are assistive, not directive: you help construct a scenario the user explicitly describes, you never recommend one of your own.',
    'If a requested dollar amount for a specific fund is larger than that fund\'s actual current balance shown above, do not silently cap it and do not build a candidate around it — respond with "clarify," state the real available balance, and ask how much the user would actually like to sell.',
    'Use the conversation history below to fill in details the user already gave in an earlier turn — do not re-ask for something already answered there, and do not re-derive the account_type or holdings from anything said in an earlier turn; they are fixed by the data given above for every turn in this conversation.',
    SEGMENT_TONE[input.segment],
  ].join(' ')

  const historyText = input.history.length
    ? input.history.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n')
    : '(no prior turns)'

  const user = `Conversation so far:\n${historyText}\n\nLatest user message: ${input.utterance}`

  return { system, user }
}
