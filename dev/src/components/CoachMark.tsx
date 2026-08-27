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
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_KEY = 'vsr_coach_marks_dismissed'

function getDismissed(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function addDismissed(id: string): void {
  const current = getDismissed()
  if (!current.includes(id)) {
    localStorage.setItem(LS_KEY, JSON.stringify([...current, id]))
  }
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
  const [dismissed, setDismissed] = useState(() => getDismissed().includes(id))
  const [open, setOpen]           = useState(false)
  const [dialogPos, setDialogPos] = useState<DialogPosition>({ top: 0, left: 0 })
  const beaconRef = useRef<HTMLButtonElement>(null)

  // Re-check if dismissed on mount and on vsr-reset (covers reset flow)
  useEffect(() => {
    const check = () => setDismissed(getDismissed().includes(id))
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
