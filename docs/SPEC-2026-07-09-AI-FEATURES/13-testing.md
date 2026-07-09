# 13 · Часть P — Тест-план (T28)

Инфраструктура: vitest 4 (73 файла есть), `tests/unit/` + `tests/integration/` +
`TEST_DATABASE_URL`-переключение (есть). Новое: (1) **AI-фикстуры** — LLM в тестах не вызывается;
записанные ответы + структурные проверки (`tests/fixtures/llm/*.json`); (2) **golden-set промптов**
`tests/prompt-regression/` — 30+ пар «контекст+вопрос → инварианты ответа», гоняются на каждое
изменение промптов (структурные assertions: наличие блоков, отсутствие forbidden-phrases,
grounding чисел); (3) e2e — пока вручную по чеклисту (playwright в стеке нет — не вводим в MVP,
кандидат на AI-3).

## Категории

| Категория | Что покрывает | Где |
|---|---|---|
| Unit | скоринг NBA, trust-формула, ядро симулятора, парсеры (quick-add, intake), streak, top5-v2, risk-флаги регистрации | tests/unit/{nba,gri-trust,simulator,crm,psych,registration}/ |
| Integration (API) | все новые роуты: auth, Zod, rate-limit, RLS/IDOR, degrade-паттерны | tests/integration/ |
| AI-output / prompt regression | golden set, forbidden-phrases, схемы ответов, persona-инварианты | tests/prompt-regression/ |
| Validation pipeline | deterministic-слой, шаблоны, маршрутизация вердиктов | tests/unit/ai-validation/ |
| Security | IDOR, RAG-скоуп, инъекции, PII-фильтры, consent-гейты | tests/integration/security/ |
| Миграции | verify-скрипты по паттерну `scripts/verify-migration-0XX.js` для 045–054 | scripts/ |
| UX acceptance | ручной чеклист на релиз (файл 14 §release criteria) | docs |
| Edge/failure | LLM-null, Upstash-null, пустые данные, конфликтные данные | во всех наборах |

## 29 обязательных тестов ТЗ → конкретные файлы

| # | Тест | Файл (предлагаемый) | Тип |
|---|---|---|---|
| 1 | Выбор Named AI-Agent | tests/unit/personas/selection.test.ts | unit |
| 2 | Fallback на базового ГРИ | там же (мусорный personaId → gri_base) | unit |
| 3 | Персонализация по психопрофилю только с consent | tests/integration/psych-consent.test.ts | int |
| 4 | Запрет мед. диагнозов | tests/prompt-regression/psych-safety.test.ts (словарь+фикстуры) | AI |
| 5 | Запрет фин. гарантий | tests/unit/ai-validation/forbidden-phrases.test.ts | unit |
| 6 | Hallucination validator | tests/unit/ai-validation/number-grounding.test.ts | unit |
| 7 | Prompt injection в файле | tests/integration/security/rag-injection.test.ts (чанк с инструкцией → инварианты) | int |
| 8 | Блокировка опасного ответа | tests/unit/ai-validation/routing.test.ts (blocked → Т16) | unit |
| 9 | Симуляция с недостаточными данными | tests/unit/simulator/missing-data.test.ts | unit |
| 10 | Симуляция с конфликтующими данными | tests/unit/simulator/conflicts.test.ts | unit |
| 11 | Сохранение/загрузка симуляции | tests/integration/simulator-crud.test.ts | int |
| 12 | Экспорт результата | tests/integration/simulator-pdf.test.ts (+account export) | int |
| 13 | Удаление персональных данных | tests/integration/account-deletion.test.ts | int |
| 14 | Доступ к чужим данным | tests/integration/security/idor-new-tables.test.ts (все новые таблицы циклом) | int |
| 15 | Rate limit AI-вызовов | tests/integration/ai-rate-limits.test.ts | int |
| 16 | Чат использует RAG | tests/integration/report-chat-rag.test.ts (фикстура-чанк попадает в used_sources) | int |
| 17 | RAG не раскрывает чужие документы | tests/integration/security/rag-scope.test.ts | int |
| 18 | NBA — только одно действие | tests/unit/nba/single-action.property.test.ts | unit |
| 19 | TrustScore не фиктивный | tests/unit/gri-trust/honest-null.test.ts | unit |
| 20 | Benchmark: ограничения и источники | tests/unit/benchmarks/labels.test.ts + датасет-валидация | unit |
| 21 | Approval-gate не блокирует нормального | tests/integration/registration-auto.test.ts | int |
| 22 | Auto-approval блокирует подозрительный кейс | там же (disposable email, IP-повторы) | int |
| 23 | Share-картинка без чувствительных данных | tests/integration/og-image.test.ts (снапшот параметров) | int |
| 24 | Conversational intake сохраняет структурированное | tests/integration/intake-pilot.test.ts | int |
| 25 | Cross-validation обрабатывает расхождения | tests/unit/cross-validation/disputed.test.ts (бейдж-логика) | unit |
| 26 | Paywall не ломает базовую диагностику | tests/integration/paywall-core-free.test.ts | int |
| 27 | Mini-GRI lead → CRM с согласием | tests/integration/minigri-to-crm.test.ts `[DEP]` | int |
| 28 | Digest не отправляется без согласия | tests/unit/digest/consent-gate.test.ts | unit |
| 29 | Investor Summary без лишнего | tests/unit/report-slices/allowlist.test.ts | unit |

## Definition of Done тестирования (каждый PR фичи)

1. Unit на чистую логику + integration на роут (auth/Zod/limit/RLS) + verify-скрипт миграции.
2. Прогон prompt-regression, если менялся любой промпт/персона/шаблон.
3. `npm test && npm run lint && npm run type-check` зелёные (команды проекта).
4. Ручной smoke по чеклисту фичи (empty/error/mobile).
