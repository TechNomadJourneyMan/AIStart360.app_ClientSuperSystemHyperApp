# 04 — Точка А: как работает сейчас и целевая модель

Назначение: зафиксировать реальный расчёт Точки А и описать целевые Executive Overview (L1), раздел «Метрики» (L2) и цепочку provenance.
Обновлено: 2026-10-06

Связанные: [03-database.md](03-database.md) (085), [05-agents.md](05-agents.md), [02-gap-analysis.md](02-gap-analysis.md).

## 1. Сейчас

### 1.1 Движок v1 (`lib/point-a-engine.ts`) — единственный источник балла

| Элемент | Факт |
|---|---|
| Вход | Только `survey_answers` (документы, GRI, метрики, CRM не участвуют) |
| Запуск | `POST /api/v1/diagnostics/recalculate` (`route.ts:39-98`) — при финише анкеты, раннем выходе, кнопках «Пересчитать». Не при сохранении шага |
| Блоки | Финансы `:91-171`, Продажи `:175-231`, Операции `:235-277`, Маркетинг `:281-320`, Стратегия `:324-355` — аддитивные чек-листы 0–100 |
| Итог | `overall = 0.30·F + 0.25·S + 0.20·O + 0.15·M + 0.10·St` (`:552-558`) |
| Health | `0.6·overall + 20·[F>50] + 10·[S>50] + 10·[O>50]` (`:560-565`) |
| Стадия | seed / early / growth / scale по `overall` (`:81-87`); статусы по порогам 85/70/50/30 (`:73-79`) |
| Находки | `risks`, `insights`, `quick_wins`, `data_gaps` — правила (`:357-493`) → JSONB в `diagnostics` |
| Хранение | `diagnostics`: новая версия, триггер `is_current` (077:111-135) |

Дефекты:
- 7 legacy-ключей недоступны в текущей анкете: `s2_ltv`, `s2_cac`, `s2_revenue_2023`, `s2_revenue_2025`, `s2_new_clients_2024`, `s2_repeat_clients_2024`, `s3_has_loyalty`. Итог: Финансы ≤≈50, Продажи −25, Маркетинг −10, вечный риск «CAC или LTV не указаны» (`:107,147,161,184-186`). Часть ключей подменяется в `withCurrentAliases` (`:513-540`).
- Баллы за длину текста: аудитория >20 символов +15 (`:301`), цель на 3 года >20 символов +20 (`:334`).
- `data_gaps` просит поля, которых в анкете нет (`:480`).

### 1.2 Версии

| Версия | Файлы | Вход | В UI |
|---|---|---|---|
| v1 | `lib/point-a-engine.ts` | анкета | **Да** — единственный балл |
| AI-слой | `lib/ai/point-a-analyzer.ts`, `/api/v1/diagnostics/ai-analyze` | анкета + v1 + компания + заметки эксперта | Только `/client/point-a` |
| v2 aggregator | `lib/point-a/aggregator.ts`, `helpers.ts` | v1 + резолвер метрик | Да, `PointAIntelligenceSection`; `trends: []` |
| v2 scoring | `scoring-v2.ts`, `weights.ts`, `benchmarks.ts` | — | **Мёртв** (только тесты) |
| narrative / history | `lib/point-a/narrative.ts`, `history.ts` | — | **Мёртв** (нет вызовов API) |
| v3 | `lib/point-a/v3/*` | анкета + разобранные файлы базы клиентов | Частично: Retention, RFM, Loss map; `TopSalesTable` — `sr-only`; 6-блочный `/api/v1/point-a/v3` — мёртв |

### 1.3 Две UI

| | `/client/point-a` | `/point-a` |
|---|---|---|
| В навигации | Нет (ссылки из Header, Point B, писем) | Да, «Точка А» |
| Общий балл | Gauge «/10» | Нет героя; маленький круг в «Последние расчёты» |
| Блоки | 5 карточек + AI-диагноз (текст говорит «7 блоков») | 5 блоков «/100» |
| AI-анализ | Да | Нет |
| Метрики | Нет | KeyMetricsHero (всегда пуст), MetricZonesGrid (зоны ложные) |
| Дата | Сегодняшняя (не `calculated_at`) | Дата расчёта |
| Риски / quick wins | Да | Через `/dashboard` |

