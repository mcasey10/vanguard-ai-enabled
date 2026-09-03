/**
 * Feature 2 (what-if assistant) backend tests — dev/src/utils/whatIf.test.ts
 *
 * Covers the 9 categories in CLAUDE.md §12's "What-if (Feature 2)" list,
 * plus the response parser, the validator (the D052-flagged gap this
 * feature is the first thing to actually enforce), the candidate→params
 * mapping, and provider selection.
 *
 * Test-fixture discipline (per D044, applied here "more directly" per this
 * session's kickoff instruction, since this feature *constructs* engine
 * inputs rather than just narrating existing ones): no fixture below
 * independently reconstructs an expected engine result. For every category
 * that reaches a "confirm" outcome, the test asserts on the structured
 * candidate object first, then runs that EXACT candidate through the real
 * engine (runOptimization(), via confirmWhatIfCandidate()) and asserts on
 * the real engine's own output — never a hand-computed number.
 *
 * What's mocked, and why: this suite never makes a live call to Gemini or
 * Anthropic — same rule as narration.test.ts (CLAUDE.md §7, D038 rule 4,
 * D042). Concretely, that means the *interpretation* step (natural language
 * -> structured candidate or question) is exercised through a hand-authored
 * WhatIfInterpreterLike test double for each of the 9 categories, standing
 * in for "what a correctly-behaving model would return for this utterance"
 * — the same role global.fetch mocking plays for narration. This is a
 * deliberate boundary: it tests the orchestration, validation, and real
 * engine integration exhaustively (the parts that are wrong if this code
 * has a bug), and does not attempt to test whether a live model actually
 * produces good interpretations of free-form English (that would require a
 * live call this suite is not allowed to make). Category 6 and 7's mocks
 * deliberately simulate a model that GOT IT WRONG (ignored the SpecID/IRA
 * rule, or passed through an over-large amount) specifically to prove the
 * code-level validator — not just the prompt — is what actually stops it.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadPortfolio } from '../data/loader'
import {
  buildPortfolioReferenceContext, type WhatIfInterpretationInput, type WhatIfInterpretationResult,
  type WhatIfTurn, type WhatIfCandidate,
} from './whatIfShared'
import { validateCandidate, validateSummary } from './whatIfValidation'
import { buildOptimizationParamsFromCandidate } from './whatIfCandidateToParams'
import { interpretWhatIfTurnWith, confirmWhatIfCandidate, WhatIfError, type WhatIfInterpreterLike } from './whatIf'
import { parseInterpreterResponse, WhatIfParseError } from '../server/whatIfResponseParser'
import { buildWhatIfPrompt } from '../server/whatIfPrompt'
import { runOptimization } from '../engine/index'
import { buildScenarioFromFundResults } from './scenarioBuilder'
import type { ManualConfiguration, Recommendation } from '../types'
import type { NarrationSegment } from './narrationShared'

const portfolio = loadPortfolio()
const TAX_RATES = { st_rate: 0.24, lt_rate: 0.15 }
const TAXABLE = 'ACCT-TAXABLE-001'
const TRAD_IRA = 'ACCT-TRAD-IRA-001'
const ROTH_IRA = 'ACCT-ROTH-IRA-001'

const taxableRef = buildPortfolioReferenceContext(portfolio, TAXABLE)
const tradIraRef = buildPortfolioReferenceContext(portfolio, TRAD_IRA)
const rothIraRef = buildPortfolioReferenceContext(portfolio, ROTH_IRA)

/** A test double satisfying WhatIfInterpreterLike — returns a fixed, pre-scripted result regardless of input, standing in for "what a correctly (or, for categories 6/7, incorrectly) behaving model would return." */
function fixedInterpreter(result: WhatIfInterpretationResult): WhatIfInterpreterLike {
  return { interpret: vi.fn(async () => result) }
}

function turn(utterance: string, history: WhatIfTurn[], accountRef = taxableRef, segment: NarrationSegment = 'A'): WhatIfInterpretationInput {
  return { utterance, history, reference: accountRef, segment }
}

