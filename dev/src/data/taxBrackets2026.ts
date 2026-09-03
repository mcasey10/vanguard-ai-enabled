/**
 * Real 2026 federal tax bracket data for the "Change" tax-bracket dialog
 * (DECISIONS.md D0xx — see the entry logged alongside this file). Sourced
 * directly from the user, transcribed verbatim — not reconstructed from
 * memory, given the accuracy stakes of shipping wrong tax figures.
 *
 * Two real tables exist, and they do NOT share threshold boundaries:
 *   - Federal ordinary income brackets (also this app's `st_rate` — short-
 *     term capital gains are taxed at these same rates by law, not a
 *     separate schedule; see DECISIONS.md's IRA-tax-hypothesis entry).
 *   - Long-term capital gains brackets (`lt_rate`).
 * A user's ordinary bracket alone does not determine their LT rate (or vice
 * versa) — e.g. a Single filer's 12% ordinary bracket ($12,401–$50,400)
 * straddles the LT table's 0%/15% boundary at $49,000, and the 35% ordinary
 * bracket straddles the 15%/20% LT boundary. Picking a row from either table
 * independently would be quietly wrong for anyone in those bands.
 *
 * TAX_BRACKETS_2026 is the union of both tables' breakpoints per filing
 * status — every row is a genuine income sub-range where BOTH rates are
 * constant and unambiguous, so selecting one row always determines both
 * st_rate and lt_rate correctly together. This is the only correct
 * generalization: never let UI code infer one rate from the other table's
 * selection.
 *
 * Married Filing Separately is deliberately excluded — the real 2026 MFS
 * long-term capital-gains brackets were not available to source, and this
 * project does not guess/fabricate tax data (same standing principle as the
 * market-data rules in CLAUDE.md §7). Scoped out explicitly, not silently.
 */

export type FilingStatus = 'single' | 'married_filing_jointly' | 'head_of_household'

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  married_filing_jointly: 'Married Filing Jointly',
  head_of_household: 'Head of Household',
}

export interface TaxBracketRow {
  /** Inclusive lower bound of this income sub-range. */
  minIncome: number
  /** Inclusive upper bound; null = no upper bound (the top bracket). */
  maxIncome: number | null
  /** Federal ordinary income rate for this range — also this app's st_rate. */
  ordinaryRate: number
  /** Long-term capital gains rate for this range — this app's lt_rate. */
  ltRate: number
}

// ---------------------------------------------------------------------------
// Single
// ---------------------------------------------------------------------------
// Ordinary: 10% $0–12,400 / 12% 12,401–50,400 / 22% 50,401–105,700 /
//           24% 105,701–201,775 / 32% 201,776–256,225 / 35% 256,226–640,600 /
//           37% over 640,600
// LT:       0% up to 49,000 / 15% 49,001–541,350 / 20% over 541,350
// The 12% ordinary bracket straddles the 0%/15% LT boundary at 49,000 —
// split into two rows. The 35% ordinary bracket straddles the 15%/20% LT
// boundary at 541,350 — split into two rows.
const SINGLE: TaxBracketRow[] = [
  { minIncome: 0,       maxIncome: 12400,  ordinaryRate: 0.10, ltRate: 0.00 },
  { minIncome: 12401,   maxIncome: 49000,  ordinaryRate: 0.12, ltRate: 0.00 },
  { minIncome: 49001,   maxIncome: 50400,  ordinaryRate: 0.12, ltRate: 0.15 },
  { minIncome: 50401,   maxIncome: 105700, ordinaryRate: 0.22, ltRate: 0.15 },
  { minIncome: 105701,  maxIncome: 201775, ordinaryRate: 0.24, ltRate: 0.15 },
  { minIncome: 201776,  maxIncome: 256225, ordinaryRate: 0.32, ltRate: 0.15 },
  { minIncome: 256226,  maxIncome: 541350, ordinaryRate: 0.35, ltRate: 0.15 },
  { minIncome: 541351,  maxIncome: 640600, ordinaryRate: 0.35, ltRate: 0.20 },
  { minIncome: 640601,  maxIncome: null,   ordinaryRate: 0.37, ltRate: 0.20 },
]

// ---------------------------------------------------------------------------
// Married Filing Jointly
// ---------------------------------------------------------------------------
// Ordinary: 10% $0–24,800 / 12% 24,801–100,800 / 22% 100,801–211,400 /
//           24% 211,401–403,550 / 32% 403,551–512,450 / 35% 512,451–768,700 /
//           37% over 768,700
// LT:       0% up to 98,000 / 15% 98,001–609,050 / 20% over 609,050
// The 12% ordinary bracket straddles the 0%/15% LT boundary at 98,000. The
// 35% ordinary bracket straddles the 15%/20% LT boundary at 609,050.
const MARRIED_FILING_JOINTLY: TaxBracketRow[] = [
  { minIncome: 0,       maxIncome: 24800,  ordinaryRate: 0.10, ltRate: 0.00 },
  { minIncome: 24801,   maxIncome: 98000,  ordinaryRate: 0.12, ltRate: 0.00 },
  { minIncome: 98001,   maxIncome: 100800, ordinaryRate: 0.12, ltRate: 0.15 },
  { minIncome: 100801,  maxIncome: 211400, ordinaryRate: 0.22, ltRate: 0.15 },
  { minIncome: 211401,  maxIncome: 403550, ordinaryRate: 0.24, ltRate: 0.15 },
  { minIncome: 403551,  maxIncome: 512450, ordinaryRate: 0.32, ltRate: 0.15 },
  { minIncome: 512451,  maxIncome: 609050, ordinaryRate: 0.35, ltRate: 0.15 },
  { minIncome: 609051,  maxIncome: 768700, ordinaryRate: 0.35, ltRate: 0.20 },
  { minIncome: 768701,  maxIncome: null,   ordinaryRate: 0.37, ltRate: 0.20 },
]

