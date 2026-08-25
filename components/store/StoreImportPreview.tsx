'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type RefObject,
} from 'react'
import { useRouter } from 'next/navigation'

const MAX_FILE_BYTES = 4 * 1024 * 1024
const ACCEPTED_EXTENSIONS = ['.xls', '.xlsx', '.csv'] as const

export interface StoreImportPreviewData {
  ready: boolean
  schemaVersion: number
  normalizedSha256: string
  fileName: string
  sha256: string
  kind: string
  sheetName: string | null
  rowCount: number
  acceptedRows: number
  quarantinedRows: number
  headers: string[]
  detectedColumns: unknown
  totals: unknown
  warnings: string[]
  errors: string[]
  previewRows: Array<Record<string, unknown>>
}

export type StoreImportPreviewPhase = 'idle' | 'uploading' | 'success' | 'error'

export type StoreImportPublishPhase =
  | 'configuration'
  | 'confirmation'
  | 'publishing'
  | 'published'
  | 'duplicate'
  | 'error'

export interface StoreImportPublishResult {
  outcome: 'published' | 'duplicate'
  importRunId: string
  importKind: 'prices' | 'inventory' | 'sales' | 'management_period'
  scopeKey: string
  rowCount: number
  publishedAt: string
  quarantinedRows: number
}

interface StoreImportPreviewViewProps {
  phase: StoreImportPreviewPhase
  selectedFileName: string | null
  errorMessage: string | null
  data: StoreImportPreviewData | null
  inputId: string
  publishPhase?: StoreImportPublishPhase
  effectiveDate?: string
  confirmVariants?: boolean
  confirmWarnings?: boolean
  publishErrorMessage?: string | null
  publishResult?: StoreImportPublishResult | null
  inputRef?: RefObject<HTMLInputElement>
  onFileChange?: (event: ChangeEvent<HTMLInputElement>) => void
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  onReset?: () => void
  onEffectiveDateChange?: (event: ChangeEvent<HTMLInputElement>) => void
  onConfirmVariantsChange?: (event: ChangeEvent<HTMLInputElement>) => void
  onConfirmWarningsChange?: (event: ChangeEvent<HTMLInputElement>) => void
  onOpenConfirmation?: () => void
  onBackToConfiguration?: () => void
  onPublish?: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPreviewData(value: unknown): value is StoreImportPreviewData {
  if (!isRecord(value)) return false
  return (
    typeof value.fileName === 'string'
    && typeof value.ready === 'boolean'
    && Number.isSafeInteger(value.schemaVersion)
    && Number(value.schemaVersion) > 0
    && typeof value.normalizedSha256 === 'string'
    && /^[a-f0-9]{64}$/.test(value.normalizedSha256)
    && typeof value.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(value.sha256)
    && typeof value.kind === 'string'
    && (typeof value.sheetName === 'string' || value.sheetName === null)
    && isFiniteNumber(value.rowCount)
    && isFiniteNumber(value.acceptedRows)
    && isFiniteNumber(value.quarantinedRows)
    && isStringArray(value.headers)
    && isStringArray(value.warnings)
    && isStringArray(value.errors)
    && Array.isArray(value.previewRows)
    && value.previewRows.every(isRecord)
  )
}

function canonicalImportKind(value: string): StoreImportPublishResult['importKind'] | null {
  const kind = value.trim().toLowerCase()
  if (kind === 'prices' || kind === 'price' || kind === 'price_list') return 'prices'
  if (kind === 'management_period') return 'management_period'
  if (kind === 'inventory' || kind === 'sales') return kind
  return null
}

function isPublishResult(value: unknown): value is StoreImportPublishResult {
  if (!isRecord(value)) return false
  return (
    (value.outcome === 'published' || value.outcome === 'duplicate')
    && typeof value.importRunId === 'string'
    && canonicalImportKind(String(value.importKind ?? '')) === value.importKind
    && typeof value.scopeKey === 'string'
    && isFiniteNumber(value.rowCount)
    && typeof value.publishedAt === 'string'
    && isFiniteNumber(value.quarantinedRows)
  )
}

function validDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function publicationCanProceed(
  data: StoreImportPreviewData,
  effectiveDate: string,
  confirmVariants: boolean,
  confirmWarnings: boolean,
): boolean {
  const kind = canonicalImportKind(data.kind)
  const dateRequired = kind === 'inventory' || kind === 'prices'
  const variantsRequired = kind !== 'management_period'
  const warningsRequired = data.quarantinedRows > 0 || data.warnings.length > 0
  return data.ready
    && data.errors.length === 0
    && kind !== null
    && (!dateRequired || validDateInput(effectiveDate))
    && (!variantsRequired || confirmVariants)
    && (!warningsRequired || confirmWarnings)
}

export function storeImportErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Сессия истекла. Войдите в аккаунт снова и повторите проверку.'
    case 413:
      return 'Файл превышает 4 МБ. Уменьшите файл или разделите его на несколько файлов.'
    case 415:
      return 'Формат не поддерживается. Выберите файл XLS, XLSX или CSV.'
    case 422:
      return 'Структуру файла не удалось безопасно распознать. Проверьте заголовки, лист и типы значений.'
    case 500:
      return 'Не удалось проверить файл из-за внутренней ошибки. Данные не сохранены; повторите позже.'
    default:
      return `Не удалось проверить файл (код ${status}). Данные не сохранены.`
  }
}

