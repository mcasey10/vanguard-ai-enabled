/**
 * Narration layer tests — dev/src/utils/narration.test.ts
 *
 * Covers all 11 categories in CLAUDE.md §12's "Narration (Feature 1)" list.
 * Every fixture below is built by calling the REAL engine (runOptimization)
 * and, for the two scenario-touchpoint categories, the REAL scenario
 * builders (buildScenarioFromFundResults) — the exact same code the live
 * touchpoints use to build narration input. Earlier versions of this file
 * hand-typed FundSaleResult/SavedScenario objects with guessed defaults
 * (accounting_method: 'FIFO', est_tax_gross: 0), which silently produced
 * zeroed tax figures and a wrong cost-basis method in every sample — see
 * DECISIONS.md D044 for the full diagnosis. No fixture below invents a
 * figure; every number comes from the real engine given real dataset
 * lots (via loadPortfolio()/getMarketContextData()).
 *
 * The live provider call is mocked, never hit (CLAUDE.md §7) — tests mock
 * at the fetch/HTTP boundary (client → /api/narrate), which is inherently
 * provider-agnostic (DECISIONS.md D042), not at any specific provider's
 * SDK or endpoint.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadPortfolio, getMarketContextData } from '../data/loader'
import {
  buildDeterministicFallback, isMarketContextExcluded, buildMarketContext,
  type NarrationInput,
} from './narrationShared'
import {
  buildFundResultNarrationInput, buildScenarioNarrationInput,
} from './narrationBuilders'
import { runOptimization, type ManualSelections } from '../engine/index'
import { buildScenarioFromFundResults } from './scenarioBuilder'
import { taxFigureToNumber } from './format'
import type { FundSaleResult, ManualConfiguration, Recommendation } from '../types'

const portfolio = loadPortfolio()
const { trailing_12mo_return, market_context_exclusions } = getMarketContextData()
const TAX_RATES = { st_rate: 0.24, lt_rate: 0.15 }
const TAXABLE = 'ACCT-TAXABLE-001'
const TRAD_IRA = 'ACCT-TRAD-IRA-001'
const ROTH_IRA = 'ACCT-ROTH-IRA-001'

function findLot(fundId: string, lotId: string) {
  for (const acct of portfolio.accounts) {
    const h = acct.holdings.find(h => h.fund_id === fundId)
    const lot = h?.lots.find(l => l.lot_id === lotId)
    if (lot) return lot
  }
  throw new Error(`fixture lot not found: ${fundId}/${lotId}`)
}

/** Real engine call, manual mode. Used directly by tests that need the raw FundSaleResult[] or the ManualConfiguration (for its real allocation_impact). */
function manualRun(accountId: string, targetSaleAmount: number, selections: ManualSelections): ManualConfiguration {
  return runOptimization({
    portfolio, targetSaleAmount, activeAccountId: accountId, mode: 'manual',
    optimizationPriority: 'tax-first', activeTaxRates: TAX_RATES, manualSelections: selections,
  }) as ManualConfiguration
}

/** Real engine call, automated mode — for categories that specifically need automated-mode-only behavior (Wait & Save notices). */
function automatedRun(accountId: string, targetSaleAmount: number, priority: 'tax-first' | 'balance-first' = 'tax-first'): Recommendation {
  return runOptimization({
    portfolio, targetSaleAmount, activeAccountId: accountId, mode: 'automated',
    optimizationPriority: priority, activeTaxRates: TAX_RATES,
  }) as Recommendation
}

/** Sells one specific real lot in full via the real engine (manual mode, SpecID) — deterministic, real tax/gain figures, for tests that need one exact named lot. */
function realFundResultForLot(accountId: string, fundId: string, lotId: string): FundSaleResult {
  const lot = findLot(fundId, lotId)
  const config = manualRun(accountId, lot.current_value, {
    fund_selections: [{ fund_id: fundId, accounting_method: 'specific_lot_identification', lot_overrides: [{ lot_id: lotId, shares: lot.shares }] }],
  })
  const fr = config.fund_results.find(f => f.fund_id === fundId)
  if (!fr) throw new Error(`realFundResultForLot: no fund result for ${fundId}/${lotId}`)
  return fr
}

