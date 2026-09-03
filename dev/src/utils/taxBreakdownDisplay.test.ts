/**
 * taxBreakdownDisplay.test.ts — the "Breakdown ▾" panel's pure formatting
 * logic (DECISIONS.md's breakdown-expanders entry, item 7). Covers the
 * fund-level netting-equation rule explicitly: show the arithmetic only
 * when there's a real netting story (2+ contributing funds, mixed signs);
 * otherwise just the net number. Also asserts the sum-consistency guarantee
 * end to end using real computeNetTaxBreakdown() output, not hand-typed
 * expected totals.
 */

import { describe, test, expect } from 'vitest'
import { formatNettingEquation, formatNetGainLine, formatTaxLine, formatEffectiveRate, buildTaxBreakdownDisplay } from './taxBreakdownDisplay'
import { computeNetTaxBreakdown } from '../engine/index'

const RATES = { st_rate: 0.24, lt_rate: 0.15 }

describe('formatNettingEquation — when to show the arithmetic vs. just the net number', () => {
  test('single contributing fund: no equation', () => {
    expect(formatNettingEquation([645.81])).toBeNull()
  })

  test('zero contributing funds (all zero): no equation', () => {
    expect(formatNettingEquation([0, 0])).toBeNull()
  })

  test('two funds, same sign (both positive): no equation — no real netting story', () => {
    expect(formatNettingEquation([645.81, 483.69])).toBeNull()
  })

  test('two funds, same sign (both negative): no equation', () => {
    expect(formatNettingEquation([-200, -300])).toBeNull()
  })

  test('two funds, mixed sign: the exact task-given example', () => {
    expect(formatNettingEquation([645.81, -483.69])).toBe('$645.81 − $483.69 = +$162.12')
  })

  test('mixed sign, negative net: leading term positive, trailing negative term outweighs it', () => {
    expect(formatNettingEquation([100, -250])).toBe('$100.00 − $250.00 = −$150.00')
  })

  test('mixed sign, first term negative: leading minus sign on the first term', () => {
    expect(formatNettingEquation([-645.81, 483.69])).toBe('−$645.81 + $483.69 = −$162.12')
  })

  test('three funds, mixed sign: all three terms shown in order', () => {
    expect(formatNettingEquation([200, 300, -100])).toBe('$200.00 + $300.00 − $100.00 = +$400.00')
  })

  test('a zero-amount fund is excluded from the equation entirely, not shown as "+$0.00"', () => {
    // Three funds sold, but only two actually contribute to this category —
    // still only 2 contributing, mixed sign, so equation shows only those two.
    expect(formatNettingEquation([500, 0, -200])).toBe('$500.00 − $200.00 = +$300.00')
  })
})

describe('formatNetGainLine — the actual row value, falling back correctly', () => {
  test('no netting story: plain signed net', () => {
    expect(formatNetGainLine([645.81, 483.69])).toBe('+$1,129.50')
  })

  test('netting story: full equation', () => {
    expect(formatNetGainLine([645.81, -483.69])).toBe('$645.81 − $483.69 = +$162.12')
  })

  test('all zero: plain $0.00', () => {
    expect(formatNetGainLine([0, 0])).toBe('$0.00')
  })
})

describe('formatTaxLine and formatEffectiveRate', () => {
  test('formatTaxLine renders "{amount} × {rate}% = {tax}"', () => {
    expect(formatTaxLine(645.81, 0.24, 154.99)).toBe('$645.81 × 24% = $154.99')
  })

  test('formatEffectiveRate divides tax by sale total, 2 decimal places', () => {
    expect(formatEffectiveRate(110.21, 25000)).toBe('0.44%')
  })

  test('formatEffectiveRate returns 0.00% for a zero sale total rather than dividing by zero', () => {
    expect(formatEffectiveRate(0, 0)).toBe('0.00%')
  })
})

