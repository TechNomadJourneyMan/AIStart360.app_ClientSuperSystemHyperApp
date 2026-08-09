'use client'

// Category chips and the report grid. Both were dead before: the chips had no
// onClick and the active one was hardcoded to «All», while the card carried
// `cursor-pointer` with nothing to click and hid its two links behind
// `opacity-0 group-hover`, so keyboard focus landed on invisible targets.

import { useMemo, useState, type ReactNode } from 'react'
import { CATEGORY_COLORS, CATEGORY_LABELS, FILE_ICONS, formatBytes, formatDate, pluralRu } from './format'

export type ReportCard = {
  id: string
  name: string
  clientName: string
  category: string
  type: string
  fileUrl: string
  fileSizeBytes: number
  createdAt: string
}

const ALL = '__all__'

function focusUploadForm() {
  const form = document.getElementById('report-upload')
  if (!form) return
  form.scrollIntoView({ behavior: 'smooth', block: 'center' })
  form.querySelector<HTMLInputElement>('input[name="name"]')?.focus({ preventScroll: true })
}

/**
 * `children` is the upload form. It is rendered between the filter row and the
 * grid so the on-screen order still matches the /reports mascot tour
 * (h1 → reports-filters → reports-upload).
 */
export function ReportsBrowser({ reports, children }: { reports: ReportCard[]; children?: ReactNode }) {
  const [category, setCategory] = useState<string>(ALL)
  const [query, setQuery] = useState('')

  // Only categories that actually occur get a chip — an empty «Рынок» filter
  // that always yields nothing is the same lie as a dead button.
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const report of reports) counts.set(report.category, (counts.get(report.category) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [reports])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return reports.filter((report) => {
      if (category !== ALL && report.category !== category) return false
      if (!needle) return true
      return (
        report.name.toLowerCase().includes(needle) || report.clientName.toLowerCase().includes(needle)
      )
    })
  }, [reports, category, query])

  const isFiltered = category !== ALL || query.trim().length > 0

  const chipClass = (active: boolean) =>
    `px-4 py-1.5 rounded-full text-xs font-mono font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
      active
        ? 'bg-primary/10 text-primary border-primary/30'
        : 'bg-surface-container text-on-surface-variant border-outline-variant/30 hover:border-outline-variant/60 hover:text-on-surface'
    }`

  return (
    <div className="space-y-6">
      {reports.length > 0 && (
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div
            data-tour="reports-filters"
            role="group"
            aria-label="Фильтр отчётов по категории"
            className="flex gap-2 flex-wrap"
          >
            <button
              type="button"
              onClick={() => setCategory(ALL)}
              aria-pressed={category === ALL}
              className={chipClass(category === ALL)}
            >
              Все · {reports.length}
            </button>
            {categories.map(([name, count]) => (
              <button
                key={name}
                type="button"
                onClick={() => setCategory(name)}
                aria-pressed={category === name}
                className={chipClass(category === name)}
              >
                {CATEGORY_LABELS[name] ?? name} · {count}
              </button>
            ))}
          </div>

          <div className="lg:ml-auto relative">
            <label htmlFor="reports-search" className="sr-only">
              Поиск по названию отчёта или клиенту
            </label>
            <span
              className="material-symbols-outlined text-base text-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            >
              search
            </span>
            <input
              id="reports-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Название или клиент"
              className="w-full lg:w-64 bg-surface-container border border-outline-variant/30 rounded-lg pl-9 pr-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            />
          </div>
        </div>
      )}

      {children}

      {reports.length > 0 && (
        <p className="text-xs font-mono text-on-surface-variant" role="status" aria-live="polite">
          {isFiltered
            ? `Показано ${visible.length} из ${reports.length}`
            : `${reports.length} ${pluralRu(reports.length, 'документ', 'документа', 'документов')}`}
        </p>
      )}

      {reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
          <span className="material-symbols-outlined text-6xl text-on-surface-variant/20 mb-4" aria-hidden="true">
            folder_open
          </span>
          <h3 className="font-headline text-lg font-bold text-on-surface mb-2">Отчётов пока нет</h3>
          <p className="text-sm text-on-surface-variant max-w-sm leading-relaxed">
            Ни одного документа ещё не загружено. Форма выше принимает PDF, XLSX, CSV и DOCX.
          </p>
          <button
            type="button"
            onClick={focusUploadForm}
            className="mt-6 inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] active:scale-95 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <span className="material-symbols-outlined text-lg" aria-hidden="true">
              upload
            </span>
            Загрузить первый отчёт
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 px-8 text-center border border-dashed border-outline-variant/30 rounded-xl">
          <p className="text-sm text-on-surface-variant max-w-sm">
            Под фильтр не попал ни один из {reports.length}{' '}
            {pluralRu(reports.length, 'документа', 'документов', 'документов')}.
          </p>
          <button
            type="button"
            onClick={() => {
              setCategory(ALL)
              setQuery('')
            }}
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-mono text-primary border border-primary/25 rounded-lg px-3 py-2 hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">
              filter_alt_off
            </span>
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 list-none">
          {visible.map((report) => (
            <li
              key={report.id}
              className="bg-surface-container rounded-xl p-5 border border-transparent hover:bg-surface-container-high focus-within:border-primary/30 transition-colors group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-on-surface-variant" aria-hidden="true">
                    {FILE_ICONS[report.type] ?? 'description'}
                  </span>
                </div>
                <span
                  className={`text-[10px] font-mono px-2 py-1 rounded-full border uppercase ${
                    CATEGORY_COLORS[report.category] ?? CATEGORY_COLORS.Custom
                  }`}
                >
                  {CATEGORY_LABELS[report.category] ?? report.category}
                </span>
              </div>

              <h3 className="font-medium text-sm mb-1 line-clamp-2">
                <a
                  href={report.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Открыть отчёт «${report.name}» в новой вкладке`}
                  className="text-on-surface hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
                >
                  {report.name}
                </a>
              </h3>
              <p className="text-xs text-on-surface-variant mb-4">{report.clientName}</p>

              <div className="flex items-center justify-between text-[10px] font-mono text-on-surface-variant">
                <span>{formatDate(report.createdAt)}</span>
                <span>{formatBytes(report.fileSizeBytes)}</span>
              </div>

              <div className="flex gap-2 mt-4 pt-4 border-t border-outline-variant/10 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                <a
                  href={report.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Просмотреть «${report.name}»`}
                  className="flex-1 py-1.5 rounded text-xs text-on-surface border border-outline-variant/30 hover:bg-surface-container-high transition-colors text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  Просмотр
                </a>
                <a
                  href={report.fileUrl}
                  download
                  aria-label={`Скачать «${report.name}», ${formatBytes(report.fileSizeBytes)}`}
                  className="flex-1 py-1.5 rounded text-xs text-primary border border-primary/20 hover:bg-primary/5 transition-colors text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  Скачать
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
