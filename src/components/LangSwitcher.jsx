import { LANGS } from '../i18n.js'
import { motion } from 'framer-motion'

export default function LangSwitcher({ value, onChange, columns = 3 }) {
  return (
    <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {LANGS.map((l) => {
        const active = value === l.code
        return (
          <motion.button
            key={l.code}
            whileTap={{ scale: 0.96 }}
            onClick={() => onChange(l.code)}
            className={`rounded-2xl border-2 p-4 text-left transition-all ${
              active
                ? 'border-steppe-500 bg-steppe-50 shadow-cartoonHover'
                : 'border-ink-200 bg-white hover:border-ink-300'
            }`}
          >
            <div className="text-3xl">{l.flag}</div>
            <div className="mt-1.5 font-extrabold text-ink-900">{l.label}</div>
            <div className="text-xs text-ink-500 font-semibold">{l.native}</div>
          </motion.button>
        )
      })}
    </div>
  )
}
