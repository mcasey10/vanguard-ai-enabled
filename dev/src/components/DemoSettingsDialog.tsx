/**
 * DemoSettingsDialog — consolidated demo-control surface (D071), replacing
 * the standalone "Reset demo" header link entirely.
 *
 * Three sections: (A) reader segment for AI narration tone, with the real
 * segment-research quote for whichever segment is selected — see
 * segmentResearch.ts for sourcing; (B) per-feature AI provider selection,
 * genuinely runtime-switchable (D071 — see narrationGenerator.ts/
 * whatIfInterpreter.ts's new `override` parameter); (C) Reset demo, now with
 * a confirmation step it never had before (self-audit, D071: confirmed no
 * guard existed).
 *
 * Modal, not a drawer — this is a settings surface, not a conversation.
 * Same scrim/centered-box pattern as ModeToggleGuard.tsx's SaveDiscardDialog
 * and ScenarioAnalysis.tsx's DeleteDialog, this app's established modal
 * convention, not a new one invented for this dialog.
 */

import { useState, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { SEGMENT_PROFILES } from '../utils/segmentResearch'
import type { NarrationSegment } from '../utils/narrationShared'
import { OFFERED_PROVIDERS, fetchServerProviderDefaults, type DemoProvider, type ServerProviderDefaults } from '../utils/demoSettings'
import { getProviderFailureDisplay } from '../utils/providerFailureTracker'
import { clearAllCoachMarks } from './CoachMark'
import { ExpandableDetail } from './ExpandableDetail'

const SEGMENTS: NarrationSegment[] = ['A', 'B', 'C', 'D']

// Anthropic deliberately excluded (D072) — the adapter, its interface
// conformance, and its tests all remain exactly as built
// (dev/src/server/generators/anthropicGenerator.ts / anthropicInterpreter.ts,
// DemoProvider still includes 'anthropic') — this deployment simply has no
// ANTHROPIC_API_KEY configured, so offering it here would let a user pick an
// option that can't actually succeed. Derived from OFFERED_PROVIDERS
// (demoSettings.ts) rather than hand-listed here a second time (D073) — that
// was the actual root cause of D073's bug: a persisted choice could point at
// an option this list no longer contained, and nothing reconciled it, so
// neither rendered button ever matched. One source of truth now.
const PROVIDER_LABELS: Record<DemoProvider, string> = { gemini: 'Gemini', anthropic: 'Anthropic', groq: 'Groq' }
const PROVIDERS = OFFERED_PROVIDERS.map(value => ({ value, label: PROVIDER_LABELS[value] }))

// Last-resort fallback only if /api/demo-config itself can't be reached at
// all (network failure, not just an unresolved provider) — Gemini is this
// project's documented code-level default (D042/D053).
const FALLBACK_PROVIDER: DemoProvider = 'gemini'

function SegmentControl({ value, onChange }: { value: NarrationSegment; onChange: (s: NarrationSegment) => void }) {
  return (
    <div className="flex items-center gap-[2px] border-[1.5px] border-vg-ink rounded-full p-[2px] bg-white w-fit">
      {SEGMENTS.map(s => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`h-[32px] w-[40px] rounded-full text-[13px] font-bold transition-colors ${
            value === s ? 'bg-vg-teal text-white' : 'text-vg-ink hover:bg-[#f0f0f0]'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

function ProviderControl({ value, onChange }: { value: DemoProvider; onChange: (p: DemoProvider) => void }) {
  return (
    <div className="flex items-center gap-[2px] border-[1.5px] border-vg-ink rounded-full p-[2px] bg-white w-fit">
      {PROVIDERS.map(p => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={`h-[32px] px-4 rounded-full text-[13px] font-bold whitespace-nowrap transition-colors ${
            value === p.value ? 'bg-vg-teal text-white' : 'text-vg-ink hover:bg-[#f0f0f0]'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

// Provider-failure indicator (DECISIONS.md's provider-failure-indicator
// entry, item 2) — shown beneath whichever dropdown(s) currently have the
// affected provider selected, so both rows show it when both happen to
// point at the same failed provider. Renders nothing when
// getProviderFailureDisplay() has nothing to say (no recent failure, or a
// stale one already past its day-rollover).
function ProviderFailureNote({ providerName }: { providerName: DemoProvider }) {
  const text = getProviderFailureDisplay(providerName)
  if (!text) return null
  return <span className="text-[11px] text-[#a35b00] leading-normal">{text}</span>
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-[10px] font-semibold text-[#717777] uppercase tracking-wide">{label}</span>
      <span className="text-[13px] text-vg-ink leading-normal">{value}</span>
    </div>
  )
}

export function DemoSettingsDialog({ onClose }: { onClose: () => void }) {
  const { demoSettings, setDemoSettings } = useAppStore()
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [coachMarksCleared, setCoachMarksCleared] = useState(false)
  const profile = SEGMENT_PROFILES[demoSettings.narrationSegment]

  function handleClearCoachMarks() {
    clearAllCoachMarks()
    setCoachMarksCleared(true)
  }

  // The real server-resolved default (D073) — fetched once per dialog open,
  // used only when the user hasn't made an explicit choice yet
  // (demoSettings.narrationProvider/whatifProvider === null). null until the
  // fetch resolves; both rows fall back to FALLBACK_PROVIDER in that brief
  // window rather than rendering with nothing highlighted.
  const [serverDefaults, setServerDefaults] = useState<ServerProviderDefaults>({ narrationProvider: null, whatifProvider: null })
  useEffect(() => {
    let cancelled = false
    fetchServerProviderDefaults().then(d => { if (!cancelled) setServerDefaults(d) })
    return () => { cancelled = true }
  }, [])

  const effectiveNarrationProvider = demoSettings.narrationProvider ?? serverDefaults.narrationProvider ?? FALLBACK_PROVIDER
  const effectiveWhatifProvider = demoSettings.whatifProvider ?? serverDefaults.whatifProvider ?? FALLBACK_PROVIDER

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div
        className="absolute bg-white rounded-[8px] flex flex-col overflow-hidden"
        style={{
          width: 600,
          maxHeight: '85vh',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          filter: 'drop-shadow(0px 4px 8px rgba(4,5,5,0.2))',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e8e9e9] shrink-0">
          <span className="text-[20px] font-bold text-vg-ink">Demo settings</span>
          <button onClick={onClose} aria-label="Close" className="text-[22px] text-vg-ink hover:opacity-70 leading-none">×</button>
        </div>

        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-7">

          {/* Section A — reader segment */}
          <section className="flex flex-col gap-3">
            <span className="text-[12px] font-bold text-vg-ink">User segment for tone of AI narration</span>
            {/* Orients the reader before they use the control below, unlike
                every other ExpandableDetail in this app (Breakdown, Why?, Lot
                details), which explains a result that already exists — those
                belong after the thing they explain, this belongs before it.
                General/constant across all four segments either way —
                deliberately not inside the per-segment profile card further
                below, which would make this read as specific to whichever
                segment happens to be selected. */}
            <ExpandableDetail label="How is this used?" panelWidth={420}>
              <p className="text-[12px] text-vg-ink leading-relaxed">
                This selector is used to demonstrate how the AI narration can adapt to a user&apos;s mindset. These four user segments come from research describing situational mindsets (not personas). The same investor can occupy different situational mindsets at different times, but this demo app doesn&apos;t attempt to infer a segment from behavior. A production version could derive some context about the user&apos;s mindset based upon the complexity of their portfolio and scenario inputs, and/or offer the user an option to include more/less detail.
              </p>
            </ExpandableDetail>
            <SegmentControl
              value={demoSettings.narrationSegment}
              onChange={s => setDemoSettings({ narrationSegment: s })}
            />
            <div className="p-4 rounded-[8px] border border-[#e8e9e9] bg-[#f8f8f7] flex flex-col gap-3">
              <span className="text-[13px] font-bold text-vg-ink">{demoSettings.narrationSegment} — {profile.name}</span>
              <Field label="Trigger" value={profile.trigger} />
              <Field label="Goal" value={profile.goal} />
              <Field label="Tool must" value={profile.toolMust} />
              <Field label="Tool must avoid" value={profile.toolMustAvoid} />
              {profile.inThisApp && (
                <div className="pt-3 border-t border-dashed border-[#c8c8c8] flex flex-col gap-[2px]">
                  <span className="text-[10px] font-semibold text-[#717777] uppercase tracking-wide">In this app</span>
                  <span className="text-[13px] text-vg-ink italic leading-normal">{profile.inThisApp}</span>
                </div>
              )}
            </div>
          </section>

          {/* Section B — AI model */}
          <section className="flex flex-col gap-3">
            <span className="text-[12px] font-bold text-vg-ink">AI model</span>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[13px] text-vg-ink">Narration of summaries</span>
                <ProviderControl
                  value={effectiveNarrationProvider}
                  onChange={p => setDemoSettings({ narrationProvider: p })}
                />
              </div>
              <ProviderFailureNote providerName={effectiveNarrationProvider} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[13px] text-vg-ink">Scenario assistant</span>
                <ProviderControl
                  value={effectiveWhatifProvider}
                  onChange={p => setDemoSettings({ whatifProvider: p })}
                />
              </div>
              <ProviderFailureNote providerName={effectiveWhatifProvider} />
            </div>
          </section>

          {/* Coach marks — a simple, one-time dismiss-all action, lower-stakes
              than Reset demo below (touches no portfolio/transaction data),
              so it doesn't need a confirmation gate. Covers every coach mark
              that exists right now, on any page, via a storage-level
              sentinel rather than an enumerated ID list — see
              clearAllCoachMarks() (CoachMark.tsx) for why. Not a persistent
              preference: Reset demo below still unconditionally restores all
              coach marks exactly as it always has, and this action doesn't
              change that in any way. */}
          <section className="flex flex-col gap-3">
            <span className="text-[12px] font-bold text-vg-ink">Coach marks</span>
            <p className="text-[12px] text-[#717777] leading-normal">
              Dismisses every Coach mark beacon, as if "Got it" had been clicked on each one.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleClearCoachMarks}
                className="h-[36px] px-4 rounded-full border-[1.5px] border-vg-ink text-vg-ink bg-white text-[13px] font-bold hover:opacity-90 transition-opacity"
                type="button"
              >
                Clear all coach marks
              </button>
              {coachMarksCleared && <span className="text-[12px] font-bold text-[#1f7a4d]">Cleared</span>}
            </div>
          </section>

          {/* Section C — Reset demo, visually distinct warning tone */}
          <section className="p-4 rounded-[8px] border border-[#f0c0c0] bg-[#fdf1f0] flex flex-col gap-3">
            <span className="text-[12px] font-bold text-[#7a1f14]">Reset demo</span>
            {!confirmingReset ? (
              <>
                <p className="text-[12px] text-[#7a1f14] leading-normal">
                  Restores the canonical sample portfolio, clears all completed transactions and saved scenarios, and restores all coach mark beacons to their initial state. Not part of the production feature set — for demonstration purposes only.
                </p>
                <button
                  onClick={() => setConfirmingReset(true)}
                  className="self-start h-[36px] px-4 rounded-full border-[1.5px] border-[#7a1f14] text-[#7a1f14] bg-white text-[13px] font-bold hover:opacity-90 transition-opacity"
                >
                  Reset demo
                </button>
              </>
            ) : (
              <>
                <p className="text-[13px] font-bold text-[#7a1f14] leading-normal">
                  Reset all demo data? This can't be undone.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { window.location.href = '/?reset=true' }}
                    className="h-[36px] px-4 rounded-full bg-[#7a1f14] text-white text-[13px] font-bold hover:opacity-90 transition-opacity"
                  >
                    Reset demo
                  </button>
                  <button
                    onClick={() => setConfirmingReset(false)}
                    className="h-[36px] px-4 rounded-full border-[1.5px] border-vg-ink text-vg-ink bg-white text-[13px] font-bold hover:opacity-90 transition-opacity"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </section>

        </div>
      </div>
    </div>
  )
}
