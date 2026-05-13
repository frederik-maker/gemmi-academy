// Scattered gem + sparkle pattern overlay — Gemmi's brand cue, since she
// carries a faceted blue gem in her beak. Uses currentColor so it inherits
// the parent's text color (white-ish on dark gradients, ink-ish on light
// surfaces) and just needs an opacity tweak per usage.
//
// Lives in its own file because both Landing.jsx and TutorChat.jsx pull
// it; Landing used to reference it without an import (it was originally
// a local fn inside TutorChat) which crashed the landing page at runtime
// with `ReferenceError: GemPattern is not defined`.

export default function GemPattern({ opacity = 0.1 }) {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="gems" x="0" y="0" width="96" height="96" patternUnits="userSpaceOnUse">
          <g fill="currentColor">
            {/* tiny faceted gem (top-left of tile) */}
            <polygon points="22,12 30,20 27,33 17,33 14,20" />
            {/* sparkle cluster around it */}
            <circle cx="38" cy="14" r="1.4" />
            <circle cx="8" cy="40" r="1" />
            <circle cx="36" cy="38" r="0.9" />

            {/* second smaller gem (bottom-right of tile) */}
            <polygon points="70,58 76,64 74,74 66,74 64,64" />
            {/* sparkles for the second gem */}
            <circle cx="82" cy="52" r="1.1" />
            <circle cx="58" cy="80" r="1.2" />
            <circle cx="86" cy="78" r="0.9" />
            <circle cx="50" cy="62" r="0.8" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#gems)" />
    </svg>
  )
}
