'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Image as ImageIcon, Loader2, Play, Type } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { appButton } from '@/components/app/ui'
import { dynamicKeys, isCarousel, orderedPages, renderPayload, slideFileName } from '@/lib/client/editorDocument'
import { cn } from '@/lib/utils'
import { plainTextFromStyled } from './kit'
import { Section, fieldClass } from './controls'

const codeClass = 'max-h-64 overflow-auto rounded-lg bg-bk-ink p-3 font-mono text-[11.5px] leading-relaxed text-bk-cream'

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

/** Developer tools: name layers, see the request body, and test a render with your own data. */
export function ApiPanel({ canvas, doc, setDynamicKey, onOpenSlide, save }) {
  const [testing, setTesting] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const payload = renderPayload(doc)
  const json = JSON.stringify(payload, null, 2)
  const curl = `curl -X POST ${origin}/api/render \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(payload)}'`
  const carousel = isCarousel(doc)
  const pages = carousel ? orderedPages(doc.pages) : []
  const keys = carousel ? dynamicKeys(doc) : []
  const layers = (canvas.nodes || []).filter(n => n.type === 'text' || n.type === 'image').slice().reverse()

  return (
    <>
      <Section>
        <p className="text-[12.5px] leading-relaxed text-bk-fg/80">
          Render this {carousel ? 'carousel' : 'post'} from your own code. Give a layer an API key, then send new text or an image URL for it.
        </p>
        <button type="button" onClick={() => setTesting(true)} className={appButton('ink', 'sm', 'w-full')}><Play className="size-3.5" />Test a render</button>
      </Section>

      <Section title={carousel ? 'API keys on this slide' : 'API keys'}>
        {layers.length === 0 ? <p className="text-[12.5px] text-bk-muted">No text or image layers yet.</p> : (
          <ul className="space-y-2">
            {layers.map(n => (
              <li key={n.id}>
                <label className="mb-1 flex min-w-0 items-center gap-1.5 text-[12px] text-bk-muted">
                  {n.type === 'text' ? <Type className="size-3.5 shrink-0" /> : <ImageIcon className="size-3.5 shrink-0" />}
                  <span className="truncate">{n.type === 'text' ? (plainTextFromStyled(n.text || '').trim() || 'Empty text') : 'Image'}</span>
                </label>
                <input
                  key={n.id + (n.dynamic_key || '')}
                  aria-label="API key"
                  placeholder="No key"
                  defaultValue={n.dynamic_key || ''}
                  onBlur={e => setDynamicKey(n.id, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  className={cn(fieldClass, 'font-mono text-[12px]')}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {carousel && keys.length > 0 && (
        <Section title="Keys in this carousel">
          <ul className="space-y-1.5">
            {keys.map(k => (
              <li key={k.key} className="flex flex-wrap items-center gap-1.5 text-[12px]">
                <code className="rounded bg-bk-chip px-1.5 py-0.5 font-mono">{k.key}</code>
                {k.slides.map(i => (
                  <button key={i} type="button" onClick={() => onOpenSlide(i)} className="rounded px-1 text-bk-muted underline-offset-2 hover:text-bk-fg hover:underline">slide {i + 1}</button>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Request" action={<div className="flex"><CopyButton text={json} label="JSON" /><CopyButton text={curl} label="cURL" /></div>}>
        <p className="font-mono text-[12px]"><span className="font-bold">POST</span> /api/render</p>
        <pre className={codeClass}>{json}</pre>
        {carousel && <p className="text-[11.5px] leading-snug text-bk-muted">Keys end in _top on the first slide, _1, _2… on the middle slides and _bottom on the last.</p>}
      </Section>

      <Section title="Response">
        <p className="text-[12.5px] text-bk-fg/80">{carousel ? 'A link to a ZIP with one PNG per slide:' : 'A link to the finished PNG.'}</p>
        {carousel && (
          <ul className="space-y-1">
            {pages.map((p, i) => (
              <li key={p.id} className={cn('truncate rounded px-1.5 py-0.5 font-mono text-[11.5px]', p.id === canvas._pageId ? 'bg-bk-chip text-bk-fg' : 'text-bk-muted')}>{slideFileName(p, i, pages.length)}</li>
            ))}
          </ul>
        )}
      </Section>

      <RenderDialog open={testing} onOpenChange={setTesting} payload={json} carousel={carousel} save={save} />
    </>
  )
}

function RenderDialog({ open, onOpenChange, payload, carousel, save }) {
  const [body, setBody] = useState(payload)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { if (open) { setBody(payload); setResult(null); setError('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setBusy(true); setError(''); setResult(null)
    try {
      const parsed = JSON.parse(body)
      if (!(await save())) throw new Error('Save your changes before rendering')
      const res = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || 'The render failed')
      setResult(new URL(data.url, window.location.origin).pathname)
    } catch (e) {
      setError(e instanceof SyntaxError ? 'The request body is not valid JSON' : e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[880px]">
        <DialogHeader>
          <DialogTitle className="font-bk-display text-[20px] font-bold tracking-[-0.03em]">Test a render</DialogTitle>
          <DialogDescription className="text-[13.5px] text-bk-muted">Edit the values and render. Your changes are saved first.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <textarea aria-label="Request body" value={body} onChange={e => setBody(e.target.value)} spellCheck={false} rows={14} className={cn(fieldClass, 'h-auto flex-1 resize-y py-2 font-mono text-[12px] leading-relaxed')} />
            <button type="button" onClick={run} disabled={busy} className={appButton('primary', 'md')}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}{busy ? 'Rendering…' : 'Render'}
            </button>
          </div>
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl bg-bk-alt p-4 text-center">
            {error ? <p role="alert" className="text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>
              : result ? (carousel
                ? <><p className="text-[13.5px]">Your slides are ready.</p><a href={result} download className={appButton('ink', 'md')}>Download ZIP</a></>
                : <><img src={result} alt="Rendered post" className="max-h-[360px] max-w-full rounded-lg shadow-bk-card" /><a href={result} download="render.png" className="text-[12.5px] font-semibold underline underline-offset-4">Download PNG</a></>)
                : <p className="text-[13px] text-bk-muted">The result appears here.</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
