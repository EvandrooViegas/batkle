'use client'

import { useId } from 'react'

/**
 * Small drawings of what each design setting does, for the design editor (DesignStudyEditor): three lines aligned to
 * the left, a photo with a shade over it, a ring at the edge of a slide. They are drawn from the theme colours, so they
 * follow light and dark mode; `currentColor` is the ink.
 */

// Colours a drawing needs beyond the ink: a photo, its highlight, and the accent.
const PHOTO = '#b7afa3', PHOTO_LIGHT = '#ddd6cb', ACCENT = '#e8541e'
// Brand-agnostic colours for the colour roles (the demo brand of the design previews).
export const ROLE_SWATCHES = { surface: '#f6f2ea', tint: '#f8d3c4', light: '#fff6e3', dark: '#101327', primary: '#ed5125', accent: '#ffe05b', foreground: '#14131a', white: '#ffffff' }

/** A small portrait slide (40 × 50) holding a drawing. */
function Slide({ children, fill, className = '' }) {
  return (
    <svg viewBox="0 0 40 50" aria-hidden="true" className={`h-[50px] w-10 ${className}`}>
      <rect x=".5" y=".5" width="39" height="49" rx="4" className={fill ? undefined : 'fill-bk-surface'} fill={fill} stroke="currentColor" strokeOpacity=".16" />
      {children}
    </svg>
  )
}
/** A headline line (thick) or a copy line (thin, lighter). */
const Line = ({ x, y, w, thin = false, color }) => <rect x={x} y={y} width={w} height={thin ? 1.6 : 3.2} rx={thin ? .8 : 1.2} fill={color || 'currentColor'} fillOpacity={thin ? .45 : 1} />
/** A photo: a muted block with hills, clipped to its shape. */
function Photo({ x, y, w, h, rx = 0, shape = 'rect' }) {
  const id = useId().replace(/:/g, '')
  const path = shape === 'circle' ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={Math.min(w, h) / 2} ry={Math.min(w, h) / 2} />
    : shape === 'arch' ? <path d={`M${x} ${y + h} V${y + w / 2} A${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2} V${y + h} Z`} />
    : <rect x={x} y={y} width={w} height={h} rx={shape === 'pill' ? Math.min(w, h) / 2 : rx} />
  return (
    <g>
      <defs><clipPath id={id}>{path}</clipPath></defs>
      <g clipPath={`url(#${id})`}>
        <rect x={x} y={y} width={w} height={h} fill={PHOTO} />
        <path d={`M${x} ${y + h} L${x + w * .35} ${y + h * .55} L${x + w * .55} ${y + h * .75} L${x + w * .75} ${y + h * .5} L${x + w} ${y + h * .8} V${y + h} Z`} fill={PHOTO_LIGHT} />
        <circle cx={x + w * .72} cy={y + h * .28} r={Math.max(1.2, Math.min(w, h) * .09)} fill={PHOTO_LIGHT} />
      </g>
    </g>
  )
}
/** A headline and two copy lines, aligned and placed as asked. */
function Copy({ align = 'left', top = 22, left = 6, width = 28, white = false }) {
  const at = w => (align === 'center' ? left + (width - w) / 2 : align === 'right' ? left + width - w : left)
  const color = white ? '#ffffff' : undefined
  return <><Line x={at(width * .86)} y={top} w={width * .86} color={color} /><Line x={at(width * .62)} y={top + 4.6} w={width * .62} color={color} /><Line x={at(width * .74)} y={top + 10} w={width * .74} thin color={color} /></>
}
/** Big text sample in the display font, for type settings. */
const Type = ({ children, style }) => <span aria-hidden="true" className="font-bk-display leading-none text-bk-fg" style={style}>{children}</span>

