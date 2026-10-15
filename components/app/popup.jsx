'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { appButton } from './ui'

/*
 * Batkle popups, used across the app instead of the browser's confirm()/alert().
 *
 *   const popup = usePopup()
 *   if (await popup.confirm({ title: 'Delete this render?', tone: 'danger' })) ...
 *
 * With `action`, the popup stays open while it runs, shows a spinner and keeps any error on screen,
 * so the person can retry or cancel without losing context.
 *
 * <Popup> is the same frame for dialogs with their own content (forms, previews).
 */

const DANGER = 'bg-[#C2412F] text-white hover:bg-[#A8361F] focus-visible:outline-[#C2412F]'

const TONES = {
  default: { icon: Info, tile: 'bg-bk-butter text-bk-ink', action: '' },
  danger: { icon: Trash2, tile: 'bg-[#C2412F]/10 text-[#C2412F] dark:bg-[#F0826F]/15 dark:text-[#F0826F]', action: DANGER },
  warning: { icon: AlertTriangle, tile: 'bg-[#F2A900]/15 text-[#9A6B00] dark:text-[#F2C14E]', action: '' },
  success: { icon: CheckCircle2, tile: 'bg-[#1F7A5A]/10 text-[#1F7A5A] dark:bg-[#4CC79A]/15 dark:text-[#4CC79A]', action: '' },
}

const SIZES = { sm: 'max-w-[440px]', md: 'max-w-[560px]', lg: 'max-w-[760px]', xl: 'max-w-[1000px]' }

/** The popup frame: optional tone icon, title, description, any content and a footer. */
export function Popup({
  open, onOpenChange, title, description, tone, icon, size = 'md', footer, children,
  dismissible = true, className, onInteractOutside, onEscapeKeyDown, onCloseAutoFocus, ...contentProps
}) {
  const style = tone ? TONES[tone] || TONES.default : null
  // What had focus when the popup opened, read during the render that opens it: the dialog's own effects run first
  // and move focus inside. A popup without a trigger would otherwise send focus to the page when it closes.
  const opener = useRef(null)
  const wasOpen = useRef(false)
  if (open && !wasOpen.current && typeof document !== 'undefined') opener.current = document.activeElement
  wasOpen.current = Boolean(open)
  const Icon = icon === undefined ? style?.icon : icon
  return (
    <Dialog open={open} onOpenChange={next => (dismissible || next) && onOpenChange?.(next)}>
      <DialogContent
        hideClose={!dismissible}
        onInteractOutside={e => { onInteractOutside?.(e); if (!dismissible) e.preventDefault() }}
        onEscapeKeyDown={e => { onEscapeKeyDown?.(e); if (!dismissible) e.preventDefault() }}
        onCloseAutoFocus={e => {
          onCloseAutoFocus?.(e)
          const back = opener.current
          if (e.defaultPrevented || !back?.isConnected || typeof back.focus !== 'function') return
          e.preventDefault()
          back.focus()
        }}
        // Without a description, Radix expects aria-describedby to be cleared explicitly.
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn(SIZES[size] || size, 'max-h-[calc(100dvh-32px)] overflow-y-auto', className)}
        {...contentProps}
      >
        <DialogHeader className={cn(Icon && 'flex-row items-start gap-4')}>
          {Icon && (
            <span aria-hidden="true" className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', style?.tile || TONES.default.tile)}>
              <Icon className="size-5" />
            </span>
          )}
          <div className="min-w-0 space-y-1.5">
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </div>
        </DialogHeader>
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

/** Keeps a quoted name in a popup title to one or two lines. */
export function shortName(text, max = 48) {
  const value = String(text || '').trim()
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

const PopupContext = createContext(null)

/** confirm(options) → Promise<boolean>; alert(options) → Promise<void>. */
export function usePopup() {
  const popup = useContext(PopupContext)
  if (!popup) throw new Error('usePopup must be used inside <PopupProvider>')
  return popup
}

// Matches the dialog's close animation, so the next queued popup never jumps in mid-fade.
const CLOSE_MS = 200

export function PopupProvider({ children }) {
  const [queue, setQueue] = useState([])
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = queue[0]

  const show = useCallback((kind, options) => new Promise(resolve => {
    setQueue(q => [...q, { kind, options: typeof options === 'string' ? { title: options } : options || {}, resolve }])
  }), [])

  const settle = useCallback(value => {
    if (!current || closing) return
    current.resolve(value)
    setClosing(true)
    setTimeout(() => {
      setQueue(q => q.slice(1))
      setClosing(false)
      setBusy(false)
      setError('')
    }, CLOSE_MS)
  }, [current, closing])

  const api = useMemo(() => ({
    confirm: options => show('confirm', options),
    alert: options => show('alert', options).then(() => undefined),
  }), [show])

  const confirm = async () => {
    const action = current?.options.action
    if (!action) return settle(true)
    setBusy(true)
    setError('')
    try {
      await action()
      settle(true)
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  const options = current?.options || {}
  const isConfirm = current?.kind === 'confirm'
  const tone = options.tone || 'default'
  const confirmLabel = options.confirmLabel || (tone === 'danger' ? 'Delete' : isConfirm ? 'Confirm' : 'Got it')

  return (
    <PopupContext.Provider value={api}>
      {children}
      {current && (
        <Popup
          open={!closing}
          onOpenChange={next => !next && !busy && settle(isConfirm ? false : undefined)}
          dismissible={!busy}
          // A confirmation needs an explicit answer; a click outside never counts as one.
          onInteractOutside={e => isConfirm && e.preventDefault()}
          role={isConfirm ? 'alertdialog' : 'dialog'}
          size={options.size || 'sm'}
          tone={tone}
          icon={options.icon}
          title={options.title || (isConfirm ? 'Are you sure?' : 'Notice')}
          description={options.description}
          footer={(
            <>
              {isConfirm && (
                <button type="button" onClick={() => settle(false)} disabled={busy} className={appButton('outline', 'md')}>
                  {options.cancelLabel || 'Cancel'}
                </button>
              )}
              <button type="button" onClick={isConfirm ? confirm : () => settle(undefined)} disabled={busy} className={appButton('primary', 'md', TONES[tone]?.action)}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy && options.busyLabel ? options.busyLabel : confirmLabel}
              </button>
            </>
          )}
        >
          {options.body}
          {error && (
            <p role="alert" className="rounded-xl border border-[#C2412F]/25 bg-[#C2412F]/[0.06] px-4 py-3 text-[14px] leading-relaxed text-[#A8361F] dark:text-[#F0826F]">
              {error}
            </p>
          )}
        </Popup>
      )}
    </PopupContext.Provider>
  )
}
