# AIStart360 — Полное Техническое Задание
## Руководство по реализации клиентского портала

> Версия: 2.0 | Дата: Март 2026 | Статус: Production Blueprint

---

## ЧАСТЬ 0 — АНАЛИЗ СУЩЕСТВУЮЩИХ ФАЙЛОВ

### 0.1 Отчёт о проверке файлов

**Всего файлов проанализировано:** 92
**HTML-файлы (code.html):** 45
**PNG-скриншоты (screen.png):** 45
**Системные файлы (.DS_Store):** 2

| Категория | Количество | Статус |
|---|---|---|
| Дизайн-компоненты (named) | 18 | ✅ OK |
| Вариации дизайна (aistart360_1–27) | 27 | ✅ OK |
| Скриншоты-превью | 45 | ✅ OK |
| Конфиг-файлы (package.json, etc.) | 0 | ⚠️ ОТСУТСТВУЮТ |
| Файлы сборки (webpack/vite) | 0 | ⚠️ ОТСУТСТВУЮТ |
| Общие стили (shared CSS) | 0 | ⚠️ ОТСУТСТВУЮТ |

### 0.2 Выявленные проблемы

**КРИТИЧЕСКИЕ:**
1. **Нет системы сборки** — все файлы статичны, Tailwind подключается через CDN. В продакшне это недопустимо (медленно, нет оптимизации).
2. **Нет shared-компонентов** — каждый HTML-файл содержит полную копию `tailwind.config`. Это ~15КБ дублированного кода на 45 файлов.
3. **Нет роутинга** — все ссылки ведут на `href="#"`, навигация не работает.
4. **Нет JS-логики** — кнопки, модали, фильтры не функционируют (pure HTML).
5. **Внешние изображения** — используются URL с `lh3.googleusercontent.com` (Google CDN для AI-генерированных картинок). В продакшне нужны собственные ассеты.

