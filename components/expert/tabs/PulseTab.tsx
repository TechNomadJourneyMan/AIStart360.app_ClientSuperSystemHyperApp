'use client'

// Mirrors the REAL /pulse page (sales-rep portfolio monitor) so the items
// the expert comments on match exactly what the client sees on their own
// GRI Pulse page. All items wrapped in <Commentable> with ids from
// lib/comment-targets.ts.

import { useState } from 'react'
import { Commentable } from '@/components/expert/Commentable'

interface Props {
  clientId: string
}

type PulseView = 'today' | 'risk' | 'card' | 'crm'

const TABS: Array<{ key: PulseView; label: string; icon: string; targetId: string }> = [
  { key: 'today', label: 'Кому продавать сегодня', icon: 'phone_in_talk',  targetId: 'pulse:tab:today' },
  { key: 'risk',  label: 'Топ в зоне риска',       icon: 'trending_down',  targetId: 'pulse:tab:risk' },
  { key: 'card',  label: 'Карточка клиента',       icon: 'badge',          targetId: 'pulse:tab:card' },
  { key: 'crm',   label: 'CRM-интеграции',         icon: 'integration_instructions', targetId: 'pulse:tab:crm' },
]

type RiskFilter = 'all' | 'high' | 'medium' | 'low'

const RISK_FILTERS: Array<{ key: RiskFilter; label: string; targetId: string }> = [
  { key: 'all',    label: 'Все',      targetId: 'pulse:filter:all' },
  { key: 'high',   label: 'Высокий',  targetId: 'pulse:filter:high' },
  { key: 'medium', label: 'Средний',  targetId: 'pulse:filter:medium' },
  { key: 'low',    label: 'Низкий',   targetId: 'pulse:filter:low' },
]

