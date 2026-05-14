import { Flame, Heart, Gem } from 'lucide-react'
import { useStore } from '../store.js'
import { useEffect } from 'react'

export default function Topbar({ onLangClick, currentLang }) {
  const { streak, hearts, gems, tickHearts } = useStore()

  useEffect(() => {
    tickHearts()
    const id = setInterval(tickHearts, 30_000)
    return () => clearInterval(id)
  }, [tickHearts])

  return (
    <div className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-ink-100" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
        <button
          onClick={onLangClick}
          className="pill bg-ink-100 text-ink-700 hover:bg-ink-200 transition-colors"
          aria-label="Change language"
        >
          {currentLang === 'kk' ? '🇰🇿' : currentLang === 'ru' ? '🇷🇺' : '🇬🇧'}
          <span className="text-xs">{currentLang?.toUpperCase()}</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="pill bg-orange-100 text-orange-700">
            <Flame className="w-4 h-4" strokeWidth={3} fill="currentColor" />
            {streak}
          </span>
          <span className="pill bg-sky-100 text-sky-700">
            <Gem className="w-4 h-4" strokeWidth={3} />
            {gems}
          </span>
          <span className="pill bg-rose-100 text-rose-700">
            <Heart className="w-4 h-4" strokeWidth={3} fill="currentColor" />
            {hearts}
          </span>
        </div>
      </div>
    </div>
  )
}
