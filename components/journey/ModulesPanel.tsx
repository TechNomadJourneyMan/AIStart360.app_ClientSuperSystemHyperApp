'use client'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Eye, GripVertical, Layers3 } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import type { JourneyWidgetView } from './model'
import { getWidgetDecisionReason, WidgetModule } from './WidgetModule'

interface ModulesPanelProps {
  widgets: JourneyWidgetView[]
  widgetOrder?: string[]
  widgetDecisions?: unknown
  onToggle: (id: string) => void
  onFocus: (id: string) => void
  onHide: (id: string) => void
  onRestore: (id: string) => void
  onDiscuss: (widget: JourneyWidgetView) => void
  onReorder: (activeId: string, overId: string) => void
}

export function ModulesPanel({
  widgets,
  widgetOrder = [],
  widgetDecisions,
  onToggle,
  onFocus,
  onHide,
  onRestore,
  onDiscuss,
  onReorder,
}: ModulesPanelProps) {
  const [announcement, setAnnouncement] = useState('')
  const order = new Map(widgetOrder.map((id, index) => [id, index]))
  const byUserOrder = (a: JourneyWidgetView, b: JourneyWidgetView) => {
    const aIndex = order.get(a.id)
    const bIndex = order.get(b.id)
    if (aIndex !== undefined || bIndex !== undefined) {
      if (aIndex === undefined) return 1
      if (bIndex === undefined) return -1
      return aIndex - bIndex
    }
    return b.priority - a.priority
  }
  const visible = widgets.filter((widget) => !widget.hidden).sort(byUserOrder)
  const hidden = widgets.filter((widget) => widget.hidden).sort(byUserOrder)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const finishReorder = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const moved = visible.find((widget) => widget.id === active.id)
    onReorder(String(active.id), String(over.id))
    if (moved) setAnnouncement(`Модуль «${moved.title}» перемещён. Новый порядок сохранён.`)
  }

  return (
    <div className="h-full overflow-y-auto px-3 pb-28 pt-4">
      <div className="mb-4 flex items-start gap-3 px-1">
        <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Layers3 className="size-4" aria-hidden />
        </div>
        <div>
          <h2 className="text-balance text-base font-semibold text-on-surface">AI-модули вашего бизнеса</h2>
          <p className="mt-1 text-xs text-pretty text-on-surface-variant">Показываются только релевантные текущему контексту.</p>
        </div>
      </div>

      {visible.length ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finishReorder}>
          <SortableContext items={visible.map((widget) => widget.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {visible.map((widget) => (
                <SortableWidget
                  key={widget.id}
                  widget={widget}
                  decisionReason={getWidgetDecisionReason(widgetDecisions, widget)}
                  onToggle={onToggle}
                  onFocus={onFocus}
                  onHide={onHide}
                  onDiscuss={onDiscuss}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center">
          <Layers3 className="mx-auto size-6 text-on-surface-variant" aria-hidden />
          <p className="mt-3 text-sm text-on-surface">Пока нет активных модулей</p>
          <p className="mt-1 text-xs text-pretty text-on-surface-variant">Расскажите о бизнесе в чате — AI выберет первый безопасный модуль.</p>
        </div>
      )}

      <p className="sr-only" aria-live="polite">{announcement}</p>

      {!!hidden.length && (
        <section className="mt-5 border-t border-white/5 pt-4" aria-label="Скрытые модули">
          <p className="mb-2 px-1 text-xs font-semibold text-on-surface-variant">Скрытые</p>
          <div className="space-y-1">
            {hidden.map((widget) => (
              <button
                key={widget.id}
                type="button"
                aria-label={`Вернуть модуль: ${widget.title}`}
                onClick={() => onRestore(widget.id)}
                className="flex w-full items-center gap-2 rounded-xl border border-white/5 px-3 py-2.5 text-left text-xs text-on-surface-variant hover:bg-white/[0.035] hover:text-primary"
              >
                <Eye className="size-3.5" aria-hidden />
                <span className="truncate">{widget.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function SortableWidget({
  widget,
  decisionReason,
  onToggle,
  onFocus,
  onHide,
  onDiscuss,
}: {
  widget: JourneyWidgetView
  decisionReason?: string
  onToggle: (id: string) => void
  onFocus: (id: string) => void
  onHide: (id: string) => void
  onDiscuss: (widget: JourneyWidgetView) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.82 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} data-sorting={isDragging ? 'true' : 'false'} className="relative">
      <WidgetModule
        widget={widget}
        decisionReason={decisionReason}
        mode="list"
        onToggle={onToggle}
        onFocus={onFocus}
        onHide={onHide}
        onDiscuss={onDiscuss}
        onMove={() => {}}
        listDragHandle={(
          <button
            ref={setActivatorNodeRef}
            type="button"
            data-testid="widget-sort-handle"
            {...attributes}
            {...listeners}
            aria-label={`Изменить порядок модуля: ${widget.title}. Нажмите пробел и используйте стрелки.`}
            title="Удерживайте и перетащите"
            className="flex size-8 shrink-0 touch-none items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-on-surface cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
      />
    </div>
  )
}