export function PulseTab({ clientId: _ }: Props) {
  const [view, setView] = useState<PulseView>('today')
  const [risk, setRisk] = useState<RiskFilter>('all')

  return (
    <div className="space-y-6">
      {/* Explanatory banner — this is a mirror, not a live feed */}
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-400 flex-shrink-0">info</span>
        <div className="text-sm">
          <p className="text-on-surface font-medium">
            Экспертный вид GRI Pulse — зеркало клиентской страницы
          </p>
          <p className="text-on-surface-variant mt-0.5 text-xs">
            Структура и пункты точно соответствуют тому, что клиент видит на своей странице{' '}
            <code className="text-primary">/pulse</code>. Нажмите 💬 на любом пункте, чтобы оставить совет.
          </p>
        </div>
      </div>

      {/* Title + data source */}
      <header>
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/70 mb-2">
          GRI Pulse · Монитор клиентской базы
        </p>
        <Commentable targetId="pulse:header:title">
          <h2 className="font-headline text-2xl font-extrabold text-on-surface">
            Кому звонить сегодня
          </h2>
        </Commentable>
        <p className="text-sm text-on-surface-variant mt-1">
          Инструмент менеджера по продажам — видит кто уходит, у кого падает объём, и какое действие
          нужно прямо сейчас.
        </p>
        <Commentable targetId="pulse:header:dataSource">
          <div className="inline-flex items-center gap-1.5 mt-3 text-[11px] font-mono text-on-surface-variant bg-surface-container border border-white/[0.06] px-2 py-1 rounded">
            <span className="material-symbols-outlined text-[12px]">code</span>
            Данные из CRM · Bitrix24
          </div>
        </Commentable>
      </header>

      {/* Briefing card */}
      <Commentable targetId="pulse:briefing:card">
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary text-2xl">lightbulb</span>
              <div>
                <p className="text-[10px] font-mono uppercase tracking-widest text-primary/70 mb-1">
                  Рекомендация на сегодня
                </p>
                <p className="text-sm italic text-on-surface-variant">
                  Нажмите «Обновить» чтобы получить рекомендацию
                </p>
              </div>
            </div>
            <button className="text-xs text-on-surface-variant hover:text-primary inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">refresh</span>
              Обновить
            </button>
          </div>
        </div>
      </Commentable>

      {/* 5 header stats */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          targetId="pulse:header:revenueAtRisk"
          label="Выручка под угрозой"
          value="0 ₸"
          hint="0 клиентов высокого риска"
          icon="payments"
          tone="error"
        />
        <StatCard
          targetId="pulse:header:highRisk"
          label="Высокий риск"
          value="0"
          hint="требуют звонка сегодня"
          icon="power_settings_new"
          tone="error"
        />
        <StatCard
          targetId="pulse:header:mediumRisk"
          label="Средний риск"
          value="0"
          hint="написать до конца дня"
          icon="warning"
          tone="warning"
        />
        <StatCard
          targetId="pulse:header:totalClients"
          label="Всего клиентов"
          value="0"
          hint="в активной базе"
          icon="group"
        />
        <StatCard
          targetId="pulse:header:processedToday"
          label="Обработано сегодня"
          value="0 / 6"
          hint="0% выполнено"
          icon="task_alt"
          tone="success"
        />
      </section>

      {/* 4 tabs */}
      <nav className="flex flex-wrap gap-3 border-b border-white/[0.06]">
        {TABS.map((t) => {
          const active = view === t.key
          return (
            <Commentable key={t.key} targetId={t.targetId} position="top-right">
              <button
                onClick={() => setView(t.key)}
                className={`inline-flex items-center gap-1.5 px-1 pb-3 pt-1 text-sm transition-colors border-b-2 -mb-px ${
                  active
                    ? 'border-primary text-primary font-medium'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
                {t.label}
              </button>
            </Commentable>
          )
        })}
      </nav>

      {/* Risk filter row (for Today / Risk tabs) */}
      {(view === 'today' || view === 'risk') && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
            Риск:
          </span>
          {RISK_FILTERS.map((f) => {
            const active = risk === f.key
            return (
              <Commentable key={f.key} targetId={f.targetId}>
                <button
                  onClick={() => setRisk(f.key)}
                  className={`text-[10px] font-mono uppercase px-3 py-1 rounded-full border transition-colors ${
                    active
                      ? 'bg-primary/15 border-primary/30 text-primary'
                      : 'bg-white/[0.03] border-white/[0.06] text-on-surface-variant hover:bg-white/[0.06]'
                  }`}
                >
                  {f.label}
                </button>
              </Commentable>
            )
          })}
        </div>
      )}

      {/* Tab content */}
      {view === 'today' && <TodayView />}
      {view === 'risk' && <RiskView />}
      {view === 'card' && <CardView />}
      {view === 'crm' && <CrmView />}

      {/* 3 priority cards at bottom (Today tab) */}
      {view === 'today' && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PriorityCard
            targetId="pulse:priority:call"
            icon="phone"
            title="Приоритет 1 — Звонок"
            count={0}
            tone="error"
          />
          <PriorityCard
            targetId="pulse:priority:message"
            icon="chat"
            title="Приоритет 2 — Написать"
            count={0}
            tone="warning"
          />
          <PriorityCard
            targetId="pulse:priority:monitor"
            icon="visibility"
            title="Мониторинг"
            count={0}
          />
        </section>
      )}
    </div>
  )
}

// ── Tab contents ────────────────────────────────────────────────────────────

function TodayView() {
  return (
    <div className="space-y-4">
      <Commentable targetId="pulse:today:alertBanner">
        <div className="rounded-2xl border border-error/20 bg-error/5 p-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-error">notifications_active</span>
          <p className="text-sm text-on-surface">
            Клиенты с просроченным циклом заказа выделяются здесь. Сейчас: <span className="font-mono">0</span>.
          </p>
        </div>
      </Commentable>

      {/* Desktop table structure — each column header is commentable */}
      <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-white/[0.06]">
              <TableColHeader targetId="pulse:table:col:client"       label="Клиент" />
              <TableColHeader targetId="pulse:table:col:lastOrder"    label="Последний заказ" />
              <TableColHeader targetId="pulse:table:col:avgCheck"     label="Ср. чек" />
              <TableColHeader targetId="pulse:table:col:volumeChange" label="Изм. объёма" />
              <TableColHeader targetId="pulse:table:col:riskScore"    label="Риск-скор" />
              <TableColHeader targetId="pulse:table:col:churnProb"    label="Вер-сть оттока" />
              <TableColHeader targetId="pulse:table:col:comment"      label="Комментарий" />
              <TableColHeader targetId="pulse:table:col:action"       label="Действие" />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={8} className="py-12 text-center text-sm text-on-surface-variant">
                Нет клиентов в этой выборке
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RiskView() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low py-12 text-center text-sm text-on-surface-variant">
      Клиенты в зоне риска отсутствуют
    </div>
  )
}

function CardView() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard targetId="pulse:card:metric:avgCheck"     label="Средний чек"   value="—" icon="payments" />
        <StatCard targetId="pulse:card:metric:volumeChange" label="Изм. объёма"   value="—" icon="trending_up" suffix="%" />
        <StatCard targetId="pulse:card:metric:riskScore"    label="Риск-скор"     value="—" icon="warning" />
        <StatCard targetId="pulse:card:metric:daysSince"    label="Дней без заказа" value="—" icon="calendar_today" />
      </div>
      <Commentable targetId="pulse:card:historyChart">
        <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5">
          <p className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-3">
            История заказов (последние 5)
          </p>
          <div className="h-24 flex items-end gap-2">
            {[0, 0, 0, 0, 0].map((_, i) => (
              <div key={i} className="flex-1 bg-white/[0.04] rounded-t h-1/4" />
            ))}
          </div>
        </div>
      </Commentable>
      <Commentable targetId="pulse:card:comment">
        <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 text-sm">
          <span className="material-symbols-outlined text-on-surface-variant/70 mr-2 align-middle text-base">
            format_quote
          </span>
          <span className="text-on-surface-variant italic">Нет комментария аналитика</span>
        </div>
      </Commentable>
    </div>
  )
}

function CrmView() {
  return (
    <div className="space-y-4">
      <Commentable targetId="pulse:crm:header">
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-surface-container-low border border-white/[0.06] p-4">
          <h3 className="font-headline text-base font-bold text-on-surface">CRM-интеграции</h3>
          <button className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">add</span>
            Подключить CRM
          </button>
        </div>
      </Commentable>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Commentable targetId="pulse:crm:bitrix24">
          <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">storage</span>
            <div>
              <p className="text-sm font-medium text-on-surface">Bitrix24</p>
              <p className="text-[10px] text-on-surface-variant">Не подключён</p>
            </div>
          </div>
        </Commentable>
        <Commentable targetId="pulse:crm:amocrm">
          <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">storage</span>
            <div>
              <p className="text-sm font-medium text-on-surface">AmoCRM</p>
              <p className="text-[10px] text-on-surface-variant">Не подключён</p>
            </div>
          </div>
        </Commentable>
      </div>
    </div>
  )
}

// ── Shared atoms ────────────────────────────────────────────────────────────

function StatCard({
  targetId,
  label,
  value,
  hint,
  icon,
  suffix,
  tone = 'default',
}: {
  targetId: string
  label: string
  value: string
  hint?: string
  icon: string
  suffix?: string
  tone?: 'default' | 'error' | 'warning' | 'success'
}) {
  const toneClass =
    tone === 'error'
      ? 'text-error'
      : tone === 'warning'
      ? 'text-amber-400'
      : tone === 'success'
      ? 'text-primary'
      : 'text-on-surface'
  return (
    <Commentable targetId={targetId}>
      <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4">
        <div className="flex items-start justify-between mb-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
            {label}
          </span>
          <span className={`material-symbols-outlined text-base ${toneClass}`}>{icon}</span>
        </div>
        <p className={`text-2xl font-mono font-bold ${toneClass}`}>
          {value}
          {suffix && <span className="text-sm text-on-surface-variant ml-1">{suffix}</span>}
        </p>
        {hint && <p className="text-[10px] text-on-surface-variant mt-1">{hint}</p>}
      </div>
    </Commentable>
  )
}

function TableColHeader({ targetId, label }: { targetId: string; label: string }) {
  return (
    <th className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant px-3 py-3 min-w-[100px]">
      <Commentable targetId={targetId} position="top-right">
        <span className="block pr-5">{label}</span>
      </Commentable>
    </th>
  )
}

function PriorityCard({
  targetId,
  icon,
  title,
  count,
  tone = 'default',
}: {
  targetId: string
  icon: string
  title: string
  count: number
  tone?: 'default' | 'error' | 'warning'
}) {
  const toneClass =
    tone === 'error'
      ? 'border-error/20 bg-error/5 text-error'
      : tone === 'warning'
      ? 'border-amber-500/20 bg-amber-500/5 text-amber-400'
      : 'border-white/[0.06] bg-surface-container-low text-primary'
  return (
    <Commentable targetId={targetId}>
      <div className={`rounded-2xl border p-4 flex items-center gap-3 ${toneClass}`}>
        <span className="material-symbols-outlined text-2xl">{icon}</span>
        <div>
          <p className="text-2xl font-mono font-bold">{count}</p>
          <p className="text-xs text-on-surface">{title}</p>
        </div>
      </div>
    </Commentable>
  )
}
