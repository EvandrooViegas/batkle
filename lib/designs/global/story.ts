/**
 * Stories and Reels (9:16). Meta draws the account name over the top of a story and the reply bar over its bottom, so a
 * story is composed in the part of the frame they leave clear and then placed in the full 1080×1920 frame: what fills
 * the composition (a photo, a colour field) is stretched over the whole frame; words, logo and the rest move down below
 * the top bar. Ads and story posts share it.
 */
export const STORY_FRAME = { width: 1080, height: 1920 }

type Safe = { top: number; bottom: number }

/** The size a story is composed at: the frame without Meta's bars. */
export const storyArea = (safe: Safe) => ({ width: STORY_FRAME.width, height: STORY_FRAME.height - safe.top - safe.bottom })

/** A canvas composed at `storyArea`, placed in the full frame; every frame of a multi-frame story too. */
export function toStoryCanvas(canvas: any, safe: Safe) {
  const inner = canvas.height, full = STORY_FRAME.height
  const fills = (n: any) => n.x <= 1 && n.y <= 1 && n.width >= canvas.width - 1 && n.height >= inner - 1
  const place = (nodes: any[]) => (Array.isArray(nodes) ? nodes : []).map((n: any) => (fills(n) ? { ...n, y: 0, height: full } : { ...n, y: n.y + safe.top }))
  canvas.nodes = place(canvas.nodes)
  if (Array.isArray(canvas.pages)) canvas.pages = canvas.pages.map((page: any) => ({ ...page, nodes: place(page.nodes), ...(page.height ? { height: full } : {}) }))
  canvas.height = full
  return canvas
}