describe('buildTaxBreakdownDisplay — end-to-end against real computeNetTaxBreakdown() output', () => {
  test('taxable brokerage, mixed multi-fund: every displayed number traces back to the real breakdown, not a re-derived one', () => {
    const funds = [
      { est_st_gain_loss: 645.81, est_lt_gain_loss: 0, sell_amount: 15000 },
      { est_st_gain_loss: -483.69, est_lt_gain_loss: -1057, sell_amount: 10000 },
    ]
    const breakdown = computeNetTaxBreakdown(funds, 'taxable_brokerage', RATES)
    const display = buildTaxBreakdownDisplay('taxable_brokerage', funds, breakdown, RATES, 25000, 'unused')
    if (display.kind !== 'taxable_brokerage') throw new Error('expected taxable_brokerage')
    expect(display.netSTLine).toBe('$645.81 − $483.69 = +$162.12') // two contributors, mixed sign
    expect(display.netLTLine).toBe('−$1,057.00') // single contributor, no equation
    expect(display.totalLine).toBe(`$${breakdown.total.toFixed(2)}`)
    // The two tax lines' own numeric results sum to the real total — the
    // core guarantee this whole feature exists to provide.
    expect(breakdown.stTax + breakdown.ltTax).toBeCloseTo(breakdown.total, 2)
  })

  test('traditional IRA: single-line tax equation uses the real totalWithdrawal and total', () => {
    const funds = [{ est_st_gain_loss: -50, est_lt_gain_loss: 900, sell_amount: 10000 }]
    const breakdown = computeNetTaxBreakdown(funds, 'traditional_IRA', RATES)
    const display = buildTaxBreakdownDisplay('traditional_IRA', funds, breakdown, RATES, 10000, 'unused')
    if (display.kind !== 'traditional_IRA') throw new Error('expected traditional_IRA')
    expect(display.taxLine).toBe('$10,000.00 × 24% = $2,400.00')
  })

  test('roth IRA: no numeric equation at all, just the supplied reasoning note passed through verbatim', () => {
    const funds = [{ est_st_gain_loss: 3000, est_lt_gain_loss: 2000, sell_amount: 20000 }]
    const breakdown = computeNetTaxBreakdown(funds, 'roth_IRA', RATES)
    const display = buildTaxBreakdownDisplay('roth_IRA', funds, breakdown, RATES, 20000, 'Investor is 73 — qualified distribution.')
    if (display.kind !== 'roth_IRA') throw new Error('expected roth_IRA')
    expect(display.note).toBe('Investor is 73 — qualified distribution.')
  })

  test('cross-category netting case: the displayed ST tax line correctly shows $0, not a negative naive figure', () => {
    // Same case as engine.test.ts's dedicated cross-netting test: ST loss
    // absorbed entirely by a larger LT gain — taxableAtST is 0, so the
    // ST tax LINE must read "$0.00 × 24% = $0.00", never anything implying
    // the raw -$500 net ST loss was multiplied by the ST rate.
    const funds = [
      { est_st_gain_loss: -500, est_lt_gain_loss: 0, sell_amount: 4000 },
      { est_st_gain_loss: 0, est_lt_gain_loss: 1000, sell_amount: 6000 },
    ]
    const breakdown = computeNetTaxBreakdown(funds, 'taxable_brokerage', RATES)
    const display = buildTaxBreakdownDisplay('taxable_brokerage', funds, breakdown, RATES, 10000, 'unused')
    if (display.kind !== 'taxable_brokerage') throw new Error('expected taxable_brokerage')
    expect(display.netSTLine).toBe('−$500.00') // the raw net (informational)
    expect(display.stTaxLine).toBe('$0.00 × 24% = $0.00') // the real taxable attribution (what's actually taxed)
    expect(display.ltTaxLine).toBe('$500.00 × 15% = $75.00')
    expect(display.totalLine).toBe('$75.00')
  })
})
