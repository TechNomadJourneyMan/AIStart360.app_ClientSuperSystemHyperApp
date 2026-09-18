'use client'

import * as Tooltip from '@radix-ui/react-tooltip'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  CircleDot,
  Focus,
  Minus,
  Move,
  Plus,
  RotateCcw,
  Route,
  Target,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { getCurrentConfirmedJourneyGoal } from './JourneyExperience'
import type {
  JourneyFactView,
  JourneySuggestionView,
  JourneyWidgetView,
  JourneyWorkspaceView,
} from './model'
import { SuggestionPills } from './SuggestionPills'
import { getWidgetDecisionReason, WidgetDock, WidgetModule } from './WidgetModule'

const PLANE_WIDTH = 1600
const PLANE_HEIGHT = 1240
// Include the priority widget row in the initial fit. The chat remains a
// compact floating control without covering module content.
const FIT_HEIGHT = 1120
const MIN_ZOOM = 0.42
const MAX_ZOOM = 1.45
const DEFAULT_DOCK_SAFE_BOTTOM = 216
const DOCK_GAP = 16

interface JourneyCanvasProps {
  state: JourneyWorkspaceView
  onWidgetToggle: (id: string) => void
  onWidgetFocus: (id: string) => void
  onWidgetHide: (id: string) => void
  onWidgetRestore: (id: string) => void
  onWidgetMove: (id: string, position: { x: number; y: number }) => void
  onWidgetResetLayout: () => void
  onWidgetDiscuss: (widget: JourneyWidgetView) => void
  onSuggestionAccept: (suggestion: JourneySuggestionView) => void
  onSuggestionReject: (id: string) => void
  onSuggestionHide: (id: string) => void
}

interface Camera {
  x: number
  y: number
  scale: number
}