describe('narration coverage categories (CLAUDE.md §12)', () => {
  // 1. Pure gain — T-VTSAX-08, real engine call (manual, MinTax, $5,000), real
  // non-zero tax ($105.78) — not the hand-typed est_tax_gross:0 this test used to have.
  test('1. pure gain', () => {
    const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
    const input = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    expect(input.funds[0].accounting_method).toBe('MinTax')
    expect(input.funds[0].st_gain_loss).toBeGreaterThan(0)
    expect(input.funds[0].lt_gain_loss).toBe(0)
    expect(input.funds[0].est_tax_gross).toBeGreaterThan(0) // the tier-1 regression check for this category specifically
    const text = buildDeterministicFallback(input)
    expect(text).toMatch(/gain of \$\d/)
    expect(text).not.toMatch(/loss/i)
  })

  // 2. Pure loss-harvest — VBTLX, real engine call ($3,000 MinTax). est_tax_gross
  // is correctly $0 here BY DESIGN (a pure loss has no positive gross tax at the
  // per-fund level in this engine — see engine/index.ts buildFundResult) — this
  // is real, verified engine behavior, not the same bug as category 1's zeroing.
  test('2. pure loss-harvest', () => {
    const config = manualRun(TAXABLE, 3000, { fund_selections: [{ fund_id: 'VBTLX', accounting_method: 'MinTax', sell_amount: 3000 }] })
    const input = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    expect(input.funds[0].lt_gain_loss).toBeLessThan(0)
    expect(input.funds[0].est_tax_gross).toBe(0) // correct-by-design for a pure loss, confirmed against engine source
    const text = buildDeterministicFallback(input)
    expect(text).toMatch(/loss of \$\d/)
  })

  // 3. Mixed gain+harvest — VTSAX gain + VBTLX loss, both real engine calls in one transaction
  test('3. mixed gain + harvest', () => {
    const config = manualRun(TAXABLE, 8000, { fund_selections: [
      { fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 },
      { fund_id: 'VBTLX', accounting_method: 'MinTax', sell_amount: 3000 },
    ] })
    const input = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    expect(input.funds).toHaveLength(2)
    const gainFund = input.funds.find(f => f.fund_id === 'VTSAX')!
    const lossFund = input.funds.find(f => f.fund_id === 'VBTLX')!
    expect(gainFund.st_gain_loss).toBeGreaterThan(0)
    expect(gainFund.est_tax_gross).toBeGreaterThan(0)
    expect(lossFund.lt_gain_loss).toBeLessThan(0)
  })

  // 4. ST-LT crossing — real large MinTax sale from VTSAX taxable, forces both
  // periods to be realized simultaneously (real engine output, not hardcoded aggregates)
  test('4. ST-LT crossing (one fund, both periods realized)', () => {
    const config = manualRun(TAXABLE, 100000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 100000 }] })
    const input = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    expect(input.funds[0].st_gain_loss).toBeGreaterThan(0)
    expect(input.funds[0].lt_gain_loss).toBeGreaterThan(0)
    expect(input.funds[0].est_tax_gross).toBeGreaterThan(0)
  })

  // 5. Traditional IRA ordinary-income framing — IRA-VFITX-05, real gain lot via
  // SpecID (MinTax on this fund picks a different, loss lot instead — verified
  // directly — which would conflate this category with loss-harvest).
  test('5. Traditional IRA ordinary-income framing', () => {
    const fr = realFundResultForLot(TRAD_IRA, 'VFITX', 'IRA-VFITX-05')
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'traditional_IRA', segment: 'A' })
    expect(input.funds[0].account_type).toBe('traditional_IRA')
    expect(input.funds[0].lt_gain_loss).toBeGreaterThan(0)
    expect(input.funds[0].est_tax_gross).toBe(0) // correct-by-design for IRA — ordinary income on withdrawal, not captured here
    const text = buildDeterministicFallback(input)
    expect(text).toMatch(/ordinary income/i)
  })

  // 6. Allocation toward-target — real manual sale of ONLY the overweight equity
  // fund (VTSAX), built through the real scenario builder (buildScenarioFromFundResults).
  // Verified this moves toward target (distance-to-target sum decreases); an
  // automated tax-first run that also sold underweight VBTLX made it worse, not
  // better — that combination is deliberately not used here.
  test('6. allocation toward-target', () => {
    const config = manualRun(TAXABLE, 30000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 30000 }] })
    const scenario = buildScenarioFromFundResults(config.fund_results, portfolio, TAX_RATES, config.allocation_impact, TAXABLE)
    expect(scenario).not.toBeNull()
    const input = buildScenarioNarrationInput({ scenario: scenario!, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const before = distanceFromTarget(input.allocation_impact!.before)
    const after = distanceFromTarget(input.allocation_impact!.after)
    expect(after).toBeLessThan(before)
    expect(input.est_net_tax).toBeGreaterThan(0)
  })

  // 7. Allocation away-from-target — real manual sale of ONLY the underweight
  // bond fund (VBTLX). This is a real, supported Manual-mode path (a user can
  // select any fund, not just the balance-optimal one) — verified this moves
  // away from target (distance-to-target sum increases).
  test('7. allocation away-from-target', () => {
    const config = manualRun(TAXABLE, 20000, { fund_selections: [{ fund_id: 'VBTLX', accounting_method: 'MinTax', sell_amount: 20000 }] })
    const scenario = buildScenarioFromFundResults(config.fund_results, portfolio, TAX_RATES, config.allocation_impact, TAXABLE)
    expect(scenario).not.toBeNull()
    const input = buildScenarioNarrationInput({ scenario: scenario!, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const before = distanceFromTarget(input.allocation_impact!.before)
    const after = distanceFromTarget(input.allocation_impact!.after)
    expect(after).toBeGreaterThan(before)
  })

  // 8. Wait & Save triggered — real automated run (balance-first, $350,000 —
  // verified via a parameter sweep that smaller amounts / tax-first priority
  // never touch VTIAX at all, leaving wait_and_save_notices empty).
  test('8. Wait & Save triggered', () => {
    const rec = automatedRun(TAXABLE, 350000, 'balance-first')
    expect(rec.wait_and_save_notices.length).toBeGreaterThan(0)
    const notice = rec.wait_and_save_notices.find(n => n.fund_id === 'VTIAX')
    expect(notice).toBeDefined()
    expect(notice!.days_until_lt).toBeLessThanOrEqual(30)
    const input = buildFundResultNarrationInput({
      fundResults: rec.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A',
      est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
      wait_and_save_notices: rec.wait_and_save_notices.map(n => ({ fund_id: n.fund_id, lot_id: n.lot_id, days_until_lt: n.days_until_lt, tax_savings_by_waiting: n.tax_savings_by_waiting })),
    })
    const text = buildDeterministicFallback(input)
    expect(text).toMatch(new RegExp(`${notice!.days_until_lt} more day`))
  })

  // Multi-fund (3+) aggregation — closes the gap flagged in CLAUDE.md §12 / DECISIONS.md
  // D048: this category was in D032's original plan but never had its own dedicated
  // test. Reuses category 8's exact real fixture (automated, balance-first, $350,000 —
  // a real 4-fund transaction: VTSAX, VTIAX, VBTLX, VBIRX) rather than building new
  // fixture data, per instruction — it already exercises this case.
  //
  // Boundary note on what's asserted here vs. not: the *input* going into the prompt
  // (all four funds' figures correctly separated, attributed, and aggregated) is
  // fully deterministic real-engine output, so it's asserted directly and exactly.
  // Whether the *live model's generated prose* actually renders as four separate
  // sentences (D047's fix) is NOT re-asserted here with a live API call or an exact
  // wording match — this suite has never made live provider calls (CLAUDE.md §7,
  // D038 rule 4, D042: tests mock at the interface/HTTP boundary, no live network
  // dependency), and prose wording can legitimately vary run to run even with the
  // same instruction. That empirical check was already done manually against real
  // Gemini output in D047 (docs/narration-review-sample.md's category 8). What IS
  // asserted here, as the code-level guarantee that D047's fix actually applies to
  // THIS multi-fund input, is that buildNarrationPrompt()'s system prompt for this
  // fixture's segment contains the per-fund structural instruction verbatim.
  describe('multi-fund (3+) aggregation', () => {
    function fourFundResult() {
      return automatedRun(TAXABLE, 350000, 'balance-first')
    }

    test('all 3+ funds are present with figures correctly attributed — no merging or cross-contamination', () => {
      const rec = fourFundResult()
      expect(rec.fund_results.length).toBeGreaterThanOrEqual(3) // sanity: this really is a 3+ fund fixture
      const input = buildFundResultNarrationInput({
        fundResults: rec.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A',
        est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
      })
      expect(input.funds).toHaveLength(rec.fund_results.length)

      // Every real fund's figures must land on that same fund in the narration
      // input, unchanged — not merged into another fund's line, not summed
      // together, not dropped.
      for (const fr of rec.fund_results) {
        const line = input.funds.find(f => f.fund_id === fr.fund_id)
        expect(line, `narration input is missing fund ${fr.fund_id}`).toBeDefined()
        expect(line!.st_gain_loss).toBe(fr.est_st_gain_loss)
        expect(line!.lt_gain_loss).toBe(fr.est_lt_gain_loss)
        expect(line!.est_tax_gross).toBe(fr.est_tax_gross)
        expect(line!.impact_pct).toBe(fr.impact_pct)
        expect(line!.accounting_method).toBe(fr.accounting_method)
      }

      // Cross-contamination check: no two funds should have been given each
      // other's figures. Real fixture data happens to make every fund's
      // st_gain_loss distinct, so exact-value collisions across funds would
      // indicate a mix-up rather than coincidence.
      const stGainValues = input.funds.map(f => f.st_gain_loss)
      expect(new Set(stGainValues).size).toBe(stGainValues.length)
    })

    test('aggregate figures (net tax, effective rate, losses harvested) are computed across all funds, not just per-fund', () => {
      const rec = fourFundResult()
      const input = buildFundResultNarrationInput({
        fundResults: rec.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A',
        est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
      })

      // est_net_tax/effective_rate: real portfolio-level netted figures from the
      // engine, not a naive sum of each fund's own est_tax_gross (which would
      // double-count/miss the cross-fund netting the engine already did).
      // effective_rate specifically: rec.effective_rate is stored as a raw
      // fraction (e.g. 0.0044 for 0.44%) — the builder converts it to a real
      // percentage before it reaches NarrationInput (see DECISIONS.md's
      // effective-rate/target-match entry). Asserting input.effective_rate
      // equals the raw fraction unconverted (the pre-fix behavior) is exactly
      // the "0.00% effective rate" bug this test would previously have
      // encoded as correct rather than caught.
      expect(input.est_net_tax).toBe(rec.est_net_tax)
      expect(input.effective_rate).toBeCloseTo(rec.effective_rate * 100, 6)
      const sumOfPerFundTax = rec.fund_results.reduce((s, fr) => s + taxFigureToNumber(fr.est_tax_gross), 0)
      expect(input.est_net_tax).not.toBe(sumOfPerFundTax) // sanity: netting actually changes the figure for this fixture

      // losses_harvested: real sum of every fund's own net loss (funds with a
      // net gain contribute 0, not a negative offset) — computed independently
      // here from the same real per-fund figures the input was built from, not
      // copied from the builder's own logic.
      const expectedLossesHarvested = rec.fund_results.reduce((s, fr) => s + Math.min(0, fr.est_st_gain_loss + fr.est_lt_gain_loss), 0)
      expect(input.losses_harvested).toBeCloseTo(expectedLossesHarvested, 2)
      expect(rec.fund_results.some(fr => fr.est_st_gain_loss + fr.est_lt_gain_loss < 0)).toBe(true) // sanity: at least one real fund contributes a loss in this fixture
    })

    test('the per-fund structural instruction (D047) is present in the prompt for this multi-fund input', async () => {
      const { buildNarrationPrompt } = await import('../server/narrationPrompt')
      const rec = fourFundResult()
      const input = buildFundResultNarrationInput({
        fundResults: rec.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A',
        est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
      })
      const { system } = buildNarrationPrompt(input)
      expect(system).toMatch(/ONE short sentence PER FUND/)
      expect(system).toMatch(/A four-fund transaction gets four short sentences/)
      // Real generated output for this exact fixture already confirmed to
      // actually render as four separate sentences — see D047 /
      // docs/narration-review-sample.md category 8.
    })
  })

  // 9. SpecID lot-level active — ROTH-VFIAX-07, real engine call, specific_lot_identification
  test('9. SpecID lot-level active', () => {
    const fr = realFundResultForLot(ROTH_IRA, 'VFIAX', 'ROTH-VFIAX-07')
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'roth_IRA', segment: 'A' })
    expect(input.funds[0].accounting_method).toBe('specific_lot_identification')
    expect(input.funds[0].lots).toHaveLength(1)
    expect(input.funds[0].lots![0].lot_id).toBe('ROTH-VFIAX-07')
    expect(input.funds[0].lots![0].acquisition_date).toBe('2025-11-10') // real value, looked up not invented
    expect(input.funds[0].st_gain_loss).toBeGreaterThan(0)
    expect(input.funds[0].est_tax_gross).toBe(0) // correct-by-design for Roth — tax-free
  })

  // 10. Same figures across two segment tones — the prompt's figures (user
  // message) must be identical while the tone guidance (system message)
  // differs, proving segment affects only tone, never content.
  test('10. same figures across two segment tones', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
    const inputA = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const inputB: NarrationInput = { ...inputA, segment: 'B' }
    const promptA = buildNarrationPrompt(inputA)
    const promptB = buildNarrationPrompt(inputB)
    expect(promptA.user).toBe(promptB.user) // same figures
    expect(promptA.system).not.toBe(promptB.system) // different tone guidance
  })

  // D074 — closes the D069-flagged gap: Segments C and D had never been
  // exercised by this suite at all, which is exactly how the cross-wired
  // content went unnoticed. Same figures-vs-tone split as category 10,
  // extended to all four segments, plus content assertions tying each
  // segment's real tone directly back to segmentResearch.ts's own exported
  // fields — the actual shared source this prompt now reads from, not just
  // a paraphrase that happens to currently agree with it.
  test('D074: all four segments produce identical figures but four genuinely distinct tone instructions', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
    const base = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const prompts = (['A', 'B', 'C', 'D'] as const).map(segment => buildNarrationPrompt({ ...base, segment }))
    expect(new Set(prompts.map(p => p.user)).size).toBe(1)
    expect(new Set(prompts.map(p => p.system)).size).toBe(4)
  })

  test('D074: Segment C tone instructs the shortest possible phrasing and is built from segmentResearch.ts\'s own real quoted goal, not a re-typed copy', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const { SEGMENT_PROFILES } = await import('./segmentResearch')
    const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
    const input = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'C' })
    const { system } = buildNarrationPrompt(input)
    expect(system).toMatch(/shortest possible phrasing/i)
    expect(system).toContain(SEGMENT_PROFILES.C.goal) // the literal shared string, not a paraphrase
    expect(system).toContain(SEGMENT_PROFILES.C.toolMustAvoid)
  })

  // DECISIONS.md's Segment C content-rules entry: a style-only "be terse"
  // instruction was not enough on its own — real generated output was
  // technically shorter than Segment D's but still included the ST/LT
  // breakdown and all four per-asset allocation percentages, exactly the
  // "tax detail"/"optional extra work" this segment's own research says to
  // avoid. Two explicit content rules replace the style-only guidance.
  test('Segment C prompt states two explicit content rules — never a separate ST/LT breakdown, never per-asset allocation percentages', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
    const input = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'C' })
    const { system } = buildNarrationPrompt(input)
    expect(system).toMatch(/never state the short-term and long-term gain\/loss breakdown separately/i)
    expect(system).toMatch(/state only the single net tax figure/i)
    expect(system).toMatch(/never state per-asset-class allocation percentage shifts/i)
  })

  // Segment C's own example-anchoring bug (cc-prompt-test-segment-c-anchoring.md):
  // the prompt used to carry exactly one worked example, and its figures were
  // identical to this project's own canonical test scenario ($15,000 VTSAX +
  // $10,000 VBTLX = $64.85) — so a live generation for that exact scenario came
  // back byte-identical to the example, and real generations for genuinely
  // different transactions (different funds, different amounts) still echoed
  // its "comes to an estimated net tax of $X" phrasing in 4 of 5 real calls.
  // The same failure shape D113 found for Segment D, never checked for C.
  // Also found in the process: the original example never actually led with
  // the tax figure despite the instruction literally saying to — no real
  // output ever front-loaded the figure until the example was fixed to match
  // its own instruction. Multiple example-based fixes were tried (two examples,
  // three examples, an example plus a negative counter-example); each one the
  // model settled into rotating through the provided example(s) rather than
  // genuinely varying, so the final fix removes quoted example sentences
  // entirely in favor of abstract, non-copyable rules — re-verified with real
  // output across five different transactions (single-fund and multi-fund,
  // funds/amounts never used in the old example) plus a re-run of the
  // canonical fixture: every real response front-loaded the dollar figure,
  // held both content bans, and varied in actual sentence structure rather
  // than reading as the same sentence with the numbers swapped.
  test('Segment C prompt has no quoted example sentence left to anchor on, and instructs front-loading + genuine variation instead', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
    const input = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'C' })
    const { system } = buildNarrationPrompt(input)
    expect(system).toMatch(/as the very first word or clause of your sentence/i)
    expect(system).toMatch(/should not read as the same sentence with the numbers swapped/i)
    expect(system).toMatch(/do not add a trailing clause explaining what the sale accomplishes/i)
    // The old single canonical example is gone entirely, not just relabeled —
    // and no replacement quoted example sentence was added in its place either
    // (every fix attempt that kept ANY quoted example, even a negative one,
    // was itself echoed verbatim by real output during this investigation).
    expect(system).not.toContain('Selling $15,000 of VTSAX and $10,000 of VBTLX comes to an estimated net tax of $64.85')
    expect(system).not.toMatch(/\$210\.40|\$340\.00|\$115\.20 tax would apply to selling/) // no leftover quoted example from an earlier fix attempt
  })

  test('D074: Segment D tone instructs plain-language jargon definitions and is built from segmentResearch.ts\'s own real quoted goal, not a re-typed copy', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const { SEGMENT_PROFILES } = await import('./segmentResearch')
    const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
    const input = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'D' })
    const { system } = buildNarrationPrompt(input)
    expect(system).toMatch(/plain[- ]language/i)
    expect(system).toMatch(/cost basis/i) // the real worked example
    expect(system).toContain(SEGMENT_PROFILES.D.goal) // the literal shared string, not a paraphrase
  })

  // Real generated output (read cold, cc-prompt-fix-segment-d-consistency.md)
  // showed Segment D's orientation-before-specifics rule was being honored
  // inconsistently: correct at Scenario Analysis/Order Confirmation, absent
  // at Fund Selection's per-fund rows and at Execution Summary (the latter
  // never previously checked). SEGMENT_TONE.D is one shared instruction
  // (not duplicated per touchpoint — confirmed by inspecting
  // narrationPrompt.ts directly), so the fix tightens that one shared string
  // rather than reconciling drifted copies. It also finally references
  // SEGMENT_PROFILES.D.toolMust ("Orientation before action...") — a real
  // research field that existed all along but was never actually
  // interpolated into the prompt, only .goal and .toolMustAvoid were.
  test('Segment D prompt explicitly requires orientation before any specific fund/dollar figure, identically across a per-fund (Fund Selection) input and a past-tense (Execution Summary) input', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const { SEGMENT_PROFILES } = await import('./segmentResearch')
    const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
    const perFundInput = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'D' })
    const pastTenseInput: NarrationInput = { ...perFundInput, touchpoint: 'execution_summary_narrative', tense: 'past' }
    for (const input of [perFundInput, pastTenseInput]) {
      const { system } = buildNarrationPrompt(input)
      expect(system).toContain(SEGMENT_PROFILES.D.toolMust) // "Orientation before action..." — real research, now actually used
      expect(system).toMatch(/FIRST sentence must orient the reader/i)
      expect(system).toMatch(/never open with "Selling \$X.*or "Sold \$X.*regardless of tense/i)
    }
  })

  // D112's own fix (the orientation rule above) was itself re-checked with
  // real output — read cold, cc-prompt-verify-segment-d-variation.md — across
  // three genuinely different transactions (single-fund, a different fund
  // pairing, different dollar amounts, funds never used in D112's own
  // fixture). Structurally correct (every real output still oriented before
  // stating specifics) but nearly every prospective-tense opening was a
  // close paraphrase of the SAME single example sentence D112 had added —
  // the model was echoing the example's specific wording, not just its
  // pattern. Fixed by replacing the one canonical example per tense with two
  // deliberately differently-worded ones, explicitly labeled as illustrative
  // rather than a template, plus an explicit instruction to vary wording
  // rather than default to a fixed opening phrase.
  test('Segment D prompt instructs varied wording for the orienting sentence rather than a single fixed example to echo', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
    const input = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'D' })
    const { system } = buildNarrationPrompt(input)
    expect(system).toMatch(/vary the wording/i)
    expect(system).toMatch(/not a template to copy verbatim/i)
    // Two distinct example openings per tense, not one — the D112-era single
    // canonical sentence ("You're looking at a plan to sell part of two of
    // your investments to raise cash") is gone entirely, not just relabeled.
    expect(system).not.toContain("You're looking at a plan to sell part of two of your investments to raise cash")
  })

  // 11. Market-context exclusion-check mechanism — tests the mechanism
  // itself (does the code consult market_context_exclusions), not just that
  // the one hardcoded VFITX case happens to render correctly.
  describe('11. market-context exclusion-check mechanism', () => {
    test('the real exclusion (VFITX / IRA-VFITX-06) is present in the dataset', () => {
      expect(market_context_exclusions.some(e => e.fund === 'VFITX' && e.lot_id === 'IRA-VFITX-06')).toBe(true)
    })

    test('excludes market context for the excluded fund/lot pairing', () => {
      const excluded = isMarketContextExcluded('VFITX', ['IRA-VFITX-06'], market_context_exclusions)
      expect(excluded).toBe(true)
      const value = buildMarketContext('VFITX', ['IRA-VFITX-06'], trailing_12mo_return, market_context_exclusions)
      expect(value).toBeUndefined()
    })

    test('does NOT exclude the same fund when a different, non-excluded lot is involved', () => {
      const excluded = isMarketContextExcluded('VFITX', ['IRA-VFITX-02'], market_context_exclusions)
      expect(excluded).toBe(false)
      const value = buildMarketContext('VFITX', ['IRA-VFITX-02'], trailing_12mo_return, market_context_exclusions)
      expect(value).toBe(trailing_12mo_return.VFITX) // real, sourced figure (+5.48 per DECISIONS.md D037)
      expect(value).toBeGreaterThan(0)
    })

    test('a fund with no exclusion entries is never excluded', () => {
      expect(isMarketContextExcluded('VTSAX', ['T-VTSAX-08'], market_context_exclusions)).toBe(false)
      const value = buildMarketContext('VTSAX', ['T-VTSAX-08'], trailing_12mo_return, market_context_exclusions)
      expect(value).toBe(trailing_12mo_return.VTSAX)
    })

    test('end-to-end through the builder: the excluded lot never carries market_context_return_pct', () => {
      const fr = realFundResultForLot(TRAD_IRA, 'VFITX', 'IRA-VFITX-06')
      const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'traditional_IRA', segment: 'A' })
      expect(input.funds[0].market_context_return_pct).toBeUndefined()
      const text = buildDeterministicFallback(input)
      expect(text).not.toMatch(/trailing 12 months/)
    })

    test('end-to-end through the builder: a non-excluded VFITX lot DOES carry it', () => {
      const fr = realFundResultForLot(TRAD_IRA, 'VFITX', 'IRA-VFITX-02')
      const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'traditional_IRA', segment: 'A' })
      expect(input.funds[0].market_context_return_pct).toBe(trailing_12mo_return.VFITX)
      const text = buildDeterministicFallback(input)
      expect(text).toMatch(/trailing 12 months/)
    })
  })
})