`/client/home` показывает «Точка А N/100» и «GRI N/10». Шкалы не согласованы.

### 1.4 Что есть для Overview сейчас

| Элемент | Есть? | Где |
|---|---|---|
| Общий балл | частично | `/client/point-a`, `/client/home` |
| Стадия зрелости | хранится, не выводится | `diagnostics.stage` |
| Проблемные зоны | частично | статусы блоков; красная зона MetricZonesGrid всегда пуста |
| Риски | да | `diagnostics.risks` |
| Сильные стороны | ошибочно | «сильные» = топ по уверенности данных, не по результату (`helpers.ts:177-191`) |
| Пробелы | частично | `data_gaps` хранится, не выводится |
| Полнота | частично | % анкеты; `computeDataConfidence` (`lib/gri/trust.ts:57-96`) не используется |
| Дата обновления | частично | см. 1.3 |
| Количество источников | нет | — |

## 2. Цель

### 2.1 Источники Точки А

| Источник | Таблица | Что даёт | provenance_type | Агент |
|---|---|---|---|---|
| Онбординг / анкета | `survey_answers` | Ответы, цели, профиль | FACT (со слов клиента) | data_collection |
| Компания | `companies` | Отрасль, размер, цели выручки | FACT | data_collection |
| GRI | `gri_assessments` | 7 разделов, индекс, TOP-5 ограничений | FACT (самооценка) / CALCULATED (индекс) | data_collection |
| Документы | `documents.parsed_data` | Поля с confidence, строки продаж/клиентов | FACT (извлечено) | document_intelligence |
| Интеграции (CRM) | `crm_clients`, `crm_provider_connections` | Сделки, клиенты, активность | FACT | data_collection |
| Метрики | `metrics` + `metric_value_history` | Значения, тренды | FACT / CALCULATED | metrics |
| Бенчмарки | код (`lib/gri/benchmarks.ts`, таксономия) | Сравнение | CALCULATED (с меткой источника) | benchmark |
| Находки | `diagnostic_findings` | Риски, пробелы, сильные стороны | CALCULATED / INFERRED / AI_HYPOTHESIS | data_quality, diagnostic |
| Рекомендации | `diagnostic_recommendations` | Действия 30/90/180 | RECOMMENDATION | recommendation |

Балл (D9): 5 блоков сохраняются; v1 переводится на текущие ключи; там, где есть метрика, блок берёт её значение вместо самооценки из анкеты.

### 2.2 Executive Overview (L1)

Снимок сохраняется в `diagnostic_sessions.overview` при финализации; UI читает снимок, а не пересчитывает.

| Элемент | Правило | Источник |
|---|---|---|
| Общий балл | v1 (исправленный) по 5 блокам, единая шкала 0–100 | `diagnostics.overall_score` |
| Стадия зрелости | seed / early / growth / scale + текстовое пояснение | `diagnostics.stage` |
| Топ проблемных зон | 3 категории с наихудшим статусом метрик / баллом блока | `metrics` + таксономия + блоки |
| Ключевые риски | находки `kind=risk`, `severity ∈ {critical, high}`, `visible_to_client` | `diagnostic_findings` |
| Сильные стороны | `kind=strength` (по результату, не по полноте данных) | `diagnostic_findings` |
| Критические пробелы | `kind ∈ {gap, data_gap}`, severity ≥ high | `diagnostic_findings` |
| Статус диагностики | `diagnostic_sessions.status` | — |
| Полнота данных | `computeDataConfidence` + прогресс анкеты (`/api/v1/onboarding/status`) | `lib/gri/trust.ts`, `lib/survey/steps.ts` |
| Последнее обновление | `diagnostics.calculated_at` / `completed_at` сессии | — |
| Обработано источников | шаги анкеты N/12, документы parsed N, GRI да/нет, CRM да/нет, метрик со значением N/126 | `diagnostic_sessions.sources` |

Одна UI Точки А (предложение, вне D9 — подтвердить): содержание `/client/point-a` (gauge, блоки, AI) + метрики `/point-a`. Второй маршрут — редирект.

### 2.3 Раздел «Метрики» (L2)

Возможности: категории и подкатегории, фильтры, поиск, сортировка, период, источник, уверенность, статус, тренд/дельта (из истории), бенчмарк, цель, факт.

