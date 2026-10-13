'use client'

import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ChevronsDown, ChevronsUp, ChevronDown, ChevronUp,
  Clipboard, Copy, CopyPlus, Crop, Eye, EyeOff, Group, Image as ImageIcon, Lock, Maximize2, MousePointerSquareDashed, Scissors,
  Trash2, Type, Ungroup, Unlock,
} from 'lucide-react'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { appLayer } from '@/components/app/ui'
import { cn } from '@/lib/utils'

const item = 'gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold focus:bg-bk-alt focus:text-bk-fg data-[state=open]:bg-bk-alt [&_svg]:size-4 [&_svg]:shrink-0'
const danger = 'text-[#C2412F] focus:bg-[#C2412F]/10 focus:text-[#C2412F] dark:text-[#F0826F] dark:focus:text-[#F0826F]'
const content = cn(appLayer, 'w-60 rounded-xl border-bk-line bg-bk-surface p-1.5 text-bk-fg shadow-bk-pop')

/** "Ctrl+" on Windows and Linux, "⌘" on a Mac. */
export function modKey() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+'
}

function Keys({ children }) {
  return <span className="ml-auto pl-4 text-[11.5px] font-medium tabular-nums text-bk-muted">{children}</span>
}

function Item({ icon: Icon, label, keys, onSelect, disabled, tone }) {
  return (
    <ContextMenuItem className={cn(item, tone === 'danger' && danger)} disabled={disabled} onSelect={onSelect}>
      <Icon aria-hidden="true" />{label}{keys && <Keys>{keys}</Keys>}
    </ContextMenuItem>
  )
}

const ALIGN = [
  ['left', 'Left', AlignStartVertical],
  ['center', 'Centre', AlignCenterVertical],
  ['right', 'Right', AlignEndVertical],
  ['top', 'Top', AlignStartHorizontal],
  ['middle', 'Middle', AlignCenterHorizontal],
  ['bottom', 'Bottom', AlignEndHorizontal],
]

/**
 * Right-click menu for the canvas and the layers list. `onOpen` runs first with the event, so the layer under
 * the pointer can be selected before the menu reads `sel`.
 */
export function LayerMenu({ children, onOpen, sel, actions, disabled }) {
  const mod = modKey()
  const shift = mod === '⌘' ? '⇧' : 'Shift+'
  const many = sel.count > 1
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild disabled={disabled} onContextMenu={onOpen}>{children}</ContextMenuTrigger>
      <ContextMenuContent className={content} onCloseAutoFocus={e => e.preventDefault()}>
        {sel.count === 0 ? (
          <>
            <Item icon={Clipboard} label="Paste" keys={`${mod}V`} disabled={!sel.canPaste} onSelect={actions.paste} />
            <Item icon={MousePointerSquareDashed} label="Select all" keys={`${mod}A`} onSelect={actions.selectAll} />
            <ContextMenuSeparator className="bg-bk-line" />
            <Item icon={Type} label="Add text" keys="T" onSelect={actions.addText} />
            <Item icon={ImageIcon} label="Add image" keys="I" onSelect={actions.addImage} />
            <ContextMenuSeparator className="bg-bk-line" />
            <Item icon={Maximize2} label="Zoom to fit" keys={`${shift}1`} onSelect={actions.fit} />
          </>
        ) : (
          <>
            <Item icon={Scissors} label="Cut" keys={`${mod}X`} onSelect={actions.cut} />
            <Item icon={Copy} label="Copy" keys={`${mod}C`} onSelect={actions.copy} />
            <Item icon={Clipboard} label="Paste" keys={`${mod}V`} disabled={!sel.canPaste} onSelect={actions.paste} />
            <Item icon={CopyPlus} label="Duplicate" keys={`${mod}D`} onSelect={actions.duplicate} />
            {sel.single?.type === 'text' && <Item icon={Type} label="Edit text" keys="Enter" disabled={sel.allLocked} onSelect={actions.editText} />}
            {sel.single?.type === 'image' && <Item icon={Crop} label="Crop" keys="Enter" disabled={sel.allLocked} onSelect={actions.crop} />}
            <ContextMenuSeparator className="bg-bk-line" />
            <Item icon={ChevronsUp} label="Bring to front" keys={`${mod}${shift}]`} onSelect={() => actions.arrange('front')} />
            <Item icon={ChevronUp} label="Bring forward" keys={`${mod}]`} onSelect={() => actions.arrange('forward')} />
            <Item icon={ChevronDown} label="Send backward" keys={`${mod}[`} onSelect={() => actions.arrange('backward')} />
            <Item icon={ChevronsDown} label="Send to back" keys={`${mod}${shift}[`} onSelect={() => actions.arrange('back')} />
            <ContextMenuSeparator className="bg-bk-line" />
            <ContextMenuSub>
              <ContextMenuSubTrigger className={item}><AlignCenterVertical aria-hidden="true" />{many ? 'Align layers' : 'Align to slide'}</ContextMenuSubTrigger>
              <ContextMenuSubContent className={cn(content, 'w-52')}>
                {ALIGN.map(([edge, label, Icon]) => <Item key={edge} icon={Icon} label={label} onSelect={() => actions.align(edge)} />)}
                {many && (
                  <>
                    <ContextMenuSeparator className="bg-bk-line" />
                    <Item icon={AlignHorizontalDistributeCenter} label="Space evenly across" disabled={sel.count < 3} onSelect={() => actions.distribute('x')} />
                    <Item icon={AlignVerticalDistributeCenter} label="Space evenly down" disabled={sel.count < 3} onSelect={() => actions.distribute('y')} />
                  </>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
            {many && <Item icon={Group} label="Group" keys={`${mod}G`} onSelect={actions.group} />}
            {sel.inGroup && <Item icon={Ungroup} label="Ungroup" keys={`${mod}${shift}G`} onSelect={actions.ungroup} />}
            <ContextMenuSeparator className="bg-bk-line" />
            <Item icon={sel.allHidden ? Eye : EyeOff} label={sel.allHidden ? 'Show' : 'Hide'} keys={`${mod}${shift}H`} onSelect={actions.toggleHidden} />
            <Item icon={sel.allLocked ? Unlock : Lock} label={sel.allLocked ? 'Unlock' : 'Lock'} keys={`${mod}${shift}L`} onSelect={actions.toggleLocked} />
            <ContextMenuSeparator className="bg-bk-line" />
            <Item icon={Trash2} label={many ? `Delete ${sel.count} layers` : 'Delete'} keys="Del" tone="danger" onSelect={actions.remove} />
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
