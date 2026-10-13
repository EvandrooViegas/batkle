'use client'

import { useRef, useState } from 'react'
import {
  AlignCenter, AlignHorizontalDistributeCenter, AlignLeft, AlignRight, AlignVerticalDistributeCenter, ArrowDown, ArrowRight, Check,
  CopyPlus, Crop, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Group, Image as ImageIcon, Italic, Link as LinkIcon, Link2, Lock,
  Plus, Strikethrough, Trash2, Underline, Unlink, Unlink2, Unlock, Upload, X,
} from 'lucide-react'
import { toast } from 'sonner'
import GalleryPicker from '@/components/GalleryPicker'
import { Eyebrow, appButton } from '@/components/app/ui'
import { alignNodes } from '@/lib/client/editorGeometry'
import { DEFAULT_TEXT_GRADIENT, buildTextGradientCss } from '@/lib/textGradient'
import { normalizeGroupGaps } from '@/lib/groups'
import { cn } from '@/lib/utils'
import {
  CHECKER, DEFAULT_FILTERS, FONT_META, GRADIENT_PRESETS, IMAGE_MASKS, NODE_KIND, SIZE_PRESETS, WEIGHT_LABELS,
  buildGradientCssClient, fontChoices, nodeLayerLabel, plainTextFromStyled,
} from './kit'
import {
  ColorField, Disclosure, Field, IconButton, NumberField, RangeField, Section, Segmented, SelectField, TextField, Toggle, fieldClass,
} from './controls'

const ALIGN_OPTIONS = [
  { value: 'left', label: 'Align left', icon: AlignLeft },
  { value: 'center', label: 'Align centre', icon: AlignCenter },
  { value: 'right', label: 'Align right', icon: AlignRight },
]

const COLOR_MODES = [
  { value: 'color', label: 'None' },
  { value: 'grayscale', label: 'Black & white' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'invert', label: 'Invert' },
  { value: 'high-contrast', label: 'High contrast' },
]

