import type { Account, AccountType, Portfolio, SavedScenario, TaxFigureOrNA } from '../types'

// Friendly display name for an account type — the one shared place this
// mapping should live (D057: found duplicated/incomplete in more than one
// place, e.g. OrderConfirmation.tsx falling back to the raw "roth_IRA"
// enum string once account switching made a non-taxable order reachable).
const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  taxable_brokerage: 'Taxable Brokerage',
  traditional_IRA: 'Traditional IRA',
  roth_IRA: 'Roth IRA',
}

export function accountTypeLabel(accountType: AccountType | undefined | null): string {
  return accountType ? ACCOUNT_TYPE_LABELS[accountType] : 'Taxable Brokerage'
}

/**
 * Resolves the real Account a saved scenario belongs to — the one shared
 * place this fallback should live (D067's Tier 3 finding: scenarios can
 * genuinely span different accounts, so both Scenario Analysis's per-scenario
 * header label and the Scenario assistant's summary card need this same
 * lookup, not two independently-written copies of it). Falls back to the
 * portfolio's taxable_brokerage account for a scenario saved before
 * account_id existed (D057) — the seeded canonical demo scenarios are the
 * only real case of this, and they're genuinely taxable-only, same fallback
 * SavedScenario.account_id's own doc comment and startEditingScenario (D061)
 * already establish.
 */
export function resolveScenarioAccount(
  scenario: Pick<SavedScenario, 'account_id' | 'account_type'>,
  portfolio: Portfolio
): Account | undefined {
  if (scenario.account_id) {
    const found = portfolio.accounts.find(a => a.account_id === scenario.account_id)
    if (found) return found
  }
  return portfolio.accounts.find(a => a.account_type === 'taxable_brokerage') ?? portfolio.accounts[0]
}

// Compute "X% Stocks / Y% Bonds / Z% Reserves" from live account holdings.
export function accountAllocStr(account: Account): string {
  const total = account.holdings.reduce((s, h) => s + h.current_balance, 0)
  if (total === 0) return ''
  const stocks  = account.holdings.filter(h => h.asset_class === 'domestic_equity' || h.asset_class === 'international_equity').reduce((s, h) => s + h.current_balance, 0)
  const bonds   = account.holdings.filter(h => h.asset_class === 'domestic_bonds').reduce((s, h) => s + h.current_balance, 0)
  const reserves = account.holdings.filter(h => h.asset_class === 'short_term_reserves').reduce((s, h) => s + h.current_balance, 0)
  return `${Math.round(stocks / total * 100)}% Stocks / ${Math.round(bonds / total * 100)}% Bonds / ${Math.round(reserves / total * 100)}% Reserves`
}

// Currency — always shows $ sign, comma separators, 2 decimal places
// e.g. 25000.03 → "$25,000.03"
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Currency compact — no cents for round display values (Summary Banner SALE TOTAL)
// e.g. 25000 → "$25,000"
export function formatCurrencyCompact(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Shares — up to 3 decimal places, comma separators, no trailing zeros
// e.g. 1597 → "1,597" | 103.306 → "103.306" | 200.0 → "200"
export function formatShares(shares: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(shares);
}

// TaxFigureOrNA (types/index.ts) → a plain number, treating 'not_applicable'
// as 0 for arithmetic/aggregation purposes — this is the one shared
// coercion boundary, not a check duplicated at every summation site. Only
// use this where the not-applicable distinction genuinely doesn't matter
// to the consumer (e.g. narration, which already has its own correct,
// separate handling of the IRA $0 case) — for display, use
// formatTaxFigure() below instead, which preserves the distinction.
export function taxFigureToNumber(v: TaxFigureOrNA): number {
  return v === 'not_applicable' ? 0 : v
}

// TaxFigureOrNA → display string — "N/A" for a genuinely not-applicable
// figure (e.g. per-fund gross tax on an IRA holding), never "$0.00", which
// would wrongly imply "calculated, no tax owed."
export function formatTaxFigure(v: TaxFigureOrNA): string {
  return v === 'not_applicable' ? 'N/A' : formatCurrency(v)
}

// Percentage — always shows 1 decimal place with % sign
// e.g. 0.0044 → "0.4%" | 2.77 → "2.8%"
export function formatPercent(value: number, alreadyPercent = false): string {
  const pct = alreadyPercent ? value : value * 100;
  return (
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(pct) + "%"
  );
}