describe('what-if coverage categories (CLAUDE.md §12)', () => {
  // 1. Clean unambiguous delta
  test('1. clean unambiguous delta', async () => {
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: { mode: 'manual', targetSaleAmount: 5000, manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] } },
      summary: 'Sell $5,000.00 of VTSAX using MinTax.',
    })
    const result = await interpretWhatIfTurnWith(mock, turn('Sell $5,000 of VTSAX', []))
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')
    expect(result.candidate.manualSelections?.fund_selections).toEqual([
      { fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 },
    ])

    // Second check: run the exact candidate through the REAL engine.
    const engineResult = confirmWhatIfCandidate(result.candidate, taxableRef, portfolio, TAXABLE, TAX_RATES) as ManualConfiguration
    expect(engineResult.mode).toBe('manual')
    const fr = engineResult.fund_results.find(f => f.fund_id === 'VTSAX')!
    expect(fr.sell_amount).toBe(5000)
    expect(fr.accounting_method).toBe('MinTax')
    expect(fr.est_tax_gross).toBeGreaterThan(0) // real gain lot — same tax-figure regression guard as D044
  })

  // 2. Vague/relative quantity requiring clarification
  test('2. vague-relative quantity requiring clarification', async () => {
    const mock = fixedInterpreter({ type: 'clarify', question: 'How much would you like to sell, in dollars?' })
    const result = await interpretWhatIfTurnWith(mock, turn('Sell a bit more of my bonds', []))
    expect(result).toEqual({ type: 'clarify', question: 'How much would you like to sell, in dollars?' })
  })

  // 3. Objective-shaped request mapping to Tax-first or Balance-first
  test('3. objective-shaped request', async () => {
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: { mode: 'automated', targetSaleAmount: 20000, optimizationPriority: 'tax-first' },
      summary: 'Raise $20,000.00 optimizing for the lowest tax impact.',
    })
    const result = await interpretWhatIfTurnWith(mock, turn('I want to reduce my tax impact — raise $20,000', []))
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')
    expect(result.candidate.mode).toBe('automated')
    expect(result.candidate.optimizationPriority).toBe('tax-first')

    const engineResult = confirmWhatIfCandidate(result.candidate, taxableRef, portfolio, TAXABLE, TAX_RATES) as Recommendation
    expect(engineResult.mode).toBe('automated')
    expect(engineResult.optimization_priority).toBe('tax-first')
    expect(engineResult.fund_results.length).toBeGreaterThan(0)
    expect(typeof engineResult.est_net_tax).toBe('number')
  })

  // 4. Full specification with explicit cost-basis methods
  test('4. full specification with explicit cost-basis methods', async () => {
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: {
        mode: 'manual',
        targetSaleAmount: 8000,
        manualSelections: {
          fund_selections: [
            { fund_id: 'VTSAX', accounting_method: 'FIFO', sell_amount: 5000 },
            { fund_id: 'VBTLX', accounting_method: 'HIFO', sell_amount: 3000 },
          ],
        },
      },
      summary: 'Sell $5,000.00 of VTSAX using FIFO and $3,000.00 of VBTLX using HIFO.',
    })
    const result = await interpretWhatIfTurnWith(mock, turn('Sell $5,000 of VTSAX using FIFO and $3,000 of VBTLX using HIFO', []))
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')

    const engineResult = confirmWhatIfCandidate(result.candidate, taxableRef, portfolio, TAXABLE, TAX_RATES) as ManualConfiguration
    expect(engineResult.fund_results.find(f => f.fund_id === 'VTSAX')!.accounting_method).toBe('FIFO')
    expect(engineResult.fund_results.find(f => f.fund_id === 'VBTLX')!.accounting_method).toBe('HIFO')
  })

  // 5. Multi-turn with inline lot-level detail (SpecID, Roth IRA — SpecID IS
  // allowed here; only Traditional IRA disallows it, see category 6)
  test('5. multi-turn with inline lot-level detail', async () => {
    const firstUtterance = 'I want to use SpecID to sell some VFIAX from my Roth IRA'
    const clarifyMock = fixedInterpreter({ type: 'clarify', question: 'Which lot(s) of VFIAX, and how many shares?' })
    const firstResult = await interpretWhatIfTurnWith(clarifyMock, turn(firstUtterance, [], rothIraRef))
    expect(firstResult).toEqual({ type: 'clarify', question: 'Which lot(s) of VFIAX, and how many shares?' })

    const history: WhatIfTurn[] = [
      { role: 'user', content: firstUtterance },
      { role: 'assistant', content: 'Which lot(s) of VFIAX, and how many shares?' },
    ]
    const secondUtterance = 'Sell all 40 shares of lot ROTH-VFIAX-07'
    const confirmMock = fixedInterpreter({
      type: 'confirm',
      candidate: {
        mode: 'manual',
        targetSaleAmount: 21932,
        manualSelections: { fund_selections: [{ fund_id: 'VFIAX', accounting_method: 'specific_lot_identification', lot_overrides: [{ lot_id: 'ROTH-VFIAX-07', shares: 40 }] }] },
      },
      summary: 'Sell all 40 shares of lot ROTH-VFIAX-07 (VFIAX).',
    })
    const input = turn(secondUtterance, history, rothIraRef)
    const secondResult = await interpretWhatIfTurnWith(confirmMock, input)

    // The orchestration must actually thread the full history to the interpreter.
    expect(confirmMock.interpret).toHaveBeenCalledWith(input)
    expect(secondResult.type).toBe('confirm')
    if (secondResult.type !== 'confirm') throw new Error('unreachable')

    const engineResult = confirmWhatIfCandidate(secondResult.candidate, rothIraRef, portfolio, ROTH_IRA, TAX_RATES) as ManualConfiguration
    const fr = engineResult.fund_results.find(f => f.fund_id === 'VFIAX')!
    expect(fr.lots_sold).toEqual([expect.objectContaining({ lot_id: 'ROTH-VFIAX-07', shares_to_sell: 40 })])
    expect(fr.est_tax_gross).toBe('not_applicable') // Roth IRA — per-fund gross tax not applicable, not $0 (IRA ordinary-income tax entry)
  })

  // 6. SpecID requested on Traditional IRA — must refuse, not attempt.
  // Mock simulates a model that ignored the prompt's refusal instruction,
  // to prove the CODE (whatIfValidation.ts / D052) is the real enforcement,
  // not just the prompt text.
  test('6. SpecID requested on Traditional IRA (refusal)', async () => {
    const badCandidate = {
      mode: 'manual' as const,
      targetSaleAmount: 10850,
      manualSelections: { fund_selections: [{ fund_id: 'VFITX', accounting_method: 'specific_lot_identification' as const, lot_overrides: [{ lot_id: 'IRA-VFITX-05', shares: 1000 }] }] },
    }
    const badMock = fixedInterpreter({
      type: 'confirm',
      candidate: badCandidate,
      summary: 'Sell all 1,000 shares of lot IRA-VFITX-05 (VFITX).',
    })
    const result = await interpretWhatIfTurnWith(badMock, turn('Use SpecID to sell lot IRA-VFITX-05 from my Traditional IRA, all shares', [], tradIraRef))
    expect(result.type).toBe('refuse')
    if (result.type !== 'refuse') throw new Error('unreachable')
    expect(result.reason).toMatch(/Traditional IRA/)

    // Confirming this exact candidate directly (bypassing interpretation entirely) must also refuse — the validator, not the orchestration wrapper, is what's actually stopping it.
    expect(() => confirmWhatIfCandidate(badCandidate, tradIraRef, portfolio, TRAD_IRA, TAX_RATES)).toThrow(WhatIfError)
  })

  // 7. Requested amount exceeding position size — must catch, not pass to
  // the engine. VBIRX's real taxable balance is $84,402.00.
  test('7. requested amount exceeding position size', async () => {
    const badMock = fixedInterpreter({
      type: 'confirm',
      candidate: { mode: 'manual', targetSaleAmount: 200000, manualSelections: { fund_selections: [{ fund_id: 'VBIRX', accounting_method: 'MinTax', sell_amount: 200000 }] } },
      summary: 'Sell $200,000.00 of VBIRX.',
    })
    const result = await interpretWhatIfTurnWith(badMock, turn('Sell $200,000 of VBIRX', []))
    expect(result.type).toBe('clarify')
    if (result.type !== 'clarify') throw new Error('unreachable')
    expect(result.question).toMatch(/84,402\.00/)
  })

  // 8. Ambiguous fund reference requiring disambiguation. Real grounding
  // check first: the taxable account genuinely holds two real funds with
  // "Bond" in their name (VBIRX "Short-Term Bond Index," VBTLX "Total Bond
  // Market Index") — different asset classes for allocation purposes
  // (short_term_reserves vs. domestic_bonds), but a user saying "my bond
  // fund" would plausibly mean either — a genuine ambiguity, not contrived.
  test('8. ambiguous fund reference requiring disambiguation', async () => {
    const bondFundIds = taxableRef.funds.filter(f => f.fund_name.includes('Bond')).map(f => f.fund_id)
    expect(bondFundIds.sort()).toEqual(['VBIRX', 'VBTLX'])

    const mock = fixedInterpreter({ type: 'clarify', question: 'Did you mean VBIRX (Short-Term Bond Index) or VBTLX (Total Bond Market Index)?' })
    const result = await interpretWhatIfTurnWith(mock, turn('Sell $10,000 of my bond fund', []))
    expect(result.type).toBe('clarify')
    if (result.type !== 'clarify') throw new Error('unreachable')
    expect(result.question).toMatch(/VBIRX/)
    expect(result.question).toMatch(/VBTLX/)
  })

  // 9. Out-of-scope general-advice request — must decline (CD-1.1, assistive not directive)
  test('9. out-of-scope general-advice request', async () => {
    const mock = fixedInterpreter({ type: 'refuse', reason: 'I can help you build a specific scenario, but I can\'t tell you whether to sell — that\'s a decision only you (or a financial advisor) can make.' })
    const result = await interpretWhatIfTurnWith(mock, turn('Should I sell my stocks right now?', []))
    expect(result.type).toBe('refuse')
  })
})

// ---------------------------------------------------------------------------
// Dimension-coverage gap closures (CLAUDE.md §12's what-if matrix, Tier 2 of
// the scrim/shares/multi-account investigation task). The 9 categories above
// were never checked against a formal dimension matrix — this block closes
// the specific cells that check turned up genuinely uncovered: a single
// named lot's dollar amount (the Tier 1 bug just fixed in whatIfPrompt.ts,
// which had no regression test until now), the average_cost method (listed
// in the schema and in VTSAX's own available_accounting_methods, never
// exercised anywhere in this file), two or more explicitly-named lots in one
// request, criteria-based multi-lot selection (D065 diagnosed this live
// against real Groq output but never committed it as repeatable coverage —
// both its success shape and the real schema-inconsistency D065 actually
// found), a plain non-SpecID Traditional IRA request exercised through the
// full interpret-to-engine path (previously only reachable via a direct
// validateCandidate() call, never through this describe block's category
// pattern), fund-level "sell all" resolved against the fund's real balance
// rather than an explicit dollar figure, and a buy request (the prompt
// states this tool "only ever SELLS," but no test asserted a buy gets
// refused).
// ---------------------------------------------------------------------------

