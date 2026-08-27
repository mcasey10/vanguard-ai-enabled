/**
 * TypeScript interfaces for the Vanguard Sell & Rebalance tool.
 *
 * Entity numbering follows PRD 07 (Logical Data Model).
 * Field names match pm/08-sample-dataset.json exactly — not PRD 07 prose,
 * since the loader must parse the canonical JSON directly.
 */

// ---------------------------------------------------------------------------
// Entity 10 — Tax Assumption Set
// ---------------------------------------------------------------------------

export interface TaxAssumptionSet {
  st_rate: number              // short-term capital gains rate, default 0.24
  lt_rate: number              // long-term capital gains rate, default 0.15
  income_bracket_label: string // plain-language income range label
  source: 'default' | 'user_selected'
  selection_timestamp: string  // ISO timestamp
}

// ---------------------------------------------------------------------------
// Entity 12 — YTD Gains Record  (matches ytd_gains_record in JSON)
// ---------------------------------------------------------------------------

export interface YTDGainsRecord {
  ytd_id: string
  portfolio_id: string
  tax_year: number
  st_gains_realized_ytd: number
  lt_gains_realized_ytd: number
  as_of_date: string
  data_completeness_flag: 'complete' | 'partial' | 'unavailable'
  source: string
}

// ---------------------------------------------------------------------------
// Entity 6 — Target Allocation  (matches target_allocation in JSON)
// ---------------------------------------------------------------------------

export interface TargetAllocation {
  allocation_id: string
  portfolio_id: string
  domestic_equity_pct: number
  international_equity_pct: number
  domestic_bonds_pct: number
  short_term_reserves_pct: number
  fund_level_targets: Record<string, number> | null
  source: 'user_set' | 'vanguard_allocation_wizard' | 'default_50_50'
  as_of_date: string
}

// ---------------------------------------------------------------------------
// Wait & Save detail  (matches wait_and_save_detail in JSON)
// ---------------------------------------------------------------------------

export interface WaitAndSaveDetail {
  days_until_lt: number
  lt_conversion_date: string
  unrealized_gain: number
  tax_if_sold_now_st_rate_24pct: number
  tax_if_sold_after_conversion_lt_rate_15pct: number
  estimated_tax_savings_by_waiting: number
  note: string
}

// ---------------------------------------------------------------------------
// Harvestable loss detail  (matches harvestable_loss_detail in JSON)
// ---------------------------------------------------------------------------

export interface HarvestableLossDetail {
  unrealized_loss: number
  holding_period: 'LT' | 'ST'
  note: string
}

// ---------------------------------------------------------------------------
// Entity 5 — Lot  (matches lots[] in JSON)
// ---------------------------------------------------------------------------

export interface Lot {
  lot_id: string
  acquisition_date: string
  shares: number
  cost_basis_per_share: number
  total_cost_basis: number
  current_nav: number
  current_value: number
  unrealized_gain_loss: number
  holding_period: 'LT' | 'ST'
  days_to_lt_conversion: number | null
  lt_conversion_date: string | null
  wait_and_save_flag?: boolean
  wait_and_save_detail?: WaitAndSaveDetail
  harvestable_loss_flag?: boolean
  harvestable_loss_detail?: HarvestableLossDetail
  note?: string
}

// ---------------------------------------------------------------------------
// Entity 4 — Fund / Holding  (matches holdings[] in JSON)
// ---------------------------------------------------------------------------

export type AccountingMethod =
  | 'FIFO'
  | 'average_cost'
  | 'specific_lot_identification'
  | 'HIFO'
  | 'MinTax'

// UI-layer cost basis method labels (stored in Zustand, displayed in CostBasisDialog).
// Distinct from AccountingMethod — converted via toAccountingMethod() before engine calls.
export type CostBasisMethod = 'MinTax' | 'HIFO' | 'FIFO' | 'SpecID' | 'AvgCost'

export interface FundHolding {
  fund_id: string
  fund_name: string
  asset_class: 'domestic_equity' | 'international_equity' | 'domestic_bonds' | 'short_term_reserves'
  total_shares: number
  current_balance: number
  current_allocation_weight_pct: number
  available_accounting_methods: AccountingMethod[]
  unrealized_st_gain_loss: number
  unrealized_lt_gain_loss: number
  total_unrealized_gain_loss: number
  total_cost_basis: number
  lots: Lot[]
}

