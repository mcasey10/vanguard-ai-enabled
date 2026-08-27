import { Outlet } from 'react-router-dom'
import GlobalHeader from './GlobalHeader'
import L2Nav from './L2Nav'

export default function PortalShell() {
  return (
    // Outer: full-viewport white canvas (handles background at >1440px viewports)
    <div className="min-h-screen bg-white">
      {/* Inner: single fixed-width, centered shell — header through content as one unit */}
      <div className="w-[1440px] mx-auto flex flex-col min-h-screen">
        <GlobalHeader />
        <L2Nav />
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
