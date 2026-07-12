'use client'

// Miro-style A → B growth map.
//
// Left cluster = Point A (facts extracted from chat + parsed documents).
// Right cluster = Point B (targets stated by the user or proposed by AI).
// Between them: a curved path with milestones. Nodes are draggable in a
// future iteration; today they're positioned by the mock data. Everything
// animates in with Framer Motion so the map feels alive as new facts land.

import { motion } from 'framer-motion'
import { useRef, useState } from 'react'
import type { JourneyMilestone, JourneyNode, JourneyState } from '@/lib/journey/state'

interface Props {
  state: JourneyState
}

export function JourneyCanvas({ state }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [zoom, setZoom]         = useState(1)

  // Path from Point A anchor → Point B anchor. Slight bezier curve so it
  // feels like a journey not a straight line.
  const pathD = 'M 22 50 C 40 20, 60 80, 78 50'

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full rounded-2xl border border-white/[0.05] bg-[radial-gradient(circle_at_50%_50%,rgba(110,255,192,0.03)_0%,transparent_60%)] overflow-hidden"
      style={{ background: 'radial-gradient(circle at 50% 50%, rgba(110,255,192,0.04) 0%, transparent 55%), #0a0d13' }}
    >
      {/* Grid dots */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.035)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Top toolbar */}
      <div className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-surface-container/80 backdrop-blur border border-white/[0.06] px-3 py-2">
          <span className="material-symbols-outlined text-primary text-sm">map</span>
          <p className="text-xs font-semibold text-on-surface">Карта роста</p>
          <span className="text-[10px] text-on-surface-variant/60 font-mono ml-2">
            {state.companyName || 'без имени'} · {state.industry || '—'}
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-1 rounded-xl bg-surface-container/80 backdrop-blur border border-white/[0.06] p-1">
          <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))} className="w-7 h-7 rounded-lg hover:bg-white/[0.06] flex items-center justify-center text-on-surface-variant">
            <span className="material-symbols-outlined text-sm">remove</span>
          </button>
          <span className="text-[10px] font-mono text-on-surface-variant w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom((z) => Math.min(1.5, z + 0.15))} className="w-7 h-7 rounded-lg hover:bg-white/[0.06] flex items-center justify-center text-on-surface-variant">
            <span className="material-symbols-outlined text-sm">add</span>
          </button>
          <div className="w-px h-4 bg-white/[0.08] mx-1" />
          <button onClick={() => setZoom(1)} className="w-7 h-7 rounded-lg hover:bg-white/[0.06] flex items-center justify-center text-on-surface-variant" title="Сброс">
            <span className="material-symbols-outlined text-sm">recenter</span>
          </button>
        </div>
      </div>

      {/* Zoomable content plane */}
      <motion.div
        className="absolute inset-0"
        animate={{ scale: zoom }}
        transition={{ type: 'spring', stiffness: 180, damping: 24 }}
        style={{ transformOrigin: '50% 50%' }}
      >

        {/* Column labels */}
        <div className="absolute top-6 left-[10%] text-[10px] font-mono uppercase tracking-[0.25em] text-on-surface-variant/60">
          Точка А · сейчас
        </div>
        <div className="absolute top-6 right-[10%] text-[10px] font-mono uppercase tracking-[0.25em] text-primary/70">
          Точка Б · цель 12 мес
        </div>

        {/* Journey path */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="pathGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"  stopColor="#94a3b8" stopOpacity="0.35" />
              <stop offset="50%" stopColor="#6effc0" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#6effc0" stopOpacity="1" />
            </linearGradient>
          </defs>
          <motion.path
            d={pathD}
            fill="none"
            stroke="url(#pathGrad)"
            strokeWidth="0.4"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.6, ease: 'easeInOut' }}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Point A nodes */}
        {state.pointA.map((n, i) => (
          <Node
            key={n.id}
            node={n}
            selected={selected === n.id}
            onSelect={() => setSelected((s) => (s === n.id ? null : n.id))}
            delay={0.1 + i * 0.08}
            side="a"
          />
        ))}

        {/* Point B nodes */}
        {state.pointB.map((n, i) => (
          <Node
            key={n.id}
            node={n}
            selected={selected === n.id}
            onSelect={() => setSelected((s) => (s === n.id ? null : n.id))}
            delay={0.6 + i * 0.08}
            side="b"
          />
        ))}

        {/* Milestones along the path */}
        <MilestonesPath milestones={state.milestones} />
      </motion.div>

      {/* Legend footer */}
      <div className="absolute bottom-3 left-4 right-4 z-30 flex items-center justify-between text-[10px] font-mono text-on-surface-variant/60">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary" /> ok</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-tertiary-container" /> weak</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-error" /> critical</span>
        </div>
        <span>{state.pointA.length} узлов А · {state.pointB.length} узлов Б · {state.milestones.length} вех</span>
      </div>
    </div>
  )
}

