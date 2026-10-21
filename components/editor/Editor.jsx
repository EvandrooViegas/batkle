'use client'

import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  AlertCircle, ArrowLeft, Bold, Check, ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, CopyPlus, Download, FileJson,
  Image as ImageIcon, Italic, Keyboard, Layers, Link as LinkIcon, Loader2, Magnet, Maximize2, Minus, Moon, MoreHorizontal,
  Palette, Plus, Redo2, SlidersHorizontal, Sun, Trash2, Underline, Undo2, Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import DesignLibrary from '@/components/DesignLibrary'
import GalleryPicker from '@/components/GalleryPicker'
import { useCanvasFonts } from '@/components/useCanvasFonts'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TooltipProvider } from '@/components/ui/tooltip'
import { appButton, appLayer } from '@/components/app/ui'
import {
  addPage, applyDesign, deletePage, duplicatePage, loadDocument, movePage, openPage, orderedPages, renamePage, toDocument,
} from '@/lib/client/editorDocument'
import {
  alignNodes, distributeNodes, handleCursor, handlesFor, resizeFromHandle, selectionBounds, snapResizeDrag, touchingLines, visibleBox,
} from '@/lib/client/editorGeometry'
import { applyGroupLayoutToNodes, getGroupBounds, insertNodeIdIntoGroup, moveNodeIdInGroup, normalizeGroupGaps, removeNodeFromAllGroups, removeNodeIdFromGroup, reorderGroupNodeIds, sortNodeIdsByLayout } from '@/lib/groups'
import { applyPatchWithReflow } from '@/lib/flowLayout'
import { isVisibleBackground, parseStyledText, renderStyledText, splitTokensByNewlines } from '@/lib/styleParser'
import { textGradientStyle } from '@/lib/textGradient'
import { cn } from '@/lib/utils'
import { ApiPanel } from './ApiPanel'
import { ColorField, IconButton, Segmented, SwatchContext, TextField, Tip } from './controls'
import {
  CROP, DEFAULT_FILTERS, MAX_ZOOM, MIN_ZOOM, POLYGON_MASKS, SELECT, SNAP, SNAP_THRESHOLD, STACKED_COPY, brandColors, buildFilterCss,
  classAttr, collectSnapTargets, documentColors, freeSpot, getCanvasClassStyle, normalizeClassTagName, plainTextFromStyled, snapMovePosition,
  textPreset, uploadImage,
} from './kit'
import { LayerMenu, modKey } from './LayerMenu'
import { AddSection, LayersPanel } from './LayersPanel'
import {
  AdvancedSection, GradientProperties, GroupProperties, ImageProperties, LayerHeader, LayoutSection, MultiSelection, PostSettings,
  ShapeProperties, TextProperties,
} from './properties'
import { SlideStrip } from './SlideStrip'
import { StylesPanel } from './StylesPanel'

const menuItem = 'gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold focus:bg-bk-alt focus:text-bk-fg'
const LAYERS_MIME = 'application/x-batkle-layers'
const CLIPBOARD_KEY = 'kand-clipboard'
const SNAP_KEY = 'bk-editor-snap'
const ZOOM_PRESETS = [0.5, 1, 2]

/**
 * A random v4 id for a new layer, group or slide. Not the `uuid` package: the server keeps that as an external ES
 * module, which turns this whole module async and breaks the page's server render ("Element type is invalid").
 * randomUUID only exists on HTTPS and localhost, so other addresses build one from random bytes.
 */
function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const SHORTCUTS = [
  ['Edit', [
    ['Undo / redo', 'Ctrl Z · Ctrl Shift Z'],
    ['Save now', 'Ctrl S'],
    ['Cut / copy / paste layers', 'Ctrl X · C · V'],
    ['Paste an image or text from another app', 'Ctrl V'],
    ['Duplicate', 'Ctrl D'],
    ['Delete', 'Delete'],
    ['Select everything', 'Ctrl A'],
    ['Select the next / previous layer', 'Tab · Shift Tab'],
    ['Deselect', 'Esc'],
    ['Type in text · crop an image', 'Enter or double-click'],
  ]],
  ['Arrange', [
    ['Add to or take from the selection', 'Shift + click'],
    ['Select the layer behind', 'Alt + click'],
    ['Nudge (10 px with Shift)', 'Arrow keys'],
    ['Move straight across or down', 'Shift + drag'],
    ['Move or resize without snapping', 'Ctrl + drag'],
    ['Resize keeping proportions', 'Shift + drag a handle'],
    ['Bring forward / send backward', 'Ctrl ] · Ctrl ['],
    ['Bring to front / send to back', 'Ctrl Shift ] · Ctrl Shift ['],
    ['Group / ungroup', 'Ctrl G · Ctrl Shift G'],
    ['Hide / lock', 'Ctrl Shift H · Ctrl Shift L'],
  ]],
  ['Add', [
    ['Text', 'T'],
    ['Image', 'I'],
    ['Rectangle · circle · line', 'R · O · L'],
  ]],
  ['View', [
    ['Zoom in / out', 'Ctrl + · Ctrl −'],
    ['Zoom around the pointer', 'Ctrl + scroll'],
    ['Zoom to fit · 100%', 'Shift 1 · Shift 0'],
    ['Move around the canvas', 'Space + drag'],
    ['Previous / next slide', 'Page Up · Page Down'],
    ['Show these shortcuts', '?'],
  ]],
]

const isTyping = t => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
const overlaps = (a, b) => !(a.x > b.x + b.width || a.x + a.width < b.x || a.y > b.y + b.height || a.y + a.height < b.y)
const clipText = nodes => nodes.filter(n => n.type === 'text').map(n => plainTextFromStyled(n.text || '').trim()).filter(Boolean).join('\n')

function readStoredClipboard() {
  try {
    const stored = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) || 'null')
    // Older editors stored the copied layers alone.
    return Array.isArray(stored) ? { nodes: stored, text: clipText(stored) } : stored
  } catch {
    return null
  }
}

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'
  return (
    <IconButton label={dark ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? <Sun /> : <Moon />}
    </IconButton>
  )
}

function SaveStatus({ saving, error, dirty, onSave }) {
  const state = saving ? 'saving' : error ? 'error' : dirty ? 'dirty' : 'saved'
  const label = { saving: 'Saving…', error: 'Not saved', dirty: 'Unsaved changes', saved: 'Saved' }[state]
  return (
    <Tip label={state === 'error' ? `${error}. Click to try again.` : state === 'saved' ? 'All changes saved' : 'Save now (Ctrl+S)'}>
      <button
        type="button"
        onClick={onSave}
        aria-live="polite"
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-semibold transition-colors hover:bg-bk-alt',
          state === 'error' ? 'text-[#C2412F] dark:text-[#F0826F]' : 'text-bk-muted',
        )}
      >
        {state === 'saving' ? <Loader2 className="size-3.5 animate-spin" />
          : state === 'error' ? <AlertCircle className="size-3.5" />
            : state === 'dirty' ? <span className="size-2 rounded-full bg-bk-butter ring-2 ring-bk-butter/30" />
              : <Check className="size-3.5" />}
        <span className="hidden xl:inline">{label}</span>
      </button>
    </Tip>
  )
}

/** Tooltips, and the brand and post colours offered by every colour field. */
function EditorProviders({ swatches, children }) {
  return (
    <SwatchContext.Provider value={swatches}>
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
    </SwatchContext.Provider>
  )
}

function CenteredState({ children }) {
  return <div className={cn(appLayer, 'flex h-[100dvh] flex-col items-center justify-center gap-4 bg-bk-alt px-6 text-center')}>{children}</div>
}

