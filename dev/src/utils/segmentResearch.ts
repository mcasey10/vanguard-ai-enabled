/**
 * Segment research content for the Demo Settings dialog's Section A (D071).
 *
 * Quoted directly, not invented, from the real segment-research artifact:
 * https://mcasey10.github.io/vanguard-ai-pipeline/pm/contextual_segment_map.html
 * (fetched live in this session — see DECISIONS.md D071). That page's own
 * per-segment fields are "trigger" (the collapsed card's subtitle),
 * "Primary goal," "Tool must," and "Tool must avoid" — the same four fields
 * requested for this dialog. "Key anxiety" and "Likely workflow" exist on
 * the source page too but weren't asked for here, and "Likely workflow"
 * specifically still uses the superseded "Workflow A/B" terminology
 * (CLAUDE.md §3's glossary) — reproducing it verbatim in shipped UI would
 * reintroduce deprecated terms, so it's deliberately omitted rather than
 * silently rewritten (a quote gets reproduced exactly or not at all).
 */

import type { NarrationSegment } from './narrationShared'

export interface SegmentProfile {
  name: string
  trigger: string
  goal: string
  toolMust: string
  toolMustAvoid: string
  /** D071 — this app's own concrete translation of the research finding into an actual product decision, distinct from the quoted research itself. */
  inThisApp?: string
}

export const SEGMENT_PROFILES: Record<NarrationSegment, SegmentProfile> = {
  A: {
    name: 'Strategic optimizer',
    trigger: 'Planning a large withdrawal, comparing scenarios',
    goal: 'Maximum optimization across both tax and rebalancing dimensions',
    toolMust: 'Surface lot-level detail, progressive disclosure of optimization logic',
    toolMustAvoid: "Hiding reasoning; oversimplified rationale that can't be audited",
  },
  B: {
    name: 'Routine executor',
    trigger: 'Quarterly drawdown, RMD, established withdrawal pattern',
    goal: 'Efficient confirmation that the routine withdrawal is reasonable',
    toolMust: 'Consistent, predictable recommendations that reinforce routine',
    toolMustAvoid: 'Pushing scenario comparison onto a user who just wants to execute',
  },
  C: {
    name: 'Reactive withdrawer',
    trigger: 'Medical bill, family emergency, urgent external need',
    goal: 'Fastest credible path to executing a specific dollar amount',
    toolMust: 'Single trustworthy recommendation, minimal inputs, short path to execution',
    toolMustAvoid: 'Scenario comparison, tax detail, anything that reads as optional extra work',
    inThisApp: "Scenario Analysis stays available to everyone — this isn't proactively suggested for this segment's default path, not hidden or restricted.",
  },
  D: {
    name: 'Newly self-directed',
    trigger: 'Death of spouse, divorce, end of advisor relationship',
    goal: 'Comprehension before optimization — understand what is happening',
    toolMust: 'Orientation before action, plain-language rationale, comfort with incomplete sessions',
    toolMustAvoid: 'Leading with a recommendation before establishing comprehension',
    inThisApp: "Learning resources (plain-language rationale, coach marks) are offered alongside the recommendation, not required before seeing it — comprehension can't be measured, so nothing is gated behind it.",
  },
}
