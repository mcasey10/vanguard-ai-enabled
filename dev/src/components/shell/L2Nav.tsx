import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { CoachMark } from '../CoachMark'
import { DemoSettingsDialog } from '../DemoSettingsDialog'

const NAV_ITEMS = [
  { label: 'Dashboard',        to: '#' },
  { label: 'Balances',         to: '#' },
  { label: 'Holdings',         to: '#' },
  { label: 'Activity',         to: '#' },
  { label: 'Performance',      to: '#' },
  { label: 'Portfolio Watch',  to: '#' },
  { label: 'Sell & Rebalance', to: '/' },
]

export default function L2Nav() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <nav className="bg-white flex items-stretch h-12 px-6 gap-6 border-b border-vg-border shrink-0">
      {NAV_ITEMS.map(({ label, to }) =>
        label === 'Sell & Rebalance' ? (
          // Active item: full-height link with 2px red bottom border
          // The red border-b-2 sits on top of the nav's gray border-b
          <NavLink
            key={label}
            to={to}
            end
            className="flex items-center gap-[6px] text-[14px] font-bold text-vg-ink whitespace-nowrap
              border-b-2 border-vg-red -mb-px"
          >
            {label}
            <CoachMark
              id="nav-prototype"
              text="These navigation tabs are static (only shown to provide realistic portal context). This application covers only the Sell & Rebalance tool: an AI-optimized workflow for selecting which funds to sell when raising cash from a taxable brokerage account."
            />
          </NavLink>
        ) : (
          <span
            key={label}
            className="flex items-center text-[14px] text-vg-ink whitespace-nowrap cursor-pointer"
          >
            {label}
          </span>
        ),
      )}

      {/* Demo settings — replaces the standalone "Reset demo" link entirely
          (D071). Reset demo lives inside the dialog now, as its own
          confirmation-gated section, alongside reader segment and AI
          provider selection. */}
      <div className="ml-auto flex items-center gap-2">
        <CoachMark
          id="demo-settings"
          text="Demo settings is not part of the production feature set — it exists for demonstration purposes only. Choose the reader segment AI narration is tuned for, switch which AI provider each feature uses, or reset the demo entirely (restores the canonical sample portfolio, clears all completed transactions, and restores all coach mark beacons)."
        />
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-[6px] text-[11px] text-[#717777] cursor-pointer whitespace-nowrap hover:opacity-80"
        >
          <Settings size={14} className="text-[#717777]" />
          Demo settings
        </button>
      </div>

      {settingsOpen && <DemoSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </nav>
  )
}
