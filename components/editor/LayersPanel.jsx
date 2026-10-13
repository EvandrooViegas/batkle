'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Blend, ChevronDown, ChevronRight, Circle, Eye, EyeOff, Folder, GripVertical, Group, Image as ImageIcon, Lock, Minus, Plus,
  Square, Type, Unlink, Unlock, Upload,
} from 'lucide-react'
import { appButton } from '@/components/app/ui'
import { cn } from '@/lib/utils'
import { IconButton, Section, Tip } from './controls'
import { TEXT_PRESETS, buildGradientCssClient, nodeLayerLabel, textPreset } from './kit'
import { LayerMenu } from './LayerMenu'

function LayerThumb({ node }) {
  const box = cn('size-8 shrink-0 overflow-hidden rounded-md border border-bk-line', node.hidden && 'opacity-40')
  if (node.type === 'image' && node.src) return <span className={cn(box, 'bg-bk-chip')}><img src={node.src} alt="" className="size-full object-cover" draggable={false} /></span>
  if (node.type === 'text') {
    return (
      <span className={cn(box, 'flex items-center justify-center bg-bk-surface text-bk-fg')}>
        <Type className="size-3.5 text-bk-muted" />
      </span>
    )
  }
  if (node.type === 'gradient') return <span className={box} style={{ backgroundImage: buildGradientCssClient(node) }} />
  return <span className={box} style={{ background: node.fill || '#6366f1', borderRadius: node.shape === 'ellipse' ? '50%' : undefined }} />
}

/** Text presets and elements to add to the open slide. */
export function AddSection({ canvas, uploading, onAddText, onAddShape, onAddLine, onAddGradient, onOpenImage, onUpload }) {
  const fileRef = useRef(null)
  const tools = [
    { label: 'Image', icon: ImageIcon, onClick: onOpenImage, keys: 'I' },
    { label: uploading ? 'Uploading…' : 'Upload', icon: Upload, onClick: () => fileRef.current?.click(), disabled: uploading },
    { label: 'Gradient', icon: Blend, onClick: onAddGradient },
    { label: 'Rectangle', icon: Square, onClick: () => onAddShape('rect'), keys: 'R' },
    { label: 'Circle', icon: Circle, onClick: () => onAddShape('ellipse'), keys: 'O' },
    { label: 'Line', icon: Minus, onClick: onAddLine, keys: 'L' },
  ]
  return (
    <Section title="Add">
      <div className="space-y-1.5">
        {Object.entries(TEXT_PRESETS).map(([kind, preset]) => {
          const look = textPreset(canvas, kind)
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onAddText(kind)}
              title={kind === 'body' ? 'Add text (T)' : undefined}
              className="flex w-full items-center rounded-lg border border-bk-line bg-bk-surface px-3 text-left transition-[border-color,transform] hover:-translate-y-px hover:border-bk-fg/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg"
              style={{ height: kind === 'heading' ? 40 : 34 }}
            >
              <span
                className="truncate leading-none"
                style={{ fontFamily: `'${look.fontFamily}', sans-serif`, fontWeight: look.fontWeight, fontSize: kind === 'heading' ? 19 : kind === 'subheading' ? 15 : 13 }}
              >
                {preset.text}
              </span>
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {tools.map(({ label, icon: Icon, onClick, disabled, keys }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={keys ? `${label} (${keys})` : undefined}
            className="flex h-[52px] flex-col items-center justify-center gap-1 rounded-xl border border-bk-line bg-bk-surface text-[11.5px] font-semibold transition-[border-color,transform] hover:-translate-y-px hover:border-bk-fg/50 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg"
          >
            <Icon className="size-[18px]" aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files?.length) onUpload(e.target.files); e.target.value = '' }} />
    </Section>
  )
}

function RowToggles({ node, onToggleHidden, onToggleLocked }) {
  const btn = (active) => cn(
    'flex size-6 shrink-0 items-center justify-center rounded-md text-bk-muted transition-[opacity,background-color] hover:bg-bk-line hover:text-bk-fg focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-fg [&_svg]:size-3.5',
    active ? 'opacity-100 text-bk-fg' : 'opacity-0 group-hover:opacity-100 max-lg:opacity-100',
  )
  return (
    <>
      <button type="button" draggable={false} className={btn(node.locked)} aria-label={node.locked ? 'Unlock layer' : 'Lock layer'} aria-pressed={!!node.locked} title={node.locked ? 'Unlock' : 'Lock (it stays put on the canvas)'} onClick={e => { e.stopPropagation(); onToggleLocked([node.id]) }}>
        {node.locked ? <Lock /> : <Unlock />}
      </button>
      <button type="button" draggable={false} className={btn(node.hidden)} aria-label={node.hidden ? 'Show layer' : 'Hide layer'} aria-pressed={!!node.hidden} title={node.hidden ? 'Show' : 'Hide (it is left out of downloads too)'} onClick={e => { e.stopPropagation(); onToggleHidden([node.id]) }}>
        {node.hidden ? <EyeOff /> : <Eye />}
      </button>
    </>
  )
}

function LayerName({ node, renaming, onRename, onDone }) {
  if (!renaming) {
    return <span className={cn('min-w-0 flex-1', node.type === 'text' && !node.name ? 'line-clamp-2 leading-snug' : 'truncate', node.hidden && 'text-bk-muted')}>{nodeLayerLabel(node)}</span>
  }
  return (
    <input
      autoFocus
      aria-label="Layer name"
      defaultValue={node.name || ''}
      placeholder={nodeLayerLabel({ ...node, name: '' })}
      onFocus={e => e.currentTarget.select()}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { e.currentTarget.value = node.name || ''; e.currentTarget.blur() }
      }}
      onBlur={e => {
        const name = e.currentTarget.value.trim()
        if (name !== (node.name || '')) onRename(node.id, name)
        onDone()
      }}
      className="h-6 min-w-0 flex-1 rounded border border-bk-fg bg-bk-surface px-1.5 text-[13px] font-semibold focus:outline-none"
    />
  )
}

