/**
 * Client-side narration fetcher. Calls POST /api/narrate (the Vercel
 * serverless function / its Vite dev-server equivalent), falls back to a
 * deterministic summary on failure, and memoizes by input content for the
 * session — see CLAUDE.md §7 and DECISIONS.md D038 for why each of these
 * exists.
 */

import { buildDeterministicFallback, type NarrationInput } from './narrationShared'

export interface NarrationResult {
  text: string
  /** CD-1.2: only true when the text actually came from the model. */
  aiGenerated: boolean
}

// Session-scoped, in-memory only — never persisted (D038: avoids
// stale-cache-across-dataset-version risk; a prototype has no cache
// invalidation infrastructure to keep a persisted cache honest).
const cache = new Map<string, NarrationResult>()

function cacheKey(input: NarrationInput): string {
  // Stable stringify: NarrationInput's own field order is already fixed by
  // how callers construct it, and JSON.stringify is deterministic for a
  // given object's insertion order — sufficient for a same-session cache
  // where nothing else mutates these objects after construction.
  return `${input.touchpoint}:${JSON.stringify(input)}`
}

export async function getNarration(input: NarrationInput): Promise<NarrationResult> {
  const key = cacheKey(input)
  const cached = cache.get(key)
  if (cached) return cached

  let result: NarrationResult
  try {
    const res = await fetch('/api/narrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw new Error(`narrate API returned ${res.status}`)
    const body = await res.json() as { text?: string; error?: string }
    if (!body.text) throw new Error(body.error ?? 'narrate API returned no text')
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
