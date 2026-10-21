'use client'

import { useEffect, useState } from 'react'

// Installed on every device; Google Fonts does not serve them.
const SYSTEM_FONTS = new Set(['arial', 'helvetica', 'impact', 'georgia', 'times new roman', 'verdana', 'tahoma', 'trebuchet ms', 'courier new', 'sans-serif', 'serif', 'monospace', 'system-ui'])
// Google splits each font by script; this sample asks for the Latin and accented-Latin files every post may need.
const SAMPLE = 'AaZz09 ÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúüñ ĄĆĘŁŃŚŹŻąćęłńśźżŐőŰű'
// A font that never arrives (offline, blocked) does not hold the post back for longer than this.
const FONT_WAIT_MS = 6000

function canvasFonts(canvas) {
  const fonts = new Map()
  const add = (family, weight) => fonts.set(family, (fonts.get(family) || new Set()).add(Number(weight) || 400))
  const scan = (nodes, classes) => {
    for (const n of nodes || []) if (n?.type === 'text' && n.fontFamily) add(n.fontFamily, n.fontWeight)
    // A text style can set its own font (a second font for the emphasised words).
    for (const style of Object.values(classes || {})) if (style?.fontFamily) add(style.fontFamily, style.fontWeight)
  }
  scan(canvas?.nodes, canvas?.classes)
  for (const page of canvas?.pages || []) scan(page.nodes, page.classes)
  return fonts
}

/** Resolves once the stylesheet has loaded or failed; either way its faces are as registered as they will get. */
function stylesheetSettled(link) {
  if (link.dataset.settled) return Promise.resolve()
  return new Promise(resolve => {
    link.addEventListener('load', resolve, { once: true })
    link.addEventListener('error', resolve, { once: true })
  })
}

/**
 * Loads every Google font a canvas uses, so text renders and measures in its real font instead of a wider fallback.
 * Each weight is its own request: Google rejects a whole request that names a weight the family lacks (Anton has only
 * 400), so one missing weight never blocks the others.
 *
 * Returns 0 until the fonts have loaded (or FONT_WAIT_MS has passed), then a number that goes up each time more fonts
 * finish loading, so text measured in a fallback can be measured again. Ready means each face has really loaded:
 * the browser reports its fonts as loaded before a stylesheet has even arrived, since there is nothing to load yet.
 */
export function useCanvasFonts(canvas) {
  const [loaded, setLoaded] = useState({ key: null, count: 0 })
  const fonts = canvasFonts(canvas)
  const key = [...fonts].map(([family, weights]) => `${family}:${[...weights].sort().join(',')}`).sort().join('|')
  useEffect(() => {
    if (typeof document === 'undefined') return
    let live = true, settled = false, timer
    const done = () => { if (live) setLoaded(prev => ({ key, count: (prev.key === key ? prev.count : 0) + 1 })) }
    if (!document.fonts) { done(); return }
    const pending = []
    for (const [family, weights] of fonts) {
      if (SYSTEM_FONTS.has(family.toLowerCase())) continue
      for (const weight of new Set([400, ...weights])) {
        const id = `${family}:${weight}`
        let link = document.querySelector(`link[data-canvas-font="${CSS.escape(id)}"]`)
        if (!link) {
          link = document.createElement('link')
          link.rel = 'stylesheet'
          link.dataset.canvasFont = id
          link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}${weight === 400 ? '' : `:wght@${weight}`}&display=swap`
          const settle = () => { link.dataset.settled = '1' }
          link.addEventListener('load', settle, { once: true })
          link.addEventListener('error', settle, { once: true })
          document.head.appendChild(link)
        }
        pending.push(stylesheetSettled(link).then(() => document.fonts.load(`${weight} 48px "${family}"`, SAMPLE)).catch(() => {}))
      }
    }
    const wait = new Promise(resolve => { timer = setTimeout(resolve, FONT_WAIT_MS) })
    Promise.race([Promise.all(pending), wait]).then(() => { settled = true; done() })
    // A font that arrives after the wait triggers another measurement.
    const late = () => { if (settled) done() }
    document.fonts.addEventListener?.('loadingdone', late)
    return () => { live = false; clearTimeout(timer); document.fonts.removeEventListener?.('loadingdone', late) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  // Derived during render, so text is never measured with the previous fonts' answer after the fonts change.
  return loaded.key === key ? loaded.count : 0
}