/**
 * The open slide's layers, front first. Drag rows to reorder or to move them in and out of groups,
 * double-click to rename, right-click for every layer action.
 */
export function LayersPanel({
  canvas, carousel, groups, selectedIds, selectedGroupId, expandedGroups, setHoverId,
  onSelectLayer, onSelectGroup, onToggleGroup, onUngroup, onCreateGroup, onToggleHidden, onToggleLocked, onRename,
  dnd, menu, sessionImages, onInsertImage, children,
}) {
  const [dragOverId, setDragOverId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [dragSource, setDragSource] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const rowRefs = useRef(new Map())
  const nodes = canvas.nodes || []
  const lastSelected = selectedIds[selectedIds.length - 1]

  // A layer picked on the canvas scrolls into view in the list.
  useEffect(() => {
    rowRefs.current.get(lastSelected)?.scrollIntoView({ block: 'nearest' })
  }, [lastSelected])

  const refFor = id => el => { if (el) rowRefs.current.set(id, el); else rowRefs.current.delete(id) }

  const onDragStart = (nodeId, fromGroupId, e) => {
    e.dataTransfer.setData('text/plain', nodeId)
    if (fromGroupId) e.dataTransfer.setData('application/x-kand-from-group', fromGroupId)
    e.dataTransfer.effectAllowed = 'move'
    setDragSource({ nodeId, fromGroupId: fromGroupId || null })
  }
  const onDragEnd = () => {
    setDragSource(null)
    setDropTarget(null)
    setDragOverId(null)
  }
  const dropActive = (target) => {
    if (!dropTarget || !target || dropTarget.type !== target.type) return false
    if (target.groupId != null && dropTarget.groupId !== target.groupId) return false
    if (target.nodeId != null && dropTarget.nodeId !== target.nodeId) return false
    return true
  }
  const onDrop = (e, target) => {
    e.preventDefault()
    e.stopPropagation()
    const draggedId = e.dataTransfer.getData('text/plain')
    setDropTarget(null)
    setDragOverId(null)
    if (!draggedId || !target) return
    const fromGroupId = e.dataTransfer.getData('application/x-kand-from-group') || null
    if (target.type === 'group-add') {
      if (fromGroupId === target.groupId) {
        const g = groups.find(gr => gr.id === target.groupId)
        if (g && g.nodeIds[g.nodeIds.length - 1] !== draggedId) dnd.reorderGroupMember(target.groupId, draggedId, null)
      } else dnd.addNodeToGroup(target.groupId, draggedId, null)
    } else if (target.type === 'group-before') {
      if (fromGroupId === target.groupId) dnd.reorderGroupMember(target.groupId, draggedId, target.nodeId)
      else dnd.addNodeToGroup(target.groupId, draggedId, target.nodeId)
    } else if (target.type === 'ungroup') {
      if (fromGroupId) dnd.removeNodeFromGroupById(fromGroupId, draggedId)
    } else if (target.type === 'ungrouped-before' && target.nodeId) {
      if (fromGroupId) dnd.removeNodeFromGroupById(fromGroupId, draggedId)
      dnd.reorderByDrag(draggedId, target.nodeId)
    }
  }

  const rowClass = (selectedRow, dropping) => cn(
    'group relative flex cursor-grab items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] transition-colors active:cursor-grabbing',
    selectedRow ? 'bg-bk-chip font-semibold ring-1 ring-inset ring-bk-fg/50' : 'hover:bg-bk-alt',
    dropping && 'shadow-[inset_0_2px_0_0_rgb(var(--bk-fg))]',
  )
  const rowEvents = (n) => ({
    'data-layer-id': n.id,
    ref: refFor(n.id),
    draggable: renamingId !== n.id,
    onDragEnd,
    onMouseEnter: () => setHoverId(n.id),
    onMouseLeave: () => setHoverId(null),
    onDoubleClick: (e) => { e.stopPropagation(); setRenamingId(n.id) },
  })
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  return (
    <>
      {children}
      <div className="flex min-h-0 flex-1 flex-col border-t border-bk-line">
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">Layers <span className="ml-1 tabular-nums tracking-normal">{nodes.length}</span></h3>
          {selectedIds.length >= 2 && (
            <button type="button" onClick={onCreateGroup} className={appButton('outline', 'xs', 'h-7 px-2 text-[12px]')}><Group className="size-3.5" />Group</button>
          )}
        </div>
        <LayerMenu sel={menu.sel} actions={menu.actions} onOpen={e => menu.onOpen(e.target.closest?.('[data-layer-id]')?.getAttribute('data-layer-id') || null)}>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3" role="list" aria-label="Layers">
            {nodes.length === 0 && (
              <p className="px-1.5 py-6 text-center text-[12.5px] leading-relaxed text-bk-muted">This {carousel ? 'slide' : 'post'} is empty.<br />Add text, an image or a shape above.</p>
            )}
            {groups.map((g) => {
              const expanded = expandedGroups[g.id] !== false
              const addTarget = { type: 'group-add', groupId: g.id }
              return (
                <div key={g.id} className="overflow-hidden rounded-lg border border-bk-line" role="listitem">
                  <div
                    className={cn('flex cursor-pointer items-center gap-1.5 px-1.5 py-1.5 text-[13px]', selectedGroupId === g.id ? 'bg-bk-chip' : 'hover:bg-bk-alt', dropActive(addTarget) && 'ring-2 ring-inset ring-bk-fg')}
                    onClick={() => onSelectGroup(g.id)}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget(addTarget) }}
                    onDragLeave={(e) => { e.stopPropagation(); if (dropActive(addTarget)) setDropTarget(null) }}
                    onDrop={(e) => onDrop(e, addTarget)}
                  >
                    <button type="button" aria-label={expanded ? 'Collapse group' : 'Expand group'} className="rounded p-0.5 hover:bg-bk-line" onClick={(e) => { e.stopPropagation(); onToggleGroup(g.id) }}>
                      {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                    <Folder className="size-3.5 shrink-0 text-bk-muted" />
                    <span className="flex-1 truncate font-semibold">{g.name}</span>
                    <span className="text-[11px] tabular-nums text-bk-muted">{g.nodeIds.length}</span>
                    <IconButton label="Ungroup" className="size-6" onClick={(e) => { e.stopPropagation(); onUngroup(g.id) }}><Unlink /></IconButton>
                  </div>
                  {expanded && g.nodeIds.map((nid) => {
                    const n = nodeMap.get(nid)
                    if (!n) return null
                    const beforeTarget = { type: 'group-before', groupId: g.id, nodeId: nid }
                    return (
                      <div
                        key={nid}
                        {...rowEvents(n)}
                        onDragStart={(e) => onDragStart(nid, g.id, e)}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget(beforeTarget) }}
                        onDragLeave={(e) => { e.stopPropagation(); if (dropActive(beforeTarget)) setDropTarget(null) }}
                        onDrop={(e) => onDrop(e, beforeTarget)}
                        onClick={(e) => { e.stopPropagation(); onSelectLayer(nid, e) }}
                        className={cn(rowClass(selectedIds.includes(nid), dropActive(beforeTarget)), 'rounded-none border-t border-bk-line pl-5')}
                      >
                        <LayerThumb node={n} />
                        <LayerName node={n} renaming={renamingId === nid} onRename={onRename} onDone={() => setRenamingId(null)} />
                        <RowToggles node={n} onToggleHidden={onToggleHidden} onToggleLocked={onToggleLocked} />
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {dragSource?.fromGroupId && (
              <div
                className={cn('rounded-lg border border-dashed px-2 py-2 text-center text-[12px] transition-colors', dropActive({ type: 'ungroup' }) ? 'border-bk-fg bg-bk-chip' : 'border-bk-field text-bk-muted')}
                onDragOver={(e) => { e.preventDefault(); setDropTarget({ type: 'ungroup' }) }}
                onDragLeave={() => { if (dropTarget?.type === 'ungroup') setDropTarget(null) }}
                onDrop={(e) => onDrop(e, { type: 'ungroup' })}
              >
                Drop here to take it out of the group
              </div>
            )}
            {nodes.slice().reverse().filter((n) => !n.groupId).map((n) => {
              const beforeTarget = { type: 'ungrouped-before', nodeId: n.id }
              return (
                <div
                  key={n.id}
                  role="listitem"
                  {...rowEvents(n)}
                  onDragStart={(e) => onDragStart(n.id, null, e)}
                  onDragOver={(e) => { e.preventDefault(); setDropTarget(beforeTarget); if (dragOverId !== n.id) setDragOverId(n.id) }}
                  onDragLeave={() => { if (dragOverId === n.id) setDragOverId(null); if (dropActive(beforeTarget)) setDropTarget(null) }}
                  onDrop={(e) => onDrop(e, beforeTarget)}
                  onClick={(e) => onSelectLayer(n.id, e)}
                  className={rowClass(selectedIds.includes(n.id), dropActive(beforeTarget) || dragOverId === n.id)}
                >
                  <GripVertical className="absolute -left-0.5 size-3 text-bk-muted opacity-0 group-hover:opacity-60" aria-hidden="true" />
                  <LayerThumb node={n} />
                  <LayerName node={n} renaming={renamingId === n.id} onRename={onRename} onDone={() => setRenamingId(null)} />
                  {n.dynamic_key && renamingId !== n.id && <span className="max-w-[64px] shrink-0 truncate rounded bg-bk-lilac/60 px-1.5 py-0.5 font-mono text-[10.5px] text-bk-ink" title={`API key: ${n.dynamic_key}`}>{n.dynamic_key}</span>}
                  <RowToggles node={n} onToggleHidden={onToggleHidden} onToggleLocked={onToggleLocked} />
                </div>
              )
            })}
          </div>
        </LayerMenu>
        {nodes.length > 0 && <p className="hidden border-t border-bk-line px-4 py-2 text-[11px] text-bk-muted lg:block">Double-click a layer to rename it. Right-click for more.</p>}
      </div>
      {sessionImages.length > 0 && (
        <Section title="Your uploads" className="max-h-[200px] shrink-0 overflow-y-auto">
          <div className="grid grid-cols-4 gap-1.5">
            {sessionImages.map((src) => (
              <Tip key={src} label="Add this image" side="top">
                <button type="button" aria-label="Add this image" className="group relative aspect-square overflow-hidden rounded-lg border border-bk-line" onClick={() => onInsertImage(src)}>
                  <img src={src} alt="" className="size-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-bk-ink/45 opacity-0 transition-opacity group-hover:opacity-100"><Plus className="size-4 text-white" /></span>
                </button>
              </Tip>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}
