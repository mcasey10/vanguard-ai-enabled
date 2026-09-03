/**
 * Zustand store — application-wide state for the Vanguard Sell & Rebalance tool.
 *
 * State slices:
 *   - portfolio          Portfolio loaded from canonical data / localStorage
 *   - Sale session       targetSaleAmount, activeAccountId, mode, optimizationPriority
 *   - Engine outputs     recommendation, manualConfig (null until engine built)
 *   - Scenarios          up to 3 SavedScenario
 *   - Tax rates          activeTaxRates (default 24% ST / 15% LT)
 */

import { create } from 'zustand'
import type {
  Portfolio,
  Recommendation,
  ManualConfiguration,
  SavedScenario,
  TaxAssumptionSet,
  CostBasisMethod,
} from '../types'
import { loadPortfolio, savePortfolioState } from '../data/loader'
import { fromAccountingMethod } from '../utils/methods'
import { loadDemoSettings, saveDemoSettings, type DemoSettings } from '../utils/demoSettings'

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface AppState {
  // ── Portfolio data ────────────────────────────────────────────────────────
  portfolio: Portfolio

  // ── Sale session ──────────────────────────────────────────────────────────
  targetSaleAmount: number | null
  activeAccountId: string
  mode: 'automated' | 'manual'
  optimizationPriority: 'tax-first' | 'balance-first'

  // ── Engine outputs (null until optimization engine is built — REQ-OE-001) ─
  recommendation: Recommendation | null
  manualConfig: ManualConfiguration | null

  // ── Manual session state — lifted from FundSelectionManual2 so it survives
  //    navigation to /manual-lot and back (local React state resets on unmount)
  manualActiveFundIds: string[]
  manualAppliedAmountsCents: Record<string, number>   // ticker → cents
  manualCostBasisMethods: Record<string, CostBasisMethod>  // ticker → UI method label
  manualLotSelections: Record<string, Record<string, string>>  // ticker → { lot_id → sharesString }

  // ── Scenarios (max 3, REQ-SC-001) ─────────────────────────────────────────
  scenarios: SavedScenario[]

  // Set true the first time ScenarioAnalysis.tsx seeds the canonical demo
  // scenarios into an empty `scenarios` array this session (D106). In-memory
  // only, like `scenarios` itself (no persist() wraps this store) — resets
  // to false on a genuine hard reload, same as `scenarios` resets to `[]`,
  // so a fresh page load still shows the seeded demo data as before. Not
  // reset by ordinary resetSession() calls (e.g. ExecutionSummary.tsx's
  // "start a new sale") — but "Reset demo" specifically (FundSelectionEntry.tsx's
  // /?reset=true handler) explicitly sets this true with an empty scenarios
  // array (D109), since that flow's own hard reload would otherwise silently
  // reseed the 3 canonical scenarios on the next Scenario Analysis visit,
  // undoing whatever the user had (including an explicit "delete all"). This
  // flag's core purpose remains stopping `scenarios.length === 0` from being
  // misread as "never seeded" once the user has genuinely emptied it out.
  scenariosSeeded: boolean

  // ── Scenario editing context ───────────────────────────────────────────────
  // null  = starting a new scenario (Go to SC will addScenario)
  // set   = editing an existing scenario (Go to SC will updateScenario in place)
  activeScenarioId: string | null

  // ── Tax rate assumptions (user-adjustable per REQ-G-010) ─────────────────
  activeTaxRates: Pick<TaxAssumptionSet, 'st_rate' | 'lt_rate'>

  // ── Demo Settings (D071) — reader segment + per-feature provider choice.
  //    Persisted to its own localStorage key (demoSettings.ts), deliberately
  //    NOT cleared by resetSession() or the full "Reset demo" flow — these
  //    are tool preferences, not demo data.
  demoSettings: DemoSettings
}

interface AppActions {
  // Portfolio
  setPortfolio: (portfolio: Portfolio) => void
  persistPortfolio: () => void

  // Sale session
  setTargetSaleAmount: (amount: number | null) => void
  setActiveAccountId: (id: string) => void
  setMode: (mode: 'automated' | 'manual') => void
  setOptimizationPriority: (priority: 'tax-first' | 'balance-first') => void

