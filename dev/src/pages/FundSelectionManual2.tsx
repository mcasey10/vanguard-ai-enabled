import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, PenLine, ChevronDown } from 'lucide-react'
import { useModeToggleGuard, SaveDiscardDialog } from '../components/ModeToggleGuard'
import { CostBasisDialog } from '../components/CostBasisDialog'
import { CoachMark } from '../components/CoachMark'
import { ExpandableDetail } from '../components/ExpandableDetail'
import { TaxBreakdownPanel } from '../components/TaxBreakdownPanel'
import { FundSelectionAssistantEntry } from '../components/FundSelectionAssistantEntry'
import type { CostBasisMethod } from '../types'
import { toAccountingMethod } from '../utils/methods'
import { TargetAllocationModal } from '../components/TargetAllocationModal'
import { TaxBracketDialog } from '../components/TaxBracketDialog'
import { useAppStore } from '../store/useAppStore'
import { runOptimization, shortAssetClass, computeNetTax } from '../engine/index'
import type { FundSaleResult, ManualConfiguration, Recommendation } from '../types'
import { formatCurrency, formatCurrencyCompact, formatShares, formatPercent, accountAllocStr, accountTypeLabel, formatTaxFigure } from '../utils/format'
import {
  bannerRateDisplay, bannerShowYtdRealized, bannerShowSeparateGainLoss, CONSOLIDATED_GAIN_LOSS_LABEL,
  bannerNetTaxLabel, bannerShowEarlyWithdrawalPenalty, EARLY_WITHDRAWAL_PENALTY_LABEL,
  EARLY_WITHDRAWAL_PENALTY_VALUE, EARLY_WITHDRAWAL_PENALTY_NOTE,
} from '../utils/accountBanner'
import { buildScenarioFromFundResults, isDuplicateScenario } from '../utils/scenarioBuilder'
import { NarrationBlock } from '../components/NarrationBlock'
import { buildFundResultNarrationInput } from '../utils/narrationBuilders'
import type { NarrationInput } from '../utils/narrationShared'

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <div
      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
        selected ? 'border-vg-ink' : 'border-vg-ink-muted'
      }`}
    >
      {selected && <div className="w-2 h-2 rounded-full bg-vg-ink" />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// NF-1 — Reset to system recommendation dialog (572:3190)
// ---------------------------------------------------------------------------

function ResetDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div
        className="bg-white border border-[#d0d0d0] rounded-[4px] flex flex-col items-start justify-between
          overflow-clip pb-[16px] pt-[24px] px-[24px]"
        style={{ width: 480, height: 200 }}
      >
        <div className="flex flex-col gap-3 w-full">
          <p className="text-[16px] font-bold text-vg-ink leading-normal">
            Reset to system recommendation?
          </p>
          <p className="text-[14px] text-vg-ink-muted leading-normal">
            Your manually entered amounts will be cleared and the system recommendation will be restored.
          </p>
        </div>
        <div className="flex items-center justify-between w-full">
          <button
            onClick={onCancel}
            className="h-[48px] px-7 rounded-full border-[1.5px] border-vg-ink bg-white
              text-[14px] font-bold text-vg-ink hover:opacity-90 transition-opacity"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="h-[48px] px-7 rounded-full bg-vg-ink text-white
              text-[14px] font-bold hover:opacity-90 transition-opacity"
          >
            Confirm reset
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fund row types
// ---------------------------------------------------------------------------

type FundRow = {
  ticker: string
  fullName: string
  shares: string
  balance: string
  assetClass: string
  balanceCents?: number // raw balance for "Sell all shares" (undefined on read-only rows)
}

type TaxData = {
  estSTGains: string
  estSTColor: string
  estLTGains: string
  estLTColor: string
  estTax: string
  impact: string
  impactColor: string
  rationale: string
  waitAndSave?: string  // dollar amount if Wait & Save applies
}

// ---------------------------------------------------------------------------
// Active fund row — (Figma 393:2377 / 382:1532)
// Main Row: 64px · Details Row: 32px · Total: 96px
// ---------------------------------------------------------------------------

function ActiveFundRow({
  fund,
  taxData,
  narrationInput,
  narrationProvider,
  appliedCents,
  currentMethod,
  onApply,
  onMethodChange,
  showAllocationHint,
  showHarvestableHint,
  showCostBasisHint,
  showLotDetailsHint,
  onCancel,
  onLotDetails,
}: {
  fund: FundRow
  taxData: TaxData
  narrationInput: NarrationInput | null
  narrationProvider?: string
  appliedCents: number
  currentMethod: CostBasisMethod      // lifted — parent is source of truth
  onApply: (ticker: string, cents: number) => void
  onMethodChange: (ticker: string, method: CostBasisMethod) => void
  showAllocationHint: boolean
  showHarvestableHint: boolean
  showCostBasisHint: boolean
  showLotDetailsHint: boolean
  onCancel: () => void
  onLotDetails: (ticker: string, readOnly: boolean) => void
}) {
  const [inputCents, setInputCents]     = useState(appliedCents)
  const [inputDisplay, setInputDisplay] = useState(formatCurrency(appliedCents / 100))
  const [showMethodDialog, setShowMethodDialog] = useState(false)

  const hasChange = inputCents !== appliedCents
  // "Sell all shares" is checked when the input amount equals the fund's full balance
  const balanceCents = fund.balanceCents ?? 0
  const isAllShares = balanceCents > 0 && inputCents >= balanceCents
  // Lot details: SpecID always enabled (amount derived from lot selections);
  // other methods enabled once an amount has been applied (engine must have run)
  const isSpecID = currentMethod === 'SpecID'
  const canViewLots = isSpecID || appliedCents > 0

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '')
    const cents  = parseInt(digits || '0', 10)
    setInputCents(cents)
    setInputDisplay(digits === '' ? '' : formatCurrency(cents / 100))
  }

  function handleApply() {
    if (!hasChange) return
    onApply(fund.ticker, inputCents)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleApply()
  }

  function handleSellAll(checked: boolean) {
    if (checked) {
      setInputCents(balanceCents)
      setInputDisplay(formatCurrency(balanceCents / 100))
      onApply(fund.ticker, balanceCents)
    } else {
      setInputCents(0)
      setInputDisplay('')
      onApply(fund.ticker, 0)
    }
  }

  return (
    <div className="flex flex-col border-b border-[#e8e9e9] w-full bg-white">
      {/* Main Row — 64px */}
      <div className="flex h-16 items-center overflow-hidden px-3 w-full bg-white">

        {/* FUND — 280px */}
        <div className="w-[280px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
          <span className="text-[12px] text-vg-ink-muted truncate">{fund.fullName}</span>
          <a className="text-[14px] font-bold text-[#1255cc] underline whitespace-nowrap">{fund.ticker}</a>
        </div>

        {/* POSITION — 140px */}
        <div className="w-[140px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
          <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">{fund.shares} shares</span>
          <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{fund.balance}</span>
        </div>

        {/* SELL AMOUNT — 128px: label + input, same label/value pattern as every other column.
            py-[8px] (vs py-[12px] elsewhere) because label+input together need ~44px of content
            height; inner flex-1 justify-center centers the pair within the available 48px. */}
        <div className="w-[128px] h-full flex flex-col gap-[3px] items-start overflow-hidden px-[4px] py-[8px] shrink-0">
          <div className="flex flex-1 flex-col gap-[4px] items-start justify-center min-h-0 w-[120px]">
            <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">SELL AMOUNT</span>
            <input
              type="text"
              inputMode="numeric"
              value={inputDisplay}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onBlur={handleApply}
              placeholder="$0.00"
              className="w-[120px] h-[28px] px-3 border border-vg-ink rounded-[4px]
                text-[14px] text-vg-ink text-right placeholder:text-vg-ink-muted
                bg-white focus:outline-none focus:ring-2 focus:ring-vg-ink/20"
            />
          </div>
        </div>

        {/* SELL ALL SHARES — 130px */}
        <div className="w-[130px] h-full flex flex-col gap-2 items-start px-2 py-[12px] shrink-0 overflow-hidden">
          <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">&nbsp;</span>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => handleSellAll(!isAllShares)}
              className={`w-4 h-4 border-[1.5px] rounded-[2px] shrink-0 flex items-center justify-center cursor-pointer
                ${isAllShares ? 'bg-vg-ink border-vg-ink' : 'bg-white border-[#767676]'}`}
            >
              {isAllShares && <span className="text-white text-[10px] leading-none font-bold">✓</span>}
            </div>
            <span className="text-[12px] text-vg-ink whitespace-nowrap">Sell all shares</span>
          </label>
        </div>

        {/* COST BASIS METHOD — 160px — lifted to parent for engine re-run on change */}
        <div className="w-[160px] h-full flex flex-col justify-center gap-1 px-2 shrink-0 overflow-hidden">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">COST BASIS METHOD</span>
            {showCostBasisHint && (
              <CoachMark id="cost-basis" text="The cost basis method determines which purchase lots are used to calculate your gain or loss when selling shares, directly affecting estimated taxes. MinTax selects lots that minimize tax impact. FIFO sells oldest lots first. SpecID lets you choose specific lots manually." />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{currentMethod}</span>
            <a
              className="text-[14px] text-[#1255cc] underline cursor-pointer whitespace-nowrap"
              onClick={() => setShowMethodDialog(true)}
            >Edit</a>
          </div>
          {showMethodDialog && (
            <CostBasisDialog
              currentMethod={currentMethod}
              onConfirm={method => { onMethodChange(fund.ticker, method); setShowMethodDialog(false) }}
              onClose={() => setShowMethodDialog(false)}
            />
          )}
        </div>

        {/* EST. ST GAINS — 95px */}
        <div className="w-[95px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
          <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. ST GAINS</span>
          <span className={`text-[14px] font-bold whitespace-nowrap ${taxData.estSTColor}`}>{taxData.estSTGains}</span>
        </div>

        {/* EST. LT GAINS — 95px */}
        <div className="w-[95px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
          <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. LT GAINS</span>
          <span className={`text-[14px] font-bold whitespace-nowrap ${taxData.estLTColor}`}>{taxData.estLTGains}</span>
        </div>

        {/* EST. TAX — 85px */}
        <div className="w-[85px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
          <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. TAX</span>
          <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{taxData.estTax}</span>
        </div>

        {/* IMPACT — 110px; allocation beacon */}
        <div className="w-[110px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">IMPACT</span>
            {showAllocationHint && (
              <CoachMark id="allocation" text="This fund makes up more of your portfolio than your target. Selling from it would bring your allocation closer to balance." />
            )}
          </div>
          <span className={`text-[12px] font-semibold whitespace-nowrap ${taxData.impactColor}`}>{taxData.impact}</span>
        </div>

        {/* ACTION — flex-1: Cancel button */}
        <div className="flex flex-1 h-full items-center justify-end px-2">
          <button
            onClick={onCancel}
            className="h-[36px] w-[90px] rounded-full border-[1.5px] border-vg-ink bg-white
              text-[14px] font-bold text-vg-ink shrink-0 hover:opacity-90 active:opacity-80 transition-opacity"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Details Row — min 32px, grows to fit the AI narration: a real
          NarrationBlock (badge + full sentence, often wrapping to 2-3
          lines) needs far more than the original fixed 32px this row was
          sized for back when it only ever held taxData.rationale's short
          deterministic fallback string. A fixed h-8 with items-center let
          real narration overflow both above and below the row, visually
          colliding with the main row and the next fund's row (confirmed
          live) — Automated mode's equivalent narration container has never
          had a fixed height, which is why it never showed this. */}
      <div className="flex min-h-[32px] items-start justify-between px-4 py-2 w-full bg-white">
        <div className="flex items-start gap-[5px]">
          {narrationInput
            ? <NarrationBlock input={narrationInput} provider={narrationProvider} />
            : <p className="text-[13px] italic text-vg-ink-muted">{taxData.rationale}</p>}
          {taxData.waitAndSave && (
            <span className="flex items-center gap-1 px-2 py-[2px] rounded-full bg-[#e07000] shrink-0">
              <span className="text-[9px] font-bold text-white tracking-[0.36px] whitespace-nowrap">
                WAIT &amp; SAVE {taxData.waitAndSave}
              </span>
            </span>
          )}
          {showHarvestableHint && (
            <CoachMark id="harvestable" text="This lot is worth less than you paid for it. Selling it realizes a loss that can offset gains elsewhere in your portfolio, potentially reducing your tax bill." />
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {showLotDetailsHint && (
            <CoachMark id="lot-details" text="Lot details shows the purchase history for a fund, grouped by long-term and short-term holdings. Each lot's gain or loss is based on the difference between its original cost and the current share price. Lot quantities can only be adjusted when SpecID (Specific Identification) is selected as the cost basis method." />
          )}
          <button
            onClick={() => canViewLots && onLotDetails(fund.ticker, !isSpecID)}
            disabled={!canViewLots}
            title={canViewLots ? (isSpecID ? undefined : 'View lots selected by the engine (read-only)') : 'Enter a sell amount first'}
            className={`flex items-center gap-1 ${canViewLots ? 'cursor-pointer hover:opacity-70' : 'opacity-30 cursor-not-allowed'}`}
          >
            <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">Lot details</span>
            <span className="text-vg-ink-muted text-base leading-none">▾</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inactive fund row — identical to FS-MAN-1
// ---------------------------------------------------------------------------

function InactiveFundRow({ fund, onSell }: { fund: FundRow; onSell: () => void }) {
  return (
    <div className="flex h-16 items-center overflow-hidden px-3 w-full border-b border-[#e8e9e9] bg-[#fafafa]">
      <div className="w-[280px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
        <span className="text-[12px] text-vg-ink-muted truncate">{fund.fullName}</span>
        <a className="text-[14px] font-bold text-[#1255cc] underline whitespace-nowrap">{fund.ticker}</a>
      </div>
      <div className="w-[140px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
        <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">{fund.shares} shares</span>
        <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{fund.balance}</span>
      </div>
      <div className="w-[128px] h-full shrink-0" />
      <div className="w-[130px] h-full shrink-0" />
      <div className="w-[160px] h-full shrink-0" />
      <div className="w-[95px] h-full shrink-0" />
      <div className="w-[95px] h-full shrink-0" />
      <div className="w-[85px] h-full shrink-0" />
      <div className="w-[110px] h-full shrink-0" />
      <div className="flex flex-1 h-full items-center justify-end px-2">
        <button
          onClick={onSell}
          className="h-[36px] w-[90px] rounded-full border-[1.5px] border-vg-ink bg-white
            text-[14px] font-bold text-vg-ink shrink-0 hover:opacity-90 active:opacity-80 transition-opacity"
        >
          Sell
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: map FundSaleResult → TaxData for ActiveFundRow display
// ---------------------------------------------------------------------------

function r2(n: number) { return Math.round(n * 100) / 100 }
function fmtSigned(n: number) { return (n >= 0 ? '+' : '−') + formatCurrency(Math.abs(n)) }
// 1-decimal percent for IMPACT column (matches FS-AUTO-1 fmtPct1)
function fmtPct1(n: number) { return new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n) }

function taxDataFromResult(fr: FundSaleResult | undefined): TaxData {
  if (!fr) return {
    estSTGains: '—', estSTColor: 'text-vg-ink',
    estLTGains: '—', estLTColor: 'text-vg-ink',
    estTax: '—', impact: '—', impactColor: 'text-vg-ink', rationale: '',
  }
  const stg = fr.est_st_gain_loss, ltg = fr.est_lt_gain_loss
  return {
    estSTGains: stg !== 0 ? fmtSigned(stg) : formatCurrency(0),
    estSTColor: stg > 0 ? 'text-[#007a00]' : stg < 0 ? 'text-[#c8102e]' : 'text-vg-ink',
    estLTGains: ltg !== 0 ? fmtSigned(ltg) : formatCurrency(0),
    estLTColor: ltg > 0 ? 'text-[#007a00]' : ltg < 0 ? 'text-[#c8102e]' : 'text-vg-ink',
    estTax: formatTaxFigure(fr.est_tax_gross),
    impact: `${fr.impact_pct <= 0 ? '−' : '+'}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(fr.impact_pct))}% ${shortAssetClass(fr.impact_asset_class)}`,
    impactColor: fr.impact_pct <= 0 ? 'text-[#007a00]' : 'text-[#c8102e]',
    rationale: fr.rationale,
    waitAndSave: undefined,
  }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function FundSelectionManual2() {
  const navigate = useNavigate()
  const {
    portfolio, activeAccountId, setActiveAccountId, activeTaxRates, optimizationPriority, setManualConfig, manualConfig, recommendation,
    scenarios, addScenario, updateScenario, activeScenarioId, setActiveScenarioId, setPortfolio,
    manualActiveFundIds, manualAppliedAmountsCents, manualCostBasisMethods, manualLotSelections,
    setManualActiveFunds, setManualAppliedAmount, clearManualAppliedAmount, setManualCostBasisMethod, setManualLotSelections,
    demoSettings,
  } = useAppStore()

  // Engine output for this session — per-fund results for display
  const [fundResults, setFundResults] = useState<FundSaleResult[]>([])

  // Derive local conveniences from store (store is the source of truth — survives navigation)
  // On first mount from Automated mode: seed from recommendation if store is empty
  const activeFunds = new Set(manualActiveFundIds)
  const appliedAmounts = manualAppliedAmountsCents
  const costBasisMethods = manualCostBasisMethods

  // runManualEngine — builds ManualSelections from current activeFunds + appliedAmounts
  // and calls runOptimization() in manual mode. Called on Apply/blur/Enter.
  const runManualEngine = useCallback((
    newAmounts: Record<string, number>,
    newActiveFunds: Set<string>,
    newMethods: Record<string, CostBasisMethod> = {},
    // Caller may supply updated lot selections that aren't in the store closure yet
    lotSelectionsOverride?: Record<string, Record<string, string>>
  ) => {
    if (!portfolio) return
    const totalDollars = r2(Object.values(newAmounts).reduce((s, v) => s + v, 0) / 100)
    if (totalDollars <= 0 || newActiveFunds.size === 0) { setFundResults([]); return }
    const effectiveLotSelections = lotSelectionsOverride ?? manualLotSelections
    const fundSelectionsForEngine = Array.from(newActiveFunds)
      .filter(ticker => (newAmounts[ticker] ?? 0) > 0)
      .map(ticker => {
        const method = newMethods[ticker] ?? 'MinTax'
        const base = {
          fund_id: ticker,
          accounting_method: toAccountingMethod(method),
          sell_amount: r2((newAmounts[ticker] ?? 0) / 100),
        }
        if (method !== 'SpecID') return base
        // For SpecID: attach persisted lot selections so the engine produces a valid result
        const storedInputs = effectiveLotSelections[ticker]
        if (!storedInputs) return base
        const lot_overrides = Object.entries(storedInputs)
          .filter(([, v]) => parseFloat(v) > 0)
          .map(([lot_id, v]) => ({ lot_id, shares: parseFloat(v) }))
        return lot_overrides.length > 0 ? { ...base, lot_overrides } : base
      })
    if (fundSelectionsForEngine.length === 0) { setFundResults([]); return }
    const result = runOptimization({
      portfolio,
      targetSaleAmount: totalDollars,
      activeAccountId,
      mode: 'manual',
      optimizationPriority,
      activeTaxRates,
      manualSelections: { fund_selections: fundSelectionsForEngine },
    })
    const config = result as ManualConfiguration
    setManualConfig(config)
    setFundResults(config.fund_results)
  }, [portfolio, activeAccountId, optimizationPriority, activeTaxRates, setManualConfig, manualLotSelections])

  // handleMethodChange — updates per-fund method in store and re-runs engine.
  // When switching TO SpecID, seeds lot selections from the current engine result
  // (lots_sold from the previous method) so the user starts with a concrete selection
  // rather than a blank slate. The seeded inputs are passed directly to runManualEngine
  // because setManualLotSelections is synchronous in the store but the closure still
  // holds the pre-update value.
  function handleMethodChange(ticker: string, method: CostBasisMethod) {
    setHasUserModified(true)
    let lotSelectionsOverride: Record<string, Record<string, string>> | undefined
    if (method === 'SpecID') {
      const currentResult = manualConfig?.fund_results.find(r => r.fund_id === ticker)
      if (currentResult && currentResult.lots_sold.length > 0) {
        const seeded = Object.fromEntries(
          currentResult.lots_sold.map(l => [l.lot_id, String(l.shares_to_sell)])
        )
        setManualLotSelections(ticker, seeded)
        lotSelectionsOverride = { ...manualLotSelections, [ticker]: seeded }
      }
    }
    setManualCostBasisMethod(ticker, method)
    const newMethods = { ...costBasisMethods, [ticker]: method }
    runManualEngine(appliedAmounts, activeFunds, newMethods, lotSelectionsOverride)
  }

  // Single mount effect covering two cases:
  //
  // Case 1 — First arrival from Automated: store is empty (manualActiveFundIds=[]).
  //   Seed store from recommendation AND immediately run engine with fresh amounts.
  //   We CANNOT read appliedAmounts from the closure here — it captured {} at render
  //   time before the store was seeded (Zustand set() is synchronous but the closure
  //   is already bound). We pass the amounts directly to runManualEngine to bypass
  //   the stale closure and populate the banner on first render.
  //
  // Case 2 — Return from FS-MAN-LOT: store already has amounts; fundResults (local
  //   state) was lost on unmount. Re-run engine from closure values, which are now
  //   valid because the store was populated on a prior mount.
  useEffect(() => {
    if (manualActiveFundIds.length === 0 && recommendation?.fund_results?.length) {
      // Case 1: seed store then run engine with fresh data (not the stale closure)
      const ids = recommendation.fund_results.map(fr => fr.fund_id)
      const freshAmounts: Record<string, number> = {}
      setManualActiveFunds(ids)
      for (const fr of recommendation.fund_results) {
        const cents = Math.round(fr.sell_amount * 100)
        setManualAppliedAmount(fr.fund_id, cents)
        freshAmounts[fr.fund_id] = cents
      }
      runManualEngine(freshAmounts, new Set(ids), {})
      return
    }
    // Case 2: returning from lot detail or subsequent mount — use closure values (valid)
    const total = Object.values(appliedAmounts).reduce((s, v) => s + v, 0)
    if (total > 0 && activeFunds.size > 0) {
      runManualEngine(appliedAmounts, activeFunds, costBasisMethods)
    }
  }, []) // intentionally runs once on mount — see comment above for why [] is correct

  // handleApplyAmount — updates store then triggers engine
  function handleApplyAmount(ticker: string, cents: number) {
    setHasUserModified(true)
    setManualAppliedAmount(ticker, cents)
    const newAmounts = { ...appliedAmounts, [ticker]: cents }
    runManualEngine(newAmounts, activeFunds, costBasisMethods)
  }

  function handleLotDetails(ticker: string, readOnly: boolean) {
    navigate('/manual-lot', {
      state: { fund: ticker, readOnly, costBasisMethod: costBasisMethods[ticker] ?? 'MinTax' },
    })
  }

  // Target Allocation Modal
  const [showAllocModal, setShowAllocModal] = useState(false)

  // Account references. `accountsInCanonicalOrder` is fixed — Taxable
  // Brokerage → Traditional IRA → Roth IRA, per dev/CLAUDE.md's
  // withdrawal-priority rule — and never reorders based on which is active
  // (D058: an earlier version filtered the active account out of the list
  // and rendered it separately in a fixed "top" slot, which moved accounts
  // around on every switch). Selecting an account only controls which row's
  // fund table expands underneath it, never its position in the list.
  const allAccounts = portfolio?.accounts ?? []
  const ACCOUNT_TYPE_ORDER = ['taxable_brokerage', 'traditional_IRA', 'roth_IRA'] as const
  const accountsInCanonicalOrder = ACCOUNT_TYPE_ORDER
    .map(t => allAccounts.find(a => a.account_type === t))
    .filter((a): a is NonNullable<typeof a> => a !== undefined)
  const activeAcct2 = allAccounts.find(a => a.account_id === activeAccountId)

  // Real, aggregate net tax across every currently-active fund — computed
  // once here (the Summary Banner below has its own equivalent, kept
  // separate to avoid a larger refactor) so the per-fund narration call
  // further down can pass it too. Previously never passed at all: a real,
  // pre-existing gap where Manual mode's per-fund narration could never
  // state a net tax figure, AI-generated or fallback, for any account type
  // — meaning even after D083/D084 made Traditional IRA's ordinary-income
  // tax a real number, Manual mode's narration still couldn't say it,
  // since the number never reached the narration input at all (see
  // DECISIONS.md's IRA narration entry).
  const manualEstNetTax = computeNetTax(fundResults, activeAcct2?.account_type, activeTaxRates)
  const manualTotalSale = r2(fundResults.reduce((s, f) => s + f.sell_amount, 0))
  const manualEffRate = manualTotalSale > 0 ? r2((manualEstNetTax / manualTotalSale) * 100) / 100 : 0

  // Switching accounts clears the in-progress manual session rather than
  // carrying it over: manualActiveFundIds/manualAppliedAmountsCents/etc. are
  // keyed by fund_id (ticker) alone, and the same ticker (e.g. VBTLX) can
  // exist as a real, distinct holding in more than one account — leaving the
  // session in place would silently bleed one account's in-progress amounts
  // into another account's identically-named fund (found while enabling this
  // switch, see DECISIONS.md D057). Centralized into setActiveAccountId
  // itself (D058 follow-up) so this holds regardless of which page performs
  // the switch — a plain local clearManualSession() call here only covered
  // switches made from this page, not ones made from Automated.
  //
  // Clearing alone left a second bug (D059 follow-up, found live): this
  // page's seed-from-recommendation logic only runs in the mount effect
  // below, which fires once per mount — switching accounts while already on
  // this page (no navigation, no remount) never re-fires it, so the newly
  // active account's fund table stayed empty until the user manually clicked
  // "Sell" on something. Mirror the mount effect's own seeding here: capture
  // the dollar total that was in progress for the OLD account, and if there
  // was one, compute a fresh automated-style recommendation for the NEW
  // account against that same total and seed the manual session from it —
  // the same "what would Automated suggest" starting point Manual mode
  // always seeds from on first arrival, just re-run at switch time instead
  // of only at mount time.
  function switchAccount(accountId: string) {
    if (accountId === activeAccountId) return
    const priorTotal = r2(Object.values(appliedAmounts).reduce((s, v) => s + v, 0) / 100)
    setActiveAccountId(accountId)
    if (priorTotal <= 0 || !portfolio) return
    const autoResult = runOptimization({
      portfolio,
      targetSaleAmount: priorTotal,
      activeAccountId: accountId,
      mode: 'automated',
      optimizationPriority,
      activeTaxRates,
    }) as Recommendation
    if (!autoResult.fund_results.length) return
    const ids = autoResult.fund_results.map(fr => fr.fund_id)
    setManualActiveFunds(ids)
    for (const fr of autoResult.fund_results) {
      setManualAppliedAmount(fr.fund_id, Math.round(fr.sell_amount * 100))
    }
    // Build the manual-mode config directly against the NEW account id,
    // rather than through runManualEngine() — that callback is memoized on
    // this render's closure, which still holds the OLD activeAccountId at
    // this point (the setActiveAccountId() call above updates the store
    // synchronously, but this component hasn't re-rendered to pick up a
    // freshly-bound runManualEngine yet). Routing through it here would
    // silently look these fund_ids up inside the wrong account's holdings
    // and produce an empty result all over again — the same stale-closure
    // trap this whole fix exists to route around.
    const fundSelectionsForEngine = autoResult.fund_results.map(fr => ({
      fund_id: fr.fund_id,
      accounting_method: toAccountingMethod('MinTax'),
      sell_amount: fr.sell_amount,
    }))
    const manualResult = runOptimization({
      portfolio,
      targetSaleAmount: priorTotal,
      activeAccountId: accountId,
      mode: 'manual',
      optimizationPriority,
      activeTaxRates,
      manualSelections: { fund_selections: fundSelectionsForEngine },
    }) as ManualConfiguration
    setManualConfig(manualResult)
    setFundResults(manualResult.fund_results)
  }

  // Track whether the user has explicitly changed something in Manual mode.
  // Pre-populated amounts from the Automated recommendation do NOT count as user changes.
  // The dialog only fires if the user has taken a deliberate action (Sell, Cancel, Apply).
  const [hasUserModified, setHasUserModified] = useState(false)
  const { showDialog: showModeDialog, handleToggleClick, handleSave, handleDiscard, handleClose } =
    useModeToggleGuard(hasUserModified)

  function handleSell(ticker: string) {
    setHasUserModified(true)
    setManualActiveFunds([...manualActiveFundIds, ticker])
    setManualAppliedAmount(ticker, 0)
  }

  function handleCancel(ticker: string) {
    setHasUserModified(true)
    setManualActiveFunds(manualActiveFundIds.filter(id => id !== ticker))
    clearManualAppliedAmount(ticker)
    const newAmounts = { ...appliedAmounts }
    delete newAmounts[ticker]
    const newFunds = new Set(activeFunds)
    newFunds.delete(ticker)
    // Re-run engine to clear this fund from results
    if (newFunds.size > 0 && Object.values(newAmounts).some(v => v > 0)) {
      runManualEngine(newAmounts, newFunds, costBasisMethods)
    } else {
      setFundResults([])
    }
  }

  // B2: "Review order" is disabled when any active SpecID fund has no confirmed lot selections
  const hasUnresolvedSpecID = Array.from(activeFunds).some(
    ticker => costBasisMethods[ticker] === 'SpecID' &&
      !Object.values(manualLotSelections[ticker] ?? {}).some(v => parseFloat(v) > 0)
  )

  // NF-1 dialog
  const [showResetDialog, setShowResetDialog] = useState(false)
  const [taxBracketOpen, setTaxBracketOpen] = useState(false)

  function handleConfirmReset() {
    setShowResetDialog(false)
    setManualActiveFunds([])
    navigate('/automated')
  }

  // REQ-B4-001: "Go to Scenario Analysis" → save/update scenario then navigate
  function handleGoToScenarios() {
    if (fundResults.length > 0) {
      const scenario = buildScenarioFromFundResults(fundResults, portfolio, activeTaxRates, null, activeAccountId)
      if (scenario) {
        if (activeScenarioId) {
          // Editing → update in place
          updateScenario(activeScenarioId, { ...scenario, scenario_id: activeScenarioId })
          setActiveScenarioId(null)
        } else if (scenarios.length < 3 && !isDuplicateScenario(scenario, scenarios)) {
          addScenario(scenario)
        }
      }
    }
    navigate('/scenarios')
  }

  return (
    <>
      {taxBracketOpen && <TaxBracketDialog onClose={() => setTaxBracketOpen(false)} />}
      {/* Target Allocation Modal */}
      {showAllocModal && (
        <TargetAllocationModal
          onClose={() => setShowAllocModal(false)}
          initialStocks={(portfolio?.target_allocation?.domestic_equity_pct ?? 0) + (portfolio?.target_allocation?.international_equity_pct ?? 0)}
          initialBonds={portfolio?.target_allocation?.domestic_bonds_pct ?? 35}
          initialReserves={portfolio?.target_allocation?.short_term_reserves_pct ?? 10}
          onSave={(stocks, bonds, reserves) => {
            if (!portfolio) return
            const oldTa = portfolio.target_allocation
            // Preserve domestic/international ratio within the new stocks total
            const oldStocks = (oldTa?.domestic_equity_pct ?? 40) + (oldTa?.international_equity_pct ?? 15)
            const ratio = oldStocks > 0 ? (oldTa?.domestic_equity_pct ?? 40) / oldStocks : 0.727
            const newDomestic = Math.round(stocks * ratio * 10) / 10
            const newIntl     = Math.round((stocks - newDomestic) * 10) / 10
            const updated = {
              ...portfolio,
              target_allocation: {
                allocation_id:           oldTa?.allocation_id ?? 'user-set',
                portfolio_id:            portfolio.portfolio_id,
                domestic_equity_pct:     newDomestic,
                international_equity_pct: newIntl,
                domestic_bonds_pct:      bonds,
                short_term_reserves_pct: reserves,
                fund_level_targets:      oldTa?.fund_level_targets ?? null,
                source:                  'user_set' as const,
                as_of_date:              new Date().toISOString().slice(0, 10),
              },
            }
            setPortfolio(updated)
            runManualEngine(appliedAmounts, activeFunds, costBasisMethods)
          }}
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

      {/* NF-1 — Reset confirmation dialog */}
      {showResetDialog && (
        <ResetDialog
          onCancel={() => setShowResetDialog(false)}
          onConfirm={handleConfirmReset}
        />
      )}

      <div className="flex flex-col items-start w-full">
        <div className="flex flex-col gap-6 py-10 w-full">

          {/* Row 1 — Page title + mode toggle */}
          <div className="flex items-center justify-between px-8 h-14">
            <h1 className="text-[30px] font-bold text-vg-ink whitespace-nowrap leading-normal">
              Sell &amp; Rebalance
            </h1>
            <div className="flex items-center gap-2">
              <div className="flex items-center border-[1.5px] border-vg-ink rounded-full p-[2px] bg-white h-[37px]">
                <button
                  onClick={handleToggleClick}
                  className="self-stretch flex items-center gap-1.5 px-4 rounded-[4px] text-[14px] font-bold text-vg-ink"
                >
                  <Sparkles size={16} className="text-vg-ink" />
                  Automated
                </button>
                <div className="self-stretch flex items-center gap-1.5 px-4 rounded-full bg-vg-teal">
                  <PenLine size={16} className="text-white" />
                  <span className="text-[14px] font-bold text-white">Manual</span>
                </div>
              </div>
              <CoachMark id="mode-toggle" text="Automated mode uses an AI optimization engine to recommend which funds to sell and how much, minimizing your estimated tax burden while improving portfolio allocation. Manual mode gives you direct control over fund selection, cost basis method, and individual lot choices." />
            </div>
          </div>

          {/* Assistant entry point — visible only while no fund row is
              currently active, reactive to the same live manualActiveFundIds
              state that already governs which rows render as active/editable,
              not a separate "has been shown" flag. */}
          {manualActiveFundIds.length === 0 && <FundSelectionAssistantEntry />}

          {/* Summary Banner — values from engine output (fundResults + manualConfig) when available */}
          {(() => {
            const totalSale = r2(fundResults.reduce((s, f) => s + f.sell_amount, 0))
            const salePct = portfolio ? r2((totalSale / portfolio.total_investable_balance) * 100) : 0
            const stGains = r2(fundResults.reduce((s, f) => s + f.est_st_gain_loss, 0))
            const ltGains = r2(fundResults.reduce((s, f) => s + f.est_lt_gain_loss, 0))
            // The same shared three-way branch (taxable_brokerage /
            // traditional_IRA / roth_IRA) engine/index.ts's runOptimization()
            // and scenarioBuilder.ts use — not a fourth hand-copied
            // implementation. This banner previously had its own inline
            // taxable-only gate (D057's original fix, for the Roth IRA case
            // only) — found still showing $0 for a live Traditional IRA sale
            // while live-verifying the Manual mode IRA tax fix, since it was
            // never updated when Traditional IRA's ordinary-income tax was
            // added to the engine (see DECISIONS.md's Manual mode IRA tax
            // fix entry).
            const estNetTax = computeNetTax(fundResults, activeAcct2?.account_type, activeTaxRates)
            const effRate = totalSale > 0 ? r2((estNetTax / totalSale) * 100) : 0
            // Allocation impact from manualConfig — computed by engine alongside fundResults
            const allocImpact = manualConfig?.allocation_impact ?? null
            const equityDelta = allocImpact ? r2(
              (allocImpact.domestic_equity_after + allocImpact.international_equity_after) -
              (allocImpact.domestic_equity_before + allocImpact.international_equity_before)
            ) : null
            const bondsDelta = allocImpact ? r2(allocImpact.domestic_bonds_after - allocImpact.domestic_bonds_before) : null
            const ai = fundResults.length > 0 ? { stGains, ltGains, estNetTax, effRate, totalSale, salePct } : null

            // IRA banner redesign — display/layout only, see accountBanner.ts.
            const rateDisplay = bannerRateDisplay(activeAcct2?.account_type, activeTaxRates)
            const showYtd = bannerShowYtdRealized(activeAcct2?.account_type)
            const showSeparateGainLoss = bannerShowSeparateGainLoss(activeAcct2?.account_type)
            const combinedGainLoss = ai ? ai.stGains + ai.ltGains : null
            const netTaxLabel = bannerNetTaxLabel(activeAcct2?.account_type)
            const showPenalty = bannerShowEarlyWithdrawalPenalty(activeAcct2?.account_type)
            return (
          <div className="flex items-center px-8 w-full relative">
            <div className="flex flex-1 items-start bg-[#e8f5f0] px-6 py-4">

              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">SALE TOTAL</span>
                <span className="text-[20px] font-bold text-vg-ink whitespace-nowrap">{ai ? formatCurrencyCompact(ai.totalSale) : '—'}</span>
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{ai && portfolio ? formatPercent(ai.salePct, true) + ' of ' + formatCurrency(portfolio.total_investable_balance) : '0.0% of portfolio'}</span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">{rateDisplay.label}</span>
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{rateDisplay.value}</span>
                {rateDisplay.changeable && (
                  <a onClick={() => setTaxBracketOpen(true)} className="text-[12px] text-[#1255cc] underline cursor-pointer whitespace-nowrap">Change</a>
                )}
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              {showYtd && (
                <>
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
                </>
              )}
              {showSeparateGainLoss ? (
                <>
                  <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. ST GAINS</span>
                    <span className={`text-[16px] font-bold whitespace-nowrap ${ai && ai.stGains > 0 ? 'text-[#007a00]' : ai && ai.stGains < 0 ? 'text-vg-red' : 'text-vg-ink'}`}>
                      {ai ? fmtSigned(ai.stGains) : '—'}
                    </span>
                  </div>
                  <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
                  <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. LT GAINS</span>
                    <span className={`text-[16px] font-bold whitespace-nowrap ${ai && ai.ltGains > 0 ? 'text-[#007a00]' : ai && ai.ltGains < 0 ? 'text-vg-red' : 'text-vg-ink'}`}>
                      {ai ? fmtSigned(ai.ltGains) : '—'}
                    </span>
                  </div>
                  <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">{CONSOLIDATED_GAIN_LOSS_LABEL}</span>
                    <span className={`text-[16px] font-bold whitespace-nowrap ${combinedGainLoss !== null && combinedGainLoss > 0 ? 'text-[#007a00]' : combinedGainLoss !== null && combinedGainLoss < 0 ? 'text-vg-red' : 'text-vg-ink'}`}>
                      {combinedGainLoss !== null ? fmtSigned(combinedGainLoss) : '—'}
                    </span>
                  </div>
                  <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
                </>
              )}
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">{netTaxLabel}</span>
                  <CoachMark id="tax" text="This figure updates as you adjust your sell amounts. It reflects your estimated capital gains tax on the shares you've selected, at your current rate assumption." />
                </div>
                <span className="text-[16px] font-bold text-vg-ink whitespace-nowrap">{ai ? formatCurrency(ai.estNetTax) : '—'}</span>
                {ai && (
                  <ExpandableDetail label="Breakdown">
                    <TaxBreakdownPanel
                      accountType={activeAcct2?.account_type}
                      funds={fundResults}
                      taxRates={activeTaxRates}
                      saleTotal={ai.totalSale}
                    />
                  </ExpandableDetail>
                )}
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              {showPenalty && (
                <>
                  <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">{EARLY_WITHDRAWAL_PENALTY_LABEL}</span>
                    <span className="text-[16px] font-bold text-vg-ink whitespace-nowrap">{EARLY_WITHDRAWAL_PENALTY_VALUE}</span>
                    <ExpandableDetail label="Why?">
                      <p className="text-[11.5px] text-vg-ink-muted leading-relaxed">{EARLY_WITHDRAWAL_PENALTY_NOTE}</p>
                    </ExpandableDetail>
                  </div>
                  <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
                </>
              )}
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
            </div>
          </div>
          )})()}

          {/* Fund Table — relative wrapper anchors Allocation + Harvestable Loss marks */}
          <div className="flex flex-col items-start px-8 w-full">
            <div className="flex flex-col items-start w-full border border-[#e8e9e9] relative">
              {(() => {
                // Column header + fund rows for whichever account is active.
                // Computed once, rendered directly under that account's own
                // header row below — never a separately-positioned block, so
                // heading and funds can never refer to different accounts
                // and the row itself never has to move to "become" active (D058).
                const fundTableSection = (
                  <>
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

                    {/* Fund rows — active funds first (portfolio order within group), then inactive funds.
                        This keeps pre-populated funds (from Automated recommendation) adjacent and stable;
                        activating/deactivating a fund moves it between groups but never splits active rows. */}
                    {(() => {
                      const allHoldings = activeAcct2?.holdings ?? []
                      return [
                        ...allHoldings.filter(h => activeFunds.has(h.fund_id)),
                        ...allHoldings.filter(h => !activeFunds.has(h.fund_id)),
                      ].map(h => ({ holding: h, accountType: activeAcct2!.account_type }))
                    })().map(({ holding, accountType }) => {
                      const fund: FundRow = {
                        ticker: holding.fund_id,
                        fullName: holding.fund_name,
                        shares: formatShares(holding.total_shares),
                        balance: formatCurrency(holding.current_balance),
                        assetClass: holding.asset_class.replace('_', ' '),
                        balanceCents: Math.round(holding.current_balance * 100),
                      }
                      const engineResult = fundResults.find(fr => fr.fund_id === holding.fund_id)
                      if (activeFunds.has(fund.ticker)) {
                        return (
                          <ActiveFundRow
                            key={fund.ticker}
                            fund={fund}
                            taxData={taxDataFromResult(engineResult)}
                            narrationInput={engineResult && portfolio ? buildFundResultNarrationInput({
                              fundResults: [engineResult],
                              portfolio,
                              accountType,
                              segment: demoSettings.narrationSegment,
                              est_net_tax: manualEstNetTax,
                              effective_rate: manualEffRate,
                              // No est_early_withdrawal_penalty here — ManualConfiguration
                              // has no such field (D083/D085 deliberately didn't thread it
                              // through), so this is correctly omitted rather than guessed.
                            }) : null}
                            narrationProvider={demoSettings.narrationProvider ?? undefined}
                            appliedCents={appliedAmounts[fund.ticker] ?? 0}
                            currentMethod={costBasisMethods[fund.ticker] ?? 'MinTax'}
                            onApply={handleApplyAmount}
                            onMethodChange={handleMethodChange}
                            onLotDetails={(ticker, ro) => handleLotDetails(ticker, ro)}
                            showAllocationHint={holding.asset_class === 'domestic_equity'}
                            showHarvestableHint={(holding.total_unrealized_gain_loss ?? 0) < 0}
                            showCostBasisHint={fund.ticker === 'VTSAX'}
                            showLotDetailsHint={fund.ticker === 'VTSAX'}
                            onCancel={() => handleCancel(fund.ticker)}
                          />
                        )
                      }
                      return (
                        <InactiveFundRow
                          key={fund.ticker}
                          fund={fund}
                          onSell={() => handleSell(fund.ticker)}
                        />
                      )
                    })}
                  </>
                )

                // All three accounts render in fixed canonical order (Taxable
                // Brokerage → Traditional IRA → Roth IRA) regardless of which
                // is active — selecting an account only swaps which row's
                // fund table expands beneath it, never row position (D058).
                // Replaces the old activeAcct2-hardcoded-first-block +
                // otherAccounts.map() split, which moved the selected
                // account into a fixed top slot on every switch.
                return accountsInCanonicalOrder.map(acct => {
                  const isActive = acct.account_id === activeAccountId
                  return (
                    <div key={acct.account_id} className="flex flex-col items-start w-full">
                      <div
                        className="flex h-16 items-center px-4 bg-[#f8f8f8] border-b border-[#e8e9e9] w-full cursor-pointer"
                        onClick={() => switchAccount(acct.account_id)}
                      >
                        <RadioDot selected={isActive} />
                        <div className="w-2 shrink-0" />
                        <div className="flex gap-1 items-center flex-wrap">
                          <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{accountTypeLabel(acct.account_type)}</span>
                          <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{acct.masked_number}</span>
                          {acct.rmd_record && (
                            <>
                              <div className="w-2 shrink-0" />
                              <div className="flex items-center gap-1 px-2 py-[2px] rounded-full bg-[#e07000]">
                                <span className="text-[9px] font-bold text-white tracking-[0.36px] whitespace-nowrap">
                                  Remaining 2026 RMD: {formatCurrency(Math.round(acct.rmd_record.rmd_remaining))}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex-1" />
                        <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{accountAllocStr(acct)}</span>
                        <div className="w-4 shrink-0" />
                        <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{formatCurrency(acct.account_balance)}</span>
                        <div className="w-4 shrink-0" />
                        {isActive && <ChevronDown size={24} className="text-vg-ink shrink-0" />}
                      </div>
                      {isActive && fundTableSection}
                    </div>
                  )
                })
              })()}
            </div>
          </div>

          {/* Footer Bar — Figma 382:1563/1564
              "↩ Reset to system recommendation" (ghost-link → NF-1 dialog) pinned
              left, "Review order" (primary) + "Go to Scenario Analysis"
              (secondary) grouped right — same justify-between pattern as
              Automated mode's own footer and Execution Confirmation's "View
              transaction history →" / "Start a new sale" pairing, not new
              spacing invented for this screen (see DECISIONS.md, incidental
              cleanup entry). */}
          <div className="flex items-center justify-between px-8 w-full">
            <button
              onClick={() => setShowResetDialog(true)}
              className="text-[14px] text-[#1255cc] underline cursor-pointer whitespace-nowrap hover:opacity-80"
            >
              ↩ Reset to system recommendation
            </button>
            <div className="flex gap-3 items-center">
              <div className="relative group">
                <button
                  onClick={() => !hasUnresolvedSpecID && navigate('/confirm')}
                  disabled={hasUnresolvedSpecID}
                  className={`h-[48px] px-7 rounded-full text-[14px] font-bold whitespace-nowrap transition-opacity ${
                    hasUnresolvedSpecID
                      ? 'bg-vg-ink/30 text-white cursor-not-allowed'
                      : 'bg-vg-ink text-white hover:opacity-90'
                  }`}
                >
                  Review order
                </button>
                {hasUnresolvedSpecID && (
                  <div className="absolute bottom-full left-0 mb-2 w-56 bg-vg-ink text-white text-[12px] rounded px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    Enter lot quantities for all SpecID funds before reviewing your order.
                  </div>
                )}
              </div>
              <div className="relative group">
                <button
                  onClick={() => !hasUnresolvedSpecID && handleGoToScenarios()}
                  disabled={hasUnresolvedSpecID}
                  className={`h-[48px] px-7 rounded-full border-[1.5px] text-[14px] font-bold whitespace-nowrap transition-opacity ${
                    hasUnresolvedSpecID
                      ? 'border-vg-ink/30 text-vg-ink/30 bg-white cursor-not-allowed'
                      : 'border-vg-ink text-vg-ink bg-white hover:opacity-90'
                  }`}
                >
                  Go to Scenario Analysis
                </button>
                {hasUnresolvedSpecID && (
                  <div className="absolute bottom-full left-0 mb-2 w-56 bg-vg-ink text-white text-[12px] rounded px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    Enter lot quantities for all SpecID funds before proceeding.
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
