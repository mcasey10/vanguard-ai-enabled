/**
 * accountBanner.ts — shared display-content decisions for the IRA banner
 * redesign (DECISIONS.md's IRA banner redesign entry). Display/layout only:
 * every figure these functions describe was already correct and
 * consolidated as of D083/D084 (computeNetTax(), TaxFigureOrNA) — this file
 * decides what LABEL to show and which cards to show, never what to
 * compute. Six real touchpoints (Fund Selection Automated/Manual2/ManualLot,
 * Scenario Analysis, Order Confirmation, Execution Summary) each keep their
 * own JSX/layout and call these functions for the content decision, rather
 * than each re-deriving "what does this account type need to see" —
 * single source of truth for the *decision*, not a shared component for
 * the *layout* (those differ too much across touchpoints to unify, per the
 * self-audit — confirmed by reading each, not assumed).
 */

import type { AccountType } from '../types'

export interface BannerRateDisplay {
  label: string
  value: string
  /** Whether a "Change" link to TaxBracketDialog makes sense here. False
   *  for Roth IRA — qualified distributions are tax-free regardless of
   *  bracket, so there is nothing to change. */
  changeable: boolean
}

/**
 * What the "TAX BRACKET"-equivalent card shows, per account type:
 *   - taxable_brokerage: both ST/LT rates, as today.
 *   - traditional_IRA: ordinary income rate only (st_rate) — the ST/LT
 *     split is meaningless here, since a Traditional IRA withdrawal is
 *     ordinary income, never a capital gain (CLAUDE.md constraint 2).
 *   - roth_IRA: no rate to show at all — qualified distributions are
 *     tax-free regardless of bracket.
 */
export function bannerRateDisplay(
  accountType: AccountType | undefined,
  rates: { st_rate: number; lt_rate: number }
): BannerRateDisplay {
  if (accountType === 'roth_IRA') {
    return { label: 'TAX STATUS', value: 'Tax-free (qualified)', changeable: false }
  }
  if (accountType === 'traditional_IRA') {
    return { label: 'ORDINARY INCOME RATE', value: `${Math.round(rates.st_rate * 100)}%`, changeable: true }
  }
  return {
    label: 'TAX BRACKET',
    value: `${Math.round(rates.st_rate * 100)}% ST / ${Math.round(rates.lt_rate * 100)}% LT`,
    changeable: true,
  }
}

/**
 * YTD Realized is a taxable-brokerage capital-gains-tracking concept — it
 * doesn't apply to either IRA type's withdrawal-based tax treatment, since
 * neither one contributes to or is affected by realized-capital-gains YTD
 * totals. `undefined` (unresolved account) defaults to showing it, matching
 * this app's existing default-to-taxable convention elsewhere.
 */
export function bannerShowYtdRealized(accountType: AccountType | undefined): boolean {
  return accountType !== 'traditional_IRA' && accountType !== 'roth_IRA'
}

/**
 * Whether ST/LT gain/loss should render as two separate figures (taxable
 * brokerage, where the ST/LT split drives the actual tax rate applied) or
 * consolidated into one informational "Est. gain/loss (no tax impact)"
 * figure (either IRA type, where the split has no tax consequence — the
 * whole withdrawal is taxed as ordinary income, or not taxed at all).
 */
export function bannerShowSeparateGainLoss(accountType: AccountType | undefined): boolean {
  return accountType !== 'traditional_IRA' && accountType !== 'roth_IRA'
}

export const CONSOLIDATED_GAIN_LOSS_LABEL = 'EST. GAIN/LOSS (NO TAX IMPACT)'
/** Same label, title case — for the TaxRow-style rows (Scenario Analysis,
 *  Order Confirmation, Execution Summary) that use "Federal Tax"/"Net
 *  Taxable Gain" capitalization rather than the ALL-CAPS card labels. */
export const CONSOLIDATED_GAIN_LOSS_LABEL_TITLECASE = 'Est. gain/loss (no tax impact)'

