/**
 * Converts each touchpoint's existing engine-computed data into the shared
 * NarrationInput shape (CLAUDE.md §7: "one spec, four call sites, not four
 * bespoke specs"). Each function here is a pure adapter — no calculation,
 * only reshaping figures the engine already produced.
 */

import type {
  Portfolio, Recommendation, SavedScenario, ManualConfiguration,
  TransactionRecord, FundSaleResult, AccountingMethod, AllocationImpact,
} from '../types'
import { getMarketContextData } from '../data/loader'
import {
  buildMarketContext,
  type NarrationInput, type NarrationFundLine, type NarrationSegment,
  type NarrationTouchpoint, type NarrationAllocationImpact,
} from './narrationShared'

function findFund(portfolio: Portfolio, fundId: string): { fund_name: string; asset_class: string } {
  for (const acct of portfolio.accounts) {
    const h = acct.holdings.find(h => h.fund_id === fundId)
    if (h) return { fund_name: h.fund_name, asset_class: h.asset_class }
  }
  return { fund_name: fundId, asset_class: '' }
}

// LotSaleDetail/TransactionFundRecord's per-lot shape carries no
// acquisition_date (only lot_id, shares, proceeds, cost basis, gain/loss,
// holding_period) — look it up from the portfolio's own lot records, which
// is the actual source of truth for it.
function findLotAcquisitionDate(portfolio: Portfolio, fundId: string, lotId: string): string {
  for (const acct of portfolio.accounts) {
    const h = acct.holdings.find(h => h.fund_id === fundId)
    const lot = h?.lots.find(l => l.lot_id === lotId)
    if (lot) return lot.acquisition_date
  }
  return ''
}

function toAllocationImpact(ai: AllocationImpact): NarrationAllocationImpact {
  return {
    before: {
      domestic_equity: ai.domestic_equity_before,
      international_equity: ai.international_equity_before,
      domestic_bonds: ai.domestic_bonds_before,
      short_term_reserves: ai.short_term_reserves_before,
    },
    after: {
      domestic_equity: ai.domestic_equity_after,
      international_equity: ai.international_equity_after,
      domestic_bonds: ai.domestic_bonds_after,
      short_term_reserves: ai.short_term_reserves_after,
    },
    // AllocationImpact has no target snapshot of its own — callers that need
    // one (none currently do) would source it from portfolio.target_allocation.
    target: {
      domestic_equity: ai.domestic_equity_after,
      international_equity: ai.international_equity_after,
      domestic_bonds: ai.domestic_bonds_after,
      short_term_reserves: ai.short_term_reserves_after,
    },
  }
}

function marketContextFor(fundId: string, lotIds: string[]): number | undefined {
  const { trailing_12mo_return, market_context_exclusions } = getMarketContextData()
  return buildMarketContext(fundId, lotIds, trailing_12mo_return, market_context_exclusions)
}

// ---------------------------------------------------------------------------
// Touchpoint 1 — Fund Selection rationale (built from FundSaleResult[],
// shared by Recommendation.fund_results and ManualConfiguration.fund_results)
// ---------------------------------------------------------------------------

