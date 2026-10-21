'use client'

import { cn } from '@/lib/utils'

/**
 * A small picture of what an upgrade unlocks, drawn as Batkle's own screens (a calendar with posts on it, ads in
 * Meta's sizes, designs with their authors…), never icons. SVG, so it is sharp at the notice's size and the
 * dialog's, and follows light and dark mode through the theme colours.
 */

// Post colours from the design previews' demo brand, so the mock posts look like real ones.
const POST = { orange: '#ed5125', navy: '#101327', yellow: '#ffe05b', cream: '#fff6e3' }
const text = { fontFamily: 'inherit' }

/** A mock post: a coloured slide with a headline and a line. */
function Post({ x, y, w, h, bg, fg, accent, r = 5 }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={bg} />
      <rect x={x + w * 0.14} y={y + h * 0.18} width={w * 0.5} height={Math.max(2, h * 0.07)} rx={1} fill={accent} />
      <rect x={x + w * 0.14} y={y + h * 0.34} width={w * 0.72} height={Math.max(3, h * 0.11)} rx={1.5} fill={fg} />
      <rect x={x + w * 0.14} y={y + h * 0.5} width={w * 0.58} height={Math.max(3, h * 0.11)} rx={1.5} fill={fg} />
      <rect x={x + w * 0.14} y={y + h * 0.78} width={w * 0.3} height={Math.max(2, h * 0.06)} rx={1} fill={fg} opacity={0.55} />
    </g>
  )
}

const Card = props => <rect rx={14} className="fill-bk-surface stroke-bk-line" strokeWidth={1} {...props} />
const Chip = ({ x, y, label, dark = false, w = label.length * 5.6 + 18 }) => (
  <g>
    <rect x={x} y={y} width={w} height={18} rx={9} className={dark ? 'fill-bk-ink' : 'fill-bk-butter'} />
    <text x={x + w / 2} y={y + 12.5} textAnchor="middle" fontSize={9.5} fontWeight={700} className={dark ? 'fill-bk-cream' : 'fill-bk-ink'} style={text}>{label}</text>
  </g>
)

function Schedule() {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const posts = { 1: [POST.orange, '#fff', POST.yellow], 3: [POST.navy, POST.cream, POST.yellow], 7: [POST.yellow, POST.navy, POST.orange], 12: [POST.cream, POST.navy, POST.orange] }
  return (
    <>
      <Card x={18} y={14} width={284} height={168} />
      <text x={34} y={38} fontSize={12} fontWeight={800} className="fill-bk-fg" style={text}>October</text>
      <rect x={250} y={27} width={36} height={14} rx={7} className="fill-bk-alt" />
      {days.map((d, i) => <text key={i} x={44 + i * 37} y={58} textAnchor="middle" fontSize={8.5} fontWeight={700} className="fill-bk-muted" style={text}>{d}</text>)}
      {Array.from({ length: 14 }, (_, i) => {
        const x = 28 + (i % 7) * 37, y = 66 + Math.floor(i / 7) * 54
        const post = posts[i]
        return (
          <g key={i}>
            <rect x={x} y={y} width={33} height={48} rx={7} className="fill-bk-alt" />
            <text x={x + 5} y={y + 11} fontSize={7.5} fontWeight={700} className="fill-bk-muted" style={text}>{i + 13}</text>
            {post && <Post x={x + 6} y={y + 15} w={21} h={27} bg={post[0]} fg={post[1]} accent={post[2]} r={3} />}
          </g>
        )
      })}
      {/* The reminder that arrives when a post is due. */}
      <g>
        <rect x={168} y={146} width={140} height={42} rx={12} className="fill-bk-ink" />
        <circle cx={186} cy={167} r={9} className="fill-bk-butter" />
        <path d="M182 169.5h8m-6.5 0v-3.5a2.5 2.5 0 0 1 5 0v3.5m-3.2 2h1.4" className="stroke-bk-ink" strokeWidth={1.3} fill="none" strokeLinecap="round" />
        <text x={201} y={163} fontSize={9.5} fontWeight={800} className="fill-bk-cream" style={text}>Time to post · 10:00</text>
        <text x={201} y={176} fontSize={8} className="fill-bk-cream" opacity={0.7} style={text}>Slides and caption ready</text>
      </g>
    </>
  )
}

