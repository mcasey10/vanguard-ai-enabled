/**
 * WhatIfPanel — Feature 2's collapsible assistant panel (CLAUDE.md §8, D006).
 *
 * UI only. Wires directly to the existing backend (dev/src/utils/whatIf.ts,
 * whatIfShared.ts, scenarioBuilder.ts) — no new interpretation, validation,
 * or engine-calling logic lives here. Conversation state is ordinary React
 * state, ephemeral, never persisted (D053) — closing the panel discards it.
 *
 * Rendered as a right-side drawer, 480px wide — the real Constellation
 * `--drawer-width` token (PDB 05 §"Spacing and layout"), not an invented
 * size — using this codebase's existing scrim/overlay pattern (see
 * CostBasisDialog.tsx, ScenarioAnalysis.tsx's DeleteDialog). No dedicated
 * chat-panel precedent exists anywhere in the design system or the live
 * previous-project app (this is the first conversational surface either has
 * ever had) — the drawer container and its "text link expands to reveal an
 * editor" collapse affordance (the Sell & Rebalance Q5 inline-drawer
 * pattern, PDB 05) are real precedent; the message-list/bubble content
 * inside is necessarily new.
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import type { Portfolio, SavedScenario } from '../types'
import { buildPortfolioReferenceContext, type PortfolioReferenceContext, type WhatIfCandidate, type WhatIfTurn } from '../utils/whatIfShared'
import { interpretWhatIfTurn, confirmWhatIfCandidate, WhatIfError } from '../utils/whatIf'
import { buildScenarioFromRecommendation, buildScenarioFromFundResults } from '../utils/scenarioBuilder'
import { formatCurrency, formatShares, accountTypeLabel, resolveScenarioAccount } from '../utils/format'
import type { NarrationSegment } from '../utils/narrationShared'

// ---------------------------------------------------------------------------
// Internal message shape — richer than WhatIfTurn, so each assistant turn
// keeps enough structure to render the right UI (a confirm card needs
// buttons; a clarify question doesn't).
// ---------------------------------------------------------------------------

type PanelMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; kind: 'greeting'; text: string }
  | { role: 'assistant'; kind: 'result'; text: string }
  | { role: 'assistant'; kind: 'clarify'; question: string }
  | { role: 'assistant'; kind: 'refuse'; reason: string }
  | { role: 'assistant'; kind: 'confirm'; candidate: WhatIfCandidate; summary: string; resolved?: 'confirmed' | 'cancelled' }
  // retryUtterance is set only for a genuine interpret-time failure (never
  // for an in-scope refusal or a business-rule error) — see sendUtterance's
  // catch block and CLAUDE.md §8's failure-handling rule (D066).
  | { role: 'assistant'; kind: 'error'; text: string; retryUtterance?: string }

const GREETING = 'Tell me what you’d like to do — for example, "Sell $5,000 of VTSAX" or "Reduce my tax impact by $20,000."'

/** Finds the first real fund_id from the reference data that appears as a substring of the given text. */
function findMentionedFund(text: string, reference: PortfolioReferenceContext) {
  return reference.funds.find(f => text.includes(f.fund_id) && f.lots.length > 0)
}

// ---------------------------------------------------------------------------
// Compact inline lot table — the WhatIfFundLotReference shape the backend
// already exposes, plus a GAIN/SH column added in D063 (cost_basis_per_share
// / current_nav, added to that same shape so criterion-based lot selection
// like "prioritize the smallest gains" is answerable at all — see
// whatIfShared.ts). The full FundSelectionManualLot.tsx table is ~800px
// across six columns and does not fit a 480px drawer — this is a
// deliberately smaller, purpose-built variant, not a reuse of that
// component.
// ---------------------------------------------------------------------------