describe('dimension-coverage gap closures (CLAUDE.md §12 matrix)', () => {
  // 10. Dollar amount for a single named lot — regression test for the Tier 1
  // fix (whatIfPrompt.ts's new exception to "never infer a share count").
  // Computed from real reference data, not hand-typed, matching this file's
  // fixture discipline — the interpreter's job is exactly this division.
  test('10. dollar amount for a single named lot — interpreter computes the share count itself', async () => {
    const lot = taxableRef.funds.find(f => f.fund_id === 'VTSAX')!.lots.find(l => l.lot_id === 'T-VTSAX-08')!
    const expectedShares = 10000 / lot.current_nav
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: {
        mode: 'manual', targetSaleAmount: 10000,
        manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'specific_lot_identification', lot_overrides: [{ lot_id: 'T-VTSAX-08', shares: expectedShares }] }] },
      },
      summary: 'Sell $10,000.00 of VTSAX from lot T-VTSAX-08.',
    })
    const result = await interpretWhatIfTurnWith(mock, turn('Sell $10,000 of lot T-VTSAX-08', []))
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')
    // No manual share-count round trip requested of the user — the candidate
    // already carries a computed share count, not a further clarify.
    expect(result.candidate.manualSelections?.fund_selections[0].lot_overrides).toEqual([
      { lot_id: 'T-VTSAX-08', shares: expectedShares },
    ])

    const engineResult = confirmWhatIfCandidate(result.candidate, taxableRef, portfolio, TAXABLE, TAX_RATES) as ManualConfiguration
    const fr = engineResult.fund_results.find(f => f.fund_id === 'VTSAX')!
    expect(fr.lots_sold).toEqual([expect.objectContaining({ lot_id: 'T-VTSAX-08' })])
    expect(fr.est_tax_gross).toBeGreaterThan(0) // real gain lot (cost basis $132.40 < NAV $145.20)
  })

  // 11. average_cost — listed in the candidate schema and in VTSAX's real
  // available_accounting_methods, never exercised anywhere else in this file.
  test('11. average_cost cost-basis method', async () => {
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: { mode: 'manual', targetSaleAmount: 5000, manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'average_cost', sell_amount: 5000 }] } },
      summary: 'Sell $5,000.00 of VTSAX using average cost.',
    })
    const result = await interpretWhatIfTurnWith(mock, turn('Sell $5,000 of VTSAX using average cost', []))
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')

    const engineResult = confirmWhatIfCandidate(result.candidate, taxableRef, portfolio, TAXABLE, TAX_RATES) as ManualConfiguration
    const fr = engineResult.fund_results.find(f => f.fund_id === 'VTSAX')!
    expect(fr.accounting_method).toBe('average_cost')
    expect(fr.sell_amount).toBe(5000)
  })

  // 12. Multiple explicitly-named lots in one request — cat. 5/6 each name
  // exactly one lot; this is the first test where the user names two.
  test('12. multiple explicitly-named lots in one request', async () => {
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: {
        mode: 'manual', targetSaleAmount: 29040,
        manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'specific_lot_identification', lot_overrides: [{ lot_id: 'T-VTSAX-08', shares: 150 }, { lot_id: 'T-VTSAX-09', shares: 50 }] }] },
      },
      summary: 'Sell all 150 shares of lot T-VTSAX-08 and 50 shares of lot T-VTSAX-09 (VTSAX).',
    })
    const result = await interpretWhatIfTurnWith(mock, turn('Sell all 150 shares of lot T-VTSAX-08 and 50 shares of lot T-VTSAX-09', []))
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')

    const engineResult = confirmWhatIfCandidate(result.candidate, taxableRef, portfolio, TAXABLE, TAX_RATES) as ManualConfiguration
    const fr = engineResult.fund_results.find(f => f.fund_id === 'VTSAX')!
    expect(fr.lots_sold).toEqual(expect.arrayContaining([
      expect.objectContaining({ lot_id: 'T-VTSAX-08', shares_to_sell: 150 }),
      expect.objectContaining({ lot_id: 'T-VTSAX-09', shares_to_sell: 50 }),
    ]))
    expect(fr.lots_sold).toHaveLength(2)
  })

  // 13. Criteria-based multi-lot selection, success shape — D065 diagnosed
  // this live against real Groq output for a $30,000 "smallest gains first"
  // request (full lot T-VTSAX-08 + ~56.61 shares of T-VTSAX-09) but never
  // committed it as repeatable coverage. This is that same real split, with
  // a schema-correct candidate (accounting_method actually set to
  // "specific_lot_identification", matching what the real model got wrong —
  // see test 14 for that failure mode).
  test('13. criteria-based multi-lot selection ("smallest gains first") — schema-correct split', async () => {
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: {
        mode: 'manual', targetSaleAmount: 29999.65,
        manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'specific_lot_identification', lot_overrides: [{ lot_id: 'T-VTSAX-08', shares: 150 }, { lot_id: 'T-VTSAX-09', shares: 56.61 }] }] },
      },
      summary: 'Sell $30,000.00 of VTSAX, prioritizing the lots with the smallest gains first.',
    })
    const result = await interpretWhatIfTurnWith(mock, turn('Sell $30,000 of VTSAX, prioritizing the lots with the smallest gains first', []))
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')

    const engineResult = confirmWhatIfCandidate(result.candidate, taxableRef, portfolio, TAXABLE, TAX_RATES) as ManualConfiguration
    const fr = engineResult.fund_results.find(f => f.fund_id === 'VTSAX')!
    expect(fr.lots_sold).toEqual(expect.arrayContaining([
      expect.objectContaining({ lot_id: 'T-VTSAX-08', shares_to_sell: 150 }),
      expect.objectContaining({ lot_id: 'T-VTSAX-09', shares_to_sell: 56.61 }),
    ]))
    expect(fr.est_tax_gross).toBeGreaterThan(0)
  })

  // 14. Criteria-based multi-lot selection, the real failure shape D065 found
  // against live Groq output: lot_overrides correctly split across two real
  // lots, but accounting_method left as "MinTax" (not switched to
  // "specific_lot_identification") and no sell_amount supplied. The code-level
  // validator — not the prompt — is what catches this, exactly as D052/D053
  // designed it to.
  test('14. criteria-based multi-lot selection — schema-inconsistent candidate is downgraded to clarify, not executed', async () => {
    const badMock = fixedInterpreter({
      type: 'confirm',
      candidate: {
        mode: 'manual', targetSaleAmount: 30000,
        manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', lot_overrides: [{ lot_id: 'T-VTSAX-08', shares: 150 }, { lot_id: 'T-VTSAX-09', shares: 56.61 }] }] },
      },
      summary: 'Sell $30,000.00 of VTSAX, prioritizing the lots with the smallest gains first.',
    })
    const result = await interpretWhatIfTurnWith(badMock, turn('Sell $30,000 of VTSAX, prioritizing the lots with the smallest gains first', []))
    expect(result.type).toBe('clarify')
    if (result.type !== 'clarify') throw new Error('unreachable')
    expect(result.question).toMatch(/VTSAX/)
    expect(result.question).toMatch(/never specified/)
  })

  // 15. Plain in-scope Traditional IRA request, non-SpecID method — exercised
  // through the full interpret-to-engine path for the first time in this
  // describe block (previously only reachable via a direct validateCandidate()
  // call in the "whatIfValidation" describe block below).
  test('15. plain in-scope Traditional IRA request (non-SpecID), full interpret-to-engine path', async () => {
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: { mode: 'manual', targetSaleAmount: 10000, manualSelections: { fund_selections: [{ fund_id: 'VFITX', accounting_method: 'FIFO', sell_amount: 10000 }] } },
      summary: 'Sell $10,000.00 of VFITX using FIFO.',
    })
    const result = await interpretWhatIfTurnWith(mock, turn('Sell $10,000 of VFITX using FIFO', [], tradIraRef))
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')

    const engineResult = confirmWhatIfCandidate(result.candidate, tradIraRef, portfolio, TRAD_IRA, TAX_RATES) as ManualConfiguration
    const fr = engineResult.fund_results.find(f => f.fund_id === 'VFITX')!
    expect(fr.accounting_method).toBe('FIFO')
    expect(fr.sell_amount).toBe(10000)
    // Per-fund gross tax stays 'not_applicable' for a Traditional IRA
    // holding — same as Roth, but for a different reason: this fund's own
    // ordinary-income tax is a portfolio-level figure (computed against the
    // total withdrawal, not per fund — see the IRA ordinary-income tax
    // entry in DECISIONS.md), not a "genuinely tax-free" $0 the way Roth's
    // per-fund figure is. Never a numeric 0 for either IRA type at the
    // per-fund level.
    expect(fr.est_tax_gross).toBe('not_applicable')
  })

  // 16. Fund-level "sell all" — resolved against the fund's real current
  // balance, not an explicit dollar figure the user stated (distinct from
  // "sell $200,000" in category 7, where the over-large number IS explicit).
  test('16. fund-level "sell all" resolves against the real current balance', async () => {
    const fullBalance = taxableRef.funds.find(f => f.fund_id === 'VTSAX')!.current_balance
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: { mode: 'manual', targetSaleAmount: fullBalance, manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: fullBalance }] } },
      summary: `Sell all of VTSAX (${fullBalance.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}).`,
    })
    const result = await interpretWhatIfTurnWith(mock, turn('Sell all of my VTSAX', []))
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')
    expect(result.candidate.manualSelections?.fund_selections[0].sell_amount).toBe(fullBalance)

    const engineResult = confirmWhatIfCandidate(result.candidate, taxableRef, portfolio, TAXABLE, TAX_RATES) as ManualConfiguration
    const fr = engineResult.fund_results.find(f => f.fund_id === 'VTSAX')!
    expect(fr.sell_amount).toBe(fullBalance)
  })

  // 17. Out-of-scope buy request — the prompt states this tool "only ever
  // SELLS existing holdings" and never buys, but nothing asserted a buy
  // request actually gets refused rather than silently reinterpreted as a
  // sell.
  test('17. out-of-scope buy request — must decline, not reinterpret as a sell', async () => {
    const mock = fixedInterpreter({ type: 'refuse', reason: 'This tool can only help you sell existing holdings — it doesn\'t place buy orders.' })
    const result = await interpretWhatIfTurnWith(mock, turn('Buy $5,000 more of VTSAX', []))
    expect(result.type).toBe('refuse')
  })
})

