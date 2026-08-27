import { Routes, Route } from 'react-router-dom'
import PortalShell from './components/shell/PortalShell'
import FundSelectionEntry from './pages/FundSelectionEntry'
import FundSelectionAutomated from './pages/FundSelectionAutomated'
import FundSelectionManual from './pages/FundSelectionManual'
import FundSelectionManual2 from './pages/FundSelectionManual2'
import FundSelectionManualLot from './pages/FundSelectionManualLot'
import ScenarioAnalysis from './pages/ScenarioAnalysis'
import OrderConfirmation from './pages/OrderConfirmation'
import ExecutionSummary from './pages/ExecutionSummary'
import TransactionHistory from './pages/TransactionHistory'

export default function App() {
  return (
    <Routes>
      <Route element={<PortalShell />}>
        <Route path="/" element={<FundSelectionEntry />} />
        <Route path="/automated" element={<FundSelectionAutomated />} />
        <Route path="/manual" element={<FundSelectionManual />} />
        <Route path="/manual-2" element={<FundSelectionManual2 />} />
        <Route path="/manual-lot" element={<FundSelectionManualLot />} />
        <Route path="/scenarios" element={<ScenarioAnalysis />} />
        <Route path="/confirm" element={<OrderConfirmation />} />
        <Route path="/summary" element={<ExecutionSummary />} />
        <Route path="/history" element={<TransactionHistory />} />
      </Route>
    </Routes>
  )
}