/** Nothing selected: the open slide and the post's size, background and finish. */
export function PostSettings({ canvas, setCanvas, slide, onRenameSlide }) {
  const carousel = !!slide
  return (
    <>
      <div className="mx-4 mt-4 rounded-xl bg-bk-chip px-3.5 py-3 text-[12.5px] leading-relaxed text-bk-fg/80">
        Select a layer to edit it, or drag across the canvas to pick several. Double-click text to type, right-click for more, and press <kbd className="rounded bg-bk-surface px-1 font-mono text-[11px]">?</kbd> for shortcuts.
      </div>
      {carousel && (
        <Section title={`Slide ${slide.index + 1}`}>
          <Field label="Name">
            <TextField value={slide.name || ''} onChange={e => onRenameSlide(e.target.value)} placeholder={`Slide ${slide.index + 1}`} />
          </Field>
        </Section>
      )}
      <Section title={carousel ? 'Slide background' : 'Background'}>
        <ColorField label="Background" value={canvas.background || '#ffffff'} onChange={background => setCanvas(c => ({ ...c, background }))} />
      </Section>
      <Section title={carousel ? 'Size of every slide' : 'Size'}>
        <div className="grid grid-cols-4 gap-1.5">
          {SIZE_PRESETS.map(p => {
            const active = canvas.width === p.w && canvas.height === p.h
            const box = p.w >= p.h ? { width: 22, height: Math.round(22 * p.h / p.w) } : { width: Math.round(22 * p.w / p.h), height: 22 }
            return (
              <button
                key={p.ratio}
                type="button"
                aria-pressed={active}
                onClick={() => setCanvas(c => ({ ...c, width: p.w, height: p.h }))}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg',
                  active ? 'border-bk-fg bg-bk-chip' : 'border-bk-line hover:border-bk-fg/40',
                )}
              >
                <span className="flex h-[22px] items-center"><span className="rounded-[3px] border-[1.5px] border-current" style={box} /></span>
                <span>{p.label}</span>
                <span className="-mt-1 text-[10.5px] font-normal text-bk-muted">{p.ratio}</span>
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="W" title="Width in pixels" value={canvas.width} min={100} onChange={v => setCanvas(c => ({ ...c, width: Math.max(100, Math.round(v || 1080)) }))} suffix="px" />
          <NumberField label="H" title="Height in pixels" value={canvas.height} min={100} onChange={v => setCanvas(c => ({ ...c, height: Math.max(100, Math.round(v || 1080)) }))} suffix="px" />
        </div>
      </Section>
      <Disclosure title="Colour effect">
        <SelectField aria-label="Colour effect" value={canvas.colorMode || 'color'} onChange={colorMode => setCanvas(c => ({ ...c, colorMode }))} options={COLOR_MODES} />
        <p className="text-[11.5px] text-bk-muted">Applied to the whole {carousel ? 'carousel' : 'post'} when it is downloaded.</p>
      </Disclosure>
    </>
  )
}

/** The selected layer's kind and name, with its visibility and lock. */
export function LayerHeader({ node, updateNode, onToggleHidden, onToggleLocked }) {
  return (
    <div className="px-4 pb-3 pt-4">
      <div className="flex items-center gap-1">
        <Eyebrow className="flex-1">{NODE_KIND[node.type] || 'Layer'}</Eyebrow>
        <IconButton label={node.hidden ? 'Show (Ctrl+Shift+H)' : 'Hide (Ctrl+Shift+H)'} className="size-7" active={!!node.hidden} onClick={() => onToggleHidden([node.id])}>{node.hidden ? <EyeOff /> : <Eye />}</IconButton>
        <IconButton label={node.locked ? 'Unlock (Ctrl+Shift+L)' : 'Lock (Ctrl+Shift+L)'} className="size-7" active={!!node.locked} onClick={() => onToggleLocked([node.id])}>{node.locked ? <Lock /> : <Unlock />}</IconButton>
      </div>
      <input
        aria-label="Layer name"
        value={node.name || ''}
        placeholder={nodeLayerLabel({ ...node, name: '' })}
        onChange={e => updateNode(node.id, { name: e.target.value || undefined })}
        className="-mx-1.5 mt-0.5 block h-8 w-[calc(100%+12px)] truncate rounded-md bg-transparent px-1.5 font-bk-display text-[16px] font-bold tracking-[-0.02em] placeholder:text-bk-fg transition-colors hover:bg-bk-alt focus:bg-bk-alt focus:outline-none focus:placeholder:text-bk-muted"
      />
      {(node.locked || node.hidden) && (
        <p className="mt-2 rounded-lg bg-bk-chip px-2.5 py-2 text-[12px] leading-snug text-bk-fg/80">
          {node.hidden ? 'Hidden: it is left out of the canvas and of downloads.' : 'Locked: it can’t be moved on the canvas, and clicks go to the layers behind it.'}
        </p>
      )}
    </div>
  )
}

/** Position, size, rotation and opacity, with shortcuts to align the layer on the slide. */
export function LayoutSection({ node, canvas, updateNode }) {
  const [keepRatio, setKeepRatio] = useState(false)
  const image = node.type === 'image'
  const ratio = image && node.aspectRatio ? node.aspectRatio : node.width / Math.max(1, node.height)
  const locked = image || keepRatio
  const align = edge => {
    const [moved] = alignNodes([node], edge, { x: 0, y: 0, width: canvas.width, height: canvas.height })
    updateNode(node.id, { x: moved.x, y: moved.y })
  }
  const int = v => Math.round(v || 0)
  return (
    <Section title="Position">
      <AlignRow onAlign={align} slide />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={node.x} onChange={v => updateNode(node.id, { x: int(v) })} />
        <NumberField label="Y" value={node.y} onChange={v => updateNode(node.id, { y: int(v) })} />
      </div>
      <div className="flex items-center gap-1">
        <NumberField label="W" title="Width" className="flex-1" value={node.width} onChange={v => {
          const w = Math.max(1, int(v))
          updateNode(node.id, locked ? { width: w, height: Math.max(1, Math.round(w / ratio)) } : { width: w })
        }} />
        <IconButton
          label={image ? 'Images keep their proportions' : keepRatio ? 'Proportions locked' : 'Lock proportions'}
          className="size-7"
          active={locked}
          disabled={image}
          onClick={() => setKeepRatio(v => !v)}
        >
          {locked ? <Link2 /> : <Unlink2 />}
        </IconButton>
        <NumberField label="H" title="Height" className="flex-1" value={node.height} onChange={v => {
          const h = Math.max(1, int(v))
          updateNode(node.id, locked ? { height: h, width: Math.max(1, Math.round(h * ratio)) } : { height: h })
        }} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="↻" title="Rotation in degrees" value={node.rotation || 0} suffix="°" onChange={v => updateNode(node.id, { rotation: ((int(v) % 360) + 360) % 360 })} />
      </div>
      <RangeField label="Opacity" value={node.opacity ?? 100} suffix="%" onChange={opacity => updateNode(node.id, { opacity: opacity >= 100 ? undefined : opacity })} />
    </Section>
  )
}

const ALIGN_EDGES = {
  x: [['left', 'Align left'], ['center', 'Centre across'], ['right', 'Align right']],
  y: [['top', 'Align top'], ['middle', 'Centre down'], ['bottom', 'Align bottom']],
}

/** Six buttons that line layers up, on the slide (`slide`) or with each other. */
export function AlignRow({ onAlign, slide = false }) {
  const where = ['start', 'center', 'end']
  return (
    <div className="flex gap-1">
      {['x', 'y'].map((axis, a) => (
        <div key={axis} className="contents">
          {a === 1 && <span className="mx-0.5 w-px self-stretch bg-bk-line" />}
          {ALIGN_EDGES[axis].map(([edge, label], i) => (
            <IconButton key={edge} label={slide ? `${label} on the slide` : label} side="top" onClick={() => onAlign(edge)} className="size-7 flex-1 border border-bk-line">
              <AlignGlyph axis={axis} where={where[i]} />
            </IconButton>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Several layers selected: line them up, space them out, group them. */
export function MultiSelection({ count, allHidden, allLocked, onAlign, onDistribute, onGroup, onDuplicate, onDelete, onClear, onToggleHidden, onToggleLocked }) {
  return (
    <>
      <Section title={`${count} layers selected`}>
        <p className="-mt-1 text-[12.5px] leading-relaxed text-bk-muted">Drag any of them to move them together. Shift+click a layer to add or remove it.</p>
        <button type="button" onClick={onGroup} className={appButton('ink', 'sm', 'w-full')}><Group className="size-4" />Group layers</button>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={onDuplicate} className={appButton('outline', 'xs')}><CopyPlus className="size-3.5" />Duplicate</button>
          <button type="button" onClick={onDelete} className={appButton('outline', 'xs', 'text-[#C2412F] dark:text-[#F0826F]')}><Trash2 className="size-3.5" />Delete</button>
          <button type="button" onClick={onToggleHidden} className={appButton('outline', 'xs')}>{allHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}{allHidden ? 'Show' : 'Hide'}</button>
          <button type="button" onClick={onToggleLocked} className={appButton('outline', 'xs')}>{allLocked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}{allLocked ? 'Unlock' : 'Lock'}</button>
        </div>
      </Section>
      <Section title="Line up">
        <AlignRow onAlign={onAlign} />
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" disabled={count < 3} onClick={() => onDistribute('x')} title={count < 3 ? 'Select three or more layers' : undefined} className={appButton('outline', 'xs')}><AlignHorizontalDistributeCenter className="size-3.5" />Space across</button>
          <button type="button" disabled={count < 3} onClick={() => onDistribute('y')} title={count < 3 ? 'Select three or more layers' : undefined} className={appButton('outline', 'xs')}><AlignVerticalDistributeCenter className="size-3.5" />Space down</button>
        </div>
        <button type="button" onClick={onClear} className={appButton('quiet', 'xs', 'w-full')}>Clear selection</button>
      </Section>
    </>
  )
}

function AlignGlyph({ axis, where }) {
  const pos = where === 'start' ? 3 : where === 'center' ? 8 : 13
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {axis === 'x'
        ? <><path d={`M${pos} 2v12`} strokeLinecap="round" /><rect x={where === 'start' ? 4.5 : where === 'center' ? 5 : 5.5} y="5" width="6" height="6" rx="1" fill="currentColor" stroke="none" opacity=".55" /></>
        : <><path d={`M2 ${pos}h12`} strokeLinecap="round" /><rect x="5" y={where === 'start' ? 4.5 : where === 'center' ? 5 : 5.5} width="6" height="6" rx="1" fill="currentColor" stroke="none" opacity=".55" /></>}
    </svg>
  )
}

/** Rarely needed controls: the flow box (max size), a style class and the API key. */
export function AdvancedSection({ node, updateNode, setDynamicKey }) {
  return (
    <Disclosure title="Advanced">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Max W" title="Maximum width while text flows" placeholder="none" value={node.maxWidth} onChange={v => updateNode(node.id, { maxWidth: v ? Math.round(v) : undefined })} />
        <NumberField label="Max H" title="Maximum height while text flows" placeholder="none" value={node.maxHeight} onChange={v => updateNode(node.id, { maxHeight: v ? Math.round(v) : undefined })} />
      </div>
      {node.type !== 'text' && (
        <Field label="Class name" hint="Link this layer to a style from the Styles tab.">
          <TextField placeholder="e.g. .highlight" value={node.className || ''} onChange={e => updateNode(node.id, { className: e.target.value })} />
        </Field>
      )}
      {(node.type === 'text' || node.type === 'image') && (
        <Field label="API key" hint="Name this layer to replace its content when rendering through the API.">
          <input
            key={node.id + (node.dynamic_key || '')}
            type="text"
            placeholder="e.g. headline"
            defaultValue={node.dynamic_key || ''}
            onBlur={e => setDynamicKey(node.id, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className={cn(fieldClass, 'font-mono text-[12px]')}
          />
        </Field>
      )}
    </Disclosure>
  )
}

export function TextProperties({ node, updateNode, canvas, editorRef, savedRangeRef, htmlToTags, editingId }) {
  const meta = FONT_META[node.fontFamily] || null
  const weights = meta?.weights || [300, 400, 500, 600, 700, 800, 900]
  const ts = node.textShadow || { enabled: false, offsetX: 0, offsetY: 4, blur: 12, color: '#00000055' }
  const textClasses = Object.entries(canvas.classes || {}).filter(([, c]) => c.type === 'text' || !c.type)

  const applyTextClassToCanvas = (className) => {
    if (editingId !== node.id) return toast.error('Double-click the text on the canvas, highlight some words, then pick a style')
    const editor = editorRef?.current
    const range = savedRangeRef?.current
    if (!editor) return
    if (!range) return toast.error('Highlight some text on the canvas first')
    editor.focus()
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    const span = document.createElement('span')
    span.className = className.startsWith('.') ? className.slice(1) : className
    try {
      span.appendChild(range.extractContents())
      range.insertNode(span)
      const after = document.createRange()
      after.setStartAfter(span)
      after.collapse(true)
      sel.removeAllRanges()
      sel.addRange(after)
      updateNode(node.id, { text: htmlToTags(editor.innerHTML) })
    } catch {
      toast.error('That style cannot be applied to this selection')
    }
  }

  const clearTextClassFromCanvas = () => {
    if (editingId !== node.id) return toast.error('Double-click the text on the canvas, highlight some words, then clear')
    const editor = editorRef?.current
    const range = savedRangeRef?.current
    if (!editor) return
    if (!range) return toast.error('Highlight some text on the canvas first')
    let modified = false
    if (range.collapsed) {
      let curr = range.startContainer
      if (curr.nodeType === Node.TEXT_NODE) curr = curr.parentNode
      while (curr && curr !== editor) {
        if (curr.tagName === 'SPAN' && curr.className) { curr.removeAttribute('class'); modified = true; break }
        curr = curr.parentNode
      }
    } else {
      for (const span of editor.querySelectorAll('span[class]')) {
        if (range.intersectsNode(span)) { span.removeAttribute('class'); modified = true }
      }
    }
    if (modified) updateNode(node.id, { text: htmlToTags(editor.innerHTML) })
    else toast.error('The selected text has no style')
  }

  const decoration = node.textDecoration || 'none'
  return (
    <>
      <Section title="Content">
        <textarea
          aria-label="Text"
          rows={4}
          className={cn(fieldClass, 'h-auto min-h-[88px] resize-y py-2 leading-relaxed')}
          style={{ fontFamily: `'${node.fontFamily || 'Inter'}', sans-serif` }}
          value={plainTextFromStyled(node.text || '')}
          onChange={e => updateNode(node.id, { text: e.target.value })}
          placeholder="Type your text"
        />
        <p className="-mt-1.5 text-[11.5px] leading-snug text-bk-muted">Editing here keeps plain text. Double-click the text on the canvas to style single words.</p>
        {textClasses.length > 0 && (
          <div data-class-panel className="space-y-2">
            <Field label="Style for the whole text">
              <SelectField
                aria-label="Style for the whole text"
                value={node.className || ''}
                onChange={v => updateNode(node.id, { className: v || undefined })}
                options={[{ value: '', label: 'None' }, ...textClasses.map(([name]) => ({ value: name, label: name.replace(/^\./, '') }))]}
              />
            </Field>
            <div>
              <p className="mb-1 text-[12px] font-semibold text-bk-muted">Style highlighted words</p>
              <div className="flex flex-wrap gap-1">
                {textClasses.map(([name]) => (
                  <button key={name} type="button" onClick={() => applyTextClassToCanvas(name)} className="rounded-md border border-bk-line bg-bk-surface px-2 py-0.5 font-mono text-[11.5px] transition-colors hover:border-bk-fg/50">
                    {name.replace(/^\./, '')}
                  </button>
                ))}
                <button type="button" onClick={clearTextClassFromCanvas} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-semibold text-[#C2412F] hover:bg-[#C2412F]/10 dark:text-[#F0826F]">
                  <X className="size-3" />Clear
                </button>
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Font">
        <SelectField
          aria-label="Font"
          value={node.fontFamily || 'Inter'}
          onChange={fontFamily => updateNode(node.id, { fontFamily })}
          style={{ fontFamily: `'${node.fontFamily || 'Inter'}', sans-serif` }}
          options={fontChoices(node.fontFamily).map(f => ({ value: f, label: f, style: { fontFamily: `'${f}', sans-serif` } }))}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Size" title="Font size" value={node.fontSize || 48} min={4} suffix="px" onChange={v => updateNode(node.id, { fontSize: Math.max(4, Math.round(v || 48)) })} />
          <SelectField
            aria-label="Weight"
            value={String(node.fontWeight || 400)}
            onChange={v => updateNode(node.id, { fontWeight: Number(v) })}
            options={[...new Set([...weights, Number(node.fontWeight || 400)])].sort((a, b) => a - b).map(w => ({ value: String(w), label: WEIGHT_LABELS[w] || String(w) }))}
          />
        </div>
        <div className="flex gap-2">
          <Segmented label="Alignment" className="flex-1" value={node.textAlign || 'left'} onChange={textAlign => updateNode(node.id, { textAlign })} options={ALIGN_OPTIONS} />
          <div className="flex rounded-lg border border-bk-field p-0.5">
            <IconButton label={meta && !meta.italic ? 'This font has no italic' : 'Italic'} side="top" className="size-7" active={node.fontStyle === 'italic'} disabled={!!meta && !meta.italic} onClick={() => updateNode(node.id, { fontStyle: node.fontStyle === 'italic' ? 'normal' : 'italic' })}><Italic /></IconButton>
            <IconButton label="Underline" side="top" className="size-7" active={decoration === 'underline'} onClick={() => updateNode(node.id, { textDecoration: decoration === 'underline' ? 'none' : 'underline' })}><Underline /></IconButton>
            <IconButton label="Strikethrough" side="top" className="size-7" active={decoration === 'line-through'} onClick={() => updateNode(node.id, { textDecoration: decoration === 'line-through' ? 'none' : 'line-through' })}><Strikethrough /></IconButton>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Line" title="Line height" step={0.05} value={node.lineHeight || 1.2} onChange={v => updateNode(node.id, { lineHeight: v || 1.2 })} />
          <NumberField label="Space" title="Letter spacing" value={node.letterSpacing || 0} suffix="px" onChange={v => updateNode(node.id, { letterSpacing: Math.round(v || 0) })} />
        </div>
        <SelectField
          aria-label="Letter case"
          value={node.textTransform || 'none'}
          onChange={textTransform => updateNode(node.id, { textTransform })}
          options={[{ value: 'none', label: 'As typed' }, { value: 'uppercase', label: 'UPPERCASE' }, { value: 'lowercase', label: 'lowercase' }, { value: 'capitalize', label: 'Capitalise Each Word' }]}
        />
      </Section>

      <Section title="Colour">
        <Segmented
          label="Text fill"
          value={node.fillType === 'gradient' ? 'gradient' : 'solid'}
          onChange={fillType => updateNode(node.id, { fillType, textGradient: node.textGradient || DEFAULT_TEXT_GRADIENT })}
          options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]}
        />
        {node.fillType === 'gradient'
          ? <GradientProperties textFill node={{ ...DEFAULT_TEXT_GRADIENT, ...node.textGradient, id: node.id }} updateNode={(id, patch) => updateNode(id, { textGradient: { ...DEFAULT_TEXT_GRADIENT, ...node.textGradient, ...patch } })} />
          : <ColorField label="Text colour" value={node.color || '#000000'} onChange={color => updateNode(node.id, { color })} />}
      </Section>

      <Disclosure title="Shadow" defaultOpen={!!ts.enabled}>
        <Toggle label="Text shadow" checked={!!ts.enabled} onChange={enabled => updateNode(node.id, { textShadow: { ...ts, enabled } })} />
        {ts.enabled && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="X" title="Shadow offset X" value={ts.offsetX || 0} onChange={v => updateNode(node.id, { textShadow: { ...ts, offsetX: Math.round(v || 0) } })} />
              <NumberField label="Y" title="Shadow offset Y" value={ts.offsetY || 0} onChange={v => updateNode(node.id, { textShadow: { ...ts, offsetY: Math.round(v || 0) } })} />
              <NumberField label="Blur" title="Shadow blur" value={ts.blur || 0} onChange={v => updateNode(node.id, { textShadow: { ...ts, blur: Math.max(0, Math.round(v || 0)) } })} />
            </div>
            <ColorField label="Shadow colour" allowTransparent={false} value={ts.color || '#000000'} onChange={color => updateNode(node.id, { textShadow: { ...ts, color } })} />
            <p className="text-[11.5px] text-bk-muted">Use an 8-digit hex such as #00000080 for a softer shadow.</p>
          </>
        )}
      </Disclosure>
    </>
  )
}

export function ImageProperties({ node, updateNode, setCropModeNodeId, onReplace, onReplaceUpload, flowId, uploading }) {
  const f = { ...DEFAULT_FILTERS, ...(node.filters || {}) }
  const setFilter = (key, value) => updateNode(node.id, { filters: { ...f, [key]: value } })
  const fileRef = useRef(null)
  const [source, setSource] = useState(null) // 'gallery' | 'url' | null
  const [url, setUrl] = useState('')
  const mask = node.mask || 'none'
  const crop = ['cropLeft', 'cropRight', 'cropTop', 'cropBottom']
  const setCrop = (key, value) => {
    const opposite = { cropLeft: 'cropRight', cropRight: 'cropLeft', cropTop: 'cropBottom', cropBottom: 'cropTop' }[key]
    if (value + (node[opposite] || 0) < 100) updateNode(node.id, { [key]: value })
  }
  const submitUrl = () => {
    if (!url.trim()) return
    onReplace(url.trim())
    setUrl('')
    setSource(null)
  }

  return (
    <>
      <Section title="Replace image">
        <div className="grid grid-cols-3 gap-1.5">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={appButton('outline', 'xs', 'px-1.5')}>
            <Upload className="size-3.5" />{uploading ? 'Uploading…' : 'Upload'}
          </button>
          <button type="button" onClick={() => setSource(s => (s === 'gallery' ? null : 'gallery'))} disabled={!flowId} title={flowId ? undefined : 'This post is not linked to a brand'} aria-pressed={source === 'gallery'} className={appButton('outline', 'xs', cn('px-1.5', source === 'gallery' && 'border-bk-fg'))}>
            <ImageIcon className="size-3.5" />Gallery
          </button>
          <button type="button" onClick={() => setSource(s => (s === 'url' ? null : 'url'))} aria-pressed={source === 'url'} className={appButton('outline', 'xs', cn('px-1.5', source === 'url' && 'border-bk-fg'))}>
            <LinkIcon className="size-3.5" />Link
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) onReplaceUpload(file); e.target.value = '' }} />
        </div>
        {source === 'gallery' && <GalleryPicker flowId={flowId} onPick={src => { onReplace(src); setSource(null) }} />}
        {source === 'url' && (
          <div className="flex gap-1.5">
            <TextField autoFocus placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitUrl()} aria-label="Image link" />
            <IconButton label="Use this image" onClick={submitUrl} className="border border-bk-field"><Check /></IconButton>
          </div>
        )}
      </Section>

      <Section title="Shape">
        <div className="grid grid-cols-6 gap-1">
          {IMAGE_MASKS.map(({ value, label, css }) => {
            const active = mask === value
            return (
              <button
                key={value}
                type="button"
                title={label}
                aria-label={`Shape: ${label}`}
                aria-pressed={active}
                onClick={() => updateNode(node.id, { mask: value })}
                className={cn('flex aspect-square items-center justify-center rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bk-fg', active ? 'border-bk-fg bg-bk-chip' : 'border-bk-line hover:border-bk-fg/40')}
              >
                <span className="size-[18px] bg-bk-fg/75" style={css} />
              </button>
            )
          })}
        </div>
        {mask === 'none' && <NumberField label="Corners" title="Corner radius" value={node.borderRadius || 0} suffix="px" onChange={v => updateNode(node.id, { borderRadius: Math.max(0, Math.round(v || 0)) })} />}
      </Section>

      <Section title="Crop and flip">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => setCropModeNodeId(node.id)} className={appButton('outline', 'xs')}><Crop className="size-3.5" />Crop on canvas</button>
          <button type="button" onClick={() => updateNode(node.id, { cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 })} disabled={!crop.some(k => node[k])} className={appButton('quiet', 'xs')}>Reset crop</button>
          <button type="button" aria-pressed={!!node.flipX} onClick={() => updateNode(node.id, { flipX: !node.flipX || undefined })} className={appButton('outline', 'xs', node.flipX && 'border-bk-fg bg-bk-chip')}><FlipHorizontal2 className="size-3.5" />Flip across</button>
          <button type="button" aria-pressed={!!node.flipY} onClick={() => updateNode(node.id, { flipY: !node.flipY || undefined })} className={appButton('outline', 'xs', node.flipY && 'border-bk-fg bg-bk-chip')}><FlipVertical2 className="size-3.5" />Flip down</button>
        </div>
        <p className="text-[11.5px] text-bk-muted">To crop, you can also double-click the image (or press Enter), then drag its edges.</p>
      </Section>

      <Disclosure title="Adjust">
        <div className="flex justify-end">
          <button type="button" onClick={() => updateNode(node.id, { filters: { ...DEFAULT_FILTERS } })} className="text-[12px] font-semibold underline underline-offset-4">Reset</button>
        </div>
        <RangeField label="Brightness" value={f.brightness} min={0} max={200} suffix="%" onChange={v => setFilter('brightness', v)} />
        <RangeField label="Contrast" value={f.contrast} min={0} max={200} suffix="%" onChange={v => setFilter('contrast', v)} />
        <RangeField label="Saturation" value={f.saturate} min={0} max={200} suffix="%" onChange={v => setFilter('saturate', v)} />
        <RangeField label="Black & white" value={f.grayscale} min={0} max={100} suffix="%" onChange={v => setFilter('grayscale', v)} />
        <RangeField label="Sepia" value={f.sepia} min={0} max={100} suffix="%" onChange={v => setFilter('sepia', v)} />
        <RangeField label="Hue" value={f.hueRotate} min={0} max={360} suffix="°" onChange={v => setFilter('hueRotate', v)} />
        <RangeField label="Blur" value={f.blur} min={0} max={20} suffix="px" onChange={v => setFilter('blur', v)} />
        <RangeField label="Opacity" value={f.opacity} min={0} max={100} suffix="%" onChange={v => setFilter('opacity', v)} />
      </Disclosure>

      <Disclosure title="Crop precisely">
        {[['cropLeft', 'Left'], ['cropRight', 'Right'], ['cropTop', 'Top'], ['cropBottom', 'Bottom']].map(([key, label]) => (
          <RangeField key={key} label={label} value={node[key] || 0} min={0} max={90} suffix="%" onChange={v => setCrop(key, v)} />
        ))}
      </Disclosure>
    </>
  )
}

export function ShapeProperties({ node, updateNode }) {
  return (
    <Section title="Fill and border">
      <Field label="Fill">
        <ColorField label="Fill colour" value={node.fill || '#6366f1'} onChange={fill => updateNode(node.id, { fill })} />
      </Field>
      <Field label="Border">
        <div className="space-y-2">
          <ColorField label="Border colour" allowTransparent={false} value={node.stroke || '#000000'} onChange={stroke => updateNode(node.id, { stroke })} />
          <NumberField label="Width" title="Border width" value={node.strokeWidth || 0} suffix="px" onChange={v => updateNode(node.id, { strokeWidth: Math.max(0, Math.round(v || 0)) })} />
        </div>
      </Field>
      {node.shape === 'rect' && <NumberField label="Corners" title="Corner radius" value={node.borderRadius || 0} suffix="px" onChange={v => updateNode(node.id, { borderRadius: Math.max(0, Math.round(v || 0)) })} />}
    </Section>
  )
}

/** Gradient editing for gradient layers, and for gradient text fills (textFill). */
export function GradientProperties({ node, updateNode, textFill = false }) {
  const stops = node.stops || []
  const radial = node.gradientType === 'radial'
  const addStop = () => {
    const ordered = [...stops].sort((a, b) => a.position - b.position)
    let position = 50, largestGap = -1
    for (let i = 1; i < ordered.length; i++) {
      const gap = ordered[i].position - ordered[i - 1].position
      if (gap > largestGap) { largestGap = gap; position = (ordered[i].position + ordered[i - 1].position) / 2 }
    }
    updateNode(node.id, { stops: [...stops, { color: '#ffffff', position, alpha: 100 }] })
  }
  const removeStop = (idx) => {
    if (stops.length <= 2) return toast.error('A gradient needs at least two colours')
    updateNode(node.id, { stops: stops.filter((_, i) => i !== idx) })
  }
  const updateStop = (idx, patch) => updateNode(node.id, { stops: stops.map((s, i) => (i === idx ? { ...s, ...patch } : s)) })
  const applyPreset = (preset) => updateNode(node.id, {
    stops: preset.stops,
    angle: preset.angle,
    gradientType: preset.gradientType || 'linear',
    ...(preset.gradientType === 'radial' ? { radialShape: preset.radialShape || 'circle', focalX: preset.focalX ?? 50, focalY: preset.focalY ?? 50 } : {}),
  })

  const body = (
    <>
      <div className="relative h-12 overflow-hidden rounded-lg border border-bk-line" style={{ background: CHECKER }}>
        <div className="absolute inset-0" style={{ backgroundImage: textFill ? buildTextGradientCss(node) : buildGradientCssClient(node) }} />
      </div>
      <Segmented label="Gradient type" value={radial ? 'radial' : 'linear'} onChange={gradientType => updateNode(node.id, { gradientType })} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} />
      {!radial && <RangeField label="Angle" value={node.angle ?? 90} min={0} max={360} suffix="°" onChange={angle => updateNode(node.id, { angle })} />}
      {radial && (
        <>
          <RangeField label="Centre across" value={node.focalX ?? 50} suffix="%" onChange={focalX => updateNode(node.id, { focalX })} />
          <RangeField label="Centre down" value={node.focalY ?? 50} suffix="%" onChange={focalY => updateNode(node.id, { focalY })} />
        </>
      )}
      {!textFill && !radial && (
        <div className="grid grid-cols-2 gap-2">
          <SelectField aria-label="Gradient shape" value={node.shape || 'rect'} onChange={shape => updateNode(node.id, { shape })} options={[{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }]} />
          {node.shape !== 'ellipse' && <NumberField label="Corners" title="Corner radius" value={node.borderRadius || 0} onChange={v => updateNode(node.id, { borderRadius: Math.max(0, Math.round(v || 0)) })} />}
        </div>
      )}
      {textFill && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Spread" title="Gradient spread" value={node.spread ?? 100} suffix="%" onChange={v => updateNode(node.id, { spread: Math.max(1, Math.min(200, Number(v) || 1)) })} />
            <SelectField aria-label="Spread behaviour" value={node.spreadMethod || 'pad'} onChange={spreadMethod => updateNode(node.id, { spreadMethod })} options={[{ value: 'pad', label: 'Extend edges' }, { value: 'repeat', label: 'Repeat' }, { value: 'reflect', label: 'Reflect' }]} />
          </div>
          {radial && <SelectField aria-label="Radial shape" value={node.radialShape || 'circle'} onChange={radialShape => updateNode(node.id, { radialShape })} options={[{ value: 'circle', label: 'Circle' }, { value: 'ellipse', label: 'Ellipse' }]} />}
          <div className="flex gap-1.5">
            <button type="button" className={appButton('outline', 'xs', 'flex-1')} onClick={() => updateNode(node.id, { stops: [...stops].reverse().map(s => ({ ...s, position: 100 - s.position })) })}>Reverse</button>
            <button type="button" className={appButton('outline', 'xs', 'flex-1')} onClick={() => updateNode(node.id, { stops: [...stops].sort((a, b) => a.position - b.position).map((s, i) => ({ ...s, position: i * 100 / (stops.length - 1) })) })}>Space evenly</button>
          </div>
        </>
      )}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-bk-muted">Colours</span>
          <button type="button" onClick={addStop} className="inline-flex items-center gap-1 text-[12px] font-semibold hover:underline"><Plus className="size-3.5" />Add</button>
        </div>
        <ul className="space-y-2">
          {stops.map((stop, i) => (
            <li key={i} className="space-y-1.5 rounded-lg border border-bk-line p-2">
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1"><ColorField label={`Colour ${i + 1}`} allowTransparent={false} value={stop.color} onChange={color => updateStop(i, { color })} /></div>
                <NumberField label="" title={`Colour ${i + 1} position`} className="w-[62px] shrink-0" value={stop.position} min={0} max={100} step={0.1} suffix="%" onChange={v => updateStop(i, { position: Math.max(0, Math.min(100, Number(v) || 0)) })} />
                <IconButton label={`Remove colour ${i + 1}`} tone="danger" disabled={stops.length <= 2} onClick={() => removeStop(i)} className="size-7"><Trash2 /></IconButton>
              </div>
              <RangeField label="Opacity" value={typeof stop.alpha === 'number' ? stop.alpha : 100} suffix="%" onChange={alpha => updateStop(i, { alpha })} />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-bk-muted">Presets</p>
        <div className="grid grid-cols-6 gap-1">
          {GRADIENT_PRESETS.map(p => (
            <button key={p.name} type="button" title={p.name} aria-label={`Preset: ${p.name}`} onClick={() => applyPreset(p)} className="relative aspect-square overflow-hidden rounded-md border border-bk-line transition-transform hover:scale-105" style={{ background: CHECKER }}>
              <span className="absolute inset-0" style={{ backgroundImage: buildGradientCssClient({ stops: p.stops, angle: p.angle, gradientType: p.gradientType || 'linear', focalX: p.focalX, focalY: p.focalY }) }} />
            </button>
          ))}
        </div>
      </div>
    </>
  )
  return textFill ? <div className="space-y-3">{body}</div> : <Section title="Gradient">{body}</Section>
}

export function GroupProperties({ group, nodes, selectedIds, updateGroup, updateGroupGap, ungroupById, moveGroupMember }) {
  const gaps = normalizeGroupGaps(group)
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const orderNodeId = selectedIds?.length === 1 && group.nodeIds.includes(selectedIds[0]) ? selectedIds[0] : null
  const orderIdx = orderNodeId != null ? group.nodeIds.indexOf(orderNodeId) : -1
  const vertical = group.layout === 'vertical'

  return (
    <>
      <Section title="Group" action={<IconButton label="Ungroup" onClick={() => ungroupById(group.id)}><Unlink /></IconButton>}>
        <Field label="Name">
          <TextField value={group.name} onChange={e => updateGroup(group.id, { name: e.target.value })} />
        </Field>
        <Field label="Stack">
          <Segmented
            label="Stack direction"
            value={vertical ? 'vertical' : 'horizontal'}
            onChange={layout => updateGroup(group.id, { layout })}
            options={[{ value: 'horizontal', label: 'Side by side', icon: ArrowRight, text: 'Across' }, { value: 'vertical', label: 'On top of each other', icon: ArrowDown, text: 'Down' }]}
          />
        </Field>
        <Field label={vertical ? 'Line up across' : 'Line up down'}>
          <SelectField
            aria-label="Line up items"
            value={group.align || 'free'}
            onChange={align => updateGroup(group.id, { align })}
            options={[
              { value: 'free', label: 'Free (keep positions)' },
              { value: 'left', label: vertical ? 'Left' : 'Top' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: vertical ? 'Right' : 'Bottom' },
            ]}
          />
        </Field>
        {orderNodeId && (
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" className={appButton('outline', 'xs')} disabled={orderIdx <= 0} onClick={() => moveGroupMember(group.id, orderNodeId, 'up')}>Move earlier</button>
            <button type="button" className={appButton('outline', 'xs')} disabled={orderIdx < 0 || orderIdx >= group.nodeIds.length - 1} onClick={() => moveGroupMember(group.id, orderNodeId, 'down')}>Move later</button>
          </div>
        )}
      </Section>
      <Section title="Spacing">
        <p className="-mt-1 text-[11.5px] text-bk-muted">The first item stays put; the rest move to keep these gaps.</p>
        {gaps.map((gap, i) => {
          const a = nodeMap.get(group.nodeIds[i])
          const b = nodeMap.get(group.nodeIds[i + 1])
          return (
            <div key={i} className="space-y-1.5">
              <p className="truncate text-[12px] text-bk-muted">{a ? nodeLayerLabel(a).slice(0, 16) : '?'} → {b ? nodeLayerLabel(b).slice(0, 16) : '?'}</p>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="X" title="Gap across" value={gap.gapX ?? 0} onChange={v => updateGroupGap(group.id, i, 'gapX', Number(v) || 0)} />
                <NumberField label="Y" title="Gap down" value={gap.gapY ?? 0} onChange={v => updateGroupGap(group.id, i, 'gapY', Number(v) || 0)} />
              </div>
            </div>
          )
        })}
      </Section>
    </>
  )
}
