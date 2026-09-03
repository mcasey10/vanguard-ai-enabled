/**
 * Narration input/output types and the pure logic shared between the
 * client (dev/src/utils/narration.ts) and the server (dev/src/server/,
 * dev/api/narrate.ts). Nothing in this file touches the network or reads
 * an API key — see CLAUDE.md §7 for the CD-4.2 boundary this enforces.
 */

import type { AccountingMethod, AccountType } from '../types'

export type NarrationTouchpoint =
  | 'fund_selection_rationale'
  | 'scenario_tradeoff_summary'
  | 'order_confirmation_summary'
  | 'execution_summary_narrative'

export type NarrationTense = 'prospective' | 'past'

// PRD 04 Segments A-D (CLAUDE.md §4, §6 CD-2.x). Segment A prefers terse,
// figure-forward copy; B-D get more explanatory framing.
export type NarrationSegment = 'A' | 'B' | 'C' | 'D'

export interface NarrationLotLine {
  lot_id: string
  acquisition_date: string
  holding_period: 'ST' | 'LT'
  realized_gain_loss: number
}

export interface NarrationFundLine {
  fund_id: string
  fund_name: string
  asset_class: string
  account_type: AccountType
  accounting_method: AccountingMethod
  sell_amount: number
  st_gain_loss: number
  lt_gain_loss: number
  est_tax_gross?: number
  impact_pct?: number
  lots?: NarrationLotLine[]
  /** Only ever populated by buildMarketContext() below — never set directly. */
  market_context_return_pct?: number
}

export interface NarrationWaitAndSaveLine {
  fund_id: string
  lot_id: string
  days_until_lt: number
  tax_savings_by_waiting: number
}

export interface NarrationAllocationSnapshot {
  domestic_equity: number
  international_equity: number
  domestic_bonds: number
  short_term_reserves: number
}

export interface NarrationAllocationImpact {
  before: NarrationAllocationSnapshot
  after: NarrationAllocationSnapshot
  target: NarrationAllocationSnapshot
}

export interface NarrationInput {
  touchpoint: NarrationTouchpoint
  tense: NarrationTense
  segment: NarrationSegment
  funds: NarrationFundLine[]
  est_net_tax?: number
  effective_rate?: number
  losses_harvested?: number
  /**
   * Only ever populated with a real, nonzero figure — never the
   * 'not_applicable' sentinel, and never a genuine $0. Both of those cases
   * are coerced to `undefined` at the narrationBuilders.ts boundary before
   * they ever reach this type, so `undefined` here means exactly one thing
   * to every consumer (the prompt, the deterministic fallback): don't
   * mention a penalty at all. This is a deliberate design choice (omit by
   * default, state only when real), not a narrower version of the
   * TaxFigureOrNA type that happened to lose the sentinel — see
   * DECISIONS.md's IRA narration entry.
   */
  est_early_withdrawal_penalty?: number
  allocation_impact?: NarrationAllocationImpact
  wait_and_save_notices?: NarrationWaitAndSaveLine[]
}

export interface MarketContextExclusion {
  fund: string
  lot_id: string
  reason: string
}

// ---------------------------------------------------------------------------
// market_context_exclusions check — CLAUDE.md §11's 11th coverage category
// tests this mechanism directly, not just the one hardcoded VFITX case.
// ---------------------------------------------------------------------------

/** True if narrating `fund_id` alongside any of `lot_ids` must suppress market context. */
export function isMarketContextExcluded(
  fund_id: string,
  lot_ids: string[],
  exclusions: MarketContextExclusion[]
): boolean {
  return exclusions.some(ex => ex.fund === fund_id && lot_ids.includes(ex.lot_id))
}

/**
 * The only place market_context_return_pct is ever set. Checks
 * market_context_exclusions before including a figure — callers must never
 * set market_context_return_pct directly (see NarrationFundLine's comment).
 */
export function buildMarketContext(
  fund_id: string,
  lot_ids: string[],
  trailing_12mo_return: Record<string, number> | undefined,
  exclusions: MarketContextExclusion[]
): number | undefined {
  if (!trailing_12mo_return) return undefined
  if (isMarketContextExcluded(fund_id, lot_ids, exclusions)) return undefined
  return trailing_12mo_return[fund_id]
}

// ---------------------------------------------------------------------------
// Deterministic fallback — used when the live Anthropic call fails.
// CLAUDE.md §7: this is the PRIMARY-content fallback (unlike the market-data
// sentence, which is omitted silently on failure) and must never carry the
// CD-1.2 AI-generated disclosure badge.
// ---------------------------------------------------------------------------

function fmtMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n < 0 ? '-' : ''}$${abs}`
}

function fundLineFallback(f: NarrationFundLine, tense: NarrationTense): string {
  const assetClass = f.asset_class.replace(/_/g, ' ')
  const verb = tense === 'past' ? 'Sold' : 'Selling'
  const totalGain = r2(f.st_gain_loss + f.lt_gain_loss)
  const gainWord = totalGain < 0 ? 'a loss of' : 'a gain of'
  const taxNote = f.account_type === 'traditional_IRA'
    ? ' Traditional IRA withdrawals are taxed as ordinary income regardless of this gain/loss figure.'
    : ''
  let sentence = `${verb} ${fmtMoney(f.sell_amount)} of ${f.fund_name} (${assetClass}) via ${methodLabel(f.accounting_method)}, realizing ${gainWord} ${fmtMoney(Math.abs(totalGain))}.${taxNote}`
  if (f.market_context_return_pct !== undefined) {
    const dir = f.market_context_return_pct >= 0 ? 'gained' : 'lost'
    sentence += ` ${f.fund_name} has ${dir} ${Math.abs(f.market_context_return_pct).toFixed(2)}% over the trailing 12 months.`
  }
  return sentence
}

function methodLabel(m: AccountingMethod): string {
  switch (m) {
    case 'specific_lot_identification': return 'specific lot identification'
    case 'average_cost': return 'average cost'
    default: return m
  }
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Plain, deterministic summary built from exactly the structured figures in
 * `input` — never anything the engine didn't already compute. This is what
 * ships when the live model call fails; it deliberately reads as competent
 * but plain, not as a stand-in for the AI voice.
 */
export function buildDeterministicFallback(input: NarrationInput): string {
  const lines = input.funds.map(f => fundLineFallback(f, input.tense))
  let text = lines.join(' ')

  if (input.est_net_tax !== undefined) {
    text += ` Estimated net tax across this transaction: ${fmtMoney(input.est_net_tax)}.`
  }
  // Only ever present when real and nonzero (see NarrationInput's own doc
  // comment) — omitted entirely otherwise, matching the AI prompt's
  // identical instruction, so the fallback and the live model never
  // disagree on when this gets mentioned.
  if (input.est_early_withdrawal_penalty !== undefined) {
    text += ` Estimated early withdrawal penalty: ${fmtMoney(input.est_early_withdrawal_penalty)}.`
  }
  if (input.wait_and_save_notices && input.wait_and_save_notices.length > 0) {
    const n = input.wait_and_save_notices[0]
    text += ` Waiting ${n.days_until_lt} more day${n.days_until_lt === 1 ? '' : 's'} on lot ${n.lot_id} would convert it to long-term treatment, saving an estimated ${fmtMoney(n.tax_savings_by_waiting)}.`
  }
  return text.trim()
}
