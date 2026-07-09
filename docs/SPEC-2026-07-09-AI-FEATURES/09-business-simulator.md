# 09 · Часть K — Бизнес-симулятор (M2 MVP / L3 полный · L · 🔥🔥)

Отдельная страница `/simulator`: тренажёр перехода А→Б. **Дополняет** раздел «Точка Б», не
заменяет: Точка Б — целевая траектория и роадмап; симулятор — «что если» вокруг неё.

## 1. Архитектурный принцип: детерминированное ядро + LLM-обвязка

Численный каркас сценария считает **код**, не модель (паттерн уже принят: `point-b-analyzer`
сознательно не содержит числовых полей в Zod-схеме, числа — из `lib/point-b/engine.ts`).

```
lib/simulator/
  core.ts        — детерминированная модель: помесячная проекция revenue/costs/cash
                   от драйверов (лиды × конверсия × чек × повторные − затраты), 3 пресета
                   отклонений (optimistic +X% / realistic / pessimistic −Y% к драйверам)
  levers.ts      — рычаги по типу симуляции (что пользователь «крутит»)
  narrative.ts   — LLM (Sonnet, structured): интерпретация, риски, шаги, stop-loss —
                   БЕЗ права менять числа ядра (схема без числовых полей, как в point-b)
  schema.ts      — Zod-схема SimulationResult (зеркало JSON-схемы §5)
```

Драйверы берутся из данных пользователя; отсутствующие — **явно** запрашиваются или помечаются
допущением (missing_data). Никакой «средней темп-роста отрасли» без источника.

## 2. Источники данных (K1) → маппинг на существующее

| Источник ТЗ | Реализация |
|---|---|
| Анкета, диагностика, GRI | `buildAssistantContext` + `gri_assessments` (top_5_limits как ограничения модели) |
| Психопрофиль | risk-подача сценариев (averse → сначала pessimistic), не числа |
| Файлы | parsed_data метрики (`s9n_*`, extract-rows продажи) |
| Цели, Точка А/Б | `point_b_analysis` + `calculatePointBV2` таргеты |
| Рыночные данные | Mark-analytics as-of (если есть) — только как контекст narrative с citation |
| Ограничения/ресурсы/сроки | форма настройки сценария (§3) |
| Выполненные действия | прогресс плана 90д (стартовая точка «что уже сделано») |

## 3. Возможности (K2) и UX

```
/simulator
 ├─ Список симуляций (сохранённые карточки: тип, цель, дата, confidence) [+ Новая]
 ├─ Мастер (4 шага):
 │   1. Тип симуляции (§4) + цель (из Точки Б или своя)
 │   2. Текущие данные: автозаполнение из профиля (подсвечено «из ваших данных») +
 │      ручные поля; пропуски → допущения (жёлтые чипы)
 │   3. Ограничения и рычаги: бюджет, команда, срок, горизонт (3/6/12 мес), настройка рычагов
 │   4. Предпросмотр допущений → [Смоделировать]
 ├─ Результат: 3 кривые (opt/real/pess, recharts) + таблица помесячно + блоки:
 │   допущения · недостающие данные · риски · первые 3–5 шагов · roadmap · KPI ·
 │   stop-loss · триггеры пересмотра · confidence
 ├─ Сравнение: 2–3 сценария рядом (таблица дельт)
 ├─ Stress-test: «а если конверсия −30%?» — быстрые пере-прогоны ядра (без LLM)
 ├─ Sensitivity: топ-3 драйвера по влиянию на результат (расчёт ядра: ±10% каждого драйвера)
 └─ Действия: [Сохранить] [Экспорт PDF] [Обсудить с ГРИ] [→ В Точку Б] [Шаги → в план 90д]
```

«→ В Точку Б» переносит выбранный сценарий как *черновик* целей (не перезаписывает Точку Б без
подтверждения). «Обсудить с ГРИ» — чат A1 c surface='simulator' и снапшотом симуляции в контексте.

