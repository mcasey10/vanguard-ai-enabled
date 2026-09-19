import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import App from './App'
import './index.css'


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
    {/* Vercel Web Analytics (D126) — rendered once, outside the router. Only
        reports on a real Vercel deployment with Analytics enabled in the
        dashboard; inert locally. */}
    <Analytics />
  </StrictMode>,
)
