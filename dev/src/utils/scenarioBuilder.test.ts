/**
 * scenarioBuilder.ts tests — Manual mode IRA tax fix (DECISIONS.md).
 *
 * Covers buildScenarioFromFundResults()'s portfolio-level net tax, now that
 * it calls the shared computeNetTax() (engine/index.ts) instead of its own
 * hand-copied taxable-only gate. Same discipline as engine.test.ts and
 * narration.test.ts: every fixture is a real runOptimization() call against
 * the real dataset, never a hand-typed FundSaleResult[].
 *
 * Real account IDs (sample-dataset.json): ACCT-TRAD-IRA-001 holds
 * VBTLX + VFITX; ACCT-ROTH-IRA-001 holds VFIAX only;
 * ACCT-TAXABLE-001 holds VTSAX/VTIAX/VBIRX/VBTLX.
 */

import { describe, test, expect } from 'vitest'
import { loadPortfolio } from '../data/loader'
import { runOptimization, type ManualSelections } from '../engine/index'
import { buildScenarioFromFundResults } from './scenarioBuilder'
import type { ManualConfiguration } from '../types'

const portfolio = loadPortfolio()
const TAX_RATES = { st_rate: 0.24, lt_rate: 0.15 }
const TAXABLE = 'ACCT-TAXABLE-001'
const TRAD_IRA = 'ACCT-TRAD-IRA-001'
const ROTH_IRA = 'ACCT-ROTH-IRA-001'

function manualRun(accountId: string, targetSaleAmount: number, selections: ManualSelections): ManualConfiguration {
  return runOptimization({
    portfolio, targetSaleAmount, activeAccountId: accountId, mode: 'manual',
    optimizationPriority: 'tax-first', activeTaxRates: TAX_RATES, manualSelections: selections,
  }) as ManualConfiguration
}

describe('buildScenarioFromFundResults — Traditional IRA single-fund', () => {
  const config = manualRun(TRAD_IRA, 8000, { fund_selections: [{ fund_id: 'VFITX', accounting_method: 'MinTax', sell_amount: 8000 }] })
  const scenario = buildScenarioFromFundResults(config.fund_results, portfolio, TAX_RATES, config.allocation_impact, TRAD_IRA)

  test('est_net_tax = total withdrawn × st_rate ($8,000 × 24% = $1,920), not netted against gain/loss', () => {
    expect(scenario).not.toBeNull()
    expect(scenario!.est_net_tax).toBeCloseTo(1920, 2)
  })

  test('per-fund est_tax_gross is the not-applicable sentinel, not $0', () => {
    for (const fs of scenario!.fund_selections) {
      expect(fs.est_tax_gross).toBe('not_applicable')
    }
  })
})

describe('buildScenarioFromFundResults — Traditional IRA multi-fund sums the TOTAL withdrawal, not per-fund', () => {
  // VBTLX $5,000 + VFITX $6,000 — a real 2-fund manual selection within one
  // account, the specific regression this fix targets (a naive per-fund
  // sum of nonexistent tax figures would produce $0, not $2,640).
  const config = manualRun(TRAD_IRA, 11000, { fund_selections: [
    { fund_id: 'VBTLX', accounting_method: 'MinTax', sell_amount: 5000 },
    { fund_id: 'VFITX', accounting_method: 'MinTax', sell_amount: 6000 },
  ] })
  const scenario = buildScenarioFromFundResults(config.fund_results, portfolio, TAX_RATES, config.allocation_impact, TRAD_IRA)

  test('both funds are genuinely present in this fixture', () => {
    expect(scenario!.fund_selections.length).toBe(2)
  })

  test('est_net_tax = SUM of both funds\' sell_amount × st_rate ($11,000 × 24% = $2,640)', () => {
    expect(scenario!.total_sell_amount).toBeCloseTo(11000, 1)
    expect(scenario!.est_net_tax).toBeCloseTo(2640, 2)
  })
})

describe('buildScenarioFromFundResults — Roth IRA regression, still exactly $0', () => {
  const config = manualRun(ROTH_IRA, 5000, { fund_selections: [{ fund_id: 'VFIAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
  const scenario = buildScenarioFromFundResults(config.fund_results, portfolio, TAX_RATES, config.allocation_impact, ROTH_IRA)

  test('est_net_tax is exactly 0', () => {
    expect(scenario!.est_net_tax).toBe(0)
  })

  test('per-fund est_tax_gross is the not-applicable sentinel, not $0', () => {
    for (const fs of scenario!.fund_selections) {
      expect(fs.est_tax_gross).toBe('not_applicable')
    }
  })
})

describe('buildScenarioFromFundResults — taxable brokerage regression, unaffected by the computeNetTax() consolidation', () => {
  // $5,000 MinTax VTSAX — the same real fixture narration.test.ts's "pure
  // gain" category uses, with the same known-real $105.78 tax figure.
  const config = manualRun(TAXABLE, 5000, { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] })
  const scenario = buildScenarioFromFundResults(config.fund_results, portfolio, TAX_RATES, config.allocation_impact, TAXABLE)

  test('est_net_tax still computes via ST/LT netting, unchanged ($105.78)', () => {
    expect(scenario!.est_net_tax).toBeCloseTo(105.78, 2)
  })

  test('per-fund est_tax_gross remains a real number for taxable brokerage', () => {
    for (const fs of scenario!.fund_selections) {
      expect(typeof fs.est_tax_gross).toBe('number')
    }
  })
})