## 4. Типы симуляций (K3): 9 MVP-типов + 5 расширенных

| # | Тип | Ключевые рычаги ядра |
|---|---|---|
| 1 | Рост выручки | лиды, конверсия, чек, повторные покупки |
| 2 | Запуск нового продукта | доля каннибализации, ramp-up кривая, CAC нового сегмента |
| 3 | Изменение позиционирования | чек ±, конверсия ± (переходный провал), отток |
| 4 | Оптимизация команды | ФОТ, производительность, стоимость найма/увольнения, риск качества |
| 5 | Снижение затрат | статьи затрат (из s9n_expense_*), эффект на качество/выручку |
| 6 | Масштабирование продаж | +менеджеры (ramp 2-3 мес), CRM-конверсия, ёмкость лидгена |
| 7 | Антикризисный план | стоп-затраты, быстрый приток, runway-кривая |
| 8 | Выход на новый рынок | CAC×2..4 допущение, срок до первой сделки, локальные затраты |
| 9 | Изменение бизнес-модели | подписка/разовые: LTV-кривая, cash-провал перехода |
| 10 | «6 месяцев» на данных GRI (G5) | автоматический: слабые блоки → drag-коэффициенты роста |
| 11 | Найм ключевого сотрудника | зарплата vs высвобожденные часы × ценность часа собственника |
| 12 | Изменение цены | эластичность (вводится как допущение-диапазон!), отток, маржа |
| 13 | Внедрение CRM/воронки | +конверсия из бенчмарка внедрений (диапазон), стоимость, срок |
| 14 | Выход из операционки | делегирование → часы → либо рост, либо затраты на замену |

MVP: типы 1, 5, 7 (максимально считаемые из имеющихся данных). Остальные — по мере готовности
рычагов.

## 5. Правила прогнозов (K4) и JSON-схема результата (K5)

Правила (enforced схемой + validator): только диапазоны и сценарии; обязательные разделы
данных/допущений/недостающего/уверенности/рисков; запрещённые формулировки («будет», «вы
получите», «гарантированный») — deterministic-фильтр; каждая цифра narrative обязана существовать
в выходе ядра.

