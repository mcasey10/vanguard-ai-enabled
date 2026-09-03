/**
 * dev/src/data/taxBrackets2026.test.ts — the real 2026 bracket data behind
 * the "Change" tax-bracket dialog (DECISIONS.md D0xx). High accuracy
 * stakes (this is real tax data a user could act on), so this checks both
 * the bounds-validation mechanism itself and the two specific ambiguous
 * splits the task calling for this dialog named explicitly.
 */

import { describe, test, expect } from 'vitest'
import {
  TAX_BRACKETS_2026, FILING_STATUS_LABELS, validateTaxBracketTable, formatIncomeRange,
  type TaxBracketRow,
} from './taxBrackets2026'

describe('TAX_BRACKETS_2026 — every table is well-formed (already validated at module load; re-asserted here as a real, named test)', () => {
  for (const status of Object.keys(FILING_STATUS_LABELS) as (keyof typeof FILING_STATUS_LABELS)[]) {
    test(`${status}: passes bounds validation`, () => {
      expect(() => validateTaxBracketTable(TAX_BRACKETS_2026[status])).not.toThrow()
    })

    test(`${status}: starts at $0, ends open-ended, every row's range is contiguous with the next`, () => {
      const rows = TAX_BRACKETS_2026[status]
      expect(rows[0].minIncome).toBe(0)
      expect(rows[rows.length - 1].maxIncome).toBeNull()
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].minIncome).toBe((rows[i - 1].maxIncome as number) + 1)
      }
    })
  }

  test('Married Filing Separately is deliberately absent — real 2026 MFS long-term brackets were not available to source, not guessed', () => {
    expect(Object.keys(TAX_BRACKETS_2026)).not.toContain('married_filing_separately')
    expect(Object.keys(FILING_STATUS_LABELS)).toHaveLength(3)
  })
})

describe('validateTaxBracketTable — the bounds-validation mechanism itself, adversarially', () => {
  const validSingleRow: TaxBracketRow = { minIncome: 0, maxIncome: 100, ordinaryRate: 0.1, ltRate: 0 }

  test('rejects an empty table', () => {
    expect(() => validateTaxBracketTable([])).toThrow(/empty/)
  })

  test('rejects a table that does not start at $0', () => {
    expect(() => validateTaxBracketTable([{ minIncome: 1, maxIncome: null, ordinaryRate: 0.1, ltRate: 0 }])).toThrow(/start at \$0/)
  })

  test('rejects a table whose top row is not open-ended', () => {
    expect(() => validateTaxBracketTable([validSingleRow])).toThrow(/open-ended/)
  })

  test('rejects a rate outside [0, 1]', () => {
    expect(() => validateTaxBracketTable([{ minIncome: 0, maxIncome: null, ordinaryRate: 1.5, ltRate: 0 }])).toThrow(/valid rate/)
  })

  test('rejects a gap between two rows', () => {
    const rows: TaxBracketRow[] = [
      { minIncome: 0, maxIncome: 100, ordinaryRate: 0.1, ltRate: 0 },
      { minIncome: 105, maxIncome: null, ordinaryRate: 0.2, ltRate: 0.15 }, // gap: should be 101
    ]
    expect(() => validateTaxBracketTable(rows)).toThrow(/gap or overlap/)
  })

  test('rejects an overlap between two rows', () => {
    const rows: TaxBracketRow[] = [
      { minIncome: 0, maxIncome: 100, ordinaryRate: 0.1, ltRate: 0 },
      { minIncome: 90, maxIncome: null, ordinaryRate: 0.2, ltRate: 0.15 }, // overlap
    ]
    expect(() => validateTaxBracketTable(rows)).toThrow(/gap or overlap/)
  })

  test('accepts a genuinely well-formed table', () => {
    const rows: TaxBracketRow[] = [
      { minIncome: 0, maxIncome: 100, ordinaryRate: 0.1, ltRate: 0 },
      { minIncome: 101, maxIncome: null, ordinaryRate: 0.2, ltRate: 0.15 },
    ]
    expect(() => validateTaxBracketTable(rows)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// The two specific ambiguous splits the task named explicitly — real,
// checkable regression tests, not just "the table looks right."
// ---------------------------------------------------------------------------

describe('the two named ambiguous splits are actually present, not silently missed', () => {
  test('Single: the 12% ordinary bracket ($12,401–$50,400) is split at the $49,000 LT boundary into two distinct rows', () => {
    const rows = TAX_BRACKETS_2026.single
    const twelvePctRows = rows.filter(r => r.ordinaryRate === 0.12)
    expect(twelvePctRows).toHaveLength(2)
    expect(twelvePctRows[0]).toEqual({ minIncome: 12401, maxIncome: 49000, ordinaryRate: 0.12, ltRate: 0.00 })
    expect(twelvePctRows[1]).toEqual({ minIncome: 49001, maxIncome: 50400, ordinaryRate: 0.12, ltRate: 0.15 })
  })

  test('Single: the 35% ordinary bracket ($256,226–$640,600) is split at the $541,350 LT boundary into two distinct rows', () => {
    const rows = TAX_BRACKETS_2026.single
    const thirtyFivePctRows = rows.filter(r => r.ordinaryRate === 0.35)
    expect(thirtyFivePctRows).toHaveLength(2)
    expect(thirtyFivePctRows[0]).toEqual({ minIncome: 256226, maxIncome: 541350, ordinaryRate: 0.35, ltRate: 0.15 })
    expect(thirtyFivePctRows[1]).toEqual({ minIncome: 541351, maxIncome: 640600, ordinaryRate: 0.35, ltRate: 0.20 })
  })

  test('a selection anywhere in the current app default ($105,701–$201,775, Single) resolves to exactly 24% ordinary / 15% long-term — matching this app\'s existing default rates', () => {
    const row = TAX_BRACKETS_2026.single.find(r => r.minIncome === 105701)!
    expect(row.ordinaryRate).toBe(0.24)
    expect(row.ltRate).toBe(0.15)
    expect(row.maxIncome).toBe(201775)
  })
})

describe('formatIncomeRange', () => {
  test('formats a bounded range with thousands separators', () => {
    expect(formatIncomeRange({ minIncome: 105701, maxIncome: 201775, ordinaryRate: 0.24, ltRate: 0.15 })).toBe('$105,701–$201,775')
  })

  test('formats the open-ended top bracket as "Over $X"', () => {
    expect(formatIncomeRange({ minIncome: 640601, maxIncome: null, ordinaryRate: 0.37, ltRate: 0.20 })).toBe('Over $640,600')
  })
})
