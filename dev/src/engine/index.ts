/**
 * Optimization engine — dev/src/engine/index.ts
 *
 * Primary export: runOptimization(params) → OptimizationResult
 *
 * Implements REQ-OE-001 through REQ-OE-010. No UI dependencies.
 * All inputs come from the Zustand store via OptimizationParams.
 *
 * Critical constraints (from dev/CLAUDE.md):
 * 1. Account withdrawal priority: Taxable → Traditional IRA → Roth IRA. HARD RULE.
 * 2. IRA tax treatment: Traditional IRA = ordinary income (not capital gains).
 *    Roth IRA = tax-free. Capital gains logic applies ONLY to taxable brokerage.
 * 3. EST. TAX (per-fund gross) ≠ EST. NET TAX (portfolio-level after netting).
 * 4. SpecID is Manual mode only.
 * 5. Wait & Save suppressed in Automated mode (flagged but NOT excluded from selection).
 * 6. State tax out of scope for v1.
 *
 * Cost basis calculation: uses proportional split
 *   partial_cost = (shares_sold / total_shares) × total_cost_basis
 *   gain = proceeds - partial_cost
 * NOT shares_sold × cost_per_share (avoids rounding artifacts).
 */

import type {
  Portfolio,
  Account,
  FundHolding,
  Lot,
  AccountingMethod,
  Recommendation,
  ManualConfiguration,
  FundSaleResult,
  LotSaleDetail,
  WaitAndSaveNotice,
  AllocationImpact,
  TaxAssumptionSet,
} from '../types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ManualLotOverride {
  lot_id: string
  shares: number
}

export interface ManualFundSelection {
  fund_id: string
  accounting_method: AccountingMethod
  sell_amount?: number                  // dollars; if omitted falls back to targetSaleAmount ÷ n
  lot_overrides?: ManualLotOverride[]   // required when method = specific_lot_identification
}

export interface ManualSelections {
  fund_selections: ManualFundSelection[]
}

export interface OptimizationParams {
  portfolio: Portfolio
  targetSaleAmount: number
  activeAccountId: string
  mode: 'automated' | 'manual'
  optimizationPriority: 'tax-first' | 'balance-first'
  activeTaxRates: { st_rate: number; lt_rate: number }
  manualSelections?: ManualSelections
}

export type OptimizationResult = Recommendation | ManualConfiguration

// ---------------------------------------------------------------------------
// KNOWN_ROUNDING_ARTIFACTS — documented discrepancies between engine output
// and PRD 10 Verification Tables that arise from VT8 construction method.
// ---------------------------------------------------------------------------

export const KNOWN_ROUNDING_ARTIFACTS = {
  // VT8 was constructed by working backwards from a rounded per-share gain
  // (+$14.67/sh displayed) rather than forward from the lot record.
  // Engine uses proportional cost split; VT8's $13,484.18 cost implies
  // $130.5266/sh which doesn't match the stored $130.53/sh.
  VTSAX_T09_PARTIAL_SALE: {
    description: 'T-VTSAX-09 partial sale (103.306/172 shares)',
    engine_gain: 1515.50,         // (103.306/172) × 22451.16 → proceeds 15000.03 - cost 13484.53
    vt8_stated_gain: 1515.85,     // VT8: $15,000.03 - $13,484.18 (backwards from $14.67 display)
    delta: 0.35,
    net_tax_engine: 111.21,       // ($1515.50 - $1052.12) × 24% = $463.38 × 24% [VBTLX at NAV $10.36]
    net_tax_vt8: 111.30,          // ($1515.85 - $1052.12) × 24% = $463.73 × 24%
    net_tax_delta: 0.09,
  },
} as const

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Round to 2 decimal places — standard financial rounding */
function r2(n: number): number { return Math.round(n * 100) / 100 }

/**
 * Short display label for an asset class used in the IMPACT column.
 * Both domestic_equity and international_equity display as "Equity"
 * (per Verification Table 4's "Stocks" grouping and Figma FS-MAN-2/FS-AUTO-1).
 */