// ---------------------------------------------------------------------------
// Modifying an existing scenario (DECISIONS.md D064) — the gap the original
// 9 categories never covered: D007 framed the assistant as an edit tool
// equivalent to a round trip through Fund Selection, which covers
// modification in principle, but nothing tested "modify Scenario N" as
// distinct from "create new." Two real, distinct request shapes:
//   (a) an explicit modify target (opened via a scenario's own "Modify with
//       assistant" trigger) — the interpreter is told which scenario is the
//       target via is_modify_target, and a confirmed result should replace
//       it, not add a new one (WhatIfPanel.tsx branches on this — the actual
//       addScenario-vs-updateScenario choice is a React-component-level
//       concern this file doesn't render, covered instead by
//       dev/tests/whatif-panel.spec.ts and live verification).
//   (b) an implicit reference ("like Scenario 1 but...") with no modify
//       target set — this should read Scenario 1's real data from
//       existing_scenarios and construct a NEW, modified candidate.
// Both need the same real data plumbing this describe block verifies:
// buildPortfolioReferenceContext actually carries existing_scenarios, and
// buildWhatIfPrompt actually puts that data (and the modify-target
// instruction) in front of the model.
// ---------------------------------------------------------------------------

describe('scenario modification — existing_scenarios grounding data (DECISIONS.md D064)', () => {
  // A real, engine-computed scenario to reference — same discipline as every
  // other fixture in this file (D044's rule, applied here per this file's
  // own header note): built via the real engine + the real scenario builder,
  // never hand-typed.
  function realScenario(fundId: string, amount: number) {
    const config = runOptimization({
      portfolio, targetSaleAmount: amount, activeAccountId: TAXABLE, mode: 'manual',
      optimizationPriority: 'tax-first', activeTaxRates: TAX_RATES,
      manualSelections: { fund_selections: [{ fund_id: fundId, accounting_method: 'MinTax', sell_amount: amount }] },
    }) as ManualConfiguration
    return buildScenarioFromFundResults(config.fund_results, portfolio, TAX_RATES, config.allocation_impact, TAXABLE)!
  }

  test('existing_scenarios is empty when no scenarios are passed (backward compatible with every other category above)', () => {
    expect(taxableRef.existing_scenarios).toEqual([])
  })

  test('a real scenario appears in existing_scenarios, correctly labeled and with its real fund_selections — no modify target by default', () => {
    const scenario = realScenario('VTSAX', 15000)
    const ref = buildPortfolioReferenceContext(portfolio, TAXABLE, [scenario])
    expect(ref.existing_scenarios).toHaveLength(1)
    expect(ref.existing_scenarios[0].label).toBe('Scenario 1')
    expect(ref.existing_scenarios[0].is_modify_target).toBe(false)
    expect(ref.existing_scenarios[0].fund_selections).toEqual([
      { fund_id: 'VTSAX', sell_amount: 15000, accounting_method: 'MinTax' },
    ])
  })

  test('is_modify_target is true only for the scenario id explicitly passed as the modify target', () => {
    // buildScenarioFromFundResults() ids scenarios by Date.now() alone, which
    // can collide across two calls in the same millisecond (a real, minor,
    // pre-existing latent bug in that function — not something this test is
    // for) — assign explicit distinct ids so this test isn't flaky because
    // of it.
    const scenarioA = { ...realScenario('VTSAX', 15000), scenario_id: 'sc-test-a' }
    const scenarioB = { ...realScenario('VBTLX', 8000), scenario_id: 'sc-test-b' }
    const ref = buildPortfolioReferenceContext(portfolio, TAXABLE, [scenarioA, scenarioB], scenarioB.scenario_id)
    expect(ref.existing_scenarios[0].is_modify_target).toBe(false) // Scenario 1 (A)
    expect(ref.existing_scenarios[1].is_modify_target).toBe(true)  // Scenario 2 (B) — the real target
  })

  test('buildWhatIfPrompt includes the existing_scenarios data and the modify-target instruction when one is set', async () => {
    const scenario = realScenario('VTSAX', 15000)
    const refWithTarget = buildPortfolioReferenceContext(portfolio, TAXABLE, [scenario], scenario.scenario_id)
    const { system } = buildWhatIfPrompt({ utterance: 'sell more instead', history: [], reference: refWithTarget, segment: 'A' })
    expect(system).toMatch(/Scenario 1/)
    expect(system).toMatch(/is_modify_target/)
    expect(system).toMatch(/opened this conversation specifically to MODIFY/)
  })

  test('buildWhatIfPrompt omits the modify-target instruction when nothing is being modified (the general header-level Scenario assistant entry point)', async () => {
    const scenario = realScenario('VTSAX', 15000)
    const refNoTarget = buildPortfolioReferenceContext(portfolio, TAXABLE, [scenario])
    const { system } = buildWhatIfPrompt({ utterance: 'sell some VBTLX', history: [], reference: refNoTarget, segment: 'A' })
    expect(system).not.toMatch(/opened this conversation specifically to MODIFY/)
  })

  test('(a) explicit modify target: a stated change to the target scenario produces a correct candidate, runs correctly through the real engine', async () => {
    const original = realScenario('VTSAX', 15000)
    const ref = buildPortfolioReferenceContext(portfolio, TAXABLE, [original], original.scenario_id)
    // Stands in for "what a correctly-behaving model would return" for
    // "change this to sell $20,000 instead" — same role every other
    // category's fixedInterpreter plays (this suite makes no live call).
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: { mode: 'manual', targetSaleAmount: 20000, manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 20000 }] } },
      summary: 'Sell $20,000.00 of VTSAX using MinTax, updating this scenario.',
    })
    const result = await interpretWhatIfTurnWith(mock, { utterance: 'change this to sell $20,000 instead', history: [], reference: ref, segment: 'A' })
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')
    expect(result.candidate.manualSelections?.fund_selections[0].sell_amount).toBe(20000)

    const engineResult = confirmWhatIfCandidate(result.candidate, ref, portfolio, TAXABLE, TAX_RATES) as ManualConfiguration
    const fr = engineResult.fund_results.find(f => f.fund_id === 'VTSAX')!
    expect(fr.sell_amount).toBe(20000)
    expect(fr.est_tax_gross).toBeGreaterThan(0)
  })

  test('(b) implicit reference, no modify target: "like Scenario 1 but sell more VBTLX" produces a NEW, modified candidate — the referenced scenario stays untouched as reference data', async () => {
    const original = realScenario('VTSAX', 15000)
    const ref = buildPortfolioReferenceContext(portfolio, TAXABLE, [original]) // no modify target — this is a NEW-scenario request
    expect(ref.existing_scenarios[0].is_modify_target).toBe(false)
    // "Like Scenario 1 but sell more VBTLX" — a correctly-behaving model
    // reads Scenario 1's real VTSAX $15,000 from existing_scenarios and adds
    // a genuinely new VBTLX line the user actually asked for.
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: {
        mode: 'manual', targetSaleAmount: 23000,
        manualSelections: { fund_selections: [
          { fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 15000 },
          { fund_id: 'VBTLX', accounting_method: 'MinTax', sell_amount: 8000 },
        ] },
      },
      summary: 'Sell $15,000.00 of VTSAX and $8,000.00 of VBTLX using MinTax, as a new scenario based on Scenario 1.',
    })
    const result = await interpretWhatIfTurnWith(mock, { utterance: 'like Scenario 1 but also sell $8,000 of VBTLX', history: [], reference: ref, segment: 'A' })
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')
    expect(result.candidate.manualSelections?.fund_selections).toHaveLength(2)

    const engineResult = confirmWhatIfCandidate(result.candidate, ref, portfolio, TAXABLE, TAX_RATES) as ManualConfiguration
    expect(engineResult.fund_results.find(f => f.fund_id === 'VTSAX')?.sell_amount).toBe(15000)
    expect(engineResult.fund_results.find(f => f.fund_id === 'VBTLX')?.sell_amount).toBe(8000)
    // The referenced scenario itself is untouched — this test double never
    // returns anything that would mutate it, and confirmWhatIfCandidate has
    // no path to a store write at all (that's WhatIfPanel's job downstream).
    expect(original.fund_selections).toEqual([
      expect.objectContaining({ fund_id: 'VTSAX', sell_amount: 15000 }),
    ])
  })
})

