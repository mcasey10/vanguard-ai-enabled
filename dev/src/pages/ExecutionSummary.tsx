/**
 * ExecutionSummary — Stage 4 post-submission screen (ES-1, node 628:26531)
 *
 * VSR-78 / REQ-EC-005: Success banner, tax summary with optimization savings
 * headline, portfolio rebalancing impact, What Happens Next timeline,
 * and footer actions. All content read-only.
 */

import { useNavigate } from 'react-router-dom'
import { CoachMark } from '../components/CoachMark'
import { useAppStore } from '../store/useAppStore'
import { getTransactionHistory } from '../data/loader'
import type { TransactionRecord } from '../types'
import { formatCurrency, formatPercent } from '../utils/format'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r2(n: number) { return Math.round(n * 100) / 100 }

function fmtRate2(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + '%'
}

function signed(n: number): string {
  if (n === 0) return formatCurrency(0)
  return (n > 0 ? '+' : '−') + formatCurrency(Math.abs(n))
}

function Divider() {
  return <div className="bg-[#e8e9e9] h-px relative shrink-0 w-full" />
}

function TaxRow({ label, value, labelBold, valueBold, valueLg, muted, valueColor }: {
  label: string
  value: string
  labelBold?: boolean
  valueBold?: boolean
  valueLg?: boolean
  muted?: boolean
  valueColor?: string
}) {
  return (
    <div className="flex h-[26px] items-center justify-between w-full whitespace-nowrap">
      <span className={`text-[13px] ${labelBold ? 'font-semibold' : 'font-normal'} ${muted ? 'text-[#717777]' : 'text-[#040505]'}`}>
        {label}
      </span>
      <span
        className={`${valueLg ? 'text-[14px]' : 'text-[13px]'} ${valueBold ? 'font-bold' : 'font-normal'} ${muted ? 'text-[#717777]' : ''} text-right`}
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Timeline step
// ---------------------------------------------------------------------------

function TimelineStep({ step, label, description, done, lastStep }: {
  step: number | '✓'
  label: string
  description: string
  done?: boolean
  lastStep?: boolean
}) {
  const isDone = done || step === '✓'
  return (
    <div className="flex flex-1 flex-col gap-[8px] items-center min-w-0">
      {/* Circle row */}
      <div className="flex items-center w-full">
        <div className={`flex-1 h-px ${isDone ? 'bg-transparent' : 'bg-[#e8e9e9]'}`} />
        <div className={`w-[32px] h-[32px] rounded-full flex items-center justify-center shrink-0 ${
          isDone ? 'bg-[#007a00]' : 'bg-white border-2 border-[#e8e9e9]'
        }`}>
          <span className={`text-[12px] font-semibold text-center ${isDone ? 'text-white' : 'text-[#717777]'}`}>
            {step}
          </span>
        </div>
        <div className={`flex-1 h-px ${lastStep ? '' : 'bg-[#e8e9e9]'}`} />
      </div>
      <span className={`text-[12px] font-semibold text-center w-full ${isDone ? 'text-[#007a00]' : 'text-[#040505]'}`}>
        {label}
      </span>
      <span className="text-[11px] text-[#717777] text-center w-full">{description}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExecutionSummary() {
  const navigate = useNavigate()
  const { portfolio, resetSession } = useAppStore()

  // Get the most recently committed transaction from localStorage
  const history = getTransactionHistory()
  const txn: TransactionRecord | null = history.length > 0 ? history[history.length - 1] : null

  // Derive display values from the transaction record
  const stGains         = r2(txn?.realized_st_gains ?? 0)
  const ltGains         = r2(txn?.realized_lt_gains ?? 0)
  const lossesHarvested = r2(txn?.losses_harvested ?? 0)
  const netTaxableGain  = r2(txn?.net_taxable_gain ?? (stGains + ltGains + lossesHarvested))
  const estTotalTax     = r2(txn?.est_tax_at_active_rate ?? 0)
  const totalSaleAmount = r2(txn?.target_sale_amount ?? 0)
  const effectiveRate   = txn?.effective_rate != null ? txn.effective_rate : (totalSaleAmount > 0 ? r2((estTotalTax / totalSaleAmount) * 100) : 0)

  // Cumulative YTD after transaction
  const cumulativeYtdST = r2(txn?.cumulative_ytd_st_gains ?? 0)
  const cumulativeYtdLT = r2(txn?.cumulative_ytd_lt_gains ?? 0)

  // Portfolio value after sale — portfolio.total_investable_balance is already updated
  // by applyTransactionToPortfolio in OrderConfirmation before navigation here
  const portfolioAfter  = r2(portfolio.total_investable_balance)

  // Allocation data — read from transaction snapshot (set on submit) or fall back to current allocation
  const ca = portfolio.current_allocation
  const ta = portfolio.target_allocation
  const stocksBefore = txn?.stocks_before_pct  ?? r2(ca.domestic_equity_pct + ca.international_equity_pct)
  const bondsBefore  = txn?.bonds_before_pct   ?? r2(ca.domestic_bonds_pct)
  const resBefore    = txn?.reserves_before_pct ?? r2(ca.short_term_reserves_pct)
  const stocksAfter  = txn?.stocks_after_pct   ?? stocksBefore
  const bondsAfter   = txn?.bonds_after_pct    ?? bondsBefore
  const resAfter     = txn?.reserves_after_pct  ?? resBefore

  const stocksTarget = ta ? r2(ta.domestic_equity_pct + ta.international_equity_pct) : 55
  const bondsTarget  = ta ? r2(ta.domestic_bonds_pct) : 35
  const resTarget    = ta ? r2(ta.short_term_reserves_pct) : 10

  const estimatedSavings = txn?.tax_savings_vs_fifo ?? 0

  // Confirmation ID
  const confirmationId = txn?.transaction_id ?? 'VSR-2026-48291'
  const taxYear = new Date().getFullYear()

  // Account masked number
  const acct = portfolio.accounts.find(a => a.account_type === 'taxable_brokerage')
  const masked = acct?.masked_number ?? '...4782'

  function handleStartNewSale() {
    resetSession()
    navigate('/')
  }

  // Bar widths as percentages
  const barColors = { stocks: '#2bbfb3', bonds: '#c8902a', reserves: '#888' }

  return (
    <div className="flex flex-col items-start w-full">
      {/* No page title heading — ES-1 goes straight to content */}
      <div className="flex flex-col gap-[24px] items-start px-[32px] py-[24px] w-full">

        {/* Element 1 — Success Banner */}
        <div className="bg-[#e8f5f0] border border-[#5dcaa5] flex gap-[12px] items-start p-[20px] rounded-[8px] w-full">
          <span className="text-[24px] font-bold text-[#007a00] shrink-0">✓</span>
          <div className="flex flex-1 flex-col gap-[4px] items-start min-w-0">
            <p className="text-[16px] font-bold text-[#040505] w-full leading-5">Order submitted successfully</p>
            <p className="text-[13px] text-[#040505] w-full leading-4">
              Your sell order has been placed and is being processed. Confirmation #{confirmationId}
            </p>
            <p className="text-[12px] text-[#717777] w-full leading-[15px]">
              Estimated settlement: 1–2 business days · Proceeds to Brokerage {masked} settlement fund
            </p>
          </div>
        </div>

        {/* Transaction Summary */}
        {txn && txn.funds_sold.length > 0 && (() => {
          const allHoldings = portfolio.accounts.flatMap(a => a.holdings)
          const fundName = (id: string) => {
            const name = allHoldings.find(h => h.fund_id === id)?.fund_name ?? id
            return name
              .replace(/^Vanguard\s+/i, '')
              .replace(/\s+Admiral Shares$/i, '')
              .replace(/\s+Investor Shares$/i, '')
              .replace(/\s+ETF$/i, '')
              .trim()
          }
          const methodLabel = (m: string) =>
            m === 'average_cost' ? 'Avg Cost'
            : m === 'specific_lot_identification' ? 'SpecID'
            : m
          const glForFund = (f: { st_gain_loss: number; lt_gain_loss: number }): { amount: number; period: 'ST' | 'LT' } => {
            // Use whichever period has a non-zero value; if both, combine into the larger
            const st = f.st_gain_loss
            const lt = f.lt_gain_loss
            if (st !== 0 && lt === 0) return { amount: st, period: 'ST' }
            if (lt !== 0 && st === 0) return { amount: lt, period: 'LT' }
            // Both non-zero — show the dominant one (larger absolute value)
            return Math.abs(st) >= Math.abs(lt) ? { amount: st, period: 'ST' } : { amount: lt, period: 'LT' }
          }
          const totalSell = r2(txn.funds_sold.reduce((s, f) => s + f.sell_amount, 0))
          return (
            <div className="bg-white border border-[#e8e9e9] flex flex-col items-start rounded-[8px] overflow-clip w-full">
              {/* Card Header */}
              <div className="bg-[#f8f8f8] border-b border-[#e8e9e9] flex items-center h-[48px] px-[15px] w-full">
                <span className="text-[13px] font-semibold text-[#040505]">Transaction summary</span>
              </div>
              {/* Funds Section */}
              <div className="bg-white border border-[#e8e9e9] flex flex-col gap-[2px] w-full">
                {/* Column Header */}
                <div className="bg-[#f8f8f8] border-b border-[#e8e9e9] flex h-[30px] items-center w-full">
                  <span className="text-[10px] font-semibold text-[#717777] uppercase flex-1 pl-[15px]">Funds Sold</span>
                  <div className="w-[202px] pr-[0px] flex justify-end">
                    <span className="text-[10px] font-semibold text-[#717777] uppercase">Method</span>
                  </div>
                  <div className="w-[269px] flex justify-end">
                    <span className="text-[10px] font-semibold text-[#717777] uppercase">Sell Amount</span>
                  </div>
                  <div className="w-[446px] flex justify-end pr-[17px]">
                    <span className="text-[10px] font-semibold text-[#717777] uppercase">Est. Gain/Loss</span>
                  </div>
                </div>
                {/* Fund Rows */}
                {txn.funds_sold.map(f => {
                  const gl = glForFund(f)
                  const glColor = gl.amount > 0 ? '#007a00' : gl.amount < 0 ? '#c8102e' : '#717777'
                  const glStr = (gl.amount > 0 ? '+' : gl.amount < 0 ? '−' : '') + formatCurrency(Math.abs(gl.amount)) + ' ' + gl.period
                  return (
                    <div key={f.fund_id} className="flex h-[40px] items-center border-b border-[#f0f0f0] bg-white w-full">
                      <div className="flex flex-col justify-center flex-1 pl-[15px]">
                        <span className="text-[13px] font-bold text-[#1255cc] leading-none">{f.fund_id}</span>
                        <span className="text-[10px] text-[#717777] leading-none mt-[4px]">{fundName(f.fund_id)}</span>
                      </div>
                      <div className="w-[202px] flex justify-end">
                        <span className="text-[12px] text-[#717777]">{methodLabel(f.accounting_method)}</span>
                      </div>
                      <div className="w-[269px] flex justify-end">
                        <span className="text-[13px] font-bold text-[#040505]">{formatCurrency(f.sell_amount)}</span>
                      </div>
                      <div className="w-[446px] flex justify-end pr-[17px]">
                        <span className="text-[12px] font-bold" style={{ color: glColor }}>{glStr}</span>
                      </div>
                    </div>
                  )
                })}
                {/* Totals Row */}
                <div className="flex h-[36px] items-center bg-[#f8f8f7] border border-[#e8e9e9] w-full">
                  <span className="text-[12px] font-semibold text-[#040505] flex-1 pl-[15px]">Total</span>
                  <div className="w-[202px]" />
                  <div className="w-[269px] flex justify-end">
                    <span className="text-[13px] font-bold text-[#040505]">{formatCurrency(totalSell)}</span>
                  </div>
                  <div className="w-[446px] pr-[17px]" />
                </div>
              </div>
            </div>
          )
        })()}

        {/* Two Column Row */}
        <div className="flex gap-[24px] items-start w-full">

          {/* Element 2 — Tax Summary */}
          <div className="bg-white border border-[#e8e9e9] flex flex-1 flex-col items-start rounded-[8px] overflow-clip min-w-0">
            {/* Card Header */}
            <div className="bg-[#f8f8f8] border-b border-[#e8e9e9] flex items-center p-[16px] w-full">
              <span className="text-[13px] font-semibold text-[#040505] leading-4">Tax summary</span>
            </div>

            {/* Optimization Savings */}
            {estimatedSavings > 0 && (
              <div className="bg-[#e8f5f0] border-b border-[#e8e9e9] flex flex-col gap-[4px] items-start p-[16px] w-full">
                <p className="text-[13px] font-bold text-[#085041] w-full leading-4">
                  ↓ You saved an estimated {formatCurrency(estimatedSavings)} compared to selling without optimization
                </p>
                <p className="text-[11px] text-[#717777] w-full leading-[13px]">
                  Based on FIFO comparison at your active tax rate assumptions
                </p>
              </div>
            )}

            {/* Tax Rows */}
            <div className="flex flex-col gap-[6px] items-start p-[16px] w-full">
              <TaxRow
                label="ST Capital Gains realized"
                value={stGains !== 0 ? signed(stGains) : '$0.00'}
                valueBold={stGains !== 0}
                valueColor={stGains > 0 ? '#007a00' : stGains < 0 ? '#c8102e' : '#717777'}
              />
              <TaxRow
                label="LT Capital Gains realized"
                value={ltGains !== 0 ? signed(ltGains) : '$0.00'}
                valueColor={ltGains > 0 ? '#007a00' : ltGains < 0 ? '#c8102e' : '#717777'}
              />
              <TaxRow
                label="Losses Harvested"
                value={lossesHarvested !== 0 ? signed(lossesHarvested) : '$0.00'}
                valueBold={lossesHarvested !== 0}
                valueColor={lossesHarvested < 0 ? '#c8102e' : lossesHarvested > 0 ? '#007a00' : '#717777'}
              />
              <Divider />
              <TaxRow label="Net Taxable Gain"     value={formatCurrency(netTaxableGain)} valueBold />
              <TaxRow label="Federal Tax (estimated)" value={formatCurrency(estTotalTax)} />
              <TaxRow label="State Tax" value="$0.00 (not included)" muted />
              <Divider />
              <TaxRow label="EST. TOTAL TAX" value={formatCurrency(estTotalTax)} labelBold valueBold valueLg />
              <TaxRow label="Effective rate"       value={fmtRate2(effectiveRate)} muted />
            </div>

            {/* YTD Footer */}
            <div className="bg-[#f8f8f7] border-t border-[#e8e9e9] flex items-center p-[12px] w-full">
              <p className="flex-1 text-[11px] text-[#717777] min-w-0">
                Updated YTD realized — ST: {formatCurrency(cumulativeYtdST)} · LT: {formatCurrency(cumulativeYtdLT)}
              </p>
            </div>
          </div>

          {/* Element 3 — Portfolio Impact */}
          <div className="bg-white border border-[#e8e9e9] flex flex-1 flex-col items-start rounded-[8px] overflow-clip min-w-0">
            {/* Card Header */}
            <div className="bg-[#f8f8f8] border-b border-[#e8e9e9] flex items-center p-[16px] w-full">
              <span className="text-[13px] font-semibold text-[#040505] leading-4">Portfolio rebalancing impact</span>
            </div>

            {/* Portfolio Total Row */}
            <div className="bg-[#f8f8f7] border-b border-[#e8e9e9] flex items-center justify-between p-[16px] w-full whitespace-nowrap">
              <span className="text-[13px] text-[#717777]">Portfolio value after sale</span>
              <span className="text-[14px] font-bold text-[#040505]">{formatCurrency(portfolioAfter)}</span>
            </div>

            {/* Allocation Section */}
            <div className="flex flex-col gap-[12px] items-start p-[16px] w-full">
              {/* Legend */}
              <div className="flex gap-[12px] items-center">
                {([['#2bbfb3','Stocks'],['#c8902a','Bonds'],['#888','Short-term reserves']] as const).map(([color, name]) => (
                  <div key={name} className="flex gap-[4px] items-center">
                    <div className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-[11px] text-[#040505] whitespace-nowrap">{name}</span>
                  </div>
                ))}
              </div>

              {/* Before bar */}
              <div className="flex gap-[8px] items-center w-full">
                <span className="text-[12px] text-[#717777] w-[52px] shrink-0">Before</span>
                <div className="flex flex-1 h-[12px] rounded-[4px] overflow-clip">
                  <div style={{ width: `${stocksBefore}%`, background: barColors.stocks }} className="h-full" />
                  <div style={{ width: `${bondsBefore}%`, background: barColors.bonds  }} className="h-full" />
                  <div style={{ width: `${resBefore}%`,   background: barColors.reserves }} className="h-full" />
                </div>
              </div>

              {/* After bar */}
              <div className="flex gap-[8px] items-center w-full">
                <span className="text-[12px] text-[#717777] w-[52px] shrink-0">After</span>
                <div className="flex flex-1 h-[12px] rounded-[4px] overflow-clip">
                  <div style={{ width: `${stocksAfter}%`, background: barColors.stocks  }} className="h-full" />
                  <div style={{ width: `${bondsAfter}%`,  background: barColors.bonds   }} className="h-full" />
                  <div style={{ width: `${resAfter}%`,    background: barColors.reserves }} className="h-full" />
                </div>
              </div>

              {/* Percentage table */}
              <div className="flex flex-col text-[11px] w-full pt-[6px]">
                {/* Header */}
                <div className="flex font-semibold items-start pb-[6px] w-full">
                  <span className="flex-1 min-w-0 text-[#717777]" />
                  <span className="w-[200px] text-right text-[#2bbfb3]">Stocks</span>
                  <span className="w-[200px] text-right text-[#c8902a]">Bonds</span>
                  <span className="w-[200px] text-right text-[#888]">Reserves</span>
                </div>
                {[
                  { label: 'Current', s: stocksBefore, b: bondsBefore, r: resBefore },
                  { label: 'After',   s: stocksAfter,  b: bondsAfter,  r: resAfter  },
                  { label: 'Target',  s: stocksTarget,  b: bondsTarget,  r: resTarget  },
                ].map(row => (
                  <div key={row.label} className="flex h-[24px] items-center border-t border-[#f0f0f0] w-full">
                    <span className="flex-1 min-w-0 text-[#717777]">{row.label}</span>
                    <span className="w-[200px] text-right text-[#040505]">{formatPercent(row.s, true)}</span>
                    <span className="w-[200px] text-right text-[#040505]">{formatPercent(row.b, true)}</span>
                    <span className="w-[200px] text-right text-[#040505]">{formatPercent(row.r, true)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Element 4 — What Happens Next */}
        <div className="bg-white border border-[#e8e9e9] flex flex-col items-start rounded-[8px] overflow-clip w-full">
          <div className="bg-[#f8f8f8] border-b border-[#e8e9e9] flex items-center p-[16px] w-full">
            <span className="text-[13px] font-semibold text-[#040505] leading-4">What happens next</span>
          </div>
          <div className="flex items-start justify-between px-[24px] py-[16px] w-full">
            <TimelineStep step="✓" label="Order submitted"    description="Sell order placed and confirmed"             done />
            <TimelineStep step={2}  label="Execution at NAV"  description="Trades execute at next available NAV pricing" />
            <TimelineStep step={3}  label="Settlement"        description="Proceeds settle in 1–2 business days"         />
            <TimelineStep step={4}  label="Tax lot update"    description={`Lot records updated for ${taxYear} tax year`} lastStep />
          </div>
        </div>

        {/* Element 5 — Actions */}
        <div className="flex items-center justify-between w-full">
          {/* Left group: ghost links */}
          <div className="flex gap-[16px] items-center">
            <a className="text-[14px] text-[#1255cc] underline cursor-pointer whitespace-nowrap hover:opacity-80" onClick={() => navigate('/history')}>
              View transaction history →
            </a>
            <CoachMark id="txn-history" text="Shows all transactions completed in this session. Transaction history and portfolio values are restored to their starting state when the demo is reset." />
          </div>

          {/* Primary CTA */}
          <button
            onClick={handleStartNewSale}
            className="h-[48px] w-[180px] rounded-full bg-vg-ink text-white text-[14px] font-bold hover:opacity-90 transition-opacity shrink-0"
          >
            Start a new sale
          </button>
        </div>

      </div>
    </div>
  )
}
