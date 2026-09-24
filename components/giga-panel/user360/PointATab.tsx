'use client'

import { Badge, EmptyState, ErrorState, Panel, Skeleton, StatTile, fmtDate, fmtDateTime, useGigaQuery, type Tone } from '../kit'

/**
 * Точка А клиента — то же, что клиент видит на своей странице: общий балл,
 * 5 блоков, риски, инсайты, быстрые победы, дорожная карта, разбор ИИ.
 * Данные — `diagnostics` и текущий `gri_assessments`; пустых мест не
 * заполняем выдуманными значениями.
 */

interface Item { title: string; text: string | null; tag: string | null }
interface Block { id: string; label: string; score: number | null; status: string | null; topIssues: string[]; recommendations: string[] }
interface PointAData {
  diagnostic: null | {
    id: string; overallScore: number | null; healthIndex: number | null; stage: string | null; calculatedAt: string | null; aiStatus: string | null
    blocks: Block[]; risks: Item[]; insights: Item[]; quickWins: Item[]; dataGaps: Item[]
    summary: string | null; priorities: Item[]
    roadmap: Array<{ key: '30_days' | '90_days' | '180_days'; goals: string[]; actions: string[] }>
    industryContext: string | null
  }
  history: Array<{ id: string; overallScore: number | null; healthIndex: number | null; calculatedAt: string }>
  gri: null | { id: string; index: number; sectionAvgs: Record<string, number>; top5: Item[]; assessedAt: string }
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  critical: { label: 'критично', tone: 'red' },
  weak: { label: 'слабо', tone: 'red' },
  average: { label: 'средне', tone: 'amber' },
  strong: { label: 'сильно', tone: 'green' },
  excellent: { label: 'отлично', tone: 'green' },
}
const STAGE: Record<string, string> = { seed: 'Старт', early: 'Ранняя', growth: 'Рост', scale: 'Масштаб', mature: 'Зрелость' }
const ROADMAP: Record<string, string> = { '30_days': '30 дней', '90_days': '90 дней', '180_days': '180 дней' }

const round = (n: number | null) => (n == null ? '—' : String(Math.round(n)))

function Items({ items, empty }: { items: Item[]; empty: string }) {
  if (!items.length) return <p className="text-xs text-slate-600">{empty}</p>
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="text-xs text-slate-300">
          <span className="font-medium text-slate-200">{it.title}</span>
          {it.tag && <Badge className="ml-2" tone={it.tag === 'critical' || it.tag === 'high' ? 'red' : 'neutral'}>{it.tag}</Badge>}
          {it.text && <p className="mt-0.5 text-slate-500">{it.text}</p>}
        </li>
      ))}
    </ul>
  )
}

