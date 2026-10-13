import { NextResponse } from 'next/server'
import { generateLogoVariants } from '@/lib/services/logoVariants'
import { publicMessage } from '@/lib/services/publicError'
export const runtime = 'nodejs'
export async function POST(request) {
  try {
    const { logo } = await request.json()
    if (typeof logo !== 'string' || !logo) return NextResponse.json({ error: 'Logo URL is required' }, { status: 400 })
    return NextResponse.json(await generateLogoVariants(logo))
  } catch (error) {
    console.warn('[logo-variants]', error)
    return NextResponse.json({ error: publicMessage(error.message || 'Unable to generate logo variants', 422) }, { status: 422 })
  }
}