```json
{
  "$id": "business_simulation.result.v1",
  "type": "object",
  "required": ["version", "sim_type", "title", "horizon_months", "inputs_used", "assumptions",
               "missing_data", "scenarios", "risks", "opportunities", "first_steps", "roadmap",
               "kpis", "stop_loss_conditions", "revision_triggers", "confidence",
               "recommendation", "next_action_for_gri", "export_summary"],
  "properties": {
    "version": {"const": 1},
    "sim_type": {"enum": ["revenue_growth","new_product","repositioning","team_optimization",
      "cost_reduction","sales_scaling","anti_crisis","new_market","business_model_change",
      "six_month_gri","key_hire","price_change","crm_funnel","owner_exit"]},
    "title": {"type": "string"}, "description": {"type": "string"},
    "horizon_months": {"enum": [3, 6, 12]},
    "inputs_used": {"type": "array", "items": {"type": "object",
      "properties": {"field": {"type": "string"}, "value": {}, "source":
        {"enum": ["survey","documents","metrics","point_a","point_b","gri","user_input"]}}}},
    "assumptions": {"type": "array", "items": {"type": "object", "required": ["text", "impact"],
      "properties": {"text": {"type": "string"}, "impact": {"enum": ["low","medium","high"]},
        "user_confirmed": {"type": "boolean"}}}},
    "missing_data": {"type": "array", "items": {"type": "string"}},
    "scenarios": {"type": "object", "required": ["optimistic", "realistic", "pessimistic"],
      "properties": {
        "optimistic": {"$ref": "#/$defs/scenario"},
        "realistic": {"$ref": "#/$defs/scenario"},
        "pessimistic": {"$ref": "#/$defs/scenario"}}},
    "risks": {"type": "array", "maxItems": 7, "items": {"type": "object",
      "properties": {"text": {"type": "string"}, "severity": {"enum": ["low","medium","high"]},
        "mitigation": {"type": "string"}}}},
    "opportunities": {"type": "array", "maxItems": 5, "items": {"type": "string"}},
    "first_steps": {"type": "array", "minItems": 3, "maxItems": 5, "items": {"type": "object",
      "properties": {"text": {"type": "string"}, "week": {"type": "integer"},
        "success_criterion": {"type": "string"}}}},
    "roadmap": {"type": "array", "items": {"type": "object",
      "properties": {"month": {"type": "integer"}, "focus": {"type": "string"},
        "milestones": {"type": "array", "items": {"type": "string"}}}}},
    "kpis": {"type": "array", "maxItems": 6, "items": {"type": "object",
      "properties": {"name": {"type": "string"}, "target_range": {"type": "array",
        "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "unit": {"type": "string"}}}},
    "stop_loss_conditions": {"type": "array", "minItems": 1, "items": {"type": "string"}},
    "revision_triggers": {"type": "array", "items": {"type": "string"}},
    "confidence": {"type": "object", "required": ["score", "reasons"],
      "properties": {"score": {"enum": ["low","medium","high"]},
        "reasons": {"type": "array", "items": {"type": "string"}}}},
    "recommendation": {"type": "string", "maxLength": 600,
      "description": "сценарная рекомендация с оговорками, не директива"},
    "next_action_for_gri": {"type": "string"},
    "export_summary": {"type": "string", "maxLength": 900}
  },
  "$defs": {
    "scenario": {"type": "object",
      "required": ["label", "monthly", "outcome_ranges", "drivers"],
      "properties": {
        "label": {"type": "string"},
        "monthly": {"type": "array", "items": {"type": "object", "properties": {
          "month": {"type": "integer"}, "revenue_range": {"type": "array", "items": {"type": "number"}},
          "cash_range": {"type": "array", "items": {"type": "number"}}}},
          "description": "рассчитано ядром, НЕ LLM"},
        "outcome_ranges": {"type": "object", "description": "итоговые диапазоны: revenue, profit, team, runway"},
        "drivers": {"type": "array", "items": {"type": "string"}}
      }}
  }
}
```

## 6. Хранение и API (миграция 052)

```sql
CREATE TABLE business_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid,
  sim_type text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed','archived')),
  inputs jsonb NOT NULL,        -- вводы+рычаги+ограничения
  result jsonb,                 -- схема §5
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
-- RLS self; лимит: 20 строк на пользователя (проверка в API) + paywall-лимит G1
```

API: `GET/POST /api/v1/simulator` (список/создать), `POST /api/v1/simulator/[id]/run`
(ядро+LLM, rate-limit 4/мин, maxDuration 300 как у analyze), `PATCH/DELETE /api/v1/simulator/[id]`,
`POST /api/v1/simulator/[id]/to-point-b` (черновик целей), `POST .../to-plan` (шаги → action_items).
Экспорт: `renderSimulationPdf` (pdfkit, по образцу Point B).

## 7. Тесты

1. Ядро: снапшот-тесты помесячной математики по каждому типу; sensitivity корректна (обяз. 11-смежные).
2. Недостаточно данных → missing_data + confidence=low, запуск не блокируется, но narrative
   осторожный (обяз. тест 9).
3. Конфликтующие данные (выручка из анкеты ≠ из документа) → шаблон Т12 в предпросмотре,
   симуляция требует выбора значения (обяз. 10).
4. LLM-narrative с числом, отличным от ядра → validator needs_revision (числовой grounding).
5. Сохранение/загрузка/архив; лимит 20; RLS-IDOR (обяз. 11, 14).
6. Экспорт PDF собирается из result без пересчёта (обяз. 12).
7. Forbidden-phrases в narrative («гарантированно») → переписывание.