  // Engine outputs
  setRecommendation: (rec: Recommendation | null) => void
  setManualConfig: (config: ManualConfiguration | null) => void

  // Manual session state
  setManualActiveFunds: (ids: string[]) => void
  setManualAppliedAmount: (ticker: string, cents: number) => void
  clearManualAppliedAmount: (ticker: string) => void
  setManualCostBasisMethod: (ticker: string, method: CostBasisMethod) => void
  setManualLotSelections: (ticker: string, inputs: Record<string, string>) => void
  clearManualSession: () => void

  // Scenarios
  setScenarios: (scenarios: SavedScenario[]) => void
  addScenario: (scenario: SavedScenario) => void
  updateScenario: (id: string, scenario: SavedScenario) => void
  deleteScenario: (id: string) => void
  // Seeds the canonical demo scenarios exactly once per session (D106) — a
  // no-op if scenariosSeeded is already true, regardless of scenarios.length.
  seedScenariosOnce: (scenarios: SavedScenario[]) => void

  // Scenario editing context
  setActiveScenarioId: (id: string | null) => void
  // Restore a saved scenario's session state for editing and set activeScenarioId
  startEditingScenario: (scenario: SavedScenario) => void
  // Clear session state and activeScenarioId for adding a brand-new scenario
  startNewScenario: () => void

  // Tax rates
  setActiveTaxRates: (rates: Pick<TaxAssumptionSet, 'st_rate' | 'lt_rate'>) => void

  // Session reset — clears all sale session state, keeps portfolio
  resetSession: () => void

  // Demo Settings — merges into the existing settings and persists
  // immediately (demoSettings.ts), the same pattern persistPortfolio() uses
  // for portfolio state, just always-on rather than called explicitly.
  setDemoSettings: (partial: Partial<DemoSettings>) => void
}

type AppStore = AppState & AppActions

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

const DEFAULT_TAX_RATES: Pick<TaxAssumptionSet, 'st_rate' | 'lt_rate'> = {
  st_rate: 0.24,
  lt_rate: 0.15,
}

