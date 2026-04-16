import { useMemo } from 'react'
import { InlineMath, BlockMath } from 'react-katex'

// Renders a string that may contain LaTeX math written as $…$ (inline) or
// $$…$$ (display) by splitting on those delimiters and handing the math
// portions to KaTeX. Falls back to plain text when no math is found.
// Bare \frac / \int outside of $…$ are also caught and rendered inline.
const INLINE = /\$\$([^$]+)\$\$|\$([^$]+)\$/g
const BARE = /\\(?:frac|int|sum|prod|sqrt|cdot|times|leq|geq|neq|approx|to|infty|pi|alpha|beta|gamma|delta|theta|sigma|omega|nabla|partial|in\b|notin)/

export default function LatexText({ children, className = '' }) {
  const text = String(children ?? '')

  const segments = useMemo(() => {
    if (!text.includes('$') && !BARE.test(text)) return [{ type: 'text', value: text }]
    // Pre-process: if we see bare \frac / \int etc. not already inside $…$, wrap
    // the whole string in $…$. This is a best-effort fallback for MMLU rows that
    // omit dollar delimiters.
    let normalised = text
    if (BARE.test(text) && !text.includes('$')) {
      normalised = `$${text}$`
    }

    const out = []
    let cursor = 0
    const re = new RegExp(INLINE.source, 'g')
    let m
    while ((m = re.exec(normalised)) !== null) {
      if (m.index > cursor) out.push({ type: 'text', value: normalised.slice(cursor, m.index) })
      const display = m[1] !== undefined
      const body = display ? m[1] : m[2]
      out.push({ type: display ? 'block' : 'inline', value: body })
      cursor = re.lastIndex
    }
    if (cursor < normalised.length) out.push({ type: 'text', value: normalised.slice(cursor) })
    return out
  }, [text])

  return (
    <span className={className}>
      {segments.map((s, i) => {
        if (s.type === 'inline') {
          try { return <InlineMath key={i} math={s.value} /> }
          catch { return <span key={i}>${s.value}$</span> }
        }
        if (s.type === 'block') {
          try { return <BlockMath key={i} math={s.value} /> }
          catch { return <span key={i}>$${s.value}$$</span> }
        }
        return <span key={i}>{s.value}</span>
      })}
    </span>
  )
}