// ---------------------------------------------------------------------------
// Cross-account scenario reference (D067, item 4) — the residual gap D067
// itself flagged: a "like Scenario N" reference to a scenario built against a
// DIFFERENT account than the one currently active, now confirmed live-
// reachable through the real UI by D067's Tier 3 investigation (a Taxable
// scenario and a Traditional IRA scenario genuinely coexisting in the same
// comparison). WhatIfScenarioReference now carries the referenced scenario's
// own real account_type (whatIfShared.ts), and whatIfPrompt.ts instructs the
// interpreter to ground any fund/lot it actually uses in the CURRENT
// account's real holdings, never the referenced scenario's — a referenced
// fund not held in the target account must be clarified, not guessed.
// ---------------------------------------------------------------------------

describe('cross-account scenario reference (DECISIONS.md D067)', () => {
  function taxableScenario(fundId: string, amount: number) {
    const config = runOptimization({
      portfolio, targetSaleAmount: amount, activeAccountId: TAXABLE, mode: 'manual',
      optimizationPriority: 'tax-first', activeTaxRates: TAX_RATES,
      manualSelections: { fund_selections: [{ fund_id: fundId, accounting_method: 'MinTax', sell_amount: amount }] },
    }) as ManualConfiguration
    return buildScenarioFromFundResults(config.fund_results, portfolio, TAX_RATES, config.allocation_impact, TAXABLE)!
  }

  test('WhatIfScenarioReference carries the referenced scenario\'s own real account_type', () => {
    const scenario = taxableScenario('VTSAX', 20000)
    const ref = buildPortfolioReferenceContext(portfolio, ROTH_IRA, [scenario])
    expect(ref.existing_scenarios[0].account_type).toBe('taxable_brokerage')
  })

  test('buildWhatIfPrompt states each referenced scenario\'s account_type may differ, with cross-account grounding instructions', () => {
    const scenario = taxableScenario('VTSAX', 20000)
    const ref = buildPortfolioReferenceContext(portfolio, ROTH_IRA, [scenario])
    const { system } = buildWhatIfPrompt({ utterance: 'like Scenario 1 but in my Roth IRA', history: [], reference: ref, segment: 'A' })
    expect(system).toMatch(/account_type.*may differ/)
    expect(system).toMatch(/ground every fund_id and lot_id you actually use in THIS account/)
  })

  test('legitimate cross-account reference: "like Scenario 1\'s amount, but from my Roth IRA\'s VFIAX" — grounded in the target account\'s own real holding, runs correctly through the real engine', async () => {
    const scenario = taxableScenario('VTSAX', 20000) // Scenario 1: Taxable, VTSAX, $20,000
    const ref = buildPortfolioReferenceContext(portfolio, ROTH_IRA, [scenario])
    expect(ref.account_type).toBe('roth_IRA')
    // Only the transferable detail (the $20,000 amount) carries over — the
    // fund is VFIAX, Roth's own real (and only) holding, never VTSAX.
    const mock = fixedInterpreter({
      type: 'confirm',
      candidate: { mode: 'manual', targetSaleAmount: 20000, manualSelections: { fund_selections: [{ fund_id: 'VFIAX', accounting_method: 'MinTax', sell_amount: 20000 }] } },
      summary: 'Sell $20,000.00 of VFIAX (Roth IRA) using MinTax, matching Scenario 1\'s amount.',
    })
    const result = await interpretWhatIfTurnWith(mock, { utterance: 'like Scenario 1\'s amount, but from my Roth IRA\'s VFIAX', history: [], reference: ref, segment: 'A' })
    expect(result.type).toBe('confirm')
    if (result.type !== 'confirm') throw new Error('unreachable')

    const engineResult = confirmWhatIfCandidate(result.candidate, ref, portfolio, ROTH_IRA, TAX_RATES) as ManualConfiguration
    const fr = engineResult.fund_results.find(f => f.fund_id === 'VFIAX')!
    expect(fr.sell_amount).toBe(20000)
    expect(fr.est_tax_gross).toBe('not_applicable') // Roth IRA — per-fund gross tax not applicable, not $0
  })

  test('adversarial: a badly-behaved model reusing the referenced scenario\'s own fund (VTSAX, Taxable-only) is refused, not passed to the engine — the validator catches it even though it never saw the referenced scenario\'s account', async () => {
    const scenario = taxableScenario('VTSAX', 20000)
    const ref = buildPortfolioReferenceContext(portfolio, ROTH_IRA, [scenario])
    const badMock = fixedInterpreter({
      type: 'confirm',
      candidate: { mode: 'manual', targetSaleAmount: 20000, manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 20000 }] } },
      summary: 'Sell $20,000.00 of VTSAX, matching Scenario 1.',
    })
    const result = await interpretWhatIfTurnWith(badMock, { utterance: 'like Scenario 1 but in my Roth IRA', history: [], reference: ref, segment: 'A' })
    expect(result.type).toBe('refuse')
    if (result.type !== 'refuse') throw new Error('unreachable')
    expect(result.reason).toMatch(/VTSAX/)
  })
})

