import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, PenLine } from 'lucide-react'
import { TargetAllocationModal } from '../components/TargetAllocationModal'
import { CoachMark } from '../components/CoachMark'
import { useAppStore } from '../store/useAppStore'
import { runOptimization, shortAssetClass } from '../engine/index'
import type { Recommendation } from '../types'
import { formatCurrency, formatCurrencyCompact, formatShares, formatPercent, accountAllocStr } from '../utils/format'
import { buildScenarioFromRecommendation, isDuplicateScenario } from '../utils/scenarioBuilder'

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? 'border-vg-ink' : 'border-vg-ink-muted'}`}>
      {selected && <div className="w-2 h-2 rounded-full bg-vg-ink" />}
    </div>
  )
}

// For values not covered by format.ts (integer % rates, 2-decimal %, 1-decimal impact %)
function fmtPct1(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)
}
function fmtPct2(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function fmtSigned(n: number): string {
  return (n >= 0 ? '+' : '−') + formatCurrency(Math.abs(n))
}

export default function FundSelectionAutomated() {
  const navigate = useNavigate()

  const {
    portfolio, targetSaleAmount, activeAccountId, optimizationPriority, activeTaxRates,
    recommendation, setRecommendation, setTargetSaleAmount, setOptimizationPriority,
    scenarios, addScenario, updateScenario, activeScenarioId, setActiveScenarioId, setPortfolio,
    setMode,
  } = useAppStore()

  // Local input state for the amount field (display only — store is source of truth)
  const [inputDisplay, setInputDisplay] = useState(
    targetSaleAmount ? formatCurrency(targetSaleAmount) : ''
  )
  const [inputDollars, setInputDollars] = useState(targetSaleAmount ?? 0)
  const [isDirty, setIsDirty] = useState(false)

  // Sync input when targetSaleAmount is changed externally (e.g., discard from Manual, or
  // startEditingScenario restoring a saved amount). Only fires on external changes — not while
  // the user is actively typing (those don't write targetSaleAmount until Calculate is clicked).
  useEffect(() => {
    if (targetSaleAmount === null) {
      setInputDisplay('')
      setInputDollars(0)
      setIsDirty(false)
    } else {
      setInputDisplay(formatCurrency(targetSaleAmount))
      setInputDollars(targetSaleAmount)
      setIsDirty(false)
    }
  }, [targetSaleAmount])

  const [showAllocModal, setShowAllocModal] = useState(false)

  // ── Engine call ──────────────────────────────────────────────────────────

  const runEngine = useCallback((amount: number, priority: typeof optimizationPriority) => {
    if (!portfolio || amount <= 0) return
    const result = runOptimization({
      portfolio,
      targetSaleAmount: amount,
      activeAccountId,
      mode: 'automated',
      optimizationPriority: priority,
      activeTaxRates,
    })
    setRecommendation(result as Recommendation)
  }, [portfolio, activeAccountId, activeTaxRates, setRecommendation])

  // Run engine on mount if recommendation is null or stale
  useEffect(() => {
    const amt = targetSaleAmount ?? 0
    if (amt > 0 && !recommendation) {
      runEngine(amt, optimizationPriority)
    }
  }, []) // intentionally run once on mount

  // ── Derived display values ───────────────────────────────────────────────

  const rec = recommendation as Recommendation | null
  // Use targetSaleAmount (user-entered, store-persisted) for SALE TOTAL — the engine's
  // fund allocation totals may differ slightly from the entered target due to lot sizing.
  const totalSale = targetSaleAmount ?? (rec ? rec.fund_results.reduce((s, f) => s + f.sell_amount, 0) : 0)
  const salePct = portfolio ? (totalSale / portfolio.total_investable_balance) * 100 : 0

  const estSTGains = rec ? rec.fund_results.reduce((s, f) => s + f.est_st_gain_loss, 0) : null
  const estLTGains = rec ? rec.fund_results.reduce((s, f) => s + f.est_lt_gain_loss, 0) : null
  const estNetTax = rec?.est_net_tax ?? null
  const effectiveRate = rec?.effective_rate ?? null

  const ytd = portfolio?.ytd_gains_record
  const taxRates = activeTaxRates

  // Account data from store
  const accounts = portfolio?.accounts ?? []
  const taxableAcct = accounts.find(a => a.account_id === activeAccountId)
  const iraAcct = accounts.find(a => a.account_type === 'traditional_IRA')
  const rothAcct = accounts.find(a => a.account_type === 'roth_IRA')

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Allow digits and one decimal point with up to 2 decimal places.
    // The user types plain dollars — no cent-based conversion.
    const raw = e.target.value.replace(/[^0-9.]/g, '')
    // Keep only the first decimal point, max 2 decimal places
    const firstDot = raw.indexOf('.')
    const normalized = firstDot === -1
      ? raw
      : raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '').slice(0, 2)
    const dollars = parseFloat(normalized) || 0
    setInputDollars(dollars)
    setInputDisplay(normalized)
    setIsDirty(dollars !== (targetSaleAmount ?? 0))
  }

  function handleFocus() {
    if (inputDollars > 0) setInputDisplay(String(inputDollars))
  }

  // On blur: format raw typed value to currency display without triggering engine
  function handleBlur() {
    if (inputDollars > 0) {
      setInputDisplay(formatCurrency(inputDollars))
    }
  }

  function handleRecalculate() {
    if (inputDollars <= 0) return
    setTargetSaleAmount(inputDollars)
    setIsDirty(false)
    runEngine(inputDollars, optimizationPriority)
  }

  // REQ-A5-004: "Go to Scenario Analysis" → save/update scenario then navigate
  function handleGoToScenarios() {
    if (rec) {
      const scenario = buildScenarioFromRecommendation(rec, portfolio, activeTaxRates)
      if (activeScenarioId) {
        // Editing an existing scenario → update it in place (Fix 2)
        updateScenario(activeScenarioId, { ...scenario, scenario_id: activeScenarioId })
        setActiveScenarioId(null)
      } else if (scenarios.length < 3 && !isDuplicateScenario(scenario, scenarios)) {
        // New scenario → add it
        addScenario(scenario)
      }
    }
    navigate('/scenarios')
  }

  function handleOptMode(priority: 'tax-first' | 'balance-first') {
    setOptimizationPriority(priority)
    runEngine(targetSaleAmount ?? 0, priority)
  }

  // ── Allocation impact display ─────────────────────────────────────────────

  const ai = rec?.allocation_impact
  const equityDelta = ai ? ((ai.domestic_equity_after + ai.international_equity_after) - (ai.domestic_equity_before + ai.international_equity_before)) : null
  const bondsDelta  = ai ? (ai.domestic_bonds_after - ai.domestic_bonds_before) : null

  return (
    <>
      {showAllocModal && (
        <TargetAllocationModal
          onClose={() => setShowAllocModal(false)}
          initialStocks={(portfolio?.target_allocation?.domestic_equity_pct ?? 0) + (portfolio?.target_allocation?.international_equity_pct ?? 0)}
          initialBonds={portfolio?.target_allocation?.domestic_bonds_pct ?? 35}
          initialReserves={portfolio?.target_allocation?.short_term_reserves_pct ?? 10}
          onSave={(stocks, bonds, reserves) => {
            if (!portfolio) return
            const oldTa = portfolio.target_allocation
            const oldStocks = (oldTa?.domestic_equity_pct ?? 40) + (oldTa?.international_equity_pct ?? 15)
            const ratio = oldStocks > 0 ? (oldTa?.domestic_equity_pct ?? 40) / oldStocks : 0.727
            const newDomestic = Math.round(stocks * ratio * 10) / 10
            const newIntl     = Math.round((stocks - newDomestic) * 10) / 10
            const updated = {
              ...portfolio,
              target_allocation: {
                allocation_id: oldTa?.allocation_id ?? 'user-set',
                portfolio_id: portfolio.portfolio_id,
                domestic_equity_pct: newDomestic,
                international_equity_pct: newIntl,
                domestic_bonds_pct: bonds,
                short_term_reserves_pct: reserves,
                fund_level_targets: oldTa?.fund_level_targets ?? null,
                source: 'user_set' as const,
                as_of_date: new Date().toISOString().slice(0, 10),
              },
            }
            setPortfolio(updated)
            runEngine(targetSaleAmount ?? 0, optimizationPriority)
          }}
        />
      )}

      <div className="flex flex-col items-start w-full">
        <div className="flex flex-col gap-6 py-10 w-full">

          {/* Row 1 — Title + mode toggle */}
          <div className="flex items-center justify-between px-8 h-14">
            <h1 className="text-[30px] font-bold text-vg-ink whitespace-nowrap leading-normal">Sell &amp; Rebalance</h1>
            <div className="flex items-center gap-2">
              <div className="flex items-center border-[1.5px] border-vg-ink rounded-full p-[2px] bg-white h-[37px]">
                <div className="self-stretch flex items-center gap-1.5 px-4 rounded-full bg-vg-teal">
                  <Sparkles size={16} className="text-white" />
                  <span className="text-[14px] font-bold text-white">Automated</span>
                </div>
                <button onClick={() => { setMode('manual'); navigate('/manual-2') }} className="self-stretch flex items-center gap-1.5 px-4 rounded-[4px] text-[14px] font-bold text-vg-ink">
                  <PenLine size={16} className="text-vg-ink" />Manual
                </button>
              </div>
              <CoachMark id="mode-toggle" text="Automated mode uses an AI optimization engine to recommend which funds to sell and how much, minimizing your estimated tax burden while improving portfolio allocation. Manual mode gives you direct control over fund selection, cost basis method, and individual lot choices." />
            </div>
          </div>

          {/* Row 2 — Amount input + Recalculate + Optimization priority */}
          <div className="flex items-end gap-3 px-8 w-full">
            <div className="flex flex-col gap-2 shrink-0">
              <label className="text-[12px] text-vg-ink-muted whitespace-nowrap">Total sell amount</label>
              <input
                type="text"
                inputMode="decimal"
                value={inputDisplay}
                onChange={handleAmountChange}
                onFocus={handleFocus}
                onKeyDown={e => e.key === 'Enter' && handleRecalculate()}
                onBlur={handleBlur}
                className="w-[200px] h-[48px] px-3 border border-vg-ink rounded-[4px] text-[14px] text-vg-ink text-right bg-white focus:outline-none focus:ring-2 focus:ring-vg-ink/20"
              />
            </div>
            {/* Issue 3: label is "Calculate" on first entry, "Recalculate" when a recommendation exists */}
            <button
              onClick={handleRecalculate}
              disabled={inputDollars <= 0 || (!!recommendation && !isDirty)}
              className="h-[48px] px-7 rounded-full border-[1.5px] border-vg-ink text-[14px] font-bold text-vg-ink bg-white shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {recommendation ? 'Recalculate' : 'Calculate'}
            </button>
            <div className="ml-auto flex flex-col gap-2 shrink-0">
              <div className="flex items-center gap-1">
                <label className="text-[12px] text-vg-ink-muted whitespace-nowrap">Optimization priority</label>
                <CoachMark id="opt-priority" text="Optimization priority determines how funds are selected: Tax-first minimizes estimated capital gains tax by prioritizing loss harvesting. Balance-first prioritizes correcting your portfolio's asset allocation toward your target." />
              </div>
              <div className="flex items-center border border-vg-ink rounded-full p-[2px] h-[36px]">
                {(['tax-first', 'balance-first'] as const).map(p => (
                  <button key={p} onClick={() => handleOptMode(p)}
                    className={`flex items-center justify-center px-[12px] h-full rounded-full text-[14px] font-bold whitespace-nowrap transition-colors ${optimizationPriority === p ? 'bg-vg-ink text-white' : 'text-vg-ink'}`}
                  >
                    {p === 'tax-first' ? 'Tax-first' : 'Balance-first'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Summary Banner */}
          <div className="flex items-center px-8 w-full relative">
            <div className="flex flex-1 items-start bg-[#e8f5f0] px-6 py-4">

              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">SALE TOTAL</span>
                <span className="text-[20px] font-bold text-vg-ink whitespace-nowrap">{formatCurrencyCompact(totalSale)}</span>
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{formatPercent(salePct, true)} of {portfolio ? formatCurrency(portfolio.total_investable_balance) : '—'}</span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />

              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">TAX BRACKET</span>
                  <CoachMark id="tax" text="We're using a mid-range tax rate as a starting point. If you know your bracket, you can select it below for a more accurate estimate." />
                </div>
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{Math.round(taxRates.st_rate * 100)}% ST / {Math.round(taxRates.lt_rate * 100)}% LT</span>
                <a className="text-[12px] text-[#1255cc] underline cursor-pointer whitespace-nowrap">Change</a>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />

              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">YTD REALIZED</span>
                  <CoachMark id="ytd" text="This shows capital gains you've already realized this year. Selling more shares adds to this total." />
                </div>
                {ytd ? (
                  <>
                    <span className="text-[12px] text-vg-ink whitespace-nowrap">ST {formatCurrency(ytd.st_gains_realized_ytd)}</span>
                    <span className="text-[12px] text-vg-ink whitespace-nowrap">LT {formatCurrency(ytd.lt_gains_realized_ytd)}</span>
                  </>
                ) : <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">—</span>}
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />

              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. ST GAINS</span>
                <span className={`text-[16px] font-bold whitespace-nowrap ${estSTGains !== null && estSTGains > 0 ? 'text-[#007a00]' : estSTGains !== null && estSTGains < 0 ? 'text-vg-red' : 'text-vg-ink'}`}>
                  {estSTGains !== null ? fmtSigned(estSTGains) : '—'}
                </span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />

              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. LT GAINS</span>
                <span className={`text-[16px] font-bold whitespace-nowrap ${estLTGains !== null && estLTGains > 0 ? 'text-[#007a00]' : estLTGains !== null && estLTGains < 0 ? 'text-vg-red' : 'text-vg-ink'}`}>
                  {estLTGains !== null ? fmtSigned(estLTGains) : '—'}
                </span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />

              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. NET TAX</span>
                <span className="text-[16px] font-bold text-vg-ink whitespace-nowrap">{estNetTax !== null ? formatCurrency(estNetTax) : '—'}</span>
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">
                  {effectiveRate !== null ? `${fmtPct2(effectiveRate * 100)}% effective rate` : ''}
                </span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />

              <div className="flex flex-col gap-0.5 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">IMPACT</span>
                {equityDelta !== null && (
                  <div className="flex gap-1.5 items-center">
                    <span className="text-[12px] text-vg-ink">Stocks</span>
                    <span className={`text-[12px] ${equityDelta <= 0 ? 'text-[#007a00]' : 'text-vg-red'}`}>{equityDelta <= 0 ? '−' : '+'}{fmtPct1(Math.abs(equityDelta))}%</span>
                  </div>
                )}
                {bondsDelta !== null && (
                  <div className="flex gap-1.5 items-center">
                    <span className="text-[12px] text-vg-ink">Bonds</span>
                    <span className={`text-[12px] ${bondsDelta >= 0 ? 'text-[#007a00]' : 'text-vg-red'}`}>{bondsDelta >= 0 ? '+' : '−'}{fmtPct1(Math.abs(bondsDelta))}%</span>
                  </div>
                )}
                <a className="text-[10px] text-[#1255cc] underline cursor-pointer whitespace-nowrap" onClick={() => setShowAllocModal(true)}>
                  Target allocation
                </a>
              </div>

            </div>

          </div>

          {/* Fund Table */}
          <div className="flex flex-col items-start px-8 w-full">
            <div className="flex flex-col items-start w-full border border-[#e8e9e9]">

              {/* Taxable Brokerage account header */}
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
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{taxableAcct ? formatCurrency(taxableAcct.account_balance) : '—'}</span>
                <div className="w-4 shrink-0" />
              </div>

              {/* Column header */}
              <div className="flex h-9 items-center px-3 bg-[#f8f8f8] border border-[#e0e0e0] w-full shrink-0">
                <div className="w-[280px] px-2 flex items-center h-full shrink-0"><span className="text-[12px] font-semibold text-vg-ink">FUND</span></div>
                <div className="w-[140px] px-2 flex items-center h-full shrink-0"><span className="text-[12px] font-semibold text-vg-ink">POSITION</span></div>
                <div className="flex-1" />
              </div>

              {/* Engine-driven fund rows */}
              {rec?.fund_results.map(fr => {
                const holding = taxableAcct?.holdings.find(h => h.fund_id === fr.fund_id)
                const stGain = fr.est_st_gain_loss
                const ltGain = fr.est_lt_gain_loss
                return (
                  <div key={fr.fund_id} className="flex flex-col border-b border-[#e8e9e9] w-full bg-white">
                    <div className="flex h-16 items-center overflow-hidden px-3 w-full">
                      <div className="w-[280px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
                        <span className="text-[13px] text-vg-ink-muted truncate">{holding?.fund_name ?? fr.fund_id}</span>
                        <a className="text-[14px] font-bold text-[#1255cc] underline whitespace-nowrap">{fr.fund_id}</a>
                      </div>
                      <div className="w-[140px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
                        <span className="text-[11px] text-vg-ink-muted whitespace-nowrap">{holding ? formatShares(holding.total_shares) : '—'} shares</span>
                        <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{holding ? formatCurrency(holding.current_balance) : '—'}</span>
                      </div>
                      <div className="w-[128px] h-full flex flex-col justify-center gap-[3px] px-1 shrink-0 overflow-hidden">
                        <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">SELL AMOUNT</span>
                        <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{formatCurrency(fr.sell_amount)}</span>
                      </div>
                      <div className="w-[130px] h-full shrink-0" />
                      <div className="w-[160px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden text-vg-ink-muted">
                        <span className="text-[12px] whitespace-nowrap">Cost Basis Method</span>
                        <span className="text-[14px] font-bold whitespace-nowrap">{fr.accounting_method}</span>
                      </div>
                      <div className="w-[95px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
                        <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. ST GAINS</span>
                        <span className={`text-[14px] font-bold whitespace-nowrap ${stGain > 0 ? 'text-[#007a00]' : stGain < 0 ? 'text-vg-red' : 'text-vg-ink'}`}>{stGain !== 0 ? fmtSigned(stGain) : formatCurrency(0)}</span>
                      </div>
                      <div className="w-[95px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
                        <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. LT GAINS</span>
                        <span className={`text-[14px] font-bold whitespace-nowrap ${ltGain > 0 ? 'text-[#007a00]' : ltGain < 0 ? 'text-vg-red' : 'text-vg-ink'}`}>{ltGain !== 0 ? fmtSigned(ltGain) : formatCurrency(0)}</span>
                      </div>
                      <div className="w-[85px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
                        <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. TAX</span>
                        <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{formatCurrency(fr.est_tax_gross)}</span>
                      </div>
                      <div className="w-[110px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
                        <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">IMPACT</span>
                        <span className={`text-[12px] font-semibold whitespace-nowrap ${fr.impact_pct <= 0 ? 'text-[#007a00]' : 'text-vg-red'}`}>
                          {fr.impact_pct <= 0 ? '−' : '+'}{fmtPct1(Math.abs(fr.impact_pct))}% {shortAssetClass(fr.impact_asset_class)}
                        </span>
                      </div>
                      <div className="flex-1 h-full" />
                    </div>
                    <div className="flex h-8 items-center px-4 w-full bg-white">
                      <p className="text-[13px] italic text-vg-ink-muted">{fr.rationale}</p>
                    </div>
                  </div>
                )
              })}

              {/* Placeholder when engine hasn't run yet */}
              {!rec && (
                <div className="flex h-16 items-center px-4 w-full bg-white border-b border-[#e8e9e9]">
                  <span className="text-[14px] text-vg-ink-muted italic">Generating recommendation…</span>
                </div>
              )}

              {/* Traditional IRA */}
              <div className="flex h-16 items-center px-4 bg-[#f8f8f8] border-b border-[#e8e9e9] w-full">
                <RadioDot selected={false} />
                <div className="w-2 shrink-0" />
                <div className="flex gap-1 items-center flex-wrap">
                  <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">Traditional IRA</span>
                  <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{iraAcct?.masked_number ?? '...2973'}</span>
                  {iraAcct?.rmd_record && (
                    <>
                      <div className="w-2 shrink-0" />
                      <div className="flex items-center gap-1 px-2 py-[2px] rounded-full bg-[#e07000]">
                        <span className="text-[9px] font-bold text-white tracking-[0.36px] whitespace-nowrap">
                          Remaining 2026 RMD: {formatCurrency(Math.round(iraAcct.rmd_record.rmd_remaining))}
                        </span>
                      </div>
                    </>
                  )}
                </div>
                <div className="flex-1" />
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{iraAcct ? accountAllocStr(iraAcct) : ''}</span>
                <div className="w-4 shrink-0" />
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{iraAcct ? formatCurrency(iraAcct.account_balance) : '—'}</span>
                <div className="w-4 shrink-0" />
              </div>

              {/* Roth IRA */}
              <div className="flex h-16 items-center px-4 bg-[#f8f8f8] border-b border-[#e8e9e9] w-full">
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
              </div>

            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-3 items-center justify-end px-8 w-full">
            <button onClick={() => navigate('/confirm')} className="h-[48px] px-7 rounded-full bg-vg-ink text-white text-[14px] font-bold whitespace-nowrap hover:opacity-90 transition-opacity">Review order</button>
            <button onClick={handleGoToScenarios} className="h-[48px] px-7 rounded-full border-[1.5px] border-vg-ink text-vg-ink bg-white text-[14px] font-bold whitespace-nowrap hover:opacity-90 transition-opacity">Go to Scenario Analysis</button>
            <CoachMark id="scenario-analysis" text="Scenario Analysis shows the full tax impact and asset mix effect of your current selection, and lets you compare up to 3 different scenarios side by side before committing to a transaction." />
          </div>

        </div>
      </div>
    </>
  )
}