// ---------------------------------------------------------------------------
// 13/14. Traditional IRA real ordinary-income tax figure + early-withdrawal-
// penalty omission (DECISIONS.md's IRA narration entry). Real automated
// engine call against ACCT-TRAD-IRA-001 — est_net_tax is now a real,
// correctly-computed number (D083/D084), not the pre-D083 always-$0 figure
// category 5's own fixture predates.
// ---------------------------------------------------------------------------

describe('13. Traditional IRA with a real computed ordinary income tax figure', () => {
  const rec = automatedRun(TRAD_IRA, 10000)

  test('sanity: this fixture genuinely has a real, nonzero ordinary income tax — $10,000 × 24% = $2,400', () => {
    expect(rec.est_net_tax).toBeCloseTo(2400, 2)
  })

  test('the narration input actually carries the real figure through, not the pre-D083 $0', () => {
    const input = buildFundResultNarrationInput({
      fundResults: rec.fund_results, portfolio, accountType: 'traditional_IRA', segment: 'A',
      est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
    })
    expect(input.est_net_tax).toBeCloseTo(2400, 2)
  })

  test('the deterministic fallback states both the qualitative rule AND the real dollar figure', () => {
    const input = buildFundResultNarrationInput({
      fundResults: rec.fund_results, portfolio, accountType: 'traditional_IRA', segment: 'A',
      est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
    })
    const text = buildDeterministicFallback(input)
    expect(text).toMatch(/ordinary income/i)
    expect(text).toMatch(/\$2,400\.00/)
  })

  test('the prompt instructs the model to state the actual dollar tax figure, not just the qualitative rule alone', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const input = buildFundResultNarrationInput({
      fundResults: rec.fund_results, portfolio, accountType: 'traditional_IRA', segment: 'A',
      est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
    })
    const { system } = buildNarrationPrompt(input)
    expect(system).toMatch(/est_net_tax/)
    expect(system).toMatch(/actual dollar tax figure/i)
  })
})

