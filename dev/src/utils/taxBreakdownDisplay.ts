/**
 * taxBreakdownDisplay.ts — pure formatting/content logic for the "Breakdown
 * ▾" panel (DECISIONS.md's breakdown-expanders entry). No JSX here, by
 * design (same split as accountBanner.ts/narrationBuilders.ts elsewhere in
 * this codebase) — TaxBreakdownPanel.tsx renders whatever this file
 * decides, so the actual arithmetic/formatting logic stays independently
 * testable with plain Vitest, no React rendering required.
 *
 * The tax-line values here always use computeNetTaxBreakdown()'s
 * taxableAtST/taxableAtLT (the real blended-rate attribution), never the
 * raw netSTGain/netLTGain — the two are numerically identical whenever
 * neither category is a loss the other category's gain absorbs, which
 * covers every case this feature was actually reviewed against, but they
 * genuinely diverge under cross-category netting (see engine/index.ts's
 * NetTaxBreakdown doc comment and engine.test.ts's dedicated cases). Using
 * taxableAtST/taxableAtLT is what keeps this panel's displayed numbers
 * always summing to the real total, in every case, not just the common one.
 */

import type { NetTaxBreakdown } from '../engine/index'
import { formatCurrency } from './format'

export interface FundGainLossEntry {
  est_st_gain_loss: number
  est_lt_gain_loss: number
  sell_amount: number
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

function fmtSignedCurrency(n: number): string {
  const rounded = r2(n)
  if (rounded === 0) return formatCurrency(0)
  return (rounded > 0 ? '+' : '−') + formatCurrency(Math.abs(rounded))
}

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

/**
 * Builds the "$645.81 − $483.69 = +$162.12"-style netting equation for one
 * category (ST or LT) from that category's real per-fund amounts, or
 * returns null when there's no real netting story to tell: 0–1 nonzero
 * contributing funds, or 2+ contributing funds that all share the same
 * sign (nothing is actually offsetting anything). A fund with a $0 amount
 * in this specific category doesn't "contribute" and never appears in the
 * equation at all, regardless of how many funds were sold overall.
 */
export function formatNettingEquation(amounts: number[]): string | null {
  const nonzero = amounts.filter(a => a !== 0)
  if (nonzero.length <= 1) return null
  const allPositive = nonzero.every(a => a > 0)
  const allNegative = nonzero.every(a => a < 0)
  if (allPositive || allNegative) return null

  const net = r2(nonzero.reduce((s, a) => s + a, 0))
  const terms = nonzero.map((amount, i) => {
    const abs = formatCurrency(Math.abs(amount))
    if (i === 0) return amount < 0 ? `−${abs}` : abs
    return amount < 0 ? `− ${abs}` : `+ ${abs}`
  })
  return `${terms.join(' ')} = ${fmtSignedCurrency(net)}`
}

/**
 * The "Net short-term/long-term gain/loss" row's display value — the full
 * netting equation when formatNettingEquation() has one, otherwise just the
 * plain signed net figure alone.
 */
export function formatNetGainLine(amounts: number[]): string {
  const net = r2(amounts.reduce((s, a) => s + a, 0))
  return formatNettingEquation(amounts) ?? fmtSignedCurrency(net)
}

/** "{taxable amount} × {rate}% = {tax}" — the shared shape for both the
 *  taxable-brokerage ST/LT tax lines and the Traditional IRA line. */
export function formatTaxLine(taxableAmount: number, rate: number, tax: number): string {
  return `${formatCurrency(taxableAmount)} × ${fmtPct(rate)} = ${formatCurrency(tax)}`
}

export function formatEffectiveRate(totalTax: number, saleTotal: number): string {
  const rate = saleTotal > 0 ? (totalTax / saleTotal) * 100 : 0
  return `${rate.toFixed(2)}%`
}

/**
 * Structured content for the taxable-brokerage variant — TaxBreakdownPanel
 * renders these fields directly, in order, with no further computation of
 * its own beyond the visual "total" vs. "effective rate (for reference)"
 * distinction the task calls for (a styling concern, handled in the .tsx).
 */
export interface TaxableBrokerageBreakdownDisplay {
  kind: 'taxable_brokerage'
  netSTLine: string
  netLTLine: string
  netTaxableGainLine: string
  stTaxLine: string
  ltTaxLine: string
  totalLine: string
  effectiveRateLine: string
}

export interface TraditionalIraBreakdownDisplay {
  kind: 'traditional_IRA'
  taxLine: string
  effectiveRateLine: string
}

export interface RothIraBreakdownDisplay {
  kind: 'roth_IRA'
  note: string
}

export type TaxBreakdownDisplay =
  | TaxableBrokerageBreakdownDisplay
  | TraditionalIraBreakdownDisplay
  | RothIraBreakdownDisplay

/**
 * Assembles the full display content for the "Breakdown ▾" panel. `funds`
 * supplies the per-fund amounts needed for the netting equations only —
 * every actual number (net totals, taxable attribution, tax owed) comes
 * from `breakdown` (computeNetTaxBreakdown()'s real output), never
 * re-derived here from `funds` a second time, which is exactly the
 * duplicated-calculation risk this task's self-audit named.
 */
export function buildTaxBreakdownDisplay(
  accountType: 'taxable_brokerage' | 'traditional_IRA' | 'roth_IRA',
  funds: FundGainLossEntry[],
  breakdown: NetTaxBreakdown,
  taxRates: { st_rate: number; lt_rate: number },
  saleTotal: number,
  rothQualifiedNote: string
): TaxBreakdownDisplay {
  if (accountType === 'roth_IRA') {
    return { kind: 'roth_IRA', note: rothQualifiedNote }
  }
  if (accountType === 'traditional_IRA') {
    return {
      kind: 'traditional_IRA',
      taxLine: formatTaxLine(breakdown.totalWithdrawal, taxRates.st_rate, breakdown.total),
      effectiveRateLine: formatEffectiveRate(breakdown.total, saleTotal),
    }
  }
  return {
    kind: 'taxable_brokerage',
    netSTLine: formatNetGainLine(funds.map(f => f.est_st_gain_loss)),
    netLTLine: formatNetGainLine(funds.map(f => f.est_lt_gain_loss)),
    // The bridging step the panel was missing: net ST and net LT are each
    // shown above, then the tax lines below jump straight to a third number
    // (taxableAtST/taxableAtLT) with nothing connecting the two — this row
    // is that connection, reusing the same "show the netting equation when
    // there's a real offsetting story, otherwise just the net number"
    // convention formatNetGainLine already applies within a single category,
    // now applied across the two categories. Same figure and same label as
    // Scenario Analysis's existing "Net Taxable Gain" row (ScenarioAnalysis.tsx
    // TaxRow, SavedScenario.net_taxable_gain) — reused, not reinvented.
    netTaxableGainLine: formatNetGainLine([breakdown.netSTGain, breakdown.netLTGain]),
    stTaxLine: formatTaxLine(breakdown.taxableAtST, taxRates.st_rate, breakdown.stTax),
    ltTaxLine: formatTaxLine(breakdown.taxableAtLT, taxRates.lt_rate, breakdown.ltTax),
    totalLine: formatCurrency(breakdown.total),
    effectiveRateLine: formatEffectiveRate(breakdown.total, saleTotal),
  }
}
