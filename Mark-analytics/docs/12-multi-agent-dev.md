# 12 — Multi-Agent Development Workflow

> Как использовать 8 Claude-сабагентов (`.claude/agents/*.md`) на этапе разработки. Все эти агенты используют Claude Opus 4.7 — это **dev-time**, не production.

## Зачем

Большая система = много контекстов. Один Claude в одной сессии:
- быстро забивает контекст
- путает фронт с бэком
- хуже принимает решения вне своей экспертизы

Решение: специализированные сабагенты с узким system prompt'ом и собственным инструментарием. Вы (или главный Claude в IDE) делегируете под-задачи им.

## Восемь dev-агентов

| # | Slug | Когда вызывать | Системный фокус |
|---|------|----------------|-----------------|
| 1 | `system-architect` | Дизайн новой подсистемы, ADR, ревью архитектуры | DDD, scalability, trade-offs |
| 2 | `backend-engineer` | Новый endpoint, изменение схемы, рефактор API | FastAPI, SQLAlchemy, Pydantic |
| 3 | `crawl-engineer` | Новый источник, антибот, fix спайдера | Scrapy, Playwright, прокси |
| 4 | `ai-engineer` | Новый prompt, model routing tweak, embeddings | AI Gateway, prompts, cache |
| 5 | `osint-engineer` | Entity resolution, граф, OSINT-источники | dedup, Neo4j, NER |
| 6 | `frontend-engineer` | UI компоненты, dashboards (Next.js репо отдельно) | React, TS, charts |
| 7 | `devops-engineer` | Деплой, CI, secrets, observability | Railway, Fly, Docker, GitHub Actions |
| 8 | `security-engineer` | Auth, secrets, audit, threat model | OWASP, AuthZ, data privacy |

Полные YAML-определения — в [`.claude/agents/`](../.claude/agents/).

## Когда какой агент

**Запрос**: «Добавь endpoint для экспорта компаний в CSV»
→ `backend-engineer` основной, `security-engineer` для permission check на больших экспортах.

**Запрос**: «Кажется, парсер 2GIS перестал работать»
→ `crawl-engineer`.

**Запрос**: «Слишком дорого, оптимизируй extraction»
→ `ai-engineer` (cache, model swap), потом `devops-engineer` если нужны метрики.

**Запрос**: «Заведи новый источник X»
→ `crawl-engineer` для spider + `ai-engineer` если нужен extraction prompt + `system-architect` если новый тип сущности.

**Запрос**: «Спроектируй фичу мониторинга людей»
→ `system-architect` сначала (план, ADR), потом backend/osint/ai по разделению.

## Правила работы

1. **Один агент = одна ответственность.** Не давайте `backend-engineer` писать prompts — это для `ai-engineer`.
2. **Главный Claude — оркестратор.** В IDE вы общаетесь с одним Claude, он зовёт сабагентов.
3. **Параллелизм.** Независимые задачи → параллельные сабагенты одновременно.
4. **Полнота брифа.** Каждый сабагент стартует с нуля — кидайте ему весь контекст в первом сообщении.
5. **Verify after delegate.** После работы сабагента — проверьте diff, не верьте слепо.

## Шаблон вызова сабагента

```
Agent({
  description: "Добавить spider для kompra.kz",
  subagent_type: "crawl-engineer",
  prompt: """
Контекст: нужно собрать ~200K карточек компаний с kompra.kz.

Уже есть:
- BaseSpider в backend/app/crawlers/base.py (R2 upload, pages write)
- Прокси-middleware в backend/app/crawlers/middlewares.py
- Структура pages в БД (см. docs/05-data-model.md)

Задача:
1. Написать spider/kz_kompra.py
2. Семя: https://kompra.kz/companies/ (пагинация)
3. Извлекать на rule-level: name, bin, address, director, phone
4. Соблюдать rate limit 30 rpm
5. Использовать Playwright для пагинации (есть infinite scroll)

Тесты: unit-тест на парсинг одного HTML-сэмпла из tests/fixtures/kompra/.

Не пиши: extraction-prompt для LLM (это для ai-engineer), деплой-конфиг.
  """
})
```

## Когда **не** использовать сабагентов

- Тривиальные задачи (rename переменной, добавить лог) — делайте сами.
- Задачи, требующие full-repo контекст — главный Claude видит больше.
- Когда вы сами знаете решение и нужно его записать.

## Файловая структура

```
.claude/
└── agents/
    ├── system-architect.md
    ├── backend-engineer.md
    ├── crawl-engineer.md
    ├── ai-engineer.md
    ├── osint-engineer.md
    ├── frontend-engineer.md
    ├── devops-engineer.md
    └── security-engineer.md
```

Каждый файл — Markdown с YAML frontmatter:
```yaml
---
name: backend-engineer
description: FastAPI/SQLAlchemy/Pydantic specialist. Use for API endpoints, DB schema, request validation.
tools: Read, Write, Edit, Bash, Grep, Glob
model: opus
---

# System prompt body...
```

Claude Code IDE автоматически подхватывает `.claude/agents/`.

## Метрика «работают ли агенты»

- Среднее число файлов на задачу, тронутых одним агентом (если > 15 — агент слишком broad).
- Доля задач, где пришлось переделывать после сабагента (> 30% — узкое распределение, надо уточнять брифы или сужать агентов).
- Скорость завершения сложных задач сравнить с до-агентным baseline.

## Дальнейшее развитие

- Phase 2: добавить `code-reviewer` агент для PR-ревью.
- Phase 3: автоматический trigger агента из CI (`pull_request opened → security-engineer review`).
- Phase 4: data-собственно агенты тестировщики (UX-tester, e2e-runner).
