'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { filterIdeas } from '@/lib/client/ideaStatus'
import { scheduleState } from '@/lib/client/schedule'
import { cn } from '@/lib/utils'
import { useAppShell } from '../AppShell'
import { usePopup } from '../popup'
import { Eyebrow, appButton, displayClass } from '../ui'
import { useCreation } from './useCreation'
import { IdeaComposer } from './IdeaComposer'
import { FeaturedPost } from './FeaturedPost'
import { IdeaRow } from './IdeaRow'
import { PostPreview } from './PostPreview'
import { ScheduleDialog } from '../schedule/ScheduleDialog'
import { useSchedule } from '../schedule/useSchedule'

const FILTERS = [
  { value: 'all', label: 'All ideas' },
  { value: 'building', label: 'Building' },
  { value: 'ready', label: 'Ready' },
  { value: 'approved', label: 'Approved' },
  { value: 'carousel', label: 'Carousels' },
  { value: 'single', label: 'Single posts' },
]

function Notice({ tone = 'info', children }) {
  return (
    <div className={cn(
      'mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-[13px]',
      tone === 'error' ? 'border-[#C2412F]/30 bg-[#C2412F]/[0.06] text-[#8F2D20] dark:text-[#F0826F]' : 'border-bk-line bg-bk-surface text-bk-fg/85',
    )}>
      {children}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading ideas" className="mt-8 space-y-4">
      <div className="h-[220px] rounded-2xl bg-bk-fg/[0.06] motion-safe:animate-pulse" />
      <div className="h-[340px] rounded-2xl bg-bk-surface motion-safe:animate-pulse" />
    </div>
  )
}

