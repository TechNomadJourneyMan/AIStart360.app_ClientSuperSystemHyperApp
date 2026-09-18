'use client'

import * as Tooltip from '@radix-ui/react-tooltip'
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Focus,
  GripHorizontal,
  Layers3,
  MessageCircle,
  Sparkles,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { JourneyWidgetView } from './model'
import { WIDGET_META, WidgetRenderer } from './widgets/WidgetRenderer'

interface WidgetModuleProps {
  widget: JourneyWidgetView
  mode?: 'canvas' | 'list'
  scale?: number
  onToggle: (id: string) => void
  onFocus: (id: string) => void
  onHide: (id: string) => void
  onDiscuss: (widget: JourneyWidgetView) => void
  onMove: (id: string, position: { x: number; y: number }) => void
  listDragHandle?: ReactNode
  decisionReason?: string
}

const WIDGET_GRID = 12
const WIDGET_MAX_X = 1_280
const WIDGET_MIN_Y = 80
const WIDGET_MAX_Y = 900

export function WidgetModule({
  widget,
  mode = 'canvas',
  scale = 1,
  onToggle,
  onFocus,
  onHide,
  onDiscuss,
  onMove,
  listDragHandle,
  decisionReason,
}: WidgetModuleProps) {
  const meta = WIDGET_META[widget.kind]
  const Icon = meta.icon
  const drag = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    position: { x: number; y: number }
  } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number } | null>(null)

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (mode !== 'canvas' || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: widget.position.x,
      originY: widget.position.y,
      position: widget.position,
    }
  }

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    const x = drag.current.originX + (event.clientX - drag.current.startX) / scale
    const y = drag.current.originY + (event.clientY - drag.current.startY) / scale
    const position = {
      x: snapWithin(x, 0, WIDGET_MAX_X),
      y: snapWithin(y, WIDGET_MIN_Y, WIDGET_MAX_Y),
    }
    drag.current.position = position
    setDragPreview(position)
  }

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    const position = drag.current.position
    drag.current = null
    setDragPreview(null)
    onMove(widget.id, position)
  }

  const cancelDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setDragPreview(null)
  }

  const displayedPosition = dragPreview ?? widget.position

  return (
    <article
      data-testid="journey-widget"
      data-widget-id={widget.id}
      data-widget-kind={widget.kind}
      data-collapsed={widget.collapsed ? 'true' : 'false'}
      data-focused={widget.focused ? 'true' : 'false'}
      data-dragging={dragPreview ? 'true' : 'false'}
      data-board-interactive={mode === 'canvas' ? '' : undefined}
      className={cn(
        'border bg-surface-container-lowest shadow-card',
        mode === 'canvas' ? 'absolute w-80 rounded-2xl' : 'w-full rounded-2xl',
        widget.focused ? 'border-primary/60' : 'border-white/10',
        dragPreview && 'z-20 border-primary/50 shadow-xl',
      )}
      style={mode === 'canvas' ? { left: displayedPosition.x, top: displayedPosition.y } : undefined}
    >
      <header className="flex min-h-11 items-center gap-2 border-b border-white/5 px-2.5">
        {mode === 'canvas' && (
          <button
            type="button"
            data-testid="widget-drag-handle"
            aria-label={`Переместить модуль: ${widget.title}. Перетащите или используйте стрелки; Shift — крупный шаг.`}
            title="Перетащить · стрелки — точная настройка"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={cancelDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={(event) => {
              const delta = event.shiftKey ? 40 : 12
              if (!event.key.startsWith('Arrow')) return
              event.preventDefault()
              if (event.key === 'ArrowLeft') onMove(widget.id, { ...widget.position, x: Math.max(0, widget.position.x - delta) })
              if (event.key === 'ArrowRight') onMove(widget.id, { ...widget.position, x: Math.min(WIDGET_MAX_X, widget.position.x + delta) })
              if (event.key === 'ArrowUp') onMove(widget.id, { ...widget.position, y: Math.max(WIDGET_MIN_Y, widget.position.y - delta) })
              if (event.key === 'ArrowDown') onMove(widget.id, { ...widget.position, y: Math.min(WIDGET_MAX_Y, widget.position.y + delta) })
            }}
            className="flex size-8 shrink-0 touch-none items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-on-surface cursor-grab active:cursor-grabbing"
          >
            <GripHorizontal className="size-4" aria-hidden />
          </button>
        )}
        {mode === 'list' && listDragHandle}
        <Icon className="size-4 shrink-0 text-primary" aria-hidden />
        <h3 title={widget.title} className="min-w-0 flex-1 truncate text-xs font-semibold text-on-surface">{widget.title}</h3>
        <div className="flex shrink-0 items-center">
          <Tip label={widget.collapsed ? 'Развернуть' : 'Свернуть'}>
            <button
              type="button"
              aria-label={`${widget.collapsed ? 'Развернуть' : 'Свернуть'} модуль: ${widget.title}`}
              onClick={() => onToggle(widget.id)}
              className="flex size-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
            >
              {widget.collapsed ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />}
            </button>
          </Tip>
          <Tip label="Фокусировать">
            <button
              type="button"
              aria-label={`Фокусировать модуль: ${widget.title}`}
              aria-pressed={widget.focused}
              onClick={() => onFocus(widget.id)}
              className={cn(
                'flex size-8 items-center justify-center rounded-lg hover:bg-white/5',
                widget.focused ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface',
              )}
            >
              <Focus className="size-3.5" aria-hidden />
            </button>
          </Tip>
          <Tip label="Обсудить с AI">
            <button
              type="button"
              aria-label={`Обсудить модуль: ${widget.title}`}
              onClick={() => onDiscuss(widget)}
              className="flex size-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-primary"
            >
              <MessageCircle className="size-3.5" aria-hidden />
            </button>
          </Tip>
          <Tip label="Скрыть">
            <button
              type="button"
              aria-label={`Скрыть модуль: ${widget.title}`}
              onClick={() => onHide(widget.id)}
              className="flex size-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-error/10 hover:text-error"
            >
              <EyeOff className="size-3.5" aria-hidden />
            </button>
          </Tip>
        </div>
      </header>
      {!widget.collapsed && (
        <div className="p-4">
          {decisionReason && (
            <div className="mb-3 flex items-start gap-2 border-b border-white/5 pb-3 text-[11px] leading-relaxed text-on-surface-variant">
              <Sparkles className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden />
              <p><span className="font-medium text-on-surface">Почему здесь:</span> {decisionReason}</p>
            </div>
          )}
          <WidgetRenderer widget={widget} />
        </div>
      )}
    </article>
  )
}

