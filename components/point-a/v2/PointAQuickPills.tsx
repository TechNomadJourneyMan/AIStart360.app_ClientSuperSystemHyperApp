'use client'

/**
 * PointAQuickPills — sticky-bottom quick navigation for /point-a.
 *
 * Pills (left → right):
 *   1. "Данные (NN%)"        → anchor #company-data    (amber <80, primary ≥80)
 *   2. "Снимок · Точка А"    → anchor #growth-snapshot (neutral)
 *   3. "5 Потерь"            → anchor #loss-map        (error ≥3, amber otherwise)
 *   4. "GRI · 7 блоков"      → window event 'aistart360:open-gri' (primary, disabled if no GRI)
 *   5. "Карта роста · 90 дней" → anchor #growth-map    (primary, fallback /point-b)
 *
 * UX details:
 *   • Fixed bottom-center with backdrop-blur surface.
 *   • IntersectionObserver scroll-spy highlights the active pill.
 *   • Tooltip on hover above each pill.
 *   • Mobile (< sm): horizontal scroll-snap row.
 *   • Hidden below 380px (avoids overlap with content).
 *
 * NOTE for orchestrator: the GRI pill dispatches a global
 *   `window` CustomEvent named 'aistart360:open-gri'. The
 *   GrowthSnapshotHero must subscribe to this event and call its
 *   internal `setGriModalOpen(true)`. That bridge is NOT wired here —
 *   leave the orchestrator wiring to a follow-up. (TODO bridge)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

// ─── Types ──────────────────────────────────────────────────────────────────

type PillVariant = 'primary' | 'neutral' | 'warning' | 'danger' | 'disabled'

interface PillSpec {
  id: string
  /** Either an anchor section id (without leading '#') or null for non-anchor pills. */
  anchorId: string | null
  /** Hash href (preferred) — when set, the pill is an <a>. */
  hashHref?: string
  /** Optional Next link href (e.g. fallback /point-b). */
  linkHref?: string
  /** Click handler — used by the GRI pill. */
  onClick?: () => void
  icon: string
  label: string
  tooltip: string
  variant: PillVariant
  disabled?: boolean
}

interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
}

interface OnboardingStatus {
  survey?: { percent?: number }
}

interface LossMapResponse {
  buckets?: Array<{ loss_kzt_per_year?: number }>
}

interface GriAssessmentResponse {
  current?: { gri_index?: number } | null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function variantClasses(variant: PillVariant, isActive: boolean): string {
  const base = 'border transition-colors duration-150'
  if (variant === 'disabled') {
    return `${base} border-white/[0.04] bg-surface-container/60 text-on-surface-variant/50 cursor-not-allowed`
  }
  const activeRing = isActive
    ? 'bg-primary/15 border-primary/40'
    : 'bg-surface-container/70 border-white/[0.06] hover:bg-surface-container-high/80'
  const text =
    variant === 'primary'
      ? 'text-primary'
      : variant === 'warning'
        ? 'text-amber-400'
        : variant === 'danger'
          ? 'text-error'
          : 'text-on-surface'
  return `${base} ${activeRing} ${text}`
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function PointAQuickPills() {
  const [surveyPercent, setSurveyPercent] = useState<number>(0)
  const [lossCount, setLossCount] = useState<number>(5) // sane default per brief
  const [hasGri, setHasGri] = useState<boolean>(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const mountedRef = useRef(true)

  // ─── Data fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    const fetchAll = async () => {
      try {
        const [statusRes, lossRes, griRes] = await Promise.all([
          fetch('/api/v1/onboarding/status', { credentials: 'include' }).catch(() => null),
          fetch('/api/v1/point-a/loss-map', { credentials: 'include' }).catch(() => null),
          fetch('/api/v1/gri/assessment', { credentials: 'include' }).catch(() => null),
        ])

        if (!mountedRef.current) return

        if (statusRes && statusRes.ok) {
          const j = (await statusRes.json()) as ApiResult<{ survey: OnboardingStatus['survey'] }>
          if (j?.ok && typeof j.data?.survey?.percent === 'number') {
            setSurveyPercent(Math.max(0, Math.min(100, j.data.survey.percent)))
          }
        }

        if (lossRes && lossRes.ok) {
          const j = (await lossRes.json()) as ApiResult<LossMapResponse>
          const buckets = j?.data?.buckets ?? []
          const active = buckets.filter((b) => (b.loss_kzt_per_year ?? 0) > 0).length
          // Pill label says "5 Потерь" — show full catalogue size when empty,
          // but use the active count for the danger/warning colour.
          setLossCount(active)
        }

        if (griRes && griRes.ok) {
          const j = (await griRes.json()) as ApiResult<GriAssessmentResponse>
          setHasGri(Boolean(j?.ok && j.data?.current && typeof j.data.current.gri_index === 'number'))
        }
      } catch {
        // Silent — pills render with defaults.
      }
    }
    void fetchAll()
    return () => {
      mountedRef.current = false
    }
  }, [])

