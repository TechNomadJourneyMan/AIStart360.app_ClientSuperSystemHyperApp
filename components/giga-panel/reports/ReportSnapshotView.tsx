'use client'

/**
 * Preview of a report version's frozen content (report_versions.content) as
 * staff see it before publishing: every finding and recommendation with its
 * provenance badge, confidence, producer and evidence; sources and dates.
 * Renders only what the snapshot holds — no extra fetches.
 */
import type { ReactNode } from 'react'
import { Bot, FileSearch, Sparkles } from 'lucide-react'
import { Badge, fmtDate, fmtDateTime } from '../kit'
import { KV, Metric, StatusChip } from '../agents/ui'
import { producerLabel, type ReportContent, type ReportEvidence, type ReportFinding, type ReportRecommendation } from '@/lib/reports/types'
import { EVIDENCE_TYPE_LABELS, fmtConfidence, provenanceMeta, severityMeta } from './model'

function EvidenceList({ items }: { items: ReportEvidence[] }) {
  if (!items.length) return null
  return (
    <ul className="mt-2 space-y-1 border-l border-white/[0.08] pl-3">
      {items.map((e, i) => (
        <li key={i} className="text-[11px] text-slate-400">
          <span className="text-slate-500">{EVIDENCE_TYPE_LABELS[e.type] ?? e.type}:</span>{' '}
          <span className="font-mono text-slate-300">{e.ref}</span>
          {e.field && <span className="text-slate-500"> · {e.field}</span>}
          {e.value !== null && <span className="text-slate-200"> = {typeof e.value === 'number' ? e.value.toLocaleString('ru-RU') : e.value}</span>}
          {e.quote && <span className="block text-slate-500">«{e.quote}»</span>}
        </li>
      ))}
    </ul>
  )
}

function ItemBadges({ type, confidence, extra }: { type: string; confidence: number; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusChip meta={provenanceMeta(type)} />
      <Badge title="Уверенность">уверенность {fmtConfidence(confidence)}</Badge>
      {extra}
    </div>
  )
}

function FindingCard({ f }: { f: ReportFinding }) {
  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <ItemBadges
        type={f.provenance_type}
        confidence={f.confidence}
        extra={<><StatusChip meta={severityMeta(f.severity)} /><Badge>{f.area_label}</Badge></>}
      />
      <p className="mt-2 text-sm font-medium text-slate-100">{f.title}</p>
      {f.body && <p className="mt-1 text-xs leading-relaxed text-slate-400">{f.body}</p>}
      <p className="mt-1.5 text-[11px] text-slate-500">
        Источник: {producerLabel(f.source)} <span className="font-mono">({f.source})</span>
        {f.model && <> · модель <span className="font-mono">{f.model}</span></>}
        {f.reviewed_at && <> · проверено {fmtDateTime(f.reviewed_at)}</>}
      </p>
      <EvidenceList items={f.evidence} />
    </li>
  )
}

function RecommendationCard({ r, titles }: { r: ReportRecommendation; titles: Map<string, string> }) {
  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <ItemBadges
        type={r.provenance_type}
        confidence={r.confidence}
        extra={<>
          <Badge tone={r.priority <= 2 ? 'red' : 'neutral'}>приоритет {r.priority}</Badge>
          {r.horizon_days && <Badge>{r.horizon_days} дн.</Badge>}
          <Badge>{r.area_label}</Badge>
        </>}
      />
      <p className="mt-2 text-sm font-medium text-slate-100">{r.title}</p>
      {r.body && <p className="mt-1 text-xs leading-relaxed text-slate-400">{r.body}</p>}
      {r.expected_impact && <p className="mt-1 text-xs text-emerald-300">Эффект: {r.expected_impact}</p>}
      <p className="mt-1.5 text-[11px] text-slate-500">
        Источник: {producerLabel(r.source)} <span className="font-mono">({r.source})</span>
        {r.model && <> · модель <span className="font-mono">{r.model}</span></>}
        {r.reviewed_at && <> · проверено {fmtDateTime(r.reviewed_at)}</>}
      </p>
      {r.finding_ids.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-l border-white/[0.08] pl-3 text-[11px] text-slate-400">
          {r.finding_ids.map((id) => <li key={id}>закрывает: {titles.get(id) ?? <span className="font-mono">{id}</span>}</li>)}
        </ul>
      )}
    </li>
  )
}

export function ReportSnapshotView({ content }: { content: ReportContent }) {
  const d = content.diagnostic
  const titles = new Map(content.findings.map((f) => [f.id, f.title]))
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Индекс Точки А" value={d.overall_score !== null ? `${d.overall_score}/100` : '—'} />
        <Metric label="Индекс здоровья" value={d.health_index !== null ? `${d.health_index}/100` : '—'} />
        <Metric label="Зрелость" value={d.maturity?.label ?? '—'} />
        <Metric label="Полнота данных" value={fmtConfidence(content.data.completeness)} />
      </div>

      {content.narrative && (
        <section className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Sparkles size={13} className="text-violet-300" />
            <StatusChip meta={provenanceMeta('AI_HYPOTHESIS')} />
            <span className="font-mono text-[10px] text-slate-500">{content.narrative.model} · {content.narrative.prompt_version}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-200">{content.narrative.summary}</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-slate-300">
            {content.narrative.key_points.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </section>
      )}

      {d.blocks.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
            Блоки <StatusChip meta={provenanceMeta('CALCULATED')} />
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {d.blocks.map((b) => <Metric key={b.key} label={b.label} value={`${b.score}/100`} hint={b.top_issues[0]} tone={b.score < 50 ? 'red' : b.score < 70 ? 'amber' : 'green'} />)}
          </div>
        </section>
      )}

      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500"><FileSearch size={12} /> Выводы ({content.findings.length})</h4>
        {content.findings.length ? <ul className="space-y-2">{content.findings.map((f) => <FindingCard key={f.id} f={f} />)}</ul>
          : <p className="text-xs text-slate-500">Выводов, видимых клиенту, нет.</p>}
      </section>

      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500"><Bot size={12} /> Рекомендации ({content.recommendations.length})</h4>
        {content.recommendations.length ? <ul className="space-y-2">{content.recommendations.map((r) => <RecommendationCard key={r.id} r={r} titles={titles} />)}</ul>
          : <p className="text-xs text-slate-500">Рекомендаций, видимых клиенту, нет.</p>}
      </section>

      {content.data.gaps.length > 0 && (
        <section>
          <h4 className="mb-2 text-[11px] uppercase tracking-wider text-slate-500">Пробелы в данных</h4>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-300">{content.data.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </section>
      )}

      <section>
        <h4 className="mb-2 text-[11px] uppercase tracking-wider text-slate-500">Источники</h4>
        <KV items={[
          ...content.sources.map((s): [string, string] => [s.label, s.detail]),
          ['Дата расчёта', content.calculated_at ? fmtDate(content.calculated_at) : 'нет данных'],
          ['Снимок собран', fmtDateTime(content.generated_at)],
        ]} />
      </section>
    </div>
  )
}
