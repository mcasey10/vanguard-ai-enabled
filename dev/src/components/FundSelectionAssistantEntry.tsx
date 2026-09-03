/**
 * FundSelectionAssistantEntry — an entry point into the Scenario assistant,
 * shown on Fund Selection only while nothing has been specified yet
 * (DECISIONS.md's fund-selection-assistant-entry / fund-selection-assistant-entry-gap
 * entries): FundSelectionEntry.tsx's amount field is empty/zero,
 * FundSelectionAutomated.tsx's amount field is empty/zero, or
 * FundSelectionManual2.tsx has no fund row currently active. Deliberately
 * its own small shared component rather than duplicated JSX, since all
 * three pages render it identically, at the identical position (below the
 * title/toggle row, not inside it — a deliberate spatial separation from
 * the Automated/Manual toggle, which governs a different concept). Not
 * rendered on FundSelectionManualLot.tsx at all — that page is only
 * reachable once a fund is already active, so the "nothing specified yet"
 * condition this exists for can never be true there.
 *
 * Visual treatment matches `fund-selection-assistant-entry-mockup.html`
 * exactly (DECISIONS.md's fund-selection-assistant-entry-styling entry) — a
 * full-width bordered box, not a bare text link: a light mint background
 * (#f0fbf8) and border (#b7ece1), descriptive text on the left, and an
 * explicit, clearly-styled "Ask the Scenario assistant" button on the
 * right. The hex values are taken directly from the mockup rather than
 * forced onto this app's named `vg-teal` token (#00bda3, a close but
 * distinct value) — same precedent as this codebase's other Figma-sourced
 * one-off colors (e.g. FundSelectionAutomated.tsx's `bg-[#e8f5f0]` summary
 * strip), which are inline arbitrary values, not retrofitted onto the
 * small set of named tokens in tailwind.config.js.
 *
 * Navigates to Scenario Analysis with its own existing "Scenario assistant"
 * panel already open, defaulting to "New" — the exact same panel a user
 * reaches by clicking that page's own header button directly, which this
 * component does not duplicate, reduce, or replace in any way. The panel
 * opens via a one-time React Router navigation-state signal
 * (`{ state: { openAssistant: true } }`, read once by ScenarioAnalysis.tsx's
 * own `useState` initializer), the same pattern this codebase already uses
 * for `navigate('/manual-lot', { state: { fund: ticker } })`.
 */

import { Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function FundSelectionAssistantEntry() {
  const navigate = useNavigate()
  return (
    <div className="px-8">
      <div className="flex items-center justify-between gap-4 bg-[#f0fbf8] border border-[#b7ece1] rounded-[10px] px-[18px] py-3">
        <div className="flex items-center gap-2.5 text-[14px] text-[#0f6e56]">
          <Sparkles size={16} className="shrink-0" />
          <span>Prefer to describe what you'd like to do instead?</span>
        </div>
        <button
          onClick={() => navigate('/scenarios', { state: { openAssistant: true } })}
          type="button"
          className="shrink-0 bg-white border border-[#14b8a6] text-[#0f6e56] font-semibold text-[13px] px-3.5 py-1.5 rounded-full hover:opacity-90 transition-opacity"
        >
          Ask the Scenario assistant
        </button>
      </div>
    </div>
  )
}
