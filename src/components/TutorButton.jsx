import { useState } from 'react'
import { motion } from 'framer-motion'
import { MessageCircle } from 'lucide-react'
import { useStore } from '../store.js'
import TutorChat from './TutorChat.jsx'

// Bottom-right "Ask Gemmi" pill — kept flat (single shadow, no stacked
// 3D bevel) so it doesn't fight the answer-card buttons for attention.
// Sits clear of the bottom nav by ~88px (BottomNav is 64px + safe-inset).
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
        whileTap={{ scale: 0.96 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="fixed right-3 z-40 inline-flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full bg-steppe-500 hover:bg-steppe-600 text-white font-extrabold text-sm shadow-lg shadow-steppe-500/30"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}
        aria-label="Open AI tutor"
      >
        <MessageCircle className="w-4 h-4" strokeWidth={3} />
        <span className="leading-none">{LABEL[lang]}</span>
      </motion.button>
      <TutorChat open={open} onClose={() => setOpen(false)} context={context} />
    </>
  )
}