Таксономия (D2; файл маппинга метрика → категория в коде):

| Категория | Наполнение сейчас (126 метрик: biz 48 / kpi 12 / gri 7 / goal 59) | Данные для новых метрик |
|---|---|---|
| Финансы | biz «Финансы» (8) | шаг 9 анкеты, документы P&L |
| Продажи | biz «Продажи» (7) | CRM, строки продаж из файлов |
| Маркетинг | biz «Маркетинг» (9) | шаг 7, рекламные отчёты |
| Клиенты | biz «Клиенты» (6) | шаг 5, база клиентов (RFM, retention v3) |
| Операции | biz «Операции» (7) | шаг 4 |
| Команда / HR | biz «HR» (6) | шаг 4, GRI «Team» |
| Продукт | biz «Продукт» (5) | шаг 3, GRI «Product & Demand» |
| Автоматизация | **нет** | шаг 12 `s12_*` (системы и инструменты) |
| AI-зрелость | **нет** | шаг 12 `s12_*`, GRI «Operations» |
| Digital-зрелость | **нет** | шаг 12 `s12_*` |
| Управление | **нет** | шаг 4 `s4m_*`, GRI «Owner Readiness» |
| Цели роста | goal (59) по 11 целям | Metrics.docx (ниже) |
| GRI | gri (7) | `gri_assessments` |

KPI-неймспейс (12, отраслевой FMCG-набор: доля рынка, ROA, SKU, фолловеры…) раскладывается по категориям с тегом «отраслевой» или скрывается для нерелевантных отраслей.

Цели роста (владелец, `Documents/Metrics.docx`):

| # | Цель | Ключевые метрики |
|---|---|---|
| 0 | Основные параметры | Сумма продаж; какие продукты; по какой цене; сколько продано |
| 1 | Привлечение новых клиентов | Новые клиенты / лиды / целевые лиды по источникам; стоимость клиента, лида, целевого лида; расходы на рекламу |
| 2 | Удержать и сделать постоянными | Всего клиентов; купивших ≥2 раз и их средний чек; сумма повторных продаж; Time Between Purchases; Churn Rate; LTV; покупок на клиента; Repeat Purchase Rate |
| 3 | Увеличить средний чек | Средний чек; доход на клиента; доля и сумма апсейлов; доля и сумма кросс-сейлов |
| 4 | Увеличить частоту покупки | Frequency; Repeat Purchase Rate; Time Between Purchases; LTV; Retention 30/60/90 |
| 5 | Запустить сарафанное радио | Клиенты и % по рекомендации; лиды и % по рекомендации; NPS; UGC Volume; Share Rate |
| 6 | Забрать клиентов у конкурента | Кол-во и % перешедших от конкурента; контакты клиентов конкурентов; % от квал. лидов |
| 7 | Создать потребность | Engagement rate; CR контент→диалог; CR диалог→диагностика; % прогретых лидов; Time-to-interest |
| 8 | Ускорить сделку | Средний цикл; длительность и количество сделок; % ускорения; дни между этапами Лид→Диалог→Встреча→КП→Сделка |
| 9 | Снизить CAC | CAC = (маркетинг + продажи + прочие) / новые клиенты; LTV; LTV/CAC |
| 10 | Повысить конверсию | Лид→Диалог; Диалог→Встреча; Встреча→КП; КП→Сделка; Time to response; Time to close |
| 11 | Чтобы выбрали вас | Win-rate; Loss Rate |

Бенчмарки владельца (метка источника «Metrics.docx»): Retention 30 = 50–70 % хорошо; Retention 60 = 30–50 % стабильно; Retention 90 = 15–30 % отлично; LTV > 3×CAC — бизнес прибыльный.

### 2.4 Поля метрики

