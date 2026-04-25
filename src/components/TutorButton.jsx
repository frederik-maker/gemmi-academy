import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { useStore } from '../store.js'
import TutorChat from './TutorChat.jsx'

// Prominent "Ask Gemmi" pill that lives in the bottom-right corner of every
// Learn screen except lesson player & lesson complete. Sits clear of the
// bottom nav and the Today-XP card.
const LABEL = {
  kk: 'Джеммиден сұра',
  ru: 'Спросить Джемми',
  en: 'Ask Gemmi',
}

export default function TutorButton({ context }) {
  const [open, setOpen] = useState(false)
  const lang = useStore((s) => s.lang) || 'en'
  return (
    <>
      <motion.button
        onClick={() => setOpen(true)}
        whileTap={{ scale: 0.95 }}
        initial={{ opacity: 0, scale: 0.6, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 0.3, type: 'spring', stiffness: 240, damping: 18 }}
        className="fixed right-3 bottom-[88px] z-40 inline-flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full text-white font-extrabold text-sm"
        style={{
          background: 'radial-gradient(circle at 30% 30%, #54c2ff, #1186f5 65%, #0e6ce0)',
          boxShadow:
            '0 8px 0 0 #0e6ce0, 0 12px 30px -6px rgba(17,134,245,0.55), inset 0 -6px 0 0 rgba(0,0,0,0.18), inset 0 3px 0 0 rgba(255,255,255,0.4)',
        }}
        aria-label="Open AI tutor"
      >
        <span className="grid place-items-center w-7 h-7 rounded-full bg-white/20">
          <Sparkles className="w-4 h-4 drop-shadow" strokeWidth={3} />
        </span>
        <span className="leading-none">{LABEL[lang]}</span>
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-sun-300 border-2 border-white animate-pulse" />
      </motion.button>
      <TutorChat open={open} onClose={() => setOpen(false)} context={context} />
    </>
  )
}
