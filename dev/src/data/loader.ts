/**
 * Data loader — reads canonical dataset and handles localStorage persistence.
 *
 * Single source of truth: pm/08-sample-dataset.json (repo root).
 * Do NOT create a copy in dev/src/data/ — import directly from the path
 * Vite resolves via the alias configured in vite.config.ts, or via
 * a relative path from the built output. We use a JSON import with the
 * Vite ?url suffix approach or direct import.
 *
 * localStorage key: 'vsr_portfolio_state'  (REQ-PS-001)
 * All functions gracefully handle localStorage unavailable or corrupted data.
 */

import type { Portfolio, PortfolioState, TransactionRecord, Account, RMDRecord } from '../types'

// ---------------------------------------------------------------------------
// Import canonical dataset
// Vite treats JSON imports as ES modules; the path is relative to this file.
// dev/src/data/loader.ts → ../../.. is repo root → pm/08-sample-dataset.json
// ---------------------------------------------------------------------------
import rawDataset from '../../../pm/08-sample-dataset.json'

const LS_KEY = 'vsr_portfolio_state'
const DATASET_VERSION = '1.0'

// ---------------------------------------------------------------------------
// Internal: build a Portfolio object from the raw canonical JSON
// ---------------------------------------------------------------------------
function buildPortfolioFromRaw(raw: typeof rawDataset): Portfolio {
  // Attach RMD records to the matching account
  const rmdByAccount: Record<string, RMDRecord> = {}
  for (const rmd of raw.rmd_records) {
    rmdByAccount[rmd.account_id] = rmd as RMDRecord
  }

  const accounts: Account[] = raw.accounts.map(acct => ({
    account_id: acct.account_id,
    portfolio_id: acct.portfolio_id,
    account_type: acct.account_type as Account['account_type'],
    account_balance: acct.account_balance,
    rmd_applicable: acct.rmd_applicable,
    settlement_account_id: acct.settlement_account_id,
    masked_number: (acct as Record<string, unknown>).masked_number as string ?? '',
    holdings: acct.holdings.map(h => ({
      fund_id: h.fund_id,
      fund_name: h.fund_name,
      asset_class: h.asset_class as import('../types').FundHolding['asset_class'],
      total_shares: h.total_shares,
      current_balance: h.current_balance,
      current_allocation_weight_pct: h.current_allocation_weight_pct,
      available_accounting_methods: h.available_accounting_methods as import('../types').AccountingMethod[],
      unrealized_st_gain_loss: h.unrealized_st_gain_loss,
      unrealized_lt_gain_loss: h.unrealized_lt_gain_loss,
      total_unrealized_gain_loss: h.total_unrealized_gain_loss,
      total_cost_basis: h.total_cost_basis,
      lots: h.lots.map(l => ({
        lot_id: l.lot_id,
        acquisition_date: l.acquisition_date,
        shares: l.shares,
        cost_basis_per_share: l.cost_basis_per_share,
        total_cost_basis: l.total_cost_basis,
        current_nav: l.current_nav,
        current_value: l.current_value,
        unrealized_gain_loss: l.unrealized_gain_loss,
        holding_period: l.holding_period as 'LT' | 'ST',
        days_to_lt_conversion: (l as Record<string, unknown>).days_to_lt_conversion as number | null ?? null,
        lt_conversion_date: (l as Record<string, unknown>).lt_conversion_date as string | null ?? null,
        wait_and_save_flag: (l as Record<string, unknown>).wait_and_save_flag as boolean | undefined,
        wait_and_save_detail: (l as Record<string, unknown>).wait_and_save_detail as import('../types').WaitAndSaveDetail | undefined,
        harvestable_loss_flag: (l as Record<string, unknown>).harvestable_loss_flag as boolean | undefined,
        harvestable_loss_detail: (l as Record<string, unknown>).harvestable_loss_detail as import('../types').HarvestableLossDetail | undefined,
        note: (l as Record<string, unknown>).note as string | undefined,
      })),
    })),
    rmd_record: rmdByAccount[acct.account_id],
  }))

  const ta = raw.target_allocation
  const ytd = raw.ytd_gains_record

  return {
    portfolio_id: raw.portfolio.portfolio_id,
    user_id: raw.portfolio.user_id,
    total_investable_balance: raw.portfolio.total_investable_balance,
    current_allocation: {
      domestic_equity_pct: raw.portfolio.current_allocation.domestic_equity_pct,
      international_equity_pct: raw.portfolio.current_allocation.international_equity_pct,
      domestic_bonds_pct: raw.portfolio.current_allocation.domestic_bonds_pct,
      short_term_reserves_pct: raw.portfolio.current_allocation.short_term_reserves_pct,
    },
    target_allocation: ta ? {
      allocation_id: ta.allocation_id,
      portfolio_id: ta.portfolio_id,
      domestic_equity_pct: ta.domestic_equity_pct,
      international_equity_pct: ta.international_equity_pct,
      domestic_bonds_pct: ta.domestic_bonds_pct,
      short_term_reserves_pct: ta.short_term_reserves_pct,
      fund_level_targets: ta.fund_level_targets as Record<string, number> | null,
      source: ta.source as import('../types').TargetAllocation['source'],
      as_of_date: ta.as_of_date,
    } : null,
    accounts,
    ytd_gains_record: ytd ? {
      ytd_id: ytd.ytd_id,
      portfolio_id: ytd.portfolio_id,
      tax_year: ytd.tax_year,
      st_gains_realized_ytd: ytd.st_gains_realized_ytd,
      lt_gains_realized_ytd: ytd.lt_gains_realized_ytd,
      as_of_date: ytd.as_of_date,
      data_completeness_flag: ytd.data_completeness_flag as import('../types').YTDGainsRecord['data_completeness_flag'],
      source: ytd.source,
    } : null,
  }
}

