'use client'

/**
 * CompetitorDetailModal — карточка конкурента из блока E чек-листа.
 *
 * Открывается кликом по строке в списке «Доли по выручке · топ-5» и тянет
 * `GET /api/market/companies/<id>` (прокси → Mark-analytics, схема CompanyDetail).
 *
 * ЧЕСТНОСТЬ: рисуем только те поля, которые реально пришли. Ничего не
 * достраиваем и не показываем «0» вместо отсутствующего значения — поле,
 * которого нет в ответе, просто не появляется, а внизу карточки написано,
 * сколько полей каталог не отдал.
 */

import { useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  asArray,
  formatDate,
  formatInt,
  formatUsd,
  industryLabel,
  num,
  pick,
  placeLabel,
  str,
  unwrap,
  useMarketResource,
} from './market-api'

// ── View model (mirrors CompanyDetail, only what we render) ──────────────────

interface Fact {
  label: string
  value: string
}

interface InsightCard {
  severity: 'ok' | 'info' | 'warn' | 'danger'
  title: string
  body: string
}

interface SimilarRow {
  id: string | null
  name: string
  revenueUsd: number | null
}

interface TimelineRow {
  at: string
  label: string
}

interface CompetitorDetail {
  name: string
  bin: string | null
  status: string | null
  industry: string | null
  place: string | null
  description: string | null
  website: string | null
  facts: Fact[]
  insights: InsightCard[]
  similar: SimilarRow[]
  timeline: TimelineRow[]
  /** Сколько ключевых полей карточки каталог не отдал — показываем честно. */
  missing: string[]
}

const SEVERITY_STYLE: Record<InsightCard['severity'], { color: string; bg: string; border: string; icon: string }> = {
  ok: { color: '#6effc0', bg: 'rgba(110,255,192,0.08)', border: 'rgba(110,255,192,0.30)', icon: 'check_circle' },
  info: { color: '#7dd3fc', bg: 'rgba(125,211,252,0.08)', border: 'rgba(125,211,252,0.30)', icon: 'info' },
  warn: { color: '#fcd34d', bg: 'rgba(252,211,77,0.08)', border: 'rgba(252,211,77,0.30)', icon: 'warning' },
  danger: { color: '#fca5a5', bg: 'rgba(252,165,165,0.08)', border: 'rgba(252,165,165,0.30)', icon: 'error' },
}

function severityOf(v: unknown): InsightCard['severity'] {
  const s = str(v)
  if (s === 'ok' || s === 'warn' || s === 'danger') return s
  return 'info'
}

