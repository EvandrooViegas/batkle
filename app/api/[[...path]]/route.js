import { handleGlobalDesignRequest } from '@/lib/handlers/globalDesignHandler'
import { isDesignAdmin, requireDesignAdmin } from '@/lib/designs/global/admin'
import { publicMessage } from '@/lib/services/publicError'
import { handleBrandDesigns, handleDeleteBrandDesign } from '@/lib/handlers/brandDesignHandler'
import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { corsify } from '@/lib/services/middleware'
import { handleGetCanvases, handleCreateCanvas, handleDuplicateCanvas, handleGetCanvas, handleUpdateCanvas, handleDeleteCanvas } from '@/lib/handlers/canvasHandlers'
import { handleGetGalleries, handleCreateGallery, handleGetGallery, handleUpdateGallery, handleDeleteGallery } from '@/lib/handlers/galleryHandlers'
import { handleUploadImage, handleGetUpload } from '@/lib/handlers/uploadHandlers'
import { handleRender, handleGetRendered, handleGetRenders, handleApproveRender, handleDeleteRender } from '@/lib/handlers/renderHandlers'
import { handleGetFlows, handleCreateFlow, handleGetFlow, handleUpdateFlow, handleDeleteFlow, handleFlowOpened } from '@/lib/handlers/flowHandlers'
import { handleExtractBusinessInfo } from '@/lib/handlers/businessInfoHandler'
import { ensureEnglishBusinessProfile } from '@/lib/services/englishBusinessProfile'
import { handleGenerateContentIdeas } from '@/lib/handlers/contentIdeasHandler'
import { handleGenerateCopywriting } from '@/lib/handlers/copywritingHandler'
import { handleUploadAsset, handleListAssets, handleGetAsset, handleDeleteAsset, handleUpdateAsset } from '@/lib/handlers/assetHandlers'
import { handlePlanAssets } from '@/lib/handlers/assetPlannerHandler'
import { handlePlanPost } from '@/lib/handlers/postPlanHandler'
import { handleResolveAssets } from '@/lib/handlers/assetResolverHandler'
import { handleDesignCanvas, handleSwitchDesign } from '@/lib/handlers/canvasDesignerHandler'
import { handleUploadPostImage, handleDeletePostImage } from '@/lib/handlers/postImageHandler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return corsify(new NextResponse(null, { status: 200 }))
}

/**
 * Every error leaves the API in words written for people: provider names, keys, billing and model or stack details
 * are logged here and replaced (see publicMessage). The Design Library admin keeps the full message.
 */
async function publicErrors(request, path, response) {
  if (!(response instanceof Response) || response.status < 400) return response
  if (!(response.headers.get('content-type') || '').includes('application/json')) return response
  if (path[0] === 'global-designs' && isDesignAdmin(request)) return response
  let body
  try { body = await response.clone().json() } catch { return response }
  if (!body || typeof body !== 'object' || typeof body.error !== 'string') return response
  const { raw: _raw, ...rest } = body
  const error = publicMessage(body.error, response.status)
  if (error === body.error && !('raw' in body)) return response
  if (error !== body.error) console.warn(`[api] ${request.method} /${path.join('/')} ${response.status}: "${body.error}" shown as "${error}"`)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new NextResponse(JSON.stringify({ ...rest, error }), { status: response.status, headers })
}

async function handleRoute(request, context) {
  return publicErrors(request, context.params?.path || [], await routeRequest(request, context))
}