export function PointATab({ userId }: { userId: string }) {
  const { data, error, loading, reload } = useGigaQuery<{ data: PointAData }>(`/api/giga-admin/users/${userId}/point-a`)
  const d = data?.data

  if (loading && !d) return <Skeleton className="h-64" />
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!d) return null

  const diag = d.diagnostic
  const prev = d.history[1] ?? null
  const delta = diag?.overallScore != null && prev?.overallScore != null ? Math.round(diag.overallScore) - Math.round(prev.overallScore) : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Точка А" value={round(diag?.overallScore ?? null)} hint={diag?.calculatedAt ? `рассчитана ${fmtDate(diag.calculatedAt)}${delta != null ? ` · ${delta > 0 ? '+' : ''}${delta} к прошлому` : ''}` : 'не рассчитана'} tone="green" />
        <StatTile label="Индекс здоровья" value={round(diag?.healthIndex ?? null)} hint={diag?.stage ? `стадия: ${STAGE[diag.stage] ?? diag.stage}` : undefined} tone="blue" />
        <StatTile label="GRI (текущий замер)" value={d.gri ? d.gri.index.toFixed(1) : '—'} hint={d.gri ? fmtDate(d.gri.assessedAt) : 'тест не пройден'} tone="violet" />
        <StatTile label="Расчётов Точки А" value={d.history.length} hint={diag?.aiStatus && diag.aiStatus !== 'completed' ? `разбор ИИ: ${diag.aiStatus}` : undefined} tone="amber" />
      </div>

      {!diag && (
        <Panel>
          <EmptyState title="Точка А ещё не рассчитана" text="Клиент не прошёл диагностику или расчёт не сохранился. Баллы появятся здесь после первого расчёта." />
        </Panel>
      )}

      {diag && (
        <>
          <Panel title="Разбор ИИ" description="Краткое резюме, которое видит клиент">
            {diag.summary ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{diag.summary}</p> : <p className="text-xs text-slate-600">Разбор ещё не сгенерирован.</p>}
          </Panel>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {diag.blocks.map((b) => (
              <Panel key={b.id} title={b.label} actions={
                <span className="flex items-center gap-2">
                  <span className="text-lg font-bold tabular-nums text-slate-100">{round(b.score)}</span>
                  {b.status && <Badge tone={STATUS[b.status]?.tone}>{STATUS[b.status]?.label ?? b.status}</Badge>}
                </span>
              }>
                {!b.topIssues.length && !b.recommendations.length && <p className="text-xs text-slate-600">Деталей по блоку нет.</p>}
                {!!b.topIssues.length && (
                  <div className="mb-2">
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-red-300/80">Проблемы</p>
                    <ul className="space-y-0.5 text-xs text-slate-300">{b.topIssues.map((x, i) => <li key={i}>• {x}</li>)}</ul>
                  </div>
                )}
                {!!b.recommendations.length && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-emerald-300/80">Рекомендации</p>
                    <ul className="space-y-0.5 text-xs text-slate-300">{b.recommendations.map((x, i) => <li key={i}>• {x}</li>)}</ul>
                  </div>
                )}
              </Panel>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Риски"><Items items={diag.risks} empty="Рисков не выявлено или они не сохранены." /></Panel>
            <Panel title="Инсайты"><Items items={diag.insights} empty="Инсайтов нет." /></Panel>
            <Panel title="Быстрые победы"><Items items={diag.quickWins} empty="Быстрых побед нет." /></Panel>
          </div>

          {(!!diag.priorities.length || !!diag.dataGaps.length) && (
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Стратегические приоритеты"><Items items={diag.priorities} empty="Приоритеты не сформулированы." /></Panel>
              <Panel title="Пробелы в данных" description="Чего не хватает для точной оценки"><Items items={diag.dataGaps} empty="Пробелов нет." /></Panel>
            </div>
          )}

          {!!diag.roadmap.length && (
            <div className="grid gap-3 lg:grid-cols-3">
              {diag.roadmap.map((r) => (
                <Panel key={r.key} title={`Дорожная карта: ${ROADMAP[r.key]}`}>
                  {!!r.goals.length && <ul className="mb-2 space-y-0.5 text-xs text-slate-200">{r.goals.map((g, i) => <li key={i}>◎ {g}</li>)}</ul>}
                  {!!r.actions.length && <ul className="space-y-0.5 text-xs text-slate-400">{r.actions.map((a, i) => <li key={i}>• {a}</li>)}</ul>}
                </Panel>
              ))}
            </div>
          )}

          {diag.industryContext && (
            <Panel title="Отраслевой контекст"><p className="text-sm leading-relaxed text-slate-300">{diag.industryContext}</p></Panel>
          )}
        </>
      )}

      {d.gri && !!d.gri.top5.length && (
        <Panel title="ТОП-5 ограничений роста (GRI)" description={`Замер от ${fmtDate(d.gri.assessedAt)}`}>
          <Items items={d.gri.top5} empty="" />
        </Panel>
      )}

      {d.history.length > 1 && (
        <Panel title="История расчётов Точки А">
          <ul className="divide-y divide-white/[0.05] text-xs">
            {d.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-1.5 text-slate-400">
                <span>{fmtDateTime(h.calculatedAt)}</span>
                <span className="tabular-nums text-slate-200">{round(h.overallScore)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
