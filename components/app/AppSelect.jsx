'use client'

import { Check, ChevronDown } from 'lucide-react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import { appLayer } from './ui'

const SIZES = { sm: 'h-8 gap-1.5 px-2.5 text-[13px]', md: 'h-10 gap-2 px-3 text-[14px]' }

/**
 * Batkle's own select, in place of the browser's: a field-styled button that opens a menu of options. An option is
 * `{ value, label, description?, icon? }`: the description explains it in the menu (what a role can do) and the icon
 * goes before its label in the menu and on the button (a brand's tile). `id` and a `<label htmlFor>` name it as a
 * select does; `size` is 'md' in forms (40 px) and 'sm' in rows (32 px).
 */
export default function AppSelect({ value, onChange, options, id, label, size = 'md', disabled = false, align = 'start', menuWidth = 300, className = '' }) {
  const current = options.find(option => option.value === value) || options[0]
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          aria-label={label ? `${label}: ${current?.label || ''}` : undefined}
          className={cn(
            'inline-flex min-w-0 items-center rounded-lg border border-bk-field bg-bk-surface font-semibold text-bk-fg outline-none transition-[border-color,box-shadow]',
            'hover:border-bk-fg/50 focus-visible:border-bk-fg focus-visible:shadow-[0_0_0_4px_rgb(255_216_77/0.45)] data-[state=open]:border-bk-fg disabled:cursor-not-allowed disabled:opacity-60',
            SIZES[size] || SIZES.md, className,
          )}
        >
          {current?.icon}
          <span className="min-w-0 flex-1 truncate text-left">{current?.label}</span>
          <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        {/* The menu opens outside the app root, so it brings the app's theme and its own surface. */}
        <Menu.Content
          align={align}
          sideOffset={6}
          collisionPadding={16}
          style={{ width: `min(${menuWidth}px, calc(100vw - 32px))` }}
          className={cn(appLayer, 'z-50 max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto rounded-xl border border-bk-line bg-bk-surface p-1.5 shadow-bk-pop')}
        >
          <Menu.RadioGroup value={current?.value} onValueChange={onChange}>
            {options.map(option => (
              <Menu.RadioItem
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="flex cursor-pointer select-none items-start gap-2.5 rounded-lg px-2.5 py-2 outline-none transition-colors data-[highlighted]:bg-bk-alt data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
              >
                {option.icon && <span className="mt-px shrink-0">{option.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">{option.label}</span>
                  {option.description && <span className="mt-0.5 block text-[12px] leading-snug text-bk-muted">{option.description}</span>}
                </span>
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                  <Menu.ItemIndicator><Check className="size-4" strokeWidth={2.5} /></Menu.ItemIndicator>
                </span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
