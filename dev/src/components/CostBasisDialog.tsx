/**
 * CostBasisDialog — accounting method selector (REQ-B3-003)
 *
 * Figma: 660:4194 (Cost Basis Dialog, 800×651px)
 * Jira:  VSR-22
 *
 * Triggered by the "Edit" link next to Cost Basis Method on any active fund row.
 * Selecting a method and clicking "Continue" updates the triggering row's local
 * display only — NOT lifted to parent state. Full state-lifting and recalculation
 * belong to the REQ-B3-003 TODO already documented in FundSelectionManual2.tsx.
 *
 * Trigger points: FundSelectionManual2 (ActiveFundRow), FundSelectionManualLot
 * (expanded row + CollapsedActiveFundRow).
 */

import { useState } from 'react'
import type { CostBasisMethod } from '../types'

export type { CostBasisMethod }

const METHODS: { id: CostBasisMethod; label: string; description: string }[] = [
  {
    id: 'MinTax',
    label: 'Minimum tax (MinTax)',
    description:
      'Aims to reduce the tax rate applied—not the total tax owed—by prioritizing the sale of shares in order of potential tax rate favorability: short-term losses, long-term losses, long-term gains, and short-term gains.',
  },
  {
    id: 'HIFO',
    label: 'Highest in, first out (HIFO)',
    description:
      "The shares you bought at the highest price will be the first shares we sell, regardless of how long you've held the security.",
  },
  {
    id: 'FIFO',
    label: 'First in, first out (FIFO)',
    description: 'Shares with the oldest acquisition date are sold first.',
  },
  {
    id: 'SpecID',
    label: 'Specific identification (SpecID)',
    description: 'You select the shares (or lots) to sell.',
  },
  {
    id: 'AvgCost',
    label: 'Average cost (AvgCost)',
    description:
      'Calculates cost basis using an average cost for each share you own so that all shares of a security have the same cost basis.',
  },
]

export function CostBasisDialog({
  currentMethod,
  onConfirm,
  onClose,
}: {
  currentMethod: CostBasisMethod
  onConfirm: (method: CostBasisMethod) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<CostBasisMethod>(currentMethod)

  return (
    <div className="fixed inset-0 z-50">
      {/* Scrim — dismissible per established pattern (same rationale as SaveDiscardDialog) */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog — 800×651px, lighter shadow per Figma (0px_2px_6px_rgba(4,5,5,0.12)) */}
      <div
        className="absolute bg-white rounded-[4px] flex flex-col overflow-hidden"
        style={{
          width: 800,
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          filter: 'drop-shadow(0px 2px 6px rgba(4,5,5,0.12))',
        }}
      >
        {/* × close — absolute top-right */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute text-[16px] text-vg-ink cursor-pointer leading-none hover:opacity-70"
          style={{ left: 772, top: 28, transform: 'translate(-50%, -50%)' }}
        >
          ×
        </button>

        {/* Header */}
        <div className="flex flex-col p-6 border-b border-[#e0e0e0] bg-white shrink-0">
          <p className="text-[20px] font-bold text-vg-ink">Choose a cost basis method</p>
          <div className="pt-3">
            <p className="text-[14px] text-vg-ink leading-normal">
              Cost basis is generally the price you paid for your shares of a security. The cost
              basis method you choose will help determine your gain or loss on the sale along with
              its tax implications.
            </p>
          </div>
          <div className="pt-2">
            <p className="text-[14px] text-vg-ink leading-normal">
              Your selection will be established as your preferred cost basis method for this
              holding for all future sales, unless you select SpecID.
            </p>
          </div>
          <div className="pt-2">
            <a className="text-[14px] text-[#1255ff] underline cursor-pointer">
              Learn more about cost basis →
            </a>
          </div>
        </div>

        {/* Method List — 5 radio rows */}
        <div className="flex flex-col overflow-y-auto">
          {METHODS.map(method => (
            <label
              key={method.id}
              className="flex items-center justify-between px-6 py-4 border-b border-[#e0e0e0] cursor-pointer hover:bg-[#f8f8f8] transition-colors"
            >
              {/* Left: radio + method name */}
              <div className="flex items-center gap-3 shrink-0">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    selected === method.id ? 'border-vg-ink' : 'border-vg-ink-muted'
                  }`}
                  onClick={() => setSelected(method.id)}
                >
                  {selected === method.id && (
                    <div className="w-2.5 h-2.5 rounded-full bg-vg-ink" />
                  )}
                </div>
                <span
                  className="text-[14px] font-medium text-vg-ink whitespace-nowrap"
                  onClick={() => setSelected(method.id)}
                >
                  {method.label}
                </span>
              </div>
              {/* Right: description */}
              <p
                className="text-[14px] text-vg-ink-muted leading-normal"
                style={{ width: 380 }}
                onClick={() => setSelected(method.id)}
              >
                {method.description}
              </p>
            </label>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-6 border-t border-[#e0e0e0] bg-white shrink-0">
          <button
            onClick={() => onConfirm(selected)}
            className="h-[48px] px-7 rounded-full bg-vg-ink text-white text-[14px] font-bold hover:opacity-90 transition-opacity"
          >
            Continue
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
