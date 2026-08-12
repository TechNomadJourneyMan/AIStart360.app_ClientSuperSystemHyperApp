import type { StoreImportHistoryEntry } from '@/lib/store/import/history'

function kindLabel(kind: StoreImportHistoryEntry['kind']): string {
  if (kind === 'prices') return 'Прайс'
  if (kind === 'inventory') return 'Остатки'
  return 'Продажи'
}

function period(entry: StoreImportHistoryEntry): string {
  if (!entry.periodStart) return 'Период не указан'
  if (!entry.periodEnd || entry.periodEnd === entry.periodStart) {
    return new Date(`${entry.periodStart}T00:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'UTC' })
  }
  return `${new Date(`${entry.periodStart}T00:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'UTC' })} — ${new Date(`${entry.periodEnd}T00:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'UTC' })}`
}

function publishedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
}

export function StoreImportHistory({ entries }: { entries: StoreImportHistoryEntry[] }) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-6" aria-labelledby="store-import-history-title">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">Audit trail</p>
          <h2 id="store-import-history-title" className="mt-1 font-headline text-lg font-bold text-on-surface">История публикаций</h2>
        </div>
        <p className="text-xs text-on-surface-variant">Только версии вашей компании · без исходных строк и PII</p>
      </div>

      {entries.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-outline-variant/30 px-5 py-9 text-center">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/40" aria-hidden="true">history</span>
          <p className="mt-2 text-sm font-semibold text-on-surface">Публикаций пока нет</p>
          <p className="mt-1 text-xs text-on-surface-variant">После первой публикации здесь появятся версия, период и контрольное число строк.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 md:p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-on-surface">{kindLabel(entry.kind)}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-mono ${entry.status === 'published' ? 'border-primary/20 bg-primary/[0.07] text-primary' : 'border-white/10 bg-white/[0.03] text-on-surface-variant'}`}>
                      {entry.status === 'published' ? 'Опубликовано' : 'Заменено'}
                    </span>
                    <span className="font-mono text-[10px] text-on-surface-variant">{entry.sourceSha256.slice(0, 12)}…</span>
                  </div>
                  <p className="mt-1 text-xs text-on-surface-variant">{period(entry)} · {entry.scopeKey}</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:text-right">
                  <div>
                    <dt className="text-on-surface-variant">Строк</dt>
                    <dd className="font-mono font-bold tabular-nums text-on-surface">{entry.rowCount.toLocaleString('ru-RU')}</dd>
                  </div>
                  <div>
                    <dt className="text-on-surface-variant">Публикация</dt>
                    <dd className="text-on-surface">{publishedAt(entry.publishedAt)}</dd>
                  </div>
                  {(entry.warningCount > 0 || entry.errorCount > 0) && (
                    <div className="col-span-2 text-tertiary-container">
                      Предупреждений: {entry.warningCount.toLocaleString('ru-RU')}
                    </div>
                  )}
                </dl>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
