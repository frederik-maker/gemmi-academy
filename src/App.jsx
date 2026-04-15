import { Routes, Route, Navigate } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import Learn from './pages/Learn.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/learn/*" element={<Learn />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