function Designs() {
  return (
    <>
      {/* The examples a member uploads… */}
      <g transform="rotate(-6 70 100)">
        <rect x={24} y={44} width={84} height={104} rx={8} fill={POST.cream} className="stroke-bk-line" />
        <rect x={34} y={56} width={64} height={46} rx={4} fill="#d9c7a7" />
        <rect x={34} y={110} width={52} height={7} rx={2} fill={POST.navy} />
        <rect x={34} y={122} width={38} height={5} rx={2} fill={POST.navy} opacity={0.5} />
      </g>
      <g transform="rotate(4 92 96)">
        <rect x={52} y={40} width={84} height={104} rx={8} fill={POST.navy} />
        <text x={64} y={84} fontSize={30} fontWeight={700} fill={POST.yellow} style={{ fontFamily: 'Georgia, serif' }}>Aa</text>
        <rect x={64} y={100} width={58} height={6} rx={2} fill="#fff" />
        <rect x={64} y={112} width={44} height={6} rx={2} fill="#fff" opacity={0.6} />
      </g>
      <path d="M150 98h28m0 0-7-6m7 6-7 6" className="stroke-bk-muted" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* …become a design in the brand's own colours. */}
      <Card x={190} y={26} width={112} height={150} />
      <Post x={200} y={36} w={92} h={92} bg={POST.orange} fg="#fff" accent={POST.yellow} r={6} />
      {[POST.orange, POST.navy, POST.yellow, POST.cream].map((c, i) => <circle key={c} cx={209 + i * 15} cy={143} r={5.5} fill={c} className="stroke-bk-line" />)}
      <Chip x={204} y={154} label="By you" />
    </>
  )
}

function Community() {
  const cards = [
    { x: 22, rot: -5, post: [POST.navy, '#fff', POST.yellow], by: 'By Ana' },
    { x: 116, rot: 0, post: [POST.yellow, POST.navy, POST.orange], by: 'By Studio Norte' },
    { x: 212, rot: 5, post: [POST.orange, '#fff', POST.navy], by: 'By Rui' },
  ]
  return cards.map(c => (
    <g key={c.x} transform={`rotate(${c.rot} ${c.x + 43} 100)`}>
      <Card x={c.x} y={30} width={86} height={128} />
      <Post x={c.x + 7} y={37} w={72} h={90} bg={c.post[0]} fg={c.post[1]} accent={c.post[2]} r={6} />
      <circle cx={c.x + 16} cy={142} r={6} className="fill-bk-alt stroke-bk-line" />
      <text x={c.x + 26} y={145.5} fontSize={8.5} fontWeight={700} className="fill-bk-fg" style={text}>{c.by}</text>
    </g>
  ))
}

function Team() {
  const people = [['M', '#ed5125'], ['J', '#101327'], ['S', '#1f7a5a']]
  return (
    <>
      <Card x={70} y={36} width={180} height={140} />
      <Post x={82} y={48} w={78} h={98} bg={POST.navy} fg="#fff" accent={POST.yellow} r={6} />
      <text x={172} y={66} fontSize={10} fontWeight={800} className="fill-bk-fg" style={text}>Studio style</text>
      <g><rect x={172} y={74} width={66} height={16} rx={8} className="fill-bk-alt" /><text x={180} y={85} fontSize={8} fontWeight={700} className="fill-bk-fg" style={text}>Your team</text></g>
      {people.map(([initial, color], i) => (
        <g key={initial}><circle cx={182 + i * 16} cy={116} r={10} fill={color} className="stroke-bk-surface" strokeWidth={2.5} /><text x={182 + i * 16} y={119.5} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff" style={text}>{initial}</text></g>
      ))}
      <text x={172} y={146} fontSize={8.5} className="fill-bk-muted" style={text}>Shared with 3 people</text>
      {/* A teammate picking the design up. */}
      <path d="M262 46l9 22 3.5-8.5 8.5-3.5z" className="fill-bk-ink" />
      <Chip x={272} y={66} label="Marta" dark w={42} />
    </>
  )
}

function Ads() {
  const frames = [
    { x: 30, w: 76, h: 136, ratio: '9:16', post: [POST.navy, '#fff', POST.yellow] },
    { x: 122, w: 84, h: 106, ratio: '4:5', post: [POST.orange, '#fff', POST.yellow] },
    { x: 222, w: 72, h: 72, ratio: '1:1', post: [POST.yellow, POST.navy, POST.orange] },
  ]
  return frames.map(f => {
    const y = 176 - f.h - 22
    return (
      <g key={f.ratio}>
        <rect x={f.x - 4} y={y - 16} width={f.w + 8} height={f.h + 42} rx={10} className="fill-bk-surface stroke-bk-line" />
        <circle cx={f.x + 4} cy={y - 7} r={3.5} className="fill-bk-butter" />
        <text x={f.x + 11} y={y - 4} fontSize={6.5} fontWeight={700} className="fill-bk-muted" style={text}>Sponsored</text>
        <Post x={f.x} y={y} w={f.w} h={f.h} bg={f.post[0]} fg={f.post[1]} accent={f.post[2]} r={4} />
        <rect x={f.x} y={y + f.h + 5} width={f.w * 0.42} height={5} rx={2} className="fill-bk-line" />
        <rect x={f.x + f.w - 34} y={y + f.h + 3} width={34} height={11} rx={3} className="fill-bk-alt" />
        <text x={f.x + f.w - 17} y={y + f.h + 10.5} textAnchor="middle" fontSize={6} fontWeight={800} className="fill-bk-fg" style={text}>Learn More</text>
        <text x={f.x + f.w / 2} y={192} textAnchor="middle" fontSize={8.5} fontWeight={800} className="fill-bk-muted" style={text}>{f.ratio}</text>
      </g>
    )
  })
}

