/**
 * TransactionHistory — FS-TXHIST (node 547:2428)
 *
 * Read-only view of committed transactions from localStorage.
 * Accessible from ES-1 "View transaction history →" and from
 * Fund Selection. Only visible to returning users with prior transactions.
 */

import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import { getTransactionHistory } from '../data/loader'
import type { TransactionRecord, AccountingMethod } from '../types'
import { formatCurrency } from '../utils/format'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r2(n: number) { return Math.round(n * 100) / 100 }

function fmtPct2(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + '%'
}

function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    const date = d.toISOString().slice(0, 10)               // YYYY-MM-DD
    const time = d.toTimeString().slice(0, 5)               // HH:MM
    return `${date} · ${time}`
  } catch {
    return iso
  }
}

// Short display label for each fund ID
function shortFundName(fundId: string): string {
  const map: Record<string, string> = {
    VTSAX: 'Total Stock Market',
    VTIAX: 'Total Intl Stock',
    VBIRX: 'Short-Term Bond',
    VBTLX: 'Total Bond Market',
    VFITX: 'Intermediate-Term Treasuries',
    VFIAX: '500 Index Fund',
  }
  return map[fundId] ?? fundId
}

// Display label for accounting method
function methodLabel(m: AccountingMethod | string): string {
  const map: Record<string, string> = {
    MinTax:                      'MinTax',
    FIFO:                        'FIFO',
    HIFO:                        'HIFO',
    average_cost:                'AvgCost',
    specific_lot_identification: 'SpecID',
  }
  return map[m] ?? m
}

// Per-fund display derived from stored st_gain_loss / lt_gain_loss fields
interface FundDisplay {
  fund_id: string
  sell_amount: number
  accounting_method: string
  netGainLoss: number
  holdingPeriod: 'ST' | 'LT' | 'mixed' | 'none'
  estTax: number   // gross per-fund tax at active rates
}

function buildFundDisplay(
  fund_id: string,
  sell_amount: number,
  accounting_method: string,
  st_gain_loss: number,
  lt_gain_loss: number,
  stRate: number,
  ltRate: number,
): FundDisplay {
  const netGainLoss = r2(st_gain_loss + lt_gain_loss)
  // Gross per-fund tax: positive gains × active rate (losses don't generate tax)
  const estTax = r2(Math.max(0, st_gain_loss) * stRate + Math.max(0, lt_gain_loss) * ltRate)

  let holdingPeriod: FundDisplay['holdingPeriod'] = 'none'
  if (st_gain_loss !== 0 && lt_gain_loss !== 0) holdingPeriod = 'mixed'
  else if (st_gain_loss !== 0) holdingPeriod = 'ST'
  else if (lt_gain_loss !== 0) holdingPeriod = 'LT'

  return { fund_id, sell_amount, accounting_method, netGainLoss, holdingPeriod, estTax }
}

