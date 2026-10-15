import { handleGlobalDesignRequest } from '@/lib/handlers/globalDesignHandler'
import { isDesignAdmin, requireDesignAdmin } from '@/lib/designs/global/admin'
import { publicMessage } from '@/lib/services/publicError'
import { handleBrandDesigns, handleDeleteBrandDesign } from '@/lib/handlers/brandDesignHandler'
import { NextResponse } from 'next/server'
import { connectToMongo } from '@/lib/services/db/mongo'
import { corsify } from '@/lib/services/middleware'
import { handleGetCanvases, handleCreateCanvas, handleDuplicateCanvas, handleGetCanvas, handleUpdateCanvas, handleDeleteCanvas } from '@/lib/handlers/canvasHandlers'
import { handleGetGalleries, handleCreateGallery, handleGetGallery, handleUpdateGallery, handleDeleteGallery } from '@/lib/handlers/galleryHandlers'
import { handleUploadImage, handleGetUpload, handleSignUpload } from '@/lib/handlers/uploadHandlers'
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
import { handleClearOnboardingDraft, handleCompleteOnboarding, handleSaveOnboardingDraft } from '@/lib/handlers/accountHandlers'
import { requireOwnBrands, requireUserId } from '@/lib/auth'
import { BILLING_CODES, billingErrorBody } from '@/lib/billing/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return corsify(new NextResponse(null, { status: 200 }))
}

/**
 * Every error leaves the API in words written for people: provider names, keys, billing and model or stack details
 * are logged here and replaced (see publicMessage). The Design Library admin keeps the full message, and plan limits
 * (insufficient credits, a feature or limit of the plan) keep theirs, which say what to do next.
 */
async function publicErrors(request, path, response) {
  if (!(response instanceof Response) || response.status < 400) return response
  if (!(response.headers.get('content-type') || '').includes('application/json')) return response
  if (path[0] === 'global-designs' && isDesignAdmin(request)) return response
  let body
  try { body = await response.clone().json() } catch { return response }
  if (!body || typeof body !== 'object' || typeof body.error !== 'string') return response
  if (BILLING_CODES.includes(body.code)) return response
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

/**
 * Routes anyone can call (the middleware lets the same ones through): images and renders are linked from posts,
 * exports and the server-side renderer. Everything else needs an account. Rendering from outside Batkle goes
 * through the developer API (POST /api/v1/posts), which takes an API key and credits.
 */
function isPublicRoute(route, method) {
  return method === 'GET' && (route === '/' || /^\/(uploads|rendered)\/[^/]+$/.test(route))
}

const notFound = message => Object.assign(new Error(message), { status: 404 })

/**
 * Every brand a request names (as flowId, brand_id or brandContext.id, in the query or the JSON body) must be the
 * caller's own; another account's brand reads as missing.
 */
async function requireNamedBrands(db, userId, request) {
  const ids = new Set()
  const add = value => { if (typeof value === 'string' && value) ids.add(value.replace(/^brand_/, '')) }
  const query = new URL(request.url).searchParams
  add(query.get('brand_id'))
  add(query.get('flowId'))
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const text = await request.clone().text().catch(() => '')
    let body = null
    try { body = text ? JSON.parse(text) : null } catch {}
    if (body && typeof body === 'object') {
      add(body.flowId)
      add(body.brand_id)
      add(body.brandContext?.id)
    }
  }
  await requireOwnBrands(db, userId, [...ids])
}

/** A post the caller may open. Design Library editor canvases stay with the library admin, as before. */
async function requireCanvas(db, userId, request, id) {
  const canvas = await db.collection('canvases').findOne({ id }, { projection: { _id: 0, ownerId: 1, globalDesignEditor: 1 } })
  if (canvas?.globalDesignEditor) requireDesignAdmin(request)
  else if (canvas && canvas.ownerId !== userId) throw notFound('Not found')
}

