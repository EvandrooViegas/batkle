'use client'

import { COMPOSITIONS, DECORATION_KINDS, IMAGERY_MODES } from '@/lib/designs/global/types'
import { familyGrammar, familyImagery } from '@/lib/designs/global/study'
import { COMPOSITION_LABELS } from '@/components/GlobalDesignPreview'

const IMAGERY_LABELS = { none: 'None', background: 'Background photography', fullBleed: 'Full-bleed', cutout: 'Cutout', contained: 'Contained', collage: 'Collage', mixed: 'Mixed', other: 'Other' }
export const imageryLabel = mode => IMAGERY_LABELS[mode] || mode
const POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'none']
const BLANK_STUDY = { personality: '', composition: '', spaceDensity: '', typography: '', colorContrast: '', colorRoles: { background: '', foreground: '', accent: '', decoration: '' }, decorative: '', hierarchy: '', logoPlacement: '', distinctive: [], familyRules: [], variantRules: [], avoid: [] }

const label = 'text-[11px] font-bold uppercase tracking-[0.12em] text-bk-muted'
const input = 'w-full rounded-lg border border-bk-field bg-bk-surface px-3 py-2 text-[13.5px] text-bk-fg outline-none transition-colors focus:border-bk-fg'

function Text({ title, value, onChange, rows = 2 }) {
  return <label className="block space-y-1"><span className={label}>{title}</span><textarea rows={rows} className={input} value={value || ''} onChange={e => onChange(e.target.value)} /></label>
}
function Lines({ title, hint, value, onChange, tone = '' }) {
  return <label className="block space-y-1"><span className={label}>{title}</span>{hint && <span className="block text-[12px] text-bk-muted">{hint}</span>}<textarea rows={4} className={`${input} ${tone}`} value={(value || []).join('\n')} onChange={e => onChange(e.target.value.split('\n').map(s => s.trimStart()).filter((s, i, all) => s || i === all.length - 1).slice(0, 16))} /></label>
}
function Choice({ title, value, options, onChange, labels = {} }) {
  return <label className="block space-y-1"><span className={label}>{title}</span><select className={input} value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o} value={o}>{labels[o] || o}</option>)}</select></label>
}
function Multi({ title, value, options, onChange, labels = {} }) {
  const toggle = o => { const next = value.includes(o) ? value.filter(v => v !== o) : [...value, o]; if (next.length) onChange(next) }
  return <fieldset className="space-y-1"><legend className={label}>{title}</legend><div className="flex flex-wrap gap-1.5">{options.map(o => <button type="button" key={o} aria-pressed={value.includes(o)} onClick={() => toggle(o)} className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors ${value.includes(o) ? 'border-bk-fg bg-bk-fg text-bk-bg' : 'border-bk-field text-bk-muted hover:text-bk-fg'}`}>{labels[o] || o}</button>)}</div></fieldset>
}
function Section({ title, children }) {
  return <section className="space-y-3 rounded-xl border border-bk-line p-4"><h4 className="text-[14px] font-bold">{title}</h4>{children}</section>
}

/**
 * Editable, brand-agnostic design study: the visual language generation follows.
 * Prose explains the language; the grammar fields are what the composition planner reads.
 */
export default function DesignStudyEditor({ family, onChange }) {
  const study = { ...BLANK_STUDY, ...family.study, imagery: familyImagery(family), grammar: familyGrammar(family) }
  const g = study.grammar
  const set = patch => onChange({ ...family, study: { ...study, ...patch } })
  const setGrammar = patch => set({ grammar: { ...g, ...patch } })
  const setImagery = patch => set({ imagery: { ...study.imagery, ...patch } })
  const decorations = g.decorations || []
  const setDecoration = (i, patch) => setGrammar({ decorations: decorations.map((d, j) => j === i ? { ...d, ...patch } : d) })
  return <div aria-label="Design study" className="space-y-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[16px] font-bold">Design study</h3><span className="text-[12px] text-bk-muted">A visual language, not a template. Colors, fonts and logo always come from each brand.</span></div>
    {!family.study && <p className="rounded-xl bg-bk-chip p-3 text-[13px]">This family was saved before structured studies. The values below were derived from its layouts; edit and save to keep them, or use “Rebuild from references”.</p>}
    <Section title="Identity">
      <Text title="Personality" value={study.personality} onChange={v => set({ personality: v })} />
      <Lines title="Distinctive characteristics" value={study.distinctive} onChange={v => set({ distinctive: v })} />
    </Section>
    <Section title="Composition">
      <Text title="Composition behaviour" value={study.composition} onChange={v => set({ composition: v })} />
      <Text title="Hierarchy" value={study.hierarchy} onChange={v => set({ hierarchy: v })} />
      <Multi title="Composition moves this language allows" value={g.compositions} options={COMPOSITIONS} labels={COMPOSITION_LABELS} onChange={v => setGrammar({ compositions: v })} />
      <div className="grid gap-3 sm:grid-cols-2"><Multi title="Alignment (dominant first)" value={g.alignment} options={['left', 'center', 'right']} onChange={v => setGrammar({ alignment: v })} /><Multi title="Copy anchors" value={g.anchors} options={['top', 'center', 'bottom']} onChange={v => setGrammar({ anchors: v })} /></div>
    </Section>
    <Section title="Typography">
      <Text title="Typography behaviour" value={study.typography} onChange={v => set({ typography: v })} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Choice title="Headline scale" value={g.headline.scale} options={['medium', 'large', 'veryLarge', 'oversized']} onChange={v => setGrammar({ headline: { ...g.headline, scale: v } })} />
        <Choice title="Headline weight" value={g.headline.weight} options={['regular', 'bold', 'black']} onChange={v => setGrammar({ headline: { ...g.headline, weight: v } })} />
        <Choice title="Headline box" value={g.headline.frame || 'none'} options={['none', 'outline', 'solid']} labels={{ none: 'None', outline: 'Outlined box', solid: 'Filled panel' }} onChange={v => setGrammar({ headline: { ...g.headline, frame: v } })} />
        <Choice title="Headline case" value={g.headline.case} options={['none', 'uppercase']} onChange={v => setGrammar({ headline: { ...g.headline, case: v } })} />
        <Choice title="Tracking" value={g.headline.tracking} options={['tight', 'normal', 'wide']} onChange={v => setGrammar({ headline: { ...g.headline, tracking: v } })} />
        <Choice title="Body scale" value={g.body.scale} options={['small', 'medium', 'large']} onChange={v => setGrammar({ body: { scale: v } })} />
        <Choice title="Accent treatment" value={g.emphasis} options={['none', 'color', 'background', 'underline']} onChange={v => setGrammar({ emphasis: v })} />
      </div>
    </Section>
    <Section title="Color strategy">
      <Text title="Color & contrast" value={study.colorContrast} onChange={v => set({ colorContrast: v })} />
      <div className="grid gap-3 sm:grid-cols-2">{['background', 'foreground', 'accent', 'decoration'].map(role => <Text key={role} title={`${role} role`} rows={1} value={study.colorRoles?.[role]} onChange={v => set({ colorRoles: { ...study.colorRoles, [role]: v } })} />)}</div>
      <Multi title="Surfaces (dominant first)" value={g.surfaces} options={['dark', 'light', 'brand']} labels={{ dark: 'Brand dark', light: 'Brand light', brand: 'Brand primary' }} onChange={v => setGrammar({ surfaces: v })} />
    </Section>
    <Section title="Imagery strategy">
      <Choice title="Imagery type" value={study.imagery.mode} options={IMAGERY_MODES} labels={IMAGERY_LABELS} onChange={v => setImagery({ mode: v })} />
      {study.imagery.mode !== 'none' && <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Choice title="Scale" value={g.imagery.scale} options={['small', 'medium', 'large', 'dominant']} onChange={v => setGrammar({ imagery: { ...g.imagery, scale: v } })} />
          <Choice title="Dominance" value={g.imagery.dominance} options={['supports', 'balanced', 'dominates']} onChange={v => setGrammar({ imagery: { ...g.imagery, dominance: v } })} />
          <Choice title="Frequency" value={g.imagery.frequency} options={['every', 'most', 'some', 'rare']} onChange={v => setGrammar({ imagery: { ...g.imagery, frequency: v } })} />
          <Choice title="Shape" value={g.imagery.shape} options={['rect', 'rounded', 'circle', 'pill', 'arch']} onChange={v => setGrammar({ imagery: { ...g.imagery, shape: v } })} />
          <Choice title="Overlap" value={g.imagery.overlap} options={['none', 'text', 'edge']} onChange={v => setGrammar({ imagery: { ...g.imagery, overlap: v } })} />
          <Choice title="Overlay" value={g.imagery.overlay} options={['none', 'gradient', 'solid']} onChange={v => setGrammar({ imagery: { ...g.imagery, overlay: v } })} />
          <Choice title="Images" value={g.imagery.cutout === 'always' ? 'always' : 'some'} options={['some', 'always']} labels={{ some: 'AI cutouts, up to 20% stock', always: 'AI cutouts only' }} onChange={v => setGrammar({ imagery: { ...g.imagery, cutout: v } })} />
        </div>
        <p className="text-[12px] text-bk-muted">Images are AI-generated transparent PNGs, saved to the brand gallery (a post may reuse one that fits). With “up to 20% stock”, about one image in five is a stock photograph instead; photographs are never AI-generated.</p>
        <Multi title="Positions" value={g.imagery.positions} options={['full', 'top', 'bottom', 'left', 'right', 'center']} onChange={v => setGrammar({ imagery: { ...g.imagery, positions: v } })} />
        <div className="grid gap-3 sm:grid-cols-2">{[['usage', 'Usage'], ['placement', 'Placement'], ['cropBehavior', 'Crop'], ['textRelationship', 'Text relationship'], ['overlayTreatment', 'Overlay treatment'], ['frequency', 'Frequency notes']].map(([key, title]) => <Text key={key} title={title} rows={1} value={study.imagery[key]} onChange={v => setImagery({ [key]: v })} />)}</div>
      </>}
    </Section>
    <Section title="Spacing & density">
      <Text title="Space & density" value={study.spaceDensity} onChange={v => set({ spaceDensity: v })} />
      <div className="grid gap-3 sm:grid-cols-2"><Choice title="Margins" value={g.margin} options={['tight', 'standard', 'generous']} onChange={v => setGrammar({ margin: v })} /><Choice title="Density" value={g.density} options={['airy', 'balanced', 'dense']} onChange={v => setGrammar({ density: v })} /></div>
    </Section>
    <Section title="Decorative language">
      <Text title="Decoration behaviour" value={study.decorative} onChange={v => set({ decorative: v })} />
      {decorations.map((d, i) => <div key={i} className="grid items-end gap-2 rounded-lg border border-bk-line p-2 sm:grid-cols-[1fr_1fr_1fr_80px_1fr_auto]">
        <Choice title="Element" value={d.kind} options={DECORATION_KINDS} onChange={v => setDecoration(i, { kind: v })} />
        <Choice title="Scale" value={d.scale} options={['small', 'medium', 'large', 'oversized']} onChange={v => setDecoration(i, { scale: v })} />
        <Choice title="Color role" value={d.color} options={['surfaceTone', 'accent', 'foreground']} onChange={v => setDecoration(i, { color: v })} />
        <label className="block space-y-1"><span className={label}>Opacity</span><input type="number" min={0} max={100} className={input} value={d.opacity} onChange={e => setDecoration(i, { opacity: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></label>
        <Choice title="Frequency" value={d.frequency} options={['every', 'some']} labels={{ every: 'Every slide', some: 'Some slides' }} onChange={v => setDecoration(i, { frequency: v })} />
        <button type="button" className="h-10 text-xs underline" onClick={() => setGrammar({ decorations: decorations.filter((_, j) => j !== i) })}>Remove</button>
      </div>)}
      {decorations.length < 6 && <button type="button" className="text-sm underline" onClick={() => setGrammar({ decorations: [...decorations, { kind: 'ring', placement: 'edge', scale: 'medium', opacity: 20, color: 'surfaceTone', frequency: 'every' }] })}>Add decorative element</button>}
    </Section>
    <Section title="Branding placement">
      <Text title="Logo behaviour" rows={1} value={study.logoPlacement} onChange={v => set({ logoPlacement: v })} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Choice title="Logo" value={g.branding.logo} options={POSITIONS} onChange={v => setGrammar({ branding: { ...g.branding, logo: v } })} />
        <Choice title="Slide number" value={g.branding.slideNumber} options={POSITIONS} onChange={v => setGrammar({ branding: { ...g.branding, slideNumber: v } })} />
        <Choice title="Website" value={g.branding.handle} options={POSITIONS} onChange={v => setGrammar({ branding: { ...g.branding, handle: v } })} />
      </div>
    </Section>
    <Section title="Rules">
      <Lines title="Recurring rules" hint="What defines the family and stays consistent." value={study.familyRules} onChange={v => set({ familyRules: v })} />
      <Lines title="Flexible rules" hint="What may change between slides, and within which limits." value={study.variantRules} onChange={v => set({ variantRules: v })} />
      <Lines title="Anti-patterns" hint="What would break the design." value={study.avoid} onChange={v => set({ avoid: v })} tone="text-red-700 dark:text-red-400" />
    </Section>
  </div>
}
