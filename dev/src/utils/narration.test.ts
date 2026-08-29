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
    const scenario = buildScenarioFromFundResults(config.fund_results, portfolio, TAX_RATES, config.allocation_impact)
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
    const scenario = buildScenarioFromFundResults(config.fund_results, portfolio, TAX_RATES, config.allocation_impact)
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
// Additional coverage: CD-4.2 boundary, failure fallback, market-data rule 1
// ---------------------------------------------------------------------------

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

  test('an unknown provider name throws NarrationApiError rather than silently falling back', async () => {
    process.env.NARRATION_PROVIDER = 'not-a-real-provider'
    const { getActiveGenerator, NarrationApiError } = await import('../server/narrationGenerator')
    expect(() => getActiveGenerator()).toThrow(NarrationApiError)
  })

  test('both adapters implement the same NarrationGenerator interface shape', async () => {
    const { anthropicGenerator } = await import('../server/generators/anthropicGenerator')
    const { geminiGenerator } = await import('../server/generators/geminiGenerator')
    for (const gen of [anthropicGenerator, geminiGenerator]) {
      expect(typeof gen.name).toBe('string')
      expect(typeof gen.generate).toBe('function')
    }
  })

  test('both adapters fail the same way (NarrationApiError) with no key set — proves neither is coupled to a fallback path only the other knows about', async () => {
    const { anthropicGenerator } = await import('../server/generators/anthropicGenerator')
    const { geminiGenerator } = await import('../server/generators/geminiGenerator')
    const { NarrationApiError } = await import('../server/narrationGenerator')
    const savedAnthropicKey = process.env.ANTHROPIC_API_KEY
    const savedGeminiKey = process.env.GEMINI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      const fr = realFundResultForLot(TAXABLE, 'VTSAX', 'T-VTSAX-08')
      const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
      await expect(anthropicGenerator.generate(input)).rejects.toBeInstanceOf(NarrationApiError)
      await expect(geminiGenerator.generate(input)).rejects.toBeInstanceOf(NarrationApiError)
    } finally {
      if (savedAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropicKey
      if (savedGeminiKey !== undefined) process.env.GEMINI_API_KEY = savedGeminiKey
    }
  })
})
