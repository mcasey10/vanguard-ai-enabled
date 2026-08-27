/**
 * TargetAllocationModal — target asset mix editor
 *
 * Figma: 667:3618 (Target Allocation Modal, 560×487px)
 *
 * Triggered by "Target allocation" link in the Summary Banner IMPACT column.
 * Trigger points: FundSelectionAutomated, FundSelectionManual2, FundSelectionManualLot.
 *
 * Stacked bar updates reactively as the user types (pure UI, no engine dependency).
 * "Save allocation" → saveTargetAllocationPlaceholder() seam (same pattern as
 * saveScenarioPlaceholder in ModeToggleGuard — TODO for when engine is built).
 */

import { useState } from 'react'

// ---------------------------------------------------------------------------
// Color tokens matching Figma chart segments
// ---------------------------------------------------------------------------
const COLORS = {
  stocks:   '#2bbfb3',  // teal
  bonds:    '#c8902a',  // amber
  reserves: '#b4b2a9',  // gray
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TargetAllocationModal({
  onClose,
  onSave,
  initialStocks = 55,
  initialBonds = 35,
  initialReserves = 10,
}: {
  onClose: () => void
  onSave?: (stocks: number, bonds: number, reserves: number) => void
  initialStocks?: number
  initialBonds?: number
  initialReserves?: number
}) {
  const [stocks,   setStocks]   = useState(Math.round(initialStocks))
  const [bonds,    setBonds]    = useState(Math.round(initialBonds))
  const [reserves, setReserves] = useState(Math.round(initialReserves))

  const total = stocks + bonds + reserves
  const valid = total === 100 && stocks >= 0 && bonds >= 0 && reserves >= 0

  // Proportional bar widths as percentages of the 100% case (clamp to 0 if invalid)
  const safeTotal = total > 0 ? total : 100
  const stocksPct   = Math.max(0, (stocks   / safeTotal) * 100)
  const bondsPct    = Math.max(0, (bonds    / safeTotal) * 100)
  const reservesPct = Math.max(0, (reserves / safeTotal) * 100)

  function handleSave() {
    if (!valid) return
    onSave?.(stocks, bonds, reserves)
    onClose()
  }

  function handleNumberInput(setter: (v: number) => void, raw: string) {
    const n = parseInt(raw.replace(/\D/g, '') || '0', 10)
    setter(Math.min(100, n))
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* Scrim */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog — 560×487px, lighter shadow per Figma */}
      <div
        className="absolute bg-white rounded-[4px] flex flex-col overflow-hidden"
        style={{
          width: 560,
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          filter: 'drop-shadow(0px 2px 6px rgba(4,5,5,0.12))',
        }}
      >
        {/* × close */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute text-[16px] text-vg-ink cursor-pointer leading-none hover:opacity-70"
          style={{ left: 532, top: 28, transform: 'translate(-50%, -50%)' }}
        >
          ×
        </button>

        {/* Header */}
        <div className="flex flex-col p-6 border-b border-[#e0e0e0] bg-white shrink-0">
          <p className="text-[20px] font-bold text-vg-ink">Set target allocation</p>
          <div className="pt-2">
            <p className="text-[14px] text-vg-ink-muted leading-normal">
              Set your target asset mix. This will be used to evaluate portfolio balance when
              calculating sell recommendations.
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col p-6 shrink-0">
          {/* Inner panel — own drop-shadow per Figma (Modal/Target Allocation) */}
          <div
            className="flex flex-col rounded-[8px] overflow-hidden bg-white w-full"
            style={{ filter: 'drop-shadow(0px 4px 8px rgba(4,5,5,0.2))' }}
          >
            {/* Stacked bar — reactive */}
            <div className="px-6 py-5">
              <div className="flex h-8 rounded-[4px] overflow-hidden w-full">
                <div
                  className="flex items-center justify-center h-full transition-all"
                  style={{ width: `${stocksPct}%`, background: COLORS.stocks, minWidth: stocksPct > 0 ? 4 : 0 }}
                >
                  {stocksPct >= 8 && (
                    <span className="text-[11px] text-white whitespace-nowrap">{stocks}%</span>
                  )}
                </div>
                <div
                  className="flex items-center justify-center h-full transition-all"
                  style={{ width: `${bondsPct}%`, background: COLORS.bonds, minWidth: bondsPct > 0 ? 4 : 0 }}
                >
                  {bondsPct >= 8 && (
                    <span className="text-[11px] text-white whitespace-nowrap">{bonds}%</span>
                  )}
                </div>
                <div
                  className="flex items-center justify-center h-full transition-all"
                  style={{ width: `${reservesPct}%`, background: COLORS.reserves, minWidth: reservesPct > 0 ? 4 : 0 }}
                >
                  {reservesPct >= 8 && (
                    <span className="text-[11px] text-white whitespace-nowrap">{reserves}%</span>
                  )}
                </div>
              </div>
            </div>

            {/* Input rows */}
            <div className="flex flex-col gap-4 px-5 pb-5">
              {/* Stocks */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS.stocks }} />
                  <span className="text-[14px] text-vg-ink">Stocks</span>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={stocks === 0 ? '' : String(stocks)}
                  onChange={e => handleNumberInput(setStocks, e.target.value)}
                  placeholder="0"
                  className="w-[120px] h-[28px] px-3 border border-vg-ink rounded-[4px] text-[14px] text-vg-ink text-right bg-white focus:outline-none focus:ring-2 focus:ring-vg-ink/20"
                />
              </div>

              {/* Bonds */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS.bonds }} />
                  <span className="text-[14px] text-vg-ink">Bonds</span>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={bonds === 0 ? '' : String(bonds)}
                  onChange={e => handleNumberInput(setBonds, e.target.value)}
                  placeholder="0"
                  className="w-[120px] h-[28px] px-3 border border-vg-ink rounded-[4px] text-[14px] text-vg-ink text-right bg-white focus:outline-none focus:ring-2 focus:ring-vg-ink/20"
                />
              </div>

              {/* Reserves */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS.reserves }} />
                  <span className="text-[14px] text-vg-ink">Reserves</span>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={reserves === 0 ? '' : String(reserves)}
                  onChange={e => handleNumberInput(setReserves, e.target.value)}
                  placeholder="0"
                  className="w-[120px] h-[28px] px-3 border border-vg-ink rounded-[4px] text-[14px] text-vg-ink text-right bg-white focus:outline-none focus:ring-2 focus:ring-vg-ink/20"
                />
              </div>
            </div>
          </div>

          {/* "Allocations must total 100%"
              Figma (667:3702) shows this as a single static italic #717777 text node — one style only,
              no error-state variant in the design context. The red color + live sum + disabled Save button
              when total ≠ 100% were added proactively as sound UX, not pulled from an explicit Figma
              error state. If Figma is ever updated to show a specific error-state design that differs
              from this behavior, this is the seam to correct. */}
          <div className="pt-2">
            <p className={`text-[11px] italic ${valid ? 'text-vg-ink-muted' : 'text-vg-red font-semibold'}`}>
              {valid ? 'Allocations must total 100%' : `Allocations must total 100% (current: ${total}%)`}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-6 border-t border-[#e0e0e0] bg-white shrink-0">
          <button
            onClick={handleSave}
            disabled={!valid}
            className="h-[48px] px-7 rounded-full bg-vg-ink text-white text-[14px] font-bold
              hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save allocation
          </button>
          <button
            onClick={onClose}
            className="h-[48px] px-7 rounded-full border-[1.5px] border-vg-ink bg-white text-[14px] font-bold text-vg-ink hover:opacity-90 transition-opacity"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
