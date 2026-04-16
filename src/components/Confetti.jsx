import { useMemo } from 'react'

const COLORS = ['#58cc02', '#1186f5', '#fbbf24', '#ff2d4a', '#7c3aed', '#10b981']

export default function Confetti({ count = 32 }) {
  const pieces = useMemo(() =>
    Array.from({ length: count }).map((_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.4,
      bg: COLORS[i % COLORS.length],
      rotate: Math.random() * 360,
    })),
  [count])

  return (
    <div className="confetti pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            top: '-12px',
            background: p.bg,
            transform: `rotate(${p.rotate}deg)`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  )
}
