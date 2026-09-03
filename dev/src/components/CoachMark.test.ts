/**
 * CoachMark.test.ts — the "Clear all coach marks" logic (DECISIONS.md's
 * clear-all-coach-marks entry). Only clearAllCoachMarks() is exported for
 * testing; the per-ID dismiss/isDismissed helpers are exercised indirectly
 * through it and through direct localStorage assertions, the same pattern
 * providerFailureTracker.test.ts and demoSettings.test.ts already use for
 * localStorage-backed modules in this codebase.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

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
  // This project's Vitest environment is 'node' (vite.config.ts), not
  // jsdom — no real `window` exists, so clearAllCoachMarks()'s
  // window.dispatchEvent() needs one. Node's global EventTarget is a real,
  // spec-compliant event target — sufficient for dispatch/addEventListener
  // assertions without pulling in a DOM environment for this one module.
  vi.stubGlobal('window', new EventTarget())
})

describe('clearAllCoachMarks', () => {
  test('stores a sentinel value, not a per-ID array — deliberately ID-agnostic', async () => {
    const { clearAllCoachMarks } = await import('./CoachMark')
    clearAllCoachMarks()
    expect(localStorage.getItem('vsr_coach_marks_dismissed')).toBe('ALL')
  })

  test('dispatches vsr-reset so every mounted CoachMark re-checks its own dismissed state', async () => {
    const { clearAllCoachMarks } = await import('./CoachMark')
    const handler = vi.fn()
    window.addEventListener('vsr-reset', handler)
    clearAllCoachMarks()
    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener('vsr-reset', handler)
  })

  test('overwrites a prior per-ID dismissed array rather than merging with it', async () => {
    localStorage.setItem('vsr_coach_marks_dismissed', JSON.stringify(['tax', 'ytd']))
    const { clearAllCoachMarks } = await import('./CoachMark')
    clearAllCoachMarks()
    expect(localStorage.getItem('vsr_coach_marks_dismissed')).toBe('ALL')
  })

  test('does not remove the key — only Reset demo\'s own flow does that (FundSelectionEntry.tsx), and this action must not be able to trigger that unconditional-restore behavior', async () => {
    const { clearAllCoachMarks } = await import('./CoachMark')
    clearAllCoachMarks()
    expect(localStorage.getItem('vsr_coach_marks_dismissed')).not.toBeNull()
  })
})
