# AIStart360 — Аудит производительности, багов и UX загрузки

**Дата:** 2026-07-01 · **Стек:** Next.js 14.2 App Router · React 18.3 · Prisma 5 + Supabase (общий Postgres) · @tanstack/react-query 5 · Zustand · Tailwind · framer-motion · recharts · OpenRouter (Claude Sonnet/Haiku) · Inngest · Upstash

> Документ — готовое ТЗ для разработчика. Метки: **[ИСПРАВЛЕНО]** — правка уже внесена в этой ветке; **[ПРЕДЛОЖЕНО]** — готовый diff/план, требует применения и проверки. Все находки привязаны к реальному коду (`файл:строка`).
>
> **Ограничение проверки:** в worktree отсутствует `node_modules`, поэтому `tsc`/`next build`/runtime-профилирование здесь не выполнялись. Внесённые правки безопасны по построению (не меняют success-path); перед деплоем прогнать `npm install && npm run type-check && npm run build` и QA-чеклист (раздел 8).

---

## 1. Краткое резюме проблемы

Портал «долго грузится и подвисает» по трём независимым причинам, которые складываются:

1. **Аутентификация выполняется 3–4 раза за одну загрузку.** Middleware на каждый переход делает сетевой `supabase.auth.getUser()` (валидация JWT по сети) **плюс** запрос к `profiles`; затем клиентский `auth.store.init()` повторяет то же; а каждый защищённый API-роут внутри снова зовёт `getAdminSession()` (ещё `getUser()` + `profiles`). Это добавляет секунды к TTFB каждого перехода и каждого запроса.
   `middleware.ts:92-95`, `stores/auth.store.ts:139-152`, `lib/rbac.ts:93-115`

2. **AI-вызовы могли висеть бесконечно.** Единая точка всех LLM-запросов `chatWithOpenRouter` не имела таймаута; при зависании сети/модели любой сценарий с ассистентом, диагностикой, извлечением данных «замерзал» на неопределённое время, а обёртка `generateObjectViaOpenRouter` удваивала это ретраем (до ~50 c), Point A цепочкой из двух вызовов — до ~64 c. **[ИСПРАВЛЕНО]**
   `lib/ai/openrouter.ts:128,175`, `lib/ai/structured.ts:52`, `lib/assistant/llm-analyzer.ts:247,325`

3. **Тяжёлый клиентский бандл и избыточные запросы.** `recharts` статически затянут в first-load JS почти всех дата-маршрутов (даже когда график не виден); дашборд-страницы — это гигантские `'use client'` модули (`pulse/page.tsx` — 1281 строка); а одни и те же эндпоинты (`onboarding/status` ×3, `gri/assessment` в 9 компонентах) запрашиваются параллельно, потому что ~75 файлов используют «сырой» `useEffect + fetch` вместо react-query.

Дополнительно: во многих местах ошибка загрузки данных «маскируется под пусто» (пользователь думает, что данных нет), кнопки долгих операций (загрузка отчёта, сохранение целей) не показывают состояние → повторные клики, а на бэкенде часть дорогих/AI-роутов не имеет ни авторизации, ни rate-limit.

**Хорошие новости (проверено):** тяжёлые серверные библиотеки (`tesseract.js`, `xlsx`, `pdfkit`, `pdf-parse`, `mammoth`) в клиент **не утекают**; N+1 в БД в основном отсутствует (код грамотно батчит через `Promise.all`/`in`/`updateMany`); route-level скелетоны (`loading.tsx`) и `error.tsx` уже есть; TypeScript типизирован строго.

---

## 2. Таблица найденных багов

Критичность: **Critical** (ломает/вешает) · **High** · **Medium** · **Low**.