describe('whatIfValidation — the D052-flagged gap this feature closes', () => {
  test('rejects a fund that does not exist in the account (hallucination guard)', () => {
    const check = validateCandidate(
      { mode: 'manual', targetSaleAmount: 1000, manualSelections: { fund_selections: [{ fund_id: 'NOTAREAL', accounting_method: 'MinTax', sell_amount: 1000 }] } },
      taxableRef
    )
    expect(check).toEqual({ valid: false, kind: 'refuse', reason: expect.stringContaining('NOTAREAL') })
  })

  test('rejects SpecID on a Traditional IRA — CLAUDE.md §5, binding', () => {
    const check = validateCandidate(
      { mode: 'manual', targetSaleAmount: 10850, manualSelections: { fund_selections: [{ fund_id: 'VFITX', accounting_method: 'specific_lot_identification', lot_overrides: [{ lot_id: 'IRA-VFITX-05', shares: 1000 }] }] } },
      tradIraRef
    )
    expect(check).toEqual({ valid: false, kind: 'refuse', reason: expect.stringContaining('Traditional IRA') })
  })

  test('allows SpecID on a Roth IRA — the rule is Traditional-IRA-specific, not IRA-wide', () => {
    const check = validateCandidate(
      { mode: 'manual', targetSaleAmount: 21932, manualSelections: { fund_selections: [{ fund_id: 'VFIAX', accounting_method: 'specific_lot_identification', lot_overrides: [{ lot_id: 'ROTH-VFIAX-07', shares: 40 }] }] } },
      rothIraRef
    )
    expect(check).toEqual({ valid: true })
  })

  test('rejects a sell amount exceeding the real fund balance', () => {
    const check = validateCandidate(
      { mode: 'manual', targetSaleAmount: 200000, manualSelections: { fund_selections: [{ fund_id: 'VBIRX', accounting_method: 'MinTax', sell_amount: 200000 }] } },
      taxableRef
    )
    expect(check).toEqual({ valid: false, kind: 'clarify', reason: expect.stringContaining('84,402.00') })
  })

  test('rejects a lot_override share count exceeding the real lot', () => {
    const check = validateCandidate(
      { mode: 'manual', targetSaleAmount: 10850, manualSelections: { fund_selections: [{ fund_id: 'VFITX', accounting_method: 'specific_lot_identification', lot_overrides: [{ lot_id: 'IRA-VFITX-05', shares: 5000 }] }] } },
      { ...tradIraRef, account_type: 'roth_IRA' } // swap account type so this test isolates the share-count check from the SpecID/Traditional-IRA rule
    )
    expect(check).toEqual({ valid: false, kind: 'clarify', reason: expect.stringContaining('IRA-VFITX-05') })
  })

  // Adversarial boundary tests — a validator only exercised with obviously-
  // valid or obviously-invalid input hasn't actually been tested against the
  // failure mode it exists to catch. VBIRX's real taxable balance is exactly
  // $84,402.00 (dev/src/data/sample-dataset.json).
  describe('boundary cases — almost valid, not quite', () => {
    test('accepts an amount exactly equal to the real balance (not "less than", the boundary itself)', () => {
      const check = validateCandidate(
        { mode: 'manual', targetSaleAmount: 84402.00, manualSelections: { fund_selections: [{ fund_id: 'VBIRX', accounting_method: 'MinTax', sell_amount: 84402.00 }] } },
        taxableRef
      )
      expect(check).toEqual({ valid: true })
    })

    test('rejects an amount exactly one cent over the real balance', () => {
      // This is the case that originally slipped through: the epsilon
      // tolerance (added for float-precision noise) was wide enough to
      // also swallow a genuine one-cent overage. Found via this exact test.
      const check = validateCandidate(
        { mode: 'manual', targetSaleAmount: 84402.01, manualSelections: { fund_selections: [{ fund_id: 'VBIRX', accounting_method: 'MinTax', sell_amount: 84402.01 }] } },
        taxableRef
      )
      expect(check).toEqual({ valid: false, kind: 'clarify', reason: expect.stringContaining('84,402.00') })
    })

    test('still tolerates genuine sub-cent floating-point noise at the boundary', () => {
      const check = validateCandidate(
        { mode: 'manual', targetSaleAmount: 84402.0, manualSelections: { fund_selections: [{ fund_id: 'VBIRX', accounting_method: 'MinTax', sell_amount: 84402.0 + 1e-10 }] } },
        taxableRef
      )
      expect(check).toEqual({ valid: true })
    })

    test('accepts a lot_override share count exactly equal to the real lot (IRA-VFITX-05 has exactly 1000 shares)', () => {
      const check = validateCandidate(
        { mode: 'manual', targetSaleAmount: 10850, manualSelections: { fund_selections: [{ fund_id: 'VFITX', accounting_method: 'specific_lot_identification', lot_overrides: [{ lot_id: 'IRA-VFITX-05', shares: 1000 }] }] } },
        { ...tradIraRef, account_type: 'roth_IRA' }
      )
      expect(check).toEqual({ valid: true })
    })

    test('rejects a lot_override share count exactly one hundredth of a share over the real lot', () => {
      const check = validateCandidate(
        { mode: 'manual', targetSaleAmount: 10850, manualSelections: { fund_selections: [{ fund_id: 'VFITX', accounting_method: 'specific_lot_identification', lot_overrides: [{ lot_id: 'IRA-VFITX-05', shares: 1000.01 }] }] } },
        { ...tradIraRef, account_type: 'roth_IRA' }
      )
      expect(check.valid).toBe(false)
    })

    test('allows a NON-SpecID method (MinTax) on a Traditional IRA — the SpecID rule is method-specific, not account-wide', () => {
      const check = validateCandidate(
        { mode: 'manual', targetSaleAmount: 10850, manualSelections: { fund_selections: [{ fund_id: 'VFITX', accounting_method: 'MinTax', sell_amount: 10850 }] } },
        tradIraRef
      )
      expect(check).toEqual({ valid: true })
    })

    test('allows SpecID on a plain taxable brokerage account — the restriction names Traditional IRA specifically, not "any non-Roth account"', () => {
      const check = validateCandidate(
        { mode: 'manual', targetSaleAmount: 5000, manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'specific_lot_identification', lot_overrides: [{ lot_id: 'T-VTSAX-08', shares: 40 }] }] } },
        taxableRef
      )
      expect(check).toEqual({ valid: true })
    })
  })

  test('rejects a manual candidate with no fund selections', () => {
    const check = validateCandidate({ mode: 'manual', targetSaleAmount: 1000 }, taxableRef)
    expect(check.valid).toBe(false)
  })

  test('rejects an automated candidate with no optimization priority', () => {
    const check = validateCandidate({ mode: 'automated', targetSaleAmount: 1000 }, taxableRef)
    expect(check.valid).toBe(false)
  })

  test('accepts a genuinely valid manual candidate', () => {
    const check = validateCandidate(
      { mode: 'manual', targetSaleAmount: 5000, manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] } },
      taxableRef
    )
    expect(check).toEqual({ valid: true })
  })

  // DECISIONS.md's amount-rejection bug entry: a real, live-reproduced model
  // inconsistency — for a fund-specific ("manual") request, the model
  // sometimes omits the top-level targetSaleAmount field from the candidate
  // even though every fund selection's own sell_amount is correctly present
  // (reproduced in roughly half of real single-turn calls, and in a real
  // multi-turn "amount answered on turn 2" sequence). targetSaleAmount is
  // structurally redundant for manual mode once every selection already
  // states its own amount — this was previously rejected unconditionally
  // with a misleading "total sale amount" message about a field the request
  // never needed to state twice.
  describe('manual mode does not require targetSaleAmount — it is redundant once every fund selection states its own amount', () => {
    test('accepts a manual candidate with targetSaleAmount entirely absent (undefined), matching the exact real model output reproduced live', () => {
      const candidateWithoutTarget = {
        mode: 'manual' as const,
        manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax' as const, sell_amount: 5000 }] },
      }
      const check = validateCandidate(candidateWithoutTarget as WhatIfCandidate, taxableRef)
      expect(check).toEqual({ valid: true })
    })

    test('accepts a manual candidate with targetSaleAmount present but 0 / NaN — still irrelevant once fund selections are valid', () => {
      const check = validateCandidate(
        { mode: 'manual', targetSaleAmount: NaN, manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] } },
        taxableRef
      )
      expect(check).toEqual({ valid: true })
    })

    test('automated mode still requires targetSaleAmount — the fix is manual-mode-specific, not a blanket removal of the check', () => {
      const check = validateCandidate({ mode: 'automated', targetSaleAmount: NaN, optimizationPriority: 'tax-first' }, taxableRef)
      expect(check).toEqual({ valid: false, kind: 'clarify', reason: expect.stringContaining('total sale amount') })
    })

    test('a manual candidate missing targetSaleAmount still correctly fails its OTHER validation checks (this is not a blanket bypass)', () => {
      const check = validateCandidate(
        { manualSelections: { fund_selections: [{ fund_id: 'NOTAREAL', accounting_method: 'MinTax', sell_amount: 1000 }] } } as unknown as WhatIfCandidate,
        taxableRef
      )
      expect(check).toEqual({ valid: false, kind: 'refuse', reason: expect.stringContaining('NOTAREAL') })
    })

    test('end-to-end: the exact real model output reproduced live (missing targetSaleAmount) reaches "confirm," not a false clarify, and the real engine produces the correct $5,000 sale', () => {
      const liveReproducedCandidate = {
        mode: 'manual' as const,
        manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax' as const, sell_amount: 5000 }] },
      } as WhatIfCandidate
      const mock = fixedInterpreter({
        type: 'confirm',
        candidate: liveReproducedCandidate,
        summary: 'Sell $5,000 of VTSAX using MinTax accounting method.',
      })
      return interpretWhatIfTurnWith(mock, turn('Sell $5,000 of VTSAX', [])).then(result => {
        expect(result.type).toBe('confirm')
        const engineResult = confirmWhatIfCandidate(liveReproducedCandidate, taxableRef, portfolio, TAXABLE, TAX_RATES)
        expect(engineResult.fund_results.length).toBeGreaterThan(0)
        expect(engineResult.fund_results.reduce((s, f) => s + f.sell_amount, 0)).toBeCloseTo(5000, 2)
      })
    })
  })
})