/** A render of one of the caller's posts. */
async function requireRender(db, userId, id) {
  const render = await db.collection('renders').findOne({ id }, { projection: { _id: 0, canvasId: 1 } })
  if (!render) return
  const owned = await db.collection('canvases').countDocuments({ id: render.canvasId, ownerId: userId }, { limit: 1 })
  if (!owned) throw notFound('Not found')
}

/** A gallery image from one of the caller's brands. */
async function requireAsset(db, userId, id) {
  const asset = await db.collection('assets').findOne({ id }, { projection: { _id: 0, brand_id: 1 } })
  if (asset?.brand_id) await requireOwnBrands(db, userId, [String(asset.brand_id).replace(/^brand_/, '')])
}

async function routeRequest(request, { params }) {
  const { path = [] } = params
  const route = `/${path.join('/')}`
  const method = request.method

  try {
    const db = await connectToMongo()

    // A signed-in account for every private route, and the brands a request names must be its own.
    const userId = isPublicRoute(route, method) ? null : await requireUserId()
    if (userId) await requireNamedBrands(db, userId, request)

    if (route === '/account/onboarding' && method === 'POST') return await handleCompleteOnboarding(db, userId, await request.json())
    if (route === '/account/onboarding/draft' && method === 'POST') return await handleSaveOnboardingDraft(db, userId, await request.json())
    if (route === '/account/onboarding/draft' && method === 'DELETE') return await handleClearOnboardingDraft(db, userId)

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
      return await handleExtractBusinessInfo(await request.json(), db, request, userId)
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
      return await handlePlanPost(db, await request.json(), userId)
    }

    // Asset planner endpoint
    if (route === '/plan-assets' && method === 'POST') {
      return await handlePlanAssets(db, await request.json())
    }

    // Asset resolver endpoint
    if (route === '/resolve-assets' && method === 'POST') {
      return await handleResolveAssets(db, await request.json(), userId)
    }

    // Canvas designer endpoint
    if (route === '/design-canvas' && method === 'POST') {
      return await handleDesignCanvas(db, await request.json(), true, userId)
    }

    // Photos attached to a post idea: read on upload, used once by that post
    if (route === '/post-images' && method === 'POST') return await handleUploadPostImage(db, await request.json(), userId)
    const postImageMatch = route.match(/^\/post-images\/([^/]+)$/)
    if (postImageMatch && method === 'DELETE') return await handleDeletePostImage(db, postImageMatch[1], new URL(request.url).searchParams.get('brand_id'))

    // Asset routes
    if (route === '/assets' && method === 'POST') return await handleUploadAsset(db, await request.json(), request, userId)
    if (route === '/assets' && method === 'GET') {
      const brand_id = new URL(request.url).searchParams.get('brand_id') || ''
      return await handleListAssets(db, brand_id)
    }
    const assetMatch = route.match(/^\/assets\/([^/]+)$/)
    if (assetMatch) {
      await requireAsset(db, userId, assetMatch[1])
      if (method === 'GET') return await handleGetAsset(db, assetMatch[1])
      if (method === 'DELETE') return await handleDeleteAsset(db, assetMatch[1])
      if (method === 'PATCH') return await handleUpdateAsset(db, assetMatch[1], await request.json())
    }

    const designMatch = route.match(/^\/canvases\/([^/]+)\/design$/)
    if (designMatch && method === 'POST') {
      await requireCanvas(db, userId, request, designMatch[1])
      return await handleSwitchDesign(db, designMatch[1], await request.json())
    }

    // Canvas routes
    if (route === '/canvases' && method === 'GET') return await handleGetCanvases(db, userId)
    if (route === '/canvases' && method === 'POST') return await handleCreateCanvas(db, await request.json(), userId)
    const dupMatch = route.match(/^\/canvases\/([^/]+)\/duplicate$/)
    if (dupMatch && method === 'POST') {
      await requireCanvas(db, userId, request, dupMatch[1])
      return await handleDuplicateCanvas(db, dupMatch[1], userId)
    }
    const canvasMatch = route.match(/^\/canvases\/([^/]+)$/)
    if (canvasMatch) {
      await requireCanvas(db, userId, request, canvasMatch[1])
      if (method === 'GET') return await handleGetCanvas(db, canvasMatch[1])
      if (method === 'PUT') return await handleUpdateCanvas(db, canvasMatch[1], await request.json())
      if (method === 'DELETE') return await handleDeleteCanvas(db, canvasMatch[1])
    }

    // Upload routes
    // A presigned PUT so the browser sends the image straight to storage; then one of the upload routes takes { upload }.
    if (route === '/uploads/sign' && method === 'POST') return await handleSignUpload(db, await request.json(), userId)
    if (route === '/uploads' && method === 'POST') return await handleUploadImage(db, await request.json(), request, userId)
    const uploadMatch = route.match(/^\/uploads\/([^/]+)$/)
    if (uploadMatch && method === 'GET') return await handleGetUpload(db, uploadMatch[1], request)

    // Render routes
    // The editor's export and test renders: the post must be the caller's own.
    if (route === '/render' && method === 'POST') {
      const body = await request.json()
      const canvasId = body.canva_id || body.canvas_id || body.canvaId
      if (typeof canvasId === 'string' && canvasId) await requireCanvas(db, userId, request, canvasId)
      return await handleRender(db, body, request)
    }
    const renderedMatch = route.match(/^\/rendered\/([^/]+?)(?:\.(png|zip))?$/)
    if (renderedMatch && method === 'GET') return await handleGetRendered(db, renderedMatch[1])
    if (route === '/renders' && method === 'GET') return await handleGetRenders(db, userId)
    const renderApproveMatch = route.match(/^\/renders\/([^/]+)\/approve$/)
    if (renderApproveMatch && method === 'POST') {
      await requireRender(db, userId, renderApproveMatch[1])
      return await handleApproveRender(db, renderApproveMatch[1])
    }
    const renderDeleteMatch = route.match(/^\/renders\/([^/]+)$/)
    if (renderDeleteMatch && method === 'DELETE') {
      await requireRender(db, userId, renderDeleteMatch[1])
      return await handleDeleteRender(db, renderDeleteMatch[1])
    }

    // Gallery routes
    if (route === '/galleries' && method === 'GET') return await handleGetGalleries(db, userId)
    if (route === '/galleries' && method === 'POST') return await handleCreateGallery(db, await request.json(), userId)
    const galleryMatch = route.match(/^\/galleries\/([^/]+)$/)
    if (galleryMatch) {
      if (method === 'GET') return await handleGetGallery(db, galleryMatch[1], userId)
      if (method === 'PUT') return await handleUpdateGallery(db, galleryMatch[1], await request.json(), userId)
      if (method === 'DELETE') return await handleDeleteGallery(db, galleryMatch[1], userId)
    }

    // Flow routes
    if (route === '/flows' && method === 'GET') return await handleGetFlows(db, userId)
    if (route === '/flows' && method === 'POST') return await handleCreateFlow(db, await request.json(), userId)
    const flowMatch = route.match(/^\/flows\/([^/]+)$/)
    if (flowMatch) {
      if (method === 'GET') return await handleGetFlow(db, flowMatch[1], userId)
      if (method === 'PUT') return await handleUpdateFlow(db, flowMatch[1], await request.json(), userId)
      if (method === 'DELETE') return await handleDeleteFlow(db, flowMatch[1], userId)
    }
    const flowOpenedMatch = route.match(/^\/flows\/([^/]+)\/opened$/)
    if (flowOpenedMatch && method === 'POST') return await handleFlowOpened(db, flowOpenedMatch[1], userId)

    return corsify(NextResponse.json({ error: `Route ${route} not found` }, { status: 404 }))
  } catch (error) {
    const billing = billingErrorBody(error)
    if (billing) return corsify(NextResponse.json(billing, { status: error.status }))
    console.error('API Error:', error)
    return corsify(NextResponse.json({ error: error?.message || 'Internal server error' }, { status: error?.status || 500 }))
  }
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
