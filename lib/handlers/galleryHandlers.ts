/**
 * Gallery CRUD handlers for API routes
 */

import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { corsify } from '@/lib/services/middleware'

/** Galleries belong to the account that made them (`ownerId`). */
export async function handleGetGalleries(db: any, ownerId: string) {
  const list = await db.collection('galleries').find({ ownerId }).sort({ updatedAt: -1 }).toArray()
  return corsify(NextResponse.json(list.map(({ _id, ...r }: any) => r)))
}

export async function handleCreateGallery(db: any, body: any, ownerId: string) {
  const gallery = {
    id: uuidv4(),
    ownerId,
    name: body.name || 'Untitled Gallery',
    images: body.images || [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  await db.collection('galleries').insertOne(gallery)
  const { _id, ...rest } = gallery
  return corsify(NextResponse.json(rest))
}

export async function handleGetGallery(db: any, id: string, ownerId: string) {
  const g = await db.collection('galleries').findOne({ id, ownerId })
  if (!g) return corsify(NextResponse.json({ error: 'Not found' }, { status: 404 }))
  const { _id, ...rest } = g
  return corsify(NextResponse.json(rest))
}

export async function handleUpdateGallery(db: any, id: string, body: any, ownerId: string) {
  const update = { ...body, id, updatedAt: new Date() }
  delete (update as any)._id
  delete (update as any).createdAt
  delete (update as any).ownerId
  await db.collection('galleries').updateOne({ id, ownerId }, { $set: update })
  const g = await db.collection('galleries').findOne({ id, ownerId })
  const { _id, ...rest } = g || {}
  return corsify(NextResponse.json(rest))
}

export async function handleDeleteGallery(db: any, id: string, ownerId: string) {
  await db.collection('galleries').deleteOne({ id, ownerId })
  return corsify(NextResponse.json({ success: true }))
}