describe('14. Traditional IRA narration correctly omits the early withdrawal penalty when not applicable', () => {
  const rec = automatedRun(TRAD_IRA, 10000)

  test('a real engine Recommendation genuinely carries the not_applicable sentinel, not a number', () => {
    expect(rec.est_early_withdrawal_penalty).toBe('not_applicable')
  })

  test('the narration input omits the field entirely (undefined) rather than passing the sentinel through', () => {
    const input = buildFundResultNarrationInput({
      fundResults: rec.fund_results, portfolio, accountType: 'traditional_IRA', segment: 'A',
      est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
      est_early_withdrawal_penalty: rec.est_early_withdrawal_penalty,
    })
    expect(input.est_early_withdrawal_penalty).toBeUndefined()
  })

  test('a genuine $0 penalty is also omitted, not stated as "$0.00" — only a real nonzero figure is ever included', () => {
    const input = buildFundResultNarrationInput({
      fundResults: rec.fund_results, portfolio, accountType: 'traditional_IRA', segment: 'A',
      est_early_withdrawal_penalty: 0,
    })
    expect(input.est_early_withdrawal_penalty).toBeUndefined()
  })

  test('a real, nonzero penalty (hypothetical future case) DOES flow through and get stated', () => {
    const input = buildFundResultNarrationInput({
      fundResults: rec.fund_results, portfolio, accountType: 'traditional_IRA', segment: 'A',
      est_early_withdrawal_penalty: 500,
    })
    expect(input.est_early_withdrawal_penalty).toBe(500)
    const text = buildDeterministicFallback(input)
    expect(text).toMatch(/\$500\.00/)
    expect(text).toMatch(/penalty/i)
  })

  test('the deterministic fallback never mentions a penalty, age, or retirement when the figure is absent — no reassuring filler', () => {
    const input = buildFundResultNarrationInput({
      fundResults: rec.fund_results, portfolio, accountType: 'traditional_IRA', segment: 'A',
      est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
      est_early_withdrawal_penalty: rec.est_early_withdrawal_penalty,
    })
    const text = buildDeterministicFallback(input)
    expect(text).not.toMatch(/penalty/i)
    expect(text).not.toMatch(/59/)
    expect(text).not.toMatch(/retire/i)
  })

  test('self-audit guard: the not_applicable sentinel never leaks as literal text, and never produces NaN/undefined in output', () => {
    const input = buildFundResultNarrationInput({
      fundResults: rec.fund_results, portfolio, accountType: 'traditional_IRA', segment: 'A',
      est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
      est_early_withdrawal_penalty: 'not_applicable',
    })
    const text = buildDeterministicFallback(input)
    expect(text).not.toMatch(/not_applicable/i)
    expect(text).not.toMatch(/NaN/)
    expect(text).not.toMatch(/undefined/)
  })

  test('the prompt explicitly instructs omission by absence, not a stated non-applicability', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const input = buildFundResultNarrationInput({
      fundResults: rec.fund_results, portfolio, accountType: 'traditional_IRA', segment: 'A',
      est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
    })
    const { system } = buildNarrationPrompt(input)
    expect(system).toMatch(/est_early_withdrawal_penalty/)
    expect(system).toMatch(/say NOTHING about penalties/i)
  })
})