// Format gain/loss with sign, color class, and period suffix
function fmtGainLoss(fd: FundDisplay): { text: string; color: string } {
  const n = fd.netGainLoss
  const abs = formatCurrency(Math.abs(n))
  const suffix = fd.holdingPeriod !== 'none' && fd.holdingPeriod !== 'mixed' ? ` ${fd.holdingPeriod}` : ''
  if (n > 0) return { text: `+${abs}${suffix}`, color: 'text-[#007a00]' }
  if (n < 0) return { text: `−${abs}${suffix}`, color: 'text-[#c8102e]' }
  return { text: '$0.00', color: 'text-[#717777]' }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ColHdr() {
  return (
    <div className="flex items-center w-full border-b border-[#f0f0f0] pb-[8px]">
      <div className="flex flex-1 items-center min-w-px">
        <span className="text-[10px] font-semibold text-[#717777] uppercase">FUND</span>
      </div>
      <div className="w-[100px] flex items-center shrink-0">
        <span className="text-[10px] font-semibold text-[#717777] uppercase">METHOD</span>
      </div>
      <div className="w-[260px] flex items-center justify-end shrink-0">
        <span className="text-[10px] font-semibold text-[#717777] uppercase">AMOUNT</span>
      </div>
      <div className="w-[260px] flex items-center justify-end shrink-0">
        <span className="text-[10px] font-semibold text-[#717777] uppercase">GAIN/LOSS</span>
      </div>
      <div className="w-[260px] flex items-center justify-end shrink-0">
        <span className="text-[10px] font-semibold text-[#717777] uppercase">EST. TAX</span>
      </div>
    </div>
  )
}

function FundRow({ fd }: { fd: FundDisplay }) {
  const gl = fmtGainLoss(fd)
  return (
    <div className="flex h-[32px] items-center w-full border-b border-[#f0f0f0]">
      <div className="flex flex-1 items-center gap-[4px] min-w-px overflow-hidden">
        <span className="text-[12px] font-bold text-[#1255cc] whitespace-nowrap">{fd.fund_id}</span>
        <span className="text-[11px] text-[#717777] whitespace-nowrap"> {shortFundName(fd.fund_id)}</span>
      </div>
      <div className="w-[100px] shrink-0">
        <span className="text-[11px] text-[#717777]">{methodLabel(fd.accounting_method)}</span>
      </div>
      <div className="w-[260px] flex items-center justify-end shrink-0">
        <span className="text-[12px] font-bold text-[#040505] whitespace-nowrap">{formatCurrency(fd.sell_amount)}</span>
      </div>
      <div className="w-[260px] flex items-center justify-end shrink-0">
        <span className={`text-[12px] font-medium whitespace-nowrap ${gl.color}`}>{gl.text}</span>
      </div>
      <div className="w-[260px] flex items-center justify-end shrink-0">
        <span className={`text-[12px] whitespace-nowrap ${fd.estTax === 0 ? 'text-[#717777]' : 'text-[#040505]'}`}>
          {formatCurrency(fd.estTax)}
        </span>
      </div>
    </div>
  )
}

function TransactionCard({ txn, acctMasked, stRate, ltRate }: { txn: TransactionRecord; acctMasked: string; stRate: number; ltRate: number }) {
  const funds = txn.funds_sold.map(f =>
    buildFundDisplay(f.fund_id, f.sell_amount, f.accounting_method, f.st_gain_loss ?? 0, f.lt_gain_loss ?? 0, stRate, ltRate)
  )
  const totalSold = r2(funds.reduce((s, f) => s + f.sell_amount, 0))
  const effectiveRateDisplay = fmtPct2(txn.effective_rate)

  return (
    <div className="flex flex-col gap-[12px] items-start w-full p-[16px]">
      {/* Tx header */}
      <div className="flex items-center justify-between w-full">
        <div className="flex flex-col gap-[3px] items-start">
          <span className="text-[11px] font-medium text-[#040505] whitespace-nowrap">
            {fmtDateTime(txn.committed_timestamp)}
          </span>
          <span className="text-[11px] text-[#717777] whitespace-nowrap">
            Confirmation #{txn.transaction_id}
          </span>
        </div>
        <span className="text-[11px] font-semibold text-[#007a00]">✓ Completed</span>
      </div>

      {/* Fund table */}
      <div className="flex flex-col items-start w-full">
        <ColHdr />
        {funds.map(fd => <FundRow key={fd.fund_id} fd={fd} />)}
      </div>

      {/* Tax summary */}
      <div className="flex items-center justify-between w-full border-t border-[#e8e9e9] pt-[12px]">
        <div className="flex gap-[16px] items-center">
          <div className="flex gap-[4px] items-center">
            <span className="text-[11px] text-[#717777]">Total sold</span>
            <span className="text-[12px] font-bold text-[#040505]">{formatCurrency(totalSold)}</span>
          </div>
          <div className="flex gap-[4px] items-center">
            <span className="text-[11px] text-[#717777]">Net taxable gain</span>
            <span className="text-[12px] font-bold text-[#040505]">{formatCurrency(Math.max(0, txn.net_taxable_gain))}</span>
          </div>
        </div>
        <div className="flex gap-[8px] items-center">
          <span className="text-[10px] font-semibold text-[#717777] uppercase">EST. NET TAX</span>
          <span className="text-[13px] font-bold text-[#040505]">{formatCurrency(txn.est_tax_at_active_rate)}</span>
          <span className="text-[11px] text-[#717777]">{effectiveRateDisplay} effective</span>
        </div>
      </div>

      {/* Settlement */}
      <div className="flex items-start pt-[12px] w-full border-t border-[#e8e9e9]">
        <span className="text-[11px] text-[#717777] whitespace-nowrap">
          Proceeds settled to Brokerage {acctMasked} settlement fund · 1–2 business days
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TransactionHistory() {
  const navigate = useNavigate()
  const { portfolio, activeTaxRates } = useAppStore()

  // Most recent first
  const history = [...getTransactionHistory()].reverse()
  const latest = history[0] ?? null

  // YTD stats from most recent transaction's cumulative fields
  const ytdST  = latest?.cumulative_ytd_st_gains ?? 0
  const ytdLT  = latest?.cumulative_ytd_lt_gains ?? 0
  const ytdTax = r2(history.reduce((s, t) => s + t.est_tax_at_active_rate, 0))
  const taxYear = new Date().getFullYear()
  const stRate  = Math.round(activeTaxRates.st_rate * 100)
  const ltRate  = Math.round(activeTaxRates.lt_rate * 100)

  // Account masked number from portfolio
  const acct = portfolio?.accounts.find(a => a.account_type === 'taxable_brokerage')
  const acctMasked = acct?.masked_number ?? '...4782'

  return (
    <div className="flex flex-col items-start w-full px-[32px] py-[24px] gap-[24px]">

      {/* Page title */}
      <div className="flex h-[56px] items-center w-full">
        <h1 className="text-[30px] font-bold text-[#040505] whitespace-nowrap">Transaction History</h1>
      </div>

      {/* YTD Summary card */}
      <div className="flex items-center justify-between bg-white border border-[#e8e9e9] rounded-[8px] p-[16px] w-full overflow-clip">
        <div className="flex gap-[24px] items-start">
          <div className="flex flex-col gap-[4px] items-start">
            <span className="text-[10px] font-semibold text-[#717777] uppercase tracking-wide">YTD ST REALIZED</span>
            <span className="text-[15px] font-bold text-[#007a00]">{formatCurrency(ytdST)}</span>
          </div>
          <div className="flex flex-col gap-[4px] items-start">
            <span className="text-[10px] font-semibold text-[#717777] uppercase tracking-wide">YTD LT REALIZED</span>
            <span className="text-[15px] font-bold text-[#040505]">{formatCurrency(ytdLT)}</span>
          </div>
          <div className="flex flex-col gap-[4px] items-start">
            <span className="text-[10px] font-semibold text-[#717777] uppercase tracking-wide">EST. TOTAL TAX YTD</span>
            <span className="text-[15px] font-bold text-[#040505]">{formatCurrency(ytdTax)}</span>
          </div>
        </div>
        <span className="text-[11px] text-[#717777] whitespace-nowrap">
          Tax year {taxYear} · {stRate}% ST / {ltRate}% LT
        </span>
      </div>

      {/* Transaction list */}
      <div className="flex flex-col items-start bg-white border border-[#e8e9e9] rounded-[8px] w-full overflow-clip">
        {/* List header */}
        <div className="flex items-center justify-between bg-[#f8f8f8] border border-[#e8e9e9] px-[12px] py-[10px] w-full">
          <span className="text-[10px] font-semibold text-[#717777] uppercase">TRANSACTION HISTORY</span>
          <span className="text-[11px] text-[#717777]">
            {history.length === 0
              ? 'No transactions'
              : `${history.length} transaction${history.length > 1 ? 's' : ''} this session`}
          </span>
        </div>

        {/* Transaction cards or empty state */}
        {history.length === 0 ? (
          <div className="flex flex-col gap-[8px] items-center bg-[#f8f8f7] border border-[#e8e9e9] rounded-[8px] p-[16px] m-[16px] w-[calc(100%-32px)]">
            <p className="text-[10px] italic text-[#717777] text-center w-full">
              In a session with no prior transactions, this placeholder appears instead of transaction cards:
            </p>
            <div className="flex h-[48px] items-center justify-center bg-white border border-[#e8e9e9] rounded-[8px] w-full">
              <span className="text-[13px] text-[#717777]">No transactions this session</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start w-full divide-y divide-[#e8e9e9]">
            {history.map((txn, i) => (
              <TransactionCard key={txn.transaction_id ?? i} txn={txn} acctMasked={acctMasked} stRate={activeTaxRates.st_rate} ltRate={activeTaxRates.lt_rate} />
            ))}
          </div>
        )}
      </div>

      {/* Actions footer */}
      <div className="flex items-center justify-between w-full">
        <a
          className="text-[14px] text-[#1255cc] underline cursor-pointer hover:opacity-80 whitespace-nowrap"
          onClick={() => navigate('/')}
        >
          ← Back to Fund Selection
        </a>
      </div>

    </div>
  )
}
