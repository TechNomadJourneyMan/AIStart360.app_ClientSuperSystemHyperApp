'use client'

/**
 * market-api — общий слой доступа к рыночным данным для зоны «Рынок».
 *
 * Всё, что рисует MarketDataPanel и CompetitorDetailModal, приходит ТОЛЬКО
 * отсюда — через authed-proxy /api/market/* (FastAPI Mark-analytics).
 * Никаких выдуманных чисел: 503 «не настроен» → 'not_configured',
 * 503 «не отвечает» → 'unavailable', пустой ответ → 'empty'.
 *
 * Кэш живёт на уровне модуля, поэтому сворачивание/раскрытие блока чек-листа
 * (перемонтирование панели) больше не бьёт по сети. `reload()` кэш сбрасывает.
 *
 * Названия полей соответствуют реальной схеме Mark-analytics
 * (Mark-analytics/frontend/src/types/api.ts): AnalyticsOverview,
 * IndustryDistributionItem, CompanyListItem, CompanyDetail. Все денежные поля
 * контракта названы `*_usd`, поэтому доллар в подписи — не догадка.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Result / state shapes ────────────────────────────────────────────────────

/**
 * 'not_configured' — внешний каталог не подключён к кабинету (повтор не поможет);
 * 'unavailable'    — подключён, но не ответил (повтор имеет смысл);
 * 'empty'          — ответил, но полезных строк нет.
 */
export type MarketFailureKind = 'not_configured' | 'unavailable' | 'empty'

export type MarketFetchResult =
  | { ok: true; payload: unknown }
  | { ok: false; kind: MarketFailureKind }

export type PanelState<T> =
  | { status: 'loading' }
  | { status: 'not_configured' }
  | { status: 'unavailable' }
  | { status: 'empty' }
  | { status: 'ready'; data: T }

// ── Low-level fetch ──────────────────────────────────────────────────────────

export async function fetchMarket(path: string): Promise<MarketFetchResult> {
  try {
    const res = await fetch(`/api/market/${path}`, { cache: 'no-store' })
    if (res.status === 503) {
      // The proxy distinguishes «не настроен» from «не отвечает» via the error
      // code — keep that difference, the user-facing texts are not the same.
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null
      const code = typeof body?.error === 'string' ? body.error : ''
      return {
        ok: false,
        kind: code === 'market_api_not_configured' ? 'not_configured' : 'unavailable',
      }
    }
    if (!res.ok) return { ok: false, kind: 'empty' }
    const payload = (await res.json().catch(() => null)) as unknown
    return { ok: true, payload }
  } catch {
    return { ok: false, kind: 'unavailable' }
  }
}

// ── Module-level cache (survives panel unmount/remount) ──────────────────────

const CACHE_TTL_MS = 120_000

interface CacheEntry {
  at: number
  result: MarketFetchResult
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<MarketFetchResult>>()

function readCache(path: string): CacheEntry | null {
  const hit = cache.get(path)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) return null
  return hit
}

export async function loadMarket(path: string, force = false): Promise<MarketFetchResult> {
  if (!force) {
    const hit = readCache(path)
    if (hit) return hit.result
    const pending = inflight.get(path)
    if (pending) return pending
  }
  const promise = fetchMarket(path).then((result) => {
    cache.set(path, { at: Date.now(), result })
    inflight.delete(path)
    return result
  })
  inflight.set(path, promise)
  return promise
}

/** Drops a cached endpoint (used by «Обновить»). */
export function invalidateMarket(path: string): void {
  cache.delete(path)
  inflight.delete(path)
}

// ── React binding ────────────────────────────────────────────────────────────

export interface MarketResource<T> {
  state: PanelState<T>
  /** Epoch ms of the payload currently on screen (null while first load runs). */
  fetchedAt: number | null
  reload: () => void
  reloading: boolean
}

