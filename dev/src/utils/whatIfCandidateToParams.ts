/**
 * Pure reshaping only, no calculation — mirrors narrationBuilders.ts's role
 * for Feature 1. Converts a validated WhatIfCandidate into the exact
 * OptimizationParams shape runOptimization() already accepts from Fund
 * Selection (CLAUDE.md §8: the assistant calls the shared engine module
 * directly, never a parallel implementation of it).
 */

import type { Portfolio } from '../types'
import type { OptimizationParams } from '../engine/index'
import type { WhatIfCandidate } from './whatIfShared'

export function buildOptimizationParamsFromCandidate(
  candidate: WhatIfCandidate,
  portfolio: Portfolio,
  activeAccountId: string,
  activeTaxRates: { st_rate: number; lt_rate: number }
): OptimizationParams {
  if (candidate.mode === 'automated') {
    return {
      portfolio,
      activeAccountId,
      activeTaxRates,
      targetSaleAmount: candidate.targetSaleAmount,
      mode: 'automated',
      optimizationPriority: candidate.optimizationPriority ?? 'tax-first',
    }
  }

  const fundSelections = candidate.manualSelections?.fund_selections ?? []
  return {
    portfolio,
    activeAccountId,
    activeTaxRates,
    // Derived from the fund selections' own sell_amounts (already validated
    // by validateCandidate() to each be a real positive number, or absent
    // only for a SpecID selection) rather than trusted from the candidate's
    // own top-level field — the model was found, live, to inconsistently
    // omit targetSaleAmount for a fund-specific candidate even though every
    // selection's own amount was correct (DECISIONS.md's amount-rejection
    // bug entry). OptimizationParams still requires a real number here, and
    // the engine's manual-mode branch never actually reads it once every
    // selection has its own sell_amount, but deriving a correct one rather
    // than passing through a possibly-undefined candidate.targetSaleAmount
    // keeps this parameter object honest regardless of what future code
    // might read it.
    targetSaleAmount: fundSelections.reduce((s, fs) => s + (fs.sell_amount ?? 0), 0),
    mode: 'manual',
    // Unused by the engine in manual mode, but OptimizationParams requires it.
    optimizationPriority: 'tax-first',
    manualSelections: { fund_selections: fundSelections },
  }
}
