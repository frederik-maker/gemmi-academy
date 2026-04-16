import { motion } from 'framer-motion'

export default function ProgressBar({ value, total, color = '#58cc02' }) {
  const pct = total ? (value / total) * 100 : 0
  return (
    <div className="w-full h-4 rounded-full bg-ink-100 overflow-hidden">
      <motion.div
        className="h-full rounded-full relative"
        style={{ background: color }}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
      >
        <div className="absolute inset-x-2 top-0.5 h-1 bg-white/40 rounded-full" />
      </motion.div>
    </div>
  )
}
