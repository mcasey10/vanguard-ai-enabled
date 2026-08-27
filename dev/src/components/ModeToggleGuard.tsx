/**
 * ModeToggleGuard — shared module for the Manual→Automated mode-switch interrupt.
 *
 * Figma: FS-INT-SAVEDISCARD (node 425:1885)
 * Jira:  VSR-77
 * REQs:  REQ-B1-006, PM Decision 11, PM Decision 12
 *
 * Exports:
 *   useModeToggleGuard(hasAmounts)  — hook; manages dialog visibility and navigation
 *   SaveDiscardDialog               — modal UI; render when showDialog is true
 *
 * Both FundSelectionManual2 and FundSelectionManualLot import from here so the
 * trigger condition and modal behavior stay in one place.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Seam for Stage 2 scenario persistence
// ---------------------------------------------------------------------------

/**
 * TODO (Stage 2 / REQ-B4-001): Replace with real scenario persistence.
 * When Scenario Analysis is built:
 *   - Receive current appliedAmounts + activeFunds via parameter
 *   - Write a new scenario entry to a shared scenarios collection
 *   - Use the same state-lifting pattern as appliedAmounts in FundSelectionManual2
 * For now this is a clearly-named no-op so the seam is obvious.
 */
export function saveScenarioPlaceholder() {
  // no-op until Stage 2 exists
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useModeToggleGuard(hasAmounts: boolean) {
  const navigate = useNavigate()
  const [showDialog, setShowDialog] = useState(false)

  /** Call this from the "Automated" button's onClick on any Manual-mode screen. */
  function handleToggleClick() {
    if (hasAmounts) {
      setShowDialog(true)
    } else {
      // No amounts entered — silent reset per REQ-B1-006 / PDB 04 FS-MAN-1 paths
      navigate('/automated')
    }
  }

  function handleSave() {
    saveScenarioPlaceholder()
    setShowDialog(false)
    navigate('/automated')
  }

  function handleDiscard() {
    setShowDialog(false)
    navigate('/automated')
  }

  function handleClose() {
    setShowDialog(false)
  }

  return { showDialog, handleToggleClick, handleSave, handleDiscard, handleClose }
}

// ---------------------------------------------------------------------------
// Dialog component  (Figma: Modal/Dialog 425:1976 + scrim 425:1952)
// ---------------------------------------------------------------------------

/**
 * SaveDiscardDialog — the FS-INT-SAVEDISCARD overlay.
 *
 * Figma measurements:
 *   Scrim:    1440×931, y=150, semi-transparent
 *   Modal:    560×241px, x=440, y=495 (centered at 1440/2 = 720)
 *             p-[32px], rounded-[4px], drop-shadow rgba(4,5,5,0.2) 0px 4px 8px
 *   Title:    "Switch to Automated mode?" — 28px bold
 *   Body:     17px regular
 *   × close:  absolute, right-[32px] top-[16px], 24px #717777
 *   Buttons:  right-aligned pair; Discard (secondary, 187px) then Save (primary, 172px), gap-3
 *             — Figma shows them as siblings above the modal instance but both at y=664
 *               which is inside the modal's vertical bounds; React nests them inside the div.
 */
export function SaveDiscardDialog({
  onSave,
  onDiscard,
  onClose,
}: {
  onSave: () => void
  onDiscard: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50">
      {/* Scrim — dismisses dialog (same outcome as × close: stay on current screen, no navigation).
          Figma prototype interactions on the scrim element (425:1952) could not be verified from
          metadata; both × and scrim-click resolve to the same safe outcome (no data lost, no
          navigation), so scrim-dismiss is the deliberate choice over forced-choice (scrim=no-op).
          If Figma ever specifies forced-choice, remove onClick here. */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal/Dialog — 560px, centered */}
      <div
        className="absolute bg-white rounded-[4px] p-8 flex flex-col"
        style={{
          width: 560,
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          filter: 'drop-shadow(0px 4px 8px rgba(4,5,5,0.2))',
        }}
      >
        {/* × close — absolute top-right inside padding boundary */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute text-[24px] text-vg-ink-muted cursor-pointer leading-none hover:opacity-70"
          style={{ right: 32, top: 16 }}
        >
          ×
        </button>

        {/* Title */}
        <p className="text-[28px] font-bold text-vg-ink whitespace-nowrap">
          Switch to Automated mode?
        </p>

        <div className="h-4" />

        {/* Body */}
        <p className="text-[17px] text-vg-ink leading-normal">
          You have entered sell amounts manually. Switching to Automated mode will replace your
          current entries with the system recommendation.
        </p>

        <div className="h-8" />

        {/* Footer buttons — right-aligned (Discard left, Save right), 12px gap per Figma */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onDiscard}
            className="h-[48px] px-7 rounded-full border-[1.5px] border-vg-ink bg-white
              text-[14px] font-bold text-vg-ink hover:opacity-90 transition-opacity whitespace-nowrap"
            style={{ minWidth: 187 }}
          >
            Discard and switch
          </button>
          <button
            onClick={onSave}
            className="h-[48px] px-7 rounded-full bg-vg-ink text-white
              text-[14px] font-bold hover:opacity-90 transition-opacity whitespace-nowrap"
            style={{ minWidth: 172 }}
          >
            Save as scenario
          </button>
        </div>
      </div>
    </div>
  )
}
