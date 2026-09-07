/**
 * TaxBreakdownPanel — the content rendered inside "Breakdown ▾"
 * (ExpandableDetail) at all six real touchpoints (DECISIONS.md's
 * breakdown-expanders entry). One component handling all three account
 * types' variants, since it's the same conceptual "explain this tax
 * figure" content throughout, just branching on what there is to explain —
 * not three separate components for what is, underneath, one feature.
 *
 * Computes computeNetTaxBreakdown() itself, from the same real per-fund
 * array each touchpoint already has in scope — never a second,
 * independently-derived approximation of the number already on screen in
 * the collapsed tile. See taxBreakdownDisplay.ts for why the ST/LT tax
 * lines use taxableAtST/taxableAtLT rather than the raw net gain/loss
 * figures, and engine/index.ts's NetTaxBreakdown doc comment for the
 * underlying arithmetic reason those two are not always the same number.
 */

import type { AccountType } from '../types'
import { computeNetTaxBreakdown } from '../engine/index'
import { buildTaxBreakdownDisplay, type FundGainLossEntry } from '../utils/taxBreakdownDisplay'
import { ROTH_QUALIFIED_DISTRIBUTION_NOTE } from '../utils/accountBanner'

export interface TaxBreakdownPanelProps {
  accountType: AccountType | undefined
  funds: FundGainLossEntry[]
  taxRates: { st_rate: number; lt_rate: number }
  saleTotal: number
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-[3px]">
      <span className={`text-[11.5px] ${bold ? 'font-bold text-vg-ink' : 'text-vg-ink-muted'} whitespace-nowrap`}>{label}</span>
      <span className={`text-[11.5px] text-right ${bold ? 'font-bold text-vg-ink' : 'text-vg-ink'}`}>{value}</span>
    </div>
  )
}

export function TaxBreakdownPanel({ accountType, funds, taxRates, saleTotal }: TaxBreakdownPanelProps) {
  const resolvedType: 'taxable_brokerage' | 'traditional_IRA' | 'roth_IRA' =
    accountType === 'traditional_IRA' || accountType === 'roth_IRA' ? accountType : 'taxable_brokerage'
  const breakdown = computeNetTaxBreakdown(funds, resolvedType, taxRates)
  const display = buildTaxBreakdownDisplay(resolvedType, funds, breakdown, taxRates, saleTotal, ROTH_QUALIFIED_DISTRIBUTION_NOTE)

  if (display.kind === 'roth_IRA') {
    return (
      <p className="text-[11.5px] text-vg-ink-muted leading-relaxed">{display.note}</p>
    )
  }

  if (display.kind === 'traditional_IRA') {
    return (
      <div className="flex flex-col">
        <Row label="Ordinary income tax" value={display.taxLine} bold />
        <div className="h-px bg-[#e8e9e9] my-[6px]" />
        <Row label="Effective rate (for reference)" value={display.effectiveRateLine} />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <Row label="Net short-term gain/loss" value={display.netSTLine} />
      <Row label="Net long-term gain/loss" value={display.netLTLine} />
      <Row label="Net Taxable Gain" value={display.netTaxableGainLine} bold />
      <div className="h-px bg-[#e8e9e9] my-[6px]" />
      <Row label="Short-term tax" value={display.stTaxLine} />
      <Row label="Long-term tax" value={display.ltTaxLine} />
      <div className="h-px bg-[#e8e9e9] my-[6px]" />
      <Row label="Total estimated tax" value={display.totalLine} bold />
      <div className="h-px bg-[#e8e9e9] my-[6px]" />
      {/* Effective rate is visually distinct from the additive steps above —
          a derived summary stat, not another step in the calculation. */}
      <Row label="Effective rate (for reference)" value={display.effectiveRateLine} />
    </div>
  )
}
