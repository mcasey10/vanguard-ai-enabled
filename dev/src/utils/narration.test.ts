/**
 * Narration layer tests — dev/src/utils/narration.test.ts
 *
 * Covers all 11 categories in CLAUDE.md §12's "Narration (Feature 1)" list.
 * Every fixture below uses real fund/lot/account values already present in
 * dev/src/data/sample-dataset.json (via loadPortfolio()/getMarketContextData())
 * rather than invented numbers — same rule this project has followed for
 * engine.test.ts. The live provider call is mocked, never hit (CLAUDE.md §7)
 * — tests mock at the fetch/HTTP boundary (client → /api/narrate), which is
 * inherently provider-agnostic (DECISIONS.md D042), not at any specific
 * provider's SDK or endpoint.
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
import type { FundSaleResult, SavedScenario } from '../types'

const portfolio = loadPortfolio()
const { trailing_12mo_return, market_context_exclusions } = getMarketContextData()

function findLot(fundId: string, lotId: string) {
  for (const acct of portfolio.accounts) {
    const h = acct.holdings.find(h => h.fund_id === fundId)
    const lot = h?.lots.find(l => l.lot_id === lotId)
    if (lot) return lot
  }
  throw new Error(`fixture lot not found: ${fundId}/${lotId}`)
}

function fundResult(overrides: Partial<FundSaleResult> & Pick<FundSaleResult, 'fund_id' | 'fund_name'>): FundSaleResult {
  return {
    sell_amount: 0,
    accounting_method: 'FIFO',
    lots_sold: [],
    est_st_gain_loss: 0,
    est_lt_gain_loss: 0,
    est_tax_gross: 0,
    impact_pct: 0,
    impact_asset_class: '',
    rationale: '',
    ...overrides,
  }
}

describe('narration coverage categories (CLAUDE.md §11)', () => {
  // 1. Pure gain — T-VTSAX-08, real unrealized_gain_loss +$1,920.00 (ST)
  test('1. pure gain', () => {
    const lot = findLot('VTSAX', 'T-VTSAX-08')
    const fr = fundResult({
      fund_id: 'VTSAX', fund_name: 'Vanguard Total Stock Market Index Fund Admiral Shares',
      sell_amount: lot.current_value, est_st_gain_loss: lot.unrealized_gain_loss,
      lots_sold: [{ lot_id: lot.lot_id, shares_to_sell: lot.shares, proceeds: lot.current_value, cost_basis: lot.total_cost_basis, realized_gain_loss: lot.unrealized_gain_loss, holding_period: 'ST' }],
    })
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    expect(input.funds[0].st_gain_loss).toBe(1920)
    expect(input.funds[0].lt_gain_loss).toBe(0)
    const text = buildDeterministicFallback(input)
    expect(text).toMatch(/gain of \$1,920\.00/)
    expect(text).not.toMatch(/loss/i)
  })

  // 2. Pure loss-harvest — T-VBTLX-02, real unrealized_loss -$2,180.00 (LT)
  test('2. pure loss-harvest', () => {
    const lot = findLot('VBTLX', 'T-VBTLX-02')
    expect(lot.unrealized_gain_loss).toBeLessThan(0)
    const fr = fundResult({
      fund_id: 'VBTLX', fund_name: 'Vanguard Total Bond Market Index Fund Admiral Shares',
      sell_amount: lot.current_value, est_lt_gain_loss: lot.unrealized_gain_loss,
      lots_sold: [{ lot_id: lot.lot_id, shares_to_sell: lot.shares, proceeds: lot.current_value, cost_basis: lot.total_cost_basis, realized_gain_loss: lot.unrealized_gain_loss, holding_period: 'LT' }],
    })
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const text = buildDeterministicFallback(input)
    expect(text).toMatch(/loss of \$2,180\.00/)
  })

  // 3. Mixed gain+harvest — VTSAX gain lot + VBTLX loss lot in one transaction
  test('3. mixed gain + harvest', () => {
    const gainLot = findLot('VTSAX', 'T-VTSAX-08')
    const lossLot = findLot('VBTLX', 'T-VBTLX-02')
    const frGain = fundResult({ fund_id: 'VTSAX', fund_name: 'VTSAX Fund', sell_amount: gainLot.current_value, est_st_gain_loss: gainLot.unrealized_gain_loss })
    const frLoss = fundResult({ fund_id: 'VBTLX', fund_name: 'VBTLX Fund', sell_amount: lossLot.current_value, est_lt_gain_loss: lossLot.unrealized_gain_loss })
    const input = buildFundResultNarrationInput({ fundResults: [frGain, frLoss], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    expect(input.funds).toHaveLength(2)
    const netted = input.funds.reduce((s, f) => s + f.st_gain_loss + f.lt_gain_loss, 0)
    expect(netted).toBe(gainLot.unrealized_gain_loss + lossLot.unrealized_gain_loss)
  })

  // 4. ST-LT crossing — VTSAX taxable holding's real ST/LT aggregate, both non-zero
  test('4. ST-LT crossing (one fund, both periods realized)', () => {
    const fr = fundResult({
      fund_id: 'VTSAX', fund_name: 'VTSAX Fund', sell_amount: 100000,
      est_st_gain_loss: 4723.6, est_lt_gain_loss: 114277.5, // real VTSAX taxable holding aggregate
    })
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    expect(input.funds[0].st_gain_loss).toBeGreaterThan(0)
    expect(input.funds[0].lt_gain_loss).toBeGreaterThan(0)
  })

  // 5. Traditional IRA ordinary-income framing — IRA-VFITX-02, real gain +$625.00
  test('5. Traditional IRA ordinary-income framing', () => {
    const lot = findLot('VFITX', 'IRA-VFITX-02')
    const fr = fundResult({
      fund_id: 'VFITX', fund_name: 'Vanguard Intermediate-Term Treasury Index Fund Admiral Shares',
      sell_amount: lot.current_value, est_lt_gain_loss: lot.unrealized_gain_loss,
    })
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'traditional_IRA', segment: 'A' })
    expect(input.funds[0].account_type).toBe('traditional_IRA')
    const text = buildDeterministicFallback(input)
    expect(text).toMatch(/ordinary income/i)
  })

  // 6. Allocation toward-target
  test('6. allocation toward-target', () => {
    const scenario = makeScenario({
      before: { domestic_equity: 41.75, international_equity: 16.02, domestic_bonds: 32.53, short_term_reserves: 9.69 },
      after: { domestic_equity: 40.5, international_equity: 15.3, domestic_bonds: 34.2, short_term_reserves: 10.0 },
    })
    const input = buildScenarioNarrationInput({ scenario, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const before = distanceFromTarget(input.allocation_impact!.before)
    const after = distanceFromTarget(input.allocation_impact!.after)
    expect(after).toBeLessThan(before)
  })

  // 7. Allocation away-from-target
  test('7. allocation away-from-target', () => {
    const scenario = makeScenario({
      before: { domestic_equity: 41.75, international_equity: 16.02, domestic_bonds: 32.53, short_term_reserves: 9.69 },
      after: { domestic_equity: 44.0, international_equity: 17.5, domestic_bonds: 29.0, short_term_reserves: 9.5 },
    })
    const input = buildScenarioNarrationInput({ scenario, portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const before = distanceFromTarget(input.allocation_impact!.before)
    const after = distanceFromTarget(input.allocation_impact!.after)
    expect(after).toBeGreaterThan(before)
  })

  // 8. Wait & Save triggered — T-VTIAX-07, real days_to_lt_conversion=14, savings $55.80
  test('8. Wait & Save triggered', () => {
    const lot = findLot('VTIAX', 'T-VTIAX-07')
    expect(lot.days_to_lt_conversion).toBeLessThanOrEqual(30)
    const fr = fundResult({
      fund_id: 'VTIAX', fund_name: 'VTIAX Fund', sell_amount: lot.current_value, est_st_gain_loss: lot.unrealized_gain_loss,
    })
    const input = buildFundResultNarrationInput({
      fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A',
      wait_and_save_notices: [{ fund_id: 'VTIAX', lot_id: lot.lot_id, days_until_lt: lot.days_to_lt_conversion!, tax_savings_by_waiting: 55.80 }],
    })
    const text = buildDeterministicFallback(input)
    expect(text).toMatch(/14 more day/)
    expect(text).toMatch(/\$55\.80/)
  })

  // 9. SpecID lot-level active — ROTH-VFIAX-07, specific_lot_identification
  test('9. SpecID lot-level active', () => {
    const lot = findLot('VFIAX', 'ROTH-VFIAX-07')
    const fr = fundResult({
      fund_id: 'VFIAX', fund_name: 'Vanguard 500 Index Fund Admiral Shares',
      sell_amount: lot.current_value, est_st_gain_loss: lot.unrealized_gain_loss,
      accounting_method: 'specific_lot_identification',
      lots_sold: [{ lot_id: lot.lot_id, shares_to_sell: lot.shares, proceeds: lot.current_value, cost_basis: lot.total_cost_basis, realized_gain_loss: lot.unrealized_gain_loss, holding_period: 'ST' }],
    })
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'roth_IRA', segment: 'A' })
    expect(input.funds[0].accounting_method).toBe('specific_lot_identification')
    expect(input.funds[0].lots).toHaveLength(1)
    expect(input.funds[0].lots![0].lot_id).toBe('ROTH-VFIAX-07')
    expect(input.funds[0].lots![0].acquisition_date).toBe('2025-11-10') // real value, looked up not invented
  })

  // 10. Same figures across two segment tones — the prompt's figures (user
  // message) must be identical while the tone guidance (system message)
  // differs, proving segment affects only tone, never content.
  test('10. same figures across two segment tones', async () => {
    const { buildNarrationPrompt } = await import('../server/narrationPrompt')
    const lot = findLot('VTSAX', 'T-VTSAX-08')
    const fr = fundResult({ fund_id: 'VTSAX', fund_name: 'VTSAX Fund', sell_amount: lot.current_value, est_st_gain_loss: lot.unrealized_gain_loss })
    const inputA = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
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
      const lot = findLot('VFITX', 'IRA-VFITX-06')
      const fr = fundResult({
        fund_id: 'VFITX', fund_name: 'VFITX Fund', sell_amount: lot.current_value, est_st_gain_loss: lot.unrealized_gain_loss,
        lots_sold: [{ lot_id: lot.lot_id, shares_to_sell: lot.shares, proceeds: lot.current_value, cost_basis: lot.total_cost_basis, realized_gain_loss: lot.unrealized_gain_loss, holding_period: 'ST' }],
      })
      const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'traditional_IRA', segment: 'A' })
      expect(input.funds[0].market_context_return_pct).toBeUndefined()
      const text = buildDeterministicFallback(input)
      expect(text).not.toMatch(/trailing 12 months/)
    })

    test('end-to-end through the builder: a non-excluded VFITX lot DOES carry it', () => {
      const lot = findLot('VFITX', 'IRA-VFITX-02')
      const fr = fundResult({
        fund_id: 'VFITX', fund_name: 'VFITX Fund', sell_amount: lot.current_value, est_lt_gain_loss: lot.unrealized_gain_loss,
        lots_sold: [{ lot_id: lot.lot_id, shares_to_sell: lot.shares, proceeds: lot.current_value, cost_basis: lot.total_cost_basis, realized_gain_loss: lot.unrealized_gain_loss, holding_period: 'LT' }],
      })
      const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'traditional_IRA', segment: 'A' })
      expect(input.funds[0].market_context_return_pct).toBe(trailing_12mo_return.VFITX)
      const text = buildDeterministicFallback(input)
      expect(text).toMatch(/trailing 12 months/)
    })
  })
})

// ---------------------------------------------------------------------------
// Additional coverage: CD-4.2 boundary, failure fallback, market-data rule 1
// ---------------------------------------------------------------------------

describe('CD-4.2 boundary and failure fallback (CLAUDE.md §7, DECISIONS.md D038)', () => {
  test('fallback never claims to be AI-generated', async () => {
    const { getImmediateFallback } = await import('./narration')
    const lot = findLot('VTSAX', 'T-VTSAX-08')
    const fr = fundResult({ fund_id: 'VTSAX', fund_name: 'VTSAX Fund', sell_amount: lot.current_value, est_st_gain_loss: lot.unrealized_gain_loss })
    const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
    const result = getImmediateFallback(input)
    expect(result.aiGenerated).toBe(false)
  })

  test('getNarration falls back to a non-AI-generated result when the API call fails, and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { getNarration } = await import('./narration')
    const lot = findLot('VTSAX', 'T-VTSAX-08')
    const fr = fundResult({ fund_id: 'VTSAX', fund_name: 'VTSAX Fund', sell_amount: lot.current_value, est_st_gain_loss: lot.unrealized_gain_loss })
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
    const lot = findLot('VTSAX', 'T-VTSAX-09') // different lot than other tests to avoid the cache
    const fr = fundResult({ fund_id: 'VTSAX', fund_name: 'VTSAX Fund', sell_amount: lot.current_value, est_lt_gain_loss: lot.unrealized_gain_loss })
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
    const lot = findLot('VFITX', 'IRA-VFITX-02')
    const fr = fundResult({
      fund_id: 'VFITX', fund_name: 'VFITX Fund', sell_amount: lot.current_value, est_lt_gain_loss: lot.unrealized_gain_loss,
      lots_sold: [{ lot_id: lot.lot_id, shares_to_sell: lot.shares, proceeds: lot.current_value, cost_basis: lot.total_cost_basis, realized_gain_loss: lot.unrealized_gain_loss, holding_period: 'LT' }],
    })
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

function makeScenario(alloc: {
  before: { domestic_equity: number; international_equity: number; domestic_bonds: number; short_term_reserves: number }
  after: { domestic_equity: number; international_equity: number; domestic_bonds: number; short_term_reserves: number }
}): SavedScenario {
  const lot = findLot('VTSAX', 'T-VTSAX-08')
  return {
    scenario_id: 'TEST-SCENARIO',
    scenario_name: 'Test scenario',
    source_mode: 'manual',
    fund_selections: [{
      fund_id: 'VTSAX', fund_name: 'VTSAX Fund', sell_amount: lot.current_value,
      accounting_method: 'FIFO', lots_selected: [],
      st_gain_loss: lot.unrealized_gain_loss, lt_gain_loss: 0, est_tax_gross: 0,
    }],
    total_sell_amount: lot.current_value,
    projected_st_gains: Math.max(0, lot.unrealized_gain_loss),
    projected_lt_gains: 0,
    losses_harvested: 0,
    net_taxable_gain: lot.unrealized_gain_loss,
    est_net_tax: 0,
    effective_rate: 0,
    allocation_impact: {
      domestic_equity_before: alloc.before.domestic_equity,
      international_equity_before: alloc.before.international_equity,
      domestic_bonds_before: alloc.before.domestic_bonds,
      short_term_reserves_before: alloc.before.short_term_reserves,
      domestic_equity_after: alloc.after.domestic_equity,
      international_equity_after: alloc.after.international_equity,
      domestic_bonds_after: alloc.after.domestic_bonds,
      short_term_reserves_after: alloc.after.short_term_reserves,
    },
    tradeoff_summary: '',
    tax_assumption_set: { st_rate: 0.24, lt_rate: 0.15, income_bracket_label: '24% / 15%', source: 'default', selection_timestamp: new Date().toISOString() },
    created_at: new Date().toISOString(),
  }
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
      const lot = findLot('VTSAX', 'T-VTSAX-08')
      const fr = fundResult({ fund_id: 'VTSAX', fund_name: 'VTSAX Fund', sell_amount: lot.current_value, est_st_gain_loss: lot.unrealized_gain_loss })
      const input = buildFundResultNarrationInput({ fundResults: [fr], portfolio, accountType: 'taxable_brokerage', segment: 'A' })
      await expect(anthropicGenerator.generate(input)).rejects.toBeInstanceOf(NarrationApiError)
      await expect(geminiGenerator.generate(input)).rejects.toBeInstanceOf(NarrationApiError)
    } finally {
      if (savedAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropicKey
      if (savedGeminiKey !== undefined) process.env.GEMINI_API_KEY = savedGeminiKey
    }
  })
})