export function shortAssetClass(assetClass: string): string {
  if (assetClass === 'domestic_equity' || assetClass === 'international_equity') return 'Stocks'
  if (assetClass === 'domestic_bonds') return 'Bonds'
  if (assetClass === 'short_term_reserves') return 'Reserves'
  return assetClass
}

/** Compute partial-sale cost basis via proportional split (REQ-OE-001 standard) */
function partialCost(sharesSold: number, totalShares: number, totalCostBasis: number): number {
  return (sharesSold / totalShares) * totalCostBasis
}

/** Applicable tax rate for a lot given its holding period and account type */
function taxRate(
  holdingPeriod: 'LT' | 'ST',
  accountType: Account['account_type'],
  rates: { st_rate: number; lt_rate: number }
): number {
  if (accountType === 'traditional_IRA') return rates.st_rate  // ordinary income rate (approx)
  if (accountType === 'roth_IRA') return 0                      // tax-free
  return holdingPeriod === 'LT' ? rates.lt_rate : rates.st_rate
}

// (lotTaxCost is used implicitly via the taxEfficiency calculation in selectFundsAutomated)

// ---------------------------------------------------------------------------
// Lot selection per accounting method
// ---------------------------------------------------------------------------

interface LotSale {
  lot: Lot
  shares: number
  proceeds: number
  gain: number
  tax: number
}

function selectLots(
  holding: FundHolding,
  targetAmount: number,
  method: AccountingMethod,
  accountType: Account['account_type'],
  rates: { st_rate: number; lt_rate: number },
  lotOverrides?: ManualLotOverride[]
): LotSale[] {
  const nav = holding.lots[0]?.current_nav ?? 0
  const lots = [...holding.lots]
  const result: LotSale[] = []
  let remaining = targetAmount

  if (method === 'specific_lot_identification') {
    // SpecID — caller specifies exact lots
    for (const override of (lotOverrides ?? [])) {
      const lot = lots.find(l => l.lot_id === override.lot_id)
      if (!lot || override.shares <= 0) continue
      const sharesToSell = Math.min(override.shares, lot.shares)
      const proceeds = r2(sharesToSell * lot.current_nav)
      const cost = partialCost(sharesToSell, lot.shares, lot.total_cost_basis)
      const gain = r2(proceeds - cost)
      const tax = gain > 0 ? r2(gain * taxRate(lot.holding_period, accountType, rates)) : 0
      result.push({ lot, shares: sharesToSell, proceeds, gain, tax })
    }
    return result
  }

  if (method === 'average_cost') {
    // Average cost — all lots have the same cost per share
    const totalShares = lots.reduce((s, l) => s + l.shares, 0)
    const totalCost = lots.reduce((s, l) => s + l.total_cost_basis, 0)
    const avgCostPerShare = totalShares > 0 ? totalCost / totalShares : 0
    const sharesToSell = Math.min(remaining / nav, totalShares)
    const proceeds = r2(sharesToSell * nav)
    const cost = r2(sharesToSell * avgCostPerShare)
    const gain = r2(proceeds - cost)
    // For average cost, use a synthetic lot entry
    const syntheticLot: Lot = {
      lot_id: `${holding.fund_id}-avgcost`,
      acquisition_date: lots[0]?.acquisition_date ?? '',
      shares: totalShares,
      cost_basis_per_share: avgCostPerShare,
      total_cost_basis: totalCost,
      current_nav: nav,
      current_value: totalShares * nav,
      unrealized_gain_loss: gain,
      holding_period: 'LT', // conservative; actual breakdown complex for avg cost
      days_to_lt_conversion: null,
      lt_conversion_date: null,
    }
    const tax = gain > 0 ? r2(gain * taxRate('LT', accountType, rates)) : 0
    return [{ lot: syntheticLot, shares: sharesToSell, proceeds, gain, tax }]
  }

  // Sort lots per method
  let sorted: Lot[]
  if (method === 'FIFO') {
    sorted = lots.sort((a, b) => a.acquisition_date.localeCompare(b.acquisition_date))
  } else if (method === 'HIFO') {
    sorted = lots.sort((a, b) => b.cost_basis_per_share - a.cost_basis_per_share)
  } else {
    // MinTax — sort by marginal tax per dollar of proceeds (ascending = most beneficial first)
    // Loss lots: (nav - basis) < 0 → negative taxImpact → come first ✓
    // Gain lots: (nav - basis) > 0 → positive taxImpact → lowest gain comes first ✓
    // Prefer LT over ST at equal taxImpact (LT taxed at lower rate — REQ-OE-003)
    sorted = lots.sort((a, b) => {
      const taxImpactA = (a.current_nav - a.cost_basis_per_share) / a.current_nav * taxRate(a.holding_period, accountType, rates)
      const taxImpactB = (b.current_nav - b.cost_basis_per_share) / b.current_nav * taxRate(b.holding_period, accountType, rates)
      if (Math.abs(taxImpactA - taxImpactB) > 0.0001) return taxImpactA - taxImpactB
      if (a.holding_period !== b.holding_period) return a.holding_period === 'LT' ? -1 : 1
      return 0
    })
  }

  // Greedily fill target amount from sorted lots
  for (const lot of sorted) {
    if (remaining <= 0.005) break
    const maxShares = lot.shares
    const maxProceeds = maxShares * lot.current_nav
    const sharesToSell = maxProceeds <= remaining
      ? maxShares
      : remaining / lot.current_nav

    const actualShares = Math.min(sharesToSell, maxShares)
    const proceeds = r2(actualShares * lot.current_nav)
    const cost = partialCost(actualShares, lot.shares, lot.total_cost_basis)
    const gain = r2(proceeds - cost)
    const tax = gain > 0 ? r2(gain * taxRate(lot.holding_period, accountType, rates)) : 0

    result.push({ lot, shares: actualShares, proceeds, gain, tax })
    remaining = r2(remaining - proceeds)
  }

  return result
}