/**
 * The existing net-tax figure (D083/D084) is already correct for every
 * account type — only the clearest label changes. Roth IRA keeps the
 * generic "EST. NET TAX" label (task's own scope: only Traditional IRA
 * gets a relabel, since "ordinary income tax" would be a strange thing to
 * call a figure that's always exactly $0).
 */
export function bannerNetTaxLabel(accountType: AccountType | undefined): string {
  return accountType === 'traditional_IRA' ? 'EST. ORDINARY INCOME TAX' : 'EST. NET TAX'
}

/**
 * Same relabeling for the TaxRow-style rows used in Scenario Analysis /
 * Order Confirmation / Execution Summary's tax-breakdown blocks, where
 * "Federal Tax" / "Est. Total Tax" / "Est. federal tax" are the
 * taxable-brokerage-era names for the same figure `bannerNetTaxLabel`
 * relabels above. Takes the exact Traditional-IRA replacement as a
 * parameter, rather than hardcoding one casing/wording — each touchpoint's
 * default label uses its own exact capitalization and suffix conventions
 * ("(estimated)", ALL-CAPS vs. Title Case), and the replacement should
 * match that same convention, not a single fixed string applied everywhere.
 */
export function bannerRelabelForIra(
  accountType: AccountType | undefined,
  defaultLabel: string,
  traditionalIraLabel: string
): string {
  return accountType === 'traditional_IRA' ? traditionalIraLabel : defaultLabel
}

/**
 * Both IRA types show the early-withdrawal-penalty card — always
 * not-applicable for this dataset's single investor (age 73, past the
 * 59½ threshold; see sample-dataset.json's note_retirement_status). This
 * is deliberately a display-layer constant, not a field threaded through
 * Recommendation/ManualConfiguration/SavedScenario — the underlying fact
 * (this investor's age makes the penalty inapplicable) is dataset-level
 * and identical regardless of transaction, mode, or account, so there is
 * nothing for a second data field to compute that this one constant
 * doesn't already say correctly. `Recommendation.est_early_withdrawal_penalty`
 * (D083) still exists as engine-level groundwork for a real future
 * calculation; this display constant is not a replacement for it, just the
 * thing every touchpoint shows today because that calculation isn't built.
 */
export function bannerShowEarlyWithdrawalPenalty(accountType: AccountType | undefined): boolean {
  return accountType === 'traditional_IRA' || accountType === 'roth_IRA'
}

export const EARLY_WITHDRAWAL_PENALTY_LABEL = 'EARLY WITHDRAWAL PENALTY'
export const EARLY_WITHDRAWAL_PENALTY_VALUE = 'N/A'
export const EARLY_WITHDRAWAL_PENALTY_NOTE =
  'Investor is 73 — past the age 59½ threshold where this penalty could apply.'

/**
 * Roth IRA's "Breakdown ▾" content (breakdown-expanders task, item 5) — a
 * deliberate addition beyond the reviewed mockup, not part of it: leaving
 * Roth's $0 tax figure as the only value in the banner with no explanation,
 * once every other "why is this the value it is" case gets an answer,
 * would be an odd asymmetry. Reuses the same underlying reasoning as
 * EARLY_WITHDRAWAL_PENALTY_NOTE above — both are condensed from the exact
 * same sample-dataset.json `note_retirement_status` field (age 73 exceeds
 * both the 59½ age and 5-year holding requirements) — but states the fact
 * that's actually relevant to a $0 *tax* figure (qualified distributions
 * are tax-free), not the penalty-specific fact the other note states; the
 * two notes describe two different real conclusions from the same
 * underlying age fact, not one note copy-pasted into two places.
 */
export const ROTH_QUALIFIED_DISTRIBUTION_NOTE =
  'Investor is 73 — well past the 59½ age and 5-year holding requirements for a qualified Roth distribution, so this withdrawal is entirely tax-free.'