// ---------------------------------------------------------------------------
// Tense regression guard (DECISIONS.md D062): Fund Selection and Scenario
// Analysis narrate a proposed, unexecuted plan — narrationPrompt.ts used to
// receive input.tense but silently discard it, so the model had no signal
// to avoid declarative past tense ("Sold $X...") for a sale that hasn't
// happened. Order Confirmation is prospective too (same reasoning — nothing
// has executed at that screen either); only Execution Summary is genuinely
// past tense.
// ---------------------------------------------------------------------------

describe('narration tense per touchpoint (DECISIONS.md D062)', () => {
  const fr = realFundResultForLot(TAXABLE, 'VTSAX', 'T-VTSAX-08')

  test('fund_selection_rationale is prospective, not past', () => {
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    expect(input.tense).toBe('prospective')
  })

  test('scenario_tradeoff_summary is prospective, not past', () => {
    const scenario = buildScenarioFromFundResults([fr], portfolio, TAX_RATES, automatedRun(TAXABLE, fr.sell_amount).allocation_impact, TAXABLE)!
    const input = buildScenarioNarrationInput({ scenario, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    expect(input.tense).toBe('prospective')
  })

  test('order_confirmation_summary is prospective, not past — nothing has executed at this screen either', async () => {
    const { buildOrderConfirmationNarrationInput } = await import('./narrationBuilders')
    const rec = automatedRun(TAXABLE, 10000)
    const input = buildOrderConfirmationNarrationInput({
      source: { kind: 'recommendation', data: rec }, portfolio, accountType: 'taxable_brokerage', segment: 'A',
    })
    expect(input.tense).toBe('prospective')
  })

  test('execution_summary_narrative is past — this one has actually executed', async () => {
    const { buildExecutionSummaryNarrationInput } = await import('./narrationBuilders')
    const config = manualRun(TAXABLE, fr.sell_amount, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: fr.sell_amount }] })
    const transaction = {
      transaction_id: 'txn-test', account_id: TAXABLE, account_type: 'taxable_brokerage' as const,
      funds_sold: config.fund_results.map(r => ({ fund_id: r.fund_id, sell_amount: r.sell_amount, accounting_method: r.accounting_method, st_gain_loss: r.est_st_gain_loss, lt_gain_loss: r.est_lt_gain_loss, lots_sold: r.lots_sold })),
      est_tax_at_active_rate: 0, effective_rate: 0, losses_harvested: 0,
      stocks_before_pct: 0, stocks_after_pct: 0, bonds_before_pct: 0, bonds_after_pct: 0, reserves_before_pct: 0, reserves_after_pct: 0,
      settlement_account_id: TAXABLE, submitted_at: new Date().toISOString(),
    } as unknown as Parameters<typeof buildExecutionSummaryNarrationInput>[0]['transaction']
    const input = buildExecutionSummaryNarrationInput({ transaction, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    expect(input.tense).toBe('past')
  })

  test('the prospective instruction reaches the actual prompt sent to the model — not just the input object', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const { system } = buildNarrationPrompt(input)
    expect(system).toMatch(/has NOT been executed/)
    expect(system).not.toMatch(/has already been executed and settled/)
  })

  test('the past-tense instruction reaches the prompt for execution_summary_narrative', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const input: NarrationInput = { ...buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' }), touchpoint: 'execution_summary_narrative', tense: 'past' }
    const { system } = buildNarrationPrompt(input)
    expect(system).toMatch(/has already been executed and settled/)
    expect(system).not.toMatch(/has NOT been executed/)
  })

  test('the deterministic fallback (used on API failure) also respects tense — prospective input never says "Sold"', () => {
    const prospectiveInput = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const text = buildDeterministicFallback(prospectiveInput)
    expect(text).not.toMatch(/^Sold /)
    expect(text).not.toMatch(/ Sold /)
  })

  test('the deterministic fallback for a past-tense (Execution Summary) input does say "Sold"', () => {
    const pastInput: NarrationInput = { ...buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' }), touchpoint: 'execution_summary_narrative', tense: 'past' }
    const text = buildDeterministicFallback(pastInput)
    expect(text).toMatch(/^Sold /)
  })
})

// ---------------------------------------------------------------------------
// Tier-1 regression guard (DECISIONS.md D044): a lot with a known real gain
// must never silently produce a zero tax figure in the narration input.
// ---------------------------------------------------------------------------

describe('tax-figure regression guard (DECISIONS.md D044)', () => {
  test('a taxable-brokerage lot with a known real gain produces a non-zero est_tax_gross in the narration input', () => {
    const fr = realFundResultForLot(TAXABLE, 'VTSAX', 'T-VTSAX-08')
    expect(fr.est_st_gain_loss).toBeGreaterThan(0) // sanity: this lot really is a gain
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    expect(input.funds[0].est_tax_gross).toBeGreaterThan(0)
    // Would have failed against the old hand-typed fixture helper, which
    // defaulted est_tax_gross to 0 regardless of the real gain — this test
    // exists specifically so that regression can't happen silently again.
  })
})

// ---------------------------------------------------------------------------
// Effective-rate units and target-allocation regression guard (this task's
// own fix). Both bugs were the same root shape: a real number reached the
// model, but either in the wrong units (effective_rate: a raw 0-1 fraction,
// e.g. 0.0044, presented to the model with no way to know it wasn't already
// a percentage) or entirely fabricated (allocation_impact.target used to be
// a copy of `after`, so narration always described the sale as landing
// exactly on target). Neither was the model inventing something from a
// genuinely empty field — see DECISIONS.md's effective-rate/target-match
// entry for the full diagnosis.
// ---------------------------------------------------------------------------

describe('effective-rate units and target-allocation accuracy regression guard', () => {
  test('effective_rate reaching NarrationInput is a real percentage, not the engine\'s raw fraction — reproduces the "0.00% effective rate" bug directly', () => {
    const rec = automatedRun(TAXABLE, 25000, 'tax-first')
    // Sanity: the engine's own stored field really is a small fraction
    // (e.g. 0.0044 for 0.44%), not already a percentage — if this ever stops
    // holding, the conversion below would need to change too.
    expect(rec.effective_rate).toBeGreaterThan(0)
    expect(rec.effective_rate).toBeLessThan(1)
    const input = buildFundResultNarrationInput({
      fundResults: rec.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A',
      est_net_tax: rec.est_net_tax, effective_rate: rec.effective_rate,
    })
    expect(input.effective_rate).toBeCloseTo(rec.effective_rate * 100, 6)
    // The actual bug, reproduced: formatting the OLD unconverted fraction to
    // 2 decimals collapses to "0.00%" even though a real, nonzero tax was
    // charged — formatting the FIXED value must not.
    expect(rec.effective_rate.toFixed(2)).toBe('0.00') // the raw fraction really does collapse to this
    expect(input.effective_rate!.toFixed(2)).not.toBe('0.00') // the fixed value must not
  })

  test('allocation_impact.target is the real portfolio target_allocation, not a copy of "after" — reproduces the "perfectly reaching your target allocations" bug directly', () => {
    // A partial sale of only the overweight equity fund: moves toward target
    // but, by construction, does not land exactly on it — a genuine nonzero
    // gap must remain in the narration input's target snapshot.
    const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
    const scenario = buildScenarioFromFundResults(config.fund_results, portfolio, TAX_RATES, config.allocation_impact, TAXABLE)
    expect(scenario).not.toBeNull()
    const input = buildScenarioNarrationInput({ scenario: scenario!, portfolio, accountType: 'taxable_brokerage', segment: 'A' })

    // The real dataset target (sample-dataset.json) — asserted against the
    // portfolio fixture directly, never hand-typed, so this test can't drift
    // out of sync with the real data it's supposed to be checking against.
    const ta = portfolio.target_allocation!
    expect(input.allocation_impact!.target.domestic_equity).toBe(ta.domestic_equity_pct)
    expect(input.allocation_impact!.target.international_equity).toBe(ta.international_equity_pct)
    expect(input.allocation_impact!.target.domestic_bonds).toBe(ta.domestic_bonds_pct)
    expect(input.allocation_impact!.target.short_term_reserves).toBe(ta.short_term_reserves_pct)

    // The bug this reproduces: target used to be a literal copy of `after`,
    // which would make this comparison trivially pass no matter the real
    // gap. Assert `after` is genuinely NOT equal to `target` for this
    // fixture (a small partial sale, not a full rebalance to target) —
    // otherwise this test couldn't actually distinguish the fix from the bug.
    expect(input.allocation_impact!.after.domestic_equity).not.toBe(input.allocation_impact!.target.domestic_equity)
  })
})

// ---------------------------------------------------------------------------
// Leaked-draft regression guard (cc-prompt-leaked-draft-and-sync.md): a real
// Groq call, found while verifying D123's Segment C fix, returned a response
// whose text contained two paragraphs — a rule-violating draft followed by a
// compliant final sentence — with nothing checking the response's shape
// before this. Breadth investigation (8 real Groq calls across all four
// segments, 6 real Gemini calls across all four segments) found this
// correlates with Groq specifically (a reasoning model) — 1 real leak
// observed across roughly 23 real Groq calls made investigating this and the
// Segment C anchoring bug together, 0 across 6 real Gemini calls — not with
// any one segment. Fixed at two layers, mirroring whatIfValidation.ts's
// "prompt instruction alone is not a guarantee" precedent: an explicit new
// system-prompt instruction (prevention), plus isMalformedNarrationText()
// wired into dev/api/narrate.ts, returning a 502 (falls back to the
// deterministic summary via the client's existing failure path) rather than
// ever rendering a multi-paragraph response (detection).
// ---------------------------------------------------------------------------

describe('leaked-draft regression guard — malformed multi-paragraph response detection', () => {
  test('isMalformedNarrationText: a single continuous block, even multi-sentence, is not malformed', async () => {
    const { isMalformedNarrationText } = await import('../server/narrationValidation')
    expect(isMalformedNarrationText('Selling $15,000.00 of VTSAX would realize a gain. Est. tax $317.35.')).toBe(false)
  })

  test('isMalformedNarrationText: two blocks separated by a blank line is malformed — the exact shape of the real observed leak', async () => {
    const { isMalformedNarrationText } = await import('../server/narrationValidation')
    const real = 'Selling $12,000.00 of Vanguard Total International Stock Index Fund Admiral Shares would realize a short-term gain of $480.00 and result in an estimated tax of $115.20 at an effective rate of 0.96%. This trade would lower international-equity weight from about 16.02% to 14.85%.\n\n$115.20 tax on selling $12,000.00 of Vanguard Total International Stock Index Fund Admiral Shares.'
    expect(isMalformedNarrationText(real)).toBe(true)
  })

  test('isMalformedNarrationText: leading/trailing whitespace and a single trailing blank line do not themselves count as a second block', async () => {
    const { isMalformedNarrationText } = await import('../server/narrationValidation')
    expect(isMalformedNarrationText('\n  Selling $8,000.00 of VBTLX comes to $0.00 in tax.  \n\n')).toBe(false)
  })

  test('the prompt explicitly instructs a single final response, not just "no markdown" — a genuinely new rule, not a restatement of the existing one', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
    const input = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const { system } = buildNarrationPrompt(input)
    // The pre-existing rule governs markdown syntax only — confirm the new
    // rule is additional text, not something already covered by it.
    expect(system).toMatch(/output prose only.*no headers, no bullet points, no markdown/i)
    expect(system).toMatch(/never split across multiple paragraphs or separated by a blank line/i)
    expect(system).toMatch(/do not include a draft, an alternate attempt, a self-correction/i)
  })

  test('dev/api/narrate.ts returns 502 for a malformed response rather than passing it through to the client', async () => {
    const mod = await import('../../api/narrate')
    const handler = mod.default
    const { getActiveGenerator } = await import('../server/narrationGenerator')
    const realGenerator = getActiveGenerator('groq')
    const originalGenerate = realGenerator.generate
    realGenerator.generate = async () => 'A rule-violating draft paragraph that should never reach the user.\n\n$64.85 is the estimated net tax on selling $15,000.00 of VTSAX.'
    try {
      let statusCode = 0
      let jsonBody: unknown = null
      const res = {
        status(code: number) { statusCode = code; return res },
        json(body: unknown) { jsonBody = body },
      }
      const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
      const input = buildFundResultNarrationInput({ fundResults: config.fund_results, portfolio, accountType: 'taxable_brokerage', segment: 'C' })
      await handler({ method: 'POST', body: { ...input, provider: 'groq' } }, res)
      expect(statusCode).toBe(502)
      expect(jsonBody).toMatchObject({ providerName: 'groq' })
      // Never the raw malformed text reaching the response body at all (D066's
      // "never surface raw provider text" rule extends naturally to this case).
      expect(JSON.stringify(jsonBody)).not.toContain('rule-violating draft')
    } finally {
      realGenerator.generate = originalGenerate
    }
  })
})