export function storeImportPublishErrorMessage(status: number, code = ''): string {
  if (code === 'effective_date_required' || code === 'effective_date_invalid') {
    return 'Укажите корректную дату снимка и повторите публикацию.'
  }
  if (code === 'warnings_confirmation_required') {
    return 'Подтвердите, что предупреждения проверены, а строки карантина будут исключены.'
  }
  if (code === 'variants_confirmation_required') {
    return 'Подтвердите точное сопоставление вариантов по полному названию.'
  }
  if (code === 'preview_stale' || code === 'publish_conflict') {
    return 'Файл или опубликованные данные изменились. Сформируйте предпросмотр заново.'
  }
  switch (status) {
    case 400:
      return 'Предпросмотр устарел или неполон. Проверьте файл заново.'
    case 401:
      return 'Сессия истекла. Войдите в аккаунт снова перед публикацией.'
    case 403:
      return 'Публикация отклонена проверкой безопасности. Обновите страницу и повторите.'
    case 409:
      return 'Данные изменились с момента проверки. Сформируйте предпросмотр заново.'
    case 413:
      return 'Файл превышает безопасный лимит публикации 4 МБ.'
    case 415:
      return 'Формат файла больше не поддерживается. Проверьте исходный файл заново.'
    case 422:
      return 'Параметры публикации не приняты. Проверьте дату и подтверждения.'
    case 429:
      return 'Слишком много публикаций. Подождите и повторите с этой страницы.'
    case 500:
      return 'Публикация не выполнена. Предыдущие данные не изменены; можно повторить.'
    default:
      return `Публикация не выполнена (код ${status}). Предыдущие данные не изменены.`
  }
}

function localFileError(file: File): string | null {
  const lowerName = file.name.toLowerCase()
  if (!ACCEPTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    return 'Выберите файл с расширением .xls, .xlsx или .csv.'
  }
  if (file.size > MAX_FILE_BYTES) {
    return 'Файл превышает 4 МБ. Уменьшите его и повторите проверку.'
  }
  if (file.size === 0) return 'Файл пуст. Выберите файл с данными.'
  return null
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
      : '—'
  }
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (typeof value === 'string') return value.slice(0, 180)
  try {
    return JSON.stringify(value).slice(0, 180)
  } catch {
    return '—'
  }
}

function displayEntries(value: unknown): Array<{ label: string; value: string }> {
  if (isRecord(value)) {
    return Object.entries(value).map(([label, item]) => ({
      label,
      value: formatValue(item),
    }))
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (isRecord(item)) {
        const label = formatValue(item.source ?? item.header ?? item.column ?? `Колонка ${index + 1}`)
        const detected = item.target ?? item.field ?? item.detected ?? item.value ?? item
        return { label, value: formatValue(detected) }
      }
      return { label: `Значение ${index + 1}`, value: formatValue(item) }
    })
  }
  return []
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    sales: 'Продажи',
    inventory: 'Остатки',
    price: 'Прайс',
    prices: 'Прайс',
    price_list: 'Прайс',
    management_period: 'Управленческие периоды',
    unknown: 'Не определён',
  }
  return labels[kind.toLowerCase()] ?? kind
}

interface PublicationPanelProps {
  data: StoreImportPreviewData
  inputId: string
  phase: StoreImportPublishPhase
  effectiveDate: string
  confirmVariants: boolean
  confirmWarnings: boolean
  errorMessage: string | null
  result: StoreImportPublishResult | null
  onEffectiveDateChange?: (event: ChangeEvent<HTMLInputElement>) => void
  onConfirmVariantsChange?: (event: ChangeEvent<HTMLInputElement>) => void
  onConfirmWarningsChange?: (event: ChangeEvent<HTMLInputElement>) => void
  onOpenConfirmation?: () => void
  onBackToConfiguration?: () => void
  onPublish?: () => void
}

