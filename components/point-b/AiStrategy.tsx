'use client'

import type { PointBV2 } from '@/lib/point-b/engine'
import { Card } from './shared'

// Humanize a snake_case / camelCase key into a readable Russian-friendly label.
function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Generic, defensive renderer for the unstructured ai_strategy object. */
function GenericValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null || value === '') {
    return <span className="font-mono text-on-surface-variant/60">—</span>
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-on-surface">{String(value)}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="font-mono text-on-surface-variant/60">—</span>
    // Array of primitives → bullet list. Array of objects → nested blocks.
    const allPrimitive = value.every(
      (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
    )
    if (allPrimitive) {
      return (
        <ul className="space-y-1.5">
          {value.map((v, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-on-surface">
              <span className="material-symbols-outlined text-primary/50 text-base mt-0.5 flex-shrink-0" aria-hidden>
                chevron_right
              </span>
              <span>{String(v)}</span>
            </li>
          ))}
        </ul>
      )
    }
    return (
      <div className="space-y-3">
        {value.map((v, i) => (
          <div key={i} className="rounded-xl border border-white/[0.06] bg-surface-container p-3">
            <GenericValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }

  if (isPlainObject(value)) {
    return (
      <div className={depth > 0 ? 'space-y-3' : 'space-y-4'}>
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest mb-1.5">
              {humanizeKey(k)}
            </p>
            <GenericValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }

  return <span className="font-mono text-on-surface-variant/60">—</span>
}

export function AiStrategy({
  status,
  strategy,
}: {
  status: PointBV2['ai_status']
  strategy: PointBV2['ai_strategy']
}) {
  // Honest disconnected / not-ready states.
  if (status === 'none' || strategy == null) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.08] bg-surface-container-low p-6 text-center">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant/40 mb-2 block" aria-hidden>
          smart_toy
        </span>
        <p className="text-sm font-medium text-on-surface mb-1">AI-стратегия не подключена</p>
        <p className="text-xs text-on-surface-variant">
          Добавьте LLM-ключ, чтобы получить детальную стратегию достижения Точки Б.
        </p>
      </div>
    )
  }

  if (status === 'processing') {
    return (
      <Card className="flex items-center gap-3">
        <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-sm text-on-surface-variant">AI-стратегия генерируется…</p>
      </Card>
    )
  }

  if (status === 'failed') {
    return (
      <div className="rounded-2xl border border-error/20 bg-error/[0.04] p-6 text-center">
        <span className="material-symbols-outlined text-3xl text-error/60 mb-2 block" aria-hidden>
          error
        </span>
        <p className="text-sm font-medium text-on-surface mb-1">Не удалось сгенерировать AI-стратегию</p>
        <p className="text-xs text-on-surface-variant">Попробуйте пересчитать позже.</p>
      </div>
    )
  }

  return (
    <Card>
      <GenericValue value={strategy} />
    </Card>
  )
}
