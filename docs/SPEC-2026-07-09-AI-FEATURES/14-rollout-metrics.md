# 14 · План внедрения, метрики, acceptance criteria (T29–T31)

## 1. Синхронизация с действующим роадмапом

Роадмап GRI/CRM (параллельная ветка): Фазы 1–3 выполнены; Фаза 4 = каналы (Email/Telegram);
Фаза 5 = UX-пакеты по спеке 2026-07-08 §5; Фаза 6 = тарифный гейт GRI + лендинг.
Эта спецификация вводит **треки AI-1 / AI-2 / AI-3**, которые идут после мержа ветки GRI/CRM и
частично параллельно Фазам 4–6 (пересечения помечены).

## 2. AI-1 — MVP (R1 ТЗ) · ориентир 4–6 недель

**Цель:** замкнуть цикл «отчёт → понимание → одно действие → прогресс» + фундамент безопасности AI.

**Scope:** порядок исполнения внутри релиза:
1. Инфраструктура: `lib/ai/orchestration` + validation layer (deterministic + LLM) + миграция 045;
   мигрирование `requireAuth`-остатка (Q6) в затрагиваемых роутах.
2. B2 честный trustScore (+ фикс Point B s9n — маленький и важный долг).
3. RAG-чтение (046, бэкфилл) + A1 чат (3 персоны: gri_base, careful_analyst, growth_strategist).
4. A2 NBA (+ 048) и A4 интерактивный план (049).
5. E3-база: интерпретация Step 10 + consent-таблица (047) + фикс заголовка шага.
6. D3 self-serve (`auto`-режим + risk-флаги).

**Dependencies:** мерж ветки GRI/CRM (S1-сигнал NBA, cron); `ENABLE_DOCUMENT_EMBEDDINGS=true`;
prod-миграции 043-044 применены (чеклист пользователя).

**Risks:** стоимость LLM-валидации (митигация: deterministic-first, Haiku, risk-гейтинг);
скорость ответа чата (два вызова: ~6–10с — приемлемо без стриминга, замерить);
качество NBA-фраз (фолбэк-шаблоны обязательны).

**Release criteria:** обязательные тесты 1–8, 13–19, 21–22 зелёные; golden-set пройден;
9 из 10 ответов чата на тест-аккаунте (client@aistart360.test) grounded (ручная проверка);
NBA показывается ≤300мс p95 (кэш); нулевые IDOR по чеклисту.

**Rollback:** env-флаги (AI_CHAT_ENABLED, NEXT_PUBLIC_FEATURE_NBA, REGISTRATION_AUTO,
AI_VALIDATOR_MODE=deterministic) — мгновенно, без миграций вниз.

**Metrics gate (2 недели после):** first chat message sent ≥ 30% пользователей с отчётом;
NBA click-through ≥ 40%; validator blocked rate < 5% (иначе разбор); жалоб на «чушь» — 0 критических.

## 3. AI-2 (R2 ТЗ) · после стабилизации AI-1

Порядок: (1) A3 ставки + фикс top5-shape → (2) B1 методология + B3 бенчмарки → (3) C2 re-scan
празднование + C4 unlock-toasts → (4) остальные 5 персон + полный психопрофиль (5 механик) →
(5) C1 дайджест-генератор (стыкуется с Фазой 4 каналов) + G4 mini-GRI→CRM → (6) D1 sample,
D2 ROI, D4 OG-share → (7) E1 investor summary, E2 видео-разбор (после Q4-скоупинга) →
(8) F1 intake-pilot (A/B), F2 quick-add парсер, F3 cross-validation → (9) B4 источники,
C3 стрик → (10) симулятор MVP (типы 1/5/7; 052).

Каждый пункт: цель/критерии в своём файле; общий release-паттерн AI-1 (флаг, тесты, metrics gate).
Пересечение с Фазой 6 (тарифный гейт): G1 paywall-инфраструктура ставится здесь в «тихом режиме»
(события без enforcement) — гейт включает Фаза 6.

## 4. AI-3 (R3 ТЗ)

White-label (после юр. модели), GRI-кредиты, полный симулятор (все 14 типов + 6-месячная
GRI-симуляция), живая анонимная база бенчмарков, PersonalizationMemory с UI-просмотром,
отраслевые mini-GRI (D5), D6 валюта, стриминг чата, playwright-e2e.

## 5. Метрики (Часть S) → события

Инструментация: `assistant_events` (существующая, без текстов) + `paywall_events` + `nba_log`.

| Группа | Метрика | Событие/источник |
|---|---|---|
| Activation | completion анкеты; time-to-first-report; report viewed; **first chat message**; **NBA clicked**; first plan task done; self-serve conversion | survey_step_*, report_view, chat_message, nba_log, action_items, profiles.status |
| Engagement | WAU; chat sessions/user; pulse rescan rate; plan completion %; digest open/CTR; return 7/30/90 | events + gri_pulse_responses + Resend webhooks |
| Trust | methodology views; benchmark interactions; trust tooltip opens; citation opens; export rate; investor summary generated | page_view + ui events |
| Monetization | paywall view→upgrade; video review conversion; PDF/benchmark upgrade; credits usage | paywall_events, expert_reviews, credit_transactions |
| AI quality | validator blocked/revised rate; hallucination_risk distribution; cross-model disagreement; 👍/👎; fallback rate; unsafe incidents (=0 цель); injection blocked | ai_messages.validation, Langfuse, assistant_events |

Дашборд метрик — giga-panel модуль (AI-2), до того — SQL-выборки.

## 6. Acceptance criteria (Часть U) — самопроверка спецификации

| Критерий | Где выполнен |
|---|---|
| Функции описаны до реализуемости | файлы 01–09: схемы SQL/JSON, API, промпты, тесты |
| 29 идей встроены в архитектуру, не перечислены | карта 00 §4 + сквозные связи (NBA↔план↔пульс↔дайджест↔чат) |
| Приоритеты/effort/effect расставлены и объяснены | 00 §4 (+пересмотры: D3 удешевлён — гейт уже наполовину есть) |
| MVP не перегружен | 8 элементов, симулятор/дайджест/OG вынесены |
| Персоны глубокие, персонализация не поверхностная | 06 (психология/слабости/anti-manipulation), 07 (подтверждение гипотез) |
| Психопрофиль без мед. границ | 07 (жёсткая рамка + словарь запретов + тест 4) |
| Intake снижает галлюцинации | 08 (deterministic number-grounding — главный механизм, не только LLM-судья) |
| Шаблоны безопасных ответов | 08 §3 — 17 шт. |
| Симулятор ≠ факты | 09 (ядро-диапазоны + схема + фильтры) |
| RAG осмысленно | 01 (достройка чтения, скоупинг, grounding-chips) |
| trustScore честный | 03 B2 (формула/null) |
| NBA — одно действие | 02 (инвариант + property-тест) |
| План 90д интерактивный | 02 A4 |
| Бенчмарки честные / источники у market | 03 B3/B4 |
| Self-serve без потери безопасности | 04 D3 (флаги+audit+kill-switch) |
| JSON-схемы / API / БД / UX / security / тесты / rollout | 01–14 соответственно |
| Совместимость со стеком | всё на существующих паттернах (OpenRouter, Supabase RLS, plain SQL, vitest, sonner, pdfkit) |
| High-risk зоны с ограничениями и fallback | 08 §6, 10 §5, 12 §1 |
