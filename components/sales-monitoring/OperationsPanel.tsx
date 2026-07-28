'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { toast } from '@/stores/ui.store'
import type { AssistantAnswer } from '@/types/sales-monitoring'
import {
  apiRequest,
  browserStorage,
  clearDurableOperation,
  continueDurableOperation,
  createDurableOperation,
  fieldClass,
  formDraftStorageKey,
  labelClass,
  money,
  readDurableOperation,
  readStoredJson,
  removeStoredValue,
  today,
  writeDurableOperation,
  writeStoredJson,
  type SalesMonitoringContext,
  type SalesOrganization,
} from './client'

type OperationsTab = 'expenses' | 'plans' | 'import' | 'assistant'

interface ExpenseDraft {
  version: 1
  operationType: string
  documentDate: string
  paymentDate: string
  categoryId: string
  costCenterId: string
  amount: string
  supplier: string
  comment: string
}

interface ExpenseCreatePayload {
  organizationId: string
  operationType: string
  documentDate: string
  paymentDate?: string
  categoryId: string
  costCenterId?: string
  amount: string
  currency: string
  supplier?: string
  comment?: string
}

interface PlanDraft {
  version: 1
  periodStart: string
  periodEnd: string
  regionId: string
  revenue: string
  grossProfit: string
  quantity: string
}

interface PlanCreatePayload {
  organizationId: string
  periodStart: string
  periodEnd: string
  currency: string
  lines: Array<{
    regionId?: string
    revenueTarget: string
    grossProfitTarget: string
    quantityTarget: string
  }>
}

export function OperationsPanel(props: {
  tab: OperationsTab
  organization: SalesOrganization
  context: SalesMonitoringContext
  onChanged: () => void
}) {
  if (props.tab === 'expenses') return <ExpensePanel {...props} />
  if (props.tab === 'plans') return <PlanPanel {...props} />
  if (props.tab === 'import') return <ImportPanel {...props} />
  return <AssistantPanel {...props} />
}

