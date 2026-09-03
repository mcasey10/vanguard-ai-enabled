import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Sparkles, PenLine } from 'lucide-react'
import { CoachMark } from '../components/CoachMark'
import { FundSelectionAssistantEntry } from '../components/FundSelectionAssistantEntry'
import { useAppStore } from '../store/useAppStore'
import { loadPortfolio } from '../data/loader'
import { formatCurrency } from '../utils/format'

export default function FundSelectionEntry() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { mode: storeMode, setTargetSaleAmount, setMode, startNewScenario, resetSession, setPortfolio, setDemoSettings, seedScenariosOnce } = useAppStore()

  // /?reset=true — clears all localStorage and in-memory session state, then redirects to /
  useEffect(() => {
    if (searchParams.get('reset') === 'true') {
      localStorage.removeItem('vsr_portfolio_state')
      localStorage.removeItem('vsr_coach_marks_dismissed')
      window.dispatchEvent(new Event('vsr-reset'))
      setPortfolio(loadPortfolio())  // reload canonical dataset into Zustand store
      resetSession()
      // Explicitly clear scenarios and mark seeding as already-done (D109) —
      // resetSession() deliberately does NOT touch scenarios (see its own
      // comment in useAppStore.ts; it's also called from ExecutionSummary.tsx
      // after every completed transaction, where wiping saved comparison
      // scenarios would be wrong). But this flow starts from a genuine hard
      // reload (window.location.href, DemoSettingsDialog.tsx), which resets
      // scenarios/scenariosSeeded to their in-memory defaults regardless —
      // scenarios has no persist() (same as most of this store). Left alone,
      // the next /scenarios visit would see scenariosSeeded: false and
      // legitimately reseed the 3 canonical demo scenarios, exactly as a
      // genuine first-ever visit should — except this isn't that; it's a
      // deliberate reset, and "Reset demo" already clears comparably scoped
      // data (transactions, coach marks). seedScenariosOnce([]) marks
      // seeding as done with an empty result, so the next visit correctly
      // shows "No scenarios to compare" instead of silently restoring the 3
      // canonical scenarios the user may have just explicitly deleted.
      seedScenariosOnce([])
      // Provider choices revert to the real env-var default on a full reset
      // (D073) — going through the store's own setter, not a standalone
      // localStorage write, so the in-memory demoSettings updates too (this
      // reset flow uses client-side navigate() below, not a real page
      // reload, so nothing else would pick up a localStorage-only change).
      // Segment intentionally does NOT reset here — it's a UI-tone
      // preference, not demo data (D071's original reasoning, unchanged).
      // Tax bracket selection also resets (D081): resetSession() above
      // doesn't clear activeTaxRates, but this whole flow began with a real
      // hard navigation to /?reset=true, so the store already reinitialized
      // to its default activeTaxRates (24%/15%) before this effect ever
      // ran — leaving a stale persisted filing-status/income-band pair
      // would reopen the dialog showing a selection that no longer matches
      // the actual reset rate. Same reasoning as providers, not segment.
      setDemoSettings({ narrationProvider: null, whatifProvider: null, taxBracketFilingStatus: null, taxBracketIncomeMin: null })
      navigate('/', { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [inputDisplay, setInputDisplay] = useState('')  // what the input shows
  const [amountDollars, setAmountDollars] = useState(0) // parsed dollar value
  const [mode, setLocalMode] = useState<'automated' | 'manual'>(storeMode)

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9.]/g, '')
    const firstDot = raw.indexOf('.')
    const normalized = firstDot === -1
      ? raw
      : raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '').slice(0, 2)
    const dollars = parseFloat(normalized) || 0
    setAmountDollars(dollars)
    setInputDisplay(normalized)
  }

  function handleFocus() {
    if (amountDollars > 0) setInputDisplay(String(amountDollars))
  }

  function handleBlur() {
    if (amountDollars > 0) setInputDisplay(formatCurrency(amountDollars))
  }

  function handleModeChange(m: 'automated' | 'manual') {
    if (m === 'manual') {
      // Manual mode doesn't need a total sell amount — go straight to the fund table.
      // Clear any stale session state so FS-MAN-2 starts with all funds inactive.
      startNewScenario()
      setMode('manual')
      navigate('/manual-2')
      return
    }
    setLocalMode(m)
  }

  function handleSubmit() {
    if (amountDollars <= 0) return
    setTargetSaleAmount(amountDollars)
    setMode(mode)
    navigate('/automated')
  }

  const hasAmount = amountDollars > 0

  return (
    <div className="flex flex-col items-start w-full">
      <div className="flex flex-col gap-6 py-10 w-full bg-white">

        {/* Row 1 — Page title + mode toggle */}
        <div className="flex items-center justify-between px-8 h-14">
          <h1 className="text-[30px] font-bold text-vg-ink whitespace-nowrap leading-normal">
            Sell &amp; Rebalance
          </h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center border-[1.5px] border-vg-ink rounded-full p-[2px] bg-white h-[37px]">
              <button
                onClick={() => handleModeChange('automated')}
                className={`self-stretch flex items-center gap-1.5 px-4 rounded-full text-[14px] font-bold transition-colors ${
                  mode === 'automated' ? 'bg-vg-teal text-white' : 'bg-transparent text-vg-ink'
                }`}
              >
                <Sparkles size={16} className={mode === 'automated' ? 'text-white' : 'text-vg-ink'} />
                Automated
              </button>
              <button
                onClick={() => handleModeChange('manual')}
                className={`self-stretch flex items-center gap-1.5 px-4 rounded-[4px] text-[14px] font-bold transition-colors ${
                  mode === 'manual' ? 'bg-vg-teal text-white' : 'bg-transparent text-vg-ink'
                }`}
              >
                <PenLine size={16} className={mode === 'manual' ? 'text-white' : 'text-vg-ink'} />
                Manual
              </button>
            </div>
            <CoachMark id="mode-toggle" text="Automated mode uses an AI optimization engine to recommend which funds to sell and how much, minimizing your estimated tax burden while improving portfolio allocation. Manual mode gives you direct control over fund selection, cost basis method, and individual lot choices." />
          </div>
        </div>

        {/* Assistant entry point — visible only while nothing has been
            specified yet (no valid nonzero amount), reactive to the same
            live amountDollars state "Get recommendation" already uses, not
            a separate "has been shown" flag. This is the actual first-visit
            landing page (route "/") — distinct from FundSelectionAutomated.tsx
            (route "/automated", reached only after a first submission here)
            — see DECISIONS.md's fund-selection-assistant-entry-gap entry for
            why this file was missed in the original pass. */}
        {!hasAmount && <FundSelectionAssistantEntry />}

        {/* Row 2 — Amount input + CTA */}
        <div className="flex items-end gap-3 px-8">
          <div className="flex flex-col gap-2">
            <label htmlFor="sale-amount" className="text-[12px] text-vg-ink leading-normal whitespace-nowrap">
              How much would you like to sell?
            </label>
            <input
              id="sale-amount"
              type="text"
              inputMode="decimal"
              value={inputDisplay}
              onChange={handleAmountChange}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={e => e.key === 'Enter' && hasAmount && handleSubmit()}
              placeholder="$0.00"
              className="w-[200px] h-[48px] px-3 border border-vg-ink rounded-[4px]
                text-[14px] text-vg-ink text-right placeholder:text-vg-ink-muted
                bg-white focus:outline-none focus:ring-2 focus:ring-vg-ink/20"
            />
          </div>
          <button
            disabled={!hasAmount}
            onClick={handleSubmit}
            className="h-[48px] px-7 rounded-full bg-vg-ink text-white text-[14px] font-bold
              whitespace-nowrap transition-opacity
              disabled:opacity-40 disabled:cursor-not-allowed
              hover:opacity-90 active:opacity-80"
          >
            Get recommendation
          </button>
        </div>

        {/* Explanation text */}
        <div className="px-8">
          <p className="text-[14px] text-vg-ink-muted leading-normal">
            Enter the amount you&apos;d like to raise from your portfolio. We&apos;ll generate a
            fund sell recommendation that minimizes your tax impact while keeping your portfolio on
            target.
          </p>
        </div>
      </div>
    </div>
  )
}