describe('CD-4.2 boundary and failure fallback (CLAUDE.md §7, DECISIONS.md D038)', () => {
  test('fallback never claims to be AI-generated', async () => {
    const { getImmediateFallback } = await import('./narration')
    const fr = realFundResultForLot(TAXABLE, 'VTSAX', 'T-VTSAX-08')
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const result = getImmediateFallback(input)
    expect(result.aiGenerated).toBe(false)
  })

  test('getNarration falls back to a non-AI-generated result when the API call fails, and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { getNarration } = await import('./narration')
    const fr = realFundResultForLot(TAXABLE, 'VTSAX', 'T-VTSAX-08')
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const result = await getNarration(input)
    expect(result.aiGenerated).toBe(false)
    expect(result.text.length).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })

  test('getNarration returns aiGenerated:true and the model text on a mocked successful call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'Mocked model narration.' }),
    }))
    const { getNarration } = await import('./narration')
    const fr = realFundResultForLot(TAXABLE, 'VTSAX', 'T-VTSAX-09') // different lot than other tests to avoid the cache
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const result = await getNarration(input)
    expect(result.aiGenerated).toBe(true)
    expect(result.text).toBe('Mocked model narration.')
    vi.unstubAllGlobals()
  })

  test('the serverless function input validator rejects raw account/portfolio-shaped payloads', async () => {
    const mod = await import('../../api/narrate')
    const handler = mod.default
    let statusCode = 0
    let jsonBody: unknown = null
    const res = {
      status(code: number) { statusCode = code; return res },
      json(body: unknown) { jsonBody = body },
    }
    await handler({ method: 'POST', body: { account_id: 'ACCT-1', holdings: [] } }, res)
    expect(statusCode).toBe(400)
    expect(jsonBody).toMatchObject({ error: expect.any(String) })
  })

  test('market-data rule 1: fallback never states an absolute price, only a percentage return', () => {
    const fr = realFundResultForLot(TRAD_IRA, 'VFITX', 'IRA-VFITX-02')
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'traditional_IRA', segment: 'A' })
    const text = buildDeterministicFallback(input)
    // current_nav for VFITX (10.85) must never appear in narration text (CLAUDE.md §7 rule 1)
    expect(text).not.toMatch(/\$10\.85/)
    expect(text).toMatch(/%/)
  })
})

beforeEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Fixture helper for allocation categories 6/7
// ---------------------------------------------------------------------------

function distanceFromTarget(a: { domestic_equity: number; international_equity: number; domestic_bonds: number; short_term_reserves: number }): number {
  const t = { domestic_equity: 40.0, international_equity: 15.0, domestic_bonds: 35.0, short_term_reserves: 10.0 }
  return Math.abs(a.domestic_equity - t.domestic_equity) + Math.abs(a.international_equity - t.international_equity)
    + Math.abs(a.domestic_bonds - t.domestic_bonds) + Math.abs(a.short_term_reserves - t.short_term_reserves)
}

// ---------------------------------------------------------------------------
// Provider-agnostic generator selection (CLAUDE.md §1, DECISIONS.md D042)
// ---------------------------------------------------------------------------

describe('narration generator selection (D042: provider-agnostic, Gemini default)', () => {
  const ORIGINAL_ENV = process.env.NARRATION_PROVIDER

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.NARRATION_PROVIDER
    else process.env.NARRATION_PROVIDER = ORIGINAL_ENV
  })

  test('defaults to Gemini when NARRATION_PROVIDER is unset', async () => {
    delete process.env.NARRATION_PROVIDER
    const { getActiveGenerator } = await import('../server/narrationGenerator')
    expect(getActiveGenerator().name).toBe('gemini')
  })

  test('NARRATION_PROVIDER=anthropic switches to the Anthropic adapter — no code change needed', async () => {
    process.env.NARRATION_PROVIDER = 'anthropic'
    const { getActiveGenerator } = await import('../server/narrationGenerator')
    expect(getActiveGenerator().name).toBe('anthropic')
  })

  test('NARRATION_PROVIDER=groq switches to the Groq adapter (D065) — no code change needed', async () => {
    process.env.NARRATION_PROVIDER = 'groq'
    const { getActiveGenerator } = await import('../server/narrationGenerator')
    expect(getActiveGenerator().name).toBe('groq')
  })

  test('an unknown provider name throws NarrationApiError rather than silently falling back', async () => {
    process.env.NARRATION_PROVIDER = 'not-a-real-provider'
    const { getActiveGenerator, NarrationApiError } = await import('../server/narrationGenerator')
    expect(() => getActiveGenerator()).toThrow(NarrationApiError)
  })

  // D071 — the Demo Settings dialog's runtime per-request override. The env
  // var stays the default for headless testing and any request that omits
  // an override; a real override always wins when present.
  test('a per-request override wins over NARRATION_PROVIDER when both are present', async () => {
    process.env.NARRATION_PROVIDER = 'groq'
    const { getActiveGenerator } = await import('../server/narrationGenerator')
    expect(getActiveGenerator('anthropic').name).toBe('anthropic')
  })

  test('omitting the override falls back to NARRATION_PROVIDER, unchanged from before this parameter existed', async () => {
    process.env.NARRATION_PROVIDER = 'groq'
    const { getActiveGenerator } = await import('../server/narrationGenerator')
    expect(getActiveGenerator().name).toBe('groq')
    expect(getActiveGenerator(undefined).name).toBe('groq')
  })

  test('all three adapters implement the same NarrationGenerator interface shape', async () => {
    const { anthropicGenerator } = await import('../server/generators/anthropicGenerator')
    const { geminiGenerator } = await import('../server/generators/geminiGenerator')
    const { groqGenerator } = await import('../server/generators/groqGenerator')
    for (const gen of [anthropicGenerator, geminiGenerator, groqGenerator]) {
      expect(typeof gen.name).toBe('string')
      expect(typeof gen.generate).toBe('function')
    }
  })

  test('all three adapters fail the same way (NarrationApiError) with no key set — proves none is coupled to a fallback path only the others know about', async () => {
    const { anthropicGenerator } = await import('../server/generators/anthropicGenerator')
    const { geminiGenerator } = await import('../server/generators/geminiGenerator')
    const { groqGenerator } = await import('../server/generators/groqGenerator')
    const { NarrationApiError } = await import('../server/narrationGenerator')
    const savedAnthropicKey = process.env.ANTHROPIC_API_KEY
    const savedGeminiKey = process.env.GEMINI_API_KEY
    const savedGroqKey = process.env.GROQ_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.GROQ_API_KEY
    try {
      const fr = realFundResultForLot(TAXABLE, 'VTSAX', 'T-VTSAX-08')
      const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
      await expect(anthropicGenerator.generate(input)).rejects.toBeInstanceOf(NarrationApiError)
      await expect(geminiGenerator.generate(input)).rejects.toBeInstanceOf(NarrationApiError)
      await expect(groqGenerator.generate(input)).rejects.toBeInstanceOf(NarrationApiError)
    } finally {
      if (savedAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropicKey
      if (savedGeminiKey !== undefined) process.env.GEMINI_API_KEY = savedGeminiKey
      if (savedGroqKey !== undefined) process.env.GROQ_API_KEY = savedGroqKey
    }
  })
})
