/**
 * CoachMark — pulsing walkthrough beacon + floating dialog
 *
 * Replaces the "?" badge + tooltip system. Each beacon persists its dismissed
 * state to localStorage so it never reappears after the user clicks "Got it".
 *
 * Usage:
 *   <CoachMark id="tax" text="We're using a mid-range tax rate..." />
 *
 * The component renders null once dismissed. Position it inline adjacent to
 * the UI element it explains — the dialog auto-positions via getBoundingClientRect.
 *
 * Also exports clearAllCoachMarks() — the Demo Settings "Clear all coach
 * marks" action (DECISIONS.md's clear-all-coach-marks entry). Coach marks are
 * scattered across many pages and only the ones on the *current* route are
 * ever mounted at once (this app has no persistent page that holds all of
 * them) — so a "clear all" that snapshots currently-mounted IDs could never
 * reach the ones on pages the user isn't viewing right now, and a hardcoded
 * ID list would silently go stale the next time a CoachMark is added
 * somewhere. Both are avoided by storing a single sentinel value instead of
 * a per-ID array when "clear all" is used — see DISMISS_ALL_SENTINEL below.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_KEY = 'vsr_coach_marks_dismissed'

// Sentinel stored in place of a per-ID array — deliberately ID-agnostic, so
// it dismisses every coach mark that exists today AND any added in a future
// code change, with no ID list anywhere to remember to update. A raw string
// (not JSON-wrapped) so it's cheap to check before ever attempting
// JSON.parse on the normal array case.
const DISMISS_ALL_SENTINEL = 'ALL'

function isDismissed(id: string): boolean {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return false
    if (raw === DISMISS_ALL_SENTINEL) return true
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) && parsed.includes(id)
  } catch {
    return false
  }
}

function addDismissed(id: string): void {
  let current: string[] = []
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw && raw !== DISMISS_ALL_SENTINEL) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) current = parsed
    }
  } catch {
    current = []
  }
  if (!current.includes(id)) {
    localStorage.setItem(LS_KEY, JSON.stringify([...current, id]))
  }
}

/**
 * "Clear all coach marks" (Demo Settings) — a simple, one-time dismiss-all
 * action, not a persistent preference: it dismisses every coach mark that
 * exists right now, exactly as if the user had clicked "Got it" on each one.
 * It does NOT prevent a coach mark added in a future code change from ever
 * showing — only ones that exist at the moment this is clicked. Lower-stakes
 * than "Reset demo" (FundSelectionEntry.tsx's /?reset=true flow) — that flow
 * removes this same localStorage key entirely (unconditionally restoring
 * every coach mark) and is deliberately left untouched by this addition;
 * this function only ever *sets* the key, never removes it, so the two
 * actions can't interfere with each other's behavior.
 *
 * Fires the same 'vsr-reset' event Reset demo already dispatches — every
 * mounted CoachMark already listens to it to re-check its own dismissed
 * state, and "something external changed dismissed-state, recheck" is
 * exactly the right semantics for both cases, so the existing plumbing is
 * reused rather than duplicated with a second event name.
 */
export function clearAllCoachMarks(): void {
  localStorage.setItem(LS_KEY, DISMISS_ALL_SENTINEL)
  window.dispatchEvent(new Event('vsr-reset'))
}

// ---------------------------------------------------------------------------
// Dialog position — below-right of beacon by default; flips on overflow
// ---------------------------------------------------------------------------

interface DialogPosition {
  top: number
  left: number
}

const DIALOG_W = 320
const DIALOG_H = 160   // conservative estimate; actual height may vary
const OFFSET   = 12    // gap between beacon and dialog edge

function computeDialogPos(beaconRect: DOMRect): DialogPosition {
  let top  = beaconRect.bottom + OFFSET
  let left = beaconRect.left

  // Flip vertically if the dialog would overflow the bottom
  if (top + DIALOG_H > window.innerHeight - 16) {
    top = beaconRect.top - DIALOG_H - OFFSET
  }

  // Flip / nudge horizontally if dialog overflows right edge
  if (left + DIALOG_W > window.innerWidth - 16) {
    left = beaconRect.right - DIALOG_W
  }

  // Never let it go off the left edge
  left = Math.max(12, left)

  return { top, left }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CoachMarkProps {
  id: string
  title?: string
  text: string
  className?: string
  style?: React.CSSProperties
}

export function CoachMark({ id, title, text, className, style }: CoachMarkProps) {
  const [dismissed, setDismissed] = useState(() => isDismissed(id))
  const [open, setOpen]           = useState(false)
  const [dialogPos, setDialogPos] = useState<DialogPosition>({ top: 0, left: 0 })
  const beaconRef = useRef<HTMLButtonElement>(null)

  // Re-check if dismissed on mount and on vsr-reset (covers both the full
  // Reset-demo flow and the Demo Settings "Clear all coach marks" action)
  useEffect(() => {
    const check = () => setDismissed(isDismissed(id))
    check()
    window.addEventListener('vsr-reset', check)
    return () => window.removeEventListener('vsr-reset', check)
  }, [id])

  const handleBeaconClick = useCallback(() => {
    if (!beaconRef.current) return
    const rect = beaconRef.current.getBoundingClientRect()
    setDialogPos(computeDialogPos(rect))
    setOpen(true)
  }, [])

  const handleDismiss = useCallback(() => {
    addDismissed(id)
    setDismissed(true)
    setOpen(false)
  }, [id])

  const handleClose = useCallback(() => setOpen(false), [])

  if (dismissed) return null

  return (
    <>
      {/* Beacon dot — pulsing teal circle */}
      <button
        ref={beaconRef}
        onClick={handleBeaconClick}
        className={`coach-mark-beacon shrink-0 ${className ?? ''}`}
        style={style}
        aria-label="Open walkthrough tip"
        type="button"
      >
        <span className="block w-[10px] h-[10px] rounded-full bg-[#00BDA3]" />
      </button>

      {/* Portal: scrim + dialog */}
      {open && createPortal(
        <>
          {/* Light scrim */}
          <div
            className="fixed inset-0 z-[998]"
            style={{ background: 'rgba(0,0,0,0.15)' }}
            onClick={handleClose}
          />

          {/* Floating dialog */}
          <div
            className="fixed z-[999] overflow-hidden"
            style={{
              top:          dialogPos.top,
              left:         dialogPos.left,
              width:        DIALOG_W,
              background:   'white',
              borderRadius: 8,
              boxShadow:    '0 8px 24px rgba(4,5,5,0.15)',
            }}
          >
            {/* Teal accent bar */}
            <div style={{ height: 4, background: '#00BDA3' }} />

            <div className="px-[16px] pt-[14px] pb-[16px] flex flex-col gap-[14px]">
              {title && <p className="text-[13px] font-bold text-[#040505] uppercase tracking-wide">{title}</p>}
              <p className="text-[14px] text-[#040505] leading-relaxed">{text}</p>

              <button
                onClick={handleDismiss}
                className="w-full h-[40px] rounded-full bg-[#040505] text-white text-[14px] font-bold hover:opacity-90 transition-opacity"
                type="button"
              >
                Got it
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
