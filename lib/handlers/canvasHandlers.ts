import { persistInlineImages } from '@/lib/services/persistInlineImages'
import { canvasBrand } from '@/lib/designs/canvasBrand'
/**
 * Canvas CRUD handlers for API routes
 */

import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { corsify } from '@/lib/services/middleware'

/** Posts belong to the account that made them (`ownerId`); the API route checks ownership before the by-ID handlers. */
export async function handleGetCanvases(db: any, ownerId: string) {
  const list = await db.collection('canvases').find({ ownerId, globalDesignEditor: { $exists: false } }).sort({ updatedAt: -1 }).limit(500).toArray()
  return corsify(NextResponse.json(list.map(({ _id, ...rest }: any) => rest)))
}

export async function handleCreateCanvas(db: any, body: any, ownerId: string) {
  const isCarousel = body.type === 'carousel'
  const w = body.width || 1080
  const h = body.height || 1080
  const bg = body.background || '#ffffff'

  const newCanvas = {
    id: uuidv4(),
    ownerId,
    name: body.name || 'Untitled Canvas',
    type: isCarousel ? 'carousel' : 'single',
    width: w,
    height: h,
    background: bg,
    nodes: [],
    groups: [],
    classes: {},
    ...(isCarousel
      ? {
          pages: [
            { id: uuidv4(), type: 'top_peer', name: 'Top Peer (Hook)', order: 0, nodes: [], groups: [], classes: {}, background: bg },
            { id: uuidv4(), type: 'content', name: 'Page 1', order: 1, nodes: [], groups: [], classes: {}, background: bg },
            { id: uuidv4(), type: 'bottom_peer', name: 'Bottom Peer (CTA)', order: 2, nodes: [], groups: [], classes: {}, background: bg },
          ],
        }
      : {}),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  await db.collection('canvases').insertOne(newCanvas)
  const { _id, ...rest } = newCanvas
  return corsify(NextResponse.json(rest))
}

export async function handleDuplicateCanvas(db: any, srcId: string, ownerId: string) {
  const src = await db.collection('canvases').findOne({ id: srcId })
  if (!src) return corsify(NextResponse.json({ error: 'Not found' }, { status: 404 }))

  const newCanvas = {
    ...src,
    id: uuidv4(),
    ownerId,
    name: (src.name || 'Canvas') + ' (Copy)',
    nodes: (src.nodes || []).map((n: any) => ({ ...n, id: uuidv4() })),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  delete (newCanvas as any)._id
  await db.collection('canvases').insertOne(newCanvas)
  const { _id, ...rest } = newCanvas
  return corsify(NextResponse.json(rest))
}

export async function handleGetCanvas(db: any, id: string) {
  const c = await db.collection('canvases').findOne({ id })
  if (!c) return corsify(NextResponse.json({ error: 'Not found' }, { status: 404 }))
  const { _id, ...rest } = c
  const brand=await canvasBrand(db,c)
  if(brand.id) {
    rest.flowId=brand.id
    rest.brandContext=brand
    if(rest.designInput)rest.designInput={...rest.designInput,brandContext:brand}
  }
  return corsify(NextResponse.json(rest))
}

export async function handleUpdateCanvas(db: any, id: string, body: any) {
  const current = await db.collection('canvases').findOne({ id })
  const update = { ...await persistInlineImages(db, body), id, updatedAt: new Date() }
  delete update.globalDesignEditor
  delete (update as any).ownerId
  if (current?.globalDesignEditor) update.globalDesignEditor = current.globalDesignEditor
  delete (update as any)._id
  delete (update as any).createdAt
  await db.collection('canvases').updateOne({ id }, { $set: update })
  const c = await db.collection('canvases').findOne({ id })
  const { _id, ...rest } = c || {}
  return corsify(NextResponse.json(rest))
}

export async function handleDeleteCanvas(db: any, id: string) {
  await db.collection('canvases').deleteOne({ id })
  return corsify(NextResponse.json({ success: true }))
}
