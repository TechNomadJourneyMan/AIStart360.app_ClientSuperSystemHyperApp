# Changelog — Metrics Dashboard v2

## [2.0.0] — 2026-04-05

### Новые файлы

| Файл | Описание |
|---|---|
| `types/periods.ts` | Единый enum периодов `1W \| 1M \| 3M \| 1Y \| 3Y` с `PERIOD_CONFIG` (granularity, labelRu, showForecast) — единственный источник истины для FE и BE |
| `types/metrics.ts` | Типы `MetricSummary`, `TimeseriesPoint`, `ForecastPoint`, `ChartPoint`, `AnomalyPoint`, `MetricGoal`, `MetricBreakdown`, `DataLayer` |
| `stores/metrics.store.ts` | Zustand-стор: `visibleMetricIds`, `hiddenMetricIds`, `activeMetricId`, `selectedPeriod`, `activeLayers`. Персистируется в localStorage (`aistart360-metrics`). Actions: add/remove/hide/show/reorder/setPeriod/toggleLayer |
| `hooks/useMetrics.ts` | React Query хуки `useMetrics()` и `useMetricsCatalog()` |
| `hooks/useTimeseries.ts` | React Query хуки `useTimeseries()`, `useForecast()`, `useMetricGoal()`, `useAnomalies()` |
| `app/api/v1/metrics/route.ts` | `GET /api/v1/metrics` — список 4 метрик с реальными данными из БД (fallback mock) |
| `app/api/v1/metrics/catalog/route.ts` | `GET /api/v1/metrics/catalog` — каталог 16 метрик для AddMetricModal |
| `app/api/v1/metrics/[id]/timeseries/route.ts` | `GET /api/v1/metrics/[id]/timeseries?period=1M` — временной ряд с автоагрегацией по granularity (day/week/month/quarter) |
| `app/api/v1/metrics/[id]/forecast/route.ts` | `GET /api/v1/metrics/[id]/forecast?period=3M` — прогноз (только при `showForecast=true`, т.е. 3M/1Y/3Y) |
| `app/api/v1/metrics/[id]/goals/route.ts` | `GET /api/v1/metrics/[id]/goals` — цель метрики с progress% и trajectory |
| `app/api/v1/metrics/[id]/anomalies/route.ts` | `GET /api/v1/metrics/[id]/anomalies` — аномальные точки с severity и описанием |
| `components/dashboard/AddMetricModal.tsx` | Модал добавления метрик: поиск по каталогу, группировка по категориям, мультиселект, лимит 20 |
| `components/dashboard/LayerToggle.tsx` | Переключатель слоёв данных: Факт / Прогноз / Цель / Сравнение |
| `components/dashboard/MetricModal.tsx` | Новый полноценный модал метрики: header с трендом, goal progress bar, LayerToggle, PeriodSelector (5 периодов), chart с forecast (dashed), goal ReferenceLine, anomaly ReferenceDot, anomaly alerts, skeleton loading |

### Изменённые файлы

| Файл | Что изменено |
|---|---|
| `components/dashboard/KpiCardsGrid.tsx` | Полная переработка: убран prop `kpiData`, данные через `useMetrics()`, управление метриками через `metricsStore`, context menu (скрыть / удалить), кнопка «+ Метрика», EmptyState, skeleton loading, `MetricModal` вместо `ChartModal` |
| `components/dashboard/KpiChart.tsx` | Использует `useTimeseries()` вместо hardcoded DATA; `Period` из `types/periods.ts`; добавлен `avg_check`; 5 периодов вместо 4; skeleton state |
| `components/dashboard/ChartModal.tsx` | Оставлен как legacy-обёртка для совместимости с WidgetGrid; убрано дублирование кода |
| `stores/ui.store.ts` | Удалено `activeChartMetric` и `setActiveChartMetric` (перенесено в `metricsStore`) |
| `app/(dashboard)/dashboard/page.tsx` | Убран prop `kpiData` из `<KpiCardsGrid />` |

### Исправленные баги

| Баг | Файл | Фикс |
|---|---|---|
| Средний чек открывал график «Доход» | `KpiCardsGrid.tsx` | Убран `CHART_METRIC_MAP`, метрика открывается по `metric.id` |
| `activeChartMetric` дублировался в global store и local useState | `ui.store.ts`, `KpiCardsGrid` | Удалён из `uiStore`, весь modal state в `metricsStore` |
| `avg_check` отсутствовал в `METRICS` чарта | `KpiChart.tsx` | Добавлен с цветом `#c9a6ff` |
| Периоды `7d/30d/3m/1y` — несовместимы со стандартом | `KpiChart.tsx` | Заменены на `1W/1M/3M/1Y/3Y` из `types/periods.ts` |
| Все данные чарта хардкожены в компоненте | `KpiChart.tsx` | Заменены real fetch через `useTimeseries()` |

### Архитектурные решения

- **Единый enum периодов** — `Period = '1W' | '1M' | '3M' | '1Y' | '3Y'` в `types/periods.ts` импортируется и FE-компонентами, и BE-роутами. Никаких строковых литералов вне этого файла.
- **Backend агрегирует сам** — клиент передаёт только `period`, backend возвращает `granularity` и уже отформатированные `label` для XAxis.
- **Прогноз только при period ≥ 3M** — флаг `showForecast` в `PERIOD_CONFIG`, проверяется на BE (forecast endpoint) и FE (LayerToggle).
- **Разделение Modal state** — `metricsStore` (глобальный) vs UI-state карточек (локальный useState). `MetricCard` — pure presentational component.
- **React Query** — кэширование 5 минут для timeseries/metrics, 30 минут для catalog. AbortSignal обрабатывается автоматически при быстрых переключениях периода.
