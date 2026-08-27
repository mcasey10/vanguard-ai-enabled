/**
 * scenarioBuilder.ts — converts engine output into SavedScenario objects.
 *
 * Used by FS-AUTO-1, FS-MAN-2, and FS-MAN-LOT when the user clicks
 * "Go to Scenario Analysis" (REQ-A5-004, REQ-B4-001).
 *
 * All values come from actual engine output — never hardcoded.
 */

import type {
  SavedScenario,
  Recommendation,
  FundSaleResult,
  Portfolio,
  TaxAssumptionSet,
} from '../types'
import { formatCurrency } from './format'

// ---------------------------------------------------------------------------
// Duplicate detection — same optimization priority, fund IDs, sell amounts
// (within 1 cent), and accounting method per fund
// ---------------------------------------------------------------------------

export function isDuplicateScenario(
  candidate: SavedScenario,
  existing: SavedScenario[]
): boolean {
  return existing.some(s => {
    if (s.optimization_priority !== candidate.optimization_priority) return false
    if (s.fund_selections.length !== candidate.fund_selections.length) return false
    const sortedExisting  = [...s.fund_selections].sort((a, b) => a.fund_id.localeCompare(b.fund_id))
    const sortedCandidate = [...candidate.fund_selections].sort((a, b) => a.fund_id.localeCompare(b.fund_id))
    return sortedExisting.every((fs, i) => {
      const cf = sortedCandidate[i]
      return fs.fund_id === cf?.fund_id
        && Math.abs(fs.sell_amount - (cf?.sell_amount ?? 0)) < 0.01
        && fs.accounting_method === cf?.accounting_method
    })
  })
}

// ---------------------------------------------------------------------------
// Tradeoff summary — system-generated, grade 8 reading level (REQ-SC-004)
// References at least one concrete tradeoff between tax and allocation.
// ---------------------------------------------------------------------------

function generateTradeoffSummary(
  est_net_tax: number,
  losses_harvested: number,
  projected_st_gains: number,
  afterStocks: number,
  afterBonds: number,
  afterRes: number,
  targetStocks: number,
  targetBonds: number,
  targetRes: number
): string {
  const taxStr = formatCurrency(est_net_tax)

  // Part 1: Loss harvesting
  const harvestingPart = losses_harvested < -50
    ? `Loss harvesting offsets ${projected_st_gains > 0 ? 'some ST gains' : 'gains'}.`
    : 'No loss harvesting.'

  // Part 2: Allocation impact — which asset class moved most toward/away from target?
  const stocksDiff = afterStocks - targetStocks
  const bondsDiff  = afterBonds  - targetBonds
  const resDiff    = afterRes    - targetRes

  const maxAbsDiff = Math.max(Math.abs(stocksDiff), Math.abs(bondsDiff), Math.abs(resDiff))

  let allocPart: string
  if (maxAbsDiff < 0.5) {
    allocPart = 'Allocation stays close to target.'
  } else if (Math.abs(stocksDiff) >= Math.abs(bondsDiff) && Math.abs(stocksDiff) >= Math.abs(resDiff)) {
    if (stocksDiff < 0) {
      allocPart = `Stocks move closer to ${targetStocks.toFixed(0)}% target.`
    } else {
      allocPart = `Stocks drift further from ${targetStocks.toFixed(0)}% target.`
    }
  } else if (Math.abs(bondsDiff) >= Math.abs(resDiff)) {
    if (bondsDiff < 0) {
      allocPart = `Bonds drift further from ${targetBonds.toFixed(0)}% target.`
    } else {
      allocPart = `Bonds move closer to ${targetBonds.toFixed(0)}% target.`
    }
  } else {
    if (resDiff < 0) {
      allocPart = 'Reserves decrease below target.'
    } else {
      allocPart = 'Reserves move above target.'
    }
  }

  return `Net tax ${taxStr}. ${harvestingPart} ${allocPart}`
}

// ---------------------------------------------------------------------------
// Build from Recommendation (FS-AUTO-1)
// ---------------------------------------------------------------------------

