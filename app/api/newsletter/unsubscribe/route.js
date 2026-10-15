import { connectToMongo } from '@/lib/services/db/mongo'
import { unsubscribeFromNewsletter } from '@/lib/billing/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const page = (heading, text, status) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${heading} · Batkle</title></head>
<body style="margin:0;background:#f4f1ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#141210">
<main style="max-width:480px;margin:64px auto;padding:32px 24px;background:#fff;border-radius:16px">
<p style="margin:0 0 16px;font-weight:700">Batkle</p><h1 style="margin:0 0 12px;font-size:24px;letter-spacing:-0.02em">${heading}</h1>
<p style="margin:0 0 20px;line-height:1.55;color:#3d3a36">${text}</p><a href="/" style="color:#141210;font-weight:700">Go to Batkle</a></main></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
)

/**
 * The unsubscribe link in newsletter emails (public: the token is the subscriber's own random one). GET opens it from
 * the email; POST is the one-click unsubscribe mail apps send.
 */
async function handle(request) {
  const token = new URL(request.url).searchParams.get('token')
  try {
    const done = await unsubscribeFromNewsletter(await connectToMongo(), token)
    return done
      ? page('You’re unsubscribed', 'You won’t get Batkle’s newsletter emails any more. Reminders for your posts are separate: change those in Settings.', 200)
      : page('Link not recognised', 'This unsubscribe link isn’t valid. If you keep getting emails you don’t want, reply to one of them and we’ll remove you.', 404)
  } catch (error) {
    console.error('[newsletter] unsubscribe failed:', error)
    return page('Please try again', 'Something went wrong on our side, so you’re not unsubscribed yet. Please open the link again in a minute.', 500)
  }
}

export const GET = handle
export const POST = handle