/**
 * Subscribes a component to one proxied endpoint.
 * `map` converts the raw payload into the view model; returning `null` means
 * «ответ пришёл, но полезных строк в нём нет» → status 'empty'.
 * `map` is read through a ref, so it may be an inline arrow without thrashing.
 */
export function useMarketResource<T>(
  path: string | null,
  map: (payload: unknown) => T | null,
): MarketResource<T> {
  const [state, setState] = useState<PanelState<T>>({ status: 'loading' })
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [reloading, setReloading] = useState(false)
  const aliveRef = useRef(true)
  const mapRef = useRef(map)
  mapRef.current = map

  const apply = useCallback((result: MarketFetchResult, at: number) => {
    if (!aliveRef.current) return
    setFetchedAt(at)
    if (!result.ok) {
      setState({ status: result.kind })
      return
    }
    const mapped = mapRef.current(result.payload)
    setState(mapped == null ? { status: 'empty' } : { status: 'ready', data: mapped })
  }, [])

  useEffect(() => {
    aliveRef.current = true
    if (!path) {
      setState({ status: 'empty' })
      return () => {
        aliveRef.current = false
      }
    }
    const cached = readCache(path)
    if (cached) {
      apply(cached.result, cached.at)
    } else {
      setState({ status: 'loading' })
      void loadMarket(path, false).then((r) => apply(r, Date.now()))
    }
    return () => {
      aliveRef.current = false
    }
  }, [path, apply])

  const reload = useCallback(() => {
    if (!path) return
    setReloading(true)
    invalidateMarket(path)
    void loadMarket(path, true).then((r) => {
      apply(r, Date.now())
      if (aliveRef.current) setReloading(false)
    })
  }, [path, apply])

  return { state, fetchedAt, reload, reloading }
}

// ── Payload helpers (defensive: upstream envelope is { data, meta, errors }) ──

export function unwrap(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: unknown }).data
  }
  return payload
}

export function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') {
    for (const k of ['items', 'results', 'companies', 'rows', 'list']) {
      const inner = (v as Record<string, unknown>)[k]
      if (Array.isArray(inner)) return inner
    }
  }
  return []
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const cleaned = v.replace(/\s/g, '').replace(/[^0-9.\-]/g, '')
    if (!cleaned || cleaned === '-' || cleaned === '.') return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function pick(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const rec = obj as Record<string, unknown>
  for (const k of keys) if (k in rec) return rec[k]
  return undefined
}

/** `industry` arrives as a nested { code, label } ref on CompanyListItem. */
export function industryLabel(item: unknown): string | null {
  const direct = str(pick(item, ['industry_label', 'industry_name']))
  if (direct) return direct
  const ref = pick(item, ['industry'])
  if (typeof ref === 'string') return str(ref)
  const label = str(pick(ref, ['label', 'name']))
  if (label) return label
  return str(pick(ref, ['code'])) ?? str(pick(item, ['industry_code']))
}

/** «Алматы, Алматинская обл.» — из region_name / city_name, без выдумок. */
export function placeLabel(item: unknown): string | null {
  const city = str(pick(item, ['city_name']))
  const region = str(pick(item, ['region_name']))
  if (city && region && city !== region) return `${city}, ${region}`
  return city ?? region
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Все денежные поля контракта Mark-analytics названы `revenue_usd` /
 * `revenue_total_usd` / `capitalization_usd`, то есть валюта задана источником.
 * Функцию применяем ТОЛЬКО к ним — иначе подпись «$» была бы выдумкой.
 */
export function formatUsd(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)} млрд`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)} млн`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)} тыс`
  return `$${v.toFixed(0)}`
}

export function formatInt(v: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(v))
}

/** «обновлено 14:32» — короткая метка времени под шапкой панели. */
export function formatClock(ts: number | null): string {
  if (ts == null) return ''
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** ISO-дата из каталога → «12.03.2019»; мусор → null (не показываем). */
export function formatDate(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const t = Date.parse(s)
  if (!Number.isFinite(t)) return null
  return new Date(t).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
