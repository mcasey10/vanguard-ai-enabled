/**
 * Provider-failure indicator (DECISIONS.md's provider-failure-indicator
 * entry) — tracks the last known failure per real AI provider (gemini /
 * anthropic / groq), shared across narration and the Scenario assistant
 * deliberately: both features draw on the same underlying provider quota
 * when pointed at the same provider, so a Gemini-narration failure is real
 * evidence about a Gemini-assistant call too, not two separate facts to
 * track independently. Read by DemoSettingsDialog.tsx; written by
 * narration.ts and whatIf.ts on every real call's outcome.
 *
 * Self-audit (before this file existed): only a genuine HTTP 429 from a
 * provider's own API response is a reliable quota/rate-limit signal — a
 * bad key or a malformed request return their own distinct status (401/403,
 * 400), and a network failure never produces a response at all, so none of
 * those are mistakable for 429. This isn't a guess: a real Gemini 429 and a
 * real Groq 429 (with real `x-ratelimit-*` headers) were both already
 * observed live in this project (DECISIONS.md D065/D066) using the exact
 * same status-code check this file relies on.
 *
 * Persisted to its own localStorage key, deliberately separate from
 * demoSettings.ts's `vsr_demo_settings` (DECISIONS.md's provider-failure-
 * indicator entry, item 4, explains the reasoning) and deliberately NOT
 * cleared by "Reset demo" (FundSelectionEntry.tsx) — a demo reset clears
 * demo *data*; it does nothing to an actual provider's real quota state, so
 * clearing this record on reset would just make the same confusion happen
 * again the next time that provider is called.
 */

const LS_KEY = 'vsr_provider_failures'

interface ProviderFailureRecord {
  /** ISO timestamp of the most recent real failure. */
  lastFailedAt: string
  /** True only when that failure's real HTTP status was 429. */
  likelyQuotaLimit: boolean
}

type ProviderFailureState = Partial<Record<string, ProviderFailureRecord>>

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  groq: 'Groq',
}

function loadState(): ProviderFailureState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as ProviderFailureState : {}
  } catch {
    return {}
  }
}

function saveState(state: ProviderFailureState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch {
    console.error('[providerFailureTracker] Failed to save to localStorage')
  }
}

/**
 * Records a real failure for `providerName`. `providerStatus` is the real
 * HTTP status the provider's own API returned, when one came back at all
 * (undefined for a network failure or a missing-key short-circuit, neither
 * of which ever reach a real response) — the 429-vs-everything-else
 * decision is made here, once, not re-decided at each call site.
 */
export function recordProviderFailure(providerName: string, providerStatus: number | undefined): void {
  const state = loadState()
  state[providerName] = {
    lastFailedAt: new Date().toISOString(),
    likelyQuotaLimit: providerStatus === 429,
  }
  saveState(state)
}

/**
 * Clears any recorded failure for `providerName` — called on every real
 * success. A subsequent success is stronger, more direct evidence the limit
 * has lifted than time alone, so this takes priority over the day-rollover
 * fallback in getProviderFailureDisplay() below.
 */
export function recordProviderSuccess(providerName: string): void {
  const state = loadState()
  if (state[providerName]) {
    delete state[providerName]
    saveState(state)
  }
}

/**
 * The Demo Settings dialog's display text for `providerName`, or null when
 * there is nothing to show. Two cases produce a genuinely different
 * wording, not just a formatting difference: a confirmed-quota-shaped
 * failure (429) states that plainly; any other real failure is shown more
 * generically, with no claim about *why* it failed — the task's own
 * explicit instruction not to guess when the evidence doesn't support it.
 */
export function getProviderFailureDisplay(providerName: string): string | null {
  const record = loadState()[providerName]
  if (!record) return null

  const failedAt = new Date(record.lastFailedAt)
  const now = new Date()
  // Day-rollover fallback (only reached when nothing has been retried since
  // the failure — a real success already clears the record above, before
  // this function would ever see it): free-tier quota limits typically
  // reset daily, so a failure from a previous calendar day is treated as
  // stale. Compares calendar date, not a rolling 24h window, so a failure
  // at 11:58pm reads as stale at 12:01am, not at 11:58pm the next day.
  if (failedAt.toDateString() !== now.toDateString()) return null

  const label = PROVIDER_DISPLAY_NAMES[providerName] ?? providerName
  // Date included, not just time (found missing in review) — the day-rollover
  // check above means this is almost always "today" when shown, but the one
  // known gap (a dialog left mounted open across midnight with no
  // re-render trigger) can still surface a from-yesterday message, and
  // "last failed 8:05 AM" alone would misleadingly read as this morning in
  // that case. See this file's own module comment / DECISIONS.md's
  // provider-failure-indicator-date-fix entry for the full investigation.
  const dateStr = failedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const timeStr = failedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return record.likelyQuotaLimit
    ? `${label} — last failed ${dateStr}, ${timeStr}, likely a usage limit`
    : `${label} — last failed ${dateStr}, ${timeStr}`
}
