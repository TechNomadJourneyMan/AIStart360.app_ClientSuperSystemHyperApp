# 02 · A2 Next Best Action · A3 «5 решающих ставок» · A4 Интерактивный план 90 дней

---

## A2. Next Best Action (H1 · S-M · 🔥🔥🔥)

Единый блок на дашборде: **одно** главное действие сейчас + «почему» + «объясни с ГРИ» +
«выполнено». Детерминированный скоринг (без LLM в выборе — воспроизводимость и тестируемость);
LLM (Haiku) только для человеческой формулировки, с шаблонным фолбэком.

### 1. Таблица сигналов

Источники — всё уже существующие данные. `[DEP: GRI/CRM]` — таблицы 044.

| # | Сигнал | Источник | Базовый вес | Условие активации |
|---|---|---|---|---|
| S1 | Просроченные CRM-напоминания | `crm_reminders` (due < now, не done) `[DEP]` | 90 | ≥1 просрочено; +2 за каждое (cap +10) |
| S2 | Красная зона Точки А | `point A blocks: status='red'` (aggregator) | 85 | есть red-блок; выбирается worst |
| S3 | Главное ограничение GRI | `gri_assessments.top_5_limits[0]` | 80 | есть текущий assessment |
| S4 | Анкета не завершена | `computeCompletion()` (lib/assistant/completion.ts) | 75 | completion < 70% |
| S5 | Следующая задача плана 90д | `action_items` ближайшая не выполненная (по horizon) | 65 | есть активный план |
| S6 | Пульс давно не снимался | `gri_pulse_responses.week_start` (последний) | 60 | > 14 дней |
| S7 | Re-scan GRI пора | `gri_assessments.created_at` текущего | 55 | > 90 дней (связь с C2) |
| S8 | Психопрофиль не заполнен | `founder_psych_profiles` отсутствует | 35 | отчёт есть, профиля нет |
| S9 | Документы не загружены | `document_summaries` = 0 | 30 | completion ≥ 70% |

Модификаторы: стадия бизнеса (Point A `stage`): для `seed` вес S4/S9 +10; для `scale` S1/S5 +10.
Цель пользователя (`s6_goal_*` / period-goals): сигнал, соответствующий цели, +5.
Психопрофиль (файл 07): тег `avoids_sales` → S1 +5 (мягкий подталкивающий буст, см. анти-манипуляцию §7).

### 2. Алгоритм и псевдокод

```
function selectNextBestAction(userId):
  signals = collectSignals(userId)          // параллельные выборки, каждая null-safe
  candidates = signals.filter(active)
  for c in candidates:
      c.score = base(c) + modifiers(c, stage, goal, psych)
      if wasDismissed(c.actionKey, within=72h): c.score -= 100     // кулдаун
      if wasCompleted(c.actionKey, within=7d):  c.score -= 100     // не повторяем
  winner = max(candidates, key=score, tiebreak=фикс. порядок S1>S2>S3>...)
  if winner is None or winner.score <= 0: return fallback()        // §5
  return buildAction(winner)                 // title, reason, cta, links
```

`actionKey` — стабильный ключ вида `crm_overdue`, `red_zone:{blockId}`, `gri_limit:{criterionId}`,
`plan_task:{taskId}` — по нему работают кулдауны и логирование.

**Только одно действие** — инвариант (тест 18): API всегда возвращает 0 или 1 действие.

### 3. Модель данных (миграция 048)

Выбор — на лету (compute-on-read, кэш 5 мин в React Query). Храним только события:

```sql
CREATE TABLE nba_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  event text NOT NULL CHECK (event IN ('shown','done','dismissed','explained','why_opened')),
  payload jsonb,                -- снимок: score, signal, title
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nba_log_user_idx ON nba_log(user_id, action_key, created_at DESC);
-- RLS: self insert/select; staff select после Q4.
```

### 4. API

| Метод | Роут | Ответ |
|---|---|---|
| GET | `/api/v1/nba` | `{action: {key,title,reason,why,cta:{label,href},source:{type,ref}} \| null, generated_at}` |
| POST | `/api/v1/nba/event` | `{key, event: 'done'\|'dismissed'\|'why_opened'\|'explained'}` → 204 |

«Объясни с ГРИ» — фронт открывает чат A1 с prefill `Объясни, почему сейчас важно: {title}`
(+ событие `explained`). «Выполнено» по `plan_task:*` дополнительно закрывает задачу плана (A4).

### 5. Fallback-правила

1. Нет ни одного сигнала (новый пользователь) → действие «Пройти диагностику» (стат. карточка).
2. Все сигналы в кулдауне → «Всё под контролем 🐾 Ближайший шаг из плана — {след. задача}» либо
   скрыть блок (если и плана нет).
