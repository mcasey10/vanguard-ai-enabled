/**
 * Client-side narration fetcher. Calls POST /api/narrate (the Vercel
 * serverless function / its Vite dev-server equivalent), falls back to a
 * deterministic summary on failure, and memoizes by input content for the
 * session — see CLAUDE.md §7 and DECISIONS.md D038 for why each of these
 * exists.
 */

import { buildDeterministicFallback, type NarrationInput } from './narrationShared'
import { recordProviderFailure, recordProviderSuccess } from './providerFailureTracker'

export interface NarrationResult {
  text: string
  /** CD-1.2: only true when the text actually came from the model. */
  aiGenerated: boolean
}

// Session-scoped, in-memory only — never persisted (D038: avoids
// stale-cache-across-dataset-version risk; a prototype has no cache
// invalidation infrastructure to keep a persisted cache honest).
const cache = new Map<string, NarrationResult>()

function cacheKey(input: NarrationInput, provider?: string): string {
  // Stable stringify: NarrationInput's own field order is already fixed by
  // how callers construct it, and JSON.stringify is deterministic for a
  // given object's insertion order — sufficient for a same-session cache
  // where nothing else mutates these objects after construction. Provider
  // (D071) is folded into the key too — the same figures narrated by two
  // different providers are two different results, not one cache entry.
  return `${input.touchpoint}:${provider ?? 'default'}:${JSON.stringify(input)}`
}

/**
 * `provider` (D071) is the Demo Settings dialog's runtime selection, sent as
 * a sibling field on the request body — never part of NarrationInput itself
 * (that stays exactly the CD-4.2 boundary contract: only already-computed
 * figures). Omit it to use whichever provider NARRATION_PROVIDER resolves to
 * server-side, unchanged behavior from before this parameter existed.
 */
export async function getNarration(input: NarrationInput, provider?: string): Promise<NarrationResult> {
  const key = cacheKey(input, provider)
  const cached = cache.get(key)
  if (cached) return cached

  let result: NarrationResult
  try {
    const res = await fetch('/api/narrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(provider ? { ...input, provider } : input),
    })
    if (!res.ok) {
      // providerStatus/providerName are internal-use-only fields the API
      // route adds for exactly this purpose (dev/api/narrate.ts) — never
      // shown to the user as text, only fed to the provider-failure
      // indicator so a real failure here still updates it even though the
      // touchpoint itself silently recovers via the deterministic fallback
      // below.
      const body = await res.json().catch(() => ({})) as { error?: string; providerStatus?: number; providerName?: string }
      if (body.providerName) recordProviderFailure(body.providerName, body.providerStatus)
      throw new Error(body.error ?? `narrate API returned ${res.status}`)
    }
    const body = await res.json() as { text?: string; error?: string; providerName?: string }
    if (!body.text) throw new Error(body.error ?? 'narrate API returned no text')
    if (body.providerName) recordProviderSuccess(body.providerName)
    result = { text: body.text, aiGenerated: true }
  } catch {
    result = { text: buildDeterministicFallback(input), aiGenerated: false }
  }

  cache.set(key, result)
  return result
}

/** For components that want to paint the fallback synchronously before the async call resolves. */
export function getImmediateFallback(input: NarrationInput): NarrationResult {
  return { text: buildDeterministicFallback(input), aiGenerated: false }
}