export function JourneyCanvas(props: JourneyCanvasProps) {
  const {
    state,
    onWidgetToggle,
    onWidgetFocus,
    onWidgetHide,
    onWidgetRestore,
    onWidgetMove,
    onWidgetResetLayout,
    onWidgetDiscuss,
    onSuggestionAccept,
    onSuggestionReject,
    onSuggestionHide,
  } = props
  const viewportRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, scale: 0.72 })
  const [panning, setPanning] = useState(false)
  const panRef = useRef<{ pointerId: number; x: number; y: number; camera: Camera } | null>(null)
  const previousCounts = useRef({ facts: 0, goals: 0, roadmap: 0 })
  const confirmedFacts = state.facts.filter((fact) => fact.status === 'confirmed')
  const activeSuggestions = state.suggestions.filter((item) => item.status === 'active')
  const visibleWidgets = state.widgets.filter((widget) => !widget.hidden)
  const boardWidgets = visibleWidgets.filter((widget) => !widget.collapsed)
  const focusedWidget = visibleWidgets.find((widget) => widget.focused)
  const widgetDecisions = (state as JourneyWorkspaceView & { widgetDecisions?: unknown }).widgetDecisions

  const focusPoint = useCallback((point: { x: number; y: number }, nextScale = 0.88) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const availableHeight = getBoardAvailableHeight(rect)
    const scale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM)
    setCamera({
      x: rect.width / 2 - point.x * scale,
      y: availableHeight / 2 - point.y * scale,
      scale,
    })
  }, [])

  const fitBoard = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const availableHeight = getBoardAvailableHeight(rect)
    const scale = clamp(Math.min((rect.width - 36) / PLANE_WIDTH, (availableHeight - 56) / FIT_HEIGHT), MIN_ZOOM, 0.92)
    setCamera({
      x: (rect.width - PLANE_WIDTH * scale) / 2,
      y: Math.max(28, (availableHeight - FIT_HEIGHT * scale) / 2),
      scale,
    })
  }, [])

  useEffect(() => {
    fitBoard()
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(fitBoard)
    observer.observe(viewport)
    const chatDock = document.querySelector<HTMLElement>('section[aria-label="AI-диалог о бизнесе"]')
    if (chatDock) observer.observe(chatDock)
    return () => observer.disconnect()
  }, [fitBoard])

  useEffect(() => {
    const previous = previousCounts.current
    const next = {
      facts: confirmedFacts.length,
      goals: state.goals.length,
      roadmap: state.roadmap.length,
    }
    if (previous.facts > 0 && next.facts > previous.facts) focusPoint({ x: 260, y: 360 }, 0.9)
    if (previous.goals > 0 && next.goals > previous.goals) focusPoint({ x: 1310, y: 360 }, 0.9)
    if (previous.roadmap > 0 && next.roadmap > previous.roadmap) focusPoint({ x: 800, y: 360 }, 0.82)
    previousCounts.current = next
  }, [confirmedFacts.length, focusPoint, state.goals.length, state.roadmap.length])

  useEffect(() => {
    if (!focusedWidget) return
    focusPoint({ x: focusedWidget.position.x + 160, y: focusedWidget.position.y + 130 }, 0.95)
  }, [focusPoint, focusedWidget])

  const setZoom = (next: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const center = { x: rect.width / 2, y: rect.height / 2 }
    const scale = clamp(next, MIN_ZOOM, MAX_ZOOM)
    const planeX = (center.x - camera.x) / camera.scale
    const planeY = (center.y - camera.y) / camera.scale
    setCamera({ x: center.x - planeX * scale, y: center.y - planeY * scale, scale })
  }

  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('button, a, input, textarea, [data-board-interactive]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      camera,
    }
    setPanning(true)
  }

  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = panRef.current
    if (!start || start.pointerId !== event.pointerId) return
    setCamera({
      ...start.camera,
      x: start.camera.x + event.clientX - start.x,
      y: start.camera.y + event.clientY - start.y,
    })
  }

  const stopPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return
    panRef.current = null
    setPanning(false)
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const scale = clamp(camera.scale * Math.exp(-event.deltaY * 0.001), MIN_ZOOM, MAX_ZOOM)
    const planeX = (cursor.x - camera.x) / camera.scale
    const planeY = (cursor.y - camera.y) / camera.scale
    setCamera({ x: cursor.x - planeX * scale, y: cursor.y - planeY * scale, scale })
  }

  return (
    <Tooltip.Provider>
      <section
        ref={viewportRef}
        aria-label="Доска трансформации бизнеса из Точки A в Точку B"
        className={cn(
          'relative hidden size-full overflow-hidden bg-background md:block',
          panning ? 'cursor-grabbing' : 'cursor-grab',
        )}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
        onWheel={onWheel}
      >
        <DotGrid />

        <motion.div
          className="absolute left-0 top-0"
          animate={{ x: camera.x, y: camera.y, scale: camera.scale }}
          transition={{ duration: reduceMotion || panning ? 0 : 0.18, ease: 'easeOut' }}
          style={{ width: PLANE_WIDTH, height: PLANE_HEIGHT, transformOrigin: '0 0' }}
        >
          <BoardConnections reduceMotion={Boolean(reduceMotion)} hasRoadmap={state.roadmap.length > 0} />

          <PointASection facts={confirmedFacts} onFocus={() => focusPoint({ x: 260, y: 360 }, 0.92)} />
          <RoadmapSection state={state} onFocus={() => focusPoint({ x: 800, y: 360 }, 0.84)} />
          <PointBSection state={state} onFocus={() => focusPoint({ x: 1310, y: 360 }, 0.92)} />

          <ContextSuggestions
            suggestions={activeSuggestions}
            onAccept={onSuggestionAccept}
            onReject={onSuggestionReject}
            onHide={onSuggestionHide}
          />

          {boardWidgets.map((widget) => (
            <WidgetModule
              key={widget.id}
              widget={widget}
              decisionReason={getWidgetDecisionReason(widgetDecisions, widget)}
              scale={camera.scale}
              onToggle={onWidgetToggle}
              onFocus={onWidgetFocus}
              onHide={onWidgetHide}
              onDiscuss={onWidgetDiscuss}
              onMove={onWidgetMove}
            />
          ))}
        </motion.div>

        <BoardToolbar
          scale={camera.scale}
          onZoomOut={() => setZoom(camera.scale - 0.12)}
          onZoomIn={() => setZoom(camera.scale + 0.12)}
          onFit={fitBoard}
          onResetLayout={onWidgetResetLayout}
        />

        <WidgetDock
          widgets={state.widgets}
          onOpen={onWidgetToggle}
          onFocus={onWidgetFocus}
          onRestore={onWidgetRestore}
          className="absolute right-4 top-20 z-30 max-h-[calc(100%-15rem)] overflow-y-auto"
        />

        <div className="pointer-events-none absolute bottom-5 left-5 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-surface-container-lowest px-3 py-2 text-[11px] text-on-surface-variant shadow-card">
          <Move className="size-3.5" aria-hidden />
          Тяните фон · колесо меняет масштаб
        </div>
      </section>
    </Tooltip.Provider>
  )
}

