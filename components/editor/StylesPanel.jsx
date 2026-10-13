'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { resolveCanvasClass } from '@/lib/styleParser'
import { ColorField, Disclosure, Field, IconButton, NumberField, Section, SelectField, TextField, Toggle } from './controls'

const TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
  { value: 'shape', label: 'Shape' },
  { value: 'gradient', label: 'Gradient' },
]

/**
 * Reusable styles ("classes") for the open slide. Text styles can be applied to single words:
 * double-click text on the canvas, highlight words, then pick the style.
 */
export function StylesPanel({ canvas, setCanvas }) {
  const classes = canvas.classes || {}
  const [name, setName] = useState('')
  const [type, setType] = useState('text')

  const addClass = () => {
    let key = name.trim()
    if (!key) return
    if (!key.startsWith('.')) key = '.' + key
    if (resolveCanvasClass(classes, key)) return toast.error('A style with that name already exists')
    const defaults = { type }
    if (type === 'image') defaults.filters = {}
    if (type === 'gradient') defaults.stops = [{ color: '#6366f1', position: 0, alpha: 100 }, { color: '#ec4899', position: 100, alpha: 100 }]
    setCanvas(c => ({ ...c, classes: { ...(c.classes || {}), [key]: defaults } }))
    setName('')
  }

  const removeClass = key => setCanvas(c => {
    const next = { ...(c.classes || {}) }
    delete next[key]
    return { ...c, classes: next }
  })

  const updateClass = (key, field, value) => setCanvas(c => {
    const current = { ...((c.classes || {})[key] || {}) }
    if (value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value))) delete current[field]
    else current[field] = value
    return { ...c, classes: { ...(c.classes || {}), [key]: current } }
  })

  const keys = Object.keys(classes)
  return (
    <>
      <Section title="New style">
        <p className="-mt-1 text-[12px] leading-snug text-bk-muted">Save a look once and reuse it. Text styles can colour or highlight single words.</p>
        <div className="flex gap-1.5">
          <SelectField aria-label="Style type" className="w-[92px] shrink-0" value={type} onChange={setType} options={TYPES} />
          <TextField aria-label="Style name" placeholder="highlight" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addClass()} />
          <IconButton label="Add style" onClick={addClass} disabled={!name.trim()} className="border border-bk-field"><Plus /></IconButton>
        </div>
      </Section>
      {keys.length === 0 ? (
        <p className="border-t border-bk-line px-4 py-6 text-center text-[12.5px] text-bk-muted">No styles on this {canvas._pageId ? 'slide' : 'post'} yet.</p>
      ) : keys.map(key => (
        <ClassEditor key={key} name={key} cls={classes[key] || {}} onRemove={() => removeClass(key)} onChange={(field, value) => updateClass(key, field, value)} />
      ))}
    </>
  )
}