// ─── Node ──────────────────────────────────────────────────────────────

function Node({
  node, selected, onSelect, delay, side,
}: {
  node: JourneyNode
  selected: boolean
  onSelect: () => void
  delay: number
  side: 'a' | 'b'
}) {
  const accent =
    node.status === 'critical' ? 'border-error/50 shadow-error/10'
    : node.status === 'weak'   ? 'border-tertiary-container/40 shadow-tertiary-container/10'
                               : 'border-primary/40 shadow-primary/10'

  const bg = side === 'a' ? 'bg-surface-container/85' : 'bg-primary/8'

  return (
    <motion.button
      layout
      initial={{ opacity: 0, scale: 0.75, y: 20 }}
      animate={{ opacity: 1, scale: selected ? 1.05 : 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 220, damping: 22 }}
      onClick={onSelect}
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl border ${accent} ${bg} backdrop-blur-sm px-4 py-3 text-left shadow-xl min-w-[170px] max-w-[240px] hover:z-20`}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full ${side === 'a' ? 'bg-on-surface-variant' : 'bg-primary'}`} />
        <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
          {node.label}
        </p>
      </div>
      <div className="space-y-1">
        {node.facts.map((f) => (
          <div key={f.k} className="flex justify-between gap-2 text-xs">
            <span className="text-on-surface-variant/70 truncate">{f.k}</span>
            <span className="font-mono font-semibold text-on-surface">{f.v}</span>
          </div>
        ))}
      </div>
    </motion.button>
  )
}

// ─── Milestones ────────────────────────────────────────────────────────

function MilestonesPath({ milestones }: { milestones: JourneyMilestone[] }) {
  // Coordinates along the same bezier used above. Simple approx by t.
  const anchor = (t: number) => {
    // Cubic bezier: M 22 50 C 40 20, 60 80, 78 50
    const p0 = { x: 22, y: 50 }
    const p1 = { x: 40, y: 20 }
    const p2 = { x: 60, y: 80 }
    const p3 = { x: 78, y: 50 }
    const x =
      Math.pow(1 - t, 3) * p0.x +
      3 * Math.pow(1 - t, 2) * t * p1.x +
      3 * (1 - t) * t * t * p2.x +
      t * t * t * p3.x
    const y =
      Math.pow(1 - t, 3) * p0.y +
      3 * Math.pow(1 - t, 2) * t * p1.y +
      3 * (1 - t) * t * t * p2.y +
      t * t * t * p3.y
    return { x, y }
  }

  return (
    <>
      {milestones.map((m, i) => {
        const p = anchor(m.t)
        return (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1.2 + i * 0.15, type: 'spring', stiffness: 300, damping: 20 }}
            className="absolute -translate-x-1/2 -translate-y-1/2 group"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            <button
              className={`relative w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${
                m.active
                  ? 'bg-primary border-primary text-on-primary shadow-lg shadow-primary/40 animate-pulse'
                  : m.done
                    ? 'bg-primary/20 border-primary/50 text-primary'
                    : 'bg-surface-container border-white/[0.15] text-on-surface-variant hover:border-primary/40'
              }`}
              title={`${m.label} — ${m.description}`}
            >
              {m.done ? (
                <span className="material-symbols-outlined text-sm">check</span>
              ) : (
                <span className="text-[10px] font-mono font-bold">{m.label.replace(/\D+/g, '') || i + 1}</span>
              )}
            </button>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-30 w-56 bg-surface-container/95 backdrop-blur border border-white/[0.08] rounded-xl p-3 shadow-2xl">
              <p className="text-xs font-bold text-on-surface">{m.label}</p>
              <p className="text-[11px] text-on-surface-variant leading-snug mt-1">{m.description}</p>
              {m.metric && (
                <p className="text-[10px] font-mono text-primary mt-2">
                  {m.metric.name}: {m.metric.from} → {m.metric.to}
                </p>
              )}
            </div>
          </motion.div>
        )
      })}
    </>
  )
}