/** The canonical portfolio built once from the JSON import. */
const CANONICAL_PORTFOLIO: Portfolio = buildPortfolioFromRaw(rawDataset)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * loadPortfolio — returns the portfolio from localStorage if present and
 * valid, otherwise returns the canonical sample dataset.
 * REQ-PS-005: hydrate from localStorage if Portfolio State exists.
 */
export function loadPortfolio(): Portfolio {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return structuredClone(CANONICAL_PORTFOLIO)

    const state: PortfolioState = JSON.parse(raw)

    // If the base dataset version has changed, fall back to canonical
    if (state.base_dataset_version !== DATASET_VERSION) {
      console.warn('[loader] Dataset version mismatch — reverting to canonical data')
      return structuredClone(CANONICAL_PORTFOLIO)
    }

    return state.portfolio
  } catch {
    // Corrupted localStorage — fall through to canonical
    return structuredClone(CANONICAL_PORTFOLIO)
  }
}

/**
 * savePortfolioState — persists the current portfolio state to localStorage.
 * REQ-PS-001: atomic update of all portfolio fields.
 */
export function savePortfolioState(portfolio: Portfolio, transactionHistory?: TransactionRecord[]): void {
  try {
    const existing = getStoredState()
    const state: PortfolioState = {
      state_version: (existing?.state_version ?? 0) + 1,
      base_dataset_version: DATASET_VERSION,
      last_updated: new Date().toISOString(),
      portfolio,
      transaction_history: transactionHistory ?? existing?.transaction_history ?? [],
    }
    localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch {
    console.error('[loader] Failed to save portfolio state to localStorage')
  }
}

/**
 * resetPortfolio — clears localStorage and reverts to canonical dataset.
 * REQ-PS-004: "Reset portfolio" clears localStorage, restores canonical data.
 */
export function resetPortfolio(): void {
  try {
    localStorage.removeItem(LS_KEY)
  } catch {
    console.error('[loader] Failed to clear localStorage')
  }
}

/**
 * getTransactionHistory — returns the transaction history from localStorage.
 * REQ-PS-006: Transaction History view for returning users.
 */
export function getTransactionHistory(): TransactionRecord[] {
  try {
    const state = getStoredState()
    return state?.transaction_history ?? []
  } catch {
    return []
  }
}

/**
 * appendTransaction — adds a transaction record to localStorage history.
 * REQ-PS-002: append Transaction History Entry on successful submission.
 */
export function appendTransaction(
  portfolio: Portfolio,
  record: TransactionRecord
): void {
  try {
    const existing = getStoredState()
    const history = [...(existing?.transaction_history ?? []), record]
    savePortfolioState(portfolio, history)
  } catch {
    console.error('[loader] Failed to append transaction')
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getStoredState(): PortfolioState | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PortfolioState
  } catch {
    return null
  }
}
