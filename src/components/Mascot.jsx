import { useState } from 'react'
import { motion } from 'framer-motion'

// Gemmi — the navy-blue bird mascot that carries a sky-blue gem in its beak.
//
// Rendering strategy: prefer `/gemmi.png` if it has been processed (you save
// the source PNG to public/gemmi-source.png and run scripts/process-mascot.py).
// Until then this component renders an inline SVG that matches the design so
// the app is never visually broken.
//
// `mood` switches the facial expression / pose: idle | happy | wave | wink | sad
export default function Mascot({ size = 180, mood = 'idle', className = '' }) {
  const [pngFailed, setPngFailed] = useState(false)

  // Once the PNG is in place this short-circuits and renders the bitmap.
  if (!pngFailed) {
    // Birds bob, they don't wave — but a *calm* bob. Animations should be
    // ambient, never demand attention.
    //   wave  → a small greeting bob
    //   happy → one celebratory hop
    //   idle  → almost-imperceptible breathing (so it feels alive but not noisy)
    //   sad / wink → still
    const bob = mood === 'wave' ? [0, -3, 0]
              : mood === 'happy' ? [0, -6, 0]
              : mood === 'idle' ? [0, -1.5, 0]
              : 0
    const bobDuration = mood === 'wave' ? 2.6
                      : mood === 'happy' ? 2.0
                      : 4.5
    return (
      <motion.img
        src="/gemmi.png"
        alt="Gemmi"
        width={size}
        height={size}
        className={`${className} select-none pointer-events-none`}
        onError={() => setPngFailed(true)}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1, y: bob }}
        transition={{
          y: { repeat: bob === 0 ? 0 : Infinity, duration: bobDuration, ease: 'easeInOut' },
          opacity: { duration: 0.3 },
          scale: { type: 'spring', stiffness: 200, damping: 18 },
        }}
        style={{ filter: mood === 'sad' ? 'saturate(0.7) brightness(0.95)' : undefined }}
      />
    )
  }

  // ---- SVG fallback ---------------------------------------------------------
  // Navy bird with a faceted blue gem in its beak. Tries to mirror the
  // attached reference image so swapping in the real PNG isn't jarring.
  const eyeWink = mood === 'wink'
  const closedEye = mood === 'sad'
  const beakOpen = mood === 'happy' || mood === 'wave'

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 500 500"
      className={className}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{
        scale: 1,
        opacity: 1,
        rotate: mood === 'wave' ? [-3, 3, -3] : 0,
        y: mood === 'happy' ? [0, -6, 0] : 0,
      }}
      transition={{
        rotate: { repeat: mood === 'wave' ? Infinity : 0, duration: 1.6, ease: 'easeInOut' },
        y: { repeat: mood === 'happy' ? Infinity : 0, duration: 2.4, ease: 'easeInOut' },
        opacity: { duration: 0.3 },
        scale: { type: 'spring', stiffness: 200, damping: 18 },
      }}
    >
      <defs>
        <linearGradient id="gem-front" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7CB1FF" />
          <stop offset="1" stopColor="#1E5DFF" />
        </linearGradient>
        <linearGradient id="body-grad" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#34346B" />
          <stop offset="1" stopColor="#1F1F4A" />
        </linearGradient>
      </defs>

      {/* Tail feathers */}
      <path d="M 90 330 Q 60 360 90 400 L 160 380 Z" fill="#1F1F4A" />
      <path d="M 95 350 Q 70 380 100 410 L 165 392 Z" fill="#2C2C5C" opacity="0.7" />

      {/* Body */}
      <ellipse cx="220" cy="320" rx="160" ry="130" fill="url(#body-grad)" />

      {/* Wing */}
      <path d="M 150 310 Q 200 240 290 260 Q 320 320 290 380 Q 220 410 160 370 Z" fill="#2C2C5C" />
      {/* Wing chevrons */}
      <g fill="#454584" opacity="0.7">
        <path d="M 200 320 q 25 -15 50 0" stroke="#454584" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 200 340 q 28 -15 56 0" stroke="#454584" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 210 360 q 25 -15 50 0" stroke="#454584" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>

      {/* Legs */}
      <g stroke="#9389B0" strokeWidth="10" strokeLinecap="round" fill="none">
        <line x1="200" y1="430" x2="200" y2="465" />
        <line x1="250" y1="430" x2="250" y2="465" />
      </g>
      {/* Feet */}
      <g fill="#A399C2">
        <path d="M 180 463 L 220 463 L 215 475 L 185 475 Z" />
        <path d="M 230 463 L 270 463 L 265 475 L 235 475 Z" />
      </g>

      {/* Head */}
      <circle cx="320" cy="200" r="115" fill="url(#body-grad)" />

      {/* Eye */}
      {closedEye ? (
        <path d="M 305 195 q 18 8 36 0" stroke="#0b1530" strokeWidth="6" fill="none" strokeLinecap="round" />
      ) : eyeWink ? (
        <path d="M 305 195 q 18 -8 36 0" stroke="#0b1530" strokeWidth="6" fill="none" strokeLinecap="round" />
      ) : (
        <>
          <circle cx="325" cy="195" r="22" fill="#FFD440" stroke="#0b1530" strokeWidth="4" />
          <circle cx="328" cy="200" r="9" fill="#0b1530" />
          <circle cx="332" cy="195" r="3" fill="#fff" />
        </>
      )}

      {/* Beak (a lavender open-V holding the gem) */}
      {beakOpen ? (
        <>
          <path d="M 412 200 L 458 192 L 442 222 Z" fill="#9389B0" stroke="#0b1530" strokeWidth="2" />
          <path d="M 412 220 L 458 235 L 442 250 Z" fill="#7A719E" stroke="#0b1530" strokeWidth="2" />
        </>
      ) : (
        <path d="M 410 200 L 462 215 L 415 232 Z" fill="#9389B0" stroke="#0b1530" strokeWidth="2.5" />
      )}

      {/* Gem in beak */}
      <g transform="translate(465 215)">
        <polygon points="0,-22 20,-8 16,18 -16,18 -20,-8" fill="url(#gem-front)" stroke="#0b1530" strokeWidth="2" />
        <polygon points="0,-22 -20,-8 -16,18" fill="#1E5DFF" opacity="0.6" />
        <polygon points="0,-22 20,-8 16,18" fill="#7CB1FF" opacity="0.5" />
        <line x1="0" y1="-22" x2="0" y2="18" stroke="#0b1530" strokeWidth="1" opacity="0.4" />
        <polygon points="-7,-15 -2,-18 -3,-10" fill="#fff" opacity="0.6" />
      </g>

      {/* Head sheen (subtle highlight) */}
      <path d="M 260 130 q 50 -30 120 -10" stroke="#fff" strokeWidth="2" fill="none" opacity="0.2" strokeLinecap="round" />
    </motion.svg>
  )
}
