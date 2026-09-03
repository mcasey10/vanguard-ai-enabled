/**
 * Feature 2 (what-if assistant) — isomorphic types shared by the server-side
 * interpreter adapters, the client orchestration, and tests. Sibling to
 * narrationShared.ts, not an extension of it — see DECISIONS.md D053 for why
 * Feature 1's NarrationGenerator contract (structured figures in, prose out)
 * can't serve Feature 2's reverse-plus-fork shape (natural language in,
 * structured candidate OR a question out).
 */

import type { Portfolio, AccountType, SavedScenario } from '../types/index.js'
import type { ManualFundSelection } from '../engine/index.js'
// Reused, not redefined (D071) — the same A/B/C/D reader-tone concept
// narration already carries (CLAUDE.md §6/CD-2.x); keeping one type avoids
// the two features' segment concepts drifting apart the way their letters
// once could have without a shared source of truth.
import type { NarrationSegment } from './narrationShared.js'

// Re-exported, not redefined — a what-if candidate's fund selection is
// exactly a ManualFundSelection; keeping one shape avoids two definitions
// drifting apart.
export type WhatIfCandidateFundSelection = ManualFundSelection

export interface WhatIfTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface WhatIfFundLotReference {
  lot_id: string
  holding_period: 'LT' | 'ST'
  shares: number
  current_value: number
  // cost_basis_per_share / current_nav (D063): added so the inline lot table
  // can show gain/share, and — necessarily, since this is the same shape fed
  // to the interpreter's grounding context below — so a criterion-based
  // request ("prioritize the lots with the smallest gains") is answerable at
  // all. Deliberately still NOT a computed tax/gain-dollar figure: the
  // interpreter can compare per-share magnitudes to pick lots, but actual
  // realized gain/loss and tax dollars remain the engine's job downstream
  // (confirmWhatIfCandidate → runOptimization) — this doesn't hand the
  // interpreter anything it could use to fabricate a tax estimate itself.
  cost_basis_per_share: number
  current_nav: number
}

export interface WhatIfFundReference {
  fund_id: string
  fund_name: string
  asset_class: string
  current_balance: number
  available_accounting_methods: string[]
  lots: WhatIfFundLotReference[]
}

/**
 * Grounding data for one account — the only real funds/lots the interpreter
 * is allowed to reference. Deliberately narrow: no tax figures, no
 * engine-computed gain/loss dollar amounts, nothing beyond what a user
 * already sees in the app's own UI for this account. Per-lot
 * cost_basis_per_share/current_nav (D063) is an exception explicitly let
 * through this boundary, not an oversight — it's real, already-user-visible
 * data (the same figures FundSelectionManualLot.tsx's own lot table shows),
 * and criterion-based lot selection ("prioritize the smallest gains") is
 * architecturally impossible to interpret correctly without it. The
 * boundary that still holds: the interpreter may compare these to rank or
 * select lots, but never to compute or state a dollar gain/loss or tax
 * figure itself — that stays the engine's job (confirmWhatIfCandidate →
 * runOptimization), same as before.
 */
// A saved scenario's real fund_selections, exposed read-only to the
// interpreter (D064) so it can answer "like Scenario 2 but sell more VBTLX"
// or, when `is_modify_target` is set, "change this to sell $20,000 instead."
// `label` is the same 1-based "Scenario N" numbering the UI already shows —
// scenario_id is an internal key the user never sees or refers to. No tax
// figures here, same boundary as WhatIfFundReference above.
export interface WhatIfScenarioReference {
  scenario_id: string
  label: string
  mode: 'automated' | 'manual'
  optimization_priority?: 'tax-first' | 'balance-first'
  fund_selections: Array<{ fund_id: string; sell_amount: number; accounting_method: string }>
  is_modify_target: boolean
  // Which account this scenario was actually built against (D067, closing
  // the residual gap D067 itself flagged) — scenarios can genuinely span
  // different accounts (CLAUDE.md §5/D057, confirmed live in D067's Tier 3),
  // so a reference like "like Scenario 1 but in my Roth IRA" is meaningless
  // without knowing Scenario 1's own account. Falls back to
  // "taxable_brokerage" for a scenario saved before account_type existed,
  // same precedent as every other account_id?/account_type? fallback in this
  // codebase (D057/D061).
  account_type: AccountType
}

export interface PortfolioReferenceContext {
  account_id: string
  account_type: AccountType
  funds: WhatIfFundReference[]
  existing_scenarios: WhatIfScenarioReference[]
}

export function buildPortfolioReferenceContext(
  portfolio: Portfolio,
  activeAccountId: string,
  scenarios: SavedScenario[] = [],
  modifyingScenarioId?: string
): PortfolioReferenceContext {
  const account = portfolio.accounts.find(a => a.account_id === activeAccountId)
  if (!account) {
    throw new Error(`buildPortfolioReferenceContext: account "${activeAccountId}" not found in portfolio`)
  }
  return {
    account_id: account.account_id,
    account_type: account.account_type,
    funds: account.holdings.map(h => ({
      fund_id: h.fund_id,
      fund_name: h.fund_name,
      asset_class: h.asset_class,
      current_balance: h.current_balance,
      available_accounting_methods: h.available_accounting_methods,
      lots: h.lots.map(l => ({
        lot_id: l.lot_id,
        holding_period: l.holding_period,
        shares: l.shares,
        current_value: l.current_value,
        cost_basis_per_share: l.cost_basis_per_share,
        current_nav: l.current_nav,
      })),
    })),
    existing_scenarios: scenarios.map((s, i) => ({
      scenario_id: s.scenario_id,
      label: `Scenario ${i + 1}`,
      mode: s.source_mode,
      optimization_priority: s.optimization_priority,
      fund_selections: s.fund_selections.map(fs => ({
        fund_id: fs.fund_id, sell_amount: fs.sell_amount, accounting_method: fs.accounting_method,
      })),
      is_modify_target: s.scenario_id === modifyingScenarioId,
      account_type: s.account_type ?? 'taxable_brokerage',
    })),
  }
}

/**
 * A candidate is exactly what the engine needs beyond {portfolio,
 * activeAccountId, activeTaxRates} — see whatIfCandidateToParams.ts for the
 * (calculation-free) mapping onto OptimizationParams.
 */
export interface WhatIfCandidate {
  mode: 'manual' | 'automated'
  targetSaleAmount: number
  optimizationPriority?: 'tax-first' | 'balance-first'
  manualSelections?: { fund_selections: WhatIfCandidateFundSelection[] }
}

export interface WhatIfInterpretationInput {
  utterance: string
  history: WhatIfTurn[]
  reference: PortfolioReferenceContext
  // Reader tone for clarifying questions and confirm summaries (D071) — the
  // session-level user-selected value (Demo Settings dialog), threaded
  // through the same way NarrationInput.segment already is for Feature 1.
  // Required, not optional-with-a-silent-default: every call site states it
  // explicitly, matching this project's own standing discipline for any
  // other meaningful field (CLAUDE.md's CORE RULE precedent in
  // whatIfPrompt.ts — no silent defaults for something that actually varies).
  segment: NarrationSegment
}

/**
 * The core boundary (CLAUDE.md §1 / D053): never construct a candidate from
 * an unstated or inferred value. If anything required is ambiguous or
 * missing, the result must be "clarify" — never a guessed "confirm".
 */
export type WhatIfInterpretationResult =
  | { type: 'clarify'; question: string }
  | { type: 'refuse'; reason: string }
  | { type: 'confirm'; candidate: WhatIfCandidate; summary: string }
