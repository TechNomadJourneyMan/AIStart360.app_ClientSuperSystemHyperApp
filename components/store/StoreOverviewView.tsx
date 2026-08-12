import Link from 'next/link'
import type { StoreAlertLevel, StoreOverview } from '@/lib/store/types'
import {
  availabilityLabel,
  formatCompactKzt,
  formatDate,
  formatNumber,
  formatPercent,
  formatPeriod,
} from '@/lib/store/format'

function sourceLabel(data: StoreOverview): string {
  if (data.source === 'operational') return 'Утверждённые отчёты'
  if (data.source === 'myhonor') return 'MyHonor · live'
  return 'Данные не подключены'
}

function alertTone(level: StoreAlertLevel): string {
  if (level === 'critical') return 'border-error/25 bg-error/[0.07] text-error'
  if (level === 'warning') return 'border-tertiary-container/25 bg-tertiary-container/[0.07] text-tertiary-container'
  return 'border-secondary/20 bg-secondary/[0.06] text-secondary'
}

function statusTone(ready: boolean): string {
  return ready
    ? 'border-primary/20 bg-primary/[0.06] text-primary'
    : 'border-white/[0.07] bg-white/[0.025] text-on-surface-variant'
}

interface KpiProps {
  label: string
  value: string
  detail: string
  icon: string
  tone?: 'default' | 'good' | 'warning'
}

function Kpi({ label, value, detail, icon, tone = 'default' }: KpiProps) {
  const toneClass = tone === 'good'
    ? 'text-primary'
    : tone === 'warning'
      ? 'text-tertiary-container'
      : 'text-on-surface'
  return (
    <article className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-on-surface-variant">
            {label}
          </p>
          <p className={`mt-3 truncate font-mono text-2xl font-bold tabular-nums ${toneClass}`}>
            {value}
          </p>
        </div>
        <span className="material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-lg text-on-surface-variant">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">{detail}</p>
    </article>
  )
}

function EmptySection({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-outline-variant/30 px-5 text-center">
      <span className="material-symbols-outlined text-3xl text-on-surface-variant/50">{icon}</span>
      <p className="mt-3 text-sm font-semibold text-on-surface">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-on-surface-variant">{text}</p>
    </div>
  )
}

