import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, PenLine, ChevronDown, ChevronUp } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useModeToggleGuard, SaveDiscardDialog } from '../components/ModeToggleGuard'
import { formatCurrency, formatShares, accountAllocStr } from '../utils/format'

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? 'border-vg-ink' : 'border-vg-ink-muted'}`}>
      {selected && <div className="w-2 h-2 rounded-full bg-vg-ink" />}
    </div>
  )
}


export default function FundSelectionManual() {
  const navigate = useNavigate()
  const { portfolio, activeTaxRates } = useAppStore()

  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())
  function toggleAccount(id: string) {
    setExpandedAccounts(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  // FS-MAN-1 has no applied amounts so the mode toggle is always silent
  const { showDialog: showModeDialog, handleToggleClick, handleSave, handleDiscard, handleClose } =
    useModeToggleGuard(false)

  const accounts = portfolio?.accounts ?? []
  const taxableAcct = accounts.find(a => a.account_type === 'taxable_brokerage')
  const iraAcct     = accounts.find(a => a.account_type === 'traditional_IRA')
  const rothAcct    = accounts.find(a => a.account_type === 'roth_IRA')

  return (
    <>
      {showModeDialog && <SaveDiscardDialog onSave={handleSave} onDiscard={handleDiscard} onClose={handleClose} />}

      <div className="flex flex-col items-start w-full">
        <div className="flex flex-col gap-6 py-10 w-full">

          {/* Row 1 — Title + mode toggle */}
          <div className="flex items-center justify-between px-8 h-14">
            <h1 className="text-[30px] font-bold text-vg-ink whitespace-nowrap leading-normal">Sell &amp; Rebalance</h1>
            <div className="flex items-center border-[1.5px] border-vg-ink rounded-full p-[2px] bg-white h-[37px]">
              <button onClick={handleToggleClick} className="self-stretch flex items-center gap-1.5 px-4 rounded-[4px] text-[14px] font-bold text-vg-ink">
                <Sparkles size={16} className="text-vg-ink" />Automated
              </button>
              <div className="self-stretch flex items-center gap-1.5 px-4 rounded-full bg-vg-teal">
                <PenLine size={16} className="text-white" />
                <span className="text-[14px] font-bold text-white">Manual</span>
              </div>
            </div>
          </div>

          {/* Summary Banner — dashes (no amounts entered) */}
          <div className="flex items-center px-8 w-full">
            <div className="flex flex-1 items-start bg-[#e8f5f0] px-6 py-4">
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">SALE TOTAL</span>
                <span className="text-[20px] font-bold text-vg-ink whitespace-nowrap">—</span>
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">0.0% of portfolio</span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">TAX BRACKET</span>
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{Math.round(activeTaxRates.st_rate * 100)}% ST / {Math.round(activeTaxRates.lt_rate * 100)}% LT</span>
                <a className="text-[12px] text-[#1255cc] underline cursor-pointer whitespace-nowrap">Change</a>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">YTD REALIZED</span>
                {portfolio?.ytd_gains_record ? (
                  <>
                    <span className="text-[12px] text-vg-ink whitespace-nowrap">ST {formatCurrency(portfolio.ytd_gains_record.st_gains_realized_ytd)}</span>
                    <span className="text-[12px] text-vg-ink whitespace-nowrap">LT {formatCurrency(portfolio.ytd_gains_record.lt_gains_realized_ytd)}</span>
                  </>
                ) : <span className="text-[12px] text-vg-ink-muted">—</span>}
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. ST GAINS</span>
                <span className="text-[16px] font-bold text-vg-ink whitespace-nowrap">—</span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. LT GAINS</span>
                <span className="text-[16px] font-bold text-vg-ink whitespace-nowrap">—</span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">EST. NET TAX</span>
                <span className="text-[16px] font-bold text-vg-ink whitespace-nowrap">—</span>
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">0.00% effective rate</span>
              </div>
              <div className="self-stretch w-px bg-[#c8d8d4] shrink-0" />
              <div className="flex flex-col gap-0.5 flex-1 min-w-0 overflow-hidden px-3">
                <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">IMPACT</span>
                <div className="flex gap-1.5 items-center"><span className="text-[12px] text-vg-ink">Stocks</span><span className="text-[12px] text-vg-ink">—</span></div>
                <div className="flex gap-1.5 items-center"><span className="text-[12px] text-vg-ink">Bonds</span><span className="text-[12px] text-vg-ink">—</span></div>
                <a className="text-[10px] text-[#1255cc] underline cursor-pointer whitespace-nowrap">Target allocation</a>
              </div>
            </div>
          </div>

          {/* Fund Table */}
          <div className="flex flex-col items-start px-8 w-full">
            <div className="flex flex-col items-start w-full border border-[#e8e9e9]">

              {/* Taxable Brokerage — active, expanded */}
              <div className="flex h-16 items-center px-4 bg-[#f8f8f8] border-b border-[#e8e9e9] w-full">
                <RadioDot selected={true} />
                <div className="w-2 shrink-0" />
                <div className="flex gap-1 items-center">
                  <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">Taxable Brokerage</span>
                  <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{taxableAcct?.masked_number ?? '...4782'}</span>
                </div>
                <div className="flex-1" />
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{taxableAcct ? accountAllocStr(taxableAcct) : ''}</span>
                <div className="w-4 shrink-0" />
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{taxableAcct ? formatCurrency(taxableAcct.account_balance) : '—'}</span>
                <div className="w-4 shrink-0" />
                <ChevronDown size={24} className="text-vg-ink shrink-0" />
              </div>

              {/* Column header */}
              <div className="flex h-9 items-center px-3 bg-[#f8f8f8] border border-[#e0e0e0] w-full shrink-0">
                <div className="w-[280px] px-2 flex items-center h-full shrink-0"><span className="text-[12px] font-semibold text-vg-ink">FUND</span></div>
                <div className="w-[140px] px-2 flex items-center h-full shrink-0"><span className="text-[12px] font-semibold text-vg-ink">POSITION</span></div>
                <div className="flex-1" />
              </div>

              {/* Taxable holdings — all inactive (no amounts entered) */}
              {(taxableAcct?.holdings ?? []).map(h => (
                <div key={h.fund_id} className="flex h-16 items-center overflow-hidden px-3 w-full border-b border-[#e8e9e9] bg-[#fafafa]">
                  <div className="w-[280px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
                    <span className="text-[12px] text-vg-ink-muted truncate">{h.fund_name}</span>
                    <a className="text-[14px] font-bold text-[#1255cc] underline whitespace-nowrap">{h.fund_id}</a>
                  </div>
                  <div className="w-[140px] h-full flex flex-col justify-center gap-[3px] px-2 shrink-0 overflow-hidden">
                    <span className="text-[10px] text-vg-ink-muted whitespace-nowrap">{formatShares(h.total_shares)} shares</span>
                    <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{formatCurrency(h.current_balance)}</span>
                  </div>
                  <div className="w-[128px] h-full shrink-0" /><div className="w-[130px] h-full shrink-0" />
                  <div className="w-[160px] h-full shrink-0" /><div className="w-[95px] h-full shrink-0" />
                  <div className="w-[95px] h-full shrink-0" /><div className="w-[85px] h-full shrink-0" />
                  <div className="w-[110px] h-full shrink-0" />
                  <div className="flex flex-1 h-full items-center justify-end px-2">
                    <button
                      onClick={() => navigate('/manual-2')}
                      className="h-[36px] w-[90px] rounded-full border-[1.5px] border-vg-ink bg-white text-[14px] font-bold text-vg-ink shrink-0 hover:opacity-90"
                    >Sell</button>
                  </div>
                </div>
              ))}

              {/* Traditional IRA — collapsed, expandable */}
              <div className="flex h-16 items-center px-4 bg-[#f8f8f8] border-t border-[#e8e9e9] w-full cursor-pointer" onClick={() => toggleAccount('ira')}>
                <RadioDot selected={false} />
                <div className="w-2 shrink-0" />
                <div className="flex gap-1 items-center flex-wrap">
                  <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">Traditional IRA</span>
                  <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{iraAcct?.masked_number ?? '...2973'}</span>
                  {iraAcct?.rmd_record && (
                    <>
                      <div className="w-2 shrink-0" />
                      <div className="flex items-center gap-1 px-2 py-[2px] rounded-full bg-[#e07000]">
                        <span className="text-[9px] font-bold text-white tracking-[0.36px] whitespace-nowrap">
                          Remaining 2026 RMD: {formatCurrency(Math.round(iraAcct.rmd_record.rmd_remaining))}
                        </span>
                      </div>
                    </>
                  )}
                </div>
                <div className="flex-1" />
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{iraAcct ? accountAllocStr(iraAcct) : ''}</span>
                <div className="w-4 shrink-0" />
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{iraAcct ? formatCurrency(iraAcct.account_balance) : '—'}</span>
                <div className="w-4 shrink-0" />
                {expandedAccounts.has('ira') ? <ChevronUp size={24} className="text-vg-ink shrink-0" /> : <ChevronDown size={24} className="text-vg-ink shrink-0" />}
              </div>
              {expandedAccounts.has('ira') && (iraAcct?.holdings ?? []).map(h => (
                <div key={h.fund_id} className="flex h-14 items-center px-6 border-b border-[#e8e9e9] bg-white w-full">
                  <div className="flex flex-col gap-[2px]">
                    <span className="text-[12px] text-vg-ink-muted">{h.fund_name}</span>
                    <span className="text-[13px] font-bold text-[#1255cc] underline">{h.fund_id}</span>
                  </div>
                  <div className="flex-1" />
                  <span className="text-[12px] text-vg-ink-muted mr-4">{h.asset_class.replace('_', ' ')}</span>
                  <span className="text-[13px] font-bold text-vg-ink">{formatCurrency(h.current_balance)}</span>
                </div>
              ))}

              {/* Roth IRA — collapsed, expandable */}
              <div className="flex h-16 items-center px-4 bg-[#f8f8f8] border-t border-[#e8e9e9] w-full cursor-pointer" onClick={() => toggleAccount('roth')}>
                <RadioDot selected={false} />
                <div className="w-2 shrink-0" />
                <div className="flex gap-1 items-center">
                  <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">Roth IRA</span>
                  <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{rothAcct?.masked_number ?? '...8148'}</span>
                </div>
                <div className="flex-1" />
                <span className="text-[12px] text-vg-ink-muted whitespace-nowrap">{rothAcct ? accountAllocStr(rothAcct) : ''}</span>
                <div className="w-4 shrink-0" />
                <span className="text-[14px] font-bold text-vg-ink whitespace-nowrap">{rothAcct ? formatCurrency(rothAcct.account_balance) : '—'}</span>
                <div className="w-4 shrink-0" />
                {expandedAccounts.has('roth') ? <ChevronUp size={24} className="text-vg-ink shrink-0" /> : <ChevronDown size={24} className="text-vg-ink shrink-0" />}
              </div>
              {expandedAccounts.has('roth') && (rothAcct?.holdings ?? []).map(h => (
                <div key={h.fund_id} className="flex h-14 items-center px-6 border-b border-[#e8e9e9] bg-white w-full">
                  <div className="flex flex-col gap-[2px]">
                    <span className="text-[12px] text-vg-ink-muted">{h.fund_name}</span>
                    <span className="text-[13px] font-bold text-[#1255cc] underline">{h.fund_id}</span>
                  </div>
                  <div className="flex-1" />
                  <span className="text-[12px] text-vg-ink-muted mr-4">{h.asset_class.replace('_', ' ')}</span>
                  <span className="text-[13px] font-bold text-vg-ink">{formatCurrency(h.current_balance)}</span>
                </div>
              ))}

            </div>
          </div>
        </div>
      </div>
    </>
  )
}
