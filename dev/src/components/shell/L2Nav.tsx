import { NavLink } from 'react-router-dom'
import { CoachMark } from '../CoachMark'

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

      {/* Reset demo — utility link + beacon, far right */}
      <div className="ml-auto flex items-center gap-2">
        <CoachMark id="reset-demo" text="Reset demo is not part of the production feature set — it exists for demonstration purposes only. It restores the canonical sample portfolio ($870,619.40 total value), clears all completed transactions, and restores all coach mark beacons to their initial state." />
        <a
          onClick={() => { window.location.href = '/?reset=true' }}
          className="flex items-center text-[11px] text-[#717777] underline cursor-pointer whitespace-nowrap hover:opacity-80"
        >
          Reset demo
        </a>
      </div>
    </nav>
  )
}
