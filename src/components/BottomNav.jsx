import { NavLink } from 'react-router-dom'
import { Home, BarChart3, User } from 'lucide-react'
import { useStore } from '../store.js'
import { t } from '../i18n.js'

export default function BottomNav() {
  const lang = useStore((s) => s.lang) || 'en'
  const link = ({ isActive }) =>
    `flex flex-col items-center justify-center gap-1 py-2 flex-1 ${
      isActive ? 'text-steppe-600' : 'text-ink-400'
    }`
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 border-t border-ink-100 bg-white/95 backdrop-blur"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
    >
      <div className="max-w-md mx-auto grid grid-cols-3">
        <NavLink end to="/learn" className={link}>
          <Home className="w-6 h-6" strokeWidth={2.5} />
          <span className="text-xs font-bold">{t('learn', lang)}</span>
        </NavLink>
        <NavLink to="/learn/stats" className={link}>
          <BarChart3 className="w-6 h-6" strokeWidth={2.5} />
          <span className="text-xs font-bold">{t('stats', lang)}</span>
        </NavLink>
        <NavLink to="/learn/profile" className={link}>
          <User className="w-6 h-6" strokeWidth={2.5} />
          <span className="text-xs font-bold">{t('profile', lang)}</span>
        </NavLink>
      </div>
    </nav>
  )
}