3. Ошибка любой выборки → сигнал пропускается (никогда не 500 всего блока).
4. LLM-формулировка упала → шаблонная строка из словаря `NBA_TEMPLATES[actionKey]`.

### 6. UI-состояния

Карточка «Главное действие сейчас» вверху дашборда (owner/client), тон hero-блока:
`default` (title + reason + 3 кнопки: Выполнено / Почему это важно? / Объясни с ГРИ),
`done` (галочка + следующее действие подъезжает), `empty` (fallback 1/2), `loading` (skeleton),
`error` (блок скрыт — дашборд не деградирует). Кнопка «Почему?» раскрывает `why`:
конкретика сигнала («3 напоминания просрочены: Иван — 5 дней…») + ссылка на источник.

### 7. Анти-паттерны (обязательные ограничения)

- Не более 1 действия; никаких «а ещё 5 рекомендаций» в этом блоке.
- Психопрофиль может только мягко перевешивать (<±10), не диктовать; текст never «стыдит».
- Reason всегда фактический (числа из сигналов), не сгенерированные утверждения.
- Dismiss без наказания: «Скрыть» = кулдаун 72ч, без потери прогресса.

### 8. Тест-кейсы

1. Просроченный reminder + красная зона → выбирается S1 (вес).
2. Dismiss → 72ч не показывается, показывается следующий по score.
3. Пустой аккаунт → «Пройти диагностику».
4. LLM недоступен → шаблонная формулировка, блок работает.
5. Инвариант единственности (property-тест по случайным наборам сигналов).
6. done по plan_task закрывает задачу в action_items.
7. RLS: чужие nba_log недоступны.

---

## A3. «5 решающих ставок» (M2 · S · 🔥🔥)

Переупаковка `top_5_limits`: из «списка проблем» в «ставка → эффект на GRI → первый шаг».
Заодно **чинится shape mismatch** (аудит: продюсер пишет `criterionText/blockName`, потребители
ждут `title/block/severity`).

### 1. Новая структура (v2), обратная совместимость

`lib/gri-calculator/top5-action-plan.ts` — `computeTop5Limits` дополняется маппером `toBetV2`:

```ts
export interface Top5BetV2 {
  // legacy-поля сохраняются (не ломаем share/PDF/assistant):
  criterionId: string; criterionText: string; blockId: string; blockName: string; score: number
  // v2:
  rank: 1|2|3|4|5
  title: string            // «Ставка: внедрить скрипты продаж»
  problem: string          // какую проблему решает (из criterionText)
  why_now: string          // почему важно (связь с блоком/стадией)
  expected_gri_effect: { block: string; from: number; to_range: [number, number] } // консервативно
  first_step: string       // конкретный первый шаг ≤ 1 недели
  success_metric: string   // как поймём, что сработало
  risk: string             // главный риск ставки
  horizon: '1-30'|'31-60'|'61-90'
  agent_id: string         // рекомендуемая персона ГРИ (файл 06), напр. 'growth_strategist'
  plan_task_ids: string[]  // связь с задачами A4
}
```

`expected_gri_effect` считается **детерминированно**: `to_range = [score+1, min(score+3, 10)]`
на уровне критерия → пересчёт вклада в блок по формуле секции. Никаких LLM-обещаний по индексу.
LLM (Sonnet, structured) заполняет только текстовые поля `title/why_now/first_step/success_metric/risk`
из фактов критерия; при недоступности — детерминированный шаблон из справочника критериев.

### 2. Prompt-шаблон (генерация текстов ставки)

```
Ты — бизнес-методолог. По слабому критерию GRI сформулируй «решающую ставку».
ФАКТЫ: критерий «{criterionText}», блок «{blockName}», оценка {score}/10,
стадия {stage}, отрасль {industry}.
Верни JSON {title, why_now, first_step, success_metric, risk}. Правила: first_step — одно
конкретное действие на ≤1 неделю; никаких гарантий и цифр, которых нет в ФАКТАХ; язык — {locale}.
```

JSON-schema: 5 строковых полей, maxLength 200/300/200/150/200. Валидатор: deterministic-слой
(нет запрещённых обещаний «гарантированно», «вырастет на X%» без источника).

### 3. UI-формат

Вкладка «Результат» `/gri`: секция «5 решающих ставок» — карточки с rank-бейджем, эффектом
(«Блок “Продажи”: 4 → 5–7»), первым шагом (кнопка «В план» → создаёт/подсвечивает задачу A4),
риском (свёрнуто), «Обсудить с ГРИ» (чат A1, prefill + `personaId=agent_id`). В PDF — таблица
(рендерер уже принимает `top5` — расширить колонки).

### 4. Тест-кейсы