function ExpensePanel({ organization, context, onChanged }: Omit<Parameters<typeof OperationsPanel>[0], 'tab'>) {
  const categories = context.categories.filter((item) => item.organization_id === organization.id)
  const costCenters = context.costCenters.filter((item) => item.organization_id === organization.id)
  const [loading, setLoading] = useState(false)
  const [operationType, setOperationType] = useState('operating_expense')
  const [documentDate, setDocumentDate] = useState(today)
  const [paymentDate, setPaymentDate] = useState(today)
  const [categoryId, setCategoryId] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [amount, setAmount] = useState('')
  const [supplier, setSupplier] = useState('')
  const [comment, setComment] = useState('')
  const submittingRef = useRef(false)
  const suppressDraftSaveRef = useRef(false)
  const draftKey = formDraftStorageKey(organization.id, 'expense')
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null)

  useEffect(() => {
    const saved = readStoredJson<ExpenseDraft>(browserStorage(), draftKey)
    if (saved?.version === 1) {
      setOperationType(saved.operationType)
      setDocumentDate(saved.documentDate)
      setPaymentDate(saved.paymentDate)
      setCategoryId(saved.categoryId)
      setCostCenterId(saved.costCenterId)
      setAmount(saved.amount)
      setSupplier(saved.supplier)
      setComment(saved.comment)
    } else {
      setOperationType('operating_expense')
      setDocumentDate(today())
      setPaymentDate(today())
      setCategoryId('')
      setCostCenterId('')
      setAmount('')
      setSupplier('')
      setComment('')
    }
    setHydratedDraftKey(draftKey)
  }, [draftKey])

  useEffect(() => {
    if (hydratedDraftKey !== draftKey) return
    if (suppressDraftSaveRef.current) {
      suppressDraftSaveRef.current = false
      return
    }
    writeStoredJson(browserStorage(), draftKey, {
      version: 1,
      operationType,
      documentDate,
      paymentDate,
      categoryId,
      costCenterId,
      amount,
      supplier,
      comment,
    } satisfies ExpenseDraft)
  }, [
    amount,
    categoryId,
    comment,
    costCenterId,
    documentDate,
    draftKey,
    hydratedDraftKey,
    operationType,
    paymentDate,
    supplier,
  ])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submittingRef.current) return

    const storage = browserStorage()
    let operation = readDurableOperation<ExpenseCreatePayload>(
      storage,
      organization.id,
      'expense',
    )
    let durableRetryAvailable = operation !== null
    if (!operation && !categoryId) return toast.warning('Выберите статью расхода')

    submittingRef.current = true
    setLoading(true)
    try {
      if (!operation) {
        const draft: ExpenseDraft = {
          version: 1,
          operationType,
          documentDate,
          paymentDate,
          categoryId,
          costCenterId,
          amount,
          supplier,
          comment,
        }
        const payload: ExpenseCreatePayload = {
          organizationId: organization.id,
          operationType,
          documentDate,
          paymentDate: ['write_off', 'adjustment', 'depreciation'].includes(operationType) ? undefined : paymentDate,
          categoryId,
          costCenterId: costCenterId || undefined,
          amount: normalizeMoney(amount),
          currency: organization.currency,
          supplier: supplier || undefined,
          comment: comment || undefined,
        }
        operation = createDurableOperation(
          organization.id,
          'expense',
          payload,
        )
        if (
          !writeStoredJson(storage, draftKey, draft)
          || !writeDurableOperation(storage, operation)
        ) {
          throw new Error('Не удалось надёжно сохранить операцию в браузере; отправка отменена')
        }
        durableRetryAvailable = true
      } else {
        toast.info(
          'Безопасно повторяем расход',
          'Продолжаем сохранённую операцию с теми же ключами — новый расход не создастся.',
        )
      }

      const posted = await continueDurableOperation(
        storage,
        operation,
        (payload, key) => apiRequest<{ id: string }>('/api/v1/expenses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify(payload),
        }),
        (expenseId, key) => apiRequest<{ id: string; amount: string }>(
          `/api/v1/expenses/${expenseId}/post?organizationId=${encodeURIComponent(organization.id)}`,
          {
            method: 'POST',
            headers: { 'Idempotency-Key': key },
          },
        ),
      )
      clearDurableOperation(storage, organization.id, 'expense')
      removeStoredValue(storage, draftKey)
      suppressDraftSaveRef.current = true
      toast.success('Расход проведён', money(posted.amount, organization.currency))
      setOperationType('operating_expense')
      setDocumentDate(today())
      setPaymentDate(today())
      setCategoryId('')
      setCostCenterId('')
      setAmount('')
      setSupplier('')
      setComment('')
      onChanged()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
      toast.error(
        'Расход не проведён',
        durableRetryAvailable
          ? `${message}. Состояние сохранено: повторите отправку, чтобы безопасно продолжить без дубля.`
          : `${message}. Запрос не был отправлен; проверьте доступ к хранилищу браузера и повторите.`,
      )
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <h2 className="font-headline text-xl font-bold">Новый расход</h2>
        <p className="mt-1 text-sm text-on-surface-variant">P&amp;L и ДДС обновляются по типу движения</p>
        <form onSubmit={submit} className="mt-6 grid gap-4 md:grid-cols-2">
          <Select label="Тип движения" value={operationType} onChange={setOperationType} options={[
            ['operating_expense', 'Операционный расход'], ['write_off', 'Списание'],
            ['owner_payment', 'Выплата учредителю'], ['tax', 'Налог'],
            ['capital_expense', 'Капитальный расход'], ['internal_transfer', 'Внутренний перевод'],
            ['adjustment', 'Корректировка'], ['depreciation', 'Амортизация'],
          ]} />
          <Select label="Статья расхода" value={categoryId} onChange={setCategoryId} options={categories.map((item) => [item.id, item.name])} placeholder="Выберите из справочника" />
          <label><span className={labelClass}>Дата документа</span><input className={fieldClass} type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} required /></label>
          <label><span className={labelClass}>Дата оплаты</span><input className={fieldClass} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></label>
          <Select label="Центр затрат" value={costCenterId} onChange={setCostCenterId} options={costCenters.map((item) => [item.id, item.name])} placeholder="Вся компания" />
          <label><span className={labelClass}>Сумма, {organization.currency}</span><input className={fieldClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label><span className={labelClass}>Поставщик</span><input className={fieldClass} value={supplier} onChange={(e) => setSupplier(e.target.value)} /></label>
          <label><span className={labelClass}>Комментарий</span><input className={fieldClass} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          <div className="md:col-span-2 flex justify-end"><Button type="submit" loading={loading} leftIcon="task_alt">Провести расход</Button></div>
        </form>
      </Card>
      <Card>
        <h3 className="font-headline text-lg font-bold">Финансовое влияние</h3>
        <div className="mt-5 space-y-3 text-sm">
          <Effect label="Аренда / зарплата / налог" pnl="Да" cash="Да" />
          <Effect label="Выплата учредителю" pnl="Нет" cash="Да" />
          <Effect label="Внутренний перевод" pnl="Нет" cash="Между счетами" />
          <Effect label="Амортизация" pnl="Да" cash="Нет" />
          <Effect label="Капитальный расход" pnl="Не сразу" cash="Да" />
        </div>
      </Card>
    </div>
  )
}

