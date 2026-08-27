import { useState, useCallback, useEffect, useMemo } from 'react'
import { formatCurrency, formatShares, formatPercent, accountAllocStr } from '../utils/format'
import { useNavigate, useLocation } from 'react-router-dom'
import { Sparkles, PenLine, ChevronDown, ChevronUp, Clock } from 'lucide-react'
import { useModeToggleGuard, SaveDiscardDialog } from '../components/ModeToggleGuard'
import { CostBasisDialog } from '../components/CostBasisDialog'
import { CoachMark } from '../components/CoachMark'
import { TargetAllocationModal } from '../components/TargetAllocationModal'
import { useAppStore } from '../store/useAppStore'
import { runOptimization, shortAssetClass } from '../engine/index'
import type { CostBasisMethod, Lot as CanonicalLot } from '../types'
import { toAccountingMethod } from '../utils/methods'
import { buildScenarioFromFundResults, isDuplicateScenario } from '../utils/scenarioBuilder'

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? 'border-vg-ink' : 'border-vg-ink-muted'}`}>
      {selected && <div className="w-2 h-2 rounded-full bg-vg-ink" />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Canonical lot data (from pm/08-sample-dataset.json — never recalled from memory)
// NAV: VTSAX $145.20, VBTLX $9.18
// ---------------------------------------------------------------------------

type Lot = {
  lotId: string
  acquisitionDate: string   // display format MM/DD/YYYY
  shares: number
  costPerShare: number
  totalCost: number
  currentValue: number
  gainLoss: number          // unrealized_gain_loss
  gainLossPerShare: number  // nav - costPerShare
  holdingPeriod: 'LT' | 'ST'
  waitAndSave?: {
    daysUntilLT: number
    ltConversionDate: string
    savingsAmount: string
    noticeText: string
  }
}

/** Convert canonical Lot (from store) to local display Lot type */
function toDisplayLot(l: CanonicalLot): Lot {
  const [y, m, d] = l.acquisition_date.split('-')
  const acqDisplay = `${m}/${d}/${y}`
  const gainPerShare = l.current_nav - l.cost_basis_per_share
  return {
    lotId: l.lot_id,
    acquisitionDate: acqDisplay,
    shares: l.shares,
    costPerShare: l.cost_basis_per_share,
    totalCost: l.total_cost_basis,
    currentValue: l.current_value,
    gainLoss: l.unrealized_gain_loss,
    gainLossPerShare: Math.round(gainPerShare * 100) / 100,
    holdingPeriod: l.holding_period,
    waitAndSave: l.wait_and_save_flag && l.wait_and_save_detail ? {
      daysUntilLT: l.wait_and_save_detail.days_until_lt,
      ltConversionDate: l.wait_and_save_detail.lt_conversion_date,
      savingsAmount: formatCurrency(l.wait_and_save_detail.estimated_tax_savings_by_waiting),
      noticeText: `Your estimated federal tax will be reduced by ${formatCurrency(l.wait_and_save_detail.estimated_tax_savings_by_waiting)}, if you wait until this lot converts to a long-term holding. This lot converts to a long-term holding in ${l.wait_and_save_detail.days_until_lt} days.`,
    } : undefined,
  }
}

function fmtSigned(n: number): string {
  return (n >= 0 ? '+' : '−') + formatCurrency(Math.abs(n))
}
// 2-decimal rate for effective rate display (Intl, no toFixed)
function fmtRate2(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

// ---------------------------------------------------------------------------
// Lot Detail Header (Figma 376:4775 — bg-[#f0f0f0], 36px)
// ---------------------------------------------------------------------------

function LotDetailHeader() {
  return (
    <div className="flex h-9 items-center overflow-clip px-3 w-full bg-[#f0f0f0] shrink-0">
      <div className="w-[220px] flex items-center justify-between pr-2 shrink-0 h-full">
        <span className="text-[12px] font-semibold text-vg-ink-muted">Shares to sell</span>
      </div>
      <div className="flex-1 min-w-px" />
      <div className="w-[100px] flex items-center justify-end gap-0.5 shrink-0 h-full">
        <span className="text-[12px] font-semibold text-vg-ink-muted text-right whitespace-nowrap">Shares owned</span>
        <span className="text-[10px] text-vg-ink-muted">⇅</span>
      </div>
      <div className="flex-1 min-w-px" />
      <div className="w-[120px] flex items-center justify-end gap-0.5 shrink-0 h-full">
        <span className="text-[12px] font-semibold text-vg-ink-muted text-right whitespace-nowrap">Total cost</span>
        <span className="text-[10px] text-vg-ink-muted">⇅</span>
      </div>
      <div className="flex-1 min-w-px" />
      <div className="w-[160px] flex items-center justify-end gap-0.5 shrink-0 h-full">
        <span className="text-[12px] font-semibold text-vg-ink-muted text-right whitespace-nowrap overflow-hidden text-ellipsis">Est. gain/loss (per share)</span>
        <span className="text-[10px] text-vg-ink-muted">⇅</span>
      </div>
      <div className="flex-1 min-w-px" />
      <div className="w-[150px] flex items-center justify-end gap-0.5 shrink-0 h-full">
        <span className="text-[12px] font-semibold text-vg-ink-muted text-right whitespace-nowrap">Est. available proceeds</span>
        <span className="text-[10px] text-vg-ink-muted">⇅</span>
      </div>
      <div className="flex-1 min-w-px" />
      <div className="w-[120px] flex items-center gap-0.5 shrink-0 h-full">
        <span className="text-[12px] font-semibold text-vg-ink-muted whitespace-nowrap">Date acquired</span>
        <span className="text-[10px] text-vg-ink-muted">⇅</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section header for LT / ST groupings
// ---------------------------------------------------------------------------

function LotSectionHeader({ label, showViewDefs }: { label: string; showViewDefs: boolean }) {
  return (
    <div className="flex h-9 items-center justify-between overflow-clip w-full shrink-0 whitespace-nowrap">
      <span className="text-[13px] font-semibold text-vg-ink">{label}</span>
      <a className={`text-[12px] underline cursor-pointer pr-3 ${showViewDefs ? 'text-[#1255cc]' : 'text-transparent'}`}>View definitions</a>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Normal Lot Row (bg-[#fafafa], 48px)
// ---------------------------------------------------------------------------

function NormalLotRow({ lot, sharesInput, onSharesChange, onSharesCommit, readOnly, readOnlyShares }:
  { lot: Lot; sharesInput: string; onSharesChange: (v: string) => void; onSharesCommit: (v: string) => void
    readOnly?: boolean; readOnlyShares?: string }) {
  const isGain = lot.gainLoss >= 0
  const glColor = isGain ? 'text-[#007a00]' : 'text-[#c8102e]'

  return (
    <div className="flex h-12 items-center overflow-clip px-3 w-full bg-[#fafafa] border-b border-[#e8e9e9] shrink-0">
      {/* Shares to sell — 220px: input+All (interactive) or bold text (read-only) */}
      <div className="w-[220px] flex items-center shrink-0 h-full">
        {readOnly ? (
          <span className="w-[120px] px-3 text-[14px] font-bold text-[#040505] whitespace-nowrap">
            {readOnlyShares ?? '0.000'}
          </span>
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              value={sharesInput}
              onChange={e => onSharesChange(e.target.value.replace(/[^\d.]/g, ''))}
              onBlur={e => onSharesCommit(e.target.value.replace(/[^\d.]/g, ''))}
              onKeyDown={e => e.key === 'Enter' && onSharesCommit((e.target as HTMLInputElement).value.replace(/[^\d.]/g, ''))}
              className="w-[120px] h-[28px] px-3 border border-vg-ink rounded-[4px] text-[14px] text-vg-ink text-right bg-white focus:outline-none focus:ring-2 focus:ring-vg-ink/20"
            />
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none ml-2"
              onClick={() => {
                const isAll = parseFloat(sharesInput) >= lot.shares - 0.001
                onSharesCommit(isAll ? '0' : String(lot.shares))
              }}
            >
              <div className={`w-[13px] h-[13px] border rounded-[2px] shrink-0 flex items-center justify-center
                ${parseFloat(sharesInput) >= lot.shares - 0.001
                  ? 'bg-vg-ink border-vg-ink'
                  : 'bg-white border-vg-ink'}`}
              >
                {parseFloat(sharesInput) >= lot.shares - 0.001 && (
                  <span className="text-white text-[9px] leading-none font-bold">✓</span>
                )}
              </div>
              <span className="text-[12px] text-vg-ink whitespace-nowrap">All</span>
            </label>
          </>
        )}
      </div>
      <div className="flex-1 min-w-px" />
      {/* Shares owned — 100px */}
      <div className="w-[100px] flex items-center justify-end shrink-0 h-full">
        <span className="text-[12px] text-vg-ink whitespace-nowrap">{formatShares(lot.shares)}</span>
      </div>
      <div className="flex-1 min-w-px" />
      {/* Total cost — 120px */}
      <div className="w-[120px] flex items-center justify-end shrink-0 h-full">
        <span className="text-[12px] text-vg-ink whitespace-nowrap">{formatCurrency(lot.totalCost)}</span>
      </div>
      <div className="flex-1 min-w-px" />
      {/* Est. gain/loss (per share) — 160px: two lines */}
      <div className="w-[160px] flex flex-col items-end justify-center gap-[3px] shrink-0 h-full py-1.5">
        <div className="flex items-center gap-1">
          <span className={`text-[12px] font-bold ${glColor}`}>{isGain ? '↑' : '↓'}</span>
          <span className={`text-[12px] font-bold ${glColor} whitespace-nowrap`}>{formatCurrency(Math.abs(lot.gainLoss))}</span>
        </div>
        <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">({formatCurrency(Math.abs(lot.gainLossPerShare))})</span>
      </div>
      <div className="flex-1 min-w-px" />
      {/* Est. available proceeds — 150px */}
      <div className="w-[150px] flex items-center justify-end shrink-0 h-full">
        <span className="text-[12px] text-vg-ink whitespace-nowrap">{formatCurrency(lot.currentValue)}</span>
      </div>
      <div className="flex-1 min-w-px" />
      {/* Date acquired — 120px */}
      <div className="w-[120px] flex items-center shrink-0 h-full">
        <span className="text-[12px] text-vg-ink whitespace-nowrap">{lot.acquisitionDate}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wait & Save Lot Row (bg-[#fff8e8], amber left accent, inline notice)
// ---------------------------------------------------------------------------

function WaitSaveLotRow({ lot, sharesInput, onSharesChange, onSharesCommit, showHint, readOnly, readOnlyShares }:
  { lot: Lot; sharesInput: string; onSharesChange: (v: string) => void; onSharesCommit: (v: string) => void
    showHint: boolean; readOnly?: boolean; readOnlyShares?: string }) {
  const ws = lot.waitAndSave!

  return (
    <div className="flex w-full bg-[#fff8e8] border-b border-[#e8e9e9] shrink-0">
      {/* Amber left accent — #ffad00, 4px wide, full height */}
      <div className="bg-[#ffad00] w-1 self-stretch shrink-0" />

      <div className="flex flex-col flex-1 pb-2">
        {/* Lot data row — same columns as NormalLotRow */}
        <div className="flex h-12 items-center overflow-clip px-2 w-full">
          <div className="w-[220px] flex items-center shrink-0 h-full">
            {readOnly ? (
              <span className="w-[120px] px-3 text-[14px] font-bold text-[#040505] whitespace-nowrap">
                {readOnlyShares ?? '0.000'}
              </span>
            ) : (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  value={sharesInput}
                  onChange={e => onSharesChange(e.target.value.replace(/[^\d.]/g, ''))}
                  onBlur={e => onSharesCommit(e.target.value.replace(/[^\d.]/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && onSharesCommit((e.target as HTMLInputElement).value.replace(/[^\d.]/g, ''))}
                  className="w-[120px] h-[28px] px-3 border border-vg-ink rounded-[4px] text-[14px] text-vg-ink text-right bg-white focus:outline-none focus:ring-2 focus:ring-vg-ink/20"
                />
                <label
                  className="flex items-center gap-1.5 cursor-pointer select-none ml-2"
                  onClick={() => {
                    const isAll = parseFloat(sharesInput) >= lot.shares - 0.001
                    onSharesCommit(isAll ? '0' : String(lot.shares))
                  }}
                >
                  <div className={`w-[13px] h-[13px] border rounded-[2px] shrink-0 flex items-center justify-center
                    ${parseFloat(sharesInput) >= lot.shares - 0.001
                      ? 'bg-vg-ink border-vg-ink'
                      : 'bg-white border-vg-ink'}`}
                  >
                    {parseFloat(sharesInput) >= lot.shares - 0.001 && (
                      <span className="text-white text-[9px] leading-none font-bold">✓</span>
                    )}
                  </div>
                  <span className="text-[12px] text-vg-ink whitespace-nowrap">All</span>
                </label>
              </>
            )}
          </div>
          <div className="flex-1 min-w-px" />
          <div className="w-[100px] flex items-center justify-end shrink-0 h-full">
            <span className="text-[12px] text-vg-ink whitespace-nowrap">{formatShares(lot.shares)}</span>
          </div>
          <div className="flex-1 min-w-px" />
          <div className="w-[120px] flex items-center justify-end shrink-0 h-full">
            <span className="text-[12px] text-vg-ink whitespace-nowrap">{formatCurrency(lot.totalCost)}</span>
          </div>
          <div className="flex-1 min-w-px" />
          <div className="w-[160px] flex flex-col items-end justify-center gap-[3px] shrink-0 h-full py-1.5">
            <div className="flex items-center gap-1">
              <span className="text-[12px] font-bold text-[#007a00]">↑</span>
              <span className="text-[12px] font-bold text-[#007a00] whitespace-nowrap">{formatCurrency(lot.gainLoss)}</span>
            </div>
            <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">({formatCurrency(Math.abs(lot.gainLossPerShare))})</span>
          </div>
          <div className="flex-1 min-w-px" />
          <div className="w-[150px] flex items-center justify-end shrink-0 h-full">
            <span className="text-[12px] text-vg-ink whitespace-nowrap">{formatCurrency(lot.currentValue)}</span>
          </div>
          <div className="flex-1 min-w-px" />
          <div className="w-[120px] flex items-center shrink-0 h-full">
            <span className="text-[12px] text-vg-ink whitespace-nowrap">{lot.acquisitionDate}</span>
          </div>
        </div>

        {/* Wait & Save inline notice */}
        <div className="flex items-center gap-2.5 px-2.5 pb-1">
          <span className="text-[14px] font-bold text-[#ffad00] shrink-0">⚠</span>
          <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">Wait &amp; Save opportunity</span>
          <p className="text-[12px] text-vg-ink flex-1">{ws.noticeText}</p>
          {showHint && (
            <CoachMark id="ws" text={`This lot will qualify for the lower long-term capital gains rate in ${ws.daysUntilLT} days. Selling it now costs more in estimated tax than waiting.`} />
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapsed active fund row — shown for the OTHER active fund when one is
// expanded into lot detail. Same 96px structure as FS-MAN-2 (64px main +
// 32px details) but "Lot details ▾" navigates to /manual-lot with that fund.
// Matches Figma FS-MAN-LOT: 388:2534 (VBTLX at y=777, 96px when VTSAX expanded)
// ---------------------------------------------------------------------------

type CollapsedActiveFundData = {
  ticker: string; fullName: string; shares: string; balance: string
  sellAmount: string
  estSTGains: string; estSTColor: string
  estLTGains: string; estLTColor: string
  estTax: string
  impact: string; impactColor: string
  rationale: string
  waitAndSave?: string
}

function CollapsedActiveFundRow({ fund, onLotDetails, displayMethod, onEditClick }: {
  fund: CollapsedActiveFundData
  onLotDetails: (ticker: string) => void
  displayMethod: CostBasisMethod
  onEditClick: () => void
}) {
  return (
    <div className="flex flex-col border-b border-[#e8e9e9] w-full bg-white">
      {/* Main Row — 64px */}
      <div className="flex h-16 items-center overflow-hidden px-3 w-full bg-white">
        <div className="w-[280px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
          <span className="text-[12px] text-vg-ink-muted truncate">{fund.fullName}</span>
          <a className="text-[14px] font-bold text-[#1255cc] underline whitespace-nowrap">{fund.ticker}</a>
        </div>
        <div className="w-[140px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
          <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">{fund.shares} shares</span>
          <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{fund.balance}</span>
        </div>
        <div className="w-[128px] h-full flex flex-col justify-center gap-[2px] px-1 shrink-0 overflow-hidden">
          <div className="w-[120px] h-[28px] px-3 border border-vg-ink rounded-[4px] bg-white flex items-center">
            <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{fund.sellAmount}</span>
          </div>
        </div>
        <div className="w-[130px] h-full flex items-center gap-2 px-2 shrink-0 overflow-hidden">
          <div className="w-4 h-4 border-[1.5px] border-[#767676] rounded-[2px] shrink-0 bg-white" />
          <span className="text-[12px] text-vg-ink whitespace-nowrap">Sell all shares</span>
        </div>
        <div className="w-[160px] h-full flex flex-col justify-center gap-1 px-2 shrink-0 overflow-hidden">
          <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">COST BASIS METHOD</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{displayMethod}</span>
            <a className="text-[14px] text-[#1255cc] underline cursor-pointer whitespace-nowrap" onClick={onEditClick}>Edit</a>
          </div>
        </div>
        <div className="w-[95px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0">
          <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. ST GAINS</span>
          <span className={`text-[14px] font-bold whitespace-nowrap ${fund.estSTColor}`}>{fund.estSTGains}</span>
        </div>
        <div className="w-[95px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0">
          <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. LT GAINS</span>
          <span className={`text-[14px] font-bold whitespace-nowrap ${fund.estLTColor}`}>{fund.estLTGains}</span>
        </div>
        <div className="w-[85px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0">
          <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. TAX</span>
          <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{fund.estTax}</span>
        </div>
        <div className="w-[110px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0">
          <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">IMPACT</span>
          <span className={`text-[12px] font-semibold whitespace-nowrap ${fund.impactColor}`}>{fund.impact}</span>
        </div>
        <div className="flex flex-1 h-full items-center justify-end px-2">
          <button className="h-[36px] w-[90px] rounded-full border-[1.5px] border-vg-ink bg-white text-[14px] font-bold text-vg-ink shrink-0 hover:opacity-90">Cancel</button>
        </div>
      </div>
      {/* Details Row — 32px */}
      <div className="flex h-8 items-center justify-between px-4 w-full bg-white">
        <div className="flex items-center gap-[5px]">
          <p className="text-[13px] italic text-vg-ink-muted">{fund.rationale}</p>
          {fund.waitAndSave && (
            <span className="flex items-center gap-1 px-2 py-[2px] rounded-full bg-[#e07000]">
              <span className="text-[9px] font-bold text-white tracking-[0.36px] whitespace-nowrap">WAIT &amp; SAVE {fund.waitAndSave}</span>
            </span>
          )}
        </div>
        <button onClick={() => onLotDetails(fund.ticker)} className="flex items-center gap-1 cursor-pointer shrink-0 hover:opacity-70">
          <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">Lot details</span>
          <span className="text-vg-ink-muted text-base leading-none">▾</span>
        </button>
      </div>
    </div>
  )
}

// Inactive fund row for non-active funds below the active section
function InactiveFundRowLOT({ ticker, fullName, shares, balance }: {
  ticker: string; fullName: string; shares: string; balance: string
}) {
  return (
    <div className="flex h-16 items-center overflow-hidden px-3 w-full border-b border-[#e8e9e9] bg-[#fafafa]">
      <div className="w-[280px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
        <span className="text-[12px] text-vg-ink-muted truncate">{fullName}</span>
        <a className="text-[14px] font-bold text-[#1255cc] underline whitespace-nowrap">{ticker}</a>
      </div>
      <div className="w-[140px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
        <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">{shares} shares</span>
        <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{balance}</span>
      </div>
      <div className="w-[128px] h-full shrink-0" /><div className="w-[130px] h-full shrink-0" />
      <div className="w-[160px] h-full shrink-0" /><div className="w-[95px] h-full shrink-0" />
      <div className="w-[95px] h-full shrink-0" /><div className="w-[85px] h-full shrink-0" />
      <div className="w-[110px] h-full shrink-0" />
      <div className="flex flex-1 h-full items-center justify-end px-2">
        <button className="h-[36px] w-[90px] rounded-full border-[1.5px] border-vg-ink bg-white text-[14px] font-bold text-vg-ink shrink-0 hover:opacity-90">Sell</button>
      </div>
    </div>
  )
}

function fmtPct1(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r2(n: number) { return Math.round(n * 100) / 100 }

interface LotBannerData {
  totalSale: number
  salePct: number
  stGainLoss: number
  ltGainLoss: number
  estNetTax: number
  effRate: number
  // Totals row fields
  totalShares: number
  totalCost: number
  pricePerShare: number
  priceDate: string
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function FundSelectionManualLot() {
  const navigate = useNavigate()
  const location = useLocation()
  const { portfolio, activeAccountId, activeTaxRates, optimizationPriority, setManualConfig,
    manualConfig, manualAppliedAmountsCents, manualActiveFundIds, manualCostBasisMethods, setManualCostBasisMethod,
    manualLotSelections, setManualLotSelections,
    scenarios, addScenario, updateScenario, activeScenarioId, setActiveScenarioId } = useAppStore()
  const locationState = location.state as { fund?: string } | null
  const fund          = locationState?.fund ?? 'VTSAX'
  const [bannerData, setBannerData] = useState<LotBannerData | null>(null)

  // Always show 3 decimal places in read-only share cells (matches Figma "0.000" / "103.306")
  function fmtLotShares(n: number): string {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n)
  }

  // Cost basis for the expanded fund row — always initialized from the Zustand store
  // (single source of truth). Navigation state is NOT used because it can be stale or
  // absent when navigating via CollapsedActiveFundRow's Lot details link.
  const [expandedMethod,  setExpandedMethod]  = useState<CostBasisMethod>(
    manualCostBasisMethods[fund] ?? 'MinTax'
  )
  const [showExpandedCBD, setShowExpandedCBD] = useState(false)

  // Re-sync method state when `fund` changes via same-route navigation
  // (/manual-lot → /manual-lot). React Router reuses the component instance so
  // useState initializers don't re-run — this effect keeps them in sync with the store.
  useEffect(() => {
    const otherFund = fund === 'VTSAX' ? 'VBTLX' : 'VTSAX'
    setExpandedMethod(manualCostBasisMethods[fund]       ?? 'MinTax')
    setCollapsedMethod(manualCostBasisMethods[otherFund] ?? 'MinTax')
    setBannerData(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fund])

  // isReadOnly derived from CURRENT method — updates live when user changes method
  const isReadOnly = expandedMethod !== 'SpecID'

  // Build lot→shares map from engine output (used in read-only view)
  const lotSharesMap = useMemo<Map<string, number>>(() => {
    if (!isReadOnly || !manualConfig) return new Map()
    const fr = manualConfig.fund_results.find(r => r.fund_id === fund)
    if (!fr) return new Map()
    return new Map(fr.lots_sold.map(ls => [ls.lot_id, ls.shares_to_sell]))
  }, [isReadOnly, manualConfig, fund])

  // Derive lots from store portfolio (single source of truth — no hardcoded arrays)
  const taxableAcct = portfolio?.accounts.find(a => a.account_id === activeAccountId)
  const iraAcct     = portfolio?.accounts.find(a => a.account_type === 'traditional_IRA')
  const rothAcct    = portfolio?.accounts.find(a => a.account_type === 'roth_IRA')
  const holding = taxableAcct?.holdings.find(h => h.fund_id === fund)
  const lots: Lot[] = (holding?.lots ?? []).map(toDisplayLot)

  // Handle method change in lot view: persist to store, re-run engine, update display
  function handleExpandedMethodChange(newMethod: CostBasisMethod) {
    setExpandedMethod(newMethod)
    setShowExpandedCBD(false)
    setManualCostBasisMethod(fund, newMethod)

    if (newMethod !== 'SpecID') {
      const sellAmountCents = manualAppliedAmountsCents[fund] ?? 0
      if (sellAmountCents > 0 && portfolio) {
        const sellDollars = Math.round(sellAmountCents) / 100
        const result = runOptimization({
          portfolio,
          targetSaleAmount: sellDollars,
          activeAccountId,
          mode: 'manual',
          optimizationPriority,
          activeTaxRates,
          manualSelections: {
            fund_selections: [{ fund_id: fund, accounting_method: toAccountingMethod(newMethod) }],
          },
        })
        const config = result as import('../types').ManualConfiguration
        setManualConfig(config)

        // Derive bannerData from engine result so fund row tax figures update immediately
        const fr = config.fund_results.find(r => r.fund_id === fund)
        if (fr) {
          const stg = fr.est_st_gain_loss, ltg = fr.est_lt_gain_loss
          const netGain = Math.max(0, r2(stg + ltg))
          const taxST   = Math.min(netGain, Math.max(0, stg)) * activeTaxRates.st_rate
          const taxLT   = Math.max(0, netGain - Math.min(netGain, Math.max(0, stg))) * activeTaxRates.lt_rate
          const estNetTax = r2(taxST + taxLT)
          const totalSale = fr.sell_amount
          setBannerData({
            totalSale,
            salePct:       r2((totalSale / portfolio.total_investable_balance) * 100),
            stGainLoss:    stg,
            ltGainLoss:    ltg,
            estNetTax,
            effRate:       totalSale > 0 ? r2((estNetTax / totalSale) * 100) : 0,
            totalShares:   fr.lots_sold.reduce((s, l) => s + l.shares_to_sell, 0),
            totalCost:     fr.lots_sold.reduce((s, l) => s + l.cost_basis, 0),
            pricePerShare: holding?.lots[0]?.current_nav ?? 0,
            priceDate:     '05/27/2026',
          })
        }
      }
    } else {
      // SpecID: seed lot inputs from engine's current selection so results stay stable
      const fr = manualConfig?.fund_results.find(r => r.fund_id === fund)
      if (fr && fr.lots_sold.length > 0) {
        const prePopulated: Record<string, string> = {}
        for (const lot of lots) {
          const ls = fr.lots_sold.find(s => s.lot_id === lot.lotId)
          prePopulated[lot.lotId] = ls ? ls.shares_to_sell.toFixed(3) : '0.000'
        }
        setSharesInputs(prePopulated)
        setManualLotSelections(fund, prePopulated)
        runLotEngine(prePopulated)
      } else {
        setBannerData(null)
      }
    }
  }

  // Mode toggle guard — hasAmounts always true on this screen (only reachable from FS-MAN-2
  // which requires active fund rows with applied amounts)
  const { showDialog: showModeDialog, handleToggleClick, handleSave, handleDiscard, handleClose } =
    useModeToggleGuard(true)

  // Modal state
  const [showAllocModal,  setShowAllocModal]  = useState(false)
  // Cost basis for the collapsed other-fund row — read from store, not hardcoded
  const [collapsedMethod, setCollapsedMethod] = useState<CostBasisMethod>(
    manualCostBasisMethods[fund === 'VTSAX' ? 'VBTLX' : 'VTSAX'] ?? 'MinTax'
  )
  const [showCollapsedCBD, setShowCollapsedCBD] = useState(false)

  // Per-lot shares input state — seeded from persisted store selections when available.
  // Falls back to hardcoded T-VTSAX-09 pre-population only when no prior selection exists.
  const [sharesInputs, setSharesInputs] = useState<Record<string, string>>(() => {
    const stored = manualLotSelections[fund]
    if (stored && Object.keys(stored).length > 0) return stored
    const init: Record<string, string> = {}
    for (const lot of lots) {
      init[lot.lotId] = '0.000'
    }
    return init
  })

  // runLotEngine — called on blur/Enter on any lot share input.
  // Builds SpecID selections from sharesInputs and calls runOptimization().
  const runLotEngine = useCallback((inputs: Record<string, string>) => {
    if (!portfolio) return
    const lotOverrides = Object.entries(inputs)
      .filter(([, v]) => parseFloat(v) > 0)
      .map(([lotId, v]) => ({ lot_id: lotId, shares: parseFloat(v) }))
    if (lotOverrides.length === 0) { setBannerData(null); return }

    // Compute banner + totals row values directly from lot selections (SpecID — exact lots known)
    let stGainLoss = 0, ltGainLoss = 0, totalSale = 0, totalShares = 0, totalCost = 0
    let pricePerShare = 0, priceDate = ''
    for (const o of lotOverrides) {
      const lot = holding?.lots.find(l => l.lot_id === o.lot_id)
      if (!lot) continue
      const proceeds = o.shares * lot.current_nav
      const partialCost = (o.shares / lot.shares) * lot.total_cost_basis
      const gainLoss = r2(proceeds - partialCost)
      if (lot.holding_period === 'ST') stGainLoss = r2(stGainLoss + gainLoss)
      else ltGainLoss = r2(ltGainLoss + gainLoss)
      totalSale = r2(totalSale + proceeds)
      totalShares = r2(totalShares + o.shares)
      totalCost = r2(totalCost + partialCost)
      pricePerShare = lot.current_nav
    }
    priceDate = '05/27/2026' // canonical portfolio reference date
    const netGain = Math.max(0, r2(stGainLoss + ltGainLoss))
    const taxST = Math.min(netGain, Math.max(0, stGainLoss)) * activeTaxRates.st_rate
    const taxLT = Math.max(0, netGain - Math.min(netGain, Math.max(0, stGainLoss))) * activeTaxRates.lt_rate
    const estNetTax = r2(taxST + taxLT)
    const effRate = totalSale > 0 ? r2((estNetTax / totalSale) * 100) : 0
    const salePct = r2((totalSale / portfolio.total_investable_balance) * 100)
    setBannerData({ totalSale, salePct, stGainLoss, ltGainLoss, estNetTax, effRate, totalShares, totalCost, pricePerShare, priceDate })

    const result = runOptimization({
      portfolio,
      targetSaleAmount: Math.round(totalSale * 100) / 100,
      activeAccountId,
      mode: 'manual',
      optimizationPriority,
      activeTaxRates,
      manualSelections: { fund_selections: [{ fund_id: fund, accounting_method: 'specific_lot_identification', lot_overrides: lotOverrides }] },
    }) as import('../types').ManualConfiguration

    // Merge this fund's result into existing manualConfig so other funds' results are preserved.
    const newFundResult = result.fund_results.find(r => r.fund_id === fund)
    if (newFundResult && manualConfig && manualConfig.fund_results.some(r => r.fund_id !== fund)) {
      const mergedFundResults = manualConfig.fund_results.map(r => r.fund_id === fund ? newFundResult : r)
      if (!mergedFundResults.some(r => r.fund_id === fund)) mergedFundResults.push(newFundResult)
      const mergedTotalSell = r2(mergedFundResults.reduce((s, r) => s + r.sell_amount, 0))
      setManualConfig({
        ...manualConfig,
        fund_results: mergedFundResults,
        total_sell_amount: mergedTotalSell,
        allocation_impact: manualConfig.allocation_impact,
      })
    } else {
      setManualConfig(result)
    }
  }, [portfolio, holding, fund, activeAccountId, optimizationPriority, activeTaxRates, manualConfig, setManualConfig])

  function handleSharesChange(lotId: string, value: string) {
    setSharesInputs(prev => ({ ...prev, [lotId]: value }))
  }

  function handleSharesCommit(lotId: string, value: string) {
    const newInputs = { ...sharesInputs, [lotId]: value }
    setSharesInputs(newInputs)
    setManualLotSelections(fund, newInputs)
    runLotEngine(newInputs)
  }

  // Auto-fire engine on mount when inputs are pre-populated (SpecID interactive only).
  // Also persists initial selections to the store so navigate-back in FS-MAN-2 can use them.
  // Skip in read-only mode — manualConfig is already correct from the non-SpecID engine run.
  useEffect(() => {
    if (isReadOnly) return
    const hasSelections = Object.values(sharesInputs).some(v => parseFloat(v) > 0)
    if (hasSelections) {
      setManualLotSelections(fund, sharesInputs)
      runLotEngine(sharesInputs)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Populate bannerData on mount for non-SpecID (read-only) views.
  // handleExpandedMethodChange sets bannerData when the user changes method, but on a
  // fresh mount (or re-open after navigation) bannerData starts null. Derive it from
  // the already-computed manualConfig so "Total impact" is always visible.
  useEffect(() => {
    if (!isReadOnly || !manualConfig || !portfolio) return
    const fr = manualConfig.fund_results.find(r => r.fund_id === fund)
    if (!fr) return
    const stg = fr.est_st_gain_loss, ltg = fr.est_lt_gain_loss
    const netGain   = Math.max(0, r2(stg + ltg))
    const taxST     = Math.min(netGain, Math.max(0, stg)) * activeTaxRates.st_rate
    const taxLT     = Math.max(0, netGain - Math.min(netGain, Math.max(0, stg))) * activeTaxRates.lt_rate
    const estNetTax = r2(taxST + taxLT)
    const totalSale = fr.sell_amount
    setBannerData({
      totalSale,
      salePct:       r2((totalSale / portfolio.total_investable_balance) * 100),
      stGainLoss:    stg,
      ltGainLoss:    ltg,
      estNetTax,
      effRate:       totalSale > 0 ? r2((estNetTax / totalSale) * 100) : 0,
      totalShares:   fr.lots_sold.reduce((s, l) => s + l.shares_to_sell, 0),
      totalCost:     fr.lots_sold.reduce((s, l) => s + l.cost_basis, 0),
      pricePerShare: holding?.lots[0]?.current_nav ?? 0,
      priceDate:     '05/27/2026',
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // REQ-B4-001: "Go to Scenario Analysis" from lot detail — save/update scenario and navigate.
  // Uses manualConfig.fund_results (all active funds, with actual lots_sold from engine output)
  // rather than a synthetic single-fund object, so lot selections survive startEditingScenario.
  function handleGoToScenarios() {
    const fundResults = manualConfig?.fund_results ?? []
    if (fundResults.length > 0 && portfolio) {
      const scenario = buildScenarioFromFundResults(fundResults, portfolio, activeTaxRates, null)
      if (scenario) {
        if (activeScenarioId) {
          updateScenario(activeScenarioId, { ...scenario, scenario_id: activeScenarioId })
          setActiveScenarioId(null)
        } else if (scenarios.length < 3 && !isDuplicateScenario(scenario, scenarios)) {
          addScenario(scenario)
        }
      }
    }
    navigate('/scenarios')
  }

  // Account expansion
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())
  function toggleAccount(id: string) {
    setExpandedAccounts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id) ; else next.add(id)
      return next
    })
  }
  const iraExpanded  = expandedAccounts.has('ira')
  const rothExpanded = expandedAccounts.has('roth')

  // Determine whether the "other" active fund should appear BEFORE the expanded fund.
  // Reads manualActiveFundIds (activation order from FS-MAN-2) to preserve the order
  // the user set — e.g. if VTSAX was activated first, it stays above VBTLX even when
  // VBTLX's lot detail is open.
  const otherFundId = fund === 'VTSAX' ? 'VBTLX' : 'VTSAX'

  // Derive live collapsed fund data from manualConfig for the other active fund
  const collapsedFundData: CollapsedActiveFundData | null = (() => {
    const otherHolding = taxableAcct?.holdings.find(h => h.fund_id === otherFundId) ?? null
    if (!otherHolding) return null
    const fr = manualConfig?.fund_results.find(r => r.fund_id === otherFundId) ?? null
    const sellAmountCents = manualAppliedAmountsCents[otherFundId] ?? 0
    const stg = fr?.est_st_gain_loss ?? null
    const ltg = fr?.est_lt_gain_loss ?? null
    const impact = fr?.impact_pct ?? null
    const assetClass = fr?.impact_asset_class ?? otherHolding.asset_class
    return {
      ticker: otherFundId,
      fullName: otherHolding.fund_name,
      shares: formatShares(otherHolding.total_shares),
      balance: formatCurrency(otherHolding.current_balance),
      sellAmount: formatCurrency(sellAmountCents / 100),
      estSTGains: stg !== null ? (stg !== 0 ? fmtSigned(stg) : formatCurrency(0)) : '—',
      estSTColor: stg !== null ? (stg > 0 ? 'text-[#007a00]' : stg < 0 ? 'text-[#c8102e]' : 'text-vg-ink') : 'text-vg-ink',
      estLTGains: ltg !== null ? (ltg !== 0 ? fmtSigned(ltg) : formatCurrency(0)) : '—',
      estLTColor: ltg !== null ? (ltg > 0 ? 'text-[#007a00]' : ltg < 0 ? 'text-[#c8102e]' : 'text-vg-ink') : 'text-vg-ink',
      estTax: fr ? formatCurrency(fr.est_tax_gross) : '—',
      impact: impact !== null
        ? `${impact <= 0 ? '−' : '+'}${fmtPct1(Math.abs(impact))}% ${shortAssetClass(assetClass)}`
        : '—',
      impactColor: impact !== null ? (impact <= 0 ? 'text-[#007a00]' : 'text-[#c8102e]') : 'text-vg-ink',
      rationale: fr?.rationale ?? '',
    }
  })()

  const otherFundComesFirst = (() => {
    const expandedIdx = manualActiveFundIds.indexOf(fund)
    const otherIdx    = manualActiveFundIds.indexOf(otherFundId)
    // If either isn't in the list fall back to current behavior (other fund after)
    if (expandedIdx === -1 || otherIdx === -1) return false
    return otherIdx < expandedIdx
  })()

  const ltLots = lots.filter(l => l.holdingPeriod === 'LT')
  const stLots = lots.filter(l => l.holdingPeriod === 'ST')

  // Combined session-level banner derived from all active funds in manualConfig.
  // Drives the top summary bar so it remains stable while the user edits lot inputs.
  const combinedBanner = useMemo(() => {
    if (!manualConfig || !portfolio || manualConfig.fund_results.length === 0) return null
    const results = manualConfig.fund_results
    const totalSell  = r2(results.reduce((s, fr) => s + fr.sell_amount, 0))
    const stGain     = r2(results.reduce((s, fr) => s + fr.est_st_gain_loss, 0))
    const ltGain     = r2(results.reduce((s, fr) => s + fr.est_lt_gain_loss, 0))
    const netGain    = Math.max(0, r2(stGain + ltGain))
    const taxST      = Math.min(netGain, Math.max(0, stGain)) * activeTaxRates.st_rate
    const taxLT      = Math.max(0, netGain - Math.min(netGain, Math.max(0, stGain))) * activeTaxRates.lt_rate
    const estNetTax  = r2(taxST + taxLT)
    const salePct    = r2((totalSell / portfolio.total_investable_balance) * 100)
    const effRate    = totalSell > 0 ? r2((estNetTax / totalSell) * 100) : 0
    return { totalSell, stGain, ltGain, estNetTax, salePct, effRate }
  }, [manualConfig, portfolio, activeTaxRates])

  return (
    <>
      {/* Target Allocation Modal */}
      {showAllocModal && <TargetAllocationModal onClose={() => setShowAllocModal(false)} />}

      {/* Cost Basis Dialog — expanded fund row */}
      {showExpandedCBD && (
        <CostBasisDialog
          currentMethod={expandedMethod}
          onConfirm={handleExpandedMethodChange}
          onClose={() => setShowExpandedCBD(false)}
        />
      )}

      {/* Cost Basis Dialog — collapsed other-fund row */}
      {showCollapsedCBD && (
        <CostBasisDialog
          currentMethod={collapsedMethod}
          onConfirm={m => { setCollapsedMethod(m); setShowCollapsedCBD(false) }}
          onClose={() => setShowCollapsedCBD(false)}
        />
      )}

      {/* FS-INT-SAVEDISCARD — Mode switch save/discard dialog */}
      {showModeDialog && (
        <SaveDiscardDialog
          onSave={handleSave}
          onDiscard={handleDiscard}
          onClose={handleClose}
        />
      )}

      <div className="flex flex-col items-start w-full">
        <div className="flex flex-col gap-6 py-10 w-full">

          {/* Row 1 — Page title + mode toggle */}
          <div className="flex items-center justify-between px-8 h-14">
            <h1 className="text-[30px] font-bold text-vg-ink whitespace-nowrap leading-normal">
              Sell &amp; Rebalance
            </h1>
            <div className="flex items-center border-[1.5px] border-vg-ink rounded-full p-[2px] bg-white h-[37px]">
              <button onClick={handleToggleClick} className="self-stretch flex items-center gap-1.5 px-4 rounded-[4px] text-[14px] font-bold text-vg-ink">
                <Sparkles size={16} className="text-vg-ink" />Automated
              </button>
              <div className="self-stretch flex items-center gap-1.5 px-4 rounded-full bg-vg-teal">
                <PenLine size={16} className="text-white" />
                <span className="text-[14px] font-bold text-white">Manual</span>
              </div>
            </div>
          </div>

          {/* Summary Banner — combined session totals from manualConfig (stable across lot-editing) */}
          <div className="flex items-center px-8 w-full">
            <div className="flex flex-1 items-start bg-[#e8f5f0] px-6 py-4">
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">SALE TOTAL</span>
                <span className="text-[20px] font-bold text-vg-ink whitespace-nowrap">{combinedBanner ? formatCurrency(combinedBanner.totalSell) : '—'}</span>
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{combinedBanner && portfolio ? formatPercent(combinedBanner.salePct, true) + ' of ' + formatCurrency(portfolio.total_investable_balance) : '0.0% of portfolio'}</span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">TAX BRACKET</span>
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{Math.round(activeTaxRates.st_rate * 100)}% ST / {Math.round(activeTaxRates.lt_rate * 100)}% LT</span>
                <a className="text-[12px] text-[#1255cc] underline cursor-pointer whitespace-nowrap">Change</a>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">YTD REALIZED</span>
                {portfolio?.ytd_gains_record ? (
                  <>
                    <span className="text-[12px] text-vg-ink whitespace-nowrap">ST {formatCurrency(portfolio.ytd_gains_record.st_gains_realized_ytd)}</span>
                    <span className="text-[12px] text-vg-ink whitespace-nowrap">LT {formatCurrency(portfolio.ytd_gains_record.lt_gains_realized_ytd)}</span>
                  </>
                ) : <span className="text-[12px] text-vg-ink-muted">—</span>}
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. ST GAINS</span>
                <span className={`text-[16px] font-bold whitespace-nowrap ${combinedBanner && combinedBanner.stGain > 0 ? 'text-[#007a00]' : combinedBanner && combinedBanner.stGain < 0 ? 'text-vg-red' : 'text-vg-ink'}`}>
                  {combinedBanner ? fmtSigned(combinedBanner.stGain) : '—'}
                </span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. LT GAINS</span>
                <span className={`text-[16px] font-bold whitespace-nowrap ${combinedBanner && combinedBanner.ltGain > 0 ? 'text-[#007a00]' : combinedBanner && combinedBanner.ltGain < 0 ? 'text-vg-red' : 'text-vg-ink'}`}>
                  {combinedBanner ? fmtSigned(combinedBanner.ltGain) : '—'}
                </span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. NET TAX</span>
                <span className="text-[16px] font-bold text-vg-ink whitespace-nowrap">{combinedBanner ? formatCurrency(combinedBanner.estNetTax) : '—'}</span>
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{combinedBanner ? fmtRate2(combinedBanner.effRate) + '% effective rate' : ''}</span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              {(() => {
                const allocImpact = manualConfig?.allocation_impact ?? null
                const equityDelta = allocImpact ? r2(
                  (allocImpact.domestic_equity_after + allocImpact.international_equity_after) -
                  (allocImpact.domestic_equity_before + allocImpact.international_equity_before)
                ) : null
                const bondsDelta = allocImpact ? r2(allocImpact.domestic_bonds_after - allocImpact.domestic_bonds_before) : null
                return (
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0 overflow-hidden px-3">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">IMPACT</span>
                    {equityDelta !== null ? (
                      <div className="flex gap-1.5 items-center">
                        <span className="text-[12px] text-vg-ink">Stocks</span>
                        <span className={`text-[12px] ${equityDelta <= 0 ? 'text-[#007a00]' : 'text-vg-red'}`}>
                          {equityDelta <= 0 ? '−' : '+'}{fmtPct1(Math.abs(equityDelta))}%
                        </span>
                      </div>
                    ) : (
                      <div className="flex gap-1.5 items-center"><span className="text-[12px] text-vg-ink">Stocks</span><span className="text-[12px] text-vg-ink">—</span></div>
                    )}
                    {bondsDelta !== null ? (
                      <div className="flex gap-1.5 items-center">
                        <span className="text-[12px] text-vg-ink">Bonds</span>
                        <span className={`text-[12px] ${bondsDelta >= 0 ? 'text-[#007a00]' : 'text-vg-red'}`}>
                          {bondsDelta >= 0 ? '+' : '−'}{fmtPct1(Math.abs(bondsDelta))}%
                        </span>
                      </div>
                    ) : (
                      <div className="flex gap-1.5 items-center"><span className="text-[12px] text-vg-ink">Bonds</span><span className="text-[12px] text-vg-ink">—</span></div>
                    )}
                    <a className="text-[10px] text-[#1255cc] underline cursor-pointer whitespace-nowrap" onClick={() => setShowAllocModal(true)}>Target allocation</a>
                  </div>
                )
              })()}
            </div>
          </div>

          {/* Fund Table — relative wrapper anchors the W&S coach mark bubble */}
          <div className="flex flex-col items-start px-8 w-full">
            <div className="flex flex-col items-start w-full border border-[#e8e9e9] relative">

              {/* Taxable Brokerage header */}
              <div className="flex h-16 items-center px-4 bg-[#f8f8f8] border-b border-[#e8e9e9] w-full">
                <RadioDot selected={true} />
                <div className="w-2 shrink-0" />
                <div className="flex gap-1 items-center">
                  <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">Taxable Brokerage</span>
                  <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{taxableAcct?.masked_number ?? '...4782'}</span>
                </div>
                <div className="flex-1" />
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{taxableAcct ? accountAllocStr(taxableAcct) : ''}</span>
                <div className="w-4 shrink-0" />
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{formatCurrency(taxableAcct?.account_balance ?? 0)}</span>
                <div className="w-4 shrink-0" />
                <ChevronDown size={24} className="text-vg-ink shrink-0" />
              </div>

              {/* Column header row */}
              <div className="flex h-9 items-center px-3 bg-[#f8f8f8] border border-[#e0e0e0] w-full shrink-0">
                <div className="w-[280px] px-2 flex items-center h-full shrink-0">
                  <span className="text-[12px] font-semibold text-vg-ink">FUND</span>
                </div>
                <div className="w-[140px] px-2 flex items-center h-full shrink-0">
                  <span className="text-[12px] font-semibold text-vg-ink">POSITION</span>
                </div>
                <div className="flex-1" />
              </div>

              {/* Other active fund — collapsed, shown BEFORE expanded fund when it was activated first */}
              {otherFundComesFirst && collapsedFundData && (
                <CollapsedActiveFundRow
                  fund={collapsedFundData}
                  onLotDetails={ticker => navigate('/manual-lot', { state: { fund: ticker } })}
                  displayMethod={collapsedMethod}
                  onEditClick={() => setShowCollapsedCBD(true)}
                />
              )}

              {/* EXPANDED active fund row — Main Row + Details Row + Lot Detail */}
              <div className="flex flex-col border-b border-[#e8e9e9] w-full bg-white">

                {/* Main Row — 64px */}
                <div className="flex h-16 items-center overflow-hidden px-3 w-full bg-white">
                  <div className="w-[280px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
                    <span className="text-[12px] text-vg-ink-muted truncate">
                      {holding?.fund_name ?? fund}
                    </span>
                    <a className="text-[14px] font-bold text-[#1255cc] underline whitespace-nowrap">{fund}</a>
                  </div>
                  <div className="w-[140px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">{formatShares(holding?.total_shares ?? 0)} shares</span>
                    <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{formatCurrency(holding?.current_balance ?? 0)}</span>
                  </div>
                  {/* Sell amount — SpecID: "SELL AMOUNT *" derived from lot inputs; non-SpecID: input-styled display matching FS-MAN-2 */}
                  <div className="w-[128px] h-full flex flex-col gap-[3px] items-start overflow-hidden px-[4px] py-[8px] shrink-0">
                    <div className="flex flex-1 flex-col gap-[4px] items-start justify-center min-h-0 w-[120px]">
                      <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">
                        {isReadOnly ? 'SELL AMOUNT' : 'SELL AMOUNT *'}
                      </span>
                      {isReadOnly ? (
                        <div className="w-[120px] h-[28px] px-3 border border-vg-ink rounded-[4px] bg-white flex items-center">
                          <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">
                            {formatCurrency((manualAppliedAmountsCents[fund] ?? 0) / 100)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">
                          {bannerData ? formatCurrency(bannerData.totalSale) : (fund === 'VTSAX' ? formatCurrency(15000.03) : formatCurrency(10000))}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="w-[130px] h-full flex flex-col gap-2 items-start px-2 py-[12px] shrink-0 overflow-hidden">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">&nbsp;</span>
                    {/* Hidden in lot-detail view: lot-level SpecID selection replaces fund-level "sell all".
                        invisible keeps the column space so no other content shifts. */}
                    <div className="flex items-center gap-2 invisible">
                      <div className="w-4 h-4 border-[1.5px] border-[#767676] rounded-[2px] shrink-0 bg-white" />
                      <span className="text-[12px] text-vg-ink whitespace-nowrap">Sell all shares</span>
                    </div>
                  </div>
                  <div className="w-[160px] h-full flex flex-col justify-center gap-1 px-2 shrink-0 overflow-hidden">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">COST BASIS METHOD</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{expandedMethod}</span>
                      <a className="text-[14px] text-[#1255cc] underline cursor-pointer whitespace-nowrap" onClick={() => setShowExpandedCBD(true)}>Edit</a>
                    </div>
                  </div>
                  {(() => {
                    // Per-fund gross tax = tax on this fund's own gain, before portfolio-level netting
                    const stg = bannerData?.stGainLoss ?? 0
                    const ltg = bannerData?.ltGainLoss ?? 0
                    const grossTax = r2(Math.max(0, stg) * activeTaxRates.st_rate + Math.max(0, ltg) * activeTaxRates.lt_rate)
                    const stColor = stg > 0 ? 'text-[#007a00]' : stg < 0 ? 'text-[#c8102e]' : 'text-vg-ink'
                    const ltColor = ltg < 0 ? 'text-[#c8102e]' : ltg > 0 ? 'text-[#007a00]' : 'text-vg-ink'
                    return (<>
                  <div className="w-[95px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. ST GAINS</span>
                    <span className={`text-[14px] font-bold whitespace-nowrap ${stColor}`}>
                      {bannerData ? (stg !== 0 ? fmtSigned(stg) : formatCurrency(0)) : '—'}
                    </span>
                  </div>
                  <div className="w-[95px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. LT GAINS</span>
                    <span className={`text-[14px] font-bold whitespace-nowrap ${ltColor}`}>
                      {bannerData ? (ltg !== 0 ? fmtSigned(ltg) : formatCurrency(0)) : '—'}
                    </span>
                  </div>
                  <div className="w-[85px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. TAX</span>
                    <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">
                      {bannerData ? formatCurrency(grossTax) : '—'}
                    </span>
                  </div>
                    </>)
                  })()}
                  {(() => {
                    const expFr = bannerData ? manualConfig?.fund_results.find(r => r.fund_id === fund) : null
                    const expImpact = expFr?.impact_pct ?? null
                    const expAsset  = expFr?.impact_asset_class ?? holding?.asset_class ?? ''
                    const expImpactStr = expImpact !== null
                      ? `${expImpact <= 0 ? '−' : '+'}${fmtPct1(Math.abs(expImpact))}% ${shortAssetClass(expAsset)}`
                      : '—'
                    const expImpactColor = expImpact !== null
                      ? (expImpact <= 0 ? 'text-[#007a00]' : 'text-[#c8102e]')
                      : 'text-vg-ink'
                    return (
                      <div className="w-[110px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0">
                        <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">IMPACT</span>
                        <span className={`text-[12px] font-semibold whitespace-nowrap ${expImpactColor}`}>{expImpactStr}</span>
                      </div>
                    )
                  })()}
                  <div className="flex flex-1 h-full items-center justify-end px-2">
                    <button onClick={() => navigate('/manual-2')} className="h-[36px] w-[90px] rounded-full border-[1.5px] border-vg-ink bg-white text-[14px] font-bold text-vg-ink shrink-0 hover:opacity-90 active:opacity-80 transition-opacity">Cancel</button>
                  </div>
                </div>

                {/* Details Row — collapse trigger (chevron UP = currently expanded) */}
                <div className="flex h-8 items-center justify-between px-4 w-full bg-white border-b border-[#e8e9e9]">
                  <div className="flex items-center gap-[5px] shrink overflow-hidden">
                    {isReadOnly && (
                      <span className="text-[11px] font-semibold text-[#717777] whitespace-nowrap italic mr-1">
                        Engine selection — read-only
                      </span>
                    )}
                    <p className="text-[13px] italic text-vg-ink-muted whitespace-nowrap">
                      {fund === 'VTSAX'
                        ? 'Selling the lowest-gain short-term lot (acquired Nov 2025) reduces domestic equity overweight while limiting estimated gross tax to $364.'
                        : 'Harvesting a $1,057 long-term bond loss nets against equity gains; combined taxable gain is $459 and estimated net tax is $110.'}
                    </p>
                    {(() => {
                      const wsLot = stLots.find(l => l.waitAndSave)
                      return wsLot ? (
                        <span className="flex items-center gap-[4px] h-[15px] px-[8px] py-[2px] rounded-[100px] bg-[#e07000] shrink-0">
                          <Clock size={10} className="text-white shrink-0" />
                          <span className="text-[9px] font-bold text-white tracking-[0.36px] whitespace-nowrap">
                            WAIT &amp; SAVE {wsLot.waitAndSave!.savingsAmount}
                          </span>
                        </span>
                      ) : null
                    })()}
                  </div>
                  <button onClick={() => navigate('/manual-2')} className="flex items-center gap-1 cursor-pointer shrink-0 hover:opacity-70 ml-2">
                    <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">Lot details</span>
                    <span className="text-vg-ink-muted text-base leading-none">▴</span>
                  </button>
                </div>

                {/* Lot Detail Section — Figma: bg-[#f8f8f7], border-l #e8e9e9, pl-32, overflow-clip */}
                <div className="pl-8 w-full flex flex-col bg-[#f8f8f7] border-l border-[#e8e9e9] overflow-clip">

                {/* AvgCost — single blended summary row; no individual lot groups (no lot-level data) */}
                {expandedMethod === 'AvgCost' ? (() => {
                  const fr = manualConfig?.fund_results.find(r => r.fund_id === fund)
                  const syntheticLot = fr?.lots_sold[0]
                  // Use engine-computed values directly — avoids rounding divergence vs totals row
                  const sharesToSell = syntheticLot?.shares_to_sell ?? 0
                  const costOfSold   = syntheticLot?.cost_basis ?? 0
                  const proceeds     = syntheticLot?.proceeds ?? 0
                  const gainLoss     = syntheticLot?.realized_gain_loss ?? 0
                  const totalShares  = holding?.total_shares ?? 0
                  const gainPerShare = sharesToSell > 0 ? r2(gainLoss / sharesToSell) : 0
                  const isGain       = gainLoss >= 0
                  const glColor      = isGain ? 'text-[#007a00]' : 'text-[#c8102e]'
                  return (
                    <>
                      <LotDetailHeader />
                      <div className="flex h-12 items-center overflow-clip px-3 w-full bg-[#fafafa] border-b border-[#e8e9e9] shrink-0">
                        {/* Shares to sell — 220px: bold text (no input, no All checkbox) */}
                        <div className="w-[220px] flex items-center shrink-0 h-full">
                          <span className="w-[120px] px-3 text-[14px] font-bold text-[#040505] whitespace-nowrap">
                            {fmtLotShares(sharesToSell)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-px" />
                        {/* Shares owned */}
                        <div className="w-[100px] flex items-center justify-end shrink-0 h-full">
                          <span className="text-[12px] text-vg-ink whitespace-nowrap">{formatShares(totalShares)}</span>
                        </div>
                        <div className="flex-1 min-w-px" />
                        {/* Total cost */}
                        <div className="w-[120px] flex items-center justify-end shrink-0 h-full">
                          <span className="text-[12px] text-vg-ink whitespace-nowrap">{formatCurrency(costOfSold)}</span>
                        </div>
                        <div className="flex-1 min-w-px" />
                        {/* Est. gain/loss */}
                        <div className="w-[160px] flex flex-col items-end justify-center gap-[3px] shrink-0 h-full py-1.5">
                          <div className="flex items-center gap-1">
                            <span className={`text-[12px] font-bold ${glColor}`}>{isGain ? '↑' : '↓'}</span>
                            <span className={`text-[12px] font-bold whitespace-nowrap ${glColor}`}>{formatCurrency(Math.abs(gainLoss))}</span>
                          </div>
                          <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">({formatCurrency(Math.abs(gainPerShare))})</span>
                        </div>
                        <div className="flex-1 min-w-px" />
                        {/* Est. available proceeds */}
                        <div className="w-[150px] flex items-center justify-end shrink-0 h-full">
                          <span className="text-[12px] text-vg-ink whitespace-nowrap">{formatCurrency(proceeds)}</span>
                        </div>
                        <div className="flex-1 min-w-px" />
                        {/* Date acquired — not applicable for AvgCost */}
                        <div className="w-[120px] flex items-center shrink-0 h-full">
                          <span className="text-[11px] text-vg-ink-muted italic whitespace-nowrap">Average cost basis</span>
                        </div>
                      </div>
                    </>
                  )
                })() : (
                  <>
                    {ltLots.length > 0 && (
                      <>
                        <LotSectionHeader label="Long-term holdings" showViewDefs={!isReadOnly} />
                        <LotDetailHeader />
                        {ltLots.map(lot => (
                          <NormalLotRow
                            key={lot.lotId}
                            lot={lot}
                            sharesInput={sharesInputs[lot.lotId] ?? '0.000'}
                            onSharesChange={v => handleSharesChange(lot.lotId, v)}
                            onSharesCommit={v => handleSharesCommit(lot.lotId, v)}
                            readOnly={isReadOnly}
                            readOnlyShares={isReadOnly ? fmtLotShares(lotSharesMap.get(lot.lotId) ?? 0) : undefined}
                          />
                        ))}
                      </>
                    )}

                    {stLots.length > 0 && (
                      <>
                        <LotSectionHeader label="Short-term holdings" showViewDefs={false} />
                        <LotDetailHeader />
                        {stLots.map(lot =>
                          lot.waitAndSave ? (
                            <WaitSaveLotRow
                              key={lot.lotId}
                              lot={lot}
                              sharesInput={sharesInputs[lot.lotId] ?? '0.000'}
                              onSharesChange={v => handleSharesChange(lot.lotId, v)}
                              onSharesCommit={v => handleSharesCommit(lot.lotId, v)}
                              showHint={!isReadOnly}
                              readOnly={isReadOnly}
                              readOnlyShares={isReadOnly ? fmtLotShares(lotSharesMap.get(lot.lotId) ?? 0) : undefined}
                            />
                          ) : (
                            <NormalLotRow
                              key={lot.lotId}
                              lot={lot}
                              sharesInput={sharesInputs[lot.lotId] ?? '0.000'}
                              onSharesChange={v => handleSharesChange(lot.lotId, v)}
                              onSharesCommit={v => handleSharesCommit(lot.lotId, v)}
                              readOnly={isReadOnly}
                              readOnlyShares={isReadOnly ? fmtLotShares(lotSharesMap.get(lot.lotId) ?? 0) : undefined}
                            />
                          )
                        )}
                      </>
                    )}
                  </>
                )}

                {/* Lot Detail Totals — Figma: I388:2116;455:754;569:6624
                    36px section header + 40px totals row, shown once engine has fired */}
                {bannerData && (
                  <>
                    {/* Section header: "Total impact of selected shares to sell" — flush with Table Section left edge */}
                    <div className="flex h-9 items-center justify-between overflow-clip w-full shrink-0">
                      <span className="text-[13px] font-semibold text-vg-ink whitespace-nowrap">Total impact of selected shares to sell</span>
                    </div>
                    {/* Totals row (40px) — inherits Table Section bg (#f8f8f7), columns aligned to lot table */}
                    <div className="flex h-10 items-center overflow-clip px-3 w-full shrink-0">
                      {/* t1 — Total selected shares to sell (220px) */}
                      <div className="w-[220px] flex flex-col items-start justify-center h-full shrink-0 overflow-clip">
                        <span className="text-[11px] text-vg-ink-muted">Total selected shares to sell</span>
                        <span className="text-[12px] font-semibold text-vg-ink whitespace-nowrap">{formatShares(bannerData.totalShares)}</span>
                      </div>
                      <div className="flex-1 min-w-px" />
                      {/* t2 — empty (Shares owned column) */}
                      <div className="w-[100px] h-full shrink-0" />
                      <div className="flex-1 min-w-px" />
                      {/* t3 — Total Cost (120px, right-aligned) */}
                      <div className="w-[120px] flex flex-col items-end justify-center h-full shrink-0 overflow-clip">
                        <span className="text-[11px] text-vg-ink-muted">Total Cost</span>
                        <span className="text-[12px] font-bold text-vg-ink whitespace-nowrap">{formatCurrency(bannerData.totalCost)}</span>
                      </div>
                      <div className="flex-1 min-w-px" />
                      {/* t4 — Total estimated gain/loss (160px, right-aligned) */}
                      <div className="w-[160px] flex flex-col items-end justify-center gap-[2px] h-full shrink-0 overflow-clip py-1">
                        <span className="text-[11px] text-vg-ink-muted text-right">Total estimated gain/loss</span>
                        <span className={`text-[12px] font-bold whitespace-nowrap ${(bannerData.stGainLoss + bannerData.ltGainLoss) >= 0 ? 'text-[#007a00]' : 'text-[#c8102e]'}`}>
                          {fmtSigned(r2(bannerData.stGainLoss + bannerData.ltGainLoss))}
                        </span>
                      </div>
                      <div className="flex-1 min-w-px" />
                      {/* t5 — Total estimated proceeds (150px, right-aligned) */}
                      <div className="w-[150px] flex flex-col items-end justify-center gap-[2px] h-full shrink-0 overflow-clip py-1 whitespace-nowrap">
                        <span className="text-[11px] text-vg-ink-muted">Total estimated proceeds</span>
                        <span className="text-[12px] font-bold text-vg-ink">{formatCurrency(bannerData.totalSale)}</span>
                      </div>
                      <div className="flex-1 min-w-px" />
                      {/* t6 — Price per share + date (120px) — aligns with Date acquired column */}
                      <div className="w-[120px] flex flex-col items-start justify-center h-full shrink-0 overflow-clip whitespace-nowrap">
                        <span className="text-[11px] text-vg-ink-muted">Price as of {bannerData.priceDate}</span>
                        <span className="text-[12px] text-vg-ink">{formatCurrency(bannerData.pricePerShare)} per share</span>
                      </div>
                    </div>
                  </>
                )}
                </div>{/* end Table Section pl-8 wrapper */}
              </div>

              {/* Other active fund — collapsed, shown AFTER expanded fund when it was activated later */}
              {!otherFundComesFirst && collapsedFundData && (
                <CollapsedActiveFundRow
                  fund={collapsedFundData}
                  onLotDetails={ticker => navigate('/manual-lot', { state: { fund: ticker } })}
                  displayMethod={collapsedMethod}
                  onEditClick={() => setShowCollapsedCBD(true)}
                />
              )}

              {/* Inactive fund rows — VTIAX and VBIRX (Figma: 382:1898-1899, 64px each) */}
              {(() => {
                const vtiax = taxableAcct?.holdings.find(h => h.fund_id === 'VTIAX')
                const vbirx = taxableAcct?.holdings.find(h => h.fund_id === 'VBIRX')
                return (<>
                  {vtiax && <InactiveFundRowLOT ticker="VTIAX" fullName={vtiax.fund_name} shares={formatShares(vtiax.total_shares)} balance={formatCurrency(vtiax.current_balance)} />}
                  {vbirx && <InactiveFundRowLOT ticker="VBIRX" fullName={vbirx.fund_name} shares={formatShares(vbirx.total_shares)} balance={formatCurrency(vbirx.current_balance)} />}
                </>)
              })()}

              {/* Traditional IRA — collapsed, expandable */}
              <div className="flex h-16 items-center px-4 bg-[#f8f8f8] border-t border-[#e8e9e9] w-full cursor-pointer" onClick={() => toggleAccount('ira')}>
                <RadioDot selected={false} />
                <div className="w-2 shrink-0" />
                <div className="flex gap-1 items-center flex-wrap">
                  <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">Traditional IRA</span>
                  <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{iraAcct?.masked_number ?? '...2973'}</span>
                  {iraAcct?.rmd_record && (
                    <>
                      <div className="w-2 shrink-0" />
                      <div className="flex items-center gap-[4px] px-2 py-[2px] rounded-full bg-[#e07000]">
                        <Clock size={12} className="text-white shrink-0" />
                        <span className="text-[9px] font-bold text-white tracking-[0.36px] whitespace-nowrap">Remaining 2026 RMD: {formatCurrency(Math.round(iraAcct.rmd_record.rmd_remaining))}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="flex-1" />
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{iraAcct ? accountAllocStr(iraAcct) : ''}</span>
                <div className="w-4 shrink-0" />
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{iraAcct ? formatCurrency(iraAcct.account_balance) : '—'}</span>
                <div className="w-4 shrink-0" />
                {iraExpanded ? <ChevronUp size={24} className="text-vg-ink shrink-0" /> : <ChevronDown size={24} className="text-vg-ink shrink-0" />}
              </div>

              {/* Roth IRA — collapsed, expandable */}
              <div className="flex h-16 items-center px-4 bg-[#f8f8f8] border-t border-[#e8e9e9] w-full cursor-pointer" onClick={() => toggleAccount('roth')}>
                <RadioDot selected={false} />
                <div className="w-2 shrink-0" />
                <div className="flex gap-1 items-center">
                  <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">Roth IRA</span>
                  <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{rothAcct?.masked_number ?? '...8148'}</span>
                </div>
                <div className="flex-1" />
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{rothAcct ? accountAllocStr(rothAcct) : ''}</span>
                <div className="w-4 shrink-0" />
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{rothAcct ? formatCurrency(rothAcct.account_balance) : '—'}</span>
                <div className="w-4 shrink-0" />
                {rothExpanded ? <ChevronUp size={24} className="text-vg-ink shrink-0" /> : <ChevronDown size={24} className="text-vg-ink shrink-0" />}
              </div>

            </div>
          </div>

          {/* Footer — same as FS-MAN-2 */}
          <div className="flex gap-3 items-center px-8 w-full">
            <button className="h-[48px] px-7 rounded-full bg-vg-ink text-white text-[14px] font-bold whitespace-nowrap hover:opacity-90">Review order</button>
            <button onClick={handleGoToScenarios} className="h-[48px] px-7 rounded-full border-[1.5px] border-vg-ink text-vg-ink bg-white text-[14px] font-bold whitespace-nowrap hover:opacity-90 transition-opacity">Go to Scenario Analysis</button>
            <button className="text-[14px] text-[#1255cc] underline cursor-pointer whitespace-nowrap hover:opacity-80">
              ↩ Reset to system recommendation
            </button>
          </div>

        </div>
      </div>
    </>
  )
}
