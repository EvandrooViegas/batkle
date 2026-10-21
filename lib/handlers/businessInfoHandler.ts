import { NextResponse } from 'next/server'
import { corsify } from '@/lib/services/middleware'
import { generateLogoVariants } from '@/lib/services/logoVariants'
import { withMinimumBrandDesigns } from '@/lib/designs/minimumBrandDesigns'
import { randomUUID } from 'node:crypto'
import { persistInlineImages } from '@/lib/services/persistInlineImages'
import { billingResponse, onboardingMarker, unfinishedBrand } from './flowHandlers'
import { requireBrandSlot } from '@/lib/billing/account'

/**
 * Researches a website into a brand profile: updates `flowId` (the API route checked it is the caller's) or creates a
 * brand owned by `ownerId`. Research for a new brand needs a free brand slot on the plan, checked before the research
 * (which takes a minute), unless it replaces a brand left unfinished in onboarding (`replaces`). Researching a brand
 * the person already has again is never limited.
 */
export async function handleExtractBusinessInfo(body: any, db: any, request: Request, ownerId: string) {
  try {
    const { url } = body

    if (!url || typeof url !== 'string') {
      return corsify(
        NextResponse.json(
          { error: 'URL is required and must be a string' },
          { status: 400 }
        )
      )
    }

    if (body.flowId != null && typeof body.flowId !== 'string') return corsify(NextResponse.json({ error: 'Invalid brand ID' }, { status: 400 }))
    const existing = body.flowId ? await db.collection('flows').findOne({ id: body.flowId, ownerId }) : null
    if (body.flowId && !existing) return corsify(NextResponse.json({ error: 'Brand not found' }, { status: 404 }))
    const replaced = !existing && ownerId ? await unfinishedBrand(db, body.replaces, ownerId) : null
    if (!existing && ownerId && !replaced) await requireBrandSlot(db, ownerId)

    // Dynamically import the extractor at runtime to avoid build issues
    const extractorModule = await import('@/lib/business-info-extractor-complete')
    const { extractBusinessInfo } = extractorModule

    // Call the extractor with the provided URL
    const businessInfo = await extractBusinessInfo(url)

    if (businessInfo.logo) {
      try { businessInfo.logoVariants = await generateLogoVariants(businessInfo.logo) }
      catch (error: any) { businessInfo.logoVariantsError = error.message }
    }
    const profile = businessInfo
    const flowId = existing?.id || randomUUID()
    const brandContext = await persistInlineImages(db, withMinimumBrandDesigns({
      ...existing?.brandContext, ...profile,
      logoVariants: profile.logoVariants || null,
      colors: profile.designSystem?.colors || [], fonts: profile.designSystem?.fonts || [],
    }))
    const now = new Date()
    // Research run by the onboarding leaves the brand at the review step, so leaving now can be continued later.
    const onboarding = body.onboarding === true ? { onboarding: onboardingMarker({ step: 'review' }) } : {}
    if (existing) {
      await db.collection('flows').updateOne({ id: flowId }, { $set: { brandContext, ...onboarding, updatedAt: now } })
    } else {
      await db.collection('flows').insertOne({ id: flowId, ownerId, ...onboarding, name: profile.name || 'New brand', brandContext, brandAnswers: {}, brandQuestions: [], extractedContext: '', tone: 'informative', language: 'english', posts: [], createdAt: now, updatedAt: now })
      if (replaced) await db.collection('flows').deleteOne({ id: replaced.id, ownerId })
    }
    const flow = await db.collection('flows').findOne({ id: flowId })
    return corsify(NextResponse.json({ ...profile, logo: brandContext.logo, logoVariants: brandContext.logoVariants, flow }))
  } catch (error: any) {
    const limit = billingResponse(error)
    if (limit) return limit
    console.error('Business info extraction error:', error)
    return corsify(
      NextResponse.json(
        {
          error: error.message || 'Failed to extract business information',
        },
        { status: 500 }
      )
    )
  }
}
