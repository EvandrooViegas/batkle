import { handleGlobalDesignRequest } from '@/lib/handlers/globalDesignHandler'
import { isDesignAdmin, requireDesignAdmin } from '@/lib/designs/global/admin'
import { loadViewer } from '@/lib/designs/global/viewer'
import { recordSignupAttribution } from '@/lib/analytics/visits'
import { publicMessage } from '@/lib/services/publicError'
import { handleBrandDesigns, handleDeleteBrandDesign } from '@/lib/handlers/brandDesignHandler'
import { handleBrandPosts } from '@/lib/handlers/brandPostsHandler'
import { handlePostFeedback } from '@/lib/handlers/postFeedbackHandler'
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
import { handleListAssets, handleGetAsset, handleDeleteAsset, handleUpdateAsset } from '@/lib/handlers/assetHandlers'
import { handlePlanAssets } from '@/lib/handlers/assetPlannerHandler'
import { handlePlanPost } from '@/lib/handlers/postPlanHandler'
import { handleResolveAssets } from '@/lib/handlers/assetResolverHandler'
import { handleDesignCanvas, handleSwitchDesign } from '@/lib/handlers/canvasDesignerHandler'
import { handleUploadPostImage, handleDeletePostImage } from '@/lib/handlers/postImageHandler'
import { handleClearOnboardingDraft, handleCompleteOnboarding, handleSaveOnboardingDraft, handleUpdateName } from '@/lib/handlers/accountHandlers'
import { requireUserId } from '@/lib/auth'
import { BILLING_CODES, billingErrorBody, isAdminUser, requirePhotoRoom } from '@/lib/billing/account'
import { forgetBrand, memberOpened, requireBrandAccess, sharedLimitAnswer } from '@/lib/teams'
import { canvasBrand } from '@/lib/designs/canvasBrand'
import { AI_LIMIT_MESSAGE, overAiLimit, overLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Making a post runs model calls that can take minutes; without this the host's default time limit could cut it off.
export const maxDuration = 300

/** The routes that ask the AI and take no credits up front (plan-post refunds a plan that fails): counted per account. */
const AI_ROUTES = ['/generate-content-ideas', '/generate-copywriting', '/plan-post', '/plan-assets', '/extract-business-info', '/brand-posts']
// Researching a website reads many pages and makes several model calls.
const RESEARCH_PER_HOUR = 10

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
  if (BILLING_CODES.includes(body.code) || body.code === 'rate_limited') return response
  const { raw: _raw, ...rest } = body
  const error = publicMessage(body.error, response.status)
  if (error === body.error && !('raw' in body)) return response
  if (error !== body.error) console.warn(`[api] ${request.method} /${path.join('/')} ${response.status}: "${body.error}" shown as "${error}"`)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new NextResponse(JSON.stringify({ ...rest, error }), { status: response.status, headers })
}

// A plan limit met while working in a brand shared with the caller (`acting`, set by routeRequest) is the brand
// owner's: the answer says so and who to ask, whether the handler threw it or answered it.
async function handleRoute(request, context) {
  const acting = {}
  const response = await sharedLimitAnswer(acting.db, await routeRequest(request, context, acting), acting.ownerId)
  return publicErrors(request, (await context.params)?.path || [], response)
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

/** The brands a request names (as flowId, brand_id or brandContext.id, in the query or the JSON body), and its body. */
async function namedBrands(request) {
  const ids = new Set()
  const add = value => { if (typeof value === 'string' && value) ids.add(value.replace(/^brand_/, '')) }
  const query = new URL(request.url).searchParams
  add(query.get('brand_id'))
  add(query.get('flowId'))
  let body = null
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const text = await request.clone().text().catch(() => '')
    try { body = text ? JSON.parse(text) : null } catch {}
    if (body && typeof body === 'object') {
      add(body.flowId)
      add(body.brand_id)
      add(body.brandContext?.id)
    }
  }
  return { ids: [...ids], body }
}