  // ─── Pill definitions ─────────────────────────────────────────────────────
  const pills: PillSpec[] = useMemo(() => {
    const dataVariant: PillVariant = surveyPercent >= 80 ? 'primary' : 'warning'
    const lossVariant: PillVariant = lossCount >= 3 ? 'danger' : 'warning'

    return [
      {
        id: 'company-data',
        anchorId: 'company-data',
        hashHref: '#company-data',
        icon: 'database',
        label: `Данные (${surveyPercent}%)`,
        tooltip: 'Полнота анкеты компании и загруженных документов',
        variant: dataVariant,
      },
      {
        id: 'growth-snapshot',
        anchorId: 'growth-snapshot',
        hashHref: '#growth-snapshot',
        icon: 'insights',
        label: 'Снимок · Точка А',
        tooltip: 'Текущее состояние бизнеса и приоритетные сигналы',
        variant: 'neutral',
      },
      {
        id: 'loss-map',
        anchorId: 'loss-map',
        hashHref: '#loss-map',
        icon: 'warning',
        label: '5 Потерь',
        tooltip: 'Карта потерь выручки — где утекают деньги',
        variant: lossVariant,
      },
      {
        id: 'gri',
        anchorId: null,
        onClick: () => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aistart360:open-gri'))
          }
        },
        icon: 'donut_small',
        label: 'GRI · 7 блоков',
        tooltip: hasGri
          ? 'Открыть результаты GRI-диагностики'
          : 'Пройдите GRI-диагностику, чтобы открыть',
        variant: hasGri ? 'primary' : 'disabled',
        disabled: !hasGri,
      },
      {
        id: 'growth-map',
        anchorId: 'growth-map',
        hashHref: '#growth-map',
        linkHref: '/point-b',
        icon: 'route',
        label: 'Карта роста · 90 дней',
        tooltip: 'Карта роста на 90 дней и Точка Б',
        variant: 'primary',
      },
    ]
  }, [surveyPercent, lossCount, hasGri])

  // ─── Scroll-spy via IntersectionObserver ──────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const anchorIds = pills.map((p) => p.anchorId).filter((x): x is string => Boolean(x))
    const targets: HTMLElement[] = []
    for (const id of anchorIds) {
      const el = document.getElementById(id)
      if (el) targets.push(el)
    }
    if (targets.length === 0) return

    const visibility = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibility.set(entry.target.id, entry.intersectionRatio)
        }
        // Active = section with the largest visible ratio (above some threshold).
        let topId: string | null = null
        let topRatio = 0
        for (const [id, ratio] of visibility) {
          if (ratio > topRatio) {
            topRatio = ratio
            topId = id
          }
        }
        setActiveId(topRatio > 0.15 ? topId : null)
      },
      {
        // Slightly offset the bottom so the sticky bar doesn't mask sections.
        rootMargin: '-20% 0px -25% 0px',
        threshold: [0, 0.15, 0.35, 0.6, 0.9],
      },
    )
    for (const el of targets) observer.observe(el)
    return () => observer.disconnect()
  }, [pills])

  // ─── Smooth scroll on anchor click ────────────────────────────────────────
  const handleAnchorClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, anchorId: string | null) => {
      if (!anchorId) return
      if (typeof document === 'undefined') return
      const el = document.getElementById(anchorId)
      if (!el) return
      e.preventDefault()
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Update hash without jumping.
      try {
        history.replaceState(null, '', `#${anchorId}`)
      } catch {
        /* ignore */
      }
    },
    [],
  )

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="
        fixed bottom-4 left-1/2 -translate-x-1/2 z-40
        max-[379px]:hidden
        w-[min(100%-1rem,52rem)]
        pointer-events-none
      "
      role="navigation"
      aria-label="Быстрая навигация по Точке А"
    >
      <div
        className="
          pointer-events-auto
          flex items-center gap-1.5
          rounded-full
          bg-surface/85 backdrop-blur-xl
          border border-white/[0.06]
          shadow-card
          px-1.5 py-1.5
          overflow-x-auto sm:overflow-visible
          snap-x snap-mandatory sm:snap-none
          [-ms-overflow-style:none] [scrollbar-width:none]
          [&::-webkit-scrollbar]:hidden
        "
      >
        {pills.map((p) => {
          const isActive = activeId !== null && activeId === p.anchorId
          const isHovered = hovered === p.id
          const cls = `
            relative shrink-0 snap-start
            inline-flex items-center gap-1.5
            rounded-full px-3 py-1.5
            text-xs font-mono uppercase tracking-[0.08em]
            focus:outline-none focus:ring-2 focus:ring-primary/40
            ${variantClasses(p.variant, isActive)}
          `

          const inner = (
            <>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14, lineHeight: 1 }}
                aria-hidden="true"
              >
                {p.icon}
              </span>
              <span className="whitespace-nowrap">{p.label}</span>

              {/* Tooltip */}
              {isHovered && !p.disabled ? (
                <span
                  role="tooltip"
                  className="
                    absolute -top-9 left-1/2 -translate-x-1/2
                    whitespace-nowrap
                    rounded-lg
                    bg-surface-container-highest
                    border border-white/10
                    px-2 py-1
                    text-[10px] font-mono tracking-normal normal-case
                    text-on-surface
                    shadow-modal
                    pointer-events-none
                  "
                >
                  {p.tooltip}
                </span>
              ) : null}
            </>
          )

          const commonHandlers = {
            onMouseEnter: () => setHovered(p.id),
            onMouseLeave: () => setHovered((cur) => (cur === p.id ? null : cur)),
            onFocus: () => setHovered(p.id),
            onBlur: () => setHovered((cur) => (cur === p.id ? null : cur)),
            'aria-current': isActive ? ('true' as const) : undefined,
            'aria-label': p.tooltip,
            title: p.tooltip,
          }

          // Disabled (e.g. no GRI yet) → render a non-interactive button.
          if (p.disabled) {
            return (
              <button
                key={p.id}
                type="button"
                disabled
                className={cls}
                {...commonHandlers}
              >
                {inner}
              </button>
            )
          }

          // GRI pill (custom click).
          if (p.onClick) {
            return (
              <button
                key={p.id}
                type="button"
                onClick={p.onClick}
                className={cls}
                {...commonHandlers}
              >
                {inner}
              </button>
            )
          }

          // Anchor pill with smooth scroll. If the section is missing on the
          // page AND a fallback linkHref is provided, fall back to next/link.
          if (p.hashHref) {
            return (
              <a
                key={p.id}
                href={p.hashHref}
                onClick={(e) => {
                  if (!p.anchorId) return
                  const exists =
                    typeof document !== 'undefined' &&
                    !!document.getElementById(p.anchorId)
                  if (exists) {
                    handleAnchorClick(e, p.anchorId)
                  } else if (p.linkHref) {
                    // Let Next handle navigation to the fallback page.
                    e.preventDefault()
                    if (typeof window !== 'undefined') {
                      window.location.assign(p.linkHref)
                    }
                  }
                }}
                className={cls}
                {...commonHandlers}
              >
                {inner}
              </a>
            )
          }

          // Plain Next link (e.g. when no anchor at all).
          if (p.linkHref) {
            return (
              <Link
                key={p.id}
                href={p.linkHref}
                className={cls}
                {...commonHandlers}
              >
                {inner}
              </Link>
            )
          }

          return null
        })}
      </div>
    </div>
  )
}
