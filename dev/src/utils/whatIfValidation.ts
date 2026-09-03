/**
 * Feature 2's completeness/business-rule validator — see DECISIONS.md D052.
 *
 * This is the first place in the codebase either of these rules is actually
 * enforced: CostBasisDialog.tsx offers SpecID unconditionally regardless of
 * account type, and no UI or engine code guards a sell amount against the
 * fund's real balance before it reaches runOptimization(). Both checks are
 * built fresh here, not extracted from an existing implementation, because
 * no existing implementation exists.
 *
 * Called twice, deliberately: the prompt (whatIfPrompt.ts) instructs the
 * model to avoid all of this on its own, but a prompt instruction is not a
 * guarantee — this module is what actually enforces it in code, the same
 * way CD-4.2's boundary is architectural for narration, not just
 * conventional (CLAUDE.md §7).
 */

import type { WhatIfCandidate, PortfolioReferenceContext } from './whatIfShared'

export interface ValidationSuccess {
  valid: true
}

export interface ValidationFailure {
  valid: false
  /**
   * "refuse": a hard rule violation or a hallucinated reference — no amount
   * of follow-up fixes it, the request itself can't be fulfilled as stated.
   * "clarify": a fixable gap (e.g. an amount larger than the real balance)
   * — worth asking the user a direct follow-up question instead.
   */
  kind: 'refuse' | 'clarify'
  reason: string
}

export type ValidationResult = ValidationSuccess | ValidationFailure

// Tolerance for floating-point noise only (e.g. a balance computed as
// 84402.00000000001) — NOT a grace window for a genuine overage. Must stay
// well under one cent: at 0.01 this used to let a request exactly one cent
// over the real balance through uncaught ($84,402.01 vs. a $84,402.00
// balance: 84402.01 > 84402.00 + 0.01 is false), found via adversarial
// boundary testing — see DECISIONS.md D055.
const AMOUNT_EPSILON = 0.001