export function JourneyMobileBoard({ state }: { state: JourneyWorkspaceView }) {
  const confirmed = state.facts.filter((fact) => fact.status === 'confirmed')
  const currentGoal = getCurrentConfirmedJourneyGoal(state)
  return (
    <div data-testid="journey-mobile-board" className="h-full space-y-3 overflow-y-auto px-3 pb-28 pt-3 md:hidden">
      <MobilePointCard testId="point-a" eyebrow="Точка A · сейчас" title={state.companyName || 'Ваш бизнес'}>
        {confirmed.length ? <FactList facts={confirmed} /> : <EmptyCopy>Расскажите о бизнесе и подтвердите первые факты.</EmptyCopy>}
      </MobilePointCard>

      <div className="flex items-center justify-center gap-2 py-1 text-xs text-on-surface-variant">
        <ArrowRight className="size-4 text-primary" aria-hidden />
        <span>{state.roadmap.length ? `${state.roadmap.length} этапа трансформации` : 'Путь формируется в диалоге'}</span>
      </div>

      <MobilePointCard testId="journey-roadmap" eyebrow="Путь" title="Пробелы, приоритеты, действия">
        {state.roadmap.length ? <RoadmapList items={state.roadmap} /> : <EmptyCopy>Сначала нужна подтверждённая Точка A и измеримая цель.</EmptyCopy>}
      </MobilePointCard>

      <MobilePointCard testId="point-b" eyebrow="Точка B · цель" title={currentGoal?.metric || 'Желаемый результат'} accent>
        {currentGoal ? (
          <div>
            <p className="text-sm font-medium text-on-surface">{currentGoal.title}</p>
            {(currentGoal.metric || currentGoal.target || currentGoal.deadline) && (
              <p className="mt-1 text-xs text-primary tabular-nums">
                {[currentGoal.metric, currentGoal.target, currentGoal.deadline].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        ) : (
          <EmptyCopy>Назовите, что должно измениться, до какого значения и к какому сроку.</EmptyCopy>
        )}
      </MobilePointCard>
    </div>
  )
}

function PointASection({ facts, onFocus }: { facts: JourneyFactView[]; onFocus: () => void }) {
  return (
    <section
      data-testid="point-a"
      data-board-interactive
      className="absolute left-20 top-56 w-[360px] rounded-3xl border border-white/10 bg-surface-container-lowest p-5 shadow-card"
    >
      <SectionHeader icon={CircleDot} eyebrow="Точка A · сейчас" title="Подтверждённая реальность" onFocus={onFocus} />
      <div className="mt-4">
        {facts.length ? <FactList facts={facts} /> : <EmptyCopy>Здесь появятся только факты, которые вы подтвердили.</EmptyCopy>}
      </div>
      <div className="mt-4 border-t border-white/5 pt-3 text-[11px] text-on-surface-variant">
        {facts.length ? `${facts.length} подтверждённых фактов` : 'Начните с одного сообщения о компании'}
      </div>
    </section>
  )
}

function RoadmapSection({ state, onFocus }: { state: JourneyWorkspaceView; onFocus: () => void }) {
  const next = state.roadmap.find((item) => item.status === 'next')
  return (
    <section
      data-testid="journey-roadmap"
      data-board-interactive
      className="absolute left-[535px] top-48 w-[530px] rounded-3xl border border-white/10 bg-surface-container-lowest p-5 shadow-card"
    >
      <SectionHeader icon={Route} eyebrow="Путь A → B" title="Пробелы, приоритеты, зависимости" onFocus={onFocus} />
      <div className="mt-4">
        {state.roadmap.length ? <RoadmapList items={state.roadmap} /> : <EmptyCopy>Путь появится после подтверждения Точки A и цели.</EmptyCopy>}
      </div>
      {next && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-xs text-primary">
          <Target className="size-3.5 shrink-0" aria-hidden />
          Следующее: <span className="truncate font-medium">{next.title}</span>
        </div>
      )}
    </section>
  )
}

function PointBSection({ state, onFocus }: { state: JourneyWorkspaceView; onFocus: () => void }) {
  const currentGoal = getCurrentConfirmedJourneyGoal(state)
  return (
    <section
      data-testid="point-b"
      data-board-interactive
      className="absolute left-[1160px] top-56 w-[360px] rounded-3xl border border-primary/30 bg-surface-container-lowest p-5 shadow-card"
    >
      <SectionHeader icon={Target} eyebrow="Точка B · цель" title={currentGoal?.metric || 'Измеримый результат'} onFocus={onFocus} accent />
      <div className="mt-4 space-y-3">
        {currentGoal ? (
          <div className="border-b border-white/5 pb-3 last:border-0 last:pb-0">
            <p className="text-sm text-pretty font-medium text-on-surface">{currentGoal.title}</p>
            {(currentGoal.metric || currentGoal.target || currentGoal.deadline) && (
              <p className="mt-1.5 text-xs text-primary tabular-nums">
                {[currentGoal.metric, currentGoal.target, currentGoal.deadline].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        ) : (
          <EmptyCopy>Опишите желаемый результат, значение метрики и срок.</EmptyCopy>
        )}
      </div>
    </section>
  )
}

function FactList({ facts }: { facts: JourneyFactView[] }) {
  return (
    <dl className="space-y-2.5">
      {facts.slice(0, 7).map((fact) => (
        <div key={fact.id} className="flex items-start justify-between gap-4">
          <dt className="min-w-0 text-xs text-on-surface-variant">{fact.label}</dt>
          <dd title={fact.value} className="max-w-[62%] text-right text-xs font-medium text-on-surface line-clamp-3">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function RoadmapList({ items }: { items: JourneyWorkspaceView['roadmap'] }) {
  const titles = new Map(items.map((item) => [item.id, item.title]))
  return (
    <ol className="space-y-3">
      {items.slice(0, 5).map((item, index) => (
        <li key={item.id} className="flex items-start gap-3">
          <span className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
            item.status === 'done'
              ? 'bg-primary text-on-primary'
              : item.status === 'next'
                ? 'border border-primary/40 bg-primary/10 text-primary'
                : 'border border-white/10 bg-white/[0.025] text-on-surface-variant',
          )}>
            {item.status === 'done' ? <Check className="size-3.5" aria-hidden /> : index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium text-on-surface">{item.title}</p>
              <span className="shrink-0 text-[10px] text-on-surface-variant">{item.horizon}</span>
            </div>
            {item.description && <p title={item.description} className="mt-1 text-[11px] text-pretty text-on-surface-variant md:line-clamp-2">{item.description}</p>}
            {!!item.dependsOn?.length && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-on-surface-variant">
                После: {item.dependsOn.slice(0, 2).map((id) => titles.get(id) ?? id).join(', ')}
              </p>
            )}
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full bg-primary" style={{ width: `${item.progress}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function SectionHeader({
  icon: Icon,
  eyebrow,
  title,
  onFocus,
  accent = false,
}: {
  icon: typeof Target
  eyebrow: string
  title: string
  onFocus: () => void
  accent?: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', accent ? 'bg-primary text-on-primary' : 'bg-white/5 text-primary')}>
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-on-surface-variant">{eyebrow}</p>
        <h2 className="mt-0.5 text-balance text-base font-semibold text-on-surface">{title}</h2>
      </div>
      <button
        type="button"
        aria-label={`Фокусировать область: ${eyebrow}`}
        title="Фокусировать"
        onClick={onFocus}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
      >
        <Focus className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

function ContextSuggestions({
  suggestions,
  onAccept,
  onReject,
  onHide,
}: {
  suggestions: JourneySuggestionView[]
  onAccept: (suggestion: JourneySuggestionView) => void
  onReject: (id: string) => void
  onHide: (id: string) => void
}) {
  const groups = useMemo(() => ({
    pointA: suggestions.filter((item) => item.target === 'point-a' || item.target === 'chat'),
    roadmap: suggestions.filter((item) => item.target === 'roadmap' || item.target === 'widget'),
    pointB: suggestions.filter((item) => item.target === 'point-b'),
  }), [suggestions])

  return (
    <>
      <SuggestionPills suggestions={groups.pointA} onAccept={onAccept} onReject={onReject} onHide={onHide} className="absolute left-24 top-40" />
      <SuggestionPills suggestions={groups.roadmap} onAccept={onAccept} onReject={onReject} onHide={onHide} className="absolute left-[590px] top-32" />
      <SuggestionPills suggestions={groups.pointB} onAccept={onAccept} onReject={onReject} onHide={onHide} className="absolute left-[1160px] top-40" />
    </>
  )
}

function BoardConnections({ reduceMotion, hasRoadmap }: { reduceMotion: boolean; hasRoadmap: boolean }) {
  return (
    <svg className="pointer-events-none absolute inset-0" width={PLANE_WIDTH} height={PLANE_HEIGHT} aria-hidden>
      <defs>
        <marker id="journey-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#6effc0" opacity="0.7" />
        </marker>
      </defs>
      <motion.path
        d="M 440 380 C 485 380, 495 340, 535 340"
        fill="none"
        stroke="#6effc0"
        strokeOpacity={hasRoadmap ? 0.55 : 0.18}
        strokeWidth="2"
        strokeDasharray={hasRoadmap ? undefined : '7 8'}
        markerEnd="url(#journey-arrow)"
        initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
      />
      <motion.path
        d="M 1065 340 C 1100 340, 1115 380, 1160 380"
        fill="none"
        stroke="#6effc0"
        strokeOpacity={hasRoadmap ? 0.55 : 0.18}
        strokeWidth="2"
        strokeDasharray={hasRoadmap ? undefined : '7 8'}
        markerEnd="url(#journey-arrow)"
        initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut', delay: reduceMotion ? 0 : 0.04 }}
      />
    </svg>
  )
}

function BoardToolbar({
  scale,
  onZoomOut,
  onZoomIn,
  onFit,
  onResetLayout,
}: {
  scale: number
  onZoomOut: () => void
  onZoomIn: () => void
  onFit: () => void
  onResetLayout: () => void
}) {
  return (
    <div className="absolute left-4 top-20 z-30 flex items-center rounded-xl border border-white/10 bg-surface-container-lowest p-1 shadow-card">
      <ToolbarButton label="Уменьшить" onClick={onZoomOut}><Minus className="size-4" aria-hidden /></ToolbarButton>
      <span className="w-12 text-center text-[10px] text-on-surface-variant tabular-nums">{Math.round(scale * 100)}%</span>
      <ToolbarButton label="Увеличить" onClick={onZoomIn}><Plus className="size-4" aria-hidden /></ToolbarButton>
      <span className="mx-1 h-5 w-px bg-white/10" />
      <ToolbarButton label="Показать всю доску" onClick={onFit}><Focus className="size-4" aria-hidden /></ToolbarButton>
      <ToolbarButton label="Сбросить расположение модулей" onClick={onResetLayout}><RotateCcw className="size-4" aria-hidden /></ToolbarButton>
    </div>
  )
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>
        <button type="button" aria-label={label} onClick={onClick} className="flex size-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-on-surface">
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="bottom" sideOffset={6} className="z-50 rounded-lg bg-surface-container-high px-2 py-1 text-[11px] text-on-surface shadow-card">
          {label}
          <Tooltip.Arrow className="fill-surface-container-high" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

function DotGrid() {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
      <defs>
        <pattern id="journey-dot-grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="#84958a" opacity="0.16" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#journey-dot-grid)" />
    </svg>
  )
}

function EmptyCopy({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-pretty text-on-surface-variant">{children}</p>
}

function MobilePointCard({
  testId,
  eyebrow,
  title,
  accent = false,
  children,
}: {
  testId: string
  eyebrow: string
  title: string
  accent?: boolean
  children: React.ReactNode
}) {
  return (
    <section data-testid={testId} className={cn('rounded-2xl border bg-surface-container-lowest p-4', accent ? 'border-primary/30' : 'border-white/10')}>
      <p className="text-[10px] text-on-surface-variant">{eyebrow}</p>
      <h2 className="mt-1 text-balance text-base font-semibold text-on-surface">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getBoardAvailableHeight(viewportRect: DOMRect): number {
  const chatDock = document.querySelector<HTMLElement>('section[aria-label="AI-диалог о бизнесе"]')
  const dockRect = chatDock?.getBoundingClientRect()
  const measuredInset = dockRect && dockRect.top < viewportRect.bottom
    ? viewportRect.bottom - dockRect.top + DOCK_GAP
    : 0
  const bottomInset = Math.max(DEFAULT_DOCK_SAFE_BOTTOM, measuredInset)
  return Math.max(280, viewportRect.height - bottomInset)
}
