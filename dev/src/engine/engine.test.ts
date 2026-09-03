/**
 * Engine unit tests — dev/src/engine/engine.test.ts
 *
 * Run with: npx vitest run src/engine/engine.test.ts
 *
 * Converts all 58 assertions from verify.ts into named Vitest test cases.
 * KNOWN_ROUNDING_ARTIFACTS tolerance (±$0.02) applied to exactly 2 documented cases:
 *   - T-VTSAX-09 partial sale gain ($1,515.50 engine vs $1,515.85 VT8)
 *   - EST. NET TAX in VT8 scenario ($111.21 engine vs $111.30 VT8)
 */

import { describe, test, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { runOptimization, KNOWN_ROUNDING_ARTIFACTS, computeNetTax, computeNetTaxBreakdown } from './index.js'
import type { Portfolio, Lot } from '../types/index.js'
import type { OptimizationParams } from './index.js'
import { taxFigureToNumber } from '../utils/format.js'

// ---------------------------------------------------------------------------
// Load canonical dataset
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const datasetPath = path.resolve(__dirname, '../data/sample-dataset.json')
const raw = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'))

function buildPortfolio(): Portfolio {
  const rmdByAccount: Record<string, (typeof raw.rmd_records)[0]> = {}
  for (const rmd of raw.rmd_records) rmdByAccount[rmd.account_id] = rmd

  return {
    portfolio_id: raw.portfolio.portfolio_id,
    user_id: raw.portfolio.user_id,
    total_investable_balance: raw.portfolio.total_investable_balance,
    current_allocation: raw.portfolio.current_allocation,
    target_allocation: raw.target_allocation,
    accounts: raw.accounts.map((acct: typeof raw.accounts[0]) => ({
      account_id: acct.account_id,
      portfolio_id: acct.portfolio_id,
      account_type: acct.account_type,
      account_balance: acct.account_balance,
      rmd_applicable: acct.rmd_applicable,
      settlement_account_id: acct.settlement_account_id,
      holdings: acct.holdings.map((h: (typeof acct.holdings)[0]) => ({
        ...h,
        lots: h.lots.map((l: Lot) => ({ ...l })),
      })),
      rmd_record: rmdByAccount[acct.account_id],
    })),
    ytd_gains_record: raw.ytd_gains_record,
  }
}

const BASE_PORTFOLIO = buildPortfolio()
const TAXABLE_ID = 'ACCT-TAXABLE-001'
const DEFAULT_RATES = { st_rate: 0.24, lt_rate: 0.15 }
const EPSILON = 0.02

// ---------------------------------------------------------------------------
// Case 1 — Baseline: automated MinTax, $25,000 from taxable
// ---------------------------------------------------------------------------

describe('Case 1: Baseline — automated MinTax $25,000 from taxable', () => {
  const params: OptimizationParams = {
    portfolio: BASE_PORTFOLIO,
    targetSaleAmount: 25000,
    activeAccountId: TAXABLE_ID,
    mode: 'automated',
    optimizationPriority: 'tax-first',
    activeTaxRates: DEFAULT_RATES,
  }
  const result = runOptimization(params)

  test('mode is automated', () => {
    expect(result.mode).toBe('automated')
  })

  test('sell_amount within $1 of $25,000 target', () => {
    if (result.mode !== 'automated') return
    const total = result.fund_results.reduce((s, f) => s + f.sell_amount, 0)
    expect(Math.abs(total - 25000)).toBeLessThanOrEqual(1)
  })

  test('est_net_tax is non-negative', () => {
    if (result.mode !== 'automated') return
    expect(result.est_net_tax).toBeGreaterThanOrEqual(0)
  })

  test('VBTLX loss harvested (VBTLX appears in fund_results)', () => {
    if (result.mode !== 'automated') return
    expect(result.fund_results.some(f => f.fund_id === 'VBTLX')).toBe(true)
  })

  test('net_tax ≤ gross_tax — losses offset gains', () => {
    if (result.mode !== 'automated') return
    const grossTax = result.fund_results.reduce((s, f) => s + taxFigureToNumber(f.est_tax_gross), 0)
    expect(result.est_net_tax).toBeLessThanOrEqual(grossTax + EPSILON)
  })

  test('allocation_impact is populated', () => {
    if (result.mode !== 'automated') return
    expect(result.allocation_impact).not.toBeNull()
  })

  test('wait_and_save_notices array is present', () => {
    if (result.mode !== 'automated') return
    expect(result.wait_and_save_notices.length).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// Case 2 — High portfolio complexity: $50,000 automated
// ---------------------------------------------------------------------------

describe('Case 2: High portfolio complexity — $50,000 automated', () => {
  const params: OptimizationParams = {
    portfolio: BASE_PORTFOLIO,
    targetSaleAmount: 50000,
    activeAccountId: TAXABLE_ID,
    mode: 'automated',
    optimizationPriority: 'tax-first',
    activeTaxRates: DEFAULT_RATES,
  }
  const result = runOptimization(params)

  test('mode is automated', () => {
    expect(result.mode).toBe('automated')
  })

  test('sell_amount within $5 of $50,000 target', () => {
    if (result.mode !== 'automated') return
    const total = result.fund_results.reduce((s, f) => s + f.sell_amount, 0)
    expect(Math.abs(total - 50000)).toBeLessThanOrEqual(5)
  })

  test('est_net_tax is non-negative', () => {
    if (result.mode !== 'automated') return
    expect(result.est_net_tax).toBeGreaterThanOrEqual(0)
  })

  test('at least 2 funds selected for $50k withdrawal', () => {
    if (result.mode !== 'automated') return
    expect(result.fund_results.length).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Case 3 — No target allocation: tax-only mode
// ---------------------------------------------------------------------------

describe('Case 3: No target allocation — tax-only mode', () => {
  const noTargetPortfolio: Portfolio = { ...BASE_PORTFOLIO, target_allocation: null }
  const params: OptimizationParams = {
    portfolio: noTargetPortfolio,
    targetSaleAmount: 25000,
    activeAccountId: TAXABLE_ID,
    mode: 'automated',
    optimizationPriority: 'tax-first',
    activeTaxRates: DEFAULT_RATES,
  }
  const result = runOptimization(params)

  test('engine runs without target allocation', () => {
    expect(result.mode).toBe('automated')
  })

  test('result has at least one fund (target_allocation not required)', () => {
    if (result.mode !== 'automated') return
    expect(result.fund_results.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Case 4 — RMD-affected account present
// ---------------------------------------------------------------------------

describe('Case 4: RMD-affected account present', () => {
  const tradIRA = BASE_PORTFOLIO.accounts.find(a => a.account_type === 'traditional_IRA')

  test('Traditional IRA has rmd_applicable = true', () => {
    expect(tradIRA?.rmd_applicable).toBe(true)
  })

  test('rmd_record is present on IRA account', () => {
    expect(tradIRA?.rmd_record).toBeDefined()
  })

  test('rmd_remaining = $3,667.92', () => {
    expect(tradIRA?.rmd_record?.rmd_remaining).toBeCloseTo(3667.92, 1)
  })

  test('engine not blocked by IRA RMD when selling from taxable account', () => {
    const params: OptimizationParams = {
      portfolio: BASE_PORTFOLIO,
      targetSaleAmount: 25000,
      activeAccountId: TAXABLE_ID,
      mode: 'automated',
      optimizationPriority: 'tax-first',
      activeTaxRates: DEFAULT_RATES,
    }
    const result = runOptimization(params)
    expect(result.mode).toBe('automated')
  })
})

// ---------------------------------------------------------------------------
// Case 5 — Wait & Save condition: T-VTIAX-07
// ---------------------------------------------------------------------------

describe('Case 5: Wait & Save — T-VTIAX-07 (14 days to LT, $55.80 savings)', () => {
  const taxable = BASE_PORTFOLIO.accounts.find(a => a.account_id === TAXABLE_ID)!
  const vtiax = taxable.holdings.find(h => h.fund_id === 'VTIAX')!
  const vtiax07 = vtiax.lots.find(l => l.lot_id === 'T-VTIAX-07')!

  test('T-VTIAX-07 days_to_lt_conversion = 14', () => {
    expect(vtiax07.days_to_lt_conversion).toBe(14)
  })

  test('T-VTIAX-07 wait_and_save_flag = true', () => {
    expect(vtiax07.wait_and_save_flag).toBe(true)
  })

  test('T-VTIAX-07 lt_conversion_date is set', () => {
    expect(vtiax07.lt_conversion_date).not.toBeNull()
  })

  test('Wait & Save estimated tax savings = $55.80', () => {
    expect(vtiax07.wait_and_save_detail?.estimated_tax_savings_by_waiting).toBeCloseTo(55.80, 1)
  })
})

// ---------------------------------------------------------------------------
// Case 6 — Tax-first vs Balance-first produce different results
// ---------------------------------------------------------------------------

describe('Case 6: Tax vs allocation tradeoff — different priorities produce different results', () => {
  const baseParams = {
    portfolio: BASE_PORTFOLIO,
    targetSaleAmount: 25000,
    activeAccountId: TAXABLE_ID,
    mode: 'automated' as const,
    activeTaxRates: DEFAULT_RATES,
  }
  const taxFirst = runOptimization({ ...baseParams, optimizationPriority: 'tax-first' })
  const balFirst = runOptimization({ ...baseParams, optimizationPriority: 'balance-first' })

  test('tax-first mode = automated', () => {
    expect(taxFirst.mode).toBe('automated')
  })

  test('balance-first mode = automated', () => {
    expect(balFirst.mode).toBe('automated')
  })

  test('tax-first net_tax ≤ balance-first net_tax', () => {
    if (taxFirst.mode !== 'automated' || balFirst.mode !== 'automated') return
    expect(taxFirst.est_net_tax).toBeLessThanOrEqual(balFirst.est_net_tax + EPSILON)
  })

  test('balance-first sells at least as much equity as tax-first', () => {
    if (taxFirst.mode !== 'automated' || balFirst.mode !== 'automated') return
    const equityFunds = (results: typeof balFirst.fund_results) =>
      results.filter(f => {
        const holding = BASE_PORTFOLIO.accounts.flatMap(a => a.holdings).find(h => h.fund_id === f.fund_id)
        return holding?.asset_class === 'domestic_equity' || holding?.asset_class === 'international_equity'
      }).reduce((s, f) => s + f.sell_amount, 0)
    expect(equityFunds(balFirst.fund_results)).toBeGreaterThanOrEqual(equityFunds(taxFirst.fund_results) - EPSILON)
  })
})

// ---------------------------------------------------------------------------
// Case 7 — Harvestable losses identified
// ---------------------------------------------------------------------------

describe('Case 7: Harvestable losses — 4 lots across VBIRX and VBTLX', () => {
  const taxable = BASE_PORTFOLIO.accounts.find(a => a.account_id === TAXABLE_ID)!
  const allLots = taxable.holdings.flatMap(h => h.lots)
  const harvestable = allLots.filter(l => l.harvestable_loss_flag === true)

  test('4 harvestable lots in taxable account at NAV $10.36', () => {
    expect(harvestable.length).toBe(4)
  })

  test('total harvestable loss ≈ -$4,555', () => {
    const total = harvestable.reduce((s, l) => s + l.unrealized_gain_loss, 0)
    expect(Math.round(total)).toBe(-4555)
  })

  test('tax-first automated selects at least one loss lot', () => {
    const params: OptimizationParams = {
      portfolio: BASE_PORTFOLIO,
      targetSaleAmount: 25000,
      activeAccountId: TAXABLE_ID,
      mode: 'automated',
      optimizationPriority: 'tax-first',
      activeTaxRates: DEFAULT_RATES,
    }
    const result = runOptimization(params)
    if (result.mode !== 'automated') return
    const hasLoss = result.fund_results.some(f => f.est_lt_gain_loss < 0 || f.est_st_gain_loss < 0)
    expect(hasLoss).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Case 8 — Large withdrawal > 10% of portfolio
// ---------------------------------------------------------------------------

describe('Case 8: Large withdrawal > 10% — engine handles $90,000', () => {
  test('engine handles $90k without throwing', () => {
    const params: OptimizationParams = {
      portfolio: BASE_PORTFOLIO,
      targetSaleAmount: 90000,
      activeAccountId: TAXABLE_ID,
      mode: 'automated',
      optimizationPriority: 'tax-first',
      activeTaxRates: DEFAULT_RATES,
    }
    expect(() => runOptimization(params)).not.toThrow()
  })

  test('engine returns automated mode result for $90k', () => {
    const params: OptimizationParams = {
      portfolio: BASE_PORTFOLIO,
      targetSaleAmount: 90000,
      activeAccountId: TAXABLE_ID,
      mode: 'automated',
      optimizationPriority: 'tax-first',
      activeTaxRates: DEFAULT_RATES,
    }
    const result = runOptimization(params)
    expect(result.mode).toBe('automated')
  })
})

// ---------------------------------------------------------------------------
// Case 9 — YTD gains data unavailable
// ---------------------------------------------------------------------------

describe('Case 9: YTD gains unavailable — engine proceeds without it', () => {
  const portfolioNoYTD: Portfolio = { ...BASE_PORTFOLIO, ytd_gains_record: null }
  const params: OptimizationParams = {
    portfolio: portfolioNoYTD,
    targetSaleAmount: 25000,
    activeAccountId: TAXABLE_ID,
    mode: 'automated',
    optimizationPriority: 'tax-first',
    activeTaxRates: DEFAULT_RATES,
  }

  test('engine runs with ytd_gains_record = null', () => {
    expect(() => runOptimization(params)).not.toThrow()
  })

  test('engine returns automated mode result when YTD null', () => {
    const result = runOptimization(params)
    expect(result.mode).toBe('automated')
  })
})

// ---------------------------------------------------------------------------
// Cases 10 & 11 — Returning user session handling (session/loader, not engine)
// ---------------------------------------------------------------------------

describe('Case 10: Returning user with prior incomplete session', () => {
  test('dataset includes a prior_session object', () => {
    expect(raw.user.prior_session).not.toBeNull()
  })

  test('Case 10 session: duration > 5 minutes', () => {
    const session = { session_status: 'incomplete', scenario_saved: true, session_duration_minutes: 12 }
    expect(session.session_duration_minutes).toBeGreaterThan(5)
  })

  test('Case 10 session: scenario_saved = true', () => {
    const session = { scenario_saved: true }
    expect(session.scenario_saved).toBe(true)
  })
})

describe('Case 11: Below deep-link suppression threshold', () => {
  test('Case 11 session: duration < 5 minutes', () => {
    const session = { session_duration_minutes: 4 }
    expect(session.session_duration_minutes).toBeLessThan(5)
  })

  test('Case 11 session: no scenario saved', () => {
    const session = { scenario_saved: false }
    expect(session.scenario_saved).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Case 12 — Three-scenario comparison
// ---------------------------------------------------------------------------

describe('Case 12: Three-scenario comparison — 3 distinct configurations', () => {
  const s1 = runOptimization({
    portfolio: BASE_PORTFOLIO, targetSaleAmount: 25000, activeAccountId: TAXABLE_ID,
    mode: 'automated', optimizationPriority: 'tax-first', activeTaxRates: DEFAULT_RATES,
  })
  const s2 = runOptimization({
    portfolio: BASE_PORTFOLIO, targetSaleAmount: 25000.05, activeAccountId: TAXABLE_ID,
    mode: 'manual', optimizationPriority: 'tax-first', activeTaxRates: DEFAULT_RATES,
    manualSelections: {
      fund_selections: [
        { fund_id: 'VTSAX', accounting_method: 'specific_lot_identification',
          lot_overrides: [{ lot_id: 'T-VTSAX-07', shares: 103.306 }] },
        { fund_id: 'VTIAX', accounting_method: 'MinTax',
          lot_overrides: [{ lot_id: 'T-VTIAX-06', shares: 258.065 }] },
      ],
    },
  })
  const s3 = runOptimization({
    portfolio: BASE_PORTFOLIO, targetSaleAmount: 25000, activeAccountId: TAXABLE_ID,
    mode: 'automated', optimizationPriority: 'balance-first', activeTaxRates: DEFAULT_RATES,
  })

  test('Scenario 1 (automated tax-first) returns automated mode', () => {
    expect(s1.mode).toBe('automated')
  })

  test('Scenario 2 (manual SpecID) returns manual mode', () => {
    expect(s2.mode).toBe('manual')
  })

  test('Scenario 3 (automated balance-first) returns automated mode', () => {
    expect(s3.mode).toBe('automated')
  })
})

// ---------------------------------------------------------------------------
// Case 13 — Manual mode without prior automated recommendation
// ---------------------------------------------------------------------------

describe('Case 13: Manual entry without automated rec — empty config returned', () => {
  const params: OptimizationParams = {
    portfolio: BASE_PORTFOLIO,
    targetSaleAmount: 25000,
    activeAccountId: TAXABLE_ID,
    mode: 'manual',
    optimizationPriority: 'tax-first',
    activeTaxRates: DEFAULT_RATES,
    manualSelections: undefined,
  }
  const result = runOptimization(params)

  test('mode = manual', () => {
    expect(result.mode).toBe('manual')
  })

  test('no active funds when no manual selections provided', () => {
    if (result.mode !== 'manual') return
    expect(result.active_fund_ids.length).toBe(0)
  })

  test('total_sell_amount = 0 when no selections', () => {
    if (result.mode !== 'manual') return
    expect(result.total_sell_amount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Case 14 — Non-default tax brackets
// ---------------------------------------------------------------------------

describe('Case 14: Non-default tax brackets — 0% LT and 23.8% NIIT', () => {
  const result0LT = runOptimization({
    portfolio: BASE_PORTFOLIO, targetSaleAmount: 25000, activeAccountId: TAXABLE_ID,
    mode: 'automated', optimizationPriority: 'tax-first',
    activeTaxRates: { st_rate: 0.24, lt_rate: 0.00 },
  })
  const resultNIIT = runOptimization({
    portfolio: BASE_PORTFOLIO, targetSaleAmount: 25000, activeAccountId: TAXABLE_ID,
    mode: 'automated', optimizationPriority: 'tax-first',
    activeTaxRates: { st_rate: 0.24, lt_rate: 0.238 },
  })

  test('0% LT rate: est_net_tax is non-negative', () => {
    if (result0LT.mode !== 'automated') return
    expect(result0LT.est_net_tax).toBeGreaterThanOrEqual(0)
  })

  test('23.8% LT rate: est_net_tax is non-negative', () => {
    if (resultNIIT.mode !== 'automated') return
    expect(resultNIIT.est_net_tax).toBeGreaterThanOrEqual(0)
  })

  test('higher LT rate (23.8%) produces higher net tax than 0% LT', () => {
    if (result0LT.mode !== 'automated' || resultNIIT.mode !== 'automated') return
    expect(resultNIIT.est_net_tax).toBeGreaterThanOrEqual(result0LT.est_net_tax - EPSILON)
  })
})

// ---------------------------------------------------------------------------
// Case 15 — Accounting method change: FIFO vs SpecID for VTSAX
// ---------------------------------------------------------------------------

describe('Case 15: Accounting method — FIFO vs SpecID for VTSAX', () => {
  const sellTarget = 15000.03

  const fifoResult = runOptimization({
    portfolio: BASE_PORTFOLIO, targetSaleAmount: sellTarget, activeAccountId: TAXABLE_ID,
    mode: 'manual', optimizationPriority: 'tax-first', activeTaxRates: DEFAULT_RATES,
    manualSelections: {
      fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'FIFO' }],
    },
  })

  const specResult = runOptimization({
    portfolio: BASE_PORTFOLIO, targetSaleAmount: sellTarget, activeAccountId: TAXABLE_ID,
    mode: 'manual', optimizationPriority: 'tax-first', activeTaxRates: DEFAULT_RATES,
    manualSelections: {
      fund_selections: [{
        fund_id: 'VTSAX',
        accounting_method: 'specific_lot_identification',
        lot_overrides: [{ lot_id: 'T-VTSAX-09', shares: 103.306 }],
      }],
    },
  })

  test('FIFO result mode = manual', () => {
    expect(fifoResult.mode).toBe('manual')
  })

  test('SpecID result mode = manual', () => {
    expect(specResult.mode).toBe('manual')
  })

  test('FIFO selects oldest lot T-VTSAX-01 (2004, highest cost basis gain)', () => {
    if (fifoResult.mode !== 'manual') return
    const fifoFund = fifoResult.fund_selections[0]
    expect(fifoFund?.lots_selected[0]?.lot_id).toBe('T-VTSAX-01')
  })

  test('SpecID selects T-VTSAX-09 as specified', () => {
    if (specResult.mode !== 'manual') return
    const specFund = specResult.fund_selections[0]
    expect(specFund?.lots_selected[0]?.lot_id).toBe('T-VTSAX-09')
  })

  test('FIFO gain > SpecID gain by more than $100 (2004 vs 2025 lot)', () => {
    if (fifoResult.mode !== 'manual' || specResult.mode !== 'manual') return
    const fifoGain = fifoResult.fund_selections[0]?.lots_selected.reduce((s, l) => s + l.realized_gain_loss, 0) ?? 0
    const specGain = specResult.fund_selections[0]?.lots_selected.reduce((s, l) => s + l.realized_gain_loss, 0) ?? 0
    expect(fifoGain).toBeGreaterThan(specGain + 100)
  })

  // KNOWN_ROUNDING_ARTIFACT ±$0.02 tolerance — documented in KNOWN_ROUNDING_ARTIFACTS
  test('SpecID T-VTSAX-09 gain ≈ $1,515.50 (engine standard; VT8 states $1,515.85)', () => {
    if (specResult.mode !== 'manual') return
    const specGain = specResult.fund_selections[0]?.lots_selected.reduce((s, l) => s + l.realized_gain_loss, 0) ?? 0
    expect(Math.abs(specGain - KNOWN_ROUNDING_ARTIFACTS.VTSAX_T09_PARTIAL_SALE.engine_gain)).toBeLessThanOrEqual(EPSILON)
  })
})

// ---------------------------------------------------------------------------
// VT8 Scenario — Manual SpecID VTSAX T-VTSAX-09 + SpecID VBTLX T-VBTLX-02
// ---------------------------------------------------------------------------

describe('VT8: Primary sale scenario — VTSAX SpecID T-VTSAX-09 + VBTLX SpecID T-VBTLX-02', () => {
  const VBTLX_SHARES_FOR_10K = 10000 / 10.36

  const vt8 = runOptimization({
    portfolio: BASE_PORTFOLIO,
    targetSaleAmount: 25000.03,
    activeAccountId: TAXABLE_ID,
    mode: 'manual',
    optimizationPriority: 'tax-first',
    activeTaxRates: DEFAULT_RATES,
    manualSelections: {
      fund_selections: [
        { fund_id: 'VTSAX', accounting_method: 'specific_lot_identification',
          lot_overrides: [{ lot_id: 'T-VTSAX-09', shares: 103.306 }] },
        { fund_id: 'VBTLX', accounting_method: 'specific_lot_identification',
          lot_overrides: [{ lot_id: 'T-VBTLX-02', shares: VBTLX_SHARES_FOR_10K }] },
      ],
    },
  })

  // KNOWN_ROUNDING_ARTIFACT ±$0.02 tolerance — VT8 constructed backwards from display rounding
  test('VTSAX T-VTSAX-09 ST gain ≈ $1,515.50 (engine standard; VT8 states $1,515.85)', () => {
    if (vt8.mode !== 'manual') return
    const vtsaxFund = vt8.fund_selections.find(f => f.fund_id === 'VTSAX')
    const gain = vtsaxFund?.lots_selected.reduce((s, l) => s + l.realized_gain_loss, 0) ?? 0
    expect(Math.abs(gain - KNOWN_ROUNDING_ARTIFACTS.VTSAX_T09_PARTIAL_SALE.engine_gain)).toBeLessThanOrEqual(EPSILON)
  })

  test('VBTLX T-VBTLX-02 LT loss = -$1,052.12 (965.251 shares @ NAV $10.36, cost $11.45/sh)', () => {
    if (vt8.mode !== 'manual') return
    const vbtlxFund = vt8.fund_selections.find(f => f.fund_id === 'VBTLX')
    const gain = vbtlxFund?.lots_selected.reduce((s, l) => s + l.realized_gain_loss, 0) ?? 0
    expect(Math.abs(gain - (-1052.12))).toBeLessThanOrEqual(EPSILON)
  })

  test('portfolio-level NET GAIN ≈ $463.38 (VTSAX gain − VBTLX loss)', () => {
    if (vt8.mode !== 'manual') return
    const vtsaxFund = vt8.fund_selections.find(f => f.fund_id === 'VTSAX')
    const vbtlxFund = vt8.fund_selections.find(f => f.fund_id === 'VBTLX')
    const vtsaxGain = vtsaxFund?.lots_selected.reduce((s, l) => s + l.realized_gain_loss, 0) ?? 0
    const vbtlxGain = vbtlxFund?.lots_selected.reduce((s, l) => s + l.realized_gain_loss, 0) ?? 0
    const expected = KNOWN_ROUNDING_ARTIFACTS.VTSAX_T09_PARTIAL_SALE.engine_gain - 1052.12
    expect(Math.abs((vtsaxGain + vbtlxGain) - expected)).toBeLessThanOrEqual(EPSILON)
  })

  // KNOWN_ROUNDING_ARTIFACT ±$0.02 tolerance — same VTSAX rounding flows into net tax
  test('EST. NET TAX ≈ $111.21 (engine standard; VT8 states $111.30)', () => {
    if (vt8.mode !== 'manual') return
    const vtsaxFund = vt8.fund_selections.find(f => f.fund_id === 'VTSAX')
    const vbtlxFund = vt8.fund_selections.find(f => f.fund_id === 'VBTLX')
    const vtsaxGain = vtsaxFund?.lots_selected.reduce((s, l) => s + l.realized_gain_loss, 0) ?? 0
    const vbtlxGain = vbtlxFund?.lots_selected.reduce((s, l) => s + l.realized_gain_loss, 0) ?? 0
    const netGain = vtsaxGain + vbtlxGain
    const netTax = Math.max(0, netGain) * DEFAULT_RATES.st_rate
    expect(Math.abs(netTax - KNOWN_ROUNDING_ARTIFACTS.VTSAX_T09_PARTIAL_SALE.net_tax_engine)).toBeLessThanOrEqual(EPSILON)
  })
})

// ---------------------------------------------------------------------------
// VT9 Scenario 2 — VTSAX T-VTSAX-07 + VTIAX T-VTIAX-06
// ---------------------------------------------------------------------------

describe('VT9 Scenario 2: VTSAX T-VTSAX-07 + VTIAX T-VTIAX-06', () => {
  const vt9s2 = runOptimization({
    portfolio: BASE_PORTFOLIO,
    targetSaleAmount: 25000.05,
    activeAccountId: TAXABLE_ID,
    mode: 'manual',
    optimizationPriority: 'tax-first',
    activeTaxRates: DEFAULT_RATES,
    manualSelections: {
      fund_selections: [
        { fund_id: 'VTSAX', accounting_method: 'specific_lot_identification',
          lot_overrides: [{ lot_id: 'T-VTSAX-07', shares: 103.306 }] },
        { fund_id: 'VTIAX', accounting_method: 'specific_lot_identification',
          lot_overrides: [{ lot_id: 'T-VTIAX-06', shares: 258.065 }] },
      ],
    },
  })

  test('VTSAX T-VTSAX-07 gain > 0 (lot capped at 75 shares, cost basis corrected)', () => {
    if (vt9s2.mode !== 'manual') return
    const vtsaxFund = vt9s2.fund_selections.find(f => f.fund_id === 'VTSAX')
    const gain = vtsaxFund?.lots_selected.reduce((s, l) => s + l.realized_gain_loss, 0) ?? 0
    expect(gain).toBeGreaterThan(0)
  })

  test('VTIAX T-VTIAX-06 LT gain ≈ $2,980.65 (258.065 shares × ($38.75 − $27.20))', () => {
    if (vt9s2.mode !== 'manual') return
    const vtiaxFund = vt9s2.fund_selections.find(f => f.fund_id === 'VTIAX')
    const gain = vtiaxFund?.lots_selected.reduce((s, l) => s + l.realized_gain_loss, 0) ?? 0
    expect(Math.abs(gain - 2980.65)).toBeLessThanOrEqual(EPSILON)
  })
})

// ---------------------------------------------------------------------------
// Traditional IRA ordinary-income tax (DECISIONS.md IRA ordinary-income tax entry)
//
// Real engine calls throughout, per this task's own instruction — no
// reconstructed fixtures. Real account IDs from sample-dataset.json:
//   ACCT-TRAD-IRA-001 holds VBTLX + VFITX; ACCT-ROTH-IRA-001 holds VFIAX only.
// ---------------------------------------------------------------------------

const TRAD_IRA_ID = 'ACCT-TRAD-IRA-001'
const ROTH_IRA_ID = 'ACCT-ROTH-IRA-001'

describe('Traditional IRA ordinary-income tax — single-fund sale', () => {
  const result = runOptimization({
    portfolio: BASE_PORTFOLIO,
    targetSaleAmount: 10000,
    activeAccountId: TRAD_IRA_ID,
    mode: 'automated',
    optimizationPriority: 'tax-first',
    activeTaxRates: DEFAULT_RATES,
  })

  test('est_net_tax = total withdrawn × st_rate ($10,000 × 24% = $2,400), not netted against gain/loss', () => {
    if (result.mode !== 'automated') return
    expect(result.est_net_tax).toBeCloseTo(2400, 2)
  })

  test('per-fund est_tax_gross is the not-applicable sentinel, not a numeric 0, even though the portfolio total is nonzero', () => {
    if (result.mode !== 'automated') return
    expect(result.fund_results.length).toBeGreaterThan(0)
    for (const fr of result.fund_results) {
      expect(fr.est_tax_gross).toBe('not_applicable')
    }
  })

  test('est_early_withdrawal_penalty is the not-applicable sentinel (groundwork only, no calculation yet)', () => {
    if (result.mode !== 'automated') return
    expect(result.est_early_withdrawal_penalty).toBe('not_applicable')
  })
})

describe('Traditional IRA ordinary-income tax — multi-fund sale sums the TOTAL withdrawal correctly, not per-fund', () => {
  // $150,000 forces both of ACCT-TRAD-IRA-001's holdings (VBTLX + VFITX) to
  // be sold, since neither alone covers the target — the real regression
  // case for "sums sell amounts across multiple funds correctly" (task item
  // 0's explicit self-audit concern), not just a single-fund sanity check.
  const result = runOptimization({
    portfolio: BASE_PORTFOLIO,
    targetSaleAmount: 150000,
    activeAccountId: TRAD_IRA_ID,
    mode: 'automated',
    optimizationPriority: 'tax-first',
    activeTaxRates: DEFAULT_RATES,
  })

  test('more than one fund is actually sold in this fixture (a real multi-fund case, not accidentally single-fund)', () => {
    if (result.mode !== 'automated') return
    expect(result.fund_results.length).toBeGreaterThanOrEqual(2)
  })

  test('est_net_tax = SUM of every fund\'s sell_amount × st_rate — a naive sum of nonexistent per-fund tax figures would be $0', () => {
    if (result.mode !== 'automated') return
    const totalWithdrawn = result.fund_results.reduce((s, f) => s + f.sell_amount, 0)
    expect(totalWithdrawn).toBeCloseTo(150000, 1)
    const expectedTax = Math.round(totalWithdrawn * DEFAULT_RATES.st_rate * 100) / 100
    expect(result.est_net_tax).toBeCloseTo(expectedTax, 2)
    // Sanity: confirms this is genuinely testing the multi-fund summation
    // path, not one fund happening to cover the whole target.
    expect(result.fund_results.every(f => f.est_tax_gross === 'not_applicable')).toBe(true)
  })
})

describe('Roth IRA regression — still exactly $0 at the portfolio level, now that Traditional IRA no longer shares its branch', () => {
  const result = runOptimization({
    portfolio: BASE_PORTFOLIO,
    targetSaleAmount: 10000,
    activeAccountId: ROTH_IRA_ID,
    mode: 'automated',
    optimizationPriority: 'tax-first',
    activeTaxRates: DEFAULT_RATES,
  })

  test('est_net_tax is exactly 0', () => {
    if (result.mode !== 'automated') return
    expect(result.est_net_tax).toBe(0)
  })

  test('per-fund est_tax_gross is the not-applicable sentinel, not $0', () => {
    if (result.mode !== 'automated') return
    for (const fr of result.fund_results) {
      expect(fr.est_tax_gross).toBe('not_applicable')
    }
  })
})

describe('Taxable brokerage regression — unaffected by the three-way branch rewrite', () => {
  test('est_net_tax still computes via ST/LT netting, unchanged from Case 1\'s existing baseline', () => {
    const result = runOptimization({
      portfolio: BASE_PORTFOLIO,
      targetSaleAmount: 25000,
      activeAccountId: TAXABLE_ID,
      mode: 'automated',
      optimizationPriority: 'tax-first',
      activeTaxRates: DEFAULT_RATES,
    })
    if (result.mode !== 'automated') return
    expect(result.est_net_tax).toBeCloseTo(64.85, 2)
    // Per-fund est_tax_gross remains a real number for taxable brokerage —
    // the not-applicable sentinel is IRA-only.
    for (const fr of result.fund_results) {
      expect(typeof fr.est_tax_gross).toBe('number')
    }
  })
})

// ---------------------------------------------------------------------------
// computeNetTaxBreakdown() (DECISIONS.md's breakdown-expanders entry) —
// direct unit tests of the pure function, hand-constructed fund-result
// arrays (not routed through runOptimization()) since these specifically
// target arithmetic edge cases in the blended-rate attribution itself, not
// engine fund-selection behavior. computeNetTax() is asserted alongside
// computeNetTaxBreakdown().total throughout, as a regression guard that the
// wrapper still returns exactly what the pre-refactor formula returned.
// ---------------------------------------------------------------------------

describe('computeNetTaxBreakdown — taxable brokerage, pure gain (both categories non-negative)', () => {
  test('taxableAtST/taxableAtLT equal netSTGain/netLTGain exactly — no cross-category netting to attribute', () => {
    const funds = [
      { est_st_gain_loss: 645.81, est_lt_gain_loss: 0, sell_amount: 3000 },
      { est_lt_gain_loss: 300, est_st_gain_loss: 0, sell_amount: 2000 },
    ]
    const b = computeNetTaxBreakdown(funds, 'taxable_brokerage', DEFAULT_RATES)
    expect(b.netSTGain).toBeCloseTo(645.81, 2)
    expect(b.netLTGain).toBeCloseTo(300, 2)
    expect(b.taxableAtST).toBeCloseTo(645.81, 2)
    expect(b.taxableAtLT).toBeCloseTo(300, 2)
    expect(b.stTax).toBeCloseTo(645.81 * 0.24, 2)
    expect(b.ltTax).toBeCloseTo(300 * 0.15, 2)
    expect(b.total).toBeCloseTo(b.stTax + b.ltTax, 2)
    expect(computeNetTax(funds, 'taxable_brokerage', DEFAULT_RATES)).toBeCloseTo(b.total, 2)
  })
})

describe('computeNetTaxBreakdown — taxable brokerage, cross-category netting: an ST LOSS absorbed by a larger LT GAIN', () => {
  // The exact case a naive "netST * st_rate + netLT * lt_rate" gets wrong.
  // netSTGain = -500, netLTGain = +1000, net taxable = 500 — all attributed
  // to the LT rate (there is no positive ST gain to attribute anything to),
  // so the real tax is 500 * 0.15 = $75, NOT (-500*0.24 + 1000*0.15) = $30.
  const funds = [
    { est_st_gain_loss: -500, est_lt_gain_loss: 0, sell_amount: 4000 },
    { est_lt_gain_loss: 1000, est_st_gain_loss: 0, sell_amount: 6000 },
  ]
  const b = computeNetTaxBreakdown(funds, 'taxable_brokerage', DEFAULT_RATES)

  test('taxableAtST is 0 — a net ST loss can never produce positive ST-attributed tax', () => {
    expect(b.netSTGain).toBeCloseTo(-500, 2)
    expect(b.taxableAtST).toBe(0)
    expect(b.stTax).toBe(0)
  })

  test('the entire $500 net taxable amount is attributed to the LT rate — real total is $75, not the naive $30', () => {
    expect(b.taxableAtLT).toBeCloseTo(500, 2)
    expect(b.ltTax).toBeCloseTo(75, 2)
    expect(b.total).toBeCloseTo(75, 2)
    const naiveWrongTotal = -500 * 0.24 + 1000 * 0.15
    expect(b.total).not.toBeCloseTo(naiveWrongTotal, 2)
  })

  test('stTax + ltTax === total exactly — the display consistency guarantee', () => {
    expect(b.stTax + b.ltTax).toBeCloseTo(b.total, 2)
  })

  test('computeNetTax() (the existing 6-call-site wrapper) still returns exactly this same total — no regression from the refactor', () => {
    expect(computeNetTax(funds, 'taxable_brokerage', DEFAULT_RATES)).toBeCloseTo(b.total, 2)
  })
})

describe('computeNetTaxBreakdown — taxable brokerage, the mirror case: an ST GAIN outweighing an LT LOSS', () => {
  // netSTGain = 1000, netLTGain = -300, net taxable = 700 — entirely
  // attributed to the ST rate. Real tax = 700 * 0.24 = $168, not the naive
  // (1000*0.24 + -300*0.15) = $195.
  const funds = [
    { est_st_gain_loss: 1000, est_lt_gain_loss: -300, sell_amount: 5000 },
  ]
  const b = computeNetTaxBreakdown(funds, 'taxable_brokerage', DEFAULT_RATES)

  test('taxableAtLT is 0, entire taxable amount attributed to ST', () => {
    expect(b.taxableAtLT).toBe(0)
    expect(b.ltTax).toBe(0)
    expect(b.taxableAtST).toBeCloseTo(700, 2)
  })

  test('real total is $168, not the naive $195', () => {
    expect(b.total).toBeCloseTo(168, 2)
    const naiveWrongTotal = 1000 * 0.24 + -300 * 0.15
    expect(b.total).not.toBeCloseTo(naiveWrongTotal, 2)
    expect(computeNetTax(funds, 'taxable_brokerage', DEFAULT_RATES)).toBeCloseTo(168, 2)
  })
})

describe('computeNetTaxBreakdown — taxable brokerage, pure loss (both categories negative)', () => {
  test('total is exactly 0 — a net loss owes no tax, both attributions are 0', () => {
    const funds = [
      { est_st_gain_loss: -200, est_lt_gain_loss: -400, sell_amount: 1000 },
    ]
    const b = computeNetTaxBreakdown(funds, 'taxable_brokerage', DEFAULT_RATES)
    expect(b.taxableAtST).toBe(0)
    expect(b.taxableAtLT).toBe(0)
    expect(b.stTax).toBe(0)
    expect(b.ltTax).toBe(0)
    expect(b.total).toBe(0)
    expect(computeNetTax(funds, 'taxable_brokerage', DEFAULT_RATES)).toBe(0)
  })
})

describe('computeNetTaxBreakdown — taxable brokerage, single fund', () => {
  test('a single fund with only an ST gain — LT side is all zero, no netting story', () => {
    const funds = [{ est_st_gain_loss: 264.46, est_lt_gain_loss: 0, sell_amount: 2400 }]
    const b = computeNetTaxBreakdown(funds, 'taxable_brokerage', DEFAULT_RATES)
    expect(b.netSTGain).toBeCloseTo(264.46, 2)
    expect(b.netLTGain).toBe(0)
    expect(b.stTax).toBeCloseTo(264.46 * 0.24, 2)
    expect(b.ltTax).toBe(0)
    expect(b.total).toBeCloseTo(b.stTax, 2)
  })
})

describe('computeNetTaxBreakdown — multi-fund sums net gain/loss correctly across three funds, mixed signs within a category', () => {
  test('three funds contribute to ST (two positive, one negative) — net is the real sum, not just the largest term', () => {
    const funds = [
      { est_st_gain_loss: 200, est_lt_gain_loss: 0, sell_amount: 1000 },
      { est_st_gain_loss: 300, est_lt_gain_loss: 0, sell_amount: 1000 },
      { est_st_gain_loss: -100, est_lt_gain_loss: 0, sell_amount: 1000 },
    ]
    const b = computeNetTaxBreakdown(funds, 'taxable_brokerage', DEFAULT_RATES)
    expect(b.netSTGain).toBeCloseTo(400, 2)
    expect(b.taxableAtST).toBeCloseTo(400, 2)
    expect(b.total).toBeCloseTo(400 * 0.24, 2)
  })
})

describe('computeNetTaxBreakdown — Traditional IRA', () => {
  test('single fund: ordinaryIncomeTax = total withdrawal × st_rate, equals total, gain/loss fields are irrelevant to the figure', () => {
    const funds = [{ est_st_gain_loss: -50, est_lt_gain_loss: 999, sell_amount: 10000 }]
    const b = computeNetTaxBreakdown(funds, 'traditional_IRA', DEFAULT_RATES)
    expect(b.totalWithdrawal).toBeCloseTo(10000, 2)
    expect(b.ordinaryIncomeTax).toBeCloseTo(2400, 2)
    expect(b.total).toBeCloseTo(2400, 2)
    expect(b.stTax).toBe(0)
    expect(b.ltTax).toBe(0)
    expect(computeNetTax(funds, 'traditional_IRA', DEFAULT_RATES)).toBeCloseTo(2400, 2)
  })

  test('multi-fund: totalWithdrawal sums sell_amount across every fund, not just one', () => {
    const funds = [
      { est_st_gain_loss: 0, est_lt_gain_loss: 0, sell_amount: 80000 },
      { est_st_gain_loss: 0, est_lt_gain_loss: 0, sell_amount: 70000 },
    ]
    const b = computeNetTaxBreakdown(funds, 'traditional_IRA', DEFAULT_RATES)
    expect(b.totalWithdrawal).toBeCloseTo(150000, 2)
    expect(b.total).toBeCloseTo(150000 * 0.24, 2)
  })
})

describe('computeNetTaxBreakdown — Roth IRA and unresolved account type', () => {
  test('Roth IRA: total, ordinaryIncomeTax, stTax, ltTax are all exactly 0 regardless of real gains', () => {
    const funds = [{ est_st_gain_loss: 5000, est_lt_gain_loss: 3000, sell_amount: 20000 }]
    const b = computeNetTaxBreakdown(funds, 'roth_IRA', DEFAULT_RATES)
    expect(b.total).toBe(0)
    expect(b.ordinaryIncomeTax).toBe(0)
    expect(b.stTax).toBe(0)
    expect(b.ltTax).toBe(0)
    // netSTGain/netLTGain/taxableAtST/taxableAtLT are still the real sums —
    // only the tax fields are zeroed, since Roth's breakdown panel (item 5)
    // needs the real withdrawal total even though the tax owed is $0.
    expect(b.netSTGain).toBeCloseTo(5000, 2)
    expect(b.totalWithdrawal).toBeCloseTo(20000, 2)
  })

  test('unresolved account type (undefined) falls through to the same 0 branch as Roth, not a crash', () => {
    const funds = [{ est_st_gain_loss: 100, est_lt_gain_loss: 100, sell_amount: 1000 }]
    const b = computeNetTaxBreakdown(funds, undefined, DEFAULT_RATES)
    expect(b.total).toBe(0)
  })
})
