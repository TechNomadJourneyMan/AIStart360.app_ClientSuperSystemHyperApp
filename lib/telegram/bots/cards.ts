/** Text of a company card and a diagnostic session line — shared by the admin and expert bots. */
import { maskEmail } from '@/lib/admin/mask'
import { STAGE_LABELS, isDiagnosticStage } from '@/lib/diagnostics/pipeline'
import type { CompanyCard, SessionListRow } from './data'
import { cut, dt, esc, pct } from './ui'

export const SESSION_STATUS: Record<string, string> = {
  collecting: '📥 сбор данных', processing: '⚙️ обработка', ready: '✅ готова', failed: '⚠️ сбой', cancelled: '✖️ отменена', archived: '🗄 архив',
}

const SEVERITY: Record<string, string> = { critical: '🚨', high: '🔶' }

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return '—'
  return isDiagnosticStage(stage) ? STAGE_LABELS[stage] : stage
}

export function renderCompanyCard(c: CompanyCard, opts: { showContacts: boolean }): string {
  const lines: string[] = [`🏢 <b>${esc(c.name)}</b>`]
  const meta = [c.industry, c.stage].filter(Boolean).map(esc).join(' · ')
  if (meta) lines.push(meta)
  if (c.owner) {
    const email = opts.showContacts ? c.owner.email : maskEmail(c.owner.email)
    lines.push(`Владелец: ${esc(c.owner.name ?? '—')}${email ? ` · ${esc(email)}` : ''}${c.owner.status && c.owner.status !== 'approved' ? ` · статус ${esc(c.owner.status)}` : ''}`)
  }
  lines.push('')
  if (c.diagnostic) {
    lines.push(`📈 Точка А: <b>${c.diagnostic.score ?? '—'}</b>/100${c.diagnostic.health != null ? ` · здоровье ${c.diagnostic.health}` : ''}${c.diagnostic.stage ? ` · зрелость ${esc(c.diagnostic.stage)}` : ''} · ${dt(c.diagnostic.calculatedAt)}`)
  } else {
    lines.push('📈 Точка А: ещё не рассчитана')
  }
  if (c.session) {
    lines.push(`🩺 Диагностика: ${SESSION_STATUS[c.session.status] ?? esc(c.session.status)} · этап ${esc(stageLabel(c.session.stage))} · полнота ${c.session.completeness != null ? pct(c.session.completeness) : '—'} · ${dt(c.session.completedAt ?? c.session.startedAt)}`)
    if (c.session.error) lines.push(`   ошибка: ${esc(cut(c.session.error, 160))}`)
  } else {
    lines.push('🩺 Диагностика: сессий ещё не было')
  }
  if (c.diagnostic?.dataGaps.length) lines.push(`🕳 Пробелы в данных: ${c.diagnostic.dataGaps.map((g) => esc(cut(g, 40))).join(', ')}`)
  lines.push(`🚨 Критических выводов: ${c.criticalCount}`)
  if (c.findings.length) {
    lines.push('', '<b>Главные выводы</b>')
    for (const f of c.findings) {
      const hypothesis = f.provenance_type === 'AI_HYPOTHESIS'
      const tag = hypothesis ? (f.reviewed ? ' <i>(ИИ, проверено)</i>' : ' <i>(🧪 гипотеза ИИ, не проверена)</i>') : ''
      lines.push(`${SEVERITY[f.severity] ?? '•'} ${esc(cut(f.title, 140))}${tag}`)
    }
  }
  if (c.pendingHypotheses) lines.push(`🧪 Гипотез ИИ на проверке: ${c.pendingHypotheses}`)
  lines.push(`📄 Опубликованных отчётов: ${c.publishedReports}`)
  return lines.join('\n')
}

export function sessionLine(s: SessionListRow): string {
  return `${SESSION_STATUS[s.status] ?? esc(s.status)} · ${esc(cut(s.company_name ?? s.company_id, 36))} · ${esc(stageLabel(s.stage))} · ${s.completeness != null ? pct(s.completeness) : '—'} · ${dt(s.completed_at ?? s.started_at)}`
}
