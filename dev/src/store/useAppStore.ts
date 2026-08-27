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

  // ── Scenario editing context ───────────────────────────────────────────────
  // null  = starting a new scenario (Go to SC will addScenario)
  // set   = editing an existing scenario (Go to SC will updateScenario in place)
  activeScenarioId: string | null

  // ── Tax rate assumptions (user-adjustable per REQ-G-010) ─────────────────
  activeTaxRates: Pick<TaxAssumptionSet, 'st_rate' | 'lt_rate'>
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
  activeScenarioId: null,

  activeTaxRates: { ...DEFAULT_TAX_RATES },

  // ── Actions ────────────────────────────────────────────────────────────────

  setPortfolio: (portfolio) => set({ portfolio }),

  persistPortfolio: () => {
    savePortfolioState(get().portfolio)
  },

  setTargetSaleAmount: (amount) => set({ targetSaleAmount: amount }),

  setActiveAccountId: (id) => set({ activeAccountId: id }),

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
      // Scenarios are NOT cleared on session reset — they persist across sessions
    }),
}))