// Requests that only read, though they are POSTs: the English copy of a profile is derived, a render is an export.
const READ_ROUTES = ['/translate-business-profile', '/render']
// The brand's profile, its own posts and its designs: the owner and admins only.
const PROFILE_ROUTES = ['/extract-business-info', '/brand-posts', '/brand-designs']

/**
 * The least role a request needs in the brands it names (lib/teams.ts): any role to look, an editor to make and
 * change posts, ads and images, an admin for the brand profile and designs, and the owner to delete the brand.
 * Saving a brand changes only its posts' state (`creationState`) for an editor; anything else in it is the profile.
 */
function neededRole(route, method, body) {
  if (method === 'GET' || method === 'HEAD' || READ_ROUTES.includes(route) || /^\/flows\/[^/]+\/opened$/.test(route)) return 'viewer'
  if (/^\/flows\/[^/]+$/.test(route)) {
    if (method === 'DELETE') return 'owner'
    return Object.keys(body || {}).every(key => key === 'creationState') ? 'editor' : 'admin'
  }
  if (PROFILE_ROUTES.includes(route) || route.startsWith('/global-designs')) return 'admin'
  return 'editor'
}

/**
 * A post the caller may open, or change with `need`: their own, or one in a brand shared with them. Answers whose
 * post it is. Design Library editor canvases stay with the library admin, as before.
 */
async function requireCanvas(db, userId, request, id, need = 'viewer') {
  const canvas = await db.collection('canvases').findOne({ id }, { projection: { _id: 0, id: 1, ownerId: 1, globalDesignEditor: 1, flowId: 1, 'designInput.brandContext.id': 1, 'brandContext.id': 1 } })
  if (canvas?.globalDesignEditor) { if (!(await isAdminUser(db, userId))) requireDesignAdmin(request); return userId }
  if (!canvas || canvas.ownerId === userId) return userId
  // A post in a brand shared with the caller: their role there decides, and too low a role says so.
  const brand = await canvasBrand(db, canvas)
  const owner = brand?.id ? await requireBrandAccess(db, userId, [brand.id], need) : null
  if (!owner || owner !== canvas.ownerId) throw notFound('Not found')
  return owner
}

/** A render of a post the caller may change. */
async function requireRender(db, userId, request, id) {
  const render = await db.collection('renders').findOne({ id }, { projection: { _id: 0, canvasId: 1 } })
  if (!render) return
  if (!(await db.collection('canvases').countDocuments({ id: render.canvasId }, { limit: 1 }))) throw notFound('Not found')
  await requireCanvas(db, userId, request, render.canvasId, 'editor')
}

/** A gallery image from a brand the caller may see, or change with `need`. */
async function requireAsset(db, userId, id, need) {
  const asset = await db.collection('assets').findOne({ id }, { projection: { _id: 0, brand_id: 1 } })
  if (asset?.brand_id) await requireBrandAccess(db, userId, [String(asset.brand_id).replace(/^brand_/, '')], need)
}

