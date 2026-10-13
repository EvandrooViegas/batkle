'use client'
import {MockImage,MockLogo} from '@/components/DesignMockAssets'
import {blueprintSpec,complementaryAccent} from '@/lib/designs/brandBlueprint'
import {useState,useId,useEffect} from 'react'
import {PALETTE_PICKS,paletteColors,constrainBrandPalette} from '@/lib/designs/palettes'
import {Search,Check,ArrowRight,Loader2,Plus} from 'lucide-react'
import GlobalDesignPreview, { ZoomablePreview } from '@/components/GlobalDesignPreview'
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs'
import {DESIGN_LIBRARY,librarySpec} from '@/lib/designs/library'
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import {appButton} from '@/components/app/ui'

function samplePalette(canvas, theme, pick = 'brand') {
  const normalize = value => {
    if (typeof value !== 'string') return null
    const hex = value.trim()
    if (/^#[0-9a-f]{6}$/i.test(hex)) return hex
    if (/^#[0-9a-f]{3}$/i.test(hex)) return '#'+hex.slice(1).split('').map(c=>c+c).join('')
    return null
  }
  const brand = canvas?.designInput?.brandContext ?? canvas?.brandContext
  const nodes = canvas?.pages?.flatMap(p=>p.nodes||[]) || canvas?.nodes || []
  const supplied = (Array.isArray(brand?.colors)?brand.colors:[]).map(normalize).filter(Boolean)
  const recovered = nodes.flatMap(n=>[n.fill,n.color,...(n.stops||[]).map(s=>s.color)]).map(normalize).filter(Boolean)
  const colors = supplied.length ? supplied : [...new Set(recovered.filter(c=>!['#ffffff','#000000'].includes(c.toLowerCase())))]
  theme = PALETTE_PICKS.find(p=>p.id===pick)?.theme || theme
  const ordered = paletteColors(colors,pick)
  const primary = ordered[0] || normalize(canvas?.background) || '#53616b'
  const mix = (a,b,t) => '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('')
  const accent = ordered[1] || mix(primary,'#ffffff',.4)
  const bg = theme==='studio'?mix(primary,'#ffffff',.96):theme==='vibrant'?primary:mix(primary,'#000000',.88)
  const luminance = [1,3,5].map(i=>parseInt(bg.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0)
  return {primary,accent,bg,gradFrom:bg,gradTo:mix(bg,accent,.24),mutedText:luminance>.179?'#364036':'#dddeda',surface:theme==='studio'?'#ffffff':mix(bg,primary,.22),text:luminance>.179?'#101510':'#fafaf7',highlight:mix(accent,'#ffffff',.65),shade:mix(primary,'#000000',.4)}
}

// Local sample content: browsing never generates or changes a saved canvas.
export function Sample({design,chapter=0,canvas,pick='brand'}) {
  const uid=useId().replace(/:/g,'')
  let palette=samplePalette(canvas,design.blueprint?.theme||design.theme,pick)
  const brand=canvas?.designInput?.brandContext || canvas?.brandContext || {}
  const copy={headline:['Ideas that move you.','Make room for more.','Your next chapter.'][chapter],body:'A fresh perspective. Thoughtful details. Built around your brand.',cta:'Discover more',eyebrow:'STUDIO / 0'+(chapter+1)}
  copy.headline=['Lorem ipsum dolor sit amet.','Lorem ipsum, consectetur adipiscing.','Lorem ipsum. Your next chapter.'][chapter]
  copy.body='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'
  copy.eyebrow='BRAND / 0'+(chapter+1)
  if(chapter===0) copy.body=''
  if(design.blueprint)palette=constrainBrandPalette(palette,paletteColors(brand.colors||[],pick))
  const spec=design.blueprint ? blueprintSpec(design.blueprint,{slot_id:'sample',resolvedAsset:{url:'sample'}},copy,chapter,3) : librarySpec(DESIGN_LIBRARY.find(d=>d.id===(design.baseId||design.id)) || design,{slot_id:'sample',resolvedAsset:{url:'sample'}},copy,chapter,3,design.artDirection)
  const highlightText=(text,role)=>{
    const kind=design.blueprint?.highlight
    if(role!=='headline'||!kind||kind==='none'||chapter===1)return text
    const words=String(text||'').split(' '), phrase=words.splice(-Math.min(2,words.length)).join(' ')
    const styles={underline:{textDecoration:'underline',textDecorationColor:palette.accent},color:{color:palette.accent},background:{background:palette.primary,color:palette.text},font:{fontStyle:'italic'},gradient_text:{backgroundImage:'linear-gradient(110deg, '+palette.accent+', '+palette.primary+')',backgroundClip:'text',color:'transparent'},gradient_background:{backgroundImage:'linear-gradient(110deg, '+palette.primary+', '+palette.accent+')'}}
    if(kind==='boxed_gradient_text')return text
    return <>{words.join(' ')}{words.length?' ':''}<span style={styles[kind]}>{phrase}</span></>
  }
  const textStyle=e=>{
    const heading=e.role==='headline',fonts=brand.fonts||[]
    const font=fonts[heading?0:1]||fonts[0]
    const lineHeight=e.lineHeight||(heading?1.08:1.35)
    let size=e.size||(heading?86:30)
    const words=String(copy[e.role]||'').split(/\s+/)
    const availableWidth=e.width-(e.type==='badge'?40:0),availableHeight=e.height-(e.type==='badge'?24:0)
    // Fit fixed mock copy inside the authored box without altering its geometry.
    const fits=s=>{let lines=1,line=0;for(const word of words){const width=word.length*s*.56;if(width>availableWidth)return false;if(line&&line+width+s*.28>availableWidth){lines++;line=0}line+=width+s*.28}return lines*s*lineHeight<=availableHeight}
    while(size>18&&!fits(size))size--
    return {fontFamily:(typeof font==='string'?font:font?.family||font?.name)||'Arial,sans-serif',fontSize:size,fontWeight:e.weight||(heading?750:400),lineHeight,letterSpacing:e.letterSpacing||0,textShadow:e.shadow?'0 3px 14px #00000040':undefined,color:palette[e.color]||palette.text,textAlign:e.align||'left',padding:e.type==='badge'?'12px 20px':0,background:e.type==='badge'?palette[e.fill]||palette.primary:undefined,borderRadius:e.radius||24,boxSizing:'border-box',opacity:(e.opacity??100)/100}
  }
  return <svg viewBox="0 0 1080 1080" className="block w-full h-auto" aria-label={design.name+' sample slide '+(chapter+1)} role="img">
    <defs><linearGradient id={uid+'bg'} gradientTransform={'rotate('+((spec.background.angle??135)-90)+' .5 .5)'}><stop stopColor={palette[spec.background.color]||palette.bg}/><stop offset="1" stopColor={palette[spec.background.to]||palette.accent}/></linearGradient><radialGradient id={uid+'radial'}><stop stopColor={palette[spec.background.to]||palette.accent}/><stop offset="1" stopColor={palette[spec.background.color]||palette.bg}/></radialGradient></defs>
    <rect width="1080" height="1080" fill={spec.background.type==='radial'?'url(#'+uid+'radial)':spec.background.type==='gradient'?'url(#'+uid+'bg)':palette[spec.background.color]||palette.bg}/>
    {spec.background.type==='image'&&<MockImage width={1080} height={1080} palette={palette} uid={uid+'background'}/>}
    {[...spec.elements].sort((a,b)=>((a.type==='text'||a.type==='badge')?100:a.layer||0)-((b.type==='text'||b.type==='badge')?100:b.layer||0)).map((e,i)=>{
      const fill=palette[e.fill||e.color]||palette.primary
      const stroke=palette[e.color]||fill
      const opacity=(e.opacity??100)/100
      if(e.type==='text'||e.type==='badge') return <foreignObject key={i} x={e.x} y={e.y} width={e.width} height={e.height}><div xmlns="http://www.w3.org/1999/xhtml" style={textStyle(e)}>{highlightText(copy[e.role],e.role)}</div></foreignObject>
      if(e.type==='image')return <g key={i} opacity={opacity}><defs><clipPath id={uid+'clip'+i}>{e.mask==='circle'?<ellipse cx={e.x+e.width/2} cy={e.y+e.height/2} rx={e.width/2} ry={e.height/2}/>:<rect x={e.x} y={e.y} width={e.width} height={e.height} rx={e.mask==='pill'?Math.min(e.width,e.height)/2:e.radius||0}/>}</clipPath></defs><g clipPath={'url(#'+uid+'clip'+i+')'} style={{filter:e.shadow?'drop-shadow(0 12px 20px #00000030)':undefined}}><MockImage x={e.x} y={e.y} width={e.width} height={e.height} palette={palette} cutout={e.image_variant==='subject'||design.blueprint?.imagery?.placement==='cutout'} drawing={design.blueprint?.imagery?.style==='drawing'} uid={uid+'image'+i}/>{e.treatment==='darken'&&<rect x={e.x} y={e.y} width={e.width} height={e.height} fill="#000" opacity=".35"/>}</g></g>
      if(e.type==='glow'||e.type==='gradient')return <g key={i}><defs>{e.type==='glow'?<radialGradient id={uid+'layer'+i}><stop stopColor={stroke}/><stop offset="1" stopColor={stroke} stopOpacity="0"/></radialGradient>:<linearGradient id={uid+'layer'+i} gradientTransform={'rotate('+((e.angle??135)-90)+' .5 .5)'}><stop stopColor={stroke} stopOpacity={opacity}/><stop offset="1" stopColor={palette[e.to]||palette.accent} stopOpacity={(e.endOpacity??100)/100}/></linearGradient>}</defs><rect x={e.x} y={e.y} width={e.width} height={e.height} fill={'url(#'+uid+'layer'+i+')'} opacity={e.type==='glow'?opacity:1}/></g>
      if(e.type==='grid')return <g key={i} opacity={opacity}>{Array.from({length:14},(_,j)=><path key={j} d={'M '+(e.x+j*e.width/13)+' '+e.y+' V '+(e.y+e.height)+' M '+e.x+' '+(e.y+j*e.height/13)+' H '+(e.x+e.width)} stroke={stroke} strokeWidth={e.stroke||2}/>)}</g>
      if(e.type==='dots')return <g key={i} fill={stroke} opacity={opacity}>{Array.from({length:64},(_,j)=><circle key={j} cx={e.x+(j%8+.5)*e.width/8} cy={e.y+(Math.floor(j/8)+.5)*e.height/8} r={e.stroke||3}/>)}</g>
      if(e.type==='number')return <text key={i} x={e.x} y={e.y+e.height*.8} fontFamily="Arial,sans-serif" fontWeight="800" fontSize={e.size||240} fill={stroke} opacity={opacity}>0{chapter+1}</text>
      const transform=e.rotation?'rotate('+e.rotation+' '+(e.x+e.width/2)+' '+(e.y+e.height/2)+')':undefined
      if(e.type==='circle'||e.type==='ring')return <ellipse key={i} cx={e.x+e.width/2} cy={e.y+e.height/2} rx={e.width/2} ry={e.height/2} fill={e.type==='ring'?'none':fill} stroke={stroke} strokeWidth={e.stroke||2} opacity={opacity} transform={transform}/>
      return <rect key={i} x={e.x} y={e.y} width={e.width} height={e.height} rx={e.type==='pill'?Math.min(e.width,e.height)/2:e.radius||0} fill={e.type==='frame'?'none':fill} stroke={stroke} strokeWidth={e.stroke||0} transform={transform} style={{filter:e.shadow?'drop-shadow(0px 12px 20px #00000030)':undefined}} opacity={opacity}/>
    })}
    <g transform="translate(818 986) scale(.8)"><MockLogo palette={palette}/></g>
  </svg>
}

export default function DesignLibrary({canvas,selected,onSelect,disabled,triggerClassName,children}) {
  const brand = canvas?.designInput?.brandContext || canvas?.brandContext || {}
  const [open,setOpen]=useState(false), [entries,setEntries]=useState([]), [legacy,setLegacy]=useState([])
  const [active,setActive]=useState(''), [chapter,setChapter]=useState(''), [query,setQuery]=useState('')
  const [busy,setBusy]=useState(false), [loading,setLoading]=useState(false), [error,setError]=useState(''), [showLegacy,setShowLegacy]=useState(false)
  useEffect(()=>{
    if(!open)return
    let current=true
    setLoading(true);setError('')
    const read=async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data}
    Promise.all([brand.id?fetch('/api/global-designs/brand?flowId='+encodeURIComponent(brand.id)).then(read):Promise.resolve([]),brand.id?fetch('/api/flows/'+brand.id).then(read):Promise.resolve({brandContext:brand})])
      .then(([items,flow])=>{if(!current)return;setEntries(items);setLegacy((flow.brandContext?.designs||[]).filter(d=>d.source!=='global').map(d=>({...DESIGN_LIBRARY.find(p=>p.id===d.baseId),...d})));setActive(items.find(item=>item.design.id===selected?.id)?.design.id||items[0]?.design.id||selected?.id||DESIGN_LIBRARY[0].id);setShowLegacy(!items.length)})
      .catch(e=>{if(current)setError(e.message)}).finally(()=>{if(current)setLoading(false)})
    return()=>{current=false}
  },[open,brand.id])
  const global=entries.find(item=>item.design.id===active)
  const legacyDesign=[...legacy,...DESIGN_LIBRARY].find(d=>d.id===active)
  const choices=showLegacy?[...legacy,...DESIGN_LIBRARY].map(design=>({design})):entries
  const openLibrary=()=>{setOpen(true);setChapter('')}
  return <>{triggerClassName?<button type="button" className={triggerClassName} disabled={disabled} onClick={openLibrary}>{children}</button>:<Button variant="outline" size="sm" disabled={disabled} onClick={openLibrary}>Design: {selected?.name||'Custom'}</Button>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-bk-display text-[20px] font-bold tracking-[-0.03em]">Choose a design</DialogTitle>
          <DialogDescription className="text-[13.5px] text-bk-muted">One design keeps every slide consistent. Applying it replaces manual layout changes; you can undo it.</DialogDescription>
        </DialogHeader>
        {loading ? <p role="status" className="flex items-center gap-2 text-[13.5px] text-bk-muted"><Loader2 className="size-4 animate-spin"/>Loading your brand designs…</p> : (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="relative flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-bk-muted"/><input aria-label="Search designs" placeholder="Search designs" value={query} onChange={e=>setQuery(e.target.value)} className="h-9 w-full rounded-lg border border-bk-field bg-bk-surface pl-8 pr-3 text-[13.5px] focus:border-bk-fg focus:outline-none"/></div>
                <button type="button" className="shrink-0 text-[12.5px] font-semibold underline underline-offset-4" onClick={()=>setShowLegacy(v=>!v)}>{showLegacy?'Show brand designs':'Show starter designs'}</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {choices.filter(({design})=>(design.name+' '+(design.tags||[]).join(' ')).toLowerCase().includes(query.toLowerCase())).map(({design,family})=>(
                  <button key={design.id} type="button" disabled={busy} aria-pressed={active===design.id} className={'overflow-hidden rounded-xl border p-1.5 text-left transition-colors '+(active===design.id?'border-bk-fg ring-1 ring-bk-fg':'border-bk-line hover:border-bk-fg/40')} onClick={()=>{setActive(design.id);setChapter('')}}>
                    <span className="block overflow-hidden rounded-lg">{family?<GlobalDesignPreview family={family} brand={brand}/>:<Sample design={design} canvas={canvas}/>}</span>
                    <span className="mt-1.5 block px-1 pb-0.5 text-[13px] font-semibold">{design.name}</span>
                  </button>
                ))}
              </div>
              {!entries.length&&<p className="text-[12.5px] text-bk-muted">Pick designs for this brand in its Brand profile to see them here.</p>}
            </div>
            <div className="space-y-3">
              {global?<><ZoomablePreview family={global.family} brand={brand} sample={Number(chapter)||0}/><div role="group" aria-label="Sample slides" className="flex gap-1.5">{[0,1,2,3].map(i=><button type="button" key={i} aria-label={'Sample slide '+(i+1)} aria-pressed={(Number(chapter)||0)===i} onClick={()=>setChapter(String(i))} className={'h-1.5 flex-1 rounded-full transition-colors '+((Number(chapter)||0)===i?'bg-bk-fg':'bg-bk-line hover:bg-bk-field')}/>)}</div></>:legacyDesign?<Sample design={legacyDesign} canvas={canvas}/>:null}
              <p className="text-[12px] text-bk-muted">The preview uses sample text with your brand colours and fonts.</p>
            </div>
          </div>
        )}
        {error&&<p role="alert" className="text-[13px] font-semibold text-[#C2412F] dark:text-[#F0826F]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={appButton('quiet','md')} onClick={()=>setOpen(false)}>Cancel</button>
          <button type="button" className={appButton('primary','md')} disabled={busy||loading||(!global&&!legacyDesign)} onClick={async()=>{setBusy(true);setError('');try{await onSelect(active);setOpen(false)}catch(e){setError(e.message)}finally{setBusy(false)}}}>{busy?<><Loader2 className="size-4 animate-spin"/>Applying…</>:'Apply design'}</button>
        </div>
      </DialogContent>
    </Dialog></>
}