export function StoreOverviewView({ data }: { data: StoreOverview }) {
  const metrics = data.metrics
  const marginTone = metrics.grossMarginPct !== null && metrics.grossMarginPct >= 40
    ? 'good'
    : metrics.grossMarginPct !== null && metrics.grossMarginPct < 30
      ? 'warning'
      : 'default'
  const dataStatuses = [
    { label: 'Продажи', ready: data.availability.sales, icon: 'receipt_long' },
    { label: 'Остатки', ready: data.availability.inventory, icon: 'inventory_2' },
    { label: 'Прайс', ready: data.availability.prices, icon: 'sell' },
  ]

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/[0.10] via-surface-container-low to-surface-container-low p-5 md:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-primary">
                Store Control Center
              </span>
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-mono text-primary">
                {sourceLabel(data)}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="material-symbols-outlined flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-2xl text-primary">
                storefront
              </span>
              <div className="min-w-0">
                <h1 className="font-headline text-2xl font-extrabold text-on-surface md:text-3xl">
                  Магазин
                </h1>
                <p className="mt-0.5 truncate text-sm text-on-surface-variant">
                  {data.companyName ?? 'Ваш бизнес'} · {formatPeriod(data.period)}
                </p>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Продажи, маржа, цены и остатки в одном проверяемом контуре. Здесь показываются только ваши опубликованные данные и безопасный live-источник MyHonor.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row xl:justify-end">
            <Link
              href="/store/imports"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition-transform hover:scale-[0.99]"
            >
              <span className="material-symbols-outlined text-lg">upload_file</span>
              Проверить файл
            </Link>
            <a
              href="https://myhonor.shop"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:border-primary/30 hover:text-primary"
            >
              Витрина MyHonor
              <span className="material-symbols-outlined text-base">open_in_new</span>
            </a>
          </div>
        </div>

        <div className="relative mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.06] pt-4 text-xs text-on-surface-variant">
          <span className="inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-base">schedule</span>
            Актуально: {formatDate(data.asOf)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-base">verified</span>
            {data.versionLabel ?? 'Нет утверждённой версии'}
          </span>
        </div>
      </header>

      <section aria-labelledby="store-data-status-title" className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="store-data-status-title" className="font-headline text-base font-bold text-on-surface">
              Готовность данных
            </h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              Зелёный статус означает, что источник подключён и участвует в расчётах.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {dataStatuses.map((item) => (
              <div key={item.label} className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 ${statusTone(item.ready)}`}>
                <span className="material-symbols-outlined text-base">{item.ready ? 'check_circle' : item.icon}</span>
                <span className="text-xs font-medium">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="store-kpi-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">Экономика периода</p>
            <h2 id="store-kpi-title" className="mt-1 font-headline text-xl font-bold text-on-surface">Главные показатели</h2>
          </div>
          <p className="hidden text-xs text-on-surface-variant sm:block">{formatPeriod(data.period)}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-3">
          <Kpi label="Выручка" value={formatCompactKzt(metrics.revenue)} detail="После скидок и возвратов" icon="payments" />
          <Kpi label="Валовая прибыль" value={formatCompactKzt(metrics.grossProfit)} detail={metrics.cost === null ? 'Нужна историческая себестоимость' : `Себестоимость: ${formatCompactKzt(metrics.cost)}`} icon="trending_up" tone={metrics.grossProfit !== null && metrics.grossProfit > 0 ? 'good' : 'default'} />
          <Kpi label="Валовая маржа" value={formatPercent(metrics.grossMarginPct)} detail="Валовая прибыль / выручка" icon="percent" tone={marginTone} />
          <Kpi label="Влияние скидок" value={formatCompactKzt(metrics.discount)} detail={metrics.discountRatePct === null ? 'Нет подтверждённого расчёта' : `${formatPercent(metrics.discountRatePct)} от прайсовой выручки`} icon="sell" tone={metrics.discountRatePct !== null && metrics.discountRatePct >= 30 ? 'warning' : 'default'} />
          <Kpi label="Продано единиц" value={formatNumber(metrics.units, 1)} detail={metrics.returns ? `Возвратов: ${formatNumber(metrics.returns, 1)}` : 'С учётом доступных возвратов'} icon="shopping_bag" />
          <Kpi label="Запас по закупу" value={formatCompactKzt(data.inventory.inventoryCost)} detail={data.inventory.availableUnits === null ? 'Остатки ещё не опубликованы' : `Доступно: ${formatNumber(data.inventory.availableUnits, 1)} ед.`} icon="inventory_2" />
        </div>
      </section>

      {data.alerts.length > 0 && (
        <section aria-labelledby="store-alerts-title">
          <div className="mb-3">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-tertiary-container">Требует внимания</p>
            <h2 id="store-alerts-title" className="mt-1 font-headline text-xl font-bold text-on-surface">Что сделать сейчас</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.alerts.map((alert) => (
              <article key={alert.id} className={`rounded-2xl border p-4 ${alertTone(alert.level)}`}>
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-xl">
                    {alert.level === 'critical' ? 'error' : alert.level === 'warning' ? 'warning' : 'info'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-on-surface">{alert.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{alert.description}</p>
                    {alert.actionHref && alert.actionLabel && (
                      <Link href={alert.actionHref} className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-xs font-bold text-current hover:underline">
                        {alert.actionLabel}
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <section aria-labelledby="store-channels-title" className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
          <div className="mb-4">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">Каналы продаж</p>
            <h2 id="store-channels-title" className="mt-1 font-headline text-lg font-bold text-on-surface">Где создаётся прибыль</h2>
          </div>
          {data.channels.length === 0 ? (
            <EmptySection icon="bar_chart" title="Нет данных по каналам" text="После публикации строк продаж здесь появятся магазин, Kaspi и оптовые каналы." />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.06] text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
                    <tr>
                      <th className="px-2 py-3 font-medium">Канал</th>
                      <th className="px-2 py-3 text-right font-medium">Выручка</th>
                      <th className="px-2 py-3 text-right font-medium">Прибыль</th>
                      <th className="px-2 py-3 text-right font-medium">Маржа</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {data.channels.map((channel) => (
                      <tr key={channel.channel} className="table-row-hover">
                        <td className="px-2 py-3 font-medium text-on-surface">{channel.channel}</td>
                        <td className="px-2 py-3 text-right font-mono tabular-nums text-on-surface">{formatCompactKzt(channel.revenue)}</td>
                        <td className="px-2 py-3 text-right font-mono tabular-nums text-on-surface-variant">{formatCompactKzt(channel.grossProfit)}</td>
                        <td className="px-2 py-3 text-right font-mono tabular-nums text-on-surface-variant">{formatPercent(channel.grossMarginPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 md:hidden">
                {data.channels.map((channel) => (
                  <article key={channel.channel} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-on-surface">{channel.channel}</h3>
                      <span className="font-mono text-sm font-bold tabular-nums text-on-surface">{formatCompactKzt(channel.revenue)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-on-surface-variant">
                      <span>Прибыль: {formatCompactKzt(channel.grossProfit)}</span>
                      <span>Маржа: {formatPercent(channel.grossMarginPct)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="store-warehouses-title" className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
          <div className="mb-4">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">Остатки</p>
            <h2 id="store-warehouses-title" className="mt-1 font-headline text-lg font-bold text-on-surface">По складам</h2>
          </div>
          {data.inventory.warehouses.length === 0 ? (
            <EmptySection icon="warehouse" title="Склады ещё не подключены" text="Опубликуйте снимок остатков, чтобы видеть стоимость и распределение запасов." />
          ) : (
            <div className="space-y-2">
              {data.inventory.warehouses.map((warehouse) => (
                <article key={warehouse.warehouse} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-on-surface">{warehouse.warehouse}</h3>
                      <p className="mt-1 text-[10px] text-on-surface-variant">Снимок: {formatDate(warehouse.snapshotDate)}</p>
                    </div>
                    <span className="font-mono text-lg font-bold tabular-nums text-on-surface">{formatNumber(warehouse.available, 1)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-on-surface-variant">
                    <span>единиц доступно</span>
                    <span>{formatCompactKzt(warehouse.inventoryCost)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="store-catalog-title" className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-4 md:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary">Каталог</p>
            <h2 id="store-catalog-title" className="mt-1 font-headline text-lg font-bold text-on-surface">Товары в контуре</h2>
          </div>
          <p className="text-xs text-on-surface-variant">
            Активно {formatNumber(data.catalog.activeProducts)} из {formatNumber(data.catalog.products)}
          </p>
        </div>
        {data.catalog.latest.length === 0 ? (
          <EmptySection icon="category" title="Каталог пуст" text="Синхронизируйте MyHonor или опубликуйте мастер-прайс." />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {data.catalog.latest.map((product) => (
              <article key={product.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-lg text-primary">apparel</span>
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-on-surface">{product.name}</h3>
                    <p className="mt-1 truncate font-mono text-[10px] text-on-surface-variant">{product.sku}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-end justify-between gap-2 border-t border-white/[0.05] pt-3">
                  <span className="font-mono text-sm font-bold tabular-nums text-on-surface">{formatCompactKzt(product.price)}</span>
                  <span className="text-[10px] text-on-surface-variant">{availabilityLabel(product.availability)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {data.limitations.length > 0 && (
        <aside aria-label="Ограничения данных" className="rounded-2xl border border-secondary/15 bg-secondary/[0.04] p-4">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-lg text-secondary">shield_lock</span>
            <div>
              <h2 className="text-sm font-semibold text-on-surface">Что пока не входит в расчёт</h2>
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-on-surface-variant">
                {data.limitations.map((limitation) => <li key={limitation}>• {limitation}</li>)}
              </ul>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