function fmtGainPerShare(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${formatCurrency(Math.abs(n))}`
}

function InlineLotTable({ fund, onPickLot }: {
  fund: NonNullable<ReturnType<typeof findMentionedFund>>
  onPickLot: (utterance: string) => void
}) {
  return (
    <div className="mt-2 border border-[#e8e9e9] rounded-[6px] overflow-hidden">
      <div className="flex bg-[#f0f0f0] px-2 py-1.5">
        <span className="text-[10px] font-semibold text-[#717777] flex-1">LOT</span>
        <span className="text-[10px] font-semibold text-[#717777] w-[32px] text-center">TERM</span>
        <span className="text-[10px] font-semibold text-[#717777] w-[48px] text-right">SHARES</span>
        <span className="text-[10px] font-semibold text-[#717777] w-[62px] text-right">VALUE</span>
        <span className="text-[10px] font-semibold text-[#717777] w-[56px] text-right">GAIN/SH</span>
        <span className="w-[52px]" />
      </div>
      {fund.lots.map(lot => {
        const gainPerShare = lot.current_nav - lot.cost_basis_per_share
        const gainColor = gainPerShare > 0 ? 'text-[#007a00]' : gainPerShare < 0 ? 'text-[#c8102e]' : 'text-[#717777]'
        return (
          <div key={lot.lot_id} className="flex items-center px-2 py-1.5 border-t border-[#e8e9e9]">
            <span className="text-[11px] font-bold text-[#1255cc] flex-1 truncate">{lot.lot_id}</span>
            <span className="text-[10px] text-[#717777] w-[32px] text-center">{lot.holding_period}</span>
            <span className="text-[11px] text-vg-ink w-[48px] text-right">{formatShares(lot.shares)}</span>
            <span className="text-[11px] text-vg-ink w-[62px] text-right">{formatCurrency(lot.current_value)}</span>
            <span className={`text-[11px] w-[56px] text-right ${gainColor}`}>{fmtGainPerShare(gainPerShare)}</span>
            {/* Composes a dollar-value utterance, not a share-count one
                (D063 fix) — whatIfPrompt.ts's instructions and every worked
                example are dollar-centric (sell_amount, "$X"); nothing tells
                the interpreter how to map a raw share count onto a
                candidate, so "Sell all 40 shares of lot X" went
                unrecognized. The lot's own current_value already IS the
                dollar amount for "sell all of it," so this needs no new
                data or prompt changes — just phrasing the same real number
                the way the interpreter is actually equipped to read. */}
            <button
              onClick={() => onPickLot(`Sell all of lot ${lot.lot_id}, worth ${formatCurrency(lot.current_value)}`)}
              className="w-[52px] text-[10px] font-semibold text-[#1255cc] underline text-right shrink-0 hover:opacity-70"
            >
              Sell all
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Segmented control — "New" plus one option per existing scenario, dynamically
// generated (D067, item 2). Not a reuse of the Automated/Manual mode toggle
// seen on Fund Selection pages: that toggle turned out, on inspection, to be
// fixed-two-option markup hand-copy-pasted per page (FundSelectionAutomated/
// Manual/Manual2/ManualLot.tsx each hardcode their own "Automated"/"Manual"
// buttons with fixed icons and fixed navigation targets) — no shared,
// data-driven component exists to extend for a variable-length option list,
// so this is a small, genuinely new component, styled to match that same
// visual pattern (rounded-full bordered pill container, filled active
// segment) rather than reusing code that isn't actually reusable.
// ---------------------------------------------------------------------------

function ScenarioSegmentedControl({ scenarios, selectedId, onSelect }: {
  scenarios: SavedScenario[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const segment = (id: string | null, label: string) => (
    <button
      key={id ?? 'new'}
      onClick={() => onSelect(id)}
      className={`h-[28px] px-3 rounded-full text-[12px] font-bold whitespace-nowrap shrink-0 transition-colors ${
        selectedId === id ? 'bg-vg-teal text-white' : 'text-vg-ink hover:bg-[#f0f0f0]'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex items-center gap-[2px] border-[1.5px] border-vg-ink rounded-full p-[2px] bg-white w-fit max-w-full overflow-x-auto">
      {segment(null, 'New')}
      {scenarios.map((s, i) => segment(s.scenario_id, `Scenario ${i + 1}`))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scenario summary card — shown only when a specific scenario (not "New") is
// selected in the segmented control above (D067, item 3). Exists specifically
// because the underlying scenario is obscured by the scrim once the panel is
// open — this is the only way to see which account/funds/figures are being
// modified without closing the panel.
// ---------------------------------------------------------------------------

function ScenarioSummaryCard({ scenario, label, portfolio }: {
  scenario: SavedScenario
  label: string
  portfolio: Portfolio
}) {
  const account = resolveScenarioAccount(scenario, portfolio)
  const fundList = scenario.fund_selections.map(fs => fs.fund_id).join(', ')
  return (
    <div data-testid="whatif-summary-card" className="mx-5 mt-3 p-3 rounded-[8px] border border-[#e8e9e9] bg-[#f8f8f7] flex flex-col gap-1 shrink-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-vg-ink">{label}</span>
        {account && (
          <span className="text-[10px] text-[#717777] whitespace-nowrap">
            {accountTypeLabel(account.account_type)} {account.masked_number}
          </span>
        )}
      </div>
      <span className="text-[11px] text-[#717777]">
        {fundList} · {formatCurrency(scenario.total_sell_amount)} · Est. tax {formatCurrency(scenario.est_net_tax)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Account picker — shown only when "New" is selected (the mirror-image case
// of ScenarioSummaryCard above), filling the same visual slot that's empty
// when there's no scenario to summarize. Exists for the same reason the
// summary card does: the scrim obscures the page's own "ACCOUNT FOR NEW
// SCENARIOS" label the moment the panel opens, and that label was never
// more than a passive display anyway — Scenario Analysis has never had an
// account switcher of its own (D057's switcher exists only on the two Fund
// Selection pages), so before this there was no way to change which account
// a new scenario targets without leaving the panel entirely. Defaults to
// the page's own active account (identical behavior to before this existed)
// until the user explicitly picks something else here.
// ---------------------------------------------------------------------------

function AccountPicker({ portfolio, selectedAccountId, onSelect }: {
  portfolio: Portfolio
  selectedAccountId: string
  onSelect: (accountId: string) => void
}) {
  return (
    <div className="mx-5 mt-3 p-3 rounded-[8px] border border-[#e8e9e9] bg-[#f8f8f7] flex flex-col gap-2 shrink-0">
      <span className="text-[11px] font-bold text-vg-ink">Account for this new scenario</span>
      <div className="flex flex-wrap gap-[6px]">
        {portfolio.accounts.map(acct => {
          const selected = acct.account_id === selectedAccountId
          return (
            <button
              key={acct.account_id}
              onClick={() => onSelect(acct.account_id)}
              type="button"
              className={`px-[10px] py-[5px] rounded-full text-[11px] font-semibold border whitespace-nowrap transition-colors ${
                selected ? 'bg-vg-ink text-white border-vg-ink' : 'bg-white text-vg-ink border-[#c8c8c8] hover:border-vg-ink'
              }`}
            >
              {accountTypeLabel(acct.account_type)} {acct.masked_number}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface WhatIfPanelProps {
  onClose: () => void
  portfolio: Portfolio
  // The default account a NEW scenario is built against (Scenario Analysis's
  // own "ACCOUNT FOR NEW SCENARIOS" label, D063 item 5) — used only when the
  // in-panel segmented control below has "New" selected, and only until the
  // user explicitly overrides it via the in-panel AccountPicker (see
  // newScenarioAccountId below) — that override exists specifically because
  // this page-level label is obscured by the panel's own scrim the moment
  // it opens, and was never itself a picker to begin with. Modifying an
  // existing scenario instead uses THAT scenario's own account (D067) — see
  // effectiveAccountId below; this is the single fix that makes the
  // segmented control safe to use across scenarios that span different real
  // accounts (CLAUDE.md §5/D057, confirmed reachable live in D067's Tier 3).
  activeAccountId: string
  activeTaxRates: { st_rate: number; lt_rate: number }
  scenarios: SavedScenario[]
  scenarioCount: number
  onScenarioAdded: (scenario: SavedScenario) => void
  onScenarioUpdated: (scenarioId: string, scenario: SavedScenario) => void
  // Demo Settings dialog's runtime selections (D071) — reader tone for
  // clarifying questions/confirm summaries, and which real provider
  // interprets this conversation. `provider` omitted server-side falls back
  // to WHATIF_PROVIDER.
  segment: NarrationSegment
  provider?: string
}

const MAX_SCENARIOS = 3

export function WhatIfPanel({
  onClose, portfolio, activeAccountId, activeTaxRates, scenarios, scenarioCount, onScenarioAdded,
  onScenarioUpdated, segment, provider,
}: WhatIfPanelProps) {
  // Which scenario the panel is modifying, if any — internal, in-panel
  // selection state now (D067, item 2), not a prop set once at launch by
  // whichever per-scenario link was clicked (D064's original model, removed
  // this session along with the per-scenario links themselves). null means
  // "New" — the segmented control's default selection.
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null)
  const modifyingScenario = selectedScenarioId ? scenarios.find(s => s.scenario_id === selectedScenarioId) : undefined

  // The account a new scenario targets, when explicitly overridden via the
  // in-panel AccountPicker below — null means "no override yet, use the
  // page's activeAccountId" (identical to this panel's original behavior).
  // Panel-lifetime only, like every other piece of conversation state here
  // (D053) — resets naturally on next open since the panel unmounts/remounts
  // fresh each time (ScenarioAnalysis.tsx's `{assistantOpen && <WhatIfPanel/>}`).
  const [newScenarioAccountId, setNewScenarioAccountId] = useState<string | null>(null)

  function scenarioLabel(scenario: SavedScenario): string {
    const idx = scenarios.findIndex(s => s.scenario_id === scenario.scenario_id)
    return idx >= 0 ? `Scenario ${idx + 1}` : 'this scenario'
  }

  // The account this conversation actually operates against — the page's
  // "account for new scenarios" when building something new, but the
  // SELECTED SCENARIO'S OWN account when modifying one (D067). Before this,
  // the panel always used the page-level activeAccountId regardless of which
  // scenario it was modifying — silently wrong the moment a scenario built
  // against a different account than the page's currently-active one was
  // selected (exactly the shape D067's Tier 3 investigation confirmed is
  // real and reachable: a Taxable scenario and a Traditional IRA scenario
  // genuinely coexisting in the same comparison).
  const effectiveAccountId = modifyingScenario
    ? resolveScenarioAccount(modifyingScenario, portfolio)?.account_id ?? activeAccountId
    : (newScenarioAccountId ?? activeAccountId)

  const reference = useMemo(
    () => buildPortfolioReferenceContext(portfolio, effectiveAccountId, scenarios, modifyingScenario?.scenario_id),
    [portfolio, effectiveAccountId, scenarios, modifyingScenario]
  )

  function greetingFor(scenario: SavedScenario | undefined): string {
    return scenario ? `Modifying ${scenarioLabel(scenario)} — tell me what to change.` : GREETING
  }

  const [messages, setMessages] = useState<PanelMessage[]>([{ role: 'assistant', kind: 'greeting', text: GREETING }])
  const [turnHistory, setTurnHistory] = useState<WhatIfTurn[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expandedLotFund, setExpandedLotFund] = useState<string | null>(null)
  // D076 — closing the panel used to discard an unconfirmed, in-progress
  // conversation with no warning at all (D069 flagged this explicitly).
  // True only while the confirm-before-discard prompt below is showing.
  const [confirmingClose, setConfirmingClose] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // "In progress" means a user message (or an unsent draft) exists since the
  // last successfully-confirmed result — not "any message ever," since a
  // panel that already confirmed once and was then simply re-opened to look
  // around has nothing left to lose by closing. Checked at close-time, not
  // tracked as its own piece of state, so it can never drift out of sync
  // with the actual message list.
  function hasUnconfirmedProgress(): boolean {
    const lastResultIndex = messages.reduce(
      (acc, m, i) => (m.role === 'assistant' && m.kind === 'result' ? i : acc), -1
    )
    const sinceLastResult = messages.slice(lastResultIndex + 1)
    return sinceLastResult.some(m => m.role === 'user') || input.trim().length > 0
  }

  function handleCloseAttempt() {
    if (hasUnconfirmedProgress()) {
      setConfirmingClose(true)
    } else {
      onClose()
    }
  }

  // Switching the segmented control's selection mid-conversation clears any
  // in-progress conversation history (D067, item 2) — the same discipline
  // already established for account switches (D059's manual-session guard)
  // and post-confirm resets (this file's own turnHistory clear after a
  // successful confirm) — otherwise a conversation started about Scenario 1
  // could bleed into a request made after switching to Scenario 2. The
  // target scenario is resolved and passed to greetingFor() directly, not
  // read back from selectedScenarioId state in the same tick — a store/state
  // update isn't visible to code running later in the same synchronous
  // function (D060's stale-closure lesson, applies here too).
  function selectScenario(id: string | null) {
    if (id === selectedScenarioId) return
    const target = id ? scenarios.find(s => s.scenario_id === id) : undefined
    setSelectedScenarioId(id)
    setMessages([{ role: 'assistant', kind: 'greeting', text: greetingFor(target) }])
    setTurnHistory([])
    setInput('')
    setExpandedLotFund(null)
  }

  // Picking a different account for "New" changes what `reference` is
  // grounded in (effectiveAccountId feeds buildPortfolioReferenceContext
  // above), so an in-progress conversation about the old account's holdings
  // would no longer be valid — reset it the same way switching the
  // segmented control does, for the same reason (D059's account-change
  // session-clearing precedent, applied here to this panel's own state).
  function selectNewScenarioAccount(accountId: string) {
    if (accountId === (newScenarioAccountId ?? activeAccountId)) return
    setNewScenarioAccountId(accountId)
    setMessages([{ role: 'assistant', kind: 'greeting', text: GREETING }])
    setTurnHistory([])
    setInput('')
    setExpandedLotFund(null)
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  // Focus retention: the input is disabled while loading (can't hold focus
  // then), so refocus once it re-enables — covers both a normal send and
  // the initial mount. Keyed on `loading` rather than called inline after
  // setLoading(false) so it fires after the DOM actually re-enables the
  // input, not before.
  useEffect(() => {
    if (!loading) inputRef.current?.focus()
  }, [loading])

  async function sendUtterance(utterance: string) {
    const trimmed = utterance.trim()
    if (!trimmed || loading) return

    setMessages(m => [...m, { role: 'user', text: trimmed }])
    setInput('')
    setLoading(true)

    const historyForCall = turnHistory
    try {
      const result = await interpretWhatIfTurn({ utterance: trimmed, history: historyForCall, reference, segment }, provider)
      setTurnHistory(h => [...h, { role: 'user', content: trimmed }, { role: 'assistant', content: result.type === 'clarify' ? result.question : result.type === 'refuse' ? result.reason : result.summary }])

      if (result.type === 'clarify') {
        setMessages(m => [...m, { role: 'assistant', kind: 'clarify', question: result.question }])
      } else if (result.type === 'refuse') {
        setMessages(m => [...m, { role: 'assistant', kind: 'refuse', reason: result.reason }])
      } else {
        setMessages(m => [...m, { role: 'assistant', kind: 'confirm', candidate: result.candidate, summary: result.summary }])
      }
    } catch {
      // Never surface err.message here (CLAUDE.md §8, D066) — interpretWhatIfTurn
      // wraps a genuine provider/network failure (rate limit, outage, an
      // invalid key, a malformed response) into a WhatIfError whose message
      // is exactly the raw underlying text ("Gemini API returned 429" was
      // found reaching the user directly, live, before this fix). This
      // catch has no deterministic fallback to offer (CLAUDE.md §7's
      // narration fallback has no equivalent here — there's no template for
      // "what the user meant"), so the honest, safe response is a plain
      // apology plus a way forward: retry the same utterance, or fall back
      // to the always-available manual path.
      setMessages(m => [...m, {
        role: 'assistant', kind: 'error',
        text: 'The Scenario assistant couldn’t process that just now — this is usually temporary. You can try again, or continue manually with Edit scenario / Add scenario in the meantime.',
        retryUtterance: trimmed,
      }])
    } finally {
      setLoading(false)
    }
  }

  function handleConfirm(index: number, candidate: WhatIfCandidate) {
    try {
      const engineResult = confirmWhatIfCandidate(candidate, reference, portfolio, effectiveAccountId, activeTaxRates)
      const scenario = engineResult.mode === 'automated'
        ? buildScenarioFromRecommendation(engineResult, portfolio, activeTaxRates, effectiveAccountId)
        : buildScenarioFromFundResults(engineResult.fund_results, portfolio, activeTaxRates, engineResult.allocation_impact, effectiveAccountId)

      if (!scenario) {
        setMessages(m => [...m, { role: 'assistant', kind: 'error', text: 'That request did not produce a sale — nothing was added.' }])
        return
      }

      if (modifyingScenario) {
        // Update in place — preserve the scenario's identity (scenario_id,
        // name, created_at) and only replace what the engine actually
        // recomputed, same as Fund Selection's own "Edit scenario" round
        // trip does for a non-AI edit.
        onScenarioUpdated(modifyingScenario.scenario_id, {
          ...scenario,
          scenario_id: modifyingScenario.scenario_id,
          scenario_name: modifyingScenario.scenario_name,
          created_at: modifyingScenario.created_at,
          ai_assisted: true,
        })
        setMessages(m => m.map((msg, i) => i === index && msg.role === 'assistant' && msg.kind === 'confirm' ? { ...msg, resolved: 'confirmed' } : msg))
        setMessages(m => [...m, { role: 'assistant', kind: 'result', text: `Updated ${modifyingScenario.scenario_name} in Scenario Analysis.` }])
        setTurnHistory([])
        return
      }

      // The store silently no-ops past the 3-scenario cap (REQ-SC-001) — check
      // here too so the panel never claims success for an add that didn't happen.
      if (scenarioCount >= MAX_SCENARIOS) {
        setMessages(m => m.map((msg, i) => i === index && msg.role === 'assistant' && msg.kind === 'confirm' ? { ...msg, resolved: 'cancelled' } : msg))
        setMessages(m => [...m, { role: 'assistant', kind: 'error', text: 'You already have 3 scenarios saved — delete one in Scenario Analysis before adding another.' }])
        return
      }

      onScenarioAdded({ ...scenario, ai_assisted: true })
      setMessages(m => m.map((msg, i) => i === index && msg.role === 'assistant' && msg.kind === 'confirm' ? { ...msg, resolved: 'confirmed' } : msg))
      setMessages(m => [...m, { role: 'assistant', kind: 'result', text: 'Added to Scenario Analysis — see the new column, marked "AI-assisted."' }])
      // A confirmed request is a completed transaction — clear the history sent
      // to the interpreter (not the visible message log) so the next utterance
      // is read as a fresh, independent request rather than an addition to one
      // that's already been executed. Found live: without this, a second
      // unrelated request ("Sell $2,000 of VTIAX") got merged into the first,
      // already-applied one instead of being treated as its own scenario.
      setTurnHistory([])
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', kind: 'error', text: err instanceof WhatIfError ? err.message : 'Could not complete that request.' }])
    }
  }

  function handleCancelConfirm(index: number) {
    setMessages(m => m.map((msg, i) => i === index && msg.role === 'assistant' && msg.kind === 'confirm' ? { ...msg, resolved: 'cancelled' } : msg))
  }

  return (
    // Starts at 150px, not 0 — the height of PortalShell's persistent
    // header/nav chrome (measured live against the real running app, not
    // guessed), so the scrim and drawer both leave it visibly undimmed
    // (D067). This was flagged with a specific fix in the very first UI
    // review and never made it into an executable prompt three times over
    // — a side drawer isn't a blocking full-screen modal the way
    // CostBasisDialog.tsx's `fixed inset-0` scrim correctly is for an
    // actual dialog; don't copy that pattern verbatim for a drawer.
    <div className="fixed left-0 right-0 bottom-0 z-50" style={{ top: 150 }}>
      {/* Scrim — lightened as well as shortened (25% vs. the modal
          pattern's 30-40%), since a drawer is a lighter-weight interaction
          than a blocking dialog. */}
      <div className="absolute inset-0 bg-black/25" onClick={handleCloseAttempt} />

      {/* Drawer — 480px, real --drawer-width token (PDB 05). top-0/h-full
          are relative to the shortened parent above, so the drawer's own
          top edge sits right at the header's bottom edge, not overlapping
          or covering it either. */}
      <div
        data-testid="whatif-panel"
        className="absolute right-0 top-0 h-full bg-white flex flex-col"
        style={{ width: 480, filter: 'drop-shadow(-4px 0px 16px rgba(4,5,5,0.16))' }}
      >
        {/* Header */}
        <div className="flex flex-col gap-2 border-b border-[#e8e9e9] px-5 py-4 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[16px] font-bold text-vg-ink">Scenario assistant</span>
            <button onClick={handleCloseAttempt} aria-label="Close" className="text-[18px] text-vg-ink hover:opacity-70 leading-none">×</button>
          </div>
          <span className="text-[11px] text-[#717777]">AI-generated interpretations — review each request before confirming.</span>
          {/* The single entry point into this panel (D067, item 2) — the
              per-scenario "Modify with Scenario assistant" links are gone;
              this segmented control is now the only way to target an
              existing scenario instead of building a new one. */}
          <ScenarioSegmentedControl scenarios={scenarios} selectedId={selectedScenarioId} onSelect={selectScenario} />
        </div>

        {/* Scenario summary card (D067, item 3) when modifying a specific
            scenario; account picker (see AccountPicker above) in the same
            visual slot when "New" is selected — previously empty here, the
            one place a user could explicitly set which account a new
            scenario targets without leaving the panel. */}
        {modifyingScenario ? (
          <ScenarioSummaryCard scenario={modifyingScenario} label={scenarioLabel(modifyingScenario)} portfolio={portfolio} />
        ) : (
          <AccountPicker portfolio={portfolio} selectedAccountId={effectiveAccountId} onSelect={selectNewScenarioAccount} />
        )}

        {/* Message list */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {messages.map((msg, i) => {
            if (msg.role === 'user') {
              return (
                <div key={i} className="self-end max-w-[85%] bg-vg-ink text-white text-[13px] rounded-[12px] rounded-br-[2px] px-3 py-2">
                  {msg.text}
                </div>
              )
            }

            if (msg.kind === 'greeting' || msg.kind === 'result') {
              return (
                <div key={i} className="self-start max-w-[90%] bg-[#f0f0f0] text-vg-ink text-[13px] rounded-[12px] rounded-bl-[2px] px-3 py-2">
                  {msg.text}
                </div>
              )
            }

            if (msg.kind === 'error') {
              return (
                <div key={i} className="self-start max-w-[90%] bg-[#fdecea] text-[#7a1f14] text-[13px] rounded-[12px] rounded-bl-[2px] px-3 py-2 flex flex-col gap-2">
                  <span>{msg.text}</span>
                  {msg.retryUtterance && (
                    <button
                      onClick={() => sendUtterance(msg.retryUtterance!)}
                      className="self-start h-[28px] px-3 rounded-full bg-[#7a1f14] text-white text-[12px] font-semibold hover:opacity-90"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )
            }

            if (msg.kind === 'refuse') {
              return (
                <div key={i} className="self-start max-w-[90%] bg-[#f8f8f7] border border-[#e8e9e9] text-vg-ink text-[13px] rounded-[12px] rounded-bl-[2px] px-3 py-2">
                  {msg.reason}
                </div>
              )
            }

            if (msg.kind === 'clarify') {
              const mentioned = findMentionedFund(msg.question, reference)
              return (
                <div key={i} className="self-start max-w-[90%] flex flex-col gap-1.5">
                  <div className="bg-[#f0f0f0] text-vg-ink text-[13px] rounded-[12px] rounded-bl-[2px] px-3 py-2">
                    {msg.question}
                  </div>
                  {mentioned && (
                    <>
                      <button
                        onClick={() => setExpandedLotFund(v => v === mentioned.fund_id ? null : mentioned.fund_id)}
                        className="self-start text-[11px] text-[#1255cc] underline hover:opacity-70"
                      >
                        {expandedLotFund === mentioned.fund_id ? 'Hide' : 'View'} lot details for {mentioned.fund_id}
                      </button>
                      {expandedLotFund === mentioned.fund_id && (
                        <InlineLotTable fund={mentioned} onPickLot={sendUtterance} />
                      )}
                    </>
                  )}
                </div>
              )
            }

            // confirm
            return (
              <div key={i} className="self-start max-w-[90%] bg-[#fff8e8] border border-[#f0e0b0] text-vg-ink text-[13px] rounded-[12px] rounded-bl-[2px] px-3 py-2 flex flex-col gap-2">
                <span>{msg.summary}</span>
                {!msg.resolved && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleConfirm(i, msg.candidate)}
                      className="h-[32px] px-4 rounded-full bg-vg-ink text-white text-[12px] font-bold hover:opacity-90"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => handleCancelConfirm(i)}
                      className="h-[32px] px-4 rounded-full border-[1.5px] border-vg-ink bg-white text-[12px] font-bold text-vg-ink hover:opacity-90"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {msg.resolved === 'confirmed' && <span className="text-[11px] text-[#085041] font-semibold">Confirmed.</span>}
                {msg.resolved === 'cancelled' && <span className="text-[11px] text-[#717777]">Not applied.</span>}
              </div>
            )
          })}

          {loading && (
            <div className="self-start bg-[#f0f0f0] text-[#717777] text-[13px] rounded-[12px] rounded-bl-[2px] px-3 py-2">
              Thinking…
            </div>
          )}
        </div>

        {/* Input row */}
        <div className="border-t border-[#e8e9e9] p-3 flex items-center gap-2 shrink-0">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendUtterance(input) }}
            placeholder="Tell the Scenario assistant what you'd like to do…"
            disabled={loading}
            className="flex-1 h-[40px] rounded-[20px] border border-[#d0d0d0] px-3 text-[13px] focus:outline-none focus:border-vg-ink"
          />
          <button
            onClick={() => sendUtterance(input)}
            disabled={loading || !input.trim()}
            className="h-[40px] px-4 rounded-full bg-vg-ink text-white text-[12px] font-bold disabled:opacity-40 hover:opacity-90"
          >
            Send
          </button>
        </div>
      </div>

      {/* Confirm-before-discard (D076) — closing used to silently drop an
          unconfirmed, in-progress conversation with no warning at all
          (D069). Same centered-modal convention as this app's other
          confirm dialogs (ScenarioAnalysis.tsx's DeleteDialog,
          ModeToggleGuard.tsx's SaveDiscardDialog) — rendered after the
          drawer above, same z-50, so normal DOM stacking order puts it on
          top without needing a higher z-index. */}
      {confirmingClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setConfirmingClose(false)}>
          <div
            className="bg-white rounded-[8px] p-6 flex flex-col gap-4"
            style={{ width: 400, filter: 'drop-shadow(0px 4px 8px rgba(4,5,5,0.2))' }}
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[16px] font-bold text-vg-ink">Discard this conversation?</p>
            <p className="text-[13px] text-[#717777] leading-normal">
              This request hasn't been confirmed yet. Closing now will discard it — nothing has been added to Scenario Analysis.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmingClose(false)}
                className="h-[40px] px-4 rounded-full border-[1.5px] border-vg-ink text-vg-ink bg-white text-[13px] font-bold hover:opacity-90 transition-opacity"
              >
                Keep editing
              </button>
              <button
                onClick={() => { setConfirmingClose(false); onClose() }}
                className="h-[40px] px-4 rounded-full bg-vg-ink text-white text-[13px] font-bold hover:opacity-90 transition-opacity"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