| Поле | Смысл | Откуда (цель) | Сейчас |
|---|---|---|---|
| name | Название | реестр | ✅ `label` |
| description | Что / зачем / как | `descriptions.ts` (без `current_state`) | ✅ (с фейковым `current_state`) |
| value | Фактическое значение | `metrics.metric_value` | ✅ |
| unit | Единица | реестр (`inferUnit`) | ✅ (по regex) |
| category | Категория таксономии | файл таксономии | ⚠ только biz-отдел |
| source | survey / document / manual / calculated / resolver / external / prisma | `metrics.source` | ✅ |
| calculation_method | Формула / способ | реестр (`formula`, `how`) + `provenance` | ⚠ только текст каталога |
| confidence | 0..1 | `metrics.confidence` | ✅ |
| period | год / квартал / месяц | `metrics.period_*` | ⚠ у анкеты всегда NULL |
| target | Цель | `metric_targets` (085) | ❌ (только выручка) |
| benchmark | Эталон + метка источника | код | ❌ в каталоге |
| trend | Δ к прошлому значению, направление | `metric_value_history` (085) | ❌ |
| status | в норме / риск / критично / нет цели / нет данных | f(value, target, benchmark, direction) | ❌ (зоны ложные) |
| last_updated | Время последнего изменения значения | `metric_value_history.recorded_at` | ⚠ `computed_at` |

Статус: есть цель → сравнение с целью; нет цели, есть бенчмарк → сравнение с бенчмарком; нет обоих → «нет цели» (не «зелёная зона»); нет значения → «нет данных» + подсказка, какой источник заполнить (`suggestSourceFor`).

### 2.5 Provenance

```
 Source            Raw                    Transformation           Metric               AI reasoning          Finding                Recommendation
 survey_answers ─► answer{value}      ─►  coerce/parse по ключу ─► metrics (FACT)   ─►                    ─►  diagnostic_findings ─► diagnostic_recommendations
 documents      ─► parsed_data.fields ─►  resolver (priority,  ─► metrics (FACT)       LLM (agent run,       (evidence[] → ссылки   (finding_ids[], RECOMMENDATION)
 gri_assessments─► scores             ─►  unit gate)           ─► metrics (CALC)      model, prompt_ver) ─►  на survey/doc/metric)  └► action_items (по решению)
 CRM / интегр.  ─► snapshot           ─►  формулы реестра      ─► metrics (CALC)
```

| Тип | Определение | Видимость клиенту | Пример |
|---|---|---|---|
| FACT | Значение из источника без вычислений (ответ, поле документа, CRM) | Да | Выручка 2024 из P&L |
| CALCULATED | Детерминированный расчёт по формуле/правилу | Да | LTV/CAC; балл блока |
| INFERRED | Детерминированный вывод из нескольких фактов (правило) | Да | «Нет CRM при 500+ клиентах» |
| AI_HYPOTHESIS | Вывод LLM; всегда со ссылками `evidence` | Только после ревью (`visible_to_client=false` по умолчанию) | «Вероятная причина оттока — …» |
| RECOMMENDATION | Предлагаемое действие | После ревью / публикации отчёта | «Внедрить повторное касание на 30-й день» |

Правила: у каждой находки есть `produced_by`, `confidence`, `evidence[]`; у AI — ещё `agent_run_id`, `model`, `prompt_version`. Клиент не может записать `source/confidence/provenance` (guard-триггеры 085). UI показывает бейдж типа и ссылку «откуда это».

### 2.6 Исправления Phase 3–5

| Что | Где | Действие |
|---|---|---|
| Legacy-ключи v1 | `lib/point-a-engine.ts` | Перевод на текущие ключи; убрать баллы за длину текста |
| Фейковые `current_state` | `lib/metrics/descriptions.ts` → `MetricDrillDownModalV2`, `MetricsPageClient` | Не показывать; поле удалить из каталога |
| MetricZonesGrid | `components/point-a/v2/MetricZonesGrid.tsx:82-103` | Статус по правилу 2.4; рабочий клик |
| `/api/v1/metrics` | `app/api/v1/metrics/route.ts:35-37` | Отдавать значения + delta + target |
| Дата на `/client/point-a` | `page.tsx:253,366-369` | `calculated_at` |
| «5 Потерь» | `PointAQuickPills.tsx:95,183` | Реальное число |
| GRI AI-вкладка | `GriPageShell.tsx:45,148-152` | Сид из `gri_assessments`; без него — empty state |
| Пустой Intelligence без компании | `/api/v1/point-a/aggregate/route.ts:37-43` | 404 → empty state |
| Бесконечный спиннер | `app/client/point-a/page.tsx:158,175,198-200` | Обработать отсутствие сессии |