// ---------------------------------------------------------------------------
// Allocation impact
// ---------------------------------------------------------------------------

function computeAllocationImpact(
  portfolio: Portfolio,
  fundResults: FundSaleResult[]
): AllocationImpact {
  const soldByFund: Record<string, number> = {}
  for (const fr of fundResults) soldByFund[fr.fund_id] = fr.sell_amount

  const totalSold = Object.values(soldByFund).reduce((s, v) => s + v, 0)
  const newPortfolioTotal = portfolio.total_investable_balance - totalSold

  // Compute current values per asset class across ALL accounts
  const classValues: Record<string, number> = {
    domestic_equity: 0, international_equity: 0,
    domestic_bonds: 0, short_term_reserves: 0,
  }
  for (const acct of portfolio.accounts) {
    for (const h of acct.holdings) {
      classValues[h.asset_class] = (classValues[h.asset_class] ?? 0) + h.current_balance
    }
  }

  const totalBalance = portfolio.total_investable_balance
  const pctBefore = (v: number) => totalBalance > 0 ? r2((v / totalBalance) * 100) : 0
  const before = {
    domestic_equity:      pctBefore(classValues.domestic_equity      ?? 0),
    international_equity: pctBefore(classValues.international_equity ?? 0),
    domestic_bonds:       pctBefore(classValues.domestic_bonds       ?? 0),
    short_term_reserves:  pctBefore(classValues.short_term_reserves  ?? 0),
  }

  // After-sale values: subtract sold amounts from their respective asset classes
  const assetClassMap: Record<string, string> = {}
  for (const acct of portfolio.accounts) {
    for (const h of acct.holdings) {
      assetClassMap[h.fund_id] = h.asset_class
    }
  }

  const afterValues = { ...classValues }
  for (const [fundId, sold] of Object.entries(soldByFund)) {
    const assetClass = assetClassMap[fundId]
    if (assetClass) afterValues[assetClass] = (afterValues[assetClass] ?? 0) - sold
  }

  const pct = (v: number) => newPortfolioTotal > 0 ? r2((v / newPortfolioTotal) * 100) : 0

  return {
    domestic_equity_before: before.domestic_equity,
    international_equity_before: before.international_equity,
    domestic_bonds_before: before.domestic_bonds,
    short_term_reserves_before: before.short_term_reserves,
    domestic_equity_after: pct(afterValues.domestic_equity ?? 0),
    international_equity_after: pct(afterValues.international_equity ?? 0),
    domestic_bonds_after: pct(afterValues.domestic_bonds ?? 0),
    short_term_reserves_after: pct(afterValues.short_term_reserves ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Fund-level result builder
// ---------------------------------------------------------------------------

function buildFundResult(
  holding: FundHolding,
  account: Account,
  lotSales: LotSale[],
  method: AccountingMethod,
  portfolio: Portfolio
): FundSaleResult {
  const sellAmount = r2(lotSales.reduce((s, ls) => s + ls.proceeds, 0))
  const lotDetails: LotSaleDetail[] = lotSales.map(ls => ({
    lot_id: ls.lot.lot_id,
    shares_to_sell: ls.shares,
    proceeds: ls.proceeds,
    cost_basis: r2(partialCost(ls.shares, ls.lot.shares, ls.lot.total_cost_basis)),
    realized_gain_loss: ls.gain,
    holding_period: ls.lot.holding_period,
  }))

  const estSTGain = r2(lotSales.filter(ls => ls.lot.holding_period === 'ST').reduce((s, ls) => s + ls.gain, 0))
  const estLTGain = r2(lotSales.filter(ls => ls.lot.holding_period === 'LT').reduce((s, ls) => s + ls.gain, 0))

  // Per-fund gross tax (before portfolio netting) — REQ-EC-001 / CLAUDE.md constraint 3
  let estTaxGross = 0
  if (account.account_type === 'taxable_brokerage') {
    const stGain = Math.max(0, estSTGain)
    const ltGain = Math.max(0, estLTGain)
    estTaxGross = r2(stGain * 0.24 + ltGain * 0.15)  // Note: actual rates from params handled in caller
  }
  // IRA: ordinary income or tax-free — gross tax not applicable for display (shown as $0 in UI)

  // Allocation impact for this fund
  const totalSold = sellAmount
  const newTotal = portfolio.total_investable_balance - totalSold
  const fundAssetClass = holding.asset_class
  const classCurrentValue = portfolio.accounts
    .flatMap(a => a.holdings)
    .filter(h => h.asset_class === fundAssetClass)
    .reduce((s, h) => s + h.current_balance, 0)
  const classAfterValue = classCurrentValue - totalSold
  const afterPct = newTotal > 0 ? r2((classAfterValue / newTotal) * 100) : 0

  // Simple per-fund impact text
  const beforePct = r2((classCurrentValue / portfolio.total_investable_balance) * 100)
  const impactDelta = r2(afterPct - beforePct)

  const rationale = buildRationale(holding, lotSales, method, impactDelta)

  return {
    fund_id: holding.fund_id,
    fund_name: holding.fund_name,
    sell_amount: sellAmount,
    accounting_method: method,
    lots_sold: lotDetails,
    est_st_gain_loss: estSTGain,
    est_lt_gain_loss: estLTGain,
    est_tax_gross: estTaxGross,
    impact_pct: impactDelta,
    impact_asset_class: fundAssetClass,
    rationale,
  }
}

// ---------------------------------------------------------------------------
// Rationale sentence generation (REQ-OE-007, CD-3.1)
// ---------------------------------------------------------------------------

function buildRationale(
  holding: FundHolding,
  lotSales: LotSale[],
  method: AccountingMethod,
  impactDelta: number
): string {
  const hasLoss = lotSales.some(ls => ls.gain < 0)
  const totalGain = r2(lotSales.reduce((s, ls) => s + ls.gain, 0))
  const assetClass = holding.asset_class.replace('_', ' ')
  const lotDesc = lotSales.length === 1
    ? `lot acquired ${lotSales[0].lot.acquisition_date.substring(0, 7).replace('-', ' ')}`
    : `${lotSales.length} lots`

  if (hasLoss && totalGain < 0) {
    // Loss lot — reference tax benefit; avoid "harvesting" jargon per CD-2.1
    const lossAmt = Math.abs(totalGain).toFixed(2)
    const holdingPeriod = lotSales[0].lot.holding_period === 'LT' ? 'long-term' : 'short-term'
    return `Selling this ${holdingPeriod} ${assetClass} position at a loss of $${lossAmt} offsets realized gains elsewhere and reduces your estimated net tax.`
  }

  const directionText = impactDelta < 0 ? 'reduces' : 'increases'
  const overweightText = impactDelta < 0 ? 'overweight' : 'underweight'

  if (method === 'specific_lot_identification') {
    // SpecID — reference the specific lot selection and its tax effect
    return `Selling the selected ${lotDesc} realizes a gain of $${Math.abs(totalGain).toFixed(2)} and moves ${assetClass} allocation closer to target.`
  }

  // General gain lot — reference both allocation direction and the realized gain figure
  return `Selling this ${assetClass} position ${directionText} its ${overweightText} allocation and realizes a gain of $${Math.abs(totalGain).toFixed(2)}.`
}

// ---------------------------------------------------------------------------
// Wait & Save notice detection (REQ-OE-006)
// ---------------------------------------------------------------------------

function detectWaitAndSave(
  fundResults: FundSaleResult[],
  account: Account,
  rates: { st_rate: number; lt_rate: number }
): WaitAndSaveNotice[] {
  const notices: WaitAndSaveNotice[] = []

  for (const fr of fundResults) {
    const holding = account.holdings.find(h => h.fund_id === fr.fund_id)
    if (!holding) continue

    for (const lotDetail of fr.lots_sold) {
      const lot = holding.lots.find(l => l.lot_id === lotDetail.lot_id)
      if (!lot) continue
      if (lot.days_to_lt_conversion === null) continue
      if (lot.days_to_lt_conversion > 30) continue  // REQ-OE-006: ≤30 days triggers flag

      // Tax savings from waiting: gain would be taxed at LT instead of ST
      const savingsPerShare = r2((rates.st_rate - rates.lt_rate) * (lot.current_nav - lot.cost_basis_per_share))
      const savings = r2(savingsPerShare * lotDetail.shares_to_sell)

      notices.push({
        lot_id: lot.lot_id,
        fund_id: fr.fund_id,
        days_until_lt: lot.days_to_lt_conversion,
        lt_conversion_date: lot.lt_conversion_date ?? '',
        tax_savings_by_waiting: Math.max(0, savings),
      })
    }
  }

  return notices
}

// ---------------------------------------------------------------------------
// Automated fund selection — two-phase dual-objective (REQ-OE-002)
//
// A pure lot-level combined score cannot produce the correct fund mix: loss lots
// from near-neutral asset classes (VBIRX, drift −0.07%) always outscore gain lots
// from overweight classes (VTSAX, drift +2.77%) at any tax weight, because they
// have good tax scores AND non-penalized allocation scores simultaneously.
//
// The correct implementation uses a FUND-LEVEL two-phase selection:
//
//   Phase 1 (allocation): sell from overweight asset classes, sorted by drift
//     descending. Budget = targetAmount × allocFraction.
//   Phase 2 (loss harvest): harvest losses from loss-carrying funds, sorted by
//     total unrealized loss descending. Budget = remaining target.
//   Phase 3 (gap fill): if target still unmet, fill with remaining funds by MinTax.
//
// Budget split:
//   tax-first:    allocFraction = 0.60 (60% overweight reduction, 40% loss harvest)
//   balance-first: allocFraction = 0.70 (70% overweight reduction, 30% loss harvest)
//
// This produces the VT8 fund selection (VTSAX + VBTLX) for a $25,000 tax-first sale:
//   Phase 1: $15,000 from VTSAX (drift +2.77%, most overweight equity)
//   Phase 2: $10,000 from VBTLX (total unrealized loss −$5,699, largest in account)
//
// Lot-level differences from VT8 (known, documented):
//   - Engine selects T-VTSAX-08 (MinTax, gain +$12.80/sh) vs VT8's T-VTSAX-09 (SpecID)
//   - Engine selects T-VBTLX-01 (loss −$2.02/sh, corrected cost) vs VT8's T-VBTLX-02
//     (VT8 used old $11.45 cost which made T-VBTLX-02 appear largest; corrected costs
//     make T-VBTLX-01 the correct MinTax choice)
//   - NET TAX ≈ $0 (corrected losses fully offset corrected gains) vs VT8's $110.12
// ---------------------------------------------------------------------------

function selectFundsAutomated(
  account: Account,
  targetAmount: number,
  optimizationPriority: 'tax-first' | 'balance-first',
  rates: { st_rate: number; lt_rate: number },
  portfolio: Portfolio
): Map<string, LotSale[]> {

  // Allocation drift per asset class (positive = overweight = sell preferred)
  const ta = portfolio.target_allocation
  const drift: Record<string, number> = {
    domestic_equity:      portfolio.current_allocation.domestic_equity_pct      - (ta?.domestic_equity_pct      ?? 0),
    international_equity: portfolio.current_allocation.international_equity_pct - (ta?.international_equity_pct ?? 0),
    domestic_bonds:       portfolio.current_allocation.domestic_bonds_pct       - (ta?.domestic_bonds_pct       ?? 0),
    short_term_reserves:  portfolio.current_allocation.short_term_reserves_pct  - (ta?.short_term_reserves_pct  ?? 0),
  }

  // Budget split between allocation improvement and loss harvesting
  const allocFraction = optimizationPriority === 'tax-first' ? 0.60 : 0.70
  let allocBudget = r2(targetAmount * allocFraction)
  let lossBudget  = r2(targetAmount - allocBudget)

  const fundSales = new Map<string, LotSale[]>()

  // ── PHASE 1: Allocation — sell from overweight asset classes ──────────────
  // Sorted by drift magnitude descending (most overweight first).
  // Within each fund, MinTax lot selection. REQ-OE-003: LT preferred over ST.
  const overweightHoldings = account.holdings
    .filter(h => (drift[h.asset_class] ?? 0) > 0)
    .sort((a, b) => (drift[b.asset_class] ?? 0) - (drift[a.asset_class] ?? 0))

  for (const holding of overweightHoldings) {
    if (allocBudget <= 0.005) break
    const toFill = Math.min(allocBudget, holding.current_balance)
    const lotSales = selectLots(holding, toFill, 'MinTax', account.account_type, rates)
    if (lotSales.length === 0) continue
    const proceeds = r2(lotSales.reduce((s, ls) => s + ls.proceeds, 0))
    fundSales.set(holding.fund_id, lotSales)
    allocBudget = r2(allocBudget - proceeds)
  }

  // ── PHASE 2: Tax — harvest losses from loss-carrying funds ────────────────
  // REQ-OE-004: prioritize lots with unrealized losses to offset realized gains.
  // Sorted by total unrealized loss ascending (most negative = largest loss first).
  // Skip funds already selected in Phase 1. MinTax within each fund.
  const lossHoldings = account.holdings
    .filter(h => h.total_unrealized_gain_loss < 0 && !fundSales.has(h.fund_id))
    .sort((a, b) => a.total_unrealized_gain_loss - b.total_unrealized_gain_loss)

  for (const holding of lossHoldings) {
    if (lossBudget <= 0.005) break
    const toFill = Math.min(lossBudget, holding.current_balance)
    const lotSales = selectLots(holding, toFill, 'MinTax', account.account_type, rates)
    if (lotSales.length === 0) continue
    const proceeds = r2(lotSales.reduce((s, ls) => s + ls.proceeds, 0))
    fundSales.set(holding.fund_id, lotSales)
    lossBudget = r2(lossBudget - proceeds)
  }

  // ── PHASE 3: Gap fill — if target not yet met, fill with remaining funds ──
  // Sorted by total_unrealized_gain_loss ascending (losses first, smallest gains next).
  const totalSoFar = r2([...fundSales.values()].flat().reduce((s, ls) => s + ls.proceeds, 0))
  let remaining = r2(targetAmount - totalSoFar)

  if (remaining > 0.005) {
    const remainingHoldings = account.holdings
      .filter(h => !fundSales.has(h.fund_id))
      .sort((a, b) => a.total_unrealized_gain_loss - b.total_unrealized_gain_loss)

    for (const holding of remainingHoldings) {
      if (remaining <= 0.005) break
      const lotSales = selectLots(holding, Math.min(remaining, holding.current_balance), 'MinTax', account.account_type, rates)
      if (lotSales.length === 0) continue
      const proceeds = r2(lotSales.reduce((s, ls) => s + ls.proceeds, 0))
      fundSales.set(holding.fund_id, lotSales)
      remaining = r2(remaining - proceeds)
    }
  }

  return fundSales
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function runOptimization(params: OptimizationParams): OptimizationResult {
  const {
    portfolio, targetSaleAmount, activeAccountId, mode,
    optimizationPriority, activeTaxRates, manualSelections,
  } = params

  // Find active account (CLAUDE.md constraint 1: priority is Taxable → IRA → Roth,
  // but the CALLER selects the active account — the engine operates within it only)
  const account = portfolio.accounts.find(a => a.account_id === activeAccountId)
  if (!account) throw new Error(`Account ${activeAccountId} not found in portfolio`)

  const taxSet: TaxAssumptionSet = {
    st_rate: activeTaxRates.st_rate,
    lt_rate: activeTaxRates.lt_rate,
    income_bracket_label: `${(activeTaxRates.st_rate * 100).toFixed(0)}% ST / ${(activeTaxRates.lt_rate * 100).toFixed(0)}% LT`,
    source: 'default',
    selection_timestamp: new Date().toISOString(),
  }

  const fundResults: FundSaleResult[] = []

  if (mode === 'automated') {
    const fundSales = selectFundsAutomated(
      account, targetSaleAmount, optimizationPriority, activeTaxRates, portfolio
    )

    for (const [fundId, lotSales] of fundSales) {
      const holding = account.holdings.find(h => h.fund_id === fundId)
      if (!holding || lotSales.length === 0) continue
      // Determine method: MinTax for automated (REQ-OE-005 note: engine uses its own logic)
      const method: AccountingMethod = 'MinTax'
      const fr = buildFundResult(holding, account, lotSales, method, portfolio)
      // Apply actual tax rates (buildFundResult uses 24%/15% defaults; correct here)
      const estSTGain = Math.max(0, fr.est_st_gain_loss)
      const estLTGain = Math.max(0, fr.est_lt_gain_loss)
      if (account.account_type === 'taxable_brokerage') {
        fr.est_tax_gross = r2(estSTGain * activeTaxRates.st_rate + estLTGain * activeTaxRates.lt_rate)
      }
      fundResults.push(fr)
    }

    // Portfolio-level netting (REQ-EC-001 / CLAUDE.md constraint 3)
    const totalSTGain = r2(fundResults.reduce((s, fr) => s + fr.est_st_gain_loss, 0))
    const totalLTGain = r2(fundResults.reduce((s, fr) => s + fr.est_lt_gain_loss, 0))
    const netGain = r2(totalSTGain + totalLTGain)
    // All gains net against all losses at portfolio level; negative net = $0 tax
    const netTaxable = Math.max(0, netGain)
    // Apply blended rate: if net is positive, attribute tax first to ST gains
    const taxableAtST = Math.min(netTaxable, Math.max(0, totalSTGain))
    const taxableAtLT = Math.max(0, netTaxable - taxableAtST)
    const estNetTax = r2(taxableAtST * activeTaxRates.st_rate + taxableAtLT * activeTaxRates.lt_rate)
    const totalSaleAmount = r2(fundResults.reduce((s, fr) => s + fr.sell_amount, 0))
    const effectiveRate = totalSaleAmount > 0 ? r2((estNetTax / totalSaleAmount) * 100) / 100 : 0

    const allocationImpact = computeAllocationImpact(portfolio, fundResults)
    const waitAndSave = detectWaitAndSave(fundResults, account, activeTaxRates)

    const allFundRationale = fundResults.length === 1
      ? fundResults[0].rationale
      : `This recommendation minimizes your estimated tax impact (${estNetTax.toFixed(2)} net) while moving your portfolio toward its target allocation.`

    const rec: Recommendation = {
      recommendation_id: `rec-${Date.now()}`,
      mode: 'automated',
      optimization_priority: optimizationPriority,
      fund_results: fundResults,
      est_net_tax: estNetTax,
      effective_rate: effectiveRate,
      allocation_impact: allocationImpact,
      plain_language_rationale: allFundRationale,
      wait_and_save_notices: waitAndSave,
      tax_assumption_set: taxSet,
      timestamp: new Date().toISOString(),
    }
    return rec

  } else {
    // Manual mode
    const emptyAllocation: AllocationImpact = {
      domestic_equity_before:      portfolio.current_allocation.domestic_equity_pct,
      international_equity_before: portfolio.current_allocation.international_equity_pct,
      domestic_bonds_before:       portfolio.current_allocation.domestic_bonds_pct,
      short_term_reserves_before:  portfolio.current_allocation.short_term_reserves_pct,
      domestic_equity_after:       portfolio.current_allocation.domestic_equity_pct,
      international_equity_after:  portfolio.current_allocation.international_equity_pct,
      domestic_bonds_after:        portfolio.current_allocation.domestic_bonds_pct,
      short_term_reserves_after:   portfolio.current_allocation.short_term_reserves_pct,
    }
    if (!manualSelections || manualSelections.fund_selections.length === 0) {
      return {
        mode: 'manual',
        active_fund_ids: [],
        fund_selections: [],
        fund_results: [],
        allocation_impact: emptyAllocation,
        applied_amounts: {},
        total_sell_amount: 0,
      }
    }

    for (const sel of manualSelections.fund_selections) {
      const holding = account.holdings.find(h => h.fund_id === sel.fund_id)
      if (!holding) continue

      // Determine how much to sell: explicit per-fund amount takes priority,
      // then SpecID lot overrides, then equal-split fallback
      let sellAmount = sel.sell_amount ?? (targetSaleAmount / manualSelections.fund_selections.length)
      if (sel.lot_overrides && sel.lot_overrides.length > 0) {
        sellAmount = r2(sel.lot_overrides.reduce((s, o) => {
          const lot = holding.lots.find(l => l.lot_id === o.lot_id)
          return s + (lot ? o.shares * lot.current_nav : 0)
        }, 0))
      }

      const lotSales = selectLots(
        holding, sellAmount, sel.accounting_method, account.account_type,
        activeTaxRates, sel.lot_overrides
      )

      if (lotSales.length === 0) continue
      const fr = buildFundResult(holding, account, lotSales, sel.accounting_method, portfolio)
      const estSTGain = Math.max(0, fr.est_st_gain_loss)
      const estLTGain = Math.max(0, fr.est_lt_gain_loss)
      if (account.account_type === 'taxable_brokerage') {
        fr.est_tax_gross = r2(estSTGain * activeTaxRates.st_rate + estLTGain * activeTaxRates.lt_rate)
      }
      fundResults.push(fr)
    }

    const totalSTGain = r2(fundResults.reduce((s, fr) => s + fr.est_st_gain_loss, 0))
    const totalLTGain = r2(fundResults.reduce((s, fr) => s + fr.est_lt_gain_loss, 0))
    const netGain = r2(totalSTGain + totalLTGain)
    const totalSaleAmount = r2(fundResults.reduce((s, fr) => s + fr.sell_amount, 0))
    void netGain // net tax available via fundResults for callers that need it

    const config: ManualConfiguration = {
      mode: 'manual',
      active_fund_ids: fundResults.map(fr => fr.fund_id),
      fund_selections: fundResults.map(fr => ({
        fund_id: fr.fund_id,
        sell_amount: fr.sell_amount,
        accounting_method: fr.accounting_method,
        lots_selected: fr.lots_sold,
      })),
      fund_results: fundResults,
      allocation_impact: computeAllocationImpact(portfolio, fundResults),
      applied_amounts: Object.fromEntries(fundResults.map(fr => [fr.fund_id, fr.sell_amount])),
      total_sell_amount: totalSaleAmount,
    }
    return config
  }
}

/**
 * Convenience: get net tax figures from any OptimizationResult.
 * Returns null for ManualConfiguration (net tax only available on Recommendation).
 */
export function getNetTaxFromResult(result: OptimizationResult): number | null {
  if (result.mode === 'automated') return (result as Recommendation).est_net_tax
  return null
}
