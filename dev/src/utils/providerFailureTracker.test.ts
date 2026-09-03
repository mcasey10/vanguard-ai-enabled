/**
 * dev/src/utils/providerFailureTracker.test.ts — the provider-failure
 * indicator's own logic, covered directly (DECISIONS.md's provider-failure-
 * indicator entry).
 *
 * Same in-memory localStorage mock pattern as demoSettings.test.ts — the
 * Vitest environment is 'node', no real browser localStorage exists there.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

function createLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createLocalStorageMock())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('recordProviderFailure / getProviderFailureDisplay', () => {
  test('no recorded failure returns null', async () => {
    const { getProviderFailureDisplay } = await import('./providerFailureTracker')
    expect(getProviderFailureDisplay('gemini')).toBeNull()
  })

  test('a real 429 produces the "likely a usage limit" wording — the only status this project confirmed is a reliable quota signal', async () => {
    const { recordProviderFailure, getProviderFailureDisplay } = await import('./providerFailureTracker')
    recordProviderFailure('gemini', 429)
    const text = getProviderFailureDisplay('gemini')
    expect(text).not.toBeNull()
    expect(text).toMatch(/^Gemini — last failed/)
    expect(text).toMatch(/likely a usage limit/)
  })

  test('the displayed message includes a date, not just a time — a bare time alone misleadingly reads as "this morning" if the dialog is ever left open across midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T08:05:00'))
    const { recordProviderFailure, getProviderFailureDisplay } = await import('./providerFailureTracker')
    recordProviderFailure('groq', 429)
    const text = getProviderFailureDisplay('groq')
    // e.g. "Groq — last failed Sep 15, 8:05 AM, likely a usage limit"
    expect(text).toMatch(/Sep 15, \d{1,2}:\d{2}/)
  })

  test('a non-429 failure (e.g. a bad key, 401) still shows something, but never claims it\'s a usage limit — self-audit\'s "don\'t guess" rule', async () => {
    const { recordProviderFailure, getProviderFailureDisplay } = await import('./providerFailureTracker')
    recordProviderFailure('anthropic', 401)
    const text = getProviderFailureDisplay('anthropic')
    expect(text).not.toBeNull()
    expect(text).toMatch(/^Anthropic — last failed/)
    expect(text).not.toMatch(/usage limit/)
  })

  test('a failure with no real status at all (network failure) also shows the generic wording, not a guess', async () => {
    const { recordProviderFailure, getProviderFailureDisplay } = await import('./providerFailureTracker')
    recordProviderFailure('groq', undefined)
    const text = getProviderFailureDisplay('groq')
    expect(text).not.toBeNull()
    expect(text).not.toMatch(/usage limit/)
  })

  test('providers are tracked independently — a Gemini failure says nothing about Groq', async () => {
    const { recordProviderFailure, getProviderFailureDisplay } = await import('./providerFailureTracker')
    recordProviderFailure('gemini', 429)
    expect(getProviderFailureDisplay('groq')).toBeNull()
  })
})

describe('recordProviderSuccess — clears immediately, stronger evidence than time alone', () => {
  test('a real success clears a previously-recorded failure for the same provider', async () => {
    const { recordProviderFailure, recordProviderSuccess, getProviderFailureDisplay } = await import('./providerFailureTracker')
    recordProviderFailure('gemini', 429)
    expect(getProviderFailureDisplay('gemini')).not.toBeNull()
    recordProviderSuccess('gemini')
    expect(getProviderFailureDisplay('gemini')).toBeNull()
  })

  test('a success for one provider does not clear a different provider\'s recorded failure', async () => {
    const { recordProviderFailure, recordProviderSuccess, getProviderFailureDisplay } = await import('./providerFailureTracker')
    recordProviderFailure('gemini', 429)
    recordProviderSuccess('groq') // never failed — should be a harmless no-op
    expect(getProviderFailureDisplay('gemini')).not.toBeNull()
  })

  test('recordProviderSuccess on a provider with no recorded failure is a safe no-op', async () => {
    const { recordProviderSuccess, getProviderFailureDisplay } = await import('./providerFailureTracker')
    expect(() => recordProviderSuccess('gemini')).not.toThrow()
    expect(getProviderFailureDisplay('gemini')).toBeNull()
  })
})

describe('day-rollover fallback — only reached when nothing has been retried', () => {
  test('a failure recorded earlier the SAME calendar day still shows', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T08:00:00'))
    const { recordProviderFailure, getProviderFailureDisplay } = await import('./providerFailureTracker')
    recordProviderFailure('gemini', 429)
    vi.setSystemTime(new Date('2026-09-02T23:30:00')) // later the same day
    expect(getProviderFailureDisplay('gemini')).not.toBeNull()
  })

  test('a failure recorded on a PREVIOUS calendar day is treated as stale, even if less than 24 real hours have passed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T23:58:00'))
    const { recordProviderFailure, getProviderFailureDisplay } = await import('./providerFailureTracker')
    recordProviderFailure('gemini', 429)
    vi.setSystemTime(new Date('2026-09-03T00:01:00')) // 3 minutes later, but a new calendar day
    expect(getProviderFailureDisplay('gemini')).toBeNull()
  })

  test('a failure from several days ago is stale', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T12:00:00'))
    const { recordProviderFailure, getProviderFailureDisplay } = await import('./providerFailureTracker')
    recordProviderFailure('gemini', 429)
    vi.setSystemTime(new Date('2026-09-02T12:00:00'))
    expect(getProviderFailureDisplay('gemini')).toBeNull()
  })
})

describe('malformed/corrupted localStorage — never throws, degrades to "nothing recorded"', () => {
  test('corrupted JSON in the storage key falls back to null rather than throwing', async () => {
    localStorage.setItem('vsr_provider_failures', 'not valid json{{{')
    const { getProviderFailureDisplay } = await import('./providerFailureTracker')
    expect(() => getProviderFailureDisplay('gemini')).not.toThrow()
    expect(getProviderFailureDisplay('gemini')).toBeNull()
  })
})
