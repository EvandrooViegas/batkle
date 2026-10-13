'use client'
import { textGradientStyle } from '@/lib/textGradient'


import { parseStyledText, renderStyledText } from '@/lib/styleParser'
import { createElement, useRef, useEffect, useState } from 'react'
import { useCanvasFonts } from '@/components/useCanvasFonts'

export function buildGradientCssClient(node) {
  const stops = (node.stops || [{ color: '#6366f1', position: 0, alpha: 100 }, { color: '#ec4899', position: 100, alpha: 100 }])
    .slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((s) => {
      const a = (typeof s.alpha === 'number' ? s.alpha : 100) / 100
      const hex = s.color || '#000000'
      const r = parseInt(hex.slice(1, 3), 16) || 0
      const g = parseInt(hex.slice(3, 5), 16) || 0
      const b = parseInt(hex.slice(5, 7), 16) || 0
      return `rgba(${r},${g},${b},${a}) ${s.position || 0}%`
    })
    .join(', ')
  if (node.gradientType === 'radial') return `radial-gradient(circle at center, ${stops})`
  const angle = typeof node.angle === 'number' ? node.angle : 90
  return `linear-gradient(${angle}deg, ${stops})`
}

export function buildFilterCssClient(filters) {
  if (!filters) return 'none'
  const f = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, blur: 0, sepia: 0, hueRotate: 0, opacity: 100, ...filters }
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) grayscale(${f.grayscale}%) sepia(${f.sepia}%) hue-rotate(${f.hueRotate}deg) blur(${f.blur}px) opacity(${f.opacity}%)`
}

/** Scaled, read-only render of a canvas. For carousels, `pageIndex` picks the slide (default: the first). */
export function CanvasPreview({ canvas, containerWidth, onClick, pageIndex = 0 }) {
  const containerRef = useRef(null)
  const [scale, setScale] = useState(1)
  useCanvasFonts(canvas)

  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth
        const canvasWidth = canvas?.width || 1080
        if (width > 0) {
          setScale(width / canvasWidth)
        }
      }
    }

    // Initial call
    updateScale()
    
    // Retry after a small delay to handle cases where DOM isn't laid out yet
    const timer = setTimeout(updateScale, 100)
    
    window.addEventListener('resize', updateScale)
    return () => {
      window.removeEventListener('resize', updateScale)
      clearTimeout(timer)
    }
  }, [canvas?.width])

  if (!canvas) return null;
  const w = canvas.width || 1080
  const colorFilter =
    canvas.colorMode === 'grayscale' ? 'grayscale(100%)' :
    canvas.colorMode === 'sepia' ? 'sepia(80%) saturate(120%)' :
    canvas.colorMode === 'invert' ? 'invert(100%)' :
    canvas.colorMode === 'high-contrast' ? 'contrast(160%)' : 'none'
  
  const isCarousel = canvas.type === 'carousel'
  const firstPage = isCarousel ? (canvas.pages?.[pageIndex] || canvas.pages?.[0]) : null
  const nodes = (isCarousel ? firstPage?.nodes : canvas.nodes) || []
  const bg = (isCarousel ? firstPage?.background : canvas.background) || '#ffffff'
  const classes = (isCarousel && firstPage?.classes) || canvas.classes || {}

  return (
    <div 
      ref={containerRef}
      className={`absolute inset-0 overflow-hidden ${onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
      style={{ background: bg, filter: colorFilter }}
      onClick={onClick}
    >
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: w, height: canvas.height || 1080, position: 'relative' }}>
        {nodes.filter(n => !n.hidden).map((n) => {
          const base = {
            position: 'absolute', left: n.x, top: n.y, width: n.width, height: n.height,
            transform: n.rotation ? `rotate(${n.rotation}deg)` : undefined,
            opacity: typeof n.opacity === 'number' && n.opacity < 100 ? n.opacity / 100 : undefined,
            boxSizing: 'border-box',
            display: 'flex', alignItems: 'center',
            justifyContent: n.textAlign === 'center' ? 'center' : n.textAlign === 'right' ? 'flex-end' : 'flex-start',
            overflow: n.type === 'text' ? 'visible' : 'hidden',
          }
          let style = base
          if (n.type === 'text') {
            style = { ...base, color: n.color || '#000', ...textGradientStyle(n), fontSize: n.fontSize || 48, fontWeight: n.fontWeight || 400,
              fontStyle: n.fontStyle === 'italic' ? 'italic' : 'normal',
              fontFamily: `'${n.fontFamily || 'Inter'}', sans-serif`,
              lineHeight: n.lineHeight || 1.2, letterSpacing: n.letterSpacing || 0,
              textTransform: n.textTransform || 'none', textDecoration: n.textDecoration || 'none',
              whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
              textShadow: n.textShadow?.enabled ? `${n.textShadow.offsetX || 0}px ${n.textShadow.offsetY || 0}px ${n.textShadow.blur || 0}px ${n.textShadow.color || '#000'}` : 'none' }
          } else if (n.type === 'shape') {
            style = { ...base, background: n.fill || '#6366f1',
              borderRadius: n.shape === 'ellipse' ? Math.max(n.width, n.height) : (n.borderRadius || 0),
              border: n.strokeWidth ? `${n.strokeWidth}px solid ${n.stroke || '#000'}` : 'none' }
          } else if (n.type === 'gradient') {
            style = { ...base, backgroundImage: buildGradientCssClient(n),
              borderRadius: n.shape === 'ellipse' ? Math.max(n.width, n.height) : (n.borderRadius || 0) }
          } else if (n.type === 'image') {
            const br = n.mask === 'circle' || n.mask === 'pill' ? Math.min(n.width, n.height) / 2 : n.mask === 'rounded' ? Math.min(n.width, n.height) * 0.15 : n.borderRadius || 0
            const cL = n.cropLeft || 0
            const cR = n.cropRight || 0
            const cT = n.cropTop || 0
            const cB = n.cropBottom || 0
            const hasClip = cL > 0 || cR > 0 || cT > 0 || cB > 0
            style = {
              ...base,
              borderRadius: br,
              ...(hasClip ? { clipPath: `inset(${cT}% ${cR}% ${cB}% ${cL}% round ${br}px)` } : {}),
            }
          }
          return (
            <div key={n.id} style={style}>
              {n.type === 'text' ? <div style={{width:'100%',display:'block',textAlign:n.textAlign || 'left'}}>{renderStyledText(parseStyledText(n.text || '',classes),createElement,{canvasClasses:classes})}</div> : n.type === 'image' && n.src ? (
                <img src={n.src} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: n.objectFit || 'cover', filter: buildFilterCssClient(n.filters), transform: n.flipX || n.flipY ? `scale(${n.flipX ? -1 : 1}, ${n.flipY ? -1 : 1})` : undefined }} />
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