// ---------------------------------------------------------------------------
// validateSummary (D075) — the CD-4.2 gap the original audit (D069) found:
// every other hard rule in this feature has a validator backing its prompt
// instruction ("never a numeric tax/gain estimate in the confirm summary,"
// whatIfPrompt.ts); this one didn't, until now.
// ---------------------------------------------------------------------------

describe('validateSummary — D075: the CD-4.2 gap D069 flagged, closed', () => {
  const singleFundCandidate: WhatIfCandidate = {
    mode: 'manual', targetSaleAmount: 5000,
    manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] },
  }
  const twoFundCandidate: WhatIfCandidate = {
    mode: 'manual', targetSaleAmount: 8000,
    manualSelections: { fund_selections: [
      { fund_id: 'VTSAX', accounting_method: 'FIFO', sell_amount: 5000 },
      { fund_id: 'VBTLX', accounting_method: 'HIFO', sell_amount: 3000 },
    ] },
  }

  test('accepts a genuine, figures-free plain-language summary', () => {
    expect(validateSummary('Sell $5,000.00 of VTSAX using MinTax.', singleFundCandidate)).toEqual({ valid: true })
  })

  test('accepts a summary naming a method and multiple funds, still no unrecognized figure', () => {
    expect(validateSummary('Sell $5,000.00 of VTSAX using FIFO and $3,000.00 of VBTLX using HIFO.', twoFundCandidate)).toEqual({ valid: true })
  })

  // The actual objective-shaped category (3) legitimately says "tax" as the
  // user's stated optimization goal, not as a computed estimate — this is
  // the real false positive a naive word-ban produced (found by this file's
  // own first test run against category 3, not live). $20,000.00 here is
  // the real candidate.targetSaleAmount, not an invented figure.
  test('accepts a genuine objective-shaped summary that legitimately names "tax" as the stated goal, not a computed estimate', () => {
    const objectiveCandidate: WhatIfCandidate = { mode: 'automated', targetSaleAmount: 20000, optimizationPriority: 'tax-first' }
    expect(validateSummary('Raise $20,000.00 optimizing for the lowest tax impact.', objectiveCandidate)).toEqual({ valid: true })
  })

  test.each(['tax', 'gain', 'loss', 'harvest', 'saving'])('rejects a summary pairing "%s" with a dollar figure the candidate never stated', term => {
    const check = validateSummary(`Sell $5,000.00 of VTSAX, realizing an estimated ${term} of $105.78.`, singleFundCandidate)
    expect(check.valid).toBe(false)
    if (check.valid) throw new Error('unreachable')
    expect(check.kind).toBe('refuse')
  })

  test('the refusal reason is generic and non-technical — never echoes which forbidden term matched', () => {
    const check = validateSummary('Sell $5,000.00 of VTSAX, realizing an estimated tax of $105.78.', singleFundCandidate)
    expect(check.valid).toBe(false)
    if (check.valid) throw new Error('unreachable')
    expect(check.reason).not.toMatch(/tax/i)
  })

  test('adversarial: interpretWhatIfTurnWith downgrades a confirm whose summary leaks a tax figure to refuse — the validator catches it, not just the prompt', async () => {
    const badMock = fixedInterpreter({
      type: 'confirm',
      candidate: { mode: 'manual', targetSaleAmount: 5000, manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] } },
      summary: 'Sell $5,000.00 of VTSAX using MinTax, realizing an estimated tax of $105.78.',
    })
    const result = await interpretWhatIfTurnWith(badMock, turn('Sell $5,000 of VTSAX', []))
    expect(result.type).toBe('refuse')
  })
})

describe('buildOptimizationParamsFromCandidate — pure reshaping, no calculation', () => {
  test('manual candidate maps straight through', () => {
    const params = buildOptimizationParamsFromCandidate(
      { mode: 'manual', targetSaleAmount: 5000, manualSelections: { fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }] } },
      portfolio, TAXABLE, TAX_RATES
    )
    expect(params.mode).toBe('manual')
    expect(params.manualSelections?.fund_selections).toEqual([{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }])
    expect(params.activeAccountId).toBe(TAXABLE)
  })

  test('automated candidate maps straight through, no manualSelections', () => {
    const params = buildOptimizationParamsFromCandidate(
      { mode: 'automated', targetSaleAmount: 20000, optimizationPriority: 'balance-first' },
      portfolio, TAXABLE, TAX_RATES
    )
    expect(params.mode).toBe('automated')
    expect(params.optimizationPriority).toBe('balance-first')
    expect(params.manualSelections).toBeUndefined()
  })
})

describe('parseInterpreterResponse — structural parsing only', () => {
  test('parses a clarify response', () => {
    expect(parseInterpreterResponse('{"type":"clarify","question":"How much?"}')).toEqual({ type: 'clarify', question: 'How much?' })
  })

  test('parses a refuse response', () => {
    expect(parseInterpreterResponse('{"type":"refuse","reason":"out of scope"}')).toEqual({ type: 'refuse', reason: 'out of scope' })
  })

  test('parses a confirm response, including a markdown code fence around it', () => {
    const raw = '```json\n{"type":"confirm","candidate":{"mode":"manual","targetSaleAmount":5000},"summary":"Sell $5,000."}\n```'
    expect(parseInterpreterResponse(raw)).toEqual({
      type: 'confirm', candidate: { mode: 'manual', targetSaleAmount: 5000 }, summary: 'Sell $5,000.',
    })
  })

  test('throws on malformed JSON', () => {
    expect(() => parseInterpreterResponse('not json')).toThrow(WhatIfParseError)
  })

  test('throws on an unknown response type', () => {
    expect(() => parseInterpreterResponse('{"type":"maybe"}')).toThrow(WhatIfParseError)
  })

  test('throws on a confirm response missing its candidate', () => {
    expect(() => parseInterpreterResponse('{"type":"confirm","summary":"x"}')).toThrow(WhatIfParseError)
  })

  // DECISIONS.md's amount-rejection bug entry: a real, live-reproduced model
  // inconsistency, specific to multi-turn conversations — "manualSelections"
  // sometimes comes back as a bare array of fund selections instead of the
  // documented {"fund_selections":[...]} wrapper. Reproduced live in ~4 of 5
  // real multi-turn Gemini calls, never once in 8 real single-turn calls.
  // Still unambiguously structural (the array's contents are exactly what
  // fund_selections should hold), so the parser normalizes it rather than
  // letting it reach the validator looking like an empty selection list.
  test('normalizes a bare-array "manualSelections" into the documented {fund_selections:[...]} wrapper', () => {
    const raw = '{"type":"confirm","candidate":{"mode":"manual","manualSelections":[{"fund_id":"VTSAX","accounting_method":"MinTax","sell_amount":5000}]},"summary":"Sell $5,000 of VTSAX."}'
    const result = parseInterpreterResponse(raw)
    if (result.type !== 'confirm') throw new Error('unreachable')
    expect(result.candidate.manualSelections).toEqual({
      fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }],
    })
  })

  test('leaves an already-correctly-wrapped "manualSelections" untouched', () => {
    const raw = '{"type":"confirm","candidate":{"mode":"manual","manualSelections":{"fund_selections":[{"fund_id":"VTSAX","accounting_method":"MinTax","sell_amount":5000}]}},"summary":"Sell $5,000 of VTSAX."}'
    const result = parseInterpreterResponse(raw)
    if (result.type !== 'confirm') throw new Error('unreachable')
    expect(result.candidate.manualSelections).toEqual({
      fund_selections: [{ fund_id: 'VTSAX', accounting_method: 'MinTax', sell_amount: 5000 }],
    })
  })
})