const DEFAULT_ACTIVE_ACCOUNT = 'ACCT-TAXABLE-001'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAppStore = create<AppStore>((set, get) => ({
  // ── Initial state ──────────────────────────────────────────────────────────
  portfolio: loadPortfolio(),

  targetSaleAmount: null,
  activeAccountId: DEFAULT_ACTIVE_ACCOUNT,
  mode: 'automated',
  optimizationPriority: 'tax-first',

  recommendation: null,
  manualConfig: null,

  manualActiveFundIds: [],
  manualAppliedAmountsCents: {},
  manualCostBasisMethods: {},
  manualLotSelections: {},

  scenarios: [],
  scenariosSeeded: false,
  activeScenarioId: null,

  activeTaxRates: { ...DEFAULT_TAX_RATES },

  demoSettings: loadDemoSettings(),

  // ── Actions ────────────────────────────────────────────────────────────────

  setPortfolio: (portfolio) => set({ portfolio }),

  persistPortfolio: () => {
    savePortfolioState(get().portfolio)
  },

  setTargetSaleAmount: (amount) => set({ targetSaleAmount: amount }),

  // Clears the manual session whenever the account actually changes, not
  // just when FundSelectionManual2's own switchAccount() fires. Manual
  // session state (manualActiveFundIds etc.) is keyed by fund_id/ticker
  // alone, and the same ticker can be a real, distinct holding in more than
  // one account — a manual session built for one account is meaningless
  // (and silently produces an empty result, since runOptimization() can't
  // find those fund_ids in a different account's holdings) once the active
  // account changes out from under it. Previously this was only cleared by
  // Manual2's own switchAccount(), so switching accounts from the Automated
  // page instead left a stale, now-mismatched manual session in the store —
  // invisible until the user later opened Manual mode, at which point the
  // sell amount and fund table appeared to vanish for no visible reason.
  setActiveAccountId: (id) =>
    set((state) => (id === state.activeAccountId ? state : {
      activeAccountId: id,
      manualActiveFundIds: [],
      manualAppliedAmountsCents: {},
      manualCostBasisMethods: {},
      manualLotSelections: {},
      manualConfig: null,
    })),

  setMode: (mode) => set({ mode }),

  setOptimizationPriority: (priority) => set({ optimizationPriority: priority }),

  setRecommendation: (rec) => set({ recommendation: rec }),

  setManualConfig: (config) => set({ manualConfig: config }),

  setManualActiveFunds: (ids) => set({ manualActiveFundIds: ids }),

  setManualAppliedAmount: (ticker, cents) =>
    set((state) => ({
      manualAppliedAmountsCents: { ...state.manualAppliedAmountsCents, [ticker]: cents },
    })),

  clearManualAppliedAmount: (ticker) =>
    set((state) => {
      const next = { ...state.manualAppliedAmountsCents }
      delete next[ticker]
      return { manualAppliedAmountsCents: next }
    }),

  setManualCostBasisMethod: (ticker, method) =>
    set((state) => ({
      manualCostBasisMethods: { ...state.manualCostBasisMethods, [ticker]: method },
    })),

  setManualLotSelections: (ticker, inputs) =>
    set((state) => ({
      manualLotSelections: { ...state.manualLotSelections, [ticker]: inputs },
    })),

  clearManualSession: () =>
    set({
      manualActiveFundIds: [],
      manualAppliedAmountsCents: {},
      manualCostBasisMethods: {},
      manualLotSelections: {},
      manualConfig: null,
    }),

  setScenarios: (scenarios) => set({ scenarios }),

  addScenario: (scenario) =>
    set((state) => {
      if (state.scenarios.length >= 3) {
        console.warn('[store] Cannot add scenario: maximum of 3 already saved (REQ-SC-001)')
        return state
      }
      return { scenarios: [...state.scenarios, scenario] }
    }),

  updateScenario: (id, scenario) =>
    set((state) => ({
      scenarios: state.scenarios.map((s) => (s.scenario_id === id ? scenario : s)),
    })),

  deleteScenario: (id) =>
    set((state) => ({
      scenarios: state.scenarios.filter((s) => s.scenario_id !== id),
    })),

  seedScenariosOnce: (scenarios) =>
    set((state) => {
      if (state.scenariosSeeded) return state
      return { scenarios, scenariosSeeded: true }
    }),

  setActiveScenarioId: (id) => set({ activeScenarioId: id }),

  // Restore session state from a saved scenario so Fund Selection shows the right context
  startEditingScenario: (scenario) => {
    if (scenario.source_mode === 'manual') {
      // Reconstruct manual session from the saved fund selections
      const ids: string[] = []
      const amounts: Record<string, number> = {}
      const methods: Record<string, CostBasisMethod> = {}
      const lotSelections: Record<string, Record<string, string>> = {}
      for (const fs of scenario.fund_selections) {
        ids.push(fs.fund_id)
        amounts[fs.fund_id] = Math.round(fs.sell_amount * 100)
        methods[fs.fund_id] = fromAccountingMethod(fs.accounting_method)
        if (fs.accounting_method === 'specific_lot_identification' && fs.lots_selected.length > 0) {
          lotSelections[fs.fund_id] = Object.fromEntries(
            fs.lots_selected.map(ls => [ls.lot_id, String(ls.shares_to_sell)])
          )
        }
      }
      set({
        activeScenarioId: scenario.scenario_id,
        // account_id is optional only for scenarios saved before D057 (account
        // switching) — those are the seeded canonical demo scenarios, which
        // are genuinely taxable-only, so DEFAULT_ACTIVE_ACCOUNT is the correct
        // fallback, not "leave whatever was active before." Without this,
        // Fund Selection would recompute a fresh recommendation for whichever
        // account happened to be active already, using the scenario's dollar
        // total but the WRONG account and holdings entirely — reproduced
        // live (D061): editing a Roth scenario while Taxable was active
        // showed a completely different, freshly-computed Taxable result.
        activeAccountId: scenario.account_id ?? DEFAULT_ACTIVE_ACCOUNT,
        targetSaleAmount: scenario.total_sell_amount,
        mode: 'manual',
        recommendation: null,
        manualConfig: null,
        manualActiveFundIds: ids,
        manualAppliedAmountsCents: amounts,
        manualCostBasisMethods: methods,
        manualLotSelections: lotSelections,
      })
    } else {
      set({
        activeScenarioId: scenario.scenario_id,
        // See the manual branch above for why this fallback is
        // DEFAULT_ACTIVE_ACCOUNT specifically, not the current activeAccountId.
        activeAccountId: scenario.account_id ?? DEFAULT_ACTIVE_ACCOUNT,
        targetSaleAmount: scenario.total_sell_amount,
        mode: scenario.source_mode,
        recommendation: null,
        manualConfig: null,
        manualActiveFundIds: [],
        manualAppliedAmountsCents: {},
        manualCostBasisMethods: {},
        manualLotSelections: {},
      })
    }
  },

  startNewScenario: () =>
    set({
      activeScenarioId: null,
      targetSaleAmount: null,
      mode: 'automated',
      optimizationPriority: 'tax-first',
      recommendation: null,
      manualConfig: null,
      manualActiveFundIds: [],
      manualAppliedAmountsCents: {},
      manualCostBasisMethods: {},
      manualLotSelections: {},
    }),

  setActiveTaxRates: (rates) => set({ activeTaxRates: rates }),

  resetSession: () =>
    set({
      targetSaleAmount: null,
      activeAccountId: DEFAULT_ACTIVE_ACCOUNT,
      mode: 'automated',
      optimizationPriority: 'tax-first',
      recommendation: null,
      manualConfig: null,
      activeScenarioId: null,
      manualActiveFundIds: [],
      manualAppliedAmountsCents: {},
      manualCostBasisMethods: {},
      manualLotSelections: {},
      // Scenarios are NOT cleared here — resetSession() itself is also
      // called from ExecutionSummary.tsx after every completed transaction
      // ("start a new sale"), where wiping the user's other saved comparison
      // scenarios would be wrong. "Reset demo" (FundSelectionEntry.tsx's
      // /?reset=true handler) explicitly clears scenarios itself, on top of
      // calling this — a narrower, reset-flow-specific exception, not a
      // reversal of this function's own behavior (D109).
    }),

  setDemoSettings: (partial) => {
    const next = { ...get().demoSettings, ...partial }
    saveDemoSettings(next)
    set({ demoSettings: next })
  },
}))

