/**
 * Demo Settings persistence (D071, provider-default fix D073) —
 * session-level tool preferences (reader segment for AI narration tone, and
 * which real provider each AI feature uses), deliberately kept in their own
 * localStorage key rather than folded into vsr_portfolio_state.
 *
 * Segment survives "Reset demo" — it's a UI-tone preference, not demo data
 * (D071's original reasoning, unchanged). Provider choices do NOT survive
 * "Reset demo" as of D073 — a full reset now clears any explicit provider
 * choice back to "no explicit choice" (the real env-var-resolved default),
 * per this task's explicit verification requirement; the parts of D071's
 * original reasoning about segment surviving a reset still stand, this is a
 * narrower, provider-specific correction, not a reversal of that reasoning
 * for demo settings generally.
 */

import type { NarrationSegment } from './narrationShared'
import { TAX_BRACKETS_2026, type FilingStatus } from '../data/taxBrackets2026'

const LS_KEY = 'vsr_demo_settings'

export type DemoProvider = 'gemini' | 'anthropic' | 'groq'

// Providers actually offered in the Demo Settings dialog's dropdowns (D072
// removed Anthropic — no configured API key in this deployment). This is
// the single source of truth both the dialog's option lists and this
// module's own load-time reconciliation use (see loadDemoSettings below),
// so a persisted choice pointing at a since-removed option (e.g. a value
// saved before D072 shipped) can't silently produce "no option highlighted"
// — that was D073's actual root cause, diagnosed live (see DECISIONS.md).
export const OFFERED_PROVIDERS: DemoProvider[] = ['gemini', 'groq']

export interface DemoSettings {
  narrationSegment: NarrationSegment
  // null = no explicit user choice yet — the dialog should display (and
  // requests should use) the real server-resolved env-var default, not a
  // guessed client-side value. Set only when the user actually picks
  // something (D073).
  narrationProvider: DemoProvider | null
  whatifProvider: DemoProvider | null
  // Tax bracket dialog selection (D081) — the actual filing-status and
  // income-band *identifiers* the user picked, not just the resulting
  // st_rate/lt_rate pair, since more than one band could in principle
  // produce the same two rates and a rate-only persistence would then
  // reopen the dialog unable to say which row was actually selected.
  // minIncome uniquely identifies a row within its filing status's table
  // (taxBrackets2026.ts) — both null = no explicit selection yet (the
  // dialog's own default 24%/15% state).
  taxBracketFilingStatus: FilingStatus | null
  taxBracketIncomeMin: number | null
}

const DEFAULTS: DemoSettings = {
  narrationSegment: 'A',
  narrationProvider: null,
  whatifProvider: null,
  taxBracketFilingStatus: null,
  taxBracketIncomeMin: null,
}

function isOfferedProvider(v: unknown): v is DemoProvider {
  return OFFERED_PROVIDERS.includes(v as DemoProvider)
}

function isSegment(v: unknown): v is NarrationSegment {
  return v === 'A' || v === 'B' || v === 'C' || v === 'D'
}

function isFilingStatus(v: unknown): v is FilingStatus {
  return typeof v === 'string' && v in TAX_BRACKETS_2026
}

export function loadDemoSettings(): DemoSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<DemoSettings>

    // Filing status and income-band are validated as one pair, not two
    // independent fields — a filing status with no matching row in that
    // status's real table (e.g. stale data from before a bracket-table
    // edit) would otherwise leave the dialog showing a filing-status pill
    // selected with no income-band row highlighted, an inconsistent
    // half-state neither this task nor D073's orphaned-value precedent for
    // providers allows.
    const candidateStatus = isFilingStatus(parsed.taxBracketFilingStatus) ? parsed.taxBracketFilingStatus : null
    const candidateIncomeMin = typeof parsed.taxBracketIncomeMin === 'number' ? parsed.taxBracketIncomeMin : null
    const rowStillExists = candidateStatus !== null && candidateIncomeMin !== null
      && TAX_BRACKETS_2026[candidateStatus].some(row => row.minIncome === candidateIncomeMin)

    return {
      narrationSegment: isSegment(parsed.narrationSegment) ? parsed.narrationSegment : DEFAULTS.narrationSegment,
      // A stored value that isn't currently offered (e.g. 'anthropic',
      // persisted before D072 removed it from the dropdown) reconciles back
      // to null here — "no valid explicit choice" — rather than being kept
      // as an orphaned value nothing in the UI can ever highlight again.
      narrationProvider: isOfferedProvider(parsed.narrationProvider) ? parsed.narrationProvider : null,
      whatifProvider: isOfferedProvider(parsed.whatifProvider) ? parsed.whatifProvider : null,
      taxBracketFilingStatus: rowStillExists ? candidateStatus : null,
      taxBracketIncomeMin: rowStillExists ? candidateIncomeMin : null,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveDemoSettings(settings: DemoSettings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings))
  } catch {
    console.error('[demoSettings] Failed to save to localStorage')
  }
}

export interface ServerProviderDefaults {
  narrationProvider: DemoProvider | null
  whatifProvider: DemoProvider | null
}

/**
 * Fetches what NARRATION_PROVIDER/WHATIF_PROVIDER actually resolve to right
 * now, via /api/demo-config — the real server-side resolution
 * (getActiveGenerator()/getActiveInterpreter(), the exact functions every
 * real request already uses), not a client-side guess. Used only to decide
 * what the Demo Settings dialog highlights when no explicit choice has been
 * made; the actual narrate/interpret calls never need this — they already
 * resolve their own default server-side whenever `provider` is omitted.
 */
export async function fetchServerProviderDefaults(): Promise<ServerProviderDefaults> {
  try {
    const res = await fetch('/api/demo-config')
    if (!res.ok) throw new Error(`demo-config returned ${res.status}`)
    const body = await res.json() as { narrationProvider?: string | null; whatifProvider?: string | null }
    return {
      narrationProvider: isOfferedProvider(body.narrationProvider) ? body.narrationProvider : null,
      whatifProvider: isOfferedProvider(body.whatifProvider) ? body.whatifProvider : null,
    }
  } catch {
    return { narrationProvider: null, whatifProvider: null }
  }
}
