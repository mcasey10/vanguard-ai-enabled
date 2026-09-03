/**
 * ExpandableDetail — generic "Label ▾" / "Label ▴" click-to-expand-in-place
 * trigger, built once and reused for both "Breakdown ▾" (tax figures) and
 * "Why? ▾" (early withdrawal penalty) — DECISIONS.md's breakdown-expanders
 * entry, item 1: one shared component, not two separate implementations.
 *
 * Visual/label style matches the existing "Lot details ▾"/"▴" pattern
 * (FundSelectionManual2.tsx / FundSelectionManualLot.tsx) exactly — same
 * text/chevron classes. The underlying mechanics reuse CoachMark.tsx's
 * proven trigger+portal+getBoundingClientRect technique rather than
 * rendering the panel as a normal DOM child of the trigger: several of this
 * component's real call sites are narrow `overflow-hidden` flex cards (the
 * three Fund Selection pages' 7-card summary banner), where a normally-
 * positioned expanded panel wider than its own card would be silently
 * clipped by that ancestor's overflow-hidden — a portal to document.body,
 * positioned via the trigger's real screen coordinates, sidesteps that
 * entirely and behaves identically whether or not the trigger happens to
 * sit inside a clipping ancestor.
 */

import { useState, useRef, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface PanelPosition {
  top: number
  left: number
}

const PANEL_OFFSET = 6

function computePanelPos(triggerRect: DOMRect, panelWidth: number): PanelPosition {
  let top = triggerRect.bottom + PANEL_OFFSET
  let left = triggerRect.left

  // Flip vertically if the panel would overflow the bottom of the viewport
  if (top + 200 > window.innerHeight - 16) {
    top = triggerRect.top - PANEL_OFFSET
  }

  // Nudge left if the panel would overflow the right edge
  if (left + panelWidth > window.innerWidth - 16) {
    left = triggerRect.right - panelWidth
  }
  // Final clamp, independent of the nudge above — a trigger whose own
  // bounding rect already extends past the viewport (e.g. a button that
  // stretched to fill a flex-col parent's cross-axis width, as
  // FundSelectionAutomated.tsx's summary cards do by default) would
  // otherwise still produce an overflowing `left`, since the nudge only
  // repositions relative to the trigger's own edge, not the viewport's.
  left = Math.min(left, window.innerWidth - panelWidth - 16)
  left = Math.max(12, left)

  return { top, left }
}

export interface ExpandableDetailProps {
  /** The trigger text, e.g. "Breakdown" or "Why?" — the ▾/▴ chevron is added automatically. */
  label: string
  children: ReactNode
  /** Panel width in px. Default fits the tax-breakdown content comfortably
   *  without being so wide it looks odd anchored to a narrow trigger. */
  panelWidth?: number
  className?: string
}

export function ExpandableDetail({ label, children, panelWidth = 320, className }: ExpandableDetailProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<PanelPosition>({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleToggle = useCallback(() => {
    if (!open && triggerRef.current) {
      setPos(computePanelPos(triggerRef.current.getBoundingClientRect(), panelWidth))
    }
    setOpen(o => !o)
  }, [open, panelWidth])

  const handleClose = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        type="button"
        // self-start + w-fit: several real call sites place this inside a
        // `flex flex-col` card with no `items-start` override, whose default
        // cross-axis alignment is `stretch` — without this, the button
        // silently stretches to the full width of that card, which then
        // also breaks the portal panel's own edge-overflow math (it anchors
        // off the trigger's real bounding rect).
        className={`flex items-center gap-1 self-start w-fit cursor-pointer hover:opacity-70 ${className ?? ''}`}
      >
        <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{label}</span>
        <span className="text-vg-ink-muted text-base leading-none">{open ? '▴' : '▾'}</span>
      </button>

      {open && createPortal(
        <>
          {/* Invisible click-catcher — closes on outside click, no visual dimming (this is an informational popover, not a modal). */}
          <div className="fixed inset-0 z-[998]" onClick={handleClose} />

          <div
            className="fixed z-[999] bg-white rounded-[8px] overflow-hidden"
            style={{
              top: pos.top,
              left: pos.left,
              width: panelWidth,
              boxShadow: '0 8px 24px rgba(4,5,5,0.18)',
              border: '1px solid #e8e9e9',
            }}
          >
            <div className="p-3">{children}</div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
