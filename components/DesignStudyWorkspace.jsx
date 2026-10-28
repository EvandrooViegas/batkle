'use client'

import { useState } from 'react'
import { ArrowLeft, Globe, Loader2, Lock, RefreshCw, Trash2, ZoomIn } from 'lucide-react'
import DesignStudyEditor from '@/components/DesignStudyEditor'
import GlobalDesignPreview, { SampleLightbox } from '@/components/GlobalDesignPreview'
import { SAMPLE_DECK } from '@/lib/designs/global/compose'
import { familyGrammar } from '@/lib/designs/global/study'
import { SegmentedTabs, appButton, panelClass } from '@/components/app/ui'
import { appField } from '@/components/app/field'
import { cn } from '@/lib/utils'

export const STATUS_TONE = { published: 'bg-[#1F7A5A]/10 text-[#17583F] dark:text-[#4CC79A]', draft: 'bg-bk-chip text-bk-fg', unpublished: 'bg-[#F2A900]/15 text-[#9A6B00] dark:text-[#F2C14E]' }
const TABS = [['look', 'Look'], ['notes', 'Notes for the AI'], ['details', 'Name and sharing'], ['advanced', 'Advanced']]
const caption = 'mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted'

/**
 * Where a design is reviewed and edited: the example beside Batkle's version of it (redrawn as settings change), the
 * settings in tabs, and a save bar that stays in view.
 */
