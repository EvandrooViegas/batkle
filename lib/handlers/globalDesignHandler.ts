import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { ADMIN_COOKIE, adminConfigured, validAdminKey, adminSession, isDesignAdmin } from '@/lib/designs/global/admin'
import { listGlobalDesigns, listLibrary, listOwnRecords, getGlobalRecord, saveGlobalDraft, publishGlobalDesign, retireGlobalDesign, hydrateBrandFamilies, DesignLibraryError } from '@/lib/designs/global/store'
import { canEdit, type Viewer } from '@/lib/designs/global/access'
import { loadViewer } from '@/lib/designs/global/viewer'
import { analyzeDesignReferences } from '@/lib/designs/global/analyze'
import { billingErrorBody, isAdminUser, requireFeature } from '@/lib/billing/account'
import { retrySeconds } from '@/lib/services/ai/requestBudget'
import { compactImage } from '@/lib/services/imageStorage'
import { saveUpload } from '@/lib/services/uploadStore'

/** A member's design is studied from at most this many references (the admin's from up to 30). */
export const MEMBER_MAX_REFERENCES = 10
/** Studies a member can run per day: each one is several vision-model calls. */
export const MEMBER_DAILY_STUDIES = 5

/** The name shown as a member design's author: the name they gave, else the start of their email. */
async function authorName(db: any, userId: string) {
  const user = await db.collection('users').findOne({ id: userId }, { projection: { _id: 0, name: 1, email: 1 } })
  return user?.name || (user?.email ? String(user.email).split('@')[0] : '') || 'A Batkle member'
}

/** A record this viewer may edit; anything else reads as missing. */
async function editableRecord(db: any, id: string, viewer: Viewer) {
  const record = await getGlobalRecord(db, id)
  if (!canEdit(record, viewer)) throw new DesignLibraryError('Design family not found', 404)
  return record
}

async function requireStudyAllowance(db: any, userId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const used = await db.collection('designStudies').countDocuments({ userId, at: { $gte: since } })
  if (used >= MEMBER_DAILY_STUDIES) throw new DesignLibraryError(`You can study ${MEMBER_DAILY_STUDIES} designs a day. Try again tomorrow, or edit one of your drafts.`, 429)
}

/**
 * /api/global-designs. Everyone signed in browses the library (GET /, with `library` on each design) and their own
 * designs (GET /?mine=1). Creating and publishing takes the admin, or a member whose plan includes custom designs
 * (Pro and Business). Members manage only their own designs; the admin manages all, and publishes Batkle's own.
 */