// ---------------------------------------------------------------------------
// RMD Record  (matches rmd_records[] in JSON)
// ---------------------------------------------------------------------------

export interface RMDRecord {
  rmd_id: string
  account_id: string
  tax_year: number
  account_balance_prior_year_end: number
  irs_life_expectancy_factor: number
  rmd_required_for_year: number
  rmd_distributed_ytd: number
  rmd_remaining: number
  as_of_date: string
  source: string
}

// ---------------------------------------------------------------------------
// Entity 3 — Account  (matches accounts[] in JSON)
// ---------------------------------------------------------------------------

export type AccountType = 'taxable_brokerage' | 'traditional_IRA' | 'roth_IRA'

export interface Account {
  account_id: string
  portfolio_id: string
  account_type: AccountType
  account_balance: number
  rmd_applicable: boolean
  settlement_account_id: string
  masked_number: string         // display suffix, e.g. "...4782" (from pm/08-sample-dataset.json)
  holdings: FundHolding[]
  rmd_record?: RMDRecord       // populated from rmd_records[] where account_id matches
}

// ---------------------------------------------------------------------------
// Entity 2 — Portfolio  (matches top-level portfolio + accounts in JSON)
// ---------------------------------------------------------------------------

export interface Portfolio {
  portfolio_id: string
  user_id: string
  total_investable_balance: number
  current_allocation: {
    domestic_equity_pct: number
    international_equity_pct: number
    domestic_bonds_pct: number
    short_term_reserves_pct: number
  }
  target_allocation: TargetAllocation | null
  accounts: Account[]
  ytd_gains_record: YTDGainsRecord | null
}

// ---------------------------------------------------------------------------
// Entity 1 — User / Investor  (matches user in JSON)
// ---------------------------------------------------------------------------

export interface PriorSession {
  session_id: string
  session_status: 'completed' | 'incomplete'
  session_duration_minutes: number
  scenario_saved: boolean
}

export interface User {
  user_id: string
  display_name: string
  age: number
  birth_year: number
  first_session_completed: boolean
  prior_session: PriorSession | null
}

// ---------------------------------------------------------------------------
// Entity 7 — Sale Session (session state, not persisted as-is)
// ---------------------------------------------------------------------------

export interface SaleSession {
  session_id: string
  target_sale_amount: number | null
  active_account_id: string
  session_state: 'active' | 'incomplete' | 'complete'
  session_start_time: string
  tax_assumption_set: TaxAssumptionSet
}

// ---------------------------------------------------------------------------
// Optimization engine output types
// ---------------------------------------------------------------------------

export interface LotSaleDetail {
  lot_id: string
  shares_to_sell: number
  proceeds: number
  cost_basis: number
  realized_gain_loss: number
  holding_period: 'LT' | 'ST'
}

export interface FundSaleResult {
  fund_id: string
  fund_name: string
  sell_amount: number
  accounting_method: AccountingMethod
  lots_sold: LotSaleDetail[]
  est_st_gain_loss: number
  est_lt_gain_loss: number
  est_tax_gross: number   // per-fund gross tax before netting (EST. TAX per CLAUDE.md constraint 3)
  impact_pct: number      // signed delta to portfolio asset class allocation
  impact_asset_class: string
  rationale: string
}

export interface WaitAndSaveNotice {
  lot_id: string
  fund_id: string
  days_until_lt: number
  lt_conversion_date: string
  tax_savings_by_waiting: number
}

export interface AllocationImpact {
  domestic_equity_before: number
  international_equity_before: number
  domestic_bonds_before: number
  short_term_reserves_before: number
  domestic_equity_after: number
  international_equity_after: number
  domestic_bonds_after: number
  short_term_reserves_after: number
}

// Entity 9 — Recommendation (automated engine output)
export interface Recommendation {
  recommendation_id: string
  mode: 'automated'
  optimization_priority: 'tax-first' | 'balance-first'
  fund_results: FundSaleResult[]
  est_net_tax: number          // portfolio-level netting (EST. NET TAX per CLAUDE.md constraint 3)
  effective_rate: number
  allocation_impact: AllocationImpact
  plain_language_rationale: string
  wait_and_save_notices: WaitAndSaveNotice[]
  tax_assumption_set: TaxAssumptionSet
  timestamp: string
}

