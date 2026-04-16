import { motion } from 'framer-motion'
import { Lock, Crown, Star } from 'lucide-react'

// Polished Duolingo-style lesson node.
// - Gradient inner highlight (looks 3D)
// - Bottom shadow gives the "pressable" feel
// - Pulsing ring + "START" tooltip on the current lesson
// - Crown overlay + gold ring on completed
// - Gray solid look on locked, with a thin Lock icon
export default function LessonNode({
  icon,
  color,
  label,
  locked = false,
  completed = false,
  current = false,
  stars = 0,
  offset = 0,
  onClick,
}) {
  const baseColor = locked ? '#cbd5e1' : completed ? '#fbbf24' : color
  const shadow = locked ? '#94a3b8' : completed ? '#b45309' : darken(color)

  return (
    <div className="flex flex-col items-center" style={{ transform: `translateX(${offset}px)` }}>
      {/* Button + decorations live in their own positioning container so the
          gold ring and pulsing halo anchor to the button itself, not the column. */}
      <div className="relative w-20 h-20">
        {current && !locked && !completed && (
          <span
            className="absolute -inset-3 rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${color}22 0%, transparent 70%)`,
              animation: 'pulse-halo 2.4s ease-out infinite',
            }}
          />
        )}

        <motion.button
          onClick={onClick}
          whileTap={{ y: 6 }}
          transition={{ type: 'spring', stiffness: 700, damping: 18 }}
          aria-label={label}
          className="relative w-20 h-20 rounded-full grid place-items-center text-3xl font-extrabold text-white select-none"
          style={{
            background: locked
              ? 'linear-gradient(180deg, #e2e8f0, #cbd5e1)'
              : `radial-gradient(circle at 32% 28%, ${lighten(baseColor, 0.25)}, ${baseColor} 65%, ${darken(baseColor, 0.1)})`,
            boxShadow: [
              `0 8px 0 0 ${shadow}`,
              'inset 0 -7px 0 0 rgba(0,0,0,0.18)',
              'inset 0 3px 0 0 rgba(255,255,255,0.35)',
            ].join(', '),
          }}
        >
          <span
            aria-hidden
            className="absolute inset-x-3 top-1.5 h-3 rounded-full bg-white/35 pointer-events-none"
            style={{ filter: 'blur(2px)' }}
          />

          {locked ? (
            <Lock className="w-8 h-8 text-slate-500 relative" strokeWidth={3} />
          ) : completed ? (
            <Crown className="w-9 h-9 relative drop-shadow-sm" strokeWidth={2.5} />
          ) : (
            <span className="relative drop-shadow-sm">{icon}</span>
          )}
        </motion.button>

        {completed && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              border: '3px solid #fcd34d',
              boxShadow: '0 0 12px rgba(252,211,77,0.45)',
            }}
          />
        )}
      </div>

      <div className={`mt-2 text-xs font-extrabold max-w-[140px] text-center leading-tight ${locked ? 'text-ink-400' : 'text-ink-700'}`}>
        {label}
      </div>

      {completed && stars > 0 && (
        <div className="flex gap-0.5 mt-1">
          {[0, 1, 2].map((i) => (
            <Star
              key={i}
              className={`w-3.5 h-3.5 ${i < stars ? 'text-sun-400 fill-sun-400' : 'text-ink-200 fill-ink-200'}`}
              strokeWidth={2.5}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function lighten(hex, amount = 0.2) {
  if (!hex || !hex.startsWith('#')) return hex
  const h = hex.slice(1)
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  const blend = (c) => Math.min(255, Math.round(c + (255 - c) * amount))
  return `#${[blend(r), blend(g), blend(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function darken(hex, amount = 0.28) {
  if (!hex || !hex.startsWith('#')) return '#0b1530'
  const h = hex.slice(1)
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  const blend = (c) => Math.max(0, Math.round(c * (1 - amount)))
  return `#${[blend(r), blend(g), blend(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}
