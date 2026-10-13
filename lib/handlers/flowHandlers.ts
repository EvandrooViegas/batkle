import { persistInlineImages } from '@/lib/services/persistInlineImages'
import { ensureMinimumBrandDesigns, withMinimumBrandDesigns } from '@/lib/designs/minimumBrandDesigns'
import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { corsify } from '@/lib/services/middleware'

export async function handleGetFlows(db: any) {
  try {
    const flows = await Promise.all((await db.collection('flows').find({}).toArray()).map((flow:any)=>ensureMinimumBrandDesigns(db,flow)))
    return corsify(NextResponse.json(flows))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error.message }, { status: 500 }))
  }
}

export async function handleCreateFlow(db: any, body: any) {
  try {
    const flow = {
      id: uuidv4(),
      name: body.name || 'New Flow',
      brandContext: withMinimumBrandDesigns({...body.brandContext, designs:(body.brandContext?.designs||[]).filter((d:any)=>d.source!=='global')}),
      brandAnswers: {},
      brandQuestions: [],
      extractedContext: '',
      tone: 'informative',
      language: 'english',
      posts: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await db.collection('flows').insertOne(flow)
    return corsify(NextResponse.json(await ensureMinimumBrandDesigns(db,flow)))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error.message }, { status: 500 }))
  }
}

export async function handleGetFlow(db: any, flowId: string) {
  try {
    const flow = await db.collection('flows').findOne({ id: flowId })
    if (!flow) {
      return corsify(NextResponse.json({ error: 'Flow not found' }, { status: 404 }))
    }
    return corsify(NextResponse.json(await ensureMinimumBrandDesigns(db,flow)))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error.message }, { status: 500 }))
  }
}

export async function handleUpdateFlow(db: any, flowId: string, body: any) {
  try {
    if(body.brandContext){
      const current=await db.collection('flows').findOne({id:flowId})
      const existing=current?.brandContext?.designs||[]
      const incoming=(body.brandContext.designs||[]).filter((d:any)=>d.source!=='global')
      const designs=[...existing,...incoming.filter((d:any)=>!existing.some((e:any)=>e.id===d.id))]
      body={...body,brandContext:withMinimumBrandDesigns({...body.brandContext,designs})}
    }
    const result = await db.collection('flows').findOneAndUpdate(
      { id: flowId },
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
export async function handleFlowOpened(db: any, flowId: string) {
  try {
    const result = await db.collection('flows').updateOne({ id: flowId }, { $set: { lastOpenedAt: new Date() } })
    if (result.matchedCount === 0) {
      return corsify(NextResponse.json({ error: 'Flow not found' }, { status: 404 }))
    }
    return corsify(NextResponse.json({ success: true }))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error.message }, { status: 500 }))
  }
}

export async function handleDeleteFlow(db: any, flowId: string) {
  try {
    const result = await db.collection('flows').deleteOne({ id: flowId })
    if (result.deletedCount === 0) {
      return corsify(NextResponse.json({ error: 'Flow not found' }, { status: 404 }))
    }
    return corsify(NextResponse.json({ success: true }))
  } catch (error: any) {
    return corsify(NextResponse.json({ error: error.message }, { status: 500 }))
  }
}
