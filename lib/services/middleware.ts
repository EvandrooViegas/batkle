import { NextResponse } from 'next/server'

/**
 * The app's API answers Batkle's own pages only, so it sends no CORS headers: another site's scripts cannot read its
 * answers. (The developer API, /api/v1, is meant for other sites and sets its own: lib/developer/api.ts.) Kept so the
 * handlers that wrap their answers in it need no change.
 */
export function corsify(response: NextResponse): NextResponse {
  return response
}

/**
 * Get base URL from environment or request headers
 */
export function getBaseUrl(request: Request): string {
  // Prefer explicit env var if set
  const envBase = process.env.NEXT_PUBLIC_BASE_URL
  if (envBase) {
    let b = envBase.trim()
    if (!b.startsWith('http')) {
      b = b.includes('localhost') ? `http://${b}` : `https://${b}`
    }
    return b
  }

  // Derive from incoming request headers (works on Vercel, Render, etc.)
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

/**
 * Centralized error response handler
 */
export function errorResponse(status: number, message: string): NextResponse {
  return corsify(
    NextResponse.json(
      { error: message },
      { status }
    )
  )
}

/**
 * Not found response
 */
export function notFoundResponse(): NextResponse {
  return errorResponse(404, 'Not found')
}

/**
 * Bad request response
 */
export function badRequestResponse(message: string): NextResponse {
  return errorResponse(400, message)
}

/**
 * Server error response
 */
export function serverErrorResponse(message: string): NextResponse {
  return errorResponse(500, message)
}