// ---------------------------------------------------------------------------
// Head of Household
// ---------------------------------------------------------------------------
// Ordinary: 10% $0–17,700 / 12% 17,701–67,450 / 22% 67,451–105,700 /
//           24% 105,701–201,750 / 32% 201,751–256,200 / 35% 256,201–640,600 /
//           37% over 640,600
// LT:       0% up to 65,650 / 15% 65,651–575,150 / 20% over 575,150
// The 12% ordinary bracket straddles the 0%/15% LT boundary at 65,650. The
// 35% ordinary bracket straddles the 15%/20% LT boundary at 575,150.
const HEAD_OF_HOUSEHOLD: TaxBracketRow[] = [
  { minIncome: 0,       maxIncome: 17700,  ordinaryRate: 0.10, ltRate: 0.00 },
  { minIncome: 17701,   maxIncome: 65650,  ordinaryRate: 0.12, ltRate: 0.00 },
  { minIncome: 65651,   maxIncome: 67450,  ordinaryRate: 0.12, ltRate: 0.15 },
  { minIncome: 67451,   maxIncome: 105700, ordinaryRate: 0.22, ltRate: 0.15 },
  { minIncome: 105701,  maxIncome: 201750, ordinaryRate: 0.24, ltRate: 0.15 },
  { minIncome: 201751,  maxIncome: 256200, ordinaryRate: 0.32, ltRate: 0.15 },
  { minIncome: 256201,  maxIncome: 575150, ordinaryRate: 0.35, ltRate: 0.15 },
  { minIncome: 575151,  maxIncome: 640600, ordinaryRate: 0.35, ltRate: 0.20 },
  { minIncome: 640601,  maxIncome: null,   ordinaryRate: 0.37, ltRate: 0.20 },
]

export const TAX_BRACKETS_2026: Record<FilingStatus, TaxBracketRow[]> = {
  single: SINGLE,
  married_filing_jointly: MARRIED_FILING_JOINTLY,
  head_of_household: HEAD_OF_HOUSEHOLD,
}

/**
 * Bounds validation on the underlying data structure — there is no
 * free-text user entry to validate here (the dialog only ever offers a
 * selectable row), so this guards against a malformed table entry slipping
 * through instead: rows must be sorted ascending with no gaps or overlaps,
 * must start at 0, must end with an open-ended top bracket, and every rate
 * must be a finite number in [0, 1]. Called for every table at module load
 * (below) — a broken table fails immediately and loudly, not silently at
 * some later render.
 */
export function validateTaxBracketTable(rows: TaxBracketRow[]): void {
  if (rows.length === 0) throw new Error('Tax bracket table is empty')
  if (rows[0].minIncome !== 0) throw new Error('Tax bracket table must start at $0')
  const last = rows[rows.length - 1]
  if (last.maxIncome !== null) throw new Error('Tax bracket table\'s top row must have maxIncome: null (open-ended)')

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!Number.isFinite(row.ordinaryRate) || row.ordinaryRate < 0 || row.ordinaryRate > 1) {
      throw new Error(`Row ${i}: ordinaryRate ${row.ordinaryRate} is not a valid rate in [0, 1]`)
    }
    if (!Number.isFinite(row.ltRate) || row.ltRate < 0 || row.ltRate > 1) {
      throw new Error(`Row ${i}: ltRate ${row.ltRate} is not a valid rate in [0, 1]`)
    }
    if (row.maxIncome !== null && row.maxIncome <= row.minIncome) {
      throw new Error(`Row ${i}: maxIncome ${row.maxIncome} must be greater than minIncome ${row.minIncome}`)
    }
    if (i > 0) {
      const prev = rows[i - 1]
      if (prev.maxIncome === null) throw new Error(`Row ${i - 1} is not the last row but has an open-ended maxIncome`)
      if (row.minIncome !== prev.maxIncome + 1) {
        throw new Error(`Row ${i}'s minIncome (${row.minIncome}) does not immediately follow row ${i - 1}'s maxIncome (${prev.maxIncome}) — gap or overlap`)
      }
    }
  }
}

for (const [status, rows] of Object.entries(TAX_BRACKETS_2026)) {
  try {
    validateTaxBracketTable(rows)
  } catch (err) {
    throw new Error(`Invalid tax bracket table for "${status}": ${(err as Error).message}`)
  }
}

/** Human-readable range label for one row, e.g. "$105,701–$201,775" or "Over $640,600". */
export function formatIncomeRange(row: TaxBracketRow): string {
  const fmt = (n: number) => `$${n.toLocaleString('en-US')}`
  return row.maxIncome === null ? `Over ${fmt(row.minIncome - 1)}` : `${fmt(row.minIncome)}–${fmt(row.maxIncome)}`
}