function PlanPanel({ organization, context, onChanged }: Omit<Parameters<typeof OperationsPanel>[0], 'tab'>) {
  const regions = context.regions.filter((item) => item.organization_id === organization.id)
  const [loading, setLoading] = useState(false)
  const [periodStart, setPeriodStart] = useState(() => `${today().slice(0, 7)}-01`)
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd)
  const [regionId, setRegionId] = useState('')
  const [revenue, setRevenue] = useState('')
  const [grossProfit, setGrossProfit] = useState('')
  const [quantity, setQuantity] = useState('')
  const submittingRef = useRef(false)
  const suppressDraftSaveRef = useRef(false)
  const draftKey = formDraftStorageKey(organization.id, 'plan')
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null)

  useEffect(() => {
    const saved = readStoredJson<PlanDraft>(browserStorage(), draftKey)
    if (saved?.version === 1) {
      setPeriodStart(saved.periodStart)
      setPeriodEnd(saved.periodEnd)
      setRegionId(saved.regionId)
      setRevenue(saved.revenue)
      setGrossProfit(saved.grossProfit)
      setQuantity(saved.quantity)
    } else {
      setPeriodStart(`${today().slice(0, 7)}-01`)
      setPeriodEnd(defaultPeriodEnd())
      setRegionId('')
      setRevenue('')
      setGrossProfit('')
      setQuantity('')
    }
    setHydratedDraftKey(draftKey)
  }, [draftKey])

  useEffect(() => {
    if (hydratedDraftKey !== draftKey) return
    if (suppressDraftSaveRef.current) {
      suppressDraftSaveRef.current = false
      return
    }
    writeStoredJson(browserStorage(), draftKey, {
      version: 1,
      periodStart,
      periodEnd,
      regionId,
      revenue,
      grossProfit,
      quantity,
    } satisfies PlanDraft)
  }, [
    draftKey,
    grossProfit,
    hydratedDraftKey,
    periodEnd,
    periodStart,
    quantity,
    regionId,
    revenue,
  ])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submittingRef.current) return

    const storage = browserStorage()
    let operation = readDurableOperation<PlanCreatePayload>(
      storage,
      organization.id,
      'plan',
    )
    let durableRetryAvailable = operation !== null

    submittingRef.current = true
    setLoading(true)
    try {
      if (!operation) {
        const draft: PlanDraft = {
          version: 1,
          periodStart,
          periodEnd,
          regionId,
          revenue,
          grossProfit,
          quantity,
        }
        const payload: PlanCreatePayload = {
          organizationId: organization.id,
          periodStart,
          periodEnd,
          currency: organization.currency,
          lines: [{
            regionId: regionId || undefined,
            revenueTarget: normalizeMoney(revenue),
            grossProfitTarget: normalizeMoney(grossProfit),
            quantityTarget: normalizeQuantity(quantity),
          }],
        }
        operation = createDurableOperation(
          organization.id,
          'plan',
          payload,
        )
        if (
          !writeStoredJson(storage, draftKey, draft)
          || !writeDurableOperation(storage, operation)
        ) {
          throw new Error('Не удалось надёжно сохранить операцию в браузере; отправка отменена')
        }
        durableRetryAvailable = true
      } else {
        toast.info(
          'Безопасно повторяем публикацию плана',
          'Продолжаем сохранённую операцию с теми же ключами — новая версия плана не создастся.',
        )
      }

      const published = await continueDurableOperation(
        storage,
        operation,
        (payload, key) => apiRequest<{ id: string }>('/api/v1/plans', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify(payload),
        }),
        (planId, key) => apiRequest<{ id: string; versionNumber: number }>(
          `/api/v1/plans/${planId}/publish?organizationId=${encodeURIComponent(organization.id)}`,
          {
            method: 'POST',
            headers: { 'Idempotency-Key': key },
          },
        ),
      )
      clearDurableOperation(storage, organization.id, 'plan')
      removeStoredValue(storage, draftKey)
      suppressDraftSaveRef.current = true
      toast.success(`План v${published.versionNumber} опубликован`)
      setPeriodStart(`${today().slice(0, 7)}-01`)
      setPeriodEnd(defaultPeriodEnd())
      setRegionId('')
      setRevenue('')
      setGrossProfit('')
      setQuantity('')
      onChanged()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
      toast.error(
        'План не опубликован',
        durableRetryAvailable
          ? `${message}. Состояние сохранено: повторите отправку, чтобы безопасно продолжить без дубля.`
          : `${message}. Запрос не был отправлен; проверьте доступ к хранилищу браузера и повторите.`,
      )
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <h2 className="font-headline text-xl font-bold">Создание версии плана</h2>
        <p className="mt-1 text-sm text-on-surface-variant">Публикация фиксирует версию; прошлые планы не переписываются</p>
        <form onSubmit={submit} className="mt-6 grid gap-4 md:grid-cols-2">
          <label><span className={labelClass}>Начало периода</span><input className={fieldClass} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required /></label>
          <label><span className={labelClass}>Конец периода</span><input className={fieldClass} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required /></label>
          <Select label="Регион" value={regionId} onChange={setRegionId} options={regions.map((item) => [item.id, item.name])} placeholder="Вся компания" />
          <div />
          <label><span className={labelClass}>План выручки</span><input className={fieldClass} inputMode="decimal" value={revenue} onChange={(e) => setRevenue(e.target.value)} required /></label>
          <label><span className={labelClass}>План валовой прибыли</span><input className={fieldClass} inputMode="decimal" value={grossProfit} onChange={(e) => setGrossProfit(e.target.value)} required /></label>
          <label><span className={labelClass}>План количества</span><input className={fieldClass} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} required /></label>
          <div className="flex items-end justify-end"><Button type="submit" loading={loading} leftIcon="publish">Создать и опубликовать</Button></div>
        </form>
      </Card>
      <Card>
        <h3 className="font-headline text-lg font-bold">Правила версии</h3>
        <ul className="mt-5 space-y-3 text-sm text-on-surface-variant">
          <li>• На период активна одна опубликованная версия.</li>
          <li>• Новая публикация помечает предыдущую как заменённую.</li>
          <li>• Факт сравнивается только с опубликованным планом.</li>
          <li>• Все публикации фиксируются в аудите.</li>
        </ul>
      </Card>
    </div>
  )
}

