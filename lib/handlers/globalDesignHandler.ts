import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { ADMIN_COOKIE, adminConfigured, validAdminKey, adminSession, isDesignAdmin, requireDesignAdmin } from '@/lib/designs/global/admin'
import { listGlobalDesigns, getGlobalRecord, saveGlobalDraft, publishGlobalDesign, retireGlobalDesign, hydrateBrandFamilies, DesignLibraryError } from '@/lib/designs/global/store'
import { analyzeDesignReferences } from '@/lib/designs/global/analyze'
import { retrySeconds } from '@/lib/services/ai/requestBudget'
import { compactImage } from '@/lib/services/imageStorage'
import { saveUpload } from '@/lib/services/uploadStore'

export async function handleGlobalDesignRequest(db: any, request: Request, path: string[]) {
  try {
    const url = new URL(request.url), method = request.method
    const [id, action] = path
    if (id === 'session') {
      if (method === 'GET') return NextResponse.json({ admin: isDesignAdmin(request), configured: adminConfigured() })
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
    if (!id && method === 'GET') {
      const admin = url.searchParams.get('admin') === '1'
      if (admin) requireDesignAdmin(request)
      return NextResponse.json(await listGlobalDesigns(db, admin))
    }
    if (id === 'brand' && method === 'GET') {
      const flow = await db.collection('flows').findOne({ id: url.searchParams.get('flowId') })
      if (!flow) throw new DesignLibraryError('Brand not found', 404)
      return NextResponse.json(await hydrateBrandFamilies(db, { ...flow.brandContext, id: flow.id }))
    }
    requireDesignAdmin(request)
    if (id === 'references' && method === 'POST') {
      const body = await request.json()
      const match = typeof body.data === 'string' && body.data.match(/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=\r\n]+)$/)
      if (!match) throw new DesignLibraryError('Upload a PNG, JPEG or WebP reference.')
      const bytes = Buffer.from(match[2], 'base64')
      if (bytes.length > 6 * 1024 * 1024) throw new DesignLibraryError('Each reference must be under 6 MB.', 413)
      const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata()
      if (!meta.width || !meta.height) throw new DesignLibraryError('Invalid reference image.')
      const id = randomUUID()
      const stored = await compactImage(bytes, `image/${match[1]}`)
      await saveUpload(db, { id, bytes: stored.bytes, contentType: stored.contentType, purpose: 'design-reference' })
      return NextResponse.json({ id, url: `/api/uploads/${id}`, name: String(body.name || 'Reference').slice(0, 200), width: meta.width, height: meta.height })
    }
    if (id === 'analyze' && method === 'POST') return NextResponse.json(await analyzeDesignReferences(db, await request.json()))
    if (!id && method === 'POST') return NextResponse.json(await saveGlobalDraft(db, await request.json()))
    if (id && !action && method === 'GET') return NextResponse.json(await getGlobalRecord(db, id))
    if (id && method === 'PATCH') {
      const body = await request.json()
      if (body.family?.id !== id) throw new DesignLibraryError('Family ID cannot change.')
      return NextResponse.json(await saveGlobalDraft(db, body.family, body.revision))
    }
    if (id && (action === 'publish' || action === 'unpublish' || method === 'DELETE')) {
      if (method !== 'POST' && method !== 'DELETE') throw new DesignLibraryError('Method not allowed', 405)
      const { revision } = await request.json()
      return NextResponse.json(action === 'publish' ? await publishGlobalDesign(db, id, revision) : await retireGlobalDesign(db, id, revision, method === 'DELETE'))
    }
    throw new DesignLibraryError('Design action not found', 404)
  } catch (error: any) {
    return NextResponse.json({ error: error.issues ? error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).slice(0, 5).join('; ') : error.message || 'Design operation failed' }, { status: error.status || (error.issues ? 400 : 500), ...(error.status === 429 ? { headers: { 'Retry-After': String(retrySeconds(error)) } } : {}) })
  }
}
