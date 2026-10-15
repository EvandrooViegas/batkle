import { persistInlineImages } from '@/lib/services/persistInlineImages'
import { ensureMinimumBrandDesigns, withMinimumBrandDesigns } from '@/lib/designs/minimumBrandDesigns'
import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { corsify } from '@/lib/services/middleware'
import { billingErrorBody, requireBrandSlot } from '@/lib/billing/account'

/**
 * Where an unfinished brand onboarding stopped (`flow.onboarding`), so the next visit can continue there. Brands
 * that finished onboarding, and every brand made before this existed, have none. Anything else becomes null.
 */
export function onboardingMarker(value: any) {
  if (!value || typeof value !== 'object' || !['review', 'design'].includes(value.step)) return null
  return {
    step: value.step,
    ...(value.manual === true ? { manual: true } : {}),
    ...(value.after === 'profile' ? { after: 'profile' } : {}),
    updatedAt: new Date(),
  }
}

/**
 * The caller's own brand `id` while its onboarding is unfinished, else null. Onboarding replaces such a brand when
 * the person goes back and picks another website or sets the brand up by hand: the new brand takes its place, so it
 * needs no free brand slot, and the one it replaces is deleted once the new one is saved.
 */
export async function unfinishedBrand(db: any, id: unknown, ownerId: string) {
  if (typeof id !== 'string' || !id || !ownerId) return null
  return db.collection('flows').findOne({ id, ownerId, onboarding: { $ne: null } }, { projection: { _id: 0, id: 1 } })
}

/** A plan limit as the API answers it (402 with its code), or null for any other error. */
export function billingResponse(error: any) {
  const body = error?.billing ? billingErrorBody(error) : null
  return body ? corsify(NextResponse.json(body, { status: error.status })) : null
}

/** Brands belong to the account that created them (`ownerId`); every handler here only sees the caller's own. */
export async function handleGetFlows(db: any, ownerId: string) {
  try {
    const flows = await Promise.all((await db.collection('flows').find({ ownerId }).toArray()).map((flow:any)=>ensureMinimumBrandDesigns(db,flow)))
    return corsify(NextResponse.json(flows))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error.message }, { status: 500 }))
  }
}

/** A new brand needs a free brand slot on the account's plan, unless it replaces one left unfinished (`body.replaces`). */
export async function handleCreateFlow(db: any, body: any, ownerId: string) {
  try {
    const replaced = ownerId ? await unfinishedBrand(db, body?.replaces, ownerId) : null
    if (ownerId && !replaced) await requireBrandSlot(db, ownerId)
    const flow = {
      id: uuidv4(),
      ownerId,
      name: body.name || 'New Flow',
      brandContext: withMinimumBrandDesigns({...body.brandContext, designs:(body.brandContext?.designs||[]).filter((d:any)=>d.source!=='global')}),
      brandAnswers: {},
      brandQuestions: [],
      extractedContext: '',
      tone: 'informative',
      language: 'english',
      posts: [],
      ...(onboardingMarker(body.onboarding) ? { onboarding: onboardingMarker(body.onboarding) } : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await db.collection('flows').insertOne(flow)
    if (replaced) await db.collection('flows').deleteOne({ id: replaced.id, ownerId })
    return corsify(NextResponse.json(await ensureMinimumBrandDesigns(db,flow)))
  } catch (error: any) {
    return billingResponse(error) || corsify(NextResponse.json({ error: error.message }, { status: 500 }))
  }
}

export async function handleGetFlow(db: any, flowId: string, ownerId: string) {
  try {
    const flow = await db.collection('flows').findOne({ id: flowId, ownerId })
    if (!flow) {
      return corsify(NextResponse.json({ error: 'Flow not found' }, { status: 404 }))
    }
    return corsify(NextResponse.json(await ensureMinimumBrandDesigns(db,flow)))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error.message }, { status: 500 }))
  }
}

export async function handleUpdateFlow(db: any, flowId: string, body: any, ownerId: string) {
  try {
    // A brand keeps its ID and owner whatever the request says.
    const { _id, id: _ignoredId, ownerId: _ignoredOwner, ...changes } = body || {}
    body = changes
    if ('onboarding' in body) body.onboarding = onboardingMarker(body.onboarding)
    if(body.brandContext){
      const current=await db.collection('flows').findOne({id:flowId,ownerId})
      const existing=current?.brandContext?.designs||[]
      const incoming=(body.brandContext.designs||[]).filter((d:any)=>d.source!=='global')
      const designs=[...existing,...incoming.filter((d:any)=>!existing.some((e:any)=>e.id===d.id))]
      body={...body,brandContext:withMinimumBrandDesigns({...body.brandContext,designs})}
    }
    const result = await db.collection('flows').findOneAndUpdate(
      { id: flowId, ownerId },
      {
        $set: {
          ...await persistInlineImages(db, body),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    )
    // MongoDB driver v5+ returns the document directly; v4 wraps it in { value }
    const updated = result?.value ?? result
    if (!updated) {
      return corsify(NextResponse.json({ error: 'Flow not found' }, { status: 404 }))
    }
    return corsify(NextResponse.json(await ensureMinimumBrandDesigns(db,updated)))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error.message }, { status: 500 }))
  }
}

/** Records that a brand was opened, so it leads the brand list and opens by default. updatedAt is left alone. */
export async function handleFlowOpened(db: any, flowId: string, ownerId: string) {
  try {
    const result = await db.collection('flows').updateOne({ id: flowId, ownerId }, { $set: { lastOpenedAt: new Date() } })
    if (result.matchedCount === 0) {
      return corsify(NextResponse.json({ error: 'Flow not found' }, { status: 404 }))
    }
    return corsify(NextResponse.json({ success: true }))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error.message }, { status: 500 }))
  }
}

export async function handleDeleteFlow(db: any, flowId: string, ownerId: string) {
  try {
    const result = await db.collection('flows').deleteOne({ id: flowId, ownerId })
    if (result.deletedCount === 0) {
      return corsify(NextResponse.json({ error: 'Flow not found' }, { status: 404 }))
    }
    return corsify(NextResponse.json({ success: true }))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error.message }, { status: 500 }))
  }
}
