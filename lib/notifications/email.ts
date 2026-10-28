/**
 * Sending email through Resend (https://resend.com/docs/api-reference/emails/send-email), with no SDK: one HTTPS call.
 * RESEND_API_KEY and EMAIL_FROM ("Batkle <reminders@your-domain.com>", a domain verified in Resend) must be set;
 * without them emailConfigured() is false and sendEmail refuses.
 */

export function emailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim())
}

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  replyTo?: string
  /** The same key within 24 hours sends the email once, so a retried job never emails twice. */
  idempotencyKey?: string
}

export async function sendEmail(message: EmailMessage): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY?.trim(), from = process.env.EMAIL_FROM?.trim()
  if (!key || !from) throw Object.assign(new Error('Email is not set up: RESEND_API_KEY and EMAIL_FROM are required.'), { status: 503 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.to || '')) throw Object.assign(new Error('That email address is not valid.'), { status: 400 })
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey.slice(0, 256) } : {}),
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    }),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(`Resend: HTTP ${res.status}${data?.message ? ` (${data.message})` : ''}`), { status: 502 })
  return { id: String(data?.id || '') }
}

/**
 * Where Resend got with an email (https://resend.com/docs/api-reference/emails/retrieve-email): 'delivered' once the
 * receiving server took it, 'bounced' when the address does not exist or refused it, 'sent' while it is on its way.
 * Null when Resend could not be asked (no key, a sending-only key, a network error).
 */
export async function emailDelivery(id: string): Promise<'sent' | 'delivered' | 'bounced' | null> {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key || !id) return null
  try {
    const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    const event = String((await res.json().catch(() => ({})))?.last_event || '')
    if (['bounced', 'failed', 'suppressed', 'canceled'].includes(event)) return 'bounced'
    if (['delivered', 'opened', 'clicked', 'complained'].includes(event)) return 'delivered'
    return 'sent'
  } catch {
    return null
  }
}

/**
 * False only when DNS says nothing can receive mail at the address's domain: no MX record (or a "null MX") and no
 * A/AAAA record to fall back to. A lookup that fails for any other reason (a timeout, a resolver error) gives true,
 * so a slow DNS never blocks an invitation.
 */
export async function mailDomainExists(address: string): Promise<boolean> {
  const domain = String(address).split('@').pop()?.trim().toLowerCase() || ''
  if (!domain) return false
  const { promises: dns } = await import('node:dns')
  const missing = (error: any) => ['ENOTFOUND', 'ENODATA', 'NXDOMAIN'].includes(error?.code)
  try {
    const mx = await dns.resolveMx(domain)
    if (mx.length) return !(mx.length === 1 && (!mx[0].exchange || mx[0].exchange === '.'))
  } catch (error) {
    if (!missing(error)) return true
  }
  for (const lookup of [() => dns.resolve4(domain), () => dns.resolve6(domain)]) {
    try { if ((await lookup()).length) return true } catch (error) { if (!missing(error)) return true }
  }
  return false
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/**
 * A plain branded email: a heading, paragraphs (already-safe HTML), an optional button and a small footer.
 * Inline styles only, since email clients drop style sheets.
 */
export function emailLayout({ heading, paragraphs, button, image, footer }: {
  heading: string
  paragraphs: string[]
  button?: { label: string; url: string }
  image?: { url: string; alt: string }
  footer?: string
}): string {
  const p = (html: string) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#3d3a36">${html}</p>`
  return `<!doctype html><html><body style="margin:0;background:#f4f1ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td>
<p style="margin:0 0 20px;font-size:15px;font-weight:700;letter-spacing:-0.01em;color:#141210">Batkle</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;letter-spacing:-0.02em;color:#141210">${escapeHtml(heading)}</h1>
${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" width="456" style="display:block;width:100%;max-width:456px;height:auto;border-radius:12px;margin:0 0 18px">` : ''}
${paragraphs.map(p).join('\n')}
${button ? `<p style="margin:22px 0 6px"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#141210;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:10px">${escapeHtml(button.label)}</a></p>` : ''}
</td></tr></table>
${footer ? `<p style="max-width:520px;margin:16px auto 0;font-size:12.5px;line-height:1.5;color:#77716a">${footer}</p>` : ''}
</td></tr></table></body></html>`
}