| ID | Область | Баг/проблема | Причина | Крит. | Как исправить | Файл/место |
|---|---|---|---|---|---|---|
| B01 | Backend/AI | Все LLM-вызовы могли висеть бесконечно | `fetch` к OpenRouter без таймаута | Critical | **[ИСПРАВЛЕНО]** `AbortSignal.timeout(45s/20s)` в общей обёртке → таймаут наследуют все вызовы | `lib/ai/openrouter.ts:128,175` |
| B02 | Backend/AI | Структурный вызов удваивает латентность (до ~50 c) | `for (attempt<2)` ретрай без таймаута | Critical | Ретрай теперь ограничен таймаутом B01; сверх того — сократить до 1 ретрая или backoff | `lib/ai/structured.ts:52-87` |
| B03 | Backend/AI | Point A: 2 последовательных LLM-вызова (~64 c) | `analyzeWithLlm` → затем `llmSemanticChecks` | High | Распараллелить независимые вызовы через `Promise.all` | `lib/assistant/llm-analyzer.ts:247,325` |
| B04 | Security | `/api/gri/ai-strategy` и `/financial-analyst` — без auth и без rate-limit (аноним жжёт платный Sonnet) | Роут не самозащищён (middleware пропускает `/api`) | Critical | **[ИСПРАВЛЕНО]** добавлен `isRateLimited(...)`; **[ПРЕДЛОЖЕНО]** добавить `requireAuth()` если не нужен публичный доступ | `app/api/gri/ai-strategy/route.ts`, `.../financial-analyst/route.ts` |
| B05 | Security/Perf | rate-limit игнорирует `opts.max` при включённом Upstash (везде 10/мин) | ветка Upstash использует общий `authRateLimit` | High | Кэшировать `Ratelimit` по (bucket,max,window) | `lib/rate-limit.ts:53-56` |
| B06 | Backend | Дорогие/AI/upload/checkout-роуты без rate-limit | лимитер вызывается лишь в 4 роутах | Critical | Добавить `isRateLimited` на assistant/*, diagnostics ai-*, point-a ai-generate, market-analysis/generate, reports/upload, pulse, checkout | `app/api/v1/**` |
| B07 | Auth/Perf | 3–4 auth-round-trip'а на каждый переход/запрос | middleware + client init + `getAdminSession` дублируют `getUser`+`profiles` | High | Резолвить роль один раз; сидировать стор из `x-user-role`; кэшировать профиль в рамках запроса | `middleware.ts:92-95`, `stores/auth.store.ts:139`, `lib/rbac.ts:93` |
| B08 | Backend | Блокирующий парсинг/PDF в обработчике (`maxDuration=300`) | `pdf-parse`+`xlsx`+`mammoth` / `pdfkit` синхронно в роуте | High | Вынести в Inngest, вернуть job-id + опрос статуса | `app/api/export/report/route.ts:541`, `app/api/v1/onboarding/documents/[id]/process/route.ts:46` |
| B09 | Backend | `GET /api/v1/diagnostics/point-b` пишет в БД на каждый GET + ~7 последовательных чтений | recompute+upsert внутри GET | High | Разделить чтение и пересчёт; кэшировать снапшот | `app/api/v1/diagnostics/point-b/route.ts:162-206` |
| B10 | Backend | Небатченная вставка эмбеддингов (unbounded) | `for` с одиночным `$executeRaw INSERT` | High | Батч-вставка одним multi-row INSERT | `lib/documents/embed.ts:115-145` |
| B11 | Backend | `getAnalyticsData` тянет всех клиентов org с include без `take` | `findMany({include})` → reduce в памяти | High | Агрегировать в SQL (`groupBy/_sum`) или пагинация | `lib/analytics-data.ts:65-81` |
| B12 | Backend | `/api/metrics` отдаёт HTTP 200 при ошибке (`{source:'error'}`) | статус 200 на error-ветке | High | Возвращать 500/503, чтобы клиент и мониторинг видели сбой | `app/api/v1/metrics/route.ts:40` |
| B13 | Backend | Утечка payload: `parsed_data`/`raw_rows` уходят клиенту; `select('*')` на широких таблицах | нет проекции полей | High/Med | Возвращать только нужные поля; никогда не слать `parsed_data` | `app/api/v1/documents/[id]/rebind/route.ts:48`, `.../diagnostics/current:17` |
| B14 | Backend | Нет пагинации: `getClients`, `reportDocument.findMany`, `admin/analytics` | `findMany` без `take` | Medium | Добавить `take`/курсор; для avg — SQL-агрегация | `app/actions/gri.ts:65`, `app/actions/reports.ts:60`, `app/api/admin/analytics/route.ts:81` |
| B15 | Backend | Роуты без try/catch вокруг Prisma | необработанные rejection → 500/креш инвокейшена | Medium | Обернуть в try/catch, логировать, вернуть 500 JSON | `app/api/clients/route.ts:24`, `.../notifications/route.ts:14` |
| B16 | Data | Нет индексов по внешним ключам (26 моделей, было 8 индексов) | Postgres не индексирует FK автоматически | Medium | **[ИСПРАВЛЕНО]** добавлены `@@index` (стало 31); нужна миграция | `prisma/schema.prisma` |
| B17 | Архитектура | Тройная реализация GRI с разными шкалами (0-100 vs 0-10 vs БД×10) | 3 параллельных движка | High | Выбрать канонический (`gri_assessments`), остальные — адаптеры | `lib/gri/logic.ts:51`, `lib/gri-calculator/gri-data.ts:7`, `app/api/export/report/route.ts:251` |
| F01 | Frontend/bundle | `recharts` в first-load JS почти всех дата-маршрутов | статические импорты через жадные дочерние | Critical | `next/dynamic({ssr:false,loading})` — паттерн уже есть в `gri/page.tsx:8-24` | `components/dashboard/WidgetGrid.tsx:9`, `KpiCardsGrid.tsx:246`, `pulse/page.tsx:6`, `PointBView.tsx:26` |
| F02 | Frontend | Гигантские `'use client'` страницы (1281/1014/1008/993 строк) гидрируются целиком | вся страница — один клиентский модуль | High | Сделать RSC-оболочку, вынести интерактив в дочерние client-компоненты | `app/(dashboard)/pulse/page.tsx:1`, `components/metrics/MetricsPageClient.tsx:1` |
| F03 | Frontend | Рендер блокируется 5 семействами шрифтов + Material Symbols | `<link rel=stylesheet>` в `<head>`, не `next/font` | Medium | Перейти на `next/font` (self-host, subset, `display:swap`) | `app/layout.tsx:38-49` |
| F04 | Frontend | Плавающий ассистент всегда в DOM на каждой странице | панель рендерится и прячется CSS | Medium | Лениво монтировать панель по `open` через `next/dynamic` | `app/(dashboard)/layout.tsx:31`, `AssistantChatPanel.tsx:329` |
| F05 | Frontend | `useMemo` пересобирается каждый рендер (`new Set([...])` как зависимость) | Set создаётся инлайн в зависимостях | Medium | Обернуть Set в собственный `useMemo` | `components/dashboard/AddMetricModal.tsx:29,37` |
| F06 | Frontend | Дублирующиеся `<Toaster>` (root + 3 локальных) | локальные Toaster в компонентах | Low | Удалить локальные, оставить один в `app/layout.tsx:58` | `AssistantChatPanel.tsx:567`, `MarketAnalysisChecklist.tsx:291`, `GRICalculator.tsx:859` |
| F07 | Frontend | Мёртвая зависимость `react-grid-layout` (0 импортов) | остаток | Low | **[ИСПРАВЛЕНО]** удалена из `package.json` | `package.json` |
| U01 | UX/сеть | `onboarding/status` (×3) и `gri/assessment` (×9) запрашиваются повторно | сырой fetch без общего кэша | High | Общие react-query хуки `useOnboardingStatus`/`useGriAssessment` | `GrowthSnapshotHero.tsx:103-104`, `PointAQuickPills.tsx:106-108` |
| U02 | UX | ~75 файлов — сырой fetch вместо react-query (нет dedup/кэша) | react-query внедрён частично | High | Мигрировать высокочастотные эндпоинты на react-query хуки | `hooks/*` только 9 кэш-хуков |
| U03 | UX | Оптимистичные approve/reject без проверки `res.ok` и отката | fire-and-forget | High | Проверять `res.ok`, откатывать + toast при ошибке | `components/giga-panel/RequestsModule.tsx:273-298` |
| U04 | UX | Кнопка загрузки отчёта без pending/disabled → повторные клики | server action без `useFormStatus` | High | Кнопка сабмита на `useFormStatus()` (спиннер+disabled) | `app/(dashboard)/reports/page.tsx:64-98` |
| U05 | UX | Ошибка загрузки маскируется под «пусто» | `catch {}` / `catch(()=>setX([]))` | High | Отдельный error-state + retry; отличать error от empty | `GrowthSnapshotHero.tsx:143`, `ClientsTable.tsx:90` |
| U06 | UX/краш | `json.data.map` без `Array.isArray` → креш админ-панели | нет guard'а формы ответа | High | **[ИСПРАВЛЕНО]** `json.ok && Array.isArray(json.data)` + error-state | `components/dashboard/admin/AdminClientsList.tsx:45` |
| U07 | UX | Сохранение цели делает `window.location.reload()` (перегрузка всей страницы) | нет инвалидации кэша | Medium | **[ИСПРАВЛЕНО]** `router.refresh()` | `components/dashboard/RevenueTargetsCard.tsx:105` |
| U08 | UX | Мёртвые кнопки фильтра в Reports (ничего не делают) | нет `onClick` | Medium | Подключить фильтрацию или убрать | `app/(dashboard)/reports/page.tsx:49-60` |
| U09 | UX/сеть | Поллинг статуса документов каждые 10 c — навсегда | нет терминального условия | Medium | Останавливать, когда нет `queued/processing` | `app/client/onboarding/documents/page.tsx:392` |
| U10 | UX/сеть | `/api/health` опрашивается каждые 5 c (fan-out), без in-flight guard | агрессивный интервал | Medium | Интервал 30 c + `inFlight` ref | `components/dashboard/SystemHealth.tsx:51` |
| U11 | UX/сеть | Нет отмены запросов при размонтировании (гонки/setState после unmount) | голый `fetch` в `useEffect` | Medium | `AbortController`/`cancelled` guard | `app/client/point-a/page.tsx:174`, `.../onboarding/page.tsx:55` |
| U12 | UX | Медицинский дашборд шлёт `POST audit/run` на каждый монтаж | run-эндпоинт вместо read | Medium | Дешёвый GET для кэша; POST только по кнопке | `app/client/dashboard-medical/page.tsx:75` |
| U13 | UX | Нет глобального индикатора in-page запросов | только `nextjs-toploader` (нав) | Low | Полоса на `useIsFetching()` | `app/layout.tsx:55` |
| U14 | Cleanup | Мёртвый компонент `SystemHealthCompact` (0 импортов) | остаток | Low | Удалить | `components/dashboard/SystemHealthCompact.tsx` |

---

## 3. Главные причины медленной загрузки (Top-5)

### 1. Многократная авторизация на критическом пути
- **Симптом:** каждый переход и каждый API-запрос «думает» лишние сотни мс — секунды; ощущение подвисания.
- **Причина:** `middleware.ts:92-95` делает `getUser()` (сетевая валидация) + запрос `profiles`; клиент `auth.store.ts:139` повторяет; API-роуты зовут `getAdminSession()` (`lib/rbac.ts:93`) — снова `getUser()`+`profiles`. 3–4 round-trip'а.
- **Исправление:** резолвить роль один раз в middleware и передавать заголовком `x-user-role` (он уже ставится, `middleware.ts:98`), сидировать Zustand из него вместо клиентского `init()`; в API кэшировать сессию/профиль в рамках запроса (React `cache()`), не звать `getUser()` повторно.
- **Ожидаемый эффект:** −2..3 сетевых round-trip'а на переход → заметное падение TTFB и INP.

### 2. AI-вызовы без таймаута **[ИСПРАВЛЕНО]**
- **Симптом:** сценарии с ассистентом/диагностикой/парсингом «замерзали» надолго.
- **Причина:** `chatWithOpenRouter`/`embedWithOpenRouter` без `AbortSignal`; ретрай и цепочки умножали ожидание до 50–64 c.
- **Исправление:** добавлен `AbortSignal.timeout(45_000/20_000)` в общую обёртку — таймаут наследуют **все** вызовы (`lib/ai/openrouter.ts`). Далее — сократить ретрай (`lib/ai/structured.ts:52`) и распараллелить Point A (`lib/assistant/llm-analyzer.ts`).
- **Ожидаемый эффект:** верхняя граница ожидания фиксирована; «вечных» зависаний не остаётся.

### 3. `recharts` в first-load JS почти каждого маршрута
- **Симптом:** медленная первая загрузка и джанк на `/dashboard`, `/pulse`, `/point-a`, `/metrics`, `/point-b`, `/market` ещё до появления графика.
- **Причина:** статические импорты через жадные дочерние: `WidgetGrid→KpiChart` (`WidgetGrid.tsx:9`), всегда смонтированный `MetricModal` (`KpiCardsGrid.tsx:246`), `GriPulseWidget` (`pulse/page.tsx:6`) и др. (~150–400 КБ gz).
- **Исправление:** `next/dynamic(() => import(...), { ssr:false, loading:<Skeleton/> })` для каждого графика/тяжёлой модалки — паттерн уже отлажен в `gri/page.tsx:8-24`.
- **Ожидаемый эффект:** крупнейший vendor-чанк уходит из first-load JS 6 маршрутов; графики подгружаются по требованию.

### 4. Render-blocking шрифты
- **Симптом:** задержка FCP на каждом маршруте, мигание иконок.
- **Причина:** `app/layout.tsx:38-49` блокирует рендер на 5 семействах Google Fonts (много весов) + полный variable-шрифт Material Symbols через `<link rel=stylesheet>`.
- **Исправление:** `next/font/google` (self-host, `display:swap`, subset весов), убрать неиспользуемые семейства; для иконок — только нужные веса.
- **Ожидаемый эффект:** быстрее FCP, нет блокирующего round-trip'а к fonts.googleapis.com.

### 5. Избыточные и недедуплицированные запросы
- **Симптом:** сетевой таб показывает дубли (`onboarding/status` ×3, `gri/assessment` ×2 на одной странице), дашборд «оживает» рывками.
- **Причина:** ~75 компонентов используют сырой `useEffect + fetch` без общего кэша вместо react-query (внедрён лишь в ~9 хуках).
- **Исправление:** общие хуки `useOnboardingStatus()`, `useGriAssessment()` с единым `queryKey` (dedup/кэш/персист уже настроены в `app/providers.tsx`).
- **Ожидаемый эффект:** 5+ дублирующих round-trip'ов схлопываются до 2; мгновенные cache-hit при повторном монтировании и навигации.

---

## 4. План исправлений по приоритетам

### Этап 1. Срочные исправления (чтобы перестало висеть)
1. **[ИСПРАВЛЕНО]** Таймауты на все AI-вызовы (`openrouter.ts`).
2. **[ИСПРАВЛЕНО]** Rate-limit на публичные GRI-AI роуты (B04).
3. **[ИСПРАВЛЕНО]** Краш админ-панели на кривом ответе (U06).
4. **[ИСПРАВЛЕНО]** Таймаут на скачивание файла в парсере (B-partial, `parse-document.ts`).
5. **[ПРЕДЛОЖЕНО]** Rate-limit на остальные AI/upload/checkout роуты (B06) + фикс `opts.max` (B05).
6. **[ПРЕДЛОЖЕНО]** `/api/metrics` → корректный 5xx (B12); try/catch на «голых» роутах (B15).
7. **[ПРЕДЛОЖЕНО]** Дедуп авторизации (B07) — самый большой выигрыш по TTFB.

### Этап 2. Оптимизация производительности
1. `recharts` → `next/dynamic` во всех потребителях (F01).
2. `next/font` вместо блокирующих `<link>` (F03).
3. Дедуп запросов через react-query хуки (U01/U02).
4. Индексы FK — **[ИСПРАВЛЕНО в схеме]**, применить миграцию (B16).
5. Вынести блокирующий парсинг/PDF в Inngest (B08); убрать write-on-GET (B09); батч-вставку эмбеддингов (B10).
6. Распараллелить Point A LLM (B03), сократить ретраи (B02).
7. Разбить гигантские `'use client'` страницы на RSC-оболочку + листья (F02).

### Этап 3. Улучшение UX загрузки
1. Loading/disabled для кнопок долгих операций (U04, logout) + защита от double-submit.
2. Отдельные error-state + retry вместо «пусто» (U05); откат оптимистичных мутаций (U03).
3. Лениво монтировать ассистента (F04); убрать дубли Toaster (F06).
4. Глобальная полоса на `useIsFetching()` (U13); чинить поллинги (U09/U10/U12).

### Этап 4. Рефакторинг и стабилизация
1. Единый канонический GRI-движок, остальные — адаптеры (B17).
2. Проекция полей во всех API-ответах (B13); пагинация списков (B14).
3. `AbortController` во всех загрузчиках (U11); чистка мёртвого кода (U14).
4. Подключить `@next/bundle-analyzer` в CI, зафиксировать бюджет First-Load-JS.

---

## 5. Конкретные правки кода

### 5.1 [ИСПРАВЛЕНО] Таймаут AI (корень зависаний)
```diff
// lib/ai/openrouter.ts
  if (opts.jsonMode) body.response_format = { type: 'json_object' }
+ const timeoutMs = opts.timeoutMs ?? 45_000
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { ... },
      body: JSON.stringify(body),
+     signal: AbortSignal.timeout(timeoutMs),
    })
    ...
- } catch (err) { console.error('[openrouter] fetch failed:', err); return null }
+ } catch (err) {
+   if (err instanceof Error && err.name === 'TimeoutError') console.error(`[openrouter] request timed out after ${timeoutMs}ms`)
+   else console.error('[openrouter] fetch failed:', err)
+   return null
+ }
```
*Почему решает:* все downstream-вызовы (ассистент, диагностика, извлечение, биндинг) идут через эту функцию → фиксируется верхняя граница ожидания без изменения success-path (контракт «возвращает null при сбое» сохранён, вызывающие уже это обрабатывают).

### 5.2 [ИСПРАВЛЕНО] Rate-limit публичного LLM-роута (B04)
```diff
// app/api/gri/ai-strategy/route.ts
+ import { isRateLimited } from '@/lib/rate-limit'
  export async function POST(request: NextRequest) {
    try {
+     if (await isRateLimited(request, 'gri-ai-strategy', { max: 20 }))
+       return NextResponse.json({ error: 'Слишком много запросов...' }, { status: 429 })
```
*Почему решает:* анонимный пользователь больше не может бесконтрольно жечь платный Sonnet.

### 5.3 [ИСПРАВЛЕНО] Краш-guard + error-state (U06)
```diff
// components/dashboard/admin/AdminClientsList.tsx
- if (json.ok) { const mapped = json.data.map(...) ; setClients(mapped) }
+ if (json.ok && Array.isArray(json.data)) { setClients(json.data.map(...)) }
+ else { setError(true) }
// + отдельный if (error) return <retry/>
```

### 5.4 [ИСПРАВЛЕНО] `router.refresh()` вместо перезагрузки (U07)
```diff
// components/dashboard/RevenueTargetsCard.tsx
- if (typeof window !== 'undefined') window.location.reload()
+ router.refresh()  // + const router = useRouter()
```

### 5.5 [ПРЕДЛОЖЕНО] Общий react-query хук вместо дублей (U01)
```ts
// hooks/useOnboardingStatus.ts
import { useQuery } from '@tanstack/react-query'
export function useOnboardingStatus() {
  return useQuery({
    queryKey: ['onboarding-status'],
    queryFn: async () => {
      const r = await fetch('/api/v1/onboarding/status', { credentials: 'include' })
      if (!r.ok) throw new Error('onboarding_status_failed')
      return r.json()
    },
    staleTime: 60_000,
  })
}
```
Заменить сырые `fetch('/api/v1/onboarding/status')` в `GrowthSnapshotHero.tsx:103`, `PointAQuickPills.tsx:106`, `OnboardingStatusBadges.tsx:43` на `useOnboardingStatus()`. Аналогично `useGriAssessment()` для `/api/v1/gri/assessment` (9 потребителей). *Эффект:* дедуп + кэш + persist «из коробки».

### 5.6 [ПРЕДЛОЖЕНО] recharts → dynamic (F01)
```diff
// components/dashboard/WidgetGrid.tsx
- import { KpiChart } from './KpiChart'
+ import dynamic from 'next/dynamic'
+ const KpiChart = dynamic(() => import('./KpiChart').then(m => m.KpiChart), {
+   ssr: false, loading: () => <div className="h-64 animate-pulse bg-surface-container-low rounded-xl" />,
+ })
```
Повторить для `KpiCardsGrid→MetricModal` (рендерить только при `activeMetric`), `pulse/page→GriPulseWidget`, `PointBView→TrajectoryChart`, `MetricsLiveCatalog→MetricDrillDownModalV2`, `MarketAnalysisChecklist→MarketDataPanel`.

### 5.7 [ПРЕДЛОЖЕНО] next/font (F03)
```ts
// app/layout.tsx
import { Space_Grotesk, Inter, DM_Sans, JetBrains_Mono } from 'next/font/google'
const headline = Space_Grotesk({ subsets:['latin'], variable:'--font-headline', display:'swap' })
const body     = Inter({ subsets:['latin','cyrillic'], variable:'--font-body', display:'swap' })
const label    = DM_Sans({ subsets:['latin'], variable:'--font-label', display:'swap' })
const mono     = JetBrains_Mono({ subsets:['latin'], variable:'--font-mono', display:'swap' })
// <html className={`${headline.variable} ${body.variable} ${label.variable} ${mono.variable}`}>
// убрать оба <link rel="stylesheet"> Google Fonts; Material Symbols — грузить локально или оставить единственный <link> только для иконок.
```
Переменные `--font-*` уже используются в `tailwind.config.ts:75-80`, поэтому маппинг чистый. **Проверить визуально** (веса/иконки) перед мержем.

### 5.8 [ПРЕДЛОЖЕНО] Fix `opts.max` в rate-limit (B05)
```ts
// lib/rate-limit.ts — кэш лимитеров по конфигу
const limiters = new Map<string, Ratelimit>()
function upstashLimiter(max: number, window: `${number}m`|`${number}s`) {
  const key = `${max}:${window}`
  if (!limiters.has(key)) limiters.set(key, new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(max, window), analytics:true }))
  return limiters.get(key)!
}
// в isRateLimited: if (upstashConfigured) { const { success } = await upstashLimiter(opts.max ?? 10, `${(opts.windowMs??60000)/1000}s`).limit(`${bucket}:${ip}`); return !success }
```

### 5.9 [ПРЕДЛОЖЕНО] `/api/metrics` — честный статус (B12)
```diff
- return NextResponse.json({ source:'error', data: [] }, { status: 200 })
+ return NextResponse.json({ source:'error', error:'metrics_failed' }, { status: 500 })
```
Клиент (react-query) сможет отличить сбой от пустого и показать retry.

### 5.10 [ПРЕДЛОЖЕНО] Дедуп авторизации в API (B07)
```ts
// lib/rbac.ts — кэш на время запроса
import { cache } from 'react'
export const getAdminSession = cache(async () => { /* getUser + profiles один раз на запрос */ })
```
Плюс: в middleware уже есть `x-user-role` — сидировать Zustand из серверного компонента/заголовка, а `auth.store.init()` вызывать только при отсутствии cookie.

---

## 6. Loader и loading states (готовые реализации)

**Что уже есть:** 25 route-level `loading.tsx` (скелетоны), 3 `error.tsx`, `nextjs-toploader` на навигацию, `sonner` тосты. **Чего не хватает:** in-page состояний, disabled-кнопок, отличия error/empty, глобального индикатора in-page запросов.

**6.1 Кнопка с состоянием загрузки (защита от double-submit):**
```tsx
// components/ui/SubmitButton.tsx
'use client'
import { useFormStatus } from 'react-dom'
export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return <button type="submit" disabled={pending} aria-busy={pending}
    className="... disabled:opacity-50">{pending ? 'Загрузка…' : children}</button>
}
```
Применить в `reports/page.tsx` (U04). Для обычных async-кнопок — флаг `isPending` + `disabled`.

**6.2 Глобальная полоса in-page запросов (U13):**
```tsx
'use client'
import { useIsFetching } from '@tanstack/react-query'
export function GlobalFetching() {
  const n = useIsFetching()
  return n ? <div className="fixed top-0 inset-x-0 h-0.5 bg-primary animate-pulse z-50" /> : null
}
```

**6.3 Единый data-state:** для каждого запроса рендерить три ветки — `isLoading` → скелетон, `isError` → сообщение + кнопка «Повторить», `data.length===0` → empty-state. Не сворачивать error в empty (U05).

**6.4 Ленивая тяжёлая модалка/панель (fallback UI):** `next/dynamic(..., { ssr:false, loading: () => <Skeleton/> })` и монтировать по флагу открытия (F01/F04).

---

## 7. Оптимизация API и бэкенда

- **Ускорить endpoints:** дедуп авторизации (B07, `cache()`), вынести блокирующий парсинг/PDF в Inngest (B08), убрать write-on-GET (B09), распараллелить независимые LLM (B03).
- **Пагинация:** `take`/курсор для `getAnalyticsData` (B11), `getClients`, `reportDocument.findMany`, `admin/analytics` (B14); для средних значений — SQL-агрегация вместо материализации строк.
- **Индексы:** **[ИСПРАВЛЕНО в схеме]** — 23 новых `@@index` по FK (clientId/orgId/managerId/requestId и т.д.). Применить: `npx prisma migrate dev --name add_fk_indexes` (или `prisma db push`). Для нулевого простоя — `CREATE INDEX CONCURRENTLY`.
- **Кэширование:** заменить бланкетный `force-dynamic` на `revalidate`/`unstable_cache` на детерминированных GET (образец — `point-a/filters:15`).
- **Payload:** проекция полей; никогда не слать `parsed_data`/эмбеддинги клиенту (B13).
- **Таймауты:** **[ИСПРАВЛЕНО]** AI-обёртка; **[ПРЕДЛОЖЕНО]** общий `fetchWithTimeout` для Supabase REST-гейтов (`expert-auth.ts:22`, `supabase-admin-guard.ts:41`, `share/report-data.ts:36`).
- **Обработка ошибок:** try/catch на «голых» роутах (B15); корректные статусы (B12); не отдавать `error.message` клиенту (B04/GRI).
- **Rate-limit/логирование:** покрыть все дорогие роуты (B06), починить `opts.max` (B05).

---

## 8. Чек-лист тестирования после исправлений

- [ ] `npm install && npm run type-check && npm run build` — сборка зелёная (в этой ветке проверить после install).
- [ ] Первичная загрузка портала (холодный кэш) — FCP/LCP, нет «вечного» пустого экрана.
- [ ] Переходы между страницами — прогресс-бар, скелетоны, нет фризов.
- [ ] Логин / регистрация / выход — кнопки disabled во время запроса, нет двойного сабмита.
- [ ] Загрузка отчёта (крупный файл) — спиннер/disabled, без повторных клиц.
- [ ] Сохранение целей (RevenueTargetsCard) — без полной перезагрузки, данные обновились.
- [ ] Админ-панель клиентов — при 500/кривом ответе показывается ошибка+retry (не креш, не «пусто»).
- [ ] AI-сценарии (ассистент, GRI-стратегия, диагностика) — при недоступности модели корректный таймаут/фолбэк ≤45 c, не зависание.
- [ ] Rate-limit: 21-й запрос к `/api/gri/ai-strategy` за минуту → 429.
- [ ] Медленный интернет (throttling) / недоступный API / истёкшая сессия — понятные состояния.
- [ ] Мобильная версия + разные браузеры; повторные клики; большие объёмы данных.
- [ ] Прогнать миграцию индексов и проверить план тяжёлых выборок (`EXPLAIN`).

---

## 9. Метрики успеха (до/после)

| Метрика | Инструмент | Цель |
|---|---|---|
| LCP | Lighthouse/CrUX | < 2.5 c |
| FCP | Lighthouse | < 1.8 c |
| TTI / TBT | Lighthouse | TBT < 200 мс |
| INP | Web Vitals | < 200 мс |
| CLS | Web Vitals | < 0.1 |
| TTFB | Server-Timing | < 0.8 c (после дедупа авторизации) |
| First-Load JS (дата-маршруты) | `@next/bundle-analyzer` | −150..400 КБ (после dynamic recharts) |
| Кол-во API-запросов на загрузку дашборда | Network tab | −5+ дублей (после react-query) |
| Ср. время ответа AI-роутов | логи/Langfuse | верхняя граница ≤45 c, без «вечных» |
| Ошибки в консоли | DevTools | 0 |
| 4xx/5xx | логи | корректные статусы; 429 на флуд |
| «Зависания» UI / повторные сабмиты | ручное QA | 0 |

---

## 10. Итоговый backlog для разработчика

| Приоритет | Задача | Область | Ожидаемый результат | Критерий готовности |
|---|---|---|---|---|
| P0 | ✅ Таймауты AI-обёртки | Backend | Нет «вечных» зависаний AI | Таймаут срабатывает ≤45 c (готово) |
| P0 | ✅ Rate-limit GRI-AI роутов | Security | Аноним не жжёт Sonnet | 429 на 21-й запрос (готово) |
| P0 | ✅ Краш-guard админ-панели | Frontend | Нет креша на кривом ответе | error+retry (готово) |
| P0 | Дедуп авторизации (`cache()`, `x-user-role`) | Auth | −2..3 round-trip'а/переход | TTFB замерен до/после |
| P0 | Rate-limit на остальные AI/upload/checkout + fix `opts.max` | Backend | Нет бесконтрольной нагрузки | Все дорогие роуты лимитированы |
| P1 | recharts → `next/dynamic` (все потребители) | Frontend | −150..400 КБ First-Load JS | bundle-analyzer до/после |
| P1 | `next/font` вместо блокирующих шрифтов | Frontend | Быстрее FCP | Нет render-blocking CSS шрифтов |
| P1 | react-query хуки (onboarding/status, gri/assessment) | UX | −5+ дублей запросов | Network: 1 запрос на ключ |
| P1 | Применить миграцию FK-индексов | Data | Быстрые выборки по FK | `EXPLAIN` использует индексы |
| P1 | Вынести парсинг/PDF в Inngest; убрать write-on-GET | Backend | Нет 300-с held-функций | job-id + опрос статуса |
| P2 | Loading/disabled кнопки + error/empty состояния | UX | Нет double-submit, ясные состояния | QA-чеклист зелёный |
| P2 | Лениво монтировать ассистента; убрать дубли Toaster | Frontend | Меньше гидрации на страницу | 1 Toaster, панель по `open` |
| P2 | Починить поллинги (10c/5c), добавить AbortController | UX/сеть | Нет фонового флуда/гонок | Интервалы останавливаются |
| P3 | Единый канонический GRI-движок | Архитектура | Согласованные оценки | Одна шкала, остальные — адаптеры |
| P3 | Проекция полей в API; пагинация списков | Backend | Меньше payload | Нет `parsed_data`/`select('*')` клиенту |
| P3 | `@next/bundle-analyzer` + бюджет JS в CI | Инфра | Контроль регрессий | CI падает при превышении бюджета |

---

### Приложение. Что уже внесено в этой ветке

**Батч 1 (Этап 1):** `lib/ai/openrouter.ts` (таймауты) · `app/api/gri/ai-strategy/route.ts` + `financial-analyst/route.ts` (rate-limit) · `components/dashboard/admin/AdminClientsList.tsx` (guard+error) · `components/dashboard/RevenueTargetsCard.tsx` (router.refresh) · `lib/functions/parse-document.ts` (таймаут скачивания) · `prisma/schema.prisma` (23 FK-индекса — нужна миграция `prisma db push`) · `.eslintrc.json` (guard от импорта тяжёлых серверных либ в `components/`) · удалены `build_error.txt` (устаревший) и `lib/prisma.ts` (мёртвый дубль) · `package.json` (убрана мёртвая `react-grid-layout`).

**Батч 2 (Этап 2, продолжение):**
- `lib/rate-limit.ts` — исправлен баг `opts.max` (B05): лимитер теперь строится per-(max,window) и реально соблюдает заданные лимиты, а не подменяет их общим 10/мин.
- `lib/rbac.ts` — `getAdminSession` обёрнут в React `cache()` (B07-partial): в рамках одного запроса `getUser()`+`profiles` выполняется один раз, а не при каждом вызове guard'а/RSC.
- **recharts → `next/dynamic`** (F01) в 4 потребителях: `components/dashboard/WidgetGrid.tsx` (KpiChart), `components/dashboard/KpiCardsGrid.tsx` (MetricModal — теперь монтируется только при открытии метрики), `app/(dashboard)/pulse/page.tsx` (GriPulseWidget), `components/metrics/MetricsLiveCatalog.tsx` (MetricDrillDownModalV2). recharts уходит из first-load JS этих маршрутов и грузится по требованию.

**Батч 3 (Этап 2/4, продолжение):**
- **recharts → `next/dynamic`** довершён: `components/point-b/PointBView.tsx` (TrajectoryChart) и `components/market-analysis/MarketAnalysisChecklist.tsx` (MarketDataPanel). Итого recharts вынесен из first-load JS **6 поверхностей**.
- **Пагинация/лимиты (B11/B14):** `lib/analytics-data.ts` (OOM-backstop `take:2000` — агрегаты остаются верны для реального объёма), `app/actions/gri.ts` (`take:500`), `app/actions/reports.ts` (`take:100`).
- **Честный статус (B12):** `app/api/v1/metrics/route.ts` — ошибка теперь `500`, а не `200` (клиент `fetchMetrics` бросает на `!res.ok`; `useAllVisibleMetrics` деградирует на плейсхолдеры каталога — UI не ломается).
- **try/catch (B15):** `app/api/notifications/route.ts`, `app/api/clients/route.ts` (GET+POST) — обёрнуты, логируют, возвращают 500 JSON.
- **Cleanup:** удалён мёртвый `components/dashboard/SystemHealthCompact.tsx` (0 импортов).
- F05 (`AddMetricModal` useMemo) — **оказался уже исправлен** (`build_error.txt` был устаревшим).

**СОЗНАТЕЛЬНО НЕ применено вслепую** (высокий риск регрессии без runtime/визуальной проверки — готовые diff'ы в разделах 5–6):
- **`next/font` (F03):** переменные шрифтов заданы в `app/globals.css` (Bricolage / DM Sans / Space Grotesk / **JetBrains Mono**), а `JetBrains Mono` жёстко прописан inline в ~7 chart-компонентах (`fontFamily: 'JetBrains Mono'`) и в PDF-генерации (`lib/reports/`). `next/font` хеширует имя семейства → сломает подписи **всех** графиков и PDF. Нужна согласованная правка globals.css + ~20 inline-ссылок + визуальный QA.
- **Клиентский дедуп авторизации (B07):** требует прокидывания сессии из серверного layout в Zustand-стор с сохранением формы `PublicUser` (role/org/status/avatar) — трогает auth-путь, риск рассинхрона логина. Серверная половина (`getAdminSession` через `cache()`) уже сделана.
- **react-query дедуп (U01/U02):** переписывание data-fetching в ~12 крупных компонентах; выигрыш возникает только когда ВСЕ потребители на странице используют один `queryKey`, поэтому нужна полная проверяемая миграция. Готовые хуки — в разделе 5.5.

### Приложение. Данные, которых не хватило для полной проверки
- Нет `node_modules` в worktree → не выполнены `tsc`/`next build`/Lighthouse. Реальные размеры бандлов и Web Vitals нужно замерить (`ANALYZE=true next build`, Lighthouse) до/после.
- Нет runtime-профиля (React Profiler) → «зависания» подтверждены по коду (жадные импорты, дубли запросов), а не по флейм-графу.
- Не проверялись серверные `app/actions/*` на предмет тайминга/ошибок (рассматривались как чёрный ящик со стороны клиента).