function Brands() {
  const rows = [['K', POST.orange, 'Kachica'], ['P', POST.navy, 'Prumo'], ['B', '#1f7a5a', 'Barber PH']]
  return (
    <>
      <Card x={70} y={22} width={180} height={156} />
      {rows.map(([initial, color, name], i) => (
        <g key={name}>
          <rect x={84} y={36 + i * 34} width={152} height={28} rx={8} className={i === 0 ? 'fill-bk-alt' : 'fill-bk-surface'} />
          <rect x={90} y={40 + i * 34} width={20} height={20} rx={6} fill={color} />
          <text x={100} y={54 + i * 34} textAnchor="middle" fontSize={10} fontWeight={800} fill="#fff" style={text}>{initial}</text>
          <text x={118} y={54 + i * 34} fontSize={10} fontWeight={700} className="fill-bk-fg" style={text}>{name}</text>
        </g>
      ))}
      <rect x={84} y={140} width={152} height={28} rx={8} fill="none" className="stroke-bk-field" strokeDasharray="4 3" />
      <text x={160} y={158} textAnchor="middle" fontSize={10} fontWeight={700} className="fill-bk-muted" style={text}>+ Add a brand</text>
    </>
  )
}

function Uploads() {
  const tones = ['#d9c7a7', '#9fb7c9', '#c9a9a0', '#a7c4a0', '#e0cf9f', '#b5a9c9']
  return (
    <>
      <Card x={46} y={20} width={228} height={160} />
      {tones.map((c, i) => <rect key={c} x={60 + (i % 3) * 68} y={34 + Math.floor(i / 3) * 52} width={62} height={46} rx={7} fill={c} />)}
      <rect x={60} y={148} width={198} height={7} rx={3.5} className="fill-bk-alt" />
      <rect x={60} y={148} width={70} height={7} rx={3.5} className="fill-bk-butter" />
      <text x={60} y={170} fontSize={8.5} fontWeight={700} className="fill-bk-muted" style={text}>Your photos, in every post</text>
    </>
  )
}

function Credits() {
  return (
    <>
      <Card x={36} y={30} width={150} height={140} />
      <text x={52} y={74} fontSize={34} fontWeight={800} className="fill-bk-fg" style={text}>150</text>
      <text x={52} y={92} fontSize={9.5} fontWeight={700} className="fill-bk-muted" style={text}>credits every month</text>
      <rect x={52} y={110} width={118} height={7} rx={3.5} className="fill-bk-alt" />
      <rect x={52} y={110} width={34} height={7} rx={3.5} className="fill-bk-butter" />
      <text x={52} y={140} fontSize={8.5} className="fill-bk-muted" style={text}>≈ 37 posts</text>
      <g transform="rotate(6 250 100)"><Post x={208} y={40} w={84} h={104} bg={POST.yellow} fg={POST.navy} accent={POST.orange} r={8} /></g>
      <g transform="rotate(-4 236 108)"><Post x={194} y={58} w={84} h={104} bg={POST.navy} fg="#fff" accent={POST.yellow} r={8} /></g>
    </>
  )
}

const VISUALS = { schedule: Schedule, designs: Designs, community: Community, team: Team, ads: Ads, brands: Brands, uploads: Uploads, credits: Credits }

/** Which picture a plan limit shows. */
export function visualFor(info = {}) {
  if (info.limit === 'brands') return 'brands'
  if (info.limit === 'uploads') return 'uploads'
  return { scheduling: 'schedule', emailReminders: 'schedule', textReminders: 'schedule', customDesigns: 'designs', communityDesigns: 'community', teams: 'team', adDesigns: 'ads' }[info.feature] || 'credits'
}

export default function FeatureVisual({ name, className = '' }) {
  const Visual = VISUALS[name] || Credits
  return (
    <svg viewBox="0 0 320 200" role="img" aria-hidden="true" className={cn('block h-auto w-full font-sans', className)}>
      <Visual />
    </svg>
  )
}