export const PICTURES = {
  alignment: Object.fromEntries(['left', 'center', 'right'].map(a => [a, <Slide key={a}><Copy align={a} top={19} /></Slide>])),
  anchors: { top: <Slide><Copy top={6} /></Slide>, center: <Slide><Copy top={19} /></Slide>, bottom: <Slide><Copy top={33} /></Slide> },
  margin: Object.fromEntries([['tight', 3], ['standard', 6.5], ['generous', 10]].map(([k, m]) => [k, (
    <Slide key={k}><rect x={m} y={m} width={40 - 2 * m} height={50 - 2 * m} fill="none" stroke="currentColor" strokeOpacity=".35" strokeDasharray="1.6 1.6" strokeWidth=".7" /><Copy left={m + 1.5} width={37 - 2 * m} top={30 - m * .4} /></Slide>
  )])),
  density: Object.fromEntries([['airy', 7], ['balanced', 4.6], ['dense', 2.8]].map(([k, gap]) => [k, (
    <Slide key={k}><Line x={6} y={12} w={26} />{[0, 1, 2].map(i => <Line key={i} x={6} y={12 + 3.2 + gap + i * (1.6 + gap)} w={[24, 20, 22][i]} thin />)}</Slide>
  )])),
  compositions: {
    statement: <Slide><Line x={6} y={17} w={28} /><Line x={6} y={22} w={24} /><Line x={6} y={27} w={18} /></Slide>,
    stacked: <Slide><Photo x={4} y={4} w={32} h={20} rx={2} /><Copy top={29} /></Slide>,
    split: <Slide><Photo x={1} y={1} w={19} h={48} /><Line x={23} y={20} w={13} /><Line x={23} y={24.5} w={10} /><Line x={23} y={30} w={12} thin /></Slide>,
    'image-led': <Slide><Photo x={1} y={1} w={38} h={48} rx={3.5} /><rect x="1" y="26" width="38" height="23" rx="3.5" fill="#000" fillOpacity=".35" /><Copy top={32} white /></Slide>,
    'backdrop-type': <Slide><text x="3" y="38" fontSize="34" fontWeight="900" fill="currentColor" fillOpacity=".1">A</text><Copy top={22} /></Slide>,
    list: <Slide><Line x={6} y={8} w={22} />{[0, 1, 2].map(i => <g key={i}><circle cx={8} cy={19 + i * 8} r={2} fill={ACCENT} /><Line x={12} y={18.2 + i * 8} w={20} thin /></g>)}</Slide>,
    closing: <Slide><Line x={8} y={18} w={24} /><Line x={11} y={23} w={18} thin /><rect x="12" y="30" width="16" height="5" rx="2.5" fill="currentColor" /></Slide>,
  },
  headlineSize: { medium: <Type style={{ fontSize: 13, fontWeight: 800 }}>Aa</Type>, large: <Type style={{ fontSize: 17, fontWeight: 800 }}>Aa</Type>, veryLarge: <Type style={{ fontSize: 22, fontWeight: 800 }}>Aa</Type>, oversized: <Type style={{ fontSize: 28, fontWeight: 800 }}>Aa</Type> },
  weight: { regular: <Type style={{ fontSize: 20, fontWeight: 400 }}>Aa</Type>, bold: <Type style={{ fontSize: 20, fontWeight: 700 }}>Aa</Type>, black: <Type style={{ fontSize: 20, fontWeight: 900 }}>Aa</Type> },
  case: { none: <Type style={{ fontSize: 17, fontWeight: 800 }}>Ab</Type>, uppercase: <Type style={{ fontSize: 17, fontWeight: 800 }}>AB</Type> },
  tracking: { tight: <Type style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.09em' }}>ABC</Type>, normal: <Type style={{ fontSize: 15, fontWeight: 800 }}>ABC</Type>, wide: <Type style={{ fontSize: 15, fontWeight: 800, letterSpacing: '.18em' }}>ABC</Type> },
  leading: Object.fromEntries([['tight', .78], ['normal', 1.05], ['loose', 1.4]].map(([k, lh]) => [k, <Type key={k} style={{ fontSize: 12, fontWeight: 800, lineHeight: lh, display: 'block', textAlign: 'center' }}>Aa<br />Aa</Type>])),
  emphasis: {
    none: <Type style={{ fontSize: 12, fontWeight: 800 }}>big idea</Type>,
    color: <Type style={{ fontSize: 12, fontWeight: 800 }}>big <span style={{ color: ACCENT }}>idea</span></Type>,
    background: <Type style={{ fontSize: 12, fontWeight: 800 }}>big <span className="bg-bk-butter px-0.5 text-bk-ink">idea</span></Type>,
    underline: <Type style={{ fontSize: 12, fontWeight: 800 }}>big <span className="underline decoration-2 underline-offset-2" style={{ textDecorationColor: ACCENT }}>idea</span></Type>,
  },
  headlineFill: {
    solid: <Type style={{ fontSize: 20, fontWeight: 900 }}>Aa</Type>,
    gradient: <Type style={{ fontSize: 20, fontWeight: 900, backgroundImage: `linear-gradient(135deg, ${ACCENT}, #ffb938)`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Aa</Type>,
  },
  bodySize: Object.fromEntries([['small', 1.2], ['medium', 1.8], ['large', 2.6]].map(([k, h]) => [k, (
    <Slide key={k}><Line x={6} y={14} w={26} />{[0, 1, 2].map(i => <rect key={i} x={6} y={21 + i * (h + 2.6)} width={[24, 20, 22][i]} height={h} rx={h / 2} fill="currentColor" fillOpacity=".45" />)}</Slide>
  )])),
  cards: {
    none: <Slide><Line x={6} y={16} w={24} /><Line x={6} y={23} w={22} thin /><Line x={6} y={27} w={18} thin /></Slide>,
    card: <Slide><Line x={6} y={10} w={24} /><rect x="5" y="19" width="30" height="16" rx="2.5" fill="currentColor" fillOpacity=".12" /><Line x={8} y={24} w={22} thin /><Line x={8} y={28} w={16} thin /></Slide>,
    outline: <Slide><Line x={6} y={10} w={24} /><rect x="5" y="19" width="30" height="16" rx="2.5" fill="none" stroke="currentColor" strokeOpacity=".55" strokeWidth=".8" /><Line x={8} y={24} w={22} thin /><Line x={8} y={28} w={16} thin /></Slide>,
    glass: <Slide><Photo x={1} y={1} w={38} h={48} rx={3.5} /><rect x="5" y="19" width="30" height="16" rx="2.5" fill="#ffffff" fillOpacity=".55" /><Line x={8} y={24} w={22} thin color="#14131a" /><Line x={8} y={28} w={16} thin color="#14131a" /></Slide>,
  },
  cardCorners: Object.fromEntries([['small', 1], ['medium', 3], ['large', 5.5], ['pill', 8]].map(([k, rx]) => [k, (
    <Slide key={k}><rect x="5" y="17" width="30" height="16" rx={rx} fill="currentColor" fillOpacity=".14" /><Line x={9} y={22} w={20} thin /><Line x={9} y={26} w={14} thin /></Slide>
  )])),
  markerShape: {
    circle: <svg viewBox="0 0 24 24" aria-hidden="true" className="size-7"><circle cx="12" cy="12" r="10" fill={ACCENT} /><text x="12" y="16.2" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">1</text></svg>,
    square: <svg viewBox="0 0 24 24" aria-hidden="true" className="size-7"><rect x="2" y="2" width="20" height="20" rx="4" fill={ACCENT} /><text x="12" y="16.2" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">1</text></svg>,
    none: <svg viewBox="0 0 24 24" aria-hidden="true" className="size-7"><text x="12" y="17" textAnchor="middle" fontSize="15" fontWeight="800" fill={ACCENT}>1</text></svg>,
  },
  markerFill: {
    solid: <svg viewBox="0 0 24 24" aria-hidden="true" className="size-7"><circle cx="12" cy="12" r="10" fill={ACCENT} /><text x="12" y="16.2" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">1</text></svg>,
    outline: <svg viewBox="0 0 24 24" aria-hidden="true" className="size-7"><circle cx="12" cy="12" r="9" fill="none" stroke={ACCENT} strokeWidth="2" /><text x="12" y="16.2" textAnchor="middle" fontSize="12" fontWeight="800" fill={ACCENT}>1</text></svg>,
  },
  surfaces: {
    dark: <Slide fill={ROLE_SWATCHES.dark}><Copy top={20} white /></Slide>,
    light: <Slide fill={ROLE_SWATCHES.light}><Copy top={20} /></Slide>,
    brand: <Slide fill={ROLE_SWATCHES.primary}><Copy top={20} white /></Slide>,
  },
  photoStyle: {
    none: <Slide><Copy top={18} /><circle cx="30" cy="40" r="5" fill="none" stroke={ACCENT} strokeWidth="1.4" /></Slide>,
    background: <Slide><Photo x={1} y={1} w={38} h={48} rx={3.5} /><rect x="1" y="27" width="38" height="22" rx="3.5" fill="#000" fillOpacity=".35" /><Copy top={33} white /></Slide>,
    fullBleed: <Slide><Photo x={14} y={1} w={25} h={30} /><Copy top={34} /></Slide>,
    cutout: <Slide><Copy top={6} /><path d="M14 49 C14 38 17 33 20 33 C23 33 26 38 26 49 Z" fill={PHOTO} /><circle cx="20" cy="28" r="4.5" fill={PHOTO} /></Slide>,
    contained: <Slide><Photo x={8} y={5} w={24} h={24} shape="circle" /><Copy top={33} /></Slide>,
    collage: <Slide><Photo x={4} y={4} w={15} h={20} rx={1.5} /><Photo x={21} y={4} w={15} h={11} rx={1.5} /><Photo x={21} y={17} w={15} h={7} rx={1.5} /><Copy top={30} /></Slide>,
    mixed: <svg viewBox="0 0 40 50" aria-hidden="true" className="h-[50px] w-10"><rect x="2" y="3" width="22" height="28" rx="2.5" className="fill-bk-surface" stroke="currentColor" strokeOpacity=".16" /><Photo x={4} y={5} w={18} h={13} rx={1} /><rect x="16" y="19" width="22" height="28" rx="2.5" className="fill-bk-surface" stroke="currentColor" strokeOpacity=".16" /><Line x={19} y={27} w={15} /><Line x={19} y={32} w={11} thin /></svg>,
    other: <Slide><text x="20" y="31" textAnchor="middle" fontSize="16" fontWeight="800" fill="currentColor" fillOpacity=".45">?</text></Slide>,
  },
  photoFrequency: Object.fromEntries([['every', 4], ['most', 3], ['some', 2], ['rare', 1]].map(([k, n]) => [k, (
    <svg key={k} viewBox="0 0 44 16" aria-hidden="true" className="h-4 w-11">{[0, 1, 2, 3].map(i => <g key={i}><rect x={i * 11 + .5} y=".5" width="9.5" height="15" rx="1.5" className="fill-bk-surface" stroke="currentColor" strokeOpacity=".2" />{i < n && <rect x={i * 11 + 2} y="2" width="6.5" height="7" rx="1" fill={PHOTO} />}</g>)}</svg>
  )])),
  photoSize: Object.fromEntries([['small', 12], ['medium', 18], ['large', 25], ['dominant', 34]].map(([k, s]) => [k, (
    <Slide key={k}><Photo x={(40 - s) / 2} y={4} w={s} h={s * .8} rx={1.5} /><Line x={6} y={Math.min(42, 8 + s * .8)} w={24} thin /></Slide>
  )])),
  photoTone: {
    color: <Slide><rect x="4" y="4" width="32" height="26" rx="2" fill="#6fa3b8" /><path d="M4 30 L15 17 L22 24 L29 16 L36 25 V30 Z" fill="#7fb069" /><circle cx="28" cy="11" r="3" fill="#ffe05b" /><Copy top={34} /></Slide>,
    monochrome: <Slide><rect x="4" y="4" width="32" height="26" rx="2" fill="#9a9a9a" /><path d="M4 30 L15 17 L22 24 L29 16 L36 25 V30 Z" fill="#c4c4c4" /><circle cx="28" cy="11" r="3" fill="#e2e2e2" /><Copy top={34} /></Slide>,
  },
  photoOverlay: {
    none: <Slide><Photo x={1} y={1} w={38} h={48} rx={3.5} /><Copy top={33} white /></Slide>,
    gradient: <Slide><Photo x={1} y={1} w={38} h={48} rx={3.5} /><defs><linearGradient id="pic-fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".35" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".75" /></linearGradient></defs><rect x="1" y="1" width="38" height="48" rx="3.5" fill="url(#pic-fade)" /><Copy top={33} white /></Slide>,
    solid: <Slide><Photo x={1} y={1} w={38} h={48} rx={3.5} /><rect x="1" y="1" width="38" height="48" rx="3.5" fill="#000" fillOpacity=".45" /><Copy top={33} white /></Slide>,
  },
  photoShape: Object.fromEntries(['rect', 'rounded', 'circle', 'pill', 'arch'].map(k => [k, (
    <Slide key={k}><Photo x={8} y={5} w={24} h={k === 'pill' ? 30 : k === 'arch' ? 28 : 24} rx={k === 'rounded' ? 4 : 0} shape={k === 'rounded' ? 'rect' : k} /><Line x={6} y={40} w={24} thin /></Slide>
  )])),
  photoOverlap: {
    none: <Slide><Photo x={4} y={4} w={32} h={20} rx={2} /><Copy top={29} /></Slide>,
    text: <Slide><Photo x={1} y={1} w={38} h={48} rx={3.5} /><rect x="1" y="1" width="38" height="48" rx="3.5" fill="#000" fillOpacity=".3" /><Copy top={20} white /></Slide>,
    edge: <Slide><Photo x={4} y={4} w={32} h={26} rx={2} /><rect x="6" y="25" width="24" height="12" rx="1.5" className="fill-bk-surface" stroke="currentColor" strokeOpacity=".2" /><Line x={9} y={28} w={16} /><Line x={9} y={33} w={12} thin /></Slide>,
  },
  photoPositions: {
    full: <Slide><Photo x={1} y={1} w={38} h={48} rx={3.5} /></Slide>,
    top: <Slide><Photo x={1} y={1} w={38} h={22} /><Line x={6} y={30} w={24} thin /></Slide>,
    bottom: <Slide><Line x={6} y={10} w={24} thin /><Photo x={1} y={27} w={38} h={22} /></Slide>,
    left: <Slide><Photo x={1} y={1} w={18} h={48} /><Line x={22} y={24} w={13} thin /></Slide>,
    right: <Slide><Line x={5} y={24} w={13} thin /><Photo x={21} y={1} w={18} h={48} /></Slide>,
    center: <Slide><Photo x={9} y={13} w={22} h={22} rx={2} /></Slide>,
  },
  decorations: {
    oversizedType: <Slide><text x="2" y="40" fontSize="36" fontWeight="900" fill="currentColor" fillOpacity=".12">A</text><Line x={6} y={22} w={20} /></Slide>,
    ring: <Slide><circle cx="34" cy="8" r="10" fill="none" stroke={ACCENT} strokeWidth="1.6" /><Line x={6} y={28} w={22} /></Slide>,
    circle: <Slide><circle cx="34" cy="8" r="10" fill={ACCENT} fillOpacity=".75" /><Line x={6} y={28} w={22} /></Slide>,
    arc: <Slide><path d="M2 20 A 24 24 0 0 1 26 1" fill="none" stroke={ACCENT} strokeWidth="1.4" /><Line x={6} y={30} w={22} /></Slide>,
    line: <Slide><rect x="6" y="20" width="9" height="1.8" rx=".9" fill={ACCENT} /><Line x={6} y={25} w={24} /><Line x={6} y={30} w={18} thin /></Slide>,
    dotGrid: <Slide>{Array.from({ length: 16 }, (_, i) => <circle key={i} cx={24 + (i % 4) * 3.5} cy={6 + Math.floor(i / 4) * 3.5} r=".9" fill={ACCENT} />)}<Line x={6} y={28} w={22} /></Slide>,
    pill: <Slide><rect x="5" y="16" width="15" height="5" rx="2.5" fill="none" stroke={ACCENT} strokeWidth="1" /><Line x={6} y={25} w={24} /></Slide>,
    cornerBlock: <Slide><rect x="30" y="1" width="9" height="9" fill={ACCENT} /><Line x={6} y={26} w={22} /></Slide>,
    frame: <Slide><rect x="3" y="3" width="34" height="44" rx="2" fill="none" stroke={ACCENT} strokeWidth="1" /><Line x={7} y={24} w={22} /></Slide>,
    glow: <Slide><defs><radialGradient id="pic-glow"><stop offset="0" stopColor={ACCENT} stopOpacity=".7" /><stop offset="1" stopColor={ACCENT} stopOpacity="0" /></radialGradient></defs><circle cx="32" cy="10" r="14" fill="url(#pic-glow)" /><Line x={6} y={28} w={22} /></Slide>,
    stripes: <Slide><Photo x={1} y={1} w={38} h={48} rx={3.5} />{Array.from({ length: 7 }, (_, i) => <rect key={i} x="1" y={2 + i * 3.6} width="38" height="1.8" fill={ACCENT} fillOpacity={.7 - i * .08} />)}<Copy top={33} white /></Slide>,
  },
  decorationPlacement: {
    edge: <Slide><circle cx="38" cy="2" r="9" fill="none" stroke={ACCENT} strokeWidth="1.4" /><Line x={6} y={28} w={22} /></Slide>,
    corner: <Slide><circle cx="29" cy="11" r="6" fill="none" stroke={ACCENT} strokeWidth="1.4" /><Line x={6} y={28} w={22} /></Slide>,
  },
  panelOutline: {
    none: <Slide><rect x="5" y="17" width="30" height="13" fill="#ffd84d" /><Line x={8} y={21.5} w={22} color="#14131a" /></Slide>,
    line: <Slide><rect x="5" y="17" width="30" height="13" fill="#ffd84d" stroke="#14131a" strokeWidth="1" /><Line x={8} y={21.5} w={22} color="#14131a" /></Slide>,
  },
  panelOffset: {
    none: <Slide><rect x="5" y="17" width="28" height="13" fill="#ffd84d" /><Line x={8} y={21.5} w={20} color="#14131a" /></Slide>,
    block: <Slide><rect x="8" y="20" width="28" height="13" fill="#14131a" /><rect x="5" y="17" width="28" height="13" fill="#ffd84d" /><Line x={8} y={21.5} w={20} color="#14131a" /></Slide>,
    outline: <Slide><rect x="8" y="20" width="28" height="13" fill="none" stroke="#14131a" strokeWidth="1" /><rect x="5" y="17" width="28" height="13" fill="#ffd84d" /><Line x={8} y={21.5} w={20} color="#14131a" /></Slide>,
  },
  backgroundFill: {
    flat: <Slide fill={ROLE_SWATCHES.dark}><Copy top={20} white /></Slide>,
    linear: <Slide fill="url(#pic-linear)"><defs><linearGradient id="pic-linear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={ROLE_SWATCHES.primary} /><stop offset="1" stopColor={ROLE_SWATCHES.dark} /></linearGradient></defs><Copy top={20} white /></Slide>,
    radial: <Slide fill="url(#pic-radial)"><defs><radialGradient id="pic-radial" cx=".3" cy=".25" r=".9"><stop offset="0" stopColor={ROLE_SWATCHES.primary} /><stop offset="1" stopColor={ROLE_SWATCHES.dark} /></radialGradient></defs><Copy top={20} white /></Slide>,
  },
}

/** A colour role as a small swatch, for the colour pickers. */
export function Swatch({ role }) {
  return <span aria-hidden="true" className="block size-6 rounded-full border border-bk-line" style={{ background: ROLE_SWATCHES[role] || '#cccccc' }} />
}
