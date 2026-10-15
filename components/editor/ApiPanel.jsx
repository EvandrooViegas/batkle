'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { appButton } from '@/components/app/ui'
import { toApiDocument } from '@/lib/developer/document'
import { Section } from './controls'

const codeClass = 'max-h-80 overflow-auto rounded-lg bg-bk-ink p-3 font-mono text-[11.5px] leading-relaxed text-bk-cream'

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.error('Could not copy')
        }
      }}
      className={appButton('quiet', 'xs', 'h-7 px-2')}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Copied' : label}
    </button>
  )
}

/**
 * Developer tools: this design as a request to the developer API (POST /api/v1/posts), ready to copy, and a free
 * preview of the image it makes.
 */
export function ApiPanel({ doc, save }) {
  const [testing, setTesting] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const body = useMemo(() => toApiDocument(doc, origin), [doc, origin])
  const json = JSON.stringify(body, null, 2)
  const carousel = Boolean(body.slides)
  const curl = `curl ${origin}/api/v1/posts \\\n  -H "Authorization: Bearer $BATKLE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d @post.json \\\n  --output ${carousel ? 'carousel.zip' : 'post.png'}`
  const nodes = carousel ? body.slides.reduce((n, s) => n + s.nodes.length, 0) : body.nodes.length

  return (
    <>
      <Section>
        <p className="text-[12.5px] leading-relaxed text-bk-fg/80">
          Render this {carousel ? 'carousel' : 'post'} from your own code: copy it as a request, change its texts and image URLs, and send it to the API. Each image costs 1 credit.
        </p>
        <p className="flex flex-wrap gap-x-3 text-[12.5px] font-semibold">
          <a href="/developers#nodes" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-bk-fg/75">How nodes work</a>
          <a href="/developers/dashboard#keys" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-bk-fg/75">Your API keys</a>
        </p>
        <button type="button" onClick={() => setTesting(true)} className={appButton('ink', 'sm', 'w-full')}><Play className="size-3.5" />Preview the image</button>
      </Section>

      <Section title="Request" action={<div className="flex"><CopyButton text={json} label="JSON" /><CopyButton text={curl} label="cURL" /></div>}>
        <p className="font-mono text-[12px]"><span className="font-bold">POST</span> /api/v1/posts</p>
        <p className="text-[11.5px] leading-snug text-bk-muted">
          {carousel ? `${body.slides.length} slides, ` : ''}{nodes} node{nodes === 1 ? '' : 's'}. Save the JSON as post.json for the cURL command.
        </p>
        <pre className={codeClass}>{json}</pre>
      </Section>

      <Section title="Response">
        <p className="text-[12.5px] text-bk-fg/80">{carousel ? 'A ZIP with one PNG per slide, or one slide’s PNG with "slide": n in the body.' : 'The PNG itself.'}</p>
      </Section>

      <PreviewDialog open={testing} onOpenChange={setTesting} id={doc?.id} carousel={carousel} save={save} />
    </>
  )
}

/** Renders the saved design in the app, for free: the image the request above makes. */
function PreviewDialog({ open, onOpenChange, id, carousel, save }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const run = async () => {
    setBusy(true); setError(''); setResult(null)
    try {
      if (!(await save())) throw new Error('Save your changes before rendering')
      const res = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canva_id: id, data: {} }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || 'The render failed')
      setResult(new URL(data.url, window.location.origin).pathname)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => { onOpenChange(value); if (value) run() }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-bk-display text-[20px] font-bold tracking-[-0.03em]">Preview the image</DialogTitle>
          <DialogDescription className="text-[13.5px] text-bk-muted">Your changes are saved first. Previews here are free.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-xl bg-bk-alt p-4 text-center">
          {busy ? <Loader2 className="size-5 animate-spin text-bk-muted" aria-label="Rendering" />
            : error ? <><p role="alert" className="text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p><button type="button" onClick={run} className={appButton('outline', 'sm')}>Try again</button></>
            : result ? (carousel
              ? <><p className="text-[13.5px]">Your slides are ready.</p><a href={result} download className={appButton('ink', 'md')}>Download ZIP</a></>
              : <><img src={result} alt="Rendered post" className="max-h-[420px] max-w-full rounded-lg shadow-bk-card" /><a href={result} download="post.png" className="text-[12.5px] font-semibold underline underline-offset-4">Download PNG</a></>)
            : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