// Fix the actual cause of the "scenarios always repopulate, regardless of
// navigation" regression reported against D107's fix (D108). Confirmed by
// direct tracing, not assumption: this module had no HMR accept boundary of
// its own, so Vite propagated any edit here up through EVERY page that
// imports useAppStore — the dev-server log shows the whole page set
// ("hot updated: .../ScenarioAnalysis.tsx", .../FundSelectionAutomated.tsx,
// etc.) re-evaluating together on a single store edit — and React Fast
// Refresh remounted each of them as part of that propagation, re-firing
// their mount effects. That's what re-triggered ScenarioAnalysis.tsx's own
// seeding effect on every further edit Claude made during testing,
// independent of anything the person testing actually clicked; it looked
// like "reseeds regardless of navigation" because navigation had nothing to
// do with it. D107's `scenariosSeeded` flag and effect were themselves
// correct the whole time — confirmed live, via a temporary window.__appStore
// debug hook, tracing the flag through the exact original repro sequence
// with no further edits landing in between: it survived every real in-app
// navigation without reseeding.
//
// `import.meta.hot.accept()` with no handler makes this module genuinely
// self-accepting: Vite re-evaluates only this file on its own edits and
// stops the propagation at this boundary, so importing pages are no longer
// remounted (and their mount effects no longer re-fire) just because the
// store module changed. The dispose/restore pair below is a second,
// independent layer on top of that — it preserves the actual data (not
// action functions, which close over the disposed module's own stale
// `set`/`get` and would call back into an orphaned store instance if
// restored verbatim) across any future case where this module's own state
// does get reinitialized (e.g. a change that forces a fuller reload), so a
// single self-accept isn't the only thing this depends on holding.
if (import.meta.hot) {
  const saved = import.meta.hot.data.appStoreState as Partial<AppStore> | undefined
  if (saved) {
    const dataOnly = Object.fromEntries(
      Object.entries(saved).filter(([, v]) => typeof v !== 'function')
    )
    useAppStore.setState(dataOnly)
  }
  import.meta.hot.dispose((data) => {
    data.appStoreState = useAppStore.getState()
  })
  import.meta.hot.accept()
}