1. v2-маппер: legacy-поля не изменились (снапшот-тест share/PDF/assistant-потребителей).
2. `expected_gri_effect` в допустимых границах, `to<=10`.
3. LLM-фолбэк: тексты из справочника при отсутствии ключа.
4. «В план» создаёт задачу, повторный клик не дублирует.
5. Потребители `title/block/severity` больше не получают undefined (регресс аудита).

---

## A4. Интерактивный план 90 дней (H1 · M · 🔥🔥🔥)

`action_plan_90d` (JSONB, read-only) уже оверлеится таблицей `action_items` (миграция 030) и
доской `ActionPlanBoard`. Делаем полноценный чек-лист.

### 1. UX-flow

```
/gri → «Результат» → блок «План 90 дней»  (и отдельный экран /action-plan — уже есть доска)
 ├─ Прогресс-бар: «Выполнено 7 из 18 (39%)» + разбивка по горизонтам 1-30/31-60/61-90
 ├─ Группировка: по неделям (вычислено от даты assessment) и по направлениям (blockName)
 ├─ Задача: чекбокс · титул · блок · срок · [Объясни с ГРИ] [Отложить] [Заменить] [Комментарий]
 ├─ После 3 выполненных с последнего пульса → toast: «Отличный темп! Переснимите пульс,
 │   чтобы увидеть сдвиг» → CTA /gri (вкладка Пульс)  (интеграция C4-паттерном)
 └─ «Заменить шаг» → модал: причина + предложение ГРИ (LLM по тому же критерию) или свой текст
```

Empty: «План появится после GRI-диагностики» + CTA. Все изменения — optimistic UI + refetch
(урок админ-аудита 2026-07-04: optimistic без refetch скрывал сбой RLS).

### 2. Схема (миграция 049 — расширение `action_items`)

```sql
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','done','snoozed','replaced','dropped')),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS snoozed_until date,
  ADD COLUMN IF NOT EXISTS replaced_by uuid REFERENCES action_items(id),
  ADD COLUMN IF NOT EXISTS user_comment text,
  ADD COLUMN IF NOT EXISTS week_no int,                 -- 1..13, от даты assessment
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'plan'
    CHECK (source IN ('plan','bet','user','gri_suggested'));
-- ПРОВЕРИТЬ фактические колонки 030 перед ALTER (идемпотентность через IF NOT EXISTS)
```

### 3. API (расширение `app/api/v1/action-plan`)

| Метод | Роут | Действие |
|---|---|---|
| GET | `/api/v1/action-plan` | план + задачи + прогресс `{done,total,pct,byHorizon}` (существующий, дополняется) |
| PATCH | `/api/v1/action-plan/tasks/[id]` | `{status?/snoozed_until?/user_comment?}`; done проставляет completed_at |
| POST | `/api/v1/action-plan/tasks/[id]/replace` | `{mode:'ai'\|'manual', text?}` → новая задача, старая `replaced` |
| POST | `/api/v1/action-plan/tasks` | ручная задача (source='user') |

### 4. Логика прогресса и напоминаний

- Прогресс: `done / (total - dropped - replaced)`; по горизонтам отдельно.
- `week_no` = `ceil((today - assessment.created_at)/7)`, cap 13; просроченные horizon-задачи
  подсвечиваются, но **не краснеют агрессивно** (no-shame, см. C3).
- Напоминания: канал уведомлений `app_notifications` (037) — еженедельная запись «на этой неделе
  по плану: …» из cron-джоба `[DEP: GRI/CRM vercel.json cron]`; email/telegram — после Фазы 4.
- Снапшот прогресса пишется в `assistant_events` (`plan_progress`) — сигнал для NBA (S5), дайджеста (C1)
  и празднования (C2).

### 5. Интеграции

- **Пульс:** правило «3 done с даты последнего `gri_pulse_responses.week_start` → nudge» (§1).
- **GRI re-scan:** при новом assessment старый план архивируется (status задач не теряется,
  план привязан к assessment_id), новый генерируется; миграция невыполненных задач — предложение
  «перенести 4 незакрытые задачи в новый план?».
- **NBA:** ближайшая todo-задача = сигнал S5; done из NBA закрывает задачу здесь.
- **Ставки (A3):** «В план» создаёт задачу source='bet' со ссылкой plan_task_ids.
- **ГРИ-чат:** «Объясни шаг» → prefill в A1 с ref задачи (used_sources: action_plan).

### 6. Тест-кейсы

1. done/undo меняет прогресс и completed_at корректно.
2. replace создаёт цепочку replaced_by; прогресс не двоит.
3. Просроченный snooze возвращает задачу в todo.
4. 3 done → nudge-событие ровно один раз (идемпотентность).
5. Новый assessment → старые задачи не потеряны, привязка к старому плану.
6. RLS: чужие задачи недоступны (IDOR-тест).
7. e2e: чекбокс → optimistic → refetch подтверждает персист (регресс admin-бага).
