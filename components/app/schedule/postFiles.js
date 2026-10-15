// Getting an approved post out by hand: its slides as files and its caption on the clipboard, or on a phone, both
// at once with Post now (the share sheet takes the slides straight into Instagram or TikTok).

const fileName = topic => (topic || 'post').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/gi, '-').slice(0, 60).replace(/^-+|-+$/g, '').toLowerCase() || 'post'

const FAILED = 'The slides could not be prepared. Please try again.'

/** Renders the post: one PNG, or a ZIP of PNGs for a carousel. */
async function renderPost(entry) {
  const res = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canva_id: entry.canvasId, data: {} }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.error || FAILED)
  const file = await fetch(new URL(data.url, window.location.origin).pathname)
  if (!file.ok) throw new Error(FAILED)
  return { blob: await file.blob(), carousel: data.type === 'carousel' }
}

/** Downloads the post's slides: one PNG, or a ZIP for a carousel. Throws with a message for people. */
export async function downloadSlides(entry) {
  const { blob, carousel } = await renderPost(entry)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileName(entry.topic)}.${carousel ? 'zip' : 'png'}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function copyCaption(entry) {
  await navigator.clipboard.writeText(entry.caption || '')
}

// Slides prepared for sharing, per post version, so a second tap (or a prefetch) doesn't render them again.
const prepared = new Map()

/** The post's slides as PNG files in order, prepared once per version. A carousel's ZIP is unpacked here. */
export function slideFiles(entry) {
  const key = `${entry.id}:${entry.canvasId}`
  if (!prepared.has(key)) {
    const files = (async () => {
      const { blob, carousel } = await renderPost(entry)
      const name = fileName(entry.topic)
      if (!carousel) return [new File([blob], `${name}.png`, { type: 'image/png' })]
      const { default: JSZip } = await import('jszip')
      const zip = await JSZip.loadAsync(blob)
      // The render names slides by position ("00-top-peer.png", "01-…"), so name order is slide order.
      const slides = Object.values(zip.files).filter(f => !f.dir && /\.png$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name))
      if (!slides.length) throw new Error(FAILED)
      return Promise.all(slides.map(async (slide, i) => new File([await slide.async('blob')], `${name}-${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' })))
    })()
    prepared.set(key, files)
    files.catch(() => prepared.delete(key))
  }
  return prepared.get(key)
}

/**
 * Whether this device can share image files to another app: phones and tablets where navigator.canShare accepts
 * files. Desktops keep Download and Copy caption.
 */
export function canPostFromPhone() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false
  if (!window.matchMedia?.('(pointer: coarse)').matches) return false
  try {
    return navigator.canShare({ files: [new File([new Uint8Array([137, 80, 78, 71])], 'slide.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}

/**
 * Post now: copies the caption and opens the share sheet with the slides. Resolves to `{ result, copied }`, where
 * result is 'shared', 'cancelled', or 'ready' when preparing took so long that the browser wants another tap before
 * it shares (the slides are ready then, so the next tap opens the sheet at once). Throws with a message for people.
 */
export async function postNow(entry) {
  // Started inside the tap, before anything slow: clipboards only accept writes right after one.
  const copying = copyCaption(entry).then(() => true, () => false)
  const files = await slideFiles(entry)
  if (!navigator.canShare?.({ files })) throw new Error('This phone can’t share these slides. Download them instead.')
  try {
    await navigator.share({ files })
    return { result: 'shared', copied: await copying }
  } catch (error) {
    if (error?.name === 'AbortError') return { result: 'cancelled', copied: await copying }
    if (error?.name === 'NotAllowedError') return { result: 'ready', copied: await copying }
    throw new Error('The slides could not be shared. Download them instead.')
  }
}
