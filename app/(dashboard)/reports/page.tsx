export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { EmptyState } from '@/components/common/EmptyState'
import { getReportDocuments, uploadReportAction } from '@/app/actions/reports'

export const metadata: Metadata = { title: 'Reports' }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(value)
}

const categoryColors: Record<string, string> = {
  GRI:       'text-primary bg-primary/10 border-primary/20',
  Financial: 'text-secondary bg-secondary/10 border-secondary/20',
  Growth:    'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20',
  Market:    'text-on-surface-variant bg-surface-container-high border-outline-variant/30',
  Custom:    'text-on-surface bg-surface-container-high border-outline-variant/30',
}

const reportCategories = ['All', 'GRI', 'Financial', 'Growth', 'Market', 'Custom'] as const
type ReportCategory = (typeof reportCategories)[number]

function isReportCategory(value: string | undefined): value is ReportCategory {
  return reportCategories.some((category) => category === value)
}

async function getReportsData() {
  try {
    const reports = await getReportDocuments()
    return { reports, unavailable: false }
  } catch (error) {
    console.error('[reports] documents unavailable', error)
    return { reports: [], unavailable: true }
  }
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: { category?: string | string[] }
}) {
  const { reports, unavailable } = await getReportsData()
  const requestedCategory = Array.isArray(searchParams?.category)
    ? searchParams.category[0]
    : searchParams?.category
  const activeCategory: ReportCategory = isReportCategory(requestedCategory)
    ? requestedCategory
    : 'All'
  const visibleReports = activeCategory === 'All'
    ? reports
    : reports.filter((report) => report.category === activeCategory)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Reports Hub</h1>
          <p className="text-on-surface-variant text-sm mt-1">
            {unavailable ? 'Количество документов недоступно' : `${reports.length} документов`}
          </p>
        </div>
      </div>

      {unavailable && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3"
        >
          <span className="material-symbols-outlined mt-0.5 text-lg text-tertiary-container">cloud_off</span>
          <div>
            <p className="text-sm font-medium text-on-surface">Источник отчётов временно недоступен</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Архив не загружен, поэтому количество и категории не показаны как пустые.
            </p>
          </div>
        </div>
      )}

      {/* Category Filters */}
      {!unavailable && (
        <nav aria-label="Фильтр категорий отчётов" className="flex gap-2 flex-wrap">
          {reportCategories.map((category) => {
            const active = category === activeCategory
            return (
              <a
                key={category}
                href={category === 'All' ? '?' : `?category=${encodeURIComponent(category)}`}
                aria-current={active ? 'page' : undefined}
                className={`px-4 py-1.5 rounded-full text-xs font-mono font-medium border transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-surface-container text-on-surface-variant border-outline-variant/30 hover:border-outline-variant/60'
                }`}
              >
                {category}
              </a>
            )
          })}
        </nav>
      )}

      {/* Upload Form */}
      {!unavailable ? (
        <form action={uploadReportAction} className="bg-surface-container rounded-xl p-5 border border-outline-variant/20 grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            name="name"
            placeholder="Название отчета"
            className="md:col-span-2 bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm"
            required
          />
          <input
            name="clientName"
            placeholder="Клиент"
            className="bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm"
            required
          />
          <select
            name="category"
            defaultValue="Custom"
            className="bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm"
          >
            <option value="Custom">Custom</option>
            <option value="GRI">GRI</option>
            <option value="Financial">Financial</option>
            <option value="Growth">Growth</option>
            <option value="Market">Market</option>
          </select>
          <input
            type="file"
            name="file"
            accept=".pdf,.xlsx,.csv,.docx"
            className="bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm"
            required
          />
          <button
            type="submit"
            className="md:col-span-5 inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.99] active:scale-95 transition-all"
          >
            <span className="material-symbols-outlined text-lg">upload</span>
            Загрузить отчёт
          </button>
          <p className="md:col-span-5 text-xs text-on-surface-variant/70">Поддерживаются: PDF, XLSX, CSV, DOCX. Максимум 50MB.</p>
        </form>
      ) : (
        <div
          aria-disabled="true"
          className="flex items-start gap-3 rounded-xl border border-outline-variant/20 bg-surface-container p-5"
        >
          <span className="material-symbols-outlined text-xl text-on-surface-variant">upload_off</span>
          <div>
            <p className="text-sm font-medium text-on-surface">Загрузка отчётов отключена</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Форма станет доступна после восстановления источника данных.
            </p>
          </div>
        </div>
      )}

      {/* Reports Grid */}
      {unavailable ? (
        <div className="rounded-xl border border-white/[0.04] bg-surface-container p-8 text-center">
          <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/30">database_off</span>
          <p className="text-sm font-medium text-on-surface">Архив отчётов не загружен</p>
          <p className="mt-1 text-xs text-on-surface-variant">Это не означает, что документов нет.</p>
        </div>
      ) : visibleReports.length === 0 ? (
        <EmptyState
          icon="folder_open"
          title={activeCategory === 'All' ? 'Нет отчётов' : `Нет отчётов в категории ${activeCategory}`}
          description={activeCategory === 'All'
            ? 'Загрузите первый отчёт, чтобы начать работу'
            : 'Выберите другую категорию или загрузите новый отчёт'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleReports.map((report) => (
            <div
              key={report.id}
              className="bg-surface-container rounded-xl p-5 hover:bg-surface-container-high transition-colors group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-on-surface-variant">
                    {report.type === 'pdf' ? 'picture_as_pdf' : report.type === 'xlsx' ? 'table_chart' : 'description'}
                  </span>
                </div>
                <span className={`text-[10px] font-mono px-2 py-1 rounded-full border uppercase ${categoryColors[report.category] ?? categoryColors.Custom}`}>
                  {report.category}
                </span>
              </div>

              <h3 className="font-medium text-on-surface text-sm mb-1 line-clamp-2 group-hover:text-primary transition-colors">
                {report.name}
              </h3>
              <p className="text-xs text-on-surface-variant mb-4">{report.clientName}</p>

              <div className="flex items-center justify-between text-[10px] font-mono text-on-surface-variant">
                <span>{formatDate(report.createdAt)}</span>
                <span>{formatBytes(report.fileSizeBytes)}</span>
              </div>

              <div className="flex gap-2 mt-4 pt-4 border-t border-outline-variant/10 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                <a href={report.fileUrl} target="_blank" rel="noopener noreferrer" className="flex-1 py-1.5 rounded text-xs text-on-surface border border-outline-variant/30 hover:bg-surface-container-high transition-colors text-center">
                  Просмотр
                </a>
                <a href={report.fileUrl} download className="flex-1 py-1.5 rounded text-xs text-primary border border-primary/20 hover:bg-primary/5 transition-colors text-center">
                  Скачать
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