export function getWidgetDecisionReason(decisions: unknown, widget: JourneyWidgetView): string | undefined {
  if (!Array.isArray(decisions)) return undefined
  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) continue
    const record = decision as Record<string, unknown>
    if (record.widgetId !== widget.id || record.kind !== widget.kind) continue
    if (typeof record.reason !== 'string') return undefined
    const reason = record.reason.trim()
    return reason ? reason.slice(0, 320) : undefined
  }
  return undefined
}

function snap(value: number): number {
  return Math.round(value / WIDGET_GRID) * WIDGET_GRID
}

function snapWithin(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, snap(value)))
}

interface WidgetDockProps {
  widgets: JourneyWidgetView[]
  onOpen: (id: string) => void
  onFocus: (id: string) => void
  onRestore: (id: string) => void
  className?: string
}

export function WidgetDock({ widgets, onOpen, onFocus, onRestore, className }: WidgetDockProps) {
  const [open, setOpen] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const visible = widgets.filter((widget) => !widget.hidden).sort((a, b) => b.priority - a.priority)
  const hidden = widgets.filter((widget) => widget.hidden).sort((a, b) => b.priority - a.priority)

  if (!widgets.length) return null

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Открыть стек AI-модулей"
        onClick={() => setOpen(true)}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-white/10 bg-surface-container-lowest px-3 py-2.5 text-xs text-on-surface shadow-card hover:border-primary/30 hover:text-primary',
          className,
        )}
      >
        <Layers3 className="size-4 text-primary" aria-hidden />
        Модули
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary tabular-nums">
          {visible.length}
        </span>
      </button>
    )
  }

  return (
    <aside className={cn('w-72 rounded-2xl border border-white/10 bg-surface-container-lowest p-2 shadow-card', className)} aria-label="Стек AI-модулей">
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-2">
          <Layers3 className="size-4 text-primary" aria-hidden />
          <p className="text-xs font-semibold text-on-surface">Модули</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-on-surface-variant tabular-nums">{visible.length}</span>
          <button
            type="button"
            aria-label="Закрыть стек AI-модулей"
            onClick={() => setOpen(false)}
            className="flex size-7 items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
          >
            <ChevronUp className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {visible.slice(0, 8).map((widget) => {
          const meta = WIDGET_META[widget.kind]
          const Icon = meta.icon
          return (
            <div key={widget.id} className="flex items-center rounded-xl hover:bg-white/[0.035]">
              <button
                type="button"
                onClick={() => (widget.collapsed ? onOpen(widget.id) : onFocus(widget.id))}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
              >
                <Icon className="size-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs text-on-surface">{widget.title}</span>
                <span className="text-[10px] text-on-surface-variant">{widget.collapsed ? 'свёрнут' : 'на доске'}</span>
              </button>
            </div>
          )
        })}
      </div>

      {!!hidden.length && (
        <div className="mt-1 border-t border-white/5 pt-1">
          <button
            type="button"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((value) => !value)}
            className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs text-on-surface-variant hover:bg-white/[0.035] hover:text-on-surface"
          >
            <Eye className="size-3.5" aria-hidden />
            Скрытые модули
            <span className="ml-auto tabular-nums">{hidden.length}</span>
          </button>
          {showHidden && (
            <div className="space-y-1 pt-1">
              {hidden.map((widget) => (
                <button
                  key={widget.id}
                  type="button"
                  aria-label={`Вернуть модуль: ${widget.title}`}
                  onClick={() => onRestore(widget.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-on-surface-variant hover:bg-white/[0.035] hover:text-primary"
                >
                  <Eye className="size-3.5" aria-hidden />
                  <span className="truncate">{widget.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="top" sideOffset={6} className="z-50 rounded-lg bg-surface-container-high px-2 py-1 text-[11px] text-on-surface shadow-card">
          {label}
          <Tooltip.Arrow className="fill-surface-container-high" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