export default function DesignStudyWorkspace({ family, record, brand = {}, official, busy, dirty, visibility, onVisibility, onChange, onClose, onSave, onPublish, onUnpublish, onDelete, onRestudy, onApplyGrammar }) {
  const [tab, setTab] = useState('look'), [sample, setSample] = useState(0), [example, setExample] = useState(0), [zoom, setZoom] = useState(null)
  const [reconstructionId, setReconstructionId] = useState(family.variants?.[0]?.id || ''), [json, setJson] = useState('')
  const refs = family.referenceImages || []
  const reference = refs[Math.min(example, refs.length - 1)]
  const reconstruction = family.variants?.find(v => v.id === reconstructionId)
  const published = record.status === 'published'
  const status = busy || (dirty ? 'You have unsaved changes' : published ? 'Published. No unsaved changes.' : 'Draft. No unsaved changes.')

  return (
    <section aria-labelledby="design-workspace-title" className="mt-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={onClose} className={appButton('quiet', 'sm', '-ml-3 text-bk-muted')}><ArrowLeft className="size-4" />Design Library</button>
        <h2 id="design-workspace-title" className="min-w-0 truncate font-bk-display text-[24px] font-bold tracking-[-0.03em]">{family.name || 'Untitled design'}</h2>
        <span className={cn('rounded-md px-2 py-0.5 text-[11.5px] font-bold capitalize', STATUS_TONE[record.status] || STATUS_TONE.draft)}>{record.status}</span>
      </div>

      <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <aside aria-label="Compare with your example" className="space-y-4 lg:sticky lg:top-6">
          <div className={cn(panelClass, 'p-4')}>
            <div className="grid grid-cols-2 gap-3">
              <figure className="min-w-0">
                <figcaption className={caption}>Your example</figcaption>
                {reference && (
                  <a href={reference.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-bk-alt" style={{ aspectRatio: `${family.width}/${family.height}` }}>
                    <img src={reference.url} alt={reference.name || 'Your example'} className="size-full object-contain" />
                  </a>
                )}
              </figure>
              <figure className="min-w-0">
                <figcaption className={caption}>Batkle’s version</figcaption>
                <button type="button" aria-label={`Enlarge sample ${sample + 1}`} onClick={() => setZoom(sample)} className="group relative block w-full cursor-zoom-in rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg">
                  <GlobalDesignPreview family={family} brand={brand} sample={sample} eager sampleLabel={false} />
                  <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><ZoomIn className="size-3" /></span>
                </button>
              </figure>
            </div>
            {refs.length > 1 && (
              <div role="group" aria-label="Examples" className="mt-3 flex flex-wrap gap-1.5">
                {refs.map((ref, i) => <button key={ref.id} type="button" aria-pressed={i === example} onClick={() => setExample(i)} className={appButton(i === example ? 'ink' : 'outline', 'xs')}>Example {i + 1}</button>)}
              </div>
            )}
            <div role="group" aria-label="Samples" className="mt-3 grid grid-cols-4 gap-2">
              {SAMPLE_DECK.map((_, i) => (
                <button key={i} type="button" aria-label={`Show sample ${i + 1}`} aria-pressed={sample === i} onClick={() => setSample(i)} className={cn('overflow-hidden rounded-md transition-[opacity,box-shadow]', sample === i ? 'ring-2 ring-bk-fg ring-offset-2 ring-offset-bk-surface' : 'opacity-60 hover:opacity-100')}>
                  <GlobalDesignPreview family={family} brand={brand} sample={i} sampleLabel={false} />
                </button>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-bk-muted">Samples use sample copy and photos{brand?.name ? ` in ${brand.name}’s colours and fonts` : ''}. They change as you edit.</p>
          </div>
          <div className={cn(panelClass, 'flex flex-wrap items-center gap-3 p-4')}>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold">Doesn’t match your example?</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-bk-muted">Batkle studies it again from scratch and replaces these settings. Your name and categories stay.</p>
            </div>
            <button type="button" disabled={!!busy} onClick={onRestudy} className={appButton('outline', 'sm')}><RefreshCw className="size-4" />Study again</button>
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <SegmentedTabs items={TABS} value={tab} onChange={setTab} label="Design settings" />
          {(tab === 'look' || tab === 'notes') && <DesignStudyEditor family={family} onChange={onChange} view={tab} />}

          {tab === 'details' && <>
            <section className={cn(panelClass, 'space-y-4 p-4 sm:p-5')}>
              <label className="block"><span className="text-[13px] font-bold">Name</span><input value={family.name} onChange={e => onChange({ ...family, name: e.target.value })} className={appField('mt-2 h-10 text-[14px]')} /></label>
              <label className="block"><span className="text-[13px] font-bold">Description</span><span className="mt-0.5 block text-[12px] text-bk-muted">Shown in the library under the name.</span><textarea rows={3} value={family.description} onChange={e => onChange({ ...family, description: e.target.value })} className={appField('mt-2 h-auto py-2.5 text-[14px] leading-relaxed')} /></label>
              <label className="block"><span className="text-[13px] font-bold">Categories</span><span className="mt-0.5 block text-[12px] text-bk-muted">Separated by commas. People search the library by these.</span><input value={family.tags.join(', ')} placeholder="editorial, bold, minimal" onChange={e => onChange({ ...family, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} className={appField('mt-2 h-10 text-[14px]')} /></label>
            </section>
            {!official && (
              <section className={cn(panelClass, 'p-4 sm:p-5')}>
                <h3 className="text-[15px] font-bold">Who can use it</h3>
                <div role="radiogroup" aria-label="Who can use it" className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[['public', Globe, 'Everyone', 'Anyone finds it in the library. Members on Pro and Business can use it.'], ['private', Lock, 'You and your team', 'Only you and the people in your teams.']].map(([value, Icon, label, hint]) => (
                    <button key={value} type="button" role="radio" aria-checked={visibility === value} onClick={() => onVisibility(value)} className={cn('flex gap-3 rounded-xl border p-3 text-left transition-colors', visibility === value ? 'border-bk-fg bg-bk-alt' : 'border-bk-field hover:border-bk-fg/40')}>
                      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span><span className="block text-[14px] font-bold">{label}</span><span className="mt-0.5 block text-[12.5px] leading-relaxed text-bk-muted">{hint}</span></span>
                    </button>
                  ))}
                </div>
                {published && (record.visibility || 'private') !== visibility && <p className="mt-3 text-[12.5px] text-bk-muted">Publish again to apply this.</p>}
              </section>
            )}
            <section className={cn(panelClass, 'flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5')}>
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold">Delete this design</h3>
                <p className="mt-0.5 text-[12.5px] text-bk-muted">Brands that use it, and posts made with it, keep their saved version.</p>
              </div>
              <button type="button" disabled={!!busy} onClick={onDelete} className={appButton('outline', 'sm', 'text-[#C2412F] dark:text-[#F0826F]')}><Trash2 className="size-4" />Delete design</button>
            </section>
          </>}

          {tab === 'advanced' && <>
            <section className={cn(panelClass, 'p-4 sm:p-5')}>
              <h3 className="text-[15px] font-bold">How each example was read</h3>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-bk-muted">Rebuilt for review only. Posts are composed from the settings, never copied from these.</p>
              {family.variants?.length ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-[200px_1fr]">
                  <div className="space-y-2">
                    <select aria-label="Example reconstruction" className={appField('h-9 text-[13.5px]')} value={reconstructionId} onChange={e => setReconstructionId(e.target.value)}>{family.variants.map((v, i) => <option key={v.id} value={v.id}>Example {i + 1}</option>)}</select>
                    {reconstruction && <GlobalDesignPreview family={family} reconstruction={reconstruction} />}
                  </div>
                  <p className="whitespace-pre-line text-[12px] leading-relaxed text-bk-muted">{family.analysis}</p>
                </div>
              ) : <p className="mt-3 text-[13px] text-bk-muted">No reconstructions were kept for this design.</p>}
            </section>
            <section className={cn(panelClass, 'p-4 sm:p-5')}>
              <h3 className="text-[15px] font-bold">Settings as JSON</h3>
              <p className="mt-0.5 text-[12.5px] text-bk-muted">Everything the Look tab sets, for exact edits.</p>
              {json ? <>
                <textarea aria-label="Design grammar JSON" value={json} onChange={e => setJson(e.target.value)} className="mt-3 h-72 w-full rounded-lg border border-bk-field bg-bk-surface p-3 font-mono text-[12px] outline-none focus:border-bk-fg" />
                <div className="mt-2 flex gap-2">
                  <button type="button" className={appButton('outline', 'sm')} onClick={() => onApplyGrammar(json)}>Apply</button>
                  <button type="button" className={appButton('quiet', 'sm')} onClick={() => setJson('')}>Close</button>
                </div>
              </> : <button type="button" className={appButton('outline', 'sm', 'mt-3')} onClick={() => setJson(JSON.stringify(familyGrammar(family), null, 2))}>Show JSON</button>}
            </section>
          </>}
        </div>
      </div>

      {/* Saving and publishing stay in reach however far down the settings go. */}
      <div className="sticky bottom-4 z-20 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bk-fg bg-bk-surface p-2.5 pl-4 shadow-bk-pop">
          <p aria-live="polite" className="flex items-center gap-2 text-[13.5px] font-bold">{busy && <Loader2 className="size-4 animate-spin" />}{status}</p>
          <div className="flex flex-wrap gap-2">
            {published && <button type="button" disabled={!!busy} onClick={onUnpublish} className={appButton('quiet', 'sm')}>Unpublish</button>}
            <button type="button" disabled={!!busy || !dirty} onClick={onSave} className={appButton('outline', 'sm')}>Save draft</button>
            <button type="button" disabled={!!busy} onClick={onPublish} className={appButton('primary', 'sm')}>{published && !dirty ? 'Publish again' : 'Publish'}</button>
          </div>
        </div>
      </div>
      <SampleLightbox family={family} brand={brand} index={zoom} onIndex={setZoom} onClose={() => setZoom(null)} />
    </section>
  )
}
