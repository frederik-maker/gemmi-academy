import { motion, AnimatePresence } from 'framer-motion'
import { CloudOff } from 'lucide-react'
import { useOnlineStatus } from '../lib/offline.js'
import { useStore } from '../store.js'

const COPY = {
  kk: 'Желі жоқ — кэштелген сабақтар жұмыс істейді',
  ru: 'Нет интернета — кешированные уроки работают',
  en: 'You\'re offline — cached lessons still work',
}

export default function OfflineBanner() {
  const online = useOnlineStatus()
  const lang = useStore((s) => s.lang) || 'en'
  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          initial={{ y: -32, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -32, opacity: 0 }}
          className="sticky top-[60px] z-20 mx-3 mb-2 rounded-full bg-ink-900 text-white px-4 py-2 text-xs font-extrabold flex items-center gap-2 shadow-soft"
        >
          <CloudOff className="w-4 h-4" strokeWidth={3} />
          {COPY[lang]}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