async function routeRequest(request, { params }, acting = {}) {
  const { path = [] } = (await params) || {}
  const route = `/${path.join('/')}`
  const method = request.method

  try {
    const db = await connectToMongo()

    // A signed-in account for every private route, with a part in the brands a request names that is enough for it.
    // Work in a brand shared with the account belongs to the brand's owner: `owner` is whose posts, uploads and credits
    // the handlers use (the account itself in its own brands, and when no brand is named).
    const userId = isPublicRoute(route, method) ? null : await requireUserId()
    let owner = userId
    if (userId) {
      const named = await namedBrands(request)
      owner = (await requireBrandAccess(db, userId, named.ids, neededRole(route, method, named.body))) || userId
      if (owner !== userId) Object.assign(acting, { db, ownerId: owner })
      if (method === 'POST' && AI_ROUTES.includes(route)) {
        const research = route === '/extract-business-info' && await overLimit(db, `research:${userId}`, RESEARCH_PER_HOUR, 60 * 60 * 1000)
        if (research || await overAiLimit(db, userId)) return corsify(NextResponse.json({ error: AI_LIMIT_MESSAGE, code: 'rate_limited' }, { status: 429 }))
      }
    }

    if (route === '/account/onboarding' && method === 'POST') {
      // Where the account came from (the attribution cookie), saved once for the admin dashboard; never blocks onboarding.
      await recordSignupAttribution(db, userId, request.headers.get('cookie')).catch(error => console.warn('[analytics] attribution not saved:', error?.message))
      return await handleCompleteOnboarding(db, userId, await request.json())
    }
    if (route === '/account/onboarding/draft' && method === 'POST') return await handleSaveOnboardingDraft(db, userId, await request.json())
    if (route === '/account/onboarding/draft' && method === 'DELETE') return await handleClearOnboardingDraft(db, userId)
    // Settings → Your name
    if (route === '/account/name' && method === 'POST') return await handleUpdateName(db, userId, await request.json())

    if (path[0] === 'global-designs') return await handleGlobalDesignRequest(db, request, path.slice(1), userId)

    if (route === '/brand-designs' && method === 'POST') return await handleBrandDesigns(db, await request.json(), await loadViewer(db, owner, isDesignAdmin(request)))

    if (route === '/brand-designs' && method === 'DELETE') return await handleDeleteBrandDesign(db, await request.json())

    // The brand's own posts, read into the voice new posts are written in (Brand profile → Your posts)
    if (route === '/brand-posts' && method === 'POST') return await handleBrandPosts(db, await request.json(), owner)
    // A like or dislike on a post Batkle made, which shapes the next ones (Posts & stories)
    if (route === '/post-feedback' && method === 'POST') return await handlePostFeedback(db, await request.json())

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
      return await handleExtractBusinessInfo(await request.json(), db, request, owner)
    }

    // Content ideas generation endpoint
    if (route === '/generate-content-ideas' && method === 'POST') {
      const body = await request.json()
      // The photos attached to the idea: as many as the plan of whoever's credits pay for the post.
      if (Array.isArray(body.images)) await requirePhotoRoom(db, owner, body.images.length)
      return await handleGenerateContentIdeas(body, db)
    }

    // Copywriting generation endpoint
    if (route === '/generate-copywriting' && method === 'POST') {
      return await handleGenerateCopywriting(await request.json(), db)
    }

    // Post planning: copy + composition plan in one model call, asset needs derived in code
    if (route === '/plan-post' && method === 'POST') {
      return await handlePlanPost(db, await request.json(), owner)
    }

    // Asset planner endpoint
    if (route === '/plan-assets' && method === 'POST') {
      return await handlePlanAssets(db, await request.json())
    }

    // Asset resolver endpoint
    if (route === '/resolve-assets' && method === 'POST') {
      return await handleResolveAssets(db, await request.json(), owner)
    }

    // Canvas designer endpoint
    if (route === '/design-canvas' && method === 'POST') {
      return await handleDesignCanvas(db, await request.json(), true, owner)
    }

    // Photos attached to a post idea: read on upload, used once by that post
    if (route === '/post-images' && method === 'POST') return await handleUploadPostImage(db, await request.json(), owner)
    const postImageMatch = route.match(/^\/post-images\/([^/]+)$/)
    if (postImageMatch && method === 'DELETE') return await handleDeletePostImage(db, postImageMatch[1], new URL(request.url).searchParams.get('brand_id'))

    // The brand gallery: its saved AI cutouts, to list, describe and delete (nothing is uploaded there)
    if (route === '/assets' && method === 'GET') {
      const brand_id = new URL(request.url).searchParams.get('brand_id') || ''
      return await handleListAssets(db, brand_id)
    }
    const assetMatch = route.match(/^\/assets\/([^/]+)$/)
    if (assetMatch) {
      await requireAsset(db, userId, assetMatch[1], method === 'GET' ? 'viewer' : 'editor')
      if (method === 'GET') return await handleGetAsset(db, assetMatch[1])
      if (method === 'DELETE') return await handleDeleteAsset(db, assetMatch[1])
      if (method === 'PATCH') return await handleUpdateAsset(db, assetMatch[1], await request.json())
    }

    const designMatch = route.match(/^\/canvases\/([^/]+)\/design$/)
    if (designMatch && method === 'POST') {
      await requireCanvas(db, userId, request, designMatch[1], 'editor')
      return await handleSwitchDesign(db, designMatch[1], await request.json())
    }

    // Canvas routes
    if (route === '/canvases' && method === 'GET') return await handleGetCanvases(db, userId)
    if (route === '/canvases' && method === 'POST') return await handleCreateCanvas(db, await request.json(), owner)
    const dupMatch = route.match(/^\/canvases\/([^/]+)\/duplicate$/)
    if (dupMatch && method === 'POST') {
      // The copy belongs with the original: in a shared brand, to the brand's owner.
      return await handleDuplicateCanvas(db, dupMatch[1], await requireCanvas(db, userId, request, dupMatch[1], 'editor'))
    }
    const canvasMatch = route.match(/^\/canvases\/([^/]+)$/)
    if (canvasMatch) {
      await requireCanvas(db, userId, request, canvasMatch[1], method === 'GET' ? 'viewer' : 'editor')
      if (method === 'GET') return await handleGetCanvas(db, canvasMatch[1])
      if (method === 'PUT') return await handleUpdateCanvas(db, canvasMatch[1], await request.json())
      if (method === 'DELETE') return await handleDeleteCanvas(db, canvasMatch[1])
    }

    // Upload routes
    // A presigned PUT so the browser sends the image straight to storage; then one of the upload routes takes { upload }.
    if (route === '/uploads/sign' && method === 'POST') return await handleSignUpload(db, await request.json(), owner)
    if (route === '/uploads' && method === 'POST') return await handleUploadImage(db, await request.json(), request, owner)
    const uploadMatch = route.match(/^\/uploads\/([^/]+)$/)
    if (uploadMatch && method === 'GET') return await handleGetUpload(db, uploadMatch[1], request)

    // Render routes
    // The editor's export and test renders: a post the caller may open.
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
      await requireRender(db, userId, request, renderApproveMatch[1])
      return await handleApproveRender(db, renderApproveMatch[1])
    }
    const renderDeleteMatch = route.match(/^\/renders\/([^/]+)$/)
    if (renderDeleteMatch && method === 'DELETE') {
      await requireRender(db, userId, request, renderDeleteMatch[1])
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
    // A brand by its ID: the caller's own, or one shared with them with a role enough for the request (neededRole).
    const flowMatch = route.match(/^\/flows\/([^/]+)$/)
    if (flowMatch) {
      const body = method === 'PUT' ? await request.json() : null
      const brandOwner = (await requireBrandAccess(db, userId, [flowMatch[1]], neededRole(route, method, body))) || userId
      if (method === 'GET') return await handleGetFlow(db, flowMatch[1], brandOwner)
      if (method === 'PUT') return await handleUpdateFlow(db, flowMatch[1], body, brandOwner)
      if (method === 'DELETE') {
        const response = await handleDeleteFlow(db, flowMatch[1], userId)
        if (response.status < 400) await forgetBrand(db, flowMatch[1])
        return response
      }
    }
    const flowOpenedMatch = route.match(/^\/flows\/([^/]+)\/opened$/)
    if (flowOpenedMatch && method === 'POST') {
      // A member's visits are kept on their membership, so they never reorder the owner's brand list.
      const brandOwner = await requireBrandAccess(db, userId, [flowOpenedMatch[1]], 'viewer')
      if (brandOwner && brandOwner !== userId) return corsify(NextResponse.json({ success: await memberOpened(db, userId, flowOpenedMatch[1]) }))
      return await handleFlowOpened(db, flowOpenedMatch[1], userId)
    }

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