function ClassEditor({ name, cls, onRemove, onChange }) {
  const type = cls.type || 'text'
  const num = v => (v === undefined ? undefined : Number(v))
  return (
    <Disclosure title={<span className="flex items-center gap-2 normal-case tracking-normal"><span className="font-mono text-[12.5px] text-bk-fg">{name.replace(/^\./, '')}</span><span className="rounded bg-bk-chip px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em]">{type}</span></span>}>
      {type === 'text' && (
        <>
          <Field label="Text colour"><ColorField label="Text colour" value={cls.color || '#000000'} onChange={v => onChange('color', v)} /></Field>
          <Field label="Highlight" hint="A background shows behind the words; add padding to make it a box.">
            <ColorField label="Highlight colour" value={cls.background || cls.backgroundColor || 'transparent'} onChange={v => onChange('background', v === 'transparent' ? undefined : v)} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="X" title="Padding across" min={0} value={cls.paddingX} placeholder="0" onChange={v => onChange('paddingX', v === undefined ? undefined : Math.max(0, num(v)))} />
            <NumberField label="Y" title="Padding down" min={0} value={cls.paddingY} placeholder="0" onChange={v => onChange('paddingY', v === undefined ? undefined : Math.max(0, num(v)))} />
            <NumberField label="R" title="Corner radius" value={cls.borderRadius} placeholder="0" onChange={v => onChange('borderRadius', v === undefined ? undefined : Math.round(v))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SelectField aria-label="Line" value={cls.textDecoration || 'none'} onChange={v => onChange('textDecoration', v)} options={[{ value: 'none', label: 'No line' }, { value: 'underline', label: 'Underline' }, { value: 'line-through', label: 'Strikethrough' }]} />
            <SelectField aria-label="Letter case" value={cls.textTransform || 'none'} onChange={v => onChange('textTransform', v)} options={[{ value: 'none', label: 'As typed' }, { value: 'uppercase', label: 'UPPERCASE' }, { value: 'lowercase', label: 'lowercase' }, { value: 'capitalize', label: 'Capitalise' }]} />
          </div>
          <NumberField label="Space" title="Letter spacing" value={cls.letterSpacing} placeholder="0" suffix="px" onChange={v => onChange('letterSpacing', v)} />
          <Toggle label="Highlight shadow" checked={!!cls.boxShadow?.enabled} onChange={enabled => onChange('boxShadow', { ...(cls.boxShadow || {}), enabled })} />
          {cls.boxShadow?.enabled && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <NumberField label="X" title="Shadow offset X" value={cls.boxShadow.offsetX || 0} onChange={v => onChange('boxShadow', { ...cls.boxShadow, offsetX: Math.round(v || 0) })} />
                <NumberField label="Y" title="Shadow offset Y" value={cls.boxShadow.offsetY || 0} onChange={v => onChange('boxShadow', { ...cls.boxShadow, offsetY: Math.round(v || 0) })} />
                <NumberField label="Blur" title="Shadow blur" value={cls.boxShadow.blur || 0} onChange={v => onChange('boxShadow', { ...cls.boxShadow, blur: Math.round(v || 0) })} />
              </div>
              <ColorField label="Shadow colour" allowTransparent={false} value={(cls.boxShadow.color || '#000000').slice(0, 7)} onChange={v => onChange('boxShadow', { ...cls.boxShadow, color: v })} />
            </>
          )}
        </>
      )}
      {type === 'image' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <SelectField aria-label="Mask" value={cls.mask || 'none'} onChange={v => onChange('mask', v)} options={[{ value: 'none', label: 'No mask' }, { value: 'circle', label: 'Circle' }, { value: 'pill', label: 'Pill' }, { value: 'rounded', label: 'Rounded' }, { value: 'soft', label: 'Soft' }]} />
            <NumberField label="R" title="Corner radius" value={cls.borderRadius} placeholder="0" onChange={v => onChange('borderRadius', v === undefined ? undefined : Math.round(v))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[['brightness', 'Bright', 100], ['contrast', 'Contr.', 100], ['saturate', 'Sat.', 100], ['sepia', 'Sepia', 0]].map(([key, label, base]) => (
              <NumberField key={key} label={label} title={key} suffix="%" value={cls.filters?.[key]} placeholder={String(base)} onChange={v => onChange('filters', { ...(cls.filters || {}), [key]: v === undefined ? undefined : Math.round(v) })} />
            ))}
          </div>
        </>
      )}
      {type === 'shape' && (
        <>
          <Field label="Fill"><ColorField label="Fill colour" value={cls.fill || '#6366f1'} onChange={v => onChange('fill', v)} /></Field>
          <Field label="Border"><ColorField label="Border colour" allowTransparent={false} value={cls.stroke || '#000000'} onChange={v => onChange('stroke', v)} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Width" title="Border width" value={cls.strokeWidth} placeholder="0" onChange={v => onChange('strokeWidth', v === undefined ? undefined : Math.round(v))} />
            <NumberField label="R" title="Corner radius" value={cls.borderRadius} placeholder="0" onChange={v => onChange('borderRadius', v === undefined ? undefined : Math.round(v))} />
          </div>
        </>
      )}
      {type === 'gradient' && (
        <div className="grid grid-cols-2 gap-2">
          <SelectField aria-label="Gradient type" value={cls.gradientType || 'linear'} onChange={v => onChange('gradientType', v)} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} />
          <NumberField label="Angle" value={cls.angle ?? 90} suffix="°" onChange={v => onChange('angle', v === undefined ? undefined : Math.round(v))} />
        </div>
      )}
      <button type="button" onClick={onRemove} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#C2412F] hover:underline dark:text-[#F0826F]">
        <Trash2 className="size-3.5" />Delete style
      </button>
    </Disclosure>
  )
}
