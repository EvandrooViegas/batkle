'use client'

import { useId } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { COMPOSITIONS, COLOR_ROLES, DECORATION_KINDS } from '@/lib/designs/global/types'
import { familyGrammar, familyImagery } from '@/lib/designs/global/study'
import { appButton, panelClass } from '@/components/app/ui'
import { appField } from '@/components/app/field'
import { cn } from '@/lib/utils'

// Plain names for the study's values. The grammar keeps its own terms; people see these.
const IMAGERY = [
  ['none', 'No photos', 'Type, colour and shapes only'],
  ['background', 'Photo fills the slide', 'The copy sits over the photo'],
  ['fullBleed', 'Large photos', 'Running off the edges beside the copy'],
  ['cutout', 'Cut-out subjects', 'People or objects with no background'],
  ['contained', 'Photos in frames', 'Inside shapes in the layout'],
  ['collage', 'Collage', 'Several photos together'],
  ['mixed', 'Mixed', 'Changes from slide to slide'],
  ['other', 'Other', 'None of these'],
]
export const imageryLabel = mode => IMAGERY.find(([key]) => key === mode)?.[1] || mode
const LAYOUTS = {
  statement: ['Statement', 'One big headline'], stacked: ['Stacked', 'Headline and copy, top to bottom'], split: ['Split', 'Photo on one side, copy on the other'],
  'image-led': ['Photo-led', 'A photo fills the slide'], 'backdrop-type': ['Big word behind', 'A huge faint word under the copy'],
  list: ['List', 'Points with markers'], closing: ['Closing', 'A sign-off slide'],
}
const ROLES = { surface: 'Background', tint: 'Tint of the main colour', light: 'Brand light', dark: 'Brand dark', primary: 'Main colour', accent: 'Accent', foreground: 'Text colour', white: 'White' }
const DECORATIONS = { oversizedType: 'Big faint type', ring: 'Ring', circle: 'Circle', arc: 'Arc', line: 'Accent line', dotGrid: 'Dot grid', pill: 'Pill around the label', cornerBlock: 'Corner block', frame: 'Border around the slide', glow: 'Glow' }
const CORNERS = [['top-left', 'Top left'], ['top-center', 'Top centre'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right']]
const BLANK_STUDY = { personality: '', composition: '', spaceDensity: '', typography: '', colorContrast: '', colorRoles: { background: '', foreground: '', accent: '', decoration: '' }, decorative: '', hierarchy: '', logoPlacement: '', distinctive: [], familyRules: [], variantRules: [], avoid: [] }
const textArea = appField('h-auto py-2.5 text-[14px] leading-relaxed')

/** A titled card of settings. */
function Group({ title, hint, children }) {
  return (
    <section className={cn(panelClass, 'space-y-5 p-4 sm:p-5')}>
      <div>
        <h3 className="text-[15px] font-bold">{title}</h3>
        {hint && <p className="mt-0.5 text-[12.5px] leading-relaxed text-bk-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Setting({ id, label, hint, children, className = '' }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p id={id} className="text-[13px] font-bold">{label}</p>
      {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-bk-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  )
}

/** One of a few options, as a segmented row. `wide` gives a long row the full width of a two-column grid. */
function Choice({ label, hint, value, options, onChange, wide = false }) {
  const id = useId()
  return (
    <Setting id={id} label={label} hint={hint} className={wide ? 'sm:col-span-2' : ''}>
      <div role="radiogroup" aria-labelledby={id} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-bk-alt p-1">
        {options.map(([key, text]) => (
          <button key={key} type="button" role="radio" aria-checked={value === key} onClick={() => onChange(key)}
            className={cn('h-8 rounded-lg px-3 text-[13px] font-semibold transition-colors focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:outline-bk-fg', value === key ? 'bg-bk-surface text-bk-fg shadow-bk-card' : 'text-bk-muted hover:text-bk-fg')}>
            {text}
          </button>
        ))}
      </div>
    </Setting>
  )
}

/** Several options that can be on together. With `ordered`, the first one picked is the one used most. */
function Toggles({ label, hint, value, options, onChange, ordered = false, allowNone = false }) {
  const id = useId()
  const toggle = key => {
    const next = value.includes(key) ? value.filter(v => v !== key) : [...value, key]
    if (next.length || allowNone) onChange(next)
  }
  return (
    <Setting id={id} label={label} hint={hint}>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {options.map(([key, text, sub]) => {
          const on = value.includes(key)
          return (
            <button key={key} type="button" aria-pressed={on} onClick={() => toggle(key)}
              className={cn('rounded-lg border px-3 py-1.5 text-left transition-colors focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bk-fg', on ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-field text-bk-fg hover:border-bk-fg/50')}>
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                {text}
                {ordered && on && value.length > 1 && value[0] === key && <span className="rounded bg-bk-butter px-1 text-[10.5px] font-bold text-bk-ink">Most used</span>}
              </span>
              {sub && <span className={cn('block text-[11.5px]', on ? 'text-bk-bg/70' : 'text-bk-muted')}>{sub}</span>}
            </button>
          )
        })}
      </div>
    </Setting>
  )
}

function RoleSelect({ label, value, onChange, roles = COLOR_ROLES }) {
  return (
    <label className="block min-w-0">
      <span className="text-[13px] font-bold">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className={appField('mt-2 h-9 text-[13.5px]')}>
        {roles.map(role => <option key={role} value={role}>{ROLES[role] || role}</option>)}
      </select>
    </label>
  )
}

/** A corner of the slide, picked on a small slide, or none. */
function Corner({ label, value, onChange }) {
  const id = useId()
  const dot = (key, text) => (
    <button key={key} type="button" role="radio" aria-checked={value === key} aria-label={text} title={text} onClick={() => onChange(key)}
      className="group flex size-7 items-center justify-center rounded-md focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:outline-bk-fg">
      <span className={cn('size-3.5 rounded-full transition-colors', value === key ? 'bg-bk-fg' : 'bg-bk-field group-hover:bg-bk-fg/40')} />
    </button>
  )
  return (
    <Setting id={id} label={label}>
      <div role="radiogroup" aria-labelledby={id} className="flex items-center gap-3">
        <div className="flex h-[104px] w-[84px] flex-col justify-between rounded-lg bg-bk-alt p-1">
          <div className="flex justify-between">{CORNERS.slice(0, 3).map(([key, text]) => dot(key, text))}</div>
          <div className="flex justify-between">{CORNERS.slice(3).map(([key, text]) => dot(key, text))}</div>
        </div>
        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold">{value === 'none' ? 'Not shown' : CORNERS.find(([key]) => key === value)?.[1]}</p>
          <button type="button" role="radio" aria-checked={value === 'none'} onClick={() => onChange('none')} className={appButton(value === 'none' ? 'ink' : 'outline', 'xs')}>Don’t show</button>
        </div>
      </div>
    </Setting>
  )
}

/** How the headline sits: plain, in an outlined box, or on a filled panel, each drawn as it looks. */
function HeadlineBox({ value, onChange }) {
  const id = useId()
  const options = [
    ['none', 'Plain', <span key="none" className="font-black">Aa</span>],
    ['outline', 'Outlined box', <span key="outline" className="border-2 border-current px-1.5 font-black">Aa</span>],
    ['solid', 'On a panel', <span key="solid" className="bg-bk-butter px-1.5 font-black text-bk-ink">Aa</span>],
  ]
  return (
    <Setting id={id} label="Behind the headline" hint="A panel or box the headline sits in.">
      <div role="radiogroup" aria-labelledby={id} className="grid max-w-[420px] grid-cols-3 gap-2">
        {options.map(([key, text, look]) => (
          <button key={key} type="button" role="radio" aria-checked={value === key} onClick={() => onChange(key)}
            className={cn('flex flex-col items-center gap-2 rounded-xl border p-3 text-[12.5px] font-semibold transition-colors', value === key ? 'border-bk-fg bg-bk-alt' : 'border-bk-field hover:border-bk-fg/50')}>
            <span className="flex h-9 items-center text-[20px] leading-none">{look}</span>{text}
          </button>
        ))}
      </div>
    </Setting>
  )
}

function Text({ label, hint, value, onChange, rows = 3 }) {
  return (
    <label className="block">
      <span className="text-[13px] font-bold">{label}</span>
      {hint && <span className="mt-0.5 block text-[12px] text-bk-muted">{hint}</span>}
      <textarea rows={rows} value={value || ''} onChange={e => onChange(e.target.value)} className={cn(textArea, 'mt-2')} />
    </label>
  )
}
// One item per line; a blank line is kept while typing and dropped when saved.
function Lines({ label, hint, value, onChange }) {
  return (
    <label className="block">
      <span className="text-[13px] font-bold">{label}</span>
      {hint && <span className="mt-0.5 block text-[12px] text-bk-muted">{hint}</span>}
      <textarea rows={4} value={(value || []).join('\n')} onChange={e => onChange(e.target.value.split('\n').map(s => s.trimStart()).filter((s, i, all) => s || i === all.length - 1).slice(0, 16))} className={cn(textArea, 'mt-2')} />
    </label>
  )
}

/**
 * Editable, brand-agnostic design study. `view="look"` holds what the composer draws (the grammar and the imagery
 * type), `view="notes"` the written study the AI reads when it plans posts.
 */
export default function DesignStudyEditor({ family, onChange, view = 'look' }) {
  const study = { ...BLANK_STUDY, ...family.study, imagery: familyImagery(family), grammar: familyGrammar(family) }
  const g = study.grammar
  const set = patch => onChange({ ...family, study: { ...study, ...patch } })
  const setGrammar = patch => set({ grammar: { ...g, ...patch } })
  const setImagery = patch => set({ imagery: { ...study.imagery, ...patch } })
  const headline = patch => setGrammar({ headline: { ...g.headline, ...patch } })
  const photos = patch => setGrammar({ imagery: { ...g.imagery, ...patch } })
  const decorations = g.decorations || []
  const setDecoration = (i, patch) => setGrammar({ decorations: decorations.map((d, j) => j === i ? { ...d, ...patch } : d) })
  // Slides that follow an example only box their headline, or card their copy, when that example did. Picking a box or
  // cards when no example had one applies it to them all; otherwise the choice would change nothing.
  const setFrame = frame => setGrammar({ headline: { ...g.headline, frame }, references: frame !== 'none' && !g.references.some(r => r.frame) ? g.references.map(r => ({ ...r, frame: true })) : g.references })
  const setCardUse = use => setGrammar({ containers: { ...g.containers, use }, references: use.includes('callout') && !g.references.some(r => r.callout) ? g.references.map(r => ({ ...r, callout: true })) : g.references })

  if (view === 'notes') return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-bk-muted">Batkle’s AI reads these notes when it writes and plans posts in this design. The look itself is set in the Look tab.</p>
      {!family.study && <p className="rounded-xl bg-bk-alt p-3 text-[13px]">This design was saved before written studies. Fill these in, or use “Study again”.</p>}
      <Group title="The idea">
        <Text label="Personality" hint="How the design feels, in a sentence or two." value={study.personality} onChange={v => set({ personality: v })} />
        <Lines label="What makes it recognisable" hint="One per line." value={study.distinctive} onChange={v => set({ distinctive: v })} />
      </Group>
      <Group title="Rules" hint="One per line. Brand colours, fonts and logo always come from each brand, so leave them out.">
        <Lines label="Always" hint="What every post in this design keeps." value={study.familyRules} onChange={v => set({ familyRules: v })} />
        <Lines label="Can change" hint="What may vary from slide to slide, and how far." value={study.variantRules} onChange={v => set({ variantRules: v })} />
        <Lines label="Never" hint="What would break the design." value={study.avoid} onChange={v => set({ avoid: v })} />
      </Group>
      <Group title="Descriptions">
        <Text label="Layout" value={study.composition} onChange={v => set({ composition: v })} />
        <Text label="What reads first" value={study.hierarchy} onChange={v => set({ hierarchy: v })} />
        <Text label="Type" value={study.typography} onChange={v => set({ typography: v })} />
        <Text label="Colour and contrast" value={study.colorContrast} onChange={v => set({ colorContrast: v })} />
        <div className="grid gap-4 sm:grid-cols-2">
          {[['background', 'Background colour'], ['foreground', 'Text colour'], ['accent', 'Accent colour'], ['decoration', 'Decoration colour']].map(([role, label]) => <Text key={role} label={label} rows={2} value={study.colorRoles?.[role]} onChange={v => set({ colorRoles: { ...study.colorRoles, [role]: v } })} />)}
        </div>
        <Text label="Space" value={study.spaceDensity} onChange={v => set({ spaceDensity: v })} />
        <Text label="Decoration" value={study.decorative} onChange={v => set({ decorative: v })} />
        <Text label="Logo" rows={2} value={study.logoPlacement} onChange={v => set({ logoPlacement: v })} />
        {study.imagery.mode !== 'none' && (
          <div className="grid gap-4 sm:grid-cols-2">
            {[['usage', 'How photos are used'], ['placement', 'Where they go'], ['cropBehavior', 'Cropping'], ['textRelationship', 'Photos and copy'], ['overlayTreatment', 'Shading'], ['frequency', 'How often']].map(([key, label]) => <Text key={key} label={label} rows={2} value={study.imagery[key]} onChange={v => setImagery({ [key]: v })} />)}
          </div>
        )}
      </Group>
    </div>
  )

  return (
    <div className="space-y-4">
      {!family.study && <p className="rounded-xl bg-bk-alt p-3 text-[13px]">This design was saved before structured studies. These settings were worked out from its layouts; save to keep them, or use “Study again”.</p>}

      <Group title="Layout" hint="How slides are arranged. Each post mixes the layouts you allow.">
        <Toggles label="Slide layouts" value={g.compositions} options={COMPOSITIONS.map(c => [c, ...LAYOUTS[c]])} onChange={v => setGrammar({ compositions: v })} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Toggles ordered label="Copy alignment" value={g.alignment} options={[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} onChange={v => setGrammar({ alignment: v })} />
          <Toggles ordered label="Copy position" value={g.anchors} options={[['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']]} onChange={v => setGrammar({ anchors: v })} />
          <Choice label="Margins" value={g.margin} options={[['tight', 'Tight'], ['standard', 'Standard'], ['generous', 'Roomy']]} onChange={v => setGrammar({ margin: v })} />
          <Choice label="Space between copy" value={g.density} options={[['airy', 'Airy'], ['balanced', 'Balanced'], ['dense', 'Dense']]} onChange={v => setGrammar({ density: v })} />
        </div>
      </Group>

      <Group title="Headline">
        <HeadlineBox value={g.headline.frame || 'none'} onChange={setFrame} />
        {g.headline.frame === 'solid' && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Choice label="Panel outline" hint="Cards get the same line." value={g.panel?.outline ? 'line' : 'none'} options={[['none', 'None'], ['line', 'Thin dark line']]} onChange={v => setGrammar({ panel: { offset: 'none', ...g.panel, outline: v === 'line' } })} />
            <Choice label="Block behind the panel" hint="Offset down and to the right." value={g.panel?.offset || 'none'} options={[['none', 'None'], ['block', 'Solid'], ['outline', 'Outline only']]} onChange={v => setGrammar({ panel: { outline: false, ...g.panel, offset: v } })} />
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Choice label="Size" value={g.headline.scale} options={[['medium', 'Medium'], ['large', 'Large'], ['veryLarge', 'Very large'], ['oversized', 'Huge']]} onChange={v => headline({ scale: v })} />
          <Choice label="Weight" value={g.headline.weight} options={[['regular', 'Regular'], ['bold', 'Bold'], ['black', 'Extra bold']]} onChange={v => headline({ weight: v })} />
          <Choice label="Capitals" value={g.headline.case} options={[['none', 'As written'], ['uppercase', 'ALL CAPS']]} onChange={v => headline({ case: v })} />
          <Choice label="Letter spacing" value={g.headline.tracking} options={[['tight', 'Tight'], ['normal', 'Normal'], ['wide', 'Wide']]} onChange={v => headline({ tracking: v })} />
          <Choice label="Line spacing" value={g.headline.leading} options={[['tight', 'Tight'], ['normal', 'Normal'], ['loose', 'Loose']]} onChange={v => headline({ leading: v })} />
          <Choice wide label="Highlighted words" hint="One or two key words stand out." value={g.emphasis} options={[['none', 'None'], ['color', 'In colour'], ['background', 'Marker'], ['underline', 'Underlined']]} onChange={v => setGrammar({ emphasis: v })} />
          <Choice label="Fill" value={g.headline.fill} options={[['solid', 'One colour'], ['gradient', 'Gradient']]} onChange={v => headline({ fill: v })} />
        </div>
        {g.headline.fill === 'gradient' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <RoleSelect label="Gradient from" value={g.headline.gradient.from} onChange={v => headline({ gradient: { ...g.headline.gradient, from: v } })} />
            <RoleSelect label="Gradient to" value={g.headline.gradient.to} onChange={v => headline({ gradient: { ...g.headline.gradient, to: v } })} />
          </div>
        )}
      </Group>

      <Group title="Copy, cards and lists">
        <Choice label="Supporting copy size" value={g.body.scale} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} onChange={v => setGrammar({ body: { scale: v } })} />
        <Choice label="Cards" hint="Boxes that hold copy, list items or the website." value={g.containers.style} options={[['none', 'No cards'], ['card', 'Filled'], ['outline', 'Outlined'], ['glass', 'Frosted']]} onChange={v => setGrammar({ containers: { ...g.containers, style: v } })} />
        {g.containers.style !== 'none' && <>
          <Toggles allowNone label="Cards hold" value={g.containers.use} options={[['callout', 'Supporting copy'], ['list', 'List items'], ['label', 'Labels'], ['handle', 'Website']]} onChange={setCardUse} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Choice label="Card corners" value={g.containers.radius} options={[['small', 'Slight'], ['medium', 'Rounded'], ['large', 'Very round'], ['pill', 'Pill']]} onChange={v => setGrammar({ containers: { ...g.containers, radius: v } })} />
            <RoleSelect label="Card colour" value={g.containers.fill} onChange={v => setGrammar({ containers: { ...g.containers, fill: v } })} />
          </div>
        </>}
        <div className="grid gap-5 sm:grid-cols-2">
          <Choice label="List markers" value={g.list.marker} options={[['number', '1 2 3'], ['check', '✓'], ['arrow', '→'], ['dot', '•']]} onChange={v => setGrammar({ list: { ...g.list, marker: v } })} />
          <Choice label="Marker shape" value={g.list.shape} options={[['circle', 'Circle'], ['square', 'Square'], ['none', 'None']]} onChange={v => setGrammar({ list: { ...g.list, shape: v } })} />
          <Choice label="Marker fill" value={g.list.fill} options={[['solid', 'Filled'], ['outline', 'Outlined']]} onChange={v => setGrammar({ list: { ...g.list, fill: v } })} />
          <RoleSelect label="Marker colour" value={g.list.color} onChange={v => setGrammar({ list: { ...g.list, color: v } })} />
        </div>
      </Group>

      <Group title="Colours" hint="Always the brand’s own colours; this decides which of them go where.">
        <Toggles ordered label="Slide backgrounds" hint="The second one, if any, marks the closing slide." value={g.surfaces} options={[['dark', 'Brand dark'], ['light', 'Brand light'], ['brand', 'Main colour']]} onChange={v => setGrammar({ surfaces: v })} />
        <Choice label="Background fill" value={g.background.type} options={[['flat', 'Flat'], ['linear', 'Gradient'], ['radial', 'Radial glow']]} onChange={v => setGrammar({ background: { ...g.background, type: v } })} />
        {g.background.type !== 'flat' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <RoleSelect label="From" value={g.background.from} onChange={v => setGrammar({ background: { ...g.background, from: v } })} />
            <RoleSelect label="To" value={g.background.to} onChange={v => setGrammar({ background: { ...g.background, to: v } })} />
            <Choice label="Strength" value={g.background.intensity} options={[['subtle', 'Subtle'], ['medium', 'Medium'], ['strong', 'Strong']]} onChange={v => setGrammar({ background: { ...g.background, intensity: v } })} />
          </div>
        )}
      </Group>

      <Group title="Photos">
        <Setting label="Photo style">
          <div role="radiogroup" aria-label="Photo style" className="grid gap-2 sm:grid-cols-2">
            {IMAGERY.map(([key, text, sub]) => (
              <button key={key} type="button" role="radio" aria-checked={study.imagery.mode === key} onClick={() => setImagery({ mode: key })}
                className={cn('rounded-xl border px-3 py-2.5 text-left transition-colors', study.imagery.mode === key ? 'border-bk-fg bg-bk-alt' : 'border-bk-field hover:border-bk-fg/50')}>
                <span className="block text-[13.5px] font-semibold">{text}</span><span className="block text-[12px] text-bk-muted">{sub}</span>
              </button>
            ))}
          </div>
        </Setting>
        {study.imagery.mode !== 'none' && <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Choice label="How often" value={g.imagery.frequency} options={[['every', 'Every slide'], ['most', 'Most'], ['some', 'Some'], ['rare', 'Rarely']]} onChange={v => photos({ frequency: v })} />
            <Choice label="Size" value={g.imagery.scale} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['dominant', 'Dominant']]} onChange={v => photos({ scale: v })} />
            <Choice label="Colour" value={g.imagery.tone} options={[['color', 'In colour'], ['monochrome', 'Black and white']]} onChange={v => photos({ tone: v })} />
            <Choice label="Shade over the photo" hint="Darkens the photo so copy on it reads." value={g.imagery.overlay} options={[['none', 'None'], ['gradient', 'Fade'], ['solid', 'Even']]} onChange={v => photos({ overlay: v })} />
            <Choice wide label="Shape" value={g.imagery.shape} options={[['rect', 'Square corners'], ['rounded', 'Rounded'], ['circle', 'Circle'], ['pill', 'Pill'], ['arch', 'Arch']]} onChange={v => photos({ shape: v })} />
            <Choice wide label="Photos and copy" value={g.imagery.overlap} options={[['none', 'Apart'], ['text', 'Copy over photo'], ['edge', 'Overlapping edges']]} onChange={v => photos({ overlap: v })} />
          </div>
          <Toggles label="Where photos go" value={g.imagery.positions} options={[['full', 'Whole slide'], ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right'], ['center', 'Centre']]} onChange={v => photos({ positions: v })} />
          <Choice label="Images" hint="AI-generated images are transparent cut-outs saved to the brand gallery. With stock, about one image in five is a stock photograph instead; photographs are never AI-generated." value={g.imagery.cutout === 'always' ? 'always' : 'some'} options={[['some', 'AI cut-outs and some stock'], ['always', 'AI cut-outs only']]} onChange={v => photos({ cutout: v })} />
        </>}
      </Group>

      <Group title="Decorations" hint="Shapes and marks behind the copy. They keep clear of the copy and the logo.">
        {decorations.length === 0 && <p className="text-[13px] text-bk-muted">No decorations: the copy and photos carry the design.</p>}
        {decorations.map((d, i) => (
          <div key={i} className="space-y-4 rounded-xl bg-bk-alt p-3.5">
            <div className="flex items-end gap-2">
              <label className="block min-w-0 flex-1">
                <span className="text-[13px] font-bold">Decoration {i + 1}</span>
                <select value={d.kind} onChange={e => setDecoration(i, { kind: e.target.value })} className={appField('mt-2 h-9 text-[13.5px]')}>
                  {DECORATION_KINDS.map(kind => <option key={kind} value={kind}>{DECORATIONS[kind] || kind}</option>)}
                </select>
              </label>
              <button type="button" aria-label={`Remove decoration ${i + 1}`} onClick={() => setGrammar({ decorations: decorations.filter((_, j) => j !== i) })} className={appButton('quiet', 'sm', 'size-9 px-0 text-bk-muted hover:text-[#C2412F]')}><Trash2 className="size-4" /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice label="Size" value={d.scale} options={[['small', 'S'], ['medium', 'M'], ['large', 'L'], ['oversized', 'XL']]} onChange={v => setDecoration(i, { scale: v })} />
              <Choice label="Colour" value={d.color} options={[['surfaceTone', 'Soft'], ['accent', 'Accent'], ['foreground', 'Text colour']]} onChange={v => setDecoration(i, { color: v })} />
              <Choice label="On" value={d.frequency} options={[['every', 'Every slide'], ['some', 'Every other']]} onChange={v => setDecoration(i, { frequency: v })} />
              <Choice label="Placement" value={d.placement === 'edge' ? 'edge' : 'corner'} options={[['edge', 'At the edge'], ['corner', 'Inside the margins']]} onChange={v => setDecoration(i, { placement: v })} />
            </div>
            <label className="block max-w-[320px]">
              <span className="flex justify-between text-[13px] font-bold">Opacity<span className="font-semibold tabular-nums text-bk-muted">{d.opacity}%</span></span>
              <input type="range" min={0} max={100} step={5} value={d.opacity} onChange={e => setDecoration(i, { opacity: Number(e.target.value) })} className="mt-2 w-full accent-[#14131A] dark:accent-[#F5F1E8]" />
            </label>
          </div>
        ))}
        {decorations.length < 6 && <button type="button" onClick={() => setGrammar({ decorations: [...decorations, { kind: 'ring', placement: 'edge', scale: 'medium', opacity: 20, color: 'surfaceTone', frequency: 'every' }] })} className={appButton('outline', 'sm')}><Plus className="size-4" />Add a decoration</button>}
      </Group>

      <Group title="Logo and labels" hint="Always in a corner, never inside the copy.">
        <div className="grid gap-5 sm:grid-cols-3">
          <Corner label="Logo" value={g.branding.logo} onChange={v => setGrammar({ branding: { ...g.branding, logo: v } })} />
          <Corner label="Slide number" value={g.branding.slideNumber} onChange={v => setGrammar({ branding: { ...g.branding, slideNumber: v } })} />
          <Corner label="Website" value={g.branding.handle} onChange={v => setGrammar({ branding: { ...g.branding, handle: v } })} />
        </div>
      </Group>
    </div>
  )
}