export async function handleGlobalDesignRequest(db: any, request: Request, path: string[], userId?: string | null) {
  try {
    const url = new URL(request.url), method = request.method
    const [id, action] = path
    if (id === 'session') {
      // An admin account is the library admin without the key; the key session still works on its own.
      if (method === 'GET') return NextResponse.json({ admin: isDesignAdmin(request) || await isAdminUser(db, userId), account: await isAdminUser(db, userId), configured: adminConfigured() })
      if (method === 'DELETE') { const res = NextResponse.json({ success: true }); res.cookies.delete(ADMIN_COOKIE); return res }
      if (method === 'POST') {
        const origin = request.headers.get('origin')
        if (origin && origin !== url.origin) throw new DesignLibraryError('Invalid request origin', 403)
        if (!adminConfigured()) throw new DesignLibraryError('Set GLOBAL_DESIGN_ADMIN_KEY on the server to enable admin sign-in.', 503)
        if (!validAdminKey((await request.json()).key)) throw new DesignLibraryError('Incorrect admin key.', 401)
        const res = NextResponse.json({ admin: true })
        res.cookies.set(ADMIN_COOKIE, adminSession(), { httpOnly: true, sameSite: 'strict', secure: url.protocol === 'https:', path: '/', maxAge: 8 * 60 * 60 })
        return res
      }
    }
    const admin = isDesignAdmin(request) || await isAdminUser(db, userId)
    const viewer = await loadViewer(db, userId, admin)
    if (!id && method === 'GET') {
      if (url.searchParams.get('admin') === '1') { if (!admin) throw new DesignLibraryError('Admin sign-in is required.', 401); return NextResponse.json(await listGlobalDesigns(db, true)) }
      if (url.searchParams.get('mine') === '1') return NextResponse.json(await listOwnRecords(db, viewer))
      return NextResponse.json(await listLibrary(db, viewer))
    }
    if (id === 'brand' && method === 'GET') {
      const flow = await db.collection('flows').findOne({ id: url.searchParams.get('flowId') })
      if (!flow) throw new DesignLibraryError('Brand not found', 404)
      return NextResponse.json(await hydrateBrandFamilies(db, { ...flow.brandContext, id: flow.id }))
    }

    if (!admin && !userId) throw new DesignLibraryError('Sign in to continue.', 401)
    const origin = request.headers.get('origin')
    if (origin && origin !== url.origin) throw new DesignLibraryError('Invalid request origin.', 403)
    // Studying, saving and publishing cost a plan that includes custom designs; unpublishing and deleting never do.
    const member = !admin ? userId! : null
    const requirePlan = async () => { if (member) await requireFeature(db, member, 'customDesigns') }

    if (id === 'references' && method === 'POST') {
      await requirePlan()
      const body = await request.json()
      const match = typeof body.data === 'string' && body.data.match(/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=\r\n]+)$/)
      if (!match) throw new DesignLibraryError('Upload a PNG, JPEG or WebP reference.')
      const bytes = Buffer.from(match[2], 'base64')
      if (bytes.length > 6 * 1024 * 1024) throw new DesignLibraryError('Each reference must be under 6 MB.', 413)
      const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata()
      if (!meta.width || !meta.height) throw new DesignLibraryError('Invalid reference image.')
      const id = randomUUID()
      const stored = await compactImage(bytes, `image/${match[1]}`)
      await saveUpload(db, { id, bytes: stored.bytes, contentType: stored.contentType, purpose: 'design-reference', ...(member ? { ownerId: member } : {}) })
      return NextResponse.json({ id, url: `/api/uploads/${id}`, name: String(body.name || 'Reference').slice(0, 200), width: meta.width, height: meta.height })
    }
    if (id === 'analyze' && method === 'POST') {
      await requirePlan()
      const body = await request.json()
      if (member) {
        if (Array.isArray(body.referenceImages) && body.referenceImages.length > MEMBER_MAX_REFERENCES) throw new DesignLibraryError(`A design can be studied from up to ${MEMBER_MAX_REFERENCES} references.`)
        await requireStudyAllowance(db, member)
        await db.collection('designStudies').insertOne({ userId: member, at: new Date(), references: Array.isArray(body.referenceImages) ? body.referenceImages.length : 0 })
      }
      return NextResponse.json(await analyzeDesignReferences(db, body))
    }
    if (!id && method === 'POST') {
      await requirePlan()
      const owner = member ? { id: member, name: await authorName(db, member) } : undefined
      return NextResponse.json(await saveGlobalDraft(db, await request.json(), undefined, owner))
    }
    if (id && !action && method === 'GET') return NextResponse.json(await editableRecord(db, id, viewer))
    if (id && method === 'PATCH') {
      await requirePlan()
      await editableRecord(db, id, viewer)
      const body = await request.json()
      if (body.family?.id !== id) throw new DesignLibraryError('Family ID cannot change.')
      return NextResponse.json(await saveGlobalDraft(db, body.family, body.revision))
    }
    if (id && (action === 'publish' || action === 'unpublish' || method === 'DELETE')) {
      if (method !== 'POST' && method !== 'DELETE') throw new DesignLibraryError('Method not allowed', 405)
      await editableRecord(db, id, viewer)
      const { revision, visibility } = await request.json()
      if (action === 'publish') { await requirePlan(); return NextResponse.json(await publishGlobalDesign(db, id, revision, visibility)) }
      return NextResponse.json(await retireGlobalDesign(db, id, revision, method === 'DELETE'))
    }
    throw new DesignLibraryError('Design action not found', 404)
  } catch (error: any) {
    // Plan limits keep their code, so the page can offer the upgrade.
    const billing = billingErrorBody(error)
    if (billing) return NextResponse.json(billing, { status: error.status || 402 })
    return NextResponse.json({ error: error.issues ? error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).slice(0, 5).join('; ') : error.message || 'Design operation failed' }, { status: error.status || (error.issues ? 400 : 500), ...(error.status === 429 ? { headers: { 'Retry-After': String(retrySeconds(error)) } } : {}) })
  }
}
