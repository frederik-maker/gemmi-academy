import { Routes, Route, Navigate } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import Learn from './pages/Learn.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// When running inside the Capacitor Android WebView the marketing landing
// page makes no sense (the user already installed the APK — they want to
// learn). Skip it and route straight into /learn.
const isNativeApp = (() => {
  if (typeof window === 'undefined') return false
  try { return !!window.Capacitor?.isNativePlatform?.() } catch { return false }
})()

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={isNativeApp ? <Navigate to="/learn" replace /> : <Landing />} />
        <Route path="/learn/*" element={<Learn />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}