function mapDetail(payload: unknown): CompetitorDetail | null {
  const d = unwrap(payload)
  if (!d || typeof d !== 'object') return null

  const name = str(pick(d, ['name', 'company_name', 'title']))
  if (!name) return null

  // Key facts: only fields the catalog actually returned.
  const facts: Fact[] = []
  const missing: string[] = []

  const revenue = num(pick(d, ['revenue_usd']))
  if (revenue != null) facts.push({ label: 'Выручка', value: formatUsd(revenue) })
  else missing.push('выручка')

  const employees = num(pick(d, ['employee_count']))
  if (employees != null) facts.push({ label: 'Сотрудников', value: formatInt(employees) })
  else missing.push('сотрудники')

  const registered = formatDate(pick(d, ['registered_at']))
  if (registered) facts.push({ label: 'Регистрация', value: registered })
  else missing.push('дата регистрации')

  const size = str(pick(d, ['size_category']))
  if (size) facts.push({ label: 'Размер', value: size })

  const legalForm = str(pick(d, ['legal_form']))
  if (legalForm) facts.push({ label: 'Форма', value: legalForm })

  const capitalization = num(pick(d, ['capitalization_usd']))
  if (capitalization != null) facts.push({ label: 'Капитализация', value: formatUsd(capitalization) })

  const updated = formatDate(pick(d, ['updated_at']))
  if (updated) facts.push({ label: 'Обновлено в каталоге', value: updated })

  // Rule-based insight cards (backend computes them, no AI involved).
  const insights: InsightCard[] = asArray(pick(d, ['insights']))
    .map((item) => {
      const title = str(pick(item, ['title']))
      const body = str(pick(item, ['body']))
      return title ? { severity: severityOf(pick(item, ['severity'])), title, body: body ?? '' } : null
    })
    .filter((x): x is InsightCard => x != null)
    .slice(0, 6)

  const similar: SimilarRow[] = asArray(pick(d, ['similar']))
    .map((item) => {
      const n = str(pick(item, ['name']))
      return n
        ? { id: str(pick(item, ['id'])), name: n, revenueUsd: num(pick(item, ['revenue_usd'])) }
        : null
    })
    .filter((x): x is SimilarRow => x != null)
    .slice(0, 5)

  const timeline: TimelineRow[] = asArray(pick(d, ['timeline_events']))
    .map((item) => {
      const label = str(pick(item, ['label']))
      const at = formatDate(pick(item, ['at']))
      return label && at ? { at, label } : null
    })
    .filter((x): x is TimelineRow => x != null)
    .slice(0, 6)

  return {
    name,
    bin: str(pick(d, ['bin'])),
    status: str(pick(d, ['status'])),
    industry: industryLabel(d),
    place: placeLabel(d),
    description: str(pick(d, ['description'])),
    website: str(pick(d, ['website'])),
    facts,
    insights,
    similar,
    timeline,
    missing,
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function CompetitorDetailModal({
  companyId,
  fallbackName,
  onClose,
  onOpenCompany,
}: {
  companyId: string
  /** Имя из списка — показываем в заголовке, пока грузится детальная карточка. */
  fallbackName: string
  onClose: () => void
  /** Переход к похожей компании внутри той же модалки. */
  onOpenCompany?: (id: string, name: string) => void
}) {
  const path = useMemo(
    () => `companies/${encodeURIComponent(companyId)}`,
    [companyId],
  )
  const { state, reload, reloading } = useMarketResource<CompetitorDetail>(path, mapDetail)

  const title = state.status === 'ready' ? state.data.name : fallbackName

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      {state.status === 'loading' && (
        <div className="space-y-3" aria-hidden="true">
          <div className="h-5 w-1/2 rounded bg-surface-container animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-surface-container animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {state.status === 'not_configured' && (
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Внешний каталог компаний не подключён к кабинету, поэтому карточку конкурента показать
          неоткуда. Данные о конкурентах можно внести вручную в вопросах блока E.
        </p>
      )}

      {state.status === 'unavailable' && (
        <div className="space-y-3">
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Каталог компаний не ответил. Данные не потеряны — попробуйте ещё раз.
          </p>
          <button
            type="button"
            onClick={reload}
            disabled={reloading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-on-surface text-xs font-medium hover:border-primary/30 hover:text-primary transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">
              refresh
            </span>
            {reloading ? 'Обновляем…' : 'Повторить'}
          </button>
        </div>
      )}

      {state.status === 'empty' && (
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Каталог не вернул карточку по этой компании — записи нет или она скрыта.
        </p>
      )}

      {state.status === 'ready' && (
        <DetailBody data={state.data} onOpenCompany={onOpenCompany} />
      )}
    </Modal>
  )
}

function DetailBody({
  data,
  onOpenCompany,
}: {
  data: CompetitorDetail
  onOpenCompany?: (id: string, name: string) => void
}) {
  const chips = [data.industry, data.place, data.status].filter((v): v is string => !!v)

  return (
    <div className="space-y-5">
      {/* Идентификация */}
      <div className="space-y-2">
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span
                key={c}
                className="inline-flex items-center px-2 py-0.5 rounded-md border border-white/[0.08] bg-surface-container text-[10px] font-mono uppercase tracking-wide text-on-surface-variant"
              >
                {c}
              </span>
            ))}
          </div>
        )}
        {data.bin && (
          <p className="text-xs font-mono text-on-surface-variant/70 tabular-nums">
            БИН {data.bin}
          </p>
        )}
        {data.description && (
          <p className="text-sm text-on-surface-variant leading-relaxed">{data.description}</p>
        )}
        {data.website && (
          <a
            href={data.website.startsWith('http') ? data.website : `https://${data.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">
              open_in_new
            </span>
            {data.website}
          </a>
        )}
      </div>

      {/* Факты */}
      {data.facts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {data.facts.map((f) => (
            <div key={f.label} className="rounded-lg bg-surface-container px-3 py-2 border border-white/[0.04]">
              <p className="text-[9px] font-mono uppercase tracking-wider text-on-surface-variant">
                {f.label}
              </p>
              <p className="text-sm font-mono font-bold text-on-surface tabular-nums mt-0.5 break-words">
                {f.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Наблюдения каталога (rule-based, не AI) */}
      {data.insights.length > 0 && (
        <section>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/70 mb-2">
            Наблюдения каталога
          </p>
          <ul className="space-y-2">
            {data.insights.map((ins) => {
              const s = SEVERITY_STYLE[ins.severity]
              return (
                <li
                  key={ins.title}
                  className="rounded-lg border px-3 py-2 flex items-start gap-2"
                  style={{ borderColor: s.border, background: s.bg }}
                >
                  <span
                    className="material-symbols-outlined text-sm mt-0.5"
                    style={{ color: s.color }}
                    aria-hidden="true"
                  >
                    {s.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-on-surface">{ins.title}</p>
                    {ins.body && (
                      <p className="text-xs text-on-surface-variant leading-relaxed mt-0.5">
                        {ins.body}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Таймлайн */}
      {data.timeline.length > 0 && (
        <section>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/70 mb-2">
            Изменения в каталоге
          </p>
          <ul className="space-y-1">
            {data.timeline.map((t) => (
              <li key={`${t.at}-${t.label}`} className="flex items-baseline gap-2 text-xs">
                <span className="font-mono tabular-nums text-on-surface-variant/70 shrink-0">
                  {t.at}
                </span>
                <span className="text-on-surface-variant">{t.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Похожие компании */}
      {data.similar.length > 0 && (
        <section>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/70 mb-2">
            Похожие компании
          </p>
          <ul className="space-y-1">
            {data.similar.map((s) => (
              <li key={`${s.id ?? s.name}`}>
                {s.id && onOpenCompany ? (
                  <button
                    type="button"
                    onClick={() => onOpenCompany(s.id as string, s.name)}
                    aria-label={`Открыть карточку компании ${s.name}`}
                    className="w-full flex items-center gap-2 text-xs text-left rounded-lg px-2 py-1.5 hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                  >
                    <span className="text-on-surface truncate flex-1">{s.name}</span>
                    {s.revenueUsd != null && (
                      <span className="font-mono tabular-nums text-on-surface-variant shrink-0">
                        {formatUsd(s.revenueUsd)}
                      </span>
                    )}
                    <span className="material-symbols-outlined text-sm text-on-surface-variant/60" aria-hidden="true">
                      chevron_right
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2 text-xs px-2 py-1.5">
                    <span className="text-on-surface truncate flex-1">{s.name}</span>
                    {s.revenueUsd != null && (
                      <span className="font-mono tabular-nums text-on-surface-variant shrink-0">
                        {formatUsd(s.revenueUsd)}
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Что каталог не отдал — честно, вместо прочерков */}
      {data.missing.length > 0 && (
        <p className="text-[11px] text-on-surface-variant/60 leading-relaxed border-t border-white/[0.06] pt-3">
          Каталог не передал: {data.missing.join(', ')}. Эти поля не показаны, чтобы не выдавать
          пропуск за ноль.
        </p>
      )}
    </div>
  )
}