function PublicationPanel({
  data,
  inputId,
  phase,
  effectiveDate,
  confirmVariants,
  confirmWarnings,
  errorMessage,
  result,
  onEffectiveDateChange,
  onConfirmVariantsChange,
  onConfirmWarningsChange,
  onOpenConfirmation,
  onBackToConfiguration,
  onPublish,
}: PublicationPanelProps) {
  const kind = canonicalImportKind(data.kind)
  const dateRequired = kind === 'inventory' || kind === 'prices'
  const dateReady = !dateRequired || validDateInput(effectiveDate)
  const warningsConfirmationRequired = data.quarantinedRows > 0 || data.warnings.length > 0
  const configurationReady = publicationCanProceed(
    data,
    effectiveDate,
    confirmVariants,
    confirmWarnings,
  )
  const dateId = `${inputId}-effective-date`
  const variantsId = `${inputId}-confirm-variants`
  const warningsId = `${inputId}-confirm-warnings`
  const publicationTitleId = `${inputId}-publication-title`

  if ((phase === 'published' || phase === 'duplicate') && result) {
    const duplicate = phase === 'duplicate'
    return (
      <section
        role="status"
        aria-labelledby={publicationTitleId}
        data-testid={`store-import-${phase}`}
        className={`rounded-2xl border p-5 ${duplicate ? 'border-tertiary-container/25 bg-tertiary-container/[0.06]' : 'border-primary/25 bg-primary/[0.06]'}`}
      >
        <div className="flex items-start gap-3">
          <span className={`material-symbols-outlined text-2xl ${duplicate ? 'text-tertiary-container' : 'text-primary'}`} aria-hidden="true">
            {duplicate ? 'content_copy' : 'check_circle'}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={publicationTitleId} className="font-headline text-lg font-bold text-on-surface">
              {duplicate ? 'Файл уже был опубликован' : 'Данные опубликованы'}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
              {duplicate
                ? 'Повторная загрузка распознана. Данные магазина не изменены и строки не продублированы.'
                : `${result.rowCount.toLocaleString('ru-RU')} строк теперь доступны в Store Control Center.`}
            </p>
            <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2">
                <dt className="text-on-surface-variant">Тип</dt>
                <dd className="mt-1 font-semibold text-on-surface">{kindLabel(result.importKind)}</dd>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2">
                <dt className="text-on-surface-variant">Строк</dt>
                <dd className="mt-1 font-mono text-on-surface">{result.rowCount.toLocaleString('ru-RU')}</dd>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2">
                <dt className="text-on-surface-variant">Запуск</dt>
                <dd className="mt-1 truncate font-mono text-on-surface" title={result.importRunId}>{result.importRunId}</dd>
              </div>
            </dl>
            <a href="/store" className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary">
              Открыть Магазин
              <span className="material-symbols-outlined text-lg" aria-hidden="true">arrow_forward</span>
            </a>
          </div>
        </div>
      </section>
    )
  }

  if (phase === 'publishing') {
    return (
      <section
        aria-busy="true"
        aria-labelledby={publicationTitleId}
        data-testid="store-import-publishing"
        className="rounded-2xl border border-primary/20 bg-primary/[0.05] p-5"
      >
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined animate-spin text-2xl text-primary" aria-hidden="true">progress_activity</span>
          <div>
            <h2 id={publicationTitleId} className="text-sm font-bold text-on-surface">Публикуем проверенные данные…</h2>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              Сервер повторно сверяет исходный файл и выполняет атомарную запись. Не закрывайте страницу.
            </p>
          </div>
        </div>
      </section>
    )
  }

  if (phase === 'error') {
    return (
      <section role="alert" aria-labelledby={publicationTitleId} className="rounded-2xl border border-error/25 bg-error/[0.06] p-5">
        <h2 id={publicationTitleId} className="flex items-center gap-2 text-sm font-bold text-error">
          <span className="material-symbols-outlined text-xl" aria-hidden="true">error</span>
          Публикация не выполнена
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{errorMessage}</p>
        <p className="mt-2 text-xs font-medium text-on-surface">Предыдущие опубликованные данные не изменены.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={onBackToConfiguration} className="min-h-11 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-on-surface">
            Проверить параметры
          </button>
          <button type="button" onClick={onPublish} className="min-h-11 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary">
            Повторить публикацию
          </button>
        </div>
      </section>
    )
  }

  if (phase === 'confirmation' && configurationReady) {
    return (
      <section
        role="dialog"
        aria-labelledby={publicationTitleId}
        aria-describedby={`${publicationTitleId}-description`}
        data-testid="store-import-confirmation"
        className="rounded-2xl border border-primary/25 bg-surface-container p-5 md:p-6"
      >
        <h2 id={publicationTitleId} className="font-headline text-lg font-bold text-on-surface">Подтвердите публикацию</h2>
        <p id={`${publicationTitleId}-description`} className="mt-2 text-sm leading-relaxed text-on-surface-variant">
          Сервер повторно проверит этот же файл. Операция атомарна: при ошибке показатели магазина не изменятся.
        </p>
        <dl className="mt-4 divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] px-4 text-sm">
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-on-surface-variant">Файл</dt>
            <dd className="max-w-[65%] break-all text-right font-semibold text-on-surface">{data.fileName}</dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-on-surface-variant">Будет опубликовано</dt>
            <dd className="font-mono text-on-surface">{data.acceptedRows.toLocaleString('ru-RU')} строк</dd>
          </div>
          {data.quarantinedRows > 0 && (
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-on-surface-variant">Будет исключено</dt>
              <dd className="font-mono text-tertiary-container">{data.quarantinedRows.toLocaleString('ru-RU')} строк</dd>
            </div>
          )}
          {dateRequired && (
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-on-surface-variant">{kind === 'inventory' ? 'Дата остатков' : 'Дата прайса'}</dt>
              <dd className="font-mono text-on-surface">{effectiveDate}</dd>
            </div>
          )}
        </dl>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onBackToConfiguration} className="min-h-11 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-on-surface">
            Назад к параметрам
          </button>
          <button type="button" onClick={onPublish} className="min-h-11 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-on-primary">
            Опубликовать {data.acceptedRows.toLocaleString('ru-RU')} строк
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5" aria-labelledby={publicationTitleId}>
      <h2 id={publicationTitleId} className="font-headline text-lg font-bold text-on-surface">Параметры публикации</h2>
      {!data.ready || data.errors.length > 0 || !kind ? (
        <div className="mt-3 rounded-xl border border-error/20 bg-error/[0.05] p-4" role="alert">
          <p className="text-sm font-bold text-error">Файл не готов к публикации</p>
          <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
            Исправьте блокирующие ошибки и сформируйте новый предпросмотр.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {dateRequired && (
            <div>
              <label htmlFor={dateId} className="text-sm font-bold text-on-surface">
                {kind === 'inventory' ? 'Дата снимка остатков' : 'Дата действия прайса'}
              </label>
              <p id={`${dateId}-help`} className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                {kind === 'inventory'
                  ? 'Обязательная дата, на которую зафиксировано количество на складе.'
                  : 'Обязательная дата, с которой этот прайс считается действующим.'}
              </p>
              <input
                id={dateId}
                type="date"
                required
                aria-required="true"
                aria-describedby={`${dateId}-help`}
                aria-invalid={effectiveDate.length > 0 && !dateReady ? 'true' : undefined}
                value={effectiveDate}
                readOnly={!onEffectiveDateChange}
                onChange={onEffectiveDateChange}
                className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-surface-container px-3 py-2 text-sm text-on-surface sm:max-w-xs"
              />
            </div>
          )}

          {kind !== 'management_period' && (
            <label htmlFor={variantsId} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <input
                id={variantsId}
                type="checkbox"
                checked={confirmVariants}
                readOnly={!onConfirmVariantsChange}
                onChange={onConfirmVariantsChange}
                className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
              />
              <span>
                <span className="block text-sm font-bold text-on-surface">Точное сопоставление вариантов</span>
                <span className="mt-1 block text-xs leading-relaxed text-on-surface-variant">
                  Подтверждаю сопоставление по полному нормализованному названию. Артикул поставщика сохраняется как атрибут, а отсутствующие варианты создаются отдельно.
                </span>
              </span>
            </label>
          )}

          {warningsConfirmationRequired && (
            <label htmlFor={warningsId} className="flex cursor-pointer items-start gap-3 rounded-xl border border-tertiary-container/20 bg-tertiary-container/[0.05] p-4">
              <input
                id={warningsId}
                type="checkbox"
                checked={confirmWarnings}
                readOnly={!onConfirmWarningsChange}
                onChange={onConfirmWarningsChange}
                className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
              />
              <span>
                <span className="block text-sm font-bold text-on-surface">Предупреждения проверены</span>
                <span className="mt-1 block text-xs leading-relaxed text-on-surface-variant">
                  Подтверждаю результат проверки. {data.quarantinedRows > 0
                    ? `${data.quarantinedRows.toLocaleString('ru-RU')} строк карантина будут исключены из публикации.`
                    : 'Предупреждения приняты и не являются блокирующими.'}
                </span>
              </span>
            </label>
          )}

          <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-xs leading-relaxed text-on-surface-variant">
              Будут опубликованы только {data.acceptedRows.toLocaleString('ru-RU')} принятых строк. Исходный файл повторно сверяется на сервере.
            </p>
            <button
              type="button"
              disabled={!configurationReady}
              aria-describedby={!configurationReady ? `${publicationTitleId}-blockers` : undefined}
              onClick={onOpenConfirmation}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Перейти к подтверждению
              <span className="material-symbols-outlined text-lg" aria-hidden="true">arrow_forward</span>
            </button>
          </div>
          {!configurationReady && (
            <p id={`${publicationTitleId}-blockers`} className="text-xs font-medium text-tertiary-container">
              Заполните обязательную дату и отметьте необходимые подтверждения.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function PreviewResult({
  data,
  inputId,
  publication,
}: {
  data: StoreImportPreviewData
  inputId: string
  publication: Omit<PublicationPanelProps, 'data' | 'inputId'>
}) {
  const detected = displayEntries(data.detectedColumns)
  const totals = displayEntries(data.totals)
  const visibleHeaders = data.headers.slice(0, 12)
  const hiddenHeaderCount = Math.max(0, data.headers.length - visibleHeaders.length)

  return (
    <div className="space-y-5" data-testid="store-import-preview-result">
      <section className="rounded-2xl border border-primary/20 bg-primary/[0.05] p-4 md:p-5" aria-labelledby="preview-result-title">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-primary">
              <span className="material-symbols-outlined text-xl" aria-hidden="true">fact_check</span>
              <h2 id="preview-result-title" className="font-headline text-lg font-bold text-on-surface">Предпросмотр готов</h2>
            </div>
            <p className="mt-2 break-all text-sm font-semibold text-on-surface">{data.fileName}</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {kindLabel(data.kind)} · лист {data.sheetName || '—'}
            </p>
          </div>
          <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:min-w-[420px]">
            <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5">
              <dt className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">Файл</dt>
              <dd className="mt-1 truncate font-mono text-on-surface">{data.fileName}</dd>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2.5">
              <dt className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">SHA-256</dt>
              <dd className="mt-1 font-mono text-on-surface" title={data.sha256} aria-label={`SHA-256 ${data.sha256}`}>
                {data.sha256.length > 16 ? `${data.sha256.slice(0, 16)}…` : data.sha256}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="preview-quality-title">
        <h2 id="preview-quality-title" className="font-headline text-lg font-bold text-on-surface">Качество распознавания</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          <article className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4">
            <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">Строк в файле</p>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-on-surface">{data.rowCount.toLocaleString('ru-RU')}</p>
          </article>
          <article className="rounded-2xl border border-primary/20 bg-primary/[0.05] p-4">
            <p className="text-[10px] font-mono uppercase tracking-wider text-primary">Принято</p>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-primary">{data.acceptedRows.toLocaleString('ru-RU')}</p>
          </article>
          <article className={`rounded-2xl border p-4 ${data.quarantinedRows > 0 ? 'border-tertiary-container/25 bg-tertiary-container/[0.06]' : 'border-white/[0.06] bg-surface-container-low'}`}>
            <p className={`text-[10px] font-mono uppercase tracking-wider ${data.quarantinedRows > 0 ? 'text-tertiary-container' : 'text-on-surface-variant'}`}>Карантин</p>
            <p className={`mt-2 font-mono text-2xl font-bold tabular-nums ${data.quarantinedRows > 0 ? 'text-tertiary-container' : 'text-on-surface'}`}>{data.quarantinedRows.toLocaleString('ru-RU')}</p>
          </article>
        </div>
      </section>

      {(data.errors.length > 0 || data.warnings.length > 0) && (
        <section className="grid gap-3 lg:grid-cols-2" aria-label="Замечания проверки">
          {data.errors.length > 0 && (
            <div className="rounded-2xl border border-error/25 bg-error/[0.06] p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold text-error">
                <span className="material-symbols-outlined text-lg" aria-hidden="true">error</span>
                Ошибки ({data.errors.length})
              </h2>
              <ul className="mt-3 space-y-2 text-xs leading-relaxed text-on-surface-variant">
                {data.errors.map((error, index) => <li key={`${index}-${error}`}>• {error}</li>)}
              </ul>
            </div>
          )}
          {data.warnings.length > 0 && (
            <div className="rounded-2xl border border-tertiary-container/25 bg-tertiary-container/[0.06] p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold text-tertiary-container">
                <span className="material-symbols-outlined text-lg" aria-hidden="true">warning</span>
                Предупреждения ({data.warnings.length})
              </h2>
              <ul className="mt-3 space-y-2 text-xs leading-relaxed text-on-surface-variant">
                {data.warnings.map((warning, index) => <li key={`${index}-${warning}`}>• {warning}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {(detected.length > 0 || totals.length > 0) && (
        <section className="grid gap-4 xl:grid-cols-2" aria-label="Распознанные поля и итоги">
          {detected.length > 0 && (
            <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
              <h2 className="font-headline text-base font-bold text-on-surface">Распознанные колонки</h2>
              <dl className="mt-3 divide-y divide-white/[0.05]">
                {detected.map((entry, index) => (
                  <div key={`${index}-${entry.label}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 py-2.5 text-xs">
                    <dt className="break-words text-on-surface-variant">{entry.label}</dt>
                    <dd className="break-words text-right font-mono text-on-surface">{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {totals.length > 0 && (
            <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
              <h2 className="font-headline text-base font-bold text-on-surface">Контрольные итоги</h2>
              <dl className="mt-3 divide-y divide-white/[0.05]">
                {totals.map((entry, index) => (
                  <div key={`${index}-${entry.label}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 py-2.5 text-xs">
                    <dt className="break-words text-on-surface-variant">{entry.label}</dt>
                    <dd className="break-words text-right font-mono tabular-nums text-on-surface">{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5" aria-labelledby="preview-rows-title">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="preview-rows-title" className="font-headline text-lg font-bold text-on-surface">Пример строк</h2>
            <p className="mt-1 text-xs text-on-surface-variant">Это только безопасный предпросмотр, а не запись в базу.</p>
          </div>
          {hiddenHeaderCount > 0 && <p className="text-xs text-on-surface-variant">Скрыто колонок: {hiddenHeaderCount}</p>}
        </div>

        {data.previewRows.length === 0 || visibleHeaders.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-on-surface-variant">
            Строки для предпросмотра не сформированы.
          </div>
        ) : (
          <>
            <div className="mt-4 hidden overflow-x-auto rounded-xl border border-white/[0.06] md:block">
              <table className="min-w-full text-left text-xs">
                <caption className="sr-only">Первые распознанные строк файла {data.fileName}</caption>
                <thead className="bg-surface-container-high text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
                  <tr>
                    {visibleHeaders.map((header, index) => <th key={`${index}-${header}`} scope="col" className="whitespace-nowrap px-3 py-3 font-medium">{header}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {data.previewRows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-white/[0.02]">
                      {visibleHeaders.map((header, columnIndex) => (
                        <td key={`${columnIndex}-${header}`} className="max-w-64 px-3 py-3 align-top text-on-surface">
                          <span className="block max-w-64 break-words" title={formatValue(row[header])}>{formatValue(row[header])}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-3 md:hidden">
              {data.previewRows.map((row, rowIndex) => (
                <article key={rowIndex} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <h3 className="text-[10px] font-mono uppercase tracking-wider text-primary">Строка {rowIndex + 1}</h3>
                  <dl className="mt-2 divide-y divide-white/[0.04]">
                    {visibleHeaders.map((header, columnIndex) => (
                      <div key={`${columnIndex}-${header}`} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 py-2 text-xs">
                        <dt className="break-words text-on-surface-variant">{header}</dt>
                        <dd className="break-words text-right text-on-surface">{formatValue(row[header])}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <PublicationPanel data={data} inputId={inputId} {...publication} />
    </div>
  )
}

export function StoreImportPreviewView({
  phase,
  selectedFileName,
  errorMessage,
  data,
  inputId,
  publishPhase = 'configuration',
  effectiveDate = '',
  confirmVariants = false,
  confirmWarnings = false,
  publishErrorMessage = null,
  publishResult = null,
  inputRef,
  onFileChange,
  onSubmit,
  onReset,
  onEffectiveDateChange,
  onConfirmVariantsChange,
  onConfirmWarningsChange,
  onOpenConfirmation,
  onBackToConfiguration,
  onPublish,
}: StoreImportPreviewViewProps) {
  const uploading = phase === 'uploading'
  const publishing = publishPhase === 'publishing'
  const busy = uploading || publishing
  const liveMessage = publishing
    ? 'Публикуем проверенные данные. Не закрывайте страницу.'
    : publishPhase === 'published'
      ? 'Данные магазина успешно опубликованы.'
      : publishPhase === 'duplicate'
        ? 'Файл уже был опубликован. Данные не изменены.'
        : publishPhase === 'error'
          ? publishErrorMessage ?? 'Публикация не выполнена.'
          : uploading
            ? 'Проверяем файл. Не закрывайте страницу.'
            : phase === 'success'
              ? 'Предпросмотр готов. Данные не сохранены.'
              : errorMessage ?? ''

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-6" aria-describedby={`${inputId}-help`}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="min-w-0">
            <label htmlFor={inputId} className="text-sm font-bold text-on-surface">Файл для проверки</label>
            <p id={`${inputId}-help`} className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              XLS, XLSX или CSV · до 4 МБ. Банковские выписки и документы с персональными данными не загружайте.
            </p>
            <input
              ref={inputRef}
              id={inputId}
              name="file"
              type="file"
              accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              disabled={busy}
              onChange={onFileChange}
              className="mt-3 block min-h-11 w-full rounded-xl border border-white/[0.08] bg-surface-container px-2 py-2 text-sm text-on-surface file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-bold file:text-primary disabled:cursor-wait disabled:opacity-60"
            />
            {selectedFileName && (
              <p className="mt-2 flex items-center gap-1.5 break-all text-xs text-primary">
                <span className="material-symbols-outlined text-base" aria-hidden="true">description</span>
                Выбран: {selectedFileName}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row xl:justify-end">
            {(selectedFileName || data || errorMessage) && (
              <button type="button" onClick={onReset} disabled={busy} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-on-surface-variant hover:border-primary/25 hover:text-on-surface disabled:opacity-50">
                Очистить
              </button>
            )}
            <button type="submit" disabled={!selectedFileName || busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-on-primary transition-transform hover:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
              <span className={`material-symbols-outlined text-lg ${uploading ? 'animate-spin' : ''}`} aria-hidden="true">
                {uploading ? 'progress_activity' : 'preview'}
              </span>
              {uploading ? 'Проверяем…' : 'Показать preview'}
            </button>
          </div>
        </div>
      </form>

      <div className="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</div>

      {errorMessage && (
        <div role="alert" className="rounded-2xl border border-error/25 bg-error/[0.06] p-4 text-sm text-on-surface">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 text-xl text-error" aria-hidden="true">error</span>
            <div>
              <p className="font-bold text-error">Предпросмотр не сформирован</p>
              <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{errorMessage}</p>
              <p className="mt-2 text-xs font-medium text-on-surface">Ничего не было записано в базу.</p>
            </div>
          </div>
        </div>
      )}

      {uploading && (
        <div className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-5" aria-busy="true">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined animate-spin text-2xl text-primary" aria-hidden="true">progress_activity</span>
            <div>
              <p className="text-sm font-bold text-on-surface">Проверяем структуру и итоги</p>
              <p className="mt-1 text-xs text-on-surface-variant">Предпросмотр не публикует и не сохраняет данные.</p>
            </div>
          </div>
        </div>
      )}

      {data && phase === 'success' && (
        <PreviewResult
          data={data}
          inputId={inputId}
          publication={{
            phase: publishPhase,
            effectiveDate,
            confirmVariants,
            confirmWarnings,
            errorMessage: publishErrorMessage,
            result: publishResult,
            onEffectiveDateChange,
            onConfirmVariantsChange,
            onConfirmWarningsChange,
            onOpenConfirmation,
            onBackToConfiguration,
            onPublish,
          }}
        />
      )}

      {!data && !uploading && !errorMessage && (
        <section className="rounded-2xl border border-dashed border-outline-variant/30 px-5 py-12 text-center" aria-label="Предпросмотр ещё не сформирован">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant/40" aria-hidden="true">table_view</span>
          <h2 className="mt-3 font-headline text-lg font-bold text-on-surface">Проверьте файл до импорта</h2>
          <p className="mx-auto mt-1 max-w-lg text-sm leading-relaxed text-on-surface-variant">
            Увидите распознанные колонки, контрольные итоги, ошибки и пример строк. На этом этапе база данных не изменяется.
          </p>
        </section>
      )}
    </div>
  )
}

export default function StoreImportPreview() {
  const router = useRouter()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const idempotencyKeyRef = useRef<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<StoreImportPreviewPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<StoreImportPreviewData | null>(null)
  const [publishPhase, setPublishPhase] = useState<StoreImportPublishPhase>('configuration')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [confirmVariants, setConfirmVariants] = useState(false)
  const [confirmWarnings, setConfirmWarnings] = useState(false)
  const [publishErrorMessage, setPublishErrorMessage] = useState<string | null>(null)
  const [publishResult, setPublishResult] = useState<StoreImportPublishResult | null>(null)

  useEffect(() => () => requestRef.current?.abort(), [])

  function resetPublication() {
    idempotencyKeyRef.current = null
    setPublishPhase('configuration')
    setEffectiveDate('')
    setConfirmVariants(false)
    setConfirmWarnings(false)
    setPublishErrorMessage(null)
    setPublishResult(null)
  }

  function invalidatePublicationAttempt() {
    idempotencyKeyRef.current = null
    setPublishPhase('configuration')
    setPublishErrorMessage(null)
    setPublishResult(null)
  }

  function reset() {
    requestRef.current?.abort()
    requestRef.current = null
    setFile(null)
    setData(null)
    setErrorMessage(null)
    setPhase('idle')
    resetPublication()
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    requestRef.current?.abort()
    requestRef.current = null
    const nextFile = event.currentTarget.files?.[0] ?? null
    setData(null)
    setErrorMessage(null)
    setPhase('idle')
    resetPublication()
    if (!nextFile) {
      setFile(null)
      return
    }
    const validationError = localFileError(nextFile)
    if (validationError) {
      setFile(null)
      setErrorMessage(validationError)
      setPhase('error')
      event.currentTarget.value = ''
      return
    }
    setFile(nextFile)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || phase === 'uploading' || publishPhase === 'publishing') return

    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    setPhase('uploading')
    setErrorMessage(null)
    setData(null)
    resetPublication()

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('/api/v1/store/imports/preview', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      })

      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        // A status-specific, user-safe message is shown below.
      }

      if (!response.ok) {
        if (requestRef.current !== controller) return
        setErrorMessage(storeImportErrorMessage(response.status))
        setPhase('error')
        return
      }

      if (!isRecord(body) || body.ok !== true || !isPreviewData(body.data)) {
        if (requestRef.current !== controller) return
        setErrorMessage('Сервер вернул неполный результат. Данные не сохранены; повторите проверку.')
        setPhase('error')
        return
      }

      if (requestRef.current !== controller) return
      setData(body.data)
      setPhase('success')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setErrorMessage('Нет соединения с сервером. Данные не сохранены; проверьте сеть и повторите.')
      setPhase('error')
    } finally {
      if (requestRef.current === controller) requestRef.current = null
    }
  }

  function handleEffectiveDateChange(event: ChangeEvent<HTMLInputElement>) {
    setEffectiveDate(event.currentTarget.value)
    invalidatePublicationAttempt()
  }

  function handleConfirmVariantsChange(event: ChangeEvent<HTMLInputElement>) {
    setConfirmVariants(event.currentTarget.checked)
    invalidatePublicationAttempt()
  }

  function handleConfirmWarningsChange(event: ChangeEvent<HTMLInputElement>) {
    setConfirmWarnings(event.currentTarget.checked)
    invalidatePublicationAttempt()
  }

  function openConfirmation() {
    if (!data || !publicationCanProceed(
      data,
      effectiveDate,
      confirmVariants,
      confirmWarnings,
    )) return
    setPublishErrorMessage(null)
    setPublishPhase('confirmation')
  }

  function backToConfiguration() {
    setPublishErrorMessage(null)
    setPublishPhase('configuration')
  }

  async function publish() {
    if (
      !file
      || !data
      || publishPhase === 'publishing'
      || !publicationCanProceed(data, effectiveDate, confirmVariants, confirmWarnings)
    ) return

    const kind = canonicalImportKind(data.kind)
    if (!kind) return

    let idempotencyKey = idempotencyKeyRef.current
    if (!idempotencyKey) {
      if (typeof globalThis.crypto?.randomUUID !== 'function') {
        setPublishErrorMessage('Браузер не поддерживает безопасный ключ публикации. Обновите браузер и повторите.')
        setPublishPhase('error')
        return
      }
      idempotencyKey = globalThis.crypto.randomUUID()
      idempotencyKeyRef.current = idempotencyKey
    }

    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    setPublishErrorMessage(null)
    setPublishResult(null)
    setPublishPhase('publishing')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('expectedSha256', data.sha256)
    formData.append('expectedNormalizedSha256', data.normalizedSha256)
    formData.append('expectedKind', kind)
    formData.append('expectedAcceptedRows', String(data.acceptedRows))
    formData.append('expectedQuarantinedRows', String(data.quarantinedRows))
    formData.append('expectedSchemaVersion', String(data.schemaVersion))
    formData.append('effectiveDate', effectiveDate)
    formData.append('confirmVariants', String(confirmVariants))
    formData.append('confirmWarnings', String(confirmWarnings))

    try {
      const response = await fetch('/api/v1/store/imports/publish', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: formData,
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      })

      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        // A status-specific, user-safe message is shown below.
      }

      if (!response.ok) {
        if (requestRef.current !== controller) return
        const code = isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string'
          ? body.error.code
          : ''
        setPublishErrorMessage(storeImportPublishErrorMessage(response.status, code))
        setPublishPhase('error')
        return
      }

      if (!isRecord(body) || body.ok !== true || !isPublishResult(body.data)) {
        if (requestRef.current !== controller) return
        setPublishErrorMessage('Сервер вернул неполный результат. Проверьте историю импорта перед повтором.')
        setPublishPhase('error')
        return
      }

      if (requestRef.current !== controller) return
      setPublishResult(body.data)
      setPublishPhase(body.data.outcome)
      router.refresh()
    } catch (publishError) {
      if (publishError instanceof DOMException && publishError.name === 'AbortError') return
      setPublishErrorMessage('Нет соединения с сервером. Повтор сохранит тот же безопасный ключ и не создаст дубли.')
      setPublishPhase('error')
    } finally {
      if (requestRef.current === controller) requestRef.current = null
    }
  }

  return (
    <StoreImportPreviewView
      phase={phase}
      selectedFileName={file?.name ?? null}
      errorMessage={errorMessage}
      data={data}
      inputId={inputId}
      publishPhase={publishPhase}
      effectiveDate={effectiveDate}
      confirmVariants={confirmVariants}
      confirmWarnings={confirmWarnings}
      publishErrorMessage={publishErrorMessage}
      publishResult={publishResult}
      inputRef={inputRef}
      onFileChange={handleFileChange}
      onSubmit={handleSubmit}
      onReset={reset}
      onEffectiveDateChange={handleEffectiveDateChange}
      onConfirmVariantsChange={handleConfirmVariantsChange}
      onConfirmWarningsChange={handleConfirmWarningsChange}
      onOpenConfirmation={openConfirmation}
      onBackToConfiguration={backToConfiguration}
      onPublish={publish}
    />
  )
}
