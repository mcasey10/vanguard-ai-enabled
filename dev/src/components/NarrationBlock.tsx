/**
 * NarrationBlock — the one narration component all four Feature 1
 * touchpoints render through (CLAUDE.md §7: "one spec, four call sites").
 *
 * Renders the deterministic fallback synchronously on first paint (no
 * blank/loading flash), then swaps to the live Anthropic narration when it
 * resolves. The CD-1.2 "AI-generated" badge appears only when the text
 * actually came from the model — see getNarration()/getImmediateFallback()
 * in dev/src/utils/narration.ts and CLAUDE.md §7's failure-fallback rule.
 */

import { useEffect, useState } from 'react'
import { getNarration, getImmediateFallback, type NarrationResult } from '../utils/narration'
import type { NarrationInput } from '../utils/narrationShared'

export function NarrationBlock({
  input,
  className,
  textClassName = 'text-[13px] italic text-vg-ink-muted',
  provider,
}: {
  input: NarrationInput
  className?: string
  /** Override the narration text's own styling to match a touchpoint's existing look. */
  textClassName?: string
  /** Demo Settings dialog's runtime provider selection (D071) — omit to use the server's NARRATION_PROVIDER default. */
  provider?: string
}) {
  const [result, setResult] = useState<NarrationResult>(() => getImmediateFallback(input))

  useEffect(() => {
    let cancelled = false
    setResult(getImmediateFallback(input))
    getNarration(input, provider).then(r => {
      if (!cancelled) setResult(r)
    })
    return () => { cancelled = true }
    // input is a freshly-built object per render at each call site; comparing
    // its serialized form (rather than identity) is what getNarration()'s own
    // cache key already does, so re-fetching here on every input change is
    // correct and cheap once cached. provider is included too so switching
    // it in Demo Settings re-fetches instead of reusing a stale entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(input), provider])

  return (
    <div className={className}>
      {result.aiGenerated && (
        <div className="inline-flex items-center gap-[4px] bg-[#f3e8fd] px-[8px] py-[2px] rounded-[100px] mb-[4px]">
          <span className="text-[10px] font-semibold text-[#6b21a8] whitespace-nowrap">AI-generated</span>
        </div>
      )}
      <p className={textClassName}>{result.text}</p>
    </div>
  )
}
