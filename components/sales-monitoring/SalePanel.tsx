'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { toast } from '@/stores/ui.store'
import { Status } from './SalesMonitoringWorkspace'
import {
  apiRequest,
  fieldClass,
  idempotencyKey,
  labelClass,
  money,
  type ContextItem,
  type SalesOrganization,
} from './client'

export interface SaleListItem {
  id: string
  number: string
  status: string
  soldAt: string
  revenueTotal: string
  costTotal: string
  grossProfitTotal: string
  bonusTotal: string
}

interface ProductResult {
  id: string
  product_name: string
  sku: string
  barcode: string | null
  size: string | null
  color: string | null
  availability: string
  recommended_price: string | null
  current_cost: string | null
}

interface Line {
  key: string
  product: ProductResult
  quantity: string
  unitPrice: string
  discountAmount: string
}

export function SalePanel(props: {
  organization: SalesOrganization
  regions: ContextItem[]
  channels: ContextItem[]
  sales: SaleListItem[]
  loading: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [queryText, setQueryText] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [soldAt, setSoldAt] = useState(() => new Date().toISOString().slice(0, 16))
  const [regionId, setRegionId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [negativeReason, setNegativeReason] = useState('')
  const [negativeComment, setNegativeComment] = useState('')
  const [unknownOpen, setUnknownOpen] = useState(false)
  const [unknownSku, setUnknownSku] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const productsQuery = useQuery({
    queryKey: ['product-search', props.organization.id, queryText],
    queryFn: () => apiRequest<ProductResult[]>(
      `/api/v1/products?${new URLSearchParams({
        organizationId: props.organization.id,
        q: queryText,
        limit: '20',
      })}`,
    ),
    enabled: open && queryText.trim().length > 0,
    staleTime: 15_000,
  })

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.code === 'Space') {
        event.preventDefault()
        setOpen(true)
        setTimeout(() => searchRef.current?.focus(), 0)
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'k' && open) {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.ctrlKey && event.key === 'Enter' && open) {
        event.preventDefault()
        formRef.current?.requestSubmit()
      }
      if (event.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const totals = lines.reduce(
    (total, line) => {
      const quantity = Number(line.quantity || 0)
      const revenue = quantity * Number(line.unitPrice || 0) - Number(line.discountAmount || 0)
      const cost = quantity * Number(line.product.current_cost || 0)
      return { revenue: total.revenue + revenue, cost: total.cost + cost }
    },
    { revenue: 0, cost: 0 },
  )
  const grossProfit = totals.revenue - totals.cost

  const addProduct = (product: ProductResult) => {
    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        product,
        quantity: '1',
        unitPrice: product.recommended_price ?? '0.00',
        discountAmount: '0.00',
      },
    ])
    setQueryText('')
    searchRef.current?.focus()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!lines.length) return toast.warning('Добавьте хотя бы один товар')
    if (grossProfit < 0 && (!negativeReason || negativeComment.trim().length < 3)) {
      return toast.warning('Для убыточной продажи нужны причина и комментарий')
    }
    setSubmitting(true)
    try {
      const created = await apiRequest<SaleListItem>('/api/v1/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('sale-create') },
        body: JSON.stringify({
          organizationId: props.organization.id,
          soldAt: new Date(soldAt).toISOString(),
          regionId: regionId || undefined,
          channelId: channelId || undefined,
          currency: props.organization.currency,
          negativeMarginReason: negativeReason || undefined,
          negativeMarginComment: negativeComment || undefined,
          items: lines.map((line) => ({
            productVariantId: line.product.id,
            quantity: line.quantity,
            unitPrice: normalizeMoney(line.unitPrice),
            discountAmount: normalizeMoney(line.discountAmount),
          })),
        }),
      })
      const posted = await apiRequest<SaleListItem>(
        `/api/v1/sales/${created.id}/post?organizationId=${encodeURIComponent(props.organization.id)}`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey('sale-post') },
        },
      )
      toast.success(
        posted.status === 'pending_approval' ? 'Продажа отправлена на согласование' : `Продажа ${posted.number} проведена`,
        `Выручка ${money(posted.revenueTotal, props.organization.currency)}, валовая прибыль ${money(posted.grossProfitTotal, props.organization.currency)}`,
      )
      setLines([])
      setNegativeReason('')
      setNegativeComment('')
      setOpen(false)
      props.onChanged()
    } catch (error) {
      toast.error('Продажу не удалось провести', error instanceof Error ? error.message : undefined)
    } finally {
      setSubmitting(false)
    }
  }

  const requestProduct = async () => {
    try {
      await apiRequest('/api/v1/product-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: props.organization.id,
          sku: unknownSku || undefined,
          name: queryText || undefined,
          comment: 'Создано из формы ежедневной продажи',
        }),
      })
      toast.success('Заявка на товар создана')
      setUnknownOpen(false)
      setUnknownSku('')
    } catch (error) {
      toast.error('Не удалось создать заявку', error instanceof Error ? error.message : undefined)
    }
  }

  const reverse = async (sale: SaleListItem) => {
    const reason = window.prompt(`Причина сторнирования ${sale.number}`)
    if (!reason || reason.trim().length < 3) return
    try {
      await apiRequest(`/api/v1/sales/${sale.id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('sale-reverse') },
        body: JSON.stringify({ organizationId: props.organization.id, reason }),
      })
      toast.success(`Продажа ${sale.number} сторнирована`)
      props.onChanged()
    } catch (error) {
      toast.error('Сторно не выполнено', error instanceof Error ? error.message : undefined)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-headline text-xl font-bold">Журнал продаж</h2>
          <p className="text-sm text-on-surface-variant">Ctrl + Space — новая продажа</p>
        </div>
        <Button leftIcon="add" onClick={() => setOpen((value) => !value)}>Добавить сделку</Button>
      </div>

      {open && (
        <Card className="border border-primary/20">
          <form ref={formRef} onSubmit={submit} className="space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-headline text-lg font-bold">Новая продажа</h3>
                <p className="text-xs text-on-surface-variant">Ctrl + Enter — провести, Esc — закрыть</p>
              </div>
              <Button type="button" size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Закрыть">
                <span className="material-symbols-outlined">close</span>
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label><span className={labelClass}>Дата и время</span><input className={fieldClass} type="datetime-local" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} /></label>
              <label><span className={labelClass}>Регион</span><select className={fieldClass} value={regionId} onChange={(e) => setRegionId(e.target.value)}><option value="">Не указан</option>{props.regions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label><span className={labelClass}>Канал</span><select className={fieldClass} value={channelId} onChange={(e) => setChannelId(e.target.value)}><option value="">Не указан</option>{props.channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </div>
            <div className="relative">
              <label htmlFor="product-search" className={labelClass}>Поиск товара: артикул, штрихкод, название, размер, цвет</label>
              <input id="product-search" ref={searchRef} className={fieldClass} value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder="Ctrl + K — перейти к поиску" />
              {queryText && (
                <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-outline-variant/30 bg-surface-container-high p-2 shadow-modal">
                  {productsQuery.data?.map((product) => (
                    <button key={product.id} type="button" onClick={() => addProduct(product)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/[0.04]">
                      <span><span className="font-medium">{product.product_name}</span><span className="ml-2 font-mono text-xs text-on-surface-variant">{product.sku}</span><span className="block text-xs text-on-surface-variant">{[product.size, product.color].filter(Boolean).join(' · ') || 'Без варианта'}</span></span>
                      <span className="text-right text-sm">{money(product.recommended_price ?? 0, props.organization.currency)}<span className="block text-xs text-on-surface-variant">Себест. {money(product.current_cost ?? 0, props.organization.currency)}</span></span>
                    </button>
                  ))}
                  {!productsQuery.isLoading && !productsQuery.data?.length && (
                    <button type="button" onClick={() => setUnknownOpen(true)} className="w-full rounded-lg px-3 py-4 text-left text-sm text-tertiary-container hover:bg-white/[0.04]">
                      Артикул не найден — запросить добавление товара
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-sm">
                <thead className="text-left text-xs uppercase text-on-surface-variant"><tr><th className="py-2">Товар</th><th>Количество</th><th>Цена</th><th>Скидка</th><th className="text-right">Итого</th><th /></tr></thead>
                <tbody>{lines.map((line) => (
                  <tr key={line.key} className="border-t border-white/[0.05]">
                    <td className="py-3"><span className="font-medium">{line.product.product_name}</span><span className="block font-mono text-xs text-on-surface-variant">{line.product.sku}</span></td>
                    <td><input className={`${fieldClass} w-24`} inputMode="decimal" value={line.quantity} onChange={(e) => setLines((items) => items.map((item) => item.key === line.key ? { ...item, quantity: e.target.value } : item))} /></td>
                    <td><input className={`${fieldClass} w-32`} inputMode="decimal" value={line.unitPrice} onChange={(e) => setLines((items) => items.map((item) => item.key === line.key ? { ...item, unitPrice: e.target.value } : item))} /></td>
                    <td><input className={`${fieldClass} w-28`} inputMode="decimal" value={line.discountAmount} onChange={(e) => setLines((items) => items.map((item) => item.key === line.key ? { ...item, discountAmount: e.target.value } : item))} /></td>
                    <td className="text-right">{money(Number(line.quantity) * Number(line.unitPrice) - Number(line.discountAmount), props.organization.currency)}</td>
                    <td><button type="button" className="text-error" onClick={() => setLines((items) => items.filter((item) => item.key !== line.key))}><span className="material-symbols-outlined">delete</span></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {grossProfit < 0 && (
              <div className="rounded-xl border border-error/30 bg-error/5 p-4">
                <p className="font-medium text-error">Выручка ниже себестоимости на {money(Math.abs(grossProfit), props.organization.currency)}</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label><span className={labelClass}>Причина</span><select className={fieldClass} value={negativeReason} onChange={(e) => setNegativeReason(e.target.value)} required><option value="">Выберите причину</option>{['agreed_sale','stock_clearance','damaged_product','customer_compensation','marketing_campaign','cost_error','other'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                  <label><span className={labelClass}>Комментарий</span><input className={fieldClass} value={negativeComment} onChange={(e) => setNegativeComment(e.target.value)} required /></label>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.05] pt-4">
              <div className="text-sm"><span className="text-on-surface-variant">Выручка:</span> {money(totals.revenue, props.organization.currency)} <span className="ml-4 text-on-surface-variant">Валовая прибыль:</span> <span className={grossProfit < 0 ? 'text-error' : 'text-primary'}>{money(grossProfit, props.organization.currency)}</span></div>
              <Button type="submit" loading={submitting} leftIcon="task_alt">Провести продажу</Button>
            </div>
          </form>
          {unknownOpen && (
            <div className="mt-4 rounded-xl border border-tertiary-container/30 p-4">
              <p className="font-medium">Заявка на добавление товара</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row"><input className={fieldClass} placeholder="Артикул с этикетки" value={unknownSku} onChange={(e) => setUnknownSku(e.target.value)} /><Button type="button" onClick={requestProduct}>Отправить заявку</Button></div>
            </div>
          )}
        </Card>
      )}

      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-surface-container-high text-left text-xs uppercase text-on-surface-variant"><tr><th className="px-5 py-3">Номер</th><th>Дата</th><th>Статус</th><th className="text-right">Выручка</th><th className="text-right">Валовая прибыль</th><th className="px-5" /></tr></thead>
            <tbody>
              {props.sales.map((sale) => (
                <tr key={sale.id} className="border-t border-white/[0.05]">
                  <td className="px-5 py-4 font-mono text-xs">{sale.number}</td><td>{new Date(sale.soldAt).toLocaleString('ru-KZ')}</td><td><Status status={sale.status} /></td><td className="text-right">{money(sale.revenueTotal, props.organization.currency)}</td><td className={`text-right ${Number(sale.grossProfitTotal) < 0 ? 'text-error' : ''}`}>{money(sale.grossProfitTotal, props.organization.currency)}</td><td className="px-5 text-right">{sale.status === 'posted' && props.organization.permissions.includes('sales:reverse') && <Button size="sm" variant="danger" onClick={() => reverse(sale)}>Сторно</Button>}</td>
                </tr>
              ))}
              {!props.loading && !props.sales.length && <tr><td colSpan={6} className="py-14 text-center text-on-surface-variant">Продаж пока нет</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function normalizeMoney(value: string) {
  const amount = Number(String(value).replace(',', '.'))
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00'
}