export default function CreationPage({ flowId, brandContext: suppliedBrand }) {
  const creation = useCreation({ flowId, brandContext: suppliedBrand })
  const { brandContext, ideas, statusOf, loaded, loadError, busy } = creation
  const { setCount } = useAppShell()
  const [filter, setFilter] = useState('all')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [preview, setPreview] = useState(null) // { id, page }
  const [scheduling, setScheduling] = useState(null) // id of the idea whose post is being scheduled
  const popup = usePopup()
  const schedule = useSchedule(flowId)

  useEffect(() => { if (loaded && !loadError) setCount('creation', ideas.length) }, [loaded, loadError, ideas.length, setCount])

  const brandName = brandContext?.name || 'Your brand'
  const hasBrand = !!(brandContext?.name || brandContext?.about)
  const usesStarterDesigns = hasBrand && !(brandContext?.designs || []).some(d => d.source === 'global')
  const locked = !hasBrand || !loaded || loadError
  const featured = ideas.find(i => i.id === creation.featuredId)
  const visible = filter === 'approved' ? ideas.filter(i => schedule.byIdea.has(i.id)) : filterIdeas(ideas, filter, statusOf)
  const previewIdea = preview && ideas.find(i => i.id === preview.id)

  // Where each built post stands on its way out: approved, scheduled, due or posted (see lib/client/schedule.js).
  const approvalOf = idea => {
    const entry = schedule.byIdea.get(idea.id) || null
    return { entry, state: scheduleState(entry, statusOf(idea.id).canvas?.id || null) }
  }
  // Approving opens the schedule straight away; a post that is already approved goes straight to its schedule.
  const handleApproval = async idea => {
    const { state } = approvalOf(idea)
    if (state === 'unapproved' || state === 'changed') {
      const status = statusOf(idea.id)
      if (!status.canvas?.id) return
      const entry = await schedule.approve({ idea, canvas: status.canvas, copy: status.copy })
      if (!entry) return
      toast.success(state === 'changed' ? 'This version is approved' : 'Post approved')
      if (entry.status !== 'approved') return
    }
    setScheduling(idea.id)
  }
  const schedulingIdea = scheduling && ideas.find(i => i.id === scheduling)
  const schedulingEntry = schedulingIdea ? schedule.byIdea.get(schedulingIdea.id) || null : null

  const toggle = id => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const endSelection = () => { setSelecting(false); setSelected(new Set()) }

  const confirmDeleteAll = async () => {
    const ok = await popup.confirm({
      title: `Delete all ${ideas.length} ideas?`,
      description: `This clears the idea list for ${brandName}. Posts you already built stay in Studio and the editor.`,
      tone: 'danger',
      confirmLabel: 'Delete all',
    })
    if (ok) creation.deleteAll()
  }

  const confirmDeleteSelected = async () => {
    const ids = new Set(selected)
    const ok = await popup.confirm({
      title: ids.size === 1 ? 'Delete this idea?' : `Delete ${ids.size} ideas?`,
      description: 'Posts you already built from them stay in Studio and the editor.',
      tone: 'danger',
      confirmLabel: ids.size === 1 ? 'Delete idea' : `Delete ${ids.size} ideas`,
    })
    if (!ok) return
    creation.deleteIdeas(ids)
    endSelection()
  }

  return (
    <div className="px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <div className="mx-auto max-w-[1160px]">
        <header>
          <Eyebrow>{brandName} · Creation</Eyebrow>
          <h1 className={cn(displayClass, 'mt-1.5 text-[clamp(26px,2.6vw,34px)] leading-[1.05]')}>Content ideas</h1>
        </header>

        {!hasBrand && (
          <Notice>
            <span>Batkle needs your brand profile before it can write ideas.</span>
            <Link href={`/app/${flowId}/brand-information`} className={appButton('primary', 'sm')}>Set up brand profile</Link>
          </Notice>
        )}
        {loadError && (
          <Notice tone="error">
            <span>Your ideas could not be loaded. Nothing will be saved until they load, so no work is overwritten.</span>
            <button type="button" onClick={() => window.location.reload()} className={appButton('outline', 'sm')}>Reload</button>
          </Notice>
        )}
        {usesStarterDesigns && (
          <Notice>
            <span>Posts use your saved starter designs. Choose designs from the Global Design Library for more variety.</span>
            <Link href={`/app/${flowId}/brand-information`} className="font-bold underline underline-offset-4">Choose designs</Link>
          </Notice>
        )}

        <IdeaComposer
          className="mt-6"
          brandContext={brandContext}
          brandId={`brand_${flowId}`}
          disabled={locked}
          busy={busy}
          hasIdeas={ideas.length > 0}
          onCreate={idea => creation.createIdea({ ...idea, andBuild: true })}
          onSuggest={idea => creation.createIdea(idea)}
        />

        {!loaded ? <ListSkeleton /> : (
          <>
            {featured && (
              <FeaturedPost
                className="mt-6"
                idea={featured}
                status={statusOf(featured.id)}
                approval={approvalOf(featured)}
                onApproval={() => handleApproval(featured)}
                onPreview={page => setPreview({ id: featured.id, page })}
                onBuild={() => creation.startBuild(featured)}
                onRetry={() => creation.retry(featured)}
                limit={creation.limitOf(featured.id)}
                onRebuild={() => creation.rebuildDesign(featured)}
                onNewVersion={() => creation.newVersion(featured)}
              />
            )}

            {ideas.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-bk-field px-6 py-10 text-center motion-safe:animate-bk-page">
                <Sparkles className="mx-auto size-6 text-bk-muted" aria-hidden="true" />
                <p className="mt-2.5 font-bk-display text-[17px] font-bold tracking-[-0.02em]">No ideas yet</p>
                <p className="mx-auto mt-1 max-w-[400px] text-[13.5px] text-bk-muted">Describe a post above, or leave it empty and Batkle will suggest one from your brand profile.</p>
              </div>
            ) : (
              <>
                <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
                  <div role="group" aria-label="Filter ideas" className="flex max-w-full overflow-x-auto rounded-xl border border-bk-field bg-bk-surface p-1 [scrollbar-width:none]">
                    {FILTERS.map(f => (
                      <button
                        key={f.value}
                        type="button"
                        aria-pressed={filter === f.value}
                        onClick={() => setFilter(f.value)}
                        className={cn(
                          'h-8 shrink-0 rounded-lg px-3 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg',
                          filter === f.value ? 'bg-bk-fg font-bold text-bk-bg' : 'text-bk-fg hover:bg-bk-alt',
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-5">
                    <span className="text-[13px] text-bk-muted">{ideas.length} idea{ideas.length === 1 ? '' : 's'}</span>
                    <button type="button" onClick={confirmDeleteAll} disabled={creation.anyRunning} className="text-[13px] font-medium text-[#C2412F] underline underline-offset-4 hover:text-[#8F2D20] disabled:opacity-40 dark:text-[#F0826F]">
                      Delete all
                    </button>
                    <button type="button" onClick={() => (selecting ? endSelection() : setSelecting(true))} className={appButton('outline', 'sm')}>
                      {selecting ? 'Cancel' : 'Select'}
                    </button>
                  </div>
                </div>

                {visible.length ? (
                  <ul className="mt-4 divide-y divide-bk-line overflow-hidden rounded-2xl border border-bk-line bg-bk-surface">
                    {visible.map((idea, order) => (
                      <IdeaRow
                        key={idea.id}
                        order={order}
                        idea={idea}
                        number={ideas.indexOf(idea) + 1}
                        status={statusOf(idea.id)}
                        approval={approvalOf(idea)}
                        onApproval={() => handleApproval(idea)}
                        selecting={selecting}
                        selected={selected.has(idea.id)}
                        onToggle={() => toggle(idea.id)}
                        onPreview={page => setPreview({ id: idea.id, page })}
                        onBuild={() => creation.startBuild(idea)}
                        onRetry={() => creation.retry(idea)}
                        limit={creation.limitOf(idea.id)}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 rounded-2xl border border-dashed border-bk-field px-6 py-8 text-center text-[13.5px] text-bk-muted">No ideas match this filter yet.</p>
                )}
              </>
            )}
          </>
        )}
      </div>

      {selecting && (
        <div className="sticky bottom-4 z-20 mx-auto mt-5 max-w-[1160px] motion-safe:animate-bk-page">
          <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-bk-fg bg-bk-surface p-2.5 pl-4 shadow-bk-pop">
            <p className="mr-auto text-[13.5px] font-bold">
              {selected.size ? `${selected.size} selected` : 'Select ideas to build or delete'}
            </p>
            <button
              type="button"
              onClick={() => setSelected(selected.size === ideas.length ? new Set() : new Set(ideas.map(i => i.id)))}
              className="text-[13px] font-semibold underline underline-offset-4"
            >
              {selected.size === ideas.length ? 'Deselect all' : 'Select all'}
            </button>
            <button
              type="button"
              disabled={!selected.size}
              onClick={confirmDeleteSelected}
              className={appButton('outline', 'sm', 'text-[#C2412F] dark:text-[#F0826F]')}
            >
              <Trash2 className="size-4" />Delete
            </button>
            <button
              type="button"
              disabled={!selected.size}
              onClick={() => { const ids = new Set(selected); endSelection(); creation.buildMany(ids) }}
              className={appButton('primary', 'sm')}
            >
              Generate posts
            </button>
          </div>
        </div>
      )}

      <PostPreview
        open={!!previewIdea}
        onOpenChange={open => !open && setPreview(null)}
        idea={previewIdea}
        status={previewIdea ? statusOf(previewIdea.id) : null}
        approval={previewIdea ? approvalOf(previewIdea) : null}
        onApproval={() => { if (!previewIdea) return; setPreview(null); handleApproval(previewIdea) }}
        initialPage={preview?.page || 0}
        onRebuild={() => previewIdea && creation.rebuildDesign(previewIdea)}
        onNewVersion={() => previewIdea && creation.newVersion(previewIdea)}
      />

      <ScheduleDialog
        open={!!schedulingEntry}
        onOpenChange={open => !open && setScheduling(null)}
        entry={schedulingEntry}
        canvas={schedulingIdea ? statusOf(schedulingIdea.id).canvas : null}
        onSave={changes => schedule.update(schedulingEntry.id, changes)}
        onUnschedule={() => schedule.update(schedulingEntry.id, { status: 'approved' })}
      />

    </div>
  )
}