// Entity 8 — Scenario
export interface ScenarioFundSelection {
  fund_id: string
  fund_name?: string               // display name — populated when scenario is saved
  sell_amount: number
  accounting_method: AccountingMethod
  lots_selected: LotSaleDetail[]  // empty unless SpecID
  st_gain_loss?: number            // per-fund net ST gain (+) or loss (−); set on save
  lt_gain_loss?: number            // per-fund net LT gain (+) or loss (−); set on save
  est_tax_gross?: number           // per-fund gross tax (before portfolio netting); set on save
}

export interface SavedScenario {
  scenario_id: string
  scenario_name: string
  source_mode: 'automated' | 'manual'
  optimization_priority?: 'tax-first' | 'balance-first'  // only set for automated scenarios
  fund_selections: ScenarioFundSelection[]
  total_sell_amount: number        // sum of all fund sell_amounts
  projected_st_gains: number       // net positive ST gains
  projected_lt_gains: number       // net positive LT gains
  losses_harvested: number         // sum of all negative gains (negative value)
  net_taxable_gain: number         // projected_st_gains + projected_lt_gains + losses_harvested
  est_net_tax: number
  effective_rate: number
  allocation_impact: AllocationImpact
  tradeoff_summary: string         // system-generated, grade 8 reading level per REQ-SC-004
  tax_assumption_set: TaxAssumptionSet
  created_at: string
}

// Manual mode configuration (transient, not yet saved as Scenario)
export interface ManualConfiguration {
  mode: 'manual'
  active_fund_ids: string[]
  fund_selections: ScenarioFundSelection[]
  fund_results: FundSaleResult[]           // per-fund engine output for display (gains, tax, impact)
  allocation_impact: AllocationImpact      // portfolio-level before/after allocation for IMPACT column
  applied_amounts: Record<string, number>  // ticker → cents (lifted state from ActiveFundRow)
  total_sell_amount: number
}

// ---------------------------------------------------------------------------
// Entity 13 — Portfolio State  (localStorage persistence, REQ-PS-001)
// ---------------------------------------------------------------------------

export interface PortfolioState {
  state_version: number
  base_dataset_version: string
  last_updated: string
  portfolio: Portfolio
  transaction_history: TransactionRecord[]
}

// ---------------------------------------------------------------------------
// Entity 14 — Transaction History Entry  (REQ-PS-002, REQ-PS-006)
// ---------------------------------------------------------------------------

export interface TransactionFundRecord {
  fund_id: string
  lots_sold: LotSaleDetail[]
  accounting_method: AccountingMethod
  sell_amount: number
  st_gain_loss: number   // net ST gain (positive) or loss (negative) for this fund
  lt_gain_loss: number   // net LT gain (positive) or loss (negative) for this fund
}

export interface TransactionRecord {
  transaction_id: string
  committed_timestamp: string
  target_sale_amount: number
  actual_sale_proceeds: number
  funds_sold: TransactionFundRecord[]
  realized_st_gains: number    // positive ST gains only
  realized_lt_gains: number    // positive LT gains only
  losses_harvested: number     // negative value — sum of negative gains (losses realized)
  net_taxable_gain: number     // realized_st_gains + realized_lt_gains + losses_harvested
  est_tax_at_active_rate: number
  effective_rate: number       // est_tax / target_sale_amount
  cumulative_ytd_st_gains: number
  cumulative_ytd_lt_gains: number
  optimization_mode: 'tax-first' | 'balance-first'
  accounting_method: AccountingMethod
  resulting_portfolio_state_version: number
  // Allocation impact snapshot — for ES-1 portfolio rebalancing display
  stocks_before_pct: number
  bonds_before_pct: number
  reserves_before_pct: number
  stocks_after_pct: number
  bonds_after_pct: number
  reserves_after_pct: number
  tax_savings_vs_fifo?: number  // optimized EST. NET TAX vs naive FIFO baseline for same funds/amounts
}

// ---------------------------------------------------------------------------
// Entity 10b — Active Account Designation
// ---------------------------------------------------------------------------

export interface ActiveAccountDesignation {
  active_account_id: string
  selection_source: 'system_default' | 'user_selected'
}