interface ImportJob {
  id: string
  status: string
  duplicate: boolean
  sheets: string[]
  summary: { total: number; valid: number; warnings: number; errors: number }
}

function ImportPanel({ organization, onChanged }: Omit<Parameters<typeof OperationsPanel>[0], 'tab'>) {
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState('sales')
  const [job, setJob] = useState<ImportJob | null>(null)
  const [loading, setLoading] = useState(false)
  const [partial, setPartial] = useState(false)

  const upload = async (event: FormEvent) => {
    event.preventDefault()
    if (!file) return toast.warning('Выберите Excel или CSV')
    setLoading(true)
    try {
      const form = new FormData()
      form.set('organizationId', organization.id)
      form.set('kind', kind)
      form.set('file', file)
      const result = await apiRequest<ImportJob>('/api/v1/imports', { method: 'POST', body: form })
      setJob(result)
      toast.success(result.duplicate ? 'Этот файл уже загружался' : 'Предварительная проверка завершена')
    } catch (error) {
      toast.error('Файл не обработан', error instanceof Error ? error.message : undefined)
    } finally {
      setLoading(false)
    }
  }

  const commit = async () => {
    if (!job) return
    if (kind !== 'sales') {
      toast.info('Проведение через интерфейс сейчас доступно для продаж; остальные типы профилируются')
      return
    }
    setLoading(true)
    try {
      const result = await apiRequest<{ imported: number; errors: number }>(`/api/v1/imports/${job.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: organization.id, partial }),
      })
      toast.success('Импорт завершён', `Загружено ${result.imported}, ошибок ${result.errors}`)
      onChanged()
    } catch (error) {
      toast.error('Импорт не проведён', error instanceof Error ? error.message : undefined)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
      <Card>
        <h2 className="font-headline text-xl font-bold">Массовый импорт</h2>
        <p className="mt-1 text-sm text-on-surface-variant">Excel — источник миграции, веб-система — источник истины</p>
        <form onSubmit={upload} className="mt-6 space-y-4">
          <Select label="Тип данных" value={kind} onChange={setKind} options={[
            ['sales', 'Продажи'], ['expenses', 'Расходы'], ['plans', 'Планы'], ['master_data', 'Справочники'],
          ]} />
          <label><span className={labelClass}>Файл XLSX, XLS или CSV</span><input className={fieldClass} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></label>
          <Button type="submit" loading={loading} leftIcon="fact_check">Проверить файл</Button>
        </form>
      </Card>
      <Card>
        <h3 className="font-headline text-lg font-bold">Предварительная сверка</h3>
        {!job ? (
          <p className="mt-8 text-sm text-on-surface-variant">После загрузки здесь появятся листы, ошибки, предупреждения и потенциальные дубли.</p>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Summary label="Всего" value={job.summary.total} />
              <Summary label="Готово" value={job.summary.valid} tone="text-primary" />
              <Summary label="Предупреждения" value={job.summary.warnings} tone="text-tertiary-container" />
              <Summary label="Ошибки" value={job.summary.errors} tone="text-error" />
            </div>
            <p className="text-sm text-on-surface-variant">Листы: {job.sheets?.join(', ') || '—'}</p>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />Импортировать корректные строки, даже если есть ошибки</label>
            <Button onClick={commit} loading={loading} disabled={job.status !== 'ready'} leftIcon="database_upload">Провести импорт</Button>
          </div>
        )}
      </Card>
    </div>
  )
}

interface ActionDraft {
  id: string
  checksum: string
  preview: Record<string, unknown>
  status: string
}

function AssistantPanel({ organization }: Omit<Parameters<typeof OperationsPanel>[0], 'tab'>) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null)
  const [conversationId, setConversationId] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [document, setDocument] = useState<File | null>(null)
  const [draftPayload, setDraftPayload] = useState('')
  const [actionType, setActionType] = useState('create_expense')
  const [draft, setDraft] = useState<ActionDraft | null>(null)

  const ask = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    try {
      const result = await apiRequest<AssistantAnswer>('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: organization.id, conversationId, question, filters: {} }),
      })
      setAnswer(result)
      setConversationId(result.conversationId)
    } catch (error) {
      toast.error('AI-аналитик не ответил', error instanceof Error ? error.message : undefined)
    } finally {
      setLoading(false)
    }
  }

  const uploadDocument = async () => {
    if (!document) return
    setLoading(true)
    try {
      const form = new FormData()
      form.set('organizationId', organization.id)
      form.set('file', document)
      await apiRequest('/api/v1/knowledge/documents', { method: 'POST', body: form })
      toast.success('Документ поставлен на индексацию')
      setDocument(null)
    } catch (error) {
      toast.error('Документ не загружен', error instanceof Error ? error.message : undefined)
    } finally {
      setLoading(false)
    }
  }

  const createDraft = async () => {
    try {
      const payload = JSON.parse(draftPayload)
      const result = await apiRequest<ActionDraft>('/api/v1/assistant/action-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: organization.id, conversationId, actionType, payload }),
      })
      setDraft(result)
      toast.info('Черновик подготовлен — проверьте и подтвердите')
    } catch (error) {
      toast.error('Черновик не создан', error instanceof Error ? error.message : 'Проверьте JSON')
    }
  }

  const confirmDraft = async () => {
    if (!draft) return
    try {
      await apiRequest(`/api/v1/assistant/action-drafts/${draft.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: organization.id, checksum: draft.checksum }),
      })
      toast.success('Действие выполнено после подтверждения')
      setDraft(null)
    } catch (error) {
      toast.error('Действие не выполнено', error instanceof Error ? error.message : undefined)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <h2 className="font-headline text-xl font-bold">AI-аналитик с источниками</h2>
        <p className="mt-1 text-sm text-on-surface-variant">Финансовые ответы опираются на SQL-ledger; документы приводятся с цитатами</p>
        <form onSubmit={ask} className="mt-5 space-y-3">
          <textarea className={`${fieldClass} min-h-28`} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Почему валовая прибыль ниже плана? Какие товары требуют внимания?" required />
          <Button type="submit" loading={loading} leftIcon="auto_awesome">Спросить</Button>
        </form>
        {answer && (
          <div className="mt-5 rounded-xl border border-primary/15 bg-primary/[0.03] p-5">
            <p className="whitespace-pre-wrap text-sm leading-6">{answer.answer}</p>
            <div className="mt-5 border-t border-white/[0.06] pt-4">
              <p className="text-xs uppercase tracking-wider text-on-surface-variant">Источники · на {new Date(answer.asOf).toLocaleString('ru-KZ')}</p>
              <ol className="mt-2 space-y-2 text-xs text-on-surface-variant">
                {answer.citations.map((citation, index) => <li key={`${citation.sourceId}-${index}`}>[{index + 1}] {citation.label}{citation.excerpt ? ` — ${citation.excerpt}` : ''}</li>)}
              </ol>
            </div>
          </div>
        )}
      </Card>
      <div className="space-y-5">
        <Card>
          <h3 className="font-headline text-lg font-bold">База знаний</h3>
          <p className="mt-1 text-xs text-on-surface-variant">PDF, DOCX, XLSX, CSV, TXT · до 50 МБ</p>
          <input className={`${fieldClass} mt-4`} type="file" accept=".pdf,.docx,.xlsx,.xls,.csv,.txt" onChange={(e) => setDocument(e.target.files?.[0] ?? null)} />
          <Button className="mt-3" variant="secondary" loading={loading} onClick={uploadDocument} disabled={!document}>Индексировать</Button>
        </Card>
        <Card>
          <h3 className="font-headline text-lg font-bold">Подтверждаемое действие</h3>
          <p className="mt-1 text-xs text-on-surface-variant">AI не записывает операции без явного подтверждения</p>
          <select className={`${fieldClass} mt-4`} value={actionType} onChange={(e) => setActionType(e.target.value)}>
            <option value="create_expense">Создать расход</option><option value="create_sale">Создать продажу</option><option value="create_plan">Создать план</option><option value="create_product_request">Запросить товар</option>
          </select>
          <textarea className={`${fieldClass} mt-3 min-h-28 font-mono text-xs`} value={draftPayload} onChange={(e) => setDraftPayload(e.target.value)} placeholder='{"organizationId":"...","amount":"1000.00", ...}' />
          <Button className="mt-3" variant="secondary" onClick={createDraft}>Подготовить черновик</Button>
          {draft && (
            <div className="mt-4 rounded-lg border border-tertiary-container/30 p-3">
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(draft.preview, null, 2)}</pre>
              <Button className="mt-3" onClick={confirmDraft}>Подтвердить и выполнить</Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Select({ label, value, onChange, options, placeholder }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[][]
  placeholder?: string
}) {
  return <label><span className={labelClass}>{label}</span><select className={fieldClass} value={value} onChange={(e) => onChange(e.target.value)}><option value="">{placeholder ?? 'Выберите'}</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
}

function Effect({ label, pnl, cash }: { label: string; pnl: string; cash: string }) {
  return <div className="grid grid-cols-[1fr_60px_90px] gap-2 border-b border-white/[0.05] pb-3"><span>{label}</span><span className="text-center">{pnl}</span><span className="text-right">{cash}</span></div>
}

function Summary({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-lg bg-surface-container-high p-3"><p className="text-xs text-on-surface-variant">{label}</p><p className={`mt-1 font-headline text-xl font-bold ${tone}`}>{value}</p></div>
}

function normalizeMoney(value: string) {
  const amount = Number(String(value).replace(',', '.'))
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00'
}

function normalizeQuantity(value: string) {
  const amount = Number(String(value).replace(',', '.'))
  return Number.isFinite(amount) ? String(amount) : '0'
}

function defaultPeriodEnd() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10)
}