export function buildFundResultNarrationInput(params: {
  fundResults: FundSaleResult[]
  portfolio: Portfolio
  accountType: Portfolio['accounts'][number]['account_type']
  segment: NarrationSegment
  touchpoint?: NarrationTouchpoint
  est_net_tax?: number
  effective_rate?: number
  wait_and_save_notices?: Array<{ fund_id: string; lot_id: string; days_until_lt: number; tax_savings_by_waiting: number }>
}): NarrationInput {
  const funds: NarrationFundLine[] = params.fundResults.map(fr => {
    const { fund_name, asset_class } = findFund(params.portfolio, fr.fund_id)
    const lotIds = fr.lots_sold.map(l => l.lot_id)
    return {
      fund_id: fr.fund_id,
      fund_name: fr.fund_name || fund_name,
      asset_class,
      account_type: params.accountType,
      accounting_method: fr.accounting_method,
      sell_amount: fr.sell_amount,
      st_gain_loss: fr.est_st_gain_loss,
      lt_gain_loss: fr.est_lt_gain_loss,
      est_tax_gross: fr.est_tax_gross,
      impact_pct: fr.impact_pct,
      lots: fr.lots_sold.map(l => ({
        lot_id: l.lot_id,
        acquisition_date: findLotAcquisitionDate(params.portfolio, fr.fund_id, l.lot_id),
        holding_period: l.holding_period,
        realized_gain_loss: l.realized_gain_loss,
      })),
      market_context_return_pct: marketContextFor(fr.fund_id, lotIds),
    }
  })

  const lossesHarvested = r2(funds.reduce((s, f) => s + Math.min(0, f.st_gain_loss + f.lt_gain_loss), 0))

  return {
    touchpoint: params.touchpoint ?? 'fund_selection_rationale',
    tense: 'prospective',
    segment: params.segment,
    funds,
    est_net_tax: params.est_net_tax,
    effective_rate: params.effective_rate,
    losses_harvested: lossesHarvested,
    wait_and_save_notices: params.wait_and_save_notices,
  }
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// Touchpoint 2 — Scenario Analysis tradeoff summary
// ---------------------------------------------------------------------------

export function buildScenarioNarrationInput(params: {
  scenario: SavedScenario
  portfolio: Portfolio
  accountType: Portfolio['accounts'][number]['account_type']
  segment: NarrationSegment
  touchpoint?: NarrationTouchpoint
}): NarrationInput {
  const funds: NarrationFundLine[] = params.scenario.fund_selections.map(fs => {
    const { fund_name, asset_class } = findFund(params.portfolio, fs.fund_id)
    const lotIds = fs.lots_selected.map(l => l.lot_id)
    return {
      fund_id: fs.fund_id,
      fund_name: fs.fund_name || fund_name,
      asset_class,
      account_type: params.accountType,
      accounting_method: fs.accounting_method,
      sell_amount: fs.sell_amount,
      st_gain_loss: fs.st_gain_loss ?? 0,
      lt_gain_loss: fs.lt_gain_loss ?? 0,
      est_tax_gross: fs.est_tax_gross,
      lots: fs.lots_selected.map(l => ({
        lot_id: l.lot_id,
        acquisition_date: findLotAcquisitionDate(params.portfolio, fs.fund_id, l.lot_id),
        holding_period: l.holding_period,
        realized_gain_loss: l.realized_gain_loss,
      })),
      market_context_return_pct: marketContextFor(fs.fund_id, lotIds),
    }
  })

  return {
    touchpoint: params.touchpoint ?? 'scenario_tradeoff_summary',
    tense: 'prospective',
    segment: params.segment,
    funds,
    est_net_tax: params.scenario.est_net_tax,
    effective_rate: params.scenario.effective_rate,
    losses_harvested: params.scenario.losses_harvested,
    allocation_impact: toAllocationImpact(params.scenario.allocation_impact),
  }
}

// ---------------------------------------------------------------------------
// Touchpoint 3 — Order Confirmation summary. Same shape as touchpoint 1/2 —
// whichever source (Recommendation / SavedScenario / ManualConfiguration) is
// behind the confirmation screen, reuse its builder with the confirmation
// touchpoint tag. Nothing new is computed here (REQ-EC-004: no new
// information introduced at this stage).
// ---------------------------------------------------------------------------

export function buildOrderConfirmationNarrationInput(params: {
  source: { kind: 'recommendation'; data: Recommendation } | { kind: 'scenario'; data: SavedScenario } | { kind: 'manual'; data: ManualConfiguration }
  portfolio: Portfolio
  accountType: Portfolio['accounts'][number]['account_type']
  segment: NarrationSegment
}): NarrationInput {
  if (params.source.kind === 'scenario') {
    return buildScenarioNarrationInput({
      scenario: params.source.data,
      portfolio: params.portfolio,
      accountType: params.accountType,
      segment: params.segment,
      touchpoint: 'order_confirmation_summary',
    })
  }
  const source = params.source
  return buildFundResultNarrationInput({
    fundResults: source.data.fund_results,
    portfolio: params.portfolio,
    accountType: params.accountType,
    segment: params.segment,
    touchpoint: 'order_confirmation_summary',
    est_net_tax: source.kind === 'recommendation' ? source.data.est_net_tax : undefined,
    effective_rate: source.kind === 'recommendation' ? source.data.effective_rate : undefined,
  })
}

// ---------------------------------------------------------------------------
// Touchpoint 4 — Execution Summary narrative (past tense, from the committed
// TransactionRecord)
// ---------------------------------------------------------------------------

export function buildExecutionSummaryNarrationInput(params: {
  transaction: TransactionRecord
  portfolio: Portfolio
  accountType: Portfolio['accounts'][number]['account_type']
  segment: NarrationSegment
}): NarrationInput {
  const funds: NarrationFundLine[] = params.transaction.funds_sold.map(fs => {
    const { fund_name, asset_class } = findFund(params.portfolio, fs.fund_id)
    const lotIds = fs.lots_sold.map(l => l.lot_id)
    return {
      fund_id: fs.fund_id,
      fund_name,
      asset_class,
      account_type: params.accountType,
      accounting_method: fs.accounting_method,
      sell_amount: fs.sell_amount,
      st_gain_loss: fs.st_gain_loss,
      lt_gain_loss: fs.lt_gain_loss,
      lots: fs.lots_sold.map(l => ({
        lot_id: l.lot_id,
        acquisition_date: findLotAcquisitionDate(params.portfolio, fs.fund_id, l.lot_id),
        holding_period: l.holding_period,
        realized_gain_loss: l.realized_gain_loss,
      })),
      market_context_return_pct: marketContextFor(fs.fund_id, lotIds),
    }
  })

  return {
    touchpoint: 'execution_summary_narrative',
    tense: 'past',
    segment: params.segment,
    funds,
    est_net_tax: params.transaction.est_tax_at_active_rate,
    effective_rate: params.transaction.effective_rate,
    losses_harvested: params.transaction.losses_harvested,
    allocation_impact: {
      before: {
        domestic_equity: params.transaction.stocks_before_pct,
        international_equity: 0,
        domestic_bonds: params.transaction.bonds_before_pct,
        short_term_reserves: params.transaction.reserves_before_pct,
      },
      after: {
        domestic_equity: params.transaction.stocks_after_pct,
        international_equity: 0,
        domestic_bonds: params.transaction.bonds_after_pct,
        short_term_reserves: params.transaction.reserves_after_pct,
      },
      target: {
        domestic_equity: params.transaction.stocks_after_pct,
        international_equity: 0,
        domestic_bonds: params.transaction.bonds_after_pct,
        short_term_reserves: params.transaction.reserves_after_pct,
      },
    },
  }
}

export type { AccountingMethod }