function formatUSD(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// D075 — closes the one CD-4.2 gap the original CD-1–CD-6 audit (D069)
// found: every other hard rule in this feature (SpecID/Traditional-IRA,
// amount-exceeds-balance) has a validator backing its prompt instruction;
// "never a numeric tax or gain estimate in the confirm summary"
// (whatIfPrompt.ts) previously had none — a prompt instruction alone is not
// treated as a guarantee anywhere else in this codebase, and this rule was
// the sole exception.
//
// Two designs were tried and rejected before this one, both live-caught by
// this file's own tests, not found live:
//   1. Ban the words "tax"/"gain"/etc. outright — flagged "MinTax" (a real,
//      expected cost-basis method name) as if it said "tax," since it
//      contains that literal substring.
//   2. Ban the *words* with word-boundary matching — fixed the MinTax false
//      positive, but then flagged a genuinely correct objective-shaped
//      summary ("Raise $20,000.00 optimizing for the lowest tax impact.")
//      because it legitimately names "tax" as the user's stated objective,
//      not as a computed estimate.
// What actually distinguishes a real violation: a computed *estimate* pairs
// a dollar/percent figure with one of these words, and that figure is one
// the model invented — not one the user (or the candidate itself) already
// stated. So this checks for a dollar figure that is BOTH (a) not among the
// candidate's own real, legitimate amounts (targetSaleAmount, each fund's
// sell_amount) and (b) sitting near one of these words in the text — the
// combination "a number nobody gave it, next to 'tax'/'gain'" is what a
// stated pre-computation estimate actually looks like; either signal alone
// produces exactly the two false positives above.
const FORBIDDEN_SUMMARY_TERMS = ['tax', 'gain', 'loss', 'harvest', 'saving']
const PROXIMITY_WINDOW = 40 // characters on each side of an unrecognized dollar figure

function legitimateAmounts(candidate: WhatIfCandidate): Set<string> {
  const amounts = new Set<string>()
  if (typeof candidate.targetSaleAmount === 'number') amounts.add(candidate.targetSaleAmount.toFixed(2))
  for (const fs of candidate.manualSelections?.fund_selections ?? []) {
    if (typeof fs.sell_amount === 'number') amounts.add(fs.sell_amount.toFixed(2))
  }
  return amounts
}

/**
 * Checks a confirm result's plain-language summary for language that
 * implies a computed figure — the CD-4.2 boundary applied to the one place
 * in this feature's response shape that's free text rather than structured
 * data. Called in addition to validateCandidate() for every "confirm"
 * result, never in place of it.
 */
export function validateSummary(summary: string, candidate: WhatIfCandidate): ValidationResult {
  const legit = legitimateAmounts(candidate)
  const dollarPattern = /\$([\d,]+(?:\.\d{1,2})?)/g
  let match: RegExpExecArray | null
  while ((match = dollarPattern.exec(summary))) {
    const normalized = parseFloat(match[1].replace(/,/g, '')).toFixed(2)
    if (legit.has(normalized)) continue // a real, user-given amount — fine to restate verbatim

    const windowStart = Math.max(0, match.index - PROXIMITY_WINDOW)
    const windowEnd = Math.min(summary.length, match.index + match[0].length + PROXIMITY_WINDOW)
    const window = summary.slice(windowStart, windowEnd)
    const nearbyForbidden = FORBIDDEN_SUMMARY_TERMS.some(term => new RegExp(`\\b${term}`, 'i').test(window))
    if (nearbyForbidden) {
      return {
        valid: false,
        kind: 'refuse',
        reason: 'That request could not be confirmed as described — please try rephrasing it.',
      }
    }
  }
  return { valid: true }
}

export function validateCandidate(candidate: WhatIfCandidate, reference: PortfolioReferenceContext): ValidationResult {
  // targetSaleAmount is only actually required for "automated" mode, where
  // it's the sole input the engine has to work with — there is no per-fund
  // breakdown yet, so an ambiguous or missing total genuinely can't be
  // resolved from anything else. It used to be checked here unconditionally,
  // before the mode branch below, which was a real bug (DECISIONS.md's
  // amount-rejection bug entry): for "manual" mode, every fund selection's
  // own sell_amount is independently validated further down (a specific,
  // positive number is already required per fund, or a real lot's share
  // count for SpecID) — targetSaleAmount adds no information a manual-mode
  // candidate doesn't already have to state on its own, and buildOptimization
  // ParamsFromCandidate()/runOptimization() never read it for manual mode
  // once every selection already has its own sell_amount, which the checks
  // below guarantee. The model was found, live, to inconsistently omit this
  // structurally-redundant top-level field for a fund-specific request —
  // reproduced in roughly half of real single-turn calls even though the
  // dollar amount was correctly present everywhere else (the request
  // payload, the fund's own sell_amount, and the summary text) — so
  // requiring it unconditionally rejected a genuinely complete, correct
  // candidate with a misleading "total sale amount" message about a field
  // the request never needed to state twice.
  if (candidate.mode === 'automated') {
    if (!Number.isFinite(candidate.targetSaleAmount) || candidate.targetSaleAmount <= 0) {
      return { valid: false, kind: 'clarify', reason: 'The total sale amount must be a specific positive dollar figure.' }
    }
    if (candidate.optimizationPriority !== 'tax-first' && candidate.optimizationPriority !== 'balance-first') {
      return { valid: false, kind: 'clarify', reason: 'An objective-driven request needs a priority — tax-first or balance-first.' }
    }
    return { valid: true }
  }

  // Manual mode — fund-specific.
  const selections = candidate.manualSelections?.fund_selections ?? []
  if (selections.length === 0) {
    return { valid: false, kind: 'clarify', reason: 'A fund-specific request needs at least one named fund to sell.' }
  }

  for (const sel of selections) {
    const fundRef = reference.funds.find(f => f.fund_id === sel.fund_id)
    if (!fundRef) {
      return { valid: false, kind: 'refuse', reason: `"${sel.fund_id}" is not a real holding in this account.` }
    }

    if (sel.accounting_method === 'specific_lot_identification') {
      // CLAUDE.md §5, binding: SpecID is not available for Traditional IRA.
      if (reference.account_type === 'traditional_IRA') {
        return {
          valid: false,
          kind: 'refuse',
          reason: 'Specific lot identification (SpecID) is not available for a Traditional IRA account.',
        }
      }
      const overrides = sel.lot_overrides ?? []
      if (overrides.length === 0) {
        return { valid: false, kind: 'clarify', reason: `Specific lot identification for "${sel.fund_id}" needs at least one lot named.` }
      }
      for (const o of overrides) {
        const lotRef = fundRef.lots.find(l => l.lot_id === o.lot_id)
        if (!lotRef) {
          return { valid: false, kind: 'refuse', reason: `Lot "${o.lot_id}" is not a real lot of "${sel.fund_id}".` }
        }
        if (!Number.isFinite(o.shares) || o.shares <= 0) {
          return { valid: false, kind: 'clarify', reason: `The share count for lot "${o.lot_id}" must be a specific positive number.` }
        }
        if (o.shares > lotRef.shares + AMOUNT_EPSILON) {
          return {
            valid: false,
            kind: 'clarify',
            reason: `Lot "${o.lot_id}" only has ${lotRef.shares} shares, but ${o.shares} were requested.`,
          }
        }
      }
      continue
    }

    if (typeof sel.sell_amount !== 'number') {
      return { valid: false, kind: 'clarify', reason: `The amount to sell from "${sel.fund_id}" was never specified.` }
    }
    if (!Number.isFinite(sel.sell_amount) || sel.sell_amount <= 0) {
      return { valid: false, kind: 'clarify', reason: `The amount to sell from "${sel.fund_id}" must be a specific positive dollar figure.` }
    }
    // The amount-exceeds-position-size catch (CLAUDE.md §12) — this must
    // never reach runOptimization(), which has no guard of its own.
    if (sel.sell_amount > fundRef.current_balance + AMOUNT_EPSILON) {
      return {
        valid: false,
        kind: 'clarify',
        reason: `Only ${formatUSD(fundRef.current_balance)} is actually held in "${sel.fund_id}", but ${formatUSD(sel.sell_amount)} was requested.`,
      }
    }
  }

  return { valid: true }
}
