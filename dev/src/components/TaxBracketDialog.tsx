/**
 * TaxBracketDialog — the "Change" tax-bracket control, functional for the
 * first time (it rendered as a bare, click-handler-less <a> on all five
 * pages that show it — confirmed by direct source inspection before
 * building this, not assumed).
 *
 * Deliberately NOT free-form numeric income entry, and NOT two independent
 * selections against the ordinary-income and long-term-capital-gains
 * tables separately — those two real tables don't share threshold
 * boundaries, so picking a row from either alone can be genuinely
 * ambiguous for a real filer. Instead: pick a filing status, then pick one
 * row from the *union* of both tables' breakpoints for that status
 * (taxBrackets2026.ts) — every row unambiguously determines both st_rate
 * and lt_rate together. See that file for the real 2026 bracket data and
 * why Married Filing Separately is excluded.
 *
 * Same centered-modal convention as this app's other confirm-style dialogs
 * (ScenarioAnalysis.tsx's DeleteDialog, ModeToggleGuard.tsx's
 * SaveDiscardDialog, WhatIfPanel.tsx's close-confirmation) — not a new
 * pattern invented for this.
 *
 * Selection persistence (D081): the filing status and income-band row are
 * remembered across dialog close/reopen via demoSettings.ts — the same
 * localStorage-backed mechanism already storing the other Demo Settings
 * (segment, provider choices), for consistency rather than a bespoke second
 * persistence path. What's stored is the actual filing-status and
 * income-band *identifiers* (minIncome), not just the resulting rates —
 * more than one band could in principle produce the same st_rate/lt_rate
 * pair, so a rate-only persistence couldn't reliably say which row to
 * re-highlight on reopen.
 */

import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import {
  TAX_BRACKETS_2026, FILING_STATUS_LABELS, formatIncomeRange,
  type FilingStatus, type TaxBracketRow,
} from '../data/taxBrackets2026'

const FILING_STATUSES = Object.keys(FILING_STATUS_LABELS) as FilingStatus[]

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

// Resolves the persisted {filingStatus, incomeMin} pair back into a real
// TaxBracketRow object, if both are set and still valid — demoSettings.ts's
// own loadDemoSettings() already guarantees the pair is consistent (both
// null or both a real, currently-existing row), so this only needs to look
// the row up, not re-validate it.
function resolvePersistedRow(filingStatus: FilingStatus | null, incomeMin: number | null): TaxBracketRow | null {
  if (filingStatus === null || incomeMin === null) return null
  return TAX_BRACKETS_2026[filingStatus].find(row => row.minIncome === incomeMin) ?? null
}

export function TaxBracketDialog({ onClose }: { onClose: () => void }) {
  const { activeTaxRates, setActiveTaxRates, demoSettings, setDemoSettings } = useAppStore()
  const [filingStatus, setFilingStatus] = useState<FilingStatus | null>(demoSettings.taxBracketFilingStatus)
  const [selectedRow, setSelectedRow] = useState<TaxBracketRow | null>(
    resolvePersistedRow(demoSettings.taxBracketFilingStatus, demoSettings.taxBracketIncomeMin)
  )

  const rows = filingStatus ? TAX_BRACKETS_2026[filingStatus] : []

  function selectFilingStatus(fs: FilingStatus) {
    setFilingStatus(fs)
    setSelectedRow(null) // a row from the previous status's table is never valid for the new one
  }

  function handleApply() {
    if (!selectedRow || !filingStatus) return
    setActiveTaxRates({ st_rate: selectedRow.ordinaryRate, lt_rate: selectedRow.ltRate })
    setDemoSettings({ taxBracketFilingStatus: filingStatus, taxBracketIncomeMin: selectedRow.minIncome })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50" data-testid="tax-bracket-dialog">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div
        className="absolute bg-white rounded-[8px] flex flex-col overflow-hidden"
        style={{
          width: 520, maxHeight: '80vh',
          left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          filter: 'drop-shadow(0px 4px 8px rgba(4,5,5,0.2))',
        }}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e8e9e9] shrink-0">
          <span className="text-[18px] font-bold text-vg-ink">Change tax bracket</span>
          <button onClick={onClose} aria-label="Close" className="text-[20px] text-vg-ink hover:opacity-70 leading-none">×</button>
        </div>

        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-4">
          <div>
            <span className="text-[11px] font-semibold text-[#717777] uppercase tracking-wide">Filing status</span>
            <div className="flex gap-2 mt-2 flex-wrap">
              {FILING_STATUSES.map(fs => (
                <button
                  key={fs}
                  onClick={() => selectFilingStatus(fs)}
                  className={`h-[36px] px-4 rounded-full border-[1.5px] text-[13px] font-bold whitespace-nowrap transition-colors ${
                    filingStatus === fs ? 'bg-vg-teal text-white border-vg-teal' : 'border-vg-ink text-vg-ink bg-white hover:bg-[#f0f0f0]'
                  }`}
                >
                  {FILING_STATUS_LABELS[fs]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#717777] mt-2 leading-normal">
              Married Filing Separately isn't available here yet — real 2026 long-term capital gains brackets for that status weren't available to source, so it's excluded rather than estimated.
            </p>
          </div>

          {filingStatus && (
            <div>
              <span className="text-[11px] font-semibold text-[#717777] uppercase tracking-wide">Income band</span>
              <div className="mt-2 border border-[#e8e9e9] rounded-[8px] overflow-hidden">
                {rows.map((row, i) => {
                  const active = selectedRow === row
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedRow(row)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left text-[13px] border-b border-[#e8e9e9] last:border-b-0 transition-colors ${
                        active ? 'bg-[#e1f5ee]' : 'hover:bg-[#f8f8f7]'
                      }`}
                    >
                      <span className="text-vg-ink font-semibold">{formatIncomeRange(row)}</span>
                      <span className="text-[#717777]">{fmtPct(row.ordinaryRate)} ordinary / {fmtPct(row.ltRate)} long-term</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {selectedRow && (
            <div className="p-4 rounded-[8px] border border-[#e8e9e9] bg-[#f8f8f7]">
              <span className="text-[13px] text-vg-ink leading-normal">
                This will set your tax bracket to <strong>{fmtPct(selectedRow.ordinaryRate)} ST / {fmtPct(selectedRow.ltRate)} LT</strong>,
                {' '}replacing the current {fmtPct(activeTaxRates.st_rate)} ST / {fmtPct(activeTaxRates.lt_rate)} LT.
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#e8e9e9] shrink-0">
          <button
            onClick={onClose}
            className="h-[40px] px-4 rounded-full border-[1.5px] border-vg-ink text-vg-ink bg-white text-[13px] font-bold hover:opacity-90 transition-opacity"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!selectedRow}
            className="h-[40px] px-4 rounded-full bg-vg-ink text-white text-[13px] font-bold disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
