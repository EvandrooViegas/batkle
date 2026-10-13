"use client";
import { Check, Info, Loader2, X } from "lucide-react"
import { Toaster as Sonner } from "sonner"

import { batkleFonts } from "@/lib/batkleFonts"
import { cn } from "@/lib/utils"

/**
 * The tilted tile beside a message, stamped down when the toast arrives: butter for done,
 * coral for failed, orange for heads-up, a quiet tile for info.
 */
function Stamp({ className = "", children }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 -rotate-6 place-items-center rounded-[10px] shadow-[inset_0_-2px_0_rgb(0_0_0/0.14)] motion-safe:animate-[bk-stamp_0.45s_cubic-bezier(0.2,0.8,0.2,1)_both]",
        className
      )}
    >
      {children}
    </span>
  )
}

const icons = {
  success: <Stamp className="bg-[#FFD84D] text-[#14131A]"><Check className="size-[18px]" strokeWidth={3} /></Stamp>,
  error: <Stamp className="bg-[#E5533D] text-white"><X className="size-[18px]" strokeWidth={3} /></Stamp>,
  warning: <Stamp className="bg-[#F28C28] text-[#14131A]"><span className="font-bk-display text-[18px] font-extrabold leading-none">!</span></Stamp>,
  info: <Stamp className="bg-bk-bg/10 text-bk-bg"><Info className="size-[18px]" strokeWidth={2.5} /></Stamp>,
  loading: <Stamp className="bg-bk-bg/10 text-[#FFD84D] dark:text-[#14131A]"><Loader2 className="size-[18px] animate-spin" strokeWidth={2.75} /></Stamp>,
  close: <X className="size-3.5" strokeWidth={2.5} />,
}

/**
 * Batkle toasts: an ink ticket (cream in dark mode) with a stamped status tile, a display-font
 * title and a butter action pill. Sonner keeps the stacking, swipe and timing; every visual is
 * ours, so it runs unstyled and always on its light theme (its dark rules would restyle the
 * close button). The bk tokens come from `.bk-toaster`, which flips with `.dark` like `.bk-root`.
 */
const Toaster = ({ className, toastOptions, ...props }) => (
  <Sonner
    theme="light"
    closeButton
    gap={10}
    className={cn("bk-toaster", batkleFonts, className)}
    style={{ "--width": "372px" }}
    icons={icons}
    toastOptions={{
      unstyled: true,
      ...toastOptions,
      classNames: {
        toast: cn(
          "group/toast flex w-full items-center gap-3 rounded-[18px] bg-bk-fg py-2.5 pl-4 pr-11 font-bk-body text-bk-bg antialiased",
          "shadow-[0_1px_2px_rgb(0_0_0/0.12),0_22px_44px_-20px_rgb(20_19_26/0.6)] has-[[data-icon]]:pl-2.5",
          // Toasts tucked behind the front one show only a lighter edge, so the stack reads as cards.
          "[&[data-expanded=false][data-front=false]>*]:opacity-0 [&[data-expanded=false][data-front=false]]:bg-[color:color-mix(in_srgb,rgb(var(--bk-fg))_78%,rgb(var(--bk-bg)))]"
        ),
        // Sized so sonner's absolutely centred loader wrapper lands on the tile.
        icon: "relative flex size-8 shrink-0 items-center justify-center",
        content: "flex min-w-0 flex-1 flex-col gap-0.5 py-0.5",
        title: "font-bk-display text-[14px] font-medium leading-snug tracking-[-0.01em]",
        description: "text-[12.5px] leading-snug text-bk-bg/65",
        actionButton:
          "inline-flex h-8 shrink-0 items-center rounded-full bg-[#FFD84D] px-3.5 text-[12.5px] font-bold text-[#14131A] shadow-[inset_0_-1.5px_0_rgb(0_0_0/0.14)] transition hover:bg-[#FFE27A] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD84D] focus-visible:ring-offset-2 focus-visible:ring-offset-bk-fg",
        cancelButton:
          "inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[12.5px] font-semibold text-bk-bg/70 transition hover:bg-bk-bg/10 hover:text-bk-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bk-bg/30",
        closeButton:
          "absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-bk-bg/45 transition hover:bg-bk-bg/10 hover:text-bk-bg focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bk-bg/30 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/toast:opacity-100",
        ...toastOptions?.classNames,
      },
    }}
    {...props}
  />
)

export { Toaster }
