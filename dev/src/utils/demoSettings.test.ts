/**
 * dev/src/utils/demoSettings.test.ts — D073's actual diagnosis, covered as
 * real regression tests, not just fixed live and left untested.
 *
 * The Vitest environment is 'node' (vite.config.ts) — no browser
 * localStorage exists there by default, so this file provides a minimal
 * in-memory mock, reset before each test. This is test infrastructure only,
 * not something demoSettings.ts itself needs — the real module talks to the
 * real browser localStorage exactly as before.
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

describe('loadDemoSettings — D073: the actual root cause, covered directly', () => {
  test('with nothing stored, returns defaults: segment A, both providers null, no tax bracket selection', async () => {
    const { loadDemoSettings } = await import('./demoSettings')
    expect(loadDemoSettings()).toEqual({
      narrationSegment: 'A', narrationProvider: null, whatifProvider: null,
      taxBracketFilingStatus: null, taxBracketIncomeMin: null,
    })
  })

  test('a valid, currently-offered stored choice is returned as-is', async () => {
    const { loadDemoSettings, saveDemoSettings } = await import('./demoSettings')
    saveDemoSettings({
      narrationSegment: 'C', narrationProvider: 'groq', whatifProvider: 'gemini',
      taxBracketFilingStatus: null, taxBracketIncomeMin: null,
    })
    expect(loadDemoSettings()).toEqual({
      narrationSegment: 'C', narrationProvider: 'groq', whatifProvider: 'gemini',
      taxBracketFilingStatus: null, taxBracketIncomeMin: null,
    })
  })

  // This is the actual bug: a value persisted before D072 removed Anthropic
  // from the dropdown (or written directly, as here) no longer matches any
  // rendered option — before this fix, it stayed as the literal stored
  // string forever, so no button's `value === p.value` check could ever
  // match it again. Reconciling to null here is what makes the dialog fall
  // back to the real server default instead of highlighting nothing.
  test('a stored choice pointing at a since-removed provider (e.g. "anthropic") reconciles to null, not kept as an orphaned value', async () => {
    localStorage.setItem('vsr_demo_settings', JSON.stringify({ narrationSegment: 'B', narrationProvider: 'anthropic', whatifProvider: 'anthropic' }))
    const { loadDemoSettings } = await import('./demoSettings')
    expect(loadDemoSettings()).toEqual({
      narrationSegment: 'B', narrationProvider: null, whatifProvider: null,
      taxBracketFilingStatus: null, taxBracketIncomeMin: null,
    })
  })

  test('corrupted JSON falls back to defaults rather than throwing', async () => {
    localStorage.setItem('vsr_demo_settings', 'not valid json{{{')
    const { loadDemoSettings } = await import('./demoSettings')
    expect(loadDemoSettings()).toEqual({
      narrationSegment: 'A', narrationProvider: null, whatifProvider: null,
      taxBracketFilingStatus: null, taxBracketIncomeMin: null,
    })
  })

  test('an invalid segment value falls back to the default segment, independent of provider reconciliation', async () => {
    localStorage.setItem('vsr_demo_settings', JSON.stringify({ narrationSegment: 'Z', narrationProvider: 'groq', whatifProvider: null }))
    const { loadDemoSettings } = await import('./demoSettings')
    expect(loadDemoSettings()).toEqual({
      narrationSegment: 'A', narrationProvider: 'groq', whatifProvider: null,
      taxBracketFilingStatus: null, taxBracketIncomeMin: null,
    })
  })

  // D081 — the tax bracket selection persistence, and the one pairing rule
  // this task's own instruction motivated: storing the row's real
  // identifiers (filing status + minIncome), not just the resulting rates,
  // because more than one row could in principle share a rate pair.
  test('a valid, currently-existing filing status + income band pair is returned as-is', async () => {
    const { loadDemoSettings, saveDemoSettings } = await import('./demoSettings')
    saveDemoSettings({
      narrationSegment: 'A', narrationProvider: null, whatifProvider: null,
      taxBracketFilingStatus: 'married_filing_jointly', taxBracketIncomeMin: 100801,
    })
    const result = loadDemoSettings()
    expect(result.taxBracketFilingStatus).toBe('married_filing_jointly')
    expect(result.taxBracketIncomeMin).toBe(100801)
  })

  test('an unrecognized filing status string reconciles both fields to null, not just the status field', async () => {
    localStorage.setItem('vsr_demo_settings', JSON.stringify({
      narrationSegment: 'A', narrationProvider: null, whatifProvider: null,
      taxBracketFilingStatus: 'married_filing_separately', taxBracketIncomeMin: 12401,
    }))
    const { loadDemoSettings } = await import('./demoSettings')
    const result = loadDemoSettings()
    expect(result.taxBracketFilingStatus).toBeNull()
    expect(result.taxBracketIncomeMin).toBeNull()
  })

  test('a valid filing status paired with an income-band value that matches no real row reconciles both fields to null, not a mismatched half-state', async () => {
    localStorage.setItem('vsr_demo_settings', JSON.stringify({
      narrationSegment: 'A', narrationProvider: null, whatifProvider: null,
      taxBracketFilingStatus: 'single', taxBracketIncomeMin: 999999999,
    }))
    const { loadDemoSettings } = await import('./demoSettings')
    const result = loadDemoSettings()
    expect(result.taxBracketFilingStatus).toBeNull()
    expect(result.taxBracketIncomeMin).toBeNull()
  })
})

describe('saveDemoSettings — round-trips with loadDemoSettings', () => {
  test('a saved value is read back exactly', async () => {
    const { loadDemoSettings, saveDemoSettings } = await import('./demoSettings')
    const settings = {
      narrationSegment: 'D' as const, narrationProvider: 'gemini' as const, whatifProvider: 'groq' as const,
      taxBracketFilingStatus: 'head_of_household' as const, taxBracketIncomeMin: 67451,
    }
    saveDemoSettings(settings)
    expect(loadDemoSettings()).toEqual(settings)
  })
})

describe('fetchServerProviderDefaults — the real server-resolved default, not a client-side guess (D073)', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('returns the real resolved providers on a successful response', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ narrationProvider: 'groq', whatifProvider: 'groq' }),
    })) as unknown as typeof fetch
    const { fetchServerProviderDefaults } = await import('./demoSettings')
    expect(await fetchServerProviderDefaults()).toEqual({ narrationProvider: 'groq', whatifProvider: 'groq' })
  })

  test('a resolved value that is not currently offered (e.g. a misconfigured "anthropic") maps to null rather than being surfaced as a highlightable default', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ narrationProvider: 'anthropic', whatifProvider: 'gemini' }),
    })) as unknown as typeof fetch
    const { fetchServerProviderDefaults } = await import('./demoSettings')
    expect(await fetchServerProviderDefaults()).toEqual({ narrationProvider: null, whatifProvider: 'gemini' })
  })

  test('a network failure returns nulls rather than throwing, so the dialog can still open', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch
    const { fetchServerProviderDefaults } = await import('./demoSettings')
    expect(await fetchServerProviderDefaults()).toEqual({ narrationProvider: null, whatifProvider: null })
  })

  test('a non-OK HTTP response returns nulls rather than throwing', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch
    const { fetchServerProviderDefaults } = await import('./demoSettings')
    expect(await fetchServerProviderDefaults()).toEqual({ narrationProvider: null, whatifProvider: null })
  })
})
