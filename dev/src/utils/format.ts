import type { Account } from '../types'

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