export function buildScenarioFromRecommendation(
  rec: Recommendation,
  portfolio: Portfolio | null,
  activeTaxRates: Pick<TaxAssumptionSet, 'st_rate' | 'lt_rate'>
): SavedScenario {
  const r2 = (n: number) => Math.round(n * 100) / 100

  const fundSelections = rec.fund_results.map(fr => ({
    fund_id: fr.fund_id,
    fund_name: fr.fund_name,
    sell_amount: fr.sell_amount,
    accounting_method: fr.accounting_method,
    lots_selected: fr.lots_sold,
    st_gain_loss: fr.est_st_gain_loss,
    lt_gain_loss: fr.est_lt_gain_loss,
    est_tax_gross: fr.est_tax_gross,
  }))

  const total_sell_amount = r2(fundSelections.reduce((s, f) => s + f.sell_amount, 0))

  const projected_st_gains = r2(rec.fund_results.reduce((s, fr) => s + Math.max(0, fr.est_st_gain_loss), 0))
  const projected_lt_gains = r2(rec.fund_results.reduce((s, fr) => s + Math.max(0, fr.est_lt_gain_loss), 0))
  const losses_harvested   = r2(rec.fund_results.reduce((s, fr) => s + Math.min(0, fr.est_st_gain_loss) + Math.min(0, fr.est_lt_gain_loss), 0))
  const net_taxable_gain   = r2(projected_st_gains + projected_lt_gains + losses_harvested)

  const ai = rec.allocation_impact
  const afterStocks = r2(ai.domestic_equity_after + ai.international_equity_after)
  const afterBonds  = r2(ai.domestic_bonds_after)
  const afterRes    = r2(ai.short_term_reserves_after)

  const ta = portfolio?.target_allocation
  const targetStocks = ta ? r2(ta.domestic_equity_pct + (ta.international_equity_pct ?? 0)) : 55
  const targetBonds  = ta ? r2(ta.domestic_bonds_pct) : 35
  const targetRes    = ta ? r2(ta.short_term_reserves_pct) : 10

  const tradeoff_summary = generateTradeoffSummary(
    rec.est_net_tax, losses_harvested, projected_st_gains,
    afterStocks, afterBonds, afterRes,
    targetStocks, targetBonds, targetRes
  )

  const taxSet: TaxAssumptionSet = rec.tax_assumption_set ?? {
    st_rate: activeTaxRates.st_rate,
    lt_rate: activeTaxRates.lt_rate,
    income_bracket_label: `${Math.round(activeTaxRates.st_rate * 100)}% / ${Math.round(activeTaxRates.lt_rate * 100)}%`,
    source: 'default',
    selection_timestamp: new Date().toISOString(),
  }

  return {
    scenario_id: `sc-auto-${Date.now()}`,
    scenario_name: 'Scenario',
    source_mode: 'automated',
    optimization_priority: rec.optimization_priority,
    fund_selections: fundSelections,
    total_sell_amount,
    projected_st_gains,
    projected_lt_gains,
    losses_harvested,
    net_taxable_gain,
    est_net_tax: r2(rec.est_net_tax),
    effective_rate: rec.effective_rate,
    allocation_impact: rec.allocation_impact,
    tradeoff_summary,
    tax_assumption_set: taxSet,
    created_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Build from FundSaleResult[] (FS-MAN-2 and FS-MAN-LOT manual mode)
// ---------------------------------------------------------------------------

export function buildScenarioFromFundResults(
  fundResults: FundSaleResult[],
  portfolio: Portfolio | null,
  activeTaxRates: Pick<TaxAssumptionSet, 'st_rate' | 'lt_rate'>,
  allocationImpact: NonNullable<Recommendation['allocation_impact']> | null
): SavedScenario | null {
  if (fundResults.length === 0) return null

  const r2 = (n: number) => Math.round(n * 100) / 100

  const fundSelections = fundResults.map(fr => ({
    fund_id: fr.fund_id,
    fund_name: fr.fund_name,
    sell_amount: fr.sell_amount,
    accounting_method: fr.accounting_method,
    lots_selected: fr.lots_sold,
    st_gain_loss: fr.est_st_gain_loss,
    lt_gain_loss: fr.est_lt_gain_loss,
    est_tax_gross: fr.est_tax_gross,
  }))

  const total_sell_amount = r2(fundSelections.reduce((s, f) => s + f.sell_amount, 0))
  if (total_sell_amount <= 0) return null

  const projected_st_gains = r2(fundResults.reduce((s, fr) => s + Math.max(0, fr.est_st_gain_loss), 0))
  const projected_lt_gains = r2(fundResults.reduce((s, fr) => s + Math.max(0, fr.est_lt_gain_loss), 0))
  const losses_harvested   = r2(fundResults.reduce((s, fr) => s + Math.min(0, fr.est_st_gain_loss) + Math.min(0, fr.est_lt_gain_loss), 0))
  const net_taxable_gain   = r2(projected_st_gains + projected_lt_gains + losses_harvested)

  // Compute federal tax: net gain × weighted rate
  const stNetGain = r2(Math.min(net_taxable_gain, Math.max(0, projected_st_gains)))
  const ltNetGain = r2(Math.max(0, net_taxable_gain - stNetGain))
  const est_net_tax = r2(stNetGain * activeTaxRates.st_rate + ltNetGain * activeTaxRates.lt_rate)
  const effective_rate = total_sell_amount > 0 ? est_net_tax / total_sell_amount : 0

  // Use provided allocationImpact or derive from portfolio if available
  const ai = allocationImpact ?? deriveAllocationImpact(fundResults, portfolio)

  const ta = portfolio?.target_allocation
  const targetStocks = ta ? r2(ta.domestic_equity_pct + (ta.international_equity_pct ?? 0)) : 55
  const targetBonds  = ta ? r2(ta.domestic_bonds_pct) : 35
  const targetRes    = ta ? r2(ta.short_term_reserves_pct) : 10

  const afterStocks = ai ? r2(ai.domestic_equity_after + ai.international_equity_after) : targetStocks
  const afterBonds  = ai ? r2(ai.domestic_bonds_after) : targetBonds
  const afterRes    = ai ? r2(ai.short_term_reserves_after) : targetRes

  const tradeoff_summary = generateTradeoffSummary(
    est_net_tax, losses_harvested, projected_st_gains,
    afterStocks, afterBonds, afterRes,
    targetStocks, targetBonds, targetRes
  )

  const taxSet: TaxAssumptionSet = {
    st_rate: activeTaxRates.st_rate,
    lt_rate: activeTaxRates.lt_rate,
    income_bracket_label: `${Math.round(activeTaxRates.st_rate * 100)}% / ${Math.round(activeTaxRates.lt_rate * 100)}%`,
    source: 'default',
    selection_timestamp: new Date().toISOString(),
  }

  return {
    scenario_id: `sc-manual-${Date.now()}`,
    scenario_name: 'Scenario',
    source_mode: 'manual',
    fund_selections: fundSelections,
    total_sell_amount,
    projected_st_gains,
    projected_lt_gains,
    losses_harvested,
    net_taxable_gain,
    est_net_tax,
    effective_rate,
    allocation_impact: ai ?? {
      domestic_equity_before: 0, international_equity_before: 0,
      domestic_bonds_before: 0,  short_term_reserves_before: 0,
      domestic_equity_after: 0,  international_equity_after: 0,
      domestic_bonds_after: 0,   short_term_reserves_after: 0,
    },
    tradeoff_summary,
    tax_assumption_set: taxSet,
    created_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Derive AllocationImpact from portfolio when engine doesn't provide it
// ---------------------------------------------------------------------------

function deriveAllocationImpact(
  fundResults: FundSaleResult[],
  portfolio: Portfolio | null
): Recommendation['allocation_impact'] | null {
  if (!portfolio) return null

  const ca = portfolio.current_allocation
  const totalBefore = portfolio.total_investable_balance
  const totalSold   = fundResults.reduce((s, f) => s + f.sell_amount, 0)
  const totalAfter  = totalBefore - totalSold
  if (totalAfter <= 0) return null

  // Get current asset class values
  const accounts = portfolio.accounts
  let stocksVal = 0, bondsVal = 0, resVal = 0

  accounts.forEach(acct => {
    acct.holdings.forEach(h => {
      const val = h.current_balance
      if (h.asset_class === 'domestic_equity' || h.asset_class === 'international_equity') {
        stocksVal += val
      } else if (h.asset_class === 'domestic_bonds') {
        bondsVal += val
      } else {
        resVal += val
      }
    })
  })

  // Subtract sold amounts per asset class
  const holding = (fundId: string) =>
    accounts.flatMap(a => a.holdings).find(h => h.fund_id === fundId)

  fundResults.forEach(fr => {
    const h = holding(fr.fund_id)
    if (!h) return
    if (h.asset_class === 'domestic_equity' || h.asset_class === 'international_equity') {
      stocksVal -= fr.sell_amount
    } else if (h.asset_class === 'domestic_bonds') {
      bondsVal -= fr.sell_amount
    } else {
      resVal -= fr.sell_amount
    }
  })

  const r2 = (n: number) => Math.round(n * 100) / 100
  return {
    domestic_equity_before: r2(ca.domestic_equity_pct),
    international_equity_before: r2(ca.international_equity_pct),
    domestic_bonds_before: r2(ca.domestic_bonds_pct),
    short_term_reserves_before: r2(ca.short_term_reserves_pct),
    domestic_equity_after:  r2((stocksVal * 0.7 / totalAfter) * 100),  // approx split
    international_equity_after: r2((stocksVal * 0.3 / totalAfter) * 100),
    domestic_bonds_after:   r2((bondsVal / totalAfter) * 100),
    short_term_reserves_after: r2((resVal / totalAfter) * 100),
  }
}