export default function Editor() {
  const { id } = useParams()
  const [canvasState, setCanvasState] = useState(null)
  const [loadError, setLoadError] = useState('')
  const canvasRefObj = useRef(canvasState)
  canvasRefObj.current = canvasState
  const canvas = canvasState
  const carousel = !!canvas?._pageId

  // What the server has. Edits are compared against it, so switching slides alone never counts as a change.
  const savedRef = useRef(null)
  const [savedString, setSavedString] = useState(null)
  const doc = useMemo(() => (canvasState ? toDocument(canvasState) : null), [canvasState])
  const docString = useMemo(() => (doc ? JSON.stringify(doc) : null), [doc])
  const hasChanges = docString !== null && savedString !== null && docString !== savedString
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const savingRef = useRef(null)
  const saveAgainRef = useRef(false)

  const historyRef = useRef({ past: [], future: [] })
  const lastPushRef = useRef({ key: null, at: 0 })
  const clipboardRef = useRef([])
  const copiedPayloadRef = useRef(null)
  const [hasClipboard, setHasClipboard] = useState(false)
  const [, setHistoryTick] = useState(0)
  // Text is measured only once the canvas's own fonts have loaded, never with a fallback font.
  const fontsReady = useCanvasFonts(canvasState)

  // Quick edits of the same thing (typing, dragging a slider) undo in one step.
  const pushHistory = useCallback((stateToPush, key = null) => {
    if (!stateToPush) return
    const now = Date.now()
    const last = lastPushRef.current
    lastPushRef.current = { key, at: now }
    if (key && last.key === key && now - last.at < 800) return
    historyRef.current.past.push(stateToPush)
    if (historyRef.current.past.length > 80) historyRef.current.past.shift()
    historyRef.current.future = []
    setHistoryTick(t => t + 1)
  }, [])

  const setCanvas = useCallback((updater, skipHistory = false, historyKey = null) => {
    setCanvasState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (!skipHistory && prev && prev !== next) pushHistory(prev, historyKey)
      return next
    })
  }, [pushHistory])

  const undo = useCallback(() => {
    if (historyRef.current.past.length === 0) return
    const prev = historyRef.current.past.pop()
    historyRef.current.future.push(canvasRefObj.current)
    canvasRefObj.current = prev
    lastPushRef.current = { key: null, at: 0 }
    setCanvasState(prev)
    setHistoryTick(t => t + 1)
  }, [])
  const redo = useCallback(() => {
    if (historyRef.current.future.length === 0) return
    const next = historyRef.current.future.pop()
    historyRef.current.past.push(canvasRefObj.current)
    canvasRefObj.current = next
    lastPushRef.current = { key: null, at: 0 }
    setCanvasState(next)
    setHistoryTick(t => t + 1)
  }, [])

  const [selectedIds, setSelectedIds] = useState([])
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const [selectedGroupId, setSelectedGroupId] = useState(null)
  const [expandedGroups, setExpandedGroups] = useState({})
  const primarySelectedId = selectedIds[selectedIds.length - 1] ?? null
  const [editingId, setEditingId] = useState(null)
  const editingIdRef = useRef(editingId)
  editingIdRef.current = editingId
  const [cropModeNodeId, setCropModeNodeId] = useState(null)
  const [hoverId, setHoverId] = useState(null)
  const [scale, setScale] = useState(0.5)
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const userZoomRef = useRef(false)
  const zoomAnchorRef = useRef(null)
  const canvasViewportRef = useRef(null)
  const canvasRef = useRef(null)
  const editorRef = useRef(null)
  const hasInitializedRef = useRef(false)
  const savedRangeRef = useRef(null)
  const pointerInViewportRef = useRef(false)
  const [imageDialog, setImageDialog] = useState(false)
  const [imageSource, setImageSource] = useState('gallery')
  const [imageUrl, setImageUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [tab, setTab] = useState('edit')
  const [panel, setPanel] = useState(null) // 'layers' | 'edit' on small screens
  const fileInputRef = useRef(null)
  const measureRef = useRef(null)
  const [sessionImages, setSessionImages] = useState([])
  const [isDraggingOverBase, setIsDraggingOverBase] = useState(false)
  const [snapLines, setSnapLines] = useState([])
  const [readout, setReadout] = useState(null) // { text, x, y } next to the pointer while dragging
  const [marquee, setMarquee] = useState(null)
  const [snapping, setSnapping] = useState(true)
  const snappingRef = useRef(snapping)
  snappingRef.current = snapping
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  const [selectionRect, setSelectionRect] = useState(null)
  const [textFormat, setTextFormat] = useState({ bold: false, italic: false, underline: false, color: '#000000', align: 'left' })

  useEffect(() => {
    try {
      if (localStorage.getItem(SNAP_KEY) === 'off') setSnapping(false)
      if (readStoredClipboard()?.nodes?.length) setHasClipboard(true)
    } catch {}
  }, [])
  const toggleSnapping = () => {
    const next = !snapping
    setSnapping(next)
    try { localStorage.setItem(SNAP_KEY, next ? 'on' : 'off') } catch {}
  }

  const tagsToHtml = useCallback((text) => {
    const tokens = parseStyledText(text || '', canvas?.classes || {})
    const toHtml = (arr) => arr.map(t => {
      if (typeof t === 'string') return t.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
      if (t.className) {
        const cleanName = t.className.startsWith('.') ? t.className.slice(1) : t.className
        return `<span class="${cleanName}">${toHtml(t.children)}</span>`
      }
      // Inline style token: serialize style object to html style attr
      const styleStr = Object.entries(t.style || {}).map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').toLowerCase()}:${v}`).join(';')
      return `<span style="${styleStr}">${toHtml(t.children)}</span>`
    }).join('')
    return toHtml(tokens)
  }, [canvas?.classes])

  const htmlToTags = useCallback((html) => {
    const temp = document.createElement('div')
    temp.innerHTML = html
    const walk = (n) => {
      let str = ''
      for (const child of n.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          // Preserve all whitespace including leading spaces
          str += child.textContent
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === 'SPAN' && child.className && !child.style.cssText) {
            // Keep class tags stable whether the stored class key has a dot prefix or not.
            const cls = normalizeClassTagName(canvas?.classes || {}, child.className)
            str += `<%kind:${cls}:${walk(child)}%>`
          } else if (child.tagName === 'SPAN' && child.style.cssText) {
            // Inline-styled span (from execCommand or manual span)
            const styleParts = []
            if (child.style.color) styleParts.push(`color=${child.style.color}`)
            if (child.style.fontSize) styleParts.push(`font-size=${child.style.fontSize}`)
            if (child.style.textDecoration && child.style.textDecoration !== 'none') styleParts.push(`textDecoration=${child.style.textDecoration}`)
            if (child.style.fontWeight) styleParts.push(`fontWeight=${child.style.fontWeight}`)
            if (child.style.fontStyle) styleParts.push(`fontStyle=${child.style.fontStyle}`)
            if (child.style.backgroundColor) styleParts.push(`backgroundColor=${child.style.backgroundColor}`)
            if (child.style.letterSpacing) styleParts.push(`letterSpacing=${child.style.letterSpacing}`)
            str += styleParts.length > 0 ? `<%inline:${styleParts.join('|')}:${walk(child)}%>` : walk(child)
          } else if (child.tagName === 'FONT') {
            // execCommand 'foreColor' creates <font color="..."> in some browsers
            const inner = walk(child)
            str += child.color ? `<%inline:color=${child.color}:${inner}%>` : inner
          } else if (child.tagName === 'U') {
            str += `<%inline:textDecoration=underline:${walk(child)}%>`
          } else if (child.tagName === 'B' || child.tagName === 'STRONG') {
            str += `<%inline:fontWeight=bold:${walk(child)}%>`
          } else if (child.tagName === 'I' || child.tagName === 'EM') {
            str += `<%inline:fontStyle=italic:${walk(child)}%>`
          } else if (child.tagName === 'BR') {
            str += '\n'
          } else if (child.tagName === 'DIV' || child.tagName === 'P') {
            const childStr = walk(child)
            str += childStr ? '\n' + childStr : '\n'
          } else {
            str += walk(child)
          }
        }
      }
      return str
    }
    return walk(temp).replace(/\n\n/g, '\n')
  }, [canvas?.classes])

  const handleSelectionChange = () => {
    if (!editingId) return
    const sel = window.getSelection()
    const clear = () => { setSelectionRect(null); savedRangeRef.current = null }
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return clear()
    const editor = document.getElementById(`editor-${editingId}`)
    if (!editor || !editor.contains(sel.anchorNode)) return clear()
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0) return clear()
    savedRangeRef.current = range.cloneRange()
    setSelectionRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    const editingNode = canvasState?.nodes?.find(n => n.id === editingId)
    setTextFormat({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      color: document.queryCommandValue('foreColor') || editingNode?.color || '#000000',
      align: document.queryCommandState('justifyCenter') ? 'center' : document.queryCommandState('justifyRight') ? 'right' : 'left',
    })
  }

  const restoreSelection = () => {
    if (!savedRangeRef.current) return false
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(savedRangeRef.current)
    return true
  }

  const applyAdHocStyle = (styleKey, value) => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    restoreSelection()
    if (styleKey === 'color') document.execCommand('foreColor', false, value)
    else if (styleKey === 'textDecoration' && value === 'underline') document.execCommand('underline')
    else if (styleKey === 'fontWeight' && value === 'bold') document.execCommand('bold')
    else if (styleKey === 'fontStyle' && value === 'italic') document.execCommand('italic')
    else {
      // For other styles (fontSize etc.), manually wrap in a span
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      const span = document.createElement('span')
      span.style[styleKey] = typeof value === 'number' ? `${value}px` : value
      try {
        span.appendChild(range.extractContents())
        range.insertNode(span)
      } catch { toast.error('Could not apply that style'); return }
    }
    const text = htmlToTags(editor.innerHTML || '')
    if (text) updateNode(editingId, { text })
  }

  const applyAdHocClass = (className) => {
    if (!className) return
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    if (!restoreSelection()) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const span = document.createElement('span')
    span.className = className.startsWith('.') ? className.slice(1) : className
    try {
      span.appendChild(range.extractContents())
      range.insertNode(span)
      const text = htmlToTags(editor.innerHTML || '')
      if (text) updateNode(editingId, { text })
    } catch {
      toast.error('That style cannot be applied to this selection')
    }
  }

  useEffect(() => {
    if (editingId) {
      if (!hasInitializedRef.current && editorRef.current) {
        const enode = canvasState?.nodes?.find(n => n.id === editingId)
        if (enode) {
          const textContent = enode.text || ''
          // Styled text renders as HTML; plain text uses textContent to keep every space.
          if (textContent.includes('<%')) editorRef.current.innerHTML = tagsToHtml(textContent)
          else editorRef.current.textContent = textContent
          editorRef.current.focus()
          // Select all text so a style or format applies straight away.
          const range = document.createRange()
          range.selectNodeContents(editorRef.current)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(range)
          requestAnimationFrame(() => handleSelectionChange())
        }
        hasInitializedRef.current = true
      }
    } else {
      hasInitializedRef.current = false
    }
  }, [editingId, canvasState, tagsToHtml]) // eslint-disable-line react-hooks/exhaustive-deps

  // Leave text editing (keeping the text) when clicking anywhere but the text, its toolbar or a style list.
  useEffect(() => {
    if (!editingId) return
    const handler = (e) => {
      if (e.target.closest?.('[data-floating-toolbar], [data-class-panel], [data-editor-popover]')) return
      const editor = editorRef.current
      if (editor && editor.contains(e.target)) return
      if (editor) {
        const text = htmlToTags(editor.innerHTML || '')
        if (text !== undefined) updateNode(editingId, { text })
      }
      setEditingId(null)
      setSelectionRect(null)
      savedRangeRef.current = null
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [editingId, htmlToTags]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true
    fetch(`/api/canvases/${id}`)
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!live) return
        if (!ok || data?.error) { setLoadError(data?.error === 'Not found' ? 'This post no longer exists.' : data?.error || 'This post could not be loaded.'); return }
        // ?page=<slide id> or ?slide=<number> opens a carousel on that slide.
        const query = new URLSearchParams(window.location.search)
        const slide = Number(query.get('slide'))
        const pageId = query.get('page') || (slide > 0 ? orderedPages(data.pages)[slide - 1]?.id : undefined)
        const state = loadDocument(data, pageId)
        const saved = JSON.stringify(toDocument(state))
        savedRef.current = saved
        setSavedString(saved)
        historyRef.current = { past: [], future: [] }
        setCanvasState(state)
      })
      .catch(() => { if (live) setLoadError('This post could not be loaded. Check your connection and try again.') })
    return () => { live = false }
  }, [id])

  // A new slide starts with nothing selected.
  const openPageId = canvasState?._pageId
  useEffect(() => {
    setSelectedIds([])
    setSelectedGroupId(null)
    setEditingId(null)
    setCropModeNodeId(null)
    setSelectionRect(null)
    setHoverId(null)
    savedRangeRef.current = null
  }, [openPageId])

  const fitCanvasToView = useCallback(() => {
    if (!canvas) return
    const el = canvasViewportRef.current
    const pad = 80
    const vw = el ? el.clientWidth - pad : window.innerWidth - 720
    const vh = el ? el.clientHeight - pad : window.innerHeight - 180
    setScale(Math.max(MIN_ZOOM, Math.min(vw / canvas.width, vh / canvas.height, 1)))
    userZoomRef.current = false
  }, [canvas?.width, canvas?.height]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!canvas) return
    const updateScale = () => { if (!userZoomRef.current) fitCanvasToView() }
    updateScale()
    window.addEventListener('resize', updateScale)
    return () => window.removeEventListener('resize', updateScale)
  }, [canvas, fitCanvasToView])

  // The viewport changes size when the slide strip or a side panel appears.
  useEffect(() => {
    const el = canvasViewportRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { if (!userZoomRef.current) fitCanvasToView() })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fitCanvasToView, !!canvas]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Zooms keeping the canvas point under `at` (the pointer, or the middle of the view) where it is. */
  const zoomTo = useCallback((next, at) => {
    const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    const rect = canvasRef.current?.getBoundingClientRect()
    const view = canvasViewportRef.current?.getBoundingClientRect()
    const point = at || (view && { clientX: view.left + view.width / 2, clientY: view.top + view.height / 2 })
    if (rect && point) {
      const s = scaleRef.current
      zoomAnchorRef.current = { cx: (point.clientX - rect.left) / s, cy: (point.clientY - rect.top) / s, clientX: point.clientX, clientY: point.clientY }
    }
    userZoomRef.current = true
    setScale(target)
  }, [])
  const zoomBy = useCallback((factor, at) => zoomTo(scaleRef.current * factor, at), [zoomTo])

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current
    zoomAnchorRef.current = null
    const el = canvasViewportRef.current
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!anchor || !el || !rect) return
    el.scrollLeft += rect.left + anchor.cx * scale - anchor.clientX
    el.scrollTop += rect.top + anchor.cy * scale - anchor.clientY
  }, [scale])

  useLayoutEffect(() => {
    const el = canvasViewportRef.current
    if (!el || !canvas) return
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // Mouse wheels step; trackpad pinches send many small deltas.
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      zoomBy(Math.min(1.25, Math.max(0.8, Math.exp(-delta * 0.002))), { clientX: e.clientX, clientY: e.clientY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [!!canvas, zoomBy]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hold Space to drag the view around.
  useEffect(() => {
    const down = (e) => {
      if (e.code !== 'Space' || editingIdRef.current || isTyping(e.target)) return
      if (e.target.closest?.('[role="dialog"], [role="menu"]')) return
      // Space presses a focused button, unless the pointer is on the canvas.
      const control = e.target.closest?.('button, a, [role="radio"], [role="switch"], [role="slider"]')
      if (control && !pointerInViewportRef.current) return
      e.preventDefault()
      if (control) control.blur()
      setSpaceDown(true)
    }
    const up = (e) => { if (e.code === 'Space') setSpaceDown(false) }
    const reset = () => setSpaceDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [])

  const startPan = (e) => {
    const el = canvasViewportRef.current
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    setPanning(true)
    const move = (ev) => {
      el.scrollLeft = start.left - (ev.clientX - start.x)
      el.scrollTop = start.top - (ev.clientY - start.y)
    }
    const up = () => {
      setPanning(false)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const groups = canvas?.groups || []
  const nodes = canvas?.nodes || []
  const selectedGroup = selectedGroupId ? groups.find((g) => g.id === selectedGroupId) : null
  const selected = primarySelectedId ? nodes.find((n) => n.id === primarySelectedId) : null
  const selectedNodes = nodes.filter(n => selectedIds.includes(n.id))
  const pages = canvas?.pages || []
  const openIndex = carousel ? pages.findIndex(p => p.id === canvas._pageId) : 0

  const clearSelection = () => {
    setSelectedIds([])
    setSelectedGroupId(null)
    setCropModeNodeId(null)
  }

  /** Selects a layer from the layers list: Ctrl toggles it, Shift selects the run of layers up to it. */
  const selectLayer = (nodeId, e) => {
    setCropModeNodeId(null)
    setSelectedGroupId(null)
    if (e?.ctrlKey || e?.metaKey) {
      setSelectedIds((prev) => (prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]))
      return
    }
    if (e?.shiftKey && selectedIds.length > 0) {
      const order = nodes.slice().reverse().map(n => n.id)
      const from = order.indexOf(primarySelectedId)
      const to = order.indexOf(nodeId)
      const run = from === -1 || to === -1 ? [nodeId] : order.slice(Math.min(from, to), Math.max(from, to) + 1)
      setSelectedIds((prev) => [...new Set([...prev, ...run.filter(id => id !== nodeId), nodeId])])
      return
    }
    setSelectedIds([nodeId])
  }

  const selectGroup = (groupId) => {
    const g = groups.find((gr) => gr.id === groupId)
    if (!g) return
    setSelectedGroupId(groupId)
    setSelectedIds([...g.nodeIds])
  }

  const selectAll = () => {
    setSelectedIds(nodes.filter(n => !n.locked && !n.hidden).map(n => n.id))
    setSelectedGroupId(null)
  }

  // Tab walks through the layers front to back, as the layers list shows them.
  const cycleSelection = (step) => {
    const order = nodes.slice().reverse().filter(n => !n.hidden)
    if (!order.length) return
    const at = order.findIndex(n => n.id === primarySelectedId)
    const next = order[at === -1 ? (step > 0 ? 0 : order.length - 1) : (at + step + order.length) % order.length]
    setSelectedIds([next.id])
    setSelectedGroupId(null)
  }

  const toggleGroupExpanded = (groupId) => setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))

  const stripNodesFromOtherGroups = (groupsList, nodeIds, exceptGroupId) =>
    (groupsList || [])
      .map((g) => {
        if (g.id === exceptGroupId) return g
        const nodeIdsFiltered = g.nodeIds.filter((id) => !nodeIds.includes(id))
        return { ...g, nodeIds: nodeIdsFiltered, gaps: normalizeGroupGaps({ ...g, nodeIds: nodeIdsFiltered }) }
      })
      .filter((g) => g.nodeIds.length >= 2)

  const createGroupFromSelection = () => {
    const ids = selectedIds.filter((id) => canvas.nodes?.some((n) => n.id === id))
    if (ids.length < 2) return toast.error('Select at least two layers (Shift+click them)')
    const layout = 'horizontal'
    const sorted = sortNodeIdsByLayout(ids, canvas.nodes, layout)
    const groupId = uuidv4()
    const newGroup = {
      id: groupId,
      name: `Group ${groups.length + 1}`,
      nodeIds: sorted,
      layout,
      align: 'left',
      gaps: sorted.slice(0, -1).map(() => ({ gapX: 0, gapY: 0 })),
    }
    setCanvas((c) => {
      let nextGroups = stripNodesFromOtherGroups(c.groups || [], sorted, groupId)
      nextGroups = [...nextGroups, newGroup]
      let nodes = c.nodes.map((n) => {
        if (sorted.includes(n.id)) return { ...n, groupId }
        const stillGrouped = nextGroups.some((g) => g.nodeIds.includes(n.id))
        if (n.groupId && !stillGrouped) return { ...n, groupId: undefined }
        return n
      })
      nodes = applyGroupLayoutToNodes(nodes, newGroup)
      return { ...c, groups: nextGroups, nodes }
    })
    setSelectedGroupId(groupId)
    setSelectedIds([...sorted])
  }

  const ungroupById = (groupId) => {
    setCanvas((c) => ({
      ...c,
      groups: (c.groups || []).filter((g) => g.id !== groupId),
      nodes: c.nodes.map((n) => (n.groupId === groupId ? { ...n, groupId: undefined } : n)),
    }))
    if (selectedGroupId === groupId) setSelectedGroupId(null)
  }

  const ungroupSelection = () => {
    const ids = new Set([selectedGroupId, ...selectedNodes.map(n => n.groupId)].filter(Boolean))
    if (!ids.size) return
    setCanvas((c) => ({
      ...c,
      groups: (c.groups || []).filter((g) => !ids.has(g.id)),
      nodes: c.nodes.map((n) => (ids.has(n.groupId) ? { ...n, groupId: undefined } : n)),
    }))
    setSelectedGroupId(null)
  }

  const updateGroup = (groupId, patch) => {
    setCanvas((c) => {
      const g = (c.groups || []).find((gr) => gr.id === groupId)
      if (!g) return c
      const updated = { ...g, ...patch }
      if (patch.nodeIds) updated.nodeIds = patch.nodeIds
      updated.gaps = normalizeGroupGaps(updated)
      return {
        ...c,
        groups: (c.groups || []).map((gr) => (gr.id === groupId ? updated : gr)),
        nodes: applyGroupLayoutToNodes(c.nodes, updated),
      }
    }, false, `group:${groupId}:${Object.keys(patch).sort().join()}`)
  }

  const moveGroupMember = (groupId, nodeId, direction) => {
    const g = groups.find((gr) => gr.id === groupId)
    if (!g) return
    const updated = moveNodeIdInGroup(g, nodeId, direction)
    updateGroup(groupId, { nodeIds: updated.nodeIds, gaps: updated.gaps })
  }

  const addNodeToGroup = (groupId, nodeId, beforeNodeId = null) => {
    setCanvas((c) => {
      const nextGroups = stripNodesFromOtherGroups(c.groups || [], [nodeId], groupId)
      const gi = nextGroups.findIndex((gr) => gr.id === groupId)
      if (gi === -1) return c
      const updated = insertNodeIdIntoGroup(nextGroups[gi], nodeId, beforeNodeId)
      nextGroups[gi] = updated
      let nodes = c.nodes.map((n) => {
        if (n.id === nodeId) return { ...n, groupId }
        const still = nextGroups.some((gr) => gr.nodeIds.includes(n.id))
        if (n.groupId && !still) return { ...n, groupId: undefined }
        return n
      })
      nodes = applyGroupLayoutToNodes(nodes, updated)
      return { ...c, groups: nextGroups, nodes }
    })
  }

  const removeNodeFromGroupById = (groupId, nodeId) => {
    setCanvas((c) => {
      const g = (c.groups || []).find((gr) => gr.id === groupId)
      if (!g) return c
      const reduced = removeNodeIdFromGroup(g, nodeId)
      const nextGroups = (c.groups || [])
        .map((gr) => (gr.id === groupId ? reduced : gr))
        .filter((gr) => gr.nodeIds.length >= 2)
      let nodes = c.nodes.map((n) => (n.id === nodeId ? { ...n, groupId: undefined } : n))
      const remaining = nextGroups.find((gr) => gr.id === groupId)
      if (remaining) nodes = applyGroupLayoutToNodes(nodes, remaining)
      return { ...c, groups: nextGroups, nodes }
    })
  }

  const reorderGroupMember = (groupId, draggedId, beforeNodeId) => {
    const g = groups.find((gr) => gr.id === groupId)
    if (!g || draggedId === beforeNodeId) return
    updateGroup(groupId, { nodeIds: reorderGroupNodeIds(g.nodeIds, draggedId, beforeNodeId) })
  }

  const updateGroupGap = (groupId, gapIndex, key, value) => {
    setCanvas((c) => {
      const g = (c.groups || []).find((gr) => gr.id === groupId)
      if (!g) return c
      const gaps = normalizeGroupGaps(g)
      gaps[gapIndex] = { ...gaps[gapIndex], [key]: typeof value === 'number' ? value : 0 }
      const updated = { ...g, gaps }
      return {
        ...c,
        groups: (c.groups || []).map((gr) => (gr.id === groupId ? updated : gr)),
        nodes: applyGroupLayoutToNodes(c.nodes, updated),
      }
    }, false, `gap:${groupId}:${gapIndex}:${key}`)
  }

  const updateNode = (nodeId, patch, skipHistory = false) => {
    setCanvas((c) => ({ ...c, nodes: applyPatchWithReflow(c.nodes, nodeId, patch, c.groups || []) }), skipHistory, `${nodeId}:${Object.keys(patch).sort().join()}`)
  }
  /** Applies several position or property patches ([{ id, ...patch }]) as one change. */
  const patchNodes = (patches, skipHistory = false, historyKey = null) => {
    const byId = new Map(patches.map(({ id: nodeId, ...patch }) => [nodeId, patch]))
    if (!byId.size) return
    setCanvas((c) => ({ ...c, nodes: c.nodes.map((n) => (byId.has(n.id) ? { ...n, ...byId.get(n.id) } : n)) }), skipHistory, historyKey)
  }
  // A key names one layer, so it must be unique on the slide.
  const setDynamicKey = (nodeId, rawKey) => {
    const key = (rawKey || '').trim()
    if (key && (canvas?.nodes || []).some((n) => n.id !== nodeId && (n.dynamic_key || '').trim() === key)) {
      toast.error(`The key "${key}" is already used on this ${carousel ? 'slide' : 'post'}`)
      return
    }
    updateNode(nodeId, { dynamic_key: key })
  }
  const renameNode = (nodeId, name) => updateNode(nodeId, { name: name || undefined })
  const toggleFlag = (flag) => (ids = selectedIdsRef.current) => {
    const targets = (canvasRefObj.current?.nodes || []).filter(n => ids.includes(n.id))
    if (!targets.length) return
    const on = !targets.every(n => n[flag])
    patchNodes(targets.map(n => ({ id: n.id, [flag]: on || undefined })))
    if (on && flag === 'locked' && targets.some(n => n.id === cropModeNodeId)) setCropModeNodeId(null)
    if (targets.length > 1 || ids !== selectedIdsRef.current) return
    toast(`${on ? (flag === 'hidden' ? 'Hidden' : 'Locked') : (flag === 'hidden' ? 'Shown' : 'Unlocked')}`, { duration: 1500 })
  }
  const toggleHidden = toggleFlag('hidden')
  const toggleLocked = toggleFlag('locked')

  const deleteNode = (nodeId, skipClear = false) => {
    setCanvas((c) => ({ ...c, nodes: c.nodes.filter((n) => n.id !== nodeId), groups: removeNodeFromAllGroups(c.groups, nodeId) }))
    if (!skipClear) setSelectedIds((prev) => prev.filter((id) => id !== nodeId))
    if (nodeId === cropModeNodeId) setCropModeNodeId(null)
  }
  const deleteSelection = () => {
    const ids = new Set(selectedIds)
    if (!ids.size) return
    setCanvas((c) => ({ ...c, nodes: c.nodes.filter(n => !ids.has(n.id)), groups: [...ids].reduce((g, nid) => removeNodeFromAllGroups(g, nid), c.groups) }))
    clearSelection()
  }
  const duplicateNodes = (ids) => {
    const copies = (canvasRefObj.current?.nodes || []).filter(n => ids.includes(n.id)).map(n => ({ ...n, id: uuidv4(), groupId: undefined, x: n.x + 20, y: n.y + 20 }))
    if (!copies.length) return
    setCanvas(c => ({ ...c, nodes: [...(c.nodes || []), ...copies] }))
    setSelectedIds(copies.map(n => n.id))
    setSelectedGroupId(null)
  }

  /** Moves layers in the stacking order, keeping the order among them. */
  const arrange = (dir, ids = selectedIds) => {
    const set = new Set(ids)
    if (!set.size) return
    setCanvas((c) => {
      let list = [...c.nodes]
      if (dir === 'front') list = [...list.filter(n => !set.has(n.id)), ...list.filter(n => set.has(n.id))]
      else if (dir === 'back') list = [...list.filter(n => set.has(n.id)), ...list.filter(n => !set.has(n.id))]
      else if (dir === 'forward') {
        for (let i = list.length - 2; i >= 0; i--) if (set.has(list[i].id) && !set.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]]
      } else {
        for (let i = 1; i < list.length; i++) if (set.has(list[i].id) && !set.has(list[i - 1].id)) [list[i - 1], list[i]] = [list[i], list[i - 1]]
      }
      return list.every((n, i) => n === c.nodes[i]) ? c : { ...c, nodes: list }
    })
  }

  /** Lines layers up with each other, or a single layer on the slide. Locked layers stay put. */
  const alignSelection = (edge) => {
    const movable = selectedNodes.filter(n => !n.locked)
    if (!movable.length) return
    const frame = selectedNodes.length > 1 ? selectionBounds(selectedNodes) : { x: 0, y: 0, width: canvas.width, height: canvas.height }
    patchNodes(alignNodes(movable, edge, frame))
  }
  const distributeSelection = (axis) => patchNodes(distributeNodes(selectedNodes.filter(n => !n.locked), axis))

  // Drag-reorder a layer: place draggedId in the visual (front-first) list just before targetId
  const reorderByDrag = (draggedId, targetId) => {
    if (!draggedId || !targetId || draggedId === targetId) return
    setCanvas((c) => {
      // The layer panel lists the front layer first, so work in that reversed order.
      const visual = c.nodes.slice().reverse()
      const dragIdx = visual.findIndex((n) => n.id === draggedId)
      if (dragIdx === -1) return c
      const [item] = visual.splice(dragIdx, 1)
      const newTgt = visual.findIndex((n) => n.id === targetId)
      if (newTgt === -1) visual.push(item)
      else visual.splice(newTgt, 0, item)
      return { ...c, nodes: visual.reverse() }
    })
  }

  // Adaptive text height: measure all text nodes via a hidden mirror div, update height
  const pushedRef = useRef(new Map())
  useLayoutEffect(() => {
    if (!canvas || !measureRef.current || !fontsReady) return
    const el = measureRef.current
    const updates = []
    for (const n of canvas.nodes || []) {
      if (n.type !== 'text') continue
      if (n.autoSize === false) continue
      el.className = classAttr(n.className)
      el.style.width = `${n.width}px`
      el.style.fontSize = `${n.fontSize || 48}px`
      el.style.fontFamily = `'${n.fontFamily || 'Inter'}', sans-serif`
      el.style.fontWeight = String(n.fontWeight || 400)
      el.style.fontStyle = n.fontStyle === 'italic' ? 'italic' : 'normal'
      el.style.lineHeight = String(n.lineHeight ?? 1.2)
      el.style.textAlign = n.textAlign || 'left'
      el.style.letterSpacing = `${n.letterSpacing || 0}px`
      el.style.whiteSpace = 'pre-wrap'
      el.style.wordBreak = 'break-word'
      el.innerHTML = (n.text && n.text.length > 0) ? tagsToHtml(n.text) : 'M'
      const h = Math.max(40, Math.ceil(el.getBoundingClientRect().height))
      if (h !== n.height) updates.push({ id: n.id, height: h })
    }
    if (updates.length) {
      // A measured height corrects the layout; it is not an edit of its own to undo.
      setCanvas((c) => {
        let nodes = c.nodes
        for (const u of updates) {
          const prev = nodes.find((n) => n.id === u.id)
          if (!prev) continue
          nodes = applyPatchWithReflow(nodes, u.id, { height: u.height }, c.groups || [])
          // Composed designs (nodes carry a designRole): a copy block that measures taller in the real font pushes
          // the copy below it down instead of overlapping it. Measured shorter again (it was first measured in a
          // fallback font), it takes back the space it pushed, and no more, so the design's own spacing stays.
          const grow = u.height - prev.height
          const pushed = pushedRef.current.get(u.id) || 0
          const shift = grow > 0 ? grow : -Math.min(-grow, pushed)
          if (shift && prev.designRole && !(c.groups || []).some((g) => g.nodeIds.includes(u.id))) {
            const bottom = prev.y + prev.height
            nodes = nodes.map((n) => n.id !== u.id && STACKED_COPY.test(n.designRole || '') && n.y >= bottom - 2
              && n.x < prev.x + prev.width && n.x + n.width > prev.x ? { ...n, y: n.y + shift } : n)
            pushedRef.current.set(u.id, pushed + shift)
          }
        }
        return { ...c, nodes }
      }, true)
    }
  }, [canvas?.nodes, tagsToHtml, fontsReady]) // eslint-disable-line react-hooks/exhaustive-deps

  const addNode = node => {
    setCanvas((c) => ({ ...c, nodes: [...(c.nodes || []), node] }))
    setSelectedIds([node.id])
    setSelectedGroupId(null)
    setTab('edit')
  }
  const centred = (width, height) => freeSpot(canvasRefObj.current?.nodes, Math.round((canvas.width - width) / 2), Math.round((canvas.height - height) / 2))
  const accent = () => brandColors(canvas)[0] || '#6366f1'

  /** Adds a heading, subheading or body text in the post's own fonts, ready to type over. Pasted text is added as is. */
  const addText = (kind = 'body', text) => {
    const look = textPreset(canvas, kind)
    const node = { id: uuidv4(), ...look, ...(text ? { text, textAlign: 'left' } : {}), ...centred(look.width, look.height) }
    addNode(node)
    if (!text) setEditingId(node.id)
  }

  const addShape = (shape) => addNode({
    id: uuidv4(), type: 'shape', shape, ...centred(300, 300),
    width: 300, height: 300, fill: accent(), stroke: '#000000', strokeWidth: 0,
    borderRadius: shape === 'rect' ? 0 : 9999,
  })

  const addLine = () => {
    const width = Math.round(canvas.width * 0.5)
    const height = Math.max(4, Math.round(canvas.width / 180))
    addNode({ id: uuidv4(), type: 'shape', shape: 'rect', ...centred(width, height), width, height, fill: '#111111', stroke: '#000000', strokeWidth: 0, borderRadius: Math.round(height / 2), name: 'Line' })
  }

  const addGradient = () => addNode({
    id: uuidv4(), type: 'gradient',
    gradientType: 'linear', angle: 135, shape: 'rect',
    radialShape: 'circle', focalX: 50, focalY: 50,
    stops: [{ color: '#667eea', position: 0, alpha: 100 }, { color: '#764ba2', position: 100, alpha: 100 }],
    ...centred(600, 400), width: 600, height: 400, borderRadius: 24,
  })

  const openImageDialog = () => { setImageUrl(''); setImageSource(canvas?.flowId ? 'gallery' : 'upload'); setImageDialog(true) }
  const insertImageNode = (src) => {
    const placeNode = (width, height, aspectRatio) => {
      const c = canvasRefObj.current
      addNode({
        id: uuidv4(), type: 'image',
        ...freeSpot(c.nodes, Math.round((c.width - width) / 2), Math.round((c.height - height) / 2)),
        width, height, aspectRatio, src, borderRadius: 0, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
        filters: { ...DEFAULT_FILTERS },
      })
      setImageDialog(false)
    }
    const img = new Image()
    img.onload = () => {
      const aspect = (img.naturalWidth || 1) / (img.naturalHeight || 1)
      const maxDim = 500
      if (aspect >= 1) placeNode(maxDim, Math.round(maxDim / aspect), aspect)
      else placeNode(Math.round(maxDim * aspect), maxDim, aspect)
    }
    img.onerror = () => placeNode(500, 500, 1)
    img.src = src
  }
  const addImageByUrl = () => {
    if (!imageUrl.trim()) return toast.error('Paste an image link first')
    insertImageNode(imageUrl.trim())
  }
  const uploadFiles = async (files, { place = true } = {}) => {
    const images = [...files].filter(f => f.type.startsWith('image/'))
    if (!images.length) return
    setUploading(true)
    try {
      for (const file of images) {
        try {
          const url = await uploadImage(file)
          setSessionImages(prev => [url, ...prev.filter(v => v !== url)])
          if (place) insertImageNode(url)
        } catch (e) {
          toast.error(e.message)
        }
      }
    } finally {
      setUploading(false)
    }
  }

  // Images dropped anywhere on the editor go onto the open slide.
  const handleRootDrop = (e) => {
    e.preventDefault()
    setIsDraggingOverBase(false)
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files)
  }

  // Clipboard. Copied layers go to the system clipboard too, so the newest copy wins: layers, a screenshot or text.
  const rememberCopy = (items) => {
    clipboardRef.current = items
    try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify({ nodes: items, text: clipText(items) })) } catch {}
    setHasClipboard(true)
  }
  const copyLayers = (items, { cut = false } = {}) => {
    if (!items.length) return
    rememberCopy(items)
    copiedPayloadRef.current = null
    navigator.clipboard?.writeText(clipText(items)).catch(() => {})
    if (cut) deleteSelection()
    toast.success(`${items.length === 1 ? 'Layer' : `${items.length} layers`} ${cut ? 'cut' : 'copied'}`, { duration: 1500 })
  }
  const pasteLayers = (items) => {
    if (!items?.length) return
    const here = new Set((canvasRefObj.current?.nodes || []).map(n => n.id))
    // Pasting where the originals are puts the copy a step down and right; on another slide it keeps its place.
    const step = items.some(n => here.has(n.id)) ? 20 : 0
    const fresh = items.map(n => ({ ...n, id: uuidv4(), groupId: undefined, x: n.x + step, y: n.y + step }))
    setCanvas(c => ({ ...c, nodes: [...(c.nodes || []), ...fresh] }))
    setSelectedIds(fresh.map(n => n.id))
    setSelectedGroupId(null)
    // The next paste lands a further step along.
    clipboardRef.current = fresh
  }
  const pasteStored = () => pasteLayers(clipboardRef.current?.length ? clipboardRef.current : readStoredClipboard()?.nodes)

  useEffect(() => {
    const ours = (e) => !(isTyping(e.target) || editingIdRef.current || e.target.closest?.('[role="dialog"]'))
    const onCopy = (e, cut = false) => {
      if (!ours(e) || window.getSelection()?.toString()) return
      const items = (canvasRefObj.current?.nodes || []).filter(n => selectedIdsRef.current.includes(n.id))
      if (!items.length || !e.clipboardData) return
      e.preventDefault()
      const payload = JSON.stringify(items)
      e.clipboardData.setData(LAYERS_MIME, payload)
      e.clipboardData.setData('text/plain', clipText(items))
      rememberCopy(items)
      copiedPayloadRef.current = payload
      if (cut) deleteSelection()
      toast.success(`${items.length === 1 ? 'Layer' : `${items.length} layers`} ${cut ? 'cut' : 'copied'}`, { duration: 1500 })
    }
    const onCut = (e) => onCopy(e, true)
    const onPaste = (e) => {
      if (!ours(e) || !e.clipboardData) return
      const data = e.clipboardData
      const images = [...(data.files || [])].filter(f => f.type.startsWith('image/'))
      if (images.length) { e.preventDefault(); uploadFiles(images); return }
      const payload = data.getData(LAYERS_MIME)
      if (payload) {
        e.preventDefault()
        if (payload === copiedPayloadRef.current && clipboardRef.current?.length) pasteStored()
        else { try { pasteLayers(JSON.parse(payload)) } catch {} }
        return
      }
      const text = data.getData('text/plain')
      const stored = readStoredClipboard()
      if (stored?.nodes?.length && (!text || text === stored.text)) { e.preventDefault(); pasteStored(); return }
      if (text?.trim() && canvasRefObj.current) { e.preventDefault(); addText('body', text.trim()) }
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }) // re-bound every render so the handlers always see the current slide

  const switchDesign = async (designId, preview, paletteId) => {
    try {
      const response = preview ? null : await fetch(`/api/canvases/${id}/design`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ designId, paletteId }) })
      const data = preview ?? await response.json()
      if (response && !response.ok) throw new Error(data.error || 'Could not apply the design')
      setCanvas(c => applyDesign(c, data))
      toast.success(carousel ? 'Design applied to every slide' : 'Design applied', { action: { label: 'Undo', onClick: () => undo() } })
    } catch (error) {
      toast.error(error.message)
      throw error
    }
  }

  // One save at a time; edits made while saving are saved right after.
  const save = useCallback(() => {
    if (savingRef.current) { saveAgainRef.current = true; return savingRef.current }
    const run = (async () => {
      try {
        do {
          saveAgainRef.current = false
          const snapshot = canvasRefObj.current
          if (!snapshot) return true
          const body = JSON.stringify(toDocument(snapshot))
          if (body === savedRef.current) continue
          setSaving(true)
          const res = await fetch(`/api/canvases/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
          if (!res.ok) throw new Error('Your changes could not be saved')
          savedRef.current = body
          setSavedString(body)
        } while (saveAgainRef.current)
        setSaveError(null)
        return true
      } catch (error) {
        setSaveError(previous => {
          if (!previous) toast.error(error.message)
          return error.message
        })
        return false
      } finally {
        setSaving(false)
        savingRef.current = null
      }
    })()
    savingRef.current = run
    return run
  }, [id])

  // Autosave shortly after the last change.
  useEffect(() => {
    if (!hasChanges) return
    const t = setTimeout(() => { save() }, 1200)
    return () => clearTimeout(t)
  }, [docString, hasChanges, save])

  // Warn before leaving with changes that have not reached the server.
  useEffect(() => {
    const warn = e => {
      const state = canvasRefObj.current
      if (state && JSON.stringify(toDocument(state)) !== savedRef.current) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  const download = async () => {
    setDownloading(true)
    try {
      if (!(await save())) throw new Error('Your changes could not be saved, so nothing was downloaded')
      const res = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canva_id: id, data: {} }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || 'The download could not be prepared')
      const file = await fetch(new URL(data.url, window.location.origin).pathname)
      if (!file.ok) throw new Error('The download could not be prepared')
      const url = URL.createObjectURL(await file.blob())
      // "Missão & valores" → "missao-valores": accents dropped, kept short enough for any file system.
      const name = (canvas.name || 'post').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/gi, '-').slice(0, 60).replace(/^-+|-+$/g, '').toLowerCase() || 'post'
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.${carousel ? 'zip' : 'png'}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setDownloading(false)
    }
  }

  const exportJson = () => {
    const { _id, createdAt, updatedAt, ...exportData } = toDocument(canvas)
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${(canvas.name || 'canvas').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.kand.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Slides. Each change is undoable, so deleting needs no confirmation.
  const openSlide = useCallback(pageId => setCanvas(c => openPage(c, pageId), true), [setCanvas])
  const openSlideAt = useCallback(index => {
    const page = canvasRefObj.current?.pages?.[index]
    if (page) openSlide(page.id)
  }, [openSlide])
  const addSlide = useCallback(() => setCanvas(c => addPage(c, uuidv4)), [setCanvas])
  const duplicateSlide = useCallback(pageId => setCanvas(c => duplicatePage(c, pageId, uuidv4)), [setCanvas])
  const moveSlide = useCallback((pageId, to) => setCanvas(c => movePage(c, pageId, to)), [setCanvas])
  const deleteSlide = useCallback(pageId => {
    setCanvas(c => deletePage(c, pageId))
    toast('Slide deleted', { action: { label: 'Undo', onClick: () => undo() } })
  }, [setCanvas, undo])

  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    const handler = (e) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 's') { e.preventDefault(); saveRef.current(); return }
      // Skip every other shortcut while typing.
      if (editingId) return
      const t = e.target
      if (isTyping(t)) return
      if (t.closest?.('[role="dialog"], [role="menu"]')) return

      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.25); return }
      if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomBy(0.8); return }
      if (mod && e.key === '0') { e.preventDefault(); fitCanvasToView(); return }
      if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit1') { e.preventDefault(); fitCanvasToView(); return }
      if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit0') { e.preventDefault(); zoomTo(1); return }
      if (mod && key === 'd') { e.preventDefault(); duplicateNodes(selectedIds); return }
      if (mod && key === 'a') { e.preventDefault(); selectAll(); return }
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && key === 'y') { e.preventDefault(); redo(); return }
      if (mod && key === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else createGroupFromSelection(); return }
      if (mod && e.shiftKey && key === 'h') { e.preventDefault(); toggleHidden(); return }
      if (mod && e.shiftKey && key === 'l') { e.preventDefault(); toggleLocked(); return }
      if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        e.preventDefault()
        arrange(e.code === 'BracketRight' ? (e.shiftKey ? 'front' : 'forward') : (e.shiftKey ? 'back' : 'backward'))
        return
      }
      if (e.key === 'Escape') { if (cropModeNodeId) setCropModeNodeId(null); else clearSelection(); return }
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(true); return }
      if (carousel && (e.key === 'PageDown' || e.key === 'PageUp')) {
        e.preventDefault()
        openSlideAt(openIndex + (e.key === 'PageDown' ? 1 : -1))
        return
      }
      if (!mod && !e.altKey && !e.shiftKey) {
        const add = { t: () => addText('body'), i: openImageDialog, r: () => addShape('rect'), o: () => addShape('ellipse'), l: addLine }[key]
        if (add) { e.preventDefault(); add(); return }
      }
      if (e.key === 'Tab' && !mod && (t === document.body || t.closest?.('[data-editor-canvas]'))) { e.preventDefault(); cycleSelection(e.shiftKey ? -1 : 1); return }

      if (selectedIds.length === 0) return
      if (e.key === 'Enter' && selected && !selected.locked) {
        if (selected.type === 'text') { e.preventDefault(); setEditingId(selected.id) }
        else if (selected.type === 'image') { e.preventDefault(); setCropModeNodeId(selected.id) }
        return
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        patchNodes(selectedNodes.filter(n => !n.locked).map(n => ({ id: n.id, x: n.x + dx, y: n.y + dy })), false, `nudge:${selectedIds.join()}`)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelection()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }) // re-bound every render so the shortcuts always see the current selection and slide

  const dragState = useRef(null)
  /**
   * Starts dragging on the canvas. `mode` is move, resize (from `handle`, [hx, hy]), resize-max, rotate or crop-<side>.
   * Moving drags every selected layer (and whole groups); a plain click on one of several selected layers selects it alone.
   */
  const handleMouseDown = (e, node, mode = 'move', handle = null) => {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    const c = canvasRefObj.current
    let ids = selectedIdsRef.current
    let collapseTo = null
    if (mode === 'move') {
      if (e.altKey) { altSelect(e, node.id); return }
      const additive = e.shiftKey || e.ctrlKey || e.metaKey
      if (additive && ids.includes(node.id)) {
        setSelectedIds(ids.filter(i => i !== node.id))
        setSelectedGroupId(null)
        return
      }
      if (additive) ids = [...ids, node.id]
      else if (!ids.includes(node.id)) ids = [node.id]
      else if (ids.length > 1) collapseTo = node.id
      if (ids !== selectedIdsRef.current) {
        setSelectedIds(ids)
        setSelectedGroupId(null)
        if (cropModeNodeId && cropModeNodeId !== node.id) setCropModeNodeId(null)
      }
    }
    if (node.locked) return
    const expanded = new Set()
    for (const sid of mode === 'move' ? ids : [node.id]) {
      const n = c.nodes.find(nd => nd.id === sid)
      const group = n?.groupId && mode === 'move' ? (c.groups || []).find(g => g.id === n.groupId) : null
      for (const gid of group ? group.nodeIds : [sid]) expanded.add(gid)
    }
    const moving = c.nodes.filter(n => expanded.has(n.id) && !n.locked)
    dragState.current = {
      nodeId: node.id,
      mode,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      orig: node,
      origNodes: new Map(moving.map(n => [n.id, n])),
      bounds: selectionBounds(moving),
      initialCanvas: c,
      hasMoved: false,
      collapseTo,
    }
    const onMove = (ev) => {
      const ds = dragState.current; if (!ds) return
      const s = scaleRef.current
      if (!ds.hasMoved && Math.hypot(ev.clientX - ds.startX, ev.clientY - ds.startY) < 3) return
      let dx = (ev.clientX - ds.startX) / s, dy = (ev.clientY - ds.startY) / s
      const cs = canvasRefObj.current
      const snap = snappingRef.current && !(ev.ctrlKey || ev.metaKey)
      const threshold = SNAP_THRESHOLD / s
      const targets = () => collectSnapTargets((cs?.nodes || []).filter(n => !n.hidden), [...ds.origNodes.keys(), ds.nodeId], cs.width, cs.height)
      const n0 = ds.orig
      if (ds.mode === 'move') {
        if (!ds.bounds) return
        const b = ds.bounds
        // Shift keeps the move straight across or straight down.
        const still = ev.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? 'y' : 'x') : null
        let lines = []
        if (snap) {
          const { v, h } = targets()
          const snapped = snapMovePosition(b.x + dx, b.y + dy, b.width, b.height, v, h, threshold)
          dx = snapped.x - b.x
          dy = snapped.y - b.y
          lines = snapped.lines
        }
        if (still === 'y') { dy = 0; lines = lines.filter(l => l.type === 'v') }
        if (still === 'x') { dx = 0; lines = lines.filter(l => l.type === 'h') }
        const mx = Math.round(dx), my = Math.round(dy)
        setSnapLines(lines)
        setCanvas(cv => ({ ...cv, nodes: cv.nodes.map(n => { const o = ds.origNodes.get(n.id); return o ? { ...n, x: o.x + mx, y: o.y + my } : n }) }), true)
        setReadout({ text: `X ${Math.round(b.x + mx)}   Y ${Math.round(b.y + my)}`, x: ev.clientX, y: ev.clientY })
        ds.hasMoved = true
      } else if (ds.mode === 'resize') {
        const [hx, hy] = ds.handle
        const corner = !!(hx && hy)
        const keepRatio = n0.type === 'image' || (n0.type === 'text' && corner) || ev.shiftKey
        let lines = []
        if (snap && !((n0.rotation || 0) % 360)) {
          const { v, h } = targets()
          ;({ dx, dy, lines } = snapResizeDrag(n0, ds.handle, dx, dy, v, h, threshold))
        }
        const r = resizeFromHandle(n0, ds.handle, dx, dy, { keepRatio, maxWidth: n0.maxWidth, maxHeight: n0.maxHeight })
        let patch = { x: r.x, y: r.y, width: r.width, height: r.height }
        if (n0.type === 'text') {
          // A text corner scales the text; a side only rewraps it.
          if (corner) {
            patch.fontSize = Math.max(4, Math.round((n0.fontSize || 48) * r.scale))
            if (n0.letterSpacing) patch.letterSpacing = Math.round(n0.letterSpacing * r.scale)
          } else if (!hy) delete patch.height
        }
        updateNode(ds.nodeId, patch, true)
        setSnapLines(touchingLines(lines, visibleBox({ ...n0, ...patch })))
        const size = `${patch.width} × ${patch.height ?? n0.height}`
        setReadout({ text: patch.fontSize ? `${size}   ${patch.fontSize} px text` : size, x: ev.clientX, y: ev.clientY })
        ds.hasMoved = true
      } else if (ds.mode === 'resize-max') {
        const angle = (n0.rotation || 0) * (Math.PI / 180)
        const u = { x: Math.cos(angle), y: Math.sin(angle) }
        const v = { x: -Math.sin(angle), y: Math.cos(angle) }
        const maxW0 = n0.maxWidth || n0.width
        const maxH0 = n0.maxHeight || n0.height
        const cx = n0.x + n0.width / 2
        const cy = n0.y + n0.height / 2
        const TL = { x: cx - (n0.width / 2) * u.x - (n0.height / 2) * v.x, y: cy - (n0.width / 2) * u.y - (n0.height / 2) * v.y }
        const BRMax = { x: TL.x + maxW0 * u.x + maxH0 * v.x, y: TL.y + maxW0 * u.y + maxH0 * v.y }
        const diag = { x: BRMax.x + dx - TL.x, y: BRMax.y + dy - TL.y }
        const newMaxW = Math.max(n0.width, Math.round(diag.x * u.x + diag.y * u.y))
        const newMaxH = Math.max(n0.height, Math.round(diag.x * v.x + diag.y * v.y))
        updateNode(ds.nodeId, { maxWidth: newMaxW, maxHeight: newMaxH }, true)
        setReadout({ text: `Flow box ${newMaxW} × ${newMaxH}`, x: ev.clientX, y: ev.clientY })
        ds.hasMoved = true
      } else if (ds.mode.startsWith('crop-')) {
        const angle = (n0.rotation || 0) * (Math.PI / 180)
        const cosA = Math.cos(angle), sinA = Math.sin(angle)
        // Project screen-space delta into local node axes
        const localDx = dx * cosA + dy * sinA
        const localDy = -dx * sinA + dy * cosA
        let cropLeft = n0.cropLeft || 0, cropRight = n0.cropRight || 0, cropTop = n0.cropTop || 0, cropBottom = n0.cropBottom || 0
        const pctX = (localDx / n0.width) * 100
        const pctY = (localDy / n0.height) * 100
        if (ds.mode === 'crop-left') cropLeft = Math.max(0, Math.min(100 - cropRight - 5, cropLeft + pctX))
        else if (ds.mode === 'crop-right') cropRight = Math.max(0, Math.min(100 - cropLeft - 5, cropRight - pctX))
        else if (ds.mode === 'crop-top') cropTop = Math.max(0, Math.min(100 - cropBottom - 5, cropTop + pctY))
        else if (ds.mode === 'crop-bottom') cropBottom = Math.max(0, Math.min(100 - cropTop - 5, cropBottom - pctY))
        const round = v => Math.round(v * 10) / 10
        updateNode(ds.nodeId, { cropLeft: round(cropLeft), cropRight: round(cropRight), cropTop: round(cropTop), cropBottom: round(cropBottom) }, true)
        ds.hasMoved = true
      } else if (ds.mode === 'rotate') {
        const canvasRect = canvasRef.current?.getBoundingClientRect()
        if (canvasRect) {
          const cx = canvasRect.left + (n0.x + n0.width / 2) * s
          const cy = canvasRect.top + (n0.y + n0.height / 2) * s
          let rotation = Math.round(Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI) + 90)
          if (rotation < 0) rotation += 360
          if (ev.shiftKey || Math.abs(rotation % 45) < 5 || Math.abs(rotation % 45) > 40) rotation = Math.round(rotation / 45) * 45
          if (rotation === 360) rotation = 0
          updateNode(ds.nodeId, { rotation }, true)
          setReadout({ text: `${rotation}°`, x: ev.clientX, y: ev.clientY })
          ds.hasMoved = true
        }
      }
    }
    const onUp = () => {
      const ds = dragState.current
      if (ds?.hasMoved) pushHistory(ds.initialCanvas)
      else if (ds?.collapseTo) { setSelectedIds([ds.collapseTo]); setSelectedGroupId(null) }
      dragState.current = null
      setSnapLines([])
      setReadout(null)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  /** Drag on empty canvas to select every layer the box touches (Shift adds to the selection). */
  const startMarquee = (e) => {
    if (!canvasRef.current) return
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (!additive) clearSelection()
    const toCanvas = (ev) => {
      const r = canvasRef.current.getBoundingClientRect()
      return { x: (ev.clientX - r.left) / scaleRef.current, y: (ev.clientY - r.top) / scaleRef.current }
    }
    const start = toCanvas(e)
    const base = additive ? selectedIdsRef.current : []
    let active = false
    const move = (ev) => {
      if (!active && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return
      active = true
      const p = toCanvas(ev)
      const box = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) }
      setMarquee(box)
      const inside = (canvasRefObj.current?.nodes || []).filter(n => !n.locked && !n.hidden && overlaps(visibleBox(n), box)).map(n => n.id)
      setSelectedIds([...new Set([...base, ...inside])])
      setSelectedGroupId(null)
    }
    const up = () => {
      setMarquee(null)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const slides = useMemo(() => (canvasState?._pageId
    ? canvasState.pages.map(p => (p.id === canvasState._pageId ? { ...p, nodes: canvasState.nodes, classes: canvasState.classes, background: canvasState.background } : p))
    : []), [canvasState])
  const slideSize = useMemo(() => ({ width: canvasState?.width || 1080, height: canvasState?.height || 1350, colorMode: canvasState?.colorMode }), [canvasState?.width, canvasState?.height, canvasState?.colorMode])
  const swatches = useMemo(() => ({ brand: brandColors(canvasState), used: documentColors(doc) }), [canvasState, doc])

  if (loadError) {
    return (
      <CenteredState>
        <img src="/logo/batkle-icon-color.png" alt="" className="size-12" />
        <h1 className="font-bk-display text-[24px] font-bold tracking-[-0.03em]">We couldn’t open this post</h1>
        <p className="max-w-[380px] text-[14px] text-bk-muted">{loadError}</p>
        <Link href="/app" className={appButton('primary', 'md')}>Back to Batkle</Link>
      </CenteredState>
    )
  }
  if (!canvas) {
    return (
      <CenteredState>
        <Loader2 className="size-6 animate-spin text-bk-muted" />
        <p className="text-[14px] text-bk-muted">Opening your post…</p>
      </CenteredState>
    )
  }

  const backHref = canvas.flowId ? `/app/${canvas.flowId}/creation` : '/studio'
  const backLabel = canvas.flowId ? 'Back to content ideas' : 'Back to studio'
  const mod = modKey()

  const canvasColorFilter =
    canvas.colorMode === 'grayscale' ? 'grayscale(100%)' :
      canvas.colorMode === 'sepia' ? 'sepia(80%) saturate(120%)' :
        canvas.colorMode === 'invert' ? 'invert(100%)' :
          canvas.colorMode === 'high-contrast' ? 'contrast(160%)' : 'none'

  const nodeBoxStyle = (node) => {
    const clsStyle = getCanvasClassStyle(canvas.classes || {}, node.className)
    const base = {
      position: 'absolute', left: node.x, top: node.y, width: node.width, height: node.height,
      cursor: 'move', pointerEvents: node.locked ? 'none' : 'auto',
      outline: 'none',
      display: node.type === 'text' ? 'block' : 'flex', alignItems: node.type === 'text' ? 'normal' : 'center',
      justifyContent: node.textAlign === 'center' ? 'center' : node.textAlign === 'right' ? 'flex-end' : 'flex-start',
      overflow: node.type === 'text' ? 'visible' : 'hidden', userSelect: 'none', whiteSpace: 'pre-wrap',
      transform: `rotate(${node.rotation || 0}deg)`, transformOrigin: 'center center',
    }
    if (node.type === 'text') {
      const ts = clsStyle.textShadow && clsStyle.textShadow.enabled ? clsStyle.textShadow : (node.textShadow && node.textShadow.enabled ? node.textShadow : null)
      return {
        ...base,
        color: clsStyle.color || node.color || '#000', ...textGradientStyle(node),
        backgroundColor: clsStyle.background || clsStyle.backgroundColor || 'transparent',
        fontSize: node.fontSize || 48,
        fontWeight: clsStyle.fontWeight || node.fontWeight || 400,
        fontStyle: clsStyle.fontStyle || (node.fontStyle === 'italic' ? 'italic' : 'normal'),
        fontFamily: `'${node.fontFamily || 'Inter'}', sans-serif`,
        lineHeight: node.lineHeight || 1.2,
        letterSpacing: `${clsStyle.letterSpacing || node.letterSpacing || 0}px`,
        textTransform: clsStyle.textTransform || node.textTransform || 'none',
        textDecoration: clsStyle.textDecoration || node.textDecoration || 'none',
        textAlign: node.textAlign || 'left',
        textShadow: ts ? `${ts.offsetX || 0}px ${ts.offsetY || 0}px ${ts.blur || 0}px ${ts.color || '#000'}` : 'none',
      }
    }
    if (node.type === 'shape') {
      return {
        ...base,
        backgroundColor: clsStyle.fill || node.fill || '#6366f1',
        border: `${clsStyle.strokeWidth ?? node.strokeWidth ?? 0}px solid ${clsStyle.stroke || node.stroke || '#000000'}`,
        borderRadius: (clsStyle.shape || node.shape) === 'ellipse' ? '50%' : (clsStyle.borderRadius ?? node.borderRadius ?? 0),
      }
    }
    if (node.type === 'gradient') {
      const stops = clsStyle.stops || node.stops || [{ color: '#6366f1', position: 0, alpha: 100 }, { color: '#ec4899', position: 100, alpha: 100 }]
      const angle = clsStyle.angle ?? node.angle ?? 90
      const gType = clsStyle.gradientType || node.gradientType || 'linear'
      const shape = clsStyle.shape || node.shape || 'rect'
      const stopsStr = stops.map(s => `${s.color}${Math.round((typeof s.alpha === 'number' ? s.alpha : 100) * 2.55).toString(16).padStart(2, '0')} ${s.position}%`).join(', ')
      const fx = typeof (clsStyle.focalX ?? node.focalX) === 'number' ? (clsStyle.focalX ?? node.focalX) : 50
      const fy = typeof (clsStyle.focalY ?? node.focalY) === 'number' ? (clsStyle.focalY ?? node.focalY) : 50
      return {
        ...base,
        background: gType === 'radial' ? `radial-gradient(circle at ${fx}% ${fy}%, ${stopsStr})` : `linear-gradient(${angle}deg, ${stopsStr})`,
        borderRadius: shape === 'ellipse' ? '50%' : (clsStyle.borderRadius ?? node.borderRadius ?? 0),
      }
    }
    if (node.type === 'image') {
      const mask = node.mask || 'none'
      const cL = node.cropLeft || 0
      const cR = node.cropRight || 0
      const cT = node.cropTop || 0
      const cB = node.cropBottom || 0
      const hasClip = cL > 0 || cR > 0 || cT > 0 || cB > 0
      const min = Math.min(node.width, node.height)
      const maskRadius = mask === 'circle' ? '50%' : mask === 'rounded' ? Math.round(min * 0.15) : mask === 'pill' ? Math.round(min * 0.5) : node.borderRadius || 0
      const polygonClip = POLYGON_MASKS[mask]
      // A polygon mask clips the outer box (crop then uses an inner box); otherwise crop clips with rounded corners.
      const clipPath = polygonClip || (hasClip ? `inset(${cT}% ${cR}% ${cB}% ${cL}% round ${typeof maskRadius === 'string' ? maskRadius : maskRadius + 'px'})` : undefined)
      return { ...base, borderRadius: polygonClip ? 0 : maskRadius, overflow: 'hidden', ...(clipPath ? { clipPath } : {}) }
    }
    return base
  }

  const generateCssFromClasses = () => {
    if (!canvas?.classes) return ''
    let css = ''
    for (const [name, cls] of Object.entries(canvas.classes)) {
      if (cls.type && cls.type !== 'text') continue
      const selector = name.startsWith('.') ? name : `.${name}`
      css += `${selector} { `
      if (cls.color) css += `color: ${cls.color} !important; `
      const bg = cls.background || cls.backgroundColor
      const py = typeof cls.paddingY === 'number' ? cls.paddingY : 0
      const px = typeof cls.paddingX === 'number' ? cls.paddingX : 0
      if (cls.fontWeight) css += `font-weight: ${cls.fontWeight} !important; `
      if (cls.fontStyle) css += `font-style: ${cls.fontStyle} !important; `
      if (cls.letterSpacing) css += `letter-spacing: ${cls.letterSpacing}px !important; `
      if (cls.textTransform) css += `text-transform: ${cls.textTransform} !important; `
      if (cls.textDecoration) css += `text-decoration: ${cls.textDecoration} !important; `
      if (cls.textShadow?.enabled) css += `text-shadow: ${cls.textShadow.offsetX || 0}px ${cls.textShadow.offsetY || 0}px ${cls.textShadow.blur || 0}px ${cls.textShadow.color || '#000'} !important; `
      // Show the highlight box whenever a visible background is set; padding is optional.
      if (isVisibleBackground(bg)) {
        css += `background-color: ${bg} !important; padding: ${py}px ${px}px !important; line-height: 1 !important; `
        if (cls.borderRadius != null) css += `border-radius: ${cls.borderRadius}px !important; `
        if (cls.boxShadow?.enabled) css += `box-shadow: ${cls.boxShadow.offsetX || 0}px ${cls.boxShadow.offsetY || 0}px ${cls.boxShadow.blur || 0}px ${cls.boxShadow.color || '#000'} !important; `
      }
      css += 'display: inline !important; vertical-align: baseline !important; line-height: inherit !important; '
      css += 'box-decoration-break: clone !important; -webkit-box-decoration-break: clone !important; }\n'
    }
    return css
  }

  const altSelect = (e, nodeId) => {
    const nodeIds = document.elementsFromPoint(e.clientX, e.clientY).map(el => el.getAttribute('data-node-id')).filter(Boolean)
    const unique = [...new Set(nodeIds)]
    if (unique.length > 1) {
      const currentIdx = unique.indexOf(primarySelectedId)
      selectLayer(currentIdx !== -1 && currentIdx + 1 < unique.length ? unique[currentIdx + 1] : unique[0])
    } else selectLayer(nodeId)
  }

  const menuSel = {
    count: selectedNodes.length,
    single: selectedNodes.length === 1 ? selectedNodes[0] : null,
    allLocked: selectedNodes.length > 0 && selectedNodes.every(n => n.locked),
    allHidden: selectedNodes.length > 0 && selectedNodes.every(n => n.hidden),
    inGroup: !!selectedGroupId || selectedNodes.some(n => n.groupId),
    canPaste: hasClipboard,
  }
  const menuActions = {
    cut: () => copyLayers(selectedNodes, { cut: true }),
    copy: () => copyLayers(selectedNodes),
    paste: pasteStored,
    duplicate: () => duplicateNodes(selectedIds),
    remove: deleteSelection,
    arrange: dir => arrange(dir),
    group: createGroupFromSelection,
    ungroup: ungroupSelection,
    align: alignSelection,
    distribute: distributeSelection,
    toggleHidden: () => toggleHidden(),
    toggleLocked: () => toggleLocked(),
    editText: () => setEditingId(primarySelectedId),
    crop: () => setCropModeNodeId(primarySelectedId),
    selectAll,
    addText: () => addText('body'),
    addImage: openImageDialog,
    fit: fitCanvasToView,
  }
  // Right-clicking a layer selects it first; right-clicking empty canvas clears the selection.
  const onCanvasMenu = (e) => {
    const nodeId = e.target.closest?.('[data-node-id]')?.getAttribute('data-node-id')
    if (!nodeId) { if (selectedIds.length) clearSelection(); return }
    if (!selectedIds.includes(nodeId)) { setSelectedIds([nodeId]); setSelectedGroupId(null) }
  }

  const arrangeBar = selected && (
    <div className="flex items-center gap-0.5 border-b border-bk-line px-3 py-2">
      <IconButton label={`Bring to front (${mod}Shift+])`} onClick={() => arrange('front', [selected.id])}><ChevronsUp /></IconButton>
      <IconButton label={`Bring forward (${mod}])`} onClick={() => arrange('forward', [selected.id])}><ChevronUp /></IconButton>
      <IconButton label={`Send backward (${mod}[)`} onClick={() => arrange('backward', [selected.id])}><ChevronDown /></IconButton>
      <IconButton label={`Send to back (${mod}Shift+[)`} onClick={() => arrange('back', [selected.id])}><ChevronsDown /></IconButton>
      <span className="mx-1 h-5 w-px bg-bk-line" />
      <IconButton label={`Duplicate (${mod}D)`} onClick={() => duplicateNodes([selected.id])}><CopyPlus /></IconButton>
      <IconButton label="Delete layer" tone="danger" className="ml-auto" onClick={() => deleteNode(selected.id)}><Trash2 /></IconButton>
    </div>
  )

  const editPanel = selectedGroup ? (
    <GroupProperties group={selectedGroup} nodes={canvas.nodes} selectedIds={selectedIds} updateGroup={updateGroup} updateGroupGap={updateGroupGap} ungroupById={ungroupById} moveGroupMember={moveGroupMember} />
  ) : selectedIds.length > 1 ? (
    <MultiSelection
      count={selectedNodes.length}
      allHidden={menuSel.allHidden}
      allLocked={menuSel.allLocked}
      onAlign={alignSelection}
      onDistribute={distributeSelection}
      onGroup={createGroupFromSelection}
      onDuplicate={() => duplicateNodes(selectedIds)}
      onDelete={deleteSelection}
      onClear={clearSelection}
      onToggleHidden={() => toggleHidden()}
      onToggleLocked={() => toggleLocked()}
    />
  ) : !selected ? (
    <PostSettings
      canvas={canvas}
      setCanvas={setCanvas}
      slide={carousel ? { index: openIndex, name: pages[openIndex]?.name } : null}
      onRenameSlide={name => setCanvas(c => renamePage(c, c._pageId, name))}
    />
  ) : (
    <>
      <LayerHeader node={selected} updateNode={updateNode} onToggleHidden={toggleHidden} onToggleLocked={toggleLocked} />
      {arrangeBar}
      {selected.type === 'text' && <TextProperties node={selected} updateNode={updateNode} canvas={canvas} editorRef={editorRef} savedRangeRef={savedRangeRef} htmlToTags={htmlToTags} editingId={editingId} />}
      {selected.type === 'image' && (
        <ImageProperties
          node={selected}
          updateNode={updateNode}
          setCropModeNodeId={setCropModeNodeId}
          flowId={canvas.flowId}
          uploading={uploading}
          onReplace={(src) => updateNode(selected.id, { src })}
          onReplaceUpload={async (file) => {
            setUploading(true)
            try {
              const url = await uploadImage(file)
              updateNode(selected.id, { src: url })
              setSessionImages(prev => [url, ...prev.filter(v => v !== url)])
            } catch (e) {
              toast.error(e.message)
            } finally {
              setUploading(false)
            }
          }}
        />
      )}
      {selected.type === 'shape' && <ShapeProperties node={selected} updateNode={updateNode} />}
      {selected.type === 'gradient' && <GradientProperties node={selected} updateNode={updateNode} />}
      <LayoutSection key={selected.id} node={selected} canvas={canvas} updateNode={updateNode} />
      <AdvancedSection node={selected} updateNode={updateNode} setDynamicKey={setDynamicKey} />
    </>
  )

  const sidePanel = (side, open) => cn(
    'flex flex-col bg-bk-bg transition-transform duration-300 ease-out',
    'max-lg:fixed max-lg:bottom-0 max-lg:top-14 max-lg:z-40 max-lg:shadow-bk-pop',
    side === 'left' ? 'w-[264px] border-r border-bk-line max-lg:left-0' : 'w-[304px] border-l border-bk-line max-lg:right-0',
    !open && (side === 'left' ? 'max-lg:-translate-x-full' : 'max-lg:translate-x-full'),
  )

  const afterAdd = fn => (...args) => { fn(...args); setPanel(null) }
  const hovered = hoverId && !selectedIds.includes(hoverId) && !dragState.current ? nodes.find(n => n.id === hoverId && !n.hidden) : null
  const multiBounds = selectedNodes.length > 1 && !selectedGroupId ? selectionBounds(selectedNodes) : null

  return (
    <EditorProviders swatches={swatches}>
      <div
        className={cn(appLayer, 'relative flex h-[100dvh] flex-col overflow-hidden bg-bk-alt')}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setIsDraggingOverBase(true) } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDraggingOverBase(false) }}
        onDrop={handleRootDrop}
      >
        <style>{generateCssFromClasses()}</style>

        {selectionRect && editingId && (() => {
          const editingNode = canvas.nodes?.find(n => n.id === editingId)
          const textClasses = Object.entries(canvas.classes || {}).filter(([, c]) => c.type === 'text' || !c.type)
          const btn = active => cn('flex size-7 items-center justify-center rounded-md transition-colors [&_svg]:size-3.5', active ? 'bg-bk-fg text-bk-bg' : 'hover:bg-bk-alt')
          return (
            <div
              data-floating-toolbar="true"
              style={{ position: 'fixed', top: Math.max(8, selectionRect.top - 52), left: Math.max(8, Math.min(window.innerWidth - 520, selectionRect.left + selectionRect.width / 2 - 260)), zIndex: 99999 }}
              className="flex items-center gap-0.5 rounded-xl border border-bk-line bg-bk-surface px-1.5 py-1.5 text-bk-fg shadow-bk-pop"
              onPointerDown={(e) => e.preventDefault()}
            >
              {textClasses.length > 0 && (
                <>
                  <select
                    aria-label="Apply a style"
                    className="h-7 max-w-[110px] rounded-md border border-bk-field bg-bk-surface px-1.5 text-[12px]"
                    onChange={(e) => { if (e.target.value) { applyAdHocClass(e.target.value); e.target.value = '' } }}
                    onPointerDown={(e) => e.stopPropagation()}
                    defaultValue=""
                  >
                    <option value="">Style…</option>
                    {textClasses.map(([name]) => <option key={name} value={name}>{name.replace(/^\./, '')}</option>)}
                  </select>
                  <span className="mx-1 h-4 w-px bg-bk-line" />
                </>
              )}
              <button type="button" className={btn(textFormat.bold)} aria-label="Bold" onClick={() => applyAdHocStyle('fontWeight', 'bold')}><Bold /></button>
              <button type="button" className={btn(textFormat.italic)} aria-label="Italic" onClick={() => applyAdHocStyle('fontStyle', 'italic')}><Italic /></button>
              <button type="button" className={btn(textFormat.underline)} aria-label="Underline" onClick={() => applyAdHocStyle('textDecoration', 'underline')}><Underline /></button>
              <span className="mx-1 h-4 w-px bg-bk-line" />
              <div className="w-[150px]" title="Colour of the highlighted words">
                <ColorField
                  label="Colour of the highlighted words"
                  allowTransparent={false}
                  value={textFormat.color || editingNode?.color || '#000000'}
                  onChange={(val) => { setTextFormat(prev => ({ ...prev, color: val })); applyAdHocStyle('color', val) }}
                />
              </div>
              <span className="mx-1 h-4 w-px bg-bk-line" />
              <input
                type="number"
                min={6}
                max={400}
                aria-label="Size of the highlighted words (press Enter)"
                title="Size in px — press Enter"
                placeholder={String(editingNode?.fontSize || 48)}
                className="h-7 w-14 rounded-md border border-bk-field bg-bk-surface px-1.5 text-center text-[12px]"
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    const v = parseInt(e.target.value)
                    if (!isNaN(v) && v > 0) { applyAdHocStyle('fontSize', `${v}px`); e.target.value = '' }
                  }
                }}
              />
            </div>
          )
        })()}

        {isDraggingOverBase && (
          <div className="pointer-events-none absolute inset-3 z-[100] flex items-center justify-center rounded-2xl border-2 border-dashed border-bk-fg bg-bk-butter/15 backdrop-blur-[2px]">
            <div className="flex flex-col items-center rounded-2xl bg-bk-surface px-8 py-6 text-center shadow-bk-pop">
              <Upload className="mb-2 size-8" />
              <p className="font-bk-display text-[20px] font-bold tracking-[-0.03em]">Drop to add images</p>
              <p className="mt-0.5 text-[13px] text-bk-muted">They go onto this {carousel ? 'slide' : 'post'}.</p>
            </div>
          </div>
        )}
        {readout && (
          <div className="pointer-events-none fixed z-[200] whitespace-pre rounded-md bg-bk-ink px-2 py-1 font-mono text-[11.5px] font-semibold tabular-nums text-bk-cream shadow-bk-pop" style={{ left: readout.x + 16, top: readout.y + 18 }}>
            {readout.text}
          </div>
        )}
        <div ref={measureRef} aria-hidden="true" style={{ position: 'fixed', visibility: 'hidden', pointerEvents: 'none', left: -99999, top: -99999, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} />

        <header className="relative z-30 flex h-14 shrink-0 items-center gap-1.5 border-b border-bk-line bg-bk-bg px-2 sm:gap-2 sm:px-3">
          <Tip label={backLabel}>
            <Link href={backHref} aria-label={backLabel} className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-bk-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-fg">
              <ArrowLeft className="size-4" />
            </Link>
          </Tip>
          <img src="/logo/batkle-icon-color.png" alt="" className="hidden size-7 dark:hidden sm:block" />
          <img src="/logo/batkle-icon-color-reversed.png" alt="" className="hidden size-7 sm:dark:block" />
          <div className="min-w-0 sm:ml-1">
            <input
              aria-label="Post name"
              value={canvas.name || ''}
              onChange={(e) => setCanvas(c => ({ ...c, name: e.target.value }), false, 'post-name')}
              placeholder="Untitled post"
              className="block h-7 w-[clamp(120px,22vw,320px)] truncate rounded-md bg-transparent px-1.5 font-bk-display text-[15px] font-bold tracking-[-0.02em] transition-colors hover:bg-bk-alt focus:bg-bk-alt focus:outline-none"
            />
            <p className="truncate px-1.5 text-[11.5px] text-bk-muted">
              {carousel ? `Carousel · slide ${openIndex + 1} of ${pages.length}` : 'Single post'}<span className="hidden md:inline"> · {canvas.width} × {canvas.height}</span>
            </p>
          </div>

          <div className="ml-2 hidden items-center gap-0.5 md:flex">
            <IconButton label={`Undo (${mod}Z)`} onClick={undo} disabled={historyRef.current.past.length === 0}><Undo2 /></IconButton>
            <IconButton label={`Redo (${mod}Shift+Z)`} onClick={redo} disabled={historyRef.current.future.length === 0}><Redo2 /></IconButton>
          </div>

          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            <SaveStatus saving={saving} error={saveError} dirty={hasChanges} onSave={() => save()} />
            <DesignLibrary canvas={canvas} canvasId={id} selected={canvas.designSelection} onSelect={switchDesign} triggerClassName={appButton('outline', 'sm', 'hidden sm:inline-flex')}>
              <Palette className="size-4" /><span className="hidden lg:inline">Design</span>
            </DesignLibrary>
            <IconButton label="Layers and add" className="lg:hidden" active={panel === 'layers'} onClick={() => setPanel(p => (p === 'layers' ? null : 'layers'))}><Layers /></IconButton>
            <IconButton label="Edit panel" className="lg:hidden" active={panel === 'edit'} onClick={() => setPanel(p => (p === 'edit' ? null : 'edit'))}><SlidersHorizontal /></IconButton>
            <DropdownMenu modal={false}>
              <Tip label="More">
                <DropdownMenuTrigger aria-label="More" className="inline-flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-bk-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-fg data-[state=open]:bg-bk-alt">
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
              </Tip>
              <DropdownMenuContent align="end" className={cn(appLayer, 'w-56 rounded-xl border-bk-line bg-bk-surface p-1.5 shadow-bk-pop')}>
                <DropdownMenuItem className={cn(menuItem, 'md:hidden')} onSelect={undo}><Undo2 />Undo</DropdownMenuItem>
                <DropdownMenuItem className={cn(menuItem, 'md:hidden')} onSelect={redo}><Redo2 />Redo</DropdownMenuItem>
                <DropdownMenuItem className={menuItem} onSelect={() => { setTab('api'); setPanel('edit') }}><SlidersHorizontal />API & test render</DropdownMenuItem>
                <DropdownMenuItem className={menuItem} onSelect={exportJson}><FileJson />Export as JSON</DropdownMenuItem>
                <DropdownMenuItem className={menuItem} onSelect={toggleSnapping}><Magnet />{snapping ? 'Turn snapping off' : 'Turn snapping on'}</DropdownMenuItem>
                <DropdownMenuItem className={menuItem} onSelect={() => setShortcutsOpen(true)}><Keyboard />Keyboard shortcuts<span className="ml-auto text-[11.5px] font-medium text-bk-muted">?</span></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ThemeButton />
            <button type="button" onClick={download} disabled={downloading} className={appButton('primary', 'sm', 'px-2.5 sm:px-3')}>
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              <span className="hidden sm:inline">{downloading ? 'Preparing…' : carousel ? 'Download slides' : 'Download'}</span>
            </button>
          </div>
        </header>

        {canvas.globalDesignEditor && (
          <div className="border-b border-bk-line bg-bk-butter/25 px-4 py-2 text-[13px]">
            This post came from the retired design template editor, so edits here no longer change the design. Edit the design in the <a href="/design-library" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">Design Library</a>.
          </div>
        )}

        <div className="relative flex min-h-0 flex-1">
          <aside aria-label="Add and layers" className={sidePanel('left', panel === 'layers')}>
            <LayersPanel
              canvas={canvas}
              carousel={carousel}
              groups={groups}
              selectedIds={selectedIds}
              selectedGroupId={selectedGroupId}
              expandedGroups={expandedGroups}
              setHoverId={setHoverId}
              onSelectLayer={selectLayer}
              onSelectGroup={selectGroup}
              onToggleGroup={toggleGroupExpanded}
              onUngroup={ungroupById}
              onCreateGroup={createGroupFromSelection}
              onToggleHidden={toggleHidden}
              onToggleLocked={toggleLocked}
              onRename={renameNode}
              dnd={{ addNodeToGroup, removeNodeFromGroupById, reorderGroupMember, reorderByDrag }}
              menu={{ sel: menuSel, actions: menuActions, onOpen: (nodeId) => { if (nodeId && !selectedIds.includes(nodeId)) { setSelectedIds([nodeId]); setSelectedGroupId(null) } } }}
              sessionImages={sessionImages}
              onInsertImage={insertImageNode}
            >
              <AddSection
                canvas={canvas}
                uploading={uploading}
                onAddText={afterAdd(addText)}
                onAddShape={afterAdd(addShape)}
                onAddLine={afterAdd(addLine)}
                onAddGradient={afterAdd(addGradient)}
                onOpenImage={afterAdd(openImageDialog)}
                onUpload={afterAdd(uploadFiles)}
              />
            </LayersPanel>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
              <LayerMenu sel={menuSel} actions={menuActions} onOpen={onCanvasMenu} disabled={!!editingId}>
                <div
                  ref={canvasViewportRef}
                  data-editor-canvas=""
                  className={cn('absolute inset-0 overflow-auto [scrollbar-gutter:stable] [scrollbar-width:thin]', spaceDown && '[&_*]:!cursor-grab', panning && '[&_*]:!cursor-grabbing')}
                  style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(var(--bk-fg) / 0.09) 1px, transparent 0)', backgroundSize: '22px 22px', cursor: panning ? 'grabbing' : spaceDown ? 'grab' : undefined }}
                  onMouseEnter={() => { pointerInViewportRef.current = true }}
                  onMouseLeave={() => { pointerInViewportRef.current = false; setHoverId(null) }}
                  onMouseDownCapture={(e) => { if (e.button === 1 || (e.button === 0 && spaceDown)) startPan(e) }}
                  onMouseDown={(e) => {
                    const el = canvasViewportRef.current
                    // Pressing the viewport's own scrollbars scrolls; it doesn't start a selection box.
                    if (e.target === el && (e.nativeEvent.offsetX >= el.clientWidth || e.nativeEvent.offsetY >= el.clientHeight)) return
                    if (e.button === 0) startMarquee(e)
                  }}
                >
                  {/* The stage fills the view (or fits the zoomed slide) and clips what lies beyond it, so selection
                      outlines and handles sticking out past the slide never make the view scroll. */}
                  <div className="relative flex h-max min-h-full w-max min-w-full p-10 [overflow:clip]">
                    <div
                      ref={canvasRef}
                      className="relative m-auto shrink-0 shadow-bk-pop ring-1 ring-black/5"
                      style={{ width: canvas.width * scale, height: canvas.height * scale, background: canvas.background || '#ffffff', filter: canvasColorFilter }}
                    >
                      <div style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
                        {/* Clipped content: layers show only inside the slide */}
                        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                          {nodes.map((node) => node.hidden ? null : (
                            <div key={node.id} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                              {selectedIds.includes(node.id) && !node.locked && (node.maxWidth || node.maxHeight) && (
                                <div style={{
                                  position: 'absolute', left: node.x, top: node.y,
                                  width: node.maxWidth || node.width, height: node.maxHeight || node.height,
                                  transform: `rotate(${node.rotation || 0}deg)`, transformOrigin: `${node.width / 2}px ${node.height / 2}px`,
                                  border: `2px dashed ${SNAP}`, pointerEvents: 'none', zIndex: 10,
                                }}>
                                  <div
                                    title="Drag to set how far the text may flow"
                                    onMouseDown={(e) => handleMouseDown(e, node, 'resize-max')}
                                    style={{ pointerEvents: 'auto', position: 'absolute', right: -8, bottom: -8, width: 16, height: 16, background: '#fff', border: `2px solid ${SNAP}`, cursor: 'nwse-resize' }}
                                  />
                                </div>
                              )}
                              <div
                                data-node-id={node.id}
                                onMouseDown={(e) => { if (editingId !== node.id) handleMouseDown(e, node, 'move') }}
                                onMouseEnter={() => { if (!dragState.current) setHoverId(node.id) }}
                                onMouseLeave={() => setHoverId(h => (h === node.id ? null : h))}
                                onClick={(e) => e.stopPropagation()}
                                onDoubleClick={(e) => { e.stopPropagation(); if (node.type === 'text' && !node.locked) setEditingId(node.id) }}
                                className={classAttr(node.className)}
                                style={{ ...nodeBoxStyle(node), opacity: editingId === node.id ? 0 : (node.opacity ?? 100) / 100 }}
                              >
                                {node.type === 'text' ? splitTokensByNewlines(parseStyledText(node.text || '', canvas.classes || {})).map((lineTokens, i) => (
                                  <div key={i} style={{ width: '100%', whiteSpace: 'pre-wrap', lineHeight: node.lineHeight || 1.2, textAlign: node.textAlign || 'left' }}>
                                    {renderStyledText(lineTokens, createElement, { canvasClasses: canvas.classes || {} })}
                                  </div>
                                )) : node.type === 'image' && node.src ? (() => {
                                  const cL = node.cropLeft || 0, cR = node.cropRight || 0
                                  const cT = node.cropTop || 0, cB = node.cropBottom || 0
                                  const flip = node.flipX || node.flipY ? `scale(${node.flipX ? -1 : 1}, ${node.flipY ? -1 : 1})` : undefined
                                  // A polygon mask with a crop nests the crop in an inner box so both clips apply.
                                  if (POLYGON_MASKS[node.mask] && (cL > 0 || cR > 0 || cT > 0 || cB > 0)) {
                                    return (
                                      <div style={{ position: 'absolute', top: `${cT}%`, left: `${cL}%`, right: `${cR}%`, bottom: `${cB}%`, overflow: 'hidden' }}>
                                        <img src={node.src} alt="" style={{ position: 'absolute', top: `-${cT / (100 - cT - cB) * 100}%`, left: `-${cL / (100 - cL - cR) * 100}%`, width: `${100 * 100 / (100 - cL - cR)}%`, height: `${100 * 100 / (100 - cT - cB)}%`, objectFit: node.objectFit || 'cover', filter: buildFilterCss(node.filters), transform: flip }} draggable={false} />
                                      </div>
                                    )
                                  }
                                  return <img src={node.src} alt="" style={{ width: '100%', height: '100%', objectFit: node.objectFit || 'cover', filter: buildFilterCss(node.filters), transform: flip }} draggable={false} />
                                })() : node.type === 'image' ? <div style={{ width: '100%', height: '100%', background: '#e5e7eb' }} /> : null}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Unclipped overlay: selection outlines and handles may sit outside the slide */}
                        <div style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
                          {marquee && (
                            <div style={{
                              position: 'absolute', left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height,
                              border: `${1 / scale}px solid ${SELECT}`, backgroundColor: 'rgba(99, 102, 241, 0.1)', pointerEvents: 'none', zIndex: 9999,
                            }} />
                          )}

                          {hovered && (() => {
                            const b = visibleBox(hovered)
                            return (
                              <div style={{
                                position: 'absolute', left: b.x, top: b.y, width: b.width, height: b.height,
                                transform: `rotate(${hovered.rotation || 0}deg)`,
                                transformOrigin: `${hovered.x + hovered.width / 2 - b.x}px ${hovered.y + hovered.height / 2 - b.y}px`,
                                outline: `${1.5 / scale}px solid ${SELECT}`, opacity: 0.7, pointerEvents: 'none', zIndex: 30,
                              }} />
                            )
                          })()}

                          {selectedGroupId && (() => {
                            const g = groups.find((gr) => gr.id === selectedGroupId)
                            const bounds = g ? getGroupBounds(canvas.nodes, g) : null
                            if (!bounds) return null
                            return <div style={{ position: 'absolute', left: bounds.x - 4, top: bounds.y - 4, width: bounds.width + 8, height: bounds.height + 8, border: `${2 / scale}px dashed ${SELECT}`, pointerEvents: 'none', zIndex: 40 }} />
                          })()}

                          {multiBounds && (
                            <div style={{ position: 'absolute', left: multiBounds.x - 6 / scale, top: multiBounds.y - 6 / scale, width: multiBounds.width + 12 / scale, height: multiBounds.height + 12 / scale, border: `${1 / scale}px dashed ${SELECT}`, pointerEvents: 'none', zIndex: 40 }} />
                          )}

                          {selectedNodes.filter((node) => editingId !== node.id).map((node) => {
                            const isPrimary = node.id === primarySelectedId
                            const isImage = node.type === 'image'
                            const b = visibleBox(node)
                            // The overlay covers the visible (cropped) area and rotates around the node's own centre.
                            const offsetX = b.x - node.x
                            const offsetY = b.y - node.y
                            const isCropMode = cropModeNodeId === node.id && !node.locked
                            const fixed = node.locked || node.hidden
                            // Handles keep one size on screen at every zoom.
                            const handle = 12 / scale
                            const handleLook = { background: '#fff', border: `${1.5 / scale}px solid ${SELECT}`, boxShadow: `0 ${1 / scale}px ${3 / scale}px rgba(0,0,0,.25)` }
                            const roomFor = length => length * scale >= 48
                            const topPill = handlesFor(node).some(([hx, hy]) => !hx && hy === -1) && roomFor(b.width)
                            return (
                              <div key={node.id} style={{
                                position: 'absolute', left: b.x, top: b.y, width: b.width, height: b.height,
                                transform: `rotate(${node.rotation || 0}deg)`,
                                transformOrigin: `${node.width / 2 - offsetX}px ${node.height / 2 - offsetY}px`,
                                outline: isCropMode ? `${2 / scale}px dashed ${CROP}` : fixed ? `${1.5 / scale}px dashed ${SELECT}` : isPrimary ? `${2 / scale}px solid ${SELECT}` : `${1.5 / scale}px solid ${SELECT}`,
                                outlineOffset: 2 / scale,
                                pointerEvents: 'none', zIndex: isPrimary ? 50 : 45,
                              }}>
                                {!fixed && (
                                  <div
                                    data-node-id={node.id}
                                    onMouseDown={(e) => handleMouseDown(e, node, 'move')}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation()
                                      if (node.type === 'text') setEditingId(node.id)
                                      if (isImage && isPrimary) setCropModeNodeId(node.id)
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', cursor: isCropMode ? 'crosshair' : 'move' }}
                                  />
                                )}
                                {node.locked && (
                                  <div style={{ position: 'absolute', left: 0, top: -24 / scale, fontSize: 11 / scale, fontWeight: 700, color: '#fff', background: SELECT, padding: `${2 / scale}px ${6 / scale}px`, borderRadius: 4 / scale, whiteSpace: 'nowrap' }}>Locked</div>
                                )}
                                {isPrimary && !isCropMode && !fixed && selectedIds.length === 1 && (
                                  <>
                                    {handlesFor(node).map(([hx, hy]) => {
                                      const cursor = handleCursor(hx, hy, node.rotation || 0)
                                      const down = (e) => handleMouseDown(e, node, 'resize', [hx, hy])
                                      if (hx && hy) {
                                        return (
                                          <div
                                            key={`${hx}${hy}`}
                                            onMouseDown={down}
                                            title={node.type === 'text' ? 'Drag to resize the text' : 'Drag to resize (Shift keeps proportions)'}
                                            style={{ ...handleLook, position: 'absolute', left: `calc(${(hx + 1) * 50}% - ${handle / 2}px)`, top: `calc(${(hy + 1) * 50}% - ${handle / 2}px)`, width: handle, height: handle, borderRadius: handle / 4, cursor, pointerEvents: 'auto' }}
                                          />
                                        )
                                      }
                                      // A side: its whole edge between the corners drags, and a pill marks it when there is room.
                                      const strip = 10 / scale
                                      return (
                                        <div
                                          key={`${hx}${hy}`}
                                          onMouseDown={down}
                                          title={node.type === 'text' ? 'Drag to resize the text box' : 'Drag to resize (Shift keeps proportions)'}
                                          style={{
                                            position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor, pointerEvents: 'auto',
                                            ...(hx
                                              ? { left: `calc(${(hx + 1) * 50}% - ${strip / 2}px)`, top: handle / 2, width: strip, height: `calc(100% - ${handle}px)` }
                                              : { top: `calc(${(hy + 1) * 50}% - ${strip / 2}px)`, left: handle / 2, height: strip, width: `calc(100% - ${handle}px)` }),
                                          }}
                                        >
                                          {roomFor(hx ? b.height : b.width) && (
                                            <div style={{ ...handleLook, flexShrink: 0, width: hx ? handle * 0.7 : handle * 2.2, height: hx ? handle * 2.2 : handle * 0.7, borderRadius: handle, pointerEvents: 'none' }} />
                                          )}
                                        </div>
                                      )
                                    })}
                                    <div onMouseDown={(e) => handleMouseDown(e, node, 'rotate')} title="Rotate (Shift snaps to 45°)"
                                      style={{ position: 'absolute', left: '50%', top: -30 / scale - handle / 2, width: handle, height: handle, marginLeft: -handle / 2, background: '#fff', borderRadius: '50%', cursor: 'grab', border: `${2 / scale}px solid ${SELECT}`, pointerEvents: 'auto' }} />
                                    <div style={{ position: 'absolute', left: '50%', top: -30 / scale + handle / 2, width: 1.5 / scale, height: 30 / scale - handle / 2 - (topPill ? handle * 0.35 : 0), marginLeft: -0.75 / scale, background: SELECT, pointerEvents: 'none' }} />
                                  </>
                                )}
                                {isPrimary && isCropMode && (
                                  <>
                                    {[
                                      ['crop-left', { left: -4 / scale, top: '20%', width: 8 / scale, height: '60%', cursor: 'ew-resize' }],
                                      ['crop-right', { right: -4 / scale, top: '20%', width: 8 / scale, height: '60%', cursor: 'ew-resize' }],
                                      ['crop-top', { top: -4 / scale, left: '20%', height: 8 / scale, width: '60%', cursor: 'ns-resize' }],
                                      ['crop-bottom', { bottom: -4 / scale, left: '20%', height: 8 / scale, width: '60%', cursor: 'ns-resize' }],
                                    ].map(([cropMode, pos]) => (
                                      <div key={cropMode} onMouseDown={(e) => handleMouseDown(e, node, cropMode)} style={{ position: 'absolute', ...pos, background: CROP, borderRadius: 3 / scale, pointerEvents: 'auto' }} />
                                    ))}
                                    <div
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => { e.stopPropagation(); setCropModeNodeId(null) }}
                                      style={{ position: 'absolute', top: -34 / scale, right: 0, background: '#14131A', color: '#F6F3EA', fontSize: 12 / scale, fontWeight: 700, padding: `${4 / scale}px ${10 / scale}px`, borderRadius: 6 / scale, cursor: 'pointer', pointerEvents: 'auto', whiteSpace: 'nowrap' }}
                                    >
                                      Done cropping
                                    </div>
                                  </>
                                )}
                              </div>
                            )
                          })}

                          {editingId && canvas.nodes?.find(n => n.id === editingId) && (() => {
                            const enode = canvas.nodes.find(n => n.id === editingId)
                            return (
                              <div
                                id={`editor-${enode.id}`}
                                ref={editorRef}
                                contentEditable
                                suppressContentEditableWarning
                                className={cn('absolute m-0 resize-none overflow-visible bg-transparent p-0 outline-none', classAttr(enode.className))}
                                style={{
                                  left: enode.x, top: enode.y, width: enode.width, height: enode.height,
                                  color: enode.color || '#000', fontSize: enode.fontSize || 48, fontWeight: enode.fontWeight || 400,
                                  fontStyle: enode.fontStyle === 'italic' ? 'italic' : 'normal',
                                  fontFamily: `'${enode.fontFamily || 'Inter'}', sans-serif`,
                                  textAlign: enode.textAlign || 'left', lineHeight: enode.lineHeight || 1.2, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                  letterSpacing: `${enode.letterSpacing || 0}px`, textTransform: enode.textTransform || 'none',
                                  textShadow: enode.textShadow?.enabled ? `${enode.textShadow.offsetX || 0}px ${enode.textShadow.offsetY || 0}px ${enode.textShadow.blur || 0}px ${enode.textShadow.color || '#000'}` : 'none',
                                  transform: `rotate(${enode.rotation || 0}deg)`,
                                  outline: `${2 / scale}px solid ${SELECT}`, outlineOffset: 2 / scale,
                                  zIndex: 50, cursor: 'text', pointerEvents: 'auto', ...textGradientStyle(enode),
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onMouseUp={handleSelectionChange}
                                onKeyUp={handleSelectionChange}
                                onInput={(e) => updateNode(enode.id, { text: htmlToTags(e.currentTarget.innerHTML || '') })}
                                onBlur={(e) => updateNode(enode.id, { text: htmlToTags(e.target.innerHTML || '') })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    setEditingId(null)
                                    setSelectionRect(null)
                                  }
                                }}
                                onPaste={(e) => {
                                  e.preventDefault()
                                  const text = e.clipboardData.getData('text/plain')
                                  if (!text) return
                                  // Pasting inserts plain, unformatted text where the cursor is.
                                  const sel = window.getSelection()
                                  if (!sel || sel.rangeCount === 0 || !editorRef.current.contains(sel.anchorNode)) return
                                  const range = sel.getRangeAt(0)
                                  range.deleteContents()
                                  const textNode = document.createTextNode(text)
                                  range.insertNode(textNode)
                                  range.setStartAfter(textNode)
                                  range.collapse(true)
                                  sel.removeAllRanges()
                                  sel.addRange(range)
                                  updateNode(enode.id, { text: htmlToTags(editorRef.current.innerHTML || '') })
                                }}
                              />
                            )
                          })()}
                          {selected && selected.dynamic_key && !selected.hidden && (
                            <div style={{ position: 'absolute', left: selected.x, top: selected.y - 30 / scale, fontSize: 12 / scale, color: '#14131A', background: '#CFC8F5', padding: `${3 / scale}px ${8 / scale}px`, borderRadius: 4 / scale, fontWeight: 600, pointerEvents: 'none', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                              {selected.dynamic_key}
                            </div>
                          )}
                          {snapLines.map((line, i) => (
                            <div key={i} style={{
                              position: 'absolute',
                              background: SNAP,
                              zIndex: 9999,
                              ...(line.type === 'v' ? { left: line.pos, top: 0, bottom: 0, width: 1 / scale } : { top: line.pos, left: 0, right: 0, height: 1 / scale }),
                            }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </LayerMenu>

              <div className="pointer-events-none absolute bottom-3 right-3 z-10">
                <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-bk-line bg-bk-surface/95 p-1 shadow-bk-card backdrop-blur">
                  <IconButton label={snapping ? 'Snapping on: layers line up with each other and the slide' : 'Snapping off'} side="top" className="size-7" active={snapping} onClick={toggleSnapping}><Magnet /></IconButton>
                  <span className="mx-0.5 h-4 w-px bg-bk-line" />
                  <IconButton label={`Zoom out (${mod}−)`} side="top" className="size-7" onClick={() => zoomBy(0.8)}><Minus /></IconButton>
                  <DropdownMenu modal={false}>
                    <Tip label="Zoom options" side="top">
                      <DropdownMenuTrigger className="h-7 min-w-[56px] rounded-md px-1.5 text-[12px] font-semibold tabular-nums transition-colors hover:bg-bk-alt data-[state=open]:bg-bk-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-fg">
                        {Math.round(scale * 100)}%
                      </DropdownMenuTrigger>
                    </Tip>
                    <DropdownMenuContent side="top" align="end" className={cn(appLayer, 'w-48 rounded-xl border-bk-line bg-bk-surface p-1.5 shadow-bk-pop')}>
                      <DropdownMenuItem className={menuItem} onSelect={fitCanvasToView}><Maximize2 />Zoom to fit<span className="ml-auto text-[11.5px] font-medium text-bk-muted">Shift 1</span></DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-bk-line" />
                      {ZOOM_PRESETS.map(z => (
                        <DropdownMenuItem key={z} className={menuItem} onSelect={() => zoomTo(z)}>
                          <span className="w-4">{Math.abs(scale - z) < 0.005 && <Check className="size-4" />}</span>{z * 100}%
                          {z === 1 && <span className="ml-auto text-[11.5px] font-medium text-bk-muted">Shift 0</span>}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <IconButton label={`Zoom in (${mod}+)`} side="top" className="size-7" onClick={() => zoomBy(1.25)}><Plus /></IconButton>
                  <IconButton label="Zoom to fit (Shift+1)" side="top" className="size-7" onClick={fitCanvasToView}><Maximize2 /></IconButton>
                </div>
              </div>
            </div>

            {carousel && (
              <SlideStrip
                slides={slides}
                activeId={canvas._pageId}
                size={slideSize}
                onOpen={openSlide}
                onAdd={addSlide}
                onDuplicate={duplicateSlide}
                onDelete={deleteSlide}
                onMove={moveSlide}
              />
            )}
          </main>

          <aside aria-label="Edit" className={sidePanel('right', panel === 'edit')}>
            <div className="shrink-0 border-b border-bk-line p-2.5">
              <Segmented
                label="Panel"
                size="md"
                value={tab}
                onChange={setTab}
                options={[{ value: 'edit', label: 'Edit' }, { value: 'styles', label: 'Styles' }, { value: 'api', label: 'API' }]}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-class-panel={tab === 'styles' ? true : undefined}>
              {tab === 'edit' && editPanel}
              {tab === 'styles' && <StylesPanel canvas={canvas} setCanvas={setCanvas} />}
              {tab === 'api' && <ApiPanel canvas={canvas} doc={doc} setDynamicKey={setDynamicKey} onOpenSlide={openSlideAt} save={save} />}
            </div>
          </aside>

          {panel && <button type="button" aria-label="Close panel" onClick={() => setPanel(null)} className="fixed inset-0 top-14 z-30 bg-bk-ink/30 lg:hidden" />}
        </div>

        <Dialog open={imageDialog} onOpenChange={setImageDialog}>
          <DialogContent className="max-w-[560px]">
            <DialogHeader>
              <DialogTitle className="font-bk-display text-[20px] font-bold tracking-[-0.03em]">Add an image</DialogTitle>
              <DialogDescription className="text-[13.5px] text-bk-muted">From your brand gallery, your computer or a link. You can also drop images onto the editor, or paste a screenshot.</DialogDescription>
            </DialogHeader>
            <Segmented
              label="Image source"
              size="md"
              value={imageSource}
              onChange={setImageSource}
              options={[{ value: 'gallery', label: 'Gallery', icon: ImageIcon, text: 'Gallery' }, { value: 'upload', label: 'Upload', icon: Upload, text: 'Upload' }, { value: 'url', label: 'Link', icon: LinkIcon, text: 'Link' }]}
            />
            {imageSource === 'gallery' && <GalleryPicker flowId={canvas.flowId} onPick={src => insertImageNode(src)} />}
            {imageSource === 'upload' && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-bk-field px-6 py-10 text-center transition-colors hover:border-bk-fg hover:bg-bk-alt/60"
                >
                  {uploading ? <Loader2 className="size-6 animate-spin text-bk-muted" /> : <Upload className="size-6 text-bk-muted" />}
                  <span className="text-[14px] font-semibold">{uploading ? 'Uploading…' : 'Choose images'}</span>
                  <span className="text-[12.5px] text-bk-muted">PNG, JPG or WEBP, up to 6 MB each</span>
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = '' }} />
              </>
            )}
            {imageSource === 'url' && (
              <div className="flex gap-2">
                <TextField autoFocus aria-label="Image link" placeholder="https://example.com/image.png" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addImageByUrl()} className="h-9" />
                <button type="button" onClick={addImageByUrl} className={appButton('primary', 'md')}>Add</button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
          <DialogContent className="max-h-[85dvh] max-w-[640px] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-bk-display text-[20px] font-bold tracking-[-0.03em]">Keyboard shortcuts</DialogTitle>
              <DialogDescription className="text-[13.5px] text-bk-muted">Shortcuts work when you’re not typing in a field.{mod === '⌘' ? ' Ctrl means Cmd on a Mac.' : ''}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {SHORTCUTS.map(([section, rows]) => (
                <section key={section}>
                  <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-bk-muted">{section}</h3>
                  <dl className="divide-y divide-bk-line text-[13px]">
                    {rows.filter(([label]) => carousel || !label.includes('slide')).map(([label, keys]) => (
                      <div key={label} className="flex items-center justify-between gap-3 py-1.5">
                        <dt className="text-bk-fg/85">{label}</dt>
                        <dd className="shrink-0 rounded-md bg-bk-chip px-2 py-0.5 font-mono text-[11px]">{mod === '⌘' ? keys.replaceAll('Ctrl', '⌘') : keys}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </EditorProviders>
  )
}