async function routeRequest(request, { params }) {
  const { path = [] } = params
  const route = `/${path.join('/')}`
  const method = request.method

  try {
    const db = await connectToMongo()

    if (path[0] === 'global-designs') return await handleGlobalDesignRequest(db, request, path.slice(1))

    if (route === '/brand-designs' && method === 'POST') return await handleBrandDesigns(db, await request.json())

    if (route === '/brand-designs' && method === 'DELETE') return await handleDeleteBrandDesign(db, await request.json())

    // Root
    if (route === '/' && method === 'GET') {
      return corsify(NextResponse.json({ message: 'DynaCanvas API' }))
    }

    // Extract business info endpoint
    if (route === '/translate-business-profile' && method === 'POST') {
      const body = await request.json()
      if (typeof body.flowId !== 'string' || !body.flowId) return corsify(NextResponse.json({ error: 'Brand ID is required' }, { status: 400 }))
      return corsify(NextResponse.json({ brandContext: await ensureEnglishBusinessProfile(db, body.flowId) }))
    }
    if (route === '/extract-business-info' && method === 'POST') {
      return await handleExtractBusinessInfo(await request.json(), db, request)
    }

    // Content ideas generation endpoint
    if (route === '/generate-content-ideas' && method === 'POST') {
      return await handleGenerateContentIdeas(await request.json(), db)
    }

    // Copywriting generation endpoint
    if (route === '/generate-copywriting' && method === 'POST') {
      return await handleGenerateCopywriting(await request.json(), db)
    }

    // Post planning: copy + composition plan in one model call, asset needs derived in code
    if (route === '/plan-post' && method === 'POST') {
      return await handlePlanPost(db, await request.json())
    }

    // Asset planner endpoint
    if (route === '/plan-assets' && method === 'POST') {
      return await handlePlanAssets(db, await request.json())
    }

    // Asset resolver endpoint
    if (route === '/resolve-assets' && method === 'POST') {
      return await handleResolveAssets(db, await request.json())
    }

    // Canvas designer endpoint
    if (route === '/design-canvas' && method === 'POST') {
      return await handleDesignCanvas(db, await request.json())
    }

    // Photos attached to a post idea: read on upload, used once by that post
    if (route === '/post-images' && method === 'POST') return await handleUploadPostImage(db, await request.json())
    const postImageMatch = route.match(/^\/post-images\/([^/]+)$/)
    if (postImageMatch && method === 'DELETE') return await handleDeletePostImage(db, postImageMatch[1], new URL(request.url).searchParams.get('brand_id'))

    // Asset routes
    if (route === '/assets' && method === 'POST') return await handleUploadAsset(db, await request.json(), request)
    if (route === '/assets' && method === 'GET') {
      const brand_id = new URL(request.url).searchParams.get('brand_id') || ''
      return await handleListAssets(db, brand_id)
    }
    const assetMatch = route.match(/^\/assets\/([^/]+)$/)
    if (assetMatch) {
      if (method === 'GET') return await handleGetAsset(db, assetMatch[1])
      if (method === 'DELETE') return await handleDeleteAsset(db, assetMatch[1])
      if (method === 'PATCH') return await handleUpdateAsset(db, assetMatch[1], await request.json())
    }

    const designMatch = route.match(/^\/canvases\/([^/]+)\/design$/)
    if (designMatch && method === 'POST') return await handleSwitchDesign(db, designMatch[1], await request.json())

    // Canvas routes
    if (route === '/canvases' && method === 'GET') return await handleGetCanvases(db)
    if (route === '/canvases' && method === 'POST') return await handleCreateCanvas(db, await request.json())
    const dupMatch = route.match(/^\/canvases\/([^/]+)\/duplicate$/)
    if (dupMatch && method === 'POST') {
      const existing = await db.collection('canvases').findOne({ id: dupMatch[1] })
      if (existing?.globalDesignEditor) requireDesignAdmin(request)
      return await handleDuplicateCanvas(db, dupMatch[1])
    }
    const canvasMatch = route.match(/^\/canvases\/([^/]+)$/)
    if (canvasMatch) {
      const existing = await db.collection('canvases').findOne({ id: canvasMatch[1] })
      if (existing?.globalDesignEditor) requireDesignAdmin(request)
      if (method === 'GET') return await handleGetCanvas(db, canvasMatch[1])
      if (method === 'PUT') return await handleUpdateCanvas(db, canvasMatch[1], await request.json())
      if (method === 'DELETE') return await handleDeleteCanvas(db, canvasMatch[1])
    }

    // Upload routes
    if (route === '/uploads' && method === 'POST') return await handleUploadImage(db, await request.json(), request)
    const uploadMatch = route.match(/^\/uploads\/([^/]+)$/)
    if (uploadMatch && method === 'GET') return await handleGetUpload(db, uploadMatch[1], request)

    // Render routes
    if (route === '/render' && method === 'POST') return await handleRender(db, await request.json(), request)
    const renderedMatch = route.match(/^\/rendered\/([^/]+?)(?:\.(png|zip))?$/)
    if (renderedMatch && method === 'GET') return await handleGetRendered(db, renderedMatch[1])
    if (route === '/renders' && method === 'GET') return await handleGetRenders(db)
    const renderApproveMatch = route.match(/^\/renders\/([^/]+)\/approve$/)
    if (renderApproveMatch && method === 'POST') return await handleApproveRender(db, renderApproveMatch[1])
    const renderDeleteMatch = route.match(/^\/renders\/([^/]+)$/)
    if (renderDeleteMatch && method === 'DELETE') return await handleDeleteRender(db, renderDeleteMatch[1])

    // Gallery routes
    if (route === '/galleries' && method === 'GET') return await handleGetGalleries(db)
    if (route === '/galleries' && method === 'POST') return await handleCreateGallery(db, await request.json())
    const galleryMatch = route.match(/^\/galleries\/([^/]+)$/)
    if (galleryMatch) {
      if (method === 'GET') return await handleGetGallery(db, galleryMatch[1])
      if (method === 'PUT') return await handleUpdateGallery(db, galleryMatch[1], await request.json())
      if (method === 'DELETE') return await handleDeleteGallery(db, galleryMatch[1])
    }

    // Flow routes
    if (route === '/flows' && method === 'GET') return await handleGetFlows(db)
    if (route === '/flows' && method === 'POST') return await handleCreateFlow(db, await request.json())
    const flowMatch = route.match(/^\/flows\/([^/]+)$/)
    if (flowMatch) {
      if (method === 'GET') return await handleGetFlow(db, flowMatch[1])
      if (method === 'PUT') return await handleUpdateFlow(db, flowMatch[1], await request.json())
      if (method === 'DELETE') return await handleDeleteFlow(db, flowMatch[1])
    }
    const flowOpenedMatch = route.match(/^\/flows\/([^/]+)\/opened$/)
    if (flowOpenedMatch && method === 'POST') return await handleFlowOpened(db, flowOpenedMatch[1])

    return corsify(NextResponse.json({ error: `Route ${route} not found` }, { status: 404 }))
  } catch (error) {
    console.error('API Error:', error)
    return corsify(NextResponse.json({ error: error?.message || 'Internal server error' }, { status: error?.status || 500 }))
  }
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