**НЕКРИТИЧЕСКИЕ:**
6. Двойной импорт Material Symbols в ряде файлов (дублированный `<link>` тег).
7. Незначительные расхождения в значениях `primary` (#6effc0 vs #00E5A0) между файлами.
8. Язык `lang="ru"` только в `v2.0_aistart360`, остальные — `lang="en"`.
9. Нет `<meta description>` и SEO-тегов.
10. `/ТЗ/` папка была пустой — заполнена этим документом.

### 0.3 Что нельзя прочитать / ограничения
- PNG-файлы (`screen.png`) — не анализировались как изображения в рамках этого задания, только как ассеты. Для их просмотра используй Preview / Figma импорт.
- Нет Figma-файлов, Sketch, XD или других дизайн-исходников — только HTML+PNG.

---

## ЧАСТЬ 1 — ДИЗАЙН-СИСТЕМА (Design System)

### 1.1 Цвета

#### Основная палитра (Dark Theme — Material Design 3)

```css
/* Первичный бренд-цвет */
--color-primary:            #6effc0;  /* Активные элементы, акценты */
--color-primary-container:  #00e5a0;  /* Фон активных кнопок */
--color-primary-fixed-dim:  #00e29e;  /* Hover на primary */
--color-on-primary:         #003824;  /* Текст на primary-фоне */

/* Вторичный */
--color-secondary:          #bcc7de;  /* Второстепенный текст/элементы */
--color-secondary-container:#3e495d;  /* Фон secondary-компонентов */
--color-on-secondary:       #263143;  /* Текст на secondary-фоне */

/* Третичный (amber/warm) */
--color-tertiary:           #ffe1bd;  /* Warning, highlights */
--color-tertiary-container: #ffbd60;  /* Фон tertiary-компонентов */

/* Ошибки */
--color-error:              #ffb4ab;  /* Ошибки, критические */
--color-error-container:    #93000a;  /* Фон ошибок */

/* Поверхности */
--color-background:         #0a0b0f;  /* Самый тёмный фон страницы */
--color-surface:            #121317;  /* Основная поверхность */
--color-surface-dim:        #121317;  /* Затемнённая поверхность */
--color-surface-container-lowest: #0d0e12;
--color-surface-container-low:    #1a1b20;  /* Фон sidebar */
--color-surface-container:        #1f1f24;  /* Фон карточек */
--color-surface-container-high:   #292a2e;  /* Raised cards */
--color-surface-container-highest:#343439;  /* Максимально поднятые */
--color-surface-bright:     #38393e;  /* Выделенные поверхности */
--color-surface-variant:    #343439;

/* Текст */
--color-on-surface:         #e3e2e8;  /* Основной текст */
--color-on-surface-variant: #bacbbf;  /* Вспомогательный текст */
--color-on-background:      #e3e2e8;

/* Контуры */
--color-outline:            #84958a;  /* Границы элементов */
--color-outline-variant:    #3b4a41;  /* Тонкие разделители */
```

#### Семантические цвета статусов

```css
--status-critical:   #ffb4ab;   /* Критический */
--status-warning:    #ffbd60;   /* Предупреждение */
--status-success:    #6effc0;   /* Успех / норма */
--status-info:       #bcc7de;   /* Информация */
--status-neutral:    #84958a;   /* Нейтральный */
```

### 1.2 Типографика

```css
/* Headline — для заголовков, hero-секций */
font-family: 'Bricolage Grotesque', 'Space Grotesk', sans-serif;
/* Размеры: 48px (hero), 32px (h2), 24px (h3), 20px (h4) */

/* Body — для основного текста, параграфов, UI-элементов */
font-family: 'DM Sans', 'Inter', sans-serif;
/* Размеры: 16px (base), 14px (small), 12px (xs), 11px (label) */

/* Label — для кнопок, меток, навигации */
font-family: 'Space Grotesk', 'DM Sans', sans-serif;
/* Размеры: 13px–14px, font-weight: 500–600 */

/* Mono — для метрик, кодов, ID, технических данных */
font-family: 'JetBrains Mono', monospace;
/* Размеры: 10px (метки), 14px–16px (значения), 28px–36px (KPI) */
```

### 1.3 Сетка и отступы

```
Боковая панель:    256px (expanded) / 64px (collapsed)
Верхняя панель:    64px высота, fixed
Основной контент:  max-width: 1600px, auto margins
Внутренние отступы контента: px-8 pt-24 pb-12

Сетки карточек:
  - KPI блоки:    grid-cols-4 (desktop), grid-cols-2 (tablet)
  - Alerts:       grid-cols-4 (desktop), grid-cols-2 (tablet)
  - Cards:        grid-cols-3 (desktop), grid-cols-2 (tablet)

Gap между элементами: 16px (gap-4), 24px (gap-6)
Border-radius: 4px (sm), 8px (lg), 12px (xl), 9999px (full)
```

### 1.4 Компоненты дизайн-системы

#### Кнопки

```
Primary Button:
  bg: gradient primary → primary-container
  text: on-primary (тёмный)
  px-6 py-1.5 rounded shadow-primary/10
  hover: scale(0.95) transition 150ms

Secondary Button:
  border: 1px solid primary/20
  text: primary
  bg: transparent
  hover: bg-primary/5

Danger Button:
  border: 1px solid error/30
  text: error
  hover: bg-error/10

Ghost Button:
  text: on-surface-variant
  hover: text-white bg-surface-container
```

#### Карточки

```
Base Card:
  bg: surface-container (#1f1f24)
  border-radius: xl (12px)
  padding: p-5 or p-6

Glass Card:
  background: rgba(255,255,255,0.04)
  backdrop-filter: blur(12px)
  border: 1px solid rgba(255,255,255,0.08)

Raised Card:
  bg: surface-container-high
  hover: border-bottom 2px primary/40

Alert Card (Critical):
  border-left: 4px solid error/50
  bg: surface-container

Alert Card (Warning):
  border-left: 4px solid tertiary-container/50

Alert Card (Success):
  border-left: 4px solid primary/50
```

#### Поля ввода

```
Input Field:
  bg: surface-container-low
  border: none (только focus ring)
  border-radius: lg (8px)
  text: on-surface
  placeholder: on-surface-variant/50
  focus-ring: 1px solid primary/20
  padding: pl-10 pr-4 py-2 (с иконкой слева)

Select / Dropdown:
  Те же стили что у Input
  Иконка expand_more справа
```

#### Навигация (Sidebar)

```
Nav Item (Default):
  text: #8B95A3
  bg: transparent
  padding: px-3 py-2.5
  hover: text-white bg-surface-container

Nav Item (Active):
  text: primary (#00E5A0)
  bg: surface-container (#1f1f24)
  border-right: 2px solid primary
  font-weight: 500

Nav Group Label:
  text: 10px uppercase tracking-widest on-surface-variant
  padding: px-3 mb-2 mt-6
```

#### Таблицы

```
Table Header:
  bg: surface-container-high
  text: 11px uppercase mono tracking-widest on-surface-variant
  border-bottom: outline-variant/20

Table Row:
  bg: transparent
  border-bottom: outline-variant/10
  hover: bg-surface-container/50

Table Cell:
  font: body 14px
  padding: px-4 py-3

Status Badge:
  rounded-full px-2 py-0.5 text-10px font-mono
  Green: bg-primary/10 text-primary
  Red: bg-error/10 text-error
  Amber: bg-tertiary-container/10 text-tertiary-container
```

#### Модальные окна

```
Backdrop: bg-black/60 backdrop-blur-sm
Modal Container:
  bg: surface-container-high
  rounded-2xl
  border: 1px solid outline-variant/20
  shadow: xl
  max-w: 480px (sm), 640px (md), 800px (lg)
  padding: p-6

Modal Header:
  flex justify-between
  Заголовок: font-headline text-xl font-bold
  Кнопка закрытия: text-on-surface-variant hover:text-white

Modal Footer:
  border-top: outline-variant/10
  flex justify-end gap-3 pt-4
```

#### Индикаторы статуса

```
Pulse Dot (Online):
  w-2 h-2 rounded-full bg-primary animate-pulse

Status Badge (chip):
  rounded-full font-mono text-[10px] uppercase
  px-2.5 py-1 border border-color/20

Progress Bar:
  bg: surface-container-high (track)
  bg: primary (fill)
  h-1 rounded-full overflow-hidden

GRI Score Dial:
  Монотипная цифра (JetBrains Mono)
  Цветовые уровни:
    900–1000: #6effc0 (Excellent)
    700–899:  #00e5a0 (Strong)
    500–699:  #ffbd60 (Developing)
    300–499:  #ffb4ab (Critical)
```

---

## ЧАСТЬ 2 — UI/UX УЛУЧШЕНИЯ

### 2.1 Выявленные слабые места

| Проблема | Приоритет | Решение |
|---|---|---|
| Нет страниц Auth (login/register/forgot) | ВЫСОКИЙ | Создать Auth flow (v2.0 файл — только авторизация) |
| Нет состояний Empty/Error/Loading | ВЫСОКИЙ | Добавить empty states во все таблицы/списки |
| Навигация не адаптирована под роли | ВЫСОКИЙ | RBAC-навигация (Admin, Manager, Client) |
| Нет онбординга (onboarding) | СРЕДНИЙ | Wizard для новых пользователей |
| Нет Breadcrumbs в ряде страниц | СРЕДНИЙ | Добавить breadcrumb во все interior pages |
| Нет pagination в таблицах | СРЕДНИЙ | Компонент пагинации |
| KPI числа без контекста диапазона | НИЗКИЙ | Tooltip с benchmarks |
| Нет feedback на actions | ВЫСОКИЙ | Toast уведомления |

### 2.2 Страницы для добавления (отсутствуют в дизайне)

1. **Login / Register / Password Recovery** — уже есть `v2.0_aistart360` (auth), развить
2. **Notifications Center** — нет отдельной страницы
3. **Billing & Subscription** — нет
4. **File Manager** — нет
5. **Global Search Results** — нет отдельной страницы
6. **Error 404 / 500** — нет
7. **Onboarding Wizard** — нет

### 2.3 Улучшения иерархии информации

```
Dashboard:
  БЫЛО:  Плоская сетка KPI → Alerts → Таблица
  СТАЛО: Hero Metric (главный показатель) → Trend Charts →
         Critical Alerts → Client Activity Feed

Clients:
  БЫЛО:  Таблица клиентов
  СТАЛО: Filters Bar → Stats Row → Table с inline actions →
         Side Panel (detail drawer без перехода на новую страницу)

Reports Hub:
  БЫЛО:  Список файлов
  СТАЛО: Recent Uploads → Category Filters → Grid/List toggle →
         Preview Panel
```

### 2.4 Доступность (Accessibility)

```
ARIA labels: добавить aria-label на все icon-only кнопки
Focus trap: в модалях нужен focus trap для keyboard nav
Color contrast: проверить все серые тексты (#8B95A3 на #0A0B0F = ratio ~4.5:1 ✅)
Skip links: добавить skip-to-main для screen readers
Keyboard shortcuts: ESC = закрыть модаль, / = фокус на поиске
```

---

## ЧАСТЬ 3 — АНИМАЦИИ И ИНТЕРАКЦИИ

### 3.1 Transition Tokens

```css
--transition-fast:    100ms ease-out;   /* Hover states, tooltips */
--transition-default: 200ms ease-out;   /* Все UI переходы */
--transition-medium:  300ms ease-in-out;/* Раскрытие элементов */
--transition-slow:    500ms ease-in-out;/* Page transitions */
--transition-spring:  cubic-bezier(0.34, 1.56, 0.64, 1); /* Упругость */
```

### 3.2 Специфичные анимации

| Элемент | Тип | Длительность | Easing |
|---|---|---|---|
| Sidebar expand/collapse | slide + fade | 250ms | ease-in-out |
| Card hover | translateY(-2px) + border | 150ms | ease-out |
| Button click | scale(0.95) | 100ms | ease-out |
| Modal open | scale(0.95→1) + opacity | 200ms | spring |
| Modal close | scale(1→0.95) + opacity | 150ms | ease-in |
| Toast notification | slideInRight + opacity | 300ms | spring |
| Page transition | opacity + translateY(8px) | 200ms | ease-out |
| Loading skeleton | shimmer | 1500ms | linear (loop) |
| Pulse dot (status) | scale pulse | 2000ms | ease-in-out (loop) |
| Radar animation (GRI) | rotate | 60s | linear (loop) |
| KPI counter | count-up | 800ms | ease-out |
| Chart bars appear | scaleY(0→1) | 400ms | spring (stagger 50ms) |

### 3.3 Микроинтеракции

```
Nav Item Click:
  1. Ripple effect от точки клика
  2. Highlight активного пункта (200ms)
  3. Контент справа fade-in (150ms задержка)

Notification Bell:
  Hover → bell-shake (10deg x2, 200ms)
  При новом уведомлении → bounce animation

Search Focus:
  Expand width: max-w-md → max-w-xl (250ms)
  Backdrop blur усиливается

Table Row Hover:
  Очень тонкий bg highlight
  Actions column появляется (opacity 0→1, 150ms)

Status Pulse:
  Critical status: пульсирует красным (1s loop)
  Normal status: медленно мигает зелёным (2s loop)
```

---

## ЧАСТЬ 4 — АРХИТЕКТУРА ПОРТАЛА

### 4.1 Карта страниц и ролей

```
AUTH (публичный доступ):
  /login              — Вход в систему
  /register           — Регистрация (invite-only)
  /forgot-password    — Восстановление пароля
  /reset-password     — Сброс по токену

ADMIN (роль: admin):
  /admin/dashboard    — Административный дашборд
  /admin/clients      — Управление клиентами
  /admin/team         — Управление командой
  /admin/analytics    — Системная аналитика
  /admin/settings     — Настройки системы
  /admin/billing      — Биллинг и подписки

MANAGER (роль: manager):
  /dashboard          — Обзор клиентов
  /clients            — Список клиентов
  /clients/:id        — Профиль клиента
  /clients/:id/gri    — GRI Report
  /clients/:id/growth — Growth Plan
  /projects           — Активные проекты
  /projects/:id       — Детали проекта
  /reports            — Hub отчётов
  /reports/upload     — Загрузка данных
  /analytics          — Метрики
  /intelligence       — Intelligence Hub
  /team               — Команда и аллокация
  /notifications      — Уведомления
  /settings           — Настройки аккаунта

CLIENT (роль: client):
  /my/dashboard       — Личный дашборд
  /my/gri             — Мой GRI Score
  /my/growth          — Мой план роста
  /my/reports         — Мои отчёты
  /my/profile         — Профиль
  /my/support         — Поддержка
```

### 4.2 Описание ключевых страниц

#### Dashboard (Admin/Manager)
- **Цель:** Оперативный обзор всей системы
- **Компоненты:** Hero KPIs (4 метрики), Critical Alerts Masonry, Client Activity Table, System Health Bar
- **Состояния:** Loading (skeleton), Empty (нет клиентов — onboarding CTA), Error (failed API)
- **Действия:** Quick Action, Run Report, Navigate to client

#### GRI — Growth Readiness Index
- **Цель:** Показать composite score готовности к росту
- **Компоненты:** Score Dial (центральный), Radar Chart (6 доменов), Domain Cards, Trend Timeline
- **Состояния:** Calculating (spinner), No Data (upload CTA), Benchmark Compare mode
- **Доступен:** Admin, Manager, Client (только свой)

#### Intelligence Hub
- **Цель:** Агрегация рыночных сигналов и инсайтов
- **Компоненты:** Signal Feed, Market Radar, Opportunity Cards, Filter by sector/urgency
- **Состояния:** Live (обновление каждые N минут), Stale data warning

#### Reports Hub
- **Цель:** Хранилище и доступ к аналитическим отчётам
- **Компоненты:** Recent Uploads, Category Filter, Report Grid, Preview Panel, Upload Button
- **Состояния:** Empty (нет отчётов), Uploading progress, Error upload

#### Clients Management
- **Цель:** CRM-уровень управления клиентами
- **Компоненты:** Stats Row, Search/Filter Bar, Data Table, Quick Actions, Side Drawer (detail)
- **Состояния:** Loading table, Empty search, Client card detail panel

---

## ЧАСТЬ 5 — ФРОНТЕНД АРХИТЕКТУРА

### 5.1 Рекомендуемый стек

| Технология | Выбор | Обоснование |
|---|---|---|
| Framework | **Next.js 14** (App Router) | SSR для SEO, built-in routing, API routes, TypeScript first |
| UI Library | **React 18** | Компонентная модель, hooks, concurrent features |
| Styling | **Tailwind CSS v3** | Уже используется в дизайне, utility-first, легко экстрактить |
| Components | **shadcn/ui** | Headless + Tailwind, полностью кастомизируемо, нет vendor lock-in |
| Charts | **Recharts** или **Tremor** | Простая интеграция с React, поддержка responsive |
| Icons | **@material-symbols/font** | Уже используется в дизайне |
| State | **Zustand** | Простой, легковесный, без boilerplate как Redux |
| Server State | **TanStack Query (React Query)** | Кэширование, loading/error states, auto-refetch |
| Forms | **React Hook Form + Zod** | Производительность, валидация TypeScript-first |
| Auth | **NextAuth.js v5** | JWT + OAuth, middleware-based protection |
| Animations | **Framer Motion** | Профессиональные анимации, layout animations |

### 5.2 Структура папок

```
aistart360-portal/
├── app/                        # Next.js App Router
│   ├── (auth)/                 # Route group — публичные страницы
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── forgot-password/page.tsx
│   ├── (dashboard)/            # Route group — защищённые страницы
│   │   ├── layout.tsx          # Sidebar + Header layout
│   │   ├── dashboard/page.tsx
│   │   ├── clients/
│   │   │   ├── page.tsx        # Clients list
│   │   │   └── [id]/
│   │   │       ├── page.tsx    # Client overview
│   │   │       ├── gri/page.tsx
│   │   │       └── growth/page.tsx
│   │   ├── projects/
│   │   ├── reports/
│   │   ├── analytics/
│   │   ├── intelligence/
│   │   ├── team/
│   │   ├── notifications/
│   │   └── settings/
│   ├── api/                    # API Routes (Next.js)
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── clients/route.ts
│   │   ├── reports/route.ts
│   │   └── gri/route.ts
│   ├── globals.css
│   └── layout.tsx              # Root layout
│
├── components/
│   ├── ui/                     # Базовые UI-примитивы (shadcn)
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── table.tsx
│   │   ├── badge.tsx
│   │   ├── toast.tsx
│   │   └── skeleton.tsx
│   ├── layout/                 # Структурные компоненты
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   ├── Breadcrumbs.tsx
│   │   └── MobileNav.tsx
│   ├── dashboard/              # Страницо-специфичные компоненты
│   │   ├── KpiBlock.tsx
│   │   ├── AlertCard.tsx
│   │   ├── ActivityFeed.tsx
│   │   └── SystemHealth.tsx
│   ├── gri/
│   │   ├── GriScoreDial.tsx
│   │   ├── RadarChart.tsx
│   │   ├── DomainCard.tsx
│   │   └── GriTimeline.tsx
│   ├── clients/
│   │   ├── ClientsTable.tsx
│   │   ├── ClientCard.tsx
│   │   ├── ClientDrawer.tsx
│   │   └── ClientFilters.tsx
│   ├── charts/
│   │   ├── BarChart.tsx
│   │   ├── LineChart.tsx
│   │   ├── DonutChart.tsx
│   │   └── SparkLine.tsx
│   └── common/
│       ├── StatusBadge.tsx
│       ├── Avatar.tsx
│       ├── EmptyState.tsx
│       ├── LoadingSkeleton.tsx
│       └── ErrorState.tsx
│
├── hooks/
│   ├── useClients.ts           # React Query hook для клиентов
│   ├── useGri.ts               # GRI данные
│   ├── useNotifications.ts     # Realtime уведомления
│   ├── useAuth.ts              # Текущий пользователь
│   └── useDebounce.ts          # Дебаунс для поиска
│
├── services/
│   ├── api.ts                  # Axios/fetch instance с interceptors
│   ├── clients.service.ts
│   ├── gri.service.ts
│   ├── reports.service.ts
│   └── auth.service.ts
│
├── stores/
│   ├── ui.store.ts             # UI state (sidebar collapsed, theme)
│   ├── notifications.store.ts
│   └── filters.store.ts        # Активные фильтры таблиц
│
├── lib/
│   ├── auth.ts                 # NextAuth config
│   ├── db.ts                   # Prisma client
│   └── utils.ts                # cn(), formatDate(), formatNumber()
│
├── types/
│   ├── client.ts
│   ├── gri.ts
│   ├── report.ts
│   └── user.ts
│
├── styles/
│   └── globals.css             # Tailwind directives + CSS vars
│
└── tailwind.config.ts          # ЕДИНЫЙ shared Tailwind config
```

### 5.3 Соглашения по именованию

```
Файлы компонентов:  PascalCase.tsx    (Button.tsx, ClientCard.tsx)
Файлы хуков:        camelCase.ts      (useClients.ts)
Файлы сервисов:     camelCase.service.ts
Файлы типов:        camelCase.ts
CSS-классы:         kebab-case (через Tailwind или CSS Modules)
Переменные:         camelCase
Константы:          SCREAMING_SNAKE_CASE
API endpoints:      /api/resource (REST), /api/resource/:id
```

### 5.4 Подход к управлению состоянием

```
Серверное состояние (API данные):
  → TanStack Query
  → Автоматическое кэширование, loading, error states
  → Stale-while-revalidate

Глобальное UI состояние (Zustand):
  → Sidebar open/closed
  → Активная тема
  → Очередь Toast-уведомлений
  → Глобальные фильтры

Локальное состояние:
  → React useState — форм, модалей, локальных UI-состояний
  → React Hook Form — для всех форм

URL State (next searchParams):
  → Фильтры таблиц
  → Текущий таб
  → Страница пагинации
```

---

## ЧАСТЬ 6 — БЭКЕНД АРХИТЕКТУРА

### 6.1 Стек бэкенда

| Компонент | Технология | Обоснование |
|---|---|---|
| Runtime | **Node.js 20 LTS** | Совместим с Next.js API routes |
| API Style | **REST** (JSON API) | Просто, предсказуемо, легко кешировать |
| ORM | **Prisma** | TypeScript-first, миграции, type safety |
| Database | **PostgreSQL 16** (Supabase) | ACID, RLS, Realtime, бесплатный старт |
| Auth | **NextAuth.js v5** | JWT + BCrypt + OAuth |
| File Storage | **Supabase Storage** | Совместимо с S3, CDN |
| Email | **Resend** | Современный transactional email API |
| Queue | **Inngest** или **BullMQ** | Фоновые задачи (GRI расчёт, отчёты) |
| Cache | **Redis** (Upstash) | Сессии, rate limiting, hot data |
| Realtime | **Supabase Realtime** | WebSocket для уведомлений |

### 6.2 Структура API

```
Authentication:
  POST  /api/auth/login
  POST  /api/auth/register
  POST  /api/auth/logout
  POST  /api/auth/refresh-token
  POST  /api/auth/forgot-password
  POST  /api/auth/reset-password

Clients:
  GET   /api/clients              — список (фильтры, пагинация)
  POST  /api/clients              — создать клиента
  GET   /api/clients/:id          — получить клиента
  PATCH /api/clients/:id          — обновить клиента
  DELETE /api/clients/:id         — удалить (soft delete)

GRI:
  GET   /api/clients/:id/gri      — последний GRI report
  GET   /api/clients/:id/gri/history — история GRI
  POST  /api/clients/:id/gri/calculate — пересчитать GRI

Reports:
  GET   /api/reports              — список отчётов (фильтры)
  POST  /api/reports/upload       — загрузить файл
  GET   /api/reports/:id          — получить отчёт
  DELETE /api/reports/:id

Analytics:
  GET   /api/analytics/overview   — агрегированные метрики
  GET   /api/analytics/clients    — метрики по клиентам
  GET   /api/analytics/growth     — динамика роста

Team:
  GET   /api/team                 — список сотрудников
  GET   /api/team/:id/workload    — нагрузка сотрудника
  POST  /api/team/allocate        — назначить на проект

Notifications:
  GET   /api/notifications        — список уведомлений
  PATCH /api/notifications/:id/read
  PATCH /api/notifications/read-all

System:
  GET   /api/health               — health check
```

### 6.3 Аутентификация и роли

```
Роли:
  SUPER_ADMIN   — полный доступ + системные настройки
  ADMIN         — управление клиентами, командой, биллинг
  MANAGER       — работа с клиентами, отчёты, GRI
  ANALYST       — только просмотр + analytics
  CLIENT        — только свои данные

JWT Структура:
{
  "sub": "user_id",
  "role": "MANAGER",
  "org": "org_id",
  "iat": 1711234567,
  "exp": 1711320967
}

Middleware защита (Next.js middleware.ts):
  /api/*          → проверка JWT
  /(dashboard)/*  → redirect на /login если нет сессии
  /admin/*        → проверка роли ADMIN/SUPER_ADMIN
```

### 6.4 Схема базы данных (высокий уровень)

```sql
-- Пользователи
users (
  id UUID PK,
  email VARCHAR UNIQUE,
  password_hash VARCHAR,
  name VARCHAR,
  role user_role ENUM,
  org_id UUID FK,
  avatar_url VARCHAR,
  created_at TIMESTAMP,
  last_login TIMESTAMP
)

-- Организации / компании
organizations (
  id UUID PK,
  name VARCHAR,
  slug VARCHAR UNIQUE,
  plan subscription_plan ENUM,
  created_at TIMESTAMP
)

-- Клиенты (те компании, которых обслуживают)
clients (
  id UUID PK,
  org_id UUID FK → organizations,
  name VARCHAR,
  industry VARCHAR,
  stage growth_stage ENUM,
  manager_id UUID FK → users,
  status client_status ENUM,
  created_at TIMESTAMP
)

-- GRI Reports
gri_reports (
  id UUID PK,
  client_id UUID FK → clients,
  score INTEGER (0–1000),
  domains JSONB,      -- { strategy: 820, finance: 760, ... }
  calculated_at TIMESTAMP,
  version VARCHAR
)

-- Projects
projects (
  id UUID PK,
  client_id UUID FK → clients,
  name VARCHAR,
  status project_status ENUM,
  start_date DATE,
  end_date DATE,
  team JSONB         -- [{ user_id, allocation_pct }]
)

-- Reports (uploaded files)
reports (
  id UUID PK,
  client_id UUID FK → clients,
  name VARCHAR,
  category VARCHAR,
  file_url VARCHAR,
  file_size INTEGER,
  uploaded_by UUID FK → users,
  uploaded_at TIMESTAMP
)

-- Notifications
notifications (
  id UUID PK,
  user_id UUID FK → users,
  type notification_type ENUM,
  title VARCHAR,
  body TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  entity_type VARCHAR,  -- 'client', 'report', 'gri'
  entity_id UUID,
  created_at TIMESTAMP
)

-- Activity Log
activity_log (
  id UUID PK,
  user_id UUID FK → users,
  action VARCHAR,
  entity_type VARCHAR,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMP
)
```

---

## ЧАСТЬ 7 — ПОЛНОЕ ТЕХНИЧЕСКОЕ ЗАДАНИЕ (ТЗ)

### 10.1 Архитектура

#### Frontend (Next.js + React)

```
Тип: Single-Page Application + SSR (гибрид)
Фреймворк: Next.js 14 с App Router
Язык: TypeScript 5
UI: React 18 + Tailwind CSS v3 + shadcn/ui
Деплой: Vercel (оптимальная совместимость с Next.js)
CDN: Vercel Edge Network (автоматически)
```

#### Backend (Next.js API Routes + Supabase)

```
API: Next.js Route Handlers (/app/api/*)
БД: PostgreSQL через Supabase
Auth: NextAuth.js v5
Хранилище файлов: Supabase Storage
Realtime: Supabase Realtime WebSocket
Email: Resend
Фоновые задачи: Inngest
```

#### Database

```
Основная БД: Supabase PostgreSQL
Кэш: Upstash Redis
Поиск: Суперседит встроенным pg_trgm или Supabase Full-text Search
```

### 10.2 Как реализовать UI

#### Компоненты

**Шаг 1: Инициализировать проект**
```bash
npx create-next-app@latest aistart360 --typescript --tailwind --app
cd aistart360
npx shadcn-ui@latest init
```

**Шаг 2: Скопировать Tailwind config**
```
Взять существующий tailwind.config из любого code.html
Перенести в корневой tailwind.config.ts
Добавить плагины: @tailwindcss/forms, @tailwindcss/container-queries
```

**Шаг 3: Установить зависимости**
```bash
npm install framer-motion zustand @tanstack/react-query
npm install react-hook-form zod @hookform/resolvers
npm install recharts
npm install next-auth@beta @auth/prisma-adapter
npm install prisma @prisma/client
npm install @supabase/supabase-js
```

**Шаг 4: Начать с Layout компонентов**
```
1. Создать Sidebar.tsx (nav items, collapse logic, RBAC filter)
2. Создать Header.tsx (search, notifications, user menu)
3. Обернуть в (dashboard)/layout.tsx
4. Добавить Framer Motion для page transitions
```

**Шаг 5: Извлечь компоненты из HTML-файлов**
```
Для каждого code.html файла:
  1. Открыть файл
  2. Найти повторяющиеся паттерны (карточки, таблицы, форма)
  3. Создать React-компонент с Props interface
  4. Заменить хардкод на динамические данные
```

#### Вёрстка

```
Grid система:
  Основная: CSS Grid через Tailwind (grid grid-cols-12)
  Cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-4

Breakpoints (из Tailwind):
  sm: 640px  (мобильный горизонтально)
  md: 768px  (планшет)
  lg: 1024px (ноутбук)
  xl: 1280px (десктоп)
  2xl: 1536px (широкий экран)

Для этого портала:
  < 768px:  bottom navigation, collapsed sidebar hidden
  768–1024: icon-only sidebar (64px)
  > 1024px: full sidebar (256px)
```

#### Адаптив (Responsive)

```
Mobile (< 768px):
  - Sidebar убирается, появляется Bottom Navigation (5 иконок)
  - KPI блоки: 2 колонки
  - Tables: горизонтальный скролл с sticky первой колонкой
  - Modals: fullscreen bottom sheet

Tablet (768–1024px):
  - Sidebar: icon-only (64px), tooltip с названием
  - KPI блоки: 2–3 колонки
  - Charts: упрощённые (меньше данных)

Desktop (> 1024px):
  - Sidebar: полный (256px) с подписями
  - KPI блоки: 4 колонки
  - Все фичи активны
```

### 10.3 Логика

#### Авторизация

```
1. Пользователь вводит email/password на /login
2. POST /api/auth/login
3. NextAuth проверяет credentials через CredentialsProvider
4. При успехе: создаётся JWT с { sub, role, org }
5. JWT хранится в httpOnly cookie (secure, sameSite: strict)
6. Middleware (middleware.ts) проверяет cookie на каждом route
7. Если нет — redirect на /login
8. Если роль не соответствует — redirect на /403

Refresh Token:
  - Access Token: 24 часа
  - Refresh Token: 30 дней
  - Silent refresh при expiry < 5 минут

OAuth (Google):
  - Опционально через NextAuth GoogleProvider
  - Только для whitelisted email domains (org-level)
```

#### Работа с данными

```
Client-side data flow:
  1. Компонент монтируется
  2. useQuery('clients', fetchClients) вызывается
  3. TanStack Query проверяет кэш (staleTime: 5 минут)
  4. Если свежий — возвращает кэш немедленно
  5. Если устаревший — показывает кэш + фоново обновляет
  6. При обновлении — инвалидация через queryClient.invalidateQueries

Оптимистичные обновления (Optimistic Updates):
  Для быстрого UI отклика (без ожидания API):
  - Пометить уведомление прочитанным → сразу обновить UI, затем API
  - Обновить статус клиента → сразу в таблице, затем API

Real-time updates:
  Supabase Realtime подписка на таблицу notifications:
  useEffect(() => {
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        addNotification(payload.new)
      })
      .subscribe()
    return () => channel.unsubscribe()
  }, [userId])
```

#### Роли пользователей

```
SUPER_ADMIN видит:
  ✅ Всё + системные настройки + биллинг + audit log

ADMIN видит:
  ✅ Дашборд, Клиенты, Команда, Аналитика, Настройки, Биллинг

MANAGER видит:
  ✅ Дашборд, свои Клиенты, Проекты, Отчёты, Analytics, Intelligence
  ❌ Команда (только просмотр), не видит других менеджеров' клиентов

ANALYST видит:
  ✅ Дашборд (read-only), Analytics, Reports (download only)
  ❌ Не может создавать/редактировать клиентов

CLIENT видит:
  ✅ Свой GRI, Свой Growth Plan, Свои Отчёты, Support
  ❌ Ничего чужого

Реализация через Next.js Middleware:
  Каждый role имеет список разрешённых путей.
  Middleware проверяет при каждом запросе.
```

### 10.4 Функционал — Ключевые модули

#### Модуль 1: GRI (Growth Readiness Index)

```
Что это: Composite score 0–1000, оценивающий готовность компании к росту
Домены (6):
  1. Strategy & Vision       (вес: 20%)
  2. Financial Health        (вес: 20%)
  3. Operations Efficiency   (вес: 15%)
  4. Team & Talent           (вес: 15%)
  5. Market Position         (вес: 15%)
  6. Technology Readiness    (вес: 15%)

Как рассчитывается:
  1. Клиент заполняет intake-форму (или менеджер загружает данные)
  2. Система обрабатывает данные (background job через Inngest)
  3. Каждый домен получает raw score → нормализуется до 0–100
  4. Weighted average → итоговый GRI Score 0–1000
  5. Сравнивается с бенчмарками отрасли
  6. Генерируется рекомендация

Отображение:
  - Dial с числом (JetBrains Mono, крупный шрифт)
  - Radar Chart (6 доменов)
  - Trend line (история)
  - Domain breakdown cards
  - Benchmark comparison
```

#### Модуль 2: Reports Hub

```
Типы отчётов:
  - GRI Report (auto-generated PDF)
  - Financial Analysis (uploaded)
  - Market Research (uploaded)
  - Growth Plan (auto-generated)
  - Custom Report (uploaded)

Upload flow:
  1. Drag & drop или File picker
  2. Валидация: тип (PDF, XLSX, CSV, DOCX), размер < 50MB
  3. Upload на Supabase Storage (presigned URL)
  4. Запись метаданных в таблицу reports
  5. Toast: "Отчёт загружен"

Download/Preview:
  - In-browser preview для PDF (iframe)
  - Download button
  - Share link с expiry (signed URL 24ч)
```

#### Модуль 3: Intelligence Hub

```
Источники данных:
  - Новостной агрегатор (RSS / News API)
  - Рыночные данные (Alpha Vantage или подобное)
  - Внутренние signals (система мониторинга)

Фильтрация:
  - По отрасли
  - По уровню приоритета (Critical / High / Medium)
  - По дате
  - По типу (News / Signal / Opportunity)

Автоматические алерты:
  - Если сигнал касается клиента из базы → уведомление менеджеру
```

#### Модуль 4: Notifications

```
Типы:
  CLIENT_GRI_UPDATED    — пересчитан GRI
  REPORT_UPLOADED       — загружен новый отчёт
  CRITICAL_SIGNAL       — критический сигнал по клиенту
  PROJECT_STATUS_CHANGE — изменился статус проекта
  TEAM_ASSIGNED         — назначен на проект
  SYSTEM_ALERT          — системное уведомление

Каналы:
  1. In-app (bell icon + notification center page)
  2. Email (через Resend)
  3. Опционально: Telegram bot или WhatsApp

Приоритеты:
  URGENT   → badge + звук + email немедленно
  HIGH     → badge + email через 15 минут
  MEDIUM   → badge, email дайджест раз в день
  LOW      → только in-app, без email
```

#### Модуль 5: Analytics & Metrics

```
KPI метрики:
  - Средний GRI Score по портфелю
  - LTV / CAC ratio
  - System GMV (общий объём)
  - Portfolio Growth Rate
  - Active Clients Count
  - Churn Rate (отток клиентов)
  - NPS Score

Визуализации:
  - Trend charts (Line Chart, 30/90/365 дней)
  - Distribution charts (гистограммы)
  - Comparative analysis (сравнение клиентов)
  - Cohort analysis (по дате онбординга)

Фильтры дашборда:
  - Период (Last 7d / 30d / 90d / Custom)
  - Индустрия
  - Менеджер
  - Стадия роста
```

### 10.5 Интеграции

#### API интеграции

```
Supabase (обязательно):
  - Auth: supabase.auth.signIn()
  - Database: supabase.from('clients').select()
  - Storage: supabase.storage.from('reports').upload()
  - Realtime: supabase.channel('notifications')
  Документация: https://supabase.com/docs

NextAuth.js (обязательно):
  - Google OAuth (опционально)
  - Credentials (email/password)
  Документация: https://next-auth.js.org/

Resend (email):
  import { Resend } from 'resend'
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({ from, to, subject, react: EmailTemplate })

Inngest (фоновые задачи):
  export const calculateGri = inngest.createFunction(
    { id: 'calculate-gri' },
    { event: 'gri/calculate' },
    async ({ event, step }) => {
      const result = await step.run('compute', () => computeGRI(event.data))
      await step.run('save', () => saveGRI(result))
    }
  )
```

#### Платёжная система

```
Рекомендация: Stripe (для SaaS подписок)

Планы:
  Starter:  до 5 клиентов,  $99/мес
  Growth:   до 25 клиентов, $299/мес
  Scale:    до 100 клиентов, $799/мес
  Enterprise: неограниченно, по договору

Реализация:
  1. Stripe Billing + Stripe Checkout
  2. Webhook /api/webhooks/stripe для обработки событий
  3. Обновление таблицы organizations.plan при успешной оплате
  4. Middleware проверяет plan limit перед созданием нового клиента
```

#### Уведомления (Push/Email)

```
Email: Resend (простой API, React-компоненты для шаблонов)
In-app: Supabase Realtime
Push notifications (PWA): Web Push API + service worker (опционально)
```

### 10.6 Развёртывание

#### Где и как хостить

```
Frontend + API: Vercel
  - Автоматический деплой из GitHub
  - Edge Functions для быстрых API
  - Preview Deployments для PR
  - Бесплатный tier для начала (50GB bandwidth, 100GB-hours)

Database: Supabase
  - Free tier: 500MB DB, 1GB storage
  - Pro: $25/мес (8GB DB, 100GB storage)
  - Встроенный auth, realtime, storage

Cache: Upstash Redis
  - Free tier: 10,000 req/day
  - Pay-per-request для production

CDN для статики: Vercel Edge Network (автоматически)

Domains:
  app.aistart360.com   → основной портал
  api.aistart360.com   → если отдельный API сервер (не нужно с Vercel)
```

#### Environment Variables

```bash
# .env.local
NEXTAUTH_URL=https://app.aistart360.com
NEXTAUTH_SECRET=your-secret-key-min-32-chars

DATABASE_URL=postgresql://...supabase...

NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # только на сервере!

RESEND_API_KEY=re_...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...

INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...
```

#### CI/CD (базово)

```yaml
# .github/workflows/deploy.yml
name: Deploy to Vercel

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run build
      # Vercel автоматически деплоит через GitHub integration
      # Ручная команда: vercel --prod
```

#### Чеклист перед продакшн-запуском

```
Security:
  ✅ Все API routes защищены middleware
  ✅ CORS настроен (только whitelisted origins)
  ✅ Rate limiting на auth endpoints (10 req/min)
  ✅ HTTPS everywhere (Vercel автоматически)
  ✅ httpOnly cookies для JWT
  ✅ CSP headers
  ✅ SQL Injection защита (Prisma ORM)
  ✅ XSS защита (React by default + sanitize HTML)
  ✅ Supabase RLS включён на всех таблицах
  ✅ Secrets только в .env (не в коде)

Performance:
  ✅ Tailwind CSS purged (только использованные классы)
  ✅ Images через next/image (автоматическое webp, lazy loading)
  ✅ Code splitting (автоматически Next.js)
  ✅ Server Components где возможно
  ✅ React Query для кэширования

Monitoring:
  ✅ Vercel Analytics (встроено)
  ✅ Sentry для error tracking
  ✅ /api/health endpoint
```

### 10.7 MVP vs Полная версия

#### MVP (Минимально жизнеспособный продукт)

**Цель:** Запустить за 4–6 недель, проверить гипотезы

**Включает:**
```
✅ Auth (login, logout, JWT)
✅ Dashboard (статичные KPI + список клиентов)
✅ Clients (список, добавить, базовый профиль)
✅ GRI Score (отображение, ручной ввод данных)
✅ Reports Upload (загрузка PDF, список)
✅ Notifications (только in-app)
✅ User Profile (имя, аватар, пароль)
✅ Роли: ADMIN + CLIENT только
✅ Responsive (desktop + mobile)
```

**НЕ включает в MVP:**
```
❌ Intelligence Hub
❌ Advanced Analytics (только базовые числа)
❌ Billing / Stripe
❌ Realtime WebSocket
❌ Email notifications
❌ Background jobs (GRI пересчёт вручную)
❌ Onboarding wizard
❌ Search (только client-side фильтрация)
```

**Стек MVP (упрощённый):**
```
Next.js 14 + TypeScript
Tailwind CSS + shadcn/ui
Supabase (DB + Auth + Storage)
Vercel (деплой)
```

#### Полная версия (Full Product)

**Цель:** Полноценный B2B SaaS портал

**Добавляется к MVP:**
```
✅ Intelligence Hub с агрегацией данных
✅ Advanced Analytics + Charts
✅ Stripe Billing + подписки
✅ Realtime уведомления (WebSocket)
✅ Email уведомления (Resend)
✅ Onboarding Wizard
✅ GRI Auto-calculation (Inngest)
✅ Team Allocation модуль
✅ Global Search
✅ Audit Log
✅ Export (PDF, CSV, XLSX)
✅ Все роли (SUPER_ADMIN, ADMIN, MANAGER, ANALYST, CLIENT)
✅ Multi-organization support
✅ OAuth (Google)
✅ 2FA (опционально)
✅ White-label (опционально)
```

---

## ЧАСТЬ 8 — ПРИОРИТЕТЫ РЕАЛИЗАЦИИ

### Sprint 1 (Неделя 1–2): Foundation
```
□ Инициализация Next.js проекта
□ Tailwind config из дизайна
□ Supabase: создать проект, DB схему, RLS
□ Auth: login/logout с NextAuth
□ Layout: Sidebar + Header (responsive)
□ Dashboard страница (статичные данные)
```

### Sprint 2 (Неделя 3–4): Core Features
```
□ Clients: список + профиль
□ GRI: страница с display логикой
□ Reports: upload + список
□ User Profile страница
□ Notifications: in-app
```

### Sprint 3 (Неделя 5–6): Data & Analytics
```
□ TanStack Query: подключить все API
□ Реальные данные вместо mock
□ Analytics страница с Recharts
□ Фильтры и пагинация
□ Search functionality
```

### Sprint 4 (Неделя 7–8): Polish & Production
```
□ Framer Motion: анимации, transitions
□ Empty/Error/Loading states везде
□ Email notifications (Resend)
□ Sentry error tracking
□ Performance audit
□ Security review
□ Deploy production на Vercel
```

---

## ЧАСТЬ 9 — БЫСТРЫЙ СТАРТ

```bash
# 1. Создать проект
npx create-next-app@latest aistart360-portal \
  --typescript --tailwind --app --src-dir --import-alias "@/*"

# 2. Установить зависимости
cd aistart360-portal
npx shadcn-ui@latest init
npm install framer-motion zustand @tanstack/react-query
npm install react-hook-form zod @hookform/resolvers
npm install recharts
npm install next-auth@beta @auth/prisma-adapter
npm install prisma @prisma/client
npm install @supabase/supabase-js
npm install resend

# 3. Создать .env.local с переменными выше

# 4. Инициализировать Prisma
npx prisma init --datasource-provider postgresql
# Перенести схему из раздела 6.4

# 5. Push schema в Supabase
npx prisma db push

# 6. Запустить dev
npm run dev
# Открыть http://localhost:3000
```

---

*Документ создан на основе анализа 45 дизайн-компонентов AIStart360.
Все компоненты (code.html) доступны в /Design/* как референс для реализации.*