describe('buildWhatIfPrompt — the core boundary is actually present in the prompt', () => {
  test('states the never-infer-a-value rule and includes real grounding data', () => {
    const { system } = buildWhatIfPrompt({ utterance: 'Sell $5,000 of VTSAX', history: [], reference: taxableRef, segment: 'A' })
    expect(system).toMatch(/never state, invent, or infer/i)
    expect(system).toMatch(/VTSAX/) // real fund_id from the reference data is actually embedded
    expect(system).toMatch(/Traditional IRA/) // the SpecID refusal rule is present
  })

  test('includes prior turns in the user message so the model can use conversation history', () => {
    const history: WhatIfTurn[] = [{ role: 'user', content: 'sell some VFIAX' }, { role: 'assistant', content: 'how much?' }]
    const { user } = buildWhatIfPrompt({ utterance: '$5,000', history, reference: rothIraRef, segment: 'A' })
    expect(user).toMatch(/sell some VFIAX/)
    expect(user).toMatch(/how much\?/)
  })

  // D071 — Feature 2's first segment-aware content. Same figures-vs-tone
  // split narration's own category 10 already established: the utterance/
  // history (what the model reasons about) is identical across segments;
  // only the tone guidance in the system prompt should differ.
  test('D071: segment changes only the tone guidance, never the grounding data — all four segments produce distinct system prompts', () => {
    const base = { utterance: 'Sell $5,000 of VTSAX', history: [], reference: taxableRef }
    const prompts = (['A', 'B', 'C', 'D'] as const).map(segment => buildWhatIfPrompt({ ...base, segment }))
    const systems = prompts.map(p => p.system)
    const users = prompts.map(p => p.user)
    expect(new Set(users).size).toBe(1) // identical grounding data regardless of segment
    expect(new Set(systems).size).toBe(4) // four genuinely distinct tone instructions
  })

  test('D071: Segment C tone instructs brevity and avoiding optional extra work, grounded in the real segment research', () => {
    const { system } = buildWhatIfPrompt({ utterance: 'Sell $5,000 of VTSAX', history: [], reference: taxableRef, segment: 'C' })
    expect(system).toMatch(/fastest credible path/i)
    expect(system).toMatch(/briefly as possible/i)
  })

  test('D071: Segment D tone instructs plain-language term definitions, grounded in the real segment research', () => {
    const { system } = buildWhatIfPrompt({ utterance: 'Sell $5,000 of VTSAX', history: [], reference: taxableRef, segment: 'D' })
    expect(system).toMatch(/plain language/i)
    expect(system).toMatch(/cost basis/i) // the real worked example from the research quote
  })
})

describe('confirmWhatIfCandidate — refuses an invalid candidate rather than calling the engine', () => {
  test('throws WhatIfError instead of running the engine on an invalid candidate', () => {
    const invalidCandidate = { mode: 'manual' as const, targetSaleAmount: 200000, manualSelections: { fund_selections: [{ fund_id: 'VBIRX', accounting_method: 'MinTax' as const, sell_amount: 200000 }] } }
    expect(() => confirmWhatIfCandidate(invalidCandidate, taxableRef, portfolio, TAXABLE, TAX_RATES)).toThrow(WhatIfError)
  })
})

describe('provider selection — WHATIF_PROVIDER (mirrors NARRATION_PROVIDER, D042)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  test('defaults to gemini when unset', async () => {
    delete process.env.WHATIF_PROVIDER
    const { getActiveInterpreter } = await import('../server/whatIfInterpreter')
    expect(getActiveInterpreter().name).toBe('gemini')
  })

  test('switches to anthropic via WHATIF_PROVIDER', async () => {
    process.env.WHATIF_PROVIDER = 'anthropic'
    const { getActiveInterpreter } = await import('../server/whatIfInterpreter')
    expect(getActiveInterpreter().name).toBe('anthropic')
  })

  test('switches to groq via WHATIF_PROVIDER (D065)', async () => {
    process.env.WHATIF_PROVIDER = 'groq'
    const { getActiveInterpreter } = await import('../server/whatIfInterpreter')
    expect(getActiveInterpreter().name).toBe('groq')
  })

  test('throws on an unknown provider name rather than silently defaulting', async () => {
    process.env.WHATIF_PROVIDER = 'not-a-real-provider'
    const { getActiveInterpreter, WhatIfInterpreterApiError } = await import('../server/whatIfInterpreter')
    expect(() => getActiveInterpreter()).toThrow(WhatIfInterpreterApiError)
  })

  // D071 — the Demo Settings dialog's runtime per-request override.
  test('a per-request override wins over WHATIF_PROVIDER when both are present', async () => {
    process.env.WHATIF_PROVIDER = 'groq'
    const { getActiveInterpreter } = await import('../server/whatIfInterpreter')
    expect(getActiveInterpreter('anthropic').name).toBe('anthropic')
  })

  test('omitting the override falls back to WHATIF_PROVIDER, unchanged from before this parameter existed', async () => {
    process.env.WHATIF_PROVIDER = 'groq'
    const { getActiveInterpreter } = await import('../server/whatIfInterpreter')
    expect(getActiveInterpreter().name).toBe('groq')
    expect(getActiveInterpreter(undefined).name).toBe('groq')
  })

  test('all three adapters expose the same {name, interpret} interface shape', async () => {
    const { geminiInterpreter } = await import('../server/generators/geminiInterpreter')
    const { anthropicInterpreter } = await import('../server/generators/anthropicInterpreter')
    const { groqInterpreter } = await import('../server/generators/groqInterpreter')
    for (const interp of [geminiInterpreter, anthropicInterpreter, groqInterpreter]) {
      expect(typeof interp.name).toBe('string')
      expect(typeof interp.interpret).toBe('function')
    }
  })

  test('all three adapters fail identically with no API key set', async () => {
    delete process.env.GEMINI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GROQ_API_KEY
    const { geminiInterpreter } = await import('../server/generators/geminiInterpreter')
    const { anthropicInterpreter } = await import('../server/generators/anthropicInterpreter')
    const { groqInterpreter } = await import('../server/generators/groqInterpreter')
    const { WhatIfInterpreterApiError } = await import('../server/whatIfInterpreter')
    const input = { utterance: 'sell $1,000 of VTSAX', history: [], reference: taxableRef, segment: 'A' as const }
    await expect(geminiInterpreter.interpret(input)).rejects.toThrow(WhatIfInterpreterApiError)
    await expect(anthropicInterpreter.interpret(input)).rejects.toThrow(WhatIfInterpreterApiError)
    await expect(groqInterpreter.interpret(input)).rejects.toThrow(WhatIfInterpreterApiError)
  })
})
