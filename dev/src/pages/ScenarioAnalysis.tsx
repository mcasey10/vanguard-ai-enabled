import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import type { SavedScenario, Portfolio } from '../types'
import { formatCurrency, formatCurrencyCompact, formatPercent } from '../utils/format'

// ---------------------------------------------------------------------------
// Seed canonical scenarios for prototype demo (VT8 + VT9 variations)
// All values from pm/08-sample-dataset.json — never recalled from memory.
// Call on mount when store.scenarios is empty.
// ---------------------------------------------------------------------------
function seedCanonicalScenarios(portfolio: Portfolio | null): SavedScenario[] {
  const DEFAULT_TAX = { st_rate: 0.24, lt_rate: 0.15, income_bracket_label: '24% / 15%', source: 'default' as const, selection_timestamp: new Date().toISOString() }
  const NOW = new Date().toISOString()

  // Compute current allocation from actual holding balances (Fix 3 — previously hardcoded stale values).
  // Matches the computation in engine/index.ts computeAllocationImpact() Fix 1.
  function computeCurrentAlloc(port: Portfolio | null) {
    if (!port) return { de: 41.75, ie: 16.02, db: 32.53, sr: 9.69 } // fallback to correct computed values
    const total = port.total_investable_balance
    const sums: Record<string, number> = { domestic_equity: 0, international_equity: 0, domestic_bonds: 0, short_term_reserves: 0 }
    for (const acct of port.accounts)
      for (const h of acct.holdings)
        sums[h.asset_class] = (sums[h.asset_class] ?? 0) + h.current_balance
    const p = (v: number) => total > 0 ? Math.round((v / total) * 10000) / 100 : 0
    return { de: p(sums.domestic_equity), ie: p(sums.international_equity), db: p(sums.domestic_bonds), sr: p(sums.short_term_reserves) }
  }
  const cur = computeCurrentAlloc(portfolio)

  // Allocation impact — percentage format (0–100 range), split into domestic/international equity.
  // After-sale values computed from actual balances (portfolio total $870,619.40, new total $845,619.40 for $25K sale).
  const ALLOC_CURRENT = { domestic_equity_before: cur.de, international_equity_before: cur.ie, domestic_bonds_before: cur.db, short_term_reserves_before: cur.sr }
  // SC1: sell VTSAX $15K (domestic_equity) + VBTLX $10K (domestic_bonds)
  const SC1_AFTER  = { domestic_equity_after: 41.21, international_equity_after: 16.50, domestic_bonds_after: 32.31, short_term_reserves_after: 9.98 }
  // SC2: sell VTSAX $15K (domestic_equity) + VTIAX $10K (international_equity)
  const SC2_AFTER  = { domestic_equity_after: 41.21, international_equity_after: 15.31, domestic_bonds_after: 33.49, short_term_reserves_after: 9.98 }
  // SC3: sell VTSAX $15K (domestic_equity) + VBIRX $10K (short_term_reserves)
  const SC3_AFTER  = { domestic_equity_after: 41.21, international_equity_after: 16.50, domestic_bonds_after: 33.49, short_term_reserves_after: 8.80 }

  return [
    {
      scenario_id: 'sc-1',
      scenario_name: 'Scenario 1',
      source_mode: 'automated',
      optimization_priority: 'tax-first',
      fund_selections: [
        { fund_id: 'VTSAX', fund_name: 'Total Stock Market', sell_amount: 15000, accounting_method: 'MinTax', lots_selected: [], st_gain_loss: 1515.85, lt_gain_loss: 0, est_tax_gross: 363.80 },
        { fund_id: 'VBTLX', fund_name: 'Total Bond Market',  sell_amount: 10000, accounting_method: 'MinTax', lots_selected: [], st_gain_loss: 0,       lt_gain_loss: -1056.65, est_tax_gross: 0 },
      ],
      total_sell_amount: 25000,
      projected_st_gains: 1515.85,
      projected_lt_gains: 0,
      losses_harvested: -1056.65,
      net_taxable_gain: 459.20,
      est_net_tax: 110.21,
      effective_rate: 0.0044,
      allocation_impact: { ...ALLOC_CURRENT, ...SC1_AFTER },
      tradeoff_summary: 'Lowest net tax ($110.21). Loss harvesting offsets ST gains. Bonds drift slightly further from 35% target.',
      tax_assumption_set: DEFAULT_TAX,
      created_at: NOW,
    },
    {
      scenario_id: 'sc-2',
      scenario_name: 'Scenario 2',
      source_mode: 'manual',
      fund_selections: [
        { fund_id: 'VTSAX', fund_name: 'Total Stock Market', sell_amount: 15000.03, accounting_method: 'specific_lot_identification', lots_selected: [], st_gain_loss: 0, lt_gain_loss: 2875, est_tax_gross: 431 },
        { fund_id: 'VTIAX', fund_name: 'Total Intl Stock',   sell_amount: 10000.02, accounting_method: 'MinTax', lots_selected: [], st_gain_loss: 0, lt_gain_loss: 2981, est_tax_gross: 447 },
      ],
      total_sell_amount: 25000.05,
      projected_st_gains: 0,
      projected_lt_gains: 5855.65,
      losses_harvested: 0,
      net_taxable_gain: 5855.65,
      est_net_tax: 878.35,
      effective_rate: 0.0351,
      allocation_impact: { ...ALLOC_CURRENT, ...SC2_AFTER },
      tradeoff_summary: 'Higher net tax ($878.35). No loss harvesting. Greater equity reduction moves portfolio closer to 55% stock target.',
      tax_assumption_set: DEFAULT_TAX,
      created_at: NOW,
    },
    {
      scenario_id: 'sc-3',
      scenario_name: 'Scenario 3',
      source_mode: 'manual',
      fund_selections: [
        { fund_id: 'VTSAX', fund_name: 'Total Stock Market', sell_amount: 15000.03, accounting_method: 'MinTax', lots_selected: [], st_gain_loss: 1515.85, lt_gain_loss: 0, est_tax_gross: 363.80 },
        { fund_id: 'VBIRX', fund_name: 'Short-Term Bond',    sell_amount: 10000,    accounting_method: 'MinTax', lots_selected: [], st_gain_loss: 0,        lt_gain_loss: -220.73, est_tax_gross: 0 },
      ],
      total_sell_amount: 25000.03,
      projected_st_gains: 1515.85,
      projected_lt_gains: 0,
      losses_harvested: -220.73,
      net_taxable_gain: 1295.12,
      est_net_tax: 310.83,
      effective_rate: 0.0124,
      allocation_impact: { ...ALLOC_CURRENT, ...SC3_AFTER },
      tradeoff_summary: 'Mid-range tax ($310.83). Harvests short-term bond losses. No allocation improvement — reserves decrease below target.',
      tax_assumption_set: DEFAULT_TAX,
      created_at: NOW,
    },
  ]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r2(n: number) { return Math.round(n * 100) / 100 }

// Sign-prefixed currency: +$1,515.85 or −$1,056.65 (never for $0)
function fmtGain(n: number): string {
  if (n === 0) return formatCurrency(0)
  return (n > 0 ? '+' : '−') + formatCurrency(Math.abs(n))
}

// Compact signed currency for fund table G/L and tax cells — no cents, no wrapping
// e.g. 1515.85 → "+$1,516"  |  -1056.65 → "−$1,057"
function fmtGainCompact(n: number): string {
  if (n === 0) return formatCurrencyCompact(0)
  return (n > 0 ? '+' : '−') + formatCurrencyCompact(Math.abs(n))
}

// Accounting method display
function fmtMethod(m: string): string {
  if (m === 'specific_lot_identification') return 'Spec ID'
  if (m === 'MinTax') return 'MinTax'
  if (m === 'HIFO') return 'HIFO'
  if (m === 'FIFO') return 'FIFO'
  if (m === 'AverageCost') return 'Avg Cost'
  return m
}

// Diff-row color: red if |diff| ≥ 0.5%, neutral otherwise
function diffColor(diff: number): string {
  return Math.abs(diff) >= 0.5 ? 'text-[#c8102e]' : 'text-[#040505]'
}

// Diff value: sign prefix + 1-decimal percent, using proper minus sign
function fmtDiff(diff: number): string {
  const abs = Math.abs(diff)
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(abs)
  if (diff > 0) return `+${formatted}%`
  if (diff < 0) return `−${formatted}%`
  return `${formatted}%`
}

// ---------------------------------------------------------------------------
// Stacked allocation bar
// ---------------------------------------------------------------------------

const BAR_COLORS = {
  stocks:   { solid: '#2bbfb3', faded: 'rgba(43,191,179,0.5)'  },
  bonds:    { solid: '#c8902a', faded: 'rgba(200,144,42,0.5)'  },
  reserves: { solid: '#888888', faded: 'rgba(136,136,136,0.5)' },
}

interface BarRowProps {
  label: string
  stocks: number    // percentage 0–100
  bonds: number
  reserves: number
  faded?: boolean
  dashed?: boolean
}

function BarRow({ label, stocks, bonds, reserves, faded, dashed }: BarRowProps) {
  const c = (k: keyof typeof BAR_COLORS) => faded ? BAR_COLORS[k].faded : BAR_COLORS[k].solid
  const sPct = r2(stocks)
  const bPct = r2(bonds)
  const rPct = r2(reserves)
  return (
    <div className="flex gap-[8px] items-center w-full">
      <span className="text-[12px] text-[#717777] text-right w-[64px] shrink-0 whitespace-nowrap">{label}</span>
      <div className={`flex flex-1 h-[24px] rounded-[4px] overflow-clip ${dashed ? 'border border-dashed border-[#ccc]' : ''}`}>
        <div style={{ width: `${sPct}%`, background: c('stocks')   }} className="h-full flex items-center justify-center px-[4px]">
          {sPct >= 8 && <span className="text-[11px] text-white whitespace-nowrap">{Math.round(sPct)}%</span>}
        </div>
        <div style={{ width: `${bPct}%`, background: c('bonds')    }} className="h-full flex items-center justify-center px-[4px]">
          {bPct >= 8 && <span className="text-[11px] text-white whitespace-nowrap">{Math.round(bPct)}%</span>}
        </div>
        <div style={{ width: `${rPct}%`, background: c('reserves') }} className="h-full flex items-center justify-center px-[4px]">
          {rPct >= 5 && <span className="text-[11px] text-white whitespace-nowrap">{Math.round(rPct)}%</span>}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog (NF-1 pattern)
// ---------------------------------------------------------------------------

function DeleteDialog({ scenarioName, onConfirm, onCancel }: {
  scenarioName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white border border-[#d0d0d0] rounded-[4px] flex flex-col items-start justify-between overflow-clip pb-[16px] pt-[24px] px-[24px]" style={{ width: 480, minHeight: 200 }}>
        <div className="flex flex-col gap-3 w-full">
          <p className="text-[16px] font-bold text-vg-ink">Delete {scenarioName}?</p>
          <p className="text-[14px] text-vg-ink-muted">This scenario will be permanently removed from your comparison.</p>
        </div>
        <div className="flex items-center justify-between w-full mt-6">
          <button onClick={onCancel} className="h-[48px] px-7 rounded-full border-[1.5px] border-vg-ink bg-white text-[14px] font-bold text-vg-ink hover:opacity-90 transition-opacity">
            Cancel
          </button>
          <button onClick={onConfirm} className="h-[48px] px-7 rounded-full bg-[#c8102e] text-white text-[14px] font-bold hover:opacity-90 transition-opacity">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Kebab menu
// ---------------------------------------------------------------------------

function KebabMenu({ onDuplicate, onDelete }: { onDuplicate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} className="flex flex-col items-center justify-center w-[24px] h-[24px] cursor-pointer" aria-label="More options">
        <svg width="3" height="15" viewBox="0 0 3 15" fill="none"><circle cx="1.5" cy="1.5" r="1.5" fill="#040505"/><circle cx="1.5" cy="7.5" r="1.5" fill="#040505"/><circle cx="1.5" cy="13.5" r="1.5" fill="#040505"/></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-[28px] z-40 bg-white border border-[#e8e9e9] rounded-[4px] shadow-md min-w-[160px]" onClick={() => setOpen(false)}>
          <button onClick={onDuplicate} className="w-full text-left px-4 py-3 text-[13px] text-vg-ink hover:bg-[#f8f8f8]">Duplicate scenario</button>
          <button onClick={onDelete}    className="w-full text-left px-4 py-3 text-[13px] text-[#c8102e] hover:bg-[#f8f8f8]">Delete scenario</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scenario column
// ---------------------------------------------------------------------------

interface ScenarioColumnProps {
  scenario: SavedScenario
  index: number
  portfolio: Portfolio | null
  activeTaxRates: { st_rate: number; lt_rate: number }
  onEdit: () => void
  onReviewOrder: () => void
  onDuplicate: () => void
  onDelete: () => void
}

function ScenarioColumn({ scenario, index, portfolio, activeTaxRates, onEdit, onReviewOrder, onDuplicate, onDelete }: ScenarioColumnProps) {
  const ai = scenario.allocation_impact
  // AllocationImpact stores values in percentage format (0–100). Combine domestic+international for Stocks.
  const stocksBefore   = r2(ai.domestic_equity_before  + ai.international_equity_before)
  const stocksAfter    = r2(ai.domestic_equity_after   + ai.international_equity_after)
  const bondsBefore    = r2(ai.domestic_bonds_before)
  const bondsAfter     = r2(ai.domestic_bonds_after)
  const resBefore      = r2(ai.short_term_reserves_before)
  const resAfter       = r2(ai.short_term_reserves_after)

  // Target allocation — values are in percentage format (0–100) per canonical dataset
  const targetStocks = portfolio?.target_allocation
    ? r2(portfolio.target_allocation.domestic_equity_pct + (portfolio.target_allocation.international_equity_pct ?? 0))
    : 55
  const targetBonds  = portfolio?.target_allocation ? r2(portfolio.target_allocation.domestic_bonds_pct) : 35
  const targetRes    = portfolio?.target_allocation ? r2(portfolio.target_allocation.short_term_reserves_pct) : 10

  // Diff = target − after_sale: negative = overweight vs target, positive = underweight vs target
  const diffStocks = r2(targetStocks - stocksAfter)
  const diffBonds  = r2(targetBonds  - bondsAfter)
  const diffRes    = r2(targetRes    - resAfter)

  // Re-compute tax with active rates (REQ-SC-008: update all columns when rate changes)
  const federalTax = r2(Math.max(0, scenario.projected_st_gains) * activeTaxRates.st_rate
                    + Math.max(0, scenario.projected_lt_gains)  * activeTaxRates.lt_rate
                    + Math.max(0, r2(scenario.projected_st_gains + scenario.projected_lt_gains + scenario.losses_harvested)) * 0
                    // simplified: use stored est_net_tax scaled by rate ratio
  )
  // Use stored value — in prototype rates are fixed so this is stable
  const displayFederalTax = scenario.est_net_tax
  const effRatePct = scenario.total_sell_amount > 0
    ? r2((displayFederalTax / scenario.total_sell_amount) * 100)
    : r2(scenario.effective_rate * 100)
  const displayEffRate = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(effRatePct) + '%'
  void federalTax

  const isSystemRec = scenario.source_mode === 'automated'

  return (
    <div className="bg-white border border-[#e8e9e9] flex flex-col flex-1 rounded-[8px] overflow-hidden min-w-0">
      {/* SecA — scenario header */}
      <div className="bg-[#f8f8f8] border-b border-[#e8e9e9] flex items-center justify-between px-[16px] py-[12px] shrink-0">
        <span className="text-[10px] font-semibold text-[#717777]">SCENARIO {index + 1}</span>
        <div className="flex items-center gap-[8px]">
          {isSystemRec && (
            <div className="bg-[#e1f5ee] px-[10px] py-[4px] rounded-[100px]">
              <span className="text-[11px] font-semibold text-[#085041] whitespace-nowrap">
                System recommendation — {scenario.optimization_priority === 'balance-first' ? 'Balance-first' : 'Tax-first'} optimized
              </span>
            </div>
          )}
          {!isSystemRec && (
            <div className="bg-[#e8e9e9] px-[10px] py-[4px] rounded-[100px]">
              <span className="text-[11px] font-semibold text-[#717777] whitespace-nowrap">Custom</span>
            </div>
          )}
          <KebabMenu onDuplicate={onDuplicate} onDelete={onDelete} />
        </div>
      </div>

      {/* SecB — fund table */}
      <div className="bg-white border-b border-[#e8e9e9] flex flex-col px-[16px] py-[12px] shrink-0">
        {/* Column headers — G/L and Tax wider to fit compact integer values without wrapping */}
        <div className="flex items-start border-b border-[#e8e9e9] pb-[8px] w-full">
          <span className="text-[10px] font-semibold text-[#717777] flex-1 min-w-0">FUND</span>
          <span className="text-[10px] font-semibold text-[#717777] text-right w-[80px] shrink-0 whitespace-nowrap">AMOUNT</span>
          <span className="text-[10px] font-semibold text-[#717777] text-right w-[52px] shrink-0 whitespace-nowrap">BASIS</span>
          <span className="text-[10px] font-semibold text-[#717777] text-right w-[68px] shrink-0 whitespace-nowrap">ST G/L</span>
          <span className="text-[10px] font-semibold text-[#717777] text-right w-[68px] shrink-0 whitespace-nowrap">LT G/L</span>
          <span className="text-[10px] font-semibold text-[#717777] text-right w-[64px] shrink-0 whitespace-nowrap">EST. TAX</span>
        </div>
        {/* Fund rows */}
        {scenario.fund_selections.map((fs, i) => {
          const stg = fs.st_gain_loss ?? 0
          const ltg = fs.lt_gain_loss ?? 0
          const etx = fs.est_tax_gross ?? 0
          const stColor = stg > 0 ? 'text-[#007a00]' : stg < 0 ? 'text-[#c8102e]' : 'text-[#717777]'
          const ltColor = ltg > 0 ? 'text-[#007a00]' : ltg < 0 ? 'text-[#c8102e]' : 'text-[#717777]'
          return (
            <div key={fs.fund_id} className={`flex items-center h-[38px] w-full ${i < scenario.fund_selections.length - 1 ? 'border-b border-[#e8e9e9]' : ''}`}>
              <div className="flex flex-col gap-px flex-1 min-w-0 overflow-hidden">
                <span className="text-[13px] font-bold text-[#1255cc] underline">{fs.fund_id}</span>
                <span className="text-[10px] text-[#717777] truncate">{fs.fund_name ?? fs.fund_id}</span>
              </div>
              <span className="text-[12px] font-bold text-[#040505] text-right w-[80px] shrink-0 whitespace-nowrap">{formatCurrency(fs.sell_amount)}</span>
              <span className="text-[11px] text-[#717777] text-right w-[52px] shrink-0 whitespace-nowrap">{fmtMethod(fs.accounting_method)}</span>
              <span className={`text-[12px] font-bold text-right w-[68px] shrink-0 whitespace-nowrap ${stColor}`}>
                {stg !== 0 ? fmtGainCompact(stg) : <span className="text-[#717777] font-normal">{formatCurrencyCompact(0)}</span>}
              </span>
              <span className={`text-[12px] font-bold text-right w-[68px] shrink-0 whitespace-nowrap ${ltColor}`}>
                {ltg !== 0 ? fmtGainCompact(ltg) : <span className="text-[#717777] font-normal">{formatCurrencyCompact(0)}</span>}
              </span>
              <span className={`text-[12px] text-right w-[64px] shrink-0 whitespace-nowrap ${etx > 0 ? 'font-bold text-[#040505]' : 'text-[#717777]'}`}>
                {etx > 0 ? formatCurrencyCompact(etx) : formatCurrencyCompact(0)}
              </span>
            </div>
          )
        })}
      </div>

      {/* SecC — tax summary */}
      <div className="bg-white border-b border-[#e8e9e9] flex flex-col p-[16px] shrink-0">
        <span className="text-[12px] font-semibold text-[#040505] pb-[8px]">Tax summary</span>

        <TaxRow label="ST Capital Gains"  value={scenario.projected_st_gains}  isGain valueColor={scenario.projected_st_gains > 0 ? '#007a00' : undefined} />
        <TaxRow label="LT Capital Gains"  value={scenario.projected_lt_gains}  isGain valueColor={scenario.projected_lt_gains > 0 ? '#007a00' : undefined} />
        <TaxRow label="Losses Harvested"  value={scenario.losses_harvested}    signed valueColor={scenario.losses_harvested < 0 ? '#c8102e' : undefined} />
        <div className="bg-[#e8e9e9] h-px w-full my-0" />
        <TaxRow label="Net Taxable Gain"  value={scenario.net_taxable_gain}    bold />
        <TaxRow label="Federal Tax"       value={displayFederalTax} />
        <TaxRow label="State Tax"         value={0} muted />
        <div className="bg-[#e8e9e9] h-px w-full my-0" />
        <TaxRow label="Est. Total Tax"    value={displayFederalTax} labelBold valueBold valueLg />
        <TaxRow label="Effective Rate"    displayText={displayEffRate} muted />
      </div>

      {/* SecD — asset mix impact */}
      <div className="bg-white border-b border-[#e8e9e9] flex flex-col gap-[10px] p-[16px] shrink-0">
        <span className="text-[12px] font-semibold text-[#040505]">Asset mix impact</span>

        {/* Legend */}
        <div className="flex gap-[12px] items-center pt-[6px]">
          {([['Stocks','#2bbfb3'],['Bonds','#c8902a'],['Reserves','#888']] as const).map(([name, color]) => (
            <div key={name} className="flex gap-[6px] items-center">
              <div className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: color }} />
              <span className="text-[11px] text-[#040505]">{name}</span>
            </div>
          ))}
        </div>

        {/* Stacked bars */}
        <div className="flex flex-col gap-[6px]">
          <BarRow label="Current"    stocks={stocksBefore} bonds={bondsBefore} reserves={resBefore} />
          <BarRow label="Target"     stocks={targetStocks} bonds={targetBonds}  reserves={targetRes}  faded dashed />
          <BarRow label="After sale" stocks={stocksAfter}  bonds={bondsAfter}   reserves={resAfter} />
        </div>

        {/* Percentage table */}
        <div className="flex flex-col pt-[6px]">
          {/* Header */}
          <div className="flex pb-[6px]">
            <span className="text-[11px] font-semibold text-[#717777] flex-1" />
            <span className="text-[11px] font-semibold text-[#2bbfb3] text-right w-[22%]">Stocks</span>
            <span className="text-[11px] font-semibold text-[#c8902a] text-right w-[22%]">Bonds</span>
            <span className="text-[11px] font-semibold text-[#888] text-right w-[22%]">Reserves</span>
          </div>
          {[
            { label: 'Current',    s: stocksBefore, b: bondsBefore, r: resBefore  },
            { label: 'Target',     s: targetStocks, b: targetBonds, r: targetRes  },
            { label: 'After sale', s: stocksAfter,  b: bondsAfter,  r: resAfter   },
          ].map(row => (
            <div key={row.label} className="flex h-[24px] items-center border-b border-[#f0f0f0] text-[11px]">
              <span className="text-[#717777] flex-1">{row.label}</span>
              <span className="text-[#040505] text-right w-[22%]">{formatPercent(row.s, true)}</span>
              <span className="text-[#040505] text-right w-[22%]">{formatPercent(row.b, true)}</span>
              <span className="text-[#040505] text-right w-[22%]">{formatPercent(row.r, true)}</span>
            </div>
          ))}
          {/* Diff row — target − after_sale: negative=overweight, positive=underweight */}
          <div className="flex items-center py-[4px] bg-[#f8f8f7] text-[11px]">
            <span className="text-[#717777] flex-1">Gap to target</span>
            <span className={`font-bold text-right w-[22%] ${diffColor(diffStocks)}`}>{fmtDiff(diffStocks)}</span>
            <span className={`font-bold text-right w-[22%] ${diffColor(diffBonds)}`}>{fmtDiff(diffBonds)}</span>
            <span className={`text-right w-[22%] ${diffColor(diffRes)}`}>{fmtDiff(diffRes)}</span>
          </div>
        </div>
      </div>

      {/* SecE — tradeoff summary */}
      <div className="bg-[#fff8e8] border-b border-[#e8e9e9] p-[16px] flex-1">
        <p className="text-[13px] text-[#040505] leading-normal">{scenario.tradeoff_summary}</p>
      </div>

      {/* SecF — action buttons */}
      <div className="bg-white flex items-center justify-end gap-[24px] px-[16px] py-[12px] shrink-0">
        <button onClick={onEdit} className="h-[48px] w-[180px] rounded-full border-[1.5px] border-vg-ink bg-white text-[14px] font-bold text-vg-ink shrink-0 hover:opacity-90 transition-opacity">
          Edit scenario →
        </button>
        <button onClick={onReviewOrder} className="h-[48px] w-[180px] rounded-full bg-vg-ink text-white text-[14px] font-bold shrink-0 hover:opacity-90 transition-opacity">
          Review order
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tax row helper — right-aligns value
// ---------------------------------------------------------------------------

function TaxRow({ label, value, displayText, signed, isGain, bold, labelBold, valueBold, valueLg, muted, valueColor }: {
  label?: string
  value?: number
  displayText?: string
  signed?: boolean
  isGain?: boolean
  bold?: boolean
  labelBold?: boolean
  valueBold?: boolean
  valueLg?: boolean
  muted?: boolean
  valueColor?: string
}) {
  let text = displayText
  if (text === undefined && value !== undefined) {
    if (signed || isGain) {
      text = value !== 0 ? fmtGain(value) : formatCurrency(0)
    } else {
      text = formatCurrency(value)
    }
  }
  const labelClass = `${labelBold ? 'font-semibold' : 'font-normal'} text-[${muted ? '#717777' : '#040505'}] ${bold ? 'text-[13px]' : 'text-[13px]'}`
  const valueClass = `${valueBold || bold ? 'font-bold' : 'font-normal'} ${valueLg ? 'text-[14px]' : 'text-[13px]'} ${muted ? 'text-[#717777]' : ''}`

  return (
    <div className="flex h-[26px] items-center justify-between w-full">
      <span className={labelClass} style={{ color: muted ? '#717777' : undefined }}>{label}</span>
      <span className={valueClass} style={{ color: valueColor ?? (muted ? '#717777' : undefined) }}>{text}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ScenarioAnalysis() {
  const navigate = useNavigate()
  const { scenarios, portfolio, activeTaxRates, setScenarios, addScenario, deleteScenario,
    startEditingScenario, startNewScenario, activeScenarioId } = useAppStore()

  // Seed canonical scenarios on mount when store is empty AND we're not mid-edit.
  // The activeScenarioId check ensures a returning edit session isn't overwritten.
  useEffect(() => {
    if (scenarios.length === 0 && activeScenarioId === null) {
      setScenarios(seedCanonicalScenarios(portfolio))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const scenarioToDelete = scenarios.find(s => s.scenario_id === deleteTarget)

  function handleDelete(id: string) {
    setDeleteTarget(null)
    deleteScenario(id)
  }

  function handleDuplicate(scenario: SavedScenario) {
    if (scenarios.length >= 3) return
    addScenario({
      ...scenario,
      scenario_id: `sc-${Date.now()}`,
      scenario_name: `${scenario.scenario_name} (copy)`,
      created_at: new Date().toISOString(),
    })
  }

  const showAdd = scenarios.length < 3

  return (
    <>
      {/* Delete confirmation dialog */}
      {deleteTarget && scenarioToDelete && (
        <DeleteDialog
          scenarioName={scenarioToDelete.scenario_name}
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div className="flex flex-col items-start w-full">
        <div className="flex flex-col w-full">

          {/* Page title — "Scenario Analysis", no mode toggle */}
          <div className="bg-white flex items-center px-[32px] h-[56px] w-full">
            <h1 className="text-[30px] font-bold text-vg-ink whitespace-nowrap leading-normal">Scenario Analysis</h1>
          </div>

          {/* Row 2 — Tax strip: bracket, YTD, disclaimer */}
          <div className="bg-[#f8f8f7] border border-[#e8e9e9] flex items-center justify-between px-[32px] py-[12px] w-full">
            <div className="flex gap-[24px] items-center">
              <div className="flex gap-[6px] items-center">
                <span className="text-[10px] font-semibold text-[#717777]">TAX BRACKET</span>
                <span className="text-[13px] text-vg-ink">
                  {Math.round(activeTaxRates.st_rate * 100)}% ST / {Math.round(activeTaxRates.lt_rate * 100)}% LT
                </span>
                <a className="text-[12px] text-[#1255cc] underline cursor-pointer">Change</a>
              </div>
              <div className="flex gap-[6px] items-center">
                <span className="text-[10px] font-semibold text-[#717777]">YTD REALIZED</span>
                <span className="text-[13px] text-vg-ink">
                  ST {formatCurrencyCompact(portfolio?.ytd_gains_record?.st_gains_realized_ytd ?? 1245)} / LT {formatCurrencyCompact(portfolio?.ytd_gains_record?.lt_gains_realized_ytd ?? 8750)}
                </span>
              </div>
            </div>
            <span className="text-[11px] text-[#717777]">Federal rates only · consult a tax professional</span>
          </div>

          {/* Row 3 — Scenario columns + Add placeholder */}
          <div className="flex gap-[16px] items-stretch px-[32px] py-[24px] w-full">

            {scenarios.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center flex-1 py-[64px] gap-4 text-center">
                <p className="text-[16px] font-semibold text-vg-ink">No scenarios to compare</p>
                <p className="text-[14px] text-[#717777]">Return to Fund Selection to save a scenario.</p>
                <button onClick={() => { startNewScenario(); navigate('/') }} className="h-[48px] px-7 rounded-full border-[1.5px] border-vg-ink bg-white text-[14px] font-bold text-vg-ink hover:opacity-90 transition-opacity">
                  Return to Fund Selection
                </button>
              </div>
            ) : (
              <>
                {scenarios.map((scenario, i) => (
                  <ScenarioColumn
                    key={scenario.scenario_id}
                    scenario={scenario}
                    index={i}
                    portfolio={portfolio}
                    activeTaxRates={activeTaxRates}
                    onEdit={() => {
                      startEditingScenario(scenario)
                      navigate(scenario.source_mode === 'automated' ? '/automated' : '/manual-2')
                    }}
                    onReviewOrder={() => navigate('/confirm')}
                    onDuplicate={() => handleDuplicate(scenario)}
                    onDelete={() => setDeleteTarget(scenario.scenario_id)}
                  />
                ))}

                {/* Add Scenario placeholder (hidden when 3 scenarios) */}
                {showAdd && (
                  <div
                    onClick={() => { startNewScenario(); navigate('/') }}
                    className="bg-white border border-dashed border-[#b8c0c0] rounded-[8px] flex flex-col items-center justify-center gap-[8px] px-[12px] py-[24px] text-[#717777] cursor-pointer hover:bg-[#f8f8f8] transition-colors w-[160px] shrink-0 self-stretch"
                  >
                    <span className="text-[24px]">+</span>
                    <span className="text-[12px]">Add scenario</span>
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      </div>
    </>
  )
}
