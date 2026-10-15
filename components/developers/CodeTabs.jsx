'use client'

import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

const LANGUAGES = [['curl', 'cURL'], ['javascript', 'JavaScript'], ['python', 'Python']]
// Choosing a language on one example switches every example on the page, and is remembered.
const STORAGE_KEY = 'bk-docs-language'
const EVENT = 'bk-docs-language'

const shell = 'overflow-hidden rounded-xl bg-bk-ink text-bk-cream dark:bg-[#0E0D13] dark:ring-1 dark:ring-inset dark:ring-white/10'
const pre = 'overflow-x-auto p-4 font-mono text-[12.5px] leading-[1.65]'

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }
  return (
    <button type="button" onClick={copy} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold text-bk-cream/75 transition-colors hover:bg-white/10 hover:text-bk-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-butter">
      {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/** An example request in cURL, JavaScript and Python. */
export function CodeTabs({ examples, label = 'Request', className = '' }) {
  const [language, setLanguage] = useState('curl')

  useEffect(() => {
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved && examples[saved]) setLanguage(saved) } catch {}
    const follow = e => examples[e.detail] && setLanguage(e.detail)
    window.addEventListener(EVENT, follow)
    return () => window.removeEventListener(EVENT, follow)
  }, [examples])

  const choose = value => {
    setLanguage(value)
    try { localStorage.setItem(STORAGE_KEY, value) } catch {}
    window.dispatchEvent(new CustomEvent(EVENT, { detail: value }))
  }

  return (
    <div className={cn(shell, className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-1.5">
        <div role="tablist" aria-label={`${label} language`} className="flex min-w-0 overflow-x-auto [scrollbar-width:none]">
          {LANGUAGES.map(([value, text]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={language === value}
              onClick={() => choose(value)}
              className={cn('h-7 shrink-0 rounded-md px-2.5 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-bk-butter', language === value ? 'bg-white/[0.12] text-bk-cream' : 'text-bk-cream/60 hover:text-bk-cream')}
            >
              {text}
            </button>
          ))}
        </div>
        <CopyButton text={examples[language]} />
      </div>
      <pre className={pre}><code>{examples[language]}</code></pre>
    </div>
  )
}

/** A labelled code sample, such as a response. */
export function CodeBlock({ code, label, className = '', scroll = false }) {
  return (
    <div className={cn(shell, className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 py-1.5 pl-4 pr-2">
        <span className="font-mono text-[12px] font-semibold text-bk-cream/70">{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className={cn(pre, scroll && 'max-h-[440px] overflow-y-auto')}><code>{code}</code></pre>
    </div>
  )
}
