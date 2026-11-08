import { NextResponse } from 'next/server'
import { generateLogoVariants } from '@/lib/services/logoVariants'
import { publicMessage } from '@/lib/services/publicError'
import { requireUserId } from '@/lib/auth'
import { connectToMongo } from '@/lib/services/db/mongo'
import { clientIp, overLimit } from '@/lib/rateLimit'
export const runtime = 'nodejs'

// Each request downloads a logo and processes it several times over: counted per account.
const PER_HOUR = 30

export async function POST(request) {
  try {
    const userId = await requireUserId()
    if (await overLimit(await connectToMongo(), `logo:${userId || clientIp(request)}`, PER_HOUR, 60 * 60 * 1000)) {
      return NextResponse.json({ error: 'You’re going faster than Batkle can keep up with. Please wait a few minutes and try again.' }, { status: 429 })
    }
    const { logo } = await request.json()
    if (typeof logo !== 'string' || !logo) return NextResponse.json({ error: 'Logo URL is required' }, { status: 400 })
    return NextResponse.json(await generateLogoVariants(logo))
  } catch (error) {
    if (error?.status === 401) return NextResponse.json({ error: error.message }, { status: 401 })
    console.warn('[logo-variants]', error)
    return NextResponse.json({ error: publicMessage(error.message || 'Unable to generate logo variants', 422) }, { status: 422 })
  }
}
