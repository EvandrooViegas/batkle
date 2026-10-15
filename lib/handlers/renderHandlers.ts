/**
 * Render handlers for canvas output (PNG/ZIP)
 */

import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import JSZip from 'jszip'
import { corsify, getBaseUrl } from '@/lib/services/middleware'
import { renderCanvasToPng } from '@/lib/renderCanvas'
import { deleteRender, loadRender, saveRender } from '@/lib/services/uploadStore'

export async function handleRender(db: any, body: any, request: Request) {
  const canvaId = body.canva_id || body.canvas_id || body.canvaId
  if (!canvaId) return corsify(NextResponse.json({ error: 'canva_id is required' }, { status: 400 }))

  const canvas = await db.collection('canvases').findOne({ id: canvaId })
  if (!canvas) return corsify(NextResponse.json({ error: 'Canvas not found' }, { status: 404 }))

  const baseUrl = getBaseUrl(request)
  const renderId = uuidv4()

  if (canvas.type === 'carousel') {
    return await renderCarousel(db, canvas, body, renderId, baseUrl, canvaId)
  }

  return await renderSingle(db, canvas, body, renderId, baseUrl, canvaId)
}

async function renderCarousel(db: any, canvas: any, body: any, renderId: string, baseUrl: string, canvaId: string) {
  const { top_peer_data = {}, bottom_peer_data = {}, content = [] } = body
  const pages = [...(canvas.pages || [])].sort((a: any, b: any) => a.order - b.order)
  const zip = new JSZip()
  const renderResults = []

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    let pageData: any = {}

    if (page.type === 'top_peer') {
      for (const [k, v] of Object.entries(top_peer_data)) {
        pageData[(k as string).replace(/_top$/, '')] = v
      }
      Object.assign(pageData, top_peer_data)
    } else if (page.type === 'bottom_peer') {
      for (const [k, v] of Object.entries(bottom_peer_data)) {
        pageData[(k as string).replace(/_bottom$/, '')] = v
      }
      Object.assign(pageData, bottom_peer_data)
    } else {
      const contentIdx = pages.filter((p: any, j: number) => p.type === 'content' && j < i).length
      const raw = content[contentIdx] || {}
      for (const [k, v] of Object.entries(raw)) {
        pageData[(k as string).replace(/_\d+$/, '')] = v
      }
      Object.assign(pageData, raw)
    }

    const pageCanvas = {
      ...canvas,
      nodes: page.nodes || [],
      groups: page.groups || [],
      classes: page.classes || {},
      background: page.background || canvas.background,
    }

    try {
      const png = await renderCanvasToPng(pageCanvas, pageData)
      const label =
        page.type === 'top_peer'
          ? '00-top-peer'
          : page.type === 'bottom_peer'
          ? `${String(pages.length - 1).padStart(2, '0')}-bottom-peer`
          : `${String(i).padStart(2, '0')}-${page.name || 'page'}`
      zip.file(`${label}.png`, png)
      renderResults.push({ pageId: page.id, type: page.type, order: i, filename: `${label}.png` })
    } catch (e) {
      console.error('carousel page render error', page.id, (e as Error).message)
      renderResults.push({ pageId: page.id, type: page.type, order: i, error: (e as Error).message })
    }
  }

  const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await saveRender(db, {
    id: renderId,
    canvasId: canvaId,
    type: 'carousel',
    zip: zipBuf,
    pages: renderResults,
    payload: body,
    approved: false,
    createdAt: new Date(),
  })

  const zipUrl = `${baseUrl}/api/rendered/${renderId}.zip`
  return corsify(NextResponse.json({ url: zipUrl, render_id: renderId, canva_id: canvaId, type: 'carousel', pages: renderResults }))
}

async function renderSingle(db: any, canvas: any, body: any, renderId: string, baseUrl: string, canvaId: string) {
  const data = body.data || {}
  const png = await renderCanvasToPng(canvas, data)
  await saveRender(db, {
    id: renderId,
    canvasId: canvaId,
    type: 'single',
    png,
    payload: body,
    approved: false,
    createdAt: new Date(),
  })
  const url = `${baseUrl}/api/rendered/${renderId}`
  return corsify(NextResponse.json({ url, render_id: renderId, canva_id: canvaId, type: 'single' }))
}

/**
 * Serves a render (a PNG, or a carousel's ZIP). A render never changes, so Vercel's CDN keeps it for a year
 * (s-maxage) and most downloads never reach storage. A deleted render can stay in the CDN's copy until it expires;
 * its address is a random ID nobody else knows.
 */
export async function handleGetRendered(db: any, id: string) {
  let render
  try {
    render = await loadRender(db, id)
  } catch (error: any) {
    console.error('[rendered] could not read', id, error?.message || error)
    return corsify(NextResponse.json({ error: 'This render could not be loaded right now. Please try again.' }, { status: 503 }))
  }
  if (!render) return corsify(NextResponse.json({ error: 'Not found' }, { status: 404 }))

  return new NextResponse(render.bytes, {
    status: 200,
    headers: {
      'Content-Type': render.contentType,
      ...(render.kind === 'zip' ? { 'Content-Disposition': `attachment; filename="render-${id}.zip"` } : {}),
      'Cache-Control': 'public, max-age=86400, s-maxage=31536000',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/** Renders belong to the account that owns their post. */
export async function handleGetRenders(db: any, ownerId: string) {
  const canvasIds = await db.collection('canvases').distinct('id', { ownerId })
  // The list never needs the bytes, which older renders still keep in their records.
  const list = await db.collection('renders').find({ canvasId: { $in: canvasIds } }, { projection: { png: 0, zip: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()
  return corsify(NextResponse.json(list.map(({ _id, png, zip, key, storage, ...rest }: any) => rest)))
}

export async function handleApproveRender(db: any, id: string) {
  await db.collection('renders').updateOne({ id }, { $set: { approved: true, approvedAt: new Date() } })
  return corsify(NextResponse.json({ success: true }))
}

export async function handleDeleteRender(db: any, id: string) {
  await deleteRender(db, id)
  return corsify(NextResponse.json({ success: true }))
}
